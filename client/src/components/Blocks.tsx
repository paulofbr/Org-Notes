import { useState, type ReactNode } from 'react'
import { parseBlocks, type Block, type ListItem } from '../org/parser'
import { Inline, type InlineOptions } from './Inline'
import { tr } from '../i18n'

export interface BlockOptions extends InlineOptions {
  onCheckbox?: (line: number) => void
}

export function Blocks({ blocks, opts = {} }: { blocks: Block[]; opts?: BlockOptions }) {
  return (
    <>
      {blocks.map((b) => (
        <BlockView key={b.line} b={b} opts={opts} />
      ))}
    </>
  )
}

function BlockView({ b, opts }: { b: Block; opts: BlockOptions }) {
  switch (b.type) {
    case 'paragraph':
      return <p><Inline text={b.text} opts={opts} /></p>
    case 'list': {
      const Tag = b.items.some((i) => i.term !== undefined) ? 'dl' : b.ordered ? 'ol' : 'ul'
      if (Tag === 'dl')
        return (
          <dl>
            {b.items.map((it) => (
              <div key={it.line}>
                <dt><Inline text={it.term ?? ''} opts={opts} /></dt>
                <dd><Inline text={it.text} opts={opts} /><Blocks blocks={it.children} opts={opts} /></dd>
              </div>
            ))}
          </dl>
        )
      return <Tag className={b.items.some((i) => i.checkbox) ? 'checklist' : undefined}>{b.items.map((it) => <Item key={it.line} it={it} opts={opts} />)}</Tag>
    }
    case 'table':
      return (
        <div className="table-wrap">
          <table>
            {(() => {
              const hr = b.rows.indexOf('hr')
              const head = hr > 0 ? (b.rows.slice(0, hr).filter((r) => r !== 'hr') as string[][]) : []
              const body = (hr > 0 ? b.rows.slice(hr) : b.rows).filter((r) => r !== 'hr') as string[][]
              return (
                <>
                  {head.length > 0 && <thead>{head.map((r, i) => <tr key={i}>{r.map((c, j) => <th key={j}><Inline text={c} opts={opts} /></th>)}</tr>)}</thead>}
                  <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={/^[-+]?[\d.,]+%?$/.test(c) ? 'num' : undefined}><Inline text={c} opts={opts} /></td>)}</tr>)}</tbody>
                </>
              )
            })()}
          </table>
        </div>
      )
    case 'block':
      switch (b.name) {
        case 'src':
          return <CodeBlock lang={b.params.split(/\s+/)[0]} content={b.content} />
        case 'example':
          return <pre className="example">{b.content}</pre>
        case 'quote':
          return <blockquote><Blocks blocks={parseInner(b.content)} opts={opts} /></blockquote>
        case 'verse':
          return <p className="verse"><Inline text={b.content} opts={opts} /></p>
        case 'center':
          return <div className="center"><Blocks blocks={parseInner(b.content)} opts={opts} /></div>
        case 'comment':
          return null
        case 'export':
          return b.params.trim().toLowerCase() === 'html' ? <div dangerouslySetInnerHTML={{ __html: b.content }} /> : null
        default:
          return <div className={`special-block ${b.name}`}><div className="label">{b.name}</div><Blocks blocks={parseInner(b.content)} opts={opts} /></div>
      }
    case 'drawer':
      return <Drawer name={b.name} content={b.content} />
    case 'fixed':
      return <pre className="example">{b.content}</pre>
    case 'hr':
      return <hr />
    case 'footnote':
      return (
        <p className="footnote" id={`fn-${b.label}`}>
          <a href={`#fnr-${b.label}`}>{b.label}</a> <Inline text={b.text} opts={opts} />
        </p>
      )
    case 'keyword':
      return b.key === 'CAPTION' ? <p className="caption"><Inline text={b.value} opts={opts} /></p> : null
  }
}

const parseInner = (content: string) => parseBlocks(content.split('\n'), -1e6)

function Item({ it, opts }: { it: ListItem; opts: BlockOptions }) {
  return (
    <li className={it.checkbox ? `cb ${it.checkbox === 'X' ? 'checked' : ''}` : undefined}>
      {it.checkbox && (
        <input
          type="checkbox"
          checked={it.checkbox === 'X'}
          ref={(el) => {
            if (el) el.indeterminate = it.checkbox === '-'
          }}
          disabled={!opts.onCheckbox || it.line < 0}
          onChange={() => opts.onCheckbox?.(it.line)}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <span><Inline text={it.text} opts={opts} /></span>
      {it.children.length > 0 && <Blocks blocks={it.children} opts={opts} />}
    </li>
  )
}

export function Drawer({ name, content }: { name: string; content: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="drawer">
      <button className="drawer-toggle" onClick={(e) => (e.stopPropagation(), setOpen(!open))}>
        {open ? '▾' : '▸'} {name}
      </button>
      {open && <pre>{content}</pre>}
    </div>
  )
}

const KEYWORDS = /\b(def|class|return|if|else|elif|for|while|import|from|as|function|const|let|var|new|public|private|static|void|int|string|bool|true|false|null|None|True|False|async|await|using|namespace|interface|type|export|try|catch|finally|throw|lambda|in|of|fn|match|struct|enum|impl|select|where|insert|update|delete|create|table)\b/
const TOKEN = new RegExp(String.raw`(;.*$|#(?![+'(]).*$|//.*$|--.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\x60(?:[^\x60\\]|\\.)*\x60)|(\b\d+(?:\.\d+)?\b)|${KEYWORDS.source}`, 'gm')

function CodeBlock({ lang, content }: { lang: string; content: string }) {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of content.matchAll(TOKEN)) {
    if (m.index > last) parts.push(content.slice(last, m.index))
    const cls = m[1] ? 'tok-comment' : m[2] ? 'tok-string' : m[3] ? 'tok-number' : 'tok-keyword'
    parts.push(<span key={m.index} className={cls}>{m[0]}</span>)
    last = m.index + m[0].length
  }
  parts.push(content.slice(last))
  return (
    <div className="src">
      {lang && <span className="lang">{lang}</span>}
      <button className="copy" onClick={(e) => (e.stopPropagation(), navigator.clipboard?.writeText(content))}>{tr('Copiar')}</button>
      <pre><code>{parts}</code></pre>
    </div>
  )
}
