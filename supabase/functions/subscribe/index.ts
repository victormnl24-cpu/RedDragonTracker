// RedDragonTracker · Newsletter subscribe Edge Function
// Security: single allowed origin, server-side rate limiting, honeypot, input validation.
// Deploy: supabase functions deploy subscribe

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Allowed origins — custom domain + pages.dev fallback ───────────────
const ALLOWED_ORIGINS = new Set([
    'https://reddragontracker.com',
    'https://www.reddragontracker.com',
    'https://reddragontracker.pages.dev',
]);

function getCORS(req: Request) {
    const origin = req.headers.get('origin') || '';
    const allowed = ALLOWED_ORIGINS.has(origin) ? origin : '';
    return {
        'Access-Control-Allow-Origin':  allowed,
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_HOURLY_ATTEMPTS = 3;

Deno.serve(async (req: Request) => {
    const CORS = getCORS(req);

    // ── CORS preflight ──────────────────────────────────────────────────
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
    }
    if (req.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405, CORS);
    }

    // ── Reject if origin not allowed ────────────────────────────────────
    const origin = req.headers.get('origin') || '';
    if (!ALLOWED_ORIGINS.has(origin)) {
        return json({ error: 'Forbidden' }, 403, CORS);
    }

    // ── Parse body ──────────────────────────────────────────────────────
    let body: { email?: string; honeypot?: string };
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Invalid JSON' }, 400, CORS);
    }

    // ── Honeypot — silently succeed so bots don't retry ─────────────────
    if (body.honeypot) {
        return json({ ok: true }, 200, CORS);
    }

    // ── Email validation ────────────────────────────────────────────────
    const email = (body.email ?? '').trim().toLowerCase();
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
        return json({ error: 'Invalid email address' }, 400, CORS);
    }

    // ── IP-based rate limiting ──────────────────────────────────────────
    const ip =
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('cf-connecting-ip') ||
        req.headers.get('x-real-ip') ||
        'unknown';

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
        return json({ error: 'Too many attempts. Please try again later.' }, 429, CORS);
    }

    await sb.from('subscribe_attempts').insert({ ip, email });

    // ── Insert subscriber ───────────────────────────────────────────────
    const { error } = await sb
        .from('subscribers')
        .insert({ email, source: 'RedDragonTracker' });

    if (error && error.code !== '23505') {
        // Do NOT expose internal DB error details to the client
        return json({ error: 'Server error. Please try again.' }, 500, CORS);
    }

    return json({ ok: true }, 200, CORS);
});

function json(data: unknown, status = 200, cors: Record<string, string>) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
    });
}
