// Sales export in the gym's own sheet layout ("COURAGED FITNESS HUB PAYMENT"), from the
// sales_export database function. One sheet model feeds both CSV and Excel:
// sheet = { name, rows: [{ cells, style }] }. A plain number cell is pesos (0.00),
// cnt(n) is a count (0), strings are text. style: title | section | head | sub | total.
import { round2 } from './util.js'

const TITLE = 'COURAGED FITNESS HUB PAYMENT'
const METHOD = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', card: 'Card', bank_transfer: 'Bank transfer', other: 'Other' }
const SECTIONS = [
  ['good', 'SOLD ITEMS'],
  ['service', 'SERVICES'],
]
const cnt = (v) => ({ v, f: '0' })
const row = (cells, style) => ({ cells, style })
const n = (v) => Number(v) || 0
const itemOf = (l) => `${l.code} ${l.name}`.toUpperCase()
const longDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
// Their tabs are named like 10-12-26 (month-day-year).
export const tabName = (d) => `${d.slice(5, 7)}-${d.slice(8, 10)}-${d.slice(2, 4)}`

function sum(lines) {
  const t = { qty: 0, cost: 0, revenue: 0, gcash: 0, cash: 0, other: 0 }
  for (const l of lines) {
    t.qty += n(l.qty)
    t.cost += n(l.qty) * n(l.unit_cost)
    t.revenue += n(l.qty) * n(l.unit_price)
    t.gcash += n(l.gcash)
    t.cash += n(l.cash)
    t.other += n(l.other)
  }
  return t
}

// What the screen previews and the grand total row shows. Revenue and profit are after
// receipt discounts, so they match Analytics; voided sales are never in here.
export function totals(data, day) {
  const on = (x) => !day || x.date === day
  const t = sum(data.lines.filter(on))
  const d = data.discounts.filter(on).reduce((s, x) => ({ gcash: s.gcash + n(x.gcash), cash: s.cash + n(x.cash), other: s.other + n(x.other) }), { gcash: 0, cash: 0, other: 0 })
  const discounts = d.gcash + d.cash + d.other
  const voided = data.voided.filter(on)
  return {
    items: t.qty,
    revenue: round2(t.revenue - discounts),
    cost: round2(t.cost),
    profit: round2(t.revenue - t.cost - discounts),
    gcash: round2(t.gcash - d.gcash),
    cash: round2(t.cash - d.cash),
    other: round2(t.other - d.other),
    discounts: round2(discounts),
    disc: d,
    voided: voided.length,
    voidedTotal: round2(voided.reduce((s, v) => s + n(v.total), 0)),
  }
}

// The SOLD ITEMS and SERVICES tables, then discounts and the grand total.
// date: 'all' puts `day` on every row (daily CSV), 'lines' puts each line's date on line rows (summary).
function salesRows(data, { lines, day, date, group, other }) {
  const pre = (l) => (date === 'all' ? [day] : date === 'lines' ? [l ? l.date : null] : [])
  const head = (labels) => row([...(date ? ['Date'] : []), ...labels], 'head')
  const pay = (x) => (other ? [round2(x.gcash), round2(x.cash), round2(x.other)] : [round2(x.gcash), round2(x.cash)])
  const totalRow = (label, t, style) => row([...pre(), label, cnt(t.qty), null, null, round2(t.cost), round2(t.revenue - t.cost), ...pay(t), round2(t.revenue)], style)
  const lineRow = (l) => {
    const t = sum([l])
    return row([...pre(l), itemOf(l), cnt(n(l.qty)), n(l.unit_cost), round2(n(l.unit_price) - n(l.unit_cost)), round2(t.cost), round2(t.revenue - t.cost), ...pay(t), round2(t.revenue)])
  }
  const out = []
  for (const [kind, title] of SECTIONS) {
    let ls = lines.filter((l) => l.kind === kind)
    if (!ls.length) continue
    out.push(row([...pre(), title], 'section'))
    out.push(head(['Item', '#', 'Unit Cost', 'Add On', 'Total Cost', 'Profit', 'GCash', 'Cash', ...(other ? ['Other'] : []), 'Total']))
    if (group) {
      // Grouped by product (then day), with a subtotal row for products sold on more than one row.
      const byItem = new Map()
      for (const l of ls) byItem.set(itemOf(l), [...(byItem.get(itemOf(l)) ?? []), l])
      for (const [name, g] of [...byItem].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        g.forEach((l) => out.push(lineRow(l)))
        if (g.length > 1) out.push(totalRow(`${name} SUBTOTAL`, sum(g), 'sub'))
      }
    } else {
      ls = [...ls].sort((a, b) => (itemOf(a) < itemOf(b) ? -1 : 1))
      ls.forEach((l) => out.push(lineRow(l)))
    }
    out.push(totalRow(`TOTAL ${title}`, sum(ls), 'total'))
    out.push(row([]))
  }
  if (!out.length) return [row([...pre(), 'No sales'])]
  const t = totals({ ...data, lines }, day)
  if (t.discounts > 0) {
    const d = t.disc
    out.push(row([...pre(), 'LESS DISCOUNTS', null, null, null, null, -t.discounts, ...(other ? [-d.gcash, -d.cash, -d.other] : [-d.gcash, -d.cash]).map(round2), -t.discounts], 'sub'))
  }
  out.push(row([...pre(), 'GRAND TOTAL', cnt(t.items), null, null, t.cost, t.profit, ...(other ? [t.gcash, t.cash, t.other] : [t.gcash, t.cash]), t.revenue], 'total'))
  return out
}

