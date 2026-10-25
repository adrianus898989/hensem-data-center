/* Real frontend controller + compact server contract, using synthetic data only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const pre=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,completeAggregate,P}=new Function('require','__dirname',pre+';return {harness,settle,completeAggregate,P};')(require,__dirname);
const native={...P,sourceName:'Synthetic native'},groupsFor=(profile,q)=>profile==='amount-v1'?(q.amountBands?['amount','amount_range','provider']:['amount','provider']):profile==='time-v1'?['hourly','provider']:null;
function reply(q){return {version:2,items:q.requests.map(request=>{
 const result={...completeAggregate(native,10,5),version:1,startAt:request.startAt,endAt:request.endAt,...(request.successBasis==='created'?{successBasis:'created',capabilities:{successCohort:'created_at_current_stored_status',independentSuccessWindow:false}}:{successBasis:request.successBasis,successStartAt:request.successStartAt,successEndAt:request.successEndAt})};
 for(const key of ['amount_range','matrix_range'])result.groups[key]=[];const groups=groupsFor(q.responseProfile,request);
 const item={request,status:'ready',publication:{id:'synthetic-custom-'+(request.amountMin??'main'),generation:1,computedAt:'2026-09-23T11:59:00Z',expiresAt:'2026-09-23T12:09:00Z',cutoff:'2026-09-23T11:59:00Z',calculationComplete:true,sourceComplete:false,freshness:'fresh',refreshState:'idle'},result};
 if(groups){item.result.groups=Object.fromEntries(groups.map(key=>[key,result.groups[key]]));item.resultGroups={contract:'prepared-result-groups-v1',profile:q.responseProfile,groups};}return item;
 })};}
async function setup(page){const h=harness({page,platforms:[native],roleAccess:{mode:'owner',canView:true},roleAllowed:()=>true,extraModules:['live-statistic-windows.js','live-prepared-aggregates.js','live-matrix-custom-range.js']});await settle();Object.assign(h.L,{from:'2026-09-22T00:00:00',to:'2026-09-22T23:59:59',successFrom:'',successTo:''});h.setHandler(q=>q.action==='aggregatePrepared'?reply(q):q.action==='rates'?{rows:[],total:0}:{});await h.c.liveQuery();await settle();return h;}
for(const page of ['amount','matrix'])test(page+' custom interval reuses exact prepared cache while requesting the required hourly groups',async()=>{
 const h=await setup(page),main=JSON.stringify(h.L.results),start=h.calls.length;h.c.liveMatrixAmountSet('min','200');h.c.liveMatrixAmountSet('max','300');await h.c.liveMatrixAmountQuery();await settle();
 const reads=h.calls.slice(start).filter(q=>q.action==='aggregatePrepared');assert.equal(reads.length,1);assert.equal(reads[0].requests.length,1);const q=reads[0].requests[0];assert.equal(q.amountMin,200);assert.equal(q.amountMax,300);assert.equal(q.amountMaxExclusive,true);assert.equal(q.successBasis,'created');assert.equal(q.view,'full');assert.equal(reads[0].responseProfile,undefined,'custom consumers require hourly groups absent from amount-v1');
 assert.doesNotMatch(h.html(),/小时汇总未完整返回/);assert.match(h.html(),/50.00%/);assert.equal(JSON.stringify(h.L.results),main);assert.equal(h.calls.slice(start).filter(q=>q.action==='aggregate').length,0,'never raw-scan source orders');
 const after=h.calls.length;await h.c.liveMatrixAmountQuery();await settle();assert.equal(h.calls.length,after,'same exact custom filter uses the existing prepared completed cache');
 h.c.liveMatrixAmountSet('max','400');await h.c.liveMatrixAmountQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='aggregatePrepared'&&q.requests.some(r=>r.amountMax===400)).length,1,'different amount interval cannot reuse another interval');assert.equal(JSON.stringify(h.L.results),main);
});
