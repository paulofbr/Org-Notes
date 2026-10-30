import { HEADLINE_RE, parseOrg, serializeHeadline, refreshCookies, outlinePath, type Headline, type OrgDoc } from './parser'
import { formatTimestamp, nowStamp, shiftRepeater, dateKey, formatDuration, parseTimestamp, wallMinutes, type Timestamp } from './timestamp'
import { tr } from '../i18n'

// All edits take the file text plus the headline's line and return new text.
// The headline is re-resolved from the line so callers can pass stale objects safely.

const withLines = (text: string, fn: (lines: string[], doc: OrgDoc) => void) => {
  const doc = parseOrg(text)
  const lines = [...doc.lines]
  fn(lines, doc)
  return refreshCookies(lines.join('\n'))
}

const at = (doc: OrgDoc, line: number) => {
  const h = doc.all.find((x) => x.line === line)
  if (!h) throw new Error(`No headline at line ${line}`)
  return h
}

function rewrite(lines: string[], h: Headline, patch: Partial<Pick<Headline, 'keyword' | 'priority' | 'title' | 'tags' | 'level'>>) {
  lines[h.line] = serializeHeadline({ ...h, ...patch })
}

export const setTitle = (text: string, line: number, title: string) =>
  withLines(text, (lines, doc) => rewrite(lines, at(doc, line), { title }))

export const setTags = (text: string, line: number, tags: string[]) =>
  withLines(text, (lines, doc) => rewrite(lines, at(doc, line), { tags }))

export function cyclePriority(text: string, line: number, dir: 1 | -1 = 1) {
  const order = [undefined, 'A', 'B', 'C']
  return withLines(text, (lines, doc) => {
    const h = at(doc, line)
    const i = order.indexOf(h.priority)
    rewrite(lines, h, { priority: order[(i + (dir === 1 ? 1 : order.length - 1)) % order.length] })
  })
}

export function nextKeyword(doc: OrgDoc, current: string | undefined, dir: 1 | -1 = 1): string | undefined {
  const seq: (string | undefined)[] = [undefined, ...doc.todo.todo, ...doc.todo.done]
  const i = Math.max(0, seq.indexOf(current))
  return seq[(i + dir + seq.length) % seq.length]
}

/** Sets the TODO keyword, handling CLOSED and repeaters like org-todo. */
export function setKeyword(text: string, line: number, keyword: string | undefined, now = new Date()) {
  return withLines(text, (lines, doc) => {
    const h = at(doc, line)
    const done = !!keyword && doc.todo.done.includes(keyword)
    const planning = { ...h.planning }
    const repeating = [planning.scheduled, planning.deadline].some((t) => t?.repeater)
    if (done && !h.done && repeating) {
      // Repeating task: shift dates and reset to the first TODO state.
      const today = dateKey(now)
      if (planning.scheduled?.repeater) planning.scheduled = shiftRepeater(planning.scheduled, today)
      if (planning.deadline?.repeater) planning.deadline = shiftRepeater(planning.deadline, today)
      writePlanning(lines, h, planning)
      setPropertyIn(lines, parseOrg(lines.join('\n')), line, 'LAST_REPEAT', nowStamp(true, false, now))
      const fresh = at(parseOrg(lines.join('\n')), line)
      rewrite(lines, fresh, { keyword: h.keyword ?? doc.todo.todo[0] })
      return
    }
    if (done && !h.done) planning.closed = { ...stampFromNow(now), raw: '' }
    if (!done) delete planning.closed
    writePlanning(lines, h, planning)
    rewrite(lines, h, { keyword })
  })
}

const stampFromNow = (now: Date): Omit<Timestamp, 'raw'> => ({
  active: false,
  date: dateKey(now),
  time: now.toTimeString().slice(0, 5),
})

function writePlanning(lines: string[], h: Headline, p: Headline['planning']) {
  const parts: string[] = []
  if (p.deadline) parts.push(`DEADLINE: ${formatTimestamp(p.deadline)}`)
  if (p.scheduled) parts.push(`SCHEDULED: ${formatTimestamp(p.scheduled)}`)
  if (p.closed) parts.unshift(`CLOSED: ${formatTimestamp(p.closed)}`)
  const value = parts.join(' ')
  if (h.planningLine !== undefined) {
    if (value) lines[h.planningLine] = value
    else lines.splice(h.planningLine, 1)
  } else if (value) lines.splice(h.line + 1, 0, value)
}

