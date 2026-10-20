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

const titleRows = (from, to) => [row([TITLE], 'title'), row([from === to ? longDate(from) : `${longDate(from)} to ${longDate(to)}`], 'date'), row([])]

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
    // Table rows get every cell (blank text) so borders and fills run the table's full width.
    const aoa = s.rows.map((r) => r.cells.map((c) => (c == null ? (lookOf(r) ? '' : null) : typeof c === 'object' ? c.v : c)))
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    s.rows.forEach((r, R) =>
      r.cells.forEach((c, C) => {
        if (typeof c === 'number' || (c && typeof c === 'object')) ws[XLSX.utils.encode_cell({ r: R, c: C })].z = typeof c === 'number' ? '0.00' : '0'
      }),
    )
    // Width from the longest value in each column; titles and section labels may overflow.
    ws['!cols'] = Array.from({ length: width }, (_, C) => ({
      wch: Math.min(40, Math.max(9, ...s.rows.filter((r) => r.style !== 'title' && r.style !== 'date' && r.style !== 'section').map((r) => {
        const c = r.cells[C]
        return c == null ? 0 : typeof c === 'number' ? c.toFixed(2).length + 1 : String(typeof c === 'object' ? c.v : c).length + 1
      }))),
    }))
    XLSX.utils.book_append_sheet(wb, ws, s.name)
  }
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return styleXlsx(XLSX, buf, sheets)
}

// The look of each kind of row, in CourageD colours. Subtotal and total rows keep the plain
// yellow of their hand-made sheet. Rows with no style but several cells are table body rows.
const INK = 'FF19171B'
const GRID = 'FFD9D6DC'
const side = (tag, style = 'thin', color = GRID) => `<${tag} style="${style}"><color rgb="${color}"/></${tag}>`
const BORDER = {
  grid: `<border>${side('left')}${side('right')}${side('top')}${side('bottom')}<diagonal/></border>`,
  total: `<border>${side('left')}${side('right')}${side('top', 'medium', INK)}${side('bottom', 'medium', INK)}<diagonal/></border>`,
}
const LOOK = {
  title: { font: `<b/><sz val="16"/><color rgb="${INK}"/>` },
  date: { font: '<i/><sz val="11"/><color rgb="FF5E5A63"/>' },
  section: { font: '<b/><sz val="12"/><color rgb="FFBA0021"/>' },
  head: { font: '<b/><sz val="11"/><color rgb="FFFFFFFF"/>', fill: INK, border: 'grid', center: true },
  body: { border: 'grid' },
  sub: { font: `<b/><sz val="12"/><color rgb="${INK}"/>`, fill: 'FFFFFF00', border: 'grid' },
  total: { font: `<b/><sz val="12"/><color rgb="${INK}"/>`, fill: 'FFFFFF00', border: 'total' },
}
const KEYS = Object.keys(LOOK)
const lookOf = (r) => r.style ?? (r.cells.length > 1 ? 'body' : null)

function styleXlsx(XLSX, buf, sheets) {
  const zip = XLSX.CFB.read(new Uint8Array(buf), { type: 'array' })
  const file = (p) => XLSX.CFB.find(zip, p)
  const read = (p) => new TextDecoder().decode(file(p).content)
  const write = (p, xml) => {
    const e = file(p)
    e.content = new TextEncoder().encode(xml)
    e.size = e.content.length
  }

  // Append the fonts, fills and borders the looks use, then for every existing cell format
  // (it carries the number format) one variant per look: base i, look k -> n + i * KEYS.length + k.
  let styles = read('/xl/styles.xml')
  const count = (tag) => +styles.match(new RegExp(`<${tag} count="(\\d+)"`))[1]
  const add = (tag, items) => {
    const start = count(tag)
    styles = styles.replace(new RegExp(`<${tag} count="\\d+">([\\s\\S]*?)</${tag}>`), (_, x) => `<${tag} count="${start + items.length}">${x}${items.join('')}</${tag}>`)
    return start
  }
  const font0 = add('fonts', KEYS.map((k) => `<font>${LOOK[k].font ?? '<sz val="12"/><color theme="1"/>'}<name val="Calibri"/><family val="2"/><scheme val="minor"/></font>`))
  const fill0 = add('fills', KEYS.map((k) => (LOOK[k].fill ? `<fill><patternFill patternType="solid"><fgColor rgb="${LOOK[k].fill}"/><bgColor indexed="64"/></patternFill></fill>` : '<fill><patternFill patternType="none"/></fill>')))
  const border0 = add('borders', KEYS.map((k) => BORDER[LOOK[k].border] ?? '<border><left/><right/><top/><bottom/><diagonal/></border>'))
  const xfs = styles.match(/<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/)[1].match(/<xf [^>]*\/>/g)
  const variant = (xf, k) => {
    const l = LOOK[KEYS[k]]
    const attrs = xf
      .replace(/fontId="\d+"/, `fontId="${font0 + k}" applyFont="1"`)
      .replace(/fillId="\d+"/, `fillId="${fill0 + k}"${l.fill ? ' applyFill="1"' : ''}`)
      .replace(/borderId="\d+"/, `borderId="${border0 + k}" applyBorder="1"`)
    return l.center ? attrs.replace(/\/>$/, ' applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>') : attrs
  }
  styles = styles.replace(/<cellXfs count="\d+">[\s\S]*?<\/cellXfs>/, `<cellXfs count="${xfs.length * (KEYS.length + 1)}">${xfs.join('')}${xfs.map((x) => KEYS.map((_, k) => variant(x, k)).join('')).join('')}</cellXfs>`)
  write('/xl/styles.xml', styles)

  sheets.forEach((s, k) => {
    const path = `/xl/worksheets/sheet${k + 1}.xml`
    let xml = read(path).replace(/<row r="(\d+)"([^>/]*)>([\s\S]*?)<\/row>/g, (all, r, attrs, cells) => {
      const look = KEYS.indexOf(lookOf(s.rows[r - 1] ?? { cells: [] }))
      if (look < 0) return all
      const to = (i) => xfs.length + i * KEYS.length + look
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
