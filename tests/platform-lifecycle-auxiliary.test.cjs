const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=n=>fs.readFileSync(path.join(__dirname,'../admin-preview',n),'utf8');
const prefix=fs.readFileSync(path.join(__dirname,'admin-daily-comparison-ui.test.cjs'),'utf8').split(/\ntest\(/)[0].replaceAll('2026-10-04T04:','2026-10-22T04:').replace('.create({L,getPage:', '.create({lifecycle:options.lifecycle,lifecycleRevision:options.lifecycleRevision,L,getPage:');
const {harness:daily,P,Q,aggregate,day,manual,tick}=new Function('require','__dirname',prefix+';return {harness,P,Q,aggregate,day,manual,tick};')(require,__dirname);
const M={...P,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Synthetic inactive platform',source:'newar',sourceName:'SYNTHETIC_INACTIVE'};
const A={...Q,name:'Synthetic active platform',sourceName:'SYNTHETIC_ACTIVE'};
const e={targetId:M.id,source:M.source,sourceName:M.sourceName,scopeGroup:M.scopeGroup,country:M.country,currency:M.currency,timezone:M.timezone,evidenceKind:'user_confirmed_not_operating',confirmedFrom:'2026-10-01',confirmedThrough:'2026-10-05',operatingFrom:'2026-10-06'};
function evidence(){const c={Date,Intl};c.window=c;vm.runInNewContext(read('live-platform-lifecycle.js'),c);let identity='actorA';const model=c.HensemPlatformLifecycle.create({authority:()=>identity}),replace=(items=[e],revision='a')=>model.replace({platforms:[M,A],platformLifecycle:{version:1,revision:revision.repeat(32),items}});replace();return {model,replace,changeAuthority:()=>identity='actorB',lifecycle:(p,v)=>model.range(p,v.from,v.to,v.successFrom,v.successTo),lifecycleRevision:()=>model.revision()};}
function dailyFixture(options={}){const proof=evidence(),platforms=options.platforms||[M,A],h=daily({platforms,date:options.date||'2026-10-03',...proof,handler:q=>aggregate(platforms.find(p=>p.id===q.platformId),20),...options});return {...h,proof};}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};

test('daily comparison skips only exact inactive dates, keeps null cells, and removes false missing denominator',async()=>{
 const h=dailyFixture();await h.module.load();assert.equal(h.calls.length,2);assert(h.calls.every(q=>q.platformId===A.id));
 const m=h.module.model(),inactive=m.rows.find(r=>r.key===M.id);assert.equal(inactive.now.all_count,null);assert.equal(inactive.now.notOperating,true);assert.equal(m.now.all_count,20);assert.equal(m.now.partial,false);assert.equal(h.module.capture().status,'ready');assert.match(h.module.render(),/未营业/);assert.match(h.module.render(),/1 \/ 1/);assert.doesNotMatch(h.module.render(),/部分统计尚未准备/);
 await h.module.load();assert.equal(h.calls.length,4);assert(h.calls.every(q=>q.platformId===A.id),'an explicit query never retries declared inactive dates');assert(h.module.exportRows().some(row=>row.some(v=>String(v).includes('未营业'))));
});
test('daily opening-boundary comparison requires real operating-day data and compares only the common active cohort',async()=>{
 const h=dailyFixture({date:'2026-10-06'});await h.module.load();assert.deepEqual(h.calls.filter(q=>q.platformId===M.id).map(day),['2026-10-06']);const m=h.module.model();assert.equal(m.now.all_count,40);assert.equal(m.prior.all_count,20);assert.equal(m.comparison.count,1);assert.equal(m.comparison.current.all_count,20);assert.equal(m.comparison.previous.all_count,20);assert.equal(m.rows.find(r=>r.key===M.id).prior.all_count,null);
});
test('daily trends do not extrapolate inactivity into earlier unconfirmed dates or fill null points with zero',async()=>{
 const h=dailyFixture({date:'2026-10-06',platforms:[M]});await h.module.load();await h.module.loadTrend();assert.deepEqual(h.calls.map(day).sort(),['2026-09-29','2026-09-30','2026-10-06']);const s=h.module.capture();for(const d of ['2026-10-01','2026-10-05'])assert.equal(s.payments[d][M.id].status,'not_operating');assert.match(h.module.render(),/未营业/);
});
test('daily independent success window and mixed creation range cannot be skipped by inactive creation-day metadata',async()=>{
 const h=dailyFixture({platforms:[M]});Object.assign(h.L,{successFrom:'2026-10-06T00:00:00',successTo:'2026-10-06T23:59:59',successBasis:'success'});await h.module.load();assert.equal(h.calls.length,1);assert.equal(day(h.calls[0]),'2026-10-03');
 const cross=dailyFixture({platforms:[M],date:'2026-10-05'});cross.L.to='2026-10-06T23:59:59';await cross.module.load();assert(cross.calls.some(q=>day(q)==='2026-10-05'));
});
test('all inactive daily payments and workorders are not applicable, never synthetic zero or a retry loop',async()=>{
 const h=dailyFixture({platforms:[M]});await h.module.load();assert.equal(h.calls.length,0);assert.equal(h.module.model().now.all_count,null);assert.equal(h.module.capture().status,'ready');assert.match(h.module.render(),/未营业/);
 const w=manual(dailyFixture({platforms:[M]}));w.c.liveDailyDirection('workorder');await w.module.load();assert.equal(w.workCalls.length,0);assert.equal(w.module.model().now.all_count,null);assert.equal(w.module.capture().workStatus,'ready');
});
test('daily lifecycle revision and authority replacement invalidate retained annotations and old late results',async()=>{
 const h=dailyFixture();await h.module.load();h.module.render();h.proof.replace([],'b');assert.equal(h.module.model(),null);assert.doesNotMatch(h.module.render(),/live-retained-result/);await h.module.load();assert(h.calls.some(q=>q.platformId===M.id));
 const held=deferred(),old=dailyFixture();old.setHandler(()=>held.promise);const run=old.module.load();await tick();old.proof.changeAuthority();held.resolve(aggregate(A,999));await run;assert.equal(old.module.model(),null);assert.equal(old.module.canExport(),false);
});

const {create:members}=require('../admin-preview/live-member-counts.js');
function memberFixture(platforms=[M,A]){
 const proof=evidence(),L={country:'印度',from:'2026-10-03T00:00:00',to:'2026-10-03T23:59:59',successFrom:'',successTo:'',direction:'all',status:'all',dirty:false,multi:{}},calls=[],drawers=[];let handler,now=Date.parse('2026-10-22T04:30:00Z');
 const stamp=(v,end=false)=>new Date(Date.parse(v+'+05:30')+(end?1000:0)).toISOString();
 const response=q=>{const platform=platforms.find(p=>p.id===q.platformId),from=day(q),to=new Date(Date.parse(q.endAt)-1+330*60000).toISOString().slice(0,10),dates=[];for(let d=Date.parse(from);d<=Date.parse(to);d+=86400000)dates.push(new Date(d).toISOString().slice(0,10));return {platform,startAt:q.startAt,endAt:q.endAt,...(q.successBasis==='created'?{successBasis:'created'}:{}),rows:dates.flatMap(date=>['charge','withdraw'].map(direction=>({date,direction,created_member_count:10,success_member_count:5,created_order_count:20,success_order_count:10,created_missing_member_count:0,success_missing_member_count:0}))),capabilities:{memberIdentity:true,createdBasis:'created_at',successBasis:q.successBasis==='created'?'created_at_current_stored_status':'success_at',dedupe:'platform_local_date_direction_member',sourceCompletenessVerified:false,...(q.successBasis==='created'?{successCohort:'created_at_current_stored_status',independentSuccessWindow:false}:{})}};};
 const ui=members({L,E:String,C:String,N:String,...proof,accessContext:()=>proof.lifecycleRevision(),selected:()=>platforms,query:(p,action)=>({action,platformId:p.id,startAt:stamp(L.from),endAt:stamp(L.to,true),...(L.successFrom||L.successTo?{successBasis:'success',successStartAt:stamp(L.successFrom),successEndAt:stamp(L.successTo,true)}:{successBasis:'created'}),direction:L.direction,status:L.status,currency:p.currency}),request:q=>{calls.push(q);return handler?handler(q):Promise.resolve(response(q));},render(){},open:(title,body)=>drawers.push(body),now:()=>now});
 return {ui,L,calls,drawers,proof,response,setHandler:f=>handler=f};
}
test('member counts omit exact inactive window from reads and effective denominator while keeping financial/source evidence untouched',async()=>{
 const h=memberFixture();await h.ui.ensure();assert.equal(h.calls.length,1);assert.equal(h.calls[0].platformId,A.id);assert.match(h.ui.metric('withdraw'),/读取 1 \/ 1 平台/);assert.match(h.ui.metric('withdraw'),/未营业 1 平台/);assert.equal(h.ui.state.results[0].sourceCompletenessVerified,false);
 const inactive=h.ui.platformMetric(M.id,'withdraw');assert.equal(inactive.value,null);assert.equal(inactive.display,'未营业');assert.equal(inactive.coverage.complete,false);assert.equal(inactive.coverage.successOrderCount,null);assert.equal(inactive.coverage.sourceCompletenessVerified,false);
 const mixed=h.ui.platformMetric([M.id,A.id],'withdraw');assert.equal(mixed.value,5);assert.equal(mixed.coverage.expectedPlatforms,1);assert.equal(mixed.partial,false);assert.match(mixed.title,/未营业 1 平台/);h.ui.details();assert.match(h.drawers[0],/未营业/);assert.equal(h.calls.length,1);
});
test('all inactive member selections display unknown not zero and do not appear unsupported',async()=>{
 const h=memberFixture([M]);await h.ui.ensure();assert.equal(h.calls.length,0);assert.equal(h.ui.state.status,'ready');assert.match(h.ui.metric('charge'),/— \/ —/);assert.match(h.ui.metric('charge'),/未营业；人数不填零/);assert.doesNotMatch(h.ui.metric('charge'),/尚未接入会员明细/);await h.ui.load();assert.equal(h.calls.length,0);
});
test('member mixed creation days and explicit independent success dates still perform exact native reads',async()=>{
 const h=memberFixture([M]);h.L.from='2026-10-05T00:00:00';h.L.to='2026-10-06T23:59:59';await h.ui.ensure();assert.equal(h.calls.length,1);assert.equal(h.ui.state.results.length,1);
 const independent=memberFixture([M]);independent.L.successFrom='2026-10-06T00:00:00';independent.L.successTo='2026-10-06T23:59:59';await independent.ui.ensure();assert.equal(independent.calls.length,2);assert.equal(independent.ui.state.notOperating.length,0);
});
test('member metadata replacement changes query ownership, retains valid exact cache rules, and cannot accept a late old owner',async()=>{
 const h=memberFixture();await h.ui.ensure();const old=h.ui.capture();h.proof.replace([],'b');h.ui.restore(old);assert.match(h.ui.metric('charge'),/查询后显示人数/);await h.ui.ensure();assert(h.calls.some(q=>q.platformId===M.id));
 const late=memberFixture(),held=deferred();late.setHandler(()=>held.promise);const run=late.ui.ensure();await tick();late.proof.replace([],'b');held.resolve(late.response(late.calls[0]));await run;assert.equal(late.ui.state.results.length,0);await late.ui.ensure();assert(late.calls.some(q=>q.platformId===M.id));
});
test('member force, cancellation and permission failures preserve inactive evidence without inventing successful reads',async()=>{
 const h=memberFixture();await h.ui.ensure();await h.ui.load();assert.equal(h.calls.length,2);assert(h.calls.every(q=>q.platformId===A.id));
 const held=deferred();h.setHandler(()=>held.promise);const run=h.ui.load();await tick();h.ui.cancel();held.resolve(h.response(h.calls.at(-1)));await run;assert.equal(h.ui.state.status,'paused');assert.equal(h.ui.state.results.length,0);assert.equal(h.ui.state.notOperating.length,1);
 h.setHandler(()=>Promise.reject(Object.assign(Error('Synthetic denied'),{code:'ADMIN_LIVE_PERMISSION_DENIED'})));await h.ui.load();assert.equal(h.ui.state.results.length,0);assert.equal(h.ui.state.failures.length,1);assert.equal(h.ui.state.failures[0].id,A.id);assert.equal(h.ui.platformMetric(M.id,'charge').value,null);
});

const navPrefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness:controller,settle,completeAggregate}=new Function('require','__dirname',navPrefix+';return {harness,settle,completeAggregate};')(require,__dirname);
for(const page of ['daily_comparison','merchants'])test(page+' real shared controller supplies authorized metadata to its independent reader',async()=>{
 const m=memberFixture(),platforms=[M,A];
 const h=controller({page,platforms,roleAccess:{mode:'owner',canView:true},roleAllowed:()=>true,extraModules:['live-platform-lifecycle.js','live-member-counts.js','live-daily-comparison.js','live-statistic-windows.js','live-prepared-aggregates.js'],handler:q=>{
  if(q.action==='catalog')return {platforms,platformLifecycle:{version:1,revision:'a'.repeat(32),items:[e]}};
  if(q.action==='aggregatePrepared')return {version:q.publicationVersion||1,items:q.requests.map(request=>({request,status:'ready',publication:{id:'synthetic-'+request.platformId,generation:1,computedAt:'2026-10-22T04:00:00Z',expiresAt:'2026-10-22T04:40:00Z',cutoff:'2026-10-22T04:00:00Z',calculationComplete:true,sourceComplete:false,freshness:'fresh',refreshState:'idle'},result:{version:1,...completeAggregate(platforms.find(p=>p.id===request.platformId),10,5),startAt:request.startAt,endAt:request.endAt,successBasis:'created',capabilities:{successCohort:'created_at_current_stored_status',successMetricBasis:'created',independentSuccessWindow:false}}}))};
  if(q.action==='memberDaily')return m.response(q);
  if(q.action==='rates')return {rows:[],total:0};return {};
 }});await settle();h.setNow('2026-10-22T04:30:00Z');Object.assign(h.L,{from:'2026-10-03T00:00:00',to:'2026-10-03T23:59:59',successFrom:'',successTo:'',dirty:true});await h.c.liveQuery();await settle();
 const requests=h.calls.flatMap(q=>q.action==='aggregatePrepared'?q.requests:q.action==='memberDaily'?[q]:[]);assert(requests.length);assert(requests.every(q=>q.platformId===A.id));assert.match(h.html(),/未营业/);
 if(page==='merchants')assert.equal(h.calls.filter(q=>q.action==='memberDaily').length,1);
});
