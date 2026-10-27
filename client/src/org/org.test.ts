import { describe, expect, it } from 'vitest'
import { parseOrg, sectionBlocks } from './parser'
import { imageSrc, orgLink, pastedLink, relativePath, resolvePath } from './links'
import { insertEntry, setKeyword, toggleCheckbox, clockIn, clockOut, moveSubtree, shiftLevel, refile, archive, alignTable, setPlanning, setProperty, setFileKeyword, setDescription, descriptionOf, insertHeadline } from './edit'
import { agenda, compileMatch, entries } from './agenda'
import { captureInto, emptyProps, expand, fieldOptions, hideTemplates, propertyOptions, setPropertyOptions, setTemplates, templatesIn } from './capture'
import { parseTimestamp } from './timestamp'
import { addOption, clientKey, clientSource, clientValues, findOption, hasValue } from './clients'
import { formFields, formValues, saveForm, templateFor } from './entryForm'
import { addTags, cleanTag } from './tags'
import { attrWidth, setImageWidth } from './images'

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

describe('links', () => {
  it('resolves and builds paths relative to the linking file', () => {
    expect(resolvePath('a/b.org', '../c.org')).toBe('c.org')
    expect(resolvePath('a/b.org', 'd/e.org')).toBe('a/d/e.org')
    expect(resolvePath('b.org', './c.org')).toBe('c.org')
    expect(relativePath('a/b.org', 'c.org')).toBe('../c.org')
    expect(relativePath('a/b.org', 'a/d/e.org')).toBe('d/e.org')
    expect(relativePath('x.org', '.images/i.png')).toBe('.images/i.png')
    expect(relativePath('a/b/c.org', 'a/x/y.org')).toBe('../x/y.org')
    expect(imageSrc('a/b.org', 'file:../.images/i 1.png')).toBe('/api/raw/.images/i%201.png')
  })
  it('writes org links', () => {
    expect(orgLink('https://x.pt', 'Site [x]')).toBe('[[https://x.pt][Site (x)]]')
    expect(orgLink('https://x.pt', '')).toBe('[[https://x.pt]]')
  })
})

describe('description', () => {
  const T = '* TODO a\nSCHEDULED: <2026-10-25 Sun>\n:PROPERTIES:\n:X: 1\n:END:\nold text\n\n** child\n* b\n'
  it('reads only the text after planning and properties, up to the first child', () => {
    const doc = parseOrg(T)
    expect(descriptionOf(doc, doc.all[0])).toBe('old text')
    expect(descriptionOf(doc, doc.all[2])).toBe('')
  })
  it('can be given when inserting a headline', () => {
    expect(insertHeadline('* a', 0, 'child', 'b', { keyword: 'TODO', description: 'texto\n* x' })).toBe('* a\n** TODO b\ntexto\n * x')
    expect(insertHeadline('* a\n', undefined, 'sibling', 'c')).toBe('* a\n* c\n')
  })
  it('replaces it keeping the spacing, adds it, removes it and escapes stars', () => {
    expect(setDescription(T, 0, 'new\nlines\n')).toBe(T.replace('old text', 'new\nlines'))
    expect(setDescription(T, 0, '')).toBe(T.replace('old text\n', ''))
    expect(setDescription(T, 8, '** not a headline')).toBe(T.replace('* b\n', '* b\n ** not a headline\n'))
  })
})

