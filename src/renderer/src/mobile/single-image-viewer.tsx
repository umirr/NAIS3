import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { useT } from '../lib/i18n'

export interface ViewerImage {
  id: number
  url: string
  label: string
}

/** Preserve the selected image by identity when new generations are prepended. */
export function SingleImageViewer({
  images,
  loading,
  total = images.length,
  loadMore,
  renderImage
}: {
  images: ViewerImage[]
  loading: boolean
  total?: number
  loadMore?: () => Promise<ViewerImage | null>
  renderImage?: (image: ViewerImage) => ReactNode
}): React.JSX.Element {
  const t = useT()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState(false)
  const pending = useRef(false)
  const [fetching, setFetching] = useState(false)
  const found = images.findIndex((image) => image.id === selectedId)
  const index = found < 0 ? 0 : found
  const current = images[index]
  if (selectedId === null && current) setSelectedId(current.id)
  const next = async (): Promise<void> => {
    if (pending.current) return
    setError(false)
    if (index + 1 < images.length) setSelectedId(images[index + 1].id)
    else if (loadMore && images.length < total) {
      pending.current = true
      setFetching(true)
      try {
        const image = await loadMore()
        if (image) setSelectedId(image.id)
      } catch {
        setError(true)
      } finally {
        pending.current = false
        setFetching(false)
      }
    }
  }
  return (
    <div className="mobile-image-viewer">
      <div className="mobile-image-stage">
        {current ? (
          renderImage ? (
            renderImage(current)
          ) : (
            <img src={current.url} alt={current.label} draggable={false} />
          )
        ) : (
          <p>{loading ? t('ui.loading') : t('mobile.noImages')}</p>
        )}
      </div>
      <div className="mobile-image-controls">
        <button
          type="button"
          aria-label={t('mobile.previousImage')}
          disabled={index === 0 || loading || fetching}
          onClick={() => setSelectedId(images[index - 1].id)}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <output aria-live="polite">
          {current ? index + 1 : 0} / {total}
        </output>
        <button
          type="button"
          aria-label={t('mobile.nextImage')}
          disabled={loading || fetching || !current || index + 1 >= total}
          onClick={() => void next()}
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
      {error && <p role="alert">{t('mobile.imageLoadFailed')}</p>}
    </div>
  )
}
