import { useApp } from '../context'
import { EntryFormDialog } from './EntryForm'
import { Modal } from './Dialogs'
import { tr } from '../i18n'

/** The entry a reminder names (`path=…&line=…&title=…`, see the server's Reminder.View). */
export function parseView(view: string) {
  const q = new URLSearchParams(view)
  return { path: q.get('path') ?? '', line: Number(q.get('line')), title: q.get('title') ?? '' }
}

/**
 * A reminder's entry in its edit form, read only until "Editar". `canOpen` adds "Abrir no ficheiro" (not in the
 * desktop app's window, which shows only this).
 */
export function EventDialog({ view, canOpen = true }: { view: string; canOpen?: boolean }) {
  const app = useApp()
  const { path, line, title } = parseView(view)
  const doc = app.store.docs[path]
  // By its line; if the file changed since the reminder, by its title (the server's has no link syntax, hence includes).
  const atLine = doc?.all.find((x) => x.line === line)
  const byTitle = title ? doc?.all.find((x) => x.title.includes(title)) : undefined
  const h = atLine && (atLine.title.includes(title) || !byTitle) ? atLine : byTitle
  if (!h)
    return (
      <Modal title={tr('Evento')}>
        <p className="muted">{tr('Este evento já não existe.')}</p>
        <div className="actions"><button type="button" className="primary" autoFocus onClick={app.closeDialog}>OK</button></div>
      </Modal>
    )
  return <EntryFormDialog path={path} line={h.line} readOnly canOpen={canOpen} />
}
