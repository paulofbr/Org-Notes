import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Code2, Download, FileText, ListTree, Pencil, Printer, Search, Trash2, Layers } from 'lucide-react'
import { useApp, type AppCtx } from '../context'
import { isTyping } from '../shortcuts'
import { Outline, Menu, MenuItem, type OutlineState, type Visibility } from './Outline'
import { OrgTextarea } from './OrgTextarea'
import { PromptDialog } from './Dialogs'

const states = new Map<string, OutlineState>()
const VIS_ORDER: Visibility[] = ['overview', 'contents', 'showall']
const VIS_LABEL: Record<Visibility, string> = { overview: 'Visão geral', contents: 'Conteúdos', showall: 'Tudo' }

/** File-level commands, shared by the file menu and the command palette. */
export function fileActions(app: AppCtx, path: string, onRemoved: () => void): { label: string; icon: ReactNode; run: () => void; danger?: boolean }[] {
  const { store } = app
  const doc = store.docs[path]
  const title = doc?.keywords.TITLE || path.replace(/\.org$/, '')
  return [
    { label: 'Exportar HTML', icon: <Download size={15} />, run: () => import('../export').then((x) => x.download(path.replace(/\.org$/, '.html').split('/').pop()!, x.exportHtml(doc, title), 'text/html')) },
    { label: 'Descarregar .org', icon: <FileText size={15} />, run: () => import('../export').then((x) => x.download(path.split('/').pop()!, store.get(path) ?? '', 'text/plain')) },
    { label: 'Imprimir / PDF', icon: <Printer size={15} />, run: () => window.print() },
    {
      label: 'Mudar nome do ficheiro',
      icon: <Pencil size={15} />,
      run: () =>
        app.showDialog(
          <PromptDialog title="Mudar nome" label="Novo nome" initial={path} onSubmit={(v) => {
            const to = v.endsWith('.org') ? v : `${v}.org`
            if (to !== path) store.rename(path, to).then(() => app.open(to), (e) => alert(e.message))
          }} />,
        ),
    },
    { label: 'Apagar ficheiro', icon: <Trash2 size={15} />, danger: true, run: () => confirm(`Apagar ${path}?`) && store.remove(path).then(onRemoved) },
  ]
}

export function DocView({ path, focus, onRemoved }: { path: string; focus?: { line: number }; onRemoved: () => void }) {
  const app = useApp()
  const { store } = app
  const doc = store.docs[path]
  const [mode, setMode] = useState<'outline' | 'source'>('outline')
  const [filter, setFilter] = useState('')
  const [narrow, setNarrow] = useState<string>()
  const [, force] = useState(0)
  const filterRef = useRef<HTMLInputElement>(null)
  const sourceRef = useRef<HTMLDivElement>(null)

  const startup = doc?.startup ?? ''
  const initialVis: Visibility = /\b(overview|fold)\b/.test(startup) ? 'overview' : /\bcontent\b/.test(startup) ? 'contents' : 'showall'
  const state = states.get(path) ?? { visibility: initialVis, folds: new Map() }
  const setState = (s: OutlineState) => (states.set(path, s), force((n) => n + 1))
  const cycleVisibility = () => setState({ visibility: VIS_ORDER[(VIS_ORDER.indexOf(state.visibility) + 1) % 3], folds: new Map() })
  const toggleMode = () => setMode(mode === 'outline' ? 'source' : 'outline')

  useEffect(() => {
    if (mode === 'source') sourceRef.current?.querySelector('textarea')?.focus()
  }, [mode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || document.querySelector('.modal') || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Tab' && e.shiftKey && mode === 'outline') (e.preventDefault(), cycleVisibility())
      else if (e.key === 'm') (e.preventDefault(), toggleMode())
      else if (e.key === 'f' && mode === 'outline') (e.preventDefault(), filterRef.current?.focus())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!doc) return <div className="empty">Ficheiro não encontrado</div>
  const title = doc.keywords.TITLE || path.replace(/\.org$/, '')

  return (
    <div className="docview">
      <header className="doc-header">
        <div className="doc-title">
          <h1>{title}</h1>
          <span className="muted">{path}</span>
        </div>
        <div className="toolbar">
          {mode === 'outline' && (
            <>
              <div className="filter">
                <Search size={15} />
                <input
                  ref={filterRef}
                  placeholder="Filtrar (texto ou +etiqueta)"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') (setFilter(''), e.currentTarget.blur())
                    if (e.key === 'Enter' || e.key === 'ArrowDown') (e.preventDefault(), document.querySelector<HTMLElement>('.content .hl-row')?.focus())
                  }}
                />
                <kbd className="in-input">f</kbd>
              </div>
              <button onClick={cycleVisibility} title="Visibilidade global"><Layers size={15} /> {VIS_LABEL[state.visibility]} <kbd>Shift+Tab</kbd></button>
            </>
          )}
          <div className="segmented" title="Alternar com m">
            <button className={mode === 'outline' ? 'active' : ''} onClick={() => setMode('outline')}><ListTree size={15} /> Estrutura</button>
            <button className={mode === 'source' ? 'active' : ''} onClick={() => setMode('source')}><Code2 size={15} /> Texto <kbd>m</kbd></button>
          </div>
          <Menu label="Ficheiro (também em Ctrl+K)">
            {fileActions(app, path, onRemoved).map((a) => <MenuItem key={a.label} icon={a.icon} label={a.label} danger={a.danger} onClick={a.run} />)}
          </Menu>
        </div>
      </header>
      {mode === 'outline' ? (
        <Outline path={path} doc={doc} state={state} setState={setState} filter={filter} narrow={narrow} setNarrow={setNarrow} focus={focus} />
      ) : (
        <div ref={sourceRef}>
          <OrgTextarea
            className="source"
            value={store.files[path]}
            onChange={(t) => store.update(path, t)}
            onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), setMode('outline'))}
          />
        </div>
      )}
    </div>
  )
}
