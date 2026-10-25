import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  AlarmClock, Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarClock, ChevronRight, CornerDownRight, Focus,
  CheckCircle2, MoreHorizontal, Pencil, Play, Plus, Repeat, Settings2, Square, Tag, Trash2,
} from 'lucide-react'
import { useApp } from '../context'
import { sectionBlocks, type Headline, type OrgDoc } from '../org/parser'
import * as E from '../org/edit'
import { compileMatch, textMatch } from '../org/agenda'
import { dateKey, daysBetween, formatDuration, warningDays, type Timestamp } from '../org/timestamp'
import { Blocks, Drawer } from './Blocks'
import { Inline, formatDate } from './Inline'
import { OrgTextarea } from './OrgTextarea'
import { DateDialog, KeywordDialog, PropertyDialog, TagsDialog } from './Dialogs'
import { moveFocus } from '../shortcuts'

export type Fold = 'folded' | 'children' | 'subtree'
export type Visibility = 'overview' | 'contents' | 'showall'

const defaultFold = (v: Visibility): Fold => (v === 'overview' ? 'folded' : v === 'contents' ? 'children' : 'subtree')

export interface OutlineState {
  visibility: Visibility
  folds: Map<string, Fold>
}

interface Props {
  path: string
  doc: OrgDoc
  state: OutlineState
  setState: (s: OutlineState) => void
  filter: string
  narrow?: string
  setNarrow: (key?: string) => void
  focus?: { line: number }
}

export function Outline({ path, doc, state, setState, filter, narrow, setNarrow, focus }: Props) {
  const app = useApp()
  const root = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState<number | 'preamble' | null>(null)
  const pendingFocus = useRef<{ title: string; line: number } | null>(null)

  const foldOf = (h: Headline) => state.folds.get(h.key) ?? defaultFold(state.visibility)
  const setFolds = (entries: [string, Fold][]) => {
    const folds = new Map(state.folds)
    entries.forEach(([k, f]) => folds.set(k, f))
    setState({ ...state, folds })
  }
  const cycle = (h: Headline) => {
    const f = foldOf(h)
    const descendants = (x: Headline): Headline[] => x.children.flatMap((c) => [c, ...descendants(c)])
    if (!h.children.length) return setFolds([[h.key, f === 'subtree' ? 'folded' : 'subtree']])
    if (f === 'folded') setFolds([[h.key, 'children'], ...h.children.map((c) => [c.key, 'folded'] as [string, Fold])])
    else if (f === 'children') setFolds([[h.key, 'subtree'], ...descendants(h).map((c) => [c.key, 'subtree'] as [string, Fold])])
    else setFolds([[h.key, 'folded']])
  }

  // Reveal and focus a headline when navigating to a line (agenda, links, search).
  useEffect(() => {
    if (!focus) return
    const h = doc.all.find((x) => x.line === focus.line)
    if (!h) return
    const reveal: [string, Fold][] = []
    for (let p = h.parent; p; p = p.parent) if (foldOf(p) === 'folded') reveal.push([p.key, 'children'])
    reveal.push([h.key, 'subtree'])
    setFolds(reveal)
    pendingFocus.current = { title: h.title, line: h.line }
  }, [focus, path])

  useLayoutEffect(() => {
    const want = pendingFocus.current
    if (!want) return
    const candidates = doc.all.filter((h) => h.title === want.title)
    const best = candidates.sort((a, b) => Math.abs(a.line - want.line) - Math.abs(b.line - want.line))[0]
    const el = best && root.current?.querySelector<HTMLElement>(`[data-line="${best.line}"]`)
    if (el) {
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: 'nearest' })
      pendingFocus.current = null
    }
  })

  const edit = (fn: (text: string) => string, focus?: Headline) => {
    if (focus) pendingFocus.current = { title: focus.title, line: focus.line }
    app.edit(path, fn)
  }

  const matcher = useMemo(() => {
    const q = filter.trim()
    if (!q) return undefined
    let match: ((e: { path: string; doc: OrgDoc; h: Headline }) => boolean) | undefined
    try {
      match = compileMatch(q)
    } catch {
      match = undefined
    }
    const visible = new Set<string>()
    for (const h of doc.all)
      if (textMatch({ path, doc, h }, q) || match?.({ path, doc, h }))
        for (let p: Headline | undefined = h; p; p = p.parent) visible.add(p.key)
    return visible
  }, [filter, doc, path])

  const focusLater = (h: Headline) => (pendingFocus.current = { title: h.title, line: h.line })
  const ops: NodeOps = { path, doc, foldOf, cycle, edit, editing, setEditing, matcher, setNarrow, narrowed: !!narrow, focusLater }
  const narrowed = narrow ? doc.all.find((h) => h.key === narrow) : undefined
  const tops = narrowed ? [narrowed] : doc.headlines

  return (
    <div
      className="outline"
      ref={root}
      onKeyDown={(e) => {
        const t = e.target as HTMLElement
        if (!t.matches('li.cb > input')) return
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') (e.preventDefault(), moveFocus(e.key === 'ArrowDown' ? 1 : -1, t))
        if (e.key === 'Escape' && narrow) setNarrow(undefined)
      }}
    >
      {!narrowed && !matcher && <Preamble path={path} doc={doc} editing={editing === 'preamble'} setEditing={setEditing} />}
      {narrowed && (
        <div className="banner">
          A mostrar apenas «{narrowed.title}» <button onClick={() => setNarrow(undefined)}>Mostrar tudo</button>
        </div>
      )}
      {tops.map((h) => <Node key={h.key} h={h} ops={ops} />)}
      {!matcher && (
        <button className="add-heading" onClick={() => edit((t) => E.insertHeadline(t, narrowed?.line, narrowed ? 'child' : 'sibling', 'Novo título'))}>
          <Plus size={16} /> Novo título <kbd>Ctrl+Enter</kbd>
        </button>
      )}
    </div>
  )
}

