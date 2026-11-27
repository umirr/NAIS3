import { Capacitor, registerPlugin } from '@capacitor/core'

export type FolderPurpose = 'main' | 'scene' | 'library' | 'export'
export interface NativeFolderEntry {
  uri: string
  name: string
  mime: string
  size: number
}
export interface NativeStorage {
  readSnapshot(): Promise<{ value: string | null }>
  writeSnapshot(options: { value: string }): Promise<void>
  chooseFolder(options: { key: FolderPurpose }): Promise<{ cancelled: boolean; uri?: string }>
  getFolders(): Promise<Record<Exclude<FolderPurpose, 'export'>, string | null>>
  listFolder(options: { uri: string }): Promise<{ entries: NativeFolderEntry[] }>
  writeImage(options: { uri: string; name: string; base64: string }): Promise<{ uri: string }>
}

export const nativeStorage = registerPlugin<NativeStorage>('NaisStorage')
export const isAndroid = (): boolean => Capacitor.getPlatform() === 'android'
export const nativeImageUrl = (uri: string): string => Capacitor.convertFileSrc(uri)
