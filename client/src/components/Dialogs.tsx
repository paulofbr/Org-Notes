import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../context'
import { dateKey, type Timestamp } from '../org/timestamp'
import { outlinePath } from '../org/parser'
import { refile } from '../org/edit'
import { SHORTCUTS } from '../shortcuts'
import { api, type Login, type Me } from '../api'
import { OrgTextarea } from './OrgTextarea'
import { TitleInput } from './TitleInput'
import { MailDialog } from './MailInbox'
import { LANGS, isLang, lang, rememberLang, tr, type Lang } from '../i18n'

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose?: () => void; wide?: boolean }) {
  const { closeDialog } = useApp()
  const close = onClose ?? closeDialog
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') close()
        }}
      >
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

/** Edits a task's description (its text, without title, dates or properties). Ctrl+Enter saves. */
export function DescriptionDialog({ path, title, initial, onSubmit }: { path: string; title: string; initial: string; onSubmit: (v: string) => void }) {
  const { closeDialog } = useApp()
  const [value, setValue] = useState(initial)
  const save = () => (closeDialog(), value !== initial && onSubmit(value))
  return (
    <Modal title={`${tr('Descrição')} · ${title}`} onClose={closeDialog} wide>
      <OrgTextarea
        className="description"
        autoFocus
        autoGrow
        value={value}
        onChange={setValue}
        path={path}
        tools
        rich
        placeholder={tr('Notas, listas, tabelas, links e imagens…')}
        onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && (e.preventDefault(), save())}
      />
      <div className="actions">
        <span className="hint"><kbd>Ctrl+Enter</kbd> {tr('guardar')} · <kbd>Esc</kbd> {tr('cancelar')}</span>
        <button type="button" onClick={closeDialog}>{tr('Cancelar')}</button>
        <button className="primary" onClick={save}>{tr('Guardar')}</button>
      </div>
    </Modal>
  )
}

/** Creates a headline with its state and description in one go. Enter in the title or Ctrl+Enter saves. */
export function NewEntryDialog({ path, keywords, initialKeyword, onSubmit }: {
  path: string
  keywords: string[]
  initialKeyword?: string
  onSubmit: (entry: { title: string; keyword?: string; description: string }) => void
}) {
  const { closeDialog } = useApp()
  const [title, setTitle] = useState('')
  const [keyword, setKeyword] = useState(initialKeyword ?? '')
  const [description, setDescription] = useState('')
  const save = () => title.trim() && (closeDialog(), onSubmit({ title: title.trim(), keyword: keyword || undefined, description }))
  return (
    <Modal title={tr('Novo título')} onClose={closeDialog} wide>
      <form onSubmit={(e) => (e.preventDefault(), save())} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && (e.preventDefault(), save())}>
        <div className="row">
          <label className="keyword-pick">{tr('Estado')}
            <select value={keyword} onChange={(e) => setKeyword(e.target.value)}>
              <option value="">— ({tr('nota')})</option>
              {keywords.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label>{tr('Título')}<TitleInput autoFocus path={path} linkButton value={title} onChange={setTitle} /></label>
        </div>
        {/* Not a <label>: a click in it would be forwarded to its first button (Link externo). */}
        <div className="field">{tr('Descrição (opcional)')}
          <OrgTextarea
            className="description"
            value={description}
            onChange={setDescription}
            path={path}
            tools
            rich
            placeholder={tr('Notas, listas, links e imagens…')}
          />
        </div>
        <div className="actions">
          <span className="hint"><kbd>Enter</kbd> {tr('no título ou')} <kbd>Ctrl+Enter</kbd> {tr('guarda')}</span>
          <button type="button" onClick={closeDialog}>{tr('Cancelar')}</button>
          <button className="primary" disabled={!title.trim()}>{tr('Criar')}</button>
        </div>
      </form>
    </Modal>
  )
}

export function PromptDialog({ title, label, initial = '', onSubmit }: { title: string; label: string; initial?: string; onSubmit: (v: string) => void }) {
  const { closeDialog } = useApp()
  const [value, setValue] = useState(initial)
  return (
    <Modal title={title} onClose={closeDialog}>
      <form onSubmit={(e) => (e.preventDefault(), closeDialog(), onSubmit(value))}>
        <label>{label}<input autoFocus value={value} onChange={(e) => setValue(e.target.value)} /></label>
        <div className="actions">
          <button type="button" onClick={closeDialog}>{tr('Cancelar')}</button>
          <button className="primary">OK</button>
        </div>
      </form>
    </Modal>
  )
}

