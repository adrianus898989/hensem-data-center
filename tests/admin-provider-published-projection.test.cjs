/* Pure publication projection: real alias/submission modules, synthetic facts. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dir=path.join(__dirname,'../admin-preview'),context={structuredClone};
for(const file of ['live-provider-aliases.js','live-provider-published.js','live-submission-analysis.js'])vm.runInNewContext(fs.readFileSync(path.join(dir,file),'utf8'),context,{filename:file});
const api=context.HensemProviderPublished,clone=value=>JSON.parse(JSON.stringify(value));
const thresholds=[10,15,20,30,50,100],counts=['qualified_member_count','qualified_member_days','member_count','member_days','invalid_count','l0_members','new_members','funded_members','unknown_members'];
const platform={id:'11111111-1111-4111-8111-111111111111',source:'ar',sourceName:'Synthetic',scopeGroup:'IN',country:'印度',currency:'INR',timezone:'Asia/Kolkata'};
const window={startAt:'2026-10-13T18:30:00.000001Z',endAt:'2026-10-14T18:30:00.000001Z',previousStartAt:'2026-10-12T18:30:00.000001Z',previousEndAt:'2026-10-13T18:30:00.000001Z'};
function leaf(provider,n=10,money='100.01'){
 return {provider,direction:'charge',currency:'INR',all_count:n,success_count:2,pending_count:n-2,failed_count:0,rejected_count:0,unknown_count:0,missing_amount_count:0,negative_amount_count:0,created_success_count:2,all_amount:money,success_amount:'20.00',pending_amount:'80.01',failed_amount:'0',rejected_amount:'0',unknown_amount:'0',fee_version_estimated_amount:'0.5',fee_version_matched_count:2,fee_version_unmatched_count:0,fee_version_state:'complete'};
}
function metric(provider,n=1){return thresholds.map(threshold=>({provider,threshold,...Object.fromEntries(counts.map(key=>[key,0])),member_count:n,member_days:n,qualified_member_count:n,qualified_member_days:n,invalid_count:n*2,invalid_amount:'1.25'}));}
function fixture(){
 const orders=previous=>({version:1,platform,startAt:previous?window.previousStartAt:window.startAt,endAt:previous?window.previousEndAt:window.endAt,total:30,summary:[{...leaf(null,30),provider:undefined}],groups:{provider:[leaf('3TPay',10),leaf('T3Pay',20,'200.02')],hourly:[{hour:0,count:30}],daily:[],latency:[{count:30}]},rows:[],latencySummary:[{count:30}],pendingSummary:[{count:30}]});
 const submission={version:3,platform,startAt:window.startAt,endAt:window.endAt,basis:'platform_local_day_all_providers_zero_success_whole_day_over_threshold',exemptCount:0,thresholdComparison:'gt',metrics:[...metric(null,2),...metric('3TPay',1),...metric('T3Pay',2)],coverage:{orderCount:30,calculationComplete:true,missingMemberCount:0,unknownStatusCount:0,orderSequenceUncertainCount:0,coverageUnknownDays:0},dashboard:null};
 return {version:1,status:'ready',complete:true,window:{...window},platforms:[{platform,current:{orders:orders(false),submission,intake:{platform,rows:[{status:'received'}]}},previous:{orders:orders(true),intake:{platform,rows:[{status:'received'}]}},snapshots:[{component:'orders',snapshotId:'one'}]}],missing:[]};
}
function deepFreeze(value){if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(deepFreeze);}return value;}
test('all providers is an unchanged base publication with no supplementary work',()=>{
 const b=fixture(),result=api.project(b,[]);assert.equal(result.bundle,b);assert.equal(result.projectionComplete,true);assert.deepEqual(clone(result.unresolvedSubmissions),[]);
});
test('single exact provider projects current/prior amounts, counts, totals and distinct metrics without changing base',()=>{
 const b=deepFreeze(fixture()),before=JSON.stringify(b),result=api.project(b,['3tpayinr']);assert.equal(result.projectionComplete,true);assert.deepEqual(clone(result.providers),['3TPay']);
 for(const period of ['current','previous']){const o=result.bundle.platforms[0][period].orders;assert.equal(o.total,10);assert.equal(o.summary[0].all_count,10);assert.equal(o.summary[0].all_amount,'100.01');assert.deepEqual(clone(o.groups.provider.map(x=>x.provider)),['3TPay']);assert.equal(o.groups.provider[0].fee_version_estimated_amount,'0.5');assert.deepEqual(clone(o.groups.hourly),[]);assert.deepEqual(clone(o.latencySummary),[]);}
 const s=result.bundle.platforms[0].current.submission;assert.equal(s.metrics.find(x=>x.provider===null&&x.threshold===15).member_count,1);assert.equal(s.coverage.orderCount,10);assert.equal(s.dashboard,null);assert.equal(JSON.stringify(b),before);assert.deepEqual(result.bundle.platforms[0].current.intake,b.platforms[0].current.intake);assert.deepEqual(result.bundle.platforms[0].snapshots,b.platforms[0].snapshots);
});
test('3TPay and T3Pay remain different providers and countries use the approved exact aliases',()=>{
 const b=fixture(),a=api.project(b,['3TPay']),other=api.project(b,['t3pay']);assert.equal(a.bundle.platforms[0].current.orders.total,10);assert.equal(other.bundle.platforms[0].current.orders.total,20);assert.deepEqual(clone(other.providers),['T3Pay']);
});
test('decimal addition keeps large exact amounts and nullable money; preserves raw fee leaves',()=>{
 const b=fixture(),o=b.platforms[0].current.orders;o.groups.provider=[leaf('3TPay',10,'123456789012345678.123456'),leaf('3tpay-qr',20,'0.000004')];o.groups.provider[0].success_amount=null;const r=api.project(b,['3TPay']).bundle.platforms[0].current.orders;
 assert.equal(r.summary[0].all_amount,'123456789012345678.12346');assert.equal(r.summary[0].success_amount,null);assert.equal(r.total,30);assert.deepEqual(clone(r.groups.provider.map(x=>x.provider)),['3TPay','3tpay-qr']);assert.equal(r.groups.provider[1].fee_version_matched_count,2);
});
test('a complete empty provider keeps the platform and zero totals without borrowing other provider members',()=>{
 const b=fixture(),r=api.project(b,['Absent provider']);assert.equal(r.projectionComplete,true);assert.equal(r.bundle.platforms.length,1);const current=r.bundle.platforms[0].current;assert.equal(current.orders.total,0);assert.deepEqual(clone(current.orders.summary),[]);assert.equal(current.submission.metrics.find(x=>x.provider===null&&x.threshold===15).member_count,0);assert.equal(current.intake.rows[0].status,'received');
});
test('all source provider dimensions reuse the stored distinct union without adding overlapping members',()=>{
 const b=fixture(),r=api.project(b,['3TPay','T3Pay']);assert.equal(r.bundle.platforms[0].current.orders.total,30);assert.equal(r.projectionComplete,true);assert.equal(r.unresolvedSubmissions.length,0);assert.equal(r.bundle.platforms[0].current.submission.metrics.find(x=>x.provider===null&&x.threshold===15).member_count,2);
});
test('proper multi-provider subset retains exact rows but leaves the overlapping union unavailable',()=>{
 const b=fixture();b.platforms[0].current.submission.metrics.push(...metric('OtherPay',1));const r=api.project(b,['3TPay','T3Pay']),s=r.bundle.platforms[0].current.submission;
 assert.equal(r.projectionComplete,false);assert.equal(r.unresolvedSubmissions[0].reason,'provider_member_union_required');assert.equal(Object.hasOwn(r.unresolvedSubmissions[0],'request'),false);assert.equal(s.metrics.some(x=>x.provider===null),false);assert.deepEqual(clone(s.publishedProjection.unavailableProviders),[null]);assert.equal(s.metrics.find(x=>x.provider==='3TPay'&&x.threshold===15).member_count,1);assert.equal(s.metrics.find(x=>x.provider==='T3Pay'&&x.threshold===15).member_count,2);
});
test('multiple historical metric aliases cannot add distinct counts even for one canonical provider',()=>{
 const b=fixture();b.platforms[0].current.submission.metrics.push(...metric('3tpay-qr',1));const r=api.project(b,['3TPay']);assert.equal(r.projectionComplete,false);assert.equal(r.unresolvedSubmissions[0].reason,'provider_alias_union_required');assert.deepEqual(clone(r.bundle.platforms[0].current.submission.publishedProjection.unavailableProviders),['3TPay',null]);assert.equal(r.bundle.platforms[0].current.submission.metrics.length,0);
});
test('incomplete calculation or missing provider metrics remain unresolved rather than fake zero',()=>{
 for(const mode of ['coverage','metrics','total']){const b=fixture(),s=b.platforms[0].current.submission;if(mode==='coverage')s.coverage.missingMemberCount=1;else s.metrics=s.metrics.filter(m=>mode==='metrics'?m.provider!=='3TPay':!(m.provider===null&&m.threshold===15));const r=api.project(b,['3TPay']);assert.equal(r.projectionComplete,false,mode);assert.ok(r.bundle.platforms[0].current.submission.publishedProjection.unavailableProviders.includes('3TPay'),mode);assert.equal(r.bundle.platforms[0].current.orders.total,10);}
});
test('missing source artifact is not relabelled as computed zero or complete publication',()=>{
 const b=fixture();b.complete=false;b.status='missing';b.platforms[0].current.submission=null;b.platforms[0].current.orders=null;const r=api.project(b,['3TPay']);assert.equal(r.bundle.complete,false);assert.equal(r.bundle.platforms[0].current.orders,null);assert.equal(r.bundle.platforms[0].current.submission,null);
});
test('provider selection no longer disqualifies an otherwise supported native publication',()=>{
 const L={direction:'charge',status:'all',from:'2026-10-14T00:00:00',to:'2026-10-14T23:59:59'};assert.equal(api.eligible({page:'providers',L,platforms:[platform],visible:[platform],providers:['3TPay'],now:Date.parse('2026-10-15T00:00:00Z')}),true);assert.equal(api.eligible({page:'providers',L:{...L,memberId:'specific'},platforms:[platform],visible:[platform],providers:['3TPay'],now:Date.parse('2026-10-15T00:00:00Z')}),false);
});
function helper(){return context.HensemSubmissionAnalysis.create({L:{},E:String,C:String,N:String,accessContext:()=> 'actor-scope',isPublished:()=>true,request:()=>{throw Error('published projection must never dispatch native requests')}});}
test('applyPublished preserves provider drilldown scope and validates exact publication microseconds',()=>{
 const projection=api.project(fixture(),['3TPay','T3Pay']),h=helper();h.applyPublished(projection.bundle,[platform],{providers:projection.providers});const state=h.capture();assert.deepEqual(clone(state.items[0].request.providers),['3TPay','T3Pay']);assert.equal(h.metric().member_count,2);assert.equal(h.metric().complete,true);
 projection.bundle.platforms[0].current.submission.endAt='2026-10-14T18:30:00.000002Z';assert.throws(()=>h.applyPublished(projection.bundle,[platform],{providers:projection.providers}),/范围不一致/);
});
test('unresolved union stays unavailable while provider cells retain exact cached metrics',()=>{
 const b=fixture();b.platforms[0].current.submission.metrics.push(...metric('OtherPay',1));const r=api.project(b,['3TPay','T3Pay']),h=helper();h.applyPublished(r.bundle,[platform],{providers:r.providers});
 assert.equal(h.capture().results.length,1);assert.equal(h.metric().available,false);assert.equal(h.metric().complete,false);assert.equal(h.metric().member_count,null);assert.equal(h.metric('3TPay').member_count,1);assert.equal(h.metric('T3Pay').member_count,2);assert.equal(h.metric('3TPay').complete,true);assert.match(h.providerCell(null,[platform.id],'members',2,30),/>—<\/span>/);assert.match(h.providerCell('3TPay',[platform.id],'members',2,10),/>1<\/span>/);
});
test('ambiguous provider stays unavailable and cannot borrow a zero or whole-platform total',()=>{
 const b=fixture();b.platforms[0].current.submission.metrics.push(...metric('3tpay-qr',1));const r=api.project(b,['3TPay']),h=helper();h.applyPublished(r.bundle,[platform],{providers:r.providers});assert.equal(h.metric('3TPay').available,false);assert.equal(h.metric('3TPay').member_count,null);assert.match(h.providerCell('3TPay',[platform.id],'invalid',2,10),/>—<\/span>/);
});
test('projection metadata cannot hide missing exact provider rows or include unrelated values',()=>{
 const r=api.project(fixture(),['3TPay']),h=helper(),s=r.bundle.platforms[0].current.submission;s.metrics=s.metrics.filter(m=>m.provider===null);assert.throws(()=>h.applyPublished(r.bundle,[platform],{providers:r.providers}),/范围不完整/);
 const valid=api.project(fixture(),['3TPay']);assert.throws(()=>h.applyPublished(valid.bundle,[platform],{providers:['T3Pay']}),/范围不完整/);
});