describe('setFileKeyword', () => {
  it('adds after the title, replaces and removes', () => {
    const one = setFileKeyword('#+TITLE: T\n#+STARTUP: overview\n* a\n', 'ICON', 'book')
    expect(one).toBe('#+TITLE: T\n#+ICON: book\n#+STARTUP: overview\n* a\n')
    expect(setFileKeyword(one, 'ICON', 'abc.png')).toBe('#+TITLE: T\n#+ICON: abc.png\n#+STARTUP: overview\n* a\n')
    expect(setFileKeyword(one, 'ICON')).toBe('#+TITLE: T\n#+STARTUP: overview\n* a\n')
    expect(setFileKeyword('* a\n#+ICON: x\n', 'ICON', 'book')).toBe('#+ICON: book\n* a\n#+ICON: x\n')
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

  const FILE = '#+TITLE: T\n#+BEGIN_CAPTURE t Tarefa :datetree\n,* TODO %{title}\nSCHEDULED: %{when}\n%{body}\n#+END_CAPTURE\n\n* existing\n'

  it('reads templates from the preamble, unescaping commas', () => {
    expect(templatesIn('a.org', FILE)).toEqual([
      { key: 't', name: 'Tarefa', file: 'a.org', datetree: true, body: '* TODO %{title}\nSCHEDULED: %{when}\n%{body}' },
    ])
  })

  it('rewrites templates in place and inserts them before the first headline', () => {
    const [t] = templatesIn('a.org', FILE)
    expect(setTemplates(FILE, [t])).toBe(FILE)
    expect(setTemplates(FILE, [])).toBe('#+TITLE: T\n\n* existing\n')
    expect(setTemplates('#+TITLE: T\n\n* existing\n', [{ ...t, datetree: false }])).toBe(
      '#+TITLE: T\n#+BEGIN_CAPTURE t Tarefa\n,* TODO %{title}\nSCHEDULED: %{when}\n%{body}\n#+END_CAPTURE\n\n* existing\n',
    )
  })

  it('hides templates from the text and restores them after edits, inside the preamble', () => {
    const { text, restore } = hideTemplates(FILE)
    expect(text).toBe('#+TITLE: T\n\n* existing\n')
    expect(restore(text)).toBe(FILE)
    expect(restore('#+TITLE: T\n\n* existing\nmore\n')).toBe(FILE + 'more\n')
    // With the preamble deleted, the blocks go before the first headline instead of into its body.
    expect(restore('* existing\nbody\n')).toBe(FILE.slice(FILE.indexOf('#+BEGIN'), FILE.indexOf('\n\n') + 1) + '* existing\nbody\n')
    expect(hideTemplates('* a\n').restore('* b\n')).toBe('* b\n')
  })

  it('expands placeholders and drops %{when} lines without a date', () => {
    const [t] = templatesIn('a.org', FILE)
    expect(expand(t, { title: 'X', body: 'a\nb\n' })).toEqual(['* TODO X', 'a', 'b'])
    expect(expand({ ...t, body: '* %{title}' }, { title: 'X', body: 'nota' })).toEqual(['* X', 'nota'])
    expect(expand(t, { title: 'X', body: '', date: '2026-10-25', time: '09:00' })).toEqual(['* TODO X', 'SCHEDULED: <2026-10-25 Sun 09:00>'])
  })

  it('fills empty properties and leaves the unanswered ones empty', () => {
    const t = { key: 'c', name: 'Contacto', file: 'c.org', datetree: false, body: '* %{title}\n:PROPERTIES:\n:EMAIL:\n:PHONE:\n:END:\n%{body}' }
    expect(emptyProps(t)).toEqual(['EMAIL', 'PHONE'])
    expect(expand(t, { title: 'Maria', body: '', props: { EMAIL: ' m@x.pt ', PHONE: '' } })).toEqual(['* Maria', ':PROPERTIES:', ':EMAIL: m@x.pt', ':PHONE:', ':END:'])
  })

  it('reads property options from the preamble only', () => {
    const text = '#+PROPERTY: company_ALL Acme "Initech Lda" Globex\n#+property: ESTADO_ALL Ativo\n* x\n#+PROPERTY: OUTRO_ALL a\n'
    expect(propertyOptions(text)).toEqual({ COMPANY: ['Acme', 'Initech Lda', 'Globex'], ESTADO: ['Ativo'] })
  })

  it('offers the headlines of a _FROM file, found relative to the file or from the root', () => {
    const files = {
      'work/todo.org': '#+PROPERTY: CLIENTE_FROM ../contacts.org\n#+PROPERTY: TIPO_ALL A B\n* x',
      'agenda.org': '#+PROPERTY: cliente_FROM contacts.org\n* y',
      'contacts.org': '#+TITLE: C\n* Maria Silva :vip:\n:PROPERTIES:\n:EMAIL: m@x.pt\n:END:\n** Nota\n* John Smith\n',
    }
    expect(fieldOptions('work/todo.org', files)).toEqual({ TIPO: ['A', 'B'], CLIENTE: ['Maria Silva', 'John Smith'] })
    expect(fieldOptions('agenda.org', files)).toEqual({ CLIENTE: ['Maria Silva', 'John Smith'] })
  })

  it('writes property options before the capture blocks, replacing an existing line', () => {
    const text = '#+TITLE: C\n#+PROPERTY: COMPANY_ALL Old\n#+BEGIN_CAPTURE k C\n,* %{title}\n#+END_CAPTURE\n\n* x'
    expect(setPropertyOptions(text, { COMPANY: ['Acme', 'Initech Lda'], TIPO: ['A'] })).toBe(
      '#+TITLE: C\n#+PROPERTY: COMPANY_ALL Acme "Initech Lda"\n#+PROPERTY: TIPO_ALL A\n#+BEGIN_CAPTURE k C\n,* %{title}\n#+END_CAPTURE\n\n* x',
    )
    expect(setPropertyOptions('#+TITLE: C\n\n* x', { A: ['1'] })).toBe('#+TITLE: C\n#+PROPERTY: A_ALL 1\n\n* x')
  })
})

describe('image width', () => {
  it('reads the width an attribute line gives', () => {
    expect(attrWidth('#+ATTR_ORG: :width 400')).toBe('400px')
    expect(attrWidth('  #+attr_html: :alt x :width 50%')).toBe('50%')
    expect(attrWidth('#+CAPTION: x')).toBeUndefined()
  })
  it('sets, changes and removes the width line before the image', () => {
    const text = 'Texto\n  [[file:a.png]]\nfim'
    const at = text.indexOf('[[')
    const set = setImageWidth(text, at, 300)
    expect(set).toBe('Texto\n  #+ATTR_ORG: :width 300\n  [[file:a.png]]\nfim')
    expect(setImageWidth(set, set.indexOf('[['), 120)).toBe('Texto\n  #+ATTR_ORG: :width 120\n  [[file:a.png]]\nfim')
    expect(setImageWidth(set, set.indexOf('[['))).toBe(text)
    expect(setImageWidth('#+ATTR_ORG: :align left\n[[a.png]]', 24, 80)).toBe('#+ATTR_ORG: :width 80 :align left\n[[a.png]]')
  })
})

describe('tags', () => {
  it('reads tags with letters of any language', () => {
    expect(parseOrg('* TODO Rever :urgência:cliente:\n').all[0]).toMatchObject({ title: 'Rever', tags: ['urgência', 'cliente'] })
  })
  it('adds tags to a headline, after the ones it has', () => {
    expect(addTags('* TODO Rever', ['urgência', ' a b '])).toBe('* TODO Rever :urgência:a_b:')
    expect(addTags('** Nota   :web:', ['web', 'novo'])).toBe('** Nota :web:novo:')
    expect(addTags('texto', ['x'])).toBe('texto')
    expect(cleanTag('c/ espaços!')).toBe('c_espaços')
  })
  it('puts the chosen tags on the captured headline', () => {
    const t = { key: 't', name: 'T', file: 't.org', datetree: false, body: '* TODO %{title}\n%{body}' }
    expect(expand(t, { title: 'Ligar', body: '', tags: ['cliente'] })).toEqual(['* TODO Ligar :cliente:'])
  })
})

describe('pastedLink', () => {
  it('turns a pasted web address into a link, described by the selection', () => {
    expect(pastedLink(' https://example.com/a?b=1 ', '', 'Ver ')).toBe('[[https://example.com/a?b=1]]')
    expect(pastedLink('https://example.com', 'a proposta', 'Ver ')).toBe('[[https://example.com][a proposta]]')
  })
  it('leaves other text, and addresses pasted inside a link, as they are', () => {
    expect(pastedLink('não é um endereço', '', '')).toBeUndefined()
    expect(pastedLink('https://a.pt e mais', '', '')).toBeUndefined()
    expect(pastedLink('https://example.com', '', 'texto [[')).toBeUndefined()
  })
})

describe('client filter', () => {
  const files = {
    'contacts.org': '* Acme\n* Globex\n',
    'todo.org': '#+PROPERTY: CLIENTE_FROM contacts.org\n* Projeto\n:PROPERTIES:\n:CLIENTE: Acme\n:END:\n** TODO Tarefa herdada\n** TODO Outra\n:PROPERTIES:\n:CLIENTE: Initech\n:END:\n* TODO Solta\n',
  }
  const docs = Object.fromEntries(Object.entries(files).map(([f, t]) => [f, parseOrg(t)]))
  it('finds the property and every value, offered or used', () => {
    expect(clientKey(files)).toBe('CLIENTE')
    expect(clientValues('CLIENTE', files, docs)).toEqual(['Acme', 'Globex', 'Initech'])
  })
  it('matches a headline by its own value or the nearest one above it', () => {
    const [projeto, herdada, outra, solta] = docs['todo.org'].all
    expect([projeto, herdada, outra, solta].map((h) => hasValue(h, 'CLIENTE', 'Acme'))).toEqual([true, true, false, false])
  })
  it('knows the file the clients come from', () => expect(clientSource(files)).toEqual({ key: 'CLIENTE', file: 'contacts.org' }))
})

describe('client combo', () => {
  const contacts = '#+TITLE: Contactos\n* Acme\n:PROPERTIES:\n:EMAIL: a@acme.pt\n:END:\n\n* Globex\n'
  it('adds a client with only its name', () => {
    expect(addOption(contacts, ' Initech ')).toBe(contacts + '* Initech\n')
    expect(addOption('', 'Initech')).toBe('* Initech\n')
  })
  it('finds an existing client by the name in the combo, at the top level only', () => {
    const doc = parseOrg(contacts)
    expect(findOption(doc, 'Acme ')?.line).toBe(1)
    expect(findOption(doc, 'Nada')).toBeUndefined()
  })
})

describe('entry form', () => {
  const text = '#+BEGIN_CAPTURE c Contacto\n,* %{title}\n:PROPERTIES:\n:EMAIL:\n:PHONE:\n:END:\n%{body}\n#+END_CAPTURE\n* Acme :cliente:\n:PROPERTIES:\n:EMAIL: a@acme.pt\n:NIF: 500\n:ID: x1\n:END:\nNotas\n\n* Globex\n'
  const doc = parseOrg(text)
  const acme = doc.headlines[0]
  const fields = formFields(templateFor('c.org', text, acme), acme)
  it('asks for the template fields, then the other ones the entry has', () => expect(fields).toEqual(['EMAIL', 'PHONE', 'NIF']))
  it('fills the form with the entry', () =>
    expect(formValues(doc, acme, fields)).toEqual({ title: 'Acme', props: { EMAIL: 'a@acme.pt', PHONE: '', NIF: '500' }, tags: ['cliente'], body: 'Notas' }))
  it('saves only what changed', () => {
    const v = formValues(doc, acme, fields)
    expect(saveForm(text, acme.line, v)).toBe(text)
    const out = saveForm(text, acme.line, { ...v, title: 'Acme Lda', props: { ...v.props, PHONE: '234 000 000', NIF: '' }, body: 'Notas novas' })
    const h = parseOrg(out).headlines[0]
    expect([h.title, h.properties.PHONE, h.properties.NIF, h.properties.ID, h.tags.join()]).toEqual(['Acme Lda', '234 000 000', undefined, 'x1', 'cliente'])
    expect(out).toContain('Notas novas\n\n* Globex\n')
  })
})

describe('insertEntry', () => {
  const text = '* A\n** A1\nbody\n* B\n'
  const entry = ['* TODO New', ':PROPERTIES:', ':LOCAL: Web', ':END:', '** Sub']
  it('places a captured entry as a sibling, at the headline level', () =>
    expect(insertEntry(text, 1, 'sibling', entry)).toBe('* A\n** A1\nbody\n** TODO New\n:PROPERTIES:\n:LOCAL: Web\n:END:\n*** Sub\n* B\n'))
  it('places it as a child, one level down', () =>
    expect(insertEntry(text, 3, 'child', entry)).toBe('* A\n** A1\nbody\n* B\n** TODO New\n:PROPERTIES:\n:LOCAL: Web\n:END:\n*** Sub\n'))
})

describe('diffWords', () => {
  it('marks removed and added words', async () => {
    const { diffWords } = await import('../components/AiReview')
    expect(diffWords('o gato é preto', 'o gato era preto')).toEqual([
      { text: 'o gato ', op: '=' },
      { text: 'é', op: '-' },
      { text: 'era', op: '+' },
      { text: ' preto', op: '=' },
    ])
  })
})

describe('site build', () => {
  it('reads the build a page loads', async () => {
    const { buildOf } = await import('../freshness')
    expect(buildOf('<script>x</script><script type="module" crossorigin src="/assets/index-AbC1.js"></script>')).toBe('/assets/index-AbC1.js')
    expect(buildOf('<html><body>login</body></html>')).toBeUndefined()
  })
})

describe('attachments', () => {
  it('finds the attachment links in a text, with their names', async () => {
    const { attachmentsIn, isAttachment } = await import('./links')
    const text = 'Ver [[file:plano_Artifacts/orçamento.pdf][orçamento.pdf]] e [[https://a.pt][site]]\n[[file:../x_Artifacts/a b.zip]] [[file:plano_Artifacts/1.png]] [[file:plano_Artifacts/foto.png][foto.png]]'
    expect(attachmentsIn(text)).toEqual([['file:plano_Artifacts/orçamento.pdf', 'orçamento.pdf'], ['file:../x_Artifacts/a b.zip', 'a b.zip'], ['file:plano_Artifacts/foto.png', 'foto.png']])
    expect(isAttachment('file:plano.org')).toBe(false)
  })
})
