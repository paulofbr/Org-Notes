import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'
import { alignTable } from '../org/edit'
import { ITEM_RE } from '../org/parser'

interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  value: string
  onChange: (v: string) => void
  autoGrow?: boolean
}

/** Plain textarea with a few org conveniences: TAB aligns tables, Alt+Enter continues lists/headlines. */
export function OrgTextarea({ value, onChange, autoGrow, onKeyDown, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const pendingCursor = useRef<number | null>(null)

  useLayoutEffect(() => {
    const el = ref.current!
    if (pendingCursor.current !== null) {
      el.selectionStart = el.selectionEnd = pendingCursor.current
      pendingCursor.current = null
    }
    if (autoGrow) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight + 2}px`
    }
  }, [value, autoGrow])

  const set = (text: string, cursor: number) => {
    pendingCursor.current = cursor
    onChange(text)
  }

  return (
    <textarea
      ref={ref}
      spellCheck={false}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.defaultPrevented) return
        const el = e.currentTarget
        const pos = el.selectionStart
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
          set(value.slice(0, pos) + '  ' + value.slice(el.selectionEnd), pos + 2)
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
      }}
      {...rest}
    />
  )
}

const lineStart = (lines: string[], idx: number) => lines.slice(0, idx).reduce((n, l) => n + l.length + 1, 0)
