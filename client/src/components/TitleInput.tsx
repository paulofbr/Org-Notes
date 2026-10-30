import { useImperativeHandle, useRef, type FocusEvent, type KeyboardEvent, type Ref } from 'react'
import { Link2 } from 'lucide-react'
import { OrgTextarea, type EditorHandle } from './OrgTextarea'
import { tr } from '../i18n'

interface Props {
  value: string
  onChange: (value: string) => void
  /** The file the title belongs to, for relative links; without it there is no link insertion. */
  path?: string
  /** Shows a link button next to the title (Ctrl+L works either way). */
  linkButton?: boolean
  inputRef?: Ref<{ focus: () => void }>
  className?: string
  placeholder?: string
  autoFocus?: boolean
  onFocus?: (e: FocusEvent<HTMLElement>) => void
  onBlur?: (e: FocusEvent<HTMLElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void
  readOnly?: boolean
}

/**
 * A one-line title on the rich editor: links show as links (a pasted address as the address itself), Ctrl+L or the
 * button inserts an internal link, and Enter submits the form around it, as an input would.
 */
export function TitleInput({ value, onChange, path, linkButton, inputRef, className, ...rest }: Props) {
  const editor = useRef<EditorHandle>(null)
  useImperativeHandle(inputRef, () => ({ focus: () => editor.current?.focus() }))
  const field = <OrgTextarea {...rest} rich singleLine editorRef={editor} value={value} onChange={onChange} path={path} className={`title-field ${className ?? ''}`} />
  if (!linkButton || !path) return field
  return (
    <div className="title-input-row">
      {field}
      {/* mousedown would move the focus, and the cursor, out of the title. */}
      <button type="button" className="icon-btn" title={tr('Link interno') + ' (Ctrl+L)'} aria-label={tr('Link interno')} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.current?.openLink()}>
        <Link2 size={16} />
      </button>
    </div>
  )
}
