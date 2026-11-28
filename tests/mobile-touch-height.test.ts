// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { TouchHeight } from '../src/renderer/src/mobile/touch-height'
vi.mock('../src/renderer/src/lib/i18n', () => ({ useT: () => (key: string) => key }))

it('resizes only its panel with buttons and keyboard, with bounded height', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const panel = document.createElement('div')
  document.body.append(panel)
  vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(
    () => ({ height: Number.parseFloat(panel.style.height) || 400 }) as DOMRect
  )
  const root = createRoot(panel)
  try {
    await act(async () => root.render(h(TouchHeight)))
    await act(async () => panel.querySelectorAll('button')[1].click())
    expect(panel.style.height).toBe('464px')
    await act(async () => panel.querySelectorAll('button')[0].click())
    expect(panel.style.height).toBe('400px')
    await act(async () =>
      panel
        .querySelector('[role="separator"]')!
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
        )
    )
    expect(panel.style.height).toBe('432px')
    panel.style.height = '1200px'
    await act(async () => panel.querySelectorAll('button')[1].click())
    expect(panel.style.height).toBe('1200px')
    panel.style.height = '96px'
    await act(async () => panel.querySelectorAll('button')[0].click())
    expect(panel.style.height).toBe('96px')
  } finally {
    await act(async () => root.unmount())
    panel.remove()
  }
})
