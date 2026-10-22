const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const file=path.join(__dirname,'withdraw-prepared-ui.test.cjs'),c=vm.createContext({__dirname,require:createRequire(file),console,Date,Intl,AbortController});
vm.runInContext(fs.readFileSync(file,'utf8').split('for(const view of')[0]+';globalThis.h={fixture,data};',c);
const {fixture,data}=c.h;
const ready=n=>({...data(n),secondary:{startAt:'2026-10-15T00:00:00Z',endAt:'2026-10-15T23:59:59Z',basis:'success',rows:[]}});
for(const page of ['auto_withdraw','withdraw_operators']){
 test(page+' blank success fields select only creation results and do not export a hidden filter',async()=>{
  const f=fixture(page);const run=f.page.load();f.pending.shift().resolve(ready(7));await run;
  assert.equal(f.page.state.data.totals.total,7);assert.equal(f.L.successFrom,'');assert.equal(f.L.successTo,'');
  f.context.withdrawMetricView('secondary');assert.equal(f.page.state.metricView,'created');assert.equal(f.calls.length,1);
  assert.match(f.page.render(),/value="secondary"[^>]*disabled/);
  const meta=f.page.exportMeta();assert.deepEqual(Array.from(meta[2]),['成功时间筛选','未填写；按创建订单当前状态统计']);assert.doesNotMatch(JSON.stringify(meta),/默认成功日期/);
 });
 test(page+' an explicitly equal window enables secondary results; clearing it applies creation mode atomically',async()=>{
  const f=fixture(page);f.context.withdrawMetricTimeSet('successFrom',f.L.from);f.context.withdrawMetricTimeSet('successTo',f.L.to);
  let run=f.page.load();f.pending.shift().resolve(ready(8));await run;f.context.withdrawMetricView('secondary');
  assert.equal(f.page.state.metricView,'secondary');assert.equal(f.page.canExport(),true);assert.equal(f.calls.length,1);
  assert.match(f.page.exportMeta()[2][0],/独立/);
  f.context.withdrawMetricTimeSet('successFrom','');f.context.withdrawMetricTimeSet('successTo','');
  assert.equal(f.page.canExport(),false);assert.equal(f.page.state.applied.successWindowExplicit,true,'previous result keeps its real filter while edits are a draft');
  run=f.page.load();f.pending.shift().resolve(ready(9));await run;assert.equal(f.page.state.metricView,'created');
  assert.equal(f.page.state.data.totals.total,9);assert.equal(f.page.state.applied.successWindowExplicit,false);assert.equal(f.calls.length,2);
 });
 test(page+' restored old implicit secondary state cannot expose a fabricated user window',async()=>{
  const f=fixture(page),run=f.page.load();f.pending.shift().resolve(ready(4));await run;
  const saved=f.page.capture();saved.metricView='secondary';f.page.restore(saved);
  assert.equal(f.page.canExport(),false);f.page.render();assert.equal(f.page.state.metricView,'created');assert.equal(f.page.canExport(),true);
 });
}
