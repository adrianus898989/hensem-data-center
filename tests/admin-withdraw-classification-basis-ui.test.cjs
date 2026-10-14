// Synthetic fixtures render the production module; no order or account data.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-withdraw-pages.js'),'utf8');
const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const row=(extra={})=>({country:'印度',platform:'SYNTHETIC-AR',source:'AR',statisticBasis:'applied_at_current_status',total:100,success:60,rejected:40,autoCount:40,manualCount:60,unclassifiedCount:0,comparisonComparable:false,avgSeconds:60,durationBasis:'applied_to_completed',...extra});
const prior=(extra={})=>({total:100,success:50,rejected:50,autoCount:30,manualCount:40,unclassifiedCount:30,avgSeconds:50,durationBasis:'source_reported_processing',...extra});
async function fixture(current=row({previous:prior()}),extra={},options={}){
 const tables=[],calls=[],root={Date,Intl,HensemLiveFilters:{multi:()=>''}};root.window=root;vm.runInNewContext(source,root);
 const L={catalogReady:true,catalog:[{id:'synthetic-ar',name:'SYNTHETIC-AR',source:'ar',country:'印度',team:'M8'}],country:'印度',team:'M8',from:options.from||'2026-10-10',to:options.to||'2026-10-10'};
 const data={startDate:'2026-10-10',endDate:'2026-10-10',previousStartDate:'2026-10-09',previousEndDate:'2026-10-09',rows:[current],total:1,totals:current,previousTotals:current.previous,comparison:{complete:false},arCoverage:{coverageBasis:'unverified_source_continuity',currentComplete:false,previousComplete:false},...extra};
 const page=root.HensemLiveWithdrawPages.create({L,page:()=> 'auto_withdraw',E,C:String,N:String,R:(a,b)=>(100*Number(a)/Number(b)).toFixed(2)+'%',box:(_title,body)=>body,table:(headers,rows,cls,footers)=>{tables.push({headers,rows,cls,footers});return rows.flat().join('');},render:()=>{},request:async query=>{calls.push(query);return data;}});
 if(options.daily)page.state.daily=true;await page.load();
 return {page,L,data,calls,draw(){tables.length=0;const html=page.render();return {html,table:tables.find(t=>t.cls?.includes('withdraw-stat-table'))};}};
}
test('AR cutover preserves actual yesterday shares and unchanged automatic, success and rejection pp',async()=>{
 const previous=prior({total:12202,success:7734,rejected:4468,autoCount:4063,manualCount:3760,unclassifiedCount:4379});
 const current=row({total:12186,success:7598,rejected:4588,autoCount:3906,manualCount:8280,previous}),before=structuredClone(current),f=await fixture(current),{table,html}=f.draw(),cells=table.rows[0];
 assert.match(cells[8],/昨日 33\.30%.*-1\.24 pp/);assert.doesNotMatch(cells[8],/分类口径不同/);
 assert.match(cells[9],/昨日 30\.81% · 分类口径不同/);assert.match(cells[9],/无明确操作人的驳回计入人工/);assert.doesNotMatch(cells[9],/37\.13 pp|withdraw-delta| pp/);
 for(const index of [4,5]){assert.match(cells[index],/昨日 .* pp/);assert.doesNotMatch(cells[index],/分类口径不同/);}
 assert.equal((cells.join('').match(/分类口径不同/g)||[]).length,1);assert.equal((html.match(/AR 两期完整性尚未核验，汇总暂不比较/g)||[]).length,1);
 const manualCard=html.match(/<label>人工处理<\/label>(.*?)<\/div>/s)?.[1];assert.match(manualCard,/昨日 3760 · 分类口径不同/);assert.doesNotMatch(manualCard,/较昨日|withdraw-delta/);
 for(const footer of table.footers)assert.doesNotMatch(footer.join(''),/昨日|分类口径不同|withdraw-delta/);
 assert.deepEqual(current,before);assert.equal(f.page.state.data.rows[0],current);assert.equal(f.calls.length,1);
});
test('Oct11 versus Oct10 retains observed manual and automatic pp with partial classification still explicit',async()=>{
 const current=row({total:12812,autoCount:4122,manualCount:8690,previous:prior({total:12186,autoCount:3906,manualCount:8280})});
 const f=await fixture(current,{startDate:'2026-10-11',endDate:'2026-10-11',previousStartDate:'2026-10-10',previousEndDate:'2026-10-10'},{from:'2026-10-11',to:'2026-10-11'}),{table}=f.draw();
 assert.match(table.rows[0][8],/\+0\.12 pp/);assert.match(table.rows[0][9],/-0\.12 pp/);assert.doesNotMatch(table.rows[0].join(''),/分类口径不同/);
 const partial=row({classificationAvailable:false,classificationPartial:true,total:100,autoCount:30,manualCount:60,unclassifiedCount:10,previous:prior({classificationAvailable:false,classificationPartial:true,manualCount:50})});
 f.page.state.data.rows=[partial];f.page.state.data.totals=partial;const result=f.draw(),cells=result.table.rows[0];assert.match(cells[9],/\+10\.00 pp/);assert.match(result.html,/未分处理方式 10 笔/);assert.match(cells[9],/两期完整性尚未核验/);assert.equal(partial.unclassifiedCount,10);
});
test('daily rows use their own date and keep same-rule comparisons across a multi-day query',async()=>{
 const rows=['2026-10-09','2026-10-10','2026-10-11'].map(dataDate=>row({dataDate,previous:prior()}));
 const f=await fixture(rows[0],{startDate:'2026-10-09',endDate:'2026-10-11',previousStartDate:'2026-10-06',previousEndDate:'2026-10-08',rows,total:3},{from:'2026-10-09',to:'2026-10-11',daily:true}),{table}=f.draw();
 assert.equal(table.headers[0],'日期');assert.deepEqual(Array.from(table.rows,r=>r[0]),['2026-10-09','2026-10-10','2026-10-11']);
 for(const [index,cells] of table.rows.entries()){assert.match(cells[9],/\+10\.00 pp/);assert.match(cells[5],/\+10\.00 pp/);if(index===1){assert.match(cells[10],/昨日 40\.00% · 分类口径不同/);assert.doesNotMatch(cells[10],/ pp/);}else{assert.match(cells[10],/\+20\.00 pp/);assert.doesNotMatch(cells[10],/分类口径不同/);}}
});
test('classification annotation requires explicit AR statistic basis and does not infer from duration basis',async()=>{
 for(const extra of [{source:'NEWAR'},{source:'YASH'},{source:'WG'},{source:'ar'},{source:undefined},{statisticBasis:undefined},{statisticBasis:'created_at_current_status'}]){
  const f=await fixture(row({...extra,durationBasis:'applied_to_completed',previous:prior()})),cells=f.draw().table.rows[0];assert.match(cells[9],/\+20\.00 pp/);assert.doesNotMatch(cells[9],/分类口径不同/);
 }
 const f=await fixture(row({durationBasis:'created_to_completed',previous:prior({durationBasis:'created_to_completed'})})),cells=f.draw().table.rows[0];assert.match(cells[9],/分类口径不同/);assert.match(cells[12],/已观察用时差/);
});
test('absent, invalid, mismatched and multi-day server dates do not fabricate a classification-basis claim',async()=>{
 for(const dates of [{startDate:undefined},{previousStartDate:undefined},{endDate:'2026-10-11'},{previousEndDate:'2026-10-08'},{previousStartDate:'2026-10-08',previousEndDate:'2026-10-08'},{startDate:'2026-02-30',endDate:'2026-02-30',previousStartDate:'2026-02-28',previousEndDate:'2026-02-28'},{startDate:'2026-10-10T00:00:00Z'},{previousEndDate:null}]){
  const f=await fixture(row({previous:prior()}),dates),cells=f.draw().table.rows[0];assert.match(cells[9],/\+20\.00 pp/);assert.doesNotMatch(cells[9],/分类口径不同/);
 }
 for(const dataDate of [undefined,'2026-02-30','2026-10-10T00:00:00Z']){const f=await fixture(row({dataDate,previous:prior()}),{},{daily:true});assert.doesNotMatch(f.draw().table.rows[0][10],/分类口径不同/);}
 const f=await fixture(row({previous:prior()}));f.L.from=f.L.to='2026-10-11';assert.match(f.draw().table.rows[0][9],/分类口径不同/,'read response dates determine basis rather than edited query inputs');
});
test('missing or invalid manual samples remain unknown and real zero is preserved across the cutover',async()=>{
 for(const extra of [{manualCount:null},{manualCount:undefined},{manualCount:-1},{manualCount:101},{total:0,manualCount:0},{total:true},{manualCount:[]},{previous:prior({manualCount:null})},{previous:prior({total:0,manualCount:0})},{previous:null}]){
  const f=await fixture(row({previous:prior(),...extra})),cell=f.draw().table.rows[0][9];assert.doesNotMatch(cell,/分类口径不同|withdraw-delta| pp|NaN|Infinity/);
 }
 const f=await fixture(row({autoCount:0,manualCount:0,previous:prior({autoCount:0,manualCount:0})})),cells=f.draw().table.rows[0];assert.match(cells[8],/昨日 0\.00%.*0\.00 pp/);assert.match(cells[9],/昨日 0\.00% · 分类口径不同/);
});
