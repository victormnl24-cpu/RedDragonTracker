// Cloudflare Pages Function — AQI proxy
// Keeps WAQI token server-side. Security: strict CORS, input validation, IP rate limiting.

import { rateLimit, getIP } from './_ratelimit.js';
import { corsHeaders } from './_cors.js';

const RL_WINDOW = 60_000;   // 1 minute
const RL_MAX    = 20;       // 20 requests / IP / minute

// Allowlist of valid city slugs / station tokens the frontend actually uses.
// MUST stay in sync with AQI_CITIES in index.html — any city missing here is
// rejected with 400 and its marker silently never updates.
const ALLOWED_CITIES = new Set([
    'beijing', 'shanghai', 'guangzhou', 'shenzhen', 'chengdu',
    'wuhan', 'xian', "xi'an", 'tianjin', 'chongqing', 'nanjing',
    'hangzhou', 'shenyang', 'harbin',
    'zhengzhou', 'jinan', 'kunming', 'urumqi', 'lhasa',
    'taipei', 'hong-kong',
]);

export async function onRequest(context) {
    const { request, env } = context;

    const origin = request.headers.get('origin') || '';
    const CORS = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'GET') {
        return json({ status: 'error', data: 'Method not allowed' }, 405, CORS);
    }

    // ── Rate limit ──────────────────────────────────────────────────────
    const ip = getIP(request);
    if (!await rateLimit(env, ip, { prefix: 'aqi', windowMs: RL_WINDOW, max: RL_MAX })) {
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
