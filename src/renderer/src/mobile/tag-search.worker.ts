import { buildTagIndex, createTagSearcher, type RawTag, type TagSearcher } from '@shared/tag-search'

let searcher: Promise<TagSearcher> | null = null
function load(): Promise<TagSearcher> {
  if (!searcher) {
    searcher = (async () => {
      const response = await fetch(new URL('../../../../resources/tags.json', import.meta.url))
      if (!response.ok) throw new Error('Cannot load bundled tags')
      return createTagSearcher(buildTagIndex((await response.json()) as RawTag[]))
    })().catch((error) => {
      searcher = null
      throw error
    })
  }
  return searcher
}

self.onmessage = async (event: MessageEvent<{ id: number; query: string; limit?: number }>) => {
  const { id, query, limit } = event.data
  try {
    const index = await load()
    self.postMessage({ id, items: index.search(query, limit) })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
