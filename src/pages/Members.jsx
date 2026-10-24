import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Route, Routes, useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, EyeOff, Loader2, Plus, RefreshCw, Search, UserRoundPlus } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { byCode, manilaToday, money, parseMemberCode } from '../lib/util.js'
import { fetchAll } from '../lib/reports.js'
import { fmtDay } from '../components/RangePicker.jsx'
import { Segmented, Sheet } from '../components/ui.jsx'
import { Notice, Problem, StatusPill, Submit, field, label } from '../components/form.jsx'
import { Drawer } from './Inventory.jsx'

// End date of the annual membership paid before the POS (a period with no sale), or ''.
const paidBefore = (periods) => periods?.find((p) => !p.sale_id && p.is_membership && !p.voided)?.ends_on ?? ''
const daysLeft = (end) => Math.round((Date.parse(end) - Date.parse(manilaToday())) / 864e5)
const missingPatch = (e) => (/schema cache|does not exist/i.test(e.message) ? 'The database is missing an update. In Supabase › SQL Editor, run supabase/009_members.sql, 011_member_codes.sql, 013_gym_rates.sql, 015_member_codes_payslip_lines.sql and 016_membership_paid_before.sql, then refresh this page.' : e.message)

// Words first, colour second.
export function standing(m) {
  if (m.status === 'new' || !m.ends_on) return ['No plan yet', 'bg-mist text-smoke ring-1 ring-ink/10']
  const left = daysLeft(m.ends_on)
  if (left < 0) return [`Expired ${fmtDay(m.ends_on)}`, 'bg-crimson/10 text-crimson']
  if (left <= 7) return [left === 0 ? 'Last day today' : `${left} day${left === 1 ? '' : 's'} left`, 'bg-gold/25 text-[#6B4E00]']
  return [`Active until ${fmtDay(m.ends_on)}`, 'bg-active/12 text-[#0B6B35]']
}

// Renewing and first plans are sold on the register, so payment, receipt and reports stay in one place.
const toRegister = (navigate, m) => navigate('/', { state: { member: { id: m.id, code: m.code, full_name: m.full_name, ends_on: m.ends_on ?? null, member_until: m.member_until ?? null } } })

const TABS = [
  ['Members', '/members'],
  ['Plans', '/members/plans'],
]

