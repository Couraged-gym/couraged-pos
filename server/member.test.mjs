// npm run test:api — checks the member-invite function's rules against a fake Supabase client.
import assert from 'node:assert/strict'
import { handleMember } from './member.js'

const STAFF = '00000000-0000-0000-0000-00000000000b', BOOKS = '00000000-0000-0000-0000-0000000000f1'
const MID = '11111111-1111-1111-1111-111111111111', LINKED = '22222222-2222-2222-2222-222222222222'
function fake({ existing = [], linkFails = false } = {}) {
  const calls = []
  const roles = { [STAFF]: 'staff', [BOOKS]: 'finance' }
  const members = { [MID]: { id: MID, user_id: null }, [LINKED]: { id: LINKED, user_id: 'someone' } }
  return {
    calls,
    auth: {
      getUser: async (t) => ({ 'staff-token': { data: { user: { id: STAFF } } }, 'books-token': { data: { user: { id: BOOKS } } } })[t] ?? { data: {}, error: { message: 'bad jwt' } },
      admin: {
        inviteUserByEmail: async (email, o) => (calls.push(['invite', email, o]), existing.includes(email) ? { error: { message: 'A user with this email address has already been registered' } } : { data: { user: { id: 'new-user' } } }),
        deleteUser: async (id) => (calls.push(['delete', id]), {}),
      },
    },
    from: (table) => {
      let key
      const q = {
        select: () => q,
        eq: (_, v) => ((key = v), q),
        is: () => q,
        maybeSingle: async () => ({ data: table === 'profiles' ? (roles[key] ? { role: roles[key] } : null) : (members[key] ?? null) }),
        update: (u) => (calls.push(['link', u]), q),
        then: (r) => r(linkFails ? { data: [] } : { data: [{ id: key }] }),
      }
      return q
    },
  }
}
let n = 0
const ok = (m) => console.log(`  ✓ ${++n} ${m}`)
const good = { action: 'invite', member_id: MID, email: ' Maria@Example.com ' }

assert.equal((await handleMember(fake(), '', good)).status, 401); ok('no token is refused')
let a = fake()
assert.equal((await handleMember(a, 'books-token', good)).status, 403); assert.equal(a.calls.length, 0); ok('the bookkeeper login cannot invite, nothing is called')
a = fake()
assert.equal((await handleMember(a, 'staff-token', good, 'https://couragedph.com/')).status, 200)
assert.deepEqual(a.calls[0], ['invite', 'maria@example.com', { data: { account: 'member' }, redirectTo: 'https://couragedph.com/reset' }])
assert.deepEqual(a.calls[1], ['link', { user_id: 'new-user', email: 'maria@example.com' }]); ok('staff invite a member; the login is linked on the server')
assert.equal((await handleMember(fake(), 'staff-token', { ...good, member_id: LINKED })).status, 409); ok('a member with an account cannot be invited again')
assert.equal((await handleMember(fake(), 'staff-token', { ...good, email: 'nope' })).status, 400); ok('bad email refused')
assert.equal((await handleMember(fake(), 'staff-token', { ...good, member_id: 'x' })).status, 400); ok('bad member id refused')
assert.equal((await handleMember(fake({ existing: ['maria@example.com'] }), 'staff-token', good)).status, 409); ok('an email that already has an account is explained')
a = fake({ linkFails: true })
assert.equal((await handleMember(a, 'staff-token', good)).status, 500); assert.deepEqual(a.calls.at(-1), ['delete', 'new-user']); ok('if linking fails the invited login is removed, so a retry works')
console.log('all passed')
