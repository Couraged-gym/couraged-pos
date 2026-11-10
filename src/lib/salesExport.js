// Sales export in the gym's own sheet layout ("COURAGED FITNESS HUB PAYMENT"), from the
// sales_export database function. One sheet model feeds both CSV and Excel:
// sheet = { name, rows: [{ cells, style }] }. A plain number cell is pesos (0.00),
// cnt(n) is a count (0), strings are text. style: title | section | head | sub | total.
import { round2 } from './util.js'

const TITLE = 'COURAGED FITNESS HUB PAYMENT'
const METHOD = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', card: 'Card', bank_transfer: 'Bank transfer', other: 'Other' }
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

// What the screen previews. Revenue and profit are after
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

// One unit sold (029 'units'): its price after its share of the receipt discount, and how
// it was paid. Labels follow the manual sheet: items as "CFH23 - FRESH WATER (500ML)",
// services by name, a student-rate service as "Monthly_Student/Sr./PWD".
function unitOf(u) {
  const net = round2(n(u.unit_price) - n(u.disc))
  const m = u.method === 'cash' || u.method === 'gcash' ? u.method : 'other'
  const label = u.kind === 'good'
    ? `${u.code} - ${u.name}`.toUpperCase()
    : u.name + (u.student && n(u.disc) > 0 ? '_Student/Sr./PWD' : '')
  return { ...u, net, cost: n(u.unit_cost), label, gcash: m === 'gcash' ? net : 0, cash: m === 'cash' ? net : 0, other: m === 'other' ? net : 0 }
}
const add = (us) => us.reduce((t, u) => ({ qty: t.qty + 1, cost: t.cost + u.cost, gcash: t.gcash + u.gcash, cash: t.cash + u.cash, other: t.other + u.other, total: t.total + u.net }), { qty: 0, cost: 0, gcash: 0, cash: 0, other: 0, total: 0 })
const money = (x, other) => [round2(x.gcash), round2(x.cash), ...(other ? [round2(x.other)] : []), round2(x.total)]
const payHead = (other) => ['GCash', 'Cash', ...(other ? ['Other'] : []), 'Total']

const titleRows = (label) => [row([TITLE], 'title'), row([label], 'date'), row([])]
const unitsOf = (data) => {
  if (!data.units) throw new Error('Update the database (supabase/029_export_manual_layout.sql) to export in this layout.')
  return data.units.map(unitOf)
}

// A day tab as the manual sheet has it: items and services side by side, one row per unit
// sold (items first, then services, each in the order sold), totals, then the cash check.
function dayRows(units, voided, day, other) {
  const pw = other ? 4 : 3
  const goods = units.filter((u) => u.kind === 'good')
  const services = units.filter((u) => u.kind !== 'good')
  const blank = Array(pw).fill(null)
  const g = add(goods)
  const s = add(services)
  return [
    ...titleRows(`Date of Transaction: ${longDate(day)}`),
    row([null, 'SOLD ITEMS', ...Array(2 + pw).fill(null), 'SERVICES'], 'section'),
    row(['Item', '#', 'Unit Cost', 'Add-On', ...payHead(other), ...payHead(other)], 'head'),
    ...goods.map((u) => row([u.label, cnt(1), u.cost, round2(u.net - u.cost), ...money(add([u]), other), ...blank])),
    ...services.map((u) => row([u.label, cnt(1), null, null, ...blank, ...money(add([u]), other)])),
    row(['TOTAL', cnt(g.qty + s.qty), round2(g.cost), round2(g.total - g.cost), ...money(g, other), ...money(s, other)], 'total'),
    row([]),
    row([null, ...payHead(other)], 'head'),
    row(['Items sold', ...money(g, other)]),
    row(['Services', ...money(s, other)]),
    row(['Total received', ...money(add([...goods, ...services]), other)], 'total'),
    ...voidedRows(voided),
  ]
}