interface NodeOps {
  path: string
  doc: OrgDoc
  foldOf: (h: Headline) => Fold
  cycle: (h: Headline) => void
  edit: (fn: (text: string) => string, focus?: Headline) => void
  editing: number | 'preamble' | null
  setEditing: (v: number | 'preamble' | null) => void
  matcher?: Set<string>
  setNarrow: (key?: string) => void
  narrowed: boolean
  focusLater: (h: Headline) => void
}

function Preamble({ path, doc, editing, setEditing }: { path: string; doc: OrgDoc; editing: boolean; setEditing: (v: 'preamble' | null) => void }) {
  const app = useApp()
  const blocks = useMemo(() => sectionBlocks(doc), [doc])
  if (editing)
    return <EntryEditor initial={doc.lines.slice(0, doc.preambleEnd).join('\n')} onDone={(text) => {
      setEditing(null)
      if (text !== undefined) app.edit(path, (t) => E.replaceLines(t, 0, doc.preambleEnd, text))
    }} />
  const meta = ['AUTHOR', 'DATE', 'SUBTITLE'].filter((k) => doc.keywords[k])
  return (
    <div className="preamble" onDoubleClick={() => setEditing('preamble')}>
      {meta.length > 0 && <div className="meta">{meta.map((k) => <span key={k}>{doc.keywords[k]}</span>)}</div>}
      <Blocks blocks={blocks} opts={{ onCheckbox: (l) => app.edit(path, (t) => E.toggleCheckbox(t, l)), onLink: (t) => app.openLink(t, path) }} />
    </div>
  )
}

function Node({ h, ops }: { h: Headline; ops: NodeOps }) {
  const { matcher } = ops
  if (matcher && !matcher.has(h.key)) return null
  const fold = matcher ? 'children' : ops.foldOf(h)
  return (
    <section className={`node level-${Math.min(h.level, 6)}`}>
      <HeadlineRow h={h} ops={ops} fold={fold} />
      {ops.editing === h.line ? (
        <EntryEditor
          initial={ops.doc.lines.slice(h.line, h.contentEnd).join('\n')}
          onDone={(text) => {
            ops.setEditing(null)
            ops.focusLater(h)
            if (text !== undefined) ops.edit((t) => E.replaceLines(t, h.line, h.contentEnd, text.replace(/\n*$/, '\n')), h)
          }}
        />
      ) : (
        fold === 'subtree' && !matcher && <Body h={h} ops={ops} />
      )}
      {fold !== 'folded' && h.children.length > 0 && (
        <div className="children">{h.children.map((c) => <Node key={c.key} h={c} ops={ops} />)}</div>
      )}
    </section>
  )
}

