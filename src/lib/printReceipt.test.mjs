// npm run test:receipt — checks the ESC/POS receipt fits the 58mm paper and carries the right labels.
import assert from 'node:assert/strict'
import { daySummaryBytes, payslipBytes, receiptBytes, testReceipt } from './printReceipt.js'

let n = 0
const ok = (m) => console.log(`  ✓ ${++n} ${m}`)
const text = (b) => b.replace(/\x1b@|\x1b[Ead][\s\S]|\x1d![\s\S]/g, '') // drop the printer commands

const r = testReceipt()
const b = receiptBytes(r)
assert.ok([...b].every((c) => c.charCodeAt(0) < 128)); ok('plain ASCII bytes only (the peso sign becomes P)')
assert.ok(b.startsWith('\x1b@') && b.endsWith('\x1bd\x04')); ok('resets first, feeds past the tear bar last')
const lines = text(b).split('\n')
assert.ok(lines.every((l) => l.length <= 32), lines.find((l) => l.length > 32)); ok('every line fits 32 characters')
assert.ok(lines.includes('*** TEST PRINT ***') && lines.includes('Thank you!')); ok('banner and footer')
assert.equal(lines.find((l) => l.startsWith('TOTAL')), 'TOTAL'.padEnd(32 - 'P1,300'.length) + 'P1,300'); ok('total right-aligned')
const long = text(receiptBytes({ ...r, banner: 'VOIDED', items: [{ name: 'Protein shake chocolate extra large tub', qty: 10, lineTotal: 12345.5 }] })).split('\n')
assert.ok(long.includes('*** VOIDED ***') && long.every((l) => l.length <= 32)); ok('long item names wrap, VOIDED shows')
assert.ok(long.some((l) => l.startsWith('10 x Protein') && l.endsWith('P12,345.50'))); ok('price stays on the first line of a wrapped item')

const day = {
  date: '2026-10-22', first_no: 412, last_no: 467, receipts: 54, gross: 18450, discounts: 350, net: 18100, voids: { count: 2, total: 300 },
  payments: [{ method: 'cash', receipts: 40, total: 12200 }, { method: 'gcash', receipts: 14, total: 5900 }],
  categories: [{ category: 'Membership', total: 9000 }, { category: 'Gym time', total: 6650 }, { category: 'Drinks', total: 2800 }],
}
const x = daySummaryBytes(day, { printedBy: 'Ana Admin', methods: { cash: 'Cash', gcash: 'GCash' }, printedAt: 'Oct 22, 2026, 9:14 PM' })
const xl = text(x).split('\n')
assert.ok([...x].every((c) => c.charCodeAt(0) < 128) && xl.every((l) => l.length <= 32), xl.find((l) => l.length > 32)); ok('day summary: ASCII, every line fits 32 characters')
assert.equal(xl.find((l) => l.startsWith('NET SALES')), 'NET SALES'.padEnd(32 - 'P18,100'.length) + 'P18,100')
assert.ok(xl.some((l) => l.startsWith('Cash (40)') && l.endsWith('P12,200')) && xl.some((l) => l.startsWith('Cash sales') && l.endsWith('P12,200'))); ok('net sales, payments and expected cash in the drawer')
assert.ok(xl.includes('#00412-#00467'.padStart(32)) || xl.some((l) => l.endsWith('#00412-#00467'))); ok('first and last receipt numbers')
assert.ok(xl.includes('NOT AN OFFICIAL RECEIPT OR') || xl.some((l) => l.includes('NOT AN OFFICIAL RECEIPT'))); ok('marked internal, not an official receipt')
assert.ok(text(daySummaryBytes({ ...day, receipts: 0, gross: 0, discounts: 0, net: 0, first_no: null, payments: [], categories: [] })).includes('No sales')); ok('a day with no sales still prints')

const run = { period_start: '2026-10-01', period_end: '2026-10-15', pay_date: '2026-10-15', status: 'finalized' }
const slip = { employee_name: 'José Rizal', pay_basis: 'daily', rate: 650, days_worked: 10, basic_pay: 6500, overtime_pay: 0, allowances_taxable: 0, allowances_nontaxable: 0, gross_pay: 6500, sss_ee: 325, philhealth_ee: 250, pagibig_ee: 130, withholding_tax: 0, cash_advance: 500, advance_balance: 1500, other_deductions: 0, net_pay: 5295 }
const pl = text(payslipBytes(slip, run)).split('\n')
assert.ok(pl.every((l) => l.length <= 32) && pl.some((l) => l.startsWith('Employee') && l.endsWith('Jose Rizal'))); ok('payslip fits 32 characters, accents dropped')
assert.ok(pl.some((l) => l.startsWith('Cash advance') && l.endsWith('P500')) && pl.some((l) => l.includes('Balance left') && l.endsWith('P1,500'))); ok('payslip shows the cash advance and the balance left')
assert.ok(pl.some((l) => l.startsWith('Total deductions') && l.endsWith('P1,205')) && !pl.some((l) => l.startsWith('Overtime'))); ok('total deductions add up; zero lines are left out')
assert.ok(text(payslipBytes(slip, { ...run, status: 'draft' })).includes('*** DRAFT - NOT FINAL ***')); ok('draft payslips are marked')
console.log('all passed')
