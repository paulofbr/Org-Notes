import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { parseOrg, type OrgDoc } from './org/parser'

export type SaveState = 'saved' | 'saving' | 'error'

/** Loads every .org file, keeps them in memory, autosaves edits and keeps an undo history. */
export function useOrgStore() {
  const [files, setFiles] = useState<Record<string, string>>({})
  const [folders, setFolders] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const timers = useRef(new Map<string, number>())
  const latest = useRef(files)
  latest.current = files
  const history = useRef<{ undo: [string, string][]; redo: [string, string][] }>({ undo: [], redo: [] })
  const cache = useRef(new Map<string, { text: string; doc: OrgDoc }>())

  const loadAll = useCallback(async () => {
    const [list, dirs] = await Promise.all([api.list(), api.folders()])
    const texts = await Promise.all(list.map((f) => api.read(f.path)))
    setFolders(dirs)
    setFiles((prev) => {
      const next: Record<string, string> = {}
      list.forEach((f, i) => (next[f.path] = timers.current.has(f.path) ? prev[f.path] : texts[i]))
      for (const p of timers.current.keys()) if (prev[p] !== undefined) next[p] = prev[p]
      latest.current = next
      return next
    })
    setLoaded(true)
  }, [])

  useEffect(() => {
    loadAll().catch(() => setSaveState('error'))
    // Pick up edits made elsewhere (e.g. Emacs) when the tab regains focus.
    const onFocus = () => loadAll().catch(() => {})
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadAll])

  const scheduleSave = useCallback((path: string) => {
    clearTimeout(timers.current.get(path))
    setSaveState('saving')
    timers.current.set(
      path,
      window.setTimeout(async () => {
        try {
          await api.write(path, latest.current[path] ?? '')
          timers.current.delete(path)
          if (!timers.current.size) setSaveState('saved')
        } catch {
          setSaveState('error')
        }
      }, 500),
    )
  }, [])

  const update = useCallback(
    (path: string, text: string) => {
      const prev = latest.current[path]
      if (prev === text) return
      if (prev !== undefined) {
        history.current.undo.push([path, prev])
        if (history.current.undo.length > 200) history.current.undo.shift()
        history.current.redo = []
      }
      latest.current = { ...latest.current, [path]: text }
      setFiles(latest.current)
      scheduleSave(path)
    },
    [scheduleSave],
  )

  const travel = useCallback(
    (from: 'undo' | 'redo') => {
      const entry = history.current[from].pop()
      if (!entry) return undefined
      const [path, text] = entry
      history.current[from === 'undo' ? 'redo' : 'undo'].push([path, latest.current[path] ?? ''])
      latest.current = { ...latest.current, [path]: text }
      setFiles(latest.current)
      scheduleSave(path)
      return path
    },
    [scheduleSave],
  )

  /** Applies `fn` to the latest text of a file, so consecutive edits never see stale state. */
  const apply = useCallback((path: string, fn: (text: string) => string) => update(path, fn(latest.current[path] ?? '')), [update])
  const get = useCallback((path: string) => latest.current[path], [])

  const remove = useCallback(async (path: string) => {
    clearTimeout(timers.current.get(path))
    timers.current.delete(path)
    await api.remove(path)
    const { [path]: _, ...rest } = latest.current
    latest.current = rest
    setFiles(rest)
  }, [])

  const rename = useCallback(async (from: string, to: string) => {
    await api.rename(from, to)
    const { [from]: text, ...rest } = latest.current
    latest.current = { ...rest, [to]: text }
    setFiles(latest.current)
  }, [])

  const createFolder = useCallback(async (path: string) => {
    await api.createFolder(path)
    setFolders(await api.folders())
  }, [])

  const removeFolder = useCallback(async (path: string) => {
    await api.removeFolder(path)
    setFolders(await api.folders())
  }, [])

  const docs = useMemo(() => {
    const out: Record<string, OrgDoc> = {}
    for (const [path, text] of Object.entries(files)) {
      let c = cache.current.get(path)
      if (!c || c.text !== text) cache.current.set(path, (c = { text, doc: parseOrg(text) }))
      out[path] = c.doc
    }
    return out
  }, [files])

  return { files, folders, docs, loaded, saveState, update, apply, get, remove, rename, createFolder, removeFolder, undo: () => travel('undo'), redo: () => travel('redo') }
}

export type OrgStore = ReturnType<typeof useOrgStore>