export default function Members() {
  return (
    <main className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6 lg:px-10">
      <h1 className="font-display text-5xl font-black uppercase leading-none">Members</h1>
      <p className="mt-1 text-smoke">Register members here, then sell or renew their plan on the register with their member code.</p>
      <nav aria-label="Members" className="mt-6 flex gap-1 overflow-x-auto border-b border-ink/10">
        {TABS.map(([text, to]) => (
          <NavLink key={text} to={to} end className="relative shrink-0 px-4 pt-1 pb-3 text-sm font-semibold">
            {({ isActive }) => (
              <>
                <span className={`transition-colors duration-150 ${isActive ? 'text-ink' : 'text-smoke hover:text-ink'}`}>{text}</span>
                {isActive && <motion.span layoutId="mem-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gold" transition={{ type: 'spring', duration: 0.3, bounce: 0.1 }} />}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<MemberList />} />
        <Route path="plans" element={<Plans />} />
      </Routes>
    </main>
  )
}

function MemberList() {
  const navigate = useNavigate()
  const [all, setAll] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('active')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null) // 'new' or a member id
  const [saved, setSaved] = useState(null)

  const load = useCallback(async () => {
    try {
      setAll((await fetchAll(() => supabase.from('v_members').select('*').order('code'))).sort(byCode))
      setError(null)
    } catch (e) {
      setError(missingPatch(e))
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const count = (s) => (all ?? []).filter((m) => m.status === s).length
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (all ?? []).filter((m) => (tab === 'all' || m.status === tab) && (!t || m.full_name.toLowerCase().includes(t) || m.code?.toLowerCase().includes(t) || (m.phone ?? '').includes(t)))
  }, [all, tab, q])
  const member = all?.find((m) => m.id === open)

  return (
    <>
      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center">
        <Segmented
          id="members-tab"
          className="md:w-[26rem]"
          value={tab}
          onChange={setTab}
          options={[
            ['active', `Active · ${count('active')}`],
            ['expired', `Expired · ${count('expired')}`],
            ['all', `All · ${all?.length ?? 0}`],
          ]}
        />
        <label className="relative block md:ml-auto md:w-72">
          <span className="sr-only">Search members by name, code or phone</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-smoke" aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, code or phone" className={`${field} pl-10`} />
        </label>
        <button type="button" onClick={() => setOpen('new')} className="press flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-gold px-4 font-semibold text-ink">
          <UserRoundPlus className="size-4" aria-hidden="true" /> Register member
        </button>
      </div>

      {saved && <div className="mt-4"><Notice>{saved}</Notice></div>}
      {error && (
        <p role="alert" className="mt-6 flex items-center gap-2 rounded-lg bg-crimson/10 px-4 py-3 text-sm text-crimson">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" /> {error}
        </p>
      )}
      {!all && !error && (
        <div role="status" aria-label="Loading members" className="mt-6 space-y-2">
          {[0, 1, 2, 3].map((k) => <div key={k} className="skeleton h-16 rounded-xl bg-paper" />)}
        </div>
      )}
      {all && shown.length === 0 && (
        <p className="mt-16 text-center text-smoke">{q ? `No member matches "${q}".` : tab === 'active' ? 'No active members yet.' : tab === 'expired' ? 'Nobody has lapsed.' : 'No members yet. Register the first one.'}</p>
      )}
      {shown.length > 0 && (
        <ul className="mt-4 divide-y divide-ink/5 overflow-hidden rounded-xl bg-paper ring-1 ring-ink/5">
          {shown.map((m) => {
            const [text, tone] = standing(m)
            return (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-mist/60">
                <button type="button" onClick={() => setOpen(m.id)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-semibold">
                    {m.code && <span className="tabular mr-1.5 rounded bg-ink px-1.5 py-0.5 text-xs font-bold text-gold">{m.code}</span>} {m.full_name}
                  </span>
                  <span className="block truncate text-sm text-smoke">{[m.member_until >= manilaToday() ? `Member until ${fmtDay(m.member_until)}` : 'Annual membership not paid', m.plan_name, m.phone].filter(Boolean).join(' · ')}</span>
                </button>
                <StatusPill tone={tone}>{text}</StatusPill>
                <button type="button" onClick={() => toRegister(navigate, m)} className="press flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ring-1 ring-ink/15">
                  <RefreshCw className="size-4" aria-hidden="true" /> <span className="max-sm:sr-only">{m.status === 'new' ? 'Sell plan' : 'Renew'}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <AnimatePresence>
        {open && (
          <MemberSheet
            key={open}
            member={open === 'new' ? null : member}
            onClose={() => setOpen(null)}
            onSaved={(msg) => (setSaved(msg), setOpen(null), load())}
            onSell={(m) => toRegister(navigate, m)}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// Membership plans and other services (no stock). Each shows as a card on the register.
function Plans() {
  const [items, setItems] = useState(null)
  const [people, setPeople] = useState({})
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(null) // { id } or { create: true }
  const [flash, setFlash] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('products').select('*').eq('kind', 'service').is('deleted_at', null).order('category').order('name')
    if (error) setError(error.message)
    else {
      setError(null)
      setItems(data)
    }
  }, [])
  useEffect(() => {
    load()
    supabase
      .from('profiles')
      .select('id, full_name')
      .then(({ data }) => setPeople(Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name]))))
  }, [load])

  const categories = [...new Set((items ?? []).map((p) => p.category))]
  const current = open?.id ? items?.find((p) => p.id === open.id) : null
  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-smoke">Plans with a length (e.g. Monthly, 30 days) ask for the member code when sold, and add the days to that member. Leave the length blank for walk-ins and other services.</p>
        <button type="button" onClick={() => (setFlash(null), setOpen({ create: true }))} className="press flex h-11 items-center gap-2 rounded-lg bg-gold px-4 font-semibold text-ink">
          <Plus className="size-4" aria-hidden="true" /> Add plan
        </button>
      </div>
      {flash && <div className="mt-4"><Notice>{flash}</Notice></div>}
      {error && <div className="mt-4"><Problem>Couldn't load plans. {error}</Problem></div>}
      {!items && !error && (
        <div role="status" aria-label="Loading plans" className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((k) => <div key={k} className="skeleton h-36 rounded-xl bg-paper" />)}
        </div>
      )}
      {items?.length === 0 && <p className="mt-16 text-center text-smoke">No plans yet. Add Monthly (30 days) to start selling memberships.</p>}
      {items?.length > 0 && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => (setFlash(null), setOpen({ id: p.id }))} className={`press flex h-full min-h-36 w-full flex-col rounded-xl bg-paper p-4 text-left ring-1 ring-ink/8 transition-shadow duration-150 hover:ring-ink/25 ${p.is_active ? '' : 'opacity-60'}`}>
                <span className="font-semibold leading-snug">{p.name}</span>
                <span className="mt-0.5 text-xs text-smoke">
                  {p.code} · {p.category}
                  {!p.is_active && (
                    <span className="ml-2 inline-flex items-center gap-1 font-semibold">
                      <EyeOff className="size-3" aria-hidden="true" /> Hidden
                    </span>
                  )}
                </span>
                <span className="tabular mt-auto pt-3 font-display text-3xl font-black leading-none">{money(p.selling_price)}</span>
                <span className={`mt-1.5 text-xs font-semibold ${p.duration_days ? 'text-[#0B6B35]' : 'text-smoke'}`}>{p.is_membership ? `Annual membership · ${p.duration_days} days` : p.members_only ? 'Members only' : p.duration_days ? `${p.duration_days} days gym time` : 'Not tracked per member'}</span>
                {p.student_price != null && <span className="tabular mt-0.5 text-xs font-semibold text-[#6B4E00]">Student/Senior/PWD {money(p.student_price)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <AnimatePresence>
        {open && (open.create || current) && (
          <Drawer
            key="plan"
            kind="service"
            tab="details"
            product={current}
            categories={categories}
            people={people}
            onClose={() => setOpen(null)}
            onSaved={async (id) => {
              await load()
              if (id) setOpen({ id })
            }}
            onDeleted={(msg) => (setOpen(null), setFlash(msg), load())}
          />
        )}
      </AnimatePresence>
    </>
  )
}

function MemberSheet({ member, onClose, onSaved, onSell }) {
  const create = !member
  const [f, setF] = useState({ code: member?.code ?? '', full_name: member?.full_name ?? '', phone: member?.phone ?? '', notes: member?.notes ?? '', paid_until: '' })
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [periods, setPeriods] = useState(null)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  useEffect(() => {
    if (create) return
    supabase
      .from('member_periods')
      .select('id, plan_name, starts_on, ends_on, voided, sale_id, is_membership, sales(sale_no)')
      .eq('member_id', member.id)
      .order('ends_on', { ascending: false })
      .then(({ data }) => {
        setPeriods(data ?? [])
        setF((x) => ({ ...x, paid_until: paidBefore(data) }))
      })
  }, [create, member?.id])

  const save = async (sell) => {
    const c = { code: f.code.trim().toUpperCase() || null, full_name: f.full_name.trim(), phone: f.phone.trim() || null, notes: f.notes.trim() || null }
    if (!c.full_name) return setErr('Enter their name.')
    if (c.code && !parseMemberCode(c.code)) return setErr('Gym codes look like CRDFH26-0012. Leave it blank to give the next one.')
    setBusy(sell ? 'sell' : 'save')
    setErr(null)
    const res = create ? await supabase.from('members').insert(c).select('id, code').single() : await supabase.from('members').update(c).eq('id', member.id)
    if (res.error) return setBusy(null), setErr(res.error.code === '23505' ? `${c.code} is already someone else's code.` : missingPatch(res.error))
    if (f.paid_until !== paidBefore(periods)) {
      const id = create ? res.data.id : member.id
      const { error } = await supabase.rpc('set_member_until', { p_member_id: id, p_until: f.paid_until || null })
      if (error) return setBusy(null), setErr(`${create ? `Registered as ${res.data.code}, but the` : 'The'} membership date wasn't saved. ${missingPatch(error)}`)
    }
    setBusy(null)
    if (sell) onSell({ ...member, ...c, ...(create && res.data), ...(f.paid_until && f.paid_until > (member?.member_until ?? '') && { member_until: f.paid_until }) })
    else onSaved(create ? `${c.full_name} registered as ${res.data.code}. Give them this code; they'll use it to pay and renew.` : `Saved ${c.full_name}.`)
  }

  const [text, tone] = member ? standing(member) : []
  return (
    <Sheet
      title={create ? 'Register member' : member.full_name}
      subtitle={create ? 'Their details. The plan is paid for on the register.' : <>{member.code && <b className="tabular mr-2 text-gold">{member.code}</b>}<StatusPill tone={tone}>{text}</StatusPill></>}
      onClose={onClose}
    >
      <form onSubmit={(e) => (e.preventDefault(), save(false))} className="space-y-4">
        <label className={label}>
          Gym code <span className="font-normal text-smoke">({create ? 'blank gives the next number' : 'change only to fix a typo'})</span>
          <input value={f.code} onChange={set('code')} autoCapitalize="characters" placeholder={`CRDFH${manilaToday().slice(2, 4)}-0001`} className={`${field} tabular mt-1.5 uppercase`} />
        </label>
        <label className={label}>
          Annual membership paid until <span className="font-normal text-smoke">(only if they paid before the POS)</span>
          <input type="date" value={f.paid_until} onChange={set('paid_until')} className={`${field} tabular mt-1.5`} />
        </label>
        <label className={label}>
          Full name
          <input autoFocus={create} value={f.full_name} onChange={set('full_name')} className={`${field} mt-1.5`} />
        </label>
        <label className={label}>
          Mobile number <span className="font-normal text-smoke">(optional)</span>
          <input inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="0917 123 4567" className={`${field} tabular mt-1.5`} />
        </label>
        <label className={label}>
          Notes <span className="font-normal text-smoke">(optional)</span>
          <textarea rows={2} value={f.notes} onChange={set('notes')} placeholder="Emergency contact, injuries, coach…" className={`${field} mt-1.5 h-auto py-2.5`} />
        </label>
        {err && <Problem>{err}</Problem>}
        <Submit type="button" busy={busy === 'sell'} disabled={busy !== null} tone="bg-gold text-ink" onClick={() => save(true)}>
          {create ? 'Save and sell a plan' : member.status === 'new' ? 'Sell a plan' : 'Renew'}
        </Submit>
        <button type="submit" disabled={busy !== null} className="press flex h-11 w-full items-center justify-center gap-2 rounded-xl font-semibold ring-1 ring-ink/15 disabled:opacity-40">
          {busy === 'save' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} {create ? 'Save only' : 'Save details'}
        </button>
      </form>

      {!create && (
        <section className="mt-8">
          <h3 className="font-display text-xl font-extrabold uppercase leading-none">Plans paid</h3>
          {!periods && <p className="mt-3 text-sm text-smoke">Loading…</p>}
          {periods?.length === 0 && <p className="mt-3 text-sm text-smoke">Nothing yet.</p>}
          <ul className="tabular mt-3 space-y-2 text-sm">
            {periods?.map((p) => (
              <li key={p.id} className={`flex justify-between gap-3 rounded-lg bg-paper px-3 py-2.5 ring-1 ring-ink/5 ${p.voided ? 'text-smoke line-through' : ''}`}>
                <span>
                  <b className="font-semibold">{p.plan_name}</b> · {fmtDay(p.starts_on)} – {fmtDay(p.ends_on, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                <span className="shrink-0 text-smoke">{p.voided ? 'Voided' : p.sales?.sale_no ? `#${String(p.sales.sale_no).padStart(5, '0')}` : p.sale_id ? '' : 'Paid before'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Sheet>
  )
}
