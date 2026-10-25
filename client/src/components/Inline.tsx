import type { ReactNode } from 'react'
import { TIMESTAMP_RE, parseTimestamp, toDate } from '../org/timestamp'

export interface InlineOptions {
  onLink?: (target: string) => void
}

const PATTERNS: [string, RegExp][] = [
  ['link', /\[\[([^\]]+)\](?:\[([^\]]+)\])?\]/],
  ['timestamp', new RegExp(TIMESTAMP_RE.source)],
  ['footnote', /\[fn:([\w-]+)\]/],
  ['cookie', /\[(\d*%|\d*\/\d*)\]/],
  ['markup', /([*/_=~+])(\S|\S[^\n]*?\S)\1(?=$|[\s\-.,:!?;'")}\[\]])/],
  ['url', /https?:\/\/[^\s<>\]\)]+/],
  ['break', /\\\\$/m],
]

const PRE = /[\s(\-'"{]/
const IMAGE = /\.(png|jpe?g|gif|svg|webp)$/i

export function formatDate(key: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return toDate(key).toLocaleDateString(undefined, opts)
}

/** Renders org inline markup (emphasis, links, timestamps, footnotes...) to React nodes. */
export function Inline({ text, opts = {} }: { text: string; opts?: InlineOptions }) {
  return <>{renderInline(text, opts)}</>
}

function renderInline(text: string, opts: InlineOptions): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let key = 0
  while (rest) {
    let best: { kind: string; m: RegExpExecArray } | undefined
    for (const [kind, re] of PATTERNS) {
      let from = 0
      let m: RegExpExecArray | null
      // Markup must be preceded by start or whitespace/punctuation.
      while ((m = re.exec(rest.slice(from)))) {
        m.index += from
        if (kind !== 'markup' || m.index === 0 || PRE.test(rest[m.index - 1])) break
        from = m.index + 1
      }
      if (m && (!best || m.index < best.m.index)) best = { kind, m }
    }
    if (!best) {
      out.push(rest)
      break
    }
    const { kind, m } = best
    if (m.index > 0) out.push(rest.slice(0, m.index))
    out.push(renderToken(kind, m, opts, key++))
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}

function renderToken(kind: string, m: RegExpExecArray, opts: InlineOptions, key: number): ReactNode {
  switch (kind) {
    case 'link': {
      const [, target, desc] = m
      if (IMAGE.test(target) && !desc && /^https?:/.test(target)) return <img key={key} src={target} alt="" className="org-img" />
      const external = /^(https?|mailto):/.test(target)
      return (
        <a
          key={key}
          href={external ? target : '#'}
          target={external ? '_blank' : undefined}
          rel="noreferrer"
          onClick={(e) => {
            if (external) return
            e.preventDefault()
            e.stopPropagation()
            opts.onLink?.(target)
          }}
        >
          {desc ? renderInline(desc, opts) : target}
        </a>
      )
    }
    case 'url':
      return <a key={key} href={m[0]} target="_blank" rel="noreferrer">{m[0]}</a>
    case 'timestamp': {
      const ts = parseTimestamp(m[0])
      return (
        <span key={key} className={`ts ${ts?.active ? 'active' : 'inactive'}`} title={m[0]}>
          {ts ? `${formatDate(ts.date)}${ts.time ? ' ' + ts.time : ''}${ts.endTime ? '–' + ts.endTime : ''}${ts.end ? ' → ' + formatDate(ts.end.date) : ''}${ts.repeater ? ` (${ts.repeater.type}${ts.repeater.n}${ts.repeater.unit})` : ''}` : m[0]}
        </span>
      )
    }
    case 'footnote':
      return <sup key={key}><a href={`#fn-${m[1]}`} id={`fnr-${m[1]}`}>{m[1]}</a></sup>
    case 'cookie': {
      const [done, total] = m[1].includes('/') ? m[1].split('/').map(Number) : [Number(m[1].replace('%', '')), 100]
      return <span key={key} className={`cookie ${total && done >= total ? 'complete' : ''}`}>{m[1]}</span>
    }
    case 'break':
      return <br key={key} />
    default: {
      const inner = m[2]
      switch (m[1]) {
        case '*': return <strong key={key}>{renderInline(inner, opts)}</strong>
        case '/': return <em key={key}>{renderInline(inner, opts)}</em>
        case '_': return <u key={key}>{renderInline(inner, opts)}</u>
        case '+': return <del key={key}>{renderInline(inner, opts)}</del>
        case '=': return <code key={key} className="verbatim">{inner}</code>
        default: return <code key={key}>{inner}</code>
      }
    }
  }
}
