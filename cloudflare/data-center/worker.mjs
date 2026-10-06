const UPSTREAM = 'https://adrianus898989.github.io';
const BASE = '/hensem-data-center';
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const ENTRY_GATE = 'https://gmfyfzsxpxmaqtuuwgxb.supabase.co/functions/v1/application-entry-gate';
const PUBLISHABLE_KEY = 'sb_publishable_0DFLEmUvGBp1GYQ7jNo4IA_O1PeA9zV';
const GATE_TIMEOUT_MS = 5000;
const GATE_RETRY_DELAY_MS = 150;
const COLLECTOR_PATH = BASE + '/api/collector-control';
const COLLECTOR_ENDPOINT = 'https://gmfyfzsxpxmaqtuuwgxb.supabase.co/functions/v1/collector-control';
const COLLECTOR_ACTIONS = new Set(['overview', 'createPairing', 'revokeDevice', 'setDesired']);
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

async function readEntryDecision(ip, key, fetchGate) {
  let response, reader, timer;
  let stage = 'gate_fetch';
  const controller = new AbortController();
  const cancel = body => {
    // Cleanup cannot postpone a known denial or turn it into a retriable error.
    try { body?.cancel()?.catch(() => {}); } catch { /* cleanup only */ }
  };
  // Fence both fetch and body consumption. A stalled body must not leave one
  // script waiting forever after the rest of the page has passed its checks.
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => {
      controller.abort();
      cancel(reader);
      resolve({ status: 'unavailable', reason: stage + '_TimeoutError' });
    }, GATE_TIMEOUT_MS);
  });
  const read = async () => {
    try {
      response = await fetchGate(ENTRY_GATE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE_KEY,
          'x-portal-proxy-key': key, 'x-portal-client-ip': ip },
        body: '{}',
        // workerd accepts follow/manual only. Never follow this proof to a 3xx.
        redirect: 'manual',
        cache: 'no-store',
        signal: controller.signal,
      });
      stage = 'gate_response';
      if (!response.ok) {
        cancel(response.body);
        if (response.status >= 500 && response.status <= 599) {
          return { status: 'unavailable', reason: 'gate_http_5xx' };
        }
        return { status: 'denied', reason: response.status === 401 ? 'gate_http_401'
          : response.status === 403 ? 'gate_http_403' : 'gate_http_other' };
      }
      if (!/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') || '')) {
        cancel(response.body);
        return { status: 'denied', reason: 'gate_content_type' };
      }
      // The gate returns one small decision, never account names or IP rules.
      reader = response.body?.getReader();
      if (!reader) return { status: 'denied', reason: 'gate_body_missing' };
      stage = 'gate_body';
      let size = 0;
      const chunks = [];
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 1024) {
          cancel(reader);
          return { status: 'denied', reason: 'gate_body_limit' };
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      stage = 'gate_json';
      const decision = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (decision?.ok !== true) return { status: 'denied', reason: 'gate_decision_invalid' };
      if (decision?.allowed !== true) return { status: 'denied', reason: 'gate_decision_denied' };
      return { status: 'allowed' };
    } catch (error) {
      const name = ['AbortError', 'TimeoutError', 'NetworkError', 'TypeError', 'SyntaxError', 'Error'].includes(error?.name)
        ? error.name : 'other';
      // UTF-8/JSON/decision validation failures are terminal, even if a decoder
      // throws TypeError. Only transport failures may get a fresh gate read.
      const temporary = (stage === 'gate_fetch' || stage === 'gate_body')
        && ['AbortError', 'TimeoutError', 'NetworkError', 'TypeError'].includes(name);
      return { status: temporary ? 'unavailable' : 'denied', reason: stage + '_' + name };
    }
  };
  try { return await Promise.race([read(), deadline]); }
  finally { clearTimeout(timer); }
}

