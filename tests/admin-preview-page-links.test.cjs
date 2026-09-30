// Synthetic routing and URL boundary checks; no login, network or real data.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript'),repo=path.resolve(__dirname,'..');
const compiled=ts.transpileModule(fs.readFileSync(path.join(repo,'src/lib/adminLiveBridge.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load(location={origin:'https://dashboard.invalid',pathname:'/hensem-data-center/',hash:''}){
 const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports,URL,window:{location},require:()=>({})});return module.exports;
}
const api=load();
function frame(location){
 const bridge=load(location),html=bridge.makeAdminLiveDocument('<!doctype html><html></html>','synthetic-channel');
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.equal(scripts.length,1);
 const context=vm.createContext({addEventListener(){},parent:{postMessage(){throw Error('URL creation must not request anything')}},setTimeout,clearTimeout});
 vm.runInContext('window=globalThis',context);vm.runInContext(scripts[0][1],context);return {context,html};
}
test('legacy preview bookmark and valid page tokens retain their intended routes',()=>{
 assert.equal(api.adminPreviewPageFromHash('#owner-admin-preview'),'overview');
 for(const page of ['overview','providers','provider_payout','provider_daily','workorder_operation_logs'])assert.equal(api.adminPreviewPageFromHash('#owner-admin-preview/'+page),page);
 for(const hash of ['',null,{},'#overview','#owner-admin-preview/','#owner-admin-preview//providers','#owner-admin-preview/providers?next=https://evil.invalid','#owner-admin-preview/%70roviders','#owner-admin-preview/PROVIDERS','#owner-admin-preview/../orders','#owner-admin-preview/__proto__','#owner-admin-preview/'+('a'.repeat(65))])assert.equal(api.adminPreviewPageFromHash(hash),null);
});
test('page links preserve the deployed application path and omit host query or authentication fragments',()=>{
 const location={origin:'https://dashboard.invalid',pathname:'/hensem-data-center/',search:'?token=synthetic-private-value',hash:'#access_token=synthetic-private-value'};
 assert.equal(api.adminPreviewPageUrl('provider_payout',location),'https://dashboard.invalid/hensem-data-center/#admin/provider_payout');
 assert.equal(api.adminPreviewPageUrl('orders',{origin:'http://localhost:5173',pathname:'/'}),'http://localhost:5173/#admin/orders');
 assert.equal(api.adminPreviewPageUrl('overview',{origin:'https://dashboard.invalid'}),'https://dashboard.invalid/#admin/overview');
});
test('URL creation rejects schemes, cross-site paths and malformed page arguments',()=>{
 for(const origin of ['javascript:alert(1)','data:text/html,test','file:///private/tmp/index.html','https://user:pass@dashboard.invalid','https://dashboard.invalid/foreign','null'])assert.throws(()=>api.adminPreviewPageUrl('providers',{origin,pathname:'/'}));
 for(const pathname of ['//evil.invalid/path','///evil.invalid','/\\evil.invalid','relative/path','/path?next=evil','/path#bad','/path\nnext'])assert.throws(()=>api.adminPreviewPageUrl('providers',{origin:'https://dashboard.invalid',pathname}));
 for(const page of ['https://evil.invalid','javascript:alert(1)','//evil.invalid','../orders','providers?next=evil','providers#other','providers\n','</script><script>alert(1)</script>',null,{},42])assert.equal(api.adminPreviewPageUrl(page,{origin:'https://dashboard.invalid',pathname:'/'}),'');
});
test('opaque iframe receives a fixed same-site URL builder and requested initial page without credentials',()=>{
 const f=frame({origin:'https://dashboard.invalid',pathname:'/hensem-data-center/',hash:'#owner-admin-preview/provider_payout',search:'?access_token=synthetic-do-not-copy'});
 assert.equal(f.context.hensemAdminInitialPage,'provider_payout');
 assert.equal(f.context.hensemAdminPageUrl('providers'),'https://dashboard.invalid/hensem-data-center/#admin/providers');
 for(const page of ['https://evil.invalid','//evil.invalid','</script>',{},null,'providers&other=1'])assert.equal(f.context.hensemAdminPageUrl(page),'');
 assert.doesNotMatch(f.html,/synthetic-do-not-copy|access_token|allow-popups|parent\.location/);
 assert.equal(frame({origin:'https://dashboard.invalid',pathname:'/',hash:'#owner-admin-preview/../../evil'}).context.hensemAdminInitialPage,'overview');
});
test('formal page hashes work alongside unchanged legacy bookmarks',()=>{
 assert.equal(api.adminPreviewPageFromHash('#admin'),'overview');
 for(const page of ['overview','providers','access','stuck'])assert.equal(api.adminPreviewPageFromHash('#admin/'+page),page);
 for(const hash of ['#admin/','#admin/../orders','#admin//access','#admin/https://evil.invalid','#admin/__proto__'])assert.equal(api.adminPreviewPageFromHash(hash),null);
 assert.equal(frame({origin:'https://dashboard.invalid',pathname:'/',hash:'#admin/stuck'}).context.hensemAdminInitialPage,'stuck');
});
