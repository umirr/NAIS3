import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ workers: [] as FakeWorker[] }))
class FakeWorker extends EventEmitter {
  terminate = vi.fn(async () => 0)
  unref = vi.fn(() => {
    expect(this.listenerCount('message')).toBe(1)
  })
  postMessage = vi.fn()
  constructor() {
    super()
    state.workers.push(this)
  }
}
vi.mock('worker_threads', () => ({ Worker: FakeWorker }))
vi.mock('electron', () => ({ app: { getAppPath: () => '/app' } }))
vi.mock('../src/main/nai/qwen-tokenizer.worker?modulePath', () => ({ default: 'worker.js' }))
beforeEach(() => {
  vi.resetModules()
  state.workers = []
})
it('unrefs after attaching listeners and terminates pending work on shutdown', async () => {
  const { countQwenTokens, disposeQwenTokenizer } = await import('../src/main/nai/qwen-tokenizer')
  const pending = countQwenTokens(['hello'])
  const rejected = expect(pending).rejects.toThrow('shutting down')
  expect(state.workers[0].unref).toHaveBeenCalledOnce()
  disposeQwenTokenizer()
  await rejected
  expect(state.workers[0].terminate).toHaveBeenCalledOnce()
  await expect(countQwenTokens(['again'])).rejects.toThrow('shutting down')
  expect(state.workers).toHaveLength(1)
  disposeQwenTokenizer()
  expect(state.workers[0].terminate).toHaveBeenCalledOnce()
})
