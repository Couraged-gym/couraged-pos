// npm run test:export — builds every export from a small sample and reads the Excel file back.
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { buildExport, fileName, tabName, toCsv, toXlsx, totals } from './salesExport.js'

const line = (date, kind, code, name, qty, unit_price, unit_cost, pay) => ({ date, kind, code, name, qty, unit_price, unit_cost, cash: 0, gcash: 0, other: 0, ...pay })
const unit = (date, time, sale_no, kind, code, name, unit_price, unit_cost, method, disc = 0, student = false) => ({ date, time, sale_no, kind, code, name, unit_price, unit_cost, method, disc, student })
// Oct 12: two Pocari cash; one Pocari GCash with ₱8 off; a student Monthly by GCash (₱150 off).
// Oct 13: two Gatorade cash.
const data = {
  from: '2026-10-12',
  to: '2026-10-18',
  lines: [
    line('2026-10-12', 'good', 'CFH09', 'Pocari', 3, 58, 39, { cash: 116, gcash: 58 }),
    line('2026-10-12', 'service', 'MONTH', 'Monthly', 1, 1500, 0, { gcash: 1500 }),
    line('2026-10-13', 'good', 'CFH05', 'Gatorade "350ml"', 2, 50, 27.21, { cash: 100 }),
  ],
  discounts: [{ date: '2026-10-12', cash: 0, gcash: 158, other: 0 }],
  units: [
    unit('2026-10-12', '08:01', 40, 'good', 'CFH09', 'Pocari', 58, 39, 'cash'),
    unit('2026-10-12', '08:01', 40, 'good', 'CFH09', 'Pocari', 58, 39, 'cash'),
    unit('2026-10-12', '08:30', 41, 'good', 'CFH09', 'Pocari', 58, 39, 'gcash', 8),
    unit('2026-10-12', '09:00', 43, 'service', 'MONTH', 'Monthly', 1500, 0, 'gcash', 150, true),
    unit('2026-10-13', '10:00', 44, 'good', 'CFH05', 'Gatorade "350ml"', 50, 27.21, 'cash'),
    unit('2026-10-13', '10:00', 44, 'good', 'CFH05', 'Gatorade "350ml"', 50, 27.21, 'cash'),
  ],
  other_methods: [],
  voided: [{ date: '2026-10-13', time: '09:15', sale_no: 42, items: '1 x Red Bull', total: 45, reason: 'Wrong item' }],
  log: [
    { sale_no: 40, date: '2026-10-12', time: '08:01', staff: 'Sam', code: 'CFH09', name: 'Pocari', qty: 2, unit_price: 58, line_total: 116, method: 'cash', status: 'completed' },
    { sale_no: 42, date: '2026-10-13', time: '09:15', staff: 'Sam', code: 'CFH10', name: 'Red Bull', qty: 1, unit_price: 45, line_total: 45, method: 'cash', status: 'voided' },
  ],
}
let k = 0
const ok = (m) => console.log(`  ✓ ${++k} ${m}`)
const find = (sheet, label) => sheet.rows.find((r) => r.cells.includes(label))
const findAll = (sheet, label) => sheet.rows.filter((r) => r.cells.includes(label))
const one = { v: 1, f: '0' }

const t = totals(data)
assert.deepEqual([t.items, t.revenue, t.cost, t.gcash, t.cash, t.discounts, t.voided], [6, 1616, 171.42, 1400, 216, 158, 1])
assert.equal(t.profit, 1444.58); ok('totals: discounts come off revenue, profit and GCash; voids stay out')

// Daily: a tab per day, items and services side by side, one row per unit.
const daily = buildExport(data, 'daily', 'xlsx')
assert.deepEqual(daily.map((s) => s.name), ['10-12-26', '10-13-26']); ok('daily Excel: one tab per day, named like 10-12-26')
const [d12, d13] = daily
assert.equal(d12.rows[1].cells[0], 'Date of Transaction: October 12, 2026')
assert.equal(findAll(d12, 'CFH09 - POCARI').length, 3); ok('one row per unit sold, labelled like the manual sheet (CFH09 - POCARI)')
assert.deepEqual(findAll(d12, 'CFH09 - POCARI')[2].cells, ['CFH09 - POCARI', one, 39, 11, 50, 0, 50, null, null, null]); ok('a discounted item shows its price after the discount, in the SOLD ITEMS columns')
assert.deepEqual(find(d12, 'Monthly_Student/Sr./PWD').cells, ['Monthly_Student/Sr./PWD', one, null, null, null, null, null, 1350, 0, 1350]); ok('a student-rate service gets its own name at the student price, in the SERVICES columns')
assert.deepEqual(find(d12, 'TOTAL').cells, ['TOTAL', { v: 4, f: '0' }, 117, 49, 50, 116, 166, 1350, 0, 1350]); ok('TOTAL row: items and services side by side')
assert.deepEqual(find(d12, 'Items sold').cells, ['Items sold', 50, 116, 166])
assert.deepEqual(find(d12, 'Services').cells, ['Services', 1350, 0, 1350])
assert.deepEqual(find(d12, 'Total received').cells, ['Total received', 1400, 116, 1516]); ok('cash check: GCash and cash received for items, services and in total')
assert.ok(!find(d12, 'VOIDED (not in the totals above)') && find(d13, 'Wrong item')); ok('a void is listed on its own day only')

