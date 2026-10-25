/* Synthetic orders only. No network, credentials, browser session or database. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ui=fs.readFileSync(path.join(__dirname,'admin-live-ui.test.cjs'),'utf8');
const {ready,completeAggregate,renderedTables,plain,P}=new Function('require','__dirname',ui+'\nreturn {ready,completeAggregate,renderedTables,plain,P};')(name=>name==='node:test'?()=>{}:require(name),__dirname);
const windows=fs.readFileSync(path.join(__dirname,'../admin-preview/live-statistic-windows.js'),'utf8'),live=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8');
const ctx=vm.createContext({Date,Intl});vm.runInContext(windows,ctx);
const clockStart=live.indexOf(' const clockFormatters=new Map();'),clockEnd=live.indexOf(' function table(',clockStart);
assert(clockStart>=0&&clockEnd>clockStart);vm.runInContext(live.slice(clockStart,clockEnd)+';globalThis.nativeInstant=instant;',ctx);
const state=patch=>({from:'2026-10-19T00:00:00',to:'2026-10-19T23:59:59',successFrom:'',successTo:'',successBasis:'source_updated',direction:'withdraw',...patch});
const newar={...P,source:'NEW_AR',name:'Synthetic NEW_AR'};
function result(platform=newar,{direction='withdraw',missing=true,basis='success',count=10,success=7}={}){
 const r=completeAggregate(platform,count,success);r.successBasis=basis;
 r.capabilities={withdrawSuccessTimeAvailable:!missing,withdrawSecondaryTimeAvailable:basis==='source_updated'||!missing,withdrawSecondaryTimeUnavailableReason:missing&&basis==='success'?'payment_success_time_missing':null,withdrawLatencyAvailable:!missing};
 for(const rows of [r.summary,...Object.values(r.groups)])for(const row of rows){row.direction=direction;if(direction==='withdraw'&&missing&&basis==='success'){row.success_count=null;row.success_amount=null;row.estimated_fee=null;}}
 return r;
}
async function view(options={}){
 const platforms=options.platforms||[newar],h=await ready({platforms,manualOverview:true});
 vm.runInContext(windows,h.c);
 Object.assign(h.L,state({successBasis:options.basis||'success',direction:options.direction||'withdraw',successFrom:'2026-10-19T00:00:00',successTo:'2026-10-19T23:59:59'}),{country:'印度',pageQueried:true,overviewQueried:true,dirty:false,loading:false,queryPlatforms:platforms,results:options.results||[result(platforms[0],options)],comparisonStatus:'idle'});
 h.c.render();return h;
}
function businessTable(h){return renderedTables(h.html()).find(t=>t.headers.includes('成功笔数')&&t.rows.length);}

test('blank success inputs use the created cohort in each platform timezone despite a remembered update selector',()=>{
 for(const [zone,start,end]of [
  ['Asia/Kolkata','2026-10-18T18:30:00.000Z','2026-10-19T18:30:00.000Z'],
  ['Asia/Karachi','2026-10-18T19:00:00.000Z','2026-10-19T19:00:00.000Z'],
  ['America/Mexico_City','2026-10-19T06:00:00.000Z','2026-10-20T06:00:00.000Z']
 ]){
  const s=state(),before=JSON.stringify(s),q=ctx.HensemStatisticWindows.request(s,{source:'NEW_AR',timezone:zone},ctx.nativeInstant);
  assert.equal(q.successBasis,'created');assert.equal(q.startAt,start);assert.equal(q.endAt,end);assert.equal(Object.hasOwn(q,'successStartAt'),false);assert.equal(Object.hasOwn(q,'successEndAt'),false);assert.equal(JSON.stringify(s),before);
 }
});
test('the existing single-country UI changes country without borrowing another platform timezone',async()=>{
 const instrumented=ui.replace('context.window=context;','context.window=context;context.__preparedRequests=[];context.HensemPreparedAggregates={create:()=>({clear(){},cancel(){},async read(q){context.__preparedRequests.push(JSON.parse(JSON.stringify(q)));throw Error("synthetic read stop");}})};');
 const readyRequests=new Function('require','__dirname',instrumented+'\nreturn ready;')(name=>name==='node:test'?()=>{}:require(name),__dirname);
 const specs=[['印度','Asia/Kolkata','INR','2026-10-18T18:30:00.000Z','2026-10-19T18:30:00.000Z'],['巴基斯坦','Asia/Karachi','PKR','2026-10-18T19:00:00.000Z','2026-10-19T19:00:00.000Z'],['墨西哥','America/Mexico_City','MXN','2026-10-19T06:00:00.000Z','2026-10-20T06:00:00.000Z']];
 const platforms=specs.flatMap(([country,timezone,currency],i)=>[0,1].map(j=>({...newar,id:`${i+1}${j+1}111111-1111-4111-8111-111111111111`,name:`Synthetic ${i}/${j}`,country,timezone,currency})));
 const h=await readyRequests({platforms,manualOverview:true});vm.runInContext(windows,h.c);h.setNow('2026-10-21T12:00:00Z');
 for(const [country,timezone,,start,end]of specs){
  h.c.liveSet('country',country);h.c.liveSet('direction','withdraw');Object.assign(h.L,state());
  const before=h.c.__preparedRequests.length;await h.c.liveQuery();const requests=h.c.__preparedRequests.slice(before);
  assert.equal(requests.length,2,country);assert.deepEqual(Array.from(requests,q=>q.platformId).sort(),platforms.filter(p=>p.country===country).map(p=>p.id).sort());
  for(const q of requests){assert.equal(q.startAt,start);assert.equal(q.endAt,end);assert.equal(Object.hasOwn(q,'successStartAt'),false);assert.equal(Object.hasOwn(q,'successEndAt'),false);assert.equal(q.successBasis,'created');assert.equal(platforms.find(p=>p.id===q.platformId).timezone,timezone);}
 }
 h.c.liveSet('country','all');assert.equal(h.L.country,'墨西哥','the original UI requires one concrete country');
});
test('explicit update window stays independent and a partial pair is rejected',()=>{
 const s=state({successFrom:'2026-10-20T01:02:03',successTo:'2026-10-20T01:02:03'}),q=ctx.HensemStatisticWindows.request(s,{source:'newar',timezone:'Asia/Kolkata'},ctx.nativeInstant);
 assert.equal(q.successBasis,'source_updated');assert.equal(q.successStartAt,'2026-10-19T19:32:03.000Z');assert.equal(q.successEndAt,'2026-10-19T19:32:04.000Z');assert.notEqual(q.successStartAt,q.startAt);
 assert.throws(()=>ctx.HensemStatisticWindows.request(state({successFrom:s.successFrom}),{source:'newar',timezone:'Asia/Kolkata'},ctx.nativeInstant),/同时填写/);
});
test('all native sources use the created cohort while optional success inputs are blank',()=>{
 for(const source of ['newar','ar','wg','kb','panda','lg','game66']){
  const q=ctx.HensemStatisticWindows.request(state({direction:'charge'}),{source,timezone:'Asia/Kolkata'},ctx.nativeInstant);assert.equal(q.successBasis,'created',source);assert.equal(Object.hasOwn(q,'successStartAt'),false);assert.equal(Object.hasOwn(q,'successEndAt'),false);
 }
 assert.equal(ctx.HensemStatisticWindows.request(state(),{source:'duoli',timezone:'Asia/Jakarta'},ctx.nativeInstant).successBasis,'created');
});
test('selector is opt-in and explains its clock without filling optional ranges',()=>{
 const s=state(),html=ctx.HensemStatisticWindows.render(s,String,'Asia/Kolkata',{allowSourceUpdated:true});
 assert.match(html,/新中台出款成功统计依据/);assert.match(html,/value="source_updated" selected/);assert.match(html,/更新开始时间（可选）/);assert.match(html,/不代表实际到账时间/);assert.equal(s.successFrom,'');
 assert.doesNotMatch(ctx.HensemStatisticWindows.render(s,String,'Asia/Kolkata'),/liveMetricBasis|<select/);
});
test('missing paid clock renders unknown success and separately labels created-cohort current successes',async()=>{
 const h=await view();assert.match(h.html(),/data-newar-success-clock/);assert.match(h.html(),/不能当作 0/);assert.match(plain(h.html()),/申请单当前成功金额/);const cohort=renderedTables(h.html()).find(t=>t.headers.includes('申请单当前成功笔数'));assert.equal(plain(cohort.rows[0][3]),'7');assert.equal(plain(cohort.rows[0][2]),'—','old cache without the new amount is unknown');
 const t=businessTable(h);assert(t);const ix=t.headers.findIndex(x=>/成功笔数/.test(x));assert(t.rows.some(row=>plain(row[ix])==='—'),JSON.stringify(t));
 assert.match(h.nodes.get('liveFilters').innerHTML,/liveMetricBasis/);
});
test('complete known zero remains numeric zero rather than an unknown-clock warning',async()=>{
 const h=await view({missing:false,count:0,success:0});assert.doesNotMatch(h.html(),/data-newar-success-clock|不能当作 0/);
 const t=businessTable(h);assert(t);const ix=t.headers.findIndex(x=>/成功笔数/.test(x));assert(t.rows.some(row=>plain(row[ix])==='0'),JSON.stringify(t));
});
test('source-update totals stay available despite missing paid clock and never claim payment latency',async()=>{
 const h=await view({basis:'source_updated'});assert.match(h.html(),/不代表实际到账时间/);assert.doesNotMatch(h.html(),/不能当作 0|多利成功/);
 const t=businessTable(h);assert(t);const ix=t.headers.findIndex(x=>/成功笔数/.test(x));assert(t.rows.some(row=>plain(row[ix])==='7'),JSON.stringify(t));
 h.c.liveOverviewTab('latency');assert.match(h.html(),/成功时效暂不可用|到账时效暂不可统计/);
});
test('NEW_AR charge is unaffected by withdrawal-only missing clock metadata',async()=>{
 const h=await view({direction:'charge'});assert.doesNotMatch(h.html(),/data-newar-success-clock/);assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/liveMetricBasis/);
 const t=businessTable(h);assert(t);const ix=t.headers.findIndex(x=>/成功笔数/.test(x));assert(t.rows.some(row=>plain(row[ix])==='7'),JSON.stringify(t));
});
test('other systems have no NEW_AR selector or notice',async()=>{
 const h=await view({platforms:[P],results:[result(P,{missing:false})]});assert.doesNotMatch(h.html(),/data-newar-success-clock/);assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/liveMetricBasis/);
});
test('mixed-source selection cannot silently switch other systems to the new clock',async()=>{
 const ar={...P,id:'22222222-2222-4222-8222-222222222222'},h=await view({platforms:[newar,ar],results:[result(newar),result(ar,{missing:false})]});assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/liveMetricBasis/);assert.match(h.html(),/不能当作 0/);
});
test('mixed cached update results keep the new middle-office label and remain available despite paid-clock catalog flags',async()=>{
 const platform={...newar,capabilities:{withdrawSuccessTimeAvailable:false,withdrawSecondaryTimeAvailable:false}},ar={...P,id:'22222222-2222-4222-8222-222222222222'};
 const h=await view({platforms:[platform,ar],results:[result(platform,{basis:'source_updated'}),result(ar,{missing:false,success:6})]});
 assert.match(h.html(),/新中台按源订单更新时间/);assert.doesNotMatch(h.html(),/多利按更新时间|多利成功|不能当作 0/);
 const t=businessTable(h),ix=t.headers.findIndex(x=>/成功笔数/.test(x));assert(t.rows.some(row=>plain(row[ix])==='13'),JSON.stringify(t));
});
test('switching to charge resets a prior explicit NEW_AR choice without reading data',async()=>{
 const h=await view({basis:'source_updated'}),before=h.calls.length;h.c.liveSet('direction','charge');assert.equal(h.L.successBasis,'success');assert.equal(h.L.direction,'charge');assert.equal(h.calls.slice(before).filter(q=>['aggregate','aggregatePrepared'].includes(q.action)).length,0);assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/liveMetricBasis/);
});
test('known missing update clock stays unknown even when update mode is selected',async()=>{
 const r=result(newar,{basis:'source_updated'});r.capabilities.withdrawSecondaryTimeAvailable=false;r.summary[0].success_count=null;r.summary[0].success_amount=null;
 for(const rows of Object.values(r.groups))for(const row of rows){row.success_count=null;row.success_amount=null;}
 const h=await view({basis:'source_updated',results:[r]});const t=businessTable(h),ix=t.headers.findIndex(x=>/成功笔数/.test(x));assert(t.rows.some(row=>plain(row[ix])==='—'));
});
test('paid-clock catalog flags cannot mask an explicitly available update-clock result',async()=>{
 const platform={...newar,capabilities:{withdrawSuccessTimeAvailable:false,withdrawSecondaryTimeAvailable:false}},h=await view({platforms:[platform],basis:'source_updated',results:[result(platform,{basis:'source_updated'})]});
 const t=businessTable(h),ix=t.headers.findIndex(x=>/成功笔数/.test(x));assert(t.rows.some(row=>plain(row[ix])==='7'));assert.doesNotMatch(h.html(),/不能当作 0/);
});
test('mixed merchant ledger preserves the known platform row and creation totals while success total is unknown',async()=>{
 const ar={...P,id:'22222222-2222-4222-8222-222222222222'},h=await view({platforms:[newar,ar],results:[result(newar),result(ar,{missing:false,success:6})]});
 h.c.state.page='merchants';h.L.view='business';h.c.render();
 const t=renderedTables(h.html()).find(t=>t.headers.includes('代付成功笔数'));assert(t);
 const known=t.rows.find(row=>plain(row[0])===ar.name),missing=t.rows.find(row=>plain(row[0])===newar.name),ix=t.headers.indexOf('代付成功笔数');
 assert(known&&missing);assert.equal(plain(known[ix]),'6');assert.equal(plain(missing[ix]),'—');
 assert.equal(plain(known[t.headers.indexOf('代付成功率')]),'60.00%');assert.equal(plain(missing[t.headers.indexOf('代付成功率')]),'—');
 for(const row of [known,missing]){assert.equal(plain(row[t.headers.indexOf('代付全部笔数')]),'10');assert.equal(plain(row[t.headers.indexOf('代付全部金额')]),'1,000.00');}
 assert.equal(h.c.HensemProviderSummary.knownNumber(null),null);assert.equal(h.c.HensemProviderSummary.fraction(null,10),null);
 const unknownFee=h.c.HensemProviderSummary.feeSummary([{success_count:null,estimated_fee:null,fee_unknown:true}]);assert.equal(unknownFee.amount,null);assert.equal(unknownFee.complete,false);
});
test('export preserves unknown cells and explicitly labels a selected update window',async()=>{
 for(const basis of ['success','source_updated']){
  const h=await view({basis});h.L.feeLookupLoading=false;
  const value=basis==='success'?'—':'700.00',table={closest:()=>null,querySelectorAll:()=>[{cells:[{innerText:'成功金额'},{innerText:'成功笔数'},{innerText:'成功率'}],closest:()=>null},{cells:[{innerText:value},{innerText:basis==='success'?'—':'7'},{innerText:basis==='success'?'—':'70.00%'}],closest:()=>null}]};
  h.nodes.get('page').querySelectorAll=()=>[table];h.c.liveExport();assert.equal(h.blobs.length,1);const csv=await h.blobs[0].text();
  if(basis==='success')assert.match(csv,/"—","—","—"/);else{assert.match(csv,/源订单更新时间/);assert.match(csv,/不代表实际到账时间/);assert.match(csv,/"700.00","7","70.00%"/);}
 }
});
test('provider drawer shows an unknown paid-clock count and never queries unsupported update-clock raw orders',async()=>{
 for(const basis of ['success','source_updated']){
  const h=await view({basis});h.setNow('2026-10-20T12:00:00Z');h.L.queryNow=Date.parse('2026-10-20T12:00:00Z');h.L.status='success';h.L.results[0].platform={...newar,capabilities:{...h.L.results[0].capabilities}};const before=h.calls.length;
  await h.c.liveProviderOrders('Synthetic provider','NEW_AR','withdraw');
  assert.equal(h.calls.length,before,'an unsupported clock must not fall through to a paid-clock details request');
  const html=h.drawers.at(-1).html;
  if(basis==='success'){assert.match(html,/成功时间 · — 笔/);assert.match(html,/缺少付款成功时间/);assert.doesNotMatch(html,/成功时间 · 0 笔/);}
  else assert.match(html,/源订单更新时间统计的成功订单原始明细暂不可用/);
  assert.match(html,/请将状态改为全部/);
 }
});

test('member counts mask only NEW_AR withdrawal success, retaining creation counts and other platforms',async()=>{
 const c=vm.createContext({Date,Intl,console,AbortController});c.window=c;vm.runInContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-member-counts.js'),'utf8'),c);
 const other={...P,id:'22222222-2222-4222-8222-222222222222'},platforms=[newar,other],L={country:'印度',from:'2026-10-19T00:00:00',to:'2026-10-19T23:59:59',direction:'all',status:'all',dirty:false,multi:{}};
 const query=p=>({platformId:p.id,startAt:'2026-10-18T18:30:00Z',endAt:'2026-10-19T18:30:00Z',direction:'all',status:'all'});
 const page=c.HensemLiveMemberCounts.create({L,E:String,C:n=>n===null?'—':String(n),selected:()=>platforms,query,accessContext:()=>['synthetic'],successClockUnavailable:p=>p.id===newar.id,render(){},open(){},request:async q=>({platform:platforms.find(p=>p.id===q.platformId),startAt:q.startAt,endAt:q.endAt,capabilities:{memberIdentity:true,createdBasis:'created_at',successBasis:'success_at',dedupe:'platform_local_date_direction_member'},rows:['charge','withdraw'].map(direction=>({date:'2026-10-19',direction,created_member_count:4,created_order_count:10,created_missing_member_count:0,success_member_count:3,success_order_count:7,success_missing_member_count:0}))})});
 await page.ensure();assert.equal(page.platformMetric([newar.id],'withdraw').value,null);assert.match(page.platformMetric([newar.id],'withdraw').title,/缺少付款成功时间/);assert.equal(page.platformMetric([newar.id],'charge').value,3);assert.equal(page.platformMetric([other.id],'withdraw').value,3);assert.match(page.metric('withdraw'),/8 \/ 3/);assert.match(page.metric('withdraw'),/部分数据|已知人数/);
});
test('all-direction success total remains unknown through exact cache reuse and withdrawal narrowing while charge stays known',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'admin-aggregate-cache.test.cjs'),'utf8');
 const fixture=new Function('require','__dirname',source+'\nreturn {ready,read,request,response,P,queries};')(name=>name==='node:test'?()=>{}:require(name),__dirname);
 const h=await fixture.ready(),platform={...fixture.P,source:'NEW_AR'};h.L.catalog=[platform];
 h.setHandler(q=>{const r=fixture.response(q,platform,{total:null});r.summary=[{...r.summary[0],direction:'charge',success_count:5},{...r.summary[0],direction:'withdraw',success_count:null,success_amount:null}];return r;});
 const q=fixture.request({status:'success'}),first=await fixture.read(h,q);assert.equal(first.total,null);
 const calls=fixture.queries(h).length,same=await fixture.read(h,q),withdraw=await fixture.read(h,{...q,direction:'withdraw'}),charge=await fixture.read(h,{...q,direction:'charge'});
 assert.equal(same.total,null);assert.equal(withdraw.total,null);assert.equal(charge.total,5);assert.equal(fixture.queries(h).length,calls);assert.equal(same._aggregateCacheHit,true);assert.equal(withdraw._aggregateCacheHit,true);
});
test('created-cohort amount is separate from payment-window success and uses each platform own application clock',async()=>{
 for(const [country,timezone,currency,start,end] of [
  ['印度','Asia/Kolkata','INR','2026-10-18T18:30:00Z','2026-10-19T18:30:00Z'],
  ['巴基斯坦','Asia/Karachi','PKR','2026-10-18T19:00:00Z','2026-10-19T19:00:00Z'],
  ['墨西哥','America/Mexico_City','MXN','2026-10-19T06:00:00Z','2026-10-20T06:00:00Z']
 ]){
  const platform={...newar,country,timezone,currency},r=result(platform);Object.assign(r,{startAt:start,endAt:end});Object.assign(r.summary[0],{currency,created_success_amount:'1234.56'});
  const before=JSON.stringify(r),h=await view({platforms:[platform],results:[r]});h.L.country=country;h.c.render();
  const t=renderedTables(h.html()).find(t=>t.headers.includes('申请单当前成功金额'));assert(t);assert.equal(t.rows.length,1);
  assert.equal(plain(t.rows[0][2]),'1,234.56');assert.equal(plain(t.rows[0][3]),'7');assert.equal(plain(t.rows[0][4]),currency);
  assert.match(plain(t.rows[0][1]),/2026-10-19 00:00:00 至 2026-10-19 23:59:59/);assert(plain(t.rows[0][1]).includes(timezone));
  assert.match(h.html(),/不代表该期间实际到账金额/);assert.equal(r.summary[0].success_amount,null);assert.equal(JSON.stringify(r),before);
  const main=businessTable(h),ix=main.headers.findIndex(x=>x==='成功金额');assert(main.rows.some(row=>plain(row[ix])==='—'));
 }
});
test('created-cohort missing amounts stay unknown, known zero stays zero, and separate currencies are never added',async()=>{
 const r=result(),row={...r.summary[0],created_success_count:0,created_success_amount:'0'};
 r.summary=[{...row,currency:'INR'},{...row,currency:'PKR',created_success_count:2,created_success_amount:null},{...row,currency:'MXN',created_success_count:1,created_success_amount:undefined}];
 const h=await view({results:[r]}),t=renderedTables(h.html()).find(t=>t.headers.includes('申请单当前成功金额'));
 assert.equal(t.rows.length,3);assert.deepEqual(t.rows.map(row=>row.map(plain).slice(2)),[['0.00','0','INR'],['—','2','PKR'],['—','1','MXN']]);
});
test('explicit updated-clock amount and created-cohort amount stay independent and exclude other sources',async()=>{
 const ar={...P,id:'22222222-2222-4222-8222-222222222222'},r=result(newar,{basis:'source_updated'});r.summary[0].created_success_amount='1234.56';
 const h=await view({basis:'source_updated',platforms:[newar,ar],results:[r,result(ar,{missing:false,success:6})]});
 const cohort=renderedTables(h.html()).find(t=>t.headers.includes('申请单当前成功金额'));assert.equal(cohort.rows.length,1);assert.equal(plain(cohort.rows[0][0]),newar.name);assert.equal(plain(cohort.rows[0][2]),'1,234.56');
 assert.equal(r.summary[0].success_amount,'700');assert.equal(r.summary[0].created_success_amount,'1234.56');
});
test('the actual CSV export includes the rendered application-cohort table, currency, and distinct basis metadata',async()=>{
 const r=result();r.summary[0].created_success_amount='1234.56';r.startAt='2026-10-18T18:30:00Z';r.endAt='2026-10-19T18:30:00Z';
 const h=await view({results:[r]});h.L.feeLookupLoading=false;
 const rendered=renderedTables(h.html());assert(rendered.some(t=>t.headers.includes('申请单当前成功金额')));
 h.nodes.get('page').querySelectorAll=()=>rendered.map(t=>({closest:()=>null,querySelectorAll:()=>[t.headers,...t.rows.map(row=>row.map(plain))].map(cells=>({closest:()=>null,cells:cells.map(innerText=>({innerText}))}))}));
 h.c.liveExport();assert.equal(h.blobs.length,1);const csv=await h.blobs[0].text();
 assert.match(csv,/"申请单当前成功口径","按各平台当地申请时间选单/);assert.match(csv,/"申请单当前成功金额","申请单当前成功笔数","币种"/);
 assert.match(csv,/"1,234.56","7","INR"/);assert.match(csv,/2026-10-19 00:00:00 至 2026-10-19 23:59:59 · Asia\/Kolkata/);
 assert.match(csv,/"成功金额"/);assert.match(csv,/"—"/);assert.match(csv,/不代表该期间实际到账金额/);
});
test('cohort amount survives aggregate summing but unknown old partitions or mixed currencies never become zero',()=>{
 const c=vm.createContext({});vm.runInContext(live.slice(live.indexOf(' const countKeys='),live.indexOf(' const amountBands='))+';globalThis.sum=plus;',c);
 assert.equal(c.sum([{currency:'INR',created_success_amount:'12.5'},{currency:'INR',created_success_amount:'7.5'}]).created_success_amount,20);
 assert.equal(c.sum([{currency:'INR',created_success_amount:'12.5'},{currency:'INR'}]).created_success_amount,null);
 assert.equal(c.sum([{currency:'INR',created_success_amount:'12.5'},{currency:'PKR',created_success_amount:'7.5'}]).created_success_amount,null);
});
test('exact cache and direction projection retain independent cohort fields without replacing payment success totals',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'admin-aggregate-cache.test.cjs'),'utf8');
 const fixture=new Function('require','__dirname',source+'\nreturn {ready,read,request,response,P,queries};')(name=>name==='node:test'?()=>{}:require(name),__dirname);
 const h=await fixture.ready(),platform={...fixture.P,source:'NEW_AR'};h.L.catalog=[platform];
 h.setHandler(q=>{const r=fixture.response(q,platform);r.summary=[{...r.summary[0],direction:'charge'},{...r.summary[0],direction:'withdraw',success_count:null,success_amount:null,created_success_count:7,created_success_amount:'1234.56'}];return r;});
 const q=fixture.request();await fixture.read(h,q);const before=fixture.queries(h).length,hit=await fixture.read(h,{...q,direction:'withdraw'});
 assert.equal(fixture.queries(h).length,before);assert.equal(hit._aggregateCacheHit,true);assert.equal(hit.summary.length,1);assert.equal(hit.summary[0].created_success_amount,'1234.56');assert.equal(hit.summary[0].created_success_count,7);assert.equal(hit.summary[0].success_amount,null);
});
test('team provider view accepts combined platform ID Sets and preserves unknown withdrawal success without breaking the page',async()=>{
 const other={...P,id:'22222222-2222-4222-8222-222222222222'},h=await view({platforms:[newar,other],results:[result(newar),result(other,{missing:false,success:6})]});
 h.c.state.page='teamops';h.L.view='providers';assert.doesNotThrow(()=>h.c.render());assert.match(h.html(),/三方经营汇总/);
 const t=renderedTables(h.html()).find(t=>t.headers.includes('来源')&&t.headers.includes('成功笔数'));assert(t);
 const amount=t.headers.indexOf('成功金额'),success=t.headers.indexOf('成功笔数'),count=t.headers.indexOf('全部笔数'),source=t.headers.indexOf('来源');
 const missing=t.rows.find(row=>plain(row[source])==='NEW_AR'),known=t.rows.find(row=>plain(row[source])==='AR');assert(missing&&known);
 assert.equal(plain(missing[count]),'10');assert.equal(plain(missing[success]),'—');assert.equal(plain(missing[amount]),'—');assert.equal(plain(known[success]),'6');
 const footer=t.html.match(/<tfoot>([\s\S]*?)<\/tfoot>/)?.[1];assert(footer);const cells=[...footer.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m=>plain(m[1]));
 assert.equal(cells[count],'20');assert.equal(cells[success],'—');assert.equal(cells[amount],'—');
});
test('row clock scope accepts both arrays and sets, while empty or missing IDs conservatively remain unknown',()=>{
 const c=vm.createContext({L:{results:[{platform:{id:'missing',source:'newar'}}],queryPlatforms:[]},orderSource:p=>p?.source,sourceSuccessTimeUnavailable:p=>p?.id==='missing'});
 vm.runInContext(live.slice(live.indexOf(' const successRowsTimeUnavailable='),live.indexOf(' // Empty sources can have no summary row'))+';globalThis.unavailable=successRowsTimeUnavailable;',c);
 for(const platformIds of [new Set(['missing']),['missing']])assert.equal(c.unavailable([{platformIds}],'withdraw'),true);
 for(const platformIds of [new Set(['known']),['known']])assert.equal(c.unavailable([{platformIds}],'withdraw'),false);
 for(const row of [{},{platformIds:new Set()},{platformIds:[]},{platformIds:[null]}])assert.equal(c.unavailable([row],'withdraw'),true);
 assert.equal(c.unavailable([{platformId:'known'}],'withdraw'),false);
});
test('daily provider explanation preserves an explicitly supplied update clock window',async()=>{
 const h=await view({basis:'source_updated'});h.c.state.page='provider_daily';assert.doesNotThrow(()=>h.c.render());
 assert.match(h.html(),/源订单更新时间 · 2026-10-19 00:00:00 至 2026-10-19 23:59:59/);assert.doesNotMatch(h.html(),/成功按各平台当地成功日期/);
 assert.equal(h.L.successFrom,'2026-10-19T00:00:00');assert.equal(h.L.successTo,'2026-10-19T23:59:59');
});
test('explicitly unknown cohort currency is not replaced by the platform default or merged with confirmed currency',async()=>{
 const r=result();r.summary=[{...r.summary[0],currency:'INR',created_success_amount:'100',created_success_count:1},{...r.summary[0],currency:null,created_success_amount:'200',created_success_count:2}];
 const h=await view({results:[r]}),t=renderedTables(h.html()).find(t=>t.headers.includes('申请单当前成功金额'));
 assert.deepEqual(t.rows.map(row=>row.map(plain).slice(2)),[['100.00','1','INR'],['200.00','2','币种待确认']]);
});
