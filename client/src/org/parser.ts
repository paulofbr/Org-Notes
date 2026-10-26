import { TIMESTAMP_RE, parseTimestamp, wallMinutes, type Timestamp } from './timestamp'

export interface TodoKeywords {
  todo: string[]
  done: string[]
}

export interface Clock {
  line: number
  start: Timestamp
  end?: Timestamp
  minutes: number
}

export interface Headline {
  key: string // stable-ish identity: path of titles
  level: number
  keyword?: string
  done: boolean
  priority?: string
  title: string
  tags: string[]
  line: number // headline line
  contentEnd: number // first line of first child (or end)
  end: number // end of subtree (exclusive)
  bodyStart: number // first line after planning/properties/logbook
  planning: { scheduled?: Timestamp; deadline?: Timestamp; closed?: Timestamp }
  planningLine?: number
  properties: Record<string, string>
  propertiesRange?: [number, number] // :PROPERTIES: line, :END: line
  logbookRange?: [number, number]
  clocks: Clock[]
  timestamps: Timestamp[] // active timestamps in title and body
  children: Headline[]
  parent?: Headline
}

export interface OrgDoc {
  lines: string[]
  keywords: Record<string, string>
  todo: TodoKeywords
  filetags: string[]
  startup: string
  headlines: Headline[] // top level
  all: Headline[] // document order
  preambleEnd: number
}

// ---------- Blocks (section content) ----------

export interface ListItem {
  line: number
  bullet: string
  checkbox?: ' ' | 'X' | '-'
  term?: string
  text: string
  children: Block[]
}

export type Block =
  | { type: 'paragraph'; line: number; text: string }
  | { type: 'list'; line: number; ordered: boolean; items: ListItem[] }
  | { type: 'table'; line: number; rows: (string[] | 'hr')[]; formula?: string }
  | { type: 'block'; line: number; name: string; params: string; content: string }
  | { type: 'drawer'; line: number; name: string; content: string }
  | { type: 'fixed'; line: number; content: string }
  | { type: 'hr'; line: number }
  | { type: 'footnote'; line: number; label: string; text: string }
  | { type: 'keyword'; line: number; key: string; value: string }

