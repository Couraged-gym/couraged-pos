import { Fragment, useCallback, useEffect, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { Ban, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { manilaToday, money } from '../../lib/util.js'
import { Sheet } from '../../components/ui.jsx'
import { MoneyField, Problem, StatusPill, Submit, field, label } from '../../components/form.jsx'
import { fmtDay } from './Payroll.jsx'

// Cash advances: money staff owe back, repaid by deduction on their payslips (filled in on
// each pay run). Not an expense, so it never touches profit. One open advance per person.
export default function Advances() {
  const [rows, setRows] = useState(null)
  const [emps, setEmps] = useState([])
  const [repaid, setRepaid] = useState({}) // advance id -> [{ pay_date, amount }]
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    const [a, e, p] = await Promise.all([
      supabase.from('v_cash_advances').select('*').order('given_on', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('employees').select('id, full_name, is_active').order('full_name'),
      supabase.from('payroll_items').select('advance_id, cash_advance, payroll_runs!inner(pay_date, status)').not('advance_id', 'is', null).eq('payroll_runs.status', 'finalized'),
    ])
    const err = [a, e, p].find((x) => x.error)?.error
    if (err) return setError(err.message)
    setError(null)
    setRows(a.data)
    setEmps(e.data)
    const by = {}
    for (const it of p.data.filter((x) => Number(x.cash_advance) > 0)) (by[it.advance_id] ??= []).push({ pay_date: it.payroll_runs.pay_date, amount: it.cash_advance })
    Object.values(by).forEach((l) => l.sort((x, y) => (x.pay_date < y.pay_date ? -1 : 1)))
    setRepaid(by)
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const name = Object.fromEntries(emps.map((e) => [e.id, e.full_name]))
  const owing = (rows ?? []).filter((r) => r.status === 'active' && Number(r.balance) > 0)
  const outstanding = owing.reduce((s, r) => s + Number(r.balance), 0)

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-smoke">
          Repayments are deducted on each pay run, no interest. Get the employee's signed authorization for the deduction before giving the cash. Advances aren't expenses: they don't change profit.
        </p>
        <button type="button" onClick={() => setAdding(true)} className="press flex h-11 items-center gap-2 rounded-lg bg-gold px-4 font-semibold text-ink">
          <Plus className="size-4" aria-hidden="true" /> Give cash advance
        </button>
      </div>
      {error && (
        <div className="mt-4">
          <Problem>Couldn't load cash advances. {error} {/v_cash_advances|cash_advance/.test(error) && 'Run supabase/014_day_summary_advances_stock.sql in Supabase › SQL Editor.'}</Problem>
        </div>
      )}
      {rows && (
        <dl className="mt-4 grid grid-cols-2 overflow-hidden rounded-xl bg-paper ring-1 ring-ink/5 sm:max-w-md">
          <div className="border-r border-ink/8 p-4">
            <dt className="text-sm font-semibold text-smoke">Owed to the gym</dt>
            <dd className="tabular mt-1.5 font-display text-3xl font-black leading-none">{money(outstanding)}</dd>
          </div>
          <div className="p-4">
            <dt className="text-sm font-semibold text-smoke">Staff repaying</dt>
            <dd className="tabular mt-1.5 font-display text-3xl font-black leading-none">{owing.length}</dd>
          </div>
        </dl>
      )}
      <div className="mt-4 overflow-x-auto rounded-xl bg-paper ring-1 ring-ink/5">
        {!rows && !error && <div className="skeleton h-40" role="status" aria-label="Loading cash advances" />}
        {rows?.length === 0 && <p className="px-5 py-14 text-center text-smoke">No cash advances yet.</p>}
        {rows?.length > 0 && (
          <table className="tabular w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-ink/8 text-xs font-bold uppercase tracking-[0.08em] text-smoke">
              <tr>
                <th scope="col" className="px-5 py-3 font-bold">Employee</th>
                <th scope="col" className="px-3 py-3 text-right font-bold">Advance</th>
                <th scope="col" className="px-3 py-3 text-right font-bold">Per payday</th>
                <th scope="col" className="px-3 py-3 text-right font-bold">Repaid</th>
                <th scope="col" className="px-5 py-3 text-right font-bold">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {rows.map((r) => {
                const voided = r.status === 'voided'
                const done = !voided && Number(r.balance) <= 0
                return (
                  <Fragment key={r.id}>
                    <tr onClick={() => setOpen(open === r.id ? null : r.id)} className={`cursor-pointer transition-colors duration-150 hover:bg-mist/60 ${voided || done ? 'text-smoke' : ''}`}>
                      <td className="px-5 py-3">
                        <button type="button" aria-expanded={open === r.id} className="text-left">
                          <span className="block font-semibold text-ink">{name[r.employee_id] ?? 'Unknown'}</span>
                          <span className="block text-xs text-smoke">
                            Given {fmtDay(r.given_on, { month: 'short', day: 'numeric', year: 'numeric' })}
                            {r.reason ? ` · ${r.reason}` : ''}
                          </span>
                        </button>
                      </td>
                      <td className={`px-3 py-3 text-right ${voided ? 'line-through' : ''}`}>{money(r.amount)}</td>
                      <td className="px-3 py-3 text-right">{money(r.installment)}</td>
                      <td className="px-3 py-3 text-right">{money(r.repaid)}</td>
                      <td className="px-5 py-3 text-right">
                        {voided ? (
                          <StatusPill tone="bg-crimson/10 text-crimson" Icon={Ban}>
                            Voided
                          </StatusPill>
                        ) : done ? (
                          <StatusPill tone="bg-active/12 text-[#0B6B35]">Paid off</StatusPill>
                        ) : (
                          <b className="font-display text-xl font-black">{money(r.balance)}</b>
                        )}
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr>
                        <td colSpan={5} className="bg-mist/40 px-5 py-4">
                          <Detail adv={r} repayments={repaid[r.id] ?? []} onDone={load} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      <AnimatePresence>{adding && <NewAdvance key="new" emps={emps.filter((e) => e.is_active)} owing={owing} onClose={() => setAdding(false)} onDone={load} />}</AnimatePresence>
    </>
  )
}

function Detail({ adv, repayments, onDone }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const voidIt = async (e) => {
    e.preventDefault()
    if (!reason.trim()) return setErr('Give a reason for voiding.')
    setBusy(true)
    const { error } = await supabase.rpc('void_cash_advance', { p_id: adv.id, p_reason: reason.trim() })
    setBusy(false)
    if (error) return setErr(error.message)
    onDone()
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-smoke">Repayments</p>
        {repayments.length ? (
          <ul className="mt-2 space-y-1">
            {repayments.map((p, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span>Payslip of {fmtDay(p.pay_date, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                <span>{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-smoke">None yet. The next pay run deducts {money(Math.min(adv.installment, adv.balance))}.</p>
        )}
        {adv.status === 'voided' && <p className="mt-2 text-crimson">Voided: “{adv.void_reason}”</p>}
      </div>
      {adv.status === 'active' && Number(adv.repaid) === 0 && (
        <form onSubmit={voidIt} className="space-y-2">
          <label className={label}>
            Void this advance
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Entered by mistake, cash returned…" className={`${field} mt-1.5`} />
          </label>
          {err && <Problem>{err}</Problem>}
          <button type="submit" disabled={busy} className="press flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-crimson ring-1 ring-crimson/30 disabled:opacity-50">
            <Ban className="size-4" aria-hidden="true" /> Void advance
          </button>
        </form>
      )}
    </div>
  )
}

function NewAdvance({ emps, owing, onClose, onDone }) {
  const [f, setF] = useState({ employee_id: '', given_on: manilaToday(), amount: '', installment: '', reason: '', authorized: false })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }))
  const amount = Number(f.amount) || 0
  const inst = Number(f.installment) || 0
  const busyWith = owing.find((r) => r.employee_id === f.employee_id)

  const save = async (e) => {
    e.preventDefault()
    setErr(null)
    if (!f.employee_id) return setErr('Pick who gets the advance.')
    if (busyWith) return setErr(`They still owe ${money(busyWith.balance)} on their last advance.`)
    if (amount <= 0) return setErr('Enter the amount given.')
    if (inst <= 0 || inst > amount) return setErr('The deduction per payday must be more than zero and no more than the advance.')
    if (!f.authorized) return setErr('Tick the box once the employee has signed the deduction authorization.')
    setBusy(true)
    const { error } = await supabase.from('cash_advances').insert({ employee_id: f.employee_id, given_on: f.given_on, amount, installment: inst, reason: f.reason.trim() || null, authorized: true })
    setBusy(false)
    if (error) return setErr(error.message)
    onDone()
    onClose()
  }

  return (
    <Sheet title="Give cash advance" subtitle="Repaid by deduction on their next payslips." onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <label className={label}>
          Employee
          <select value={f.employee_id} onChange={(e) => set('employee_id')(e.target.value)} className={`${field} mt-1.5`}>
            <option value="">Pick someone…</option>
            {emps.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
          {busyWith && <span className="mt-1 block font-normal text-crimson">Still owes {money(busyWith.balance)} on an earlier advance.</span>}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Amount given
            <MoneyField value={f.amount} onChange={set('amount')} className="mt-1.5" />
          </label>
          <label className={label}>
            Deduct per payday
            <MoneyField value={f.installment} onChange={set('installment')} className="mt-1.5" />
          </label>
        </div>
        {amount > 0 && inst > 0 && inst <= amount && (
          <p className="text-sm text-smoke">
            Repaid over {Math.ceil(amount / inst)} payday{Math.ceil(amount / inst) === 1 ? '' : 's'}. You can change or skip a deduction on any pay run.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Date given
            <input type="date" value={f.given_on} onChange={(e) => e.target.value && set('given_on')(e.target.value)} className={`${field} tabular mt-1.5`} />
          </label>
          <label className={label}>
            Reason <span className="font-normal text-smoke">(optional)</span>
            <input value={f.reason} onChange={(e) => set('reason')(e.target.value)} placeholder="Medical, tuition…" className={`${field} mt-1.5`} />
          </label>
        </div>
        <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl bg-paper p-4 ring-1 ring-ink/5">
          <span>
            <span className="block font-semibold">The employee signed a written authorization</span>
            <span className="text-sm text-smoke">Required by DOLE before deducting from wages: the amount, the deduction per payday, and their signature. Keep the paper on file.</span>
          </span>
          <input type="checkbox" checked={f.authorized} onChange={(e) => set('authorized')(e.target.checked)} className="mt-1 size-5 shrink-0 accent-[#19171B]" />
        </label>
        {err && <Problem>{err}</Problem>}
        <Submit busy={busy}>Record advance</Submit>
      </form>
    </Sheet>
  )
}
