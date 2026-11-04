import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { Loader2, ScanLine } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { manilaToday } from '../lib/util.js'
import { EASE_OUT } from '../components/ui.jsx'
import { Problem } from '../components/form.jsx'
import { ResultCard, renewOnRegister, time } from '../components/ScanResult.jsx'

// The door. Passes scanned on other screens are handled by ScanAnywhere; here staff can
// also type a gym code, and see everyone who came in today.
export default function CheckIn() {
  const navigate = useNavigate()
  const input = useRef(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { scan, member } — member null when nothing matched
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
    setResult({ scan: Date.now(), member: data })
    if (data?.logged) loadToday()
  }

  const count = today?.length ?? 0

  return (
    <main className="mx-auto grid max-w-[90rem] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_24rem] lg:px-10">
      <section aria-labelledby="checkin-h">
        <h1 id="checkin-h" className="font-display text-5xl font-black uppercase leading-none">Check-in</h1>
        <p className="mt-1 text-smoke">Scan the member's pass (works on any POS screen), or type their gym code here and press Enter.</p>

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
        {error && (
          <div className="mt-4">
            <Problem>{error}</Problem>
          </div>
        )}

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
                <ResultCard result={result} onRenew={(m) => renewOnRegister(navigate, m)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <aside aria-labelledby="today-h" className="rounded-2xl bg-paper p-5 ring-1 ring-ink/10 lg:self-start">
        <div className="flex items-baseline justify-between">
          <h2 id="today-h" className="font-display text-2xl font-extrabold uppercase">Today</h2>
          <p className="tabular text-sm text-smoke">
            <b className="text-ink">{count}</b> check-in{count === 1 ? '' : 's'}
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
