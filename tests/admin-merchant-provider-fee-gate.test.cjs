/* Actual merchant controller, original band algorithm and prepared manager.
 * All IO is synthetic; these checks make no production latency claim. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-payout-provider-fee-gate.test.cjs'),'utf8').split(/\nfor\(const options/)[0];
const {setup,feeRows,ready,mainRequests,deferred,settle,platform}=new Function('require','__dirname',prefix+';return {setup,feeRows,ready,mainRequests,deferred,settle,platform};')(require,__dirname);
const full=h=>h.requests().filter(q=>q.view!=='providers');
const rateCount=h=>h.calls.filter(q=>q.action==='rates').length;
const bands=h=>JSON.parse(JSON.stringify(h.L.amountBandProfiles));
const limits=(provider,min=250,max=25000)=>{const r=feeRows(provider);r.rows[0].collectLimit=min+'-'+max;return r;};
async function trend(h){h.c.liveView('trend');await settle();}
for(const view of ['business','providers'])for(const success of [false,true])test('merchant '+view+' main renders before selected-provider fees; trend reuses the same read '+success,async()=>{
 const h=await setup('merchants',{success}),fee=deferred();h.L.view=view;h.setRate(()=>fee.promise);const run=h.c.liveQuery();await settle();
 assert.equal(h.L.results.length,1);assert.equal(h.L.loading,false);assert.match(h.html(),/1,000\.00/);assert.equal(h.L.amountBandProfiles,null);assert.equal(h.L.feeLookupLoading,true);
 const q=mainRequests(h)[0];assert.equal(q.view,'providers');assert.equal(q.direction,'all');assert.deepEqual(q.providers,['Synthetic provider']);assert.equal(Object.hasOwn(q,'amountBands'),false);assert.equal(q.successBasis,success?'success':'created');
 if(success){assert.equal(q.successStartAt,'2026-09-21T20:30:00.000Z');assert.equal(q.successEndAt,'2026-09-22T14:30:01.000Z');}
 const facts=JSON.stringify(h.L.results);await trend(h);await trend(h);assert.equal(full(h).length,0);assert.equal(rateCount(h),1);assert.equal(JSON.stringify(h.L.results),facts);
 fee.resolve(feeRows('Synthetic provider'));await run;await settle();assert.equal(rateCount(h),1);assert.equal(full(h).length,1);assert.equal(h.L.loadedView,'full');
 const t=full(h)[0];assert.equal(t.amountBands.charge[0],250);assert.equal(t.amountBands.charge.at(-1),25000);assert.equal(t.amountBands.withdraw[0],500);assert.equal(t.amountBands.withdraw.at(-1),100000);
 for(const key of ['startAt','endAt','successBasis','successStartAt','successEndAt','direction','status','providers','platformId'])assert.deepEqual(t[key],q[key],key+' unchanged');assert(h.L.results.every(r=>r._preparedPublication.sourceComplete===false));
 await trend(h);h.c.render();assert.equal(full(h).length,1);assert.equal(rateCount(h),1);
});
test('fee-only failure retains main facts and blocks trend instead of inventing default bands',async()=>{
 const h=await setup('merchants'),fee=deferred();h.setRate(()=>fee.promise);const run=h.c.liveQuery();await settle();const facts=JSON.stringify(h.L.results);await trend(h);fee.reject(Error('Synthetic fee unavailable'));await run;await settle();
 assert.equal(JSON.stringify(h.L.results),facts);assert.equal(h.L.amountBandProfiles,null);assert.equal(full(h).length,0);assert.equal(h.L.merchantTrend.status,'error');assert.match(h.L.merchantTrend.error,/fee unavailable/);assert.equal(rateCount(h),1);
 await h.c.liveMerchantTrend();await settle();assert.equal(full(h).length,0);assert.equal(rateCount(h),1,'trend retries do not silently retry rates');
});
test('explicit fee retry is not aborted or duplicated by an early trend click and resumes from its validated result',async()=>{
 const h=await setup('merchants');h.setRate(()=>Promise.reject(Error('Synthetic first failure')));await h.c.liveQuery();const facts=JSON.stringify(h.L.results),fee=deferred();h.setRate(()=>fee.promise);const retry=h.c.liveRetryFeeLookup();await settle();assert.equal(rateCount(h),2);assert.equal(h.L.feeLookupLoading,true);
 await trend(h);await trend(h);assert.equal(h.L.feeLookupLoading,true);assert.equal(full(h).length,0);assert.equal(rateCount(h),2);assert.equal(JSON.stringify(h.L.results),facts);
 fee.resolve(limits('Synthetic provider',400,40000));await retry;await settle();assert.equal(rateCount(h),2);assert.equal(full(h).length,1);assert.equal(full(h)[0].amountBands.charge[0],400);assert.equal(h.L.loadedView,'full');
});
test('failed explicit fee retry remains terminal and does not start trend or a hidden third rate read',async()=>{
 const h=await setup('merchants');h.setRate(()=>Promise.reject(Error('Synthetic first failure')));await h.c.liveQuery();const fee=deferred();h.setRate(()=>fee.promise);const retry=h.c.liveRetryFeeLookup();await settle();await trend(h);fee.reject(Error('Synthetic second failure'));await retry;await settle();assert.equal(rateCount(h),2);assert.equal(full(h).length,0);assert.equal(h.L.amountBandProfiles,null);assert.equal(h.L.merchantTrend.status,'error');assert.match(h.L.merchantTrend.error,/second failure/);
});
test('force refresh clears old profiles, keeps main first and derives trend from one new validated directory',async()=>{
 const h=await setup('merchants');h.setRate(()=>feeRows('Synthetic provider'));await h.c.liveQuery();assert.equal(bands(h).charge.edges[0],250);const fee=deferred();h.setRate(()=>fee.promise);const before=h.requests().length,run=h.c.liveQuery(true);await settle();assert.equal(h.L.results.length,1);assert.equal(h.L.amountBandProfiles,null);assert.equal(rateCount(h),2);assert(h.requests().slice(before).every(q=>q.view==='providers'));await trend(h);assert.equal(full(h).length,0);
 fee.resolve(limits('Synthetic provider',500,50000));await run;await settle();assert.equal(rateCount(h),2);assert.equal(full(h)[0].amountBands.charge[0],500);assert.equal(full(h)[0].amountBands.charge.at(-1),50000);
});
test('ordinary repeated query reuses original exact rate snapshot without a second physical read',async()=>{
 const h=await setup('merchants');h.setRate(()=>feeRows('Synthetic provider'));await h.c.liveQuery();const original=bands(h),requestCount=h.requests().length;await h.c.liveQuery();assert.equal(rateCount(h),1);assert.deepEqual(bands(h),original);assert.equal(h.requests().length,requestCount);await trend(h);assert.equal(rateCount(h),1);assert.equal(full(h)[0].amountBands.charge[0],250);
});
for(const replacement of ['provider','date','account','native','page'])test('late merchant directory cannot deliver profiles or trend across '+replacement+' change',async()=>{
 const h=await setup('merchants'),old=deferred(),fresh=deferred();let n=0;h.setRate(()=>++n===1?old.promise:fresh.promise);const first=h.c.liveQuery();await settle();await trend(h);
 if(replacement==='page'){h.c.setPage('amount');old.resolve(limits('Synthetic provider',111,11111));await first;await settle();assert.equal(full(h).length,0);assert.notEqual(h.c.state.page,'merchants');return;}
 if(replacement==='account')h.c.hensemDataScope={mode:'selected',identity:'changed-account'};
 if(replacement==='native')h.L.catalog=h.L.catalog.map(p=>({...p,sourceName:'Changed native'}));
 h.c.liveSet(replacement==='date'?'from':'provider',replacement==='date'?'2026-09-21T00:00:00':'Synthetic next');h.L.view='business';
 if(replacement==='native')h.setHandler(async q=>{if(q.action==='aggregatePrepared')return {version:2,items:q.requests.map(r=>{const item=ready(r);item.result.platform={...item.result.platform,sourceName:'Changed native'};return item;})};if(q.action==='rates')return fresh.promise;return {};});
 const second=h.c.liveQuery();await settle();assert.equal(h.L.amountBandProfiles,null);const currentFacts=JSON.stringify(h.L.results);old.resolve(limits('Synthetic provider',111,11111));await first;await settle();assert.equal(h.L.amountBandProfiles,null);assert.equal(JSON.stringify(h.L.results),currentFacts);assert.equal(full(h).length,0);
 fresh.resolve(limits(replacement==='date'?'Synthetic provider':'Synthetic next',600,60000));await second;await settle();assert.equal(h.L.amountBandProfiles.charge.edges[0],600);await trend(h);assert(full(h).length>0);assert(full(h).every(q=>q.amountBands.charge[0]===600));assert.equal(rateCount(h),2);
});
test('current supplementary permission denial preserves the established contract by clearing main facts',async()=>{
 const h=await setup('merchants'),fee=deferred();h.setRate(()=>fee.promise);const run=h.c.liveQuery();await settle();await trend(h);fee.reject(Object.assign(Error('Synthetic denied'),{code:'ADMIN_LIVE_PERMISSION_DENIED'}));await run;await settle();assert.equal(h.L.results.length,0);assert.equal(h.L.feeLookupRows,null);assert.equal(h.L.amountBandProfiles,null);assert.match(h.L.error,/权限/);assert.equal(full(h).length,0);
});
test('permission removal during explicit retry prevents a late rate snapshot and trend delivery',async()=>{
 const h=await setup('merchants');h.setRate(()=>Promise.reject(Error('Synthetic first failure')));await h.c.liveQuery();const fee=deferred();h.setRate(()=>fee.promise);const retry=h.c.liveRetryFeeLookup();await settle();await trend(h);h.c.hensemRoleAllowed=()=>false;fee.resolve(feeRows('Synthetic provider'));await retry;await settle();assert.equal(h.L.feeLookupRows,null);assert.equal(h.L.amountBandProfiles,null);assert.equal(full(h).length,0);
});
for(const options of [{provider:'',status:'all'},{status:'success'},{status:'pending'},{view:'trend'}])test('merchant original non-deferred path preserves bands and query behavior '+JSON.stringify(options),async()=>{
 const h=await setup('merchants',options),fee=deferred();if(options.view)h.L.view=options.view;h.setRate(()=>fee.promise);const run=h.c.liveQuery();await settle();if(options.provider===''){assert.equal(h.L.results.length,1);assert(h.L.amountBandProfiles);}else{assert.equal(h.requests().length,0);assert.equal(h.L.loading,true);}fee.resolve(feeRows('Synthetic provider'));await run;await settle();const q=mainRequests(h)[0];assert.equal(q.status,options.status||'all');assert.equal(q.view,options.provider===''?'providers':undefined);if(options.provider!==''){assert.equal(q.amountBands.charge[0],250);assert.equal(q.amountBands.withdraw.at(-1),100000);}assert.equal(rateCount(h),1);
});
test('a validated empty directory uses original explicit country-reference profile; failed page validation does not',async()=>{
 for(const valid of [true,false]){const h=await setup('merchants');h.setRate(()=>valid?{rows:[],total:0}:{rows:[],total:1});await h.c.liveQuery();await trend(h);if(valid){assert(h.L.amountBandProfiles);assert.equal(h.L.loadedView,'full');assert.equal(full(h).length,1);}else{assert.equal(h.L.amountBandProfiles,null);assert.equal(full(h).length,0);assert.match(h.L.merchantTrend.error,/目录不完整/);}assert.equal(rateCount(h),1);}
});
test('merchant snapshot restore retains its validated frozen profiles and performs no extra reads',async()=>{
 const h=await setup('merchants');h.setRate(()=>feeRows('Synthetic provider'));await h.c.liveQuery();const original=bands(h);h.c.setPage('time');h.c.setPage('merchants');assert.deepEqual(bands(h),original);const before=rateCount(h);await trend(h);assert.equal(full(h)[0].amountBands.charge[0],250);assert.equal(rateCount(h),before);
});
test('all pages of the original fee directory validate before trend can use its selected-provider ranges',async()=>{
 const h=await setup('merchants'),second=deferred();h.setRate(q=>q.offset===0?{rows:feeRows('Synthetic provider').rows,total:2}:second.promise);const run=h.c.liveQuery();await settle();assert.equal(h.L.results.length,1);assert.equal(rateCount(h),2);assert.equal(h.L.feeLookupRows,null);assert.equal(h.L.amountBandProfiles,null);await trend(h);assert.equal(full(h).length,0);
 second.resolve({rows:limits('Synthetic provider',700,70000).rows,total:2});await run;await settle();assert.equal(rateCount(h),2);assert.equal(h.L.feeLookupRows.length,2);assert.equal(full(h).length,1);assert.equal(full(h)[0].amountBands.charge[0],250);assert.equal(full(h)[0].amountBands.charge.at(-1),70000);
});
for(const replacement of ['account','native','date','page'])test('explicit rate retry and deferred trend stop together on '+replacement+' replacement',async()=>{
 const h=await setup('merchants');h.setRate(()=>Promise.reject(Error('Synthetic first failure')));await h.c.liveQuery();const fee=deferred();h.setRate(()=>fee.promise);const retry=h.c.liveRetryFeeLookup();await settle();await trend(h);
 if(replacement==='account')h.c.hensemDataScope={mode:'selected',identity:'new retry authority'};
 else if(replacement==='native')h.L.catalog=h.L.catalog.map(p=>({...p,sourceName:'New retry native'}));
 else if(replacement==='date')h.c.liveSet('from','2026-09-21T00:00:00');
 else h.c.setPage('time');
 fee.resolve(limits('Synthetic provider',999,99999));await retry;await settle();assert.equal(h.L.feeLookupRows,null);assert.equal(h.L.amountBandProfiles,null);assert.equal(full(h).length,0);assert.equal(rateCount(h),2);
});
for(const replacement of ['account','native','view','date'])test('late full trend response cannot replace main facts after '+replacement+' changes',async()=>{
 const h=await setup('merchants');h.setRate(()=>feeRows('Synthetic provider'));await h.c.liveQuery();const facts=JSON.stringify(h.L.results),late=deferred();h.setHandler(async q=>q.action==='aggregatePrepared'?q.requests.some(r=>r.view!=='providers')?late.promise:{version:2,items:q.requests.map(ready)}:q.action==='rates'?feeRows('Synthetic provider'):{});await trend(h);assert.equal(full(h).length,1);assert.equal(h.L.merchantTrend.status,'loading');
 if(replacement==='account')h.c.hensemDataScope={mode:'selected',identity:'new full authority'};
 else if(replacement==='native')h.L.catalog=h.L.catalog.map(p=>({...p,sourceName:'New full native'}));
 else if(replacement==='view')h.c.liveView('business');
 else h.c.liveSet('from','2026-09-21T00:00:00');
 const expected=JSON.stringify(h.L.results);late.resolve({version:2,items:full(h).map(ready)});await settle();assert.equal(JSON.stringify(h.L.results),expected);if(replacement!=='date')assert.equal(JSON.stringify(h.L.results),facts);assert.notEqual(h.L.loadedView,'full');assert.equal(rateCount(h),1);
});
test('expired directory is reread once on explicit query and cannot lend previous profiles while pending',async()=>{
 const h=await setup('merchants');h.setRate(()=>feeRows('Synthetic provider'));await h.c.liveQuery();h.setNow('2026-09-23T12:06:00Z');const fee=deferred();h.setRate(()=>fee.promise);const run=h.c.liveQuery();await settle();assert.equal(rateCount(h),2);assert.equal(h.L.amountBandProfiles,null);assert.equal(h.L.results.length,1);await trend(h);assert.equal(full(h).length,0);fee.resolve(limits('Synthetic provider',800,80000));await run;await settle();assert.equal(rateCount(h),2);assert.equal(full(h)[0].amountBands.charge[0],800);
});
