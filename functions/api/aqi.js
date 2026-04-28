// Cloudflare Pages Function — AQI proxy
// Keeps the WAQI token server-side (set WAQI_TOKEN in Pages env vars).
// Frontend calls: /api/aqi?city=Beijing

export async function onRequest(context) {
    const { request, env } = context;

    const CORS = {
        'Access-Control-Allow-Origin': 'https://reddragontracker.pages.dev',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
    }

    const { searchParams } = new URL(request.url);
    const city = (searchParams.get('city') || '').trim();
    if (!city || city.length > 100) {
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
    } catch (e) {
        return json({ status: 'error', data: 'Upstream error' }, 502, CORS);
    }
}

function json(data, status, cors) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
    });
}
