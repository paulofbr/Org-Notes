import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../context'
import { allTemplates, captureInto, emptyProps, expand, fieldOptions, saveDrafts, templatesIn, usesWhen, type CaptureTemplate, type TemplateDraft } from '../org/capture'
import { Modal } from './Dialogs'
import { OrgTextarea } from './OrgTextarea'
import { TitleInput } from './TitleInput'
import { AiExtractDialog } from './AiExtract'
import { TagPicker } from './TagPicker'
import { aiEnabled, useAiReview } from './AiReview'
import { api } from '../api'
import { tr } from '../i18n'

/**
 * Captures into a template's file; with `path` (the open page), that page's template is chosen first. With `onEntry`,
 * only that file's templates are offered and the filled-in entry goes to `onEntry` instead, to be placed by the caller.
 */
export function CaptureDialog({ path, onEntry }: { path?: string; onEntry?: (entry: string[], tpl: CaptureTemplate) => void }) {
  const { store, closeDialog, showDialog } = useApp()
  const templates = useMemo(() => allTemplates(store.files).filter((t) => !onEntry || t.file === path), [store.files, onEntry, path])
  const [tpl, setTpl] = useState<CaptureTemplate | undefined>(() => templates.find((t) => t.file === path) ?? templates[0])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [props, setProps] = useState<Record<string, string>>({})
  const [tags, setTags] = useState<string[]>([])
  const titleRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLSelectElement>(null)
  useEffect(() => pickerRef.current?.focus(), [])
  const choose = (t: CaptureTemplate) => (setTpl(t), titleRef.current?.focus())
  const ai = useAiReview({ title, body }, (f) => (setTitle(f.title), setBody(f.body)), { title: tr('Título'), body: tr('Descrição') })

  const save = () => {
    if (!title.trim() || !tpl) return
    const entry = expand(tpl, { title: title.trim(), body, date: date || undefined, time, props, tags })
    if (onEntry) onEntry(entry, tpl)
    else store.update(tpl.file, captureInto(store.files[tpl.file] ?? '', entry, tpl.datetree))
    closeDialog()
  }

  if (!tpl)
    return (
      <Modal title={tr('Capturar')} onClose={closeDialog}>
        <p>{tr('Nenhum ficheiro tem um template de captura. Abre um ficheiro e usa')} <b>{tr('Template de captura')}</b> {tr('no menu do ficheiro.')}</p>
        <div className="actions"><button className="primary" onClick={closeDialog}>OK</button></div>
      </Modal>
    )

  return (
    <Modal title={tr('Capturar')} onClose={closeDialog}>
      <form
        onSubmit={(e) => (e.preventDefault(), save())}
        onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && (e.preventDefault(), save())}
      >
        <select
          className="template-picker"
          ref={pickerRef}
          value={templates.indexOf(tpl)}
          onChange={(e) => setTpl(templates[+e.target.value])}
          onKeyDown={(e) => {
            // A template's key picks it directly (instead of the select's type-ahead).
            const t = templates.find((x) => x.key === e.key)
            if (t) (e.preventDefault(), choose(t))
            else if (e.key === 'Enter') (e.preventDefault(), titleRef.current?.focus())
          }}
        >
          {templates.map((t, i) => (
            <option key={t.file + t.key} value={i}>{t.key} · {t.name} → {t.file}</option>
          ))}
        </select>
        <div className="hint">{tr('Escolhe o ficheiro na lista')} (<kbd>↑</kbd> <kbd>↓</kbd>) {tr('ou pela tecla do template;')} <kbd>Enter</kbd> {tr('passa ao título.')}</div>
        <TitleInput inputRef={titleRef} path={tpl.file} linkButton placeholder={tr('Título')} value={title} onChange={setTitle} />
        {emptyProps(tpl).map((k) => {
          const options = fieldOptions(tpl.file, store.files)[k.toUpperCase()]
          return (
            <label key={k}>
              {k.charAt(0) + k.slice(1).toLowerCase()}
              <input value={props[k] ?? ''} list={options && `opts-${k}`} onChange={(e) => setProps({ ...props, [k]: e.target.value })} />
              {options && <datalist id={`opts-${k}`}>{options.map((o) => <option key={o} value={o} />)}</datalist>}
            </label>
          )
        })}
        <TagPicker value={tags} onChange={setTags} />
        {usesWhen(tpl) && (
          <div className="row">
            <label>{tr('Data')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label>{tr('Hora')}<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          </div>
        )}
        <OrgTextarea className="capture-body" placeholder={tr('Descrição (opcional): notas, links e imagens…')} value={body} onChange={setBody} rows={4} path={tpl.file} tools rich />
        {ai.panel}
        <div className="actions">
          {ai.button}
          {ai.button && (
            <button type="button" title={tr('Criar tarefas, eventos e contactos a partir de um email ou outro texto')} onClick={() => showDialog(<AiExtractDialog initialText={body} />)}>
              {tr('Do texto (IA)')}
            </button>
          )}
          <button type="button" onClick={closeDialog}>{tr('Cancelar')}</button>
          <button className="primary" disabled={!title.trim()}>{tr('Guardar')} <kbd>Ctrl+Enter</kbd></button>
        </div>
      </form>
    </Modal>
  )
}

