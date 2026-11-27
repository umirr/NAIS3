import { CapacitorHttp, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { NaisApi } from '../../../preload/index'
import type {
  GenerationRequest,
  IpcEventMap,
  IpcInvokeMap,
  QueueItem,
  QueueStatus
} from '@shared/types'
import { buildGenerateImagePayload } from '../../../main/nai/payload'
import { ENDPOINTS } from '../../../main/nai/endpoints'
import { preprocessRequest } from '../../../main/fragments/request'
import { parseSubscriptionResponse, type NaiSubscriptionResponse } from '@shared/subscription'
import { applyRandomCharacterPrompt } from '@shared/random-character'
import { browserFragmentSource } from '../browser/browser-workspace'
import { mutateBrowserState, nextBrowserId, readBrowserState } from '../browser/browser-db'
import { configureGateway } from '../browser/install-browser-api'
import { isAndroid, nativeImageUrl, nativeStorage } from './native-storage'

interface NativeQueueStatus extends QueueStatus {
  recovered: boolean
  completed: (QueueItem & { payloadJson: string; createdAt: string; filePath: string })[]
}
interface NativeGeneration {
  status(): Promise<NativeQueueStatus>
  enqueue(options: { jobs: unknown[] }): Promise<{ ids: string[] }>
  resume(): Promise<void>
  cancel(options: { ids: string[] }): Promise<void>
  addListener(
    event: 'changed',
    callback: (status: NativeQueueStatus) => void
  ): Promise<PluginListenerHandle>
}
const generation = registerPlugin<NativeGeneration>('NaisGeneration')

export async function installMobileRuntime(): Promise<void> {
  if (!isAndroid()) return
  const base = window.nais
  const listeners = new Set<(value: QueueStatus) => void>()
  let sync: Promise<void> = Promise.resolve()
  const reconcile = (status: NativeQueueStatus): Promise<void> => {
    const next = sync.then(async () => {
      const existing = await readBrowserState()
      const known = new Set(existing.images.map((image) => image.mobileJobId))
      const fresh = status.completed.filter((job) => !known.has(job.id))
      if (fresh.length)
        await mutateBrowserState((state) => {
          for (const job of fresh) {
            if (state.images.some((image) => image.mobileJobId === job.id)) continue
            const path = nativeImageUrl(job.filePath)
            state.images.unshift({
              id: nextBrowserId(state),
              mobileJobId: job.id,
              filePath: path,
              thumbnail: '',
              base64: '',
              kind: job.request.sceneId == null ? 'generated' : 'scene',
              seed: job.request.seed,
              createdAt: job.createdAt,
              payloadJson: job.payloadJson,
              sceneId: job.request.sceneId ?? null,
              favorite: false
            })
            const scene = state.scenes.find((item) => item.id === job.request.sceneId)
            if (scene) {
              scene.imageCount++
              scene.thumbnailPath = path
            }
          }
        })
    })
    sync = next.catch(() => undefined)
    return next
  }
  const publicStatus = (status: NativeQueueStatus): QueueStatus => ({
    items: status.items.map((item) => ({
      ...item,
      ...(item.filePath ? { filePath: nativeImageUrl(item.filePath) } : {})
    })),
    running: status.running,
    delayMs: status.delayMs
  })
  await reconcile(await generation.status())
  await generation.addListener('changed', (status) => {
    void reconcile(status)
      .then(() => {
        for (const listener of listeners) listener(publicStatus(status))
        window.dispatchEvent(new CustomEvent('nais:mobile-queue', { detail: status }))
      })
      .catch(() => {
        window.dispatchEvent(new Event('nais:mobile-storage-error'))
      })
  })

  configureGateway(async (route, data) => {
    const body = data as { token?: string }
    if (route === 'balance' || route === 'verify-token') {
      const response = await CapacitorHttp.get({
        url: ENDPOINTS.subscription,
        headers: { Authorization: `Bearer ${body.token ?? ''}` },
        connectTimeout: 30000,
        readTimeout: 30000,
        disableRedirects: true,
        responseType: 'json'
      })
      if (response.status === 401 && route === 'verify-token')
        return { valid: false, error: 'Invalid API token' }
      if (response.status < 200 || response.status >= 300)
        throw new Error(`Account API returned HTTP ${response.status}`)
      const subscription = parseSubscriptionResponse(response.data as NaiSubscriptionResponse)
      return route === 'verify-token'
        ? { valid: true, subscription }
        : {
            anlas: subscription.anlasFixed + subscription.anlasPurchased,
            tier: subscription.tier,
            ...(subscription.usage ? { usage: subscription.usage } : {})
          }
    }
    // These paths must be implemented locally, never routed to a nonexistent PC gateway.
    throw new Error(`Android operation is not yet available: ${route}`)
  })

  async function invoke(channel: keyof IpcInvokeMap, request: unknown): Promise<unknown> {
    if (channel === 'app:version') return { version: '0.1.0-android-development' }
    if (channel === 'db:status') return { version: 1, path: 'Android private workspace' }
    if (channel === 'queue:status') {
      const status = await generation.status()
      await reconcile(status)
      return publicStatus(status)
    }
    if (channel === 'queue:cancel') return generation.cancel(request as { ids: string[] })
    if (channel === 'queue:enqueue') {
      const current = await generation.status()
      if (current.recovered && !current.running) {
        const ids = current.items
          .filter((item) => item.state === 'pending' || item.state === 'failed')
          .map((item) => item.id)
        await generation.resume()
        return { ids }
      }
      const input = request as IpcInvokeMap['queue:enqueue']['req']
      const state = await readBrowserState()
      const account = state.accounts.find((item) => item.id === state.activeAccountId)
      if (!account) return { ids: [], blocked: '먼저 설정에서 NovelAI 계정을 연결해 주세요.' }
      const folders = await nativeStorage.getFolders()
      const destinationUri = input.request.sceneId == null ? folders.main : folders.scene
      if (!destinationUri) return { ids: [], blocked: '먼저 설정에서 저장 폴더를 선택해 주세요.' }
      if (
        state.vibes.some((item) => item.enabled) ||
        state.charRefs.some((item) => item.enabled) ||
        input.request.source
      ) {
        return { ids: [], blocked: '모바일 레퍼런스·이미지 입력 처리가 아직 연결되지 않았습니다.' }
      }
      const count = Math.floor(input.count)
      if (!Number.isSafeInteger(count) || count < 1 || count > 1000)
        throw new Error('Invalid generation batch size')
      const jobs = Array.from({ length: count }, (_, index) => {
        const request: GenerationRequest = applyRandomCharacterPrompt(
          { ...input.request, seed: (input.request.seed + index) >>> 0 },
          input.randomCharacterPrompts ?? []
        )
        const prepared = preprocessRequest(request, browserFragmentSource(state))
        return {
          id: crypto.randomUUID(),
          request,
          token: account.token,
          destinationUri,
          delayMs: Number(state.settings.gen_delay_ms) || 600,
          payload: buildGenerateImagePayload(prepared, {
            transparentBackground: request.transparentBackground
          })
        }
      })
      return generation.enqueue({ jobs })
    }
    if (channel === 'scenes:enqueueReserved')
      return { ids: [], blocked: '모바일 씬 예약 처리가 아직 연결되지 않았습니다.' }
    return base.invoke(channel, request as never)
  }
  window.nais = {
    ...base,
    invoke: invoke as NaisApi['invoke'],
    on<C extends keyof IpcEventMap>(channel: C, listener: (payload: IpcEventMap[C]) => void) {
      if (channel !== 'queue:changed') return base.on(channel, listener)
      const wrapped = listener as (payload: QueueStatus) => void
      listeners.add(wrapped)
      return () => {
        listeners.delete(wrapped)
      }
    }
  }
}
