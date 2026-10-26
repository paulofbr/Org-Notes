import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useApp } from '../context'
import { agenda, clockReport, compileMatch, entries, textMatch, type AgendaItem, type Entry } from '../org/agenda'
import { allTags, outlinePath } from '../org/parser'
import { nextKeyword, setKeyword } from '../org/edit'
import { useKeys, moveFocus } from '../shortcuts'
import { KeywordDialog } from './Dialogs'
import { addDays, dateKey, formatDuration, toDate } from '../org/timestamp'
import { Inline, formatDate } from './Inline'
import { tr } from '../i18n'
import { ClientFilter, useClientMatch } from './ClientFilter'

type Tab = 'day' | 'week' | 'todo' | 'search' | 'clock'

const TABS: [Tab, string][] = [['day', tr('Dia')], ['week', tr('Semana')], ['todo', tr('Tarefas')], ['search', tr('Procurar')], ['clock', tr('Relógio')]]

export function AgendaView({ initialTab = 'week' }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const nav = () => moveFocus(1, document.activeElement?.closest('.agenda-row'))
  useKeys({
    ...Object.fromEntries(TABS.map(([t], i) => [String(i + 1), () => setTab(t)])),
    j: nav,
    k: () => moveFocus(-1, document.activeElement?.closest('.agenda-row')),
  })
  return (
    <div className="agenda">
      <div className="tabs" role="tablist">
        {TABS.map(([t, label]) => (
          <button key={t} role="tab" className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{label} <kbd>{TABS.findIndex((x) => x[0] === t) + 1}</kbd></button>
        ))}
        <ClientFilter />
      </div>
      {(tab === 'day' || tab === 'week') && <Calendar span={tab === 'day' ? 1 : 7} />}
      {tab === 'todo' && <TodoList />}
      {tab === 'search' && <Search />}
      {tab === 'clock' && <ClockReport />}
    </div>
  )
}

function weekStart(key: string) {
  const d = toDate(key)
  return addDays(key, -((d.getDay() + 6) % 7))
}

