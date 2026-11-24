// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CharRefItem } from '../src/shared/types'
import { CharRefParams } from '../src/renderer/src/components/ref-overlay'

vi.mock('../src/renderer/src/lib/i18n', () => ({ useT: () => (id: string) => id }))
const item: CharRefItem = {
  id: 1,
  name: 'Example',
  thumbnail: '',
  enabled: true,
  refType: 'character',
  strength: 3,
  fidelity: 0.6,
  folderId: null
}
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
it('V5 exposes strength to 5 and outfit preference, without fidelity', async () => {
  const update = vi.fn()
  await act(async () =>
    root.render(h(CharRefParams, { item, model: 'nai-diffusion-5-full', update }))
  )
  const sliders = container.querySelectorAll('[role="slider"]')
  expect(sliders.length).toBe(1)
  expect(sliders[0].getAttribute('aria-valuemax')).toBe('5')
  expect(sliders[0].getAttribute('aria-valuenow')).toBe('3')
  expect(container.textContent).not.toContain('ui.fidelityValue')
  await act(async () => (container.querySelector('[role="switch"]') as HTMLElement).click())
  expect(update).toHaveBeenCalledWith(1, { refType: 'character_mainoutfit' })
})
it('V4.5 keeps fidelity and caps the displayed strength without overwriting saved V5 values', async () => {
  const update = vi.fn()
  await act(async () =>
    root.render(h(CharRefParams, { item, model: 'nai-diffusion-4-5-full', update }))
  )
  const sliders = container.querySelectorAll('[role="slider"]')
  expect(sliders.length).toBe(2)
  expect(sliders[0].getAttribute('aria-valuemax')).toBe('1')
  expect(sliders[0].getAttribute('aria-valuenow')).toBe('1')
  expect(container.querySelector('[role="switch"]')).toBeNull()
  expect(update).not.toHaveBeenCalled()
})
