const UPSTREAM = 'https://adrianus898989.github.io';
const BASE = '/hensem-data-center';
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const ENTRY_GATE = 'https://gmfyfzsxpxmaqtuuwgxb.supabase.co/functions/v1/application-entry-gate';
const PUBLISHABLE_KEY = 'sb_publishable_0DFLEmUvGBp1GYQ7jNo4IA_O1PeA9zV';
// This dedicated HTTPS entry can emit real anti-framing headers. Restrict only
// ancestors here: the authorized internal srcdoc preview needs its inline code.
const SECURITY_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function withinSite(path) {
  return path === BASE || path.startsWith(`${BASE}/`);
}

function reply(body, status, extra = {}) {
  return new Response(body, { status, headers: {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...extra,
  } });
}

// Only public GitHub Pages assets cross this boundary. Never copy the incoming
// Request: it may carry an authenticated dashboard cookie, token or query.
export async function servePublicStatic(request, fetchPublic = fetch) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return reply('Method not allowed', 405, { Allow: 'GET, HEAD' });
  }
  const incoming = new URL(request.url);
  if (incoming.pathname === '/' || incoming.pathname === BASE) {
    return reply(null, 302, { Location: `${BASE}/` });
  }
  if (!withinSite(incoming.pathname) || /%2f|%5c|%25/i.test(incoming.pathname)) {
    return reply('Not found', 404);
  }
  const target = new URL(incoming.pathname, UPSTREAM);
  const immutable = incoming.pathname.startsWith(`${BASE}/_next/static/`)
    && /[-.][a-f0-9]{8,}\.(?:js|css|woff2?|png|svg)$/.test(incoming.pathname);
  let upstream;
  try {
    upstream = await fetchPublic(target.href, {
      method: request.method,
      headers: { Accept: '*/*', 'Cache-Control': immutable ? 'max-age=31536000' : 'no-cache' },
      redirect: 'manual',
      // Cache successful hash assets in the browser, not before inspecting the
      // upstream response: a missing asset may return an HTML/error response.
      cache: 'no-store',
    });
  } catch {
    return reply('Site temporarily unavailable', 502);
  }
  if (REDIRECTS.has(upstream.status)) {
    const location = upstream.headers.get('Location');
    await upstream.body?.cancel();
    if (!location) return reply('Invalid upstream redirect', 502);
    let next;
    try { next = new URL(location, target); } catch { return reply('Invalid upstream redirect', 502); }
    if (next.origin !== UPSTREAM || next.username || next.password || !withinSite(next.pathname)) {
      return reply('Invalid upstream redirect', 502);
    }
    return reply(null, upstream.status, { Location: next.pathname });
  }
  // Do not relay cookies, reporting destinations or redirects from the upstream.
  const isHtml = /(?:text\/html|application\/xhtml\+xml)/i.test(upstream.headers.get('Content-Type') || '');
  const headers = new Headers({
    'Cache-Control': upstream.ok && immutable && !isHtml ? 'public, max-age=31536000, immutable' : 'no-store',
    ...SECURITY_HEADERS,
  });
  for (const name of ['Content-Type', 'ETag', 'Last-Modified']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

function clientIp(request) {
  // Cloudflare overwrites this header on Internet ingress. Never fall back to
  // user-controlled X-Forwarded-For, X-Real-IP, cookies, or query parameters.
  const raw = request.headers.get('CF-Connecting-IP') || '';
  const ip = raw.trim().replace(/^::ffff:/i, '');
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)
    && ip.split('.').every(n => Number(n) <= 255 && String(Number(n)) === n)) return ip;
  if (ip.includes(':') && ip.length <= 64) {
    try { return new URL(`https://[${ip}]`).hostname.slice(1, -1); } catch { /* invalid */ }
  }
  return null;
}

async function entryAllowed(request, env, fetchGate) {
  const ip = clientIp(request), key = env?.PORTAL_PROXY_KEY;
  if (!ip || typeof key !== 'string' || key.length < 16 || key.length > 256) return false;
  let response;
  try {
    response = await fetchGate(ENTRY_GATE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE_KEY,
        'x-portal-proxy-key': key, 'x-portal-client-ip': ip },
      body: '{}',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') || '')) {
      await response.body?.cancel();
      return false;
    }
    // The gate returns one small decision, never account names or IP rules.
    const reader = response.body?.getReader();
    if (!reader) return false;
    let size = 0;
    const chunks = [];
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 1024) { await reader.cancel(); return false; }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const decision = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return decision?.ok === true && decision?.allowed === true;
  } catch { return false; }
}

// The production handler checks every route before redirects, files or method
// errors. Decisions are not cached: a revoked rule affects the next request.
export async function serve(request, env = {}, fetchRemote = fetch) {
  if (!await entryAllowed(request, env, fetchRemote)) {
    return reply(request.method === 'HEAD' ? null : 'Access denied', 403);
  }
  const response = await servePublicStatic(request, fetchRemote);
  const headers = new Headers(response.headers);
  // Do not let a browser or intermediary reuse a protected response after its
  // address is removed. Public upstream hash caching is separate from access.
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, { status: response.status, headers });
}

export default { fetch: (request, env) => serve(request, env) };