function Calendar({ span }: { span: number }) {
  const { store } = useApp()
  const today = dateKey(new Date())
  const [anchor, setAnchor] = useState(today)
  const from = anchor
  const to = addDays(from, span - 1)
  const clientMatch = useClientMatch()
  const days = useMemo(() => {
    const all = agenda(store.docs, from, to, today)
    return clientMatch ? new Map([...all].map(([day, items]) => [day, items.filter((it) => clientMatch(it.h))])) : all
  }, [store.docs, from, to, today, clientMatch])
  useKeys({ b: () => setAnchor(addDays(anchor, -span)), f: () => setAnchor(addDays(anchor, span)), '.': () => setAnchor(today) })
  return (
    <>
      <div className="range-nav">
        <button onClick={() => setAnchor(addDays(anchor, -span))} title={tr('Anterior')}><ChevronLeft size={16} /><kbd>b</kbd></button>
        <button onClick={() => setAnchor(today)}>{tr('Hoje')} <kbd>.</kbd></button>
        <button onClick={() => setAnchor(addDays(anchor, span))} title={tr('Seguinte')}><kbd>f</kbd><ChevronRight size={16} /></button>
        <span className="range-label">
          {span === 1 ? formatDate(from, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : `${formatDate(from, { day: 'numeric', month: 'short' })} – ${formatDate(to, { day: 'numeric', month: 'short', year: 'numeric' })}`}
        </span>
      </div>
      {[...days].map(([day, items]) => (
        <div key={day} className={`day ${day === today ? 'today' : ''} ${[0, 6].includes(toDate(day).getDay()) ? 'weekend' : ''}`}>
          <h4 data-today={tr('hoje')}>{formatDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h4>
          {items.length ? items.map((it, i) => <AgendaRow key={i} e={it} item={it} />) : <div className="empty">—</div>}
        </div>
      ))}
    </>
  )
}

const KIND_LABEL = (it: AgendaItem) => {
  switch (it.kind) {
    case 'scheduled': return tr('Agendado')
    case 'deadline': return tr('Prazo')
    case 'overdue': return tr('Atrasado {n}d', { n: it.days })
    case 'upcoming': return tr('Prazo em {n}d', { n: it.days })
    case 'sched-past': return tr('Agendado há {n}d', { n: it.days })
    default: return ''
  }
}

function AgendaRow({ e, item, extra }: { e: Entry; item?: AgendaItem; extra?: string }) {
  const app = useApp()
  const { h, doc, path } = e
  const category = h.properties.CATEGORY ?? doc.keywords.CATEGORY ?? path.replace(/\.org$/, '').split('/').pop()
  const pickKeyword = () =>
    app.showDialog(<KeywordDialog keywords={[...doc.todo.todo, ...doc.todo.done]} current={h.keyword} onSubmit={(kw) => app.edit(path, (t) => setKeyword(t, h.line, kw))} />)
  const time = item?.ts.time && ['scheduled', 'deadline', 'timestamp'].includes(item.kind) ? `${item.ts.time}${item.ts.endTime ? '–' + item.ts.endTime : ''}` : ''
  return (
    <div
      className={`agenda-row ${h.done ? 'done' : ''} ${item ? `k-${item.kind}` : ''}`}
      tabIndex={0}
      onClick={() => app.open(path, h.line)}
      onKeyDown={(ev) => {
        const stop = () => (ev.preventDefault(), ev.stopPropagation())
        if (ev.key === 'Enter') (stop(), app.open(path, h.line))
        else if (ev.key === 't') (stop(), pickKeyword())
        else if (ev.shiftKey && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft'))
          (stop(), app.edit(path, (t) => setKeyword(t, h.line, nextKeyword(doc, h.keyword, ev.key === 'ArrowRight' ? 1 : -1))))
        else if (ev.key === 'ArrowDown' || ev.key === 'j') (stop(), moveFocus(1, ev.currentTarget))
        else if (ev.key === 'ArrowUp' || ev.key === 'k') (stop(), moveFocus(-1, ev.currentTarget))
        else if (ev.key === 'Escape') (stop(), ev.currentTarget.blur())
      }}
    >
      <span className="cat">{category}</span>
      <span className="time">{time}</span>
      {item && <span className="kind">{KIND_LABEL(item)}</span>}
      {h.keyword && (
        <button
          className={`kw ${h.done ? 'kw-done' : 'kw-todo'} kw-${h.keyword.toLowerCase()}`}
          title={tr('Mudar estado (t)')}
          tabIndex={-1}
          onClick={(ev) => (ev.stopPropagation(), pickKeyword())}
        >
          {h.keyword}
        </button>
      )}
      {h.priority && <span className={`prio prio-${h.priority}`}>{h.priority}</span>}
      <span className="title"><Inline text={h.title} /></span>
      {extra && <span className="badge">{extra}</span>}
      <span className="tags">{allTags(h, doc).map((t) => <span key={t} className="tag">{t}</span>)}</span>
    </div>
  )
}

function TodoList() {
  const { store } = useApp()
  const [kw, setKw] = useState<string>('')
  const clientMatch = useClientMatch()
  const all = useMemo(
    () => entries(store.docs).filter((e) => e.h.keyword && !e.h.done && !e.path.endsWith('_archive.org') && (!clientMatch || clientMatch(e.h))),
    [store.docs, clientMatch],
  )
  const keywords = [...new Set(all.map((e) => e.h.keyword!))]
  const shown = all
    .filter((e) => !kw || e.h.keyword === kw)
    .sort((a, b) => (a.h.priority ?? 'B').localeCompare(b.h.priority ?? 'B'))
  return (
    <>
      <div className="chips">
        <button className={`tag ${!kw ? 'active' : ''}`} onClick={() => setKw('')}>{tr('Todas')} ({all.length})</button>
        {keywords.map((k) => (
          <button key={k} className={`tag ${kw === k ? 'active' : ''}`} onClick={() => setKw(k)}>{k} ({all.filter((e) => e.h.keyword === k).length})</button>
        ))}
      </div>
      {shown.map((e) => <AgendaRow key={`${e.path}:${e.h.line}`} e={e} />)}
      {!shown.length && <div className="empty">{tr('Nada por fazer')} 🎉</div>}
    </>
  )
}

function Search() {
  const { store } = useApp()
  const [mode, setMode] = useState<'text' | 'match'>('text')
  const [q, setQ] = useState('')
  const [todoOnly, setTodoOnly] = useState(false)
  const clientMatch = useClientMatch()
  const results = useMemo(() => {
    // With a client chosen and nothing typed, everything of that client.
    if (!q.trim() && !clientMatch) return []
    let test: (e: Entry) => boolean
    try {
      test = !q.trim() ? () => true : mode === 'text' ? (e) => textMatch(e, q) : compileMatch(q)
    } catch {
      return []
    }
    return entries(store.docs).filter((e) => (!todoOnly || (e.h.keyword && !e.h.done)) && (!clientMatch || clientMatch(e.h)) && test(e))
  }, [store.docs, q, mode, todoOnly, clientMatch])
  return (
    <>
      <div className="search-bar">
        <select value={mode} onChange={(e) => setMode(e.target.value as 'text')}>
          <option value="text">{tr('Texto')}</option>
          <option value="match">{tr('Etiquetas / propriedades')}</option>
        </select>
        <input
          autoFocus
          id="global-search"
          placeholder={mode === 'text' ? tr('palavras  -excluir') : tr('trabalho+urgente-casa|TODO="NEXT"')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.currentTarget.blur()
            if (e.key === 'ArrowDown' || e.key === 'Enter') (e.preventDefault(), document.querySelector<HTMLElement>('.content .agenda-row')?.focus())
          }}
        />
        <label className="inline"><input type="checkbox" checked={todoOnly} onChange={(e) => setTodoOnly(e.target.checked)} /> {tr('Só tarefas abertas')}</label>
      </div>
      {mode === 'match' && (
        <p className="hint">
          {tr('Sintaxe org:')} <code>tag1+tag2-tag3</code>, <code>a|b</code> ({tr('ou')}), <code>TODO="NEXT"</code>, <code>PRIORITY="A"</code>, <code>Effort&gt;1:00</code>, <code>LEVEL=2</code>, <code>{'{regex}'}</code>, {tr('e')} <code>/NEXT|TODO</code> {tr('para filtrar estados.')}
        </p>
      )}
      {results.map((e) => (
        <div key={`${e.path}:${e.h.line}`}>
          <AgendaRow e={e} />
          <div className="crumb">{[e.path, ...outlinePath(e.h)].join(' › ')}</div>
        </div>
      ))}
      {(q || clientMatch) && !results.length && <div className="empty">{tr('Sem resultados')}</div>}
    </>
  )
}

function ClockReport() {
  const { store } = useApp()
  const today = dateKey(new Date())
  const [anchor, setAnchor] = useState(today)
  const from = weekStart(anchor)
  const to = addDays(from, 6)
  const clientMatch = useClientMatch()
  const rows = useMemo(() => clockReport(store.docs, from, to).filter((r) => !clientMatch || clientMatch(r.h)), [store.docs, from, to, clientMatch])
  const total = rows.reduce((s, r) => s + r.minutes, 0)
  useKeys({ b: () => setAnchor(addDays(anchor, -7)), f: () => setAnchor(addDays(anchor, 7)), '.': () => setAnchor(today) })
  return (
    <>
      <div className="range-nav">
        <button onClick={() => setAnchor(addDays(anchor, -7))} title={tr('Anterior')}><ChevronLeft size={16} /><kbd>b</kbd></button>
        <button onClick={() => setAnchor(today)}>{tr('Esta semana')} <kbd>.</kbd></button>
        <button onClick={() => setAnchor(addDays(anchor, 7))} title={tr('Seguinte')}><kbd>f</kbd><ChevronRight size={16} /></button>
        <span className="range-label">{formatDate(from, { day: 'numeric', month: 'short' })} – {formatDate(to, { day: 'numeric', month: 'short' })} · {tr('total')} <b>{formatDuration(total)}</b></span>
      </div>
      {rows.map((r) => (
        <div key={`${r.path}:${r.h.line}`} className="clock-row">
          <AgendaRow e={r} extra={formatDuration(r.minutes)} />
          <div className="bar" style={{ width: `${(100 * r.minutes) / (rows[0]?.minutes || 1)}%` }} />
        </div>
      ))}
      {!rows.length && <div className="empty">{tr('Sem tempo registado nesta semana')}</div>}
    </>
  )
}
