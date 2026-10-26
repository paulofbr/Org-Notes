import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useApp } from '../context'
import { api, type InboxEntry, type MailAccount } from '../api'
import { Modal } from './Dialogs'
import { ProposalReview, saveProposals } from './AiExtract'
import { locale, tr } from '../i18n'

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '')

/** The mailbox the server reads for items: IMAP account and folder, tested before it is saved. */
export function MailDialog() {
  const { closeDialog } = useApp()
  const [saved, setSaved] = useState<MailAccount | null>()
  const [form, setForm] = useState({ host: '', port: 993, user: '', password: '', folder: 'OrgNotes', enabled: true })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const load = () =>
    api.mail().then((m) => {
      setSaved(m)
      if (m) setForm((f) => ({ ...f, host: m.host, port: m.port, user: m.user, folder: m.folder, enabled: m.enabled, password: '' }))
    })
  useEffect(() => void load(), [])
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  const run = (p: Promise<unknown>, done?: string) => {
    setBusy(true)
    setMessage('')
    p.then(() => (setMessage(done ?? ''), load()), (e) => setMessage(String(e.message ?? e))).finally(() => setBusy(false))
  }
  return (
    <Modal title={tr('Email para a IA')} onClose={closeDialog}>
      <p className="hint">
        {tr('O servidor lê esta pasta de 5 em 5 minutos e a IA propõe tarefas, eventos e contactos para cada email novo. Revês as propostas em «Propostas» antes de as integrar. Só lê emails que cheguem depois de guardares, e não altera nada na caixa de correio.')}
      </p>
      <p className="hint">
        {tr('No Gmail: servidor imap.gmail.com, porta 993, e uma palavra-passe de app (não a tua password). Cria uma etiqueta, por exemplo OrgNotes, e move para lá os emails a analisar (ou usa um filtro).')}{' '}
        <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">{tr('Criar palavra-passe de app')}</a>
      </p>
      <form onSubmit={(e) => (e.preventDefault(), run(api.saveMail(form), tr('Ligação feita e guardada.')))}>
        <div className="row">
          <label>{tr('Servidor IMAP')}<input value={form.host} onChange={(e) => set({ host: e.target.value })} placeholder="imap.gmail.com" /></label>
          <label>{tr('Porta')}<input type="number" value={form.port} onChange={(e) => set({ port: +e.target.value })} /></label>
        </div>
        <div className="row">
          <label>{tr('Utilizador')}<input value={form.user} onChange={(e) => set({ user: e.target.value })} placeholder="email@gmail.com" autoComplete="off" /></label>
          <label>{tr('Password')}<input type="password" value={form.password} onChange={(e) => set({ password: e.target.value })} placeholder={saved ? tr('(guardada)') : ''} autoComplete="new-password" /></label>
        </div>
        <div className="row">
          <label>{tr('Pasta')}<input value={form.folder} onChange={(e) => set({ folder: e.target.value })} /></label>
          <label className="inline"><input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> {tr('Ler automaticamente')}</label>
        </div>
        {saved && (
          <p className="hint">
            {saved.lastCheck ? tr('Última verificação: {when}', { when: when(saved.lastCheck) }) : tr('Ainda não verificado.')}
            {saved.lastError && <> · <span className="error-text">{saved.lastError}</span></>}
          </p>
        )}
        {message && <p className="hint">{message}</p>}
        <div className="actions">
          {saved && <button type="button" className="danger" disabled={busy} onClick={() => confirm(tr('Deixar de ler este email?')) && run(api.removeMail().then(() => setSaved(null)))}>{tr('Remover')}</button>}
          {saved && <button type="button" disabled={busy} onClick={() => run(api.checkMail().then((r) => setMessage(r.lastError ?? tr('{n} emails à espera de revisão.', { n: r.inbox }))))}>{tr('Verificar agora')}</button>}
          <button type="button" onClick={closeDialog}>{tr('Fechar')}</button>
          <button className="primary" disabled={busy || !form.host.trim() || !form.user.trim() || (!saved && !form.password)}>
            {busy ? <Loader2 size={15} className="spin" /> : tr('Guardar')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** Emails whose AI-proposed items wait for review: integrate the chosen items, or discard the email. */
export function InboxDialog({ onChange }: { onChange: () => void }) {
  const { store, closeDialog } = useApp()
  const [entries, setEntries] = useState<InboxEntry[]>()
  const [open, setOpen] = useState<string>()
  const [error, setError] = useState('')
  const load = () => api.inbox().then((e) => (setEntries(e), setOpen((o) => o ?? e[0]?.id)), (e) => setError(String(e.message ?? e)))
  useEffect(() => void load(), [])
  const done = (id: string) => api.removeInbox(id).then(() => (setOpen(undefined), load(), onChange()), (e) => setError(String(e.message ?? e)))
  return (
    <Modal title={tr('Propostas do email')} onClose={closeDialog} wide>
      {error && <p className="hint">{error}</p>}
      {entries?.length === 0 && <p className="hint">{tr('Não há emails à espera de revisão.')}</p>}
      {entries?.map((e) => (
        <section key={e.id} className="inbox-entry">
          <button type="button" className={`inbox-head ${open === e.id ? 'open' : ''}`} onClick={() => setOpen(open === e.id ? undefined : e.id)}>
            <b>{e.subject || tr('(sem assunto)')}</b>
            <span className="muted">{e.from} · {when(e.date)} · {tr('{n} itens', { n: e.items.length })}</span>
          </button>
          {open === e.id && (
            <ProposalReview
              items={e.items}
              cancelLabel={tr('Descartar')}
              saveLabel={(n) => tr('Integrar {n} itens', { n })}
              onCancel={() => done(e.id)}
              onSave={(kept) => (saveProposals(store, kept), done(e.id))}
            />
          )}
        </section>
      ))}
    </Modal>
  )
}
