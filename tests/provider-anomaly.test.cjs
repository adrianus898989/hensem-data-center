const assert=require('node:assert/strict');
const test=require('node:test');
const path=require('node:path');
const {loadTs,root}=require('./load-typescript.cjs');
const risk=loadTs(path.join(root,'src/lib/providerAnomaly.ts'));
const client=loadTs(path.join(root,'src/lib/providerAnomalyClient.ts'));
const now=Date.parse('2026-09-19T12:00:00Z'),latestAt='2026-09-19T11:00:00Z',thresholds={...risk.DEFAULT_RISK_THRESHOLDS};
function source(patch={}) {return {key:'one',country:'印度',platform:'EK7',provider:'ArbPay',canonicalProvider:'ArbPay',currency:'INR',timezone:'Asia/Kolkata',
  delay:{coverage:1,latestAt,sample:100,p95Seconds:100},
  successDays:['2026-09-16','2026-09-17','2026-09-18'].map(date=>({date,total:100,success:90,coverage:1,latestAt})),
  share:{coverage:1,latestAt,sample:100,providerAmount:100,totalAmount:1000,denominatorKey:'EK7-INR'},
  midnight:{coverage:1,latestAt,verified:true,continuityVerified:true,date:'2026-09-18',count:0,amount:0,maxAgeDays:0,ageBuckets:[]},...patch};}
