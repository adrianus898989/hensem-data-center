const test = require('node:test');
const assert = require('node:assert/strict');
require('../admin-preview/live-hourly-rate-windows.js');
const {plan,combine}=globalThis.HensemHourlyRateWindows;
const date=n=>'2026-11-'+n+'T18:30:00Z';
const query={platformId:'a',currency:'INR',direction:'charge',providers:['Pay'],channelTypes:['Wallet'],
  amountMin:100,startAt:date('08'),endAt:date('09'),successBasis:'success',
  successStartAt:date('10'),successEndAt:date('11')};
const row=(all_count,success_count,hour,provider)=>({currency:'INR',direction:'charge',all_count,success_count,
  ...(hour===undefined?{}:{hour}),...(provider===undefined?{}:{provider})});
const read=(startAt,endAt,all,success,hour,provider)=>({platform:{id:'a'},startAt,endAt,providerHourMatrix:true,
  complete:true,hasMore:false,summary:[row(all,success)],groups:{hourly:[row(all,success,hour)],provider_hour:[row(all,success,hour,provider)]}});
const main={...query,platform:{id:'a'},complete:true,summary:[row(2,5)]};
const creation=read(query.startAt,query.endAt,2,41,7,'Pay');
const success=read(query.successStartAt,query.successEndAt,901,5,19,'Pay');

test('identical clocks use one request; distinct clocks keep each platform window and all non-date filters',()=>{
  const requests=plan(query,value=>value);
  assert.equal(requests.length,2);
  assert.deepEqual(requests.map(r=>[r.startAt,r.endAt]),[[date('08'),date('09')],[date('10'),date('11')]]);
  for(const r of requests){
    assert.equal(r.platformId,'a');assert.deepEqual(r.providers,['Pay']);assert.deepEqual(r.channelTypes,['Wallet']);
    assert.equal(r.amountMin,100);assert.equal(r.currency,'INR');assert.equal(r.successBasis,undefined);
  }
  assert.equal(plan({...query,successStartAt:query.startAt,successEndAt:query.endAt},v=>v).length,1);
  assert.equal(plan({startAt:date('08'),endAt:date('09'),successBasis:'created'},v=>v).length,1);
  assert.throws(()=>plan({...query,successBasis:'source_updated'},v=>v),/源更新时间/);
  assert.throws(()=>plan({...query,successStartAt:date('12')},v=>v),/范围不完整/);
});

test('independent windows keep creations at their local hour and successes at their own hour and permit more than 100%',()=>{
  const result=combine(query,main,creation,success);
  assert.deepEqual(result.summary,[row(2,5)]);
  assert.deepEqual(result.groups.hourly,[row(2,0,7),row(0,5,19)]);
  assert.deepEqual(result.groups.provider_hour,[row(2,0,7,'Pay'),row(0,5,19,'Pay')]);
  assert.equal(result.successBasis,'success');
});

test('other-leg-only activity does not produce phantom providers, and genuinely empty windows reconcile',()=>{
  const b=structuredClone(success);
  b.groups.provider_hour=[row(902,5,19,'Pay'),row(4,0,19,'OnlyCreatedLater')];
  b.groups.hourly=[row(906,5,19)];b.summary=[row(906,5)];
  assert.deepEqual(combine(query,main,creation,b).groups.provider_hour,[row(2,0,7,'Pay'),row(0,5,19,'Pay')]);
  const blank=source=>({...source,summary:[],groups:{hourly:[],provider_hour:[]}});
  const actual=combine(query,{...main,summary:[]},blank(creation),blank(success));
  assert.equal(actual.total,0);assert.deepEqual(actual.groups.hourly,[]);
});

test('native identity, window, split hourly/provider checks and main controls must all agree',()=>{
  for(const [m,a,b] of [
    [{...main,summary:[row(3,5)]},creation,success],
    [{...main,summary:[row(2,4)]},creation,success],
    [{...main,successBasis:'created'},creation,success],
    [main,{...creation,platform:{id:'other'}},success],
    [main,creation,{...success,startAt:query.startAt}],
    [main,creation,{...success,groups:{...success.groups,provider_hour:[row(901,6,19,'Pay')]}}],
    [main,creation,{...success,groups:{...success.groups,hourly:[row(901,null,19)]}}],
    [main,creation,{...success,groups:{...success.groups,provider_hour:[row(901,5,18,'Pay')]}}],
    [main,creation,{...success,summary:[{...row(901,5),currency:'USD'}]}],
    [main,creation,{...success,complete:false}]
  ]) assert.throws(()=>combine(query,m,a,b),/未对齐/);
});
const {closedIndiaDay,combineCreatedDay}=globalThis.HensemHourlyRateWindows;
const localPlatform={id:'a',timezone:'Asia/Kolkata'};
const closedQuery={platformId:'a',currency:'INR',direction:'all',status:'all',successBasis:'created',
  startAt:date('08'),endAt:date('09'),providers:['Pay'],amountMin:100};
