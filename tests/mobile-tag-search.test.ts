import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('searches bundled tags in the worker and retries a failed asset read', async () => {
  const postMessage = vi.fn()
  const scope = { postMessage, onmessage: undefined as unknown }
  vi.stubGlobal('self', scope)
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { value: 'long hair', count: 100, type: 'general' },
        { value: 'very long hair', count: 200, type: 'general' }
      ]
    })
  vi.stubGlobal('fetch', fetch)
  await import('../src/renderer/src/mobile/tag-search.worker')
  const receive = scope.onmessage as (event: { data: unknown }) => Promise<void>
  await receive({ data: { id: 1, query: 'long_' } })
  expect(postMessage).toHaveBeenLastCalledWith({ id: 1, error: 'Cannot load bundled tags' })
  await receive({ data: { id: 2, query: 'long_', limit: 2 } })
  expect(postMessage.mock.lastCall![0].items.map((item: { tag: string }) => item.tag)).toEqual([
    'long hair',
    'very long hair'
  ])
  await receive({ data: { id: 3, query: 'very' } })
  expect(fetch).toHaveBeenCalledTimes(2)
})
