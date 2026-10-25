import { en } from './en'
import { es } from './es'
import { fr } from './fr'

export type Lang = 'pt' | 'en' | 'fr' | 'es'

export const LANGS: [Lang, string][] = [
  ['pt', 'Português'],
  ['en', 'English'],
  ['fr', 'Français'],
  ['es', 'Español'],
]

const LOCALES: Record<Lang, string> = { pt: 'pt-PT', en: 'en', fr: 'fr-FR', es: 'es-ES' }

/** Translations keyed by the Portuguese text, which is also the fallback. */
export const DICTS: Record<Exclude<Lang, 'pt'>, Record<string, string>> = { en, fr, es }

export const isLang = (l: unknown): l is Lang => LANGS.some(([k]) => k === l)

function initial(): Lang {
  try {
    const saved = localStorage.getItem('lang')
    if (isLang(saved)) return saved
  } catch {
    /* storage blocked: fall back to the login page's cookie or the browser's language */
  }
  const cookie = typeof document === 'undefined' ? undefined : /(?:^|; )lang=(\w+)/.exec(document.cookie)?.[1]
  if (isLang(cookie)) return cookie
  const browser = typeof navigator === 'undefined' ? '' : navigator.language.slice(0, 2)
  return isLang(browser) ? browser : 'pt'
}

/** The interface language, fixed for the page's lifetime: changing it reloads the page. */
export const lang: Lang = initial()

/** The locale for dates and numbers in the interface language. */
export const locale = LOCALES[lang]

/** Translates a Portuguese interface text; `{name}` placeholders are filled from `vars`. */
export function tr(text: string, vars?: Record<string, string | number>): string {
  const out = lang === 'pt' ? text : (DICTS[lang][text] ?? text)
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : out
}

/** Remembers the language in the browser and in a cookie (for the server's login page), then reloads. */
export function rememberLang(l: Lang, reload = true) {
  try {
    localStorage.setItem('lang', l)
  } catch {
    /* the cookie still carries it */
  }
  document.cookie = `lang=${l}; path=/; max-age=31536000; samesite=lax`
  if (reload && l !== lang) location.reload()
}
