import { useId, useMemo, useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { useApp } from '../context'
import { fieldOptions, optionSource } from '../org/capture'
import { addOption, findOption } from '../org/clients'
import { EntryFormDialog } from './EntryForm'
import { tr } from '../i18n'

/**
 * A property field of a capture template, offering its values. When they come from another file
 * (`#+PROPERTY: CLIENTE_FROM contacts.org`), a button adds the name typed as a new entry there, or, for a name that is
 * already there, opens that entry's form filled in with its data, over the capture.
 */
export function PropCombo({ file, name, value, onChange }: { file: string; name: string; value: string; onChange: (v: string) => void }) {
  const { store } = useApp()
  const id = useId()
  const options = useMemo(() => fieldOptions(file, store.files)[name.toUpperCase()], [file, name, store.files])
  const source = useMemo(() => optionSource(file, store.files, name), [file, name, store.files])
  const [editing, setEditing] = useState(false)
  const typed = value.trim()
  const doc = source ? store.docs[source] : undefined
  const existing = typed ? findOption(doc, typed) : undefined
  const add = () => source && typed && store.apply(source, (t) => addOption(t, typed))

  return (
    <div className="field">
      <label htmlFor={id}>{name.charAt(0) + name.slice(1).toLowerCase()}</label>
      <div className="combo">
        <input id={id} value={value} list={options && `${id}-opts`} onChange={(e) => onChange(e.target.value)} />
        {source && typed && (existing ? (
          <button type="button" title={tr('Editar «{name}» em {file}', { name: typed, file: source })} onClick={() => setEditing(true)}>
            <Pencil size={14} /> {tr('Editar')}
          </button>
        ) : (
          <button type="button" title={tr('Adicionar «{name}» a {file}', { name: typed, file: source })} onClick={add}>
            <Plus size={14} /> {tr('Adicionar')}
          </button>
        ))}
      </div>
      {options && <datalist id={`${id}-opts`}>{options.map((o) => <option key={o} value={o} />)}</datalist>}
      {editing && source && existing && (
        // The entry's own form (as its file's capture asks for it), over this dialog; a new name follows into the field.
        <EntryFormDialog path={source} line={existing.line} onClose={() => setEditing(false)} onSaved={(title) => title !== typed && onChange(title)} />
      )}
    </div>
  )
}
