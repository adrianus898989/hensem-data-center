/* Fully synthetic full-range sorting; no live data, browser or network. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const harnessSource=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {ready,completeAggregate,P}=new Function('require','__dirname',harnessSource+';return {ready,completeAggregate,P};')(require,__dirname);
const plain=s=>s.replace(/<span\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g,'').replace(/<[^>]*>/g,'').trim();
const rows=html=>[...(html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]||'').matchAll(/<tr(?: [^>]*)?>([\s\S]*?)<\/tr>/g)].map(m=>[...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(c=>plain(c[1])));
const section=(h,id)=>h.html().match(new RegExp('<section[^>]*id="'+id+'"[\\s\\S]*?<\\/section>'))?.[0]||'';
const table=html=>html.match(/<table\b[^>]*>[\s\S]*?<\/table>/)?.[0]||'';
const sort=(h,id,index)=>h.c.liveReferenceTableSort(encodeURIComponent(id),index);
async function setup(page='overview'){
 const platforms=['Small','Large','Unknown'].map((name,i)=>({...P,id:String(i+1).repeat(8)+'-1111-4111-8111-111111111111',name,team:'Team '+name,country:'印度'})),h=await ready({platforms,page});
 h.L.results=platforms.map((p,i)=>{const r=completeAggregate(p,[10,100,20][i],[2,10,3][i]);r.summary[0].success_amount=i===2?null:[20,10000][i];r.groups.provider=[{...r.summary[0],provider:p.name+'Pay'}];return r});
 h.L.country='印度';h.L.currency='INR';h.L.direction='charge';h.L.dirty=false;h.L.loading=false;h.L.catalogReady=true;h.L.overviewQueried=true;h.L.feeLookupRows=[];h.L.feeLookupLoading=false;h.L.comparisonStatus='idle';h.c.state.page=page;h.L.view='business';h.c.render();return h;
}

test('overview dimensions sort complete records before independent pagination; nulls and empty platforms remain last',async()=>{
 const h=await setup(),calls=h.calls.length,id='df-platforms-charge';h.L.tableSizes[id]=2;h.L.tablePages[id]=2;h.c.render();
 const before=section(h,id).match(/<tfoot>[\s\S]*?<\/tfoot>/)[0];sort(h,id,3);
 assert.equal(h.L.tablePages[id],1);assert.deepEqual(rows(section(h,id)).map(r=>r[0]),['Large','Small']);
 sort(h,id,3);assert.deepEqual(rows(section(h,id)).map(r=>r[0]),['Small','Large']);
 h.L.tableSizes[id]=20;h.c.render();assert.deepEqual(rows(section(h,id)).map(r=>r[0]),['Small','Large','Unknown']);
 assert.equal(section(h,id).match(/<tfoot>[\s\S]*?<\/tfoot>/)[0],before);assert.equal(h.calls.length,calls);
 for(const name of ['df-teams-charge','df-countries-charge','df-providers-charge'])assert.match(section(h,name),/liveReferenceTableSort/);
 sort(h,'df-providers-charge',4);assert.equal(rows(section(h,'df-providers-charge'))[0][0],'LargePay');assert.equal(h.calls.length,calls);
});

test('team and merchant tables share raw numeric ordering without changing their displayed or aggregated fields',async()=>{
 for(const page of ['teamops','teamcountries','teamplatforms','merchants']){
  const h=await setup(page),before=h.calls.length,id='business-dimension-charge';assert.match(section(h,id),/liveReferenceTableSort/);sort(h,id,2);
  const shown=rows(section(h,id));if(page==='teamcountries')assert.equal(shown.length,1);else assert.deepEqual(shown.map(r=>r[0]),['Large','Unknown','Small']);
  assert.equal(h.calls.length,before);
 }
});

test('hour and amount sorting retain exact segments and inline expansion while sorting before the main-row pager',async()=>{
 for(const page of ['time','amount']){
  const h=await setup(page),kind=page==='time'?'hourly':'amount';h.L.results=h.L.results.slice(0,1);const base=h.L.results[0].summary[0];
  h.L.results[0].groups[kind]=[{...base,hour:7,bucket:'200',success_amount:10000},{...base,hour:18,bucket:'1000',success_amount:20}];h.L.matrixMode='exact';h.L.tableSizes['analysis-state']=100;h.c.render();
  const before=h.calls.length;sort(h,'analysis-state',4);const rendered=table(h.html().slice(h.html().indexOf('analysis-expand-table')));
  assert.match(rows(rendered)[0][1],page==='time'?/07:00/:/200/);
  const segment={kind,direction:'charge',...(page==='time'?{hour:7}:{bucket:'200'})};h.c.liveAnalysisAction(encodeURIComponent(JSON.stringify(segment)),'toggle');
  assert.match(h.html(),/analysis-aligned-item/);sort(h,'analysis-state',1);assert.match(h.html(),/analysis-aligned-item/);
  assert(h.html().indexOf('analysis-aligned-item')>h.html().indexOf(page==='time'?'07:00–07:59:59':'<td>200</td>'));assert.equal(h.calls.length,before);
 }
});

test('page snapshots retain reference sort state independently of later table changes',async()=>{
 const h=await setup('merchants'),id='business-dimension-charge';sort(h,id,3);const saved=JSON.parse(JSON.stringify(h.L.tablePages));
 h.c.setPage('time');h.L.tablePages['sort:'+id]={column:0,ascending:true};h.c.setPage('merchants');
 assert.deepEqual(JSON.parse(JSON.stringify(h.L.tablePages['sort:'+id])),saved['sort:'+id]);
});

const analysisHarness=fs.readFileSync(path.join(__dirname,'admin-analysis-drilldown.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {setup:analysisSetup,segment}=new Function('require','__dirname',analysisHarness+';return {setup,segment};')(require,__dirname);
function analysis(){const h=analysisSetup();vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-provider-summary.js'),'utf8'),{window:h.root});h.L.to='2026-09-20T23:59:59';h.L.results[0].platform.name='Small';h.L.results[1].platform.name='Large';return h}
const detailRows=(h,s)=>rows(table(h.instance.panel(s)));
test('each analysis segment sorts locally with stable denominators and snapshot state, including unknown amounts',()=>{
 const h=analysis(),other={...segment,hour:9};h.L.results[0].groups.hourly.push({...h.L.results[0].groups.hourly[0],hour:9});h.L.results[1].groups.hourly.push({...h.L.results[1].groups.hourly[0],hour:9});
 h.instance.open(segment,'8时');h.instance.panel(segment);h.action(segment,'sort',JSON.stringify(['platform',4]));assert.equal(detailRows(h,segment)[0][0],'Small');
 h.action(segment,'sort',JSON.stringify(['platform',4]));assert.equal(detailRows(h,segment)[0][0],'Large');assert.match(h.instance.panel(segment),/70.00%/);
 h.instance.open(other,'9时');assert.equal(detailRows(h,other)[0][0],'Small');
 const saved=h.instance.capture();h.action(segment,'sort',JSON.stringify(['platform',4]));h.instance.restore(saved);assert.equal(detailRows(h,segment)[0][0],'Large');
 h.L.results[1].groups.hourly[0].success_amount=null;assert.equal(detailRows(h,segment).at(-1)[0],'Large');assert.equal(h.calls.length,0);
 h.action(segment,'sort',JSON.stringify(['unregistered',0]));assert.equal(h.calls.length,0);
});

test('latency platform shares sort by their raw denominator and do not initiate provider queries',()=>{
 const h=analysis(),s={kind:'latency',direction:'charge',bucket:0,cumulative:false};h.instance.open(s,'快档');h.instance.panel(s);
 h.action(s,'sort',JSON.stringify(['platform',4]));assert.equal(detailRows(h,s)[0][0],'Small');assert.equal(detailRows(h,s)[0][4],'80.00%');
 h.action(s,'sort',JSON.stringify(['platform',4]));assert.equal(detailRows(h,s)[0][0],'Large');assert.equal(detailRows(h,s)[0][4],'20.00%');assert.equal(h.calls.length,0);
});

test('provider duration sort reuses its loaded band response and keeps provider-specific daily ordering separate',()=>{
 const h=analysis(),s={kind:'latency',direction:'charge',bucket:0,cumulative:false};h.L.to='2026-09-24T23:59:59';h.instance.open(s,'快档');
 const entry={loading:false,failures:[],total:2,results:new Map(h.L.results.map(r=>[r.platform.id,{groups:{provider:[{provider:'ManySmall',direction:'charge',currency:'INR',count:20,amount:200,valid_count:100,valid_amount:1000},{provider:'FewLarge',direction:'charge',currency:'INR',count:2,amount:10000,valid_count:10,valid_amount:20000}],provider_daily:[{date:'2026-09-20',provider:'ManySmall',direction:'charge',currency:'INR',count:18,amount:180,valid_count:90,valid_amount:900},{date:'2026-09-21',provider:'ManySmall',direction:'charge',currency:'INR',count:2,amount:20,valid_count:10,valid_amount:100}],daily:[]},summary:[{direction:'charge',currency:'INR',count:22,amount:10200}]}]))};
 const state=h.instance.snapshot().states.get(JSON.stringify(s));state.daily.set('all',entry);state.tab='provider';h.instance.panel(s);
 h.action(s,'sort',JSON.stringify(['provider',1]));assert.equal(detailRows(h,s)[0][0],'FewLarge');assert.equal(detailRows(h,s)[0][2],'98.04%');
 state.tab='providerDaily';state.provider='ManySmall';h.instance.panel(s);h.action(s,'sort',JSON.stringify(['provider-daily:ManySmall',1]));assert.match(detailRows(h,s)[0][0],/2026-09-20/);
 h.action(s,'sort',JSON.stringify(['provider-daily:ManySmall',1]));assert.match(detailRows(h,s)[0][0],/2026-09-21/);assert(detailRows(h,s).slice(2).every(r=>r[1]==='—'));
 state.tab='provider';assert.equal(detailRows(h,s)[0][0],'FewLarge');assert.equal(h.calls.length,0);
});

test('platform daily ordering keeps missing days last and computes comparisons from the previous date, not the sorted neighbor',()=>{
 const h=analysis();h.L.to='2026-09-22T23:59:59';h.instance.open(segment,'8时');const state=h.instance.snapshot().states.get(JSON.stringify(segment));
 state.tab='daily';state.daily.set('all',{loading:false,failures:[],total:2,results:new Map(h.L.results.map(r=>[r.platform.id,{platform:r.platform,startAt:'2026-09-19T18:30:00Z',endAt:'2026-09-22T18:30:00Z',groups:{daily:[{...r.groups.hourly[0],date:'2026-09-20',success_amount:10},{...r.groups.hourly[0],date:'2026-09-21',success_amount:20}]}}]))});
 h.instance.panel(segment);h.action(segment,'sort',JSON.stringify(['daily:all',3]));let data=detailRows(h,segment);assert.match(data[0][0],/2026-09-21/);assert.equal(data[0].at(-1),'100.00%');assert.match(data.at(-1)[0],/2026-09-22/);
 h.action(segment,'sort',JSON.stringify(['daily:all',3]));data=detailRows(h,segment);assert.match(data[0][0],/2026-09-20/);assert.equal(data[1].at(-1),'100.00%');assert.match(data.at(-1)[0],/2026-09-22/);assert(data.at(-1).slice(1).every(v=>v==='—'));assert.equal(h.calls.length,0);
});
