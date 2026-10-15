const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../admin-preview/live-prepared-aggregates.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const P={id:'synthetic-native-id',source:'kb',sourceName:'YASH.BET',country:'印度',scopeGroup:'IN',timezone:'Asia/Kolkata',currency:'INR'};
const NOW=Date.parse('2026-10-15T12:00:00Z');
const q=(patch={})=>({action:'aggregate',view:'providers',platformId:P.id,startAt:'2026-10-13T18:30:00.000001Z',endAt:'2026-10-14T18:30:00.000001Z',direction:'all',status:'all',currency:'INR',providers:['3TPay','T3Pay'],...patch});
function item(request,patch={}){
 const groups=Object.fromEntries(['provider','daily','hourly','amount','matrix','latency','pending_age','amount_range','matrix_range','provider_daily'].map(key=>[key,[]]));
 const metric={direction:'charge',currency:'INR',all_count:2,all_amount:'9007199254740993.01',success_count:1,success_amount:null,pending_count:1};groups.provider=[{...metric,provider:'3TPay'}];
 return {request:clone(request),status:'ready',publication:{id:'synthetic-publication',generation:5,computedAt:'2026-10-15T11:59:00Z',expiresAt:'2026-10-15T12:05:00Z',calculationComplete:true,sourceComplete:false,cutoff:'2026-10-15T11:58:00Z'},result:{version:1,platform:clone(P),startAt:request.startAt,endAt:request.endAt,...(request.successStartAt?{successStartAt:request.successStartAt,successEndAt:request.successEndAt,successBasis:request.successBasis}:{}),summary:[metric],groups,rows:[],basis:'mixed_created_success',capabilities:{successTime:{basis:'source_updated_at'}},coverage:{sourceComplete:false,complete:false},...(request.view==='drilldown'?{complete:true,hasMore:false}:{}),...(request.durationVersion?{durationVersion:request.durationVersion}:{})},...patch};
}
function envelope(requests){return {version:1,items:requests.map(request=>item(request))};}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function tick(){await new Promise(resolve=>setImmediate(resolve));}
function harness(options={}){
 const calls=[];let scope='account-a|role-v1|overview',platform=clone(P);
 const adapter=create({context:()=>scope,platform:()=>platform,now:()=>NOW,request:async(payload,control)=>{calls.push({payload,control});return options.handler?options.handler(payload,control,calls.length):envelope(payload.requests);},...options});
 return {adapter,calls,setScope:value=>{scope=value;},setPlatform:value=>{platform=value;}};
}
const code=status=>error=>error.code==='PREPARED_AGGREGATE_'+status.toUpperCase();

