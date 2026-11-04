import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, CircleCheck, CircleDashed, CircleX, Loader2, ScanLine } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { manilaToday } from '../lib/util.js'
import { fmtDay } from '../components/RangePicker.jsx'
import { EASE_OUT } from '../components/ui.jsx'
import { Problem } from '../components/form.jsx'

const daysLeft = (end) => Math.round((Date.parse(end) - Date.parse(manilaToday())) / 864e5)
const time = (t) => new Date(t).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })
const longDay = (d) => fmtDay(d, { month: 'short', day: 'numeric', year: 'numeric' })

// Read from across the room: one colour, one icon, one word, then the detail.
function verdict(m) {
  if (m.status === 'new') return { word: 'No plan yet', note: 'Sell them a plan or a day pass.', Icon: CircleDashed, tone: 'bg-ink text-paper' }
  if (m.status === 'expired') return { word: 'Expired', note: `Ended ${longDay(m.ends_on)}. Renew or sell a day pass.`, Icon: CircleX, tone: 'bg-crimson text-paper' }
  const left = daysLeft(m.ends_on)
  if (left <= 3)
    return { word: 'Let in', note: left === 0 ? 'Last day today. Remind them to renew.' : `${left} day${left === 1 ? '' : 's'} left. Remind them to renew.`, Icon: CircleAlert, tone: 'bg-gold text-ink' }
  return { word: 'Let in', note: `${m.plan_name} until ${longDay(m.ends_on)}`, Icon: CircleCheck, tone: 'bg-active text-paper' }
}

