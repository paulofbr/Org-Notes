import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FolderPlus, Bell, Pencil, PanelLeftClose, PanelLeftOpen, CalendarDays, Check, Command as CommandIcon, FilePlus, HelpCircle, Loader2, Menu as MenuIcon, Moon, Search, Square, Sun, TriangleAlert } from 'lucide-react'
import { useOrgStore } from './store'
import { Ctx, type AppCtx, type RunningClock } from './context'
import * as E from './org/edit'
import { formatDuration, nowStamp, parseTimestamp, wallMinutes } from './org/timestamp'
import { AgendaView } from './components/Agenda'
import { CaptureDialog, NewFileDialog } from './components/Capture'
import { saveDrafts } from './org/capture'
import { resolvePath } from './org/links'
import { FileTree } from './components/FileTree'
import { AccountDialog, CommandPalette, HelpDialog, NewFolderDialog, RefileDialog, type Command } from './components/Dialogs'
import { DocView, fileActions } from './components/DocView'
import { ShortcutBar } from './components/ShortcutBar'
import { isTyping, moveFocus } from './shortcuts'
import { Inline } from './components/Inline'
import { LANGS, isLang, lang, rememberLang, tr } from './i18n'
import { api } from './api'

type Nav = { view: 'agenda'; tab?: 'week' | 'search' } | { view: 'doc'; path: string; focus?: { line: number } }

