/* Real published loader, provider projection and attachment modules; synthetic I/O only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-provider-published-navigation.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {setup,envelope,platform,utc,date,settle,deferred}=new Function('require','__dirname',prefix+';return {setup,envelope,platform,utc,date,settle,deferred};')(require,__dirname);
const copy=value=>JSON.parse(JSON.stringify(value));
const platforms18=()=>Array.from({length:18},(_,i)=>({...platform,id:(i+1).toString(16).padStart(8,'0')+'-1111-4111-8111-111111111111',name:'Synthetic platform '+i,sourceName:'SYNTHETIC_NATIVE_'+i}));
const requests=(h,action)=>h.calls.filter(q=>q.action===action);
const noSourceReads=h=>assert.equal(h.calls.filter(q=>q.action==='aggregate'||q.action==='submissionAnalysis').length,0);
const emptyWorkorders=()=>({rows:[],byProvider:[],total:0,summary:{},byDirection:{}});
function providerEnvelope(q,platforms=[platform],today=false){
 const b=envelope(q,platforms);
 for(const entry of b.platforms){
  for(const period of ['current','previous']){
   const r=entry[period].orders,first={...r.groups.provider[0],provider:'3TPayINR'},second={...first,provider:'WPay',all_amount:'2000.50',success_amount:'1200.30',pending_amount:'400.10',failed_amount:'400.10'};
   r.groups.provider=[first,second];r.total=10;
   r.summary=[{...r.summary[0],all_count:10,all_amount:'3000.75',success_count:6,created_success_count:6,success_amount:'1800.45',pending_count:2,pending_amount:'600.15',failed_count:2,failed_amount:'600.15'}];
  }
  const s=entry.current.submission,leaf=s.metrics.filter(m=>m.provider!==null);
  s.metrics=[...s.metrics.filter(m=>m.provider===null),...leaf.map(m=>({...m,provider:'3TPayINR'})),...leaf.map(m=>({...m,provider:'WPay'}))];
  s.coverage={...s.coverage,orderCount:10,missingMemberCount:0,unknownStatusCount:0,orderSequenceUncertainCount:0};
 }
 if(today){
  const day=q.startAt.slice(0,10),end=utc(day,10/24),priorEnd=utc(day,10/24-1),stamp=utc(day,10/24+1/1440);
  Object.assign(b,{publishedCutoff:end,cutoffEpochMs:Date.parse(end),computedAt:stamp,nextDueAt:utc(day,10.5/24)});
  Object.assign(b.window,{endAt:end,previousEndAt:priorEnd,localCutoff:day+'T10:00:00',previousLocalCutoff:date(day,-1)+'T10:00:00'});
  for(const p of b.platforms){p.current.orders.endAt=end;p.current.submission.endAt=end;p.current.intake.snapshotWindow.endAt=end;p.current.intake.checkedAt=stamp;p.current.intake.rows=[];p.previous.orders.endAt=priorEnd;p.previous.intake.snapshotWindow.endAt=priorEnd;p.previous.intake.checkedAt=stamp;for(const s of p.snapshots)Object.assign(s,{computedAt:stamp,sourceReadStartedAt:stamp,sourceReadCompletedAt:stamp,nextDueAt:b.nextDueAt});}
 }
 return b;
}
async function fixture(options={}){
 const platforms=options.platforms||[platform];let override=options.handler;
 const handler=q=>{const result=override?.(q);if(result!==undefined)return result;if(q.action==='providerSnapshot')return providerEnvelope(q,platforms.filter(p=>q.platformIds.includes(p.id)),options.today);if(q.action==='providerOptions')return {providers:['3TPay','WPay']};};
 const h=await setup({...options,platforms,handler});h.override=fn=>override=fn;
 if(options.today){h.setNow('2026-09-23T04:37:00Z');Object.assign(h.L,{from:'2026-09-23T00:00:00',to:'2026-09-23T23:59:59'});}
 return h;
}
function assertSelected(h,count=1){
 assert.equal(h.L.results.length,count);assert.equal(h.L.comparisonResults.length,count);
 for(const r of [...h.L.results,...h.L.comparisonResults]){assert.equal(r.total,5);assert.equal(r.summary[0].all_count,5);assert.equal(r.summary[0].all_amount,'1000.25');assert.equal(r.summary[0].success_amount,'600.15');assert.deepEqual(copy(r.groups.provider.map(g=>g.provider)),['3TPayINR']);}
 assert.deepEqual(copy(h.L.providerPublished.appliedProviders),['3TPay']);
}
function exportAppliedTable(h){
 h.nodes.get('page').querySelectorAll=()=>[{querySelectorAll:()=>[
  {cells:[{innerText:'统一三方'},{innerText:'全部金额'}]},
  ...h.L.results.flatMap(r=>r.groups.provider.map(row=>({cells:[{innerText:row.provider},{innerText:row.all_amount}]})))
 ]}];
}

test('18-platform base projects 3TPay locally; only one filtered workorder read is added, then repeat is network-free',async()=>{
 const h=await fixture({platforms:platforms18()});await h.c.liveQuery();const base=h.L.providerPublished.bundle,baseText=JSON.stringify(base),before=h.calls.length;
 assert.equal(h.L.results.length,18);assert(h.L.results.every(r=>r.total===10));
 h.c.liveProvider('3TPay');await h.c.liveQuery();assertSelected(h,18);
 assert.deepEqual(h.calls.slice(before).map(q=>q.action),['workorders']);assert.deepEqual(requests(h,'workorders').at(-1).providers,['3TPay']);assert.equal(requests(h,'providerSnapshot').length,1);
 assert.equal(h.L.providerPublished.bundle,base);assert.equal(JSON.stringify(base),baseText,'projection cannot mutate the reusable all-provider base');assert.equal(h.L.providerPublished.projectionComplete,true);noSourceReads(h);
 const after=h.calls.length;await h.c.liveQuery();assert.equal(h.calls.length,after);assertSelected(h,18);
 h.c.liveProvider('');await h.c.liveQuery();assert.equal(h.calls.length,after,'the complete all-provider workorder attachment is also reusable');assert(h.L.results.every(r=>r.total===10));
});

test('provider control changes retain the applied table and make export unavailable until Query',async()=>{
 const h=await fixture();await h.c.liveQuery();const base=h.L.providerPublished.bundle,view=h.L.providerPublished.view,before=h.calls.length;
 h.c.liveSet('provider','3TPay');await settle();assert.equal(h.calls.length,before);assert.equal(h.L.providerPublished.bundle,base);assert.equal(h.L.providerPublished.view,view);assert.equal(h.L.results[0].total,10);assert.equal(h.L.dirty,true);assert.match(h.html(),/筛选已修改/);
 exportAppliedTable(h);await h.c.liveExport();assert.equal(h.blobs.length,0);assert.equal(h.calls.length,before);
 await h.c.liveQuery();assertSelected(h);assert.equal(h.L.dirty,false);noSourceReads(h);
});

test('historical publication keeps its original five-minute TTL across provider changes; workorders retain their own 30-second TTL',async()=>{
 const h=await fixture();await h.c.liveQuery();const firstRead=h.L.providerPublished.readAt;
 h.c.liveProvider('3TPay');await h.c.liveQuery();const work=requests(h,'workorders').length;
 h.setNow('2026-09-23T12:00:29Z');await h.c.liveQuery();assert.equal(requests(h,'workorders').length,work);assert.equal(requests(h,'providerSnapshot').length,1);
 h.setNow('2026-09-23T12:00:30Z');await h.c.liveQuery();assert.equal(requests(h,'workorders').length,work+1);assert.equal(requests(h,'providerSnapshot').length,1);
 h.setNow('2026-09-23T12:04:59Z');await h.c.liveQuery();assert.equal(requests(h,'providerSnapshot').length,1);assert.equal(h.L.providerPublished.readAt,firstRead);
 h.setNow('2026-09-23T12:05:00Z');await h.c.liveQuery();assert.equal(requests(h,'providerSnapshot').length,2);assertSelected(h);noSourceReads(h);
});

test('v2 publication rechecks at 30 seconds; earlier artifact nextDueAt does not evict the still-valid local result',async()=>{
 for(const dueEarly of [false,true]){
  const h=await fixture({today:true,handler:q=>{if(q.action==='providerSnapshot'&&dueEarly){const b=providerEnvelope(q,[platform],true);b.nextDueAt='2026-09-23T04:37:10.000000Z';return b;}}});await h.c.liveQuery();h.c.liveProvider('3TPay');await h.c.liveQuery();const base=h.L.providerPublished.bundle;
  h.setNow(dueEarly?'2026-09-23T04:37:09Z':'2026-09-23T04:37:29Z');await h.c.liveQuery();assert.equal(requests(h,'providerSnapshot').length,1);assert.equal(h.L.providerPublished.bundle,base);
  h.setNow('2026-09-23T04:37:10Z');await h.c.liveQuery();assert.equal(requests(h,'providerSnapshot').length,1);h.setNow('2026-09-23T04:37:30Z');await h.c.liveQuery();assert.equal(requests(h,'providerSnapshot').length,2);assertSelected(h);assert.equal(h.L.providerPublished.appliedWindow.intraday,true);noSourceReads(h);
 }
});

test('explicit refresh replaces the base and rereads current attachments instead of reusing filter caches',async()=>{
 const h=await fixture();await h.c.liveQuery();h.c.liveProvider('3TPay');await h.c.liveQuery();const base=h.L.providerPublished.bundle,before=h.calls.length;
 await h.c.liveQuery(true);assert.notEqual(h.L.providerPublished.bundle,base);assert.deepEqual(h.calls.slice(before).map(q=>q.action),['providerSnapshot','intakeCoverage','rates','workorders']);assertSelected(h);noSourceReads(h);
});

test('actor, role version and native platform remapping cannot reuse another publication or attachment cache',async()=>{
 for(const change of ['actor','role','native']){
  const ps=[{...platform}],h=await fixture({platforms:ps});await h.c.liveQuery();h.c.liveProvider('3TPay');await h.c.liveQuery();const base=h.L.providerPublished.bundle;
  if(change==='actor')h.c.hensemDataScope={identity:'another-synthetic-owner',mode:'all'};
  if(change==='role')h.c.hensemRoleAccess={...h.c.hensemRoleAccess,version:2};
  if(change==='native'){ps[0].sourceName='SYNTHETIC_REMAPPED';h.L.catalog[0].sourceName=ps[0].sourceName;}
  h.c.render();assert.equal(h.L.providerPublished,null,change);assert.equal(h.L.results.length,0,change);const before=h.calls.length;
  await h.c.liveQuery();assert.equal(requests(h,'providerSnapshot').length,2,change);assert.notEqual(h.L.providerPublished.bundle,base,change);assert.deepEqual(h.calls.slice(before).map(q=>q.action),['providerSnapshot','intakeCoverage','rates','workorders'],change);assertSelected(h);noSourceReads(h);
 }
});

test('query permission removal clears the applied filter result and does not issue a request',async()=>{
 let allowed=true;const h=await fixture({roleAllowed:(_page,action)=>action!=='query'||allowed});await h.c.liveQuery();h.c.liveProvider('3TPay');await h.c.liveQuery();const before=h.calls.length;allowed=false;
 await h.c.liveQuery();assert.equal(h.L.providerPublished,null);assert.equal(h.L.results.length,0);assert.equal(h.calls.length,before);exportAppliedTable(h);await h.c.liveExport();assert.equal(h.blobs.length,0);
});

test('a current denial from a filtered workorder attachment discards the reusable publication',async()=>{
 const h=await fixture();await h.c.liveQuery();h.override(q=>{if(q.action==='workorders'&&q.providers?.length)throw Object.assign(Error('synthetic denial'),{code:'ADMIN_LIVE_PERMISSION_DENIED'});});h.c.liveProvider('3TPay');await h.c.liveQuery();assert.equal(h.L.providerPublished,null);assert.equal(h.L.results.length,0);noSourceReads(h);
});

test('liveProvider cancels a pending bundle: late success or denial cannot replace the newly queried provider',async()=>{
 for(const late of ['success','denial']){
  const h=await fixture(),pending=deferred();let heldRequest;h.override(q=>{if(q.action==='providerSnapshot'&&!heldRequest){heldRequest=copy(q);return pending.promise;}});
  const oldRead=h.c.liveQuery();await settle();assert(heldRequest);h.c.liveProvider('3TPay');assert.equal(h.L.dirty,true);await h.c.liveQuery();assertSelected(h);const applied=h.L.providerPublished;
  if(late==='success')pending.resolve(providerEnvelope(heldRequest));else pending.reject(Object.assign(Error('cancelled old denial'),{code:'ADMIN_LIVE_SESSION_DENIED'}));await oldRead;
  assert.equal(h.L.providerPublished,applied);assertSelected(h);assert.equal(requests(h,'providerSnapshot').length,2);assert.equal(requests(h,'workorders').length,1);noSourceReads(h);
 }
});

test('liveProvider cancels a pending filtered workorder: late success or denial cannot fill another provider scope',async()=>{
 for(const late of ['success','denial']){
  const h=await fixture();await h.c.liveQuery();const pending=deferred();h.override(q=>q.action==='workorders'&&q.providers?.includes('3TPay')?pending.promise:undefined);
  h.c.liveProvider('3TPay');const oldRead=h.c.liveQuery();await settle();assert.equal(h.L.providerPublished.loading,true);
  h.c.liveProvider('WPay');await h.c.liveQuery();const applied=h.L.providerPublished,work=h.L.workorders;assert.deepEqual(copy(applied.appliedProviders),['WPay']);
  if(late==='success')pending.resolve({...emptyWorkorders(),total:999});else pending.reject(Object.assign(Error('cancelled old denial'),{code:'ADMIN_LIVE_SESSION_DENIED'}));await oldRead;
  assert.equal(h.L.providerPublished,applied);assert.equal(h.L.workorders,work);assert.equal(h.L.workorders.total,0);assert.equal(requests(h,'providerSnapshot').length,1);assert(h.L.results[0].groups.provider.every(r=>r.provider==='WPay'));noSourceReads(h);
 }
});

test('filtered export verifies the applied base generation and exports the selected rows only',async()=>{
 const h=await fixture();await h.c.liveQuery();h.c.liveProvider('3TPay');await h.c.liveQuery();exportAppliedTable(h);const before=h.calls.length;
 await h.c.liveExport();assert.equal(h.blobs.length,1);assert.deepEqual(h.calls.slice(before).map(q=>q.action),['providerSnapshot']);assert.equal(h.calls.at(-1).export,true);assert.equal(h.calls.at(-1).providers,undefined,'verification checks the common base publication');
 const csv=await h.blobs[0].text();assert.match(csv,/3TPayINR/);assert.match(csv,/1000\.25/);assert.doesNotMatch(csv,/WPay|3000\.75/);assertSelected(h);
 h.override(q=>{if(q.action==='providerSnapshot'){const b=providerEnvelope(q);b.platforms[0].snapshots[0].snapshotId='aaaaaaaa-1111-4111-8111-111111111111';return b;}});await h.c.liveExport();assert.equal(h.blobs.length,1);assert.match(h.toasts.at(-1),/发布结果已变化/);assertSelected(h);noSourceReads(h);
});

test('unpublished multi-provider distinct unions do not trigger live fanout or become a complete export',async()=>{
 const ps=platforms18(),h=await fixture({platforms:ps,handler:q=>{if(q.action==='providerSnapshot'){const b=providerEnvelope(q,ps);for(const entry of b.platforms){for(const period of ['current','previous']){const r=entry[period].orders;r.groups.provider.push({...r.groups.provider[0],provider:'OtherPay'});r.total=15;r.summary=[{...r.summary[0],all_count:15,all_amount:'4001.00',success_count:9,created_success_count:9,success_amount:'2400.60',pending_count:3,pending_amount:'800.20',failed_count:3,failed_amount:'800.20'}];}const s=entry.current.submission;s.metrics.push(...s.metrics.filter(m=>m.provider==='WPay').map(m=>({...m,provider:'OtherPay'})));s.coverage.orderCount=15;}return b;}}});await h.c.liveQuery();const before=requests(h,'providerSnapshot').length;h.L.multi.provider=['3TPay','WPay'];h.L.provider='';h.L.dirty=true;
 await h.c.liveQuery();assert.equal(requests(h,'providerSnapshot').length,before);assert(h.L.results.every(r=>r.total===10));assert.equal(h.L.providerPublished.projectionComplete,false);assert.match(h.html(),/去重合计尚未发布/);noSourceReads(h);
 exportAppliedTable(h);const n=h.calls.length;await h.c.liveExport();assert.equal(h.blobs.length,0);assert.equal(h.calls.length,n);await h.c.liveQuery();assert.equal(h.calls.length,n);assert.equal(h.L.providerPublished.projectionComplete,false);
});

test('selecting every published provider dimension reuses its stored distinct union without source reads',async()=>{
 const h=await fixture();await h.c.liveQuery();h.L.multi.provider=['3TPay','WPay'];h.L.provider='';h.L.dirty=true;const before=requests(h,'providerSnapshot').length;
 await h.c.liveQuery();assert.equal(h.L.providerPublished.projectionComplete,true);assert.equal(h.L.results[0].total,10);assert.equal(requests(h,'providerSnapshot').length,before);noSourceReads(h);exportAppliedTable(h);await h.c.liveExport();assert.equal(h.blobs.length,1);
});

test('incomplete published provider metrics stay unknown on repeat and cannot trigger supplemental computation or export',async()=>{
 const h=await fixture({handler:q=>{if(q.action==='providerSnapshot'){const b=providerEnvelope(q);b.platforms[0].current.submission.coverage.calculationComplete=false;b.platforms[0].current.submission.coverage.coverageUnknownDays=1;return b;}}});
 await h.c.liveQuery();h.c.liveProvider('3TPay');await h.c.liveQuery();assertSelected(h);assert.equal(h.L.providerPublished.projectionComplete,false);assert.equal(Object.hasOwn(h.L.providerPublished,'attachments'),false,'published state no longer retains a second attachment cache');noSourceReads(h);
 exportAppliedTable(h);const n=h.calls.length;await h.c.liveExport();assert.equal(h.blobs.length,0);assert.equal(h.calls.length,n);await h.c.liveQuery();assert.equal(h.calls.length,n);assert.equal(h.L.providerPublished.projectionComplete,false);noSourceReads(h);
});

test('failed filtered workorder reads are retried and cannot become reusable complete attachments',async()=>{
 let failed=true;const h=await fixture({handler:q=>{if(q.action==='workorders'&&q.providers?.length&&failed)throw Error('synthetic unavailable');}});await h.c.liveQuery();h.c.liveProvider('3TPay');await h.c.liveQuery();assertSelected(h);assert.equal(h.L.workorders,null);assert.match(h.L.workordersError,/unavailable/);
 exportAppliedTable(h);await h.c.liveExport();assert.equal(h.blobs.length,0);const before=h.calls.length;failed=false;await h.c.liveQuery();assert.deepEqual(h.calls.slice(before).map(q=>q.action),['workorders']);assert.equal(h.L.workorders.total,0);const complete=h.calls.length;await h.c.liveQuery();assert.equal(h.calls.length,complete);noSourceReads(h);
});

test('changing provider while filtered export authorization is pending prevents the old file download',async()=>{
 const h=await fixture();await h.c.liveQuery();h.c.liveProvider('3TPay');await h.c.liveQuery();exportAppliedTable(h);const pending=deferred();let verification;
 h.override(q=>{if(q.action==='providerSnapshot'&&q.export){verification=copy(q);return pending.promise;}});const exporting=h.c.liveExport();await settle();assert(verification);
 h.c.liveProvider('WPay');pending.resolve(providerEnvelope(verification));await exporting;assert.equal(h.blobs.length,0);assert.equal(h.L.dirty,true);assert.equal(h.L.provider,'WPay');assert.deepEqual(copy(h.L.providerPublished.appliedProviders),['3TPay']);noSourceReads(h);
});
