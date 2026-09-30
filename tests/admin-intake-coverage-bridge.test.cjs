// Synthetic requests only; no production sessions.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const compiled=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/adminLiveBridge.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const base={action:'intakeCoverage',operation:'rows',feedIds:['a'.repeat(32)],startAt:'2026-09-01',endAt:'2026-09-25'};
function load({status=200,body={complete:true,rows:[]},failure}={}){const mod={exports:{}},calls=[],auth=[];vm.runInNewContext(compiled,{module:mod,exports:mod.exports,URL,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://offline.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'offline'}},require:n=>n==='./dashboardAuthClient'?{ensureDashboardSession:async s=>{auth.push(s);return {...s,access_token:'fresh'}}}:{},fetch:async(url,init)=>{calls.push({url,init});if(failure)throw failure;return {ok:status>=200&&status<300,status,json:async()=>body}}});return {api:mod.exports,calls,auth}}
test('coverage supports a complete catalog and bounded pure-date feed batches',()=>{const h=load();for(const q of [{action:'intakeCoverage'}, {action:'intakeCoverage',operation:'catalog'},base,{...base,endAt:'2026-12-02'}])assert.doesNotThrow(()=>h.api.validateAdminLiveRequest(q));for(const q of [{...base,endAt:'2026-12-03'},{...base,startAt:'2026-02-30'},{...base,endAt:'2026-08-31'},{...base,feedIds:[]},{...base,feedIds:Array(9).fill('a'.repeat(32))},{...base,feedIds:['a'.repeat(32),'a'.repeat(32)]},{...base,feedIds:['unknown']},{...base,asOf:'2026-01-01'},{...base,country:'other'},{action:'intakeCoverage',operation:'catalog',startAt:base.startAt},{action:'syncHealth',feedIds:base.feedIds}])assert.throws(()=>h.api.validateAdminLiveRequest(q),JSON.stringify(q));});
test('coverage refreshes current auth and uses only the read-only coverage RPC',async()=>{const h=load();await h.api.adminLiveRequest({user:{id:'offline-user'},access_token:'old'},base);assert.equal(h.auth.length,1);assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_intake_coverage');assert.equal(h.calls[0].init.headers.Authorization,'Bearer fresh');assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_request:{operation:'rows',feedIds:base.feedIds,startAt:base.startAt,endAt:base.endAt}});assert.equal(h.calls[0].init.cache,'no-store');});

test('orderCatalog has the same strict no-filter validation as catalog',()=>{
 const h=load(),request={action:'intakeCoverage',operation:'orderCatalog'};
 assert.doesNotThrow(()=>h.api.validateAdminLiveRequest(request));
 for(const extra of [{feedIds:base.feedIds},{startAt:base.startAt},{endAt:base.endAt},{country:'印度'},{platformIds:[]},{providers:[]},{scope:{mode:'all'}},{asOf:'2026-09-29'},{limit:8}])
  assert.throws(()=>h.api.validateAdminLiveRequest({...request,...extra}),JSON.stringify(extra));
 for(const operation of ['ordersCatalog','OrderCatalog',null,[],{},1])
  assert.throws(()=>h.api.validateAdminLiveRequest({...request,operation}),JSON.stringify(operation));
});
test('orderCatalog refreshes auth and sends only the explicit operation to the read RPC',async()=>{
 const h=load(),request={action:'intakeCoverage',operation:'orderCatalog'};
 await h.api.adminLiveRequest({user:{id:'offline-user'},access_token:'old'},request);
 assert.equal(h.auth.length,1);assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_intake_coverage');
 assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_request:{operation:'orderCatalog'}});
 assert.equal(h.calls[0].init.headers.Authorization,'Bearer fresh');assert.equal(h.calls[0].init.cache,'no-store');
});
test('assigned roles keep orderCatalog behind the existing page permission gateway',async()=>{
 const h=load();await h.api.adminLiveRequest({user:{id:'offline-user'},access_token:'old'},
  {action:'intakeCoverage',operation:'orderCatalog'},undefined,{assigned:true,page:'provider_charge'});
 assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_execute');
 assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_page:'provider_charge',p_request:{action:'intakeCoverage',operation:'orderCatalog'}});
});
test('only the explicit old-backend operation rejection exposes the legacy catalog fallback signal',async()=>{
 const h=load({status:400,body:{code:'22023',message:'invalid_coverage_request'}});
 await assert.rejects(h.api.adminLiveRequest({user:{id:'offline-user'},access_token:'old'},
  {action:'intakeCoverage',operation:'orderCatalog'}),/^Error: 订单采集目录操作暂不支持$/);
 assert.equal(h.calls.length,1,'the bridge signals incompatibility; it does not start any automatic second query');
 const other=load({status:400,body:{code:'22023',message:'invalid_coverage_request'}});
 await assert.rejects(other.api.adminLiveRequest({user:{id:'offline-user'},access_token:'old'},
  {action:'intakeCoverage',operation:'catalog'}),/正式数据查询未完成/);
});
test('auth, permissions, timeouts and unrelated errors are not misreported as old-backend support gaps',async()=>{
 for(const [status,message,expected] of [
  [401,'invalid_coverage_request',/未获授权/],[403,'invalid_coverage_request',/未获授权/],
  [403,'role_page_denied',/当前角色没有/],[400,'scope_denied',/没有此范围/],
  [504,'statement timeout',/同步检查超时/],[500,'57014',/同步检查超时/],
  [400,'invalid_coverage_request_suffix',/正式数据查询未完成/],[500,'database_unavailable',/正式数据查询未完成/]]){
   const h=load({status,body:{message}});
   await assert.rejects(h.api.adminLiveRequest({user:{id:'offline-user'},access_token:'old'},
    {action:'intakeCoverage',operation:'orderCatalog'}),error=>{assert.match(error.message,expected);assert.doesNotMatch(error.message,/操作暂不支持/);return true;});
   assert.equal(h.calls.length,1);
 }
 const h=load({failure:new Error('connection failed')});
 await assert.rejects(h.api.adminLiveRequest({user:{id:'offline-user'},access_token:'old'},
  {action:'intakeCoverage',operation:'orderCatalog'}),/connection failed/);
});
