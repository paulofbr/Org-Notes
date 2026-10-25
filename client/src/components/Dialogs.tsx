import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../context'
import { dateKey, type Timestamp } from '../org/timestamp'
import { outlinePath } from '../org/parser'
import { refile } from '../org/edit'
import { SHORTCUTS } from '../shortcuts'

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose?: () => void; wide?: boolean }) {
  const { closeDialog } = useApp()
  const close = onClose ?? closeDialog
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') close()
        }}
      >
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

export function PromptDialog({ title, label, initial = '', onSubmit }: { title: string; label: string; initial?: string; onSubmit: (v: string) => void }) {
  const { closeDialog } = useApp()
  const [value, setValue] = useState(initial)
  return (
    <Modal title={title} onClose={closeDialog}>
      <form onSubmit={(e) => (e.preventDefault(), closeDialog(), onSubmit(value))}>
        <label>{label}<input autoFocus value={value} onChange={(e) => setValue(e.target.value)} /></label>
        <div className="actions">
          <button type="button" onClick={closeDialog}>Cancelar</button>
          <button className="primary">OK</button>
        </div>
      </form>
    </Modal>
  )
}

const QUICK: [string, number][] = [['Hoje', 0], ['Amanhã', 1], ['+1 semana', 7]]

export function DateDialog({ title, initial, onSubmit }: { title: string; initial?: Timestamp; onSubmit: (ts?: Omit<Timestamp, 'raw'>) => void }) {
  const { closeDialog } = useApp()
  const [date, setDate] = useState(initial?.date ?? dateKey(new Date()))
  const [time, setTime] = useState(initial?.time ?? '')
  const [endTime, setEndTime] = useState(initial?.endTime ?? '')
  const [repeat, setRepeat] = useState(initial?.repeater ? `${initial.repeater.type}${initial.repeater.n}${initial.repeater.unit}` : '')
  const [warn, setWarn] = useState(initial?.warning ? `${initial.warning.n}${initial.warning.unit}` : '')
  const submit = (d = date) => {
    const r = /^(\+\+|\.\+|\+)(\d+)([hdwmy])$/.exec(repeat.trim())
    const w = /^-?(\d+)([hdwmy])$/.exec(warn.trim())
    closeDialog()
    onSubmit({
      active: true,
      date: d,
      time: time || undefined,
      endTime: time && endTime ? endTime : undefined,
      repeater: r ? { type: r[1] as '+', n: +r[2], unit: r[3] as 'd' } : undefined,
      warning: w ? { n: +w[1], unit: w[2] as 'd' } : undefined,
    })
  }
  return (
    <Modal title={title} onClose={closeDialog}>
      <form onSubmit={(e) => (e.preventDefault(), submit())}>
        <div className="chips">
          {QUICK.map(([label, n]) => (
            <button type="button" key={label} onClick={() => submit(dateKey(new Date(Date.now() + n * 86400000)))}>{label}</button>
          ))}
        </div>
        <div className="row">
          <label>Data<input type="date" autoFocus value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          <label>Hora<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          <label>Até<input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={!time} /></label>
        </div>
        <div className="row">
          <label>Repetir<select value={repeat} onChange={(e) => setRepeat(e.target.value)}>
            <option value="">Não</option>
            <option value="+1d">Diariamente (+1d)</option>
            <option value="+1w">Semanalmente (+1w)</option>
            <option value="+2w">Quinzenalmente (+2w)</option>
            <option value="+1m">Mensalmente (+1m)</option>
            <option value="+1y">Anualmente (+1y)</option>
            <option value=".+1d">1 dia após concluir (.+1d)</option>
            <option value="++1w">Próxima semana futura (++1w)</option>
            {repeat && !['+1d', '+1w', '+2w', '+1m', '+1y', '.+1d', '++1w'].includes(repeat) && <option value={repeat}>{repeat}</option>}
          </select></label>
          <label>Aviso antecipado<input placeholder="ex: 3d" value={warn} onChange={(e) => setWarn(e.target.value)} /></label>
        </div>
        <div className="actions">
          {initial && <button type="button" className="danger" onClick={() => (closeDialog(), onSubmit(undefined))}>Remover</button>}
          <button type="button" onClick={closeDialog}>Cancelar</button>
          <button className="primary">Guardar</button>
        </div>
      </form>
    </Modal>
  )
}

