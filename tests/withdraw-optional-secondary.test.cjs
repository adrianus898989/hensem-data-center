/* Real withdrawal module/host validator; synthetic transport and native descriptors. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const copy=x=>JSON.parse(JSON.stringify(x));
const uiFile=path.join(__dirname,'withdraw-prepared-ui.test.cjs'),ui=vm.createContext({__dirname,require:createRequire(uiFile),console,Date,Intl,AbortController});
vm.runInContext(fs.readFileSync(uiFile,'utf8').split('for(const view of')[0]+';globalThis.fixtureTools={fixture,data};',ui);
const {fixture,data}=ui.fixtureTools;
const teamFile=path.join(__dirname,'admin-withdraw-team-reuse.test.cjs'),teamRequire=createRequire(teamFile),team=vm.createContext({__dirname,console,AbortController,setTimeout,clearTimeout,require:name=>name==='node:test'?()=>{}:teamRequire(name)});
vm.runInContext(fs.readFileSync(teamFile,'utf8')+';globalThis.teamFixture=fixture;',team);
const {validateAdminLiveRequest:validate}=require('./load-typescript.cjs').loadTs(path.resolve(__dirname,'../src/lib/adminLiveBridge.ts'));
function blank(d,L){L.successFrom='';L.successTo='';d.windows.successStartAt=d.windows.creationStartAt;d.windows.successEndAt=d.windows.creationEndAt;d.windows.includeSecondary=false;d.secondary={basis:'success',startAt:d.windows.successStartAt,endAt:d.windows.successEndAt,createdIntersection:false,state:'not_requested',complete:false,rows:[]};}
for(const view of ['auto_withdraw','withdraw_operators']){
 test(view+' blank success requests omit only unused secondary computation and retain exact creation scope',async()=>{
  const f=fixture(view),run=f.page.load(),q=copy(f.calls[0].q);assert.equal(q.includeSecondary,false);assert.equal(q.startAt,q.successStartAt);assert.equal(q.endAt,q.successEndAt);assert.equal(q.windowVersion,2);assert.equal(q.view,view==='auto_withdraw'?'auto':'operators');assert.deepEqual(q.platforms,['A']);assert.deepEqual(copy(validate(q)),q);
  f.pending.shift().resolve(data(17));await run;assert.equal(f.page.state.data.totals.total,17);assert.equal(f.page.state.applied.query.includeSecondary,false);assert.equal(f.page.state.applied.successWindowExplicit,false);assert.equal(f.page.state.metricView,'created');assert.equal(f.page.exportMeta()[2][1],'未填写；按创建订单当前状态统计');
 });
 test(view+' explicit equal and disjoint success windows keep the original wire contract',async()=>{
  for(const same of [true,false]){const f=fixture(view);f.L.successFrom=same?f.L.from:'2026-10-13T08:00:00';f.L.successTo=same?f.L.to:'2026-10-14T09:00:00';const run=f.page.load(),q=copy(f.calls[0].q);assert.equal(Object.hasOwn(q,'includeSecondary'),false);assert.equal(q.successStartAt,f.L.successFrom+'.000Z');assert.equal(q.successEndAt,f.L.successTo+'.000Z');assert.deepEqual(copy(validate(q)),q);f.pending.shift().resolve(data(3));await run;assert.equal(f.page.state.applied.successWindowExplicit,true);}
 });
 test(view+' explicit success changes cancel a blank query and its late result cannot apply',async()=>{
  const f=fixture(view),old=f.page.load();f.context.withdrawMetricTimeSet('successFrom',f.L.from);f.context.withdrawMetricTimeSet('successTo',f.L.to);assert.equal(f.calls[0].o.signal.aborted,true);const next=f.page.load();assert.equal(f.calls[0].q.includeSecondary,false);assert.equal(Object.hasOwn(f.calls[1].q,'includeSecondary'),false);f.pending[1].resolve(data(9));await next;f.pending[0].resolve(data(99));await old;assert.equal(f.page.state.data.totals.total,9);assert.equal(f.page.state.applied.successWindowExplicit,true);
 });
}
test('background polling detects equal-clock manual intent added without a control callback',async()=>{
 const f=fixture(),timers=new Map();let id=0;f.context.setTimeout=fn=>{timers.set(++id,fn);return id};f.context.clearTimeout=key=>timers.delete(key);const run=f.page.load();f.pending.shift().resolve({prepared:{status:'building'}});await run;assert.equal(timers.size,1);f.L.successFrom=f.L.from;f.L.successTo=f.L.to;const [key,fn]=timers.entries().next().value;timers.delete(key);fn();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,1);assert.equal(f.page.state.prepared,null);assert.equal(f.page.state.dirty,true);assert.equal(timers.size,0);
});
test('verified not-requested response preserves local country-to-team projection without a second read',async()=>{
 const f=team.teamFixture({edit:blank});await f.page.load();const original=copy(f.page.state.data);f.ctx.withdrawTeam('M8');assert.equal(f.calls.length,1);assert.equal(f.page.state.dirty,false);assert.equal(f.page.state.data.totals.total,20);assert.equal(f.page.state.data.previousTotals.total,16);assert.deepEqual(copy(f.page.state.data.secondary),original.secondary);assert.deepEqual(copy(f.page.state.data.prepared),original.prepared);assert.equal(f.page.state.applied.query.includeSecondary,false);assert.equal(f.page.state.data.secondary.complete,false);
});
for(const [name,change] of [
 ['missing echo',d=>delete d.windows.includeSecondary],['extra secondary total',d=>d.secondary.total=0],['wrong secondary state',d=>d.secondary.state='observed_records'],['upgraded complete',d=>d.secondary.complete=true],['wrong basis',d=>d.secondary.basis='source_updated'],['wrong date',d=>d.secondary.startAt='2026-10-16T00:00:00.000Z'],['missing intersection marker',d=>delete d.secondary.createdIntersection],['nonempty secondary',d=>d.secondary.rows=[{country:'印度',platform:'M0'}]]
])test(name+' cannot bypass native secondary coverage during local team projection',async()=>{
 const f=team.teamFixture({edit:(d,L)=>{blank(d,L);change(d);}});await f.page.load();const original=f.page.state.data;f.ctx.withdrawTeam('M8');assert.equal(f.calls.length,1);assert.equal(f.page.state.dirty,true);assert.equal(f.page.state.data,original);
});
test('default no-secondary snapshot cannot serve a manually filled equal success window',async()=>{
 const f=team.teamFixture({edit:blank});await f.page.load();f.L.successFrom=f.L.from;f.L.successTo=f.L.to;f.ctx.withdrawTeam('M8');assert.equal(f.calls.length,1);assert.equal(f.page.state.dirty,true);assert.equal(f.page.canExport(),false);
});
test('host accepts only a boolean optional-secondary extension on the existing V2 action',()=>{
 const f=fixture(),q=copy(f.page.query());for(const includeSecondary of [true,false])assert.equal(validate({...q,includeSecondary}).includeSecondary,includeSecondary);
 for(const includeSecondary of [undefined,null,0,1,'false',[],{}])assert.throws(()=>validate({...q,includeSecondary}));
 for(const patch of [{windowVersion:1},{windowVersion:undefined},{action:'withdrawReasons'},{action:'aggregate'},{successStartAt:undefined},{successBasis:'created'}])assert.throws(()=>validate({...q,...patch}));
 const old={...q};delete old.includeSecondary;assert.deepEqual(copy(validate(old)),old,'older V2 clients keep the unchanged default-secondary request');
});
