// Cloudflare Pages Function — CORS proxy (replaces allorigins.win)
// Hard allowlist: only fetches from approved domains.
// Returns { contents: "..." } to stay compatible with existing frontend code.
// Frontend calls: /api/proxy?url=https%3A%2F%2Fwww.stats.gov.cn%2F...

const ALLOWED_DOMAINS = [
    'www.stats.gov.cn',
];

export async function onRequest(context) {
    const { request } = context;

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
    const rawUrl = searchParams.get('url');
    if (!rawUrl) {
        return json({ error: 'Missing url parameter' }, 400, CORS);
    }

    let targetUrl;
    try {
        targetUrl = new URL(decodeURIComponent(rawUrl));
    } catch {
        return json({ error: 'Invalid URL' }, 400, CORS);
    }

    if (!ALLOWED_DOMAINS.includes(targetUrl.hostname)) {
        return json({ error: 'Domain not in allowlist' }, 403, CORS);
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
    } catch (e) {
        return json({ error: 'Fetch failed', contents: '' }, 502, CORS);
    }
}

function json(data, status, cors) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
    });
}
