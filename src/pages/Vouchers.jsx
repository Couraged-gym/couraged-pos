import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { Ban, FileCheck2, FilePen, Loader2, Plus, Printer, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { manilaToday, money, round2 } from '../lib/util.js'
import { printVoucher } from '../lib/reports.js'
import { useAuth } from '../auth.jsx'
import { Sheet } from '../components/ui.jsx'
import { MoneyField, Notice, Problem, StatusPill, Submit, field, label } from '../components/form.jsx'
import { addDays } from '../components/RangePicker.jsx'

// Check vouchers and journal vouchers, kept in the bookkeeper's layout (see voucherPdf in src/lib/pdf.js).
// They are documents for the books: the expense itself is recorded above, or comes from a pay run.
const KIND = { check: ['Check voucher', 'CV', FileCheck2], journal: ['Journal voucher', 'JV', FilePen] }
const fmt = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'short', day: 'numeric' })
const num = (v) => Number(v) || 0
const BLANK_LINE = { code: '', title: '', debit: '', credit: '' }

export default function Vouchers({ month }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(null) // { kind } for a new one, or a voucher row
  const [saved, setSaved] = useState(null)
  const [from, to] = [`${month}-01`, addDays(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1)).toISOString().slice(0, 10), -1)]

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('vouchers').select('*').gte('voucher_date', from).lte('voucher_date', to).order('voucher_date', { ascending: false }).order('voucher_no', { ascending: false })
    if (error) return setError(/vouchers/.test(error.message) ? 'Run supabase/017_finance_vouchers_payslip.sql in Supabase › SQL Editor to use vouchers.' : error.message)
    setError(null)
    setRows(data)
  }, [from, to])
  useEffect(() => {
    load()
  }, [load])

  return (
    <section className="mt-6 rounded-xl bg-paper p-5 ring-1 ring-ink/5" aria-labelledby="vouchers-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="vouchers-title" className="font-display text-2xl font-extrabold uppercase leading-none">
            Vouchers
          </h2>
          <p className="mt-1 text-sm text-smoke">Check and journal vouchers dated this month, printed in the bookkeeper's format.</p>
        </div>
        <div className="flex gap-2">
          {Object.entries(KIND).map(([k, [l, , Icon]]) => (
            <button key={k} type="button" onClick={() => (setSaved(null), setOpen({ kind: k }))} className="press flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold ring-1 ring-ink/15">
              <Icon className="size-4" aria-hidden="true" /> {l}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {saved && <Notice>{saved}</Notice>}
        {error && <Problem>{error}</Problem>}
      </div>
      {!rows && !error && <div className="skeleton mt-4 h-16 rounded-lg" role="status" aria-label="Loading vouchers" />}
      {rows?.length === 0 && <p className="mt-4 rounded-lg bg-mist p-4 text-sm text-smoke">No vouchers dated this month.</p>}
      {rows?.length > 0 && (
        <ul className="mt-4 divide-y divide-ink/5">
          {rows.map((v) => (
            <li key={v.id}>
              <button type="button" onClick={() => (setSaved(null), setOpen(v))} className="group flex w-full items-center gap-3 py-3 text-left">
                <span className="tabular w-10 shrink-0 rounded bg-ink px-1.5 py-0.5 text-center text-xs font-bold text-gold">{KIND[v.kind][1]}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate font-semibold group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4 ${v.status === 'voided' ? 'text-smoke' : ''}`}>
                    {v.voucher_no} · {v.payee || v.reference || KIND[v.kind][0]}
                  </span>
                  <span className="tabular block truncate text-xs text-smoke">{[fmt(v.voucher_date), v.check_no && `Check ${v.check_no}`, v.reference].filter(Boolean).join(' · ')}</span>
                </span>
                {v.status === 'voided' && <StatusPill tone="bg-crimson/10 text-crimson" Icon={Ban}>Voided</StatusPill>}
                <span className={`tabular shrink-0 font-display text-2xl font-black leading-none ${v.status === 'voided' ? 'text-smoke line-through decoration-2' : ''}`}>{money(v.amount)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <AnimatePresence>
        {open && (
          <VoucherSheet
            key={open.id ?? open.kind}
            voucher={open.id ? open : null}
            kind={open.kind}
            onClose={() => setOpen(null)}
            onSaved={(msg) => (setSaved(msg), setOpen(null), load())}
          />
        )}
      </AnimatePresence>
    </section>
  )
}

// Next number in the bookkeeper's style: year, month, then a 4-digit count (2026100009), per kind.
async function nextNumber(kind, date) {
  const prefix = date.slice(0, 4) + date.slice(5, 7)
  const { data } = await supabase.from('vouchers').select('voucher_no').eq('kind', kind).like('voucher_no', `${prefix}%`)
  const n = Math.max(0, ...(data ?? []).map((r) => Number(r.voucher_no.slice(prefix.length)) || 0))
  return prefix + String(n + 1).padStart(4, '0')
}

function VoucherSheet({ voucher, kind, onClose, onSaved }) {
  const { profile } = useAuth()
  const check = kind === 'check'
  const locked = voucher?.status === 'voided'
  const [f, setF] = useState(() =>
    voucher
      ? { ...voucher, amount: String(voucher.amount), check_date: voucher.check_date ?? '', lines: voucher.lines.length ? voucher.lines.map((l) => ({ ...BLANK_LINE, ...l, debit: l.debit ? String(l.debit) : '', credit: l.credit ? String(l.credit) : '' })) : [{ ...BLANK_LINE }] }
      : { voucher_no: '', voucher_date: manilaToday(), payee: '', bank: '', check_no: '', check_date: '', reference: '', amount: '', explanation: '', lines: [{ ...BLANK_LINE }], prepared_by: profile?.full_name ?? '', noted_by: '', approved_by: '', received_by: '', payroll_run_id: null },
  )
  const [runs, setRuns] = useState([])
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [reason, setReason] = useState('')
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }))
  const setLine = (i, k, v) => setF((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }))

  useEffect(() => {
    if (!voucher) nextNumber(kind, f.voucher_date).then((no) => setF((x) => (x.voucher_no ? x : { ...x, voucher_no: no })))
    if (check && !voucher)
      supabase
        .from('payroll_runs')
        .select('id, period_start, period_end, pay_date, payroll_items(employee_name, net_pay, loan)')
        .eq('status', 'finalized')
        .order('pay_date', { ascending: false })
        .limit(6)
        .then(({ data }) => setRuns(data ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A payroll check voucher, filled like the bookkeeper's: each person's net pay, then payroll + lending.
  const fromRun = (id) => {
    const r = runs.find((x) => x.id === id)
    if (!r) return
    const [a, b] = [r.period_start, r.period_end]
    const ref = `CFHI PAYROLL FTP ${a.slice(5, 7)}/${+a.slice(8)}-${+b.slice(8)}/${b.slice(0, 4)}`
    const its = [...r.payroll_items].sort((x, y) => x.employee_name.localeCompare(y.employee_name))
    const payroll = round2(its.reduce((t, it) => t + num(it.net_pay), 0))
    const lending = round2(its.reduce((t, it) => t + num(it.loan), 0))
    const peso = (v) => v.toLocaleString('en-PH', { minimumFractionDigits: 2 })
    const lenders = its.filter((it) => num(it.loan)).map((it) => it.employee_name.split(',')[0].trim().toLowerCase())
    setF((x) => ({
      ...x,
      payroll_run_id: r.id,
      payee: x.payee || 'COURAGED FITNESS HUB EMPLOYEES',
      reference: ref,
      amount: String(round2(payroll + lending)),
      explanation: [ref, ...its.map((it) => `${it.employee_name.toUpperCase()}-${peso(num(it.net_pay))}`), '', 'note:', `payroll - ${peso(payroll)}`, ...(lending ? [`lending- ${peso(lending)}${lenders.length ? ` (${lenders.join(', ')})` : ''}`] : []), `total - ${peso(round2(payroll + lending))}`].join('\n'),
    }))
  }

  const lines = f.lines.filter((l) => l.code.trim() || l.title.trim() || num(l.debit) || num(l.credit))
  const dr = round2(lines.reduce((t, l) => t + num(l.debit), 0))
  const cr = round2(lines.reduce((t, l) => t + num(l.credit), 0))
  const amount = check ? num(f.amount) : dr // a journal voucher's amount is its debits
  const row = () => ({
    kind,
    voucher_no: f.voucher_no.trim(),
    voucher_date: f.voucher_date,
    payee: f.payee?.trim() || null,
    bank: f.bank?.trim() || null,
    check_no: f.check_no?.trim() || null,
    check_date: f.check_date || null,
    reference: f.reference?.trim() || null,
    explanation: f.explanation?.trim() || null,
    amount,
    lines: lines.map((l) => ({ code: l.code.trim(), title: l.title.trim(), debit: num(l.debit), credit: num(l.credit) })),
    prepared_by: f.prepared_by?.trim() || null,
    noted_by: f.noted_by?.trim() || null,
    approved_by: f.approved_by?.trim() || null,
    received_by: f.received_by?.trim() || null,
    payroll_run_id: f.payroll_run_id ?? null,
  })

  const save = async (e) => {
    e.preventDefault()
    setErr(null)
    if (!f.voucher_no.trim()) return setErr('Give it a voucher number.')
    if (check && !f.payee?.trim()) return setErr('Who is the check payable to?')
    if (!amount) return setErr(check ? 'Enter the check amount.' : 'Add the account lines with their debits and credits.')
    if (!check && dr !== cr) return setErr(`Debits (${money(dr)}) and credits (${money(cr)}) must be equal.`)
    setBusy('save')
    const res = voucher ? await supabase.from('vouchers').update(row()).eq('id', voucher.id) : await supabase.from('vouchers').insert(row())
    setBusy(null)
    if (res.error) return setErr(/duplicate|unique/.test(res.error.message) ? `Voucher number ${f.voucher_no} is already used.` : res.error.message)
    onSaved(`${KIND[kind][1]} ${f.voucher_no} saved.`)
  }
  const print = async () => {
    setErr(null)
    try {
      await printVoucher({ ...(voucher ?? {}), ...row() })
    } catch (e) {
      setErr(e.message ?? String(e))
    }
  }
  const voidIt = async () => {
    if (!reason.trim()) return setErr('Say why it is voided, e.g. spoiled check.')
    setBusy('void')
    const { error } = await supabase.from('vouchers').update({ status: 'voided', void_reason: reason.trim() }).eq('id', voucher.id)
    setBusy(null)
    if (error) return setErr(error.message)
    onSaved(`${KIND[kind][1]} ${voucher.voucher_no} voided.`)
  }

  const text = (k, l, o = {}) => (
    <label className={label}>
      {l}
      <input value={f[k] ?? ''} onChange={(e) => set(k)(e.target.value)} disabled={locked} className={`${field} mt-1.5`} {...o} />
    </label>
  )
  return (
    <Sheet title={voucher ? `${KIND[kind][1]} ${voucher.voucher_no}` : `New ${KIND[kind][0].toLowerCase()}`} subtitle={locked ? `Voided: ${voucher.void_reason}` : check ? 'Payee, check details, explanation and account lines.' : 'Account lines must balance: debits equal credits.'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        {check && runs.length > 0 && !voucher && (
          <label className={label}>
            Fill from a pay run
            <select defaultValue="" onChange={(e) => fromRun(e.target.value)} className={`${field} mt-1.5 font-semibold`}>
              <option value="">Not a payroll check</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  Payroll {fmt(r.period_start)} – {fmt(r.period_end)} (paid {fmt(r.pay_date)})
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          {text('voucher_no', `${KIND[kind][1]} number`, { className: `${field} tabular mt-1.5` })}
          {text('voucher_date', `${KIND[kind][1]} date`, { type: 'date', className: `${field} tabular mt-1.5` })}
        </div>
        {check && (
          <>
            {text('payee', 'Payable to')}
            <div className="grid grid-cols-2 gap-3">
              {text('bank', 'Bank name', { placeholder: 'MBTC-COURAGED' })}
              {text('check_no', 'Check number', { className: `${field} tabular mt-1.5` })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {text('check_date', 'Check date', { type: 'date', className: `${field} tabular mt-1.5` })}
              <label className={label}>
                Amount
                <MoneyField value={f.amount} onChange={set('amount')} disabled={locked} className="mt-1.5" />
              </label>
            </div>
          </>
        )}
        {text('reference', 'Reference', { placeholder: check ? 'CFHI PAYROLL FTP 10/16-31/2026' : 'What this entry is for' })}
        <label className={label}>
          Explanation
          <textarea value={f.explanation ?? ''} onChange={(e) => set('explanation')(e.target.value)} disabled={locked} rows={6} className={`${field} mt-1.5 h-auto py-2 font-mono text-sm`} />
        </label>

        <fieldset>
          <legend className="text-sm font-semibold">Account lines</legend>
          <div className="mt-1.5 space-y-2">
            {f.lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[6.5rem_1fr_auto] gap-1.5 rounded-lg bg-paper p-2 ring-1 ring-ink/10">
                <input value={l.code} onChange={(e) => setLine(i, 'code', e.target.value)} disabled={locked} placeholder="Code" aria-label={`Account code, line ${i + 1}`} className="tabular h-9 rounded-md bg-mist px-2 text-sm outline-none focus:ring-2 focus:ring-gold" />
                <input value={l.title} onChange={(e) => setLine(i, 'title', e.target.value)} disabled={locked} placeholder="Account title" aria-label={`Account title, line ${i + 1}`} className="h-9 min-w-0 rounded-md bg-mist px-2 text-sm outline-none focus:ring-2 focus:ring-gold" />
                <button type="button" onClick={() => setF((x) => ({ ...x, lines: x.lines.length > 1 ? x.lines.filter((_, j) => j !== i) : [{ ...BLANK_LINE }] }))} disabled={locked} aria-label={`Remove line ${i + 1}`} className="press grid size-9 place-items-center rounded-md text-smoke hover:text-crimson">
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
                {['debit', 'credit'].map((k) => (
                  <input key={k} inputMode="decimal" value={l[k]} onChange={(e) => /^\d*\.?\d{0,2}$/.test(e.target.value) && setLine(i, k, e.target.value)} disabled={locked} placeholder={k === 'debit' ? 'Debit' : 'Credit'} aria-label={`${k}, line ${i + 1}`} className={`tabular h-9 rounded-md bg-mist px-2 text-right text-sm outline-none focus:ring-2 focus:ring-gold ${k === 'debit' ? 'col-span-1' : 'col-span-2'}`} />
                ))}
              </div>
            ))}
          </div>
          {!locked && (
            <button type="button" onClick={() => setF((x) => ({ ...x, lines: [...x.lines, { ...BLANK_LINE }] }))} className="press mt-2 flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-smoke ring-1 ring-ink/10 hover:text-ink">
              <Plus className="size-4" aria-hidden="true" /> Add line
            </button>
          )}
          <p className={`tabular mt-2 text-sm ${!check && dr !== cr ? 'font-semibold text-crimson' : 'text-smoke'}`}>
            Grand total: debit {money(dr)} · credit {money(cr)}
            {!check && ` · amount ${money(dr)}`}
          </p>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          {text('prepared_by', 'Prepared by')}
          {text('noted_by', 'Noted by')}
          {text('approved_by', 'Approved by')}
          {check && text('received_by', 'Received by')}
        </div>

        {err && <Problem>{err}</Problem>}
        {!locked && <Submit busy={busy === 'save'}>{voucher ? 'Save changes' : `Save ${KIND[kind][1]}`}</Submit>}
        <button type="button" onClick={print} className="press flex h-11 w-full items-center justify-center gap-2 rounded-lg font-semibold ring-1 ring-ink/15">
          <Printer className="size-4" aria-hidden="true" /> Print {KIND[kind][0].toLowerCase()}
        </button>
      </form>

      {voucher && !locked && (
        <div className="mt-6 space-y-3 rounded-xl p-5 ring-1 ring-crimson/25">
          <h3 className="font-display text-2xl font-extrabold uppercase leading-none">Void this voucher</h3>
          <p className="text-sm text-smoke">For a spoiled or cancelled check. It stays on record, marked voided, so the numbers have no gaps.</p>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Spoiled check, wrong amount…" aria-label="Reason for voiding" className={field} />
          <button type="button" onClick={voidIt} disabled={busy !== null} className="press flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-crimson font-semibold text-paper disabled:opacity-50">
            {busy === 'void' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Ban className="size-4" aria-hidden="true" />} Void {KIND[kind][1]} {voucher.voucher_no}
          </button>
        </div>
      )}
    </Sheet>
  )
}
