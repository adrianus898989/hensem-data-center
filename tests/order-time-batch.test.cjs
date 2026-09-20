const assert=require('node:assert/strict');
const test=require('node:test');
const path=require('node:path');
const {loadTs,root}=require('./load-typescript.cjs');
const {planOrderTimeBatches,queryOrderTimeBatches}=loadTs(path.join(root,'src/lib/orderTimeBatch.ts'));
const {timeMetricKeys,timeTotals}=loadTs(path.join(root,'src/lib/orderTimeQuery.ts'));
const id='00000000-0000-0000-0000-000000000001';
const base={platform:id,basis:'created',direction:'all',start:'2026-09-01T00:00:00',end:'2026-09-17T23:59:59',createdStart:'',createdEnd:''};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function payload(request,extra={}) {
  const start=request.p_start_at,end=request.p_end_at;
  return {platforms:[{id,name:'EK7',team:'香港'}],platform:'EK7',team:'香港',timezone:'Asia/Kolkata',rows:[{
    ...Object.fromEntries(timeMetricKeys.map(key=>[key,0])),direction:request.p_direction,provider:'PayA',channel_type:'UPI',
    created_date:'2026-09-01',success_date:'2026-09-17',submitted_count:1,submitted_amount:100,success_count:1,success_amount:100,
    first_created_at:start,last_created_at:end,first_success_at:start,last_success_at:end,last_synced_at:end,...extra
  }]};
}

test('September 1–17 splits into 34 non-overlapping platform/day/direction requests',()=>{
  const requests=planOrderTimeBatches(base);
  assert.equal(requests.length,34);
  for(const direction of ['charge','withdraw']) {
    const group=requests.filter(r=>r.p_direction===direction);
    assert.equal(group[0].p_start_at,'2026-08-31T18:30:00.000Z');
    assert.equal(group.at(-1).p_end_at,'2026-09-17T18:30:00.000Z');
    for(let i=1;i<group.length;i++)assert.equal(group[i-1].p_end_at,group[i].p_start_at);
    for(const request of group)assert.equal(Date.parse(request.p_end_at)-Date.parse(request.p_start_at),86400_000);
  }
});

test('batch merge propagates missing amount and fee values instead of silently summing a partial total',async()=>{
  let calls=0;
  const [result]=await queryOrderTimeBatches([{...base,direction:'withdraw',end:'2026-09-02T23:59:59'}],async request=>{
    const first=++calls===1;
    return payload(request,{currency:'INR',submitted_amount:first?null:100,success_amount:first?null:100,
      actual_amount:first?null:98,withdraw_fee:first?null:2,pending_amount:first?null:0,missing_amount_count:first?1:0});
  });
  assert.equal(result.payload.rows.length,1);
  const row=result.payload.rows[0];
  for(const key of ['submitted_amount','success_amount','actual_amount','withdraw_fee','pending_amount'])assert.equal(row[key],null,key);
  assert.equal(row.missing_amount_count,1);
  assert.equal(row.success_count,2);
});

test('partial seconds stay half-open and all independent filters retain the whole-range reference',()=>{
  const requests=planOrderTimeBatches({...base,basis:'success',direction:'withdraw',start:'2026-09-01T23:59:59',end:'2026-09-02T00:00:00',
    createdStart:'2026-08-01T00:00:00',createdEnd:'2026-08-31T23:59:59',memberId:'0007',orderNumber:'ORDER-7',status:'success',crossDayOnly:true});
  assert.equal(requests.length,2);
  assert.deepEqual(requests.map(r=>[r.p_start_at,r.p_end_at]),[
    ['2026-09-01T18:29:59.000Z','2026-09-01T18:30:00.000Z'],
    ['2026-09-01T18:30:00.000Z','2026-09-01T18:30:01.000Z']]);
  for(const request of requests) {
    assert.equal(request.p_reference_start,'2026-09-01T18:29:59.000Z');
    assert.equal(request.p_created_start,'2026-07-31T18:30:00.000Z');
    assert.equal(request.p_created_end,'2026-08-31T18:30:00.000Z');
    assert.equal(request.p_member_id,'0007');assert.equal(request.p_order_number,'ORDER-7');
    assert.equal(request.p_status,'success');assert.equal(request.p_cross_day_only,true);
  }
});