export function setPlanning(text: string, line: number, kind: 'scheduled' | 'deadline', ts?: Omit<Timestamp, 'raw'>) {
  return withLines(text, (lines, doc) => {
    const h = at(doc, line)
    const planning = { ...h.planning }
    if (ts) planning[kind] = { ...ts, raw: '' }
    else delete planning[kind]
    writePlanning(lines, h, planning)
  })
}

/**
 * Moves one of an entry's dates (its SCHEDULED, its DEADLINE, or a timestamp in its title or body) to another day and
 * time, keeping its repeater, warning and range; without a time, the end time goes too.
 */
export function moveTimestamp(text: string, line: number, kind: 'scheduled' | 'deadline' | 'timestamp', ts: Timestamp, date: string, time?: string) {
  const moved = { ...ts, date, time, endTime: time ? ts.endTime : undefined }
  if (kind !== 'timestamp') return setPlanning(text, line, kind, moved)
  return withLines(text, (lines, doc) => {
    const h = at(doc, line)
    const i = lines.findIndex((l, k) => k >= h.line && k < h.contentEnd && l.includes(ts.raw))
    if (i >= 0) lines[i] = lines[i].replace(ts.raw, formatTimestamp(moved))
  })
}

function setPropertyIn(lines: string[], doc: OrgDoc, line: number, key: string, value: string | undefined) {
  const h = at(doc, line)
  if (h.propertiesRange) {
    const [s, e] = h.propertiesRange
    for (let i = s + 1; i < e; i++)
      if (new RegExp(`^\\s*:${key}:`, 'i').test(lines[i])) {
        if (value === undefined) lines.splice(i, 1)
        else lines[i] = `:${key}: ${value}`
        if (value === undefined && e - s === 2) lines.splice(s, 2) // drawer is now empty
        return
      }
    if (value !== undefined) lines.splice(e, 0, `:${key}: ${value}`)
  } else if (value !== undefined) {
    const at = h.planningLine !== undefined ? h.planningLine + 1 : h.line + 1
    lines.splice(at, 0, ':PROPERTIES:', `:${key}: ${value}`, ':END:')
  }
}

export const setProperty = (text: string, line: number, key: string, value: string | undefined) =>
  withLines(text, (lines, doc) => setPropertyIn(lines, doc, line, key, value))

export function toggleCheckbox(text: string, itemLine: number) {
  return withLines(text, (lines) => {
    lines[itemLine] = lines[itemLine].replace(/\[([ Xx-])\]/, (_, c) => (c === ' ' || c === '-' ? '[X]' : '[ ]'))
  })
}

// ---------- Clocking ----------

export function clockIn(text: string, line: number, now = new Date()) {
  return withLines(text, (lines, doc) => {
    const h = at(doc, line)
    const entry = `CLOCK: ${nowStamp(true, false, now)}`
    if (h.logbookRange) lines.splice(h.logbookRange[0] + 1, 0, entry)
    else {
      const pos = h.propertiesRange ? h.propertiesRange[1] + 1 : h.planningLine !== undefined ? h.planningLine + 1 : h.line + 1
      lines.splice(pos, 0, ':LOGBOOK:', entry, ':END:')
    }
  })
}

export function clockOut(text: string, clockLine: number, now = new Date()) {
  return withLines(text, (lines, doc) => {
    const h = doc.all.find((x) => x.clocks.some((c) => c.line === clockLine))
    const clock = h?.clocks.find((c) => c.line === clockLine)
    if (!clock || clock.end) return
    const end = nowStamp(true, false, now)
    lines[clockLine] = `${lines[clockLine].trimEnd()}--${end} => ${formatDuration(wallMinutes(clock.start, parseTimestamp(end)!)).padStart(5)}`
  })
}

// ---------- Structure ----------

export function insertHeadline(
  text: string,
  afterLine: number | undefined,
  mode: 'sibling' | 'child',
  title = '',
  { keyword, description = '' }: { keyword?: string; description?: string } = {},
) {
  return withLines(text, (lines, doc) => {
    const level = afterLine === undefined ? 1 : mode === 'child' ? at(doc, afterLine).level + 1 : at(doc, afterLine).level
    const entry = [serializeHeadline({ level, keyword, title, tags: [] }), ...bodyLines(description)]
    if (afterLine !== undefined) lines.splice(at(doc, afterLine).end, 0, ...entry)
    else if (lines.length && lines[lines.length - 1] === '') lines.splice(lines.length - 1, 0, ...entry)
    else lines.push(...entry)
  })
}

