const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const {loadTs, root} = require('./load-typescript.cjs');
const volume = loadTs(path.join(root, 'src/lib/orderTimeVolume.ts'));
const {collectionSuccessProviderKey} = loadTs(path.join(root, 'src/lib/collectionSuccess.ts'));

const selection = {country:'香港',platforms:[],channel:'',types:[],direction:'',basis:'created',
  start:'2026-09-17T00:00:00',end:'2026-09-17T23:59:59',createdStart:'',createdEnd:''};
function row(extra={}) {
  return {direction:'withdraw',provider:'TestPayA',channel_type:'UPI',created_date:'2026-09-17',success_date:'2026-09-18',
    submitted_count:2,submitted_amount:200,success_count:1,success_amount:100,actual_amount:98,withdraw_fee:2,
    cross_day_count:1,cross_day_amount:100,earlier_count:0,earlier_amount:0,missing_success_time_count:0,
    pending_count:1,pending_amount:100,first_created_at:'2026-09-17T06:00:00Z',last_created_at:'2026-09-17T07:00:00Z',
    first_success_at:'2026-09-18T06:00:00Z',last_success_at:'2026-09-18T06:00:00Z',last_synced_at:'2026-09-19T00:00:00Z',...extra};
}
function result(rows=[row()], selected={}) {
  return {selection:{...selection,...selected},payloads:[{id:'ek7',payload:{platform:'EK7',team:'香港',timezone:'Asia/Kolkata',platforms:[],rows}}]};
}

test('payout success rate uses successful withdrawals over created withdrawals without mixing collections',()=>{
  const value=volume.timeVolumeData(result([row(),row({direction:'charge',submitted_count:10,success_count:8,success_amount:800})]));
  assert.equal(value.withdrawSuccess.compare().current.rate,0.5);
  assert.equal(value.withdrawSuccess.compare().current.submitted,2);
  assert.equal(value.withdrawSuccess.compare().current.success,1);
  assert.equal(value.collectionSuccess.compare().current.rate,0.8);
  assert.equal(value.withdrawActual.compare().current.actualAmount,98);
  assert.equal(value.withdrawActual.compare().current.feeAmount,2);
});

test('provider/platform/type totals use ratio of counts, never average of individual rates',()=>{
  const input=result([row(),row({provider:'TestPayB',submitted_count:1,success_count:1})]);
  input.payloads.push({id:'max7',payload:{platform:'MAX7',team:'香港',timezone:'Asia/Kolkata',platforms:[],
    rows:[row({channel_type:'BANK',submitted_count:10,success_count:9})]}});
  const value=volume.timeVolumeData(input);
  const a=collectionSuccessProviderKey('香港','TestPayA');
  assert.equal(value.withdrawSuccess.compare([a]).current.rate,10/12);
  assert.equal(value.withdrawSuccess.compare([a],['UPI']).current.rate,1/2);
  assert.equal(value.withdrawSuccess.compare([a],['BANK']).current.rate,9/10);
  assert.equal(value.withdrawSuccess.compare().current.rate,11/13);
  assert.equal(value.withdrawSuccess.providers.find(p=>p.key===a).submitted,12);
});

test('success-time queries do not invent a 100 percent payout or collection rate',()=>{
  const value=volume.timeVolumeData(result([row({submitted_count:1,success_count:1})],{basis:'success'}));
  assert.equal(value.withdrawSuccess,undefined);
  assert.equal(value.collectionSuccess,undefined);
  assert.match(value.successRateHint,/成功时间仅查询成功订单/);
  assert.equal(value.totals.success_count,1);
});

test('state-filtered and cross-day-only subsets hide misleading denominator rates',()=>{
  for(const status of ['success','pending','failed','rejected','unknown']) {
    const value=volume.timeVolumeData(result([row()],{status}));
    assert.equal(value.withdrawSuccess,undefined);
    assert.equal(value.collectionSuccess,undefined);
    assert.match(value.successRateHint,/已筛选订单状态/);
  }
  const cross=volume.timeVolumeData(result([row()],{crossDayOnly:true}));
  assert.equal(cross.withdrawSuccess,undefined);
  assert.equal(cross.collectionSuccess,undefined);
  assert.match(cross.successRateHint,/仅跨日成功/);
  assert.equal(volume.timeVolumeData(result([row()],{status:'all'})).withdrawSuccess.compare().current.rate,0.5);
});

