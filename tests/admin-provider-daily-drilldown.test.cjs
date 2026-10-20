/* Synthetic daily-provider drilldowns. Uses only aggregates already returned to this query. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const E=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const keys=['all_amount','all_count','success_amount','success_count','created_success_count','pending_amount','pending_count','failed_amount','failed_count','rejected_amount','rejected_count','unknown_amount','unknown_count'];
const stats=(all=10,success=6,extra={})=>({...Object.fromEntries(keys.map(key=>[key,0])),all_amount:all*100,all_count:all,success_amount:success*100,success_count:success,created_success_count:1,provider:'ExamplePay',date:'2026-09-24',direction:'charge',currency:'INR',...extra});
const plus=rows=>Object.fromEntries(keys.map(key=>[key,rows.some(row=>row[key]==null)?null:rows.reduce((sum,row)=>sum+Number(row[key]),0)]));
function combine(rows,keys){const groups=new Map();for(const row of rows){const key=JSON.stringify(keys.map(name=>row[name]));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}return [...groups.values()].map(rows=>({...rows[0],...plus(rows),items:rows}));}
const table=(headers,rows)=>'<table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
function fixture(){
 const platform=(id,source)=>({id,name:'Same Platform',source,country:'印度',currency:'INR'}),a=platform('a','ar'),b=platform('b','ar'),c=platform('c','newar'),make=(p,n,s)=>({platform:p,summary:[stats(n,s)],groups:{provider:[stats(n,s)],daily:[stats(n,s)]}});
 const L={serial:1,queryScope:'current',direction:'charge',currency:'INR',country:'印度',from:'2026-09-23T00:00:00',to:'2026-09-24T23:59:59',localPage:1,localSize:20,feeLookupRows:[],results:[make(a,10,12),make(b,20,7),make(c,40,30)]},root={},calls=[];L.catalog=[a,b,c];
 const context=vm.createContext({window:root,console,Intl,Date});root.HensemProviderSummary={providerTypeCell:()=> 'UPI'};
 for(const name of ['live-analysis-drilldown.js','live-pages-reference.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../admin-preview',name),'utf8'),context);
 const ctx={L,E,N:v=>v==null?'—':Number(v).toFixed(2),C:v=>v==null?'—':String(v),R:(n,d)=>n==null||d==null?'—':d>0?(n/d*100).toFixed(2)+'%':'—',plus,combine,empty:()=>stats(0,0),groupRows:name=>L.results.flatMap(r=>(r.groups[name]||[]).map(row=>({...row,source:r.platform.source,platformId:r.platform.id,platform:r.platform.name,country:r.platform.country}))),table,box:(title,body,note='',controls='')=>'<section><h2>'+title+'</h2>'+controls+body+'<p>'+note+'</p></section>',pager:()=>'',totals:()=>'',ensureFeeLookup:()=>{},query:()=>{throw Error('No additional query allowed')},request:q=>{calls.push(q);throw Error('No additional request allowed')},render:()=>{}};
 ctx.analysis=root.HensemAnalysisDrilldown.create(ctx);
 const render=()=>root.HensemLivePages.create(ctx).render('provider_daily'),action=(s,op='toggle')=>root.liveAnalysisAction(encodeURIComponent(JSON.stringify(s)),op),segment=(extra={})=>({kind:'provider_daily',provider:'ExamplePay',allSources:true,direction:'charge',date:'2026-09-24',country:'印度',currency:'INR',...extra});
 return {L,root,ctx,calls,render,action,segment};
}
const panel=html=>html.match(/<div class="analysis-drilldown analysis-provider-day">([\s\S]*?)<div class="analysis-note">/)[1];
const rawCells=html=>[...html.matchAll(/<tr>(.*?)<\/tr>/gs)].map(row=>[...row[1].matchAll(/<td>(.*?)<\/td>/gs)].map(cell=>cell[1])).filter(row=>row.length);
const cells=html=>rawCells(html).map(row=>row.map(value=>value.replace(/<[^>]*>/g,'')));

test('daily business controls have only collection and payout with collection as the local default',()=>{
 const h=fixture();h.L.direction='all';const html=h.render();const toolbar=html.match(/<div class="pd-toolbar">([\s\S]*?)<div class="pd-window">/)[1];
 assert.match(toolbar,/liveReferenceSet\('direction','charge'\)/);assert.match(toolbar,/liveReferenceSet\('direction','withdraw'\)/);assert.doesNotMatch(toolbar,/'all'|>全部</);assert.match(html,/>70\.00%<\/button>/);
});
test('one date-cell click opens all source platform rates under one provider row using exact date, direction and currency',()=>{
 const h=fixture();h.L.results[0].groups.daily.push(stats(900,900,{date:'2026-09-23'}),stats(800,800,{provider:'OtherPay'}),stats(700,700,{direction:'withdraw'}),stats(600,600,{currency:'USD'}));
 const initial=h.render();assert.match(initial,/>70\.00%<\/button>/);h.action(h.segment());const html=h.render(),detail=panel(html),rows=cells(detail);
 assert.deepEqual(rows,[['Same Platform','newar','4000.00','40','3000.00','30','75.00%'],['Same Platform','ar','2000.00','20','700.00','7','35.00%'],['Same Platform','ar','1000.00','10','1200.00','12','120.00%']]);
 const rates=rawCells(detail).map(row=>row[6]);assert.match(rates[1],/provider-daily-rate-low/);assert.match(rates[2],/class="provider-daily-rate"/);assert.doesNotMatch(rates[2],/provider-daily-rate-low/);
 assert.match(html,/<\/tr><tr class="analysis-expanded-row provider-daily-detail-row"><td colspan="5">/);assert.match(detail,/2026-09-24 · ExamplePay · 全部包网 · 代收/);assert.doesNotMatch(detail,/OtherPay|90000|80000|70000|60000|各平台占比|每日对比/);assert.equal(h.calls.length,0);
 assert.equal((html.match(/<td>ExamplePay<\/td>/g)||[]).length,2,'one matrix row and one same-day details row');assert.doesNotMatch(initial,/<th>包网来源<\/th>/);
});
test('opening a second day replaces the old row detail and a changed query clears expansion state',()=>{
 const h=fixture();h.L.results[0].groups.daily.push(stats(5,4,{date:'2026-09-23'}));h.render();h.action(h.segment());h.render();h.action(h.segment({date:'2026-09-23'}));let html=h.render();
 assert.equal((html.match(/analysis-provider-day/g)||[]).length,1);assert.match(panel(html),/2026-09-23/);assert.deepEqual(cells(panel(html)),[['Same Platform','ar','500.00','5','400.00','4','80.00%']]);
 h.action(h.segment({date:'2026-09-23'}));assert.doesNotMatch(h.render(),/analysis-provider-day/);h.action(h.segment());h.L.serial++;assert.doesNotMatch(h.render(),/analysis-provider-day/);assert.equal(h.calls.length,0);
});
test('payout rate cell expands payout only and a partial main query is labelled',()=>{
 const h=fixture();h.L.direction='withdraw';h.L.queryFailures=[{id:'missing'}];for(const result of h.L.results){result.groups.provider.push(stats(12,6,{direction:'withdraw'}));result.groups.daily.push(stats(12,6,{direction:'withdraw'}))}
 h.render();h.action(h.segment({direction:'withdraw'}));const detail=panel(h.render());assert.match(detail,/· 代付/);assert.match(detail,/1 个平台未读取/);assert.deepEqual(cells(detail),[['Same Platform','ar','1200.00','12','600.00','6','50.00%'],['Same Platform','ar','1200.00','12','600.00','6','50.00%'],['Same Platform','newar','1200.00','12','600.00','6','50.00%']]);assert.equal(h.calls.length,0);
});
test('success-only days remain inspectable with unknown rate and source text is encoded safely',()=>{
 const h=fixture(),unsafe='Pay\' <img src=x onerror="alert(1)">';for(const r of h.L.results){r.groups.provider=[stats(0,4,{provider:unsafe})];r.groups.daily=[stats(0,4,{provider:unsafe})]}
 h.L.dailyMetric='success_amount';let html=h.render();assert.match(html,/>1200\.00<\/button>/);assert.doesNotMatch(html,/<img|onclick="alert/);
 h.action(h.segment({provider:unsafe}));html=h.render();const detail=panel(html);assert.match(detail,/&lt;img/);assert(cells(detail).every(row=>row[6]==='—'));assert(cells(detail).every(row=>row[4]==='400.00'));assert.doesNotMatch(html,/NaN|Infinity|<img/);assert.equal(h.calls.length,0);
});

function matrixCells(html){const body=html.match(/<table\b[^>]*class="[^"]*\bprovider-daily-matrix-table\b[^"]*"[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)?.[1];assert(body,'provider daily matrix exists');return new Map(rawCells(body).map(row=>[row[0],row.at(-1)]));}
test('only known success rates strictly below 45 percent are red in both daily matrix directions',()=>{
 for(const direction of ['charge','withdraw']){
  const h=fixture(),cases=[['ZeroPay',100,0,'0.00%',true],['BelowPay',10000,4499,'44.99%',true],['BoundaryPay',100,45,'45.00%',false],['AbovePay',100,46,'46.00%',false],['UnknownSuccess',100,null,'—',false],['NoBase',0,4,'—',false]],rows=cases.map(([provider,n,s])=>stats(n,s,{provider,direction}));
  h.L.direction=direction;h.L.results=h.L.results.slice(0,1);h.L.results[0].groups={provider:rows,daily:rows};const rendered=h.render(),grid=matrixCells(rendered);
  for(const [provider,n,s,display,low] of cases){const cell=grid.get(provider);assert(cell,provider);assert.equal(cell.includes('provider-daily-rate-low'),low,direction+' '+provider+' threshold');assert(cell.includes('>'+display+'</button>'),direction+' '+provider+' value');assert.match(cell,/class="provider-daily-rate(?: |")/);}
  for(const [provider,n,s,display,low] of cases){h.action(h.segment({provider,direction}));const detail=panel(h.render()),rate=rawCells(detail)[0][6];assert.equal(rate.includes('provider-daily-rate-low'),low,direction+' '+provider+' expanded threshold');assert.equal(cells(detail)[0][6],display);h.action(h.segment({provider,direction}));}
  for(const metric of ['all_amount','all_count','success_amount','success_count']){h.L.dailyMetric=metric;for(const cell of matrixCells(h.render()).values())assert.doesNotMatch(cell,/provider-daily-rate(?:-low)?/,'amounts and counts do not inherit rate warning coloring');}
  assert.equal(h.calls.length,0);
 }
});
test('rate coloring preserves the encoded date-cell click and selected state without extra queries',()=>{
 const h=fixture();h.L.results=h.L.results.slice(0,1);h.L.results[0].groups.provider=[stats(100,44)];h.L.results[0].groups.daily=[stats(100,44)];
 const cell=matrixCells(h.render()).get('ExamplePay'),click=cell.match(/onclick="liveAnalysisAction\('([^']+)','([^']+)'\)"/);assert(click,'colored cell still exposes the original drilldown action');assert.deepEqual(JSON.parse(decodeURIComponent(click[1])),h.segment());assert.equal(click[2],'toggle');
 h.root.liveAnalysisAction(click[1],click[2]);const html=h.render(),detail=panel(html);assert.match(html,/provider-daily-rate-low/);assert.match(html,/analysis-value-button is-selected/);assert.match(detail,/2026-09-24 · ExamplePay · 全部包网 · 代收/);assert.deepEqual(cells(detail),[['Same Platform','ar','10000.00','100','4400.00','44','44.00%']]);assert.equal(h.calls.length,0);
 h.root.liveAnalysisAction(click[1],click[2]);assert.doesNotMatch(h.render(),/analysis-provider-day/);assert.equal(h.calls.length,0);
});

test('confirmed provider aliases merge across native systems and use total successful over total created orders',()=>{
 const h=fixture(),aliases=['ExamplePay','EXAMPLE-QR','ExamplePayINR'];
 h.root.HensemProviderNames={canonical:value=>aliases.includes(value)?'ExamplePay':value};
 h.L.results.forEach((result,i)=>{result.platform.source=['ar','newar','kb'][i];for(const rows of Object.values(result.groups))for(const row of rows)row.provider=aliases[i];});
 const html=h.render(),grid=matrixCells(html);assert.equal(grid.size,1);assert.match(grid.get('ExamplePay'),/>70\.00%<\/button>/);
 assert.doesNotMatch(html,/包网来源|>76\.67%<|<td>EXAMPLE-QR<\/td>|<td>ExamplePayINR<\/td>/);
 h.action(h.segment());assert.deepEqual(cells(panel(h.render())).map(r=>r[1]),['kb','newar','ar']);assert.equal(h.calls.length,0);
});

test('provider matrix and drilldown never combine another currency or country into the selected row',()=>{
 const h=fixture(),original=h.L.results[2];
 h.L.results.push({...original,platform:{...original.platform,id:'usd',currency:'USD'},groups:{provider:[stats(800,800,{currency:'USD'})],daily:[stats(800,800,{currency:'USD'})]}});
 h.L.results.push({...original,platform:{...original.platform,id:'co',country:'哥伦比亚'},groups:{provider:[stats(900,900)],daily:[stats(900,900)]}});
 assert.match(matrixCells(h.render()).get('ExamplePay'),/>70\.00%<\/button>/);
 h.action(h.segment());const detail=cells(panel(h.render()));assert.equal(detail.length,3);
 assert.equal(detail.reduce((sum,row)=>sum+Number(row[3]),0),70);assert.equal(detail.reduce((sum,row)=>sum+Number(row[5]),0),49);assert.equal(h.calls.length,0);
});

test('unknown metrics remain unknown after merging sources and in exported main-table cells',()=>{
 const h=fixture();h.L.results[1].groups.daily[0].success_count=null;h.L.results[1].groups.daily[0].success_amount=null;
 let html=h.render();assert.match(matrixCells(html).get('ExamplePay'),/>—<\/button>/);
 assert.doesNotMatch(matrixCells(html).get('ExamplePay'),/>0\.00%<\/button>/);
 h.L.dailyMetric='success_amount';html=h.render();assert.match(matrixCells(html).get('ExamplePay'),/>—<\/button>/);
 // Export reads the rendered table, which contains one source-combined row.
 const main=html.match(/<table\b[^>]*class="provider-daily-matrix-table"[\s\S]*?<\/table>/)[0];
 assert.equal(rawCells(main).length,1);assert.doesNotMatch(main,/>0\.00<\/button>/);assert.equal(h.calls.length,0);
});

test('business types retain native leaf evidence and differing types do not split the provider',()=>{
 const h=fixture();vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-provider-summary.js'),'utf8'),{window:h.root});
 h.L.results.forEach((result,i)=>result.platform.name=['Alpha','Beta','Gamma'][i]);
 h.L.feeLookupRows=['Alpha','Beta','Gamma'].map((platform,i)=>({scopeType:'platform',platform,country:'印度',provider:'ExamplePay',sourceTypeProvider:'ExamplePay',sourceType:i===1?'跑分':'扫码',sourceRow:i+1,sheetName:'Synthetic rates'}));
 const html=h.render();assert.equal(matrixCells(html).size,1);assert.match(html,/多种类型/);assert.match(html,/扫码/);assert.match(html,/跑分/);assert.equal(h.calls.length,0);
});
