import { allTags, type Headline, type OrgDoc } from './parser'
import { addDays, daysBetween, occurrences, warningDays, type Timestamp } from './timestamp'

export interface Entry {
  path: string
  doc: OrgDoc
  h: Headline
}

export interface AgendaItem extends Entry {
  kind: 'scheduled' | 'deadline' | 'timestamp' | 'overdue' | 'upcoming' | 'sched-past'
  ts: Timestamp
  days: number // for overdue/upcoming/sched-past
}

export function entries(docs: Record<string, OrgDoc>): Entry[] {
  return Object.entries(docs).flatMap(([path, doc]) => doc.all.map((h) => ({ path, doc, h })))
}

/** Agenda items for each day in [from, to], following org-agenda's rules for past/upcoming items on today. */
export function agenda(docs: Record<string, OrgDoc>, from: string, to: string, today: string): Map<string, AgendaItem[]> {
  const days = new Map<string, AgendaItem[]>()
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, [])
  const add = (day: string, item: AgendaItem) => days.get(day)?.push(item)
  const showToday = today >= from && today <= to

  for (const e of entries(docs)) {
    const { scheduled, deadline } = e.h.planning
    if (scheduled) {
      for (const d of occurrences(scheduled, from, to)) if (!(e.h.done && d !== scheduled.date)) add(d, { ...e, kind: 'scheduled', ts: scheduled, days: 0 })
      if (showToday && !e.h.done && scheduled.date < today) add(today, { ...e, kind: 'sched-past', ts: scheduled, days: daysBetween(scheduled.date, today) })
    }
    if (deadline) {
      for (const d of occurrences(deadline, from, to)) if (!(e.h.done && d !== deadline.date)) add(d, { ...e, kind: 'deadline', ts: deadline, days: 0 })
      if (showToday && !e.h.done) {
        const diff = daysBetween(today, deadline.date)
        if (diff < 0) add(today, { ...e, kind: 'overdue', ts: deadline, days: -diff })
        else if (diff > 0 && diff <= warningDays(deadline)) add(today, { ...e, kind: 'upcoming', ts: deadline, days: diff })
      }
    }
    for (const ts of e.h.timestamps) for (const d of occurrences(ts, from, to)) add(d, { ...e, kind: 'timestamp', ts, days: 0 })
  }

  const rank = { timestamp: 0, scheduled: 1, deadline: 1, overdue: 2, 'sched-past': 3, upcoming: 4 }
  for (const items of days.values())
    items.sort(
      (a, b) =>
        (a.ts.time && rank[a.kind] < 2 ? 0 : 1) - (b.ts.time && rank[b.kind] < 2 ? 0 : 1) ||
        (a.ts.time ?? '').localeCompare(b.ts.time ?? '') ||
        rank[a.kind] - rank[b.kind] ||
        (a.h.priority ?? 'B').localeCompare(b.h.priority ?? 'B'),
    )
  return days
}

// ---------- Tag/property match (org-match-syntax) ----------

type Term = { neg: boolean; test: (e: Entry, tags: string[]) => boolean }

/** Parses queries like `work+urgent-home|TODO="NEXT"`, `PRIORITY="A"`, `Effort>1`, `LEVEL=2`. */
export function compileMatch(query: string): (e: Entry) => boolean {
  const [tagPart, todoPart] = query.split('/')
  const ors = tagPart.split('|').map((conj) => {
    const terms: Term[] = []
    const re = /([+-]?)(?:([\w_]+)(=|<>|<=|>=|<|>)("[^"]*"|\{[^}]*\}|[\w.:-]+)|\{([^}]+)\}|([\w@#%]+))/g
    for (const m of conj.matchAll(re)) {
      const neg = m[1] === '-'
      if (m[6]) {
        const tag = m[6].toLowerCase()
        terms.push({ neg, test: (_, tags) => tags.some((t) => t.toLowerCase() === tag) })
      } else if (m[5]) {
        const rx = new RegExp(m[5], 'i')
        terms.push({ neg, test: (_, tags) => tags.some((t) => rx.test(t)) })
      } else terms.push({ neg, test: (e) => compareProp(propValue(e, m[2]), m[3], m[4]) })
    }
    return terms
  })
  const todoFilter = todoPart?.trim()
  return (e) => {
    if (todoFilter) {
      const kws = todoFilter.replace(/^!/, '').split('|')
      if (!e.h.keyword || !kws.includes(e.h.keyword)) return false
    }
    if (!tagPart.trim()) return true
    const tags = allTags(e.h, e.doc)
    return ors.some((terms) => terms.length > 0 && terms.every((t) => t.test(e, tags) !== t.neg))
  }
}

function propValue(e: Entry, name: string): string | undefined {
  const key = name.toUpperCase()
  if (key === 'TODO') return e.h.keyword
  if (key === 'PRIORITY') return e.h.priority ?? 'B'
  if (key === 'LEVEL') return String(e.h.level)
  if (key === 'CATEGORY') return e.h.properties.CATEGORY ?? e.path.replace(/\.org$/, '')
  if (key === 'SCHEDULED' || key === 'DEADLINE' || key === 'CLOSED') return e.h.planning[key.toLowerCase() as 'scheduled']?.date
  return Object.entries(e.h.properties).find(([k]) => k.toUpperCase() === key)?.[1]
}

function compareProp(actual: string | undefined, op: string, raw: string): boolean {
  if (raw.startsWith('{')) {
    const ok = actual !== undefined && new RegExp(raw.slice(1, -1), 'i').test(actual)
    return op === '<>' ? !ok : ok
  }
  const expected = raw.replace(/^"|"$/g, '')
  if (actual === undefined) return op === '<>' && expected !== ''
  const num = (s: string) => (/^\d+:\d{2}$/.test(s) ? s.split(':').reduce((h, m) => +h * 60 + +m, 0) : Number(s))
  const [a, b] = /^[\d.:]+$/.test(expected) && !raw.startsWith('"') ? [num(actual), num(expected)] : [actual, expected]
  switch (op) {
    case '=': return a === b
    case '<>': return a !== b
    case '<': return a < b
    case '>': return a > b
    case '<=': return a <= b
    default: return a >= b
  }
}

export function textMatch(e: Entry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const text = e.doc.lines.slice(e.h.line, e.h.contentEnd).join('\n').toLowerCase()
  return words.every((w) => (w.startsWith('-') ? !text.includes(w.slice(1)) : text.includes(w.replace(/^\+/, ''))))
}

/** Minutes clocked per headline within [from, to]. */
export function clockReport(docs: Record<string, OrgDoc>, from: string, to: string) {
  return entries(docs)
    .map((e) => ({ ...e, minutes: e.h.clocks.filter((c) => c.end && c.start.date >= from && c.start.date <= to).reduce((s, c) => s + c.minutes, 0) }))
    .filter((r) => r.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
}
