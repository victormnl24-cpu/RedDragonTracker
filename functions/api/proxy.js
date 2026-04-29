// Cloudflare Pages Function — CORS proxy (stats.gov.cn only)
// Security: strict CORS, domain allowlist, IP rate limiting, no internal errors exposed.

const ALLOWED_ORIGINS = new Set([
    'https://reddragontracker.com',
    'https://www.reddragontracker.com',
    'https://reddragontracker.pages.dev',
]);
const ALLOWED_DOMAINS = ['www.stats.gov.cn'];

// Ephemeral per-isolate rate limiter (best-effort; not a substitute for WAF rules)
const _rl = new Map();
const RL_WINDOW = 60_000;   // 1 minute
const RL_MAX    = 15;       // 15 requests / IP / minute

function rateLimit(ip) {
    const now = Date.now();
    let e = _rl.get(ip) || { n: 0, until: now + RL_WINDOW };
    if (now > e.until) { e.n = 0; e.until = now + RL_WINDOW; }
    e.n++;
    _rl.set(ip, e);
    if (_rl.size > 5000) {                           // prevent unbounded growth
        for (const [k, v] of _rl) { if (now > v.until) _rl.delete(k); }
    }
    return e.n <= RL_MAX;
}

function getIP(req) {
    return (
        req.headers.get('cf-connecting-ip') ||
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        'unknown'
    );
}

export async function onRequest(context) {
    const { request } = context;

    const origin = request.headers.get('origin') || '';
    const CORS = {
        'Access-Control-Allow-Origin':  ALLOWED_ORIGINS.has(origin) ? origin : '',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'GET') {
        return json({ error: 'Method not allowed' }, 405, CORS);
    }

    // ── Rate limit ──────────────────────────────────────────────────────
    const ip = getIP(request);
    if (!rateLimit(ip)) {
        return json({ error: 'Too many requests' }, 429, {
            ...CORS, 'Retry-After': '60',
        });
    }

    // ── URL validation ──────────────────────────────────────────────────
    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get('url');
    if (!rawUrl) return json({ error: 'Missing url parameter' }, 400, CORS);

    let targetUrl;
    try {
        targetUrl = new URL(decodeURIComponent(rawUrl));
    } catch {
        return json({ error: 'Invalid URL' }, 400, CORS);
    }

    if (!ALLOWED_DOMAINS.includes(targetUrl.hostname)) {
        return json({ error: 'Domain not allowed' }, 403, CORS);
    }

    // Force HTTPS
    targetUrl.protocol = 'https:';

    try {
        const upstream = await fetch(targetUrl.toString(), {
            headers: {
                'User-Agent': 'RedDragonTracker/1.0 (reddragontracker.pages.dev)',
                'Accept': 'text/html,application/xhtml+xml,application/xml',
            },
            cf: { cacheTtl: 300, cacheEverything: true },
        });
        const contents = await upstream.text();
        return new Response(JSON.stringify({ contents }), {
            headers: {
                ...CORS,
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=300',
            },
        });
    } catch {
        return json({ error: 'Upstream unavailable' }, 502, CORS);
    }
}

function json(data, status, cors) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
    });
}
