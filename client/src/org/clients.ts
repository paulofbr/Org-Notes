import { fieldOptions, propertySources } from './capture'
import type { Headline, OrgDoc } from './parser'

/** The property to filter by: the first one any file fills from another file (`#+PROPERTY: CLIENTE_FROM contacts.org`). */
export function clientKey(files: Record<string, string>): string | undefined {
  return Object.keys(files)
    .sort()
    .flatMap((f) => Object.keys(propertySources(files[f])))[0]
}

/** Every value of `key`: the options the templates offer (e.g. the contacts) and the ones already used, sorted. */
export function clientValues(key: string, files: Record<string, string>, docs: Record<string, OrgDoc>): string[] {
  const values = new Set<string>()
  for (const f of Object.keys(files)) fieldOptions(f, files)[key]?.forEach((v) => values.add(v))
  for (const doc of Object.values(docs))
    for (const h of doc.all) {
      const v = valueOf(h, key)
      if (v) values.add(v)
    }
  return [...values].sort((a, b) => a.localeCompare(b))
}

const valueOf = (h: Headline, key: string) => Object.entries(h.properties).find(([k]) => k.toUpperCase() === key)?.[1]?.trim()

/** Whether the headline, or one it sits under (as org's property inheritance), has `key` set to `value`. */
export function hasValue(h: Headline, key: string, value: string): boolean {
  for (let p: Headline | undefined = h; p; p = p.parent) {
    const v = valueOf(p, key)
    if (v) return v === value
  }
  return false
}
