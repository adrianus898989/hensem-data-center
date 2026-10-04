// Exercise the actual native aggregate read/merge path with synthetic responses.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
require('../admin-preview/live-provider-aliases.js');
require('../admin-preview/live-report-data.js');
const api=require('../admin-preview/live-provider-summary.js');
const source=fs.readFileSync(require.resolve('../admin-preview/live-data.js'),'utf8');
const counts=source.slice(source.indexOf(' const countKeys='),source.indexOf(' const amountBands='));
const start=source.indexOf(' function mergeParts('),read=source.slice(start,source.indexOf(' // Read deeper overview sections',start));
const native={id:'5e952cbb-e42f-d6b1-a24a-a0d42d165df9',name:'91CLUB',source:'ar',country:'印度',currency:'INR'};
const raw=(n=1,amount=100,extra={})=>({provider:'ExamplePay',direction:'charge',currency:'INR',all_count:n,all_amount:amount,success_count:n,success_amount:amount,created_success_count:n,pending_count:0,pending_amount:0,failed_count:0,failed_amount:0,rejected_count:0,rejected_amount:0,unknown_count:0,unknown_amount:0,missing_amount_count:0,...extra});
const rate=(extra={})=>({country:'印度',provider:'ExamplePay',scopeType:'country',collectFee:'4%',...extra});
const part=(rows,platform=native)=>({platform:{...platform},summary:[{...raw(rows.reduce((n,r)=>n+r.success_count,0),rows.reduce((n,r)=>n+(r.success_amount||0),0)),provider:undefined}],groups:{provider:rows},total:rows.reduce((n,r)=>n+r.all_count,0)});
function harness(handler,platform=native){
 const c={Date,console,L:{serial:1,catalog:platform?[platform]:[],queryRetrying:false},state:{page:'merchants'},isSuccessAnalysis:()=>false,providerDirection:()=>null,isFlowPage:()=>false,orderSource:p=>String(p?.source||'').toLowerCase().replaceAll('_',''),displayIdentity:p=>p};
 c.window=c;const calls=[];c.hensemLiveRequest=async q=>{calls.push({...q});return handler(q,calls.length)};
 vm.runInNewContext(counts+read+';globalThis.engine={mergeParts,readAggregate,plus,combine};',c);
 return {...c.engine,c,calls};
}
const request={action:'aggregate',view:'providers',platformId:native.id,startAt:'2026-10-02T18:30:00.000Z',endAt:'2026-10-03T18:30:00.000Z',direction:'charge',status:'all',currency:'INR',offset:0,limit:20};
const rows=result=>result.groups.provider;
const facts=(r,rates=[rate()])=>api.currentReferenceFeeFacts(r,rates,'印度');
const reason=(r,key)=>assert.ok(r.reasons.some(x=>x.reason===key),JSON.stringify(r.reasons));
const plain=value=>JSON.parse(JSON.stringify(value));
function platformFacts(engine,result,rates){
 const p=result.platform,identity={platformId:p.id,platform:p.name,source:p.source,country:p.country};
 const dimensions=api.overviewDimensions({orders:rows(result).map(r=>({...r,...identity})),summaries:result.summary.map(r=>({...r,...identity})),rates,country:'印度',key:'platform',plus:engine.plus,combine:engine.combine});
 return facts(dimensions[0],rates);
}

