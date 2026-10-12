/* Synthetic-only request-count regressions for local tables and server details. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {ready,settle,deferred,aggregate,P}=new Function('require','__dirname',prefix+';return {ready,settle,deferred,aggregate,P};')(require,__dirname);

test('loaded report and analysis table pagination never reloads aggregate reports or directory data',async()=>{
 for(const page of ['overview','collection','payout','providers','provider_payout','merchants','teamops','teamcountries','teamplatforms','risk','time','amount','matrix','provider_daily','latency']){
  const h=await ready({page});if(page==='overview')await h.c.liveQuery();await settle();const rows=h.L.results,serial=h.L.serial,queryNow=h.L.queryNow,calls=h.calls.length;
  h.c.livePageSize('50','local');h.c.livePage(2,'local');h.c.livePageSize('50','ref-analysis-state');h.c.livePage(2,'ref-analysis-state');await settle();
  assert.equal(h.calls.length,calls,page+' pagination must be local');assert.equal(h.L.results,rows,page+' retains the loaded report');assert.equal(h.L.serial,serial);assert.equal(h.L.queryNow,queryNow);
 }
});

test('local pagination does not opportunistically start idle member or fee reads',async()=>{
 let member;
 const h=await ready({page:'merchants',extraModules:['live-member-counts.js'],beforeLive:c=>{const create=c.HensemLiveMemberCounts.create;c.HensemLiveMemberCounts.create=options=>(member=create(options));}});
 await settle();member.restore(null);h.L.feeLookupRows=null;h.L.feeLookupError='';h.L.restoredPage=false;const calls=h.calls.length;
 h.c.livePageSize('50','ref-merchants');await settle();assert.equal(h.calls.length,calls,'changing visible rows is not permission to start supplementary queries');assert.equal(member.state.status,'idle');assert.equal(h.L.feeLookupRows,null);
});

test('local pagination does not resume a paused supplementary submission read',async()=>{
 let submission;
 const h=await ready({page:'providers',submission:true,beforeLive:c=>{const create=c.HensemSubmissionAnalysis.create;c.HensemSubmissionAnalysis.create=options=>(submission=create(options));}});
 const captured=submission.capture();captured.status='paused';submission.restore(captured);h.L.restoredPage=false;const calls=h.calls.length;
 h.c.livePageSize('50','local');await settle();assert.equal(h.calls.length,calls,'paging does not resume paused source reads');assert.equal(submission.capture().status,'paused');
});

test('overview pagination ignores paint visibility notifications but keeps lazy loading on later real scroll',async()=>{
 const h=await ready({page:'overview',observe:true});await h.c.liveQuery();await settle();const calls=h.calls.length,target={hasAttribute:name=>name==='data-live-overview-analysis'},old=h.observations.at(-1);
 h.c.livePageSize('50','ref-overview-platforms');await settle();const observer=h.observations.at(-1);old([{target,isIntersecting:true}]);observer([{target,isIntersecting:true}]);await settle();assert.equal(h.calls.length,calls,'stale callbacks and the first new visibility notification are only the local repaint');
 observer([{target,isIntersecting:false}]);await settle();assert.equal(h.calls.length,calls);observer([{target,isIntersecting:true}]);await settle();assert.equal(h.calls.length,calls+1,'actual later scrolling still activates the one missing aggregate');assert.equal(h.L.overviewSections.status,'ready');
});

test('real scrolling before the first pagination observer callback or within its visible band never strands lazy sections',async()=>{
 for(const beforeInitial of [true,false]){
  const h=await ready({page:'overview',observe:true});await h.c.liveQuery();await settle();const listeners=new Set();h.c.addEventListener=(type,fn)=>{if(type==='scroll')listeners.add(fn)};h.c.removeEventListener=(type,fn)=>listeners.delete(fn);const calls=h.calls.length,target={hasAttribute:name=>name==='data-live-overview-analysis'};h.nodes.get('page').querySelectorAll=()=>[target];
  h.c.livePageSize('50','ref-overview-platforms');const observer=h.observations.at(-1);assert.equal(listeners.size,1);
  if(!beforeInitial){observer([{target,isIntersecting:true}]);await settle();assert.equal(h.calls.length,calls);}
  // A no-op restoration is not a user scroll and must keep the read suppressed.
  for(const listener of listeners)listener();await settle();assert.equal(h.calls.length,calls);
  h.c.scrollY=25;for(const listener of [...listeners])listener();assert.equal(listeners.size,0);observer([{target,isIntersecting:true}]);await settle();assert.equal(h.calls.length,calls,'old observer entries stay stale after a real scroll');h.observations.at(-1)([{target,isIntersecting:true}]);await settle();assert.equal(h.calls.length,calls+1);assert.equal(h.L.overviewSections.status,'ready');
 }
});

test('shorter pagination layouts and both scroll restorations cannot activate lazy reports',async()=>{
 for(const initialMax of [600,900]){
  const h=await ready({page:'overview',observe:true});await h.c.liveQuery();await settle();const listeners=new Set(),frames=[];
  h.c.addEventListener=(type,fn)=>{if(type==='scroll')listeners.add(fn)};h.c.removeEventListener=(type,fn)=>listeners.delete(fn);h.c.requestAnimationFrame=fn=>frames.push(fn);
  let max=initialMax;const scroll=()=>{for(const listener of [...listeners])listener()};h.c.scrollTo=(x,y)=>{h.c.scrollX=x;h.c.scrollY=Math.min(y,max);scroll()};h.c.scrollY=800;
  const calls=h.calls.length,target={hasAttribute:name=>name==='data-live-overview-analysis'};h.nodes.get('page').querySelectorAll=()=>[target];
  h.c.livePageSize('20','ref-overview-platforms');const observer=h.observations.at(-1),observers=h.observations.length;
  assert.equal(h.c.scrollY,Math.min(800,max));assert.equal(listeners.size,1);scroll();observer([{target,isIntersecting:true}]);await settle();assert.equal(h.calls.length,calls);assert.equal(h.observations.length,observers,'the synchronous restoration clamp is not user scrolling');
  max=550;for(const frame of frames.splice(0))frame();assert.equal(h.c.scrollY,550);scroll();observer([{target,isIntersecting:false}]);observer([{target,isIntersecting:true}]);await settle();assert.equal(h.calls.length,calls,'rAF restoration and changed layout intersections never fetch another report');assert.equal(h.observations.length,observers);assert.equal(listeners.size,1);
  h.c.scrollY=500;scroll();assert.equal(listeners.size,0);observer([{target,isIntersecting:true}]);h.observations.at(-1)([{target,isIntersecting:true}]);await settle();assert.equal(h.calls.length,calls+1,'later genuine scrolling still reads the missing lazy report once');
 }
});

test('real server pagination requests only the target details page and leaves aggregate results intact',async()=>{
 const h=await ready({page:'orders'});h.c.liveSet('platform',P.id);await h.c.liveQuery();await settle();const results=h.L.results,serial=h.L.serial;let before=h.calls.length;
 h.c.livePageSize('50','server');await settle();assert.equal(h.calls.length,before+1);assert.equal(h.calls.at(-1).action,'details');assert.equal(h.calls.at(-1).offset,0);assert.equal(h.calls.at(-1).limit,50);assert.equal(h.L.results,results);assert.equal(h.L.serial,serial);
 before=h.calls.length;h.c.livePage(2,'server');await settle();assert.equal(h.calls.length,before+1);assert.equal(h.calls.at(-1).action,'details');assert.equal(h.calls.at(-1).offset,50);assert.equal(h.calls.at(-1).limit,50);assert.equal(h.L.results,results);
});

test('local paging neither cancels an already-running query nor adds requests to its cohort',async()=>{
 const h=await ready({page:'time'}),wait=deferred();h.setHandler(q=>q.action==='aggregate'?wait.promise:{rows:[],total:0});const run=h.c.liveQuery(true);await settle();const serial=h.L.serial,calls=h.calls.length;assert.equal(h.L.loading,true);
 h.c.scrollX=12;h.c.scrollY=345;h.c.livePageSize('50','local');h.c.livePage(2,'ref-analysis-state');await settle();assert.equal(h.calls.length,calls);assert.equal(h.L.serial,serial);assert.equal(h.L.loading,true);assert.equal(h.c.scrollX,12);assert.equal(h.c.scrollY,345);
 wait.resolve(aggregate(P,77));await run;await settle();assert.equal(h.L.loading,false);assert.equal(h.L.results[0].total,77);assert.equal(h.L.queryFailures.length,0);
});
