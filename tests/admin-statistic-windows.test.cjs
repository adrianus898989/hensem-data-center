const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-statistic-windows.js'),'utf8');
const live=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8');
const context=vm.createContext({Date,Intl});vm.runInContext(source,context);
const start=live.indexOf(' const clockFormatters=new Map();'),end=live.indexOf(' function table(',start);assert(start>=0&&end>start);
vm.runInContext(live.slice(start,end)+';globalThis.nativeInstant=instant;',context);
const api=context.HensemStatisticWindows,instant=context.nativeInstant,plain=x=>JSON.parse(JSON.stringify(x));
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state=patch=>({from:'2026-10-01T01:02:03',to:'2026-10-02T04:05:06',successFrom:'2026-10-07T07:08:09',successTo:'2026-10-08T10:11:12',successBasis:'success',...patch});

test('four external second-precision inputs and only success/source-update selectors are rendered',()=>{
 const html=api.render(state(),escape,'Asia/Kolkata');assert.equal((html.match(/type="datetime-local"/g)||[]).length,4);assert.equal((html.match(/step="1"/g)||[]).length,4);
 for(const id of ['from','to','successFrom','successTo'])assert.match(html,new RegExp('id="liveMetric-'+id+'"'));assert.match(html,/创建开始时间/);assert.match(html,/创建结束时间/);assert.match(html,/成功开始时间/);assert.match(html,/成功结束时间/);assert.match(html,/value="success" selected/);assert.match(html,/value="source_updated"/);assert.match(html,/Asia\/Kolkata/);assert.doesNotMatch(html,/ingest|synced_at|采集时间/);
 const updated=api.render(state({successBasis:'source_updated'}),escape,'Asia/Jakarta');assert.match(updated,/更新开始时间/);assert.match(updated,/更新结束时间/);assert.match(updated,/value="source_updated" selected/);
});
test('four times are escaped and rendering never triggers reads or silently changes explicit ranges',()=>{
 const value=state(),before=plain(value),html=api.render(value,escape,'<img src=x>');assert.deepEqual(value,before);assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img src=x&gt;/);
 const injected=api.render(state({successFrom:'" onfocus="bad'}),escape,'UTC');assert.doesNotMatch(injected,/value="" onfocus=/);assert.match(injected,/&quot;/);
});
test('defaults copy only missing second-window controls; explicit independent windows survive ensure',()=>{
 const value={from:state().from,to:state().to};api.ensure(value);assert.equal(value.successFrom,value.from);assert.equal(value.successTo,value.to);assert.equal(value.successBasis,'success');assert.equal(api.same(value),true);
 const independent=state(),before=plain(independent);api.ensure(independent);assert.deepEqual(independent,before);assert.equal(api.same(independent),false);api.reset(independent);assert.equal(independent.successFrom,independent.from);assert.equal(independent.successTo,independent.to);assert.equal(independent.successBasis,'success');assert.equal(api.same(independent),true);independent.successBasis='source_updated';assert.equal(api.same(independent),false);
});
test('independent disjoint ranges use platform timezone and inclusive seconds become exclusive endpoints',()=>{
 const value=state({successBasis:'source_updated'}),before=plain(value),actual=plain(api.request(value,{timezone:'Asia/Kolkata'},instant));
 assert.deepEqual(actual,{startAt:'2026-09-30T19:32:03.000Z',endAt:'2026-10-01T22:35:07.000Z',successStartAt:'2026-10-07T01:38:09.000Z',successEndAt:'2026-10-08T04:41:13.000Z',successBasis:'source_updated'});assert.deepEqual(value,before);
 const indonesia=plain(api.request(value,{timezone:'Asia/Jakarta'},instant));assert.equal(indonesia.startAt,'2026-09-30T18:02:03.000Z');assert.equal(indonesia.successStartAt,'2026-10-07T00:08:09.000Z');assert.notEqual(actual.startAt,indonesia.startAt);assert.ok(Date.parse(actual.successStartAt)>Date.parse(actual.endAt),'the two cohorts may be disjoint, not intersected');
});
test('an exact one-second selection is valid independently in both windows',()=>{
 const value=state({to:state().from,successTo:state().successFrom}),result=api.request(value,{timezone:'UTC'},instant);assert.equal(Date.parse(result.endAt)-Date.parse(result.startAt),1000);assert.equal(Date.parse(result.successEndAt)-Date.parse(result.successStartAt),1000);
});
test('each range permits at most 31 local calendar days independently',()=>{
 const allowed=state({from:'2026-10-01T00:00:00',to:'2026-10-31T23:59:59',successFrom:'2026-08-01T00:00:00',successTo:'2026-08-31T23:59:59'});assert.doesNotThrow(()=>api.validate(allowed));
 assert.throws(()=>api.validate({...allowed,to:'2026-11-01T00:00:00'}),/创建时间每次最多31个当地日/);assert.throws(()=>api.validate({...allowed,successTo:'2026-09-01T00:00:00'}),/成功时间每次最多31个当地日/);
 assert.throws(()=>api.validate({...allowed,successBasis:'source_updated',successTo:'2026-09-01T00:00:00'}),/源订单更新时间每次最多31个当地日/);
});
test('reversed/invalid dates, invalid basis and explicitly cleared second ranges fail instead of defaulting',()=>{
 for(const patch of [{from:'2026-02-30T00:00:00'},{to:'2026-10-01T01:02:02'},{successTo:'2026-10-07T07:08:08'},{successFrom:''},{successTo:''},{successBasis:'ingest'},{successBasis:'synced_at'},{from:'1999-12-31T23:59:59'}])assert.throws(()=>api.validate(state(patch)),/无效/);
});
test('native DST gaps and repeated hours reject either range instead of picking a browser offset',()=>{
 for(const patch of [{from:'2026-03-08T02:30:00',to:'2026-03-08T03:00:00'},{successFrom:'2026-03-08T02:30:00',successTo:'2026-03-08T03:00:00'},{successFrom:'2026-11-01T01:30:00',successTo:'2026-11-01T03:00:00'}])assert.throws(()=>api.request(state(patch),{timezone:'America/New_York'},instant),/跳时|重复时间/);
 assert.throws(()=>api.request(state(),{},instant),/时区/);assert.throws(()=>api.request(state(),{timezone:''},instant));
});
test('shared controls cover aggregate pages and do not alter daily/native-detail/snapshot domains',()=>{
 for(const page of ['overview','merchants','success_analysis','teamops','teamcountries','teamplatforms','daily_comparison','providers','provider_payout','collection','payout','time','amount','matrix','provider_daily','latency','risk'])assert.equal(api.enabled(page),true,page);
 for(const page of ['orders','stuck','events','auto_withdraw','withdraw_operators','deposit_statistics','workorders'])assert.equal(api.enabled(page),false,page);
 assert.deepEqual(plain(api.fields),['from','to','successFrom','successTo','successBasis']);
});
