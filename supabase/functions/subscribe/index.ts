// RedDragonTracker · Newsletter subscribe Edge Function
// Handles server-side rate limiting, validation, and insert into subscribers table.
// Deploy: supabase functions deploy subscribe

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  'https://victormnl24-cpu.github.io',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_HOURLY_ATTEMPTS = 3;

Deno.serve(async (req: Request) => {

  // ── CORS preflight ──────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // ── Parse body ──────────────────────────────────────────────────────
  let body: { email?: string; honeypot?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // ── Honeypot — silently succeed so bots don't retry ─────────────────
  if (body.honeypot) {
    return json({ ok: true });
  }

  // ── Email validation ────────────────────────────────────────────────
  const email = (body.email ?? '').trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return json({ error: 'Invalid email address' }, 400);
  }

  // ── IP-based rate limiting ──────────────────────────────────────────
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('cf-connecting-ip') ||   // Cloudflare real IP
    req.headers.get('x-real-ip') ||
    'unknown';

  // Use service role — bypasses RLS for the rate-limit table
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await sb
    .from('subscribe_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', oneHourAgo);

  if ((count ?? 0) >= MAX_HOURLY_ATTEMPTS) {
    return json({ error: 'Too many attempts. Please try again later.' }, 429);
  }

  // Log this attempt before inserting (counts even dupes/invalid)
  await sb.from('subscribe_attempts').insert({ ip, email });

  // ── Insert subscriber ───────────────────────────────────────────────
  const { error } = await sb
    .from('subscribers')
    .insert({ email, source: 'RedDragonTracker' });

  // 23505 = unique violation (already subscribed) — treat as success
  if (error && error.code !== '23505') {
    console.error('Insert error:', error.message);
    return json({ error: 'Server error. Please try again.' }, 500);
  }

  return json({ ok: true });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
