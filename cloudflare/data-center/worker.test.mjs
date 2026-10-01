import test from 'node:test';
import assert from 'node:assert/strict';
import { servePublicStatic as serve } from './worker.mjs';
const host = 'https://data-center.workdesk-hub.workers.dev';
const site = '/hensem-data-center/';
const request = (path, init) => new Request(host + path, init);

test('root redirects within the neutral site and drops the query', async () => {
  const r = await serve(request('/?token=private'), () => assert.fail('unexpected upstream'));
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), site);
});
test('mutations and unrelated or encoded paths never reach upstream', async () => {
  for (const path of ['/api/accounts', '//evil.example/file', site+'%2f..%2fsecret', site+'%252fsecret']) {
    assert.equal((await serve(request(path), () => assert.fail('unexpected upstream'))).status, 404);
  }
  assert.equal((await serve(request(site, {method:'POST', body:'private'}), () => assert.fail('unexpected upstream'))).status,405);
});
test('only a fixed public request is sent; response cookies are dropped', async () => {
  const r = await serve(request(site+'?token=private', {headers:{Authorization:'Bearer private',Cookie:'private=1','X-Client-Info':'private',Referer:'https://private.example'}}), async (url, options) => {
    assert.equal(url, 'https://adrianus898989.github.io'+site);
    assert.deepEqual(Object.keys(options.headers).sort(), ['Accept','Cache-Control']);
    assert.equal(options.redirect,'manual');
    return new Response('<html>public</html>', {headers:{'Content-Type':'text/html','Set-Cookie':'bad=1','Cache-Control':'max-age=600'}});
  });
  assert.equal(r.headers.get('set-cookie'),null);
  assert.equal(r.headers.get('cache-control'),'no-store');
  assert.equal(await r.text(),'<html>public</html>');
});
test('upstream redirects are pinned and rewritten to the same site', async () => {
  for (const target of ['https://evil.example/x','//evil.example/x','/another-project/']) {
    assert.equal((await serve(request(site), async () => new Response(null,{status:302,headers:{Location:target}}))).status,502);
  }
  const r=await serve(request(site),async()=>new Response(null,{status:301,headers:{Location:site+'index.html?token=private'}}));
  assert.equal(r.headers.get('location'),site+'index.html');
});
test('hash assets cache successfully but HTML and errors do not', async () => {
  const path=site+'_next/static/chunks/app/page-4d7a3cfeb00ad3aa.js';
  const r=await serve(request(path),async(_,options)=>{assert.equal(options.cache,'no-store');return new Response('public')});
  assert.match(r.headers.get('cache-control'),/immutable/);
  const e=await serve(request(path),async()=>new Response('missing',{status:404}));
  assert.equal(e.headers.get('cache-control'),'no-store');
  const html=await serve(request(path),async()=>new Response('<html/>',{headers:{'Content-Type':'text/html'}}));
  assert.equal(html.headers.get('cache-control'),'no-store');
});
test('HEAD preserves method, has no body; fetch errors fail closed', async () => {
  const r=await serve(request(site,{method:'HEAD'}),async(_,options)=>{assert.equal(options.method,'HEAD');return new Response(null,{headers:{'Content-Type':'text/html'}})});
  assert.equal(await r.text(),'');
  assert.equal((await serve(request(site),async()=>{throw new Error('private detail')})).status,502);
});
