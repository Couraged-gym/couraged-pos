// PDF documents for auditors and the owner. Built with jsPDF in the browser; loaded only
// when someone clicks Download (see loadPdf in src/lib/reports.js).
// Standard PDF fonts can't draw the peso sign, so amounts are "PHP 1,234.00" and
// negatives use accounting brackets: (1,234.00).
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { LOANS, OTHERS, totalDeductions } from './payroll.js'

const INK = [25, 23, 27]
const GOLD = [254, 190, 16]
const CRIMSON = [186, 0, 33]
const SMOKE = [94, 90, 99]
const MIST = [242, 242, 242]
const LINE = [228, 226, 230]
const M = 14 // page margin, mm
const W = 210 // A4 width, mm

const num = (v) => Number(v) || 0
export const amt = (v) => {
  const n = Math.round(num(v) * 100) / 100
  const s = Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `(${s})` : s
}
const php = (v) => `PHP ${amt(v)}`
const pct = (a, b) => (b ? `${Math.round((num(a) / num(b)) * 100)}%` : '-')
const day = (d, o = { month: 'short', day: 'numeric', year: 'numeric' }) => new Date(String(d).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-PH', { timeZone: 'UTC', ...o })
const stamp = (t = new Date()) => t.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
// Standard fonts only cover Latin-1: swap typographic punctuation for plain characters.
const plain = (s) => String(s ?? '').replace(/[–—−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[^\x00-\xFF]/g, '')

function newDoc() {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'normal')
  doc.setLineHeightFactor(1.25)
  return doc
}

// Dark brand band with logo, gym name, document title and period.
function header(doc, { logo, title, period }) {
  doc.setFillColor(...INK)
  doc.rect(0, 0, W, 30, 'F')
  if (logo) doc.addImage(logo, 'JPEG', M, 5, 20, 20)
  const x = logo ? M + 25 : M
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold').setFontSize(15)
  doc.text('COURAGED FITNESS HUB', x, 13)
  doc.setTextColor(...GOLD).setFontSize(10.5)
  doc.text(plain(title).toUpperCase(), x, 19.5)
  doc.setTextColor(200, 196, 204).setFont('helvetica', 'normal').setFontSize(8.5)
  doc.text('3rd Floor CRD Bldg., Miñoza St., Talamban, Cebu City', x, 24.5)
  doc.setTextColor(255, 255, 255).setFont('helvetica', 'bold').setFontSize(10)
  doc.text(plain(period), W - M, 13, { align: 'right' })
  return 40
}

function footer(doc, by) {
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    const pw = doc.internal.pageSize.getWidth()
    const ph = doc.internal.pageSize.getHeight()
    doc.setDrawColor(...LINE).setLineWidth(0.2).line(M, ph - 12, pw - M, ph - 12)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...SMOKE)
    doc.text(plain(`CourageD POS  |  Generated ${stamp()}${by ? ` by ${by}` : ''}  |  Amounts in Philippine pesos (PHP)`), M, ph - 7)
    doc.text(`Page ${i} of ${n}`, pw - M, ph - 7, { align: 'right' })
  }
}

// Section title; starts a new page when there isn't room for the title plus a few rows.
function section(doc, y, title, note) {
  if (y > 250) {
    doc.addPage()
    y = 20
  }
  doc.setFont('helvetica', 'bold').setFontSize(11.5).setTextColor(...INK)
  doc.text(plain(title).toUpperCase(), M, y)
  doc.setDrawColor(...GOLD).setLineWidth(0.8).line(M, y + 1.8, M + 12, y + 1.8)
  if (note) {
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...SMOKE)
    doc.text(plain(note), W - M, y, { align: 'right' })
  }
  return y + 5
}

