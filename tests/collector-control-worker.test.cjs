const test = require('node:test');
const assert = require('node:assert/strict');
const base = 'https://data-center.workdesk-hub.workers.dev/hensem-data-center';
const endpoint = 'https://gmfyfzsxpxmaqtuuwgxb.supabase.co/functions/v1/collector-control';
const proxyKey = 'synthetic-test-proxy-key-only';
const ip = '192.0.2.10';
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...extra } });
const req = (body = { action: 'overview' }, headers = {}, method = 'POST') => new Request(base + '/api/collector-control?ignored=yes', {
  method, headers: { 'CF-Connecting-IP': ip, Authorization: 'Bearer synthetic-human-token', 'Content-Type': 'application/json', Origin: new URL(base).origin, ...headers },
  ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
});
async function run(request, options = {}) {
  const { serve } = await import('../cloudflare/data-center/worker.mjs');
  const calls = [];
  const response = await serve(request, { PORTAL_PROXY_KEY: proxyKey }, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/application-entry-gate')) return json({ ok: true, allowed: options.allowed !== false });
    if (options.error) throw new Error('sensitive-upstream-error');
    return options.response || json({ ok: true, canEdit: true, devices: [] });
  });
  return { response, calls };
}
test('collector human proxy pins destination and replaces spoofed identity headers', async () => {
  const { response, calls } = await run(req({ action: 'overview' }, { Cookie: 'private-cookie', 'x-portal-proxy-key': 'attacker', 'x-portal-client-ip': '1.2.3.4', 'X-Forwarded-For': '5.6.7.8' }));
  assert.equal(response.status, 200); assert.equal(calls.length, 2);
  const call = calls[1], headers = new Headers(call.init.headers);
  assert.equal(call.url, endpoint); assert.equal(call.init.method, 'POST');
  assert.equal(call.init.redirect, 'manual'); assert.equal(call.init.cache, 'no-store');
  assert.equal(headers.get('x-portal-proxy-key'), proxyKey); assert.equal(headers.get('x-portal-client-ip'), ip);
  assert.equal(headers.get('Authorization'), 'Bearer synthetic-human-token');
  assert.equal(headers.get('Cookie'), null); assert.equal(headers.get('X-Forwarded-For'), null);
  assert.equal(headers.get('Origin'), null); assert.equal(call.init.body, '{"action":"overview"}');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});
test('entry denial prevents all forwarding, including valid control actions', async () => {
  const { response, calls } = await run(req(), { allowed: false });
  assert.equal(response.status, 403); assert.equal(calls.length, 1);
});
test('proxy rejects device operations and malformed or unrecognized human bodies', async () => {
  for (const body of [{action:'pair'}, {action:'poll'}, {action:'shell'}, [], null, {action:['overview']}]) {
    const { response, calls } = await run(req(body)); assert.equal(response.status, 400); assert.equal(calls.length, 1);
  }
});
test('every supported human action is sent exactly once', async () => {
  for (const action of ['overview','createPairing','revokeDevice','setDesired']) {
    const { response, calls } = await run(req({action}), { response: json({ok:false,code:'invalid_request'},400) });
    assert.equal(response.status, 400); assert.equal(calls.length, 2);
  }
});
test('method, content type, origin, bearer and bounded input checks fail before proxying', async () => {
  for (const [request,status] of [[req({}, {}, 'GET'),405], [req({}, {'Content-Type':'text/plain'}),415],
    [req({}, {Origin:'https://untrusted.invalid'}),403], [req({}, {Authorization:''}),401],
    [req({}, {Authorization:'Bearer one,two'}),401], [req({}, {'Content-Length':'65537'}),413],
    [req({action:'overview',large:'x'.repeat(65536)}),400]]) {
    const {response,calls}=await run(request); assert.equal(response.status,status); assert.equal(calls.length,1);
  }
});
test('redirects, non-JSON, malformed and oversized upstream responses fail closed', async () => {
  for (const upstream of [new Response(null,{status:302,headers:{Location:'https://untrusted.invalid'}}),
    new Response('private debug',{status:500}), json([]), json({ok:'yes'}),
    new Response('{bad',{headers:{'Content-Type':'application/json'}}), json({ok:true,large:'x'.repeat(8*1024*1024)})]) {
    const {response,calls}=await run(req(),{response:upstream});
    assert.ok([502,503].includes(response.status)); assert.equal(calls.length,2);
    assert.equal(response.headers.get('location'),null); assert.doesNotMatch(await response.text(),/private debug|untrusted/);
  }
});
test('ambiguous mutation failures are not retried and upstream cookies are stripped', async () => {
  const failed = await run(req({action:'setDesired'}),{error:true});
  assert.equal(failed.response.status,503); assert.equal(failed.calls.length,2);
  assert.doesNotMatch(await failed.response.text(),/sensitive/);
  const good = await run(req(),{response:json({ok:true,devices:[],canEdit:true},200,{'Set-Cookie':'untrusted=1'})});
  assert.equal(good.response.headers.get('set-cookie'),null);
});