export function NewFolderDialog({ onSubmit }: { onSubmit: (name: string, files: string[]) => void }) {
  const { closeDialog } = useApp()
  const [name, setName] = useState('')
  const [files, setFiles] = useState('')
  const list = files.split(',').map((f) => f.trim().replace(/\.org$/, '')).filter(Boolean)
  return (
    <Modal title={tr('Nova pasta')} onClose={closeDialog}>
      <form onSubmit={(e) => (e.preventDefault(), name.trim() && (closeDialog(), onSubmit(name, list)))}>
        <label>{tr('Nome (ex: projetos ou projetos/casa)')}<input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>{tr('Ficheiros (opcional, separados por vírgulas, sem .org)')}<input value={files} placeholder={tr('ex: tarefas, notas')} onChange={(e) => setFiles(e.target.value)} /></label>
        <div className="actions">
          <button type="button" onClick={closeDialog}>{tr('Cancelar')}</button>
          <button className="primary" disabled={!name.trim()}>{tr('Criar')}</button>
        </div>
      </form>
    </Modal>
  )
}

const QUICK: [string, number][] = [[tr('Hoje'), 0], [tr('Amanhã'), 1], [tr('+1 semana'), 7]]

export function DateDialog({ title, initial, onSubmit }: { title: string; initial?: Timestamp; onSubmit: (ts?: Omit<Timestamp, 'raw'>) => void }) {
  const { closeDialog } = useApp()
  const [date, setDate] = useState(initial?.date ?? dateKey(new Date()))
  const [time, setTime] = useState(initial?.time ?? '')
  const [endTime, setEndTime] = useState(initial?.endTime ?? '')
  const [repeat, setRepeat] = useState(initial?.repeater ? `${initial.repeater.type}${initial.repeater.n}${initial.repeater.unit}` : '')
  const [warn, setWarn] = useState(initial?.warning ? `${initial.warning.n}${initial.warning.unit}` : '')
  const submit = (d = date) => {
    const r = /^(\+\+|\.\+|\+)(\d+)([hdwmy])$/.exec(repeat.trim())
    const w = /^-?(\d+)([hdwmy])$/.exec(warn.trim())
    closeDialog()
    onSubmit({
      active: true,
      date: d,
      time: time || undefined,
      endTime: time && endTime ? endTime : undefined,
      repeater: r ? { type: r[1] as '+', n: +r[2], unit: r[3] as 'd' } : undefined,
      warning: w ? { n: +w[1], unit: w[2] as 'd' } : undefined,
    })
  }
  return (
    <Modal title={title} onClose={closeDialog}>
      <form onSubmit={(e) => (e.preventDefault(), submit())}>
        <div className="chips">
          {QUICK.map(([label, n]) => (
            <button type="button" key={label} onClick={() => submit(dateKey(new Date(Date.now() + n * 86400000)))}>{label}</button>
          ))}
        </div>
        <div className="row">
          <label>{tr('Data')}<input type="date" autoFocus value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          <label>{tr('Hora')}<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          <label>{tr('Até')}<input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={!time} /></label>
        </div>
        <div className="row">
          <label>{tr('Repetir')}<select value={repeat} onChange={(e) => setRepeat(e.target.value)}>
            <option value="">{tr('Não')}</option>
            <option value="+1d">{tr('Diariamente')} (+1d)</option>
            <option value="+1w">{tr('Semanalmente')} (+1w)</option>
            <option value="+2w">{tr('Quinzenalmente')} (+2w)</option>
            <option value="+1m">{tr('Mensalmente')} (+1m)</option>
            <option value="+1y">{tr('Anualmente')} (+1y)</option>
            <option value=".+1d">{tr('1 dia após concluir')} (.+1d)</option>
            <option value="++1w">{tr('Próxima semana futura')} (++1w)</option>
            {repeat && !['+1d', '+1w', '+2w', '+1m', '+1y', '.+1d', '++1w'].includes(repeat) && <option value={repeat}>{repeat}</option>}
          </select></label>
          <label>{tr('Aviso antecipado')}<input placeholder={tr('ex: 3d')} value={warn} onChange={(e) => setWarn(e.target.value)} /></label>
        </div>
        <div className="actions">
          {initial && <button type="button" className="danger" onClick={() => (closeDialog(), onSubmit(undefined))}>{tr('Remover')}</button>}
          <button type="button" onClick={closeDialog}>{tr('Cancelar')}</button>
          <button className="primary">{tr('Guardar')}</button>
        </div>
      </form>
    </Modal>
  )
}

