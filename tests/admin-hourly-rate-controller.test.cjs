const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-hourly-rate-controller.js'),'utf8');
const dataSource=fs.readFileSync(path.join(__dirname,'../admin-preview/live-hourly-rate-data.js'),'utf8');
const windowsSource=fs.readFileSync(path.join(__dirname,'../admin-preview/live-hourly-rate-windows.js'),'utf8');
const readUi=name=>fs.readFileSync(path.join(__dirname,'../admin-preview/'+name+'.js'),'utf8');
const amountEdges=[100,200,300,400,500,1000,2000,5000,10000,20000,50000];
const amountBands={charge:amountEdges,withdraw:amountEdges};
const from='2026-11-10T18:30:00.000Z',to='2026-11-11T18:30:00.000Z',wait=()=>new Promise(r=>setImmediate(r));
function fixture(mode='time'){
 const platform=i=>({id:'p'+i,name:'P'+i,currency:'INR',timezone:'Asia/Kolkata'});
 const platforms=[1,2,3,4].map(platform),L={results:platforms.map(platform=>({platform,groups:{hourly:[]}})),serial:1,view:'hourly-provider',pageQueried:true,queryScope:'base',queryNow:100,direction:'all',status:'all',currency:'INR',from,to};
 if(mode==='amount'){
  L.view='amount-provider';L.amountBandProfiles={charge:{edges:amountEdges},withdraw:{edges:amountEdges}};
 }
 const calls=[],models=new Map();let model,page=mode,detail=true,context='user1:v1';
 const win={HensemBandSuccessMatricesUI:{render:(m,page,kind)=>{models.set(m.direction,m);return '<section data-band-matrix="'+page+'/'+m.direction+'/'+kind+'"></section>';}}};
 const runtime={window:win,AbortController,setTimeout,clearTimeout,queueMicrotask};
 vm.runInNewContext(dataSource,runtime);
 if(mode==='amount')for(const name of ['live-amount-bands','live-amount-rate-data'])vm.runInNewContext(readUi(name),runtime);
 const build=win.HensemHourlyRateData.build;
 win.HensemHourlyRateData.build=m=>{model=m;return build(m);};
 vm.runInNewContext(windowsSource,runtime);vm.runInNewContext(source,runtime);
 const ctx={L,E:String,access:()=>context,page:()=>page,allowed:()=>true,canDrill:()=>detail,platforms:()=>platforms,query:p=>({platformId:p.id,status:'all',direction:L.direction,currency:L.currency,startAt:from,endAt:to,successBasis:'created',offset:50,limit:20,...(mode==='amount'?{amountBands:Object.fromEntries(Object.entries(L.amountBandProfiles).map(([d,profile])=>[d,profile.edges]))}:{})}),request:(q,o)=>new Promise((resolve,reject)=>calls.push({q,o,resolve,reject})),render:()=>{},denied:e=>e.code==='42501'};
 const api=win.HensemHourlyRateController,app=api.create(ctx);
 const reply=call=>({platform:{id:call.q.platformId},startAt:call.q.startAt,endAt:call.q.endAt,complete:true,hasMore:false,successBasis:'created',providerHourMatrix:true,segment:{kind:'custom',hourRange:{minHour:0,maxHour:24}},summary:[],groups:{provider_hour:[],hourly:[]}});
 return {win,api,app,calls,ctx,reply,L,model:()=>model,rendered:(direction='charge')=>models.get(direction),detail:x=>detail=x,context:x=>context=x,page:x=>page=x};
}
test('one full-day crossing per platform shared by both directions, two in flight, no repeat on sorting or rendering, retry only failed native',async()=>{
 const h=fixture(),action=h.win.HensemHourlyMatrixActions;h.app.html();assert.equal(h.calls.length,0);
 const run=action.load();assert.equal(h.calls.length,2);for(const c of h.calls){assert.equal(c.q.providerHourMatrix,true);assert.equal(c.q.direction,'all');assert.equal(c.q.offset,0)}
 await action.load();assert.equal(h.calls.length,2);h.calls[0].resolve(h.reply(h.calls[0]));h.calls[1].reject(Error('failed'));await wait();assert.equal(h.calls.length,4);
 h.calls.slice(2).forEach(c=>c.resolve(h.reply(c)));await run;assert.match(h.app.html(),/重试未完成商户/);assert.equal(h.model().providerHours.size,3);
 assert.ok(h.rendered('charge'));assert.ok(h.rendered('withdraw'));assert.equal(h.calls.length,4);
 const retry=action.load(true);assert.equal(h.calls.length,5);assert.equal(h.calls[4].q.platformId,h.calls[1].q.platformId);h.calls[4].resolve(h.reply(h.calls[4]));await retry;h.app.html();assert.equal(h.model().providerHours.size,4);h.app.cancel();
});
test('query replacement, permission loss and denied reads never paint private responses from a previous scope',async()=>{
 const h=fixture(),action=h.win.HensemHourlyMatrixActions;const old=action.load();h.context('other');h.L.serial++;h.L.loading=true;h.app.html();assert(h.calls[0].o.signal.aborted);
 h.calls.forEach(c=>c.resolve(h.reply(c)));await old;h.app.html();assert.equal(h.model().providerHours.size,0);
 h.L.loading=false;h.detail(false);await action.load();assert.equal(h.calls.length,2);
 h.detail(true);const latest=action.load();h.calls[2].reject(Object.assign(Error('hidden'),{code:'42501'}));h.calls[3].resolve(h.reply(h.calls[3]));await latest;assert.match(h.app.html(),/未获/);await action.load(true);assert.equal(h.calls.length,4);h.app.cancel();
});
test('reject mismatched clocks, wrong platform, old or incomplete groups; never convert an explicit time filter into an unfiltered read',()=>{
 const h=fixture(),base=h.ctx.query({id:'p1'});const q=h.api.matrixRequest(base),good=h.reply({q});
 assert.equal(h.api.verified(good,q).complete,true);for(const changes of [{providerHourMatrix:undefined},{hasMore:true},{startAt:to},{platform:{id:'p2'}},{successBasis:undefined},{groups:{hourly:[]}}])assert.throws(()=>h.api.verified({...good,...changes},q));
 assert.throws(()=>h.api.matrixRequest({...base,successEndAt:to}));assert.throws(()=>h.api.matrixRequest({...base,successBasis:'source_updated',successStartAt:from,successEndAt:to}));assert.throws(()=>h.api.matrixRequest({...base,status:'success'}));h.app.cancel();
});
const timeout=()=>Object.assign(Error('数据库超时'),{code:'57014'});
function withReadyDay(h){
 for(const r of h.L.results)Object.assign(r,{startAt:from,endAt:to,successBasis:'created',_preparedPublication:{status:'ready'},total:0,summary:[]});
}
test('only a real SQL timeout queues recovery behind healthy native reads and uses the original abort signal, one slice at a time',async()=>{
 const h=fixture();withReadyDay(h);const run=h.win.HensemHourlyMatrixActions.load();
 h.calls[0].reject(timeout());h.calls[1].resolve(h.reply(h.calls[1]));await wait();
 assert.deepEqual(h.calls.map(c=>c.q.platformId),['p1','p2','p3','p4']);
 h.calls.slice(2).forEach(c=>c.resolve(h.reply(c)));await wait();
 for(let i=0;i<4;i++){
  assert.equal(h.calls.length,5+i);const c=h.calls[4+i];
  assert.equal(c.q.platformId,'p1');assert.equal(c.o.signal,h.calls[0].o.signal);
  assert.equal(Date.parse(c.q.startAt),Date.parse(from)+i*6*3600000);
  assert.equal(Date.parse(c.q.endAt)-Date.parse(c.q.startAt),6*3600000);
  c.resolve(h.reply(c));await wait();
 }
 await run;h.app.html();assert.equal(h.calls.length,8);assert.equal(h.model().providerHours.size,4);h.app.cancel();
});
test('an unsuccessful slice stops immediately, without publishing partial data or retrying another timeout',async()=>{
 const h=fixture();withReadyDay(h);const run=h.win.HensemHourlyMatrixActions.load();
 h.calls[0].reject(timeout());h.calls[1].resolve(h.reply(h.calls[1]));await wait();
 h.calls.slice(2).forEach(c=>c.resolve(h.reply(c)));await wait();
 h.calls[4].resolve(h.reply(h.calls[4]));await wait();h.calls[5].reject(timeout());await run;
 h.app.html();assert.equal(h.calls.length,6);assert.equal(h.model().providerHours.size,3);h.app.cancel();
});
test('a permission revocation or replacement during a slice never issues or displays a later slice',async()=>{
 for(const revoked of [true,false]){
  const h=fixture();withReadyDay(h);const run=h.win.HensemHourlyMatrixActions.load();
  h.calls[0].reject(timeout());h.calls[1].resolve(h.reply(h.calls[1]));await wait();
  h.calls.slice(2).forEach(c=>c.resolve(h.reply(c)));await wait();
  if(revoked)h.calls[4].reject(Object.assign(Error('权限失效'),{code:'42501'}));
  else {h.L.serial++;h.L.loading=true;h.app.html();h.calls[4].resolve(h.reply(h.calls[4]));}
  await run;assert.equal(h.calls.length,5);assert(h.calls[4].o.signal.aborted);
  if(revoked)assert.match(h.app.html(),/未获/);else{h.app.html();assert.equal(h.model().providerHours.size,0);}
  h.app.cancel();
 }
});

