import { useEffect, useMemo, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { manilaToday, money } from '../lib/util.js'
import RangePicker, { addDays, monthStart } from '../components/RangePicker.jsx'
import { Segmented, Sheet } from '../components/ui.jsx'
import { Notice, Problem, Submit } from '../components/form.jsx'
import { buildExport, fileName, toCsv, toXlsx, totals } from '../lib/salesExport.js'

// Manila days; weeks run Monday to Sunday.
function presets() {
  const t = manilaToday()
  const mon = addDays(t, -((new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7))
  return [
    ['today', 'Today', t, t],
    ['yesterday', 'Yesterday', addDays(t, -1), addDays(t, -1)],
    ['week', 'This week', mon, addDays(mon, 6)],
    ['lastweek', 'Last week', addDays(mon, -7), addDays(mon, -1)],
    ['month', 'This month', monthStart(t), t],
  ]
}

const REPORTS = {
  daily: ['Daily', 'One section per day: in Excel a tab per day (like 10-12-26) plus a Summary tab.'],
  summary: ['Summary', 'One table for the whole range, grouped by product, with a subtotal per product.'],
  transactions: ['Transactions', 'Every item on every receipt, voided ones included, for auditing.'],
}

function save(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// Sales in the gym's own spreadsheet layout, as CSV or Excel. Admin only (Analytics).
export default function ExportSheet({ onClose }) {
  const base = useMemo(presets, [])
  const [range, setRange] = useState({ key: 'lastweek', from: base[3][2], to: base[3][3] })
  const [report, setReport] = useState('summary')
  const [format, setFormat] = useState('xlsx')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const log = report === 'transactions'

  useEffect(() => {
    let live = true
    setData(null)
    setError(null)
    setDone(null)
    supabase.rpc('sales_export', { p_from: range.from, p_to: range.to, p_log: log }).then(({ data, error }) => {
      if (!live) return
      if (error) setError(error.message)
      else setData(data)
    })
    return () => (live = false)
  }, [range.from, range.to, log])

  const t = data && totals(data)
  const download = async () => {
    setBusy(true)
    setError(null)
    try {
      const sheets = buildExport(data, report, format)
      const name = fileName(report, data.from, data.to, format)
      if (format === 'csv') save(new Blob([toCsv(sheets[0])], { type: 'text/csv;charset=utf-8' }), name)
      else save(new Blob([toXlsx(await import('xlsx'), sheets)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name)
      setDone(name)
    } catch (e) {
      setError(e.message ?? String(e))
    }
    setBusy(false)
  }

  return (
    <Sheet title="Export sales" subtitle="Your payment sheet, filled in. Opens in Excel or Google Sheets." onClose={onClose}>
      <div className="space-y-5">
        <RangePicker id="export" opts={[...base, ['custom', 'Custom', range.from, range.to]]} range={range} setRange={setRange} />
        <div>
          <p className="text-sm font-semibold">Report</p>
          <Segmented id="export-report" className="mt-1.5" value={report} onChange={setReport} options={Object.entries(REPORTS).map(([k, [l]]) => [k, l])} />
          <p className="mt-1.5 text-sm text-smoke">{REPORTS[report][1]}</p>
        </div>
        <div>
          <p className="text-sm font-semibold">Format</p>
          <Segmented id="export-format" className="mt-1.5" value={format} onChange={setFormat} options={[['xlsx', 'Excel (.xlsx)'], ['csv', 'CSV']]} />
        </div>

        <section aria-live="polite" className="rounded-xl bg-paper p-4 ring-1 ring-ink/5">
          <h3 className="font-display text-xl font-extrabold uppercase leading-none">What's in it</h3>
          {!t && !error && <p className="mt-3 flex items-center gap-2 text-sm text-smoke"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Adding up…</p>}
          {t && (
            <dl className="tabular mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {[
                ['Items sold', t.items.toLocaleString('en-PH')],
                ['Sales', money(t.revenue)],
                ['Cost of goods', money(t.cost)],
                ['Profit', money(t.profit)],
                ['GCash', money(t.gcash)],
                ['Cash', money(t.cash)],
                ...(data.other_methods.length ? [['Other', money(t.other)]] : []),
                ['Discounts', t.discounts ? `−${money(t.discounts)}` : 'None'],
                ['Voided (left out)', t.voided ? `${t.voided} · ${money(t.voidedTotal)}` : 'None'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 border-b border-ink/5 pb-1.5">
                  <dt className="text-smoke">{k}</dt>
                  <dd className="font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {t && <p className="mt-3 text-xs text-smoke">Sales and profit are after discounts, so they match Analytics for the same dates.{data.other_methods.length ? ' Other = Maya, card, bank transfer and other.' : ''}</p>}
        </section>

        {error && <Problem>Couldn't export. {error}</Problem>}
        {done && <Notice>Downloaded {done}. Check your downloads folder.</Notice>}
        <Submit type="button" busy={busy} disabled={!data} onClick={download}>
          {!busy && <Download className="size-5" aria-hidden="true" />} Download
        </Submit>
      </div>
    </Sheet>
  )
}
