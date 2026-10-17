/* Shared production controllers, synthetic publications and no network. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const pre=fs.readFileSync(path.join(__dirname,'admin-panda-native-ui.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,PANDA,result}=new Function('require','__dirname',pre+';return {harness,settle,PANDA,result};')(require,__dirname);
const OTHER={...PANDA,id:'88888888-8888-4888-8888-888888888888',name:'Synthetic AR',source:'ar',sourceName:'SYNTHETIC_AR',capabilities:{}};
const enc=value=>encodeURIComponent(JSON.stringify(value)),segment={kind:'hourly',direction:'charge',hour:23};
async function setup({page='time',mixed=false,prefix=true,cutoff='2026-09-23T11:00:00Z',multiDay=false}={}){
 const platforms=mixed?[PANDA,OTHER]:[PANDA],h=harness({page,platforms,roleAccess:{mode:'owner',canView:true,permissions:[]},roleAllowed:()=>true,extraModules:['live-statistic-windows.js','live-prepared-aggregates.js','live-matrix-custom-range.js'],beforeLive(c){for(const [name,key]of [['HensemAnalysisDrilldown','prefixAnalysis'],['HensemMatrixCustomRange','prefixCustom']]){const create=c[name].create;c[name].create=options=>(c[key]=create(options));}}});await settle();
 if(!prefix)h.setNow('2026-09-24T12:00:00Z');
 Object.assign(h.L,{country:'巴西',currency:'BRL',platform:mixed?'all':PANDA.id,from:'2026-09-23T00:00:00',to:(multiDay?'2026-09-24':'2026-09-23')+'T23:59:59',successFrom:'2026-09-23T00:00:00',successTo:(multiDay?'2026-09-24':'2026-09-23')+'T23:59:59'});h.L.multi.platform=platforms.map(p=>p.id);
 function response(q){const p=platforms.find(p=>p.id===q.platformId),r={...result(p),version:1,startAt:q.startAt,endAt:q.endAt,successStartAt:q.successStartAt,successEndAt:q.successEndAt,successBasis:q.successBasis,durationVersion:2,asOf:'2026-09-23T11:59:00Z'};
  for(const key of Object.keys(r.groups))r.groups[key]=r.groups[key].map(row=>({...row,hour:6,all_count:p===OTHER?2:10,all_amount:p===OTHER?'200':'1000'}));
  if(p===OTHER)r.groups.hourly.push({...r.groups.hourly[0],hour:23,all_count:2,all_amount:'200'});
  r.pandaCoverage=p===PANDA&&prefix?{timeBasis:'created_at',statisticBasis:'current_stored_status',complete:false,requestedComplete:false,effectiveComplete:true,sourceComplete:false,requestedStartAt:q.startAt,requestedEndAt:q.endAt,effectiveStartAt:q.startAt,effectiveEndAt:cutoff,dataCutoff:cutoff,reason:'verified_created_prefix_only',directions:['charge','withdraw'].map(direction=>({direction,startAt:q.startAt,endAt:cutoff,complete:true}))}:{complete:true,directions:['charge','withdraw'].map(direction=>({direction,startAt:q.startAt,endAt:q.endAt,complete:true}))};return r;}
 h.setHandler(q=>q.action==='aggregatePrepared'?{version:2,items:q.requests.map(request=>({request,status:'ready',publication:{id:'synthetic-detail-boundary',generation:1,computedAt:'2026-09-23T11:59:00Z',expiresAt:'2026-09-23T12:09:00Z',cutoff:'2026-09-23T11:59:00Z',calculationComplete:true,sourceComplete:false,freshness:'fresh',refreshState:'idle'},result:response(request)}))}:q.action==='aggregate'?{...response(q),complete:true,hasMore:false}:q.action==='providerOptions'?{providers:[]}:{rows:[],total:0});
 await h.c.liveQuery();await settle();h.L.tableSizes={'analysis-state':100};h.c.render();return h;
}
const rawCalls=h=>h.calls.filter(q=>['aggregate','analysisOrders'].includes(q.action));
function hours(h,min,max){h.c.liveAnalysisHourSet('hourMin',String(min));h.c.liveAnalysisHourSet('hourMax',String(max));h.c.liveAnalysisHourQuery();return {kind:'custom',direction:'charge',hourRange:{minHour:min,maxHour:max},placement:'analysis-custom-time'};}
test('prefix detail buttons and every manually called action stay closed without raw fallback',async()=>{
 const h=await setup();assert.match(h.html(),/data-panda-prefix-detail-blocked/);assert.match(h.html(),/08:00:00/);
 for(const op of ['togglePlatform','toggleProvider','provider','providerDaily','daily','platformDaily','select','retry','toggle'])h.c.liveAnalysisAction(enc(segment),op,encodeURIComponent(PANDA.id));
 h.c.prefixAnalysis.open(segment,'future');h.c.prefixAnalysis.valueButton(segment,'future','0');
 h.c.liveAnalysisOrders(enc({segment,dimension:'platform',platformId:PANDA.id,direction:'charge',basis:'created'}));h.c.liveAnalysisOrderPage(1);h.c.liveAnalysisOrderPlatform(0);h.c.liveAnalysisOrdersBack();await settle();
 assert.equal(rawCalls(h).length,0);assert.equal(h.c.prefixAnalysis.isOpen(segment),false);const rows=h.c.prefixAnalysis.platformRows(segment);assert(rows.every(row=>row.all_count===null&&row.success_count===null));assert.equal(h.drawers.length,0);
});
test('custom future and cutoff-crossing hours stay unknown while verified hours retain facts',async()=>{
 const h=await setup();for(const [min,max]of [[23,24],[6,10],[7,9]]){const s=hours(h,min,max);assert.equal(h.c.prefixCustom.customResults(s).complete,false);const row=h.c.prefixCustom.detailRows(s)[0];for(const key of ['all_count','all_amount','pending_count','failed_count'])assert.equal(row[key],null);assert.equal(row._ready,false);}
 const s=hours(h,6,7),row=h.c.prefixCustom.detailRows(s)[0];assert.equal(row.all_count,10);assert.equal(row.all_amount,1000);assert.equal(row.success_count,null);assert.equal(h.c.prefixCustom.customResults(s).complete,true);assert.match(h.html(),/data-panda-prefix-custom/);assert.equal(h.L.results[0].summary[0].all_count,10);assert.equal(rawCalls(h).length,0);
});
test('partial cutoff hours and later uncollected days cannot qualify as verified custom intervals',async()=>{
 const partial=await setup({cutoff:'2026-09-23T09:30:00Z'}),s=hours(partial,6,7);assert.equal(partial.c.prefixCustom.detailRows(s)[0].all_count,null);assert.equal(partial.c.prefixCustom.customResults(s).complete,false);
 const multi=await setup({multiDay:true}),next=hours(multi,6,7);assert.equal(multi.c.prefixCustom.detailRows(next)[0].all_count,null);assert.equal(multi.c.prefixCustom.customResults(next).complete,false);
});
test('mixed custom totals propagate unknown prefix coverage and keep safe earlier hours',async()=>{
 const h=await setup({mixed:true});let s=hours(h,23,24),rows=h.c.prefixCustom.detailRows(s);assert.equal(rows.find(r=>r.platformId===PANDA.id).all_count,null);assert.equal(rows.find(r=>r.platformId===OTHER.id).all_count,2);assert.equal(h.c.prefixCustom.customResults(s).complete,false);const summary=h.html().match(/23:00 ≤ 时段[\s\S]*?<\/tr>/)?.[0];assert(summary);assert.match(summary,/<td>—<\/td><td>—<\/td>/);s=hours(h,6,7);rows=h.c.prefixCustom.detailRows(s);assert.equal(rows.reduce((n,r)=>n+r.all_count,0),12);assert.equal(h.c.prefixCustom.customResults(s).complete,true);assert.equal(rawCalls(h).length,0);
});
test('independent amount prefix never creates complete future zero cells or whole-day totals',async()=>{
 const h=await setup({page:'amount'});h.c.liveMatrixAmountSet('min','0');h.c.liveMatrixAmountSet('max','2000');await h.c.liveMatrixAmountQuery();await settle();const cells=h.c.prefixCustom.row('charge');assert.match(cells[24],/—笔/);assert.doesNotMatch(cells[24],/>0笔|>0</);assert.match(cells.at(-1),/全部笔数<\/small><b>— 笔/);assert.match(cells[7],/>10笔/);assert.equal(rawCalls(h).length,0);
});
test('closed Panda preserves ordinary drilldown and old order links cannot bypass a later prefix',async()=>{
 const h=await setup({prefix:false});assert.doesNotMatch(h.html(),/data-panda-prefix-detail-blocked/);h.c.liveAnalysisAction(enc(segment),'togglePlatform');h.c.render();const key=h.html().match(/liveAnalysisOrders\('([^']+)'\)/)?.[1];assert(key);h.c.liveAnalysisAction(enc(segment),'provider');await settle();assert(rawCalls(h).some(q=>q.view==='drilldown'));
 const prefix=await setup();h.L.results=prefix.L.results;const before=rawCalls(h).length;h.c.liveAnalysisOrders(key);h.c.liveAnalysisOrderPage(1);h.c.liveAnalysisOrderPlatform(0);h.c.liveAnalysisOrder(0);h.c.liveAnalysisOrdersBack();await settle();assert.equal(rawCalls(h).length,before);assert.equal(h.drawers.length,0);
});
