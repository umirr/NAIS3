import type { ComponentProps } from 'react'
import { PromptEditor } from '../components/prompt-editor'
import { TouchHeight } from './touch-height'
import { useT } from '../lib/i18n'

export function ScenePromptEditor({
  mobile,
  ...props
}: ComponentProps<typeof PromptEditor> & { mobile: boolean }): React.JSX.Element {
  const t = useT()
  if (!mobile) return <PromptEditor {...props} />
  return (
    <div className="mobile-scene-prompt">
      <p className="shrink-0 px-1 pb-1 text-xs text-muted">
        {props.negative ? t('ui.sceneNegativePrompt') : t('ui.scenePrompt')}
      </p>
      <PromptEditor
        {...props}
        ariaLabel={
          props.ariaLabel ?? (props.negative ? t('ui.sceneNegativePrompt') : t('ui.scenePrompt'))
        }
        className="min-h-0 flex-1"
      />
      <TouchHeight />
    </div>
  )
}
