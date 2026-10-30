import { useMemo } from 'react'
import { useApp } from '../context'
import { allTags, sectionBlocks } from '../org/parser'
import { imageSrc } from '../org/links'
import { Modal } from './Dialogs'
import { Blocks } from './Blocks'
import { Inline } from './Inline'
import { tr } from '../i18n'

/** The entry a reminder names (`path=…&line=…&title=…`, see the server's Reminder.View). */
export function parseView(view: string) {
  const q = new URLSearchParams(view)
  return { path: q.get('path') ?? '', line: Number(q.get('line')), title: q.get('title') ?? '' }
}

/**
 * A reminder's entry, read only: its title, dates, properties, tags and notes. "Abrir no ficheiro" goes to it in its
 * file, to edit it (not in the desktop app's window, which shows only this).
 */
export function EventDialog({ view, canOpen = true }: { view: string; canOpen?: boolean }) {
  const app = useApp()
  const { path, line, title } = parseView(view)
  const doc = app.store.docs[path]
  // By its line; if the file changed since the reminder, by its title (the server's has no link syntax, hence includes).
  const atLine = doc?.all.find((x) => x.line === line)
  const byTitle = title ? doc?.all.find((x) => x.title.includes(title)) : undefined
  const h = atLine && (atLine.title.includes(title) || !byTitle) ? atLine : byTitle
  const blocks = useMemo(() => (doc && h ? sectionBlocks(doc, h) : []), [doc, h])
  const opts = { onLink: (t: string) => (app.closeDialog(), app.openLink(t, path)), imageUrl: (t: string) => imageSrc(path, t) }
  const { scheduled, deadline } = h?.planning ?? {}
  const props = Object.entries(h?.properties ?? {}).filter(([, v]) => v)
  const tags = doc && h ? allTags(h, doc) : []
  return (
    <Modal title={tr('Evento')}>
      {!doc || !h ? (
        <p className="muted">{tr('Este evento já não existe.')}</p>
      ) : (
        <div className="event-view">
          <h3>
            {h.keyword && <span className={`kw ${h.done ? 'kw-done' : 'kw-todo'} kw-${h.keyword.toLowerCase()}`}>{h.keyword}</span>} <Inline text={h.title} opts={opts} />
          </h3>
          {scheduled?.raw && <div><span className="muted">{tr('Agendado')}:</span> <Inline text={scheduled.raw} /></div>}
          {deadline?.raw && <div><span className="muted">{tr('Prazo')}:</span> <Inline text={deadline.raw} /></div>}
          {props.map(([k, v]) => <div key={k}><span className="muted">{k.charAt(0) + k.slice(1).toLowerCase()}:</span> {v}</div>)}
          {tags.length > 0 && <div className="tags">{tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>}
          {blocks.length > 0 && <div className="body"><Blocks blocks={blocks} opts={opts} /></div>}
          <div className="muted crumb">{path}</div>
        </div>
      )}
      <div className="actions">
        {canOpen && doc && h && <button type="button" onClick={() => (app.closeDialog(), app.open(path, h.line))}>{tr('Abrir no ficheiro')}</button>}
        <button type="button" className="primary" autoFocus onClick={app.closeDialog}>OK</button>
      </div>
    </Modal>
  )
}
