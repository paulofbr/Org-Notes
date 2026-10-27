import { useRef, useState, type PointerEvent } from 'react'
import { Modal } from './Dialogs'
import { uploadImageLink } from './LinkDialog'
import { tr } from '../i18n'

type Box = { x: number; y: number; w: number; h: number }
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
/** What a drag does: draw a new area, move the area, or pull one of its handles. */
type Drag = { mode: 'new' | 'move' | (typeof HANDLES)[number]; x: number; y: number; box?: Box }

/**
 * An image in the notes: drag over it to choose an area and crop it (the cropped copy is uploaded and the link points
 * to it), or bring it back to its original size.
 */
export function ImageEditDialog({ src, path, sized, onCrop, onOriginalSize, onClose }: {
  src: string
  path: string
  /** Whether the image has a width set (so "Tamanho original" applies). */
  sized: boolean
  onCrop: (link: string) => void
  onOriginalSize: () => void
  onClose: () => void
}) {
  const img = useRef<HTMLImageElement>(null)
  const [box, setBox] = useState<Box>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const drag = useRef<Drag | undefined>(undefined)

  const point = (e: PointerEvent) => {
    const r = img.current!.getBoundingClientRect()
    return { x: Math.min(Math.max(e.clientX - r.left, 0), r.width), y: Math.min(Math.max(e.clientY - r.top, 0), r.height) }
  }
  const crop = () => {
    const el = img.current
    if (!el || !box) return
    // The box is drawn on the shown image; the crop is taken from the full-size one.
    const scale = el.naturalWidth / el.getBoundingClientRect().width
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(box.w * scale)
    canvas.height = Math.round(box.h * scale)
    canvas.getContext('2d')!.drawImage(el, box.x * scale, box.y * scale, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
    setBusy(true)
    setError('')
    try {
      canvas.toBlob((blob) => {
        if (!blob) return (setBusy(false), setError(tr('Não foi possível recortar a imagem.')))
        uploadImageLink(path, blob).then((link) => (onCrop(link), onClose()), (e) => (setBusy(false), setError(String(e.message ?? e))))
      }, 'image/png')
    } catch {
      // A picture from another site cannot be read back from a canvas.
      setBusy(false)
      setError(tr('Só se podem recortar imagens guardadas nas notas, não de outros sites.'))
    }
  }

  return (
    <Modal title={tr('Imagem')} onClose={onClose} wide>
      <p className="hint">{tr('Arrasta sobre a imagem para escolher a área a recortar; depois ajusta-a pelos pontos ou arrasta-a.')}</p>
      <div
        className="crop-area"
        onPointerDown={(e) => {
          e.preventDefault()
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* without capture the drag only ends inside the image */
          }
          const p = point(e)
          const handle = (e.target as HTMLElement).dataset.handle as Drag['mode'] | undefined
          const inside = box && p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h
          drag.current = { mode: handle ?? (inside ? 'move' : 'new'), ...p, box }
          if (!handle && !inside) setBox(undefined)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const p = point(e)
          const r = img.current!.getBoundingClientRect()
          if (d.mode === 'new' || !d.box) {
            setBox({ x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), w: Math.abs(p.x - d.x), h: Math.abs(p.y - d.y) })
          } else if (d.mode === 'move') {
            const b = d.box
            setBox({ ...b, x: Math.min(Math.max(b.x + p.x - d.x, 0), r.width - b.w), y: Math.min(Math.max(b.y + p.y - d.y, 0), r.height - b.h) })
          } else {
            // A handle moves its own edges; the opposite ones stay put.
            const b = d.box
            let [l, t, rt, bt] = [b.x, b.y, b.x + b.w, b.y + b.h]
            if (d.mode.includes('w')) l = p.x
            if (d.mode.includes('e')) rt = p.x
            if (d.mode.includes('n')) t = p.y
            if (d.mode.includes('s')) bt = p.y
            setBox({ x: Math.min(l, rt), y: Math.min(t, bt), w: Math.abs(rt - l), h: Math.abs(bt - t) })
          }
        }}
        onPointerUp={() => {
          drag.current = undefined
          setBox((b) => (b && b.w > 4 && b.h > 4 ? b : undefined))
        }}
      >
        <img ref={img} src={src} alt="" draggable={false} crossOrigin={/^https?:/.test(src) ? 'anonymous' : undefined} />
        {box && (
          <div className="crop-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
            {HANDLES.map((h) => <span key={h} className={`h h-${h}`} data-handle={h} />)}
          </div>
        )}
      </div>
      {error && <p className="hint">{error}</p>}
      <div className="actions">
        {sized && <button type="button" onClick={() => (onOriginalSize(), onClose())}>{tr('Tamanho original')}</button>}
        <button type="button" onClick={onClose}>{tr('Cancelar')}</button>
        <button type="button" className="primary" disabled={!box || busy} onClick={crop}>{busy ? tr('A carregar…') : tr('Recortar')}</button>
      </div>
    </Modal>
  )
}
