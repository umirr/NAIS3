import JSZip from 'jszip'
import {
  BACKUP_FORMAT_VERSION,
  isBackupTableName,
  type BackupTableName
} from '../main/backup/types'

export type PortableRow = Record<string, string | number | null | Uint8Array>
export interface PortableBackup {
  tables: Partial<Record<BackupTableName, PortableRow[]>>
  mainParams: string | null
  files: { table: BackupTableName; rowId: number; extension: string; data: Uint8Array }[]
}

const encoder = new TextEncoder()
function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`)
}

async function digest(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(data).buffer)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** PC .nais v1 encoding, without Node Buffer or filesystem dependencies.
 * Native storage supplies asset bytes. Large archives still need a streaming native writer.
 */
export async function encodePortableNais(
  source: PortableBackup,
  appVersion: string,
  createdAt = new Date().toISOString()
): Promise<Uint8Array> {
  const zip = new JSZip()
  const tables = Object.keys(source.tables)
  if (!tables.every(isBackupTableName)) throw new Error('Unknown backup table')
  const checksums: Record<string, { sha256: string; bytes: number }> = {}
  const counts: Partial<Record<BackupTableName, number>> = {}
  const add = async (path: string, data: Uint8Array, compress: boolean): Promise<void> => {
    zip.file(path, data, { compression: compress ? 'DEFLATE' : 'STORE' })
    checksums[path] = { sha256: await digest(data), bytes: data.byteLength }
  }
  const assets = new Map<string, PortableBackup['files'][number]>()
  for (const file of source.files) {
    const key = `${file.table}:${file.rowId}`
    if (assets.has(key)) throw new Error('Duplicate backup asset')
    assets.set(key, file)
  }
  for (const table of tables) {
    const rows = source.tables[table]!
    const ids = new Set<number>()
    const encoded: Record<string, unknown>[] = []
    for (const row of rows) {
      if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || ids.has(row.id)) {
        throw new Error('Invalid or duplicate backup row id')
      }
      ids.add(row.id)
      const result: Record<string, unknown> = {}
      for (const [column, value] of Object.entries(row)) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) throw new Error('Invalid backup column')
        if (column === 'file_path') {
          const file = assets.get(`${table}:${row.id}`)
          if (!file) throw new Error(`Missing image asset: ${table}:${row.id}`)
          const extension = /^\.[a-zA-Z0-9]{1,10}$/.test(file.extension)
            ? file.extension.toLowerCase()
            : '.bin'
          const path = `assets/files/${table}/${row.id}${extension}`
          await add(path, file.data, false)
          result[column] = { __asset: path }
        } else if (value instanceof Uint8Array) {
          const path = `assets/blobs/${table}/${row.id}-${column}.bin`
          await add(path, value, false)
          result[column] = { __asset: path }
        } else if (
          value === null ||
          typeof value === 'string' ||
          (typeof value === 'number' && Number.isFinite(value))
        ) {
          result[column] = value
        } else throw new Error('Invalid backup value')
      }
      encoded.push(result)
    }
    counts[table] = encoded.length
    await add(`data/tables/${table}.json`, jsonBytes(encoded), true)
  }
  await add('data/settings.json', jsonBytes({ mainParams: source.mainParams }), true)
  zip.file(
    'manifest.json',
    jsonBytes({
      format: 'NAIS',
      formatVersion: BACKUP_FORMAT_VERSION,
      app: 'NAIS3',
      appVersion,
      createdAt,
      scope: 'workspace',
      tables,
      tableCounts: counts
    })
  )
  zip.file('checksums.json', jsonBytes(checksums))
  return zip.generateAsync({ type: 'uint8array' })
}