const created=(all,success,hour,provider,direction='charge')=>({...row(all,success,hour,provider),
  direction,created_success_count:success});
const parent={platform:localPlatform,_preparedPublication:{status:'ready'},successBasis:'created',
  startAt:closedQuery.startAt,endAt:closedQuery.endAt,summary:[created(3,2),created(5,2,undefined,undefined,'withdraw')],
  groups:{hourly:[created(1,1,0),created(2,1,6),created(5,2,23,undefined,'withdraw')]}};
function slices(){
 return closedIndiaDay(closedQuery,parent,localPlatform).map((q,i)=>{
  const hour=[0,6,12,23][i],all=[1,2,0,5][i],success=[1,1,0,2][i],direction=i===3?'withdraw':'charge';
  return {platform:localPlatform,successBasis:'created',providerHourMatrix:true,complete:true,hasMore:false,
   startAt:q.startAt,endAt:q.endAt,summary:all?[created(all,success,undefined,undefined,direction)]:[],
   groups:{hourly:all?[created(all,success,hour,undefined,direction)]:[],
    provider_hour:all?[created(all,success,hour,'Pay',direction)]:[]}};
 });
}
test('exactly one closed India creation day, preserving native filters across four half-open six-hour windows',()=>{
 const s=closedIndiaDay(closedQuery,parent,localPlatform);
 assert.equal(s.length,4);assert.equal(Date.parse(s[0].startAt),Date.parse(closedQuery.startAt));
 assert.equal(Date.parse(s[3].endAt),Date.parse(closedQuery.endAt));
 for(let i=0;i<4;i++){
  assert.deepEqual(s[i].providers,['Pay']);assert.equal(s[i].amountMin,100);assert.equal(s[i].successBasis,'created');
  if(i)assert.equal(s[i-1].endAt,s[i].startAt);
 }
 for(const bad of [{currency:'USD'},{direction:'all',successStartAt:date('08')},{successBasis:'success'},
   {status:'success'},{endAt:date('10')},{startAt:'2026-11-08T18:30:00.001Z'}])
  assert.equal(closedIndiaDay({...closedQuery,...bad},parent,localPlatform),null);
 assert.equal(closedIndiaDay(closedQuery,parent,localPlatform,Date.parse(closedQuery.endAt)-1),null);
 assert.equal(closedIndiaDay(closedQuery,parent,{...localPlatform,timezone:'UTC'}),null);
 assert.equal(closedIndiaDay(closedQuery,{...parent,_preparedPublication:undefined},localPlatform),null);
 assert.equal(closedIndiaDay(closedQuery,{...parent,complete:false},localPlatform),null);
});
test('reconcile all three metrics per direction, currency and local hour before publishing; reject spillover or source drift',()=>{
 const got=combineCreatedDay(closedQuery,parent,slices());
 assert.deepEqual(got.summary,parent.summary);assert.equal(got.total,8);assert.equal(got.groups.provider_hour.length,3);
 assert.deepEqual(got.groups.hourly,parent.groups.hourly);
 for(const bad of [p=>p.pop(),p=>{p[2]=p[1]},p=>{p[0].groups.provider_hour.push(p[0].groups.provider_hour[0])},
   p=>{p[0].groups.hourly[0].hour=7;p[0].groups.provider_hour[0].hour=7},p=>{p[1].summary[0].created_success_count=null},
   p=>{p[2].complete=false},p=>{p[3].groups.provider_hour[0].currency='USD'},p=>{p[1].summary[0].success_count=0}]){
  const parts=slices();bad(parts);assert.throws(()=>combineCreatedDay(closedQuery,parent,parts),/未对齐/);
 }
 const next=structuredClone(parent);next.summary[0]=created(3,3);
 assert.throws(()=>combineCreatedDay(closedQuery,next,slices()),/未对齐/);
 const changedHour=structuredClone(parent);changedHour.groups.hourly[0].hour=1;
 assert.throws(()=>combineCreatedDay(closedQuery,changedHour,slices()),/未对齐/);
});

