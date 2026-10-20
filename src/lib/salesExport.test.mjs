// npm run test:export — builds every export from a small sample and reads the Excel file back.
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { buildExport, fileName, tabName, toCsv, toXlsx, totals } from './salesExport.js'

const line = (date, kind, code, name, qty, unit_price, unit_cost, pay) => ({ date, kind, code, name, qty, unit_price, unit_cost, cash: 0, gcash: 0, other: 0, ...pay })
const data = {
  from: '2026-10-12',
  to: '2026-10-18',
  lines: [
    line('2026-10-12', 'good', 'CFH09', 'Pocari', 3, 58, 39, { cash: 116, gcash: 58 }),
    line('2026-10-12', 'service', 'MEM-M', 'Monthly', 1, 1200, 0, { gcash: 1200 }),
    line('2026-10-13', 'good', 'CFH09', 'Pocari', 1, 58, 39, { cash: 58 }),
    line('2026-10-13', 'good', 'CFH05', 'Gatorade "350ml"', 2, 50, 27.21, { cash: 100 }),
  ],
  discounts: [{ date: '2026-10-12', cash: 0, gcash: 8, other: 0 }],
  other_methods: [],
  voided: [{ date: '2026-10-13', time: '09:15', sale_no: 42, items: '1 x Red Bull', total: 45, reason: 'Wrong item' }],
  log: [
    { sale_no: 40, date: '2026-10-12', time: '08:01', staff: 'Sam', code: 'CFH09', name: 'Pocari', qty: 3, unit_price: 58, line_total: 174, method: 'cash', status: 'completed' },
    { sale_no: 42, date: '2026-10-13', time: '09:15', staff: 'Sam', code: 'CFH10', name: 'Red Bull', qty: 1, unit_price: 45, line_total: 45, method: 'cash', status: 'voided' },
  ],
}
let k = 0
const ok = (m) => console.log(`  ✓ ${++k} ${m}`)
const find = (sheet, label) => sheet.rows.find((r) => r.cells.includes(label))

const t = totals(data)
assert.deepEqual([t.items, t.revenue, t.cost, t.gcash, t.cash, t.discounts, t.voided], [7, 1524, 210.42, 1250, 274, 8, 1])
assert.equal(t.profit, 1313.58); ok('totals: discounts come off revenue, profit and GCash; voids stay out')

const [summary] = buildExport(data, 'summary', 'xlsx')
const grand = find(summary, 'GRAND TOTAL').cells
assert.deepEqual(grand.slice(2), [{ v: 7, f: '0' }, null, null, 210.42, 1313.58, 1250, 274, 1524]); ok('summary grand total row matches the totals')
assert.equal(find(summary, 'CFH09 POCARI SUBTOTAL').style, 'sub')
assert.deepEqual(find(summary, 'CFH09 POCARI SUBTOTAL').cells.slice(2), [{ v: 4, f: '0' }, null, null, 156, 76, 58, 174, 232]); ok('product sold on two days gets a yellow subtotal row')
assert.ok(!find(summary, 'CFH05 GATORADE "350ML" SUBTOTAL')); ok('a product on a single row gets no subtotal')
assert.deepEqual(find(summary, 'CFH09 POCARI').cells.slice(0, 6), ['2026-10-12', 'CFH09 POCARI', { v: 3, f: '0' }, 39, 19, 117]); ok('row: date, item, qty, unit cost, add on per unit, total cost')
assert.ok(!summary.rows.some((r) => r.cells.includes('Other'))); ok('no Other column without Maya/card/bank sales')
assert.ok(find(summary, 'VOIDED (not in the totals above)') && find(summary, 'Wrong item')); ok('voided section lists the receipt and reason')

const daily = buildExport(data, 'daily', 'xlsx')
assert.deepEqual(daily.map((s) => s.name), ['10-12-26', '10-13-26', 'Summary']); ok('daily Excel: one tab per day (named like 10-12-26) plus Summary')
assert.equal(tabName('2026-01-05'), '01-05-26')

const csv = toCsv(buildExport(data, 'daily', 'csv')[0])
assert.ok(csv.startsWith('﻿"COURAGED FITNESS HUB PAYMENT"\r\n')); ok('CSV starts with a BOM and the title')
const body = csv.split('\r\n').slice(3).filter(Boolean)
assert.ok(body.every((l) => /^"2026-10-1[23]"|^"Date"/.test(l))); ok('daily CSV: a Date column on every table row')
assert.ok(csv.includes('"2026-10-13","CFH05 GATORADE ""350ML""",2,27.21,22.79,54.42,45.58,0.00,100.00,100.00')); ok('CSV: quoted text, plain 2-decimal pesos, integer qty')
assert.ok(!csv.includes('₱') && csv.includes(',1200.00,') && !csv.includes('1,200')); ok('CSV: no peso signs or thousands separators')
assert.equal(fileName('summary', data.from, data.to, 'csv'), 'couraged_summary_2026-10-12_to_2026-10-18.csv')
assert.ok(toCsv(buildExport({ ...data, other_methods: ['maya'] }, 'summary', 'csv')[0]).includes('"Other","Total"')); ok('Other column appears when Maya/card/bank sales exist')

const log = buildExport(data, 'transactions', 'csv')[0]
assert.deepEqual(log.rows[4].cells, [{ v: 40, f: '0' }, '2026-10-12', '08:01', 'Sam', 'CFH09 POCARI', { v: 3, f: '0' }, 58, 174, 'Cash', 'Completed'])
assert.deepEqual(find(log, 'TOTAL COMPLETED (before discounts)').cells.slice(5, 8), [{ v: 3, f: '0' }, null, 174]); ok('transaction log: one row per item, voided excluded from its total')

const bytes = toXlsx(XLSX, daily)
const wb = XLSX.read(bytes, { type: 'array', cellStyles: true })
assert.deepEqual(wb.SheetNames, ['10-12-26', '10-13-26', 'Summary'])
const ws = wb.Sheets.Summary
const ref = Object.keys(ws).find((c) => ws[c].v === 'GRAND TOTAL')
const total = ws[ref.replace('B', 'J')]
assert.equal(total.v, 1524); assert.equal(total.z, '0.00'); ok('Excel reads back: tabs, values, 0.00 format')
const zip = XLSX.CFB.read(bytes, { type: 'array' })
const xml = (p) => new TextDecoder().decode(XLSX.CFB.find(zip, p).content)
assert.match(xml('/xl/styles.xml'), /<font><b\/>/); assert.match(xml('/xl/styles.xml'), /FFFFFF00/)
assert.match(xml('/xl/worksheets/sheet3.xml'), /<pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"\/>/); ok('bold header, yellow fill and frozen header row are in the file')
const grandRow = xml('/xl/worksheets/sheet3.xml').match(new RegExp(`<row r="${ref.slice(1)}"[^>]*>([\\s\\S]*?)</row>`))[1]
const xfs = xml('/xl/styles.xml').match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].match(/<xf [^>]*?(\/>|>[\s\S]*?<\/xf>)/g)
for (const s of grandRow.match(/s="(\d+)"/g)) assert.match(xfs[+s.slice(3, -1)], /applyFill="1"/)
ok('every cell in the grand total row is yellow')
console.log('all passed')