export function TagsDialog({ initial, onSubmit }: { initial: string[]; onSubmit: (tags: string[]) => void }) {
  const { closeDialog, store } = useApp()
  const [tags, setTags] = useState(initial)
  const [input, setInput] = useState('')
  const known = useMemo(() => {
    const set = new Set<string>()
    for (const doc of Object.values(store.docs)) {
      doc.all.forEach((h) => h.tags.forEach((t) => set.add(t)))
      ;(doc.keywords.TAGS ?? '').split(/[\s{}]+/).forEach((t) => t && !t.startsWith('(') && set.add(t.replace(/\(.\)$/, '')))
    }
    return [...set].sort()
  }, [store.docs])
  const add = (t: string) => {
    const clean = t.trim().replace(/[^\w@#%]/g, '')
    if (clean && !tags.includes(clean)) setTags([...tags, clean])
    setInput('')
  }
  return (
    <Modal title="Etiquetas" onClose={closeDialog}>
      <form onSubmit={(e) => (e.preventDefault(), input.trim() ? add(input) : (closeDialog(), onSubmit(tags)))}>
        <div className="chips">
          {tags.map((t) => (
            <button type="button" className="tag active" key={t} onClick={() => setTags(tags.filter((x) => x !== t))}>{t} ×</button>
          ))}
        </div>
        <input autoFocus placeholder="Nova etiqueta + Enter" value={input} onChange={(e) => setInput(e.target.value)} />
        <div className="chips">
          {known.filter((t) => !tags.includes(t) && t.toLowerCase().includes(input.toLowerCase())).map((t) => (
            <button type="button" className="tag" key={t} onClick={() => add(t)}>{t}</button>
          ))}
        </div>
        <div className="actions">
          <button type="button" onClick={closeDialog}>Cancelar</button>
          <button type="button" className="primary" onClick={() => (closeDialog(), onSubmit(input.trim() ? [...tags, input.trim()] : tags))}>Guardar</button>
        </div>
      </form>
    </Modal>
  )
}

export function PropertyDialog({ properties, onSubmit }: { properties: Record<string, string>; onSubmit: (key: string, value?: string) => void }) {
  const { closeDialog } = useApp()
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  return (
    <Modal title="Propriedades" onClose={closeDialog}>
      {Object.keys(properties).length > 0 && (
        <table className="props">
          <tbody>
            {Object.entries(properties).map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
                <td>
                  <button onClick={() => (setKey(k), setValue(v))}>Editar</button>
                  <button className="danger" onClick={() => (closeDialog(), onSubmit(k, undefined))}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form onSubmit={(e) => (e.preventDefault(), key.trim() && (closeDialog(), onSubmit(key.trim().replace(/\s+/g, '_'), value)))}>
        <div className="row">
          <label>Nome<input autoFocus value={key} list="prop-names" onChange={(e) => setKey(e.target.value)} placeholder="Effort" /></label>
          <label>Valor<input value={value} onChange={(e) => setValue(e.target.value)} /></label>
        </div>
        <datalist id="prop-names">{['Effort', 'CATEGORY', 'ID', 'CUSTOM_ID', 'ORDERED', 'LOCATION'].map((p) => <option key={p} value={p} />)}</datalist>
        <div className="actions">
          <button type="button" onClick={closeDialog}>Fechar</button>
          <button className="primary">Definir</button>
        </div>
      </form>
    </Modal>
  )
}

export function RefileDialog({ path, line }: { path: string; line: number }) {
  const { closeDialog, store, edit } = useApp()
  const [q, setQ] = useState('')
  const targets = useMemo(() => {
    const out: { path: string; line?: number; label: string }[] = []
    for (const [p, doc] of Object.entries(store.docs)) {
      if (p.endsWith('_archive.org')) continue
      out.push({ path: p, label: p })
      for (const h of doc.all) {
        if (p === path && h.line === line) continue
        out.push({ path: p, line: h.line, label: `${p} › ${[...outlinePath(h), h.title].join(' › ')}` })
      }
    }
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return out.filter((t) => words.every((w) => t.label.toLowerCase().includes(w))).slice(0, 80)
  }, [store.docs, q, path, line])

  const choose = (t: { path: string; line?: number }) => {
    closeDialog()
    try {
      if (t.path === path) edit(path, (text) => refile(text, line, undefined, t.line).src)
      else {
        const res = refile(store.get(path), line, store.get(t.path), t.line)
        store.update(path, res.src)
        store.update(t.path, res.dst!)
      }
    } catch (err) {
      alert((err as Error).message)
    }
  }
  return (
    <Modal title="Mover para… (refile)" onClose={closeDialog} wide>
      <input autoFocus placeholder="Procurar destino…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && targets[0] && choose(targets[0])} />
      <ul className="pick-list">
        {targets.map((t) => (
          <li key={`${t.path}:${t.line}`}><button onClick={() => choose(t)}>{t.line === undefined ? <b>{t.label}</b> : t.label}</button></li>
        ))}
      </ul>
    </Modal>
  )
}

export function HelpDialog() {
  const { closeDialog } = useApp()
  return (
    <Modal title="Atalhos de teclado" onClose={closeDialog} wide>
      <div className="help-grid">
        {(Object.keys(SHORTCUTS) as (keyof typeof SHORTCUTS)[]).map((c) => (
          <div key={c}>
            <h4>{SHORTCUTS[c].title}</h4>
            <table className="props">
              <tbody>{SHORTCUTS[c].keys.map(([k, v]) => <tr key={k + v}><th><kbd>{k}</kbd></th><td>{v}</td></tr>)}</tbody>
            </table>
          </div>
        ))}
      </div>
      <div className="actions"><button className="primary" onClick={closeDialog}>OK</button></div>
    </Modal>
  )
}

/** Fast keys for TODO states: first free letter of each keyword, like org's (t) annotations. */
export function keywordKeys(keywords: string[]): [string, string][] {
  const used = new Set([' '])
  return keywords.map((kw) => {
    const key = [...kw.toLowerCase(), ...'123456789'].find((c) => /[a-z0-9]/.test(c) && !used.has(c))!
    used.add(key)
    return [key, kw]
  })
}

export function KeywordDialog({ keywords, current, onSubmit }: { keywords: string[]; current?: string; onSubmit: (kw?: string) => void }) {
  const { closeDialog } = useApp()
  const keys = keywordKeys(keywords)
  const pick = (kw?: string) => (closeDialog(), onSubmit(kw))
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <Modal title="Estado">
      <div
        className="pick-keys"
        tabIndex={-1}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === ' ') (e.preventDefault(), pick(undefined))
          const hit = keys.find(([k]) => k === e.key.toLowerCase())
          if (hit) (e.preventDefault(), pick(hit[1]))
        }}
      >
        {keys.map(([k, kw]) => (
          <button key={kw} className={kw === current ? 'active' : ''} onClick={() => pick(kw)}><kbd>{k}</kbd> {kw}</button>
        ))}
        <button onClick={() => pick(undefined)}><kbd>Espaço</kbd> sem estado</button>
      </div>
    </Modal>
  )
}

export interface Command {
  label: string
  hint?: string
  run: () => void
}

export function CommandPalette({ commands }: { commands: Command[] }) {
  const { closeDialog } = useApp()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = commands.filter((c) => words.every((w) => c.label.toLowerCase().includes(w))).slice(0, 50)
  const run = (c?: Command) => c && (closeDialog(), c.run())
  return (
    <Modal title="Comandos" wide>
      <input
        autoFocus
        placeholder="Escreve para procurar ficheiros e comandos…"
        value={q}
        onChange={(e) => (setQ(e.target.value), setSel(0))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setSel(Math.min(sel + 1, shown.length - 1)))
          if (e.key === 'ArrowUp') (e.preventDefault(), setSel(Math.max(sel - 1, 0)))
          if (e.key === 'Enter') (e.preventDefault(), run(shown[sel]))
        }}
      />
      <ul className="pick-list">
        {shown.map((c, i) => (
          <li key={c.label}>
            <button className={i === sel ? 'active' : ''} onMouseEnter={() => setSel(i)} onClick={() => run(c)} ref={(el) => { if (i === sel) el?.scrollIntoView({ block: 'nearest' }) }}>
              <span>{c.label}</span>{c.hint && <kbd>{c.hint}</kbd>}
            </button>
          </li>
        ))}
      </ul>
      <div className="hint"><kbd>↑ ↓</kbd> escolher · <kbd>Enter</kbd> executar · <kbd>Esc</kbd> fechar</div>
    </Modal>
  )
}
