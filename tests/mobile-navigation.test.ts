// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MobileShell } from '../src/renderer/src/mobile/mobile-shell'
import { SingleImageViewer } from '../src/renderer/src/mobile/single-image-viewer'

vi.mock('../src/renderer/src/lib/i18n', () => ({ useT: () => (id: string) => id }))
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

it('keeps an edited draft when switching bottom navigation pages', async () => {
  await act(async () =>
    root.render(
      h(MobileShell, {
        views: {
          main: h('textarea', { defaultValue: 'draft' }),
          scene: 'scene',
          library: 'library',
          settings: 'settings'
        }
      })
    )
  )
  const input = container.querySelector('textarea')!
  input.value = 'unsaved edit'
  const buttons = container.querySelectorAll<HTMLButtonElement>('nav button')
  await act(async () => buttons[1].click())
  expect(input.closest('section')!.hidden).toBe(true)
  await act(async () => buttons[0].click())
  expect(container.querySelector('textarea')).toBe(input)
  expect(input.value).toBe('unsaved edit')
  expect(buttons).toHaveLength(4)
})

it('shows one image and preserves its identity when another image is prepended', async () => {
  const images = [
    { id: 1, url: '/one.png', label: 'one' },
    { id: 2, url: '/two.png', label: 'two' }
  ]
  await act(async () => root.render(h(SingleImageViewer, { images, loading: false })))
  expect(container.querySelectorAll('img')).toHaveLength(1)
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="mobile.nextImage"]')!.click()
  )
  expect(container.querySelector('img')!.alt).toBe('two')
  await act(async () =>
    root.render(
      h(SingleImageViewer, {
        images: [{ id: 3, url: '/three.png', label: 'three' }, ...images],
        loading: false
      })
    )
  )
  expect(container.querySelector('img')!.alt).toBe('two')
  expect(container.querySelector('output')!.textContent).toBe('3 / 3')
})