// Summary: Summary of Items and Summary of Services tabs.
const summary = buildExport(data, 'summary', 'xlsx')
assert.deepEqual(summary.map((s) => s.name), ['Summary of Items', 'Summary of Services'])
const [items, services] = summary
assert.equal(items.rows[1].cells[0], 'Period covered: October 12, 2026 to October 18, 2026')
const pocari = items.rows.findIndex((r) => r.cells[1] === 'CFH09 - POCARI') + 3
assert.deepEqual(items.rows[pocari].cells, [null, null, { v: 3, f: '0' }, 117, 49, 50, 116, 166]); assert.equal(items.rows[pocari].style, 'sub'); ok('every unit listed per product, then a yellow subtotal row')
assert.deepEqual(find(items, 'TOTAL SOLD ITEMS').cells, [null, 'TOTAL SOLD ITEMS', { v: 5, f: '0' }, 171.42, 94.58, 50, 216, 266])
assert.deepEqual(find(items, '2026-10-13').cells.slice(0, 3), ['2026-10-13', 'CFH05 - GATORADE "350ML"', one])
assert.deepEqual(items.rows.filter((r) => r.cells[0] === '2026-10-13' && r.cells[1] == null)[0].cells, ['2026-10-13', null, null, 54.42, 45.58, 0, 100, 100]); ok('Summary of Items: section total, then money per day')
assert.deepEqual(find(services, 'TOTAL SERVICES').cells, [null, 'TOTAL SERVICES', one, 1350, 0, 1350])
assert.ok(find(services, 'Wrong item')); ok('Summary of Services: no cost columns; voids listed at the end')
assert.throws(() => buildExport({ ...data, units: undefined }, 'daily', 'xlsx'), /029/); ok('without the 029 database update, the export says so')

// CSV: one file.
const csv = toCsv(buildExport(data, 'daily', 'csv')[0])
assert.ok(csv.startsWith('﻿"COURAGED FITNESS HUB PAYMENT"\r\n')); ok('CSV starts with a BOM and the title')
assert.ok(csv.includes('"Date of Transaction: October 12, 2026"') && csv.includes('"Date of Transaction: October 13, 2026"')); ok('daily CSV: every day in one file')
assert.ok(csv.includes('"CFH05 - GATORADE ""350ML""",1,27.21,22.79,0.00,50.00,50.00,,,')); ok('CSV: quoted text, plain 2-decimal pesos, integer count')
assert.ok(!csv.includes('₱') && csv.includes(',1350.00') && !csv.includes('1,350')); ok('CSV: no peso signs or thousands separators')
assert.equal(buildExport(data, 'summary', 'csv').length, 1); ok('summary CSV: both tabs in one file')
assert.equal(fileName('summary', data.from, data.to, 'csv'), 'couraged_summary_2026-10-12_to_2026-10-18.csv')
assert.equal(tabName('2026-01-05'), '01-05-26')
const maya = buildExport({ ...data, other_methods: ['maya'] }, 'daily', 'xlsx')[0]
assert.deepEqual(find(maya, 'Item').cells, ['Item', '#', 'Unit Cost', 'Add-On', 'GCash', 'Cash', 'Other', 'Total', 'GCash', 'Cash', 'Other', 'Total']); ok('Other columns appear when Maya/card/bank sales exist')

const log = buildExport(data, 'transactions', 'csv')[0]
assert.deepEqual(log.rows[4].cells, [{ v: 40, f: '0' }, '2026-10-12', '08:01', 'Sam', 'CFH09 POCARI', { v: 2, f: '0' }, 58, 116, 'Cash', 'Completed'])
assert.deepEqual(find(log, 'TOTAL COMPLETED (before discounts)').cells.slice(5, 8), [{ v: 2, f: '0' }, null, 116]); ok('transaction log: one row per item, voided excluded from its total')

// Excel file: values, formats and styling survive.
const bytes = toXlsx(XLSX, daily)
const wb = XLSX.read(bytes, { type: 'array', cellStyles: true })
assert.deepEqual(wb.SheetNames, ['10-12-26', '10-13-26'])
const ws = wb.Sheets['10-12-26']
const ref = Object.keys(ws).find((c) => ws[c].v === 'TOTAL')
const total = ws[ref.replace('A', 'J')]
assert.equal(total.v, 1350); assert.equal(total.z, '0.00'); ok('Excel reads back: tabs, values, 0.00 format')
const zip = XLSX.CFB.read(bytes, { type: 'array' })
const xml = (p) => new TextDecoder().decode(XLSX.CFB.find(zip, p).content)
assert.match(xml('/xl/styles.xml'), /<font><b\/>/); assert.match(xml('/xl/styles.xml'), /FFFFFF00/)
assert.match(xml('/xl/worksheets/sheet1.xml'), /<pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"\/>/); ok('bold header, yellow fill and frozen header row are in the file')
const totalRow = xml('/xl/worksheets/sheet1.xml').match(new RegExp(`<row r="${ref.slice(1)}"[^>]*>([\\s\\S]*?)</row>`))[1]
const xfs = xml('/xl/styles.xml').match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].match(/<xf [^>]*?(\/>|>[\s\S]*?<\/xf>)/g)
for (const s of totalRow.match(/s="(\d+)"/g)) assert.match(xfs[+s.slice(3, -1)], /applyFill="1"/)
ok('every cell in the TOTAL row is yellow')
console.log('all passed')
