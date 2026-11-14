// Real shared page controller; synthetic strict coverage and publications only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const pre=fs.readFileSync(path.join(__dirname,'admin-panda-native-ui.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,PANDA,result,showAllBandRows,bandRows}=new Function('require','__dirname',pre+';return {harness,settle,PANDA,result,showAllBandRows,bandRows};')(require,__dirname);
function reply(q,mutate=()=>{}){return {version:2,items:q.requests.map(request=>{
 const startAt=request.startAt,endAt=request.endAt,dataCutoff='2026-09-23T11:00:00Z',r={...result(),version:1,startAt,endAt,successStartAt:request.successStartAt,successEndAt:request.successEndAt,successBasis:request.successBasis,durationVersion:2,asOf:'2026-09-23T11:59:00Z',pandaCoverage:{timeBasis:'created_at',statisticBasis:'current_stored_status',complete:false,requestedComplete:false,effectiveComplete:true,sourceComplete:false,requestedStartAt:startAt,requestedEndAt:endAt,effectiveStartAt:startAt,effectiveEndAt:dataCutoff,dataCutoff,reason:'verified_created_prefix_only',directions:(request.direction==='all'?['charge','withdraw']:[request.direction]).map(direction=>({direction,startAt,endAt:dataCutoff,complete:true,count:10,zeroConfirmed:false}))}};
 mutate(r,request);return {request,status:'ready',publication:{id:'synthetic-prefix',generation:1,computedAt:'2026-09-23T11:59:00Z',expiresAt:'2026-09-23T12:09:00Z',cutoff:'2026-09-23T11:59:00Z',calculationComplete:true,sourceComplete:false,freshness:'fresh',refreshState:'idle'},result:r};
 })};}
async function setup(page='time',mutate){const h=harness({page,platforms:[PANDA],roleAccess:{mode:'owner',canView:true,permissions:[]},roleAllowed:()=>true,extraModules:['live-statistic-windows.js','live-prepared-aggregates.js','live-chart-tooltip.js']});await settle();Object.assign(h.L,{country:'巴西',currency:'BRL',platform:PANDA.id,from:'2026-09-23T00:00:00',to:'2026-09-23T23:59:59',successFrom:'2026-09-23T00:00:00',successTo:'2026-09-23T23:59:59'});h.L.multi.platform=[PANDA.id];h.setHandler(q=>q.action==='aggregatePrepared'?reply(q,mutate):q.action==='rates'?{rows:[],total:0}:q.action==='providerOptions'?{providers:[]}:{});return h;}
for(const page of ['time','amount','matrix','provider_daily'])test(page+' accepts only verified saved prefix, preserves totals and shows actual source cutoff',async()=>{
 const h=await setup(page);await h.c.liveQuery();await settle();assert.equal(h.L.results.length,1);assert.equal(h.L.queryFailures.length,0);assert(h.calls.some(q=>q.action==='aggregatePrepared'));assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);assert.match(h.html(),/已核验至 Synthetic Panda 2026-09-23 08:00:00（不含，非全天）/);assert.doesNotMatch(h.html(),/所选创建窗口已完整采集|data-panda-aggregate-blocked/);assert.equal(h.L.results[0].summary[0].all_count,10);assert.equal(h.L.results[0].pandaCoverage.complete,false);assert.equal(h.L.results[0]._preparedPublication.sourceComplete,false);assert.equal(h.L.results[0].endAt,'2026-09-24T03:00:00.000Z');assert.notEqual(h.L.comparisonStatus,'ready');
 if(page==='time'){
  showAllBandRows(h,page);
  for(const direction of ['charge','withdraw']){
   const future=bandRows(h.html(),direction).find(c=>c[0].includes('23:00'));
   assert(future);assert.equal(future[1],'—');assert.equal(future[2],'—');
  }
 }
});
const bad=[r=>r.pandaCoverage.effectiveComplete=false,r=>r.pandaCoverage.requestedComplete=true,r=>r.pandaCoverage.complete=true,r=>r.pandaCoverage.requestedEndAt='2026-09-24T02:00:00Z',r=>r.pandaCoverage.dataCutoff=r.endAt,r=>r.pandaCoverage.effectiveEndAt='2026-09-23T11:01:00Z',r=>r.pandaCoverage.directions.pop(),r=>r.pandaCoverage.directions.push(r.pandaCoverage.directions[0]),r=>r.pandaCoverage.directions[0].complete=false,r=>r.pandaCoverage.directions[0].endAt=r.endAt,r=>r.asOf='2026-09-23T10:59:59Z',r=>r.pandaCoverage.reason='unverified_prefix'];
test('forged, incomplete, mis-scoped or future prefix proofs never become saved complete results',async()=>{for(const mutate of bad){const h=await setup('time',mutate);await h.c.liveQuery();await settle();assert.equal(h.L.results.length,0);assert.equal(h.L.queryFailures.length,1);assert.match(h.html(),/完整性尚未确认/);assert.doesNotMatch(h.html(),/已核验至/);}});
test('export preserves requested windows and the independently verified effective source cutoff',async()=>{const h=await setup('time');await h.c.liveQuery();await settle();h.nodes.get('page').querySelectorAll=()=>[{closest:()=>null,querySelectorAll:()=>[{cells:[{innerText:'全部金额'},{innerText:'100.00'}],closest:()=>null}]}];h.c.liveExport();const csv=await h.blobs[0].text();assert.match(csv,/2026-09-24T03:00:00.000Z/);assert.match(csv,/实际创建截止（不含，非全天）/);assert.match(csv,/2026-09-23T11:00:00Z/);assert.doesNotMatch(csv,/来源完整性已确认/);});

