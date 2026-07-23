// Shared CORS origin policy for RedDragonTracker Pages Functions.
// (Leading underscore => Cloudflare Pages does NOT expose this file as a route.)
//
// The site is served from several legitimate origins:
//   • https://reddragontracker.com          — canonical custom domain
//   • https://www.reddragontracker.com      — www variant
//   • https://reddragontracker.pages.dev    — Cloudflare Pages production domain
//   • https://<hash>.reddragontracker.pages.dev — Pages preview deployments
//
// Only the repo owner can create *.pages.dev deployments, so allowing that
// subdomain pattern does not widen the surface to third parties.

const EXACT = new Set([
    'https://reddragontracker.com',
    'https://www.reddragontracker.com',
    'https://reddragontracker.pages.dev',
]);

// Cloudflare Pages preview deployments: https://<hash>.reddragontracker.pages.dev
const PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.reddragontracker\.pages\.dev$/;

/** @returns {boolean} true if this origin is one of ours */
export function isAllowedOrigin(origin) {
    if (!origin) return false;
    return EXACT.has(origin) || PREVIEW_RE.test(origin);
}

/**
 * Build CORS headers that echo the origin only when it is allowed.
 * Always sets Vary: Origin so caches never mix responses across origins.
 */
export function corsHeaders(origin, methods = 'GET, OPTIONS') {
    return {
        'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : '',
        'Access-Control-Allow-Methods': methods,
        'Vary': 'Origin',
    };
}
