import { expect, it, vi } from 'vitest'
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }))
import {
  decodeNativeBackupStage,
  type NativeBackupStage
} from '../src/renderer/src/mobile/native-backup'

function stage(): NativeBackupStage {
  return {
    cancelled: false,
    stageId: '12345678-1234-1234-1234-123456789abc',
    mainParams: null,
    tables: { library_images: [{ id: 1, file_path: '', thumbnail: { __base64: 'AQID' } }] },
    locations: {
      'library_images:1':
        'file:///data/app/backup-imports/12345678-1234-1234-1234-123456789abc/assets/files/library_images/1.png'
    }
  }
}
it('decodes thumbnails while retaining disk locations without loading full images', () => {
  const result = decodeNativeBackupStage(stage())
  expect(result.backup.tables.library_images![0].thumbnail).toEqual(new Uint8Array([1, 2, 3]))
  expect(result.backup.files).toEqual([])
  expect(result.locations.get('library_images:1')).toContain('/assets/files/')
})
it('rejects cancelled, duplicate and malformed rows before restoration', () => {
  expect(() => decodeNativeBackupStage({ cancelled: true })).toThrow()
  const input = stage()
  input.tables!.library_images.push(input.tables!.library_images[0])
  expect(() => decodeNativeBackupStage(input)).toThrow('Invalid native backup row')
})
it('rejects files outside the stage and unsupported table names', () => {
  const input = stage()
  input.locations!['library_images:1'] = 'file:///data/private/workspace.enc'
  expect(() => decodeNativeBackupStage(input)).toThrow('Invalid staged asset')
  const another = stage()
  another.tables!.accounts = []
  expect(() => decodeNativeBackupStage(another)).toThrow('Invalid native backup table')
})
