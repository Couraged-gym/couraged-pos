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
// CRDFH25-9 before CRDFH25-10 before CRDFH26-1.
export const byCode = (a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })
