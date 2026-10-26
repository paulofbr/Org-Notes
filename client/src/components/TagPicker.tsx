import { useMemo, useState } from 'react'
import { useApp } from '../context'
import { cleanTag, knownTags } from '../org/tags'
import { tr } from '../i18n'

/** Picks a new item's tags: the chosen ones (click to remove), a box for new ones, and the existing ones to click. */
export function TagPicker({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const { store } = useApp()
  const known = useMemo(() => knownTags(store.docs), [store.docs])
  const [input, setInput] = useState('')
  const add = (t: string) => {
    const tag = cleanTag(t)
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setInput('')
  }
  const words = input.trim().toLowerCase()
  const offered = known.filter((t) => !value.includes(t) && t.toLowerCase().includes(words)).slice(0, 12)
  return (
    <div className="tag-picker">
      <span className="muted">{tr('Etiquetas')}:</span>
      {value.map((t) => (
        <button type="button" key={t} className="tag active" title={tr('Retirar')} onClick={() => onChange(value.filter((x) => x !== t))}>{t} ×</button>
      ))}
      <input
        value={input}
        placeholder={tr('Nova etiqueta + Enter')}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && input.trim()) (e.preventDefault(), add(input))
          else if (e.key === 'Backspace' && !input && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={() => input.trim() && add(input)}
      />
      {offered.map((t) => <button type="button" key={t} className="tag" onClick={() => add(t)}>{t}</button>)}
    </div>
  )
}