export function TagsDialog({ initial, onSubmit }: { initial: string[]; onSubmit: (tags: string[]) => void }) {
  const { closeDialog, store } = useApp()
  const [tags, setTags] = useState(initial)
  const [input, setInput] = useState('')
  const known = useMemo(() => {
    const set = new Set<string>()
    for (const doc of Object.values(store.docs)) {
      doc.all.forEach((h) => h.tags.forEach((t) => set.add(t)))
      ;(doc.keywords.TAGS ?? '').split(/[\s{}]+/).forEach((t) => t && !t.startsWith('(') && set.add(t.replace(/\(.\)$/, '')))
    }
    return [...set].sort()
  }, [store.docs])
  const add = (t: string) => {
    const clean = t.trim().replace(/[^\w@#%]/g, '')
    if (clean && !tags.includes(clean)) setTags([...tags, clean])
    setInput('')
  }
  return (
    <Modal title={tr('Etiquetas')} onClose={closeDialog}>
      <form onSubmit={(e) => (e.preventDefault(), input.trim() ? add(input) : (closeDialog(), onSubmit(tags)))}>
        <div className="chips">
          {tags.map((t) => (
            <button type="button" className="tag active" key={t} onClick={() => setTags(tags.filter((x) => x !== t))}>{t} ×</button>
          ))}
        </div>
        <input autoFocus placeholder={tr('Nova etiqueta + Enter')} value={input} onChange={(e) => setInput(e.target.value)} />
        <div className="chips">
          {known.filter((t) => !tags.includes(t) && t.toLowerCase().includes(input.toLowerCase())).map((t) => (
            <button type="button" className="tag" key={t} onClick={() => add(t)}>{t}</button>
          ))}
        </div>
        <div className="actions">
          <button type="button" onClick={closeDialog}>{tr('Cancelar')}</button>
          <button type="button" className="primary" onClick={() => (closeDialog(), onSubmit(input.trim() ? [...tags, input.trim()] : tags))}>{tr('Guardar')}</button>
        </div>
      </form>
    </Modal>
  )
}

export function PropertyDialog({ properties, onSubmit }: { properties: Record<string, string>; onSubmit: (key: string, value?: string) => void }) {
  const { closeDialog } = useApp()
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  return (
    <Modal title={tr('Propriedades')} onClose={closeDialog}>
      {Object.keys(properties).length > 0 && (
        <table className="props">
          <tbody>
            {Object.entries(properties).map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
                <td>
                  <button onClick={() => (setKey(k), setValue(v))}>{tr('Editar')}</button>
                  <button className="danger" onClick={() => (closeDialog(), onSubmit(k, undefined))}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form onSubmit={(e) => (e.preventDefault(), key.trim() && (closeDialog(), onSubmit(key.trim().replace(/\s+/g, '_'), value)))}>
        <div className="row">
          <label>{tr('Nome')}<input autoFocus value={key} list="prop-names" onChange={(e) => setKey(e.target.value)} placeholder="Effort" /></label>
          <label>{tr('Valor')}<input value={value} onChange={(e) => setValue(e.target.value)} /></label>
        </div>
        <datalist id="prop-names">{['Effort', 'CATEGORY', 'ID', 'CUSTOM_ID', 'ORDERED', 'LOCATION'].map((p) => <option key={p} value={p} />)}</datalist>
        <div className="actions">
          <button type="button" onClick={closeDialog}>{tr('Fechar')}</button>
          <button className="primary">{tr('Definir')}</button>
        </div>
      </form>
    </Modal>
  )
}

export function RefileDialog({ path, line }: { path: string; line: number }) {
  const { closeDialog, store, edit } = useApp()
  const [q, setQ] = useState('')
  const targets = useMemo(() => {
    const out: { path: string; line?: number; label: string }[] = []
    for (const [p, doc] of Object.entries(store.docs)) {
      if (p.endsWith('_archive.org')) continue
      out.push({ path: p, label: p })
      for (const h of doc.all) {
        if (p === path && h.line === line) continue
        out.push({ path: p, line: h.line, label: `${p} › ${[...outlinePath(h), h.title].join(' › ')}` })
      }
    }
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return out.filter((t) => words.every((w) => t.label.toLowerCase().includes(w))).slice(0, 80)
  }, [store.docs, q, path, line])

  const choose = (t: { path: string; line?: number }) => {
    closeDialog()
    try {
      if (t.path === path) edit(path, (text) => refile(text, line, undefined, t.line).src)
      else {
        const res = refile(store.get(path), line, store.get(t.path), t.line)
        store.update(path, res.src)
        store.update(t.path, res.dst!)
      }
    } catch (err) {
      alert((err as Error).message)
    }
  }
  return (
    <Modal title={tr('Mover para… (refile)')} onClose={closeDialog} wide>
      <input autoFocus placeholder={tr('Procurar destino…')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && targets[0] && choose(targets[0])} />
      <ul className="pick-list">
        {targets.map((t) => (
          <li key={`${t.path}:${t.line}`}><button onClick={() => choose(t)}>{t.line === undefined ? <b>{t.label}</b> : t.label}</button></li>
        ))}
      </ul>
    </Modal>
  )
}

export function HelpDialog() {
  const { closeDialog } = useApp()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const all = Object.values(SHORTCUTS).flatMap(({ title, keys }) => keys.map(([key, label]) => ({ group: title, key, label })))
  const shown = all.filter((s) => words.every((w) => `${s.group} ${s.key} ${s.label}`.toLowerCase().includes(w)))
  return (
    <Modal title={tr('Atalhos de teclado')} wide>
      <input
        autoFocus
        placeholder={tr('Procurar atalho, tecla ou contexto…')}
        value={q}
        onChange={(e) => (setQ(e.target.value), setSel(0))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setSel(Math.min(sel + 1, shown.length - 1)))
          if (e.key === 'ArrowUp') (e.preventDefault(), setSel(Math.max(sel - 1, 0)))
          if (e.key === 'Enter') (e.preventDefault(), closeDialog())
        }}
      />
      <ul className="pick-list">
        {shown.map((s, i) => (
          <Fragment key={s.group + s.key + s.label}>
            {s.group !== shown[i - 1]?.group && <li className="pick-group">{s.group}</li>}
            <li>
              <button tabIndex={-1} className={i === sel ? 'active' : ''} onMouseEnter={() => setSel(i)} ref={(el) => { if (i === sel) el?.scrollIntoView({ block: 'nearest' }) }}>
                <span>{s.label}</span><kbd>{s.key}</kbd>
              </button>
            </li>
          </Fragment>
        ))}
        {shown.length === 0 && <li className="hint">{tr('Nenhum atalho encontrado.')}</li>}
      </ul>
      <div className="hint"><kbd>↑ ↓</kbd> {tr('navegar')} · <kbd>Esc</kbd> {tr('fechar')}</div>
    </Modal>
  )
}

/** Lets the browser show the reminders as system notifications while the site is open. */
function BrowserNotifications() {
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'))
  if (permission === 'unsupported') return null
  if (permission === 'granted') return <p className="hint">{tr('Notificações do browser ativas: com o site aberto, os lembretes também aparecem como notificação.')}</p>
  if (permission === 'denied') return <p className="hint">{tr('As notificações do browser estão bloqueadas: permite-as nas definições deste site no browser.')}</p>
  return (
    <p>
      <button type="button" onClick={() => Notification.requestPermission().then(setPermission)}>{tr('Ativar notificações do browser')}</button>
    </p>
  )
}

/** The administrator's list of who may sign in: add an email, or remove one added here. */
export function LoginsDialog() {
  const { closeDialog } = useApp()
  const [logins, setLogins] = useState<Login[]>()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const load = () => api.logins().then(setLogins, (e) => setError(String(e.message ?? e)))
  useEffect(() => void load(), [])
  const run = (p: Promise<unknown>) => (setError(''), p.then(load, (e) => setError(String(e.message ?? e))))
  return (
    <Modal title={tr('Logins')} onClose={closeDialog}>
      <p className="hint">{tr('Só os emails desta lista podem entrar. Cada pessoa escolhe a sua password na primeira vez, em «Criar password».')}</p>
      {error && <p className="hint">{error}</p>}
      <table className="props">
        <tbody>
          {logins?.map((l) => (
            <tr key={l.email}>
              <th>{l.email}{l.admin && <span className="muted"> · {tr('administrador')}</span>}</th>
              <td className="muted">{l.hasPassword ? tr('já entrou') : tr('ainda sem password')}</td>
              <td>
                {l.fixed ? (
                  <span className="muted" title={tr('Definido na configuração do servidor')}>{tr('configuração')}</span>
                ) : (
                  <button type="button" className="danger" onClick={() => confirm(tr('Retirar o acesso a {email}?', { email: l.email })) && run(api.removeLogin(l.email))}>{tr('Retirar')}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={(e) => (e.preventDefault(), email.trim() && run(api.addLogin(email.trim()).then(() => setEmail(''))))}>
        <div className="row">
          <label>{tr('Novo email')}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" /></label>
          <button className="primary" disabled={!email.trim()}>{tr('Acrescentar')}</button>
        </div>
      </form>
      <div className="actions"><button type="button" onClick={closeDialog}>{tr('Fechar')}</button></div>
    </Modal>
  )
}

export function AccountDialog() {
  const { closeDialog, showDialog } = useApp()
  const [me, setMe] = useState<Me>()
  const [error, setError] = useState('')
  useEffect(() => void api.me().then(setMe, (e) => setError(String(e))), [])
  const toggle = (enabled: boolean) => me && api.setNotify(enabled).then(() => setMe({ ...me, ntfy: { ...me.ntfy, enabled } }), (e) => setError(String(e)))
  const url = me && `${me.ntfy.server}/${me.ntfy.topic}`
  // The language is a user setting, so the server (notifications, capture app) knows it too.
  const changeLang = (l: Lang) => api.setLang(l).then(() => rememberLang(l), (e) => setError(String(e)))
  return (
    <Modal title={tr('Conta e notificações')} onClose={closeDialog}>
      {error && <p className="hint">{error}</p>}
      {me && (
        <p>
          {tr('Sessão')}: <b>{me.email}</b> · <a href="/logout">{tr('Sair')}</a>
          {me.admin && <> · <button type="button" className="link" onClick={() => showDialog(<LoginsDialog />)}>{tr('Gerir logins')}</button></>}
        </p>
      )}
      {me && (
        <label>
          {tr('Língua')}
          <select value={lang} onChange={(e) => isLang(e.target.value) && changeLang(e.target.value)}>
            {LANGS.map(([l, name]) => <option key={l} value={l}>{name}</option>)}
          </select>
        </label>
      )}
      {me && (
        <>
          <label className="inline"><input type="checkbox" checked={me.ntfy.enabled} onChange={(e) => toggle(e.target.checked)} /> {tr('Enviar lembretes da agenda pelo ntfy')}</label>
          <BrowserNotifications />
          <p>{tr('Tópico')}: <a href={url} target="_blank" rel="noreferrer"><code>{url}</code></a></p>
          <p className="hint">
            {tr('Subscreve este tópico na app ntfy (Android/iOS) ou no PC com')} <code>ntfy subscribe {url}</code>.{' '}
            {tr('Recebes um aviso antes de cada item com hora e um resumo diário, mesmo com o site fechado. Quem souber o tópico vê os títulos das tarefas: não o partilhes.')}
          </p>
          {me.ai && (
            <>
              <h4>{tr('Email para a IA')}</h4>
              <p className="hint">{tr('Liga uma pasta de email: a IA propõe tarefas, eventos e contactos para cada email novo, e tu revês antes de integrar.')}</p>
              <p><button type="button" onClick={() => showDialog(<MailDialog />)}>{tr('Configurar email')}</button></p>
            </>
          )}
          <h4>{tr('App de captura')}</h4>
          <p className="hint">{tr('Abre a captura com um atalho global e mostra os lembretes da agenda no computador.')}</p>
          {me.windowsInstaller && (
            <p>
              <a href="/api/downloads/windows" download>{tr('Descarregar para Windows')}</a>
            </p>
          )}
          <p>{tr('Servidor')}: <code>{location.origin}</code></p>
          <p>
            Token: <code>{me.token}</code>{' '}
            <button type="button" onClick={() => navigator.clipboard.writeText(me.token)}>{tr('Copiar')}</button>{' '}
            <button type="button" title={tr('O token antigo deixa de funcionar')} onClick={() => api.newToken().then((r) => setMe({ ...me, token: r.token }), (e) => setError(String(e)))}>{tr('Gerar novo')}</button>
          </p>
          <p className="hint">{tr('O token dá acesso às tuas notas: guarda-o só na app de captura e gera um novo se o perderes.')}</p>
        </>
      )}
      <div className="actions"><button className="primary" onClick={closeDialog}>OK</button></div>
    </Modal>
  )
}

/** Fast keys for TODO states: first free letter of each keyword, like org's (t) annotations. */
export function keywordKeys(keywords: string[]): [string, string][] {
  const used = new Set([' '])
  return keywords.map((kw) => {
    const key = [...kw.toLowerCase(), ...'123456789'].find((c) => /[a-z0-9]/.test(c) && !used.has(c))!
    used.add(key)
    return [key, kw]
  })
}

export function KeywordDialog({ keywords, current, onSubmit }: { keywords: string[]; current?: string; onSubmit: (kw?: string) => void }) {
  const { closeDialog } = useApp()
  const keys = keywordKeys(keywords)
  // Choices in display order; the last one (undefined) is "sem estado".
  const choices: (string | undefined)[] = [...keywords, undefined]
  const [sel, setSel] = useState(Math.max(0, choices.indexOf(current)))
  const pick = (kw?: string) => (closeDialog(), onSubmit(kw))
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <Modal title={tr('Estado')}>
      <div
        className="pick-keys"
        tabIndex={-1}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') (e.preventDefault(), setSel((sel + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length))
          else if (e.key === 'Enter') (e.preventDefault(), pick(choices[sel]))
          else if (e.key === ' ') (e.preventDefault(), pick(undefined))
          else {
            const hit = keys.find(([k]) => k === e.key.toLowerCase())
            if (hit) (e.preventDefault(), pick(hit[1]))
          }
        }}
      >
        {choices.map((kw, i) => (
          <button key={kw ?? ''} tabIndex={-1} className={i === sel ? 'active' : ''} onMouseEnter={() => setSel(i)} onClick={() => pick(kw)}>
            {kw ? <><kbd>{keys[i][0]}</kbd> {kw}</> : <><kbd>{tr('Espaço')}</kbd> {tr('sem estado')}</>}
            {kw === current && <span className="muted"> · {tr('atual')}</span>}
          </button>
        ))}
      </div>
      <div className="hint"><kbd>↑</kbd> <kbd>↓</kbd> {tr('escolher')} · <kbd>Enter</kbd> {tr('confirmar')} · {tr('ou a tecla do estado')}</div>
    </Modal>
  )
}

export interface Command {
  label: string
  hint?: string
  run: () => void
}

export function CommandPalette({ commands }: { commands: Command[] }) {
  const { closeDialog } = useApp()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  // Case- and accent-insensitive, so "icone" finds "Ícone".
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const words = fold(q).split(/\s+/).filter(Boolean)
  const shown = commands.filter((c) => words.every((w) => fold(c.label).includes(w))).slice(0, 50)
  const run = (c?: Command) => c && (closeDialog(), c.run())
  return (
    <Modal title={tr('Comandos')} wide>
      <input
        autoFocus
        placeholder={tr('Escreve para procurar ficheiros e comandos…')}
        value={q}
        onChange={(e) => (setQ(e.target.value), setSel(0))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setSel(Math.min(sel + 1, shown.length - 1)))
          if (e.key === 'ArrowUp') (e.preventDefault(), setSel(Math.max(sel - 1, 0)))
          if (e.key === 'Enter') (e.preventDefault(), run(shown[sel]))
        }}
      />
      <ul className="pick-list">
        {shown.map((c, i) => (
          <li key={c.label}>
            <button className={i === sel ? 'active' : ''} onMouseEnter={() => setSel(i)} onClick={() => run(c)} ref={(el) => { if (i === sel) el?.scrollIntoView({ block: 'nearest' }) }}>
              <span>{c.label}</span>{c.hint && <kbd>{c.hint}</kbd>}
            </button>
          </li>
        ))}
      </ul>
      <div className="hint"><kbd>↑ ↓</kbd> {tr('escolher')} · <kbd>Enter</kbd> {tr('executar')} · <kbd>Esc</kbd> {tr('fechar')}</div>
    </Modal>
  )
}
