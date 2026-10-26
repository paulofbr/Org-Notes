import { HEADLINE_RE, type OrgDoc } from './parser'

/** Every tag in use or declared (`#+TAGS:`), sorted: the ones to offer when tagging. */
export function knownTags(docs: Record<string, OrgDoc>): string[] {
  const set = new Set<string>()
  for (const doc of Object.values(docs)) {
    doc.all.forEach((h) => h.tags.forEach((t) => set.add(t)))
    ;(doc.keywords.TAGS ?? '').split(/[\s{}]+/).forEach((t) => t && !t.startsWith('(') && set.add(t.replace(/\(.\)$/, '')))
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** A tag as org accepts it: letters, digits, _ @ # % (spaces become _). */
export const cleanTag = (t: string) => t.trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_@#%]/gu, '')

/** Adds tags to a headline line, after the ones it already has. */
export function addTags(line: string, tags: string[]): string {
  const add = tags.map(cleanTag).filter(Boolean)
  if (!add.length || !HEADLINE_RE.test(line)) return line
  const m = /[ \t]+:((?:[\p{L}\p{N}_@#%]+:)+)[ \t]*$/u.exec(line)
  const all = [...new Set([...(m ? m[1].split(':').filter(Boolean) : []), ...add])]
  return `${m ? line.slice(0, m.index) : line.trimEnd()} :${all.join(':')}:`
}