const metric=(row,key)=>row.metrics.find(m=>m.key===key);
function score(sources,custom={}){return risk.scoreProvider(sources,{...thresholds,...custom},now);}
test('green requires all four evidenced checks, zero pending is valid only with verified complete snapshot',()=>{
  const row=score([source()]);assert.equal(row.state,'normal');assert.equal(row.score,0);assert.equal(row.incomplete,false);
  for(const patch of [{delay:null},{share:null},{midnight:null},{successDays:[]}])assert.notEqual(score([source(patch)]).state,'normal');
  assert.equal(score([source({midnight:{...source().midnight,verified:false}})]).state,'unknown');
});
test('unknown coverage, low sample, stale and future timestamps never produce healthy status',()=>{
  for(const delay of [{...source().delay,coverage:null},{...source().delay,coverage:.90},{...source().delay,sample:99},{...source().delay,latestAt:'2026-09-01T00:00:00Z'},{...source().delay,latestAt:'2026-09-20T00:00:00Z'}]){
    const row=score([source({delay})]);assert.equal(metric(row,'delay').state,'unknown');assert.equal(row.state,'unknown');assert.equal(row.score,null);
  }
});
test('UPI-QR is exempt only from share; slow or recurring-low collection still alerts',()=>{
  const s=source({canonicalProvider:'UPI-QR',share:null,delay:{...source().delay,p95Seconds:3600}});
  const row=score([s]);assert.equal(metric(row,'share').state,'exempt');assert.equal(metric(row,'delay').state,'critical');assert.equal(row.state,'critical');
  const low=score([source({canonicalProvider:'UPI-QR',successDays:source().successDays.map(d=>({...d,success:20}))})]);assert.equal(metric(low,'rate').state,'critical');
});
test('rates use weighted counts and require repeated bad days, not the average of percentages',()=>{
  const a=source({successDays:source().successDays.map(d=>({...d,total:100,success:0}))});
  const b=source({key:'two',platform:'GEM7',successDays:source().successDays.map(d=>({...d,total:900,success:900})),share:{...source().share,denominatorKey:'GEM7-INR'}});
  assert.equal(metric(score([a,b]),'rate').value,'90.0%');assert.equal(metric(score([a,b]),'rate').state,'normal');
  const oneBad=source({successDays:source().successDays.map((d,i)=>({...d,success:i?90:0}))});assert.equal(metric(score([oneBad]),'rate').state,'normal');
});
test('missing source-day, invalid denominator or insufficient daily samples block green',()=>{
  for(const days of [source().successDays.slice(1),source().successDays.map(d=>({...d,success:101}))]){
    assert.equal(metric(score([source(),source({key:'two',successDays:days})]),'rate').state,'unknown');
  }
  assert.equal(metric(score([source({successDays:source().successDays.map(d=>({...d,total:5,success:4}))})]),'rate').state,'unknown');
});
test('known red evidence survives an unknown metric but remains marked incomplete',()=>{
  const row=score([source({delay:null,successDays:source().successDays.map(d=>({...d,success:20}))})]);
  assert.equal(row.state,'critical');assert.equal(row.score,100);assert.equal(row.incomplete,true);
});
test('amount denominators deduplicate raw aliases within same platform; currencies never sum',()=>{
  const a=source({share:{...source().share,providerAmount:200}}),b=source({key:'two',provider:'Arb-UPI',share:{...source().share,providerAmount:200}});
  assert.equal(metric(score([a,b]),'share').value,'40.0%');assert.equal(metric(score([a,b]),'share').state,'warning');
  assert.throws(()=>score([a,source({key:'two',currency:'PKR'})]),/币种/);
  const rows=risk.scoreProviders([a,source({key:'two',currency:'PKR'})],thresholds,now);assert.equal(rows.length,2);
  assert.equal(metric(score([source({currency:'未提供币种'})]),'share').state,'unknown');
});
test('inconsistent shared denominators and duplicate raw source rows are rejected conservatively',()=>{
  assert.equal(metric(score([source(),source({key:'two',share:{...source().share,totalAmount:2000}})]),'share').state,'unknown');
  assert.throws(()=>risk.scoreProviders([source(),source()],thresholds,now),/来源重复/);
});
test('latency percentiles are pooled by distribution, never averaged across sources',()=>{
  const bucket=(fast,slow)=>[{minSeconds:0,maxSeconds:600,count:fast},{minSeconds:600,maxSeconds:1800,count:0},{minSeconds:1800,maxSeconds:null,count:slow}];
  const a=source({delay:{...source().delay,p95Seconds:null,sample:100,buckets:bucket(0,100)}});
  const b=source({key:'two',delay:{...source().delay,p95Seconds:null,sample:9900,buckets:bucket(9900,0)}});
  const row=score([a,b]);assert.equal(metric(row,'delay').state,'normal');assert.match(metric(row,'delay').value,/0—10/);
  assert.match(metric(row,'delay').detail,/支付时间未接入/);assert.match(metric(row,'delay').detail,/不能据此判定掉单/);
});
test('bucket boundaries crossing configured thresholds or inconsistent counts cannot fabricate exact P95',()=>{
  const delay={...source().delay,p95Seconds:null,buckets:[{minSeconds:0,maxSeconds:600,count:100}]};
  assert.equal(metric(score([source({delay})],{delayWarningMinutes:5}),'delay').state,'unknown');
  assert.equal(metric(score([source({delay:{...delay,sample:101}})]),'delay').state,'unknown');
});
test('midnight requires aged counts, not many young orders combined with one old order',()=>{
  const midnight={...source().midnight,count:201,amount:2010,maxAgeDays:null,ageBuckets:[{minDays:0,maxDays:1,count:200,amount:2000},{minDays:7,maxDays:null,count:1,amount:10}]};
  assert.equal(metric(score([source({midnight})]),'midnight').state,'normal');
  const old={...midnight,count:100,amount:1000,ageBuckets:[{minDays:7,maxDays:null,count:100,amount:1000}]};
  assert.equal(metric(score([source({midnight:old})]),'midnight').state,'critical');
  assert.equal(metric(score([source({midnight:{...old,ageBuckets:[]}})]),'midnight').state,'unknown');
});
test('a midnight age bucket overlapping threshold stays unknown rather than inventing precise age',()=>{
  const midnight={...source().midnight,count:100,amount:1000,maxAgeDays:null,ageBuckets:[{minDays:1,maxDays:7,count:100,amount:1000}]};
  assert.equal(metric(score([source({midnight})]),'midnight').state,'unknown');
});
test('created-age buckets cannot assert continuous multi-day pending without order continuity evidence',()=>{
  const midnight={...source().midnight,count:200,amount:2000,continuityVerified:false,ageBuckets:[{minDays:7,maxDays:null,count:200,amount:2000}]};
  assert.equal(metric(score([source({midnight})]),'midnight').state,'unknown');
  assert.match(metric(score([source({midnight})]),'midnight').detail,/只有创建账龄/);
});
test('threshold settings are versioned, account-local and strictly validated',()=>{
  assert.notEqual(risk.riskSettingsKey('alice'),risk.riskSettingsKey('bob'));
  assert.match(risk.riskSettingsKey('alice'),/v1/);
  assert.deepEqual(risk.readRiskSettings('{broken'),thresholds);
  for(const patch of [{version:2},{minSample:0},{minSample:1.5},{minCoveragePercent:101},{maxAgeHours:Infinity},{rateWarningPercent:20},{shareWarningPercent:60},{pendingWarningCount:200}])assert.throws(()=>risk.validateRiskThresholds({...thresholds,...patch}));
  assert.equal(risk.readRiskSettings(JSON.stringify({...thresholds,minSample:200})).minSample,200);
});
function envelope(){return {version:1,generatedAt:latestAt,limitations:['完整度未接入'],sources:[{country:'香港',platform:'EK7',provider:'ArbPay2INR-Bank',currency:null,timezone:'Asia/Kolkata',
  createdSuccess:{basis:'created_to_success_proxy',sample:100,p95Seconds:null,delayBuckets:[{minSeconds:0,maxSeconds:60,count:100}],coverage:'unknown',latestAt},
  successDays:[{date:'2026-09-18',total:100,success:90,coverage:'complete',latestAt}],share:{coverage:'unknown',providerAmount:100,totalAmount:1000,sample:100,denominatorKey:'one',latestAt},
  midnight:{date:'2026-09-18',count:null,amount:null,maxAgeDays:null,ageBuckets:[],coverage:'unknown',latestAt:null,verified:false},midnightDays:[]}]};}