test('all platforms share at most two requests and merged cohorts preserve original range metadata',async()=>{
  let active=0,maximum=0,calls=0;
  const progress=[];
  const filters=[{...base,end:'2026-09-02T23:59:59'}, {...base,platform:'00000000-0000-0000-0000-000000000002',end:'2026-09-02T23:59:59'}];
  const results=await queryOrderTimeBatches(filters,async request=>{
    maximum=Math.max(maximum,++active);calls++;await wait(2);active--;return payload(request);
  },{onProgress:p=>progress.push(p)});
  assert.equal(maximum,2);assert.equal(calls,8);assert.equal(results.length,2);
  assert.deepEqual(progress.at(-1),{completed:8,total:8,active:0});
  for(const result of results) {
    assert.equal(result.payload.rows.length,2); // Same cohort/day split recombined, direction kept separate.
    assert.equal(timeTotals(result.payload.rows).success_count,4);
    assert.equal(result.payload.start,'2026-08-31T18:30:00.000Z');
    assert.equal(result.payload.endExclusive,'2026-09-02T18:30:00.000Z');
    assert.equal(result.payload.rows[0].first_created_at,'2026-08-31T18:30:00.000Z');
    assert.equal(result.payload.rows[0].last_created_at,'2026-09-02T18:30:00.000Z');
  }
});

test('statement timeout recursively splits to one-hour leaves with no overlap or changed reference',async()=>{
  const leaves=[],progress=[];let calls=0;
  const filter={...base,direction:'charge',end:'2026-09-01T23:59:59'};
  const results=await queryOrderTimeBatches([filter],async request=>{
    calls++;
    const duration=Date.parse(request.p_end_at)-Date.parse(request.p_start_at);
    if(duration>3600_000)throw Object.assign(new Error('canceling statement due to statement timeout'),{code:'57014',status:400});
    leaves.push(request);return payload(request,{earlier_count:0,earlier_amount:0});
  },{onProgress:p=>progress.push(p)});
  assert.equal(calls,47);assert.equal(leaves.length,24);
  leaves.sort((a,b)=>a.p_start_at.localeCompare(b.p_start_at));
  for(let i=0;i<leaves.length;i++) {
    assert.equal(leaves[i].p_reference_start,'2026-08-31T18:30:00.000Z');
    assert.equal(Date.parse(leaves[i].p_end_at)-Date.parse(leaves[i].p_start_at),3600_000);
    if(i)assert.equal(leaves[i-1].p_end_at,leaves[i].p_start_at);
  }
  assert.equal(timeTotals(results[0].payload.rows).success_count,24);
  assert.equal(timeTotals(results[0].payload.rows).earlier_count,0);
  assert.deepEqual(progress.at(-1),{completed:24,total:24,active:0});
});

test('authorization and validation failures do not split or return partially completed results',async()=>{
  for(const code of ['42501','22023','28000']) {
    let calls=0;
    await assert.rejects(()=>queryOrderTimeBatches([{...base,end:'2026-09-01T23:59:59'}],async request=>{
      calls++;if(request.p_direction==='withdraw')throw Object.assign(new Error('statement timeout-looking validation message'),{code});
      return payload(request);
    }),error=>error.code===code);
    assert.equal(calls,2);
  }
});

test('a caller abort promptly cancels both in-flight requests even if the transport ignores cancellation',async()=>{
  const controller=new AbortController(),signals=[];
  const pending=queryOrderTimeBatches([base],(_request,signal)=>{signals.push(signal);return new Promise(()=>{});},{signal:controller.signal});
  await wait(1);controller.abort();
  await assert.rejects(pending,error=>error.name==='AbortError');
  assert.equal(signals.length,2);assert.ok(signals.every(signal=>signal.aborted));
});

test('single-hour timeout stops retrying and the per-request timeout aborts the transport',async()=>{
  let attempts=0;const signals=[];
  await assert.rejects(()=>queryOrderTimeBatches([{...base,direction:'charge',end:'2026-09-01T00:59:59'}],(_request,signal)=>{
    attempts++;signals.push(signal);return new Promise(()=>{});
  },{requestTimeoutMs:5}),error=>error.code==='ORDER_TIME_NETWORK_TIMEOUT');
  assert.equal(attempts,1);assert.equal(signals[0].aborted,true);
});

test('invalid inputs and repeated platforms never send requests',async()=>{
  let calls=0;const fetcher=async request=>{calls++;return payload(request);};
  await assert.rejects(()=>queryOrderTimeBatches([base,base],fetcher),/平台重复/);
  await assert.rejects(()=>queryOrderTimeBatches([{...base,end:'2026-10-02T23:59:59'}],fetcher),/最多31天/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>queryOrderTimeBatches([base],fetcher,{signal:controller.signal}),error=>error.name==='AbortError');
  assert.equal(calls,0);
});
