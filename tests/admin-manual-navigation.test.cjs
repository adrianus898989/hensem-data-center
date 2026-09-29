const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle}=new Function('require','__dirname',prefix+';return {harness,settle};')(require,__dirname);
test('every initial page loads only selection metadata and waits for an explicit data query',async()=>{
 const routes=harness().c.pages.map(p=>p[0]);
 for(const page of routes){const h=harness({page,submission:true,reports:true});await settle();h.c.render();await settle();assert.deepEqual(h.calls.filter(q=>q.action!=='catalog'),[],page);assert.equal(h.L.loading,false,page);assert.equal(h.L.pageQueried,false,page)}
});
test('opening every menu from a queried page never reads business data or resumes a stopped query',async()=>{
 const h=harness({submission:true,reports:true});await settle();await h.c.liveQuery();await settle();
 const pages=h.c.pages.map(p=>p[0]),before=h.calls.length;
 for(const page of pages){h.c.setPage(page);h.c.liveCloseOtherPages();h.c.render();await settle();assert.equal(h.calls.length,before,page)}
});
test('amount, time, matrix and risk query only after the user submits, retaining completed results on return',async()=>{
 for(const page of ['amount','time','matrix','risk','providers','provider_payout']){
  const h=harness({page});await settle();assert.deepEqual(h.calls.map(q=>q.action),['catalog']);assert.match(h.html(),/点击查询/);
  h.c.livePeriod('before');h.c.livePeriod('week');await h.c.liveLoad();await settle();assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);
  await h.c.liveQuery();await settle();assert(h.L.results.length,page);const results=h.L.results,before=h.calls.length;
  h.c.setPage('data_health');h.c.setPage(page);await settle();assert.equal(h.L.results,results);assert.equal(h.calls.length,before,page);
 }
});
test('platform order links prefill the chosen scope without querying, including a previously queried Orders tab',async()=>{
 const h=harness();await settle();const id=h.L.catalog[0].id;
 h.c.liveChoosePlatform(id);await settle();assert.equal(h.c.state.page,'orders');assert.equal(h.L.platform,id);assert.equal(h.L.pageQueried,false);assert.equal(h.calls.filter(q=>q.action!=='catalog').length,0);assert.match(h.html(),/点击查询/);
 await h.c.liveQuery();await settle();assert(h.L.detail);h.c.setPage('overview');h.L.from='2026-09-20T00:00:00';const n=h.calls.length;
 h.c.liveChoosePlatform(id);await settle();assert.equal(h.calls.length,n);assert.equal(h.L.from,'2026-09-20T00:00:00');assert.equal(h.L.detail,null);assert.equal(h.L.pageQueried,false);
});
test('withdrawal quick dates, reset, sort and page size never initiate an unsubmitted query',async()=>{
 for(const page of ['auto_withdraw','withdraw_operators']){
  const h=harness({page});await settle();const n=h.calls.length;assert.match(h.html(),/点击查询/);assert.doesNotMatch(h.html(),/正在准备|正在读取/);
  for(const mode of ['today','yesterday','before','week','lastweek','month','lastmonth'])h.c.withdrawPeriod(mode);
  h.c.withdrawShift(-1);h.c.withdrawShift(1);h.c.withdrawReset();h.c.withdrawSort('total');h.c.withdrawSize(50);await settle();assert.equal(h.calls.length,n,page);assert.match(h.html(),/查询/);
  await h.c.liveQuery();await settle();assert(h.calls.length>n,page+' explicit Query starts reading');
 }
});
test('workorder records, original orders and daily tabs wait for Query, and reset is also local',async()=>{
 const h=harness({page:'workorders'});await settle();const n=h.calls.length;
 for(const mode of ['orders','records','daily','orders']){h.c.workorderOperationsMode(mode);await settle();assert.equal(h.calls.length,n,mode)}
 h.c.workorderOperationsSize(50);h.c.workorderOperationsPage(1);h.c.workorderOperationsReset();await settle();assert.equal(h.calls.length,n);
 await h.c.liveQuery();await settle();assert(h.calls.some(q=>q.action==='workorderRecords'));
});
test('deposit statistics tabs and reset only change the selected view until Query',async()=>{
 for(const page of ['deposit_tracking','deposit_statistics']){
  const h=harness({page});await settle();const n=h.calls.length;
  for(const section of ['summary','details','providers','daily'])h.c.depositIssuesSection(section);
  h.c.depositIssuesReset();h.c.depositIssuesSize(50);h.c.depositIssuesPage(1);await settle();assert.equal(h.calls.length,n,page);assert.match(h.html(),/点击查询/);
  await h.c.liveQuery();await settle();assert(h.calls.some(q=>q.action===(page==='deposit_tracking'?'depositIssues':'depositStatistics')));
 }
});
test('configuration deep links and source tabs wait for a manual query and never choose a default over the target',async()=>{
 const h=harness();await settle();const n=h.calls.length,api=h.c.HensemLivePayoutConfig;
 api.openTarget({system:'AR',country:'IN',platform:'SYNTHETIC_CONFIG_PLATFORM'});h.c.setPage('payout_config');await settle();assert.equal(h.calls.length,n);assert.match(h.html(),/IN \/ SYNTHETIC_CONFIG_PLATFORM/);
 await h.c.liveQuery();await settle();assert.equal(api.state().platform,'SYNTHETIC_CONFIG_PLATFORM');const before=h.calls.length;
 api.selectSystem(1);await settle();assert.equal(h.calls.length,before);assert.equal(api.state().snapshotStatus,'idle');assert.match(h.html(),/点击查询/);
});
test('leaving configuration during its directory query prevents the next snapshot query from starting',async()=>{
 const h=harness({page:'payout_config'});await settle();let resolveIndex;
 h.setHandler(q=>q.action==='payoutConfig'?new Promise(resolve=>{resolveIndex=resolve}):{rows:[],total:0});
 const pending=h.c.liveQuery();await settle();assert(resolveIndex);h.c.setPage('amount');const n=h.calls.length;
 resolveIndex({version:1,system:'AR',readOnly:true,targets:[{platform:'PRIVATE_CONFIG',country_code:'IN'}],summaries:[]});await pending;await settle();assert.equal(h.calls.length,n);assert(!h.calls.some(q=>q.operation==='snapshot'));h.c.setPage('payout_config');await settle();assert.equal(h.calls.length,n);
});
