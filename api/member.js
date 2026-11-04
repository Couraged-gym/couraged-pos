// Vercel serverless function: POST /api/member. All the rules live in server/member.js.
// Needs SUPABASE_SERVICE_ROLE_KEY (server only, never VITE_) and MEMBER_SITE_URL
// (the website, e.g. https://couragedph.com) in Vercel's environment variables.
import { createClient } from '@supabase/supabase-js'
import { handleMember } from '../server/member.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Inviting members needs SUPABASE_SERVICE_ROLE_KEY set in Vercel.' })

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  try {
    const { status, json } = await handleMember(admin, token, req.body ?? {}, process.env.MEMBER_SITE_URL)
    res.status(status).json(json)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
