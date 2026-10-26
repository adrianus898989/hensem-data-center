const test = require('node:test'), assert = require('node:assert/strict');
const { gzipSync, gunzipSync } = require('node:zlib');
const base = 'https://data-center.workdesk-hub.workers.dev/hensem-data-center/api/';
const env = { PORTAL_PROXY_KEY: 'synthetic-entry-proof-only' };
test('production enables incoming client disconnect signals used by the protected reads',()=>{
  const config=JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname,'../cloudflare/data-center/wrangler.jsonc'),'utf8'));
  assert(config.compatibility_flags.includes('enable_request_signal'));
});
const json = (body, status=200, headers={}) => Response.json(body, {status, headers});
const request = (route='dashboard-preview', options={}) => new Request(base+route, {
  ...options, headers:{'CF-Connecting-IP':'192.0.2.20', Authorization:'Bearer synthetic-user',
    'Content-Type':'application/json', Origin:new URL(base).origin, ...options.headers},
});
async function run(req, options={}) {
  const {serve} = await import('../cloudflare/data-center/worker.mjs'); const calls=[];
  const response=await serve(req,env,async(url,init)=>{
    calls.push({url,init});
    if(url.endsWith('/application-entry-gate')) return json({ok:true,allowed:options.allowed!==false});
    return options.fetch ? options.fetch(url,init) : options.response || new Response('<html>authorized</html>',{headers:{'Content-Type':'text/html'}});
  });
  return {response,calls};
}
test('fixed protected reads forward only caller bearer and fixed public key after the entry gate',async()=>{
  for(const route of ['dashboard-preview','dashboard-preview?check=1','dashboard-preview?action=access','dashboard-role-access']){
    const role=route==='dashboard-role-access';
    const req=request(route,{...(role?{method:'POST',body:'{}'}:{}),headers:{Cookie:'secret-cookie',apikey:'forged-key','X-Forwarded-For':'198.51.100.1','x-portal-proxy-key':'forged-proof','x-portal-client-ip':'198.51.100.2'}});
    const h=await run(req,{response:role||route.includes('?')?json({canView:true}):undefined});
    assert.equal(h.response.status,200);assert.equal(h.calls.length,2);
    const {url,init}=h.calls[1],headers=new Headers(init.headers);
    assert.equal(url,role?'https://gmfyfzsxpxmaqtuuwgxb.supabase.co/rest/v1/rpc/dashboard_role_access':'https://gmfyfzsxpxmaqtuuwgxb.supabase.co/functions/v1/owner-admin-preview'+(route.split('?')[1]?'?'+route.split('?')[1]:''));
    assert.equal(init.method,role?'POST':'GET');assert.equal(init.body,role?'{}':undefined);
    assert.equal(init.redirect,'manual');assert.equal(init.cache,'no-store');
    assert.equal(headers.get('authorization'),'Bearer synthetic-user');assert.match(headers.get('apikey'),/^sb_publishable_/);
    for(const name of ['cookie','x-forwarded-for','x-portal-proxy-key','x-portal-client-ip','origin'])assert.equal(headers.get(name),null);
    assert.equal(h.response.headers.get('cache-control'),'private, no-store');await h.response.text();
  }
});
test('denied entry, cross-site origins, missing bearer and non-read routes never reach the protected upstream',async()=>{
  const denied=await run(request(),{allowed:false});assert.equal(denied.response.status,403);assert.equal(denied.calls.length,1);
  for(const [req,status] of [
    [request('dashboard-preview?action=grants'),400],
    [request('dashboard-preview?check=1&check=1'),400],
    [request('dashboard-preview?check=1&url=https://other.invalid'),400],
    [request('dashboard-preview',{method:'POST',body:'{}'}),405],
    [request('dashboard-preview',{method:'HEAD'}),405],
    [request('dashboard-preview',{headers:{Origin:'https://other.invalid'}}),403],
    [request('dashboard-preview',{headers:{Authorization:''}}),401],
    [request('dashboard-preview',{headers:{Authorization:'Bearer one,two'}}),401],
    [request('dashboard-role-access?x=1',{method:'POST',body:'{}'}),400],
    [request('dashboard-role-access'),405],
    [request('dashboard-role-access',{method:'POST',body:'{}',headers:{'Content-Type':'text/plain'}}),415],
    ...['[]','null','{"user":"other"}','{"x":"'+ 'x'.repeat(100)+'"}','{'].map(body=>[request('dashboard-role-access',{method:'POST',body}),400]),
  ]){
    const h=await run(req);assert.equal(h.response.status,status,req.url);assert.equal(h.calls.length,1,req.url);
  }
});
test('permissions and temporary errors retain their status without fallback, caching or private headers',async()=>{
  for(const status of [401,403,429,500,503]){
    const h=await run(request('dashboard-preview?check=1'),{response:json({ok:false,code:status===403?'preview_denied':'unavailable'},status,{'Set-Cookie':'private=1','Access-Control-Allow-Origin':'*'})});
    assert.equal(h.response.status,status);assert.equal(h.calls.length,2);
    assert.equal(h.response.headers.get('set-cookie'),null);assert.equal(h.response.headers.get('access-control-allow-origin'),null);
    assert.equal(h.response.headers.get('cache-control'),'private, no-store');await h.response.text();
  }
  for(const status of [401,403,302,500]){
    const h=await run(request(),{response:new Response('private diagnostic',{status,headers:{Location:'https://other.invalid'}})});
    assert.equal(h.response.status,[401,403].includes(status)?status:502);assert.equal(h.calls.length,2);
    assert.equal(h.response.headers.get('location'),null);assert.doesNotMatch(await h.response.text(),/private diagnostic|other.invalid/);
  }
});
test('gzip HTML bytes and encoding survive both response wrappers unchanged',async()=>{
  const text='<html>authorized '+ '内容'.repeat(1000)+'</html>',bytes=gzipSync(text);
  const h=await run(request(),{response:new Response(bytes,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Encoding':'gzip','Set-Cookie':'private=1'}})});
  assert.equal(h.response.headers.get('content-encoding'),'gzip');assert.equal(h.response.headers.get('set-cookie'),null);
  const actual=Buffer.from(await h.response.arrayBuffer());assert.deepEqual(actual,bytes);assert.equal(gunzipSync(actual).toString(),text);
});
test('client cancellation reaches upstream fetch and body; no follow-up protected request',async()=>{
  const controller=new AbortController();let forwarded;
  const h=await run(request('dashboard-preview',{signal:controller.signal}),{fetch:async(_url,init)=>{
    forwarded=init.signal;
    return new Response(new ReadableStream({start(stream){init.signal.addEventListener('abort',()=>stream.error(init.signal.reason),{once:true});}}),{headers:{'Content-Type':'text/html'}});
  }});
  const body=h.response.text();controller.abort();await assert.rejects(body);assert.equal(forwarded.aborted,true);assert.equal(h.calls.length,2);
  const stopped=new AbortController();stopped.abort();const before=await run(request('dashboard-preview',{signal:stopped.signal}));
  assert.equal(before.response.status,503);assert.equal(before.calls.length,1);
});