test('switching hourly views shares an in-flight read; leaving aborts pending platforms, and returning reuses verified platforms',async()=>{
 const h=fixture(),action=h.win.HensemHourlyMatrixActions;
 const old=action.load();
 h.calls[0].resolve(h.reply(h.calls[0]));await wait();
 assert.deepEqual(h.calls.map(c=>c.q.platformId),['p1','p2','p3']);
 h.L.view='hourly-merchant';h.app.html();
 h.L.view='hourly-provider';h.app.html();
 await action.load();
 assert.equal(h.calls.length,3);assert.ok(h.calls.every(c=>!c.o.signal.aborted));
 h.L.view='business';h.app.pause();assert.ok(h.calls[1].o.signal.aborted);
 h.calls.slice(1).forEach(c=>c.resolve(h.reply(c)));await old;
 await action.load();assert.equal(h.calls.length,3);
 h.L.view='hourly-provider';const resumed=action.load();
 h.calls.slice(3).forEach(c=>c.resolve(h.reply(c)));await wait();
 h.calls.slice(5).forEach(c=>c.resolve(h.reply(c)));await resumed;h.app.html();
 assert.deepEqual(h.calls.slice(3).map(c=>c.q.platformId),['p2','p3','p4']);
 assert.equal(h.model().providerHours.size,4);h.app.cancel();
});

