import { describe, expect, it } from 'vitest'
import { parseOrg, sectionBlocks } from './parser'
import { setKeyword, toggleCheckbox, clockIn, clockOut, moveSubtree, shiftLevel, refile, archive, alignTable, setPlanning, setProperty } from './edit'
import { agenda, compileMatch, entries } from './agenda'
import { captureInto } from './capture'
import { parseTimestamp } from './timestamp'

const SAMPLE = `#+TODO: TODO NEXT | DONE
#+FILETAGS: :f:
* Tasks [0/2]
** TODO [#A] One :work:
SCHEDULED: <2026-10-20 Tue +1w>
** NEXT Two
DEADLINE: <2026-10-28 Wed>
* Notes
- [ ] a
- [X] b
| a | bb |
|---+----|
| 1 | 2 |
`

describe('parser', () => {
  it('parses headlines, keywords, priorities, tags and planning', () => {
    const doc = parseOrg(SAMPLE)
    expect(doc.all.map((h) => h.title)).toEqual(['Tasks [0/2]', 'One', 'Two', 'Notes'])
    const one = doc.all[1]
    expect([one.keyword, one.priority, one.tags, one.level]).toEqual(['TODO', 'A', ['work'], 2])
    expect(one.planning.scheduled?.repeater).toEqual({ type: '+', n: 1, unit: 'w' })
    expect(doc.all[0].end).toBe(doc.all[3].line)
  })

  it('parses blocks', () => {
    const doc = parseOrg(SAMPLE)
    const types = sectionBlocks(doc, doc.all[3]).map((b) => b.type)
    expect(types).toEqual(['list', 'table'])
  })

  it('parses timestamps with ranges and warnings', () => {
    const ts = parseTimestamp('<2026-10-27 Tue 10:00-11:30 -3d>')!
    expect([ts.date, ts.time, ts.endTime, ts.warning?.n]).toEqual(['2026-10-27', '10:00', '11:30', 3])
  })
})

describe('edits', () => {
  const now = new Date(2026, 9, 25, 9, 30)
  it('marks done with CLOSED and updates cookies', () => {
    const out = setKeyword(SAMPLE, 5, 'DONE', now)
    expect(out).toContain('** DONE Two')
    expect(out).toContain('CLOSED: [2026-10-25 Sun 09:30] DEADLINE: <2026-10-28 Wed>')
    expect(out).toContain('* Tasks [1/2]')
  })

  it('shifts repeaters instead of closing', () => {
    const out = setKeyword(SAMPLE, 3, 'DONE', now)
    expect(out).toContain('** TODO [#A] One')
    expect(out).toContain('SCHEDULED: <2026-10-27 Tue +1w>')
    expect(out).toContain(':LAST_REPEAT: [2026-10-25 Sun 09:30]')
  })

  it('toggles checkboxes', () => {
    expect(toggleCheckbox(SAMPLE, 8)).toContain('- [X] a')
  })

  it('clocks in and out', () => {
    let out = clockIn(SAMPLE, 5, now)
    expect(out).toContain(':LOGBOOK:\nCLOCK: [2026-10-25 Sun 09:30]\n:END:')
    const line = out.split('\n').findIndex((l) => l.startsWith('CLOCK:'))
    out = clockOut(out, line, new Date(2026, 9, 25, 11, 5))
    expect(out).toContain('CLOCK: [2026-10-25 Sun 09:30]--[2026-10-25 Sun 11:05] =>  1:35')
    // Durations follow the written wall-clock times, even across a DST change.
    const dst = clockOut(clockIn(SAMPLE, 5, new Date(2026, 9, 25, 0, 30)), 8, new Date(2026, 9, 25, 3, 30))
    expect(dst).toContain('=>  3:00')
  })

  it('moves and promotes subtrees', () => {
    const moved = moveSubtree(SAMPLE, 3, 1).split('\n')
    expect(moved[3]).toBe('** NEXT Two')
    expect(shiftLevel(SAMPLE, 2, 1)).toContain('*** TODO [#A] One')
  })

  it('refiles within a file', () => {
    const { src } = refile(SAMPLE, 5, undefined, 7)
    expect(src).toMatch(/\* Notes\n[\s\S]*\*\* NEXT Two/)
    expect(src).toContain('* Tasks [0/1]')
  })

  it('archives', () => {
    const { src, archive: arch } = archive(SAMPLE, 7, 'a.org', '', now)
    expect(src).not.toContain('* Notes')
    expect(arch).toContain(':ARCHIVE_FILE: a.org')
  })

  it('sets planning and properties', () => {
    let out = setPlanning(SAMPLE, 7, 'deadline', { active: true, date: '2026-11-01' })
    expect(out).toContain('* Notes\nDEADLINE: <2026-11-01 Sun>')
    out = setProperty(out, 7, 'Effort', '1:00')
    expect(out).toContain('DEADLINE: <2026-11-01 Sun>\n:PROPERTIES:\n:Effort: 1:00\n:END:')
  })

  it('aligns tables', () => {
    expect(alignTable(['|a|bb|', '|-', '|100|2|'])).toEqual(['| a   | bb |', '|-----+----|', '| 100 | 2  |'])
  })
})

describe('agenda & search', () => {
  it('builds a week agenda with repeaters and upcoming deadlines', () => {
    const docs = { 'a.org': parseOrg(SAMPLE) }
    const days = agenda(docs, '2026-10-25', '2026-10-31', '2026-10-25')
    expect(days.get('2026-10-27')!.map((i) => i.kind)).toEqual(['scheduled'])
    expect(days.get('2026-10-28')!.map((i) => i.kind)).toEqual(['deadline'])
    expect(days.get('2026-10-25')!.map((i) => i.kind).sort()).toEqual(['sched-past', 'upcoming'])
  })

  it('matches tags and properties', () => {
    const es = entries({ 'a.org': parseOrg(SAMPLE) })
    const titles = (q: string) => es.filter(compileMatch(q)).map((e) => e.h.title)
    expect(titles('work')).toEqual(['One'])
    expect(titles('f-work+TODO="NEXT"')).toEqual(['Two'])
    expect(titles('PRIORITY="A"|LEVEL=1')).toEqual(['Tasks [0/2]', 'One', 'Notes'])
  })
})

describe('capture', () => {
  it('creates a datetree', () => {
    const now = new Date(2026, 9, 25, 9, 30)
    const out = captureInto('', ['**** 09:30 hello'], true, now)
    expect(out).toBe('* 2026\n** 2026-10 October\n*** 2026-10-25 Sunday\n**** 09:30 hello\n')
    const again = captureInto(out, ['**** 10:00 again'], true, now)
    expect(again).toBe('* 2026\n** 2026-10 October\n*** 2026-10-25 Sunday\n**** 09:30 hello\n**** 10:00 again\n')
  })
})
