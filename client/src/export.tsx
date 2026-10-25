import { renderToStaticMarkup } from 'react-dom/server'
import { sectionBlocks, type Headline, type OrgDoc } from './org/parser'
import { Blocks } from './components/Blocks'
import { Inline } from './components/Inline'

function Section({ doc, h }: { doc: OrgDoc; h: Headline }) {
  const Tag = `h${Math.min(h.level + 1, 6)}` as 'h2'
  return (
    <section>
      <Tag>
        {h.keyword && <span className={`kw ${h.done ? 'done' : 'todo'}`}>{h.keyword}</span>} {h.priority && <span className="prio">[#{h.priority}]</span>} <Inline text={h.title} />
        {h.tags.map((t) => <span key={t} className="tag">{t}</span>)}
      </Tag>
      {(h.planning.scheduled || h.planning.deadline || h.planning.closed) && (
        <p className="planning">{(['deadline', 'scheduled', 'closed'] as const).filter((k) => h.planning[k]).map((k) => `${k.toUpperCase()}: ${h.planning[k]!.date}${h.planning[k]!.time ? ' ' + h.planning[k]!.time : ''}`).join('  ')}</p>
      )}
      <Blocks blocks={sectionBlocks(doc, h)} />
      {h.children.map((c) => <Section key={c.key} doc={doc} h={c} />)}
    </section>
  )
}

const CSS = `body{font:16px/1.6 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1f2328}
h1{font-size:2rem}h2,h3,h4,h5,h6{margin:1.6em 0 .4em}.kw{font-size:.7em;padding:.1em .4em;border-radius:4px;margin-right:.3em}
.kw.todo{background:#fde2e1;color:#b42318}.kw.done{background:#dcfce7;color:#166534}.tag{font-size:.65em;background:#eef;border-radius:99px;padding:.1em .5em;margin-left:.4em;font-weight:400}
.planning{color:#666;font-size:.85em;margin:0}pre{background:#f6f8fa;padding:1em;border-radius:6px;overflow:auto}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:.3em .7em}
td.num{text-align:right}blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:1em;color:#555}.ts{color:#555}.lang,.copy,.drawer{display:none}`

export function exportHtml(doc: OrgDoc, title: string): string {
  const body = renderToStaticMarkup(
    <>
      <h1>{title}</h1>
      <Blocks blocks={sectionBlocks(doc)} />
      {doc.headlines.map((h) => <Section key={h.key} doc={doc} h={h} />)}
    </>,
  )
  const esc = title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
  return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc}</title><style>${CSS}</style></head><body>${body}</body></html>\n`
}

export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}
