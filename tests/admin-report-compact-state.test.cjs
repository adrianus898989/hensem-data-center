'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),plain=value=>JSON.parse(JSON.stringify(value));
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pages=['overview','providers','provider_payout','collection','payout'];
const report=(team='香港',direction='charge')=>({dataset:'team_sheet',system:'TEAM_SHEET_'+({香港:'HK',BDG:'BDG',达曼:'DAMAN'}[team]||'OTHER'),country:'印度',rawCountry:'印度',rawPlatform:team+'团队汇总',name:team+'团队汇总',team,currency:'INR',directions:[direction],records:2,provenance:{kind:'manual_file'},firstDate:'2026-10-15',lastDate:'2026-10-15'});
const metrics={amount:null,count:null,successAmount:'100.1',successCount:0};
const summary=(feed,more={})=>({...feed,rawCountry:feed.country,rawPlatform:feed.platform,currency:'INR',status:'received',updatedAt:'2026-10-16T00:00:00Z',records:2,coverage:{allRequestedReportsReceived:true},groups:[{grain:'provider',records:2,metrics:{...metrics},providers:[{provider:'SyntheticPay',records:2,metrics:{...metrics}}],daily:[]}],...more});
function fixture({mixed=false,feeds=[report(),report('香港','withdraw')],respond}={}){
 const context={};context.window=context;
 for(const name of ['live-provider-aliases.js','live-report-data.js','live-team-sheet-query.js'])vm.runInNewContext(fs.readFileSync(path.join(root,'admin-preview',name),'utf8'),context);
 const calls=[],native={id:'11111111-1111-4111-8111-111111111111',name:'Synthetic native',sourceName:'Synthetic native',team:'香港',country:'印度',source:'ar',currency:'INR',timezone:'Asia/Kolkata'},L={catalog:mixed?[native]:[],withdrawCatalog:[],country:'印度',team:'香港',direction:'charge',from:'2026-10-15T00:00:00',to:'2026-10-15T23:59:59',successFrom:'2026-10-15T00:00:00',successTo:'2026-10-15T23:59:59',successBasis:'success',multi:{team:['香港'],source:[],platform:[]},pageQueried:false};
 let currentPage='providers';
 const page=context.HensemLiveReportData.create({L,E:escape,N:value=>Number(value).toFixed(2),C:String,R:(n,d)=>String(n/d*100),displayAllowed:context.HensemLiveReportData.displayAllowed,request:async q=>{calls.push(plain(q));return q.action==='collectedData'?{rows:feeds}:respond?respond(q):{feeds:q.feeds.map(f=>summary(f))};}});
 const helper=context.HensemTeamSheetQuery.create({L,reportData:page,selection:()=>page.selected({country:L.country,teams:L.multi.team}),page:()=>currentPage});
 return{L,page,helper,calls,setPage:value=>{currentPage=value;L.direction=['provider_payout','payout'].includes(value)?'withdraw':'charge';}};
}
test('all five mixed report pages omit the idle panel and render never starts a summary read',async()=>{
 for(const name of pages){const f=fixture({mixed:true});await f.page.loadManualCatalog();f.setPage(name);assert.equal(f.helper.hasReports(),true);assert.equal(f.helper.onlyReports(),false);assert.equal(f.helper.render(),'');assert.deepEqual(f.calls,[{action:'collectedData',operation:'catalog',dataset:'team_sheet'}]);}
});
test('all five report-only pages keep one short unqueried state without a zero or a large panel',async()=>{
 for(const name of pages){const f=fixture();await f.page.loadManualCatalog();f.setPage(name);const html=f.helper.render();assert.equal(html,'<div class="live-report-state" role="status">源日报尚未查询</div>');assert.doesNotMatch(html,/<section|<header|<h2|<details|>0</);assert.equal(f.calls.length,1);}
});
test('every shared summary renderer has a compact idle state and detail pages retain their capability warning',async()=>{
 const f=fixture();await f.page.loadManualCatalog();
 for(const page of [...pages,'merchants','merchantproviders','teamops','teamcountries','teamplatforms']){const html=f.page.render({page});assert.match(html,/源日报尚未查询/);assert.doesNotMatch(html,/<section|<header|日报按所选起止日期/);}
 for(const page of ['orders','time','amount','matrix','latency','stuck','provider_daily'])assert.match(f.page.render({page}),/日报未提供逐笔订单/);
 assert.equal(f.calls.length,1);
});
test('loading and failures remain visible compact states in mixed selections without invented results',async()=>{
 const f=fixture({mixed:true});await f.page.loadManualCatalog();f.page.state.loading=true;let html=f.helper.render();assert.match(html,/正在读取源日报/);assert.doesNotMatch(html,/<section|<header|>0</);f.page.state.loading=false;
 for(const field of ['error','catalogError']){f.page.state[field]='<source unavailable>';html=f.helper.render();assert.match(html,/日报读取未完成，不能据此判断没有数据/);assert.match(html,/&lt;source unavailable&gt;/);assert.doesNotMatch(html,/<section|<source unavailable>|>0</);f.page.state[field]='';}
 assert.equal(f.calls.length,1);
});
test('loaded reports keep source dates and independent whole-day grain visible while routine explanation is collapsed',async()=>{
 for(const name of pages){const f=fixture();await f.page.loadManualCatalog();f.setPage(name);await f.helper.load();const html=f.helper.render(),details=html.match(/<details class="report-explanation">([\s\S]*?)<\/details>/);assert(details);assert.match(details[1],/^<summary>数据说明<\/summary>/);assert.match(details[1],/不按小时截取/);assert.match(details[1],/不同来源和统计粒度/);assert.doesNotMatch(details[0],/\bopen(?:[ =>])/);const outside=html.replace(details[0],'');assert.match(outside,/源日期 2026-10-15 至 2026-10-15/);assert.match(outside,/整日 · 独立列示/);assert.doesNotMatch(outside,/日报按所选起止日期/);assert.match(outside,/团队表格日报|100\.10/);assert.match(outside,/2026-10-16T00:00:00Z/);}
});
test('source coverage, unknown metrics and real zero remain visible outside the routine explanation',async()=>{
 const f=fixture({respond:q=>({feeds:q.feeds.map(feed=>summary(feed,{coverage:{allRequestedReportsReceived:false,receivedReportDays:3,expectedDays:4},sourceWarnings:[{kind:'unconfirmed'}]}))})});await f.page.loadManualCatalog();await f.helper.load();const html=f.helper.render().replace(/<details class="report-explanation">[\s\S]*?<\/details>/,'');assert.match(html,/日报 3\/4 天/);assert.match(html,/源表待核对/);assert.match(html,/>—<\/span>/);assert.match(html,/<td>0<\/td>/);assert.match(html,/100\.10/);
});
test('a missing source report is still missing and never rendered as a complete zero',async()=>{
 const f=fixture({respond:q=>({feeds:q.feeds.map(feed=>summary(feed,{status:'not_received',groups:[]}))})});await f.page.loadManualCatalog();await f.helper.load();const html=f.helper.render();assert.match(html,/所选日期未收到日报/);assert.doesNotMatch(html,/<td>0<\/td>|100\.10/);
});
test('provider filtering unsupported by a source grain remains explicit outside collapsed help',async()=>{
 const f=fixture({respond:q=>({feeds:q.feeds.map(feed=>summary(feed,{groups:[{grain:'platform',records:2,metrics:{...metrics},daily:[]}]}))})});await f.page.loadManualCatalog();await f.page.load({country:'印度',teams:['香港'],direction:'charge',providers:['SyntheticPay'],from:f.L.from,to:f.L.to});assert.match(f.helper.render().replace(/<details class="report-explanation">[\s\S]*?<\/details>/,''),/此来源粒度无法按三方筛选/);
});
test('unsupported team-report clocks keep their warning and send no summary request',async()=>{
 for(const patch of [{from:'2026-10-15T01:00:00'},{successFrom:'2026-10-14T00:00:00'},{successTo:'2026-10-16T23:59:59'},{successBasis:'source_updated'}]){const f=fixture({mixed:true});await f.page.loadManualCatalog();Object.assign(f.L,patch);await f.helper.load();assert.match(f.helper.render(),/团队表格只有整日报/);assert.equal(f.calls.length,1);}
});
test('unknown source links stay explicitly excluded from report statistics',async()=>{
 const f=fixture({feeds:[{...report(),dataset:'volume',provenance:{kind:'mixed'}}]});await f.page.loadCatalog();await f.page.load({country:'印度',teams:['香港'],direction:'charge',from:f.L.from,to:f.L.to});const html=f.page.render({page:'providers'});assert.match(html,/1 个来源链路尚未明确，暂不并入日报统计/);assert.equal(f.calls.filter(q=>q.action==='reportSummary').length,0);
});
test('the confirmed hidden-team display policy remains active in both idle and loaded report paths',async()=>{
 const f=fixture({feeds:[report(),report('BDG'),report('达曼')]});await f.page.loadManualCatalog();assert.deepEqual(plain(f.page.catalog().map(p=>p.team)),['香港']);await f.helper.load();assert.deepEqual(f.calls.find(q=>q.action==='reportSummary').feeds.map(feed=>feed.system),['TEAM_SHEET_HK']);assert.doesNotMatch(f.helper.render(),/BDG|达曼/);
});
