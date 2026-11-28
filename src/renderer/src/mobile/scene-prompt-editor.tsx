import type { ComponentProps } from 'react'
import { PromptEditor } from '../components/prompt-editor'
import { TouchHeight } from './touch-height'

export function ScenePromptEditor({
  mobile,
  ...props
}: ComponentProps<typeof PromptEditor> & { mobile: boolean }): React.JSX.Element {
  if (!mobile) return <PromptEditor {...props} />
  return (
    <div className="mobile-scene-prompt">
      <PromptEditor {...props} className="min-h-0 flex-1" />
      <TouchHeight />
    </div>
  )
}
