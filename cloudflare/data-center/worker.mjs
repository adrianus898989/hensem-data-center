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


const BOOTSTRAP_ORIGIN = 'https://gmfyfzsxpxmaqtuuwgxb.supabase.co';
const PROFILE_PATH = BASE + '/api/dashboard-profile';
const ROLE_ACCESS_PATH = BASE + '/api/dashboard-role-access';
const PREVIEW_PATH = BASE + '/api/dashboard-preview';
const ACCESS_CHECK_PATH = BASE + '/api/dashboard-access-check';
const BOOTSTRAP_PATHS = new Set([PROFILE_PATH, ROLE_ACCESS_PATH, PREVIEW_PATH, ACCESS_CHECK_PATH]);
const BOOTSTRAP_TIMEOUT_MS = 10000;
const BOOTSTRAP_JSON_LIMIT = 256 * 1024;
const BOOTSTRAP_HTML_LIMIT = 16 * 1024 * 1024;
const PROFILE_SELECT = 'auth_user_id,username,role,active,permissions,management_permissions,data_scope,created_at,updated_at';

async function bootstrapBytes(body, limit, signal) {
  const reader = body?.getReader();
  if (!reader) throw new Error('missing_body');
  const cancel = () => { try { reader.cancel().catch(() => {}); } catch { /* cleanup only */ } };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks = []; let size = 0;
  try {
    signal.throwIfAborted();
    for (;;) {
      const part = await reader.read(); signal.throwIfAborted();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) { cancel(); throw new Error('body_limit'); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

async function bootstrapBody(response, limit, signal) {
  let bytes = await bootstrapBytes(response.body, limit, signal);
  // Fetch normally decodes content encodings. The production preview may
  // nevertheless return gzip despite identity; support raw gzip once, without
  // re-decoding a runtime-decoded body or forwarding stale encoding/length.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (response.headers.get('content-encoding')?.toLowerCase().trim() !== 'gzip') throw new Error('body_encoding');
    bytes = await bootstrapBytes(new Response(bytes).body.pipeThrough(new DecompressionStream('gzip')), limit, signal);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// These four routes are transport-only reads. Authorization remains with the
// same verified user JWT and original Auth/RLS/session/role/preview handlers.
// No caller-supplied URL, user ID, RPC name, action or headers reach upstream.
async function serveDashboardBootstrap(request, fetchRemote) {
  const json = (value, status) => reply(JSON.stringify(value), status,
    { 'Content-Type': 'application/json; charset=utf-8' });
  const url = new URL(request.url), path = url.pathname;
  const post = path === ROLE_ACCESS_PATH || path === ACCESS_CHECK_PATH;
  if (request.method !== (post ? 'POST' : 'GET')) return json({ code: 'method_not_allowed' }, 405);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    return json({ code: 'origin_denied' }, 403);
  }
  if (path === PREVIEW_PATH ? !['', '?action=access', '?check=1'].includes(url.search) : url.search !== '') {
    return json({ code: 'invalid_request' }, 400);
  }
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer [^\s,]{1,16384}$/i.test(authorization)) return json({ code: 'login_required' }, 401);
  if (post && !/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) {
    return json({ code: 'json_required' }, 415);
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (!Number.isSafeInteger(length) || length < 0 || length > (post ? 128 : 0) || !post && request.body !== null) {
    return json({ code: 'invalid_request' }, 400);
  }
  const controller = new AbortController();
  let timer, abort;
  const stopped = new Promise((_, reject) => {
    abort = () => { reject(new Error('cancelled')); controller.abort(); };
    request.signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { reject(new Error('deadline')); controller.abort(); }, BOOTSTRAP_TIMEOUT_MS);
    if (request.signal.aborted) abort();
  });
  const remote = async (target, method = 'GET', body) => {
    controller.signal.throwIfAborted();
    const response = await fetchRemote(BOOTSTRAP_ORIGIN + target, {
      method, headers: { Authorization: authorization, apikey: PUBLISHABLE_KEY,
        Accept: target.startsWith('/functions/v1/owner-admin-preview') ? 'text/html, application/json' : 'application/json',
        'Accept-Encoding': 'identity', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body }),
      redirect: 'manual', cache: 'no-store', signal: controller.signal,
    });
    if (response.status < 200 || response.status >= 300 && response.status < 400) {
      try { response.body?.cancel().catch(() => {}); } catch { /* cleanup only */ }
      throw new Error('upstream_redirect');
    }
    const type = response.headers.get('content-type') || '';
    const html = path === PREVIEW_PATH && !url.search && response.ok && /^text\/html(?:;|$)/i.test(type);
    if (!html && !/^application\/json(?:;|$)/i.test(type)) {
      try { response.body?.cancel().catch(() => {}); } catch { /* cleanup only */ }
      throw new Error('upstream_content_type');
    }
    const text = await bootstrapBody(response, html ? BOOTSTRAP_HTML_LIMIT : BOOTSTRAP_JSON_LIMIT, controller.signal);
    if (html) {
      if (!/^<!doctype html>/i.test(text.trim()) || !text.includes('Hensem')) throw new Error('invalid_html');
      return reply(text, response.status, { 'Content-Type': 'text/html; charset=utf-8' });
    }
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object') throw new Error('invalid_json');
    return json(value, response.status);
  };
  const read = async () => {
    if (post) {
      let body;
      try { body = await boundedJson(request.body, 128, controller.signal); }
      catch { controller.signal.throwIfAborted(); return json({ code: 'invalid_request' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
        return json({ code: 'invalid_request' }, 400);
      }
    }
    if (path === PROFILE_PATH) {
      const auth = await remote('/auth/v1/user');
      if (!auth.ok) return auth;
      const user = await auth.json();
      if (typeof user.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)) {
        return json({ code: 'login_required' }, 401);
      }
      const query = new URLSearchParams({ select: PROFILE_SELECT, auth_user_id: 'eq.' + user.id, limit: '1' });
      return remote('/rest/v1/dashboard_profiles?' + query);
    }
    if (path === ROLE_ACCESS_PATH) return remote('/rest/v1/rpc/dashboard_role_access', 'POST', '{}');
    if (path === ACCESS_CHECK_PATH) return remote('/functions/v1/dashboard-user-admin', 'POST', '{"action":"check-access"}');
    return remote('/functions/v1/owner-admin-preview' + url.search);
  };
  try { return await Promise.race([read(), stopped]); }
  catch { return json({ code: 'bootstrap_unavailable' }, 503); }
  finally { clearTimeout(timer); request.signal.removeEventListener('abort', abort); controller.abort(); }
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
  const path = new URL(request.url).pathname;
  const response = BOOTSTRAP_PATHS.has(path)
    ? await serveDashboardBootstrap(request, fetchRemote)
    : path === COLLECTOR_PATH ? await serveCollectorControl(request, env, fetchRemote)
    : path.startsWith(BASE + '/api/') ? reply('Not found', 404)
    : await servePublicStatic(request, fetchRemote);
  const headers = new Headers(response.headers);
  // Do not let a browser or intermediary reuse a protected response after its
  // address is removed. Public upstream hash caching is separate from access.
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, { status: response.status, headers });
}

export default { fetch: (request, env) => serve(request, env) };
