// The editable surface of a rich OrgTextarea: plain org text where links show as links and images as images.
// The DOM is kept as text nodes plus one atomic element per link (carrying its org source in data-org),
// so turning it back into text is exact and the rest of the org syntax is never reinterpreted.

import { imageSrc } from '../org/links'
import { attrWidth } from '../org/images'
import { tr } from '../i18n'

const LINK_RE = /\[\[([^\]]+)\](?:\[([^\]]+)\])?\]/g
const IMAGE = /\.(png|jpe?g|gif|webp)$/i

function chip(raw: string, target: string, desc: string | undefined, path: string | undefined, width?: string): HTMLElement {
  const web = /^https?:/.test(target)
  const local = !/^[a-z][\w+.-]*:/i.test(target) || target.startsWith('file:')
  let el: HTMLElement
  if (IMAGE.test(target) && !desc && (web || (local && path))) {
    const img = document.createElement('img')
    img.src = web ? target : imageSrc(path!, target)
    img.alt = ''
    img.className = 'rt-img'
    if (width) {
      img.style.width = width
      img.style.maxHeight = 'none'
    }
    img.title = tr('Arrasta para mudar o tamanho · duplo clique para recortar')
    el = img
  } else {
    el = document.createElement('span')
    el.className = 'rt-link'
    el.textContent = desc ?? target.replace(/^file:/, '')
  }
  if (!el.title) el.title = target
  el.contentEditable = 'false'
  el.dataset.org = raw
  return el
}

/** Replaces the host's content with `value`. */
export function render(host: HTMLElement, value: string, path: string | undefined) {
  // Nothing at all when empty, so CSS :empty can show the placeholder.
  if (!value) return void host.replaceChildren()
  const nodes: Node[] = []
  let last = 0
  for (const m of value.matchAll(LINK_RE)) {
    nodes.push(document.createTextNode(value.slice(last, m.index)))
    // An #+ATTR_ORG: line just before the image's line gives its width, as in the view.
    const lineStart = value.lastIndexOf('\n', m.index - 1) + 1
    const prevLine = lineStart > 0 ? value.slice(value.lastIndexOf('\n', lineStart - 2) + 1, lineStart - 1) : undefined
    nodes.push(chip(m[0], m[1], m[2], path, attrWidth(prevLine)))
    last = m.index + m[0].length
  }
  nodes.push(document.createTextNode(value.slice(last)))
  // A final newline only shows as an empty line with something after it.
  if (value.endsWith('\n')) {
    const tail = document.createElement('br')
    tail.dataset.tail = ''
    nodes.push(tail)
  }
  host.replaceChildren(...nodes)
}

/** Where a chip (or any child of the host) starts in the org text. */
export function offsetOf(host: HTMLElement, node: Node): number {
  let n = 0
  for (const c of host.childNodes) {
    if (c === node) return n
    n += c instanceof Text ? c.length : c instanceof HTMLElement && c.dataset.org !== undefined ? c.dataset.org.length : 0
  }
  return n
}

/** The org text of a node, including what the browser may have added while editing (line breaks, divs). */
export function serialize(node: Node): string {
  let out = ''
  node.childNodes.forEach((n, i) => {
    if (n instanceof Text) out += n.data
    else if (n instanceof HTMLElement && n.dataset.org !== undefined) out += n.dataset.org
    else if (n instanceof HTMLBRElement) out += n.dataset.tail !== undefined ? '' : '\n'
    else if (n instanceof HTMLElement && /^(DIV|P)$/.test(n.tagName)) out += (i > 0 ? '\n' : '') + serialize(n)
    else out += serialize(n)
  })
  return out
}

/** Whether the DOM is still only text and link elements, as `render` makes it. */
export function isCanonical(host: HTMLElement) {
  return [...host.childNodes].every((n, i, all) =>
    n instanceof Text || (n instanceof HTMLElement && n.dataset.org !== undefined) || (n instanceof HTMLBRElement && n.dataset.tail !== undefined && i === all.length - 1))
}

/** The selection as offsets in the org text, or the end of the text when the selection is elsewhere. */
export function getSelection(host: HTMLElement): { start: number; end: number } {
  const sel = window.getSelection()
  const at = (container: Node, offset: number) => {
    const range = document.createRange()
    range.setStart(host, 0)
    range.setEnd(container, offset)
    const box = document.createElement('div')
    box.append(range.cloneContents())
    return serialize(box).length
  }
  if (!sel || !sel.rangeCount || !host.contains(sel.anchorNode)) {
    const end = serialize(host).length
    return { start: end, end }
  }
  const r = sel.getRangeAt(0)
  return { start: at(r.startContainer, r.startOffset), end: at(r.endContainer, r.endOffset) }
}

/** Puts the cursor at an offset in the org text; inside a link it goes after the link. */
export function setCaret(host: HTMLElement, offset: number) {
  const range = document.createRange()
  let left = offset
  let placed = false
  for (const n of host.childNodes) {
    if (n instanceof Text) {
      if (left <= n.length) {
        range.setStart(n, left)
        placed = true
        break
      }
      left -= n.length
    } else if (n instanceof HTMLElement && n.dataset.org !== undefined) {
      if (left < n.dataset.org.length) {
        range.setStartAfter(n)
        placed = true
        break
      }
      left -= n.dataset.org.length
    }
  }
  if (!placed) range.selectNodeContents(host)
  range.collapse(placed)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}
