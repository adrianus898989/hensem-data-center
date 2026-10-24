const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-withdraw-pages.js'),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
// Same field contract as the Oct21 last-complete reader and its source coverage.
// Counts/platform/generation are synthetic; no production records or identifiers.
function payload(){const prior={country:'印度',platform:'SYNTHETIC',source:'AR',total:40000,processed:40000,success:38000,rejected:2000,autoCount:27000,manualCount:13000,unclassifiedCount:0,complete:false,classificationAvailable:true,avgSeconds:3100,durationBasis:'created_to_operated'};const row={...prior,total:22000,processed:22000,success:21000,rejected:1000,autoCount:15500,manualCount:6500,avgSeconds:2700,previous:prior};return {version:2,view:'auto',windows:{version:2,creationStartAt:'2026-10-21T00:00:00.000Z',creationEndAt:'2026-10-21T23:59:59.000Z',successStartAt:'2026-10-21T00:00:00.000Z',successEndAt:'2026-10-21T23:59:59.000Z',successBasis:'success'},prepared:{status:'ready',contract:'withdraw-independent-windows-v2',publicationVersion:2,generation:'a'.repeat(32),computedAt:'2026-10-21T10:23:03.093697Z',expiresAt:'2026-10-21T10:33:03.093697Z',calculationComplete:true,freshness:'refresh_due',refreshState:'failed'},rows:[row],total:1,totals:{...row,platforms:1},previousTotals:{...prior,platforms:1},comparison:{complete:false,matchedRows:1,totalRows:1},arCoverage:{coverageBasis:'unverified_source_continuity',currentComplete:false,previousComplete:false,complete:false},startDate:'2026-10-21',endDate:'2026-10-21',previousStartDate:'2026-10-20',previousEndDate:'2026-10-20',notes:[]};}
function fixture(data,view='auto_withdraw'){
 const calls=[],tables=[],root={Date,Intl,AbortController,document:{getElementById:()=>null,querySelector:()=>null},HensemLiveFilters:{multi:()=>''}};root.window=root;vm.runInNewContext(source,root);
 const L={catalogReady:true,country:'印度',team:'M8',multi:{team:['M8']},from:'2026-10-21T00:00:00',to:'2026-10-21T23:59:59',successFrom:'',successTo:'',catalog:[{id:'synthetic-native',name:'SYNTHETIC',country:'印度',team:'M8',source:'ar',timezone:'Asia/Kolkata'}]};let page,html='';
 page=root.HensemLiveWithdrawPages.create({L,E:x=>String(x??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),C:x=>String(x),N:x=>String(x),R:(a,b)=>b?(100*a/b).toFixed(2)+'%':'—',box:(title,body)=>body,table:(headers,rows,cls,footers)=>{tables.push({headers,rows,cls,footers});return '';},render:()=>{html=page.render();},page:()=>view,request:async q=>{calls.push(clone(q));return clone(data);}});return {page,root,L,calls,tables,html:()=>html,draw:()=>html=page.render()};
}
function complete(data){data.sourceComplete=true;data.prepared={...data.prepared,sourceComplete:true,freshness:'fresh',refreshState:'idle',expiresAt:'2099-01-01T00:00:00Z'};data.arCoverage={currentComplete:true,previousComplete:true,complete:true};data.rows.forEach(r=>{r.complete=true;r.previous.complete=true;});data.comparison.complete=true;return data;}
for(const view of ['auto_withdraw','withdraw_operators']){
 test(view+' keeps the old snapshot and timestamp while restoring observed platform comparisons',async()=>{
  const data=payload(),before=clone(data),h=fixture(data,view);await h.page.load();const html=h.html(),table=h.tables.at(-1);
  assert.match(html,/更新失败 · 已入库小计/);assert.match(html,/统计生成于 2026-10-21 15:53:03（Asia\/Kolkata）/);assert.match(html,/按同平台、同口径的已入库记录计算，不代表全天完整数据/);
  assert.match(html,view==='auto_withdraw'?/总笔数<\/label><strong>22000/:/处理笔数<\/label><strong>22000/);
  assert.doesNotMatch(html,/暂不计算涨跌/);assert.doesNotMatch(table.headers.join(''),/已入库小计/);assert.match(JSON.stringify(table.rows),/ pp/);assert.match(JSON.stringify(table.rows),/−400\.00 秒/);
  if(view==='auto_withdraw')assert.match(html,/-45\.00%.*同 1 平台/);
  assert.equal(h.page.state.data.totals.total,22000);assert.equal(h.page.state.data.previousTotals.total,40000);assert.deepEqual(data,before);h.draw();assert.equal(h.calls.length,1,'render never re-queries');
  assert.equal(h.L.successFrom,'');assert.equal(h.L.successTo,'');assert.match(JSON.stringify(h.page.exportMeta()),/已入库小计/);assert.match(JSON.stringify(h.page.exportMeta()),/同平台、同口径/);
 });
 test(view+' false or missing source proof remains unknown without blocking observed arithmetic',async()=>{
  for(const change of [d=>{delete d.prepared;delete d.arCoverage;delete d.comparison;},d=>{d.prepared.sourceComplete=false;delete d.sourceComplete;},d=>{d.prepared.expiresAt='2026-10-21T10:33:03Z';},d=>{d.comparison.complete=false;}]){
   const data=complete(payload());change(data);const before=clone(data),h=fixture(data,view);await h.page.load();assert.match(JSON.stringify(h.tables.at(-1).rows),/ pp/);assert.doesNotMatch(h.html(),/暂不计算涨跌/);assert.deepEqual(data,before);
  }
 });
 test(view+' explicit fresh complete sources retain comparisons and do not gain an unknown label',async()=>{
  const h=fixture(complete(payload()),view);await h.page.load();assert.doesNotMatch(h.html(),/已入库小计/);assert.match(h.html(),/withdraw-delta/);assert.equal(h.page.state.data.previousTotals.total,40000);
 });
}
test('unavailable previous metric is not zero and no valid matched platform cannot fall back to global totals',async()=>{
 const data=payload();data.rows[0].previous.total=null;data.previousTotals.total=90000;data.totals.total=0;data.rows[0].total=0;const h=fixture(data);await h.page.load();assert.match(h.html(),/总笔数<\/label><strong>0/);assert.match(h.html(),/无同平台、同口径的昨日对比值/);assert.doesNotMatch(h.html(),/NaN|Infinity|-100\.00%/);
});
test('all coverage families keep false source proof while permitting matched observed growth',async()=>{
 for(const name of ['wgCoverage','yashCoverage','newarCoverage','arCoverage','duoliCoverage','npgCoverage']){const data=complete(payload());data[name]={currentComplete:false,previousComplete:true,complete:false};const before=clone(data),h=fixture(data);await h.page.load();assert.match(h.html(),/已入库小计/,name);assert.match(h.html(),/-45\.00%/,name);assert.deepEqual(data,before);}
});
test('cross-platform, country, source, account or explicit statistic basis never enters row or summary deltas',async()=>{
 for(const [key,value]of Object.entries({platform:'OTHER',country:'其他',source:'NEWAR',statisticBasis:'success_date',account:'other'})){
  const data=complete(payload());data.rows[0].statisticBasis='applied_at_current_status';data.rows[0].account='same';data.rows[0].previous[key]=value;data.previousTotals.total=20000;
  const h=fixture(data);await h.page.load();assert.match(h.html(),/无同平台、同口径的昨日对比值/);assert.doesNotMatch(h.html(),/data-comparison-baseline="matched-platforms"/);
  assert.doesNotMatch(JSON.stringify(h.tables.at(-1).rows),/withdraw-delta| pp/);assert.equal(h.page.state.data.previousTotals.total,20000);
 }
});
test('unfinished calculation is distinct from missing source proof and does not enter comparisons',async()=>{
 for(const v of [false,undefined]){const data=complete(payload());if(v===undefined)delete data.prepared.calculationComplete;else data.prepared.calculationComplete=v;const h=fixture(data);await h.page.load();assert.match(h.html(),/统计尚未完成/);assert.doesNotMatch(h.html(),/withdraw-delta|matched-platforms/);assert.doesNotMatch(JSON.stringify(h.tables.at(-1).rows),/withdraw-delta| pp/);}
});
