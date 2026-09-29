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