function table(doc, y, { head, body, foot, right = [], bold = [], widths = {}, emphasize }) {
  const columnStyles = {}
  right.forEach((i) => (columnStyles[i] = { ...(columnStyles[i] ?? {}), halign: 'right' }))
  Object.entries(widths).forEach(([i, w]) => (columnStyles[i] = { ...(columnStyles[i] ?? {}), cellWidth: w }))
  autoTable(doc, {
    startY: y,
    head: head && [head.map(plain)],
    body: body.map((r) => r.map((c) => (typeof c === 'object' && c !== null ? { ...c, content: plain(c.content) } : plain(c)))),
    foot: foot && [foot.map(plain)],
    theme: 'plain',
    margin: { left: M, right: M, top: 18, bottom: 16 },
    styles: { font: 'helvetica', fontSize: 8.8, cellPadding: { top: 1.7, bottom: 1.7, left: 2, right: 2 }, textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.15 } },
    headStyles: { fillColor: MIST, textColor: SMOKE, fontStyle: 'bold', fontSize: 7.8 },
    footStyles: { fontStyle: 'bold', fillColor: [255, 255, 255], textColor: INK, lineWidth: { top: 0.4, bottom: 0 }, lineColor: INK },
    columnStyles,
    didParseCell: (d) => {
      if (d.section === 'head' && right.includes(d.column.index)) d.cell.styles.halign = 'right'
      if (d.section === 'foot' && right.includes(d.column.index)) d.cell.styles.halign = 'right'
      if (d.section === 'body' && bold.includes(d.row.index)) d.cell.styles.fontStyle = 'bold'
      if (d.section === 'body' && emphasize?.(d.row.index)) {
        d.cell.styles.fillColor = [255, 247, 221]
        d.cell.styles.fontStyle = 'bold'
      }
    },
  })
  return doc.lastAutoTable.finalY + 8
}

function signatures(doc, y, labels) {
  if (y > 255) {
    doc.addPage()
    y = 30
  }
  y += 10
  const w = (W - 2 * M - 10 * (labels.length - 1)) / labels.length
  labels.forEach((l, i) => {
    const x = M + i * (w + 10)
    doc.setDrawColor(...INK).setLineWidth(0.3).line(x, y, x + w, y)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...SMOKE)
    doc.text(plain(l), x, y + 4)
  })
  return y + 12
}

const METHOD = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', card: 'Card', bank_transfer: 'Bank transfer', check: 'Check', other: 'Other' }