/** Inserts a captured entry as a sibling or child of a headline (or at the end), shifting its headlines to that level. */
export function insertEntry(text: string, afterLine: number | undefined, mode: 'sibling' | 'child', entry: string[]) {
  return withLines(text, (lines, doc) => {
    const level = afterLine === undefined ? 1 : mode === 'child' ? at(doc, afterLine).level + 1 : at(doc, afterLine).level
    const first = entry.map((l) => /^(\*+)(?=\s|$)/.exec(l)).find(Boolean)
    const delta = first ? level - first[1].length : 0
    const shifted = entry.map((l) => l.replace(/^(\*+)(?=\s|$)/, (stars) => '*'.repeat(Math.max(1, stars.length + delta))))
    let pos = afterLine === undefined ? lines.length : at(doc, afterLine).end
    // Before the file's final newline, not after it.
    if (pos === lines.length && lines[pos - 1] === '') pos--
    lines.splice(pos, 0, ...shifted)
  })
}

export function deleteSubtree(text: string, line: number) {
  return withLines(text, (lines, doc) => {
    const h = at(doc, line)
    lines.splice(h.line, h.end - h.line)
  })
}

export function shiftLevel(text: string, line: number, delta: 1 | -1) {
  return withLines(text, (lines, doc) => {
    const h = at(doc, line)
    if (h.level + delta < 1) return
    for (const d of doc.all) if (d.line >= h.line && d.line < h.end) lines[d.line] = serializeHeadline({ ...d, level: d.level + delta })
  })
}

export function moveSubtree(text: string, line: number, dir: 1 | -1) {
  return withLines(text, (lines, doc) => {
    const h = at(doc, line)
    const siblings = h.parent ? h.parent.children : doc.headlines
    const i = siblings.indexOf(h)
    const other = siblings[i + dir]
    if (!other) return
    const [a, b] = dir === 1 ? [h, other] : [other, h]
    const first = lines.slice(a.line, a.end)
    const second = lines.slice(b.line, b.end)
    lines.splice(a.line, b.end - a.line, ...second, ...first)
  })
}

/** Returns the subtree text re-levelled so its root is at `level`. */
function subtreeAt(doc: OrgDoc, h: Headline, level: number): string[] {
  const lines = doc.lines.slice(h.line, h.end)
  const delta = level - h.level
  for (const d of doc.all)
    if (d.line >= h.line && d.line < h.end) lines[d.line - h.line] = serializeHeadline({ ...d, level: d.level + delta })
  return lines
}

/** Moves a subtree under `target` (in the same or another file). Returns the new texts. */
export function refile(
  srcText: string,
  line: number,
  dstText: string | undefined, // undefined = same file
  targetLine: number | undefined, // undefined = top level of the target file
): { src: string; dst?: string } {
  const doc = parseOrg(srcText)
  const h = at(doc, line)
  const same = dstText === undefined
  if (same && targetLine !== undefined && targetLine >= h.line && targetLine < h.end) throw new Error(tr('Não é possível mover para dentro de si próprio'))
  const srcLines = [...doc.lines]
  srcLines.splice(h.line, h.end - h.line)
  const dst = parseOrg(same ? srcLines.join('\n') : dstText!)
  const target = targetLine === undefined ? undefined : at(dst, same && targetLine >= h.end ? targetLine - (h.end - h.line) : targetLine)
  const moved = subtreeAt(doc, h, target ? target.level + 1 : 1)
  const dstLines = [...dst.lines]
  let pos = target ? target.end : dstLines.length
  if (!target && dstLines[pos - 1] === '') pos--
  dstLines.splice(pos, 0, ...moved)
  const out = refreshCookies(dstLines.join('\n'))
  return same ? { src: out } : { src: refreshCookies(srcLines.join('\n')), dst: out }
}

/** All files archive into one `archive.org`. */
export function archiveName() {
  return 'archive.org'
}

