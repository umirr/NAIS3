import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../lib/i18n'
import { nativeStorage, nativeImageUrl, type NativeFolderEntry } from './native-storage'
import { readBrowserState } from '../browser/browser-db'
import { ImageContextMenu } from '../components/image-context-menu'

export function MobileLibraryPage(): React.JSX.Element {
  const t = useT()
  const [entries, setEntries] = useState<NativeFolderEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [limit, setLimit] = useState(60)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const sequence = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++sequence.current
    setBusy(true)
    setError(false)
    try {
      const { library } = await nativeStorage.getFolders()
      const result = library ? await nativeStorage.listFolder({ uri: library }) : { entries: [] }
      const workspace = await readBrowserState()
      for (const image of workspace.libraryImages) {
        if (!result.entries.some((entry) => nativeImageUrl(entry.uri) === image.filePath))
          result.entries.push({ uri: image.filePath, name: image.name, mime: 'image/*', size: 0 })
      }
      if (current !== sequence.current) return
      setEntries(
        result.entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      )
    } catch {
      if (current === sequence.current) setError(true)
    } finally {
      if (current === sequence.current) setBusy(false)
    }
  }, [])
  useEffect(() => {
    void refresh()
    const changed = (): void => {
      void refresh()
    }
    window.addEventListener('nais:folders-changed', changed)
    return () => {
      sequence.current++
      window.removeEventListener('nais:folders-changed', changed)
    }
  }, [refresh])
  const index = entries.findIndex((entry) => entry.uri === selected)
  const current = entries[index]
  return (
    <div className="space-y-3 p-3">
      <header className="flex items-center justify-between gap-3">
        <h1>{t('ui.library')}</h1>
        <button
          className="min-h-12 rounded-lg border border-line px-4"
          disabled={busy}
          onClick={() => void refresh()}
        >
          {t('mobile.refreshFolder')}
        </button>
      </header>
      {busy && <p role="status">{t('ui.loading')}</p>}
      {error && <p role="alert">{t('mobile.folderAccessFailed')}</p>}
      {current ? (
        <>
          <button className="min-h-12" onClick={() => setSelected(null)}>
            {t('mobile.imageList')}
          </button>
          <div className="mobile-image-stage">
            <ImageContextMenu filePath={nativeImageUrl(current.uri)} hideLibraryAdd>
              <img src={nativeImageUrl(current.uri)} alt={current.name} />
            </ImageContextMenu>
          </div>
          <div className="mobile-image-controls">
            <button
              aria-label={t('mobile.previousImage')}
              disabled={index === 0}
              onClick={() => setSelected(entries[index - 1].uri)}
            >
              ‹
            </button>
            <output>
              {index + 1} / {entries.length}
            </output>
            <button
              aria-label={t('mobile.nextImage')}
              disabled={index + 1 >= entries.length}
              onClick={() => setSelected(entries[index + 1].uri)}
            >
              ›
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {entries.slice(0, limit).map((entry) => (
              <ImageContextMenu key={entry.uri} filePath={nativeImageUrl(entry.uri)} hideLibraryAdd>
                <button onClick={() => setSelected(entry.uri)} aria-label={entry.name}>
                  <img
                    className="aspect-square w-full rounded-md object-cover"
                    src={nativeImageUrl(entry.uri)}
                    alt={entry.name}
                    loading="lazy"
                  />
                </button>
              </ImageContextMenu>
            ))}
          </div>
          {!busy && entries.length === 0 && <p>{t('mobile.noImages')}</p>}
          {entries.length > limit && (
            <button className="min-h-12 w-full" onClick={() => setLimit(limit + 60)}>
              {t('mobile.loadMore')}
            </button>
          )}
        </>
      )}
    </div>
  )
}
