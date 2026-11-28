import { registerPlugin } from '@capacitor/core'
import { isBackupTableName } from '../../../main/backup/types'
import type { PortableBackup, PortableRow } from '@shared/portable-nais-backup'

export interface NativeBackupStage {
  cancelled: boolean
  stageId?: string
  mainParams?: string | null
  tables?: Record<string, Record<string, unknown>[]>
  locations?: Record<string, string>
}
export const nativeBackup = registerPlugin<{
  chooseArchive(): Promise<NativeBackupStage>
  discardStage(options: { stageId: string }): Promise<void>
}>('NaisBackup')

/** Convert only the native bridge's verified metadata; full image bytes stay on disk. */
export function decodeNativeBackupStage(stage: NativeBackupStage): {
  backup: PortableBackup
  locations: Map<string, string>
} {
  if (
    stage.cancelled ||
    !stage.stageId ||
    !/^[a-f0-9-]{36}$/.test(stage.stageId) ||
    !stage.tables ||
    !stage.locations ||
    (stage.mainParams !== null && typeof stage.mainParams !== 'string')
  ) {
    throw new Error('Invalid native backup stage')
  }
  const tables: PortableBackup['tables'] = {}
  for (const [table, rows] of Object.entries(stage.tables)) {
    if (!isBackupTableName(table) || !Array.isArray(rows))
      throw new Error('Invalid native backup table')
    const ids = new Set<number>()
    tables[table] = rows.map((row) => {
      if (
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        typeof row.id !== 'number' ||
        !Number.isSafeInteger(row.id) ||
        row.id < 1 ||
        ids.has(row.id)
      )
        throw new Error('Invalid native backup row')
      ids.add(row.id)
      const decoded: PortableRow = {}
      for (const [key, value] of Object.entries(row)) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) throw new Error('Invalid native backup column')
        if (
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.keys(value).length === 1 &&
          '__base64' in value &&
          typeof value.__base64 === 'string'
        ) {
          decoded[key] = Uint8Array.from(atob(value.__base64), (char) => char.charCodeAt(0))
        } else if (
          value === null ||
          typeof value === 'string' ||
          (typeof value === 'number' && Number.isFinite(value))
        ) {
          decoded[key] = value
        } else throw new Error('Invalid native backup value')
      }
      return decoded
    })
  }
  const locations = new Map(Object.entries(stage.locations))
  for (const [key, uri] of locations) {
    if (
      typeof uri !== 'string' ||
      !uri.startsWith('file:///') ||
      !uri.includes(`/backup-imports/${stage.stageId}/assets/`) ||
      uri.includes('/../')
    ) {
      throw new Error(`Invalid staged asset location: ${key}`)
    }
  }
  return { backup: { tables, mainParams: stage.mainParams, files: [] }, locations }
}