async function entryDecision(request, env, fetchGate) {
  // Operator secret input can retain a final newline. Normalize the binding,
  // never an untrusted request header, before constructing the upstream proof.
  const ip = clientIp(request), value = env?.PORTAL_PROXY_KEY;
  const key = typeof value === 'string' ? value.trim() : '';
  const denied = reason => {
    // Keep operational evidence private and bounded. Never log the address,
    // key, URL, response body, or an upstream exception message.
    console.warn('dashboard_entry_denied:' + reason);
    return { status: 'denied', reason };
  };
  if (!ip) return denied('ingress_ip');
  if (key.length < 16 || key.length > 256) return denied('proxy_binding');
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const decision = await readEntryDecision(ip, key, fetchGate);
    if (decision.status === 'allowed') return decision;
    if (decision.status === 'denied') return denied(decision.reason);
    if (attempt === 2) {
      console.warn('dashboard_entry_denied:' + decision.reason);
      return decision;
    }
    await new Promise(resolve => setTimeout(resolve, GATE_RETRY_DELAY_MS));
  }
}

async function boundedJson(body, limit, signal) {
  const reader = body?.getReader();
  if (!reader) throw new Error('missing_body');
  const abort = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const chunks = []; let size = 0;
  try {
    signal.throwIfAborted();
    for (;;) {
      const part = await reader.read(); signal.throwIfAborted();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) { reader.cancel().catch(() => {}); throw new Error('body_limit'); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}

// Only registered human actions cross this fixed proxy. Device pairing/polling
// use their separately scoped Edge credentials and cannot use this route.
async function serveCollectorControl(request, env, fetchRemote) {
  const json = (value, status) => reply(JSON.stringify(value), status,
    { 'Content-Type': 'application/json; charset=utf-8' });
  if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ ok: false, code: 'origin_denied' }, 403);
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer [^\s,]{1,4096}$/.test(authorization)) return json({ ok: false, code: 'login_required' }, 401);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return json({ ok: false, code: 'json_required' }, 415);
  if (Number(request.headers.get('content-length') || 0) > 65536) return json({ ok: false, code: 'request_too_large' }, 413);
  const readController = new AbortController();
  const readTimer = setTimeout(() => readController.abort(), 10000);
  let body;
  try { body = await boundedJson(request.body, 65536, readController.signal); }
  catch { return json({ ok: false, code: 'invalid_request' }, 400); }
  finally { clearTimeout(readTimer); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !COLLECTOR_ACTIONS.has(body.action)) {
    return json({ ok: false, code: 'invalid_request' }, 400);
  }
  const ip = clientIp(request), key = typeof env?.PORTAL_PROXY_KEY === 'string' ? env.PORTAL_PROXY_KEY.trim() : '';
  if (!ip || key.length < 16 || key.length > 256) return json({ ok: false, code: 'proxy_denied' }, 403);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetchRemote(COLLECTOR_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE_KEY,
        Authorization: authorization, 'x-portal-proxy-key': key, 'x-portal-client-ip': ip },
      body: JSON.stringify(body), redirect: 'manual', cache: 'no-store', signal: controller.signal,
    });
    if (REDIRECTS.has(response.status) || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) {
      response.body?.cancel().catch(() => {}); return json({ ok: false, code: 'service_unavailable' }, 502);
    }
    const value = await boundedJson(response.body, 8 * 1024 * 1024, controller.signal);
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.ok !== 'boolean') {
      return json({ ok: false, code: 'service_unavailable' }, 502);
    }
    return json(value, response.status);
  } catch { return json({ ok: false, code: 'service_unavailable' }, 503); }
  finally { clearTimeout(timer); }
}

// The production handler checks every route before redirects, files or method
// errors. Decisions are not cached: a revoked rule affects the next request.
export async function serve(request, env = {}, fetchRemote = fetch) {
  const decision = await entryDecision(request, env, fetchRemote);
  if (decision.status === 'unavailable') {
    return reply(request.method === 'HEAD' ? null : 'Site temporarily unavailable', 503, { 'Retry-After': '1' });
  }
  if (decision.status !== 'allowed') {
    return reply(request.method === 'HEAD' ? null : 'Access denied', 403);
  }
  const response = new URL(request.url).pathname === COLLECTOR_PATH
    ? await serveCollectorControl(request, env, fetchRemote)
    : await servePublicStatic(request, fetchRemote);
  const headers = new Headers(response.headers);
  // Do not let a browser or intermediary reuse a protected response after its
  // address is removed. Public upstream hash caching is separate from access.
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, { status: response.status, headers });
}

export default { fetch: (request, env) => serve(request, env) };
