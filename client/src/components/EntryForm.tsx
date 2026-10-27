import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../context'
import { formFields, formValues, saveForm, templateFor, type EntryFormValues } from '../org/entryForm'
import { Modal } from './Dialogs'
import { OrgTextarea } from './OrgTextarea'
import { PropCombo } from './PropCombo'
import { TagPicker } from './TagPicker'
import { TitleInput } from './TitleInput'
import { tr } from '../i18n'

/**
 * Edits an existing entry (a contact, a client…) with the same form its file's capture template asks for, filled in
 * with its data. Shown as the app's dialog, or, with `onClose`, stacked over another dialog (the capture that opened it).
 */
export function EntryFormDialog({ path, line, onClose, onSaved }: { path: string; line: number; onClose?: () => void; onSaved?: (title: string) => void }) {
  const { store, closeDialog } = useApp()
  const close = onClose ?? closeDialog
  // The entry and its form as they were when opened; later changes to the file don't reset what is being typed.
  const [initial] = useState(() => {
    const doc = store.docs[path]
    const h = doc?.all.find((x) => x.line === line)
    if (!doc || !h) return undefined
    const fields = formFields(templateFor(path, store.files[path] ?? '', h), h)
    return { fields, values: formValues(doc, h, fields) }
  })
  const [v, setV] = useState<EntryFormValues | undefined>(initial?.values)
  const [error, setError] = useState('')
  const set = (patch: Partial<EntryFormValues>) => setV((x) => x && { ...x, ...patch })
  const changed = useMemo(() => JSON.stringify(v) !== JSON.stringify(initial?.values), [v, initial])

  const save = () => {
    if (!v || !v.title.trim()) return
    try {
      if (changed) store.apply(path, (t) => saveForm(t, line, v))
      onSaved?.(v.title.trim())
      close()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const dialog = (
    <Modal title={initial ? tr('Editar «{name}»', { name: initial.values.title }) : tr('Editar')} onClose={close}>
      {!v || !initial ? (
        <>
          <p>{tr('A entrada já não existe')}</p>
          <div className="actions"><button className="primary" onClick={close}>OK</button></div>
        </>
      ) : (
        <form
          onSubmit={(e) => (e.preventDefault(), e.stopPropagation(), save())}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.preventDefault(), save())
          }}
        >
          <div className="hint">{path}</div>
          <TitleInput path={path} placeholder={tr('Título')} value={v.title} onChange={(title) => set({ title })} autoFocus />
          {initial.fields.map((k) => (
            <PropCombo key={k} file={path} name={k} value={v.props[k] ?? ''} onChange={(value) => setV((x) => x && { ...x, props: { ...x.props, [k]: value } })} />
          ))}
          <TagPicker value={v.tags} onChange={(tags) => set({ tags })} />
          <OrgTextarea className="capture-body" placeholder={tr('Descrição (opcional): notas, links e imagens…')} value={v.body} onChange={(body) => set({ body })} rows={4} path={path} tools rich />
          {error && <p className="hint">{error}</p>}
          <div className="actions">
            <button type="button" onClick={close}>{tr('Cancelar')}</button>
            <button className="primary" disabled={!v.title.trim()}>{tr('Guardar')} <kbd>Ctrl+Enter</kbd></button>
          </div>
        </form>
      )}
    </Modal>
  )
  // Over another dialog: outside its form (forms can't nest), on top of it.
  return onClose ? createPortal(<div className="stacked-dialog">{dialog}</div>, document.body) : dialog
}
