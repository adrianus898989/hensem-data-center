const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-pages-reference.js'),'utf8');
const E=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fields=['all_amount','all_count','success_amount','success_count','created_success_count','pending_amount','pending_count','failed_amount','failed_count'];
const empty=()=>Object.fromEntries(fields.map(key=>[key,0]));
const plus=rows=>Object.fromEntries(fields.map(key=>[key,rows.reduce((total,row)=>total+Number(row[key]||0),0)]));
function combine(rows,keys){const groups=new Map();for(const row of rows){const key=JSON.stringify(keys.map(name=>row[name]));const values=groups.get(key)||[];values.push(row);groups.set(key,values);}return [...groups.values()].map(values=>({...values[0],...plus(values)}));}
function fixture({groups={},from='2026-09-24T00:00',to='2026-09-24T23:59',direction='charge',view='business',matrixMode='exact',page=1,size=100,shared=true}={}){
 const L={results:[],direction,view,matrixMode,currency:'INR',from,to,tablePages:{'analysis-state':page},tableSizes:{'analysis-state':size}},calls=[],pagers=[],groupCalls=[],businessRows=[];
 const table=(headers,rows)=>'<table><thead><tr>'+headers.map(value=>'<th>'+value+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
 const root={};vm.runInNewContext(source,{window:root});
 const ctx={L,E,N:String,C:String,R:(n,d)=>d?String(n/d):'—',plus,combine,empty,groupRows:kind=>{groupCalls.push(kind);return groups[kind]||[]},table,box:(title,body,subtitle='',tools='')=>'<section><h2>'+title+'</h2><small>'+subtitle+'</small>'+tools+body+'</section>',pager:(...args)=>{pagers.push(args);return '<nav>pager</nav>'},totals:()=>'<aside>totals</aside>',chart:rows=>'<figure>'+JSON.stringify(rows)+'</figure>',detailsView:()=>'<div>order details</div>',businessHeaders:['全部金额','全部笔数','成功金额','成功笔数','成功率'],businessCells:row=>{businessRows.push(row);return [String(row.all_amount),String(row.all_count),String(row.success_amount),String(row.success_count),row.created_success_count==null?'—':String(row.created_success_count/(row.all_count||1))]}};
 if(shared)ctx.analysis={table:config=>{calls.push(config);return table([...config.headers,'展开'],config.rows.map(row=>[...config.cells(row),'展开']))}};
 const renderer=root.HensemLivePages.create(ctx);return {L,calls,pagers,groupCalls,businessRows,render:page=>renderer.render(page)};
}
const row=(overrides={})=>({...empty(),direction:'charge',all_amount:100,all_count:10,success_amount:240,success_count:12,created_success_count:6,...overrides});

test('hourly range totals normalize string hours once and preserve success-time fields for expansion',()=>{
 const f=fixture({from:'2026-09-23T00:00',groups:{hourly:[row({hour:'07',date:'2026-09-23',platformId:'a'}),row({hour:7,date:'2026-09-24',platformId:'b'})]}}),html=f.render('time'),config=f.calls[0];
 assert.equal(f.calls.length,1);assert.equal(config.rows.length,24);assert.equal(config.rows.filter(r=>r.hour===7).length,1);assert.equal(config.headers[1],'时段');assert.doesNotMatch(html,/创建时段/);assert.match(html,/class="analysis-compact"/);assert.match(html,/与每日对比/);
 const seven=config.rows.find(r=>r.hour===7);assert.deepEqual(JSON.parse(JSON.stringify(config.segment(seven))),{kind:'hourly',direction:'charge',hour:7});assert.equal(config.label(seven),'07:00–07:59:59');assert.deepEqual(Array.from(config.cells(seven)),['代收','07:00–07:59:59','200','20','480','24','0.6']);
 assert.equal(seven.created_success_count,12);assert.equal(seven.success_count,24);assert.deepEqual(f.groupCalls,['hourly']);
});

test('expanded table keeps the existing main-row pagination and direction identity',()=>{
 const f=fixture({direction:'all',page:3,size:20,groups:{hourly:[row({hour:23,direction:'withdraw'})]}});f.render('time');const config=f.calls[0];
 assert.equal(config.id,'analysis-state');assert.equal(config.rows.length,8);assert(config.rows.every(r=>r.direction==='withdraw'));assert.deepEqual(f.pagers,[[48,3,20,'ref-analysis-state']]);assert.deepEqual(JSON.parse(JSON.stringify(config.segment(config.rows[7]))),{kind:'hourly',direction:'withdraw',hour:23});
});

test('amount tables use the selected group with raw labels for drilldown and escaped display cells',()=>{
 const f=fixture({groups:{amount:[row({bucket:100}),row({bucket:'100'}),row({bucket:'<b>custom & amount</b>'})],amount_range:[row({bucket:'100–200'})]}});const html=f.render('amount'),config=f.calls[0],custom=config.rows.find(r=>r.bucket.startsWith('<'));
 assert.equal(config.rows.filter(r=>r.bucket==='100').length,1);assert.equal(config.rows.find(r=>r.bucket==='100').success_amount,480);assert.equal(config.label(custom),'<b>custom & amount</b>');assert.equal(config.cells(custom)[1],'&lt;b&gt;custom &amp; amount&lt;/b&gt;');assert.doesNotMatch(html,/<b>custom/);assert.doesNotMatch(html,/与每日对比/);assert.deepEqual(JSON.parse(JSON.stringify(config.segment(custom))),{kind:'amount',direction:'charge',bucket:'<b>custom & amount</b>'});
 f.L.matrixMode='range';f.render('amount');const range=f.calls[1];assert.equal(range.rows.length,9);assert.deepEqual(JSON.parse(JSON.stringify(range.segment(range.rows[0]))),{kind:'amount_range',direction:'charge',bucket:'100–200'});assert.deepEqual(f.groupCalls,['amount','amount_range']);
});

test('checks and trend keep existing rendering without requesting drilldown or extra data',()=>{
 const f=fixture({view:'checks',groups:{amount:[row({bucket:'<img src=x>'})]}});const checks=f.render('amount');assert.equal(f.calls.length,0);assert.match(checks,/掉单金额/);assert.match(checks,/&lt;img src=x&gt;/);f.L.view='trend';const trend=f.render('amount');assert.equal(f.calls.length,0);assert.match(trend,/live-reference-bar/);assert.doesNotMatch(trend,/<img src=x>/);assert.deepEqual(f.groupCalls,['amount','amount']);
});

test('compact wrapper is restricted to time and amount pages; absent shared module retains data table',()=>{
 const f=fixture({shared:false,groups:{hourly:[row({hour:9})]}}),html=f.render('time');assert.match(html,/240/);assert.match(html,/时段金额与状态/);assert.equal(f.calls.length,0);assert.equal(f.pagers.length,1);const orders=f.render('orders');assert.match(orders,/order details/);assert.doesNotMatch(orders,/analysis-compact/);assert.equal(f.render('unrelated-page'),null);
});
