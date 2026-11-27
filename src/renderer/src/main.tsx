import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

async function bootstrap(): Promise<void> {
  if (import.meta.env.VITE_MOBILE === '1') {
    const { installMobileStorage } = await import('./mobile/install-mobile-storage')
    await installMobileStorage()
  }
  // Keep the browser runtime out of Electron's eager renderer path.
  if (!window.nais) await import('./browser/install-browser-api')
  if (import.meta.env.VITE_MOBILE === '1') {
    const { installMobileRuntime } = await import('./mobile/install-mobile-runtime')
    await installMobileRuntime()
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App mobile={import.meta.env.VITE_MOBILE === '1'} />
    </StrictMode>
  )
}

void bootstrap().catch(() => {
  const message = document.createElement('p')
  message.setAttribute('role', 'alert')
  message.textContent =
    '저장된 작업 공간을 열지 못했습니다. 앱을 다시 실행해 주세요. / Cannot open saved workspace. Please restart the app.'
  document.getElementById('root')!.replaceChildren(message)
})
