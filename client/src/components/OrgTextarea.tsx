import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { alignTable } from '../org/edit'
import { Link2 } from 'lucide-react'
import { ITEM_RE } from '../org/parser'
import { LinkDialog, uploadImageLink, type LinkTab } from './LinkDialog'
import * as Rich from './richText'
import { pastedLink } from '../org/links'
import { tr } from '../i18n'

interface Props {
  value: string
  onChange: (v: string) => void
  autoGrow?: boolean
  /** The file being edited; links are written relative to it. Without it there is no Ctrl+L or image pasting. */
  path?: string
  /** Shows Link and Image buttons under the text (needs `path`). */
  tools?: boolean
  /** Shows links as links and images as images while editing; everything else stays org text. */
  rich?: boolean
  className?: string
  placeholder?: string
  autoFocus?: boolean
  rows?: number
  onBlur?: (e: FocusEvent<HTMLElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void
}

/**
 * Text editor with a few org conveniences: TAB aligns tables, Alt+Enter continues lists/headlines,
 * Ctrl+L inserts a link or image, and pasting or dropping an image uploads it and links it.
 * Plain textarea by default; with `rich`, an editable surface that shows links and images (see richText.ts).
 */
export function OrgTextarea({ value, onChange, autoGrow, onKeyDown, path, tools, rich, className, placeholder, autoFocus, rows, onBlur }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const pendingCursor = useRef<number | null>(null)
  const [linking, setLinking] = useState<{ start: number; end: number; only?: LinkTab }>()
  // Uploads finish later, so they insert into the latest text, not the text from when they started.
  const latest = useRef({ value, onChange })
  latest.current = { value, onChange }

  const selection = () =>
    rich ? Rich.getSelection(host.current!) : { start: ref.current!.selectionStart, end: ref.current!.selectionEnd }
  const focus = () => (rich ? host.current : ref.current)?.focus()

  useLayoutEffect(() => {
    if (rich) {
      const el = host.current!
      if (Rich.serialize(el) !== value || !Rich.isCanonical(el)) {
        // A change from outside (an insert, the AI review): keep the cursor where it was, if there was one.
        const keep = document.activeElement === el ? Rich.getSelection(el).start : null
        Rich.render(el, value, path)
        if (pendingCursor.current === null && keep !== null) Rich.setCaret(el, Math.min(keep, value.length))
      }
      if (pendingCursor.current !== null) {
        el.focus()
        Rich.setCaret(el, pendingCursor.current)
        pendingCursor.current = null
      }
      return
    }
    const el = ref.current!
    if (pendingCursor.current !== null) {
      el.selectionStart = el.selectionEnd = pendingCursor.current
      pendingCursor.current = null
    }
    if (autoGrow) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight + 2}px`
    }
  }, [value, autoGrow, rich, path])

  useEffect(() => {
    if (rich && autoFocus) (host.current!.focus(), Rich.setCaret(host.current!, latest.current.value.length))
  }, [rich, autoFocus])

  const set = (text: string, cursor: number) => {
    pendingCursor.current = cursor
    onChange(text)
  }

  const insert = (text: string, start: number, end = start) => {
    const v = latest.current.value
    pendingCursor.current = start + text.length
    latest.current.onChange(v.slice(0, start) + text + v.slice(end))
    focus()
  }

  const uploadImages = (files: FileList | undefined, at: number) => {
    const images = [...(files ?? [])].filter((f) => f.type.startsWith('image/'))
    if (!path || !images.length) return false
    Promise.all(images.map((f) => uploadImageLink(path, f))).then((links) => insert(links.join('\n'), at), (e) => alert(e.message))
    return true
  }

  const keyDown = (e: KeyboardEvent<HTMLElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return
    const { start: pos, end: selEnd } = selection()
    const ctrl = e.ctrlKey || e.metaKey
    if (path && e.key.toLowerCase() === 'l' && ctrl && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      e.stopPropagation()
      setLinking({ start: pos, end: selEnd, only: 'internal' })
      return
    }
    // The rich surface only holds org text: no bold/italic markup from the browser, and Enter is a plain newline.
    if (rich && ctrl && /^[biu]$/i.test(e.key)) return void e.preventDefault()
    if (rich && e.key === 'Enter' && !e.altKey && !ctrl && !e.shiftKey) {
      e.preventDefault()
      set(value.slice(0, pos) + '\n' + value.slice(selEnd), pos + 1)
      return
    }
    const lines = value.split('\n')
    const lineIdx = value.slice(0, pos).split('\n').length - 1
    const line = lines[lineIdx]
    if (e.key === 'Tab' && /^\s*\|/.test(line)) {
      e.preventDefault()
      let s = lineIdx
      let t = lineIdx
      while (s > 0 && /^\s*\|/.test(lines[s - 1])) s--
      while (t < lines.length - 1 && /^\s*\|/.test(lines[t + 1])) t++
      const col = line.slice(0, pos - lineStart(lines, lineIdx)).split('|').length - 1
      const aligned = alignTable(lines.slice(s, t + 1))
      const next = [...lines.slice(0, s), ...aligned, ...lines.slice(t + 1)]
      // Move to the next cell, adding a row at the end of the table like org.
      let row = lineIdx
      let target = e.shiftKey ? col - 1 : col + 1
      const cells = (r: number) => next[r].split('|').length - 2
      if (target > cells(row)) {
        row++
        while (row <= t && /^\s*\|-/.test(next[row])) row++
        if (row > t) {
          next.splice(row, 0, aligned[lineIdx - s].replace(/[^|]/g, ' '))
          next[row] = next[row].replace(/^ */, /^\s*/.exec(line)![0])
        }
        target = 1
      } else if (target < 1) target = 1
      const parts = next[row].split('|')
      const offset = parts.slice(0, target).join('|').length + 2
      set(next.join('\n'), lineStart(next, row) + Math.min(offset, next[row].length))
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      set(value.slice(0, pos) + '  ' + value.slice(selEnd), pos + 2)
      return
    }
    if (e.key === 'Enter' && e.altKey) {
      e.preventDefault()
      const h = /^(\*+)\s/.exec(line)
      const item = ITEM_RE.exec(line)
      let prefix = ''
      if (h) prefix = `${h[1]} `
      else if (item) {
        const n = /^(\d+)([.)])$/.exec(item[2])
        prefix = `${item[1]}${n ? `${+n[1] + 1}${n[2]}` : item[2]} ${/^\[[ Xx-]\]/.test(item[3] ?? '') ? '[ ] ' : ''}`
      }
      const end = lineStart(lines, lineIdx) + line.length
      set(value.slice(0, end) + '\n' + prefix + value.slice(end), end + 1 + prefix.length)
    }
  }

  return (
    <>
      {rich ? (
        <div
          ref={host}
          className={`rich-text ${className ?? ''}`}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          role="textbox"
          aria-multiline
          data-placeholder={placeholder}
          style={rows ? { minHeight: `${rows * 1.6}em` } : undefined}
          onInput={(e) => {
            const el = e.currentTarget
            const text = Rich.serialize(el)
            // Undo or typing can leave browser-made nodes; put the DOM back in its simple form.
            if (!Rich.isCanonical(el)) {
              const { start } = Rich.getSelection(el)
              Rich.render(el, text, path)
              Rich.setCaret(el, start)
            }
            onChange(text)
          }}
          onPaste={(e) => {
            e.preventDefault()
            const { start, end } = selection()
            if (uploadImages(e.clipboardData.files, start)) return
            const pasted = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
            const text = pastedLink(pasted, value.slice(start, end), value.slice(0, start)) ?? pasted
            set(value.slice(0, start) + text + value.slice(end), start + text.length)
          }}
          onDragOver={(e) => path && e.dataTransfer.types.includes('Files') && e.preventDefault()}
          onDrop={(e) => (e.preventDefault(), uploadImages(e.dataTransfer.files, selection().start))}
          onKeyDown={keyDown}
          onBlur={onBlur}
        />
      ) : (
        <textarea
          ref={ref}
          className={className}
          placeholder={placeholder}
          autoFocus={autoFocus}
          rows={rows}
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const { selectionStart: start, selectionEnd: end } = e.currentTarget
            if (uploadImages(e.clipboardData.files, start)) return e.preventDefault()
            const link = pastedLink(e.clipboardData.getData('text/plain'), value.slice(start, end), value.slice(0, start))
            if (link) (e.preventDefault(), insert(link, start, end))
          }}
          onDragOver={(e) => path && e.dataTransfer.types.includes('Files') && e.preventDefault()}
          onDrop={(e) => uploadImages(e.dataTransfer.files, e.currentTarget.selectionStart) && e.preventDefault()}
          onKeyDown={keyDown}
          onBlur={onBlur}
        />
      )}
      {tools && path && (
        // mousedown would take the focus (and the cursor position) away from the text.
        <div className="text-tools" onMouseDown={(e) => e.preventDefault()}>
          <button type="button" title={tr('Link para um ficheiro ou título das notas')} onClick={() => setLinking({ ...selection(), only: 'internal' })}><Link2 size={14} /> {tr('Link interno')}</button>
          <span className="hint">{tr('Cola um endereço web para criar um link, ou cola / arrasta uma imagem.')}</span>
        </div>
      )}
      {/* In <body>, so its forms are never nested in a form around this editor. */}
      {linking && path && createPortal(
        <LinkDialog
          path={path}
          initialText={value.slice(linking.start, linking.end)}
          only={linking.only}
          onInsert={(link) => insert(link, linking.start, linking.end)}
          onClose={() => (setLinking(undefined), focus())}
        />,
        document.body,
      )}
    </>
  )
}

const lineStart = (lines: string[], idx: number) => lines.slice(0, idx).reduce((n, l) => n + l.length + 1, 0)
