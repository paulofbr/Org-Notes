import { HEADLINE_RE, parseOrg } from './parser'
import { dateKey, formatTimestamp, nowStamp } from './timestamp'
import { resolvePath } from './links'
import { addTags } from './tags'

/**
 * A capture template, stored in its target file's preamble as
 *   #+BEGIN_CAPTURE t Tarefa :datetree
 *   ,* TODO %{title}
 *   #+END_CAPTURE
 * Lines starting with `*` or `#` are comma-escaped, as in org source blocks.
 */
export interface CaptureTemplate {
  key: string
  name: string
  file: string
  datetree: boolean
  body: string
}

const BEGIN_RE = /^\s*#\+begin_capture\s+(\S)\s*(.*?)\s*$/i
const END_RE = /^\s*#\+end_capture\s*$/i

/** Capture blocks in a file's preamble, with their line range [begin, end]. */
function blocksIn(lines: string[]) {
  const out: { begin: number; end: number; tpl: Omit<CaptureTemplate, 'file'> }[] = []
  for (let i = 0; i < lines.length && !HEADLINE_RE.test(lines[i]); i++) {
    const m = BEGIN_RE.exec(lines[i])
    if (!m) continue
    let j = i + 1
    while (j < lines.length && !END_RE.test(lines[j])) j++
    const datetree = /(^|\s):datetree$/.test(m[2])
    const body = lines.slice(i + 1, j).map((l) => l.replace(/^(\s*),([*#])/, '$1$2')).join('\n')
    out.push({ begin: i, end: j, tpl: { key: m[1], name: m[2].replace(/\s*:datetree$/, '') || m[1], datetree, body } })
    i = j
  }
  return out
}

export function templatesIn(file: string, text: string): CaptureTemplate[] {
  return blocksIn(text.split('\n')).map((b) => ({ ...b.tpl, file }))
}

export function allTemplates(files: Record<string, string>): CaptureTemplate[] {
  return Object.keys(files).sort().flatMap((f) => templatesIn(f, files[f]))
}

/** Replaces all capture blocks of a file with `templates`, placed where the first one was (or at the end of the preamble). */
export function setTemplates(text: string, templates: Omit<CaptureTemplate, 'file'>[]): string {
  const lines = text.split('\n')
  const blocks = blocksIn(lines)
  for (const b of [...blocks].reverse()) lines.splice(b.begin, b.end - b.begin + 1)
  let at = blocks[0]?.begin ?? lines.findIndex((l) => HEADLINE_RE.test(l))
  if (at < 0) at = lines.length
  if (!blocks.length) while (at > 0 && lines[at - 1] === '') at--
  const out = templates.flatMap((t) => [
    `#+BEGIN_CAPTURE ${t.key} ${t.name}${t.datetree ? ' :datetree' : ''}`,
    ...t.body.split('\n').map((l) => l.replace(/^(\s*)([*#])/, '$1,$2')),
    '#+END_CAPTURE',
  ])
  lines.splice(at, 0, ...out)
  return lines.join('\n')
}

/**
 * The text without its capture blocks, for editing it as plain text, and `restore` to put the blocks back
 * unchanged into an edited version: at the same line, but never past the preamble.
 */
export function hideTemplates(text: string): { text: string; restore: (edited: string) => string } {
  const lines = text.split('\n')
  const blocks = blocksIn(lines)
  if (!blocks.length) return { text, restore: (edited) => edited }
  const hidden: { at: number; lines: string[] }[] = []
  let removed = 0
  for (const b of blocks) {
    hidden.push({ at: b.begin - removed, lines: lines.slice(b.begin, b.end + 1) })
    removed += b.end - b.begin + 1
  }
  const kept = lines.filter((_, i) => !blocks.some((b) => i >= b.begin && i <= b.end))
  const restore = (edited: string) => {
    const out = edited.split('\n')
    let preamble = out.findIndex((l) => HEADLINE_RE.test(l))
    if (preamble < 0) preamble = out.length
    let added = 0
    for (const h of hidden) {
      const at = Math.min(h.at, preamble) + added
      out.splice(at, 0, ...h.lines)
      added += h.lines.length
    }
    return out.join('\n')
  }
  return { text: kept.join('\n'), restore }
}

export const usesWhen =(t: CaptureTemplate) => t.body.includes('%{when}')

// An empty property line, like `:EMAIL:`, that the capture can fill in.
const EMPTY_PROP_RE = /^(\s*):([^\s:]+):\s*$/
const DRAWER_KEYS = new Set(['PROPERTIES', 'END'])

/** The template's empty properties, in order, to ask for in the capture. */
export const emptyProps = (t: CaptureTemplate) =>
  t.body.split('\n').flatMap((l) => {
    const m = EMPTY_PROP_RE.exec(l)
    return m && !DRAWER_KEYS.has(m[2].toUpperCase()) ? [m[2]] : []
  })

const PROPERTY_ALL_RE = /^\s*#\+property:\s+(\S+)_ALL\s+(.*)$/i

/** A file's `#+PROPERTY: KEY_ALL a b "c d"` lines, by upper-case property name: the values to offer in the capture. */
export function propertyOptions(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const l of text.split('\n')) {
    if (HEADLINE_RE.test(l)) break
    const m = PROPERTY_ALL_RE.exec(l)
    if (m) out[m[1].toUpperCase()] = [...m[2].matchAll(/"([^"]*)"|(\S+)/g)].map((v) => v[1] ?? v[2])
  }
  return out
}

const PROPERTY_FROM_RE = /^\s*#\+property:\s+(\S+)_FROM\s+(\S+)\s*$/i

/** A file's `#+PROPERTY: KEY_FROM other.org` lines, by upper-case property name: the file whose headlines are its values. */
export function propertySources(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const l of text.split('\n')) {
    if (HEADLINE_RE.test(l)) break
    const m = PROPERTY_FROM_RE.exec(l)
    if (m) out[m[1].toUpperCase()] = m[2]
  }
  return out
}

/**
 * The values to offer for each property of `file`: its `_ALL` lists, and the top-level headlines of its `_FROM` files
 * (e.g. the contacts), found relative to it like links, else from the root.
 */
export function fieldOptions(file: string, files: Record<string, string>): Record<string, string[]> {
  const text = files[file] ?? ''
  const out = propertyOptions(text)
  for (const key of Object.keys(propertySources(text))) {
    const src = optionSource(file, files, key)
    if (src) out[key] = parseOrg(files[src]).headlines.map((h) => h.title)
  }
  return out
}

/** The file whose top-level headlines are the values of `key` in `file` (`#+PROPERTY: KEY_FROM other.org`), if it exists. */
export function optionSource(file: string, files: Record<string, string>, key: string): string | undefined {
  const src = propertySources(files[file] ?? '')[key.toUpperCase()]
  if (!src) return undefined
  const near = resolvePath(file, src)
  return files[near] !== undefined ? near : files[src] !== undefined ? src : undefined
}

/** Sets `#+PROPERTY: KEY_ALL` lines in the preamble, replacing a property's existing line or adding it before the capture blocks. */
export function setPropertyOptions(text: string, options: Record<string, string[]>): string {
  const lines = text.split('\n')
  for (const [key, values] of Object.entries(options)) {
    const line = `#+PROPERTY: ${key}_ALL ${values.map((v) => (/\s/.test(v) ? `"${v}"` : v)).join(' ')}`
    let preamble = lines.findIndex((l) => HEADLINE_RE.test(l))
    if (preamble < 0) preamble = lines.length
    const i = lines.slice(0, preamble).findIndex((l) => PROPERTY_ALL_RE.exec(l)?.[1].toUpperCase() === key.toUpperCase())
    if (i >= 0) lines[i] = line
    else {
      const block = lines.slice(0, preamble).findIndex((l) => BEGIN_RE.test(l))
      let at = block >= 0 ? block : preamble
      if (block < 0) while (at > 0 && lines[at - 1] === '') at--
      lines.splice(at, 0, line)
    }
  }
  return lines.join('\n')
}

/** A template being edited; `options` are values for its properties, saved as `#+PROPERTY: KEY_ALL` lines. */
export type TemplateDraft = Omit<CaptureTemplate, 'file'> & { options?: Record<string, string[]> }

/** The file text with the drafts saved as capture blocks, and their property options. */
export const saveDrafts = (text: string, drafts: TemplateDraft[]) =>
  setPropertyOptions(setTemplates(text, drafts), Object.assign({}, ...drafts.map((d) => d.options ?? {})))

const bodyLines = (body: string) => (body.trim() ? body.trimEnd().split('\n') : [])

/** Fills a template: %{title}, %{body}, %{when} (chosen date; line dropped when empty), %{time}, %U, %T, and empty properties from `props`. */
export function expand(t: CaptureTemplate, v: { title: string; body: string; date?: string; time?: string; props?: Record<string, string>; tags?: string[] }, now = new Date()): string[] {
  const when = v.date ? formatTimestamp({ active: true, date: v.date, time: v.time || undefined }) : ''
  const fill = (l: string) =>
    l
      .replaceAll('%{title}', v.title)
      .replaceAll('%{when}', when)
      .replaceAll('%{time}', now.toTimeString().slice(0, 5))
      .replaceAll('%U', nowStamp(true, false, now))
      .replaceAll('%T', nowStamp(true, true, now))
      .replaceAll('%{body}', v.body.trim())
  const lines = t.body.split('\n').flatMap((l) => {
    if (l.includes('%{when}') && !when) return []
    if (l.trim() === '%{body}') return bodyLines(v.body)
    const prop = EMPTY_PROP_RE.exec(l)
    const value = prop && v.props?.[prop[2]]?.trim()
    if (value) return [`${prop[1]}:${prop[2]}: ${value}`]
    return [fill(l)]
  })
  // The chosen tags go on the entry's headline (the first one), after any the template gives it.
  const head = lines.findIndex((l) => HEADLINE_RE.test(l))
  if (head >= 0 && v.tags?.length) lines[head] = addTags(lines[head], v.tags)
  // A template without %{body} still keeps what was written, at the end of the entry.
  return t.body.includes('%{body}') ? lines : [...lines, ...bodyLines(v.body)]
}

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
