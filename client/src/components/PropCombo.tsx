import { useId, useMemo, useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { useApp } from '../context'
import { fieldOptions, optionSource } from '../org/capture'
import { addOption, findOption, optionText, replaceOption } from '../org/clients'
import { OrgTextarea } from './OrgTextarea'
import { tr } from '../i18n'

/**
 * A property field of a capture template, offering its values. When they come from another file
 * (`#+PROPERTY: CLIENTE_FROM contacts.org`), a button adds the name typed as a new entry there, or, for a name that is
 * already there, edits that entry right below the field, without leaving the capture.
 */
export function PropCombo({ file, name, value, onChange }: { file: string; name: string; value: string; onChange: (v: string) => void }) {
  const { store } = useApp()
  const id = useId()
  const options = useMemo(() => fieldOptions(file, store.files)[name.toUpperCase()], [file, name, store.files])
  const source = useMemo(() => optionSource(file, store.files, name), [file, name, store.files])
  const [editing, setEditing] = useState<string>()
  const [error, setError] = useState('')
  const typed = value.trim()
  const doc = source ? store.docs[source] : undefined
  const existing = typed ? findOption(doc, typed) : undefined

  const add = () => source && typed && store.apply(source, (t) => addOption(t, typed))
  const edit = () => {
    if (!doc || !existing) return
    setError('')
    setEditing(editing === undefined ? optionText(doc, existing) : undefined)
  }
  const save = () => {
    if (!source || editing === undefined) return
    try {
      let title: string | undefined
      store.apply(source, (t) => {
        const r = replaceOption(t, typed, editing)
        title = r.title
        return r.text
      })
      // Renamed there: the field follows, so it still names the same entry.
      if (title && title !== typed) onChange(title)
      setEditing(undefined)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="field">
      <label htmlFor={id}>{name.charAt(0) + name.slice(1).toLowerCase()}</label>
      <div className="combo">
        <input id={id} value={value} list={options && `${id}-opts`} onChange={(e) => (onChange(e.target.value), setEditing(undefined))} />
        {source && typed && (existing ? (
          <button type="button" className={editing !== undefined ? 'active' : ''} title={tr('Editar «{name}» em {file}', { name: typed, file: source })} onClick={edit}>
            <Pencil size={14} /> {tr('Editar')}
          </button>
        ) : (
          <button type="button" title={tr('Adicionar «{name}» a {file}', { name: typed, file: source })} onClick={add}>
            <Plus size={14} /> {tr('Adicionar')}
          </button>
        ))}
      </div>
      {options && <datalist id={`${id}-opts`}>{options.map((o) => <option key={o} value={o} />)}</datalist>}
      {editing !== undefined && source && (
        <div
          className="combo-edit"
          onKeyDown={(e) => {
            // Inside the capture: Ctrl+Enter saves this entry and Escape closes only this editor.
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.preventDefault(), e.stopPropagation(), save())
            else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), setEditing(undefined))
          }}
        >
          <OrgTextarea value={editing} onChange={setEditing} rows={6} path={source} autoFocus />
          {error && <p className="hint">{error}</p>}
          <div className="actions">
            <button type="button" onClick={() => setEditing(undefined)}>{tr('Cancelar')}</button>
            <button type="button" className="primary" onClick={save}>{tr('Guardar')} <kbd>Ctrl+Enter</kbd></button>
          </div>
        </div>
      )}
    </div>
  )
}
