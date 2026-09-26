/* Pure synthetic aggregates: sorting must never fetch or reinterpret source facts. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {ready,completeAggregate,P,settle}=new Function('require','__dirname',prefix+';return {ready,completeAggregate,P,settle};')(require,__dirname);
const plain=s=>s.replace(/<span\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g,'').replace(/<[^>]*>/g,'').trim();
const allTables=html=>[...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/g)].map(m=>m[0]);
const tableFor=(h,label)=>allTables(h.html()).find(s=>s.includes(label))||'';
const rows=html=>[...(html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]||'').matchAll(/<tr(?: [^>]*)?>([\s\S]*?)<\/tr>/g)].map(m=>[...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(c=>plain(c[1])));
const sort=(h,id,column)=>h.c.liveLoadedTableSort(encodeURIComponent(h.c.state.page+'|'+id),column);
const refSort=(h,id,column)=>h.c.liveReferenceTableSort(encodeURIComponent(id),column);
const rate=(provider,percent,fixed='')=>({country:'印度',scopeType:'country',provider,collectFee:percent,payoutFee:percent,collectSingleFee:fixed,payoutSingleFee:fixed});
async function setup(page='collection'){
 const platforms=['Small','Large','Unknown'].map((name,i)=>({...P,id:String(i+1).repeat(8)+'-1111-4111-8111-111111111111',name,source:i===1?'newar':'ar',scopeGroup:i===2?'':'group'+i})),h=await ready({platforms,page});
 const direction=page==='payout'?'withdraw':'charge';
 h.L.results=platforms.map((p,i)=>{const r=completeAggregate(p,[10,100,20][i],[2,10,3][i]),s={...r.summary[0],direction,success_amount:i===2?null:[20,10000][i],latest_synced_at:i===2?null:'2026-09-22T0'+(i+1)+':00:00Z'};r.summary=[s];r.groups.provider=[{...s,provider:p.name+'Pay'}];r.groups.daily=[{...s,provider:p.name+'Pay',date:'2026-09-22'}];r.groups.amount=[{...s,bucket:['200','1000','unknown'][i]}];r.groups.matrix=[{...s,bucket:['200','1000','unknown'][i],hour:[2,10,4][i]}];return r});
 Object.assign(h.L,{country:'印度',currency:'INR',direction,multi:{...h.L.multi,direction:[direction]},dirty:false,loading:false,catalogReady:true,overviewQueried:true,feeLookupRows:[rate('SmallPay','2%', '9'),rate('LargePay','10%')],feeLookupLoading:false,comparisonStatus:'idle',view:'business',tablePages:{},tableSizes:{},localPage:1,localSize:20});h.c.render();return h;
}

test('both flow tables sort complete loaded rows numerically before paging, with fixed totals and no reads',async()=>{
 for(const [page,direction]of[['collection','charge'],['payout','withdraw']]){
  const h=await setup(page),id='providers-'+direction;h.L.localSize=2;h.L.localPage=2;h.c.render();const footer=tableFor(h,'liveLoadedTableSort').match(/<tfoot>[\s\S]*?<\/tfoot>/)[0],calls=h.calls.length;
  sort(h,id,6);assert.equal(h.L.localPage,1);assert.deepEqual(rows(tableFor(h,'liveLoadedTableSort')).map(r=>r[0]),['LargePay','SmallPay']);
  sort(h,id,6);assert.deepEqual(rows(tableFor(h,'liveLoadedTableSort')).map(r=>r[0]),['SmallPay','LargePay']);
  h.L.localSize=20;h.c.render();assert.deepEqual(rows(tableFor(h,'liveLoadedTableSort')).map(r=>r[0]),['SmallPay','LargePay','UnknownPay']);
  assert.equal(tableFor(h,'liveLoadedTableSort').match(/<tfoot>[\s\S]*?<\/tfoot>/)[0],footer);assert.equal(h.calls.length,calls);
 }
});

test('source-separated provider identities and rates remain intact when sorting names, source, amounts, rates and ratios',async()=>{
 const h=await setup(),calls=h.calls.length,id='providers-charge';sort(h,id,13);assert.deepEqual(rows(tableFor(h,'liveLoadedTableSort')).map(r=>r[0]),['LargePay','SmallPay','UnknownPay']);
 sort(h,id,13);assert.deepEqual(rows(tableFor(h,'liveLoadedTableSort')).map(r=>r[0]),['SmallPay','LargePay','UnknownPay']);
 h.L.feeLookupRows=[rate('SmallPay','2%','9'),rate('LargePay','2%','10')];sort(h,id,6);sort(h,id,13);assert.deepEqual(rows(tableFor(h,'liveLoadedTableSort')).map(r=>r[0]),['LargePay','SmallPay','UnknownPay'],'equal percentages compare fixed fees as numbers');
 h.L.results[1].groups.provider[0].provider='SmallPay';h.L.results[1].groups.provider[0].success_count=110;h.c.render();sort(h,id,0);
 const text=tableFor(h,'liveLoadedTableSort'),items=rows(text);assert.equal(items.filter(r=>r[0]==='SmallPay').length,2);assert.match(text,/liveProviderOrders\(&quot;SmallPay&quot;,&quot;ar&quot;,&quot;charge&quot;\)/);assert.match(text,/liveProviderOrders\(&quot;SmallPay&quot;,&quot;newar&quot;,&quot;charge&quot;\)/);
 sort(h,id,12);assert.equal(rows(tableFor(h,'liveLoadedTableSort'))[0][12],'110.00%','sort follows the displayed success-time numerator rather than changing it to a created cohort');
 assert.equal(h.calls.length,calls);
});

test('loaded platform adapter sorts actual timestamps and authorized identities, retaining missing values last',async()=>{
 const h=await setup(),original=h.c.HensemLivePages.create;let ctx;h.c.HensemLivePages.create=c=>{ctx=c;return original(c)};h.c.render();const calls=h.calls.length;
 const platformRows=()=>rows(ctx.platformsView());ctx.platformsView();sort(h,'platforms-charge',5);assert.deepEqual(platformRows().map(r=>r[0]),['Large','Small','Unknown']);
 sort(h,'platforms-charge',12);assert.deepEqual(platformRows().map(r=>r[0]),['Large','Small','Unknown']);sort(h,'platforms-charge',12);assert.deepEqual(platformRows().map(r=>r[0]),['Small','Large','Unknown']);
 sort(h,'platforms-charge',2);assert.deepEqual(platformRows().map(r=>r[0]),['Small','Large','Unknown']);assert.match(ctx.platformsView(),new RegExp(h.L.catalog[0].id));assert.equal(h.calls.length,calls);
});

test('page snapshots preserve loaded sorting and reject stale or invalid table actions',async()=>{
 const h=await setup();sort(h,'providers-charge',6);const saved=JSON.parse(JSON.stringify(h.L.tablePages['sort:live-providers-charge']));
 h.c.setPage('payout');await settle();const calls=h.calls.length;h.c.liveLoadedTableSort(encodeURIComponent('collection|providers-charge'),0);assert.equal(h.calls.length,calls);
 h.c.setPage('collection');assert.deepEqual(JSON.parse(JSON.stringify(h.L.tablePages['sort:live-providers-charge'])),saved);const before=JSON.stringify(h.L.tablePages);sort(h,'providers-charge',99);h.c.liveLoadedTableSort('%broken',0);assert.equal(JSON.stringify(h.L.tablePages),before);
});

test('amount-band and matrix sorting retain numeric bucket order, original segments and totals',async()=>{
 const h=await setup();h.L.view='contribution';h.L.matrixMode='exact';h.c.render();const calls=h.calls.length;sort(h,'amounts-charge',0);assert.deepEqual(rows(tableFor(h,'金额档位')).map(r=>r[0]),['200','1000','金额缺失']);
 sort(h,'amounts-charge',3);assert.deepEqual(rows(tableFor(h,'金额档位')).map(r=>r[0]),['1000','200','金额缺失']);assert.equal(h.calls.length,calls);
 const m=await setup('matrix');m.L.matrixMode='exact';m.L.view='matrixDetail';m.L.localSize=2;m.L.localPage=2;m.c.render();const reads=m.calls.length;sort(m,'matrix-detail',5);assert.equal(m.L.localPage,1);const table=tableFor(m,'analysis');assert.deepEqual(rows(table).map(r=>r[1]),['1000','200']);
 const segment={kind:'matrix',direction:'charge',hour:10,bucket:'1000'};m.c.liveAnalysisAction(encodeURIComponent(JSON.stringify(segment)),'toggle');assert.match(m.html(),/analysis-expanded-row/);sort(m,'matrix-detail',1);assert.match(m.html(),/analysis-expanded-row/);assert.equal(m.calls.length,reads);
});

test('loaded quality, risk and fee tables sort real metrics before their independent pagers without fabricating unavailable fields',async()=>{
 for(const [page,id,column]of[['channelquality','provider-quality',4],['risk','provider-risk',7],['merchantproviders','provider-fees',4]]){
  const h=await setup(page);if(page==='merchantproviders')h.L.view='fees';h.L.tableSizes[id]=2;h.L.tablePages[id]=2;h.c.render();const calls=h.calls.length;refSort(h,id,column);assert.equal(h.L.tablePages[id],1,id);
  const table=tableFor(h,'liveReferenceTableSort'),items=rows(table);assert.equal(items[0][0],'LargePay');assert.equal(items.length,2);assert.match(table,/正式数据尚未提供此项/);assert.equal(h.calls.length,calls);
 }
});

test('daily matrix sorting stays on its selected date/source/currency and keeps inline expansion beside its provider',async()=>{
 const h=await setup('provider_daily');h.L.localSize=2;h.L.localPage=2;h.L.results[1].groups.daily[0].success_count=90;h.L.results[1].groups.daily.push({...h.L.results[1].groups.daily[0],currency:'BRL',success_count:0});h.c.render();const calls=h.calls.length;
 refSort(h,'daily-matrix',34);assert.equal(h.L.localPage,1);const grid=()=>tableFor(h,'daily-matrix');assert.deepEqual(rows(grid()).map(r=>r[0]),['LargePay','SmallPay']);
 const s={kind:'provider_daily',provider:'LargePay',source:'newar',direction:'charge',date:'2026-09-22',currency:'INR'};h.c.liveAnalysisAction(encodeURIComponent(JSON.stringify(s)),'toggle');assert.match(h.html(),/provider-daily-detail-row/);refSort(h,'daily-matrix',0);assert.match(h.html(),/provider-daily-detail-row/);assert.equal(h.calls.length,calls);
 h.L.dailyView='all';h.L.tableSizes['daily-details']=20;h.c.render();refSort(h,'daily-details',7);const details=allTables(h.html()).find(t=>t.includes('daily-details'));assert.deepEqual(rows(details).map(r=>r[1]),['LargePay','SmallPay','UnknownPay']);assert.equal(rows(details)[0][9],'90.00%');assert.equal(h.calls.length,calls);
});
