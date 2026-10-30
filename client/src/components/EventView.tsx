import { useMemo, useState } from 'react'
import { useApp } from '../context'
import { agenda, type AgendaItem, type Entry } from '../org/agenda'
import { dateKey } from '../org/timestamp'
import { EntryFormDialog } from './EntryForm'
import { Modal } from './Dialogs'
import { Inline, formatDate } from './Inline'
import { KIND_LABEL } from './Agenda'
import { tr } from '../i18n'

/**
 * What a reminder is about (its `view`, see the server's Reminder.View): the day's agenda (`list=yyyy-MM-dd`, the daily
 * summary) or one entry (`path=…&line=…&title=…`). Listed; each one opens in its edit form, read only, over the list.
 * `canOpen` lets that form go to the entry in its file (not in the desktop app's window, which shows only this).
 * `direct` (the app's "Ver") shows a single entry's form at once, without the list.
 */
export function EventDialog({ view, canOpen = true, direct }: { view: string; canOpen?: boolean; direct?: boolean }) {
  const app = useApp()
  const [opened, setOpened] = useState<Entry>()
  const q = new URLSearchParams(view)
  const day = q.get('list')
  const rows = useMemo((): (Entry & { item?: AgendaItem })[] => {
    if (day) return (agenda(app.store.docs, day, day, dateKey(new Date())).get(day) ?? []).map((it) => ({ ...it, item: it }))
    const path = q.get('path') ?? ''
    const line = Number(q.get('line'))
    const title = q.get('title') ?? ''
    const doc = app.store.docs[path]
    // By its line; if the file changed since the reminder, by its title (the server's has no link syntax, hence includes).
    const atLine = doc?.all.find((x) => x.line === line)
    const byTitle = title ? doc?.all.find((x) => x.title.includes(title)) : undefined
    const h = atLine && (atLine.title.includes(title) || !byTitle) ? atLine : byTitle
    return doc && h ? [{ path, doc, h }] : []
  }, [view, app.store.docs])
  if (direct && !day && rows.length === 1) return <EntryFormDialog path={rows[0].path} line={rows[0].h.line} readOnly canOpen={canOpen} />
  return (
    <Modal title={day ? `${tr('Agenda')} · ${formatDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}` : tr('Evento')}>
      {rows.length ? (
        <div className="reminder-list">
          {rows.map((r) => {
            const ts = r.item?.ts ?? r.h.planning.scheduled ?? r.h.planning.deadline ?? r.h.timestamps[0]
            return (
              <button type="button" key={`${r.path}:${r.h.line}`} className="agenda-row" onClick={() => setOpened(r)} title={tr('Ver o evento')}>
                <span className="time">{ts?.time ?? ''}</span>
                {r.item && <span className="kind">{KIND_LABEL(r.item)}</span>}
                {!day && ts && <span className="kind">{formatDate(ts.date)}</span>}
                {r.h.keyword && <span className={`kw ${r.h.done ? 'kw-done' : 'kw-todo'} kw-${r.h.keyword.toLowerCase()}`}>{r.h.keyword}</span>}
                {/* A link in the title opens the entry too, as the rest of the row does. */}
                <span className="title"><Inline text={r.h.title} opts={{ onLink: () => setOpened(r) }} /></span>
              </button>
            )
          })}
        </div>
      ) : (
        <p className="muted">{day ? tr('Nada na agenda deste dia.') : tr('Este evento já não existe.')}</p>
      )}
      <div className="actions"><button type="button" className="primary" autoFocus onClick={app.closeDialog}>OK</button></div>
      {opened && <EntryFormDialog path={opened.path} line={opened.h.line} readOnly canOpen={canOpen} onClose={() => setOpened(undefined)} />}
    </Modal>
  )
}
