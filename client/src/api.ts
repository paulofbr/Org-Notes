export interface FileInfo {
  path: string
  size: number
  modified: string
}

const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/')

export interface Me {
  email?: string
  ai: boolean
  token: string
  ntfy: { server: string; topic: string; enabled: boolean }
  lang?: string
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
  setLang: async (lang: string) =>
    check(await fetch('/api/me/lang', { method: 'PUT', body: JSON.stringify({ lang }), headers: { 'Content-Type': 'application/json' } })),
  setNotify: async (enabled: boolean) =>
    check(await fetch('/api/me/notify', { method: 'PUT', body: JSON.stringify({ enabled }), headers: { 'Content-Type': 'application/json' } })),
}