test('real response contract maps country aliases, preserves null amounts, and exposes service limitations',()=>{
  const report=client.validateAnomalyReport(envelope());assert.equal(report.sources[0].canonicalProvider,'UPI-QR');assert.equal(report.sources[0].currency,'未提供币种');
  assert.equal(report.sources[0].delay.coverage,null);assert.equal(report.sources[0].successDays[0].coverage,1);assert.equal(report.sources[0].midnight.count,null);
  assert.deepEqual(report.notices,['完整度未接入']);
});
test('invalid envelope or duplicate sources fails instead of displaying normal empty stats',()=>{
  for(const bad of [null,{}, {version:2,generatedAt:latestAt,sources:[]},{version:1,generatedAt:'bad',sources:[]}])assert.throws(()=>client.validateAnomalyReport(bad));
  const raw=envelope();raw.sources.push(raw.sources[0]);assert.throws(()=>client.validateAnomalyReport(raw),/来源重复/);
});
test('response date mismatch is rejected and silently omitted days become unknown, not removed from coverage',()=>{
  const range={startDate:'2026-09-16',endDate:'2026-09-18'},raw={...envelope(),...range};
  assert.throws(()=>client.validateAnomalyReport({...raw,endDate:'2026-09-17'},range),/范围/);
  const report=client.validateAnomalyReport(raw,range);assert.equal(report.sources[0].successDays.length,3);assert.equal(report.sources[0].successDays[0].total,null);
});
test('query is bounded and goes only to authenticated aggregate API, never ID detail search',()=>{
  assert.equal(client.anomalyQueryUrl({startDate:'2026-09-01',endDate:'2026-09-30'}),'/api/provider-anomalies?startDate=2026-09-01&endDate=2026-09-30');
  for(const range of [{startDate:'2026-09-31',endDate:'2026-10-01'},{startDate:'2026-09-18',endDate:'2026-09-17'},{startDate:'2026-08-01',endDate:'2026-09-17'}])assert.throws(()=>client.anomalyQueryUrl(range));
});
