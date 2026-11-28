// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({
  chooseArchive: vi.fn(async () => ({
    cancelled: false,
    stageId: '12345678-1234-1234-1234-123456789abc',
    mainParams: null,
    tables: {},
    locations: {}
  })),
  discardStage: vi.fn(async () => undefined),
  stageLibraryImages: vi.fn()
}))
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => api,
  Capacitor: { getPlatform: () => 'android', convertFileSrc: (uri: string) => uri }
}))
vi.mock('../src/renderer/src/lib/i18n', () => ({ useT: () => (key: string) => key }))
import { MobileBackupSettings } from '../src/renderer/src/mobile/backup-settings'
import { configureWorkspaceStorage, emptyState } from '../src/renderer/src/browser/browser-db'

it('validates before confirmation, cancels staged files, and blocks restore while generation is pending', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const write = vi.fn()
  configureWorkspaceStorage({ read: async () => emptyState(), write })
  const invoke = vi.fn(async () => ({ running: false, items: [] as { state: string }[] }))
  window.nais = { invoke } as unknown as typeof window.nais
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  try {
    await act(async () => root.render(h(MobileBackupSettings)))
    await act(async () => element.querySelector('button')!.click())
    expect(element.textContent).toContain('mobile.restoreDescription')
    expect(write).not.toHaveBeenCalled()
    expect(api.stageLibraryImages).not.toHaveBeenCalled()
    await act(async () => element.querySelectorAll('button')[1].click())
    expect(api.discardStage).toHaveBeenCalledWith({
      stageId: '12345678-1234-1234-1234-123456789abc'
    })
    invoke.mockResolvedValue({ running: false, items: [{ state: 'pending' }] })
    await act(async () => element.querySelector('button')!.click())
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('ui.importErrorValue')
    expect(api.chooseArchive).toHaveBeenCalledTimes(1)
    expect(write).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    element.remove()
  }
})