test('prepared transport preserves exact native DTO, decimal/nulls, source basis and collection uncertainty',async()=>{
 const h=harness(),request=q(),before=clone(request),result=await h.adapter.read(request);
 assert.deepEqual(request,before);assert.deepEqual(h.calls[0].payload,{action:'aggregatePrepared',requests:[before]});
 assert.equal(result.summary[0].all_amount,'9007199254740993.01');assert.equal(result.summary[0].success_amount,null);assert.equal(result.capabilities.successTime.basis,'source_updated_at');assert.equal(result.coverage.complete,false);assert.equal(result._preparedPublication.sourceComplete,false);assert.equal(result.startAt,before.startAt);assert.equal(result.endAt,before.endAt);assert.notEqual(result.endAt,result._preparedPublication.cutoff);
});
test('all aggregate views and independent time fields travel as exact queries without frontend recombination',async()=>{
 const h=harness();const requests=[q({view:'full',durationVersion:2,amountBands:[{min:0,max:100}]}),q({view:'drilldown',kind:'latency',durationVersion:2,durationRange:{minSeconds:120,maxSeconds:180}}),q({view:'drilldown',kind:'amount',bucket:'100-500'}),q({successStartAt:'2026-10-01T00:00:00Z',successEndAt:'2026-10-02T00:00:00Z',successBasis:'source_updated'})];
 const results=await Promise.all(requests.map(request=>h.adapter.read(request)));assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].payload.requests,requests);assert.equal(results.length,4);
});
test('synchronous requests coalesce at most 50 and at most two batches run concurrently',async()=>{
 const flights=[];let active=0,peak=0;const h=harness({handler:async payload=>{active++;peak=Math.max(peak,active);const d=deferred();flights.push({d,payload});try{return await d.promise;}finally{active--;}}});
 const reads=Array.from({length:121},(_,n)=>h.adapter.read(q({providers:['Provider '+n]})));await tick();assert.equal(flights.length,2);assert.deepEqual(flights.map(x=>x.payload.requests.length),[50,50]);
 flights[0].d.resolve(envelope(flights[0].payload.requests));await tick();assert.equal(flights.length,3);assert.equal(flights[2].payload.requests.length,21);assert.equal(peak,2);for(const flight of flights.slice(1))flight.d.resolve(envelope(flight.payload.requests));assert.equal((await Promise.all(reads)).length,121);
});
test('in-flight stable object keys deduplicate but completed results never become another cache',async()=>{
 const flight=deferred();const h=harness({handler:(payload,control,n)=>n===1?flight.promise:envelope(payload.requests)});const request=q(),reordered=Object.fromEntries(Object.entries(request).reverse());
 const a=h.adapter.read(request),b=h.adapter.read(reordered);await tick();assert.equal(h.calls[0].payload.requests.length,1);flight.resolve(envelope(h.calls[0].payload.requests));const [ra,rb]=await Promise.all([a,b]);ra.summary[0].all_amount='changed';assert.equal(rb.summary[0].all_amount,'9007199254740993.01');await h.adapter.read(request);assert.equal(h.calls.length,2);
});
test('input mutations after enqueue cannot change the dispatched scope',async()=>{
 const h=harness(),request=q(),original=clone(request),promise=h.adapter.read(request);request.providers.push('other');request.endAt='2026-10-20T00:00:00Z';const result=await promise;assert.deepEqual(h.calls[0].payload.requests,[original]);assert.equal(result.endAt,original.endAt);
});
test('response items match exact requests independent of response order',async()=>{
 const h=harness({handler:payload=>({version:1,items:payload.requests.map((request,i)=>{const value=item(request);value.result.summary[0].all_count=i;return value;}).reverse()})});const values=await Promise.all([h.adapter.read(q()),h.adapter.read(q({providers:['other']}))]);assert.deepEqual(values.map(x=>x.summary[0].all_count),[0,1]);
});
test('mixed ready/missing/stale/building/unsupported remain explicit without retries or source fallback',async()=>{
 const states=['ready','missing','stale','building','unsupported'],h=harness({handler:payload=>({version:1,items:payload.requests.map((request,i)=>item(request,states[i]==='ready'?{}:{status:states[i],result:null,publication:null}))})});
 const results=await Promise.allSettled(states.map((status,i)=>h.adapter.read(q({providers:['p'+i]}))));assert.equal(results[0].status,'fulfilled');for(let i=1;i<states.length;i++)assert.equal(results[i].reason.status,states[i]);assert.equal(h.calls.length,1);assert.deepEqual(h.calls.map(c=>c.payload.action),['aggregatePrepared']);
});
test('expired publications and incomplete calculations cannot be returned as ready',async()=>{
 for(const [status,change]of [['stale',v=>{v.publication.expiresAt='2026-10-15T11:59:59Z';}],['invalid',v=>{v.publication.calculationComplete=false;}],['invalid',v=>{v.result.coverage.calculationComplete=false;}],['invalid',v=>{v.result.partial=true;}],['invalid',v=>{v.result.rows=[{order_number:'synthetic-order'}];}]]){
  const h=harness({handler:payload=>{const response=envelope(payload.requests);change(response.items[0]);return response;}});await assert.rejects(h.adapter.read(q()),code(status));assert.equal(h.calls.length,1);
 }
});
test('native source identity, scope and exact microseconds are never relabelled',async()=>{
 for(const key of ['id','source','sourceName','country','scopeGroup','timezone','currency','startAt','endAt']){
  const h=harness({handler:payload=>{const response=envelope(payload.requests),r=response.items[0].result;if(key==='startAt'||key==='endAt')r[key]=r[key].replace('000001','000002');else r.platform[key]='different';return response;}});await assert.rejects(h.adapter.read(q()),code('invalid'));
 }
 const h=harness({handler:payload=>{const response=envelope(payload.requests);response.items[0].result.startAt='2026-10-14T00:00:00.000001+05:30';return response;}});assert.equal((await h.adapter.read(q())).startAt,'2026-10-14T00:00:00.000001+05:30');
});
test('wrong filters/windows/basis/array order and missing/duplicate/extra items are rejected',async()=>{
 const changes=[r=>{r.items[0].request.providers.reverse();},r=>{r.items[0].request.direction='withdraw';},r=>{r.items[0].request.endAt='2026-10-15T00:00:00Z';},r=>{r.items[0].request.basis='ingested';},r=>{r.items.pop();},r=>{r.items.push(clone(r.items[0]));},r=>{r.items[1]=clone(r.items[0]);}];
 for(const change of changes){const h=harness({handler:payload=>{const response=envelope(payload.requests);change(response);return response;}});const results=await Promise.allSettled([h.adapter.read(q()),h.adapter.read(q({providers:['other']}))]);assert.ok(results.every(r=>r.status==='rejected'&&r.reason.code==='PREPARED_AGGREGATE_INVALID'));}
});
test('each independent success clock field participates in exact publication matching',async()=>{
 const request=q({successStartAt:'2026-10-01T00:00:00Z',successEndAt:'2026-10-02T00:00:00Z',successBasis:'success'});
 for(const [field,value]of [['successStartAt','2026-10-01T00:00:01Z'],['successEndAt','2026-10-02T00:00:01Z'],['successBasis','source_updated']]){
  const h=harness({handler:payload=>{const response=envelope(payload.requests);response.items[0].request[field]=value;return response;}});await assert.rejects(h.adapter.read(request),code('invalid'));
 }
 const h=harness();await Promise.all([h.adapter.read(request),h.adapter.read({...request,successBasis:'source_updated'}),h.adapter.read(q())]);assert.equal(h.calls[0].payload.requests.length,3);
});
test('dual-window DTO must echo both independent success endpoints and selected source basis',async()=>{
 const request=q({successStartAt:'2026-10-01T00:00:00.000001Z',successEndAt:'2026-10-02T00:00:00.000001Z',successBasis:'source_updated'});
 for(const change of [r=>{delete r.successStartAt;},r=>{delete r.successEndAt;},r=>{delete r.successBasis;},r=>{r.successStartAt=r.startAt;},r=>{r.successEndAt=r.endAt;},r=>{r.successBasis='success';},r=>{r.successEndAt=r.successEndAt.replace('000001','000002');}]){
  const h=harness({handler:payload=>{const response=envelope(payload.requests);change(response.items[0].result);return response;}});await assert.rejects(h.adapter.read(request),code('invalid'));
 }
 for(const patch of [{successEndAt:undefined},{successStartAt:'invalid'},{successBasis:'ingest'},{successEndAt:request.successStartAt}]){const h=harness();await assert.rejects(h.adapter.read({...request,...patch}),code('invalid'));assert.equal(h.calls.length,0);}
});
test('a provider-only response cannot masquerade as chart or drilldown dimensions',async()=>{
 for(const request of [q({view:'full'}),q({view:'full',amountBands:[100]}),q({view:'drilldown',kind:'latency'}),q({view:'drilldown',kind:'amount',bucket:2})]){
  const h=harness({handler:payload=>{const response=envelope(payload.requests);response.items[0].result.groups={provider:[]};return response;}});await assert.rejects(h.adapter.read(request),code('invalid'));
 }
 for(const change of [r=>{r.durationVersion=1;},r=>{r.complete=false;},r=>{r.hasMore=true;}]){const h=harness({handler:payload=>{const response=envelope(payload.requests);change(response.items[0].result);return response;}});await assert.rejects(h.adapter.read(q({view:'drilldown',kind:'latency',durationVersion:2})),code('invalid'));}
});
test('individual waiter cancellation preserves a shared authorized request for the other consumer',async()=>{
 const d=deferred(),h=harness({handler:()=>d.promise}),controller=new AbortController(),a=h.adapter.read(q(),{signal:controller.signal}),b=h.adapter.read(q());const rejected=assert.rejects(a,code('cancelled'));await tick();controller.abort();await rejected;assert.equal(h.calls[0].control.signal.aborted,false);d.resolve(envelope(h.calls[0].payload.requests));assert.equal((await b).summary[0].all_count,2);
});
test('queued cancellation never dispatches and all active cancellation aborts the batch',async()=>{
 const d=deferred(),h=harness({maxBatchSize:1,maxConcurrent:1,handler:()=>d.promise}),first=new AbortController(),second=new AbortController();const a=h.adapter.read(q(),{signal:first.signal}),b=h.adapter.read(q({providers:['other']}),{signal:second.signal}),checked=Promise.all([assert.rejects(a,code('cancelled')),assert.rejects(b,code('cancelled'))]);await tick();second.abort();first.abort();await checked;assert.equal(h.calls.length,1);assert.equal(h.calls[0].control.signal.aborted,true);d.resolve(envelope(h.calls[0].payload.requests));await tick();assert.equal(h.calls.length,1);
});
test('clear aborts old work and permits new reads even when an old transport ignores abort',async()=>{
 const d=deferred(),h=harness({maxConcurrent:1,handler:(payload,control,n)=>n===1?d.promise:envelope(payload.requests)}),a=h.adapter.read(q()),check=assert.rejects(a,code('cancelled'));await tick();h.adapter.clear();await check;assert.equal(h.calls[0].control.signal.aborted,true);const result=await h.adapter.read(q());assert.equal(result.summary[0].all_count,2);d.resolve(envelope(h.calls[0].payload.requests));await tick();assert.equal(h.calls.length,2);
});
test('account/permission context changes reject old responses and never reuse old in-flight work',async()=>{
 const d=deferred(),h=harness({handler:(payload,control,n)=>n===1?d.promise:envelope(payload.requests)}),a=h.adapter.read(q()),check=assert.rejects(a,code('cancelled'));await tick();h.setScope('account-b|role-v2|overview');const b=h.adapter.read(q());await check;assert.equal(h.calls[0].control.signal.aborted,true);await b;d.resolve(envelope(h.calls[0].payload.requests));await tick();assert.equal(h.calls.length,2);
});
test('logout, changed native catalog and late page responses cannot deliver stale results',async()=>{
 for(const kind of ['logout','catalog','page']){
  let current=true;const d=deferred(),h=harness({handler:()=>d.promise}),a=h.adapter.read(q(),{isCurrent:()=>current}),check=assert.rejects(a,code('cancelled'));await tick();if(kind==='logout')h.setScope('');else if(kind==='catalog')h.setPlatform({...P,sourceName:'Changed Native'});else current=false;d.resolve(envelope(h.calls[0].payload.requests));await check;
 }
});
test('permission denial is propagated unchanged with no retries or implicit live reads',async()=>{
 const denied=Object.assign(new Error('denied'),{code:'ADMIN_LIVE_PERMISSION_DENIED'}),h=harness({handler:()=>{throw denied;}});await assert.rejects(h.adapter.read(q()),error=>error===denied);assert.equal(h.calls.length,1);
});
test('unsupported detail/identity reads, invalid queries and unknown native catalog never dispatch',async()=>{
 for(const request of [q({action:'analysisOrders'}),q({orderNumber:'synthetic'}),q({view:'details'}),q({endAt:q().startAt}),q({startAt:'2026-02-30T00:00:00Z'}),q({providers:[undefined]}),q({value:NaN})]){const h=harness();await assert.rejects(h.adapter.read(request));assert.equal(h.calls.length,0);}
 const h=harness();h.setPlatform(null);await assert.rejects(h.adapter.read(q()),code('unsupported'));assert.equal(h.calls.length,0);
});
test('oversized publication responses are bounded and rejected',async()=>{
 const h=harness({maxResponseBytes:2048,handler:payload=>{const response=envelope(payload.requests);response.items[0].result.extra='界'.repeat(1000);return response;}});await assert.rejects(h.adapter.read(q()),code('invalid'));
});
