// Cloudflare Pages Function: POST /api/member (live site). Twin of api/member.js (Vercel previews);
// all the rules live in server/member.js.
// Needs SUPABASE_SERVICE_ROLE_KEY (as a secret, never VITE_) and MEMBER_SITE_URL in the Pages project's environment variables.
import { createClient } from '@supabase/supabase-js'
import { handleMember } from '../../server/member.js'

export async function onRequestPost({ request, env }) {
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return Response.json({ error: 'Inviting members needs SUPABASE_SERVICE_ROLE_KEY set in Cloudflare.' }, { status: 500 })

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const token = String(request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  try {
    const body = await request.json().catch(() => ({}))
    const { status, json } = await handleMember(admin, token, body, env.MEMBER_SITE_URL)
    return Response.json(json, { status })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
