// Cloudflare Pages Function — AQI proxy
// Keeps WAQI token server-side. Security: strict CORS, input validation, IP rate limiting.

const ALLOWED_ORIGIN = 'https://reddragontracker.pages.dev';

// Ephemeral per-isolate rate limiter
const _rl = new Map();
const RL_WINDOW = 60_000;   // 1 minute
const RL_MAX    = 20;       // 20 requests / IP / minute

function rateLimit(ip) {
    const now = Date.now();
    let e = _rl.get(ip) || { n: 0, until: now + RL_WINDOW };
    if (now > e.until) { e.n = 0; e.until = now + RL_WINDOW; }
    e.n++;
    _rl.set(ip, e);
    if (_rl.size > 5000) {
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

// Allowlist of valid city slugs / station tokens the frontend actually uses
const ALLOWED_CITIES = new Set([
    'beijing', 'shanghai', 'guangzhou', 'shenzhen', 'chengdu',
    'wuhan', 'xian', "xi'an", 'tianjin', 'chongqing', 'nanjing',
    'hangzhou', 'shenyang', 'harbin', 'taipei', 'hong-kong',
]);

export async function onRequest(context) {
    const { request, env } = context;

    const origin = request.headers.get('origin') || '';
    const CORS = {
        'Access-Control-Allow-Origin':  origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : '',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'GET') {
        return json({ status: 'error', data: 'Method not allowed' }, 405, CORS);
    }

    // ── Rate limit ──────────────────────────────────────────────────────
    const ip = getIP(request);
    if (!rateLimit(ip)) {
        return json({ status: 'error', data: 'Too many requests' }, 429, {
            ...CORS, 'Retry-After': '60',
        });
    }

    // ── Input validation ────────────────────────────────────────────────
    const { searchParams } = new URL(request.url);
    const city = (searchParams.get('city') || '').trim().toLowerCase();
    if (!city || city.length > 50 || !ALLOWED_CITIES.has(city)) {
        return json({ status: 'error', data: 'Invalid city' }, 400, CORS);
    }

    const token = env.WAQI_TOKEN;
    if (!token) {
        return json({ status: 'error', data: 'Service unavailable' }, 503, CORS);
    }

    try {
        const upstream = await fetch(
            `https://api.waqi.info/feed/${encodeURIComponent(city)}/?token=${token}`,
            { cf: { cacheTtl: 1800, cacheEverything: true } }
        );
        const data = await upstream.json();
        return new Response(JSON.stringify(data), {
            headers: {
                ...CORS,
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=1800',
            },
        });
    } catch {
        return json({ status: 'error', data: 'Upstream unavailable' }, 502, CORS);
    }
}

function json(data, status, cors) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
    });
}