test('actual four-hour native reads retain leaf identity and platform-specific pricing through merchant dimensions',async()=>{
 const originals=[],engine=harness((q,n)=>{const result=part([raw(n,n*100)]);originals.push(result);return result}),rates=[rate(),rate({scopeType:'platform',platform:'91CLUB',collectFee:'5%'})];
 const result=await engine.readAggregate(request,1);assert.equal(engine.calls.length,6);
 assert.equal(platformFacts(engine,result,rates).amount,105);assert.equal(platformFacts(engine,result,rates).matchedCount,21);assert.equal(platformFacts(engine,result,rates).complete,true);
 assert.equal(rows(result)[0].items.length,6);for(const child of rows(result)[0].items){assert.equal(child.platformId,native.id);assert.equal(child.platform,'91CLUB');assert.equal(child.nativeFeeIdentityVerified,true);}
 for(const original of originals){assert.equal(original.groups.provider[0].platformId,undefined);assert.equal(original.groups.provider[0].nativeFeeIdentityVerified,undefined);}
 assert.equal(result._parts[0].groups.provider[0],originals[0].groups.provider[0]);
 const cached=await engine.readAggregate(request,1,true);assert.equal(engine.calls.length,6);assert.equal(platformFacts(engine,cached,rates).amount,105);
});
test('nested original items and fee_items inherit only their verified native response without changing financial facts',()=>{
 const child=raw(2,200,{fee_low_count:2,fee_low_amount:200,fee_version_state:'complete',fee_version_matched_count:2,fee_version_unmatched_count:0,fee_version_estimated_amount:7.25});
 const nested=raw(2,200,{fee_items:[{...child,items:[child]}]}),original=part([nested]),before=structuredClone(original),engine=harness(()=>{}),result=engine.mergeParts([original],native);
 const deep=rows(result)[0].fee_items[0].items[0];assert.equal(deep.platformId,native.id);assert.equal(deep.nativeFeeIdentityVerified,true);assert.equal(facts(rows(result)[0]).amount,8);
 for(const key of Object.keys(child))assert.deepEqual(deep[key],child[key]);assert.equal(api.estimateFacts(deep,[rate()],'印度').amount,7.25);assert.deepEqual(original,before);
 assert.equal(result._parts[0],original);assert.equal(result.summary,original.summary);
});
test('separately verified native platforms retain their own exceptions when a provider row is combined',()=>{
 const alpha={...native,id:'alpha-native',name:'Alpha'},beta={...native,id:'beta-native',name:'Beta',source:'newar'},engine=harness(()=>{});
 const a=rows(engine.mergeParts([part([raw(1,100)],alpha)],alpha))[0],b=rows(engine.mergeParts([part([raw(2,200)],beta)],beta))[0];
 const aggregate=engine.combine([a,b],['provider','direction','currency'])[0],result=facts(aggregate,[rate({collectFee:'2%'}),rate({scopeType:'platform',platform:'Beta',collectFee:'5%'})]);
 assert.equal(result.amount,12);assert.equal(result.matchedCount,3);assert.equal(result.complete,true);assert.equal(a.platformId,'alpha-native');assert.equal(b.platformId,'beta-native');
});
test('missing or mismatched original catalog proof fails closed even if a child carries otherwise valid identity',()=>{
 const complete=raw(1,100,{platformId:native.id,platform:native.name,country:native.country,source:native.source}),engine=harness(()=>{});
 for(const outer of [undefined,{...native,id:'foreign-id'},{...native,country:'巴西'},{...native,source:'newar'},{...native,reportOnly:true},{...native,name:''}]){
  const r=rows(engine.mergeParts([part([complete])],outer))[0];assert.equal(r.nativeFeeIdentityVerified,false);assert.equal(facts(r).amount,null);reason(facts(r),'unknown_leaf_identity');
 }
 for(const inner of [{...native,id:'foreign-id'},{...native,country:'巴西'},{...native,source:'newar'},{...native,name:''}]){const r=rows(engine.mergeParts([part([raw()],inner)],native))[0];assert.equal(r.nativeFeeIdentityVerified,false);assert.equal(facts(r).amount,null);}
});
test('explicit foreign child fields are preserved and an invalid parent cannot be bypassed by valid descendants',()=>{
 const foreign=raw(1,100,{platformId:'foreign',platform:'Other',source:'newar',country:'印度'}),valid={...raw(),platformId:native.id,platform:native.name,source:native.source,country:native.country},engine=harness(()=>{});
 const original=part([raw(1,100,{items:[{...foreign,items:[valid]}]})]),result=engine.mergeParts([original],native),parent=rows(result)[0].items[0];
 for(const key of ['platformId','platform','source','country'])assert.equal(parent[key],foreign[key]);assert.equal(parent.nativeFeeIdentityVerified,false);assert.equal(parent.items[0].nativeFeeIdentityVerified,false);
 assert.equal(facts(rows(result)[0]).amount,null);reason(facts(rows(result)[0]),'unknown_leaf_identity');assert.equal(valid.nativeFeeIdentityVerified,undefined);
});
test('native source normalization permits underscore aliases but never rewrites explicit conflicting provenance',()=>{
 const engine=harness(()=>{}),p={...native,source:'new_ar'},outer={...p,source:'newar'},good=rows(engine.mergeParts([part([raw(1,100,{source:'NEW_AR'})],p)],outer))[0];
 assert.equal(good.nativeFeeIdentityVerified,true);assert.equal(good.source,'NEW_AR');assert.equal(facts(good).amount,4);
 const bad=rows(engine.mergeParts([part([raw(1,100,{source:'wg'})],p)],outer))[0];assert.equal(bad.source,'wg');assert.equal(bad.nativeFeeIdentityVerified,false);assert.equal(facts(bad).amount,null);
});
test('currency remains original and unknown or mixed native currency never borrows the catalog currency',()=>{
 const engine=harness(()=>{}),unknown=rows(engine.mergeParts([part([raw(1,100,{currency:null})])],native))[0];
 assert.equal(unknown.currency,null);assert.equal(unknown.nativeFeeIdentityVerified,true);assert.equal(facts(unknown).amount,null);reason(facts(unknown),'unknown_currency');
 const mixed=rows(engine.mergeParts([part([raw(2,200,{items:[raw(),raw(1,100,{currency:'USD'})]})])],native))[0];assert.equal(facts(mixed).amount,null);reason(facts(mixed),'mixed_currency');
});
test('verified marker cannot replace strict leaf validation and missing marker preserves historical behavior',()=>{
 const valid={...raw(),platformId:native.id,platform:native.name,country:native.country,source:native.source};assert.equal(facts(valid).amount,4);
 for(const extra of [{platformId:null},{platform:''},{country:'巴西'},{currency:null},{source:''}]){const result=facts({...valid,...extra,nativeFeeIdentityVerified:true});assert.equal(result.amount,null);assert.equal(result.complete,false);}
 assert.equal(facts({...valid,nativeFeeIdentityVerified:false}).amount,null);
});
test('a read whose native catalog entry disappears cannot reuse response identity as authorization proof',async()=>{
 const engine=harness(()=>part([raw(1,100,{platformId:native.id,platform:native.name,source:native.source,country:native.country})]),null),result=await engine.readAggregate({...request,endAt:'2026-10-02T19:00:00.000Z'},1);
 assert.equal(rows(result)[0].nativeFeeIdentityVerified,false);assert.equal(facts(rows(result)[0]).amount,null);assert.equal(plain(result._parts[0].groups.provider[0]).nativeFeeIdentityVerified,undefined);
});
