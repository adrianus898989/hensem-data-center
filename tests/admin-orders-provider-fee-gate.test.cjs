/* Actual legacy order controller and shared modules, synthetic IO only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,deferred,P,completeAggregate,detail}=new Function('require','__dirname',prefix+';return {harness,settle,deferred,P,completeAggregate,detail};')(require,__dirname);
const platform={...P,sourceName:'Synthetic native'};
const feeRows=provider=>({rows:[{id:provider,scopeType:'country',country:'印度',provider,collectFee:'4%',collectLimit:'250-25000',payoutFee:'2%',payoutLimit:'500-100000'}],total:1});
async function setup({provider='Synthetic provider',status='all',filters={}}={}){
 const h=harness({page:'orders',platforms:[platform],roleAccess:{mode:'owner',canView:true},roleAllowed:()=>true,extraModules:['live-statistic-windows.js','live-prepared-aggregates.js','live-amount-bands.js']});await settle();
 Object.assign(h.L,{from:'2026-09-22T00:00:00',to:'2026-09-22T23:59:59',successFrom:'',successTo:'',status,provider,platform:platform.id,...filters});h.L.multi.provider=provider?[provider]:[];h.L.multi.platform=[platform.id];h.calls.length=0;
 let rate=()=>({rows:[],total:0});
 h.setHandler(q=>{
  const p=h.L.catalog.find(p=>p.id===q.platformId)||platform;
  if(q.action==='rates')return rate(q);
  if(q.action==='aggregate'){const r=completeAggregate(p,10,6);Object.assign(r,{startAt:q.startAt,endAt:q.endAt,...(q.amountBands?{amountBands:q.amountBands,amountBandsVersion:1}:{})});r.groups.provider[0].provider=q.providers?.[0]||'Synthetic provider';if(q.amountBands){r.groups.amount_range=[];r.groups.matrix_range=[];}return r;}
  if(q.action==='details')return detail(p,10,q.offset,q.limit);
  return {};
 });
 return {...h,setRate:fn=>rate=fn,aggregates:()=>h.calls.filter(q=>q.action==='aggregate'),details:()=>h.calls.filter(q=>q.action==='details')};
}
const current=h=>h.aggregates().find(q=>q.startAt==='2026-09-21T18:30:00.000Z');
for(const provider of ['', 'Synthetic provider'])test('orders all-status main and details render while fees are held '+(provider||'all providers'),async()=>{
 const h=await setup({provider}),fee=deferred();h.setRate(()=>fee.promise);const run=h.c.liveQuery();await settle();
 assert.equal(h.L.loading,false);assert.equal(h.L.results.length,1);assert.equal(h.L.detail.rows.length,10);assert.match(h.html(),/订单列表/);assert.match(h.html(),/1,000\.00/);assert.equal(h.L.feeLookupLoading,true);assert.equal(h.L.amountBandProfiles,null);
 const q=current(h);assert.deepEqual(q,{action:'aggregate',view:'providers',platformId:platform.id,startAt:'2026-09-21T18:30:00.000Z',endAt:'2026-09-22T18:30:00.000Z',direction:'all',status:'all',currency:'INR',offset:0,limit:20,...(provider?{providers:[provider]}:{})});assert.equal(h.calls.filter(q=>q.action==='aggregatePrepared').length,0,'orders keeps its existing legacy reader');assert.equal(h.details().length,1);assert.equal(Object.hasOwn(h.details()[0],'amountBands'),false);
 fee.resolve(feeRows(provider||'Synthetic provider'));await run;await settle();assert.equal(h.L.feeLookupRows.length,1);assert.equal(h.calls.filter(q=>q.action==='rates').length,1);assert.equal(h.aggregates().length,2,'only current and original previous-period request');
});
test('order search filters and three existing views, pagination and drawer keep the same requests',async()=>{
 const h=await setup({filters:{orderNumber:'synthetic-order',memberId:'synthetic-member'}}),fee=deferred();h.setRate(()=>fee.promise);const run=h.c.liveQuery();await settle();
 assert.equal(h.L.detail.rows.length,10);assert.equal(current(h).orderNumber,'synthetic-order');assert.equal(current(h).memberId,'synthetic-member');assert.equal(h.details()[0].orderNumber,'synthetic-order');assert.equal(h.details()[0].memberId,'synthetic-member');const before=h.calls.length;
 for(const view of ['orderFees','orderRates','business']){h.c.liveView(view);await settle();}assert.equal(h.calls.length,before,'views use the loaded stored order fee fields');
 h.c.livePageSize(50,'server');await settle();assert.equal(h.details().length,2);assert.equal(h.details()[1].limit,50);h.c.liveOrder(0);assert.equal(h.drawers.length,1);assert(h.aggregates().every(q=>q.view==='providers'&&!Object.hasOwn(q,'amountBands')));assert(h.details().every(q=>!Object.hasOwn(q,'amountBands')));
 fee.resolve(feeRows('Synthetic provider'));await run;
});
test('optional order fee failure keeps displayed amounts and details without another aggregate read',async()=>{
 const h=await setup(),fee=deferred();h.setRate(()=>fee.promise);const run=h.c.liveQuery();await settle();const facts=JSON.stringify(h.L.results),details=JSON.stringify(h.L.detail),count=h.aggregates().length;
 fee.reject(Error('Synthetic fee failure'));await run;await settle();assert.equal(JSON.stringify(h.L.results),facts);assert.equal(JSON.stringify(h.L.detail),details);assert.match(h.L.feeLookupError,/fee failure/);h.c.render();await settle();assert.equal(h.aggregates().length,count);assert.equal(h.calls.filter(q=>q.action==='rates').length,1);assert.match(h.html(),/订单列表/);
});
for(const replacement of ['provider','account','native','date'])test('late order fee cannot overwrite a newer '+replacement+' scope',async()=>{
 const h=await setup(),old=deferred();let n=0;h.setRate(()=>++n===1?old.promise:feeRows('Synthetic next'));const first=h.c.liveQuery();await settle();assert.equal(h.L.results.length,1);
 if(replacement==='account')h.c.hensemDataScope={mode:'selected',identity:'new-authority'};
 if(replacement==='native')h.L.catalog=h.L.catalog.map(p=>({...p,sourceName:'New native'}));
 if(replacement==='date')h.c.liveSet('from','2026-09-21T00:00:00');h.c.liveSet('provider','Synthetic next');await h.c.liveQuery();await settle();const facts=JSON.stringify(h.L.results),details=JSON.stringify(h.L.detail),rates=JSON.stringify(h.L.feeLookupRows);old.resolve(feeRows('Synthetic old'));await first;await settle();assert.equal(JSON.stringify(h.L.results),facts);assert.equal(JSON.stringify(h.L.detail),details);assert.equal(JSON.stringify(h.L.feeLookupRows),rates);assert(h.L.feeLookupRows.every(r=>r.provider==='Synthetic next'));
});
test('late fee after leaving orders cannot alter the new page',async()=>{
 const h=await setup(),old=deferred();h.setRate(()=>old.promise);const run=h.c.liveQuery();await settle();assert.equal(h.L.results.length,1);h.c.setPage('amount');const before=JSON.stringify({results:h.L.results,fees:h.L.feeLookupRows,detail:h.L.detail});old.resolve(feeRows('Synthetic old'));await run;await settle();assert.equal(JSON.stringify({results:h.L.results,fees:h.L.feeLookupRows,detail:h.L.detail}),before);
});
test('fee-only order denial keeps the existing independently authorized order result and clears fee facts',async()=>{
 const h=await setup(),fee=deferred();h.setRate(()=>fee.promise);const run=h.c.liveQuery();await settle();const facts=JSON.stringify(h.L.results),details=JSON.stringify(h.L.detail);assert.equal(h.L.results.length,1);fee.reject(Object.assign(Error('Synthetic rate-only denial'),{code:'ADMIN_LIVE_PERMISSION_DENIED'}));await run;await settle();assert.equal(JSON.stringify(h.L.results),facts);assert.equal(JSON.stringify(h.L.detail),details);assert.equal(h.L.feeLookupRows,null);assert.match(h.L.feeLookupError,/rate-only denial/);
});
test('actual order aggregate permission denial preserves the existing clear-and-stop behavior',async()=>{
 const h=await setup();await h.c.liveQuery();await settle();assert.equal(h.L.results.length,1);h.setHandler(q=>{if(q.action==='aggregate')throw Object.assign(Error('Synthetic aggregate denied'),{code:'ADMIN_LIVE_PERMISSION_DENIED'});if(q.action==='rates')return feeRows('Synthetic provider');return {};});const before=h.details().length;await h.c.liveQuery(true);await settle();assert.equal(h.L.results.length,0);assert.equal(h.L.comparisonResults.length,0);assert.equal(h.L.detail,null);assert.equal(h.L.feeLookupRows,null);assert.match(h.L.error,/权限/);assert.equal(h.details().length,before);
});
test('switching from a band-using order status to all clears the old band profile without blocking the main read',async()=>{
 const h=await setup({status:'success'});h.setRate(()=>feeRows('Synthetic provider'));await h.c.liveQuery();await settle();assert.equal(h.L.amountBandProfiles.charge.edges[0],250);const fee=deferred();h.setRate(()=>fee.promise);h.c.liveSet('status','all');const run=h.c.liveQuery(true);await settle();assert.equal(h.L.amountBandProfiles,null);assert.equal(h.L.results.length,1);assert.equal(h.L.detail.rows.length,10);const q=h.aggregates().at(-1);assert.equal(q.view,'providers');assert.equal(Object.hasOwn(q,'amountBands'),false);fee.resolve(feeRows('Synthetic provider'));await run;
});
for(const status of ['success','pending','failed'])test('orders '+status+' preserves original full aggregate bands and waits for selected-provider limits',async()=>{
 const h=await setup({status}),fee=deferred();h.setRate(()=>fee.promise);const run=h.c.liveQuery();await settle();assert.equal(h.aggregates().length,0);assert.equal(h.details().length,0);assert.equal(h.L.loading,true);
 fee.resolve(feeRows('Synthetic provider'));await run;await settle();const q=current(h);assert.equal(q.status,status);assert.equal(q.view,undefined);assert.deepEqual(q.providers,['Synthetic provider']);assert.equal(q.amountBands.charge[0],250);assert.equal(q.amountBands.charge.at(-1),25000);assert.equal(q.amountBands.withdraw[0],500);assert.equal(q.amountBands.withdraw.at(-1),100000);assert.equal(Object.hasOwn(q,'successBasis'),false);assert.equal(h.calls.filter(q=>q.action==='aggregatePrepared').length,0);assert(h.details().every(q=>!Object.hasOwn(q,'amountBands')));assert.equal(h.calls.filter(q=>q.action==='rates').length,1);
});
