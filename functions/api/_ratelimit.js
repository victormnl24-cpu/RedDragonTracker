// Shared rate limiter for RedDragonTracker Pages Functions.
// (Leading underscore => Cloudflare Pages does NOT expose this file as a route.)
//
// Durability tiers, chosen automatically:
//   1. If a KV namespace is bound as `env.RATE_LIMIT_KV`, counters are stored in
//      KV — shared across every Worker isolate and region (eventually consistent,
//      but vastly better than per-isolate memory).
//   2. Otherwise it falls back to an in-memory Map — best-effort, per-isolate.
//      This keeps the functions working before KV is provisioned.
//
// To enable tier 1 (recommended for production):
//   Cloudflare dashboard → Workers & Pages → your Pages project → Settings →
//   Functions → KV namespace bindings → add binding:
//       Variable name: RATE_LIMIT_KV
//       KV namespace:  (create one, e.g. "rdt-rate-limit")
//   No code change needed after binding — this module detects it at runtime.
//
// For a hard guarantee under real attack, layer a Cloudflare WAF
// "Rate limiting rule" on top (dashboard → Security → WAF) — that runs at the
// edge before the function executes and cannot be bypassed by isolate churn.

export function getIP(request) {
    return (
        request.headers.get('cf-connecting-ip') ||
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        request.headers.get('x-real-ip') ||
        'unknown'
    );
}

// ── In-memory fallback (per-isolate, best-effort) ──────────────────────
const _mem = new Map();

function memLimit(key, windowMs, max) {
    const now = Date.now();
    let e = _mem.get(key) || { n: 0, until: now + windowMs };
    if (now > e.until) { e.n = 0; e.until = now + windowMs; }
    e.n++;
    _mem.set(key, e);
    if (_mem.size > 5000) {                    // prevent unbounded growth
        for (const [k, v] of _mem) { if (now > v.until) _mem.delete(k); }
    }
    return e.n <= max;
}

// ── KV-backed limiter (shared across isolates) ─────────────────────────
async function kvLimit(kv, key, windowMs, max) {
    const now = Date.now();
    let e;
    try {
        e = await kv.get(key, { type: 'json' });
    } catch {
        return true;                           // fail-open on KV read error
    }
    if (!e || now > e.until) e = { n: 0, until: now + windowMs };
    e.n++;
    // KV TTL floor is 60s; clamp so short windows still persist correctly.
    const ttl = Math.max(60, Math.ceil((e.until - now) / 1000));
    try {
        await kv.put(key, JSON.stringify(e), { expirationTtl: ttl });
    } catch {
        /* fail-open on KV write error */
    }
    return e.n <= max;
}

/**
 * @param {object} env      Function env (may hold RATE_LIMIT_KV binding)
 * @param {string} ip       Client IP
 * @param {object} opts     { prefix, windowMs, max }
 * @returns {Promise<boolean>}  true = allowed, false = over limit
 */
export async function rateLimit(env, ip, { prefix, windowMs, max }) {
    const key = `rl:${prefix}:${ip}`;
    if (env && env.RATE_LIMIT_KV) {
        return kvLimit(env.RATE_LIMIT_KV, key, windowMs, max);
    }
    return memLimit(key, windowMs, max);
}
