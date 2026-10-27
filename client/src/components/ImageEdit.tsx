import { useRef, useState, type PointerEvent } from 'react'
import { Modal } from './Dialogs'
import { uploadImageLink } from './LinkDialog'
import { tr } from '../i18n'

type Box = { x: number; y: number; w: number; h: number }

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
  const start = useRef<{ x: number; y: number } | undefined>(undefined)

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
      <p className="hint">{tr('Arrasta sobre a imagem para escolher a área a recortar.')}</p>
      <div
        className="crop-area"
        onPointerDown={(e) => {
          e.preventDefault()
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* without capture the drag only ends inside the image */
          }
          start.current = point(e)
          setBox(undefined)
        }}
        onPointerMove={(e) => {
          if (!start.current) return
          const p = point(e)
          const s = start.current
          setBox({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) })
        }}
        onPointerUp={() => {
          start.current = undefined
          setBox((b) => (b && b.w > 4 && b.h > 4 ? b : undefined))
        }}
      >
        <img ref={img} src={src} alt="" draggable={false} crossOrigin={/^https?:/.test(src) ? 'anonymous' : undefined} />
        {box && <div className="crop-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
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