const amountBands = {charge:[100,200,300,400,500,1000,2000,5000,10000,20000,50000]};
const band = (total, success, bucket, provider) => ({
  ...row(total, success), ...(bucket===undefined?{}:{bucket}), ...(provider===undefined?{}:{provider})
});
const amountQuery = {...query, providerAmountMatrix:true, amountBands};
function amountLeg(startAt,endAt,total,success,bucket,provider) {
  return {platform:{id:'a'},startAt,endAt,complete:true,hasMore:false,providerAmountMatrix:true,amountBands,
    summary:[band(total,success)],groups:{amount_range:[band(total,success,bucket)],
      provider_amount_range:[band(total,success,bucket,provider)],provider:[band(total,success,undefined,provider)]}};
}
test('separate creation and success dates join by amount and provider including a success-only bucket',()=>{
  const a=amountLeg(query.startAt,query.endAt,2,40,'band:0','Pay');
  const b=amountLeg(query.successStartAt,query.successEndAt,900,5,'above','Pay');
  const aggregate={...main,amountBands,groups:{amount_range:[band(2,0,'band:0'),band(0,5,'above')],provider:[band(2,5,undefined,'Pay')]}};
  const merged=combine(amountQuery,aggregate,a,b);
  assert.equal(merged.providerAmountMatrix,true);assert.equal(merged.providerHourMatrix,undefined);
  assert.deepEqual(merged.groups.amount_range,aggregate.groups.amount_range);
  assert.deepEqual(merged.groups.provider_amount_range,[band(2,0,'band:0','Pay'),band(0,5,'above','Pay')]);
  const {verifyAmount}=globalThis.HensemHourlyRateWindows;
  assert.doesNotThrow(()=>verifyAmount(amountQuery,aggregate,merged));
  for(const broken of [
    {...merged,groups:{...merged.groups,provider_amount_range:[band(2,0,'band:1','Pay'),band(0,5,'above','Pay')]}},
    {...merged,groups:{...merged.groups,provider_amount_range:[band(2,0,'band:0','Unrelated'),band(0,5,'above','Unrelated')]}},
    {...merged,amountBands:{charge:[100,250,...amountBands.charge.slice(2)]}}
  ]) assert.throws(()=>verifyAmount(amountQuery,aggregate,broken));
  assert.throws(()=>combine(amountQuery,aggregate,a,{...b,amountBands:{charge:[200,300,...amountBands.charge.slice(2)]}}));
});

test('recovery sums the same provider and bucket across four disjoint slices and checks both direction totals',()=>{
  const q={...closedQuery,providerAmountMatrix:true,amountBands:{charge:amountBands.charge,withdraw:amountBands.charge}};
  const main={...parent,amountBands:q.amountBands,summary:[created(4,2),created(2,2,undefined,undefined,'withdraw')],
    groups:{amount_range:[{...created(4,2),bucket:'band:0'},{...created(2,2,undefined,undefined,'withdraw'),bucket:'above'}]}};
  const parts=closedIndiaDay(q,main,localPlatform).map((slice,i)=>{
    const direction=i===3?'withdraw':'charge',n=[1,2,1,2][i],s=[1,0,1,2][i],bucket=i===3?'above':'band:0';
    const summary=created(n,s,undefined,undefined,direction);
    return {platform:localPlatform,providerAmountMatrix:true,amountBands:q.amountBands,
      startAt:slice.startAt,endAt:slice.endAt,successBasis:'created',complete:true,hasMore:false,
      summary:[summary],groups:{amount_range:[{...summary,bucket}],provider_amount_range:[{...summary,bucket,provider:'Pay'}]}};
  });
  const merged=combineCreatedDay(q,main,parts);
  assert.deepEqual(merged.groups.amount_range,main.groups.amount_range);
  assert.deepEqual(merged.groups.provider_amount_range,main.groups.amount_range.map(r=>({...r,provider:'Pay'})));
  for(const broken of [
    {...parts[2],complete:false},
    {...parts[2],amountBands:{...q.amountBands,charge:[100,250,...amountBands.charge.slice(2)]}},
    {...parts[2],groups:{...parts[2].groups,provider_amount_range:[]}}
  ]) assert.throws(()=>combineCreatedDay(q,main,[parts[0],parts[1],broken,parts[3]]));
});
