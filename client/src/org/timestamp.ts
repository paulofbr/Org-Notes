export type Unit = 'h' | 'd' | 'w' | 'm' | 'y'

export interface Timestamp {
  active: boolean
  date: string // YYYY-MM-DD
  time?: string // HH:MM
  endTime?: string
  repeater?: { type: '+' | '++' | '.+'; n: number; unit: Unit }
  warning?: { n: number; unit: Unit }
  end?: Timestamp // date range <a>--<b>
  raw: string
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad = (n: number) => String(n).padStart(2, '0')

// <2026-10-25 Sun 10:00-11:00 +1w -2d>
const SINGLE = String.raw`([<[])(\d{4}-\d{2}-\d{2})(?: +[^\s\d>\]+.-][^\s>\]]*)?(?: +(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?)?((?: +(?:\+\+|\.\+|\+|--?)\d+[hdwmy])*) *[>\]]`
export const TIMESTAMP_RE = new RegExp(`${SINGLE}(?:--${SINGLE})?`, 'g')

export function parseTimestamp(raw: string): Timestamp | undefined {
  const m = new RegExp(`^${SINGLE}(?:--${SINGLE})?$`).exec(raw.trim())
  if (!m) return undefined
  const ts = fromGroups(m.slice(1, 6), raw)
  if (ts && m[6]) ts.end = fromGroups(m.slice(6, 11), raw)
  return ts
}

function fromGroups([open, date, time, endTime, mods]: string[], raw: string): Timestamp | undefined {
  if (!date) return undefined
  const ts: Timestamp = { active: open === '<', date, raw }
  if (time) ts.time = time.padStart(5, '0')
  if (endTime) ts.endTime = endTime.padStart(5, '0')
  for (const mod of (mods ?? '').trim().split(/ +/).filter(Boolean)) {
    const r = /^(\+\+|\.\+|\+)(\d+)([hdwmy])$/.exec(mod)
    if (r) ts.repeater = { type: r[1] as '+', n: +r[2], unit: r[3] as Unit }
    const w = /^--?(\d+)([hdwmy])$/.exec(mod)
    if (w) ts.warning = { n: +w[1], unit: w[2] as Unit }
  }
  return ts
}

export function formatTimestamp(ts: Omit<Timestamp, 'raw'>): string {
  const d = toDate(ts.date)
  let s = `${ts.date} ${DAY_NAMES[d.getDay()]}`
  if (ts.time) s += ` ${ts.time}${ts.endTime ? '-' + ts.endTime : ''}`
  if (ts.repeater) s += ` ${ts.repeater.type}${ts.repeater.n}${ts.repeater.unit}`
  if (ts.warning) s += ` -${ts.warning.n}${ts.warning.unit}`
  const [o, c] = ts.active ? ['<', '>'] : ['[', ']']
  const single = `${o}${s}${c}`
  return ts.end ? `${single}--${formatTimestamp(ts.end)}` : single
}

/** Inactive timestamp for "now", as used by CLOSED, CLOCK and capture. */
export function nowStamp(withTime = true, active = false, now = new Date()): string {
  return formatTimestamp({ active, date: dateKey(now), time: withTime ? `${pad(now.getHours())}:${pad(now.getMinutes())}` : undefined })
}

export const toDate = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function addDays(key: string, n: number): string {
  const d = toDate(key)
  d.setDate(d.getDate() + n)
  return dateKey(d)
}

export function addUnit(key: string, n: number, unit: Unit): string {
  const d = toDate(key)
  if (unit === 'd' || unit === 'h') d.setDate(d.getDate() + (unit === 'd' ? n : 0))
  else if (unit === 'w') d.setDate(d.getDate() + 7 * n)
  else if (unit === 'm') d.setMonth(d.getMonth() + n)
  else d.setFullYear(d.getFullYear() + n)
  return dateKey(d)
}

export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000)

export function warningDays(ts: Timestamp, fallback = 14): number {
  if (!ts.warning) return fallback
  const { n, unit } = ts.warning
  return unit === 'w' ? n * 7 : unit === 'm' ? n * 30 : unit === 'y' ? n * 365 : unit === 'h' ? 0 : n
}

/** Moves a repeating timestamp forward past `today` as org does when an entry is marked DONE. */
export function shiftRepeater(ts: Timestamp, today: string): Timestamp {
  const r = ts.repeater
  if (!r) return ts
  let date = ts.date
  if (r.type === '.+') date = addUnit(today, r.n, r.unit)
  else if (r.type === '++') {
    do date = addUnit(date, r.n, r.unit)
    while (date <= today)
  } else date = addUnit(date, r.n, r.unit)
  return { ...ts, date }
}

/** Dates in [from, to] on which a (possibly repeating) timestamp occurs. */
export function occurrences(ts: Timestamp, from: string, to: string): string[] {
  const out: string[] = []
  if (ts.end) {
    for (let d = ts.date > from ? ts.date : from; d <= to && d <= ts.end.date; d = addDays(d, 1)) out.push(d)
    return out
  }
  if (!ts.repeater || ts.repeater.n <= 0 || ts.repeater.unit === 'h') return ts.date >= from && ts.date <= to ? [ts.date] : []
  for (let d = ts.date, i = 0; d <= to && i < 2000; d = addUnit(ts.date, ++i * ts.repeater.n, ts.repeater.unit))
    if (d >= from) out.push(d)
  return out
}

export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function formatDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`
}

/** Wall-clock minutes between two timestamps, as written (immune to DST jumps, like org's clock lines). */
export function wallMinutes(a: Timestamp, b: Timestamp): number {
  return Math.max(0, daysBetween(a.date, b.date) * 1440 + minutesOf(b.time ?? '00:00') - minutesOf(a.time ?? '00:00'))
}