export default function CheckIn() {
  const navigate = useNavigate()
  const input = useRef(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { scan, member } | { scan, missing }
  const [error, setError] = useState(null)
  const [today, setToday] = useState(null)

  // The scanner types into whatever has focus, so keep it here (not on touch screens, where it pops the keyboard).
  const refocus = () => matchMedia('(pointer: fine)').matches && input.current?.focus()
  useEffect(refocus, [])

  const loadToday = useCallback(async () => {
    const from = new Date(`${manilaToday()}T00:00:00+08:00`).toISOString()
    const { data, error } = await supabase.from('checkins').select('id, checked_at, status, members(full_name, code)').gte('checked_at', from).order('checked_at', { ascending: false })
    if (!error) setToday(data)
  }, [])
  useEffect(() => {
    loadToday()
  }, [loadToday])

  const submit = async (e) => {
    e.preventDefault()
    const c = code.trim()
    if (!c || busy) return
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.rpc('check_in', { p_code: c })
    setBusy(false)
    setCode('')
    refocus()
    if (error) return setError(/check_in/.test(error.message) ? 'The database is missing an update: run supabase/019_checkins.sql.' : error.message)
    setResult({ scan: Date.now(), ...(data ? { member: data } : { missing: c }) })
    if (data?.logged) loadToday()
  }

  const m = result?.member
  const v = m && verdict(m)
  const members = today?.length ?? 0

  return (
    <main className="mx-auto grid max-w-[90rem] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_24rem] lg:px-10">
      <section aria-labelledby="checkin-h">
        <h1 id="checkin-h" className="font-display text-5xl font-black uppercase leading-none">Check-in</h1>
        <p className="mt-1 text-smoke">Scan the member's pass, or type their gym code and press Enter.</p>

        <form onSubmit={submit} className="mt-6">
          <label htmlFor="scan" className="sr-only">
            Pass or gym code
          </label>
          <div className="relative">
            <ScanLine className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-smoke" aria-hidden="true" />
            <input
              id="scan"
              ref={input}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onBlur={() => setTimeout(() => !document.activeElement?.closest('button, a, input, select, textarea') && refocus(), 0)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="Waiting for a scan…"
              className="tabular h-16 w-full rounded-2xl bg-paper pr-28 pl-14 text-xl ring-1 ring-ink/15 outline-none transition-shadow duration-150 placeholder:text-smoke/70 focus:ring-2 focus:ring-gold"
            />
            <button type="submit" disabled={busy || !code.trim()} className="press absolute top-2 right-2 bottom-2 flex items-center gap-2 rounded-xl bg-ink px-5 font-semibold text-paper disabled:opacity-40">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} Check in
            </button>
          </div>
        </form>
        {error && <div className="mt-4"><Problem>{error}</Problem></div>}

        <div aria-live="assertive" className="mt-6">
          <AnimatePresence mode="popLayout" initial={false}>
            {result && (
              <motion.div
                key={result.scan}
                initial={{ opacity: 0, transform: 'scale(0.97)' }}
                animate={{ opacity: 1, transform: 'scale(1)' }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                transition={{ duration: 0.16, ease: EASE_OUT }}
                className="overflow-hidden rounded-2xl ring-1 ring-ink/10"
              >
                {result.missing ? (
                  <div className="flex items-center gap-4 bg-crimson p-6 text-paper">
                    <CircleX className="size-12 shrink-0" aria-hidden="true" />
                    <div>
                      <p className="font-display text-4xl font-black uppercase leading-none">Not a pass</p>
                      <p className="mt-1 text-paper/85">Nothing matches that scan. Ask for their gym code or register them in Members.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className={`flex items-center gap-4 p-6 ${v.tone}`}>
                      <v.Icon className="size-14 shrink-0" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="font-display text-6xl font-black uppercase leading-none">{v.word}</p>
                        <p className="mt-1 font-semibold opacity-90">{v.note}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-end justify-between gap-4 bg-paper p-6">
                      <div className="min-w-0">
                        <p className="truncate font-display text-4xl font-extrabold uppercase leading-none">{m.full_name}</p>
                        <p className="tabular mt-1 font-semibold text-smoke">{m.code}</p>
                        <p className="mt-3 text-sm text-smoke">
                          {m.logged ? (m.last_visit ? `Last visit ${fmtDay(new Date(m.last_visit).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }))}` : 'First visit') : `Already checked in at ${time(m.last_visit)}`} · {m.visits_this_month} this month ·{' '}
                          {m.member_until && m.member_until >= manilaToday() ? `Annual membership until ${longDay(m.member_until)}` : 'No annual membership'}
                        </p>
                      </div>
                      {m.status !== 'active' || daysLeft(m.ends_on) <= 3 ? (
                        <button
                          type="button"
                          onClick={() => navigate('/', { state: { member: { id: m.id, code: m.code, full_name: m.full_name, ends_on: m.ends_on, member_until: m.member_until } } })}
                          className="press rounded-xl bg-gold px-5 py-3 font-display text-lg font-black uppercase text-ink"
                        >
                          {m.status === 'new' ? 'Sell a plan' : 'Renew'}
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <aside aria-labelledby="today-h" className="rounded-2xl bg-paper p-5 ring-1 ring-ink/10 lg:self-start">
        <div className="flex items-baseline justify-between">
          <h2 id="today-h" className="font-display text-2xl font-extrabold uppercase">Today</h2>
          <p className="tabular text-sm text-smoke">
            <b className="text-ink">{members}</b> check-in{members === 1 ? '' : 's'}
          </p>
        </div>
        {!today && <p className="mt-4 text-sm text-smoke">Loading…</p>}
        {today?.length === 0 && <p className="mt-4 text-sm text-smoke">No one yet. Scans show up here.</p>}
        <ol className="mt-3 divide-y divide-ink/8">
          {today?.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="tabular w-16 shrink-0 text-smoke">{time(c.checked_at)}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">{c.members?.full_name}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${c.status === 'active' ? 'bg-active/12 text-[#0B6B35]' : c.status === 'expired' ? 'bg-crimson/10 text-crimson' : 'bg-mist text-smoke'}`}>
                {c.status === 'active' ? 'Active' : c.status === 'expired' ? 'Expired' : 'No plan'}
              </span>
            </li>
          ))}
        </ol>
      </aside>
    </main>
  )
}