type Draft = TemplateDraft

const DEFAULT_BODY = '* %{title}\n%U\n%{body}'

const PRESETS: { name: string; body: string; datetree?: boolean }[] = [
  { name: tr('Tarefa'), body: '* TODO %{title}\nSCHEDULED: %{when}\n%U\n%{body}' },
  { name: tr('Evento'), body: '* %{title}\n%{when}\n%{body}' },
  { name: tr('Nota'), body: DEFAULT_BODY },
  { name: tr('Contacto'), body: '* %{title}\n:PROPERTIES:\n:EMAIL:\n:PHONE:\n:COMPANY:\n:END:\n%{body}' },
  { name: tr('Diário'), body: '**** %{time} %{title}\n%{body}', datetree: true },
]

// [label, text, title, whole line?]
const SNIPPETS: [string, string, string, boolean?][] = [
  [tr('Título'), '%{title}', tr('O título escrito na captura')],
  [tr('Notas'), '%{body}', tr('As notas escritas na captura')],
  [tr('Data escolhida'), '%{when}', tr('Data/hora escolhida na captura; a linha é omitida se ficar vazia')],
  [tr('Hora atual'), '%{time}', tr('Hora da captura (HH:MM)')],
  [tr('Agora'), '%U', tr('Timestamp inativo do momento da captura')],
  [tr('Agora (ativo)'), '%T', tr('Timestamp ativo do momento da captura (aparece na agenda)')],
  ['TODO', '* TODO %{title}', tr('Título com estado TODO'), true],
  ['SCHEDULED', 'SCHEDULED: %{when}', tr('Agendar para a data escolhida'), true],
  ['DEADLINE', 'DEADLINE: %{when}', tr('Prazo na data escolhida'), true],
  [tr('Etiqueta'), ` :${tr('etiqueta')}:`, tr('Etiqueta no fim do título')],
  [tr('Propriedades'), `:PROPERTIES:\n:${tr('CHAVE')}: ${tr('valor')}\n:END:`, tr('Gaveta de propriedades'), true],
]

function TemplateFields({ t, onChange, onRemove }: { t: Draft; onChange: (patch: Partial<Draft>) => void; onRemove?: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const insert = (text: string, line?: boolean) => {
    const el = boxRef.current?.querySelector('textarea')
    const pos = el ? el.selectionStart : t.body.length
    const before = t.body.slice(0, pos)
    const lead = line && before && !before.endsWith('\n') ? '\n' : ''
    const trail = line && t.body[pos] !== undefined && t.body[pos] !== '\n' ? '\n' : ''
    const cursor = pos + lead.length + text.length
    onChange({ body: before + lead + text + trail + t.body.slice(pos) })
    requestAnimationFrame(() => el && (el.focus(), (el.selectionStart = el.selectionEnd = cursor)))
  }
  const [ai, setAi] = useState(false)
  useEffect(() => void aiEnabled().then(setAi), [])
  const [describe, setDescribe] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generate = () => {
    if (!describe.trim() || busy) return
    setBusy(true)
    setError('')
    api.aiTemplate(describe).then(
      (r) => onChange({ name: r.name, datetree: r.datetree, body: r.body, options: Object.fromEntries(r.options.map((o) => [o.property, o.values])) }),
      (e) => setError(String(e.message ?? e)),
    ).finally(() => setBusy(false))
  }
  return (
    <fieldset className="template-edit">
      <div className="row">
        <label>{tr('Tecla')}<input maxLength={1} value={t.key} onChange={(e) => onChange({ key: e.target.value })} /></label>
        <label>{tr('Nome')}<input value={t.name} onChange={(e) => onChange({ name: e.target.value })} /></label>
        <label className="inline"><input type="checkbox" checked={t.datetree} onChange={(e) => onChange({ datetree: e.target.checked })} /> Datetree ({tr('ano/mês/dia')})</label>
        {onRemove && <button type="button" className="danger" onClick={onRemove}>{tr('Remover')}</button>}
      </div>
      {ai && (
        <div className="row">
          <label>
            {tr('Descreve o template e a IA cria-o')}
            <input
              value={describe}
              placeholder={tr('ex: contacto com email, telefone e empresa (Acme, Globex)')}
              onChange={(e) => setDescribe(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), generate())}
            />
          </label>
          <button type="button" onClick={generate} disabled={busy || !describe.trim()}>{busy ? tr('A criar…') : tr('Criar com IA')}</button>
        </div>
      )}
      {error && <p className="hint">{error}</p>}
      <div className="chips">
        <span className="muted">{tr('Modelos:')}</span>
        {PRESETS.map((p) => (
          <button type="button" key={p.name} className="tag" title={tr('Substitui o corpo do template')} onClick={() => onChange({ body: p.body, datetree: !!p.datetree, name: t.name || p.name })}>
            {p.name}
          </button>
        ))}
      </div>
      <div className="chips">
        <span className="muted">{tr('Inserir:')}</span>
        {SNIPPETS.map(([label, text, title, line]) => (
          <button type="button" key={label} className="tag" title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(text, line)}>
            {label}
          </button>
        ))}
      </div>
      <div ref={boxRef}>
        <OrgTextarea className="template-body" value={t.body} onChange={(body) => onChange({ body })} rows={6} />
      </div>
      {t.options && Object.keys(t.options).length > 0 && (
        <p className="hint">
          {tr('Opções')} ({Object.entries(t.options).map(([k, v]) => `${k}: ${v.join(', ')}`).join(' · ')}), {tr('guardadas no ficheiro como')} <code>#+PROPERTY: …_ALL</code>.
        </p>
      )}
    </fieldset>
  )
}

