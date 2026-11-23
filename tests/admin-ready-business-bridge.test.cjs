// Real authenticated bridge, synthetic responses; no credentials or source data.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-ready-only-bridge.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {load,session,bridge,flush,request,probe}=new Function('require','__dirname',prefix+';return {load,session,bridge,flush,request,probe};')(require,__dirname);
const full={...request,view:'full',amountBands:{charge:[0,100,200,300,400,500,600,700,800,900,1000],withdraw:[0,100,200,300,400,500,600,700,800,900,1000]}};
const compact={...probe,responseProfile:'time-v1',requests:[full]};
const amountDay={action:'aggregate',view:'full',platformId:request.platformId,
 startAt:request.startAt,endAt:request.endAt,successBasis:'created',direction:'all',status:'all',currency:'INR',offset:0,limit:20,
 amountBands:full.amountBands};
const amountProbe={...probe,responseProfile:'amount-v1',requests:[amountDay]};
const amountPrior={...probe,requests:[{action:'aggregate',view:'providers',platformId:request.platformId,
 startAt:'2026-10-12T18:30:00.000Z',endAt:amountDay.startAt,successBasis:'created',direction:'all',status:'all',currency:'INR',offset:0,limit:20}]};
for(const assigned of [false,true])test('exact authorized ready pages use unchanged native requests on '+(assigned?'assigned':'owner')+' route',async()=>{
 const h=load();for(const page of ['providers','provider_payout','overview','merchants','teamops','teamcountries','teamplatforms'])await h.api.adminLiveRequest(session,probe,undefined,{assigned,page});
 for(const page of ['teamops','teamcountries','teamplatforms','time'])for(const request of [compact,{...compact,readMode:undefined,requests:[full]}])await h.api.adminLiveRequest(session,request,undefined,{assigned,page});
 assert.equal(h.calls.length,15);assert(h.calls.every(c=>JSON.parse(c.init.body).p_request.requests[0].platformId===request.platformId));
 for(const page of ['overview','merchants','collection','payout','risk','orders','matrix','provider_daily'])await assert.rejects(h.api.adminLiveRequest(session,compact,undefined,{assigned,page}));assert.equal(h.calls.length,15);
});
test('compact ready batches permit 50, ordinary stays 3; mixed views, duration drills and reuse remain rejected',()=>{
 const validate=load().api.validateAdminLiveRequest;assert.equal(validate({...compact,requests:Array(50).fill(full)}).requests.length,50);
 for(const patch of [{requests:Array(51).fill(full)},{readMode:undefined,requests:Array(4).fill(full)},{requests:[full,request]},{responseProfile:'amount-v1',requests:[request]},{responseProfile:'latency-v1'},{forceRefresh:false},{requests:[{...full,durationRange:{minSeconds:0,maxSeconds:60}}]},{providerReuseNames:[]},{providerLeafAliases:'items-fee-items-v1'}])assert.throws(()=>validate({...compact,...patch}));
});
for(const status of [400,500])test('only exact bounded capacity token survives postMessage as fallback code on HTTP '+status,async()=>{
 const h=load({fetch:async()=>({ok:false,status,json:async()=>({code:'54000',message:'prepared_ready_response_capacity'})})}),b=bridge(h,{roleAccess:()=>({mode:'owner',canView:true})}),e=b.event('capacity',compact);e.data.page='teamops';h.send(e);await flush();await flush();assert.equal(b.replies.length,1);assert.equal(b.replies[0].data.code,'PREPARED_READY_RESPONSE_CAPACITY');b.cleanup();
});
for(const [status,body]of [[403,{code:'54000',message:'prepared_ready_response_capacity'}],[401,{code:'54000',message:'prepared_ready_response_capacity'}],[500,{code:'22023',message:'prepared_ready_response_capacity'}],[500,{code:'54000',message:'different'}]])test('error '+status+'/'+body.code+'/'+body.message+' stays closed',async()=>{
 const h=load({fetch:async()=>({ok:false,status,json:async()=>body})});await assert.rejects(h.api.adminLiveRequest(session,compact,undefined,{assigned:true,page:'teamops'}),e=>e.code!=='PREPARED_READY_RESPONSE_CAPACITY');
});
test('ordinary compact reads cannot trigger ready-only capacity fallback',async()=>{
 const h=load({fetch:async()=>({ok:false,status:500,json:async()=>({code:'54000',message:'prepared_ready_response_capacity'})})});await assert.rejects(h.api.adminLiveRequest(session,{...compact,readMode:undefined},undefined,{assigned:false,page:'teamops'}),e=>e.code!=='PREPARED_READY_RESPONSE_CAPACITY');
});

