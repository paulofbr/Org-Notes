import { dateKey } from './org/timestamp'
export interface FileInfo {
  path: string
  size: number
  modified: string
}

const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/')

/** This computer's wall-clock time without a zone, as the server reads it (relative dates follow the user's clock). */
const localNow = (d = new Date()) => `${dateKey(d)}T${d.toTimeString().slice(0, 8)}`

export interface Me {
  email?: string
  ai: boolean
  token: string
  ntfy: { server: string; topic: string; enabled: boolean }
  lang?: string
  /** Emails whose AI-proposed items wait for review. */
  inbox: number
  admin: boolean
  windowsInstaller: boolean
}

/** An item the AI proposes from free text, for one of the user's templates. */
export interface ProposedItem {
  file: string
  key: string
  template: string
  title: string
  date: string
  time: string
  body: string
  props: Record<string, string>
  tags: string[]
}

/** A reminder to show between `from` and `until` (the user's wall-clock time). */
export interface Reminder {
  id: string
  from: string
  until: string
  title: string
  body: string
}

export interface MailAccount {
  host: string
  port: number
  user: string
  folder: string
  enabled: boolean
  lastCheck?: string
  lastError?: string
}

export interface InboxEntry {
  id: string
  from: string
  subject: string
  date: string
  items: ProposedItem[]
}

export interface Login {
  email: string
  /** From the server's configuration: cannot be removed on the site. */
  fixed: boolean
  admin: boolean
  hasPassword: boolean
}

async function check(res: Response) {
  // Session expired: reloading sends the browser to the login page.
  if (res.status === 401) location.reload()
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res
}

export const api = {
  list: async (): Promise<FileInfo[]> => (await check(await fetch('/api/files'))).json(),
  read: async (path: string) => (await check(await fetch(`/api/files/${enc(path)}`))).text(),
  write: async (path: string, text: string) =>
    check(await fetch(`/api/files/${enc(path)}`, { method: 'PUT', body: text, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })),
  remove: async (path: string) => check(await fetch(`/api/files/${enc(path)}`, { method: 'DELETE' })),
  folders: async (): Promise<string[]> => (await check(await fetch('/api/folders'))).json(),
  createFolder: async (path: string) =>
    check(await fetch('/api/folders', { method: 'POST', body: JSON.stringify({ path }), headers: { 'Content-Type': 'application/json' } })),
  removeFolder: async (path: string) => check(await fetch(`/api/folders/${enc(path)}`, { method: 'DELETE' })),
  rename: async (from: string, to: string) =>
    check(await fetch('/api/rename', { method: 'POST', body: JSON.stringify({ from, to }), headers: { 'Content-Type': 'application/json' } })),
  me: async (): Promise<Me> => (await check(await fetch('/api/me'))).json(),
  improve: async (fields: Record<string, string>, mode: string): Promise<{ fields: Record<string, string>; changes: string[] }> => {
    const res = await fetch('/api/ai/improve', { method: 'POST', body: JSON.stringify({ fields, mode }), headers: { 'Content-Type': 'application/json' } })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? `${res.status}`)
    return res.json()
  },
  aiExtract: async (text: string): Promise<ProposedItem[]> => {
    const res = await fetch('/api/ai/extract', { method: 'POST', body: JSON.stringify({ text, now: localNow() }), headers: { 'Content-Type': 'application/json' } })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? `${res.status}`)
    return res.json()
  },
  reminders: async (): Promise<Reminder[]> => (await check(await fetch(`/api/reminders?now=${localNow()}`))).json(),
  mail: async (): Promise<MailAccount | null> => (await check(await fetch('/api/mail'))).json(),
  saveMail: async (account: Omit<MailAccount, 'lastCheck' | 'lastError'> & { password: string }) => {
    const res = await fetch('/api/mail', { method: 'PUT', body: JSON.stringify(account), headers: { 'Content-Type': 'application/json' } })
    if (!res.ok) throw new Error((await res.text()).replace(/^"|"$/g, ''))
  },
  removeMail: async () => check(await fetch('/api/mail', { method: 'DELETE' })),
  checkMail: async (): Promise<{ lastError?: string; inbox: number }> => (await check(await fetch('/api/mail/check', { method: 'POST' }))).json(),
  inbox: async (): Promise<InboxEntry[]> => (await check(await fetch('/api/inbox'))).json(),
  removeInbox: async (id: string) => check(await fetch(`/api/inbox/${encodeURIComponent(id)}`, { method: 'DELETE' })),
  aiTemplate: async (description: string): Promise<{ name: string; datetree: boolean; body: string; options: { property: string; values: string[] }[] }> => {
    const res = await fetch('/api/ai/template', { method: 'POST', body: JSON.stringify({ description }), headers: { 'Content-Type': 'application/json' } })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? `${res.status}`)
    return res.json()
  },
  uploadImage: async (file: string, image: Blob): Promise<{ path: string }> =>
    (await check(await fetch(`/api/images?file=${encodeURIComponent(file)}`, { method: 'POST', body: image, headers: { 'Content-Type': image.type || 'application/octet-stream' } }))).json(),
  uploadIcon: async (png: Blob): Promise<{ name: string }> =>
    (await check(await fetch('/api/icons', { method: 'POST', body: png, headers: { 'Content-Type': 'image/png' } }))).json(),
  newToken: async (): Promise<{ token: string }> => (await check(await fetch('/api/me/token', { method: 'POST' }))).json(),
  logins: async (): Promise<Login[]> => (await check(await fetch('/api/admin/logins'))).json(),
  addLogin: async (email: string) => {
    const res = await fetch('/api/admin/logins', { method: 'POST', body: JSON.stringify({ email }), headers: { 'Content-Type': 'application/json' } })
    if (!res.ok) throw new Error((await res.text()).replace(/^"|"$/g, ''))
  },
  removeLogin: async (email: string) => check(await fetch(`/api/admin/logins/${encodeURIComponent(email)}`, { method: 'DELETE' })),
  setLang: async (lang: string) =>
    check(await fetch('/api/me/lang', { method: 'PUT', body: JSON.stringify({ lang }), headers: { 'Content-Type': 'application/json' } })),
  setNotify: async (enabled: boolean) =>
    check(await fetch('/api/me/notify', { method: 'PUT', body: JSON.stringify({ enabled }), headers: { 'Content-Type': 'application/json' } })),
}
