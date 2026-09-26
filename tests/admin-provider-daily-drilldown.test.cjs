/* Synthetic daily-provider drilldowns. Uses only aggregates already returned to this query. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const E=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const keys=['all_amount','all_count','success_amount','success_count','created_success_count','pending_amount','pending_count','failed_amount','failed_count','rejected_amount','rejected_count','unknown_amount','unknown_count'];
const stats=(all=10,success=6,extra={})=>({...Object.fromEntries(keys.map(key=>[key,0])),all_amount:all*100,all_count:all,success_amount:success*100,success_count:success,created_success_count:1,provider:'ExamplePay',date:'2026-09-24',direction:'charge',currency:'INR',...extra});
const plus=rows=>Object.fromEntries(keys.map(key=>[key,rows.some(row=>row[key]==null)?null:rows.reduce((sum,row)=>sum+Number(row[key]),0)]));
function combine(rows,keys){const groups=new Map();for(const row of rows){const key=JSON.stringify(keys.map(name=>row[name]));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}return [...groups.values()].map(rows=>({...rows[0],...plus(rows)}));}
const table=(headers,rows)=>'<table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
function fixture(){
 const platform=(id,source)=>({id,name:'Same Platform',source,currency:'INR'}),a=platform('a','ar'),b=platform('b','ar'),c=platform('c','newar'),make=(p,n,s)=>({platform:p,summary:[stats(n,s)],groups:{provider:[stats(n,s)],daily:[stats(n,s)]}});
 const L={serial:1,queryScope:'current',direction:'charge',currency:'INR',country:'印度',from:'2026-09-23T00:00:00',to:'2026-09-24T23:59:59',localPage:1,localSize:20,feeLookupRows:[],results:[make(a,10,12),make(b,20,7),make(c,40,30)]},root={},calls=[];L.catalog=[a,b,c];
 const context=vm.createContext({window:root,console,Intl,Date});root.HensemProviderSummary={providerTypeCell:()=> 'UPI'};
 for(const name of ['live-analysis-drilldown.js','live-pages-reference.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../admin-preview',name),'utf8'),context);
 const ctx={L,E,N:v=>v==null?'—':Number(v).toFixed(2),C:v=>v==null?'—':String(v),R:(n,d)=>d>0?(n/d*100).toFixed(2)+'%':'—',plus,combine,empty:()=>stats(0,0),groupRows:name=>L.results.flatMap(r=>(r.groups[name]||[]).map(row=>({...row,source:r.platform.source,platformId:r.platform.id,platform:r.platform.name}))),table,box:(title,body,note='',controls='')=>'<section><h2>'+title+'</h2>'+controls+body+'<p>'+note+'</p></section>',pager:()=>'',totals:()=>'',ensureFeeLookup:()=>{},query:()=>{throw Error('No additional query allowed')},request:q=>{calls.push(q);throw Error('No additional request allowed')},render:()=>{}};
 ctx.analysis=root.HensemAnalysisDrilldown.create(ctx);
 const render=()=>root.HensemLivePages.create(ctx).render('provider_daily'),action=(s,op='toggle')=>root.liveAnalysisAction(encodeURIComponent(JSON.stringify(s)),op),segment=(extra={})=>({kind:'provider_daily',provider:'ExamplePay',source:'ar',direction:'charge',date:'2026-09-24',currency:'INR',...extra});
 return {L,root,ctx,calls,render,action,segment};
}
const panel=html=>html.match(/<div class="analysis-drilldown analysis-provider-day">([\s\S]*?)<div class="analysis-note">/)[1];
const cells=html=>[...html.matchAll(/<tr>(.*?)<\/tr>/gs)].map(row=>[...row[1].matchAll(/<td>(.*?)<\/td>/gs)].map(cell=>cell[1])).filter(row=>row.length);

test('daily business controls have only collection and payout with collection as the local default',()=>{
 const h=fixture();h.L.direction='all';const html=h.render();const toolbar=html.match(/<div class="pd-toolbar">([\s\S]*?)<div class="pd-window">/)[1];
 assert.match(toolbar,/liveReferenceSet\('direction','charge'\)/);assert.match(toolbar,/liveReferenceSet\('direction','withdraw'\)/);assert.doesNotMatch(toolbar,/'all'|>全部</);assert.match(html,/>63\.33%<\/button>/);
});
test('one date-cell click opens platform rates directly under that provider row using exact date, source, direction and currency',()=>{
 const h=fixture();h.L.results[0].groups.daily.push(stats(900,900,{date:'2026-09-23'}),stats(800,800,{provider:'OtherPay'}),stats(700,700,{direction:'withdraw'}),stats(600,600,{currency:'USD'}));
 const initial=h.render();assert.match(initial,/>63\.33%<\/button>/);h.action(h.segment());const html=h.render(),detail=panel(html),rows=cells(detail);
 assert.deepEqual(rows,[['Same Platform','ar','2000.00','20','700.00','7','35.00%'],['Same Platform','ar','1000.00','10','1200.00','12','120.00%']]);
 assert.match(html,/<\/tr><tr class="analysis-expanded-row provider-daily-detail-row"><td colspan="35">/);assert.match(detail,/2026-09-24 · ExamplePay · ar · 代收/);assert.doesNotMatch(detail,/newar|OtherPay|90000|80000|70000|60000|各平台占比|每日对比/);assert.equal(h.calls.length,0);
 const expansion=html.indexOf('provider-daily-detail-row'),nextSourceRow=html.indexOf('<td>newar</td>');assert(expansion>0&&expansion<nextSourceRow,'selected row detail is above the next provider/source row');
});
test('opening a second day replaces the old row detail and a changed query clears expansion state',()=>{
 const h=fixture();h.L.results[0].groups.daily.push(stats(5,4,{date:'2026-09-23'}));h.render();h.action(h.segment());h.render();h.action(h.segment({date:'2026-09-23'}));let html=h.render();
 assert.equal((html.match(/analysis-provider-day/g)||[]).length,1);assert.match(panel(html),/2026-09-23/);assert.deepEqual(cells(panel(html)),[['Same Platform','ar','500.00','5','400.00','4','80.00%']]);
 h.action(h.segment({date:'2026-09-23'}));assert.doesNotMatch(h.render(),/analysis-provider-day/);h.action(h.segment());h.L.serial++;assert.doesNotMatch(h.render(),/analysis-provider-day/);assert.equal(h.calls.length,0);
});
test('payout rate cell expands payout only and a partial main query is labelled',()=>{
 const h=fixture();h.L.direction='withdraw';h.L.queryFailures=[{id:'missing'}];for(const result of h.L.results){result.groups.provider.push(stats(12,6,{direction:'withdraw'}));result.groups.daily.push(stats(12,6,{direction:'withdraw'}))}
 h.render();h.action(h.segment({direction:'withdraw'}));const detail=panel(h.render());assert.match(detail,/· 代付/);assert.match(detail,/1 个平台未读取/);assert.deepEqual(cells(detail),[['Same Platform','ar','1200.00','12','600.00','6','50.00%'],['Same Platform','ar','1200.00','12','600.00','6','50.00%']]);assert.equal(h.calls.length,0);
});
test('success-only days remain inspectable with unknown rate and source text is encoded safely',()=>{
 const h=fixture(),unsafe='Pay\' <img src=x onerror="alert(1)">';for(const r of h.L.results){r.groups.provider=[stats(0,4,{provider:unsafe})];r.groups.daily=[stats(0,4,{provider:unsafe})]}
 h.L.dailyMetric='success_amount';let html=h.render();assert.match(html,/>800\.00<\/button>/);assert.doesNotMatch(html,/<img|onclick="alert/);
 h.action(h.segment({provider:unsafe}));html=h.render();const detail=panel(html);assert.match(detail,/&lt;img/);assert(cells(detail).every(row=>row[6]==='—'));assert(cells(detail).every(row=>row[4]==='400.00'));assert.doesNotMatch(html,/NaN|Infinity|<img/);assert.equal(h.calls.length,0);
});
