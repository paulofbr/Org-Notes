import { useRef, useState, type InputHTMLAttributes, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { Link2 } from 'lucide-react'
import { LinkDialog } from './LinkDialog'
import { tr } from '../i18n'
import { pastedLink } from '../org/links'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
  /** The file the title belongs to, for relative links; without it there is no link insertion. */
  path?: string
  /** Shows a link button next to the input (Ctrl+L works either way). */
  linkButton?: boolean
  inputRef?: Ref<HTMLInputElement>
}

/** A one-line title input where Ctrl+L inserts a link at the cursor, using the selected text as its description. */
export function TitleInput({ value, onChange, path, linkButton, inputRef, onKeyDown, ...rest }: Props) {
  const own = useRef<HTMLInputElement | null>(null)
  const [linking, setLinking] = useState<{ start: number; end: number }>()
  const open = () => {
    const el = own.current
    setLinking({ start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length })
  }
  const setRefs = (el: HTMLInputElement | null) => {
    own.current = el
    if (typeof inputRef === 'function') inputRef(el)
    else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = el
  }
  const input = (
    <input
      {...rest}
      ref={setRefs}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPaste={(e) => {
        const start = e.currentTarget.selectionStart ?? value.length
        const end = e.currentTarget.selectionEnd ?? start
        const link = pastedLink(e.clipboardData.getData('text/plain'), value.slice(start, end), value.slice(0, start))
        if (!link) return
        e.preventDefault()
        onChange(value.slice(0, start) + link + value.slice(end))
        requestAnimationFrame(() => own.current?.setSelectionRange(start + link.length, start + link.length))
      }}
      onKeyDown={(e) => {
        if (path && e.key.toLowerCase() === 'l' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
          e.preventDefault()
          e.stopPropagation()
          return open()
        }
        onKeyDown?.(e)
      }}
    />
  )
  return (
    <>
      {linkButton && path ? (
        <div className="title-input-row">
          {input}
          <button type="button" className="icon-btn" title={tr('Link interno') + ' (Ctrl+L)'} aria-label={tr('Link interno')} onClick={open}>
            <Link2 size={16} />
          </button>
        </div>
      ) : (
        input
      )}
      {/* In <body>, so its form is never nested in a form around this input. */}
      {linking && path && createPortal(
        <LinkDialog
          path={path}
          only="internal"
          initialText={value.slice(linking.start, linking.end)}
          onInsert={(link) => {
            onChange(value.slice(0, linking.start) + link + value.slice(linking.end))
            const at = linking.start + link.length
            requestAnimationFrame(() => own.current && (own.current.focus(), own.current.setSelectionRange(at, at)))
          }}
          onClose={() => (setLinking(undefined), own.current?.focus())}
        />,
        document.body,
      )}
    </>
  )
}
