import { describe, expect, it } from 'vitest'
import { DICTS } from '.'

const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.ts'], { query: '?raw', import: 'default', eager: true })
const keys = new Set(Object.values(sources).flatMap((src) => [...src.matchAll(/\btr\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'"))))
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('translations', () => {
  it('finds the interface texts', () => expect(keys.size).toBeGreaterThan(250))

  for (const [lang, dict] of Object.entries(DICTS))
    it(`has every text in ${lang}, with the same placeholders`, () => {
      expect([...keys].filter((k) => !(k in dict))).toEqual([])
      expect([...keys].filter((k) => k in dict && vars(k).join() !== vars(dict[k]).join())).toEqual([])
    })
})
