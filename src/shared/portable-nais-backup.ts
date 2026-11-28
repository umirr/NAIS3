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

function safePath(path: string): void {
  if (
    !path ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[a-zA-Z]:/.test(path) ||
    path.split('/').includes('..')
  )
    throw new Error('Unsafe archive path')
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Validates the entire portable workspace before returning anything to a restore caller.
 * Buffered codec for compatibility tests; the Android file bridge must stream large assets.
 */
export async function decodePortableNais(input: Uint8Array): Promise<PortableBackup> {
  const zip = await JSZip.loadAsync(input)
  const entries = Object.values(zip.files)
  if (entries.length > 100_000) throw new Error('Archive contains too many entries')
  for (const entry of entries) {
    safePath(entry.name)
    safePath(entry.unsafeOriginalName ?? entry.name)
  }
  async function raw(path: string): Promise<Uint8Array> {
    safePath(path)
    const entry = zip.file(path)
    if (!entry) throw new Error(`Archive entry is missing: ${path}`)
    const data = await entry.async('uint8array')
    if (data.byteLength > 256 * 1024 * 1024) throw new Error('Archive entry is too large')
    return data
  }
  const parse = (data: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(data))
  const manifest = parse(await raw('manifest.json'))
  if (
    !object(manifest) ||
    manifest.format !== 'NAIS' ||
    manifest.app !== 'NAIS3' ||
    manifest.formatVersion !== BACKUP_FORMAT_VERSION ||
    manifest.scope !== 'workspace'
  ) {
    throw new Error('Unsupported NAIS workspace archive')
  }
  if (
    !Array.isArray(manifest.tables) ||
    !manifest.tables.every(isBackupTableName) ||
    new Set(manifest.tables).size !== manifest.tables.length ||
    !object(manifest.tableCounts)
  ) {
    throw new Error('Invalid backup table list')
  }
  const checksums = parse(await raw('checksums.json'))
  if (!object(checksums)) throw new Error('Invalid archive checksums')
  const checksumEntries = checksums
  let total = 0
  async function checked(path: string): Promise<Uint8Array> {
    const expected = checksumEntries[path]
    if (
      !object(expected) ||
      typeof expected.sha256 !== 'string' ||
      typeof expected.bytes !== 'number' ||
      !Number.isSafeInteger(expected.bytes) ||
      expected.bytes < 0
    ) {
      throw new Error(`Invalid checksum metadata: ${path}`)
    }
    const data = await raw(path)
    total += data.byteLength
    if (total > 8 * 1024 * 1024 * 1024) throw new Error('Archive expands beyond allowed size')
    if (data.byteLength !== expected.bytes || (await digest(data)) !== expected.sha256) {
      throw new Error(`Archive checksum mismatch: ${path}`)
    }
    return data
  }
  const settings = parse(await checked('data/settings.json'))
  if (
    !object(settings) ||
    (settings.mainParams !== null && typeof settings.mainParams !== 'string')
  ) {
    throw new Error('Invalid backup generation settings')
  }
  const result: PortableBackup = { tables: {}, mainParams: settings.mainParams, files: [] }
  for (const table of manifest.tables) {
    const rows = parse(await checked(`data/tables/${table}.json`))
    if (!Array.isArray(rows) || manifest.tableCounts[table] !== rows.length)
      throw new Error('Invalid table row count')
    const ids = new Set<number>()
    result.tables[table] = []
    for (const row of rows) {
      if (
        !object(row) ||
        typeof row.id !== 'number' ||
        !Number.isSafeInteger(row.id) ||
        ids.has(row.id)
      ) {
        throw new Error('Invalid or duplicate backup row id')
      }
      ids.add(row.id)
      const decoded: PortableRow = {}
      for (const [column, value] of Object.entries(row)) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) throw new Error('Invalid backup column')
        if (object(value) && Object.keys(value).length === 1 && typeof value.__asset === 'string') {
          if (!value.__asset.startsWith('assets/')) throw new Error('Invalid asset reference')
          const data = await checked(value.__asset)
          if (column === 'file_path') {
            const extension =
              value.__asset.match(/\.[a-zA-Z0-9]{1,10}$/)?.[0].toLowerCase() ?? '.bin'
            result.files.push({ table, rowId: row.id, extension, data })
            decoded[column] = ''
          } else decoded[column] = data
        } else if (column === 'file_path') {
          throw new Error('Backup image must contain an asset, not a filesystem link')
        } else if (
          value === null ||
          typeof value === 'string' ||
          (typeof value === 'number' && Number.isFinite(value))
        )
          decoded[column] = value
        else throw new Error('Invalid backup value')
      }
      result.tables[table]!.push(decoded)
    }
  }
  return result
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
