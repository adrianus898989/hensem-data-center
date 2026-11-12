const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-success-analysis.js'),'utf8'),{window:globalThis});
require('../admin-preview/live-hourly-rate-data.js');
const build = input => globalThis.HensemHourlyRateData.build({direction:'charge', currency:'INR', ...input});
const a = {id:'ar-a',name:'A',country:'印度',source:'ar'};
const b = {id:'newar-b',name:'A',country:'印度',source:'newar'};
const row = (hour, success_count, all_count, provider) => ({hour, success_count, all_count, provider, direction:'charge', currency:'INR'});
const counts = (successCount, totalCount) => ({successCount,totalCount});
const result = (platform, hourly, summary) => ({platform, complete:true, groups:{hourly}, summary});
const byId = (matrix,key) => matrix.rows.find(item=>item.key===key);

test('both matrices use the same hour cells, locally grouped counts and weighted totals across native platforms', () => {
  const outside = {id:'private',name:'Hidden'};
  const results = [
    result(a,[row(8,2,4),row(9,0,12),{...row(8,14,14),currency:'IDR'}],[row(null,2,16)]),
    result(b,[row(8,5,5),{...row(9,10,1),direction:'withdraw'}],[row(null,5,5)]),
    result(outside,[row(8,999,999)],[row(null,999,999)])
  ];
  const providerHours = new Map([
    [a.id,{complete:true,rows:[row(8,2,4,'__proto__'),row(9,0,12,'__proto__')]}],
    [b.id,{complete:true,rows:[row(8,5,5,'__proto__')]}],
    [outside.id,{complete:true,rows:[row(8,999,999,'Hidden')]}]
  ]);
  const {provider,merchant}=build({platforms:[a,b],results,providerHours});
  assert.equal(merchant.rows.length,2); // same display name, two native IDs
  assert.equal(provider.rows.length,1);
  const joined = byId(provider,'__proto__');
  assert.deepEqual(joined.cells[8],counts(7,9));
  assert.deepEqual(joined.cells[9],counts(0,12));
  assert.deepEqual(joined.total,counts(7,21));
  assert.deepEqual(byId(merchant,a.id).total,counts(2,16));
  assert.deepEqual(byId(merchant,b.id).cells[9],counts(0,0));
  assert.equal(provider.columns.length,24);
  assert.equal(provider.partial,false);
});

test('request failures and unknown success counts do not become zero or complete totals', () => {
  const results=[result(a,[row(0,2,5),row(1,null,3)],[row(null,null,8)])];
  const providerHours=new Map([[a.id,{completeHours:[0,1],rows:[row(0,2,5,'Pay'),row(1,null,3,'Pay')]}]]);
  const {provider,merchant}=build({platforms:[a,b],results,providerHours});
  assert.equal(merchant.partial,true);
  assert.equal(byId(merchant,b.id).total,null);
  assert.equal(byId(merchant,a.id).cells[1],null);
  assert.deepEqual(byId(provider,'Pay').cells[0],{...counts(2,5),partial:true});
  assert.equal(byId(provider,'Pay').cells[1],null);
  assert.deepEqual(byId(provider,'Pay').total,{...counts(2,5),partial:true});
});

test('manual and unassigned payments reconcile to the merchant before applying the success-analysis categories', () => {
  const results=[result(a,[row(8,7,12)],[row(null,7,12)])];
  const providerHours=new Map([[a.id,{complete:true,rows:[
    row(8,3,6,'Pay'),row(8,2,3,'人工充值'),row(8,1,1,null),row(8,1,2,'USDT')
  ]}]]);
  const {provider,merchant}=build({platforms:[a],results,providerHours});
  assert.deepEqual(provider.rows.map(row=>row.name),['Pay']);
  assert.deepEqual(provider.excluded,{manual:['人工充值'],unidentified:['（三方未提供）','USDT']});
  assert.deepEqual(provider.rows[0].total,counts(3,6));
  assert.deepEqual(merchant.rows[0].total,counts(7,12));
  assert.equal(provider.partial,false);
});

test('partial hours are independent of complete hours, including cross-day success exceeding created', () => {
  const results=[result(a,[row(0,3,1),row(4,1,2)],[row(null,4,3)])];
  const providerHours=new Map([[a.id,{completeHours:[0,4],rows:[row(0,3,1,'Pay'),row(4,2,2,'Pay')]}]]);
  const {provider}=build({platforms:[a],results,providerHours});
  const pay=byId(provider,'Pay');
  assert.deepEqual(pay.cells[0],counts(3,1));
  assert.equal(pay.cells[4],null); // provider and merchant disagree on this hour
  assert.deepEqual(pay.total,{...counts(3,1),partial:true});
});

test('a missing segment in a split request, a mismatched native source or a read without a success clock cannot yield complete facts', () => {
  const good=result(a,[row(2,2,4)],[row(null,2,4)]);
  for(const changed of [
    {...good,_parts:[good,{platform:a,groups:{},summary:[]}]},
    {...good,platform:{...a,source:'wrong'}},
    {...good,pandaCoverage:{reason:'verified_created_prefix_only'}},
    {...good,summary:[row(null,9,20)]}
  ]){
    const model=build({platforms:[a],results:[changed]});
    assert.equal(byId(model.merchant,a.id).total,null);
    assert.equal(model.merchant.partial,true);
  }
  const model=build({platforms:[a],results:[good],successAvailable:()=>false});
  assert.equal(byId(model.merchant,a.id).total,null);
});
