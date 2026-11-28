import type { PortableBackup, PortableRow } from '@shared/portable-nais-backup'
import type { BackupTableName } from '../../../main/backup/types'
import type { CharRefType, ListFolder, PromptParts, PresetParams } from '@shared/types'
import { restoreImageSceneLinks } from '@shared/scene-restore-links'
import { vibeEncodingEntries, vibeEncodingModels } from '../../../main/refs/vibe-encoding-cache'
import type { BrowserState } from '../browser/browser-db'

function text(row: PortableRow, key: string, fallback = ''): string {
  const value = row[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') throw new Error(`Invalid backup text: ${key}`)
  return value
}
function number(row: PortableRow, key: string, fallback = 0): number {
  const value = row[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`Invalid backup number: ${key}`)
  return value
}
function nullableNumber(row: PortableRow, key: string): number | null {
  return row[key] == null ? null : number(row, key)
}
function binary(value: PortableRow[string] | undefined): string {
  if (value == null) return ''
  if (!(value instanceof Uint8Array)) throw new Error('Invalid backup image bytes')
  let result = ''
  for (let i = 0; i < value.length; i += 8192)
    result += String.fromCharCode(...value.subarray(i, i + 8192))
  return btoa(result)
}
function json<T>(row: PortableRow, key: string, fallback: T): T {
  const value = text(row, key)
  return value ? (JSON.parse(value) as T) : fallback
}
function folder(row: PortableRow): ListFolder {
  return {
    id: number(row, 'id'),
    name: text(row, 'name'),
    collapsed: number(row, 'collapsed') !== 0,
    color: row.color == null ? null : text(row, 'color')
  }
}

/** Build a replacement snapshot without mutating current state or touching files.
 * Asset locations must refer to successfully staged files before this is committed.
 */
export function restoreMobileWorkspace(
  current: BrowserState,
  backup: PortableBackup,
  assetLocations: ReadonlyMap<string, string>,
  imageUrl: (uri: string) => string
): BrowserState {
  const next = structuredClone(current)
  const oldRows = JSON.parse(current.mobileBackupRows ?? '{}') as Record<string, unknown>
  const retainedRows = { ...oldRows }
  const rows = (table: BackupTableName): PortableRow[] =>
    [...(backup.tables[table] ?? [])].sort(
      (a, b) =>
        number(a, 'sort_order') - number(b, 'sort_order') || number(a, 'id') - number(b, 'id')
    )
  const asset = (table: BackupTableName, row: PortableRow): string => {
    const uri = assetLocations.get(`${table}:${number(row, 'id')}`)
    if (!uri) throw new Error(`Backup image has not been saved: ${table}:${row.id}`)
    return uri
  }
  for (const table of ['vibe_images', 'charref_images', 'library_images'] as const) {
    for (const row of rows(table)) {
      if (!Object.hasOwn(row, 'file_path')) throw new Error(`Backup is missing ${table}.file_path`)
      asset(table, row)
    }
  }
  // Preserve all original columns for subsequent PC-compatible export, rather than
  // dropping timestamps, encoding caches or fields not represented by mobile controls.
  for (const [table, tableRows] of Object.entries(backup.tables)) {
    retainedRows[table] = tableRows!.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          value instanceof Uint8Array
            ? { __base64: binary(value) }
            : key === 'file_path'
              ? asset(table as BackupTableName, row)
              : value
        ])
      )
    )
  }
  next.mobileBackupRows = JSON.stringify(retainedRows)
  for (const [table, field] of [
    ['character_folders', 'characterFolders'],
    ['fragment_folders', 'fragmentFolders'],
    ['vibe_folders', 'vibeFolders'],
    ['charref_folders', 'charRefFolders']
  ] as const)
    if (backup.tables[table]) next[field] = rows(table).map(folder)
  if (backup.tables.character_prompts)
    next.characters = rows('character_prompts').map((row) => ({
      id: number(row, 'id'),
      name: text(row, 'name'),
      prompt: text(row, 'prompt'),
      negativePrompt: text(row, 'negative_prompt'),
      thumbnail: binary(row.thumbnail),
      enabled: number(row, 'enabled') !== 0,
      folderId: nullableNumber(row, 'folder_id'),
      center: { x: number(row, 'center_x', 0.5), y: number(row, 'center_y', 0.5) }
    }))
  if (backup.tables.fragments)
    next.fragments = rows('fragments').map((row) => ({
      id: number(row, 'id'),
      name: text(row, 'name'),
      content: text(row, 'content'),
      folderId: nullableNumber(row, 'folder_id')
    }))
  if (backup.tables.prompt_presets)
    next.promptPresets = rows('prompt_presets').map((row) => ({
      id: number(row, 'id'),
      name: text(row, 'name'),
      prompt: text(row, 'prompt'),
      negativePrompt: text(row, 'negative_prompt'),
      params: json<PresetParams | null>(row, 'params_json', null),
      promptParts: json<PromptParts | null>(row, 'prompt_parts_json', null)
    }))
  if (backup.tables.scene_presets)
    next.scenePresets = rows('scene_presets').map((row) => ({
      id: number(row, 'id'),
      name: text(row, 'name'),
      defaultWidth: nullableNumber(row, 'default_width'),
      defaultHeight: nullableNumber(row, 'default_height'),
      characterIds: json<number[] | null>(row, 'character_ids', null)
    }))
  if (backup.tables.gen_scenes) {
    next.scenes = rows('gen_scenes').map((row) => ({
      id: number(row, 'id'),
      presetId: number(row, 'preset_id', 1),
      name: text(row, 'name'),
      prompt: text(row, 'prompt'),
      negativePrompt: text(row, 'negative_prompt'),
      width: number(row, 'width', 832),
      height: number(row, 'height', 1216),
      reserveCount: number(row, 'reserve_count'),
      reserves: json<Record<string, number>>(
        row,
        'reserve_json',
        number(row, 'reserve_count') ? { '': number(row, 'reserve_count') } : {}
      ),
      createdAt: text(row, 'created_at'),
      thumbnail: '',
      thumbnailPath: '',
      imageCount: 0,
      hasFavorite: false
    }))
    next.images = restoreImageSceneLinks(
      current.images,
      current.scenes
        .filter((scene) => !!scene.createdAt)
        .map((scene) => ({ id: scene.id, createdAt: scene.createdAt! })),
      next.scenes.map((scene) => ({ id: scene.id, createdAt: scene.createdAt! }))
    )
    for (const scene of next.scenes) {
      const images = next.images.filter((image) => image.sceneId === scene.id)
      const cover = images.find((image) => image.favorite) ?? images[0]
      scene.imageCount = images.length
      scene.hasFavorite = images.some((image) => image.favorite)
      scene.thumbnail = cover?.thumbnail ?? ''
      scene.thumbnailPath = cover?.filePath ?? ''
    }
  }
  if (backup.tables.vibe_images) {
    next.vibeEncodings = {}
    next.vibes = rows('vibe_images').map((row) => {
      const id = number(row, 'id'),
        ie = number(row, 'info_extracted', 0.7)
      const encoded = text(row, 'encoded'),
        encodedIe = nullableNumber(row, 'encoded_ie')
      for (const item of vibeEncodingEntries(encoded, encodedIe))
        next.vibeEncodings[`${id}:${item.model}:${item.ie}`] = item.data
      const models = vibeEncodingModels(encoded, encodedIe, ie)
      return {
        id,
        name: text(row, 'name'),
        thumbnail: binary(row.thumbnail),
        enabled: number(row, 'enabled') !== 0,
        strength: number(row, 'strength', 0.6),
        infoExtracted: ie,
        folderId: nullableNumber(row, 'folder_id'),
        encodedReady: models.length > 0,
        encodedModels: models
      }
    })
  }
  if (backup.tables.charref_images)
    next.charRefs = rows('charref_images').map((row) => ({
      id: number(row, 'id'),
      name: text(row, 'name'),
      thumbnail: binary(row.thumbnail),
      enabled: number(row, 'enabled') !== 0,
      strength: number(row, 'strength', 0.6),
      fidelity: number(row, 'fidelity', 0.6),
      refType: text(row, 'ref_type', 'character&style') as CharRefType,
      folderId: nullableNumber(row, 'folder_id')
    }))
  if (backup.tables.library_images)
    next.libraryImages = rows('library_images')
      .reverse()
      .map((row) => ({
        id: number(row, 'id'),
        name: text(row, 'name'),
        filePath: imageUrl(asset('library_images', row)),
        thumbnail: binary(row.thumbnail),
        base64: '',
        width: nullableNumber(row, 'width'),
        height: nullableNumber(row, 'height'),
        stackId: nullableNumber(row, 'stack_id')
      }))
  if (backup.tables.library_stacks)
    next.libraryStacks = rows('library_stacks').map((row) => {
      const images = next.libraryImages.filter((image) => image.stackId === row.id)
      return {
        id: number(row, 'id'),
        name: text(row, 'name'),
        count: images.length,
        coverThumbnail: images[0]?.thumbnail ?? ''
      }
    })
  if (backup.mainParams !== null) next.settings.main_params = backup.mainParams
  for (const tableRows of Object.values(backup.tables))
    for (const row of tableRows!) {
      const id = number(row, 'id')
      if (!Number.isSafeInteger(id) || id < 1 || id === Number.MAX_SAFE_INTEGER)
        throw new Error('Invalid backup id')
      next.nextId = Math.max(next.nextId, id + 1)
    }
  return next
}