function voidedRows(voided, { day, date }) {
  if (!voided.length) return []
  const pre = (v) => (date === 'all' ? [day] : date === 'lines' ? [v ? v.date : null] : [])
  return [
    row([]),
    row([...pre(), 'VOIDED (not in the totals above)'], 'section'),
    row([...(date ? ['Date'] : []), 'Items', 'Receipt No.', 'Time', 'Amount', 'Void Reason'], 'head'),
    ...voided.map((v) => row([...pre(v), v.items ?? '', cnt(n(v.sale_no)), v.time, n(v.total), v.reason ?? ''])),
  ]
}

const titleRows = (from, to) => [row([TITLE], 'title'), row([from === to ? longDate(from) : `${longDate(from)} to ${longDate(to)}`], 'title'), row([])]

// Days that had a sale or a void, in order.
const daysOf = (data) => [...new Set([...data.lines, ...data.voided].map((x) => x.date))].sort()

function summarySheet(data, other) {
  return {
    name: 'Summary',
    rows: [...titleRows(data.from, data.to), ...salesRows(data, { lines: data.lines, date: 'lines', group: true, other }), ...voidedRows(data.voided, { date: 'lines' })],
  }
}

function logSheet(data) {
  const log = data.log ?? []
  const done = log.filter((x) => x.status === 'completed')
  return {
    name: 'Transactions',
    rows: [
      ...titleRows(data.from, data.to),
      row(['Receipt No.', 'Date', 'Time', 'Staff', 'Item', '#', 'Unit Price', 'Line Total', 'Payment', 'Status'], 'head'),
      ...log.map((x) => row([cnt(n(x.sale_no)), x.date, x.time, x.staff, itemOf(x), cnt(n(x.qty)), n(x.unit_price), n(x.line_total), METHOD[x.method] ?? x.method, x.status === 'voided' ? 'Voided' : 'Completed'])),
      row(['TOTAL COMPLETED (before discounts)', null, null, null, null, cnt(done.reduce((s, x) => s + n(x.qty), 0)), null, round2(done.reduce((s, x) => s + n(x.line_total), 0)), null, null], 'total'),
    ],
  }
}

// report: 'daily' | 'summary' | 'transactions'; format: 'csv' | 'xlsx'. Returns the sheets.
export function buildExport(data, report, format) {
  const other = data.other_methods.length > 0
  if (report === 'transactions') return [logSheet(data)]
  if (report === 'summary') return [summarySheet(data, other)]
  const days = daysOf(data)
  const forDay = (day, date) => [
    ...salesRows(data, { lines: data.lines.filter((l) => l.date === day), day, date, other }),
    ...voidedRows(data.voided.filter((v) => v.date === day), { day, date }),
  ]
  if (format === 'csv') {
    // One file; a Date column on every row tells the days apart.
    return [{ name: 'Daily', rows: [...titleRows(data.from, data.to), ...days.flatMap((d) => [...forDay(d, 'all'), row([])])] }]
  }
  return [...days.map((d) => ({ name: tabName(d), rows: [...titleRows(d, d), ...forDay(d)] })), summarySheet(data, other)]
}

export const fileName = (report, from, to, format) => `couraged_${report}_${from}_to_${to}.${format}`

// UTF-8 with BOM so Excel reads ₱-free text and names correctly; every text field quoted,
// pesos as plain 2-decimal numbers, dates as YYYY-MM-DD text.
export function toCsv(sheet) {
  const cell = (c) => (c == null ? '' : typeof c === 'number' ? round2(c).toFixed(2) : typeof c === 'object' ? String(c.v) : `"${String(c).replace(/"/g, '""')}"`)
  return '﻿' + sheet.rows.map((r) => r.cells.map(cell).join(',')).join('\r\n') + '\r\n'
}

