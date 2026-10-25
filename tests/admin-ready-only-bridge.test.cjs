// Existing authenticated bridge, exact ready-only negotiation, no network.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-live-bridge.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {load,session,bridge,flush}=new Function('require','__dirname',prefix+';return {load,session,bridge,flush};')(require,__dirname);
const request={action:'aggregate',view:'providers',platformId:'11111111-1111-4111-8111-111111111111',startAt:'2026-10-13T18:30:00.000Z',endAt:'2026-10-14T18:30:00.000Z',successStartAt:'2026-10-13T18:30:00.000Z',successEndAt:'2026-10-14T18:30:00.000Z',successBasis:'success',direction:'charge',status:'all',currency:'INR',offset:0,limit:20};
const probe={action:'aggregatePrepared',publicationVersion:2,readMode:'ready-only-v1',requests:[request]};
test('ready-only negotiation preserves exact inner query and requires explicit mode/version/providers',()=>{
 const check=load().api.validateAdminLiveRequest;assert.deepEqual(JSON.parse(JSON.stringify(check(probe))),probe);assert.equal(check({...probe,requests:Array(50).fill(request)}).requests.length,50);
 for(const patch of [{readMode:null},{readMode:false},{readMode:'other'},{publicationVersion:undefined},{forceRefresh:true},{forceRefresh:false},{providerLeafAliases:'items-fee-items-v1'},{providerReuseNames:[]},{responseProfile:'time-v1'},{requests:[{...request,view:'full'}]},{requests:[{...request,readMode:'ready-only-v1'}]},{requests:Array(51).fill(request)}])assert.throws(()=>check({...probe,...patch}));
});
for(const assigned of [false,true])test('ready-only page binding precedes HTTP for '+(assigned?'assigned':'owner')+' route',async()=>{
 const h=load();await h.api.adminLiveRequest(session,probe,undefined,{assigned,page:'providers'});assert.equal(h.calls.length,1);const body=JSON.parse(h.calls[0].init.body);assert.equal(body.p_page,'providers');assert.equal(body.p_request.readMode,'ready-only-v1');assert.deepEqual(body.p_request.requests,[request]);
 for(const page of ['collection','time',undefined])await assert.rejects(h.api.adminLiveRequest(session,probe,undefined,{assigned,page}),/页面无效|没有此页面/);assert.equal(h.calls.length,1);
});
test('new live documents explicitly opt in; transport failures remain failures',async()=>{
 const h=load(),html=h.api.makeAdminLiveDocument('<!doctype html><html><head></head><body></body></html>','test');assert.match(html,/window\.HENSEM_PREPARED_READY_ONLY=true/);
 for(const status of [403,500]){const denied=load({fetch:async()=>({ok:false,status,json:async()=>({message:'Synthetic failure'})})});await assert.rejects(denied.api.adminLiveRequest(session,probe,undefined,{assigned:true,page:'providers'}));assert.equal(denied.calls.length,1);}
});

test('a ready-only no-response transport uses the existing bounded bridge deadline and abort',async()=>{
 const h=load({fetch:async(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('unexposed detail'))))}),b=bridge(h,{roleAccess:()=>({mode:'owner',canView:true})}),event=b.event('probe',probe);event.data.page='providers';h.send(event);await flush();assert.equal(h.calls.length,1);assert.equal(h.timers.size,1);const timer=[...h.timers.values()][0];assert.equal(timer.ms,90000);timer.callback();await flush();assert.equal(h.calls[0].init.signal.aborted,true);assert.equal(b.replies.length,1);assert.equal(b.replies[0].data.code,'ADMIN_LIVE_TIMEOUT');assert.match(b.replies[0].data.error,/超时/);assert.equal(b.replies[0].data.result,undefined);b.cleanup();
});