for(const [name,replace] of [
 ['account',h=>h.context('different-user:v1')],
 ['permission version',h=>h.context('user1:v2')],
 ['detail permission',h=>h.detail(false)],
 ['page',h=>h.page('overview')],
 ['date range',h=>{h.L.from='2026-11-09T18:30:00.000Z';}],
 ['currency',h=>{h.L.currency='IDR';}],
 ['query refresh',h=>h.L.serial++],
 ['unapplied filters',h=>{h.L.dirty=true;}]
]){
 test(name+' replacement stops queued reads and never repaints a late response',async()=>{
  const h=fixture(),pending=h.win.HensemHourlyMatrixActions.load();
  replace(h);h.L.loading=true;h.app.html();
  assert.ok(h.calls[0].o.signal.aborted);assert.ok(h.calls[1].o.signal.aborted);
  for(const call of h.calls)call.resolve(h.reply(call));
  await pending;h.app.html();
  assert.equal(h.calls.length,2);
  if(h.model())assert.equal(h.model().providerHours.size,0);
  h.app.cancel();
 });
}

test('merchant requests only the missing native hourly data; provider then reuses its verified response',async()=>{
 const h=fixture(),action=h.win.HensemHourlyMatrixActions;
 for(const result of h.L.results.slice(0,3))Object.assign(result,{complete:true,total:0,summary:[]});
 h.L.view='hourly-merchant';h.app.html();await wait();
 assert.deepEqual(h.calls.map(c=>c.q.platformId),['p4']);
 h.calls[0].resolve({...h.reply(h.calls[0]),total:0});await wait();
 h.L.view='hourly-provider';const run=action.load();
 assert.deepEqual(h.calls.slice(1).map(c=>c.q.platformId),['p1','p2']);
 h.calls.slice(1).forEach(c=>c.resolve({...h.reply(c),total:0}));await wait();
 assert.deepEqual(h.calls.slice(3).map(c=>c.q.platformId),['p3']);
 h.calls[3].resolve({...h.reply(h.calls[3]),total:0});await run;
 h.L.view='hourly-merchant';h.app.html();await wait();
 assert.equal(h.calls.length,4);h.app.cancel();
});


