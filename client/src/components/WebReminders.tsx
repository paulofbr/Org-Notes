import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import { api, type Reminder } from '../api'
import { dateKey } from '../org/timestamp'
import { tr } from '../i18n'
import { useApp } from '../context'
import { EventDialog } from './EventView'

const SHOWN = 'reminders-shown'
// Opened from a reminder's link (the app's "Org Notes", the phone): the reminders due now were already seen there.
const fromReminder = new URLSearchParams(location.search).has('view')

/** The reminders already shown in this browser, each until it is no longer due, so a reload does not show them again. */
function shownNow(): Map<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(SHOWN) ?? 'null') as { until?: Record<string, string> } | null
    const now = new Date()
    return new Map(Object.entries(saved?.until ?? {}).filter(([, until]) => new Date(until) > now))
  } catch {
    return new Map()
  }
}

function remember(shown: Map<string, string>) {
  try {
    localStorage.setItem(SHOWN, JSON.stringify({ until: Object.fromEntries(shown) }))
  } catch {
    /* only means it could show again after a reload */
  }
}

/** Shows a sample reminder here (Conta e notificações → Testar lembrete), to check how they look and sound. */
export const testReminder = () => window.dispatchEvent(new Event('test-reminder'))

/** Two short tones, so a reminder is heard as well as seen. */
function chime() {
  try {
    const audio = new AudioContext()
    ;[880, 1175].forEach((freq, i) => {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, audio.currentTime + i * 0.25)
      gain.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + i * 0.25 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + i * 0.25 + 0.4)
      osc.connect(gain).connect(audio.destination)
      osc.start(audio.currentTime + i * 0.25)
      osc.stop(audio.currentTime + i * 0.25 + 0.45)
    })
  } catch {
    /* no audio: the card is still there */
  }
}

/**
 * While the site is open, shows the agenda reminders that are due: a card in the corner of the page that stays until
 * OK (or comes back after "Adiar 5 min"), a chime, and a browser notification when the user allowed them.
 */
export function WebReminders() {
  const app = useApp()
  const [cards, setCards] = useState<Reminder[]>([])
  const view = (r: Reminder) => r.view && app.showDialog(<EventDialog view={r.view} />)
  useEffect(() => {
    let first = true
    const check = () =>
      api.reminders().then((all) => {
        const now = new Date()
        const shown = shownNow()
        const due = all.filter((r) => new Date(r.from) <= now && now < new Date(r.until) && !shown.has(r.id))
        const quiet = first && fromReminder
        first = false
        if (!due.length) return
        due.forEach((r) => shown.set(r.id, r.until))
        remember(shown)
        if (quiet) return
        setCards((c) => [...c, ...due])
        chime()
        if ('Notification' in window && Notification.permission === 'granted')
          for (const r of due) {
            const n = new Notification(r.title, { body: r.body, tag: r.id, requireInteraction: true, icon: '/apple-touch-icon.png' })
            n.onclick = () => (window.focus(), view(r), n.close())
          }
      }, () => {})
    check()
    const t = setInterval(check, 30000)
    const test = () => {
      setCards((c) => [...c, { id: `test|${Date.now()}`, from: '', until: '', title: tr('Teste de lembrete'), body: tr('Assim vais ver os lembretes da agenda.'), view: `list=${dateKey(new Date())}` }])
      chime()
    }
    window.addEventListener('test-reminder', test)
    return () => (clearInterval(t), window.removeEventListener('test-reminder', test))
  }, [])
  const [minutes, setMinutes] = useState(5)
  if (!cards.length) return null
  const snooze = () => {
    const later = cards
    setCards([])
    setTimeout(() => (setCards((c) => [...c, ...later]), chime()), minutes * 60000)
  }
  return (
    <div className="reminder-cards" role="alert">
      <div className="reminder-card">
        <div className="reminder-head"><BellRing size={16} /> {tr('Lembretes')}</div>
        {cards.map((r) => (
          <div key={r.id + r.title} className={`reminder-item ${r.view ? 'linked' : ''}`} onClick={() => view(r)} title={r.view ? tr('Ver o evento') : undefined}>
            <b>{r.title}</b>
            {r.body && <div className="muted">{r.body}</div>}
          </div>
        ))}
        <div className="actions">
          <select value={minutes} onChange={(e) => setMinutes(+e.target.value)} aria-label={tr('Adiar por')}>
            <option value={5}>5 min</option>
            <option value={15}>15 min</option>
            <option value={60}>1 h</option>
          </select>
          <button type="button" onClick={snooze}>{tr('Adiar')}</button>
          <button type="button" className="primary" onClick={() => setCards([])}>OK</button>
        </div>
      </div>
    </div>
  )
}
