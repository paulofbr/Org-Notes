import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Code2, Download, Inbox, FileText, ListTree, Pencil, Printer, Search, Trash2, Layers } from 'lucide-react'
import { useApp, type AppCtx } from '../context'
import { isTyping } from '../shortcuts'
import { Outline, Menu, MenuItem, type OutlineState, type Visibility } from './Outline'
import { OrgTextarea } from './OrgTextarea'
import { PromptDialog } from './Dialogs'
import { hideTemplates } from '../org/capture'
import { TemplateDialog } from './Capture'
import { FileIcon, IconDialog } from './FileIcon'
import { tr } from '../i18n'
import { ClientFilter } from './ClientFilter'

const states = new Map<string, OutlineState>()
const VIS_ORDER: Visibility[] = ['overview', 'contents', 'showall']
const VIS_LABEL: Record<Visibility, string> = { overview: tr('Visão geral'), contents: tr('Conteúdos'), showall: tr('Tudo') }

/** File-level commands, shared by the file menu and the command palette. */
export function fileActions(app: AppCtx, path: string, onRemoved: () => void): { label: string; icon: ReactNode; run: () => void; danger?: boolean }[] {
  const { store } = app
  const doc = store.docs[path]
  const title = doc?.keywords.TITLE || path.replace(/\.org$/, '')
  return [
    { label: tr('Exportar HTML'), icon: <Download size={15} />, run: () => import('../export').then((x) => x.download(path.replace(/\.org$/, '.html').split('/').pop()!, x.exportHtml(doc, title), 'text/html')) },
    { label: tr('Descarregar .org'), icon: <FileText size={15} />, run: () => import('../export').then((x) => x.download(path.split('/').pop()!, store.get(path) ?? '', 'text/plain')) },
    { label: tr('Imprimir / PDF'), icon: <Printer size={15} />, run: () => window.print() },
    { label: tr('Template de captura'), icon: <Inbox size={15} />, run: () => app.showDialog(<TemplateDialog path={path} />) },
    { label: tr('Mudar ícone do ficheiro'), icon: <FileIcon path={path} icon={doc?.keywords.ICON} />, run: () => app.showDialog(<IconDialog path={path} />) },
    {
      label: tr('Mudar nome do ficheiro'),
      icon: <Pencil size={15} />,
      run: () =>
        app.showDialog(
          <PromptDialog title={tr('Mudar nome')} label={tr('Novo nome')} initial={path} onSubmit={(v) => {
            const to = v.endsWith('.org') ? v : `${v}.org`
            if (to !== path) store.rename(path, to).then(() => app.open(to), (e) => alert(e.message))
          }} />,
        ),
    },
    { label: tr('Apagar ficheiro'), icon: <Trash2 size={15} />, danger: true, run: () => confirm(tr('Apagar {path}?', { path })) && store.remove(path).then(onRemoved) },
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
  // Capture templates are edited in their own dialog, so the text mode leaves them out.
  const source = hideTemplates(store.files[path] ?? '')

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

  if (!doc) return <div className="empty">{tr('Ficheiro não encontrado')}</div>
  const title = doc.keywords.TITLE || path.replace(/\.org$/, '')

  return (
    <div className="docview">
      <header className="doc-header">
        <div className="doc-title">
          <h1>
            <button className="doc-icon" title={tr('Mudar ícone')} onClick={() => app.showDialog(<IconDialog path={path} />)}><FileIcon path={path} icon={doc.keywords.ICON} size={26} /></button>
            {title}
          </h1>
          <span className="muted">{path}</span>
        </div>
        <div className="toolbar">
          {mode === 'outline' && (
            <>
              <div className="filter">
                <Search size={15} />
                <input
                  ref={filterRef}
                  placeholder={tr('Filtrar (texto ou +etiqueta)')}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') (setFilter(''), e.currentTarget.blur())
                    if (e.key === 'Enter' || e.key === 'ArrowDown') (e.preventDefault(), document.querySelector<HTMLElement>('.content .hl-row')?.focus())
                  }}
                />
                <kbd className="in-input">f</kbd>
              </div>
              <ClientFilter />
              <button onClick={cycleVisibility} title={tr('Visibilidade global')}><Layers size={15} /> {VIS_LABEL[state.visibility]} <kbd>Shift+Tab</kbd></button>
            </>
          )}
          <div className="segmented" title={tr('Alternar com m')}>
            <button className={mode === 'outline' ? 'active' : ''} onClick={() => setMode('outline')}><ListTree size={15} /> {tr('Estrutura')}</button>
            <button className={mode === 'source' ? 'active' : ''} onClick={() => setMode('source')}><Code2 size={15} /> {tr('Texto')} <kbd>m</kbd></button>
          </div>
          <Menu label={tr('Ficheiro (também em Ctrl+K)')}>
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
            value={source.text}
            path={path}
            onChange={(t) => store.update(path, source.restore(t))}
            onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), setMode('outline'))}
          />
        </div>
      )}
    </div>
  )
}