export const HEADLINE_RE = /^(\*+)(?:[ \t]+(.*))?$/
const PLANNING_RE = /^\s*(?:SCHEDULED|DEADLINE|CLOSED):/
const PLANNING_ITEM_RE = /(SCHEDULED|DEADLINE|CLOSED):\s*([<[][^>\]]+[>\]](?:--[<[][^>\]]+[>\]])?)/g
const DRAWER_START_RE = /^\s*:([\w-]+):\s*$/
const DRAWER_END_RE = /^\s*:END:\s*$/i
const CLOCK_RE = /^\s*CLOCK:\s*(\[[^\]]+\])(?:--(\[[^\]]+\]))?/
// Letters and digits of any language, as Emacs allows (e.g. :urgência:).
const TAGS_RE = /(?:^|[ \t]+)(:(?:[\p{L}\p{N}_@#%]+:)+)[ \t]*$/u
export const ITEM_RE = /^(\s*)([-+]|\d+[.)]|\*(?=\s))(?:\s+(.*))?$/
const COOKIE_RE = /\[(\d*%|\d*\/\d*)\]/

const indentOf = (l: string) => /^\s*/.exec(l)![0].length
const isBlank = (l: string) => l.trim() === ''

export function parseTodoKeywords(spec: string[]): TodoKeywords {
  if (!spec.length) return { todo: ['TODO'], done: ['DONE'] }
  const res: TodoKeywords = { todo: [], done: [] }
  for (const s of spec) {
    const words = s.split(/\s+/).filter(Boolean).map((w) => w.replace(/\(.*\)$/, ''))
    const bar = words.indexOf('|')
    if (bar >= 0) {
      res.todo.push(...words.slice(0, bar))
      res.done.push(...words.slice(bar + 1))
    } else {
      res.todo.push(...words.slice(0, -1))
      res.done.push(...words.slice(-1))
    }
  }
  return res
}

export function parseHeadlineLine(line: string, kw: TodoKeywords) {
  const m = HEADLINE_RE.exec(line)
  if (!m) return undefined
  let rest = m[2] ?? ''
  let tags: string[] = []
  const t = TAGS_RE.exec(rest)
  if (t) {
    tags = t[1].split(':').filter(Boolean)
    rest = rest.slice(0, t.index)
  }
  let keyword: string | undefined
  const first = /^(\S+)(?:\s+|$)/.exec(rest)
  if (first && (kw.todo.includes(first[1]) || kw.done.includes(first[1]))) {
    keyword = first[1]
    rest = rest.slice(first[0].length)
  }
  let priority: string | undefined
  const p = /^\[#([A-Z0-9])\](?:\s+|$)/.exec(rest)
  if (p) {
    priority = p[1]
    rest = rest.slice(p[0].length)
  }
  return { level: m[1].length, keyword, priority, title: rest.trim(), tags }
}

export function serializeHeadline(h: { level: number; keyword?: string; priority?: string; title: string; tags: string[] }): string {
  let s = '*'.repeat(h.level)
  if (h.keyword) s += ' ' + h.keyword
  if (h.priority) s += ` [#${h.priority}]`
  if (h.title) s += ' ' + h.title
  if (h.tags.length) {
    const tags = `:${h.tags.join(':')}:`
    s += ' '.repeat(Math.max(1, 77 - s.length - tags.length)) + tags
  }
  return s
}

export function parseOrg(text: string): OrgDoc {
  const lines = text.split('\n')
  const keywords: Record<string, string> = {}
  const todoSpecs: string[] = []
  let firstHeadline = lines.length
  lines.forEach((l, i) => {
    const k = /^\s*#\+(\w+):\s*(.*)$/.exec(l)
    if (k) {
      const key = k[1].toUpperCase()
      if (['TODO', 'SEQ_TODO', 'TYP_TODO'].includes(key)) todoSpecs.push(k[2])
      else keywords[key] = keywords[key] ? `${keywords[key]} ${k[2]}` : k[2]
    }
    if (firstHeadline === lines.length && HEADLINE_RE.test(l)) firstHeadline = i
  })
  const todo = parseTodoKeywords(todoSpecs)
  const doc: OrgDoc = {
    lines,
    keywords,
    todo,
    filetags: (keywords.FILETAGS ?? '').split(/[:\s]+/).filter(Boolean),
    startup: (keywords.STARTUP ?? '').toLowerCase(),
    headlines: [],
    all: [],
    preambleEnd: firstHeadline,
  }

  const stack: Headline[] = []
  const seen = new Map<string, number>()
  for (let i = firstHeadline; i < lines.length; i++) {
    const p = parseHeadlineLine(lines[i], todo)
    if (!p) continue
    while (stack.length && stack[stack.length - 1].level >= p.level) stack.pop()
    const parent = stack[stack.length - 1]
    let key = (parent ? parent.key + '/' : '') + p.title
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    if (n) key += `#${n}`
    const h: Headline = {
      ...p,
      key,
      done: !!p.keyword && todo.done.includes(p.keyword),
      line: i,
      contentEnd: i + 1,
      end: i + 1,
      bodyStart: i + 1,
      planning: {},
      properties: {},
      clocks: [],
      timestamps: [],
      children: [],
      parent,
    }
    if (parent) parent.children.push(h)
    else doc.headlines.push(h)
    doc.all.push(h)
    stack.push(h)
  }

  doc.all.forEach((h, idx) => {
    const next = doc.all[idx + 1]
    h.contentEnd = next ? next.line : lines.length
    let end = lines.length
    for (let j = idx + 1; j < doc.all.length; j++)
      if (doc.all[j].level <= h.level) {
        end = doc.all[j].line
        break
      }
    h.end = end
    parseEntryMeta(h, lines)
  })
  return doc
}

function parseEntryMeta(h: Headline, lines: string[]) {
  let i = h.line + 1
  if (i < h.contentEnd && PLANNING_RE.test(lines[i])) {
    h.planningLine = i
    for (const m of lines[i].matchAll(PLANNING_ITEM_RE)) {
      const ts = parseTimestamp(m[2])
      if (ts) h.planning[m[1].toLowerCase() as 'scheduled'] = ts
    }
    i++
  }
  // Drawers directly after the headline/planning.
  while (i < h.contentEnd && DRAWER_START_RE.test(lines[i])) {
    const name = DRAWER_START_RE.exec(lines[i])![1].toUpperCase()
    let j = i + 1
    while (j < h.contentEnd && !DRAWER_END_RE.test(lines[j])) j++
    if (j >= h.contentEnd) break
    if (name === 'PROPERTIES') {
      h.propertiesRange = [i, j]
      for (let k = i + 1; k < j; k++) {
        const m = /^\s*:([^:\s]+):\s*(.*)$/.exec(lines[k])
        if (m) h.properties[m[1]] = m[2].trim()
      }
    } else if (name === 'LOGBOOK') h.logbookRange = [i, j]
    else break
    i = j + 1
  }
  h.bodyStart = i
  for (let k = h.line + 1; k < h.contentEnd; k++) {
    const c = CLOCK_RE.exec(lines[k])
    if (c) {
      const start = parseTimestamp(c[1])
      const end = c[2] ? parseTimestamp(c[2]) : undefined
      if (start) h.clocks.push({ line: k, start, end, minutes: end ? wallMinutes(start, end) : 0 })
    }
  }
  const scan = [h.title, ...lines.slice(h.bodyStart, h.contentEnd)]
  for (const l of scan)
    for (const m of l.matchAll(TIMESTAMP_RE)) {
      const ts = parseTimestamp(m[0])
      if (ts?.active) h.timestamps.push(ts)
    }
}

/** Tags of a headline including inherited and file tags. */
export function allTags(h: Headline, doc: OrgDoc): string[] {
  const set = new Set(doc.filetags)
  for (let p: Headline | undefined = h; p; p = p.parent) p.tags.forEach((t) => set.add(t))
  return [...set]
}

export function outlinePath(h: Headline): string[] {
  const path: string[] = []
  for (let p = h.parent; p; p = p.parent) path.unshift(p.title)
  return path
}

// ---------- Section content ----------

export function parseBlocks(lines: string[], base = 0): Block[] {
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (isBlank(l)) {
      i++
      continue
    }
    const line = base + i
    const begin = /^\s*#\+begin_(\w+)\s*(.*)$/i.exec(l)
    if (begin) {
      const name = begin[1].toLowerCase()
      let j = i + 1
      while (j < lines.length && !new RegExp(`^\\s*#\\+end_${name}\\s*$`, 'i').test(lines[j])) j++
      const content = lines.slice(i + 1, j)
      const strip = name === 'src' || name === 'example' ? Math.min(...content.filter((c) => !isBlank(c)).map(indentOf), 99) : 0
      blocks.push({
        type: 'block',
        line,
        name,
        params: begin[2],
        content: content.map((c) => c.slice(strip).replace(/^(\s*),([*#])/, '$1$2')).join('\n'),
      })
      i = j + 1
      continue
    }
    const drawer = DRAWER_START_RE.exec(l)
    if (drawer) {
      let j = i + 1
      while (j < lines.length && !DRAWER_END_RE.test(lines[j])) j++
      if (j < lines.length) {
        blocks.push({ type: 'drawer', line, name: drawer[1], content: lines.slice(i + 1, j).join('\n') })
        i = j + 1
        continue
      }
    }
    if (/^\s*\|/.test(l)) {
      const rows: (string[] | 'hr')[] = []
      let formula: string | undefined
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const r = lines[i].trim()
        rows.push(/^\|[-+]+\|?$/.test(r) ? 'hr' : r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
        i++
      }
      while (i < lines.length && /^\s*#\+TBLFM:/i.test(lines[i])) formula = lines[i++].replace(/^\s*#\+TBLFM:\s*/i, '')
      blocks.push({ type: 'table', line, rows, formula })
      continue
    }
    const kw = /^\s*#\+(\w+):\s*(.*)$/.exec(l)
    if (kw) {
      blocks.push({ type: 'keyword', line, key: kw[1].toUpperCase(), value: kw[2] })
      i++
      continue
    }
    if (/^\s*#(\s|$)/.test(l) || PLANNING_RE.test(l)) {
      i++
      continue
    }
    if (/^\s*-{5,}\s*$/.test(l)) {
      blocks.push({ type: 'hr', line })
      i++
      continue
    }
    if (/^\s*:(\s|$)/.test(l)) {
      const content: string[] = []
      while (i < lines.length && /^\s*:(\s|$)/.test(lines[i])) content.push(lines[i++].replace(/^\s*: ?/, ''))
      blocks.push({ type: 'fixed', line, content: content.join('\n') })
      continue
    }
    const fn = /^\[fn:([\w-]+)\]\s*(.*)$/.exec(l)
    if (fn) {
      blocks.push({ type: 'footnote', line, label: fn[1], text: fn[2] })
      i++
      continue
    }
    if (ITEM_RE.test(l)) {
      const { block, next } = parseList(lines, i, base)
      blocks.push(block)
      i = next
      continue
    }
    const para: string[] = []
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i])) para.push(lines[i++].trim())
    if (!para.length) para.push(lines[i++].trim())
    blocks.push({ type: 'paragraph', line, text: para.join('\n') })
  }
  return blocks
}

function startsBlock(l: string) {
  return /^\s*(#\+|\||:[\w-]*:\s*$|:(\s|$)|-{5,}\s*$|#(\s|$))/.test(l) || ITEM_RE.test(l) || /^\[fn:/.test(l) || PLANNING_RE.test(l)
}

function parseList(lines: string[], start: number, base: number): { block: Block; next: number } {
  const indent = indentOf(lines[start])
  const items: ListItem[] = []
  let ordered = false
  let i = start
  while (i < lines.length) {
    const m = ITEM_RE.exec(lines[i])
    if (!m || m[1].length !== indent) break
    ordered = /\d/.test(m[2])
    let j = i + 1
    const content: string[] = []
    while (j < lines.length) {
      if (isBlank(lines[j])) {
        let k = j
        while (k < lines.length && isBlank(lines[k])) k++
        if (k < lines.length && k - j < 2 && indentOf(lines[k]) > indent) {
          content.push(...lines.slice(j, k))
          j = k
          continue
        }
        break
      }
      if (indentOf(lines[j]) <= indent) break
      content.push(lines[j++])
    }
    let text = m[3] ?? ''
    const item: ListItem = { line: base + i, bullet: m[2], text, children: parseBlocks(content, base + i + 1) }
    const cb = /^\[([ Xx-])\](?:\s+|$)/.exec(text)
    if (cb) {
      item.checkbox = cb[1].toUpperCase() as 'X'
      text = text.slice(cb[0].length)
    }
    const term = !ordered && /^(.*?)\s+::(?:\s+(.*)|$)/.exec(text)
    if (term) {
      item.term = term[1]
      text = term[2] ?? ''
    }
    item.text = text
    items.push(item)
    i = j
    // A single blank line between items of the same list does not end it.
    if (i < lines.length && isBlank(lines[i]) && i + 1 < lines.length) {
      const n = ITEM_RE.exec(lines[i + 1])
      if (n && n[1].length === indent) i++
    }
  }
  return { block: { type: 'list', line: base + start, ordered, items }, next: i }
}

export function sectionBlocks(doc: OrgDoc, h?: Headline): Block[] {
  const [s, e] = h ? [h.bodyStart, h.contentEnd] : [0, doc.preambleEnd]
  return parseBlocks(doc.lines.slice(s, e), s)
}

// ---------- Statistics cookies ----------

function updateCookie(line: string, done: number, total: number): string {
  return line.replace(COOKIE_RE, (_, c: string) =>
    c.endsWith('%') ? `[${total ? Math.round((100 * done) / total) : 0}%]` : `[${done}/${total}]`,
  )
}

function forEachItem(blocks: Block[], fn: (item: ListItem) => void) {
  for (const b of blocks) if (b.type === 'list') b.items.forEach((it) => (fn(it), forEachItem(it.children, fn)))
}

const topCheckboxes = (blocks: Block[]) =>
  blocks.flatMap((b) => (b.type === 'list' ? b.items.filter((i) => i.checkbox) : []))

/** Recomputes every [n/m] and [%] cookie on headlines and list items. */
export function refreshCookies(text: string): string {
  const doc = parseOrg(text)
  const lines = [...doc.lines]
  const sections: { blocks: Block[]; h?: Headline }[] = [{ blocks: sectionBlocks(doc) }]
  doc.all.forEach((h) => sections.push({ h, blocks: sectionBlocks(doc, h) }))
  for (const { h, blocks } of sections) {
    forEachItem(blocks, (it) => {
      if (!COOKIE_RE.test(it.text)) return
      const boxes = topCheckboxes(it.children)
      lines[it.line] = updateCookie(lines[it.line], boxes.filter((b) => b.checkbox === 'X').length, boxes.length)
    })
    if (h && COOKIE_RE.test(h.title)) {
      const boxes = topCheckboxes(blocks)
      const todos = h.children.filter((c) => c.keyword)
      const [done, total] = boxes.length
        ? [boxes.filter((b) => b.checkbox === 'X').length, boxes.length]
        : [todos.filter((c) => c.done).length, todos.length]
      lines[h.line] = updateCookie(lines[h.line], done, total)
    }
  }
  return lines.join('\n')
}
