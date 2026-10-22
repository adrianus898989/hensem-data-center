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
 test(view+' failed last-complete remains visible as a dated subtotal without false day-over-day decline',async()=>{
  const data=payload(),before=clone(data),h=fixture(data,view);await h.page.load();const html=h.html();
  assert.match(html,/更新失败 · 已入库小计/);assert.match(html,/统计生成于 2026-10-21 15:53:03（Asia\/Kolkata）/);assert.match(html,/不能作为全天完整总计/);assert.match(html,/重新查询/);assert.match(html,view==='auto_withdraw'?/总笔数（已入库小计）<\/label><strong>22000/:/处理笔数（已入库小计）<\/label><strong>22000/);assert.match(html,/昨日已入库 40000 笔/);assert.match(html,/暂不计算涨跌/);assert.doesNotMatch(html,/withdraw-delta|data-comparison-baseline="matched-platforms"/);assert.equal(h.page.state.data.totals.total,22000);assert.equal(h.page.state.data.previousTotals.total,40000);assert.deepEqual(data,before);assert.equal(h.calls.length,1);h.draw();assert.equal(h.calls.length,1,'display never retries automatically');assert.equal(h.calls[0].successStartAt,h.calls[0].startAt);assert.equal(h.calls[0].successEndAt,h.calls[0].endAt);assert.equal(h.L.successFrom,'');assert.equal(h.L.successTo,'');const table=h.tables.at(-1);assert.match(table.headers.join(''),/已入库小计/);assert.doesNotMatch(JSON.stringify(table.rows.map(r=>r.slice(0,view==='auto_withdraw'?10:8))),/withdraw-delta| pp/,'volume/share comparisons cannot use stale subtotals');assert.match(JSON.stringify(table.rows),/−400\.00 秒/,'same-basis processing samples retain their separate observed duration comparison');assert.match(JSON.stringify(table.rows),/昨日已入库/);assert.match(JSON.stringify(h.page.exportMeta()),/已入库小计/);
 });
 test(view+' no publication/source metadata stays unknown and does not resurrect the old observed-percent path',async()=>{
  const data=payload();delete data.prepared;delete data.arCoverage;delete data.comparison;data.rows.forEach(r=>{delete r.complete;delete r.previous.complete;});const h=fixture(data,view);await h.page.load();assert.match(h.html(),/完整性未核验 · 已入库小计/);assert.match(h.html(),/统计生成时间未提供/);assert.match(h.html(),/昨日已入库 40000 笔/);assert.doesNotMatch(h.html(),/withdraw-delta|matched-platforms/);
 });
 test(view+' fresh calculation with false collection proof is still a subtotal',async()=>{
  const data=complete(payload());data.prepared.sourceComplete=false;delete data.sourceComplete;const h=fixture(data,view);await h.page.load();assert.match(h.html(),/完整性未核验 · 已入库小计/);assert.doesNotMatch(h.html(),/withdraw-delta|matched-platforms/);assert.equal(h.page.state.data.rows[0].success,21000);if(view==='auto_withdraw')assert.match(h.html(),/95\.45%/,'current success share keeps the existing stored denominator');
 });
 test(view+' a contradictory fresh label cannot make an expired snapshot current',async()=>{
  const data=complete(payload());data.prepared.expiresAt='2026-10-21T10:33:03.093697Z';const h=fixture(data,view);await h.page.load();assert.match(h.html(),/待更新 · 已入库小计/);assert.doesNotMatch(h.html(),/withdraw-delta|matched-platforms/);
 });
 test(view+' explicit fresh complete sources and comparable windows retain valid comparisons',async()=>{
  const h=fixture(complete(payload()),view);await h.page.load();assert.doesNotMatch(h.html(),/已入库小计/);assert.match(h.html(),/withdraw-delta/);assert.equal(h.page.state.data.totals.total,22000);assert.equal(h.page.state.data.previousTotals.total,40000);
 });
 test(view+' fresh verified current source with an unverified prior keeps prior values without growth',async()=>{
  const data=complete(payload());data.comparison.complete=false;const h=fixture(data,view);await h.page.load();assert.match(h.html(),/昨日已入库 40000 笔/);assert.doesNotMatch(h.html(),/withdraw-delta|matched-platforms/);
 });
}
test('unavailable previous metric is never replaced with zero while actual zero remains visible',async()=>{
 const data=payload();data.previousTotals.total=null;data.rows[0].previous.total=null;data.totals.total=0;data.rows[0].total=0;const h=fixture(data);await h.page.load();assert.match(h.html(),/总笔数（已入库小计）<\/label><strong>0/);assert.match(h.html(),/昨日已入库 —/);assert.doesNotMatch(h.html(),/昨日已入库 0 笔|NaN|Infinity/);
});
test('all source coverage families including NPG can veto a contradictory complete publication',async()=>{
 for(const name of ['wgCoverage','yashCoverage','newarCoverage','arCoverage','duoliCoverage','npgCoverage']){const data=complete(payload());data[name]={currentComplete:false,previousComplete:true,complete:false};const h=fixture(data);await h.page.load();assert.match(h.html(),/已入库小计/,name);assert.doesNotMatch(h.html(),/withdraw-delta|matched-platforms/,name);}
});

test('explicit contradictory false collection proof and prior row proof veto growth',async()=>{
 for(const change of [d=>{d.prepared.sourceComplete=false;},d=>{d.sourceComplete=false;},d=>{d.rows[0].previous.complete=false;}]){const data=complete(payload());change(data);const h=fixture(data);await h.page.load();assert.doesNotMatch(h.html(),/withdraw-delta|matched-platforms/);assert.match(h.html(),/昨日已入库 40000 笔/);}
});

test('fresh labels with missing or invalid publication proof remain unverified',async()=>{
 for(const change of [d=>{delete d.prepared.computedAt;},d=>{d.prepared.computedAt='invalid';},d=>{delete d.prepared.expiresAt;},d=>{d.prepared.expiresAt='invalid';},d=>{d.prepared.expiresAt=d.prepared.computedAt;},d=>{d.prepared.calculationComplete=false;},d=>{delete d.prepared.calculationComplete;}]){const data=complete(payload());change(data);const h=fixture(data);await h.page.load();assert.match(h.html(),/已入库小计/);assert.match(h.html(),/昨日已入库 40000 笔/);assert.doesNotMatch(h.html(),/withdraw-delta|matched-platforms/);}
});