test('shared collection trend renders verified prefix hours and keeps future tooltip values unknown',async()=>{
 const h=await setup('time');
 const create=h.c.HensemLivePages.create;
 let renderer;
 h.c.HensemLivePages.create=options=>(renderer=create(options));
 await h.c.liveQuery();await settle();
 assert.equal(h.L.results[0].pandaCoverage.reason,'verified_created_prefix_only');
 // Collection excludes native Panda at its query boundary. Exercise its shared chart renderer
 // with a prefix obtained through one of the pages permitted to read that source.
 h.L.view='trend';
 const encoded=renderer.render('collection').match(/data-chart-model="([^"]+)"/)?.[1];
 assert(encoded);
 const chart=JSON.parse(encoded.replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>'));
 const all=chart.series.find(series=>series.name==='本期全部');
 assert.equal(all.complete,false);assert.equal(all.plotted,true);
 assert.equal(all.points[23],null);assert.equal(all.points[7],0);
 assert(chart.series.find(series=>series.name==='本期成功').points.every(value=>value===null));
 assert.match(h.c.HensemLiveChart.tooltip(chart,23),/—/);
});

test('a stale prefix read after midnight cannot compare eight hours with the previous full day',async()=>{const h=await setup('time');h.setNow('2026-09-24T12:00:00Z');await h.c.liveQuery();await settle();assert.equal(h.L.results.length,1);assert.notEqual(h.L.comparisonStatus,'ready');assert.match(h.L.comparisonError,/截止范围/);assert.equal(h.L.comparisonResults.length,0);assert(h.calls.filter(q=>q.action==='aggregatePrepared').every(q=>q.requests.every(r=>r.startAt==='2026-09-23T03:00:00.000Z')));});

test('raw aggregate responses cannot opt into the saved-prefix contract by supplying publication-shaped fields',async()=>{const h=harness({page:'time',platforms:[PANDA]});await settle();Object.assign(h.L,{country:'巴西',currency:'BRL',platform:PANDA.id,from:'2026-09-23T00:00:00',to:'2026-09-23T23:59:59'});h.L.multi.platform=[PANDA.id];h.setHandler(q=>{if(q.action!=='aggregate')return {};const item=reply({requests:[q]}).items[0];return {...item.result,_preparedPublication:item.publication};});await h.c.liveQuery();await settle();assert.equal(h.L.results.length,0);assert.match(h.L.queryWarnings.join(' '),/完整性尚未确认/);});
