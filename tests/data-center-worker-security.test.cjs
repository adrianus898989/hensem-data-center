const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const worker=()=>import(path.join(__dirname,'../cloudflare/data-center/worker.mjs'));
function headers(response){assert.equal(response.headers.get('content-security-policy'),"frame-ancestors 'none'");assert.equal(response.headers.get('x-frame-options'),'DENY');assert.equal(response.headers.get('permissions-policy'),'camera=(), microphone=(), geolocation=()');assert.equal(response.headers.get('strict-transport-security'),'max-age=31536000');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('x-content-type-options'),'nosniff')}
const url='https://data-center.workdesk-hub.workers.dev/hensem-data-center/';
test('dedicated entry protects actual HTTP documents without adding directives that block srcdoc inline scripts',async()=>{
 const {serve}=await worker();const calls=[];const response=await serve(new Request(url+'?session=synthetic-query',{headers:{Authorization:'Bearer synthetic-token',Cookie:'synthetic-cookie'}}),async(...args)=>{calls.push(args);return new Response('<html><iframe sandbox="allow-scripts" srcdoc="test"></iframe></html>',{headers:{'Content-Type':'text/html','Set-Cookie':'untrusted=1','Content-Security-Policy':"default-src 'none'"}})});
 headers(response);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('set-cookie'),null);assert.doesNotMatch(response.headers.get('content-security-policy'),/default-src|script-src|frame-src/);assert.equal(calls[0][0],'https://adrianus898989.github.io/hensem-data-center/');assert.deepEqual(calls[0][1].headers,{Accept:'*/*','Cache-Control':'no-cache'});assert.equal(calls[0][1].redirect,'manual');assert.equal(calls[0][1].cache,'no-store');
});
test('all redirects, method errors, path rejections and upstream failures carry the same protections',async()=>{
 const {serve}=await worker();let callCount=0;const fetcher=async()=>{callCount++;throw Error('Synthetic upstream failure')};
 for(const [request,status] of [[new Request('https://data-center.workdesk-hub.workers.dev/'),302],[new Request(url,{method:'POST'}),405],[new Request('https://data-center.workdesk-hub.workers.dev/private'),404],[new Request(url+'%2fhidden'),404],[new Request(url),502]]){const response=await serve(request,fetcher);headers(response);assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store')}
 assert.equal(callCount,1);
 for(const location of ['https://untrusted.invalid/hensem-data-center/','https://adrianus898989.github.io/other-project/']){const response=await serve(new Request(url),async()=>new Response(null,{status:302,headers:{Location:location}}));headers(response);assert.equal(response.status,502);assert.equal(response.headers.get('location'),null)}
 const response=await serve(new Request(url+'folder'),async()=>new Response(null,{status:302,headers:{Location:'./folder/'}}));headers(response);assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/hensem-data-center/folder/');
});
test('only successful hash assets are immutable, while HEAD and HTML errors remain correct',async()=>{
 const {serve}=await worker();const asset=url+'_next/static/chunks/app/page-abcdef123456.js';
 const good=await serve(new Request(asset),async()=>new Response('synthetic script',{headers:{'Content-Type':'application/javascript','ETag':'synthetic-etag'}}));headers(good);assert.equal(good.headers.get('cache-control'),'public, max-age=31536000, immutable');assert.equal(good.headers.get('etag'),'synthetic-etag');
 for(const [status,type] of [[404,'application/javascript'],[200,'text/html']]){const response=await serve(new Request(asset),async()=>new Response('error',{status,headers:{'Content-Type':type}}));headers(response);assert.equal(response.headers.get('cache-control'),'no-store')}
 const head=await serve(new Request(url,{method:'HEAD'}),async()=>new Response('body',{headers:{'Content-Type':'text/html'}}));headers(head);assert.equal(await head.text(),'');
});
