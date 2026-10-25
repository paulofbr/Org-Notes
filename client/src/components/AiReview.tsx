import { useEffect, useRef, useState } from 'react'
import { Briefcase, ChevronDown, ListCollapse, ListTodo, Loader2, Sparkles, SpellCheck, Wand2 } from 'lucide-react'
import { api } from '../api'

const MODES = [
  { id: 'develop', label: 'Desenvolver', icon: <Wand2 size={15} />, hint: 'Alt+R' },
  { id: 'fix', label: 'Corrigir', icon: <SpellCheck size={15} />, hint: 'Alt+Shift+R' },
  { id: 'summarize', label: 'Resumir', icon: <ListCollapse size={15} /> },
  { id: 'formal', label: 'Tom profissional', icon: <Briefcase size={15} /> },
  { id: 'tasks', label: 'Extrair tarefas', icon: <ListTodo size={15} /> },
]

let enabled: Promise<boolean> | undefined
export const aiEnabled = () => (enabled ??= api.me().then((m) => m.ai, () => false))

/** Word-level diff (LCS) between two texts, for showing suggestions inline. */
export function diffWords(a: string, b: string): { text: string; op: '=' | '-' | '+' }[] {
  const x = a.split(/(\s+)/), y = b.split(/(\s+)/)
  const lcs = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1))
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: { text: string; op: '=' | '-' | '+' }[] = []
  const push = (text: string, op: '=' | '-' | '+') => (out.at(-1)?.op === op ? (out.at(-1)!.text += text) : out.push({ text, op }))
  let i = 0, j = 0
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) push(x[i++], (j++, '='))
    else if (i < x.length && (j === y.length || lcs[i + 1][j] >= lcs[i][j + 1])) push(x[i++], '-')
    else push(y[j++], '+')
  }
  return out
}

/**
 * AI proofreading for a form: an icon `button` to place in the form's action row and a suggestion `panel` to place
 * above it. Mouse-downs are swallowed so an editor that saves on blur stays open. Alt+R triggers it while mounted.
 */
export function useAiReview(fields: Record<string, string>, onAccept: (f: Record<string, string>) => void, labels?: Record<string, string>) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ fields: Record<string, string>; changes: string[] }>()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => void aiEnabled().then(setOn), [])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => menuRef.current?.contains(e.target as Node) || setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const run = (mode: string) => {
    setOpen(false)
    if (!on || busy || !Object.values(fields).some((v) => v.trim())) return
    setBusy(true)
    setError('')
    api.improve(fields, mode).then(setResult, (e) => setError(String(e.message ?? e))).finally(() => setBusy(false))
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.altKey && e.key.toLowerCase() === 'r' && (e.preventDefault(), run(e.shiftKey ? 'fix' : 'develop'))
    // Capture phase: editors and dialogs stop key propagation.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
  if (!on) return { button: null, panel: null }

  const keep = (e: { preventDefault: () => void }) => e.preventDefault()
  const button = (
    <div className="menu ai-menu" ref={menuRef} onMouseDown={keep}>
      <button type="button" className="icon-btn ai-btn" onClick={() => setOpen(!open)} disabled={busy} title="IA: desenvolver, corrigir, resumir… (Alt+R)" aria-label="IA">
        {busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="menu-pop">
          {MODES.map((m) => (
            <button type="button" key={m.id} className="menu-item" onClick={() => run(m.id)}>
              {m.icon}<span>{m.label}</span>{m.hint && <kbd>{m.hint}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
  const changed = result && Object.keys(fields).filter((k) => (result.fields[k] ?? fields[k]) !== fields[k])
  const panel = (error || (result && changed)) && (
    <div className="ai-panel" onMouseDown={keep}>
      {error && <p className="hint">{error}</p>}
      {result && changed && (
        <>
          {changed.length === 0 ? (
            <p className="hint">Sem sugestões: o texto parece estar bem.</p>
          ) : (
            <>
              {changed.map((k) => (
                <div key={k}>
                  {labels?.[k] && <div className="hint">{labels[k]}</div>}
                  <pre className="ai-diff">
                    {diffWords(fields[k], result.fields[k]).map((s, i) => (s.op === '=' ? s.text : s.op === '-' ? <del key={i}>{s.text}</del> : <ins key={i}>{s.text}</ins>))}
                  </pre>
                </div>
              ))}
              {result.changes.length > 0 && <ul className="hint">{result.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
            </>
          )}
          <div className="actions">
            <button type="button" onClick={() => setResult(undefined)}>Descartar</button>
            {changed.length > 0 && (
              <button type="button" className="primary" onClick={() => (onAccept({ ...fields, ...result.fields }), setResult(undefined))}>Aceitar</button>
            )}
          </div>
        </>
      )}
    </div>
  )
  return { button, panel }
}