/** Moves a subtree to the archive file, recording where it came from. */
export function archive(srcText: string, line: number, srcPath: string, archiveText: string, now = new Date()) {
  const doc = parseOrg(srcText)
  const h = at(doc, line)
  let moved = parseOrg(subtreeAt(doc, h, 1).join('\n'))
  const props: [string, string][] = [
    ['ARCHIVE_TIME', nowStamp(true, false, now).slice(1, -1)],
    ['ARCHIVE_FILE', srcPath],
    ['ARCHIVE_OLPATH', outlinePath(h).join('/')],
    ['ARCHIVE_CATEGORY', srcPath.replace(/\.org$/i, '').split('/').pop()!],
  ]
  if (h.keyword) props.push(['ARCHIVE_TODO', h.keyword])
  const movedLines = [...moved.lines]
  for (const [k, v] of props) {
    if (!v) continue
    setPropertyIn(movedLines, moved, 0, k, v)
    moved = parseOrg(movedLines.join('\n'))
  }
  const srcLines = [...doc.lines]
  srcLines.splice(h.line, h.end - h.line)
  const base = archiveText.trim() ? archiveText.replace(/\n*$/, '\n') : `#+TITLE: ${tr('Arquivo de {path}', { path: srcPath })}\n\n`
  return { src: refreshCookies(srcLines.join('\n')), archive: base + movedLines.join('\n') + '\n' }
}

export function replaceLines(text: string, start: number, end: number, replacement: string) {
  const lines = text.split('\n')
  lines.splice(start, end - start, ...replacement.split('\n'))
  return refreshCookies(lines.join('\n'))
}

/** A headline's description: its own text after planning, properties and logbook, up to the first child. */
export function descriptionOf(doc: OrgDoc, h: Headline) {
  return doc.lines.slice(h.bodyStart, h.contentEnd).join('\n').replace(/\s+$/, '')
}

/** A description as body lines; a line starting with stars would become a headline, so it gets a leading space. */
function bodyLines(description: string) {
  const text = description.replace(/\s+$/, '')
  return text ? text.split('\n').map((l) => (HEADLINE_RE.test(l) ? ` ${l}` : l)) : []
}

/** Replaces a headline's description, keeping the blank lines that separated it from what follows. */
export function setDescription(text: string, line: number, description: string) {
  const doc = parseOrg(text)
  const h = at(doc, line)
  const old = doc.lines.slice(h.bodyStart, h.contentEnd)
  let blanks = 0
  while (blanks < old.length && old[old.length - 1 - blanks] === '') blanks++
  const body = bodyLines(description)
  const lines = [...doc.lines]
  lines.splice(h.bodyStart, old.length, ...body, ...Array(blanks).fill(''))
  return refreshCookies(lines.join('\n'))
}
/** Sets (or, without a value, removes) a file keyword like `#+ICON:` in the preamble, after `#+TITLE:` when there is one. */
export function setFileKeyword(text: string, key: string, value?: string) {
  const lines = text.split('\n')
  const end = lines.findIndex((l) => HEADLINE_RE.test(l))
  const preamble = end < 0 ? lines.length : end
  const re = new RegExp(`^\\s*#\\+${key}:`, 'i')
  const i = lines.slice(0, preamble).findIndex((l) => re.test(l))
  const line = value ? [`#+${key}: ${value}`] : []
  if (i >= 0) lines.splice(i, 1, ...line)
  else lines.splice(lines.slice(0, preamble).findIndex((l) => /^\s*#\+title:/i.test(l)) + 1, 0, ...line)
  return lines.join('\n')
}

// ---------- Tables ----------

/** Aligns an org table given its lines (as org's TAB does). */
export function alignTable(rows: string[]): string[] {
  const indent = /^\s*/.exec(rows[0] ?? '')![0]
  const parsed = rows.map((r) => {
    const t = r.trim()
    return /^\|[-+]+\|?$/.test(t) || /^\|-/.test(t) ? null : t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
  })
  const cols = Math.max(...parsed.map((p) => p?.length ?? 0))
  const widths = Array.from({ length: cols }, (_, c) => Math.max(1, ...parsed.map((p) => [...(p?.[c] ?? '')].length)))
  const numeric = widths.map((_, c) => {
    const vals = parsed.map((p) => p?.[c]).filter(Boolean) as string[]
    return vals.length > 0 && vals.filter((v) => /^[-+]?[\d.,]+%?$/.test(v)).length / vals.length > 0.5
  })
  return parsed.map((p) =>
    p
      ? `${indent}| ${widths.map((w, c) => (numeric[c] ? (p[c] ?? '').padStart(w) : (p[c] ?? '').padEnd(w))).join(' | ')} |`
      : `${indent}|${widths.map((w) => '-'.repeat(w + 2)).join('+')}|`,
  )
}
