import { useMemo } from 'react'
import { Pencil, Tag, Users } from 'lucide-react'
import { useApp } from '../context'
import { clientKey, clientSource, clientValues, findOption, hasValue } from '../org/clients'
import { allTags, type Headline, type OrgDoc } from '../org/parser'
import { knownTags } from '../org/tags'
import { tr } from '../i18n'

/** The chosen client as a headline test, or undefined when no client is chosen. */
export function useClientMatch(): ((h: Headline) => boolean) | undefined {
  const { store, client } = useApp()
  const key = useMemo(() => clientKey(store.files), [store.files])
  return useMemo(() => (key && client ? (h: Headline) => hasValue(h, key, client) : undefined), [key, client])
}

/** The chosen client and tag together, as a test for the lists; undefined when neither is chosen. */
export function useListMatch(): ((h: Headline, doc: OrgDoc) => boolean) | undefined {
  const { tag } = useApp()
  const client = useClientMatch()
  return useMemo(
    () => (client || tag ? (h: Headline, doc: OrgDoc) => (!client || client(h)) && (!tag || allTags(h, doc).includes(tag)) : undefined),
    [client, tag],
  )
}

/** Picks the tag to show (inherited ones and #+FILETAGS count, as in org), shared by the notes and the agenda. */
export function TagFilter() {
  const { store, tag, setTag } = useApp()
  const tags = useMemo(() => knownTags(store.docs), [store.docs])
  if (!tags.length && !tag) return null
  return (
    <label className={`client-filter ${tag ? 'active' : ''}`} title={tr('Mostrar só uma etiqueta')}>
      <Tag size={15} />
      <select value={tag} onChange={(e) => setTag(e.target.value)}>
        <option value="">{tr('Etiqueta')}: {tr('todas')}</option>
        {tags.map((t) => <option key={t} value={t}>{t}</option>)}
        {tag && !tags.includes(tag) && <option value={tag}>{tag}</option>}
      </select>
    </label>
  )
}

/** Picks the client to show, shared by the notes and the agenda; hidden when no template has a client field. */
export function ClientFilter() {
  const { store, client, setClient, open } = useApp()
  const key = useMemo(() => clientKey(store.files), [store.files])
  const values = useMemo(() => (key ? clientValues(key, store.files, store.docs) : []), [key, store.files, store.docs])
  const source = useMemo(() => clientSource(store.files), [store.files])
  if (!key || (!values.length && !client)) return null
  const label = key.charAt(0) + key.slice(1).toLowerCase()
  // The chosen client's own entry (e.g. in the contacts), to go and edit it.
  const entry = client && source?.key === key ? findOption(store.docs[source.file], client) : undefined
  return (
    <span className="client-filter-wrap">
      <label className={`client-filter ${client ? 'active' : ''}`} title={tr('Mostrar só um {name}', { name: label.toLowerCase() })}>
        <Users size={15} />
        <select value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">{label}: {tr('todos')}</option>
          {values.map((v) => <option key={v} value={v}>{v}</option>)}
          {client && !values.includes(client) && <option value={client}>{client}</option>}
        </select>
      </label>
      {entry && source && (
        <button className="icon-btn" title={tr('Editar «{name}» em {file}', { name: client, file: source.file })} onClick={() => open(source.file, entry.line)}>
          <Pencil size={15} />
        </button>
      )}
    </span>
  )
}
