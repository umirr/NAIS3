import { configureWorkspaceStorage, type BrowserState } from '../browser/browser-db'
import { isAndroid, nativeStorage } from './native-storage'

export async function installMobileStorage(): Promise<void> {
  if (!isAndroid()) return
  // Fail before mounting editors if the encrypted workspace is unreadable.
  const initial = await nativeStorage.readSnapshot()
  if (initial.value !== null) {
    const parsed = JSON.parse(initial.value) as BrowserState
    if (!Number.isSafeInteger(parsed.nextId) || !parsed.settings || !Array.isArray(parsed.images)) {
      throw new Error('Invalid saved mobile workspace')
    }
  }
  configureWorkspaceStorage({
    async read() {
      const { value } = await nativeStorage.readSnapshot()
      if (value === null) return null
      const parsed = JSON.parse(value) as BrowserState
      if (
        !Number.isSafeInteger(parsed.nextId) ||
        !parsed.settings ||
        !Array.isArray(parsed.images)
      ) {
        throw new Error('Invalid saved mobile workspace')
      }
      return parsed
    },
    async write(state) {
      await nativeStorage.writeSnapshot({ value: JSON.stringify(state) })
    }
  })
}