function PlaceholderHelp() {
  return (
    <p className="hint">
      <code>%{'{title}'}</code> {tr('título')} · <code>%{'{body}'}</code> {tr('notas')} · <code>%{'{when}'}</code> {tr('data/hora escolhida (a linha é omitida se ficar vazia)')} ·{' '}
      <code>%{'{time}'}</code> {tr('hora atual')} · <code>%U</code> / <code>%T</code> {tr('agora (inativo / ativo).')} {tr('Com datetree, usa títulos de nível 4')} (<code>****</code>).
    </p>
  )
}

/** The first letter of `name`, or else of the alphabet, that no template in `used` takes. */
const freeKey = (name: string, used: Set<string>) => [...name.toLowerCase(), ...'abcdefghijklmnopqrstuvwxyz'].find((c) => /[a-z0-9]/.test(c) && !used.has(c)) ?? ''

/** Edits the capture templates stored in one file's preamble. */
export function TemplateDialog({ path }: { path: string }) {
  const { store, closeDialog, edit } = useApp()
  const [list, setList] = useState<Draft[]>(() => templatesIn(path, store.get(path) ?? ''))
  const change = (i: number, patch: Partial<Draft>) => setList((l) => l.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  // A template without a key gets a free one, as in the new file dialog, rather than being dropped on save.
  const shown = useMemo(() => {
    const used = new Set([...allTemplates(store.files).filter((t) => t.file !== path), ...list].map((t) => t.key))
    return list.map((t) => {
      if (t.key.trim()) return t
      const key = freeKey(t.name, used)
      used.add(key)
      return { ...t, key }
    })
  }, [list, store.files, path])
  const save = () => (edit(path, (text) => saveDrafts(text, shown.filter((t) => t.key.trim()))), closeDialog())
  return (
    <Modal title={`${tr('Template de captura')} · ${path}`} onClose={closeDialog} wide>
      {shown.map((t, i) => (
        <TemplateFields key={i} t={t} onChange={(patch) => change(i, patch)} onRemove={() => setList(list.filter((_, j) => j !== i))} />
      ))}
      <PlaceholderHelp />
      <div className="actions">
        <button type="button" onClick={() => setList([...list, { key: '', name: '', datetree: false, body: DEFAULT_BODY }])}>{tr('Adicionar template')}</button>
        <button type="button" onClick={closeDialog}>{tr('Cancelar')}</button>
        <button className="primary" onClick={save}>{tr('Guardar')}</button>
      </div>
    </Modal>
  )
}

/** Asks for a new file's name and, optionally, the capture template it starts with. */
export function NewFileDialog({ dir, onSubmit }: { dir?: string; onSubmit: (path: string, template?: Draft) => void }) {
  const { store, closeDialog } = useApp()
  const [name, setName] = useState(dir ? `${dir}/` : '')
  const [withTemplate, setWithTemplate] = useState(false)
  const used = useMemo(() => new Set(allTemplates(store.files).map((t) => t.key)), [store.files])
  const base = name.trim().replace(/\.org$/, '').split('/').pop() ?? ''
  // Suggest the first letter of the name that no other template uses.
  const [tpl, setTpl] = useState<Draft>({ key: '', name: '', datetree: false, body: DEFAULT_BODY })
  const shown = { ...tpl, key: tpl.key || freeKey(base, used), name: tpl.name || base }
  return (
    <Modal title={tr('Novo ficheiro')} onClose={closeDialog} wide={withTemplate}>
      <form onSubmit={(e) => (e.preventDefault(), name.trim() && (closeDialog(), onSubmit(name.trim(), withTemplate && shown.key ? shown : undefined)))}>
        <label>{tr('Nome (ex: projetos/casa.org)')}<input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="inline"><input type="checkbox" checked={withTemplate} onChange={(e) => setWithTemplate(e.target.checked)} /> {tr('Definir template de captura')}</label>
        {withTemplate && (
          <>
            {used.has(shown.key) && <p className="hint">{tr('A tecla «{key}» já é usada por outro template.', { key: shown.key })}</p>}
            <TemplateFields t={shown} onChange={(patch) => setTpl({ ...shown, ...patch })} />
            <PlaceholderHelp />
          </>
        )}
        <div className="actions">
          <button type="button" onClick={closeDialog}>{tr('Cancelar')}</button>
          <button className="primary" disabled={!name.trim()}>{tr('Criar')}</button>
        </div>
      </form>
    </Modal>
  )
}