// ---------------------------------------------------------------------------------
// Sales & profit report for a period. r = sales_report() result.
// expenses: recorded expenses in the period with a category name.
// payroll: finalized pay runs paid in the period with their items.
// ---------------------------------------------------------------------------------
// stock: stock_report() result, or null before patch 014.
export function salesReportPdf({ r, stock = null, label, expenses = [], payroll = [], logo, by }) {
  const doc = newDoc()
  const t = r.totals
  const p = r.previous
  const ex = r.expenses ?? { total: 0, previous: 0, by_category: [] }
  const cost = num(t.revenue) - num(t.gross_profit)
  const prevCost = num(p.revenue) - num(p.gross_profit)
  const net = num(t.gross_profit) - num(ex.total) - num(stock?.losses)
  const prevNet = num(p.gross_profit) - num(ex.previous) - num(stock?.previous_losses)
  let y = header(doc, { logo, title: 'Sales & profit report', period: label })

  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...SMOKE)
  doc.text(plain(`Period ${day(r.from)} to ${day(r.to)}. Compared with the ${num(r.daily?.length) || ''} days before it. Voided sales and expenses are excluded.`), M, y)
  y += 7

  // Headline figures.
  const tiles = [
    ['Sales', t.revenue],
    ['Gross profit', t.gross_profit],
    ['Expenses', ex.total],
    [net < 0 ? 'Net loss' : 'Net profit', net],
  ]
  const tw = (W - 2 * M - 9) / 4
  tiles.forEach(([k, v], i) => {
    const x = M + i * (tw + 3)
    doc.setFillColor(...(i === 3 ? INK : MIST))
    doc.roundedRect(x, y, tw, 19, 2, 2, 'F')
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...(i === 3 ? [200, 196, 204] : SMOKE))
    doc.text(k.toUpperCase(), x + 3.5, y + 6)
    doc.setFont('helvetica', 'bold').setFontSize(12.5).setTextColor(...(i === 3 ? (net < 0 ? [255, 138, 155] : GOLD) : INK))
    doc.text(amt(v), x + 3.5, y + 14)
  })
  y += 28

  y = section(doc, y, 'Profit and loss', 'PHP')
  const catRows = ex.by_category.map((c) => [`    ${c.category}`, amt(c.total), ''])
  y = table(doc, y, {
    head: ['', 'This period', 'Previous period', 'Change'],
    body: [
      ['Sales', amt(t.revenue), amt(p.revenue), amt(num(t.revenue) - num(p.revenue))],
      ['Less: cost of goods sold', amt(cost), amt(prevCost), amt(cost - prevCost)],
      ['Gross profit', amt(t.gross_profit), amt(p.gross_profit), amt(num(t.gross_profit) - num(p.gross_profit))],
      ['Less: operating expenses', '', '', ''],
      ...catRows.map((r) => [...r, '']),
      ['Total operating expenses', amt(ex.total), amt(ex.previous), amt(num(ex.total) - num(ex.previous))],
      ...(stock ? [['Less: stock losses (spoilage, count shortages)', amt(stock.losses), amt(stock.previous_losses), amt(num(stock.losses) - num(stock.previous_losses))]] : []),
      [net < 0 ? 'Net loss' : 'Net profit', amt(net), amt(prevNet), amt(net - prevNet)],
    ],
    right: [1, 2, 3],
    bold: [2, 4 + catRows.length],
    emphasize: (i) => i === 5 + catRows.length + (stock ? 1 : 0),
    widths: { 0: 78 },
  })
  if (stock) {
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...SMOKE)
    doc.text(plain(`Inventory bought for restocking this period: PHP ${amt(stock.purchases)}. Not subtracted above: goods count as cost of goods sold when they sell.`), M, y - 3, { maxWidth: W - 2 * M })
    y += 4
  }

  y = section(doc, y, 'Key figures')
  y = table(doc, y, {
    head: ['', 'This period', 'Previous period'],
    body: [
      ['Receipts', String(t.receipts), String(p.receipts)],
      ['Average sale', amt(t.receipts ? num(t.revenue) / t.receipts : 0), amt(p.receipts ? num(p.revenue) / p.receipts : 0)],
      ['Items sold', String(t.items), String(p.items)],
      ['Gross margin', pct(t.gross_profit, t.revenue), pct(p.gross_profit, p.revenue)],
      ['Discounts given', amt(t.discounts), '-'],
      ['Voided receipts', `${r.voids.count} (${amt(r.voids.total)})`, '-'],
    ],
    right: [1, 2],
    widths: { 0: 78 },
  })

  const payTotal = r.payments.reduce((s, x) => s + num(x.total), 0)
  y = section(doc, y, 'Sales by payment method', 'PHP')
  y = table(doc, y, {
    head: ['Method', 'Receipts', 'Amount', 'Share'],
    body: r.payments.length ? r.payments.map((x) => [METHOD[x.method] ?? x.method, String(x.receipts), amt(x.total), pct(x.total, payTotal)]) : [['No sales', '', '', '']],
    foot: r.payments.length ? ['Total', String(r.payments.reduce((s, x) => s + num(x.receipts), 0)), amt(payTotal), '100%'] : undefined,
    right: [1, 2, 3],
  })

  y = section(doc, y, 'Sales by category', 'PHP, before receipt discounts')
  y = table(doc, y, {
    head: ['Category', 'Units', 'Sales', 'Gross profit', 'Margin'],
    body: r.categories.length ? r.categories.map((c) => [c.category, String(c.units), amt(c.revenue), amt(c.profit), pct(c.profit, c.revenue)]) : [['No sales', '', '', '', '']],
    right: [1, 2, 3, 4],
  })

  const top = r.products.slice(0, 20)
  y = section(doc, y, `Top ${top.length} products`, 'PHP, ranked by sales')
  y = table(doc, y, {
    head: ['#', 'Product', 'Category', 'Units', 'Sales', 'Gross profit'],
    body: top.length ? top.map((x, i) => [String(i + 1), x.name, x.category, String(x.units), amt(x.revenue), amt(x.profit)]) : [['', 'No sales', '', '', '', '']],
    right: [3, 4, 5],
    widths: { 0: 8 },
  })

  const plans = r.products.filter((x) => x.category === 'Membership')
  if (plans.length) {
    y = section(doc, y, 'Memberships sold', 'PHP')
    y = table(doc, y, {
      head: ['Plan', 'Sold', 'Sales'],
      body: plans.map((x) => [x.name, String(x.units), amt(x.revenue)]),
      foot: ['Total', String(plans.reduce((s, x) => s + num(x.units), 0)), amt(plans.reduce((s, x) => s + num(x.revenue), 0))],
      right: [1, 2],
    })
  }

  y = section(doc, y, 'Sales by staff', 'PHP')
  y = table(doc, y, {
    head: ['Staff', 'Receipts', 'Sales', 'Average sale', 'Memberships', 'Discounts'],
    body: r.staff.length ? r.staff.map((s) => [s.name, String(s.receipts), amt(s.revenue), amt(s.receipts ? num(s.revenue) / s.receipts : 0), String(s.memberships), amt(s.discounts)]) : [['No sales', '', '', '', '', '']],
    right: [1, 2, 3, 4, 5],
  })

  if (payroll.length) {
    const sum = (items, f) => items.reduce((s, it) => s + f(it), 0)
    const er = (it) => num(it.sss_er) + num(it.sss_ec) + num(it.philhealth_er) + num(it.pagibig_er)
    y = section(doc, y, 'Payroll paid in this period', 'PHP, finalized pay runs')
    y = table(doc, y, {
      head: ['Pay period', 'Pay date', 'Staff', 'Gross pay', 'Employer contrib.', 'Net pay'],
      body: payroll.map((run) => [`${day(run.period_start, { month: 'short', day: 'numeric' })} - ${day(run.period_end)}`, day(run.pay_date), String(run.payroll_items.length), amt(sum(run.payroll_items, (it) => num(it.gross_pay))), amt(sum(run.payroll_items, er)), amt(sum(run.payroll_items, (it) => num(it.net_pay)))]),
      right: [2, 3, 4, 5],
    })
  }

  y = section(doc, y, 'Expenses', `${expenses.length} entries, PHP`)
  y = table(doc, y, {
    head: ['Date', 'Description', 'Category', 'OR / ref.', 'Paid via', 'Amount'],
    body: expenses.length ? expenses.map((e) => [day(e.expense_date, { month: 'short', day: 'numeric' }), e.description + (e.vendor ? ` (${e.vendor})` : ''), e.category, e.reference_no ?? '', METHOD[e.payment_method] ?? e.payment_method, amt(e.amount)]) : [['', 'No expenses recorded', '', '', '', '']],
    foot: expenses.length ? ['', 'Total', '', '', '', amt(expenses.reduce((s, e) => s + num(e.amount), 0))] : undefined,
    right: [5],
    widths: { 0: 16, 1: 68 },
  })

  signatures(doc, y, ['Prepared by', 'Reviewed by', 'Approved by'])
  footer(doc, by)
  return doc
}

