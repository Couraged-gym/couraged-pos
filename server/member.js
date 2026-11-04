// Staff action that needs Supabase's service-role key, so it runs on the server
// (api/member.js, functions/api/member.js): email a member an invite to the website,
// and link the new login to their record here, never from anything the member sends.
// `admin` is a service-role client, `token` the caller's access token, `site` the
// website's address (the invite lands on its set-password page). Returns { status, json }.

const fail = (status, error) => ({ status, json: { error } })

export async function handleMember(admin, token, body = {}, site = 'https://couragedph.com') {
  if (!token) return fail(401, 'Sign in again.')
  const { data: auth, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !auth?.user) return fail(401, 'Sign in again.')
  const { data: me } = await admin.from('profiles').select('role').eq('id', auth.user.id).maybeSingle()
  if (!['staff', 'admin'].includes(me?.role)) return fail(403, 'Only front-desk staff can invite members.')

  if (body.action !== 'invite') return fail(400, 'Unknown action.')
  const id = String(body.member_id ?? '')
  const email = String(body.email ?? '').trim().toLowerCase()
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, 'Unknown member.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, 'Enter a valid email.')

  const { data: member } = await admin.from('members').select('id, user_id').eq('id', id).maybeSingle()
  if (!member) return fail(404, 'Unknown member.')
  if (member.user_id) return fail(409, 'This member already has a website account.')

  const { data: made, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { account: 'member' }, redirectTo: `${site.replace(/\/$/, '')}/reset` })
  if (error)
    return /already/i.test(error.message)
      ? fail(409, 'That email already has a website account. Ask them to sign in and link with their gym code and mobile number (add the number here first).')
      : fail(400, error.message)

  // user_id is null still: two invites at once can't both link.
  const { data: linked, error: linkErr } = await admin.from('members').update({ user_id: made.user.id, email }).eq('id', id).is('user_id', null).select('id')
  if (linkErr || !linked?.length) {
    await admin.auth.admin.deleteUser(made.user.id) // so the retry can invite the same email again
    return fail(500, `Inviting failed${linkErr ? `: ${linkErr.message}` : ''}. Try again; ignore the email if it arrives.`)
  }
  return { status: 200, json: { ok: true } }
}
