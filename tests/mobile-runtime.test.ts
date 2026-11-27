// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import {
  emptyState,
  configureWorkspaceStorage,
  readBrowserState
} from '../src/renderer/src/browser/browser-db'

const native = vi.hoisted(() => ({
  changed: null as null | ((status: unknown) => void),
  status: vi.fn(async () => ({
    items: [],
    completed: [],
    recovered: false,
    running: false,
    delayMs: 600
  }))
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android', convertFileSrc: (uri: string) => `local:${uri}` },
  CapacitorHttp: {},
  registerPlugin: () => ({
    status: native.status,
    addListener: async (_: string, callback: (status: unknown) => void) => {
      native.changed = callback
      return { remove: async () => undefined }
    }
  })
}))
vi.mock('../src/renderer/src/browser/install-browser-api', () => ({ configureGateway: vi.fn() }))
vi.mock('../src/renderer/src/browser/browser-workspace', () => ({ browserFragmentSource: vi.fn() }))
import { installMobileRuntime } from '../src/renderer/src/mobile/install-mobile-runtime'

it('notifies scene listeners only after durable catalog save, without duplicating completed jobs', async () => {
  let stored = emptyState()
  configureWorkspaceStorage({
    read: async () => structuredClone(stored),
    write: async (state) => {
      stored = structuredClone(state)
    }
  })
  const unsubscribe = vi.fn()
  window.nais = { invoke: vi.fn(), on: vi.fn(() => unsubscribe) } as unknown as typeof window.nais
  await installMobileRuntime()
  const sceneChanged = vi.fn(() => {
    expect(stored.images).toHaveLength(1)
  })
  const off = window.nais.on('scenes:changed', sceneChanged)
  const job = {
    id: 'completed-job',
    state: 'done',
    request: { sceneId: 7, seed: 123 },
    filePath: 'content://images/one',
    createdAt: '2026-11-28T00:00:00.000Z',
    payloadJson: '{}'
  }
  const status = { items: [job], completed: [job], running: false, recovered: false, delayMs: 600 }
  native.changed!(status)
  await vi.waitFor(() => expect(sceneChanged).toHaveBeenCalledTimes(1))
  expect(sceneChanged).toHaveBeenCalledWith({ sceneId: 7, filePath: 'local:content://images/one' })
  native.changed!(status)
  // queue:status waits for the preceding reconciliation operation.
  await window.nais.invoke('queue:status', undefined)
  expect((await readBrowserState()).images).toHaveLength(1)
  expect(sceneChanged).toHaveBeenCalledTimes(1)
  off()
  expect(unsubscribe).toHaveBeenCalledOnce()
})
