import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { promptTags, togglePromptTag } from '@shared/prompt-tags'
import { useT } from '../lib/i18n'

export function PromptTagHover({
  value,
  onValueChange,
  textarea,
  typography
}: {
  value: string
  onValueChange: (value: string) => void
  textarea: RefObject<HTMLTextAreaElement | null>
  typography: string
}): React.JSX.Element {
  const t = useT()
  const mirror = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{
    start: number
    end: number
    disabled: boolean
    x: number
    y: number
  } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const popupHovered = useRef(false)
  const display = (text: string): string => text.replaceAll('\u0336', '\u200b')
  const tags = promptTags(value)
  useEffect(() => {
    const ta = textarea.current
    if (!ta) return
    const sync = (): void => {
      popupHovered.current = false
      if (mirror.current) {
        mirror.current.scrollTop = ta.scrollTop
        mirror.current.scrollLeft = ta.scrollLeft
      }
      setHover(null)
    }
    const leave = (): void => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        if (!popupHovered.current) setHover(null)
      }, 250)
    }
    const move = (event: MouseEvent): void => {
      clearTimeout(timer.current)
      const spans = mirror.current?.querySelectorAll<HTMLElement>('[data-tag-start]') ?? []
      for (const span of spans) {
        const rect = Array.from(span.getClientRects()).find(
          (r) =>
            event.clientX >= r.left &&
            event.clientX <= r.right &&
            event.clientY >= r.top &&
            event.clientY <= r.bottom
        )
        if (rect) {
          const start = Number(span.dataset.tagStart),
            end = Number(span.dataset.tagEnd)
          setHover((current) =>
            current?.start === start && current.end === end
              ? current
              : {
                  start,
                  end,
                  disabled: value.slice(start, end).includes('\u0336'),
                  x: Math.max(8, Math.min(rect.left, window.innerWidth - 160)),
                  y: Math.max(8, rect.top - 36)
                }
          )
          return
        }
      }
      leave()
    }
    ta.addEventListener('mousemove', move)
    ta.addEventListener('mouseleave', leave)
    ta.addEventListener('scroll', sync)
    ta.addEventListener('keydown', sync)
    sync()
    return () => {
      clearTimeout(timer.current)
      ta.removeEventListener('mousemove', move)
      ta.removeEventListener('mouseleave', leave)
      ta.removeEventListener('scroll', sync)
      ta.removeEventListener('keydown', sync)
    }
  }, [value, textarea])
  return (
    <>
      <div
        ref={mirror}
        aria-hidden
        className={`${typography} pointer-events-none absolute inset-0 overflow-hidden text-ink`}
      >
        {tags.map((tag, i) => (
          <span key={tag.start}>
            {display(value.slice(i ? tags[i - 1].end : 0, tag.start))}
            <span
              data-tag-start={tag.start}
              data-tag-end={tag.end}
              style={{
                background: tag.disabled
                  ? 'var(--prompt-tag-disabled-bg)'
                  : hover?.start === tag.start
                    ? 'var(--prompt-tag-hover-bg)'
                    : undefined,
                color: tag.disabled ? 'var(--prompt-tag-disabled-ink)' : undefined,
                boxDecorationBreak: 'clone'
              }}
            >
              {display(value.slice(tag.start, tag.end))}
            </span>
          </span>
        ))}
        {display(value.slice(tags.length ? tags[tags.length - 1].end : 0))}
      </div>
      {hover &&
        createPortal(
          <button
            className="fixed z-50 rounded border border-line bg-surface px-3 py-1.5 text-[12px] text-ink shadow-lg"
            style={{ left: hover.x, top: hover.y }}
            onMouseEnter={() => {
              popupHovered.current = true
              clearTimeout(timer.current)
            }}
            onMouseLeave={() => {
              popupHovered.current = false
              setHover(null)
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onValueChange(togglePromptTag(value, hover.start, hover.end))
              popupHovered.current = false
              setHover(null)
              textarea.current?.focus()
            }}
          >
            {t(hover.disabled ? 'ui.enablePromptTag' : 'ui.disablePromptTag')}
          </button>,
          document.body
        )}
    </>
  )
}