function setupAmount(){
 const h=fixture('amount');
 for(const r of h.L.results)Object.assign(r,{complete:true,hasMore:false,amountBands,successBasis:'created',startAt:from,endAt:to,total:0,summary:[],groups:{amount_range:[],provider:[]}});
 function reply(call){
  const q=call.q;
  return {...h.reply(call),platform:{id:q.platformId},providerHourMatrix:undefined,providerAmountMatrix:true,
   amountBands:q.amountBands,total:0,groups:{amount_range:[],provider_amount_range:[],provider:[]}};
 }
 return {...h,reply};
}
test('amount merchant supplements only one unavailable distribution, then reuses the same verified crossing on the provider tab',async()=>{
 const h=setupAmount(),action=h.win.HensemHourlyMatrixActions;
 h.L.results[2].groups={provider:[]};
 h.L.view='amount-merchant';h.app.html();await wait();
 assert.deepEqual(h.calls.map(c=>c.q.platformId),['p3']);
 assert.equal(h.rendered().merchant.ready.size,3);
 const c=h.calls[0];assert.equal(c.q.providerAmountMatrix,true);assert.equal(c.q.providerHourMatrix,undefined);
 assert.deepEqual(c.q.amountBands,amountBands);
 c.resolve(h.reply(c));await wait();h.app.html();assert.equal(h.rendered().merchant.ready.size,4);
 h.L.view='amount-provider';const run=action.load();
 assert.deepEqual(h.calls.slice(1).map(c=>c.q.platformId),['p1','p2']);
 h.calls.slice(1).forEach(c=>c.resolve(h.reply(c)));await wait();
 assert.equal(h.calls[3].q.platformId,'p4');h.calls[3].resolve(h.reply(h.calls[3]));await run;
 h.app.html();assert.equal(h.rendered().provider.ready.size,4);
 assert.equal(h.rendered('withdraw').provider.ready.size,4);
 assert.equal(h.calls.length,4);h.app.cancel();
});
test('amount reading invalidates an old band profile and discards a late response after account, permission or platform changes',async()=>{
 for(const change of [
  h=>{h.L.amountBandProfiles.charge={edges:[100,250,...amountEdges.slice(2)]};},
  h=>h.context('different-account'),h=>h.detail(false),h=>{h.ctx.platforms=()=>[h.L.results[3].platform];}
 ]){
  const h=setupAmount(),run=h.win.HensemHourlyMatrixActions.load();
  assert.equal(h.calls.length,2);change(h);h.L.loading=true;h.app.html();
  assert.ok(h.calls.every(c=>c.o.signal.aborted));h.calls.forEach(c=>c.resolve(h.reply(c)));await run;
  h.app.html();assert.equal(h.rendered().provider.ready.size,0);assert.equal(h.calls.length,2);
  h.app.cancel();
 }
});

