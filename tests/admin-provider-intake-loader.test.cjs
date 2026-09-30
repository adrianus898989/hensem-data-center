const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync(require('node:path').join(__dirname,'../admin-preview/live-provider-intake.js'),'utf8');
const context={};vm.runInNewContext(code,context);const api=context.HensemProviderIntake;
const from='2026-09-29',to=from,p={id:'p1',name:'51GAME',source:'ar'},feed={id:'f1',platformId:'p1',dataset:'orders',direction:'charge',timezone:'Asia/Kolkata'};
const day=overrides=>({feedId:'f1',date:from,status:'received',received:true,complete:false,zeroConfirmed:false,expected:true,evidence:'records_received_completeness_unverified',...overrides});
const response=rows=>({version:1,complete:true,checkedAt:'2026-09-30T10:00:00Z',feedIds:['f1'],startAt:from,endAt:to,rows});
test('success-only rows do not satisfy created-day coverage',()=>{
 const result=api.summarize(p,feed,[day({received:false,status:'not_received',evidence:'only_success_day_records_received'})],from,to);
 assert.equal(result.received,false);assert.equal(result.complete,false);assert.equal(result.status,'missing');assert.deepEqual(Array.from(result.missingDates),[from]);assert.match(result.message,/未收到该创建日订单/);
});
test('received is not complete and zero requires an explicit complete receipt',()=>{
 assert.equal(api.summarize(p,feed,[day({})],from,to).status,'received');
 assert.equal(api.summarize(p,feed,[day({})],from,to).complete,false);
 assert.equal(api.summarize(p,feed,[day({status:'zero_complete',zeroConfirmed:true,complete:true})],from,to).status,'zero_complete');
 assert.throws(()=>api.validate(response([day({status:'zero_complete',zeroConfirmed:false})]),[feed],from,to));
});
test('all selected dates must be present, even if one date has data',()=>{
 assert.throws(()=>api.validate(response([]),[feed],from,to),/缺少日期/);
 assert.throws(()=>api.validate(response([day({}),day({})]),[feed],from,to),/重复日期/);
 const result=api.summarize(p,feed,[day({})],'2026-09-28',to);
 assert.equal(result.received,false);assert.equal(result.complete,false);
});
test('only exact platform and direction feeds are read, with bounded batches and no provider filter',async()=>{
 const calls=[],feeds=Array.from({length:9},(_,i)=>({...feed,id:'f'+i,platformId:'p'+i})),platforms=feeds.map((f,i)=>({...p,id:f.platformId}));
 const loader=api.create({request:async q=>{calls.push(q);if(q.operation==='catalog')return {version:1,complete:true,feeds:[...feeds,{...feed,id:'withdraw',direction:'withdraw'}]};return {...response(q.feedIds.map(id=>day({feedId:id}))),feedIds:q.feedIds};}});
 const result=await loader.load({platforms,direction:'charge',from,to,providers:['UPI-QR']});
 assert.equal(result.platforms.length,9);assert.equal(result.status,'ready');assert.deepEqual(calls.slice(1).map(q=>q.feedIds.length),[4,4,1]);
 assert(calls.every(q=>!('providers' in q)&&!('status' in q)));assert(!calls.some(q=>q.feedIds?.includes('withdraw')));
});
test('transport or malformed coverage failure stays unknown rather than inventing missing orders',async()=>{
 const loader=api.create({request:async q=>q.operation==='catalog'?{version:1,complete:true,feeds:[feed]}:response([])});
 const result=await loader.load({platforms:[p],direction:'charge',from,to});assert.equal(result.platforms[0].status,'unverified');assert.equal(result.platforms[0].missingDates.length,0);assert.match(result.error,/核对失败/);
});
test('cancelled reads cannot populate a later query',async()=>{
 let resolve;const loader=api.create({request:()=>new Promise(r=>{resolve=r;})});
 const pending=loader.load({platforms:[p],direction:'charge',from,to});loader.cancel();resolve({version:1,complete:true,feeds:[feed]});await assert.rejects(pending,/已暂停/);
});
test('same scoped catalog can be shared by current and comparison checks; cancellation clears it',async()=>{
 let catalogs=0;const loader=api.create({request:async q=>{if(q.operation==='catalog'){catalogs++;return {version:1,complete:true,feeds:[feed]};}return response([day({})]);}});
 await Promise.all([loader.load({platforms:[p],direction:'charge',from,to}),loader.load({platforms:[p],direction:'charge',from,to})]);assert.equal(catalogs,1);
 loader.cancel();await loader.load({platforms:[p],direction:'charge',from,to});assert.equal(catalogs,2);
});
test('unknown source timezone never falls back to the browser date for completeness',()=>{
 for(const timezone of [undefined,'','Not/A_Timezone'])assert.throws(()=>api.validate(response([day({status:'complete',complete:true})]),[{...feed,timezone}],from,to),/缺少日期/);
 const unknown=day({date:null,status:'unverified',received:false,expected:false,evidence:'source_timezone_unknown'});api.validate(response([unknown]),[{...feed,timezone:null}],from,to);
 const result=api.summarize(p,{...feed,timezone:null},[unknown],from,to);assert.equal(result.status,'unverified');assert.match(result.days[0].notes,/时区/);assert.doesNotMatch(result.days[0].notes,/未来/);
});
test('contradictory zero flags cannot manufacture a confirmed zero platform',()=>{
 for(const overrides of [{status:'received',zeroConfirmed:true},{status:'not_received',received:false,zeroConfirmed:true},{status:'complete',complete:true,zeroConfirmed:true}])assert.throws(()=>api.validate(response([day(overrides)]),[feed],from,to),/不完整/);
 api.validate(response([day({status:'zero_complete',received:false,zeroConfirmed:true,complete:true})]),[feed],from,to);
});
test('legacy success-only evidence cannot masquerade as received creation data',()=>{
 const result=api.summarize(p,feed,[day({status:'received',received:true,evidence:'only_success_day_records_received'})],from,to);assert.equal(result.received,false);assert.equal(result.status,'missing');assert.equal(result.days[0].received,false);assert.deepEqual(Array.from(result.missingDates),[from]);
});
test('partial and failed source days retain receipt evidence but cannot complete the date range',()=>{
 for(const status of ['partial','failed']){const result=api.summarize(p,feed,[day({status,received:true,complete:false})],from,to);assert.equal(result.complete,false);assert.equal(result.status,'missing');assert.deepEqual(Array.from(result.missingDates),[from]);assert.equal(result.days[0].received,true);}
 const unknown=api.summarize(p,feed,[day({status:'unverified',received:false})],from,to);assert.equal(unknown.status,'unverified');assert.equal(unknown.missingDates.length,0);
});
test('creation source matching cannot be satisfied by success reports, aliases, or the opposite direction',async()=>{
 const calls=[],loader=api.create({request:async q=>{calls.push(q);return {version:1,complete:true,feeds:[{...feed,dataset:'collection_success'},{...feed,id:'alias',platformId:'other-id'},{...feed,id:'payout',direction:'withdraw'}]};}});
 const result=await loader.load({platforms:[p],direction:'charge',from,to});assert.equal(calls.length,1);assert.equal(result.platforms[0].status,'unverified');assert.equal(result.platforms[0].missingDates.length,0);
});
test('responses cannot inject unrelated feeds or adjacent-date source facts',()=>{
 for(const malformed of [response([day({feedId:'foreign'})]),{...response([day({})]),feedIds:['foreign']},response([day({date:'2026-09-28'})]),{...response([day({})]),startAt:'2026-09-28'}])assert.throws(()=>api.validate(malformed,[feed],from,to));
});
test('source local midnight controls the expected date set independently of client time',()=>{
 const r={...response([day({})]),checkedAt:'2026-09-29T20:00:00Z'};api.validate(r,[feed],from,to);
 assert.throws(()=>api.validate(r,[{...feed,timezone:'America/New_York'}],from,to),/缺少日期/);
 api.validate({...r,rows:[]},[{...feed,timezone:'America/New_York'}],from,to);
});
test('cancellation during a batch stops later batches and invalidates the pending result',async()=>{
 const feeds=Array.from({length:5},(_,i)=>({...feed,id:'f'+i,platformId:'p'+i})),platforms=feeds.map(f=>({...p,id:f.platformId})),calls=[];let release;
 const loader=api.create({request:async q=>{calls.push(q);if(q.operation==='catalog')return {version:1,complete:true,feeds};return new Promise(resolve=>{release=()=>resolve({...response(q.feedIds.map(id=>day({feedId:id}))),feedIds:q.feedIds});});}});
 const pending=loader.load({platforms,direction:'charge',from,to});await new Promise(resolve=>setImmediate(resolve));loader.cancel();release();await assert.rejects(pending,/已暂停/);assert.deepEqual(calls.filter(q=>q.operation==='rows').map(q=>q.feedIds.length),[4]);
});
test('current and comparison loads preserve independent date scopes while sharing authorized source catalog',async()=>{
 const calls=[],loader=api.create({request:async q=>{calls.push(q);if(q.operation==='catalog')return {version:1,complete:true,feeds:[feed]};return {...response([day({date:q.startAt})]),startAt:q.startAt,endAt:q.endAt};}});
 const [current,previous]=await Promise.all([loader.load({platforms:[p],direction:'charge',from,to}),loader.load({platforms:[p],direction:'charge',from:'2026-09-28',to:'2026-09-28'})]);
 assert.equal(current.from,from);assert.equal(previous.from,'2026-09-28');assert.equal(current.platforms[0].days[0].date,from);assert.equal(previous.platforms[0].days[0].date,'2026-09-28');assert.equal(calls.filter(q=>q.operation==='catalog').length,1);
});
