import { useState, type ReactNode } from 'react'
import { Image, Images, Layers, Settings } from 'lucide-react'
import { useT } from '../lib/i18n'
import './mobile.css'

type Page = 'main' | 'scene' | 'library' | 'settings'
const pages = [
  { id: 'main', label: 'ui.generate', icon: Image },
  { id: 'scene', label: 'ui.scene', icon: Layers },
  { id: 'library', label: 'ui.library', icon: Images },
  { id: 'settings', label: 'ui.settings', icon: Settings }
] as const

/** Keep editors mounted across navigation so switching tabs never discards a draft. */
export function MobileShell({
  views,
  onPage
}: {
  views: Record<Page, ReactNode>
  onPage?: (page: Page) => void
}): React.JSX.Element {
  const [page, setPage] = useState<Page>('main')
  const t = useT()
  return (
    <div className="mobile-shell">
      <main className="mobile-content">
        {pages.map(({ id, label }) => (
          <section key={id} hidden={id !== page} aria-label={t(label)} className="mobile-page">
            {views[id]}
          </section>
        ))}
      </main>
      <nav className="mobile-navigation" aria-label={t('ui.main')}>
        {pages.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={page === id ? 'page' : undefined}
            onClick={() => {
              setPage(id)
              onPage?.(id)
            }}
          >
            <Icon size={22} aria-hidden="true" />
            <span>{t(label)}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
