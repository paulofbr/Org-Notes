import { useEffect, useRef, useState } from 'react'
import { useApp } from '../context'
import { TEMPLATES, captureInto } from '../org/capture'
import { Modal } from './Dialogs'
import { OrgTextarea } from './OrgTextarea'

export function CaptureDialog() {
  const { store, closeDialog } = useApp()
  const [tpl, setTpl] = useState(TEMPLATES[0])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => pickerRef.current?.focus(), [])
  const choose = (t: (typeof TEMPLATES)[number]) => (setTpl(t), titleRef.current?.focus())

  const save = () => {
    if (!title.trim()) return
    const entry = tpl.build(title.trim(), body, date || undefined, time)
    store.update(tpl.file, captureInto(store.files[tpl.file] ?? '', entry, !!tpl.datetree))
    closeDialog()
  }

  return (
    <Modal title="Capturar" onClose={closeDialog}>
      <form
        onSubmit={(e) => (e.preventDefault(), save())}
        onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && (e.preventDefault(), save())}
      >
        <div
          className="chips template-picker"
          tabIndex={-1}
          ref={pickerRef}
          onKeyDown={(e) => {
            const t = TEMPLATES.find((x) => x.key === e.key)
            if (t) (e.preventDefault(), choose(t))
            else if (e.key === 'Enter') (e.preventDefault(), titleRef.current?.focus())
          }}
        >
          {TEMPLATES.map((t) => (
            <button type="button" key={t.key} tabIndex={-1} className={`tag ${t === tpl ? 'active' : ''}`} onClick={() => choose(t)}>
              <kbd>{t.key}</kbd> {t.name} <span className="muted">→ {t.file}</span>
            </button>
          ))}
        </div>
        <div className="hint">Escolhe o modelo com a tecla indicada (ou <kbd>Enter</kbd> para {tpl.name}) e escreve o título.</div>
        <input ref={titleRef} placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
        {tpl.withDate && (
          <div className="row">
            <label>Data<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label>Hora<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          </div>
        )}
        <OrgTextarea className="capture-body" placeholder="Notas (opcional, sintaxe org)" value={body} onChange={setBody} rows={4} />
        <div className="actions">
          <button type="button" onClick={closeDialog}>Cancelar</button>
          <button className="primary" disabled={!title.trim()}>Guardar <kbd>Ctrl+Enter</kbd></button>
        </div>
      </form>
    </Modal>
  )
}
