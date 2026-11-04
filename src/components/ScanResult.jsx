import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, CircleCheck, CircleDashed, CircleX, X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { manilaToday, scanDetector } from '../lib/util.js'
import { fmtDay } from './RangePicker.jsx'
import { EASE_OUT } from './ui.jsx'

const daysLeft = (end) => Math.round((Date.parse(end) - Date.parse(manilaToday())) / 864e5)
export const time = (t) => new Date(t).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })
const longDay = (d) => fmtDay(d, { month: 'short', day: 'numeric', year: 'numeric' })
const manilaDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })

// Read from across the room: one colour, one icon, one word, then the detail.
function verdict(m) {
  if (m.status === 'new') return { word: 'No plan yet', note: 'Sell them a plan or a day pass.', Icon: CircleDashed, tone: 'bg-ink text-paper' }
  if (m.status === 'expired') return { word: 'Expired', note: `Ended ${longDay(m.ends_on)}. Renew or sell a day pass.`, Icon: CircleX, tone: 'bg-crimson text-paper' }
  const left = daysLeft(m.ends_on)
  if (left <= 3)
    return { word: 'Let in', note: left === 0 ? 'Last day today. Remind them to renew.' : `${left} day${left === 1 ? '' : 's'} left. Remind them to renew.`, Icon: CircleAlert, tone: 'bg-gold text-ink' }
  return { word: 'Let in', note: `${m.plan_name} until ${longDay(m.ends_on)}`, Icon: CircleCheck, tone: 'bg-active text-paper' }
}

// The answer to one scan: a check_in() result, or { missing } when nothing matched.
export function ResultCard({ result, onRenew }) {
  const m = result.member
  if (!m)
    return (
      <div className="flex items-center gap-4 bg-crimson p-6 text-paper">
        <CircleX className="size-12 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-display text-4xl font-black uppercase leading-none">Not a pass</p>
          <p className="mt-1 text-paper/85">Nothing matches that scan. Ask for their gym code or register them in Members.</p>
        </div>
      </div>
    )
  const v = verdict(m)
  return (
    <>
      <div className={`flex items-center gap-4 p-6 ${v.tone}`}>
        <v.Icon className="size-14 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-display text-6xl font-black uppercase leading-none">{v.word}</p>
          <p className="mt-1 font-semibold opacity-90">{v.note}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4 bg-paper p-6 text-ink">
        <div className="min-w-0">
          <p className="truncate font-display text-4xl font-extrabold uppercase leading-none">{m.full_name}</p>
          <p className="tabular mt-1 font-semibold text-smoke">{m.code}</p>
          <p className="mt-3 text-sm text-smoke">
            {m.logged ? (m.last_visit ? `Last visit ${fmtDay(manilaDay(m.last_visit))}` : 'First visit') : `Already checked in at ${time(m.last_visit)}`} · {m.visits_this_month} this month ·{' '}
            {m.member_until && m.member_until >= manilaToday() ? `Annual membership until ${longDay(m.member_until)}` : 'No annual membership'}
          </p>
        </div>
        {(m.status !== 'active' || daysLeft(m.ends_on) <= 3) && (
          <button type="button" onClick={() => onRenew(m)} className="press rounded-xl bg-gold px-5 py-3 font-display text-lg font-black uppercase text-ink">
            {m.status === 'new' ? 'Sell a plan' : 'Renew'}
          </button>
        )}
      </div>
    </>
  )
}

// Renewing goes through the register with the member already chosen.
export const renewOnRegister = (navigate, m) =>
  navigate('/', { state: { member: { id: m.id, code: m.code, full_name: m.full_name, ends_on: m.ends_on, member_until: m.member_until } } })

// A pass scanned on any screen checks the member in and shows the answer on top,
// without leaving the page. The Check-in tab handles its own scans (and typed codes).
// Only website pass codes count here, so ordinary typing never checks anyone in.
export function ScanAnywhere() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const here = useRef(pathname)
  here.current = pathname
  const [result, setResult] = useState(null)

  useEffect(() => {
    const feed = scanDetector(async (token) => {
      if (here.current === '/checkin') return
      const { data, error } = await supabase.rpc('check_in', { p_code: token })
      if (!error) setResult({ scan: Date.now(), member: data })
    })
    const onKey = (e) => feed(e.key, performance.now(), e.ctrlKey || e.metaKey || e.altKey)
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Closes by itself; Esc or a tap closes it sooner.
  useEffect(() => {
    if (!result) return
    const t = setTimeout(() => setResult(null), result.member && result.member.status === 'active' ? 4000 : 8000)
    const onKey = (e) => e.key === 'Escape' && setResult(null)
    window.addEventListener('keydown', onKey)
    return () => (clearTimeout(t), window.removeEventListener('keydown', onKey))
  }, [result])

  return (
    <div aria-live="assertive" className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4">
      <AnimatePresence>
        {result && (
          <motion.div
            key={result.scan}
            role="status"
            initial={{ opacity: 0, transform: 'translateY(-8px) scale(0.98)' }}
            animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
            exit={{ opacity: 0, transform: 'translateY(-6px) scale(0.99)', transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className="pointer-events-auto relative w-full max-w-2xl overflow-hidden rounded-2xl shadow-[0_24px_60px_-12px_rgb(25_23_27/0.55)] ring-1 ring-ink/10"
          >
            <ResultCard result={result} onRenew={(m) => (setResult(null), renewOnRegister(navigate, m))} />
            <button
              type="button"
              onClick={() => setResult(null)}
              aria-label="Close"
              className="press absolute top-3 right-3 grid size-10 place-items-center rounded-full bg-ink/15 text-current"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
