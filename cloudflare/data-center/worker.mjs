const UPSTREAM = 'https://adrianus898989.github.io';
const BASE = '/hensem-data-center';
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
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
export async function serve(request, fetchPublic = fetch) {
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

export default { fetch: request => serve(request) };
