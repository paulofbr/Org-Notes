const ATTR_RE = /^\s*#\+attr_(?:org|html):(.*)$/i
const ORG_ATTR_RE = /^\s*#\+attr_org:/i

/** The CSS width an `#+ATTR_ORG:` / `#+ATTR_HTML:` line gives the image after it (`:width 400`, `400px` or `50%`). */
export function attrWidth(line: string | undefined): string | undefined {
  const m = line === undefined ? null : ATTR_RE.exec(line)
  const w = m && /:width\s+(\d+(?:\.\d+)?)(px|%)?/i.exec(m[1])
  return w ? `${w[1]}${w[2] === '%' ? '%' : 'px'}` : undefined
}

/**
 * Sets the width of the image at `offset` in an `#+ATTR_ORG:` line just before its line (as Emacs reads it), keeping
 * the line's other attributes; without a width, removes it.
 */
export function setImageWidth(text: string, offset: number, width?: number): string {
  const lines = text.split('\n')
  const idx = text.slice(0, offset).split('\n').length - 1
  const indent = /^\s*/.exec(lines[idx])![0]
  if (idx > 0 && ORG_ATTR_RE.test(lines[idx - 1])) {
    let rest = lines[idx - 1].replace(ORG_ATTR_RE, '').replace(/\s*:width\s+\S+/i, '').trim()
    if (width) rest = `:width ${width}${rest ? ' ' + rest : ''}`
    if (rest) lines[idx - 1] = `${indent}#+ATTR_ORG: ${rest}`
    else lines.splice(idx - 1, 1)
  } else if (width) lines.splice(idx, 0, `${indent}#+ATTR_ORG: :width ${width}`)
  return lines.join('\n')
}
