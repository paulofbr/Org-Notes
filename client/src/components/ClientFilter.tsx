import { useMemo } from 'react'
import { Users } from 'lucide-react'
import { useApp } from '../context'
import { clientKey, clientValues, hasValue } from '../org/clients'
import type { Headline } from '../org/parser'
import { tr } from '../i18n'

/** The chosen client as a headline test, or undefined when no client is chosen. */
export function useClientMatch(): ((h: Headline) => boolean) | undefined {
  const { store, client } = useApp()
  const key = useMemo(() => clientKey(store.files), [store.files])
  return useMemo(() => (key && client ? (h: Headline) => hasValue(h, key, client) : undefined), [key, client])
}

/** Picks the client to show, shared by the notes and the agenda; hidden when no template has a client field. */
export function ClientFilter() {
  const { store, client, setClient } = useApp()
  const key = useMemo(() => clientKey(store.files), [store.files])
  const values = useMemo(() => (key ? clientValues(key, store.files, store.docs) : []), [key, store.files, store.docs])
  if (!key || (!values.length && !client)) return null
  const label = key.charAt(0) + key.slice(1).toLowerCase()
  return (
    <label className={`client-filter ${client ? 'active' : ''}`} title={tr('Mostrar só um {name}', { name: label.toLowerCase() })}>
      <Users size={15} />
      <select value={client} onChange={(e) => setClient(e.target.value)}>
        <option value="">{label}: {tr('todos')}</option>
        {values.map((v) => <option key={v} value={v}>{v}</option>)}
        {client && !values.includes(client) && <option value={client}>{client}</option>}
      </select>
    </label>
  )
}
