// Client boundary tests use fake auth/network only.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const compiled=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/adminLiveBridge.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const base={action:'aggregate',view:'full',platformId:'11111111-1111-4111-8111-111111111111',startAt:'2026-09-20T00:00:00.000Z',endAt:'2026-09-25T00:00:00.000Z',direction:'charge',status:'all',durationVersion:2};
function load(reply={ok:true,json:async()=>({durationVersion:2,summary:[],groups:{latency:[]}})}){
 const mod={exports:{}},calls=[],auth=[];vm.runInNewContext(compiled,{module:mod,exports:mod.exports,URL,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://offline.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'offline-public-key'}},require:name=>name==='./dashboardAuthClient'?{ensureDashboardSession:async s=>{auth.push(s);return {...s,access_token:'fresh-offline'}}}:{},fetch:async(url,init)=>{calls.push({url,init});return reply}});return {api:mod.exports,calls,auth};
}
const q=extra=>({...base,...extra});
const d=extra=>q({view:'drilldown',kind:'latency',...extra});
const session={user:{id:'offline-user'},access_token:'old-offline'};
test('version two fixed buckets and independent integer-second ranges retain the full request',()=>{
 const h=load();const samples=[q({}),q({durationRange:{minSeconds:120,maxSeconds:180}}),d({durationRange:{minSeconds:120,maxSeconds:180}}),d({durationRange:{minSeconds:null,maxSeconds:0}}),d({durationRange:{minSeconds:0}}),d({durationRange:{maxSeconds:315360000}})];
 for(let bucket=0;bucket<12;bucket++)samples.push(d({bucket,cumulative:false}));
 for(let bucket=0;bucket<11;bucket++)samples.push(d({bucket,cumulative:true}));
 for(const sample of samples)assert.equal(JSON.stringify(h.api.validateAdminLiveRequest(sample)),JSON.stringify(sample));
});
test('invalid versions, contexts, mixed segments and unsafe ranges reject before any auth or network',async()=>{
 const h=load(),bad=[];
 for(const durationVersion of [1,3,'2',null,false])bad.push(q({durationVersion}));
 for(const durationRange of [null,[],{},'2-3',{minSeconds:null,maxSeconds:null},{minSeconds:180,maxSeconds:120},{minSeconds:120,maxSeconds:120},{minSeconds:-1,maxSeconds:180},{minSeconds:120.1,maxSeconds:180},{maxSeconds:'180'},{maxSeconds:Infinity},{maxSeconds:NaN},{maxSeconds:315360001},{maxSeconds:180,hidden:'x'}])bad.push(q({durationRange}));
 bad.push(q({action:'details'}),q({view:'providers'}),d({kind:'hourly',hour:1}),d({bucket:12}),d({bucket:11,cumulative:true}),d({durationRange:{maxSeconds:180},bucket:0}),d({durationRange:{maxSeconds:180},cumulative:false}),d({durationRange:{maxSeconds:180},hour:1}));
 for(const request of bad)await assert.rejects(h.api.adminLiveRequest(session,request),undefined,JSON.stringify(request));
 assert.equal(h.auth.length,0);assert.equal(h.calls.length,0);
});
test('old callers keep the legacy bucket limit and cannot silently request custom precision',()=>{
 const h=load();const {durationVersion,...old}=base;
 for(const bucket of [0,9])assert.doesNotThrow(()=>h.api.validateAdminLiveRequest({...old,view:'drilldown',kind:'latency',bucket}));
 assert.throws(()=>h.api.validateAdminLiveRequest({...old,view:'drilldown',kind:'latency',bucket:10}));
 assert.throws(()=>h.api.validateAdminLiveRequest({...old,durationRange:{maxSeconds:180}}));
});
test('owner RPC and assigned-role gateway forward precision and range without dropping exact filters',async()=>{
 const h=load(),request=d({durationRange:{minSeconds:120,maxSeconds:180},providers:['ExamplePay'],currency:'INR',memberId:'EXAMPLE',amountMin:200,amountMax:500});
 await h.api.adminLiveRequest(session,request);assert(h.calls[0].url.endsWith('/dashboard_admin_live_drilldown'));assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_request:request});
 await h.api.adminLiveRequest(session,request,undefined,{assigned:true,page:'latency'});assert(h.calls[1].url.endsWith('/dashboard_admin_execute'));assert.deepEqual(JSON.parse(h.calls[1].init.body),{p_page:'latency',p_request:request});
 await h.api.adminLiveRequest(session,q({durationRange:{maxSeconds:180}}));assert(h.calls[2].url.endsWith('/dashboard_admin_live_query'));
});
test('an old backend fails clearly and never retries with misleading legacy buckets',async()=>{
 const h=load({ok:false,status:400,json:async()=>({message:'invalid_request'})});
 await assert.rejects(h.api.adminLiveRequest(session,q({})),/到账时效统计接口尚未更新/);assert.equal(h.calls.length,1);
 const denied=load({ok:false,status:403,json:async()=>({message:'permission_denied'})});
 await assert.rejects(denied.api.adminLiveRequest(session,q({})),/角色没有此页面或操作权限/);assert.equal(denied.calls.length,1);
});