test('amount primary and prior keep the exact native payload and existing role endpoint',async()=>{
 for(const assigned of [false,true]){
  const h=load();
  const roleAccess=()=>assigned?{mode:'assigned',canView:true,permissions:['amount.view','amount.query']}:{mode:'owner',canView:true};
  const b=bridge(h,{roleAccess});
  try{
   for(const [i,p] of [amountProbe,amountPrior].entries()){
    const e=b.event('amount-'+i,p);e.data.page='amount';h.send(e);
   }
   await flush();await flush();
   assert.equal(h.calls.length,2);assert.equal(b.replies.length,2);assert(b.replies.every(r=>!r.data.error));
   for(const [i,c] of h.calls.entries()){
    const body=JSON.parse(c.init.body);assert.equal(body.p_page,'amount');assert.deepEqual(body.p_request.requests,[amountProbe,amountPrior][i].requests);
    assert.equal(body.p_request.responseProfile,i===0?'amount-v1':undefined);assert.equal(body.p_request.readMode,'ready-only-v1');
    assert(c.url.endsWith(assigned?'/dashboard_admin_execute':'/dashboard_admin_aggregate_prepared'));
   }
  }finally{b.cleanup();}
 }
});

test('ungranted amount queries cannot dispatch either historical phase',async()=>{
 const h=load(),b=bridge(h,{roleAccess:()=>({mode:'assigned',canView:true,permissions:['amount.view','providers.query']})});
 try{
  for(const [i,p] of [amountProbe,amountPrior].entries()){
   const e=b.event('amount-denied-'+i,p);e.data.page='amount';h.send(e);
  }
  await flush();await flush();assert.equal(h.calls.length,0);assert.equal(b.replies.length,2);assert(b.replies.every(r=>r.data.error));
 }finally{b.cleanup();}
});

test('amount ready reads admit twenty per phase; mismatched profile, currency, filters and larger requests stay outside the amount path',async()=>{
 const h=load();
 for(const p of [amountProbe,amountPrior]){
  const q=p.requests[0];
  await h.api.adminLiveRequest(session,{...p,requests:Array(20).fill(q)},undefined,{assigned:true,page:'amount'});
  for(const patch of [
   {requests:Array(21).fill(q)},{requests:[{...q,amountMin:10}]},{requests:[{...q,currency:'BRL'}]},
   {requests:[{...q,status:'success'}]},{requests:[{...q,successBasis:'success',successStartAt:q.startAt,successEndAt:q.endAt}]},
   {forceRefresh:true}
  ])await assert.rejects(h.api.adminLiveRequest(session,{...p,...patch},undefined,{assigned:true,page:'amount'}));
 }
 for(const p of [{...amountProbe,responseProfile:'time-v1'},{...amountProbe,responseProfile:'latency-v1'},{...amountPrior,responseProfile:'amount-v1'}]){
  await assert.rejects(h.api.adminLiveRequest(session,p,undefined,{assigned:true,page:'amount'}));
 }
 await assert.rejects(h.api.adminLiveRequest(session,amountProbe,undefined,{assigned:true,page:'teamops'}));
 assert.equal(h.calls.length,2);
});

test('new authenticated dashboard documents opt into the amount shortcut separately',()=>{
 const html=load().api.makeAdminLiveDocument('<!doctype html><html><head></head><body></body></html>','test');
 assert.match(html,/window\.HENSEM_AMOUNT_READY_ONLY=true/);
});
