import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pencil, PanelLeftClose, PanelLeftOpen, CalendarDays, Check, Command as CommandIcon, FilePlus, FileText, HelpCircle, Inbox, Loader2, Menu as MenuIcon, Moon, Search, Square, Sun, TriangleAlert } from 'lucide-react'
import { useOrgStore } from './store'
import { Ctx, type AppCtx, type RunningClock } from './context'
import * as E from './org/edit'
import { formatDuration, nowStamp, parseTimestamp, wallMinutes } from './org/timestamp'
import { AgendaView } from './components/Agenda'
import { CaptureDialog } from './components/Capture'
import { CommandPalette, HelpDialog, PromptDialog, RefileDialog, type Command } from './components/Dialogs'
import { DocView, fileActions } from './components/DocView'
import { ShortcutBar } from './components/ShortcutBar'
import { isTyping, moveFocus } from './shortcuts'
import { Inline } from './components/Inline'

type Nav = { view: 'agenda'; tab?: 'week' | 'search' } | { view: 'doc'; path: string; focus?: { line: number } }

export default function App() {
  const store = useOrgStore()
  const [nav, setNav] = useState<Nav>({ view: 'agenda' })
  const [dialog, setDialog] = useState<ReactNode>(null)
  const [sidebar, setSidebar] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar-collapsed') === '1'
    } catch {
      return false
    }
  })
  const toggleCollapsed = () => {
    setCollapsed(!collapsed)
    try {
      localStorage.setItem('sidebar-collapsed', collapsed ? '0' : '1')
    } catch {
      /* ignore */
    }
  }
  const lastFocus = useRef<HTMLElement | null>(null)
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('theme') ?? ''
    } catch {
      return ''
    }
  })

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme
    else delete document.documentElement.dataset.theme
    try {
      localStorage.setItem('theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  const running = useMemo<RunningClock | undefined>(() => {
    for (const [path, doc] of Object.entries(store.docs))
      for (const h of doc.all) {
        const clock = h.clocks.find((c) => !c.end)
        if (clock) return { path, h, clock }
      }
  }, [store.docs])

  const ctx: AppCtx = {
    store,
    running,
    edit: (path, fn) => {
      try {
        store.apply(path, fn)
      } catch (err) {
        alert((err as Error).message)
      }
    },
    open: (path, line) => {
      setNav({ view: 'doc', path, focus: line === undefined ? undefined : { line } })
      setSidebar(false)
    },
    openLink: (target, from) => {
      const m = /^(?:file:)?([^:]*?\.org)?(?:::)?(\*.*|#.*)?$/.exec(target)
      if (!m || (!m[1] && !m[2])) return void window.open(target, '_blank')
      const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : ''
      const path = m[1] ? (store.files[dir + m[1]] !== undefined ? dir + m[1] : m[1]) : from
      const doc = store.docs[path]
      if (!doc) return void alert(`Ficheiro não encontrado: ${path}`)
      const search = m[2]
      const h = search?.startsWith('*')
        ? doc.all.find((x) => x.title.toLowerCase() === search.slice(1).trim().toLowerCase())
        : search?.startsWith('#')
          ? doc.all.find((x) => x.properties.CUSTOM_ID === search.slice(1))
          : undefined
      ctx.open(path, h?.line)
    },
    clockIn: (path, line) => {
      // Only one clock may run at a time.
      if (running) {
        if (running.path === path && running.h.line === line) return
        ctx.clockOut()
      }
      ctx.edit(path, (t) => E.clockIn(t, line))
    },
    clockOut: () => running && ctx.edit(running.path, (t) => E.clockOut(t, running.clock.line)),
    archive: (path, line) => {
      const target = E.archiveName(path)
      try {
        const res = E.archive(store.get(path), line, path, store.get(target) ?? '')
        store.update(path, res.src)
        store.update(target, res.archive)
      } catch (err) {
        alert((err as Error).message)
      }
    },
    refile: (path, line) => ctx.showDialog(<RefileDialog path={path} line={line} />),
    showDialog: (node) => {
      if (!document.querySelector('.modal')) lastFocus.current = document.activeElement as HTMLElement | null
      setDialog(node)
    },
    closeDialog: () => {
      setDialog(null)
      // Give focus back to where the user was (e.g. the headline), unless an edit already moved it.
      setTimeout(() => {
        if (document.activeElement === document.body && lastFocus.current?.isConnected) lastFocus.current.focus()
      })
    },
  }

  const toggleTheme = () =>
    setTheme(document.documentElement.matches('[data-theme="dark"]') || (!theme && matchMedia('(prefers-color-scheme: dark)').matches) ? 'light' : 'dark')

  const commands = (): Command[] => [
    ...Object.keys(store.files).sort().map((p) => ({ label: `Abrir ${p}`, run: () => ctx.open(p) })),
    { label: 'Agenda', hint: 'a', run: () => setNav({ view: 'agenda' }) },
    { label: 'Procurar', hint: '/', run: () => setNav({ view: 'agenda', tab: 'search' }) },
    { label: 'Capturar', hint: 'c', run: () => ctx.showDialog(<CaptureDialog />) },
    { label: 'Novo ficheiro', run: newFile },
    ...(nav.view === 'doc' ? fileActions(ctx, nav.path, () => setNav({ view: 'agenda' })).map((a) => ({ label: a.label, run: a.run })) : []),
    ...(running ? [{ label: `Parar relógio: ${running.h.title}`, hint: 'o', run: ctx.clockOut }] : []),
    { label: 'Desfazer', hint: 'Ctrl+Z', run: () => store.undo() },
    { label: 'Refazer', hint: 'Ctrl+Y', run: () => store.redo() },
    { label: 'Alternar tema claro/escuro', run: toggleTheme },
    { label: collapsed ? 'Expandir menu lateral' : 'Minimizar menu lateral', hint: '[', run: toggleCollapsed },
    { label: 'Ver todos os atalhos', hint: '?', run: () => ctx.showDialog(<HelpDialog />) },
  ]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTyping(e.target)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (!document.querySelector('.modal')) ctx.showDialog(<CommandPalette commands={commands()} />)
        return
      }
      if ((e.ctrlKey || e.metaKey) && !typing && (e.key === 'z' || e.key === 'y' || e.key === 'Z')) {
        e.preventDefault()
        if (e.key === 'z') store.undo()
        else store.redo()
        return
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || dialog || e.defaultPrevented) return
      if (e.key === 'c') (e.preventDefault(), ctx.showDialog(<CaptureDialog />))
      else if ((e.key === 'ArrowDown' || e.key === 'j') && e.target === document.body) (e.preventDefault(), moveFocus(1))
      else if (e.key === 'a') setNav({ view: 'agenda' })
      else if (e.key === '/') (e.preventDefault(), setNav({ view: 'agenda', tab: 'search' }))
      else if (e.key === '?') ctx.showDialog(<HelpDialog />)
      else if (e.key === '[') toggleCollapsed()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function newFile() {
    ctx.showDialog(
      <PromptDialog title="Novo ficheiro" label="Nome (ex: projetos/casa.org)" onSubmit={(v) => {
        const path = (v.trim().endsWith('.org') ? v.trim() : `${v.trim()}.org`).replace(/^\/+/, '')
        if (!v.trim()) return
        if (store.files[path] === undefined) store.update(path, `#+TITLE: ${path.replace(/\.org$/, '').split('/').pop()}\n\n* `)
        ctx.open(path)
      }} />,
    )
  }

  const files = Object.keys(store.files).sort()
  const openCount = (p: string) => store.docs[p].all.filter((h) => h.keyword && !h.done).length

  return (
    <Ctx.Provider value={ctx}>
      <div className={`app ${sidebar ? 'sidebar-open' : ''} ${collapsed ? 'collapsed' : ''}`}>
        <aside className="sidebar">
          <div className="brand">
            <span className="logo">✱</span> <span className="label">Org Notes</span>
            <button className="icon-btn collapse-btn" onClick={toggleCollapsed} title={`${collapsed ? 'Expandir' : 'Minimizar'} menu ([)`} aria-label={collapsed ? 'Expandir menu' : 'Minimizar menu'}>
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>
          <nav>
            <button title="Agenda (a)" className={nav.view === 'agenda' && nav.tab !== 'search' ? 'active' : ''} onClick={() => (setNav({ view: 'agenda' }), setSidebar(false))}>
              <CalendarDays size={16} /> <span className="label">Agenda</span> <kbd>a</kbd>
            </button>
            <button title="Procurar (/)" className={nav.view === 'agenda' && nav.tab === 'search' ? 'active' : ''} onClick={() => (setNav({ view: 'agenda', tab: 'search' }), setSidebar(false))}>
              <Search size={16} /> <span className="label">Procurar</span> <kbd>/</kbd>
            </button>
            <button title="Comandos (Ctrl+K)" onClick={() => (ctx.showDialog(<CommandPalette commands={commands()} />), setSidebar(false))}>
              <CommandIcon size={16} /> <span className="label">Comandos</span> <kbd>Ctrl+K</kbd>
            </button>
          </nav>
          <div className="files-head">
            <span className="label">Ficheiros</span>
            <button className="icon-btn" onClick={newFile} title="Novo ficheiro (também em Ctrl+K)" aria-label="Novo ficheiro"><FilePlus size={16} /></button>
          </div>
          <ul className="files">
            {files.map((p) => (
              <li key={p}>
                <button title={p} className={nav.view === 'doc' && nav.path === p ? 'active' : ''} onClick={() => ctx.open(p)}>
                  {p === 'inbox.org' ? <Inbox size={15} /> : <FileText size={15} />}
                  <span className="name">{p.replace(/\.org$/, '')}</span>
                  {openCount(p) > 0 && <span className="count">{openCount(p)}</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="sidebar-foot">
            <SaveIndicator state={store.saveState} />
            <button className="help-btn" title="Todos os atalhos" onClick={() => ctx.showDialog(<HelpDialog />)}><HelpCircle size={15} /> <kbd>?</kbd></button>
            <button
              className="icon-btn"
              title="Tema"
              aria-label="Tema"
              onClick={toggleTheme}
            >
              <Sun size={16} className="sun" /><Moon size={16} className="moon" />
            </button>
          </div>
        </aside>
        <div className="scrim" onClick={() => setSidebar(false)} />
        <main>
          <div className="topbar">
            <button className="icon-btn hamburger" onClick={() => setSidebar(true)} aria-label="Menu"><MenuIcon size={20} /></button>
            {running && <ClockBar r={running} onOpen={() => ctx.open(running.path, running.h.line)} onStop={ctx.clockOut} />}
          </div>
          <div className="content-wrap">
          <div className="content">
            {!store.loaded ? (
              <div className="empty"><Loader2 className="spin" /> A carregar…</div>
            ) : nav.view === 'agenda' ? (
              <AgendaView key={nav.tab ?? 'week'} initialTab={nav.tab} />
            ) : (
              <DocView key={nav.path} path={nav.path} focus={nav.focus} onRemoved={() => setNav({ view: 'agenda' })} />
            )}
          </div>
          <button className="fab" onClick={() => ctx.showDialog(<CaptureDialog />)} title="Capturar (c)" aria-label="Capturar">
            <Pencil size={20} /> <span className="fab-label">Capturar</span> <kbd>c</kbd>
          </button>
          </div>
          {store.loaded && !dialog && <ShortcutBar view={nav.view} />}
        </main>
        {dialog}
      </div>
    </Ctx.Provider>
  )
}

function SaveIndicator({ state }: { state: string }) {
  if (state === 'saving') return <span className="save saving"><Loader2 size={14} className="spin" /> <span>A guardar</span></span>
  if (state === 'error') return <span className="save error"><TriangleAlert size={14} /> <span>Erro ao guardar</span></span>
  return <span className="save"><Check size={14} /> <span>Guardado</span></span>
}

function ClockBar({ r, onOpen, onStop }: { r: RunningClock; onOpen: () => void; onStop: () => void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(t)
  }, [])
  const minutes = wallMinutes(r.clock.start, parseTimestamp(nowStamp(true, false, new Date(now)))!)
  return (
    <div className="clockbar">
      <span className="pulse" />
      <button className="link" onClick={onOpen}><Inline text={r.h.title} /></button>
      <span className="elapsed">{formatDuration(minutes)}</span>
      <button className="icon-btn" onClick={onStop} title="Parar relógio" aria-label="Parar relógio"><Square size={15} /></button>
    </div>
  )
}