// Summary of Items / Summary of Services: every unit sold grouped by product with a
// subtotal per product, the section total, then the same money per day.
function summaryRows(units, kind, other) {
  const items = kind === 'good'
  const mine = units.filter((u) => (u.kind === 'good') === items)
  const cost = (t) => (items ? [round2(t.cost), round2(t.total - t.cost)] : [])
  const out = [row([null, items ? 'SOLD ITEMS' : 'SERVICES'], 'section'), row(['Date', 'Item', '#', ...(items ? ['Unit Cost', 'Add-On'] : []), ...payHead(other)], 'head')]
  const byLabel = new Map()
  for (const u of mine) byLabel.set(u.label, [...(byLabel.get(u.label) ?? []), u])
  for (const [, us] of [...byLabel].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    for (const u of us) out.push(row([u.date, u.label, cnt(1), ...(items ? [u.cost, round2(u.net - u.cost)] : []), ...money(add([u]), other)]))
    const t = add(us)
    out.push(row([null, null, cnt(t.qty), ...cost(t), ...money(t, other)], 'sub'))
  }
  const all = add(mine)
  out.push(row([null, `TOTAL ${items ? 'SOLD ITEMS' : 'SERVICES'}`, cnt(all.qty), ...cost(all), ...money(all, other)], 'total'), row([]))
  out.push(row(['Date', null, null, ...(items ? ['Unit Cost', 'Add-On'] : []), ...payHead(other)], 'head'))
  for (const d of [...new Set(mine.map((u) => u.date))].sort()) {
    const t = add(mine.filter((u) => u.date === d))
    out.push(row([d, null, null, ...cost(t), ...money(t, other)]))
  }
  out.push(row([null, 'TOTAL', null, ...cost(all), ...money(all, other)], 'total'))
  return out
}

function voidedRows(voided) {
  if (!voided.length) return []
  return [
    row([]),
    row([null, 'VOIDED (not in the totals above)'], 'section'),
    row(['Date', 'Items', 'Receipt No.', 'Time', 'Amount', 'Void Reason'], 'head'),
    ...voided.map((v) => row([v.date, v.items ?? '', cnt(n(v.sale_no)), v.time, n(v.total), v.reason ?? ''])),
  ]
}

function logSheet(data) {
  const log = data.log ?? []
  const done = log.filter((x) => x.status === 'completed')
  return {
    name: 'Transactions',
    rows: [
      ...titleRows(`${longDate(data.from)} to ${longDate(data.to)}`),
      row(['Receipt No.', 'Date', 'Time', 'Staff', 'Item', '#', 'Unit Price', 'Line Total', 'Payment', 'Status'], 'head'),
      ...log.map((x) => row([cnt(n(x.sale_no)), x.date, x.time, x.staff, itemOf(x), cnt(n(x.qty)), n(x.unit_price), n(x.line_total), METHOD[x.method] ?? x.method, x.status === 'voided' ? 'Voided' : 'Completed'])),
      row(['TOTAL COMPLETED (before discounts)', null, null, null, null, cnt(done.reduce((s, x) => s + n(x.qty), 0)), null, round2(done.reduce((s, x) => s + n(x.line_total), 0)), null, null], 'total'),
    ],
  }
}

// report: 'daily' | 'summary' | 'transactions'; format: 'csv' | 'xlsx'. Returns the sheets;
// a CSV is one file, so its sheets are joined into one.
export function buildExport(data, report, format) {
  const other = data.other_methods.length > 0
  if (report === 'transactions') return [logSheet(data)]
  const units = unitsOf(data)
  const period = `Period covered: ${longDate(data.from)} to ${longDate(data.to)}`
  const sheets =
    report === 'summary'
      ? [
          { name: 'Summary of Items', rows: [...titleRows(period), ...summaryRows(units, 'good', other)] },
          { name: 'Summary of Services', rows: [...titleRows(period), ...summaryRows(units, 'service', other), ...voidedRows(data.voided)] },
        ]
      : [...new Set([...units, ...data.voided].map((x) => x.date))].sort().map((d) => ({
          name: tabName(d),
          rows: dayRows(units.filter((u) => u.date === d), data.voided.filter((v) => v.date === d), d, other),
        }))
  if (format === 'csv') return [{ name: report, rows: sheets.flatMap((x) => [...x.rows, row([])]) }]
  return sheets
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
