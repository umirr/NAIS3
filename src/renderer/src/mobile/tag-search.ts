import type { IpcInvokeMap } from '@shared/types'

type Search = IpcInvokeMap['tags:search']
let worker: Worker | null = null
let nextId = 0
const pending = new Map<
  number,
  {
    resolve: (value: Search['res']) => void
    reject: (error: Error) => void
  }
>()

export function searchMobileTags(request: Search['req']): Promise<Search['res']> {
  if (!worker) {
    worker = new Worker(new URL('./tag-search.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<Search['res'] & { id: number; error?: string }>) => {
      const call = pending.get(event.data.id)
      if (!call) return
      pending.delete(event.data.id)
      if (event.data.error) call.reject(new Error(event.data.error))
      else call.resolve({ items: event.data.items })
    }
    worker.onerror = () => {
      worker?.terminate()
      worker = null
      for (const call of pending.values()) call.reject(new Error('Tag search worker failed'))
      pending.clear()
    }
  }
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker!.postMessage({ ...request, id })
  })
}
