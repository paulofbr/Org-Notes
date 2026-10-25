export interface FileInfo {
  path: string
  size: number
  modified: string
}

const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/')

async function check(res: Response) {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res
}

export const api = {
  list: async (): Promise<FileInfo[]> => (await check(await fetch('/api/files'))).json(),
  read: async (path: string) => (await check(await fetch(`/api/files/${enc(path)}`))).text(),
  write: async (path: string, text: string) =>
    check(await fetch(`/api/files/${enc(path)}`, { method: 'PUT', body: text, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })),
  remove: async (path: string) => check(await fetch(`/api/files/${enc(path)}`, { method: 'DELETE' })),
  rename: async (from: string, to: string) =>
    check(await fetch('/api/rename', { method: 'POST', body: JSON.stringify({ from, to }), headers: { 'Content-Type': 'application/json' } })),
}