// ---------------------------------------------------------------------------------
// Payslips for one pay run: a summary page, then one payslip per employee.
// ---------------------------------------------------------------------------------
export function payslipsPdf({ run, items, employees = [], logo, by }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  doc.setFont('helvetica', 'normal').setLineHeightFactor(1.25)
  transmittal(doc, { run, items, employees, by })
  doc.addPage('a4', 'portrait')
  const period = `${day(run.period_start, { month: 'short', day: 'numeric' })} - ${day(run.period_end)}`
  const byId = Object.fromEntries(employees.map((e) => [e.id, e]))
  const sum = (k) => items.reduce((s, it) => s + num(it[k]), 0)
  const er = sum('sss_er') + sum('sss_ec') + sum('philhealth_er') + sum('pagibig_er')
  const draft = run.status !== 'finalized'

  let y = header(doc, { logo, title: `Payroll summary${draft ? ' (not final)' : ''}`, period })
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...SMOKE)
  doc.text(plain(`Pay date ${day(run.pay_date)}. ${items.length} payslip${items.length === 1 ? '' : 's'}. Status: ${run.status}.`), M, y)
  y += 8
  y = section(doc, y, 'To remit', 'PHP')
  y = table(doc, y, {
    head: ['Agency', 'Employee share', 'Employer share', 'Total'],
    body: [
      ['SSS (employer share includes EC)', amt(sum('sss_ee')), amt(sum('sss_er') + sum('sss_ec')), amt(sum('sss_ee') + sum('sss_er') + sum('sss_ec'))],
      ['PhilHealth', amt(sum('philhealth_ee')), amt(sum('philhealth_er')), amt(sum('philhealth_ee') + sum('philhealth_er'))],
      ['Pag-IBIG', amt(sum('pagibig_ee')), amt(sum('pagibig_er')), amt(sum('pagibig_ee') + sum('pagibig_er'))],
      ['BIR withholding tax on compensation', amt(sum('withholding_tax')), '-', amt(sum('withholding_tax'))],
    ],
    right: [1, 2, 3],
  })
  y = table(doc, y, {
    body: [
      ['Gross pay', amt(sum('gross_pay'))],
      ['Employer contributions', amt(er)],
      ['Total cost to the gym', amt(sum('gross_pay') + er)],
    ],
    right: [1],
    bold: [2],
    widths: { 0: 120 },
  })
  if (run.rates) {
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...SMOKE)
    const v = ['sss', 'philhealth', 'pagibig', 'tax'].filter((k) => run.rates[k]).map((k) => `${{ sss: 'SSS', philhealth: 'PhilHealth', pagibig: 'Pag-IBIG', tax: 'Tax' }[k]} from ${day(run.rates[k].effective_from)}`)
    doc.text(plain(`Rate versions used: ${v.join(', ')}.`), M, y - 3)
  }
  signatures(doc, y + 2, ['Prepared by', 'Approved by'])

  for (const it of items) {
    doc.addPage()
    const e = byId[it.employee_id] ?? {}
    let py = header(doc, { logo, title: `Payslip${draft ? ' (not final)' : ''}`, period })
    doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...INK)
    doc.text(plain(it.employee_name), M, py + 2)
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...SMOKE)
    const basis = { monthly: 'month', daily: 'day', hourly: 'hour' }[it.pay_basis]
    doc.text(plain(`${e.position ? e.position + '  |  ' : ''}Rate PHP ${amt(it.rate)} per ${basis}  |  Pay date ${day(run.pay_date)}`), M, py + 7.5)
    const ids = [['SSS', e.sss_no], ['PhilHealth', e.philhealth_no], ['Pag-IBIG', e.pagibig_no], ['TIN', e.tin]].filter(([, v]) => v).map(([k, v]) => `${k} ${v}`)
    if (ids.length) doc.text(plain(ids.join('   ')), M, py + 12.5)
    py += 20

    const half = (W - 2 * M - 6) / 2
    const earnings = [
      ['Basic pay' + (it.days_worked != null ? ` (${num(it.days_worked)} days)` : it.hours_worked != null ? ` (${num(it.hours_worked)} hrs)` : ''), amt(it.basic_pay)],
      ['Overtime', amt(it.overtime_pay)],
      ['Holiday pay' + (num(it.holiday_days) ? ` (${num(it.holiday_days)} days)` : ''), amt(it.holiday_pay)],
      ['Salary adjustment', amt(it.salary_adjustment)],
      ['Allowance', amt(it.allowances_taxable)],
      ...(num(it.allowances_nontaxable) ? [['Allowances (non-taxable)', amt(it.allowances_nontaxable)]] : []), // payslips from before patch 017
    ]
    const deductions = [
      ['SSS', amt(it.sss_ee)],
      ['Pag-IBIG', amt(it.pagibig_ee)],
      ['PhilHealth', amt(it.philhealth_ee)],
      ...LOANS.map(([k, l]) => [l, amt(it[k])]),
      ...(num(it.withholding_tax) ? [['Withholding tax', amt(it.withholding_tax)]] : []),
      ['Others:', ''],
      ...OTHERS.map(([k, l]) => ['   ' + l, amt(it[k])]),
      ['   Cash advance' + (it.advance_balance != null && num(it.cash_advance) ? ` (PHP ${amt(it.advance_balance)} left)` : ''), amt(it.cash_advance)],
      ...(num(it.other_deductions) ? [['   Other' + (it.deductions_note ? ` (${it.deductions_note})` : ''), amt(it.other_deductions)]] : []),
    ]
    const totalDed = totalDeductions(it)
    const twoCol = (x, head, body, foot) =>
      autoTable(doc, {
        startY: py,
        margin: { left: x, right: W - x - half },
        tableWidth: half,
        head: [head.map(plain)],
        body: body.map((r) => r.map(plain)),
        foot: [foot.map(plain)],
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.15 } },
        headStyles: { fillColor: MIST, textColor: SMOKE, fontStyle: 'bold', fontSize: 8 },
        footStyles: { fontStyle: 'bold', fillColor: [255, 255, 255], textColor: INK, lineWidth: { top: 0.4, bottom: 0 }, lineColor: INK },
        columnStyles: { 1: { halign: 'right' } },
        didParseCell: (d) => d.column.index === 1 && (d.cell.styles.halign = 'right'),
      })
    twoCol(M, ['Earnings', 'PHP'], earnings, ['Gross pay', amt(it.gross_pay)])
    const endL = doc.lastAutoTable.finalY
    twoCol(M + half + 6, ['Deductions', 'PHP'], deductions, ['Total deductions', amt(totalDed)])
    py = Math.max(endL, doc.lastAutoTable.finalY) + 8

    doc.setFillColor(...INK)
    doc.roundedRect(M, py, W - 2 * M, 18, 2, 2, 'F')
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(200, 196, 204)
    doc.text('NET PAY', M + 5, py + 7)
    doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...GOLD)
    doc.text(php(it.net_pay), W - M - 5, py + 12, { align: 'right' })
    py += 26

    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...SMOKE)
    doc.text(plain(`Employer also paid: SSS PHP ${amt(num(it.sss_er) + num(it.sss_ec))} (incl. EC), PhilHealth PHP ${amt(it.philhealth_er)}, Pag-IBIG PHP ${amt(it.pagibig_er)}. Taxable income this payslip: PHP ${amt(it.taxable_income)}.`), M, py, { maxWidth: W - 2 * M })
    py += 10
    signatures(doc, py, ['Received by (signature over printed name)', 'Date'])
  }

  footer(doc, by)
  if (draft) {
    // Mark every page so a draft is never mistaken for a final payslip.
    for (let i = 1; i <= doc.getNumberOfPages(); i++) {
      doc.setPage(i)
      const pw = doc.internal.pageSize.getWidth()
      doc.setFillColor(...CRIMSON)
      doc.roundedRect(pw - M - 38, 19.5, 38, 7, 1.5, 1.5, 'F')
      doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(255, 255, 255)
      doc.text('DRAFT - NOT FINAL', pw - M - 19, 24.2, { align: 'center' })
    }
  }
  return doc
}


