import { expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { encodePortableNais, type PortableBackup } from '../src/shared/portable-nais-backup'
import { readNaisArchive } from '../src/main/backup/archive'

// Only the unmodified PC reader is exercised; its filesystem writer is not used.
vi.mock('../src/main/zip-writer', () => ({
  writeZipFile: () => {
    throw new Error('Unexpected filesystem write')
  }
}))

function source(): PortableBackup {
  return {
    mainParams: '{"prompt":"한글 프롬프트"}',
    tables: {
      scene_presets: [{ id: 1, name: '씬 프리셋' }],
      gen_scenes: [{ id: 2, preset_id: 1, name: 'Scene', created_at: '2026-11-28' }],
      vibe_images: [{ id: 3, file_path: 'content://vibe', thumbnail: new Uint8Array([1, 2, 3]) }],
      charref_images: [{ id: 4, file_path: 'content://reference' }],
      library_images: [{ id: 5, file_path: 'content://library' }]
    },
    files: [
      { table: 'vibe_images', rowId: 3, extension: '.png', data: new Uint8Array([4, 5]) },
      { table: 'charref_images', rowId: 4, extension: '.jpg', data: new Uint8Array([6, 7]) },
      { table: 'library_images', rowId: 5, extension: '.webp', data: new Uint8Array([8, 9]) }
    ]
  }
}

it('produces an archive readable by the unmodified PC reader with image bytes intact', async () => {
  const input = source()
  const archive = await encodePortableNais(input, '1.0.33')
  const decoded = await readNaisArchive(Buffer.from(archive))
  expect(decoded.mainParams).toBe(input.mainParams)
  expect(decoded.tables.gen_scenes).toEqual(input.tables.gen_scenes)
  expect(decoded.tables.vibe_images![0].thumbnail).toEqual(Buffer.from([1, 2, 3]))
  expect(decoded.files.map((file) => Array.from(file.data))).toEqual([
    [4, 5],
    [6, 7],
    [8, 9]
  ])
  expect(decoded.includedTables).not.toContain('images')
})

it('fails rather than silently exporting a link without its required image asset', async () => {
  const input = source()
  input.files = []
  await expect(encodePortableNais(input, 'test')).rejects.toThrow('Missing image asset')
})

it('retains PC checksum validation against changed image bytes', async () => {
  const zip = await JSZip.loadAsync(await encodePortableNais(source(), 'test'))
  zip.file('assets/files/vibe_images/3.png', new Uint8Array([99]))
  await expect(readNaisArchive(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(
    'checksum mismatch'
  )
})
