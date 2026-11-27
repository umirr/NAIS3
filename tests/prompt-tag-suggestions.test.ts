// @vitest-environment happy-dom
import { act, createElement as h, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { PromptEditor } from '../src/renderer/src/components/prompt-editor'
import { togglePromptTag } from '../src/shared/prompt-tags'
vi.mock('../src/renderer/src/lib/i18n', () => ({ useT: () => (id: string) => id }))
const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, 'execCommand')
})
function input(ta: HTMLTextAreaElement, value: string, inputType = 'insertText'): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, value)
  ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }))
}
async function mount(
  value: string
): Promise<{ ta: HTMLTextAreaElement; search: ReturnType<typeof vi.fn> }> {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const search = vi.fn(async () => ({
    items: [{ tag: 'normal_input_suggestion', count: 20, type: 0 }]
  }))
  window.nais = { invoke: search, on: () => () => {} } as unknown as typeof window.nais
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  function Editor(): React.JSX.Element {
    const [text, setText] = useState(value)
    return h(PromptEditor, { value: text, onValueChange: setText, ariaLabel: 'Prompt' })
  }
  await act(async () => root.render(h(Editor)))
  const ta = container.querySelector('textarea')!
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: vi.fn((_command: string, _show: boolean, text: string) => {
      const next = ta.value.slice(0, ta.selectionStart) + text + ta.value.slice(ta.selectionEnd)
      input(ta, next)
      return true
    })
  })
  return { ta, search }
}
async function menu(ta: HTMLTextAreaElement): Promise<void> {
  document.querySelectorAll<HTMLElement>('[data-tag-start]').forEach((span) => {
    span.getClientRects = () =>
      [{ left: 10, right: 90, top: 10, bottom: 30 }] as unknown as DOMRectList
  })
  await act(async () => {
    ta.dispatchEvent(
      new MouseEvent('contextmenu', { clientX: 20, clientY: 20, bubbles: true, cancelable: true })
    )
  })
  await act(async () => document.querySelector<HTMLElement>('[role="menuitem"]')!.click())
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60))
  })
}
it('does not request or display suggestions when reactivating, but still suggests for normal input', async () => {
  const { ta, search } = await mount(togglePromptTag('blue eyes', 0, 9))
  await menu(ta)
  expect(ta.value).toBe('blue eyes')
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 130))
  })
  expect(search).not.toHaveBeenCalled()
  expect(document.querySelector('[data-prompt-suggestions]')).toBeNull()
  await act(async () => input(ta, 'ordinary typing'))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150))
  })
  expect(search).toHaveBeenCalledWith(
    'tags:search',
    expect.objectContaining({ query: 'ordinary typing' })
  )
  expect(document.querySelector('[data-prompt-suggestions]')).not.toBeNull()
})
it.each(['historyUndo', 'historyRedo'])('does not suggest after %s', async (inputType) => {
  const { ta, search } = await mount('before')
  await act(async () => input(ta, 'restored prompt', inputType))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 130))
  })
  expect(search).not.toHaveBeenCalled()
  expect(document.querySelector('[data-prompt-suggestions]')).toBeNull()
})

it('rejects an in-flight recommendation result after a tag toggle', async () => {
  const { ta, search } = await mount('initial')
  let finish!: (value: { items: { tag: string; count: number; type: number }[] }) => void
  search.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await act(async () => input(ta, 'pending recommendation'))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120))
  })
  expect(search).toHaveBeenCalledTimes(1)
  await menu(ta)
  await act(async () => finish({ items: [{ tag: 'stale_result', count: 1, type: 0 }] }))
  expect(document.querySelector('[data-prompt-suggestions]')).toBeNull()
})
