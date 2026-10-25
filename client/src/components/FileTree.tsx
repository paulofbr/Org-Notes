import { useState } from 'react'
import { ChevronDown, ChevronRight, FilePlus, Folder, FolderOpen, Trash2 } from 'lucide-react'
import { FileIcon } from './FileIcon'
import type { OrgStore } from '../store'

const parentOf = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), 0))

/** Folders closed in the sidebar, remembered per browser. */
function useClosedFolders() {
  const [closed, setClosed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('closed-folders') ?? '[]'))
    } catch {
      return new Set()
    }
  })
  const toggle = (dir: string) => {
    const next = new Set(closed)
    if (!next.delete(dir)) next.add(dir)
    setClosed(next)
    try {
      localStorage.setItem('closed-folders', JSON.stringify([...next]))
    } catch {
      // Only a convenience: the folders just start open next time.
    }
  }
  return [closed, toggle] as const
}

/** The sidebar's files as a tree of folders, folders first. */
export function FileTree({ store, active, onOpen, onNewFile }: { store: OrgStore; active?: string; onOpen: (path: string) => void; onNewFile: (dir: string) => void }) {
  const [closed, toggle] = useClosedFolders()
  const files = Object.keys(store.files).sort()
  // Folders come from the server (empty ones too) and from the files' own paths.
  const folders = new Set(store.folders)
  for (const f of files) for (let d = parentOf(f); d; d = parentOf(d)) folders.add(d)
  const openCount = (p: string) => store.docs[p].all.filter((h) => h.keyword && !h.done).length
  const indent = (depth: number) => ({ paddingLeft: `${0.6 + depth * 0.9}rem` })

  const render = (dir: string, depth: number): React.ReactNode[] => [
    ...[...folders].filter((d) => parentOf(d) === dir).sort().map((d) => {
      const open = !closed.has(d)
      const empty = !files.some((f) => f.startsWith(d + '/'))
      return (
        <li key={`d:${d}`}>
          <div className="folder-row">
            <button title={d} style={indent(depth)} onClick={() => toggle(d)}>
              {open ? <ChevronDown size={13} className="chevron" /> : <ChevronRight size={13} className="chevron" />}
              {open ? <FolderOpen size={15} /> : <Folder size={15} />}
              <span className="name">{d.split('/').pop()}</span>
            </button>
            <button className="icon-btn folder-action" title="Novo ficheiro nesta pasta" aria-label="Novo ficheiro nesta pasta" onClick={() => onNewFile(d)}><FilePlus size={14} /></button>
            {empty && (
              <button className="icon-btn folder-action" title="Apagar pasta vazia" aria-label="Apagar pasta vazia" onClick={() => store.removeFolder(d).catch((e) => alert(e.message))}><Trash2 size={14} /></button>
            )}
          </div>
          {open && <ul>{render(d, depth + 1)}</ul>}
        </li>
      )
    }),
    ...files.filter((f) => parentOf(f) === dir).map((p) => (
      <li key={p}>
        <button title={p} style={indent(depth)} className={active === p ? 'active' : ''} onClick={() => onOpen(p)}>
          <FileIcon path={p} icon={store.docs[p]?.keywords.ICON} />
          <span className="name">{p.split('/').pop()!.replace(/\.org$/, '')}</span>
          {openCount(p) > 0 && <span className="count">{openCount(p)}</span>}
        </button>
      </li>
    )),
  ]

  return <ul className="files">{render('', 0)}</ul>
}
