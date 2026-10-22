// Prints receipts as ESC/POS commands (the receipt printer's own language) through the receipt
// helper on the front desk PC (public/helper/receipt-helper.ps1), which hands the bytes to the
// Windows print queue untouched. Chrome's printing is not used: through the XP-58 driver it gave
// blank paper or fed the whole roll, while raw ESC/POS is what the PC's old POS does too.
import { money } from './util.js'
import { RECEIPT } from '../config/receipt.js'

const ESC = '\x1b', GS = '\x1d'
const BOLD = ESC + 'E\x01', NORMAL_WEIGHT = ESC + 'E\x00'
const CENTER = ESC + 'a\x01', LEFT = ESC + 'a\x00'
const BIG = GS + '!\x11', TALL = GS + '!\x01', NORMAL_SIZE = GS + '!\x00'
const FEED = ESC + 'd\x04' // feed 4 lines so the paper clears the tear bar

// The printer's built-in font is plain ASCII: drop accents and symbols like the peso sign.
const ascii = (s) => String(s ?? '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '')
const peso = (n) => 'P' + money(n).replace('₱', '')

function wrap(s, w) {
  const out = []
  while (s.length > w) {
    let cut = s.lastIndexOf(' ', w)
    if (cut <= 0) cut = w
    out.push(s.slice(0, cut))
    s = s.slice(cut).trimStart()
  }
  return [...out, s]
}

// Line helpers for a paper width (characters per line in the standard font).
function layout(paperWidth) {
  const W = paperWidth === 80 ? 48 : 32
  // Label on the left (wrapping if long), value right-aligned on the first line.
  const row = (l, v) => {
    v = ascii(v)
    const [first, ...rest] = wrap(ascii(l), W - v.length - 1)
    return [first.padEnd(W - v.length) + v, ...rest].join('\n') + '\n'
  }
  const centred = (s) => wrap(ascii(s), W).join('\n') + '\n'
  const hr = '-'.repeat(W) + '\n'
  // Reset, optional banner, store name in large print (centred; switch back with LEFT).
  const title = (storeName, banner) => ESC + '@' + CENTER + (banner ? BOLD + centred(`*** ${banner} ***`) + NORMAL_WEIGHT : '') + BIG + wrap(ascii(storeName), W / 2).join('\n') + '\n' + NORMAL_SIZE
  const bold = (s) => BOLD + s + NORMAL_WEIGHT
  const big = (l, v) => BOLD + TALL + row(l, v) + NORMAL_SIZE + NORMAL_WEIGHT
  return { row, centred, hr, title, bold, big }
}

// receipt: { storeName, headerLines[], footerLines[], paperWidth (58|80), receiptNo, date, cashier, customer,
//   items[{ name, qty, lineTotal }], subtotal, discount, total,
//   paymentMethod (label), paymentRef, cash, change, banner (e.g. 'REPRINT', 'VOIDED'), validUntil (membership) }
// Returns the ESC/POS commands as a string of byte values (all below 128).
export function receiptBytes(r) {
  const { row, centred, hr, title, big } = layout(r.paperWidth)
  return [
    title(r.storeName, r.banner),
    ...(r.headerLines ?? []).filter(Boolean).slice(0, 3).map(centred),
    LEFT,
    hr,
    r.receiptNo ? row('Receipt #', r.receiptNo) : '',
    row('Date', r.date),
    r.cashier ? row('Staff', r.cashier) : '',
    r.customer ? row('Customer', r.customer) : '',
    r.validUntil ? row('Member until', r.validUntil) : '',
    hr,
    ...r.items.map((i) => row(`${i.qty} x ${i.name}`, peso(i.lineTotal))),
    hr,
    row('Subtotal', peso(r.subtotal)),
    row('Discount', Number(r.discount) > 0 ? '-' + peso(r.discount) : peso(0)),
    big('TOTAL', peso(r.total)),
    hr,
    row('Payment', (r.paymentMethod ?? 'Cash') + (r.paymentRef ? ` ref ${r.paymentRef}` : '')),
    row('Tendered', peso(r.cash ?? r.total)),
    row('Change', peso(r.change ?? 0)),
    hr,
    CENTER,
    ...(r.footerLines ?? []).filter(Boolean).map(centred),
    FEED,
  ].join('')
}

const fmtDate = (d) => new Date(String(d).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-PH', { timeZone: 'UTC', dateStyle: 'medium' })
const now = () => new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
const minus = (v) => (Number(v) > 0 ? '-' + peso(v) : peso(0))

// End-of-day X-reading. s = day_summary() result; methods = { cash: 'Cash', ... } labels.
// It only reads totals (nothing resets), so it can be printed as often as needed. Not a BIR
// Z-reading: the footer says so, so it's never taken for an official document.
export function daySummaryBytes(s, { printedBy, methods = {}, printedAt = now(), paperWidth = RECEIPT.paperWidth, storeName = RECEIPT.storeName } = {}) {
  const { row, centred, hr, title, bold, big } = layout(paperWidth)
  const no = (n) => '#' + String(n).padStart(5, '0')
  const cash = s.payments.filter((p) => p.method === 'cash').reduce((t, p) => t + Number(p.total), 0)
  return [
    title(storeName),
    bold(centred('DAY SUMMARY (X-READING)')),
    LEFT,
    hr,
    row('Date', fmtDate(s.date)),
    row('Printed', printedAt),
    printedBy ? row('By', printedBy) : '',
    s.first_no ? row('Receipt nos.', `${no(s.first_no)}-${no(s.last_no)}`) : '',
    hr,
    row('Receipts', String(s.receipts)),
    row('Gross sales', peso(s.gross)),
    row('Discounts', minus(s.discounts)),
    big('NET SALES', peso(s.net)),
    row(`Voided (${s.voids.count}), not counted`, peso(s.voids.total)),
    hr,
    bold('PAYMENTS\n'),
    ...(s.payments.length ? s.payments.map((p) => row(`${methods[p.method] ?? p.method} (${p.receipts})`, peso(p.total))) : [row('No sales', peso(0))]),
    hr,
    bold('BY CATEGORY, BEFORE DISCOUNTS\n'),
    ...s.categories.map((c) => row(c.category || 'Other', peso(c.total))),
    hr,
    bold('CASH DRAWER\n'),
    row('Cash sales', peso(cash)),
    row('Counted', '___________'),
    row('Over / short', '___________'),
    hr,
    CENTER,
    centred('INTERNAL REPORT'),
    centred('NOT AN OFFICIAL RECEIPT OR INVOICE'),
    FEED,
  ].join('')
}

// One payslip on the receipt printer. it = payslip (stored row or computed draft), run = its pay run.
export function payslipBytes(it, run, { position, paperWidth = RECEIPT.paperWidth, storeName = RECEIPT.storeName } = {}) {
  const { row, hr, title, bold, big, centred } = layout(paperWidth)
  const n = (v) => Number(v) || 0
  const opt = (l, v) => (n(v) ? row(l, peso(v)) : '') // optional lines print only when there's an amount
  const ded = ['sss_ee', 'philhealth_ee', 'pagibig_ee', 'withholding_tax', 'cash_advance', 'other_deductions'].reduce((t, k) => t + n(it[k]), 0)
  const basis = { monthly: 'month', daily: 'day', hourly: 'hour' }[it.pay_basis]
  const has = (v) => v != null && v !== ''
  const worked = has(it.days_worked) ? `${n(it.days_worked)} days` : has(it.hours_worked) ? `${n(it.hours_worked)} hrs` : null
  return [
    title(storeName, run.status === 'finalized' ? null : 'DRAFT - NOT FINAL'),
    bold(centred('PAYSLIP')),
    LEFT,
    hr,
    row('Employee', it.employee_name),
    position ? row('Position', position) : '',
    row('Period', `${fmtDate(run.period_start)} - ${fmtDate(run.period_end)}`),
    row('Pay date', fmtDate(run.pay_date)),
    row('Rate', `${peso(it.rate)}/${basis}`),
    worked ? row('Worked', worked) : '',
    hr,
    bold('EARNINGS\n'),
    row('Basic pay', peso(it.basic_pay)),
    opt('Overtime', it.overtime_pay),
    opt('Allowances (taxable)', it.allowances_taxable),
    opt('Allowances (non-taxable)', it.allowances_nontaxable),
    bold(row('Gross pay', peso(it.gross_pay))),
    hr,
    bold('DEDUCTIONS\n'),
    row('SSS', peso(it.sss_ee)),
    row('PhilHealth', peso(it.philhealth_ee)),
    row('Pag-IBIG', peso(it.pagibig_ee)),
    row('Withholding tax', peso(it.withholding_tax)),
    opt('Cash advance', it.cash_advance),
    n(it.cash_advance) && it.advance_balance != null ? row('  Balance left', peso(it.advance_balance)) : '',
    opt('Other' + (it.deductions_note ? ` (${it.deductions_note})` : ''), it.other_deductions),
    bold(row('Total deductions', peso(ded))),
    hr,
    big('NET PAY', peso(it.net_pay)),
    hr,
    '\nReceived by:\n\n\n' + '_'.repeat(28) + '\n',
    'Signature over printed name\n',
    FEED,
  ].join('')
}

// Latest end date of the membership this sale paid for, e.g. "Nov 19, 2026" (member_periods read back with the sale).
export const validUntil = (sale) => {
  const end = (sale.member_periods ?? []).map((p) => p.ends_on).sort().at(-1)
  return end ? new Date(end + 'T00:00:00Z').toLocaleDateString('en-PH', { timeZone: 'UTC', dateStyle: 'medium' }) : null
}

// A saved sale row (with sale_items) -> receiptBytes input. Voided sales always print VOIDED.
export const saleReceipt = (sale, { cashier, method, banner } = {}) => ({
  ...RECEIPT,
  banner: sale.status === 'voided' ? 'VOIDED' : banner,
  receiptNo: sale.sale_no ? String(sale.sale_no).padStart(5, '0') : null,
  date: new Date(sale.sold_at ?? Date.now()).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }),
  cashier,
  customer: sale.customer_name,
  validUntil: validUntil(sale),
  items: sale.sale_items.map((i) => ({ name: i.product_name, qty: i.qty, lineTotal: i.line_total })),
  subtotal: sale.subtotal,
  discount: sale.discount,
  total: sale.total,
  paymentMethod: method,
  paymentRef: sale.payment_ref,
  cash: sale.amount_tendered ?? sale.total,
  change: sale.change_due ?? 0,
})