function HeadlineRow({ h, ops, fold }: { h: Headline; ops: NodeOps; fold: Fold }) {
  const app = useApp()
  const { path, doc, edit } = ops
  const [titleEdit, setTitleEdit] = useState<string | null>(null)
  const titleCancelled = useRef(false)
  const running = app.running?.path === path && app.running.h.line === h.line
  const clocked = h.clocks.reduce((s, c) => s + c.minutes, 0)
  const hasBody = h.contentEnd - h.line > 1 || h.children.length > 0

  const actions = {
    schedule: () => app.showDialog(<DateDialog title="Agendar (SCHEDULED)" initial={h.planning.scheduled} onSubmit={(ts) => edit((t) => E.setPlanning(t, h.line, 'scheduled', ts), h)} />),
    deadline: () => app.showDialog(<DateDialog title="Prazo (DEADLINE)" initial={h.planning.deadline} onSubmit={(ts) => edit((t) => E.setPlanning(t, h.line, 'deadline', ts), h)} />),
    tags: () => app.showDialog(<TagsDialog initial={h.tags} onSubmit={(tags) => edit((t) => E.setTags(t, h.line, tags), h)} />),
    props: () => app.showDialog(<PropertyDialog properties={h.properties} onSubmit={(k, v) => edit((t) => E.setProperty(t, h.line, k, v), h)} />),
    clock: () => (running ? app.clockOut() : app.clockIn(path, h.line)),
    child: () => edit((t) => E.insertHeadline(t, h.line, 'child', 'Novo título'), { ...h, title: 'Novo título', line: h.end }),
    sibling: () => edit((t) => E.insertHeadline(t, h.line, 'sibling', 'Novo título'), { ...h, title: 'Novo título', line: h.end }),
    remove: () => confirm(`Apagar «${h.title}» e todo o seu conteúdo?`) && edit((t) => E.deleteSubtree(t, h.line)),
    move: (d: 1 | -1) => edit((t) => E.moveSubtree(t, h.line, d), h),
    level: (d: 1 | -1) => edit((t) => E.shiftLevel(t, h.line, d), h),
    keyword: (kw?: string) => edit((t) => E.setKeyword(t, h.line, kw), h),
    priority: (d: 1 | -1) => edit((t) => E.cyclePriority(t, h.line, d), h),
    pickKeyword: () => app.showDialog(<KeywordDialog keywords={[...doc.todo.todo, ...doc.todo.done]} current={h.keyword} onSubmit={(kw) => edit((t) => E.setKeyword(t, h.line, kw), h)} />),
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    const k = e.key
    const nav = (dir: 1 | -1) => moveFocus(dir, e.currentTarget)
    const handled = () => (e.preventDefault(), e.stopPropagation())
    if (k === 'Tab' && !e.shiftKey) (handled(), ops.cycle(h))
    else if (k === 'Enter' && (e.ctrlKey || e.metaKey) && e.shiftKey) (handled(), actions.child())
    else if (k === 'Enter' && (e.ctrlKey || e.metaKey)) (handled(), actions.sibling())
    else if (k === 'F2') (handled(), setTitleEdit(h.title))
    else if (k === 'Escape' && ops.narrowed) (handled(), ops.setNarrow(undefined))
    else if (k === 'Enter') (handled(), ops.setEditing(h.line))
    else if (e.altKey && k === 'ArrowUp') (handled(), actions.move(-1))
    else if (e.altKey && k === 'ArrowDown') (handled(), actions.move(1))
    else if (e.altKey && k === 'ArrowLeft') (handled(), actions.level(-1))
    else if (e.altKey && k === 'ArrowRight') (handled(), actions.level(1))
    else if (e.shiftKey && k === 'ArrowRight') (handled(), actions.keyword(E.nextKeyword(doc, h.keyword, 1)))
    else if (e.shiftKey && k === 'ArrowLeft') (handled(), actions.keyword(E.nextKeyword(doc, h.keyword, -1)))
    else if (e.shiftKey && k === 'ArrowUp') (handled(), actions.priority(1))
    else if (e.shiftKey && k === 'ArrowDown') (handled(), actions.priority(-1))
    else if (k === 'ArrowUp') (handled(), nav(-1))
    else if (k === 'ArrowDown') (handled(), nav(1))
    else if (e.ctrlKey || e.metaKey || e.altKey) return
    else if (k === 't') (handled(), actions.pickKeyword())
    else if (k === 's') (handled(), actions.schedule())
    else if (k === 'd') (handled(), actions.deadline())
    else if (k === 'q') (handled(), actions.tags())
    else if (k === 'p') (handled(), actions.props())
    else if (k === 'i') (handled(), app.clockIn(path, h.line))
    else if (k === 'o') (handled(), app.clockOut())
    else if (k === 'w') (handled(), app.refile(path, h.line))
    else if (k === '$') (handled(), app.archive(path, h.line))
    else if (k === 'n') (handled(), ops.setNarrow(h.key))
    else if (k === 'Delete') (handled(), actions.remove())
  }

  const linkOpts = { onLink: (t: string) => app.openLink(t, path) }

  return (
    <div className={`hl-row ${h.done ? 'done' : ''} ${running ? 'running' : ''}`} tabIndex={0} data-line={h.line} onKeyDown={onKey}>
      <div className="hl-main">
        <button className={`caret ${fold !== 'folded' ? 'open' : ''} ${hasBody ? '' : 'empty'}`} onClick={() => ops.cycle(h)} tabIndex={-1} aria-label="Dobrar">
          <ChevronRight size={16} />
        </button>
        <select
          className={`kw ${h.keyword ? (h.done ? 'kw-done' : 'kw-todo') : 'kw-none'} kw-${(h.keyword ?? '').toLowerCase()}`}
          value={h.keyword ?? ''}
          onChange={(e) => actions.keyword(e.target.value || undefined)}
          tabIndex={-1}
          title="Estado (t)"
        >
          <option value="">{h.keyword ? '—' : '○'}</option>
          {[...doc.todo.todo, ...doc.todo.done].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        {h.priority && <button className={`prio prio-${h.priority}`} onClick={() => actions.priority(1)} tabIndex={-1}>{h.priority}</button>}
        {titleEdit !== null ? (
          <input
            className="title-input"
            autoFocus
            value={titleEdit}
            onChange={(e) => setTitleEdit(e.target.value)}
            onFocus={() => (titleCancelled.current = false)}
            onBlur={() => {
              if (titleCancelled.current) return
              if (titleEdit !== h.title) edit((t) => E.setTitle(t, h.line, titleEdit.trim()), { ...h, title: titleEdit.trim() })
              else ops.focusLater(h)
              setTitleEdit(null)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') ((titleCancelled.current = true), setTitleEdit(null), ops.focusLater(h))
            }}
          />
        ) : (
          <span className="title" onDoubleClick={() => setTitleEdit(h.title)} onClick={() => fold === 'folded' && hasBody && ops.cycle(h)}>
            {h.title ? <Inline text={h.title} opts={linkOpts} /> : <i className="muted">(sem título)</i>}
          </span>
        )}
        <span className="hl-meta">
          {h.properties.Effort && <span className="badge" title="Esforço estimado">≈ {h.properties.Effort}</span>}
          {clocked > 0 && <span className="badge" title="Tempo registado">⏱ {formatDuration(clocked)}</span>}
          {h.tags.map((t) => <span key={t} className="tag">{t}</span>)}
        </span>
        <span className="hl-actions">
          <IconBtn title="Agendar (s)" onClick={actions.schedule}><CalendarClock size={16} /></IconBtn>
          <IconBtn title="Prazo (d)" onClick={actions.deadline}><AlarmClock size={16} /></IconBtn>
          <IconBtn title="Etiquetas (q)" onClick={actions.tags}><Tag size={16} /></IconBtn>
          <IconBtn title={running ? 'Parar relógio (o)' : 'Iniciar relógio (i)'} onClick={actions.clock}>{running ? <Square size={16} /> : <Play size={16} />}</IconBtn>
          <IconBtn title="Adicionar subtítulo (Ctrl+Shift+Enter)" onClick={actions.child}><Plus size={16} /></IconBtn>
          <Menu>
            <MenuItem icon={<Pencil size={15} />} label="Editar texto" hint="Enter" onClick={() => ops.setEditing(h.line)} />
            <MenuItem icon={<Pencil size={15} />} label="Editar título" hint="F2" onClick={() => setTitleEdit(h.title)} />
            <MenuItem icon={<CheckCircle2 size={15} />} label="Mudar estado" hint="t" onClick={actions.pickKeyword} />
            <MenuItem icon={<Plus size={15} />} label="Novo título irmão" hint="Ctrl+Enter" onClick={actions.sibling} />
            <MenuItem icon={<Settings2 size={15} />} label="Propriedades" hint="p" onClick={actions.props} />
            <MenuItem icon={<ArrowUp size={15} />} label="Mover para cima" hint="Alt+↑" onClick={() => actions.move(-1)} />
            <MenuItem icon={<ArrowDown size={15} />} label="Mover para baixo" hint="Alt+↓" onClick={() => actions.move(1)} />
            <MenuItem icon={<ArrowLeft size={15} />} label="Promover" hint="Alt+←" onClick={() => actions.level(-1)} />
            <MenuItem icon={<ArrowRight size={15} />} label="Despromover" hint="Alt+→" onClick={() => actions.level(1)} />
            <MenuItem icon={<CornerDownRight size={15} />} label="Mover para… (refile)" hint="w" onClick={() => app.refile(path, h.line)} />
            <MenuItem icon={<Archive size={15} />} label="Arquivar" hint="$" onClick={() => app.archive(path, h.line)} />
            <MenuItem icon={<Focus size={15} />} label="Focar subárvore" hint="n" onClick={() => ops.setNarrow(h.key)} />
            <MenuItem icon={<Trash2 size={15} />} label="Apagar" hint="Del" danger onClick={actions.remove} />
          </Menu>
        </span>
      </div>
      <Planning h={h} onSchedule={actions.schedule} onDeadline={actions.deadline} />
    </div>
  )
}

function Planning({ h, onSchedule, onDeadline }: { h: Headline; onSchedule: () => void; onDeadline: () => void }) {
  const { scheduled, deadline, closed } = h.planning
  if (!scheduled && !deadline && !closed) return null
  const today = dateKey(new Date())
  const label = (ts: Timestamp) => (
    <>
      {formatDate(ts.date)}{ts.time ? ' ' + ts.time : ''}
      {ts.repeater && <><Repeat size={11} />{`${ts.repeater.type}${ts.repeater.n}${ts.repeater.unit}`}</>}
    </>
  )
  const dlState = deadline && !h.done ? (deadline.date < today ? 'overdue' : daysBetween(today, deadline.date) <= warningDays(deadline) ? 'soon' : '') : ''
  return (
    <div className="planning">
      {deadline && <button className={`plan deadline ${dlState}`} onClick={onDeadline} tabIndex={-1}><AlarmClock size={13} /> {label(deadline)}</button>}
      {scheduled && <button className={`plan scheduled ${!h.done && scheduled.date < today ? 'overdue' : ''}`} onClick={onSchedule} tabIndex={-1}><CalendarClock size={13} /> {label(scheduled)}</button>}
      {closed && <span className="plan closed">✓ {label(closed)}</span>}
    </div>
  )
}

function Body({ h, ops }: { h: Headline; ops: NodeOps }) {
  const app = useApp()
  const blocks = useMemo(() => sectionBlocks(ops.doc, h), [ops.doc, h])
  const props = Object.entries(h.properties)
  const logbook = h.logbookRange && ops.doc.lines.slice(h.logbookRange[0] + 1, h.logbookRange[1]).join('\n')
  if (!blocks.length && !props.length && !logbook) return null
  return (
    <div className="body" onDoubleClick={(e) => (e.target as HTMLElement).closest('a,button,input,select') || ops.setEditing(h.line)}>
      {props.length > 0 && <Drawer name={`Propriedades (${props.length})`} content={props.map(([k, v]) => `${k}: ${v}`).join('\n')} />}
      {logbook && <Drawer name="Registo (LOGBOOK)" content={logbook} />}
      <Blocks blocks={blocks} opts={{ onCheckbox: (l) => ops.edit((t) => E.toggleCheckbox(t, l)), onLink: (t) => app.openLink(t, ops.path) }} />
    </div>
  )
}

function EntryEditor({ initial, onDone }: { initial: string; onDone: (text?: string) => void }) {
  const [text, setText] = useState(initial)
  const done = useRef(false)
  const finish = (v?: string) => {
    if (done.current) return
    done.current = true
    onDone(v === initial ? undefined : v)
  }
  return (
    <div className="entry-editor">
      <OrgTextarea
        autoFocus
        autoGrow
        value={text}
        onChange={setText}
        onBlur={() => finish(text)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') (e.preventDefault(), finish(undefined))
          if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || (e.key === 's' && (e.ctrlKey || e.metaKey))) (e.preventDefault(), finish(text))
        }}
      />
      <div className="hint">Ctrl+Enter para guardar · Esc para cancelar · Tab alinha tabelas · Alt+Enter novo item</div>
    </div>
  )
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return <button className="icon-btn" title={title} aria-label={title} tabIndex={-1} onClick={(e) => (e.stopPropagation(), onClick())}>{children}</button>
}

export function Menu({ children, icon = <MoreHorizontal size={16} />, label = 'Mais' }: { children: ReactNode; icon?: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => ref.current?.contains(e.target as Node) || setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="menu" ref={ref}>
      <button className="icon-btn" title={label} aria-label={label} tabIndex={-1} onClick={() => setOpen(!open)}>{icon}</button>
      {open && <div className="menu-pop" onClick={() => setOpen(false)}>{children}</div>}
    </div>
  )
}

export function MenuItem({ icon, label, hint, onClick, danger }: { icon?: ReactNode; label: string; hint?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className={`menu-item ${danger ? 'danger' : ''}`} onClick={onClick}>
      {icon}<span>{label}</span>{hint && <kbd>{hint}</kbd>}
    </button>
  )
}
