// npm run test:util — plan end dates (must match public.plan_end in patch 017).
import assert from 'node:assert/strict'
import { planEnd } from './util.js'

assert.equal(planEnd('2026-10-27', 30), '2026-11-26') // renews Nov 27
assert.equal(planEnd('2026-10-27', 30, 2), '2026-12-26')
assert.equal(planEnd('2026-10-27', 90), '2027-01-26')
assert.equal(planEnd('2026-01-31', 30), '2026-02-27') // Feb 28 renewal
assert.equal(planEnd('2026-10-27', 365), '2027-10-26')
assert.equal(planEnd('2026-10-27', 7), '2026-11-02') // odd lengths stay days
console.log('  ✓ plan end dates: months by calendar, years by calendar, other lengths in days\nall passed')
