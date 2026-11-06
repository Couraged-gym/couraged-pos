export const round2 = (n) => Math.round(n * 100) / 100

// ₱50 for whole amounts, ₱27.21 otherwise.
export const money = (n) =>
  '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: Number.isInteger(round2(n)) ? 0 : 2, maximumFractionDigits: 2 })

// Reports group by Manila date, so "today" must too, whatever the device clock zone.
export const manilaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })

// crypto.randomUUID only exists on HTTPS/localhost; a tablet on LAN http needs the fallback.
export const uuid = () =>
  crypto.randomUUID?.() ??
  '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16))

// Money fields are text, not type=number: a mouse wheel over a number input silently changes the amount.
export const moneyInput = (set) => (e) => /^\d*\.?\d{0,2}$/.test(e.target.value) && set(e.target.value)

// Gym codes look like CRDFH26-0012 (26 = year registered). Typed codes are matched in capitals.
export const parseMemberCode = (s) => (/^crdfh\d{2}-\d+$/i.test(s.trim()) ? s.trim().toUpperCase() : null)
// The QR on a member's website pass: CDQ + 32 hex (patch 018). Scanners may change the letter case.
export const parsePassToken = (s) => (/^cdq[0-9a-f]{32}$/i.test(s.trim()) ? 'CDQ' + s.trim().slice(3).toLowerCase() : null)
// Tells a barcode scanner from a person: a scanner types the whole code with tiny gaps
// and ends with Enter. feed(key, ms, modifier) for every keydown; calls onToken(token)
// when a pass code arrives that way. A gap longer than `gap` ms starts over.
export function scanDetector(onToken, gap = 80) {
  let buf = '', last = -Infinity
  return (key, now, modifier = false) => {
    if (now - last > gap) buf = ''
    last = now
    if (key === 'Enter') {
      const token = parsePassToken(buf)
      buf = ''
      if (token) onToken(token)
    } else if (key.length === 1 && !modifier) buf += key
  }
}
// CRDFH25-9 before CRDFH25-10 before CRDFH26-1.
export const byCode = (a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })

// Last day of a plan bought from `start` (YYYY-MM-DD). Lengths in 30s are calendar months and
// 365s are years, so 1 month from Oct 27 runs to Nov 26 and renews Nov 27. Same rule as
// public.plan_end() in supabase/017_finance_vouchers_payslip.sql.
export function planEnd(start, days, qty = 1) {
  const d = new Date(start + 'T00:00:00Z')
  const months = days % 365 === 0 ? (days / 365) * 12 * qty : days % 30 === 0 ? (days / 30) * qty : null
  if (months == null) d.setUTCDate(d.getUTCDate() + days * qty)
  else {
    const day = d.getUTCDate()
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() + months)
    d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate())) // Jan 31 + 1 month = Feb 28, like Postgres
  }
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// "LAST, FIRST MIDDLE" in capitals, one space after the comma. Same rule as public.format_name (027).
export const formatName = (s) => s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim().toUpperCase()
// Stored name -> [last, first] for the two form fields. No comma (old records): it all goes in First.
export const splitName = (s = '') => (s.includes(',') ? [s.slice(0, s.indexOf(',')), s.slice(s.indexOf(',') + 1)] : ['', s]).map((x) => x.trim())
// Two form fields -> stored name. A comma typed inside a field is dropped.
export const joinName = (last, first) => formatName([last, first].map((x) => x.replace(/,/g, ' ').trim()).filter(Boolean).join(', '))