export default function App() {
  const store = useOrgStore()
  const [nav, setNav] = useState<Nav>({ view: 'agenda' })
  const [dialog, setDialog] = useState<ReactNode>(null)
  const [client, setClient] = useState('')
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

  // The language is a user setting: the server's value wins over this browser's, and a user without one gets this browser's.
  useEffect(() => {
    api.me().then(
      (me) => void (isLang(me.lang) ? rememberLang(me.lang) : api.setLang(lang)),
      () => {},
    )
  }, [])

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
    client,
    setClient,
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
      // Relative to the linking file (as Emacs writes them), else from the root.
      const path = m[1] ? (store.files[resolvePath(from, m[1])] !== undefined ? resolvePath(from, m[1]) : m[1]) : from
      const doc = store.docs[path]
      if (!doc) return void alert(tr('Ficheiro não encontrado: {path}', { path }))
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
      const target = E.archiveName()
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
    ...Object.keys(store.files).sort().map((p) => ({ label: tr('Abrir {path}', { path: p }), run: () => ctx.open(p) })),
    { label: tr('Agenda'), hint: 'a', run: () => setNav({ view: 'agenda' }) },
    { label: tr('Procurar'), hint: '/', run: () => setNav({ view: 'agenda', tab: 'search' }) },
    { label: tr('Capturar'), hint: 'c', run: () => ctx.showDialog(<CaptureDialog path={nav.view === 'doc' ? nav.path : undefined} />) },
    { label: tr('Novo ficheiro'), run: () => newFile() },
    { label: tr('Nova pasta'), run: newFolder },
    { label: tr('Conta e notificações'), run: () => ctx.showDialog(<AccountDialog />) },
    ...(nav.view === 'doc' ? fileActions(ctx, nav.path, () => setNav({ view: 'agenda' })).map((a) => ({ label: a.label, run: a.run })) : []),
    ...(running ? [{ label: tr('Parar relógio: {title}', { title: running.h.title }), hint: 'o', run: ctx.clockOut }] : []),
    { label: tr('Desfazer'), hint: 'Ctrl+Z', run: () => store.undo() },
    { label: tr('Refazer'), hint: 'Ctrl+Y', run: () => store.redo() },
    { label: tr('Alternar tema claro/escuro'), run: toggleTheme },
    ...LANGS.filter(([l]) => l !== lang).map(([l, name]) => ({ label: `${tr('Língua')}: ${name}`, run: () => rememberLang(l) })),
    { label: collapsed ? tr('Expandir menu lateral') : tr('Minimizar menu lateral'), hint: '[', run: toggleCollapsed },
    { label: tr('Ver todos os atalhos'), hint: '?', run: () => ctx.showDialog(<HelpDialog />) },
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
      if (e.key === 'c') (e.preventDefault(), ctx.showDialog(<CaptureDialog path={nav.view === 'doc' ? nav.path : undefined} />))
      else if ((e.key === 'ArrowDown' || e.key === 'j') && e.target === document.body) (e.preventDefault(), moveFocus(1))
      else if (e.key === 'a') setNav({ view: 'agenda' })
      else if (e.key === '/') (e.preventDefault(), setNav({ view: 'agenda', tab: 'search' }))
      else if (e.key === '?') ctx.showDialog(<HelpDialog />)
      else if (e.key === '[') toggleCollapsed()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const newFileText = (path: string) => `#+TITLE: ${path.replace(/\.org$/, '').split('/').pop()}\n\n* `

  function newFile(dir?: string) {
    ctx.showDialog(
      <NewFileDialog dir={dir} onSubmit={(name, template) => {
        const path = (name.endsWith('.org') ? name : `${name}.org`).replace(/^\/+/, '')
        if (store.files[path] === undefined) {
          const text = newFileText(path)
          store.update(path, template ? saveDrafts(text, [template]) : text)
        }
        ctx.open(path)
      }} />,
    )
  }

  function newFolder() {
    ctx.showDialog(
      <NewFolderDialog onSubmit={(name, files) => {
        const path = name.trim().replace(/^\/+|\/+$/g, '')
        if (!path) return
        store.createFolder(path).then(() => {
          for (const f of files.map((f) => `${path}/${f}.org`)) if (store.files[f] === undefined) store.update(f, newFileText(f))
        }).catch((e) => alert(e.message))
      }} />,
    )
  }

  return (
    <Ctx.Provider value={ctx}>
      <div className={`app ${sidebar ? 'sidebar-open' : ''} ${collapsed ? 'collapsed' : ''}`}>
        <aside className="sidebar">
          <div className="brand">
            <span className="logo">✱</span> <span className="label">Org Notes</span>
            <button className="icon-btn collapse-btn" onClick={toggleCollapsed} title={`${collapsed ? tr('Expandir menu') : tr('Minimizar menu')} ([)`} aria-label={collapsed ? tr('Expandir menu') : tr('Minimizar menu')}>
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>
          <nav>
            <button title={`${tr('Agenda')} (a)`} className={nav.view === 'agenda' && nav.tab !== 'search' ? 'active' : ''} onClick={() => (setNav({ view: 'agenda' }), setSidebar(false))}>
              <CalendarDays size={16} /> <span className="label">{tr('Agenda')}</span> <kbd>a</kbd>
            </button>
            <button title={`${tr('Procurar')} (/)`} className={nav.view === 'agenda' && nav.tab === 'search' ? 'active' : ''} onClick={() => (setNav({ view: 'agenda', tab: 'search' }), setSidebar(false))}>
              <Search size={16} /> <span className="label">{tr('Procurar')}</span> <kbd>/</kbd>
            </button>
            <button title={`${tr('Comandos')} (Ctrl+K)`} onClick={() => (ctx.showDialog(<CommandPalette commands={commands()} />), setSidebar(false))}>
              <CommandIcon size={16} /> <span className="label">{tr('Comandos')}</span> <kbd>Ctrl+K</kbd>
            </button>
          </nav>
          <div className="files-head">
            <span className="label">{tr('Ficheiros')}</span>
            <span className="files-actions">
              <button className="icon-btn" onClick={newFolder} title={tr('Nova pasta (também em Ctrl+K)')} aria-label={tr('Nova pasta')}><FolderPlus size={16} /></button>
              <button className="icon-btn" onClick={() => newFile()} title={tr('Novo ficheiro (também em Ctrl+K)')} aria-label={tr('Novo ficheiro')}><FilePlus size={16} /></button>
            </span>
          </div>
          <FileTree store={store} active={nav.view === 'doc' ? nav.path : undefined} onOpen={ctx.open} onNewFile={newFile} />
          <div className="sidebar-foot">
            <SaveIndicator state={store.saveState} />
            <button className="help-btn" title={tr('Todos os atalhos')} onClick={() => ctx.showDialog(<HelpDialog />)}><HelpCircle size={15} /> <kbd>?</kbd></button>
            <button className="icon-btn" title={tr('Conta e notificações')} aria-label={tr('Conta e notificações')} onClick={() => ctx.showDialog(<AccountDialog />)}><Bell size={16} /></button>
            <button
              className="icon-btn"
              title={tr('Tema')}
              aria-label={tr('Tema')}
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
              <div className="empty"><Loader2 className="spin" /> {tr('A carregar…')}</div>
            ) : nav.view === 'agenda' ? (
              <AgendaView key={nav.tab ?? 'week'} initialTab={nav.tab} />
            ) : (
              <DocView key={nav.path} path={nav.path} focus={nav.focus} onRemoved={() => setNav({ view: 'agenda' })} />
            )}
          </div>
          <button className="fab" onClick={() => ctx.showDialog(<CaptureDialog path={nav.view === 'doc' ? nav.path : undefined} />)} title={`${tr('Capturar')} (c)`} aria-label={tr('Capturar')}>
            <Pencil size={20} /> <span className="fab-label">{tr('Capturar')}</span> <kbd>c</kbd>
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
  if (state === 'saving') return <span className="save saving"><Loader2 size={14} className="spin" /> <span>{tr('A guardar')}</span></span>
  if (state === 'error') return <span className="save error"><TriangleAlert size={14} /> <span>{tr('Erro ao guardar')}</span></span>
  return <span className="save"><Check size={14} /> <span>{tr('Guardado')}</span></span>
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
      <button className="icon-btn" onClick={onStop} title={tr('Parar relógio')} aria-label={tr('Parar relógio')}><Square size={15} /></button>
    </div>
  )
}
