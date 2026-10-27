import { useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { useApp } from '../context'
import { orgLink, relativePath } from '../org/links'
import { Modal } from './Dialogs'
import { tr } from '../i18n'

export type LinkTab = 'external' | 'internal' | 'image'

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Uploads an image and returns the org link to it, written relative to file `from`. */
/** Lets the user choose one or more files of their computer. */
export function pickFiles(onPick: (files: File[]) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.onchange = () => input.files?.length && onPick([...input.files])
  input.click()
}

/** Uploads a file as an attachment of note `from` and returns the link to it, described by its name. */
export async function uploadAttachmentLink(from: string, file: File) {
  const { path, name } = await api.uploadAttachment(from, file, file.name)
  return orgLink(`file:${relativePath(from, path)}`, name)
}

export async function uploadImageLink(from: string, file: Blob) {
  const { path } = await api.uploadImage(from, file)
  return orgLink(`file:${relativePath(from, path)}`)
}

const TITLES: Record<LinkTab, string> = { external: tr('Link externo'), internal: tr('Link interno'), image: tr('Inserir imagem') }

/**
 * Builds an org link written in file `path`: to a web page, to another file or heading, or to an uploaded image.
 * With `only`, it shows just that kind of link, without tabs.
 * Rendered with its own `onClose` so it can open on top of another dialog without replacing it.
 */
export function LinkDialog({ path, initialText = '', only, onInsert, onClose }: { path: string; initialText?: string; only?: LinkTab; onInsert: (link: string) => void; onClose: () => void }) {
  const { store } = useApp()
  const [tab, setTab] = useState<LinkTab>(only ?? 'external')
  const [url, setUrl] = useState('')
  const [text, setText] = useState(initialText)
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<{ file: string; heading?: string }>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // Every file and every heading, for the internal link search.
  const targets = useMemo(
    () => Object.keys(store.docs).sort().flatMap((file) => [{ file, heading: undefined as string | undefined }, ...store.docs[file].all.map((h) => ({ file, heading: h.title }))]),
    [store.docs],
  )
  const words = fold(query).split(/\s+/).filter(Boolean)
  const shown = targets.filter((t) => words.every((w) => fold(`${t.file} ${t.heading ?? ''}`).includes(w))).slice(0, 30)

  const done = (link: string) => (onClose(), onInsert(link))
  const insertExternal = () => {
    const u = url.trim()
    if (!u) return
    done(orgLink(/^[a-z][\w+.-]*:/i.test(u) ? u : `https://${u}`, text))
  }
  const insertInternal = () => {
    if (!target) return
    const heading = target.heading && `*${target.heading}`
    // A heading in this same file needs no file name, as in Emacs.
    const link = target.file === path && heading ? heading : `file:${relativePath(path, target.file)}${heading ? `::${heading}` : ''}`
    done(orgLink(link, text || target.heading || target.file.replace(/\.org$/, '').split('/').pop()))
  }
  const insertImage = (file?: File) => {
    if (!file) return
    setBusy(true)
    uploadImageLink(path, file).then(done, (e) => (setError(e instanceof Error ? e.message : String(e)), setBusy(false)))
  }

  return (
    <Modal title={only ? TITLES[only] : tr('Inserir link ou imagem')} onClose={onClose} wide>
      <div className="tabs" hidden={!!only}>
        {([['external', tr('Externo')], ['internal', tr('Interno')], ['image', tr('Imagem')]] as const).map(([t, label]) => (
          <button key={t} type="button" className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>
      {error && <p className="hint">{error}</p>}
      {tab === 'external' && (
        <form onSubmit={(e) => (e.preventDefault(), e.stopPropagation(), insertExternal())}>
          <label>{tr('Endereço')}<input autoFocus placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
          <label>{tr('Texto (opcional)')}<input value={text} onChange={(e) => setText(e.target.value)} /></label>
          <div className="actions">
            <button type="button" onClick={onClose}>{tr('Cancelar')}</button>
            <button className="primary" disabled={!url.trim()}>{tr('Inserir')}</button>
          </div>
        </form>
      )}
      {tab === 'internal' && (
        <form onSubmit={(e) => (e.preventDefault(), e.stopPropagation(), insertInternal())}>
          <label>{tr('Procurar ficheiro ou título')}<input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          <ul className="pick-list link-targets">
            {shown.map((t) => (
              <li key={`${t.file}::${t.heading ?? ''}`}>
                <button type="button" className={target?.file === t.file && target?.heading === t.heading ? 'active' : ''} onClick={() => setTarget(t)}>
                  {t.heading ? <><span className="muted">{t.file.replace(/\.org$/, '')} ›</span> {t.heading}</> : <b>{t.file.replace(/\.org$/, '')}</b>}
                </button>
              </li>
            ))}
          </ul>
          <label>{tr('Texto (opcional)')}<input value={text} onChange={(e) => setText(e.target.value)} /></label>
          <div className="actions">
            <button type="button" onClick={onClose}>{tr('Cancelar')}</button>
            <button className="primary" disabled={!target}>{tr('Inserir')}</button>
          </div>
        </form>
      )}
      {tab === 'image' && (
        <>
          <p className="hint">{tr('PNG, JPEG, GIF ou WebP até 10 MB. Também podes colar')} (<kbd>Ctrl+V</kbd>) {tr('ou arrastar uma imagem para o texto.')}</p>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => insertImage(e.target.files?.[0])} />
          <div className="actions">
            <button type="button" onClick={onClose}>{tr('Cancelar')}</button>
            <button type="button" className="primary" autoFocus disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? tr('A carregar…') : tr('Escolher imagem')}</button>
          </div>
        </>
      )}
    </Modal>
  )
}