test('a source with an unavailable payout clock retains its verified collection counts for the same native request',async()=>{
 const h=setupAmount(),action=h.win.HensemHourlyMatrixActions;
 h.ctx.platforms=()=>[h.L.results[0].platform];
 const charge={direction:'charge',currency:'INR',success_count:1,created_success_count:1,all_count:2};
 const payout={direction:'withdraw',currency:'INR',success_count:null,created_success_count:null,all_count:3};
 const main=h.L.results[0];
 Object.assign(main,{successBasis:'success',successStartAt:from,successEndAt:to,summary:[charge,payout],total:5,
   groups:{amount_range:[{...charge,bucket:'band:0'},{...payout,bucket:'band:1'}],provider:[{...charge,provider:'Pay'},{...payout,provider:'Pay'}]}});
 const originalQuery=h.ctx.query;
 h.ctx.query=p=>({...originalQuery(p),successBasis:'success',successStartAt:from,successEndAt:to});
 h.ctx.successAvailable=(p,r,d)=>p.id===main.platform.id&&d==='charge';
 const run=action.load();assert.equal(h.calls.length,1);
 const c=h.calls[0];assert.equal(c.q.direction,'all');assert.equal(c.q.successBasis,undefined);
 c.resolve({...h.reply(c),successBasis:undefined,summary:main.summary,total:5,
  groups:{...main.groups,provider_amount_range:main.groups.amount_range.map(r=>({...r,provider:'Pay'}))}});
 await run;h.app.html();assert.equal(h.rendered().provider.ready.size,1);assert.equal(h.rendered().provider.rows[0].total.successCount,1);
 assert.equal(h.rendered('withdraw').provider.ready.size,0);assert.equal(h.rendered('withdraw').provider.rows.length,0);
 await wait();assert.equal(h.calls.length,1);
 h.app.cancel();
});

for(const page of ['time','amount'])test(page+' stacks each verified direction in one tab and rejects a stale one-direction scope',async()=>{
 const h=page==='time'?fixture():setupAmount(), prefix=page==='time'?'hourly':'amount';
 for(const kind of ['merchant','provider']){
  h.L.view=prefix+'-'+kind;
  const html=h.app.html();
  const keys=Array.from(html.matchAll(/data-band-matrix="([^"]+)"/g),m=>m[1]);
  assert.deepEqual(keys,[page+'/charge/'+kind,page+'/withdraw/'+kind]);
  assert.doesNotMatch(html,/HensemHourlyMatrixActions.direction/);
 }
 const load=h.win.HensemHourlyMatrixActions.load();
 assert.equal(h.calls.length,2);
 h.L.direction='charge';const blocked=h.app.html();
 assert.ok(h.calls.every(c=>c.o.signal.aborted));assert.doesNotMatch(blocked,/data-band-matrix/);
 h.calls.forEach(c=>c.resolve(h.reply(c)));await load;await wait();
 assert.equal(h.calls.length,2);
 h.app.cancel();
});

for(const page of ['time','amount'])test(page+' renders different charge and payout counts from one native response on both tabs',async()=>{
 const isAmount=page==='amount',h=isAmount?setupAmount():fixture(),main=h.L.results[0];
 h.ctx.platforms=()=>[main.platform];
 const totals=[
  {direction:'charge',currency:'INR',success_count:3,created_success_count:3,all_count:4},
  {direction:'withdraw',currency:'INR',success_count:2,created_success_count:2,all_count:10}
 ];
 const buckets=totals.map((row,i)=>({...row,...(isAmount?{bucket:'band:'+i}:{hour:i})}));
 const nativeGroups={
  [isAmount?'amount_range':'hourly']:buckets,
  provider:totals.map(row=>({...row,provider:'Pay'}))
 };
 Object.assign(main,{startAt:from,endAt:to,successBasis:'created',complete:true,hasMore:false,total:14,summary:totals,groups:nativeGroups});
 const run=h.win.HensemHourlyMatrixActions.load();
 assert.equal(h.calls.length,1);
 const q=h.calls[0];
 q.resolve({...h.reply(q),summary:totals,total:14,groups:{
  ...nativeGroups,[isAmount?'provider_amount_range':'provider_hour']:buckets.map(row=>({...row,provider:'Pay'}))
 }});
 await run;
 for(const kind of ['provider','merchant']){
  h.L.view=(isAmount?'amount':'hourly')+'-'+kind;const html=h.app.html();
  assert.ok(html.indexOf(page+'/charge/'+kind)<html.indexOf(page+'/withdraw/'+kind));
  for(const row of totals){
   const matrix=h.rendered(row.direction)[kind];
   assert.equal(matrix.ready.size,1);
   assert.equal(matrix.rows[0].total.successCount,row.success_count);
   assert.equal(matrix.rows[0].total.totalCount,row.all_count);
  }
  assert.equal(h.calls.length,1);
 }
 h.app.cancel();
});
