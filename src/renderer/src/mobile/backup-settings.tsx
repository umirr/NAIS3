import { useState } from 'react'
import { useT } from '../lib/i18n'
import { mutateBrowserState, readBrowserState } from '../browser/browser-db'
import { nativeBackup, decodeNativeBackupStage, type NativeBackupStage } from './native-backup'
import { nativeImageUrl, nativeStorage } from './native-storage'
import { restoreMobileWorkspace } from './restore-workspace'

export function MobileBackupSettings(): React.JSX.Element {
  const t = useT()
  const [stage, setStage] = useState<NativeBackupStage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function idle(): Promise<void> {
    const queue = await window.nais.invoke('queue:status', undefined)
    if (
      queue.running ||
      queue.items.some(
        (item) => item.state === 'pending' || item.state === 'generating' || item.state === 'failed'
      )
    )
      throw new Error(t('mobile.finishQueueBeforeRestore'))
  }
  async function choose(): Promise<void> {
    setBusy(true)
    setError('')
    let selected: NativeBackupStage | null = null
    try {
      await idle()
      selected = await nativeBackup.chooseArchive()
      if (selected.cancelled) return
      const { backup, locations } = decodeNativeBackupStage(selected)
      restoreMobileWorkspace(await readBrowserState(), backup, locations, nativeImageUrl)
      if (backup.tables.library_images?.length && !(await nativeStorage.getFolders()).library)
        throw new Error(t('mobile.selectLibraryBeforeRestore'))
      setStage(selected)
    } catch (cause) {
      if (selected?.stageId)
        await nativeBackup.discardStage({ stageId: selected.stageId }).catch(() => undefined)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  async function restore(): Promise<void> {
    if (!stage?.stageId) return
    setBusy(true)
    setError('')
    try {
      await idle()
      const { backup, locations } = decodeNativeBackupStage(stage)
      const library = backup.tables.library_images?.length
        ? await nativeBackup.stageLibraryImages({ stageId: stage.stageId })
        : { locations: {} }
      for (const [key, uri] of Object.entries(library.locations)) locations.set(key, uri)
      await mutateBrowserState(
        (current) => {
          Object.assign(current, restoreMobileWorkspace(current, backup, locations, nativeImageUrl))
        },
        { backupBeforeWrite: true }
      )
      // Rehydrate all stores from the successfully committed snapshot.
      window.location.reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }
  async function cancel(): Promise<void> {
    if (!stage?.stageId) return
    setBusy(true)
    try {
      await nativeBackup.discardStage({ stageId: stage.stageId })
      setStage(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-3 border-t border-line pt-4">
      <h2>{t('mobile.importNais')}</h2>
      {stage ? (
        <>
          <p>{t('mobile.restoreDescription')}</p>
          <button
            disabled={busy}
            onClick={() => void restore()}
            className="min-h-12 rounded-lg border border-line px-4"
          >
            {t('ui.restore')}
          </button>
          <button
            disabled={busy}
            onClick={() => void cancel()}
            className="min-h-12 rounded-lg border border-line px-4"
          >
            {t('ui.cancel')}
          </button>
        </>
      ) : (
        <button
          disabled={busy}
          onClick={() => void choose()}
          className="min-h-12 rounded-lg border border-line px-4"
        >
          {t('mobile.importNais')}
        </button>
      )}
      {busy && <p role="status">{t('ui.loading')}</p>}
      {error && <p role="alert">{t('ui.importErrorValue', error)}</p>}
    </section>
  )
}
