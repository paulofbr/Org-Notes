import { emptyProps, templatesIn, type CaptureTemplate } from './capture'
import { descriptionOf, setDescription, setProperty, setTags, setTitle } from './edit'
import { parseOrg, type Headline, type OrgDoc } from './parser'

/** What the entry form shows and saves: the same fields the file's capture form asks for, filled in. */
export interface EntryFormValues {
  title: string
  props: Record<string, string>
  tags: string[]
  body: string
}

// Properties the app or org keep for themselves, not shown as form fields.
const INTERNAL = new Set(['ID', 'CUSTOM_ID', 'LAST_REPEAT', 'STYLE', 'ARCHIVE_TIME', 'ARCHIVE_FILE', 'ARCHIVE_OLPATH', 'ARCHIVE_CATEGORY', 'ARCHIVE_TODO', 'ORDERED', 'CATEGORY', 'VISIBILITY'])

/** The file's template that best fits the entry: the one whose fields it has most of (the first one on a tie). */
export function templateFor(path: string, text: string, h: Headline): CaptureTemplate | undefined {
  const own = new Set(Object.keys(h.properties).map((k) => k.toUpperCase()))
  const score = (t: CaptureTemplate) => emptyProps(t).filter((k) => own.has(k.toUpperCase())).length
  const templates = templatesIn(path, text).filter((t) => emptyProps(t).length > 0)
  return templates.reduce<CaptureTemplate | undefined>((best, t) => (!best || score(t) > score(best) ? t : best), undefined)
}

/** The form's fields, in order: the template's, then any other the entry has (e.g. added by hand). */
export function formFields(tpl: CaptureTemplate | undefined, h: Headline): string[] {
  const fields = tpl ? emptyProps(tpl) : []
  const seen = new Set(fields.map((k) => k.toUpperCase()))
  for (const k of Object.keys(h.properties)) if (!seen.has(k.toUpperCase()) && !INTERNAL.has(k.toUpperCase())) (fields.push(k), seen.add(k.toUpperCase()))
  return fields
}

const valueOf = (h: Headline, key: string) => Object.entries(h.properties).find(([k]) => k.toUpperCase() === key.toUpperCase())?.[1] ?? ''
const keyOf = (h: Headline, key: string) => Object.keys(h.properties).find((k) => k.toUpperCase() === key.toUpperCase()) ?? key

/** The entry's current values for the form. */
export function formValues(doc: OrgDoc, h: Headline, fields: string[]): EntryFormValues {
  return {
    title: h.title,
    props: Object.fromEntries(fields.map((k) => [k, valueOf(h, k)])),
    tags: [...h.tags],
    body: descriptionOf(doc, h),
  }
}

/** The text with the entry at `line` changed to the form's values; only what changed is touched. */
export function saveForm(text: string, line: number, v: EntryFormValues): string {
  const h = parseOrg(text).all.find((x) => x.line === line)
  if (!h) throw new Error('A entrada já não existe')
  let out = text
  const title = v.title.trim()
  if (title && title !== h.title) out = setTitle(out, line, title)
  for (const [k, value] of Object.entries(v.props)) {
    const now = value.trim()
    if (now !== valueOf(h, k).trim()) out = setProperty(out, line, keyOf(h, k), now || undefined)
  }
  if (v.tags.join(':') !== h.tags.join(':')) out = setTags(out, line, v.tags)
  const doc = parseOrg(out)
  const after = doc.all.find((x) => x.line === line)!
  if (v.body.replace(/\s+$/, '') !== descriptionOf(doc, after)) out = setDescription(out, line, v.body)
  return out
}
