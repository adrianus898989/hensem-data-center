const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { gzipSync } = require('node:zlib');
const worker = async () => import(path.join(__dirname, '../cloudflare/data-center/worker.mjs'));
const base = 'https://data-center.workdesk-hub.workers.dev/hensem-data-center';
const origin = new URL(base).origin, key = 'synthetic-opening-key-123456';
const uid = '11111111-2222-4333-8444-555555555555';
const profile = [{ auth_user_id: uid, username: 'synthetic', role: 'viewer', active: true }];
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {status, headers: {'Content-Type':'application/json', ...headers}});
const request = (route, init = {}) => new Request(base + '/api/' + route, {
  ...init, headers: {'CF-Connecting-IP':'192.0.2.10', Authorization:'Bearer synthetic-user-token', Origin:origin, ...init.headers},
});
async function run(req, respond = () => json({ok:true}), options = {}) {
  const {serve} = await worker(), calls = [];
  const response = await serve(req, {PORTAL_PROXY_KEY:key}, async (url, init) => {
    calls.push({url, init});
    if (url.endsWith('/application-entry-gate')) return json({ok:true, allowed:options.allowed !== false});
    return respond(url, init);
  });
  return {response, calls, remote:calls.filter(c => !c.url.endsWith('/application-entry-gate'))};
}
function privateResponse(response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('content-encoding'), null);
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(response.headers.get('location'), null);
}
test('profile identity is verified by original Auth then fixed RLS query, with the same user JWT', async () => {
  const {response, remote} = await run(request('dashboard-profile', {headers:{Cookie:'do-not-forward', apikey:'attacker', 'x-portal-proxy-key':'attacker', 'x-portal-client-ip':'1.2.3.4', 'X-Forwarded-For':'9.8.7.6', Range:'bytes=0-1'}}),
    url => url.endsWith('/auth/v1/user') ? json({id:uid, private_metadata:'not forwarded'}) : json(profile, 200, {'Set-Cookie':'private=1','Content-Encoding':'gzip','Content-Length':'5'}));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), profile); privateResponse(response);
  assert.equal(remote.length, 2); assert.equal(remote[0].url, 'https://gmfyfzsxpxmaqtuuwgxb.supabase.co/auth/v1/user');
  const target = new URL(remote[1].url); assert.equal(target.pathname, '/rest/v1/dashboard_profiles');
  assert.deepEqual([...target.searchParams.keys()].sort(), ['auth_user_id','limit','select']);
  assert.equal(target.searchParams.get('auth_user_id'), 'eq.' + uid); assert.equal(target.searchParams.get('limit'), '1');
  assert.equal(target.searchParams.get('select'), 'auth_user_id,username,role,active,permissions,management_permissions,data_scope,created_at,updated_at');
  for (const {init} of remote) {
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(init.redirect, 'manual'); assert.equal(init.cache,'no-store');
    const h = new Headers(init.headers); assert.equal(h.get('authorization'), 'Bearer synthetic-user-token');
    assert.match(h.get('apikey'), /^sb_publishable_/);
    assert.deepEqual([...h.keys()].sort(), ['accept','accept-encoding','apikey','authorization']);
  }
});
test('role and access-check have fixed upstream bodies, no caller action or arbitrary RPC', async () => {
  for (const [route, suffix, body] of [
    ['dashboard-role-access','/rest/v1/rpc/dashboard_role_access','{}'],
    ['dashboard-access-check','/functions/v1/dashboard-user-admin','{"action":"check-access"}'],
  ]) {
    const {response, remote} = await run(request(route, {method:'POST',body:' { } ',headers:{'Content-Type':'application/json'}}));
    assert.equal(response.status, 200); assert.equal(remote.length, 1);
    assert.equal(remote[0].url, 'https://gmfyfzsxpxmaqtuuwgxb.supabase.co' + suffix);
    assert.equal(remote[0].init.method, 'POST'); assert.equal(remote[0].init.body, body); privateResponse(response);
  }
});
test('preview accepts only document/access/check and keeps its original read endpoint', async () => {
  for (const query of ['', '?action=access', '?check=1']) {
    const value = query ? json({ok:true, canView:true}) : new Response('<!doctype html><html><body>Hensem verified</body></html>', {headers:{'Content-Type':'text/html'}});
    const {response, remote} = await run(request('dashboard-preview' + query), () => value);
    assert.equal(response.status, 200); assert.equal(remote.length, 1);
    assert.equal(remote[0].url, 'https://gmfyfzsxpxmaqtuuwgxb.supabase.co/functions/v1/owner-admin-preview' + query);
    assert.equal(remote[0].init.method, 'GET'); assert.equal(remote[0].init.body, undefined); privateResponse(response);
  }
});
test('entry IP denial occurs before every bootstrap read', async () => {
  for (const route of ['dashboard-profile','dashboard-role-access','dashboard-preview','dashboard-access-check']) {
    const {response, calls} = await run(request(route), () => assert.fail('unexpected remote'), {allowed:false});
    assert.equal(response.status, 403); assert.equal(calls.length, 1);
  }
});
test('writes, OPTIONS, HEAD and wrong methods cannot pass any bootstrap route', async () => {
  for (const route of ['dashboard-profile','dashboard-role-access','dashboard-preview','dashboard-access-check']) {
    const allowed = /role-access|access-check/.test(route) ? 'POST' : 'GET';
    for (const method of ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'].filter(m => m !== allowed)) {
      const {response, remote} = await run(request(route,{method}));
      assert.equal(response.status,405); assert.equal(remote.length,0);
    }
  }
});
test('cross-origin requests fail, including cross-site GET with omitted Origin', async () => {
  for (const headers of [{Origin:'https://attacker.invalid'},{Origin:'null'},{'Sec-Fetch-Site':'cross-site'}]) {
    const {response,remote} = await run(request('dashboard-profile',{headers})); assert.equal(response.status,403);assert.equal(remote.length,0);
  }
  const req = request('dashboard-profile',{headers:{'Sec-Fetch-Site':'cross-site'}});req.headers.delete('origin');
  assert.equal((await run(req)).response.status,403);
});
test('only bounded bearer credentials are accepted; cookies never substitute for login', async () => {
  for (const authorization of ['', 'Basic abc', 'Bearer a,b', 'Bearer a b', 'Bearer ' + 'x'.repeat(16385)]) {
    const {response,remote} = await run(request('dashboard-profile',{headers:{Authorization:authorization,Cookie:'session=private'}}));
    assert.equal(response.status,401);assert.equal(remote.length,0);
  }
});
test('URLs/user IDs/duplicate or encoded query controls cannot influence upstream', async () => {
  for (const route of ['dashboard-profile?auth_user_id=eq.other','dashboard-role-access?rpc=evil','dashboard-access-check?action=reset-password',
    'dashboard-preview?action=grants','dashboard-preview?check=1&action=grants','dashboard-preview?action=access&action=grants',
    'dashboard-preview?%61ction=access','dashboard-preview?url=https://attacker.invalid','dashboard-preview?check=1&check=1']) {
    const post = /role-access|access-check/.test(route);
    const {response,remote} = await run(request(route,{...(post?{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}}:{})}));
    assert.equal(response.status,400); assert.equal(remote.length,0);
  }
});
test('role and access-check reject nonempty JSON, arrays, malformed JSON, wrong type and oversized streams', async () => {
  for (const route of ['dashboard-role-access','dashboard-access-check']) {
    for (const body of ['{"action":"check-access"}','{"action":"delete"}','{"userId":"other"}','{"url":"https://attacker.invalid"}','[]','null','{','"x"','{"padding":"'+'x'.repeat(200)+'"}']) {
      const {response,remote} = await run(request(route,{method:'POST',body,headers:{'Content-Type':'application/json'}}));
      assert.equal(response.status,400);assert.equal(remote.length,0);
    }
    const wrong = await run(request(route,{method:'POST',body:'{}'}));
    assert.equal(wrong.response.status,415);assert.equal(wrong.remote.length,0);
  }
});
test('unknown and encoded API routes do not fall through to GitHub static', async () => {
  for (const route of ['anything','dashboard-preview/grants','dashboard%2fprofile','dashboard-preview%3faction=grants']) {
    const {response,remote} = await run(request(route));assert.equal(response.status,404);assert.equal(remote.length,0);
  }
});
test('original Auth failure or invalid verified identity never queries profiles', async () => {
  for (const upstream of [json({code:'login_required'},401), json({code:'access_denied'},403), json({id:'not-a-uuid'}), json({user_metadata:{sub:uid}})]) {
    const {response,remote} = await run(request('dashboard-profile'), () => upstream);
    assert.ok([401,403].includes(response.status));assert.equal(remote.length,1);
  }
});
test('original role/session/RLS denials keep status and error code without any retry', async () => {
  for (const [status,code,message] of [[401,'login_required','expired'],[403,'42501','application_session_denied'],[503,'role_access_unavailable','unavailable']]) {
    const {response,remote} = await run(request('dashboard-role-access',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}}), () => json({code,message},status,{'Set-Cookie':'bad=1','Access-Control-Allow-Origin':'*'}));
    assert.equal(response.status,status);assert.deepEqual(await response.json(),{code,message});assert.equal(remote.length,1);privateResponse(response);
  }
});
test('preview JSON errors remain JSON and are not mislabeled as HTML', async () => {
  const {response}=await run(request('dashboard-preview'),()=>json({ok:false,code:'preview_denied'},403));
  assert.equal(response.status,403);assert.match(response.headers.get('content-type'),/^application\/json/);
  assert.deepEqual(await response.json(),{ok:false,code:'preview_denied'});
});
test('redirects, non-JSON errors and malformed successful bodies fail closed without body leakage', async () => {
  for (const upstream of [new Response(null,{status:302,headers:{Location:'https://attacker.invalid'}}),
    new Response('private diagnostic',{status:500,headers:{'Content-Type':'text/plain'}}),
    new Response('invalid',{headers:{'Content-Type':'application/json'}}),
    json(null),new Response('<script>unexpected</script>',{headers:{'Content-Type':'text/html'}})]) {
    const {response,remote}=await run(request('dashboard-preview'),()=>upstream);
    assert.equal(response.status,503);assert.equal(remote.length,1);privateResponse(response);
    assert.deepEqual(await response.json(),{code:'bootstrap_unavailable'});
  }
});
test('raw gzip and runtime-decoded gzip preview bodies are decoded once with no stale encoding', async () => {
  const html='<!doctype html><html><body>Hensem authorized preview</body></html>';
  for (const bytes of [gzipSync(html), html]) {
    const {response}=await run(request('dashboard-preview'),()=>new Response(bytes,{headers:{'Content-Type':'text/html','Content-Encoding':'gzip','Content-Length':'99'}}));
    assert.equal(response.status,200);assert.equal(await response.text(),html);privateResponse(response);
  }
});
test('decompressed HTML size is bounded, including gzip bombs', async () => {
  const html='<html>'+'a'.repeat(16*1024*1024)+'</html>';
  const {response}=await run(request('dashboard-preview'),()=>new Response(gzipSync(html),{headers:{'Content-Type':'text/html','Content-Encoding':'gzip'}}));
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{code:'bootstrap_unavailable'});
});
test('JSON response size is bounded', async () => {
  const {response}=await run(request('dashboard-preview?check=1'),()=>json({large:'x'.repeat(256*1024)}));
  assert.equal(response.status,503);
});
test('aborted browser request cancels an unresponsive fetch and ignores its eventual result', async () => {
  const controller=new AbortController();let upstreamSignal, finish;
  const pending=run(request('dashboard-preview',{signal:controller.signal}),(_,init)=>{upstreamSignal=init.signal;return new Promise(resolve=>{finish=resolve})});
  while(!finish)await new Promise(resolve=>setImmediate(resolve));
  controller.abort();const {response,remote}=await pending;assert.equal(response.status,503);assert.equal(remote.length,1);assert.equal(upstreamSignal.aborted,true);
  finish(new Response('<html>late result</html>',{headers:{'Content-Type':'text/html'}}));
});
test('deadline covers stalled fetch and body; neither case waits for ignored cancellation', async () => {
  const original=setTimeout;
  global.setTimeout=(fn,ms,...args)=>original(fn,ms===10000?20:ms,...args);
  try {
    for(const phase of ['fetch','body']) {
      let signal;
      const result=await run(request('dashboard-preview'),(_,init)=>{
        signal=init.signal;
        return phase==='fetch'?new Promise(()=>{}):new Response(new ReadableStream({pull(){return new Promise(()=>{})}}),{headers:{'Content-Type':'text/html'}});
      });
      assert.equal(result.response.status,503);assert.equal(signal.aborted,true);assert.equal(result.remote.length,1);
    }
  }finally{global.setTimeout=original}
});
test('successive requests do not cache identities or retain a previous account response', async () => {
  const ids=[uid,'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'];
  for(const id of ids) {
    const {response,remote}=await run(request('dashboard-profile',{headers:{Authorization:'Bearer '+id}}),url=>url.endsWith('/auth/v1/user')?json({id}):json([{auth_user_id:id}]));
    assert.equal((await response.json())[0].auth_user_id,id);assert.equal(remote.length,2);
    assert.equal(new URL(remote[1].url).searchParams.get('auth_user_id'),'eq.'+id);
  }
});

test('preview preserves original doctype contract with comments or head-less legacy layout', async () => {
  for (const html of ['<!DOCTYPE html><!-- trusted source --><html>Hensem</html>', '<!doctype html><head><title>Hensem</title></head><body>legacy</body>']) {
    const {response}=await run(request('dashboard-preview'),()=>new Response(html,{headers:{'Content-Type':'text/html'}}));
    assert.equal(response.status,200);assert.equal(await response.text(),html);
  }
});
