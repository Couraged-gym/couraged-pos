// npm run test:util — plan end dates (must match public.plan_end in patch 017).
import assert from 'node:assert/strict'
import { formatName, joinName, parsePassToken, planEnd, scanDetector, splitName } from './util.js'

assert.equal(planEnd('2026-10-27', 30), '2026-11-26') // renews Nov 27
assert.equal(planEnd('2026-10-27', 30, 2), '2026-12-26')
assert.equal(planEnd('2026-10-27', 90), '2027-01-26')
assert.equal(planEnd('2026-01-31', 30), '2026-02-27') // Feb 28 renewal
assert.equal(planEnd('2026-10-27', 365), '2027-10-26')
assert.equal(planEnd('2026-10-27', 7), '2026-11-02') // odd lengths stay days
const tok = 'cdq' + 'A1B2'.repeat(8)
assert.equal(parsePassToken(` ${tok} `), 'CDQ' + 'a1b2'.repeat(8)) // scanner in caps lock
assert.equal(parsePassToken('CDQ123'), null)
assert.equal(parsePassToken('CRDFH26-0012'), null)
console.log('  ✓ pass tokens are recognised in any letter case')
{
  const got = []
  const type = (text, step, start = 0) => { const feed = scanDetector((t) => got.push(t)); [...text, 'Enter'].forEach((k, i) => feed(k, start + i * step)) }
  type(tok, 8) // scanner: 8 ms a key
  assert.deepEqual(got, ['CDQ' + 'a1b2'.repeat(8)])
  type(tok, 150) // a person typing it
  type('CRDFH26-0012', 8) // a gym code is not handled outside Check-in
  assert.equal(got.length, 1)
  const feed = scanDetector((t) => got.push(t))
  feed('x', 0); feed('y', 5); [...tok].forEach((k, i) => feed(k, 500 + i * 8)); feed('Enter', 500 + tok.length * 8) // earlier typing is dropped after a pause
  assert.equal(got.length, 2)
  console.log('  ✓ only a fast burst ending in Enter counts as a scanned pass')
}
console.log('  ✓ plan end dates: months by calendar, years by calendar, other lengths in days\nall passed')

assert.equal(formatName('lontok,augosto  antonio'), 'LONTOK, AUGOSTO ANTONIO')
assert.equal(formatName(' Dela Cruz ,  Juan '), 'DELA CRUZ, JUAN')
assert.equal(formatName('LONTOK, AUGOSTO'), 'LONTOK, AUGOSTO')
console.log('  ✓ names format as "LAST, FIRST" with or without a space after the comma')
assert.equal(joinName(' dela cruz ', 'juan  miguel'), 'DELA CRUZ, JUAN MIGUEL')
assert.equal(joinName('lontok,', 'augosto'), 'LONTOK, AUGOSTO')
assert.equal(joinName('', 'oscar'), 'OSCAR')
assert.deepEqual(splitName('DELA CRUZ, JUAN MIGUEL'), ['DELA CRUZ', 'JUAN MIGUEL'])
assert.deepEqual(splitName('OSCAR'), ['', 'OSCAR'])
console.log('  ✓ Last name + First name fields join with the comma, and split back for editing')
