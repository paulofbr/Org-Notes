/** The build a page's HTML loads: its module script (`/assets/index-<hash>.js` once built). */
export function buildOf(html: string): string | undefined {
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = m[0]
    if (!/\btype=["']module["']/i.test(tag)) continue
    const src = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1]
    if (src) return src
  }
  return undefined
}

const ownBuild = () => document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src') ?? undefined

/**
 * Whether the site now serves a newer build than this page runs, as after a deploy while the desktop app kept its
 * capture page loaded. False when it can't tell (offline, slow, signed out, or the development server).
 */
export async function siteUpdated(timeoutMs = 2000): Promise<boolean> {
  const own = ownBuild()
  if (!own || own.startsWith('/src/')) return false
  try {
    const res = await fetch('/', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return false
    const served = buildOf(await res.text())
    return !!served && served !== own
  } catch {
    return false
  }
}