// Sample receipt so staff can check the printer without making a sale.
export const testReceipt = () =>
  saleReceipt(
    {
      sale_no: 0,
      subtotal: 1350,
      discount: 50,
      total: 1300,
      amount_tendered: 1500,
      change_due: 200,
      customer_name: 'Sample <Customer> & Co.',
      sale_items: [
        { product_name: 'Day pass', qty: 1, line_total: 150 },
        { product_name: 'Monthly membership', qty: 1, line_total: 1000 },
        { product_name: 'Bottled water 500ml', qty: 4, line_total: 200 },
      ],
    },
    { cashier: 'Test', method: 'Cash', banner: 'TEST PRINT' },
  )

export const printReceipt = (r) => printBytes(receiptBytes(r))

// Sends ESC/POS bytes to the receipt helper.
export async function printBytes(bytes) {
  try {
    const res = await fetch(RECEIPT.helperUrl + '/print', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: btoa(bytes) })
    if (!res.ok) throw new Error(await res.text())
  } catch (e) {
    // fetch throws a TypeError when nothing is listening, i.e. the helper isn't running.
    alert(e instanceof TypeError ? "It didn't print: the receipt helper isn't running on this PC. Start it with start-receipt-helper.bat." : `It didn't print: ${e.message}`)
  }
}
