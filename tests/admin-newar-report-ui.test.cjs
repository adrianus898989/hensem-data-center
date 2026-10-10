const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-report-data.js'),'utf8');
const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const selected={country:'印度',direction:'charge',from:'2026-10-09',to:'2026-10-09'};
const catalogFeed={dataset:'newar_third_party_volume',system:'NEW_AR',country:'印度',rawCountry:'IN',name:'MAANWIN',rawPlatform:'MAANWIN',directions:['charge'],records:1,provenance:{kind:'direct'}};
function summary(q,extra={}){return {...q,rawCountry:q.country,country:'印度',rawPlatform:q.platform,status:'received',statisticBasis:'created_at_current_status',timeBasis:'created_at',currency:'INR',detailCoverage:{complete:true,days:[{date:'2026-10-09',complete:true}]},records:1,groups:[{grain:'provider',records:1,metrics:{amount:123,count:3,successAmount:99,successCount:2},providers:[{provider:'Synthetic Pay',records:1,metrics:{amount:123,count:3,successAmount:99,successCount:2}}],daily:[]}],...extra};}
async function fixture(extra={},mixed=false){
 const calls=[],root={Date};root.window=root;vm.runInNewContext(source,root);
 const L={catalog:[{id:'maan',name:'MAANWIN',country:'印度',source:'newar'}],country:'印度',direction:'charge',from:selected.from,to:selected.to,multi:{team:[],platform:[],source:[]}};
 const page=root.HensemLiveReportData.create({L,E,N:n=>Number(n).toFixed(2),C:String,R:(n,d)=>(100*n/d).toFixed(2)+'%',render:()=>{},request:async q=>{calls.push(q);if(q.action==='collectedData')return {rows:[catalogFeed,...(mixed?[{...catalogFeed,dataset:'volume',system:'REPORT',provenance:{kind:'google_sheets'}}]:[])]};return {feeds:q.feeds.map(f=>f.dataset==='newar_third_party_volume'?summary(f,extra):summary(f,{statisticBasis:undefined,timeBasis:undefined,detailCoverage:undefined,currency:null}))};}});
 await page.load(selected);return {page,calls,html:()=>page.render({page:'providers'})};
}
test('NewAR summary retains original request identity and labels database detail statistics',async()=>{
 const f=await fixture(),html=f.html(),q=f.calls.find(q=>q.action==='reportSummary');
 assert.equal(q.feeds[0].dataset,'newar_third_party_volume');assert.equal(q.feeds[0].system,'NEW_AR');assert.equal(q.feeds[0].country,'IN');
 assert.match(html,/<h2>入库明细汇总<\/h2>/);assert.match(html,/data-newar-detail-coverage="complete"/);assert.match(html,/每 10 分钟入库明细/);assert.match(html,/与订单统计使用同一批明细/);assert.doesNotMatch(html,/源日报数据|三方日报|另有订单数据，独立核对/);
});
test('partial or unverifiable coverage cannot appear complete even with numeric data',async()=>{
 for(const days of [[],[{date:'2026-10-09',complete:false}],[{date:'2026-10-09',complete:true},{date:'2026-10-09',complete:true}],[{date:'2026-10-08',complete:true}]]){
  const f=await fixture({detailCoverage:{complete:true,days}}),html=f.html();assert.match(html,/data-newar-detail-coverage="partial"/);assert.match(html,/已入库部分，尚未完整采集/);assert.doesNotMatch(html,/data-newar-detail-coverage="complete"/);assert.match(html,/>123.00</);
 }
});
test('missing NewAR records remain unknown and do not call them an absent source report',async()=>{
 const html=(await fixture({status:'not_received',records:0,groups:[],detailCoverage:{complete:false,days:[]}})).html();assert.match(html,/所选日期未收到明细/);assert.doesNotMatch(html,/所选日期未收到日报/);
});
test('unknown or mixed detail currency never inherits a report currency label or zero amount',async()=>{
 const html=(await fixture({currency:null,groups:[{grain:'provider',records:1,metrics:{amount:null,count:3,successAmount:null,successCount:2}}]})).html();assert.match(html,/明细金额（币种未确定）/);assert.doesNotMatch(html,/原报表金额|>0.00</);assert.match(html,/class="muted">—/);
});
test('mixed source pages retain legacy labels while identifying NewAR details separately',async()=>{
 const html=(await fixture({},true)).html();assert.match(html,/<h2>入库明细汇总与源日报<\/h2>/);assert.match(html,/其他来源日报单独列示/);assert.match(html,/三方金额 \/ 笔数日报/);assert.match(html,/原报表金额（币种未提供）/);
});