test('zero and invalid denominators are not rendered as 100 percent or Infinity',()=>{
  const zero=volume.timeVolumeData(result([row({submitted_count:0,success_count:0})])).withdrawSuccess.compare().current;
  assert.equal(zero.rate,null);assert.equal(zero.state,'zero');
  const noSuccess=volume.timeVolumeData(result([row({submitted_count:4,success_count:0})])).withdrawSuccess.compare().current;
  assert.equal(noSuccess.rate,0);
  for(const extra of [{submitted_count:1,success_count:2},{submitted_count:-1,success_count:0},
      {submitted_count:2,success_count:0.5},{submitted_count:Infinity,success_count:1}]) {
    const metric=volume.timeVolumeData(result([row(extra)])).withdrawSuccess.compare().current;
    assert.equal(metric.rate,null);assert.equal(metric.state,'unavailable');
  }
});

test('member/order/status/cross-day searches pass through unchanged to the RPC input',()=>{
  const input=result([row()],{memberId:'000012345678901234567890',orderNumber:'ORDER-001',status:'success',crossDayOnly:true});
  const filters=volume.timeOrderFilters(input,'ek7');
  assert.equal(filters.memberId,'000012345678901234567890');
  assert.equal(filters.orderNumber,'ORDER-001');
  assert.equal(filters.status,'success');
  assert.equal(filters.crossDayOnly,true);
  assert.equal(filters.platform,'ek7');
});

test('missing AR money stays unknown while submitted, success and pending counts remain usable',()=>{
  const unknown=row({currency:'INR',submitted_amount:null,success_amount:null,pending_amount:null,
    actual_amount:null,withdraw_fee:null,cross_day_amount:null,missing_amount_count:2});
  const data=volume.timeVolumeData(result([unknown]));
  assert.equal(data.totals.success_amount,null);
  assert.equal(data.totals.submitted_amount,null);
  assert.equal(data.totals.missing_amount_count,2);
  assert.ok(Number.isNaN(data.rows[0].amount));
  assert.equal(data.withdrawSuccess.compare().current.rate,0.5);
  assert.equal(data.withdrawActual.compare().current.state,'unavailable');
  assert.ok(Number.isNaN(data.withdrawPending.compare().current.amount));
  assert.equal(data.withdrawPending.compare().current.count,1);
  const mixed=volume.timeVolumeData(result([unknown,row({currency:'INR'})]));
  assert.equal(mixed.totals.success_amount,null,'known GAME66 money is not shown as the entire incomplete total');
  assert.equal(mixed.totals.success_count,2);
});

test('different explicit currencies never sum money, but counts remain combined',()=>{
  const data=volume.timeVolumeData(result([row({currency:'INR'}),row({currency:'PKR'})]));
  assert.equal(data.totals.success_amount,null);
  assert.equal(data.totals.pending_amount,null);
  assert.equal(data.totals.success_count,2);
  assert.equal(data.withdrawActual.compare().current.state,'unavailable');
  assert.ok(Number.isNaN(data.withdrawPending.compare().current.amount));
  assert.equal(data.withdrawPending.compare().current.count,2);
});

test('unknown formatting is a dash; confirmed zero remains zero',()=>{
  const f=loadTs(path.join(root,'src/lib/format.ts'));
  for(const value of [null,undefined,NaN,Infinity]){
    assert.equal(f.formatNumber(value),'—');
    assert.equal(f.formatPercent(value),'—');
  }
  assert.equal(f.formatNumber(0),'0');
  assert.equal(f.formatPercent(0),'0.00%');
  assert.equal(f.formatNumber(5873),'5,873');
  assert.ok(Number.isNaN(f.amountRatio(100,NaN)));
  assert.ok(Number.isNaN(f.sumVolumeAmounts([{amount:100,currency:'INR'},{amount:100,currency:'PKR'}])));
  assert.equal(f.sumVolumeAmounts([{amount:100,currency:'INR'},{amount:100,currency:'INR'}]),200);
});

test('legacy Pakistan/India local report money combines with tagged sources without treating blank metadata as another currency',()=>{
  const {sumVolumeAmounts}=loadTs(path.join(root,'src/lib/format.ts'));
  for(const [country,currency] of [['巴基斯坦','PKR'],['印度','INR']]){
    assert.equal(sumVolumeAmounts([{country,amount:100,currency:null},{country,amount:200,currency},{country,amount:300}]),600);
    assert.ok(Number.isNaN(sumVolumeAmounts([{country,amount:100,currency:null},{country,amount:200,currency:'USDT'}])),'explicit unlike currencies remain separate');
  }
  assert.ok(Number.isNaN(sumVolumeAmounts([{amount:100,currency:null},{amount:200,currency:'PKR'}])),'unknown-country sources are not silently assigned a currency');
});

test('known actual money survives a source without actual fields as a visibly partial subtotal',()=>{
  const input=result([row({actual_amount:null,withdraw_fee:null}),row({provider:'TestPayA',actual_amount:88,withdraw_fee:12})]);
  const actual=volume.timeVolumeData(input).withdrawActual.compare().current;
  assert.equal(actual.state,'partial');assert.equal(actual.actualAmount,88);assert.equal(actual.feeAmount,12);
});