// ---------------------------------------------------------------------------------
// Payroll transmittal, in the bookkeeper's format (landscape): one line per employee with
// days, earnings, each deduction and the total paid, then payroll + lending = encashment.
// ---------------------------------------------------------------------------------
const longDay = (d) => day(d, { month: 'long', day: 'numeric', year: 'numeric' })
export function coverage(run) {
  const [a, b] = [run.period_start, run.period_end]
  if (a.slice(0, 7) === b.slice(0, 7)) return `${day(a, { month: 'long' })} ${+a.slice(8)}-${+b.slice(8)}, ${a.slice(0, 4)}`
  return `${day(a)} - ${day(b)}`
}
const slash = (d) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`

function transmittal(doc, { run, items, employees, by }) {
  const pw = doc.internal.pageSize.getWidth()
  const byId = Object.fromEntries(employees.map((e) => [e.id, e]))
  const sum = (k) => items.reduce((t, it) => t + num(it[k]), 0)
  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...INK)
  doc.text('PAYROLL TRANSMITTAL', pw / 2, 16, { align: 'center' })
  doc.setFontSize(11).text('COURAGED FITNESS HUB, INC.', pw / 2, 22, { align: 'center' })
  doc.setFontSize(12).setTextColor(11, 107, 53).text(plain(coverage(run)), pw / 2, 28.5, { align: 'center' })

  const cov = `${run.period_start.slice(5, 7)}/${+run.period_start.slice(8)}-${+run.period_end.slice(8)}/${run.period_end.slice(0, 4)}`
  // [key, heading, always shown]
  const money = [
    ['basic_pay', 'Basic Pay', true],
    ['holiday_pay', 'Holiday Pay', true],
    ['overtime_pay', 'Overtime'],
    ['salary_adjustment', 'Salary Adj.'],
    ['allowances_taxable', 'Allowance'],
    ['sss_ee', 'SSS Premium', true],
    ['pagibig_ee', 'Pag-Ibig', true],
    ['philhealth_ee', 'PHIC', true],
    ['withholding_tax', 'W/Tax'],
    ['pagibig_loan', 'Pag-Ibig Loan'],
    ['sss_loan', 'SSS Loan'],
    ['cash_bond', 'Cash Bond', true],
    ['loan', 'Loan', true],
    ['cash_advance', 'Cash Adv.'],
    ['other_deductions', 'Other Deduction', true],
    ['rice', 'Rice'],
    ['paraphernalia', 'CRDK Paraphernalias', true],
  ].filter(([k, , always]) => always || items.some((it) => num(it[k])))
  const dash = (v) => (num(v) ? amt(v) : '-')
  const days = (it) => (it.days_worked != null && it.days_worked !== '' ? num(it.days_worked).toFixed(2) : it.hours_worked != null && it.hours_worked !== '' ? `${num(it.hours_worked)} h` : '-')
  const lead = 5 // Pay Date, Pay Coverage, Name, Department, Days
  autoTable(doc, {
    startY: 34,
    head: [['Pay Date', 'Pay Coverage', 'Name', 'Department', 'No. of days duty', ...money.map(([, l]) => l), 'TOTAL']],
    body: items.map((it) => [slash(run.pay_date), cov, plain(it.employee_name).toUpperCase(), plain(byId[it.employee_id]?.position ?? '').toUpperCase(), days(it), ...money.map(([k]) => dash(it[k])), amt(it.net_pay)]),
    foot: [[{ content: 'GRAND TOTAL', colSpan: 4, styles: { halign: 'center' } }, items.reduce((t, it) => t + num(it.days_worked), 0).toFixed(2), ...money.map(([k]) => dash(sum(k))), amt(sum('net_pay'))]],
    theme: 'grid',
    margin: { left: 8, right: 8 },
    styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.2, textColor: INK, lineColor: [60, 60, 60], lineWidth: 0.15, valign: 'middle' },
    headStyles: { fillColor: [255, 236, 64], textColor: INK, fontStyle: 'bold', halign: 'center', fontSize: 7 },
    footStyles: { fillColor: [214, 236, 245], textColor: INK, fontStyle: 'bold' },
    columnStyles: { 2: { cellWidth: 34 }, 3: { cellWidth: 26 } },
    didParseCell: (d) => {
      if (d.section !== 'head' && d.column.index >= lead - 1) d.cell.styles.halign = 'right'
      if (d.column.index === lead + money.length) d.cell.styles.fontStyle = 'bold'
    },
  })
  let y = doc.lastAutoTable.finalY + 10

  // Signatures on the left, the encashment summary on the right.
  const sig = (label, x, name) => {
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...SMOKE).text(label, x, y)
    doc.setDrawColor(...INK).setLineWidth(0.3).line(x, y + 12, x + 55, y + 12)
    if (name) doc.setFont('helvetica', 'bold').setTextColor(...INK).text(plain(name).toUpperCase(), x, y + 11)
  }
  sig('Prepared by:', 14, by)
  sig('Checked by:', 80, null)
  sig('Approved by:', 146, null)

  const payroll = sum('net_pay')
  const lending = sum('loan')
  const x = pw - 80
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...INK).text('SUMMARY', x, y)
  const line = (l, v, yy, bold) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(10).text(l, x, yy)
    doc.text(amt(v), pw - 14, yy, { align: 'right' })
  }
  line('PAYROLL', payroll, y + 7)
  line('LENDING', lending, y + 13)
  doc.setDrawColor(...INK).setLineWidth(0.3).line(pw - 50, y + 15, pw - 14, y + 15)
  line('TOTAL ENCASHMENT', payroll + lending, y + 20, true)
  doc.setLineWidth(0.6).line(x, y + 22, pw - 14, y + 22)
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...SMOKE)
  doc.text('Lending = the Loan column, paid out with the payroll check.', x, y + 27)
}

// "TWENTY ONE THOUSAND SIX HUNDRED FIFTY SIX PESO(S) & 25/100 ONLY", as written on vouchers and checks.
const ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN']
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']
function under1000(n) {
  const h = Math.floor(n / 100)
  const r = n % 100
  return [h && `${ONES[h]} HUNDRED`, r < 20 ? ONES[r] : [TENS[Math.floor(r / 10)], ONES[r % 10]].filter(Boolean).join(' ')].filter(Boolean).join(' ')
}
export function amountInWords(v) {
  const cents = Math.round(num(v) * 100)
  let pesos = Math.floor(cents / 100)
  const parts = []
  for (const [size, name] of [[1e9, 'BILLION'], [1e6, 'MILLION'], [1e3, 'THOUSAND'], [1, '']]) {
    const chunk = Math.floor(pesos / size)
    pesos %= size
    if (chunk) parts.push([under1000(chunk), name].filter(Boolean).join(' '))
  }
  return `${parts.join(' ') || 'ZERO'} PESO(S) & ${String(cents % 100).padStart(2, '0')}/100 ONLY`
}

// ---------------------------------------------------------------------------------
// Check voucher / journal voucher, in the bookkeeper's layout. v = vouchers row.
// ---------------------------------------------------------------------------------
export function voucherPdf(v) {
  const doc = newDoc()
  const check = v.kind === 'check'
  const lines = (v.lines ?? []).filter((l) => l.code || l.title || num(l.debit) || num(l.credit))
  const grid = { theme: 'grid', margin: { left: M, right: M }, styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.8, textColor: INK, lineColor: INK, lineWidth: 0.25 } }
  const lab = (l, val) => ({ content: `${l}\n${plain(val ?? '')}`, styles: { fontSize: 9.5 } })

  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...INK).text('COURAGED FITNESS HUB, INC.', M, 16)
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...SMOKE).text('3rd Floor CRD Bldg., Miñoza St., Talamban, Cebu City', M, 21)
  doc.setFontSize(7.5).text(plain(`Printed ${stamp()}`), W - M, 12, { align: 'right' })
  if (v.status === 'voided') {
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...CRIMSON).text(plain(`VOIDED: ${v.void_reason ?? ''}`), W - M, 21, { align: 'right' })
  }

  autoTable(doc, {
    ...grid,
    startY: 26,
    head: [[{ content: check ? 'CHECK VOUCHER' : 'JOURNAL VOUCHER', colSpan: 3, styles: { halign: 'center', fontSize: 13, fontStyle: 'bold', fillColor: [255, 255, 255], textColor: INK } }]],
    body: check
      ? [
          [{ ...lab('Payable to', v.payee), rowSpan: 2 }, lab('CV Number', v.voucher_no), lab('CV Date', longDay(v.voucher_date))],
          [{ ...lab('Bank Name', v.bank), colSpan: 1 }, lab('Amount', amt(v.amount))],
          [lab('References', v.reference), lab('Check Date', v.check_date ? longDay(v.check_date) : ''), lab('Check Number', v.check_no)],
          [{ ...lab('Amount (in words)', amountInWords(v.amount)), colSpan: 3 }],
        ]
      : [
          [lab('Reference', v.reference), lab('JV Number', v.voucher_no), lab('JV Date', longDay(v.voucher_date))],
          [{ ...lab('Amount (in words)', amountInWords(v.amount)), colSpan: 2 }, lab('Amount', amt(v.amount))],
        ],
    columnStyles: { 0: { cellWidth: 92 } },
  })
  autoTable(doc, {
    ...grid,
    startY: doc.lastAutoTable.finalY,
    head: [[{ content: 'EXPLANATION', styles: { halign: 'center', fontStyle: 'bold', fillColor: [255, 255, 255], textColor: INK } }]],
    body: [[{ content: plain(v.explanation ?? ''), styles: { font: 'courier', fontSize: 9.5, minCellHeight: 60, valign: 'top' } }]],
  })
  const dr = lines.reduce((t, l) => t + num(l.debit), 0)
  const cr = lines.reduce((t, l) => t + num(l.credit), 0)
  autoTable(doc, {
    ...grid,
    startY: doc.lastAutoTable.finalY,
    head: [['Account code', 'Account title', 'Debit', 'Credit']],
    body: (lines.length ? lines : [{}]).map((l) => [plain(l.code ?? ''), plain(l.title ?? ''), num(l.debit) ? amt(l.debit) : '', num(l.credit) ? amt(l.credit) : '']),
    foot: [[{ content: 'GRAND TOTAL', colSpan: 2, styles: { halign: 'center' } }, amt(dr), amt(cr)]],
    headStyles: { fillColor: MIST, textColor: INK, fontStyle: 'bold' },
    footStyles: { fillColor: [255, 255, 255], textColor: INK, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 32 }, 2: { halign: 'right', cellWidth: 32 }, 3: { halign: 'right', cellWidth: 32 } },
    didParseCell: (d) => d.section !== 'body' && d.column.index >= 2 && (d.cell.styles.halign = 'right'),
  })
  const who = [['Prepared by', v.prepared_by], ['Noted by', v.noted_by], ['Approved by', v.approved_by], ...(check ? [['Received by', v.received_by]] : [])]
  autoTable(doc, {
    ...grid,
    startY: doc.lastAutoTable.finalY,
    body: [who.map(([l, n]) => ({ content: `${l}:\n\n${plain(n ?? '').toUpperCase()}`, styles: { minCellHeight: 20, valign: 'top' } }))],
  })
  if (check) {
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...INK).text('NOTE: Do not release without OR.', M, doc.lastAutoTable.finalY + 6)
  }
  if (!check && lines.length && Math.round(dr * 100) !== Math.round(cr * 100)) {
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...CRIMSON).text(plain(`Debits and credits differ by ${amt(dr - cr)}.`), W - M, doc.lastAutoTable.finalY + 6, { align: 'right' })
  }
  return doc
}
