import { useEffect, useState } from 'react'
import { useT } from '../lib/i18n'
import { nativeStorage, type FolderPurpose } from './native-storage'
import { MobileBackupSettings } from './backup-settings'

export function MobileFolderSettings(): React.JSX.Element {
  const t = useT()
  const [folders, setFolders] = useState<Record<string, string | null>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    void nativeStorage
      .getFolders()
      .then(setFolders)
      .catch(() => setError(true))
  }, [])
  async function choose(key: FolderPurpose): Promise<void> {
    setBusy(true)
    setError(false)
    try {
      const result = await nativeStorage.chooseFolder({ key })
      if (!result.cancelled) {
        setFolders(await nativeStorage.getFolders())
        window.dispatchEvent(new Event('nais:folders-changed'))
      }
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4">
      {(
        [
          ['main', 'ui.mainSaveFolder'],
          ['scene', 'ui.sceneSaveFolder'],
          ['library', 'ui.library']
        ] as const
      ).map(([key, label]) => (
        <div key={key}>
          <p className="font-medium">{t(label)}</p>
          <p className="break-all text-xs text-muted">{folders[key] ?? t('mobile.noFolder')}</p>
          <button
            className="my-2 min-h-12 rounded-lg border border-line px-4"
            disabled={busy}
            onClick={() => void choose(key)}
          >
            {t('ui.change')}
          </button>
        </div>
      ))}
      {error && <p role="alert">{t('mobile.folderAccessFailed')}</p>}
      <MobileBackupSettings />
    </div>
  )
}
