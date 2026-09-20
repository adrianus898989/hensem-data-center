const assert=require('node:assert/strict');
const test=require('node:test');
const path=require('node:path');
const {loadTs,root}=require('./load-typescript.cjs');
const query=loadTs(path.join(root,'src/lib/orderTimeQuery.ts'));
const {planOrderTimeBatches,queryOrderTimeBatches}=loadTs(path.join(root,'src/lib/orderTimeBatch.ts'));
const {timePlatformCountry,timePlatformName,timeOrderFilters,timeVolumeData}=loadTs(path.join(root,'src/lib/orderTimeVolume.ts'));
const {selectOrderTimePlatforms}=loadTs(path.join(root,'src/lib/orderTimePlatforms.ts'));
const {initialOrderDetailSearch,orderDetailSearchRequest}=loadTs(path.join(root,'src/lib/orderDetailSearch.ts'));
const id='00000000-0000-0000-0000-000000000001';
const filters={platform:id,basis:'created',direction:'all',start:'2026-09-19T00:00:00',end:'2026-09-19T23:59:59',createdStart:'',createdEnd:''};

test('old metadata defaults to India; PK/AR IANA clocks never depend on the computer timezone',()=>{
  const previous=process.env.TZ;
  try{
    for(const tz of ['UTC','Pacific/Honolulu','Asia/Tokyo']){
      process.env.TZ=tz;
      assert.equal(query.orderTimeRequest(filters).p_start_at,'2026-09-18T18:30:00.000Z');
      assert.equal(query.orderTimeRequest({...filters,timezone:'Asia/Karachi'}).p_start_at,'2026-09-18T19:00:00.000Z');
      assert.equal(query.orderTimeRequest({...filters,timezone:'America/Sao_Paulo'}).p_start_at,'2026-09-19T03:00:00.000Z');
      assert.equal(query.sourceTime('2026-09-18T19:00:00Z','Asia/Karachi'),'2026-09-19 00:00:00');
      assert.equal(query.sourceDay('Asia/Karachi',0,Date.parse('2026-09-18T18:45:00Z')),'2026-09-18');
      assert.equal(query.sourceDay('Asia/Kolkata',0,Date.parse('2026-09-18T18:45:00Z')),'2026-09-19');
      assert.deepEqual(query.sourceShortcutDateRange('yesterday','','Asia/Karachi',Date.parse('2026-09-18T18:45:00Z')),{start:'2026-09-17',end:'2026-09-17'});
    }
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});

test('IANA DST days split at actual local midnight with 23/25 hours and no overlap',()=>{
  for(const [day,hours] of [['2026-03-08',23],['2026-11-01',25]]){
    const batches=planOrderTimeBatches({...filters,timezone:'America/New_York',start:day+'T00:00:00',end:day+'T23:59:59'});
    assert.equal(batches.length,2);
    assert.equal((Date.parse(batches[0].p_end_at)-Date.parse(batches[0].p_start_at))/3600000,hours);
    assert.equal(query.sourceTime(batches[0].p_start_at,'America/New_York'),day+' 00:00:00');
  }
  const batches=planOrderTimeBatches({...filters,direction:'withdraw',timezone:'America/New_York',start:'2026-10-31T00:00:00',end:'2026-11-02T23:59:59'});
  assert.deepEqual(batches.map(b=>(Date.parse(b.p_end_at)-Date.parse(b.p_start_at))/3600000),[24,25,24]);
  assert.equal(batches[0].p_end_at,batches[1].p_start_at);assert.equal(batches[1].p_end_at,batches[2].p_start_at);
  for(const b of batches)assert.equal(b.p_reference_start,batches[0].p_start_at);
  const month=query.orderTimeRequest({...filters,timezone:'America/New_York',start:'2026-10-15T00:00:00',end:'2026-11-14T23:59:59'});
  assert.equal((Date.parse(month.p_end_at)-Date.parse(month.p_start_at))/3600000,31*24+1);
  assert.throws(()=>query.orderTimeRequest({...filters,timezone:'America/New_York',start:'2026-10-15T00:00:00',end:'2026-11-15T00:00:00'}),/31天/);
});

test('batch merge never collapses distinct explicit currency cohorts',async()=>{
  let calls=0;
  const result=await queryOrderTimeBatches([{...filters,direction:'withdraw',end:'2026-09-20T23:59:59'}],async()=>({
    platforms:[],platform:'POPZAR',team:'NEWAR',country:'巴基斯坦',timezone:'Asia/Karachi',rows:[{
      ...Object.fromEntries(query.timeMetricKeys.map(k=>[k,0])),direction:'withdraw',provider:'Pay',channel_type:'BANK',
      created_date:'2026-09-19',success_date:'2026-09-20',currency:++calls===1?'PKR':'USDT',success_amount:100,
    }]
  }));
  assert.equal(result[0].payload.rows.length,2);
  assert.deepEqual(result[0].payload.rows.map(row=>row.currency).sort(),['PKR','USDT']);
  assert.ok(result[0].payload.rows.every(row=>row.success_amount===100));
});

test('nonexistent and repeated DST clocks fail explicitly, including invalid IANA names',()=>{
  assert.throws(()=>query.sourceInstant('2026-03-08T02:30:00','America/New_York'),/不存在/);
  assert.throws(()=>query.sourceInstant('2026-11-01T01:30:00','America/New_York'),/出现两次/);
  assert.throws(()=>query.sourceInstant('2026-09-19T00:00:00','Not/AZone'),/时区/);
  assert.throws(()=>query.sourceInstant('2026-02-30T00:00:00','Asia/Karachi'),/无效/);
  // Brazil's historical transition skipped local midnight. Splitting must
  // still find the first instant of the following local day.
  const next=query.nextSourceMidnight(Date.parse('2018-11-03T03:00:00Z'),'America/Sao_Paulo');
  assert.equal(new Date(next).toISOString(),'2018-11-04T03:00:00.000Z');
  assert.equal(query.sourceWallClock(next,'America/Sao_Paulo'),'2018-11-04T01:00:00');
});

test('source country metadata overrides old team routing without merging distinct display groups',()=>{
  const pk={id,name:'POPZAR',team:'NEWAR',country:'巴基斯坦',timezone:'Asia/Karachi',source:'newar'};
  const br={...pk,id:id.replace(/1$/,'2'),name:'AR-BR',country:'巴西',timezone:'America/Sao_Paulo',source:'ar'};
  assert.equal(timePlatformCountry(pk),'巴基斯坦');assert.equal(timePlatformCountry(br),'巴西');
  assert.equal(timePlatformCountry({name:'EK7',team:'香港团队'}),'香港');
  assert.equal(timePlatformCountry({name:'EK7',team:'香港团队',country:'香港团队'}),'香港');
  assert.deepEqual(selectOrderTimePlatforms([pk,br],'巴基斯坦',[],['POPZAR']),[pk]);
  for(const conflict of [{...pk,timezone:'Asia/Kolkata'},{...pk,source:'ar'}])
    assert.throws(()=>selectOrderTimePlatforms([pk,conflict],'巴基斯坦',[]),/冲突/);
});

test('AR display aliases match directory, selection and result rows without rewriting source IDs/names',()=>{
  for(const [raw,display] of [['Shree.Win','ShreeWin'],['SYNTHETIC(AR)','SYNTHETIC']]){
    const p={id,name:raw,team:'AR',country:'印度',timezone:'Asia/Kolkata',source:'ar'};
    assert.equal(timePlatformName(p),display);
    for(const selected of [[],[display],[raw]])assert.deepEqual(selectOrderTimePlatforms([p],'印度',selected,[display]),[p]);
    const result={selection:{country:'印度',platforms:[display],channel:'',types:[],direction:'',basis:'created',start:filters.start,end:filters.end,createdStart:'',createdEnd:''},payloads:[{id,payload:{platform:raw,team:'AR',country:'印度',timezone:'Asia/Kolkata',platforms:[p],rows:[{...Object.fromEntries(query.timeMetricKeys.map(k=>[k,0])),direction:'charge',provider:'Pay',channel_type:'BANK'}]}}]};
    assert.equal(timeVolumeData(result).rows[0].platform,display);
    assert.equal(timeOrderFilters(result,id).platform,id);
    assert.equal(result.payloads[0].payload.platform,raw);
    assert.throws(()=>selectOrderTimePlatforms([p,{...p,id:id.replace(/1$/,'2'),name:display}],'印度',[],[display]),/重名/,'aliases must not make duplicate sources double-count');
  }
});

test('drilldown and independent ID search preserve source-local bounds and missing money',()=>{
  const result={selection:{country:'巴基斯坦',platforms:[],channel:'',types:[],direction:'',basis:'created',start:filters.start,end:filters.end,createdStart:'',createdEnd:''},
    payloads:[{id,payload:{platforms:[],platform:'POPZAR',team:'NEWAR',country:'巴基斯坦',source:'newar',timezone:'Asia/Karachi',rows:[]}}]};
  assert.equal(query.orderTimeRequest(timeOrderFilters(result,id)).p_start_at,'2026-09-18T19:00:00.000Z');
  const request=orderDetailSearchRequest({...initialOrderDetailSearch('2026-09-19'),platform:id,timezone:'Asia/Karachi',memberId:'0001'});
  assert.equal(request.p_start_at,'2026-09-18T19:00:00.000Z');assert.equal(request.p_member_id,'0001');
  result.payloads[0].payload.rows=[{...Object.fromEntries(query.timeMetricKeys.map(k=>[k,0])),direction:'withdraw',provider:'Pay',channel_type:'BANK',
    created_date:'2026-09-19',success_date:'2026-09-19',submitted_count:1,success_count:1,success_amount:100,actual_amount:null,withdraw_fee:null,
    first_created_at:'2026-09-18T19:00:00Z',last_created_at:'2026-09-18T19:00:00Z',first_success_at:null,last_success_at:null,last_synced_at:'2026-09-19T19:00:00Z'}];
  const view=timeVolumeData(result);
  assert.equal(view.rows[0].country,'巴基斯坦');assert.equal(view.rows[0].raw['最早创建'],'2026-09-19 00:00:00');
  assert.equal(view.withdrawActual.compare().current.state,'unavailable');
});
