import { useMemo, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { useApp } from '../context'
import { api, type ProposedItem } from '../api'
import { allTemplates, captureInto, emptyProps, expand, fieldOptions, usesWhen, type CaptureTemplate } from '../org/capture'
import type { OrgStore } from '../store'
import { Modal } from './Dialogs'
import { tr } from '../i18n'

type Row = ProposedItem & { keep: boolean }

/** Captures the kept items with their templates, writing each file once. */
export function saveProposals(store: OrgStore, items: ProposedItem[]) {
  const templates = allTemplates(store.files)
  const texts: Record<string, string> = {}
  for (const it of items) {
    const tpl = templates.find((t) => t.file === it.file && t.key === it.key)
    if (!tpl) continue
    const entry = expand(tpl, { title: it.title, body: it.body, date: it.date || undefined, time: it.time, props: it.props })
    texts[tpl.file] = captureInto(texts[tpl.file] ?? store.files[tpl.file] ?? '', entry, tpl.datetree)
  }
  for (const [file, text] of Object.entries(texts)) store.update(file, text)
  return Object.keys(texts).length
}

/** The proposed items, each editable and ticked by default, with the template it will be captured with. */
export function ProposalReview({ items, onSave, onCancel, saveLabel }: { items: ProposedItem[]; onSave: (kept: ProposedItem[]) => void; onCancel: () => void; saveLabel?: string }) {
  const { store } = useApp()
  const templates = useMemo(() => allTemplates(store.files), [store.files])
  const [rows, setRows] = useState<Row[]>(() => items.map((it) => ({ ...it, keep: true })))
  const change = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const kept = rows.filter((r) => r.keep)
  return (
    <div className="proposals">
      {rows.length === 0 && <p className="hint">{tr('A IA não encontrou nada para criar neste texto.')}</p>}
      {rows.map((r, i) => {
        const tpl: CaptureTemplate | undefined = templates.find((t) => t.file === r.file && t.key === r.key)
        const options = tpl ? fieldOptions(tpl.file, store.files) : {}
        return (
          <fieldset key={i} className={`proposal ${r.keep ? '' : 'skipped'}`}>
            <div className="proposal-head">
              <input type="checkbox" checked={r.keep} onChange={(e) => change(i, { keep: e.target.checked })} aria-label={tr('Criar este item')} />
              <select
                value={tpl ? templates.indexOf(tpl) : ''}
                onChange={(e) => {
                  const t = templates[+e.target.value]
                  change(i, { file: t.file, key: t.key, template: t.name })
                }}
              >
                {!tpl && <option value="">{r.template}</option>}
                {templates.map((t, j) => <option key={t.file + t.key} value={j}>{t.name} → {t.file}</option>)}
              </select>
              <input className="grow" value={r.title} onChange={(e) => change(i, { title: e.target.value })} />
            </div>
            {tpl && usesWhen(tpl) && (
              <div className="row">
                <label>{tr('Data')}<input type="date" value={r.date} onChange={(e) => change(i, { date: e.target.value })} /></label>
                <label>{tr('Hora')}<input type="time" value={r.time} onChange={(e) => change(i, { time: e.target.value })} /></label>
              </div>
            )}
            {tpl && emptyProps(tpl).length > 0 && (
              <div className="row">
                {emptyProps(tpl).map((k) => {
                  const opts = options[k.toUpperCase()]
                  const id = `prop-${i}-${k}`
                  return (
                    <label key={k}>
                      {k.charAt(0) + k.slice(1).toLowerCase()}
                      <input value={r.props[k] ?? ''} list={opts && id} onChange={(e) => change(i, { props: { ...r.props, [k]: e.target.value } })} />
                      {opts && <datalist id={id}>{opts.map((o) => <option key={o} value={o} />)}</datalist>}
                    </label>
                  )
                })}
              </div>
            )}
            <textarea rows={Math.min(4, Math.max(2, r.body.split('\n').length))} value={r.body} onChange={(e) => change(i, { body: e.target.value })} />
          </fieldset>
        )
      })}
      <div className="actions">
        <button type="button" onClick={onCancel}>{tr('Cancelar')}</button>
        <button type="button" className="primary" disabled={!kept.length} onClick={() => onSave(kept.map(({ keep: _, ...it }) => it))}>
          {saveLabel ?? tr('Criar {n} itens', { n: kept.length })}
        </button>
      </div>
    </div>
  )
}

/** Paste free text (an email...), let the AI propose tasks, events, contacts..., review them and create them. */
export function AiExtractDialog({ initialText = '' }: { initialText?: string }) {
  const { store, closeDialog } = useApp()
  const [text, setText] = useState(initialText)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [items, setItems] = useState<ProposedItem[]>()
  const analyse = () => {
    if (!text.trim() || busy) return
    setBusy(true)
    setError('')
    api.aiExtract(text).then(setItems, (e) => setError(String(e.message ?? e))).finally(() => setBusy(false))
  }
  return (
    <Modal title={tr('Criar a partir de texto (IA)')} onClose={closeDialog} wide>
      {!items ? (
        <>
          <p className="hint">{tr('Cola um email ou outro texto: a IA propõe tarefas, eventos e contactos com os teus templates, e tu revês antes de criar.')}</p>
          <textarea autoFocus rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('Cola aqui o texto…')} />
          {error && <p className="hint">{error}</p>}
          <div className="actions">
            <button type="button" onClick={closeDialog}>{tr('Cancelar')}</button>
            <button type="button" className="primary" disabled={!text.trim() || busy} onClick={analyse}>
              {busy ? <><Loader2 size={15} className="spin" /> {tr('A analisar…')}</> : <><Sparkles size={15} /> {tr('Analisar')}</>}
            </button>
          </div>
        </>
      ) : (
        <ProposalReview items={items} onCancel={() => setItems(undefined)} onSave={(kept) => (saveProposals(store, kept), closeDialog())} />
      )}
    </Modal>
  )
}
