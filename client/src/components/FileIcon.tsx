import { useRef, useState } from 'react'
import {
  Archive, Book, BookOpen, Briefcase, CalendarDays, Camera, Car, Code, Contact, Dumbbell, FileText, Flag, Folder, Gift, GraduationCap,
  Heart, House, Inbox, Leaf, Lightbulb, ListTodo, Music, Plane, ShoppingCart, Star, Target, Upload, Users, Utensils, Wallet, Wrench,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../api'
import { useApp } from '../context'
import { setFileKeyword } from '../org/edit'
import { Modal } from './Dialogs'

/** The predefined icons, by the name stored in `#+ICON:`. */
const ICONS: Record<string, LucideIcon> = {
  file: FileText, inbox: Inbox, todo: ListTodo, calendar: CalendarDays, book: Book, notes: BookOpen, work: Briefcase, code: Code,
  money: Wallet, folder: Folder, heart: Heart, home: House, idea: Lightbulb, music: Music, travel: Plane, shopping: ShoppingCart,
  star: Star, people: Users, contact: Contact, study: GraduationCap, gym: Dumbbell, food: Utensils, archive: Archive, flag: Flag,
  goal: Target, photo: Camera, car: Car, gift: Gift, nature: Leaf, tools: Wrench,
}

/** A file's icon: its `#+ICON:` (a predefined name or an uploaded `<hash>.png`), else the default for the file. */
export function FileIcon({ path, icon, size = 15 }: { path: string; icon?: string; size?: number }) {
  if (icon?.endsWith('.png')) return <img className="file-icon" src={`/api/icons/${encodeURIComponent(icon)}`} width={size} height={size} alt="" />
  const Icon = (icon && ICONS[icon]) || (path === 'todo.org' ? Inbox : FileText)
  return <Icon size={size} />
}

/** Draws an image file into a 64×64 PNG, cropped to a square from the centre. */
async function toIconPng(file: File): Promise<Blob> {
  const img = await createImageBitmap(file)
  const side = Math.min(img.width, img.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  canvas.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 64, 64)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Imagem inválida'))), 'image/png'))
}

export function IconDialog({ path }: { path: string }) {
  const { store, closeDialog, edit } = useApp()
  const current = store.docs[path]?.keywords.ICON
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const choose = (icon?: string) => (edit(path, (text) => setFileKeyword(text, 'ICON', icon)), closeDialog())
  const upload = (file?: File) =>
    file && toIconPng(file).then(api.uploadIcon).then((r) => choose(r.name), (e) => setError(e instanceof Error ? e.message : String(e)))
  return (
    <Modal title={`Ícone · ${path}`} onClose={closeDialog}>
      {error && <p className="hint">{error}</p>}
      <div className="icon-grid">
        {Object.keys(ICONS).map((name) => (
          <button key={name} type="button" title={name} className={current === name ? 'active' : ''} onClick={() => choose(name)}>
            <FileIcon path={path} icon={name} size={20} />
          </button>
        ))}
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
      <div className="actions">
        <button type="button" onClick={() => input.current?.click()}><Upload size={15} /> Carregar imagem</button>
        <button type="button" onClick={() => choose(undefined)}>Predefinido</button>
        <button type="button" onClick={closeDialog}>Cancelar</button>
      </div>
    </Modal>
  )
}
