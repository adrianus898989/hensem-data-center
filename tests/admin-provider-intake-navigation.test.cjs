/* Real live-data + intake modules with synthetic transport, never a real account. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
let shared=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
shared=shared.replace("'live-provider-summary.js'","'live-provider-summary.js','live-provider-intake.js'");
const {harness,settle,deferred,P,aggregate}=new Function('require','__dirname',shared+';return {harness,settle,deferred,P,aggregate};')(require,__dirname);
const feed={id:'synthetic-feed-charge',platformId:P.id,dataset:'orders',direction:'charge',timezone:P.timezone};
function intakeRows(q){const rows=[];for(let d=Date.parse(q.startAt);d<=Date.parse(q.endAt);d+=86400000)for(const feedId of q.feedIds)rows.push({feedId,date:new Date(d).toISOString().slice(0,10),status:'complete',received:true,complete:true,zeroConfirmed:false,expected:true,evidence:'source_created_counts_reconciled'});return {version:1,complete:true,feedIds:q.feedIds,startAt:q.startAt,endAt:q.endAt,checkedAt:'2026-09-23T12:00:00Z',rows};}
function respond(q){if(q.action==='catalog')return {platforms:[P]};if(q.action==='intakeCoverage')return q.operation==='catalog'?{version:1,complete:true,feeds:[feed]}:intakeRows(q);if(q.action==='rates')return {rows:[],total:0,options:{countries:[],platforms:[],providers:[]}};return aggregate();}
async function setup(handler=respond){const h=harness({page:'providers',handler});await settle();h.L.from='2026-09-22T00:00:00';h.L.to='2026-09-22T23:59:59';return h;}
const intakeCalls=h=>h.calls.filter(q=>q.action==='intakeCoverage');
test('entering providers and changing filters never reads intake until manual query; current and comparison use distinct dates',async()=>{
 const h=await setup();assert.equal(intakeCalls(h).length,0);await h.c.liveLoad(true);assert.equal(intakeCalls(h).length,0);
 h.c.liveSet('from','2026-09-21T00:00:00');h.c.liveSet('from','2026-09-22T00:00:00');await settle();assert.equal(intakeCalls(h).length,0);
 await h.c.liveQuery();await settle();assert.equal(h.L.providerIntake.status,'ready');assert.equal(h.L.providerComparisonIntake.status,'ready');
 assert.deepEqual(intakeCalls(h).filter(q=>q.operation==='rows').map(q=>[q.startAt,q.endAt]),[['2026-09-22','2026-09-22'],['2026-09-21','2026-09-21']]);assert.equal(intakeCalls(h).filter(q=>q.operation==='catalog').length,1);
 assert(intakeCalls(h).every(q=>!('provider' in q)&&!('providers' in q)&&!('memberId' in q)&&!('status' in q)));assert.match(h.html(),/>创建数据<\/small> 1 \/ 1/);
});
test('completed tab restores matching coverage without any new intake request',async()=>{
 const h=await setup();await h.c.liveQuery();await settle();const current=h.L.providerIntake,previous=h.L.providerComparisonIntake,readCount=intakeCalls(h).length;
 h.c.setPage('amount');await settle();h.c.setPage('providers');await settle();assert.equal(h.L.providerIntake,current);assert.equal(h.L.providerComparisonIntake,previous);assert.equal(intakeCalls(h).length,readCount);assert.equal(h.L.dirty,false);assert.match(h.html(),/>创建数据<\/small> 1 \/ 1/);
});
test('switching away during intake cancels later work and restores a paused notice, without automatic retry',async()=>{
 const pending=deferred();let held=false;const h=await setup(q=>{if(q.action==='intakeCoverage'&&q.operation==='rows'&&!held){held=true;return pending.promise;}return respond(q);});
 const query=h.c.liveQuery();await settle();assert.equal(h.L.providerIntake.status,'loading');const first=intakeCalls(h).find(q=>q.operation==='rows');
 h.c.setPage('amount');h.c.setPage('providers');await settle();assert.equal(h.L.providerIntake.status,'error');assert.match(h.L.providerIntake.error,/已暂停/);const before=intakeCalls(h).length;
 pending.resolve(intakeRows(first));await query;await settle();assert.equal(intakeCalls(h).length,before);assert.equal(h.L.providerIntake.status,'error');assert.equal(h.L.providerComparisonIntake,null);assert.match(h.html(),/采集核对已暂停/);
});
test('filter change during source query never commits evidence under a different selected range',async()=>{
 const pending=deferred();let held=false;const h=await setup(q=>{if(q.action==='intakeCoverage'&&q.operation==='rows'&&!held){held=true;return pending.promise;}return respond(q);});
 const query=h.c.liveQuery();await settle();const first=intakeCalls(h).find(q=>q.operation==='rows'),before=intakeCalls(h).length;h.c.liveSet('from','2026-09-20T00:00:00');
 pending.resolve(intakeRows(first));await query;await settle();assert.equal(h.L.dirty,true);assert.equal(h.L.from,'2026-09-20T00:00:00');assert.notEqual(h.L.providerIntake.status,'ready');assert.equal(intakeCalls(h).length,before);assert.match(h.html(),/查询/);
 await h.c.liveQuery();await settle();assert.equal(h.L.providerIntake.status,'ready');assert.equal(h.L.providerIntake.from,'2026-09-20');assert.equal(h.L.providerComparisonIntake.from,'2026-09-17');assert.equal(h.L.providerComparisonIntake.to,'2026-09-19');
});
