import { parseOrg } from './parser'
import { dateKey, formatTimestamp, nowStamp } from './timestamp'

export interface CaptureTemplate {
  key: string
  name: string
  file: string
  datetree?: boolean
  withDate?: boolean
  build: (title: string, body: string, date?: string, time?: string) => string[]
}

const bodyLines = (body: string) => (body.trim() ? body.trimEnd().split('\n') : [])

export const TEMPLATES: CaptureTemplate[] = [
  {
    key: 't',
    name: 'Tarefa',
    file: 'inbox.org',
    withDate: true,
    build: (title, body, date, time) => [
      `* TODO ${title}`,
      ...(date ? [`SCHEDULED: ${formatTimestamp({ active: true, date, time: time || undefined })}`] : []),
      nowStamp(),
      ...bodyLines(body),
    ],
  },
  { key: 'n', name: 'Nota', file: 'inbox.org', build: (title, body) => [`* ${title} :nota:`, nowStamp(), ...bodyLines(body)] },
  {
    key: 'e',
    name: 'Evento',
    file: 'inbox.org',
    withDate: true,
    build: (title, body, date, time) => [`* ${title}`, formatTimestamp({ active: true, date: date ?? dateKey(new Date()), time: time || undefined }), ...bodyLines(body)],
  },
  {
    key: 'j',
    name: 'Diário',
    file: 'journal.org',
    datetree: true,
    build: (title, body) => [`**** ${new Date().toTimeString().slice(0, 5)} ${title}`, ...bodyLines(body)],
  },
]

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Appends an entry to `text`, optionally under a year/month/day datetree like org-capture's file+olp+datetree. */
export function captureInto(text: string, entry: string[], datetree: boolean, now = new Date()): string {
  const lines = text ? text.replace(/\n+$/, '').split('\n') : []
  if (!datetree) return [...lines, ...entry, ''].join('\n')

  const pad = (n: number) => String(n).padStart(2, '0')
  const path = [
    String(now.getFullYear()),
    `${now.getFullYear()}-${pad(now.getMonth() + 1)} ${MONTHS[now.getMonth()]}`,
    `${dateKey(now)} ${DAYS[now.getDay()]}`,
  ]
  let doc = parseOrg(lines.join('\n'))
  let parentEnd = lines.length
  let siblings = doc.headlines
  for (let level = 1; level <= 3; level++) {
    const title = path[level - 1]
    const found = siblings.find((h) => h.title === title)
    if (found) {
      siblings = found.children
      parentEnd = found.end
      continue
    }
    // Insert in sorted position among siblings.
    const after = siblings.filter((h) => h.title < title).pop()
    const pos = after ? after.end : siblings[0]?.line ?? parentEnd
    lines.splice(pos, 0, `${'*'.repeat(level)} ${title}`)
    doc = parseOrg(lines.join('\n'))
    const created = doc.all.find((h) => h.line === pos)!
    siblings = created.children
    parentEnd = created.end
  }
  lines.splice(parentEnd, 0, ...entry)
  return lines.join('\n') + '\n'
}
