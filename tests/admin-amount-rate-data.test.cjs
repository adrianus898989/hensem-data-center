const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const window = {};
for (const module of ['live-success-analysis', 'live-amount-bands', 'live-hourly-rate-data', 'live-amount-rate-data']) {
  const source = fs.readFileSync(path.join(__dirname, '../admin-preview/' + module + '.js'), 'utf8');
  vm.runInNewContext(source, {window});
}

const edges = [100,200,300,400,500,1000,2000,5000,10000,20000,50000];
const amountBands = {charge: edges, withdraw: [200,300,400,500,750,1000,2000,5000,10000,30000,100000]};
const platform = (id, source) => ({id, name: '商户同名', source, sourceName: id, country: '印度', currency: 'INR', timezone: 'Asia/Kolkata'});
const a = platform('first', 'AR'), b = platform('second', 'NEWAR'), privatePlatform = platform('outside-scope', 'AR');
const row = (direction, all_count, success_count, extra = {}) => ({
  direction, currency: 'INR', all_count, success_count, created_success_count: Math.min(success_count,all_count), ...extra
});
function response(p, records) {
  const sumBy = keys => {
    const indexed = new Map();
    for (const r of records) {
      const key = keys.map(k => r[k]), id = JSON.stringify(key);
      const total = indexed.get(id) || row(r.direction, 0, 0, Object.fromEntries(keys.map(k => [k,r[k]])));
      for (const metric of ['all_count','success_count','created_success_count']) total[metric] += r[metric];
      indexed.set(id,total);
    }
    return [...indexed.values()];
  };
  return {platform:p, complete:true, hasMore:false, amountBandsVersion:1, amountBands, providerAmountMatrix:true,
    startAt:'2026-11-08T18:30:00Z', endAt:'2026-11-09T18:30:00Z', successBasis:'created',
    segment:{kind:'custom',hourRange:{minHour:0,maxHour:24}},
    summary:sumBy(['direction']), total:records.reduce((n,r) => n + r.all_count,0),
    groups:{amount_range:sumBy(['direction','bucket']), provider_amount_range:records,
      provider:sumBy(['direction','provider']), hourly:[row('charge',999,999,{hour:0})]}};
}
const charge = (bucket, provider, n, s) => row('charge', n, s, {bucket,provider});
const withdrawal = (bucket, provider, n, s) => row('withdraw', n, s, {bucket,provider});
const first = response(a, [charge('band:0','Pay',10,1),charge('above','Pay',1,1),
  charge('below','人工充值',2,0),charge('unknown',null,1,0),withdrawal('band:0','Pay',12,8)]);
const second = response(b, [charge('band:0','Pay',2,2),charge('band:9','Pay',5,3),withdrawal('band:1','Pay',7,1)]);
const hidden = response(privatePlatform, [charge('band:0','PrivatePay',300,300)]);
function model(input={}) {
  const results = [first,second,hidden];
  return window.HensemAmountRateData.build({
    direction:'charge',currency:'INR',platforms:[a,b],results,amountBands,
    providerAmounts:new Map(results.map(r=>[r.platform.id,r])),...input
  });
}
const publicValue = obj => JSON.parse(JSON.stringify(obj));
const item = (table,id) => table.rows.find(r=>r.key===id);
const counts = (successCount,totalCount) => ({successCount,totalCount});

test('two native merchants sharing a name stay separate and only their requested amount-band counts roll into provider rates', () => {
  const {merchant,provider,dimension} = model();
  assert.equal(dimension,'amount');
  assert.equal(merchant.rows.length,2);assert.equal(provider.rows.length,1);
  assert.deepEqual(publicValue(item(merchant,a.id).total),counts(2,14));
  assert.deepEqual(publicValue(item(merchant,b.id).total),counts(5,7));
  const pay = item(provider,'Pay');
  assert.deepEqual(publicValue(pay.cells['band:0']),counts(3,12));
  assert.deepEqual(publicValue(pay.cells['band:9']),counts(3,5));
  assert.deepEqual(publicValue(pay.cells.above),counts(1,1));
  assert.deepEqual(publicValue(pay.total),counts(7,18));
  assert.deepEqual(publicValue(provider.excluded.manual),['人工充值']);
  assert.equal(provider.excluded.unidentified.length,1);
  assert.equal(provider.partial,false);
  assert.deepEqual(publicValue(merchant.columns),publicValue(provider.columns));
  assert.deepEqual(publicValue(merchant.columns.map(c=>c.key)),['below',...edges.slice(1).map((_,i)=>'band:'+i),'above','unknown']);
});