// SheetJS (community edition) builds the workbook: values, 0.00 / 0 number formats, column
// widths. It can't write bold, fills or frozen panes, so those are added to the file's XML after.
export function toXlsx(XLSX, sheets) {
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const width = Math.max(...s.rows.map((r) => r.cells.length))
    // Styled rows get every cell (blank text) so the yellow runs the full width.
    const aoa = s.rows.map((r) => Array.from({ length: r.style === 'sub' || r.style === 'total' || r.style === 'head' ? width : r.cells.length }, (_, i) => {
      const c = r.cells[i]
      return c == null ? (r.style ? '' : null) : typeof c === 'object' ? c.v : c
    }))
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    s.rows.forEach((r, R) =>
      r.cells.forEach((c, C) => {
        if (typeof c === 'number' || (c && typeof c === 'object')) ws[XLSX.utils.encode_cell({ r: R, c: C })].z = typeof c === 'number' ? '0.00' : '0'
      }),
    )
    // Width from the longest value in each column; titles and section labels may overflow.
    ws['!cols'] = Array.from({ length: width }, (_, C) => ({
      wch: Math.min(40, Math.max(8, ...s.rows.filter((r) => r.style !== 'title' && r.style !== 'section').map((r) => {
        const c = r.cells[C]
        return c == null ? 0 : typeof c === 'number' ? c.toFixed(2).length + 1 : String(typeof c === 'object' ? c.v : c).length + 1
      }))),
    }))
    XLSX.utils.book_append_sheet(wb, ws, s.name)
  }
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return styleXlsx(XLSX, buf, sheets)
}

const BOLD = new Set(['title', 'section', 'head'])
const YELLOW = new Set(['sub', 'total'])

function styleXlsx(XLSX, buf, sheets) {
  const zip = XLSX.CFB.read(new Uint8Array(buf), { type: 'array' })
  const file = (p) => XLSX.CFB.find(zip, p)
  const read = (p) => new TextDecoder().decode(file(p).content)
  const write = (p, xml) => {
    const e = file(p)
    e.content = new TextEncoder().encode(xml)
    e.size = e.content.length
  }

  // A bold copy of the default font, a solid yellow fill, and for every existing cell format
  // (number formats) a bold and a bold+yellow variant: base i -> n + 2i and n + 2i + 1.
  let styles = read('/xl/styles.xml')
  const fonts = +styles.match(/<fonts count="(\d+)"/)[1]
  const fills = +styles.match(/<fills count="(\d+)"/)[1]
  const font = styles.match(/<fonts[^>]*>(<font>[\s\S]*?<\/font>)/)[1].replace('<font>', '<font><b/>')
  styles = styles
    .replace(/<fonts count="\d+">([\s\S]*?)<\/fonts>/, (_, f) => `<fonts count="${fonts + 1}">${f}${font}</fonts>`)
    .replace(/<fills count="\d+">([\s\S]*?)<\/fills>/, (_, f) => `<fills count="${fills + 1}">${f}<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill></fills>`)
  const xfs = styles.match(/<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/)[1].match(/<xf [^>]*\/>/g)
  const variant = (xf, fill) => xf.replace(/fontId="\d+"/, `fontId="${fonts}" applyFont="1"`).replace(/fillId="\d+"/, fill ? `fillId="${fills}" applyFill="1"` : '$&')
  styles = styles.replace(/<cellXfs count="\d+">[\s\S]*?<\/cellXfs>/, `<cellXfs count="${xfs.length * 3}">${xfs.join('')}${xfs.map((x) => variant(x, false) + variant(x, true)).join('')}</cellXfs>`)
  write('/xl/styles.xml', styles)

  sheets.forEach((s, k) => {
    const path = `/xl/worksheets/sheet${k + 1}.xml`
    let xml = read(path).replace(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g, (all, r, attrs, cells) => {
      const style = s.rows[r - 1]?.style
      if (!BOLD.has(style) && !YELLOW.has(style)) return all
      const to = (i) => xfs.length + 2 * i + (YELLOW.has(style) ? 1 : 0)
      const styled = cells.replace(/<c r="([A-Z]+\d+)"( s="(\d+)")?/g, (_, ref, __, i) => `<c r="${ref}" s="${to(+(i ?? 0))}"`)
      return `<row r="${r}"${attrs}>${styled}</row>`
    })
    // Freeze everything down to the first header row.
    const head = s.rows.findIndex((r) => r.style === 'head') + 1
    if (head > 0) xml = xml.replace(/<sheetView workbookViewId="0"\s*\/>/, `<sheetView workbookViewId="0"><pane ySplit="${head}" topLeftCell="A${head + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView>`)
    write(path, xml)
  })
  return new Uint8Array(XLSX.CFB.write(zip, { fileType: 'zip', type: 'array' })) // a plain array in some browsers
}
