import { useEffect, useState } from 'react'
import { SHORTCUTS, type ShortcutContext } from '../shortcuts'
import { tr } from '../i18n'

function contextOf(el: Element | null, view: 'doc' | 'agenda'): ShortcutContext {
  if (el?.closest('.entry-editor')) return 'editor'
  if (el?.matches('textarea.source')) return 'source'
  if (el?.closest('.hl-row') || el?.matches('li.cb > input')) return 'row'
  if (el?.closest('.agenda-row')) return 'agendaRow'
  return view
}

/** Always-visible strip showing the shortcuts that apply to what is focused right now. */
export function ShortcutBar({ view }: { view: 'doc' | 'agenda' }) {
  const [ctx, setCtx] = useState<ShortcutContext>(view)
  useEffect(() => {
    const update = () => setCtx(contextOf(document.activeElement, view))
    const later = () => setTimeout(update)
    update()
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', later)
    return () => {
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', later)
    }
  }, [view])
  // Contexts with many keys show only the essentials plus a pointer to the full list.
  const busy = ctx === 'row' || ctx === 'agendaRow'
  const global = ctx === 'editor' || ctx === 'source' ? [] : SHORTCUTS.global.keys.filter(([k]) => !busy || k === '?')
  const keys = [...SHORTCUTS[ctx].keys.filter((k) => k[2] !== false), ...global]
  return (
    <div className="shortcut-bar" aria-label={tr('Atalhos de teclado')}>
      <span className="ctx">{SHORTCUTS[ctx].title}</span>
      {keys.map(([k, label]) => (
        <span key={k + label} className="sc"><kbd>{k}</kbd> {label}</span>
      ))}
    </div>
  )
}
