import { expect, it } from 'vitest'
import { emptyState } from '../src/renderer/src/browser/browser-db'
import { restoreMobileWorkspace } from '../src/renderer/src/mobile/restore-workspace'
import type { PortableBackup } from '../src/shared/portable-nais-backup'

const identityUrl = (uri: string): string => uri
function backup(): PortableBackup {
  return {
    mainParams: '{"prompt":"restored"}',
    files: [],
    tables: {
      prompt_presets: [
        {
          id: 10,
          name: '복구 프리셋',
          prompt: 'tag',
          negative_prompt: 'negative',
          params_json: '{"steps":28}',
          prompt_parts_json: null
        }
      ],
      gen_scenes: [{ id: 20, name: '씬', created_at: '2026-11-28', preset_id: 1 }]
    }
  }
}

it('replaces portable configuration while retaining accounts, preferences and matching image links', () => {
  const initial = restoreMobileWorkspace(emptyState(), backup(), new Map(), identityUrl)
  initial.settings.theme = 'dark'
  initial.activeAccountId = 'account'
  initial.accounts = [
    { id: 'account', label: 'private', token: 'private-token' }
  ] as typeof initial.accounts
  initial.images = [
    {
      id: 30,
      filePath: 'content://existing',
      thumbnail: '',
      base64: '',
      kind: 'scene',
      seed: 42,
      createdAt: '2026-11-28',
      payloadJson: '{}',
      sceneId: 20,
      favorite: true
    }
  ]
  const original = structuredClone(initial)
  const restored = restoreMobileWorkspace(initial, backup(), new Map(), identityUrl)
  expect(initial).toEqual(original)
  expect(restored.accounts).toEqual(original.accounts)
  expect(restored.settings.theme).toBe('dark')
  expect(restored.settings.main_params).toBe(backup().mainParams)
  expect(restored.promptPresets).toHaveLength(1)
  expect(restored.promptPresets[0].params).toEqual({ steps: 28 })
  expect(restored.images).toEqual(original.images)
  expect(restored.scenes[0]).toMatchObject({
    imageCount: 1,
    hasFavorite: true,
    thumbnailPath: 'content://existing'
  })
})

it('keeps generated files but unlinks a scene with a reused id and different creation time', () => {
  const initial = restoreMobileWorkspace(emptyState(), backup(), new Map(), identityUrl)
  initial.images = [
    {
      id: 30,
      filePath: 'content://existing',
      thumbnail: '',
      base64: '',
      kind: 'scene',
      seed: 42,
      createdAt: '2026-11-28',
      payloadJson: '{}',
      sceneId: 20,
      favorite: false
    }
  ]
  const changed = backup()
  changed.tables.gen_scenes![0].created_at = 'different-scene'
  const restored = restoreMobileWorkspace(initial, changed, new Map(), identityUrl)
  expect(restored.images[0].filePath).toBe('content://existing')
  expect(restored.images[0].sceneId).toBeNull()
  expect(initial.images[0].sceneId).toBe(20)
})

it('requires staged assets and keeps original binary columns in JSON-safe form', () => {
  const input = backup()
  input.tables.library_images = [
    {
      id: 50,
      name: 'library',
      file_path: '',
      thumbnail: new Uint8Array([1, 2, 3]),
      created_at: 'original-time',
      stack_id: null
    }
  ]
  const current = emptyState()
  expect(() => restoreMobileWorkspace(current, input, new Map(), identityUrl)).toThrow(
    'has not been saved'
  )
  expect(current).toEqual(emptyState())
  const restored = restoreMobileWorkspace(
    current,
    input,
    new Map([['library_images:50', 'content://restored']]),
    identityUrl
  )
  expect(restored.libraryImages[0].filePath).toBe('content://restored')
  expect(JSON.parse(restored.mobileBackupRows!).library_images[0]).toMatchObject({
    thumbnail: { __base64: 'AQID' },
    created_at: 'original-time',
    file_path: 'content://restored'
  })
  expect(restored.nextId).toBeGreaterThan(50)
})

it('does not mutate existing state when later preset JSON fails validation', () => {
  const input = backup()
  input.tables.prompt_presets![0].params_json = '{broken'
  const current = emptyState()
  expect(() => restoreMobileWorkspace(current, input, new Map(), identityUrl)).toThrow()
  expect(current).toEqual(emptyState())
})