test('payout uses its own requested edges, rows and weighted total', () => {
  const {provider,merchant} = model({direction:'withdraw'});
  const firstBand = provider.columns.find(c=>c.key==='band:0');
  assert.equal(firstBand.label,'200 ≤ 金额 < 300');
  assert.deepEqual(publicValue(item(provider,'Pay').cells['band:0']),counts(8,12));
  assert.deepEqual(publicValue(item(provider,'Pay').total),counts(9,19));
  assert.deepEqual(publicValue(item(merchant,b.id).total),counts(1,7));
});

test('missing or unverified native range evidence leaves a merchant unknown and preserves the other verified native subtotal', () => {
  for (const changed of [
    {...second,groups:{hourly:second.groups.hourly,amount:[charge('100','Pay',7,5)]}},
    {...second,complete:false},
    {...second,amountBands:{...amountBands,charge:[100,250,...edges.slice(2)]}},
    {...second,platform:{...b,source:'AR'}},
    {...second,pandaCoverage:{reason:'verified_created_prefix_only'}},
    {...second,_parts:[second,{...second,groups:{}}]}
  ]) {
    const {merchant,provider} = model({results:[first,changed,hidden], providerAmounts:new Map([[a.id,first],[privatePlatform.id,hidden]])});
    assert.equal(merchant.partial,true);
    assert.equal(item(merchant,b.id).total,null);
    assert.deepEqual(publicValue(item(merchant,a.id).total),counts(2,14));
    assert.equal(provider.partial,true);
    assert.deepEqual(publicValue(item(provider,'Pay').total),{...counts(2,11),partial:true});
  }
});

test('a missing provider crossing leaves complete merchant facts available and a verified empty source proves zero counts', () => {
  const empty = response(b,[]), sources = [first,empty];
  const {merchant,provider} = model({results:sources, providerAmounts:new Map([[b.id,empty]])});
  assert.equal(merchant.partial,false);
  assert.deepEqual(publicValue(item(merchant,b.id).cells['band:0']),counts(0,0));
  assert.deepEqual(publicValue(item(merchant,a.id).total),counts(2,14));
  assert.equal(provider.partial,true);assert.equal(provider.rows.length,0);
  const unavailable = model({results:sources, successAvailable:p=>p.id!==a.id});
  assert.equal(item(unavailable.merchant,a.id).total,null);
  assert.equal(unavailable.provider.rows.some(r=>r.name==='PrivatePay'),false);
});

test('the verified supplement supplies absent main groups for the same dates and does not overwrite conflicting published groups', () => {
  const mainWithoutRanges = {...second,groups:{provider:second.groups.provider}};
  const withMain = main => model({results:[first,main],providerAmounts:new Map([[a.id,first],[b.id,second]])});
  const repaired = withMain(mainWithoutRanges);
  assert.equal(repaired.merchant.partial,false);assert.equal(repaired.provider.partial,false);
  assert.deepEqual(publicValue(item(repaired.merchant,b.id).total),counts(5,7));
  assert.deepEqual(publicValue(item(repaired.provider,'Pay').total),counts(7,18));
  for (const rejected of [
    {...mainWithoutRanges,startAt:'2026-11-07T18:30:00Z'},
    {...mainWithoutRanges,summary:[row('charge',7,6)]},
    {...second,groups:{...second.groups,amount_range:[]}},
    {...second,_parts:[second,mainWithoutRanges]}
  ]) {
    const incomplete = withMain(rejected);
    assert.equal(incomplete.merchant.partial,true);
    assert.equal(item(incomplete.merchant,b.id).total,null);
    assert.deepEqual(publicValue(item(incomplete.provider,'Pay').total),{...counts(2,11),partial:true});
  }
});
