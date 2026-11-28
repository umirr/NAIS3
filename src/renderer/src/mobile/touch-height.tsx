import { useRef } from 'react'
import { useT } from '../lib/i18n'

/** A touch handle controls its containing panel, independently of textarea selection. */
export function TouchHeight(): React.JSX.Element {
  const t = useT()
  const active = useRef<{ id: number; y: number; height: number } | null>(null)
  const resize = (element: HTMLElement, height: number): void => {
    const panel = element.parentElement
    if (panel) panel.style.height = `${Math.max(96, Math.min(1200, height))}px`
  }
  return (
    <div className="mobile-height-controls">
      <button
        type="button"
        aria-label={t('mobile.shrinkPrompt')}
        onClick={(e) =>
          resize(
            e.currentTarget.parentElement!,
            e.currentTarget.parentElement!.parentElement!.getBoundingClientRect().height - 64
          )
        }
      >
        −
      </button>
      <div
        role="separator"
        aria-label={t('mobile.resizePrompt')}
        aria-orientation="horizontal"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
          e.preventDefault()
          resize(
            e.currentTarget.parentElement!,
            e.currentTarget.parentElement!.parentElement!.getBoundingClientRect().height +
              (e.key === 'ArrowDown' ? 32 : -32)
          )
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          active.current = {
            id: e.pointerId,
            y: e.clientY,
            height: e.currentTarget.parentElement!.parentElement!.getBoundingClientRect().height
          }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const drag = active.current
          if (drag?.id === e.pointerId)
            resize(e.currentTarget.parentElement!, drag.height + e.clientY - drag.y)
        }}
        onPointerUp={() => {
          active.current = null
        }}
        onPointerCancel={() => {
          active.current = null
        }}
        onLostPointerCapture={() => {
          active.current = null
        }}
      >
        <span />
      </div>
      <button
        type="button"
        aria-label={t('mobile.expandPrompt')}
        onClick={(e) =>
          resize(
            e.currentTarget.parentElement!,
            e.currentTarget.parentElement!.parentElement!.getBoundingClientRect().height + 64
          )
        }
      >
        ＋
      </button>
    </div>
  )
}
