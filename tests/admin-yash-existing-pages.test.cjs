/* Synthetic KB/YASH records only; no network or production account data. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
function helpers(file,names){const preamble=fs.readFileSync(path.join(__dirname,file),'utf8').split(/\ntest\(/)[0];return new Function('require','__dirname',preamble+';return {'+names+'};')(require,__dirname)}
const {harness,settle,aggregate,P}=helpers('admin-navigation-performance.test.cjs','harness,settle,aggregate,P');
const KB={...P,id:'88888888-8888-4888-8888-888888888888',name:'YASH.BET',sourceName:'YASH.BET',source:'kb',team:'M8',country:'印度',scopeGroup:'IN',currency:'INR',timezone:'Asia/Kolkata',capabilities:{systemOrderId:false,thirdPartyOrderNumber:true,memberIdentity:true,memberDailyAvailable:true,analysisOrdersAvailable:true,recordedFee:true,successTimeAvailable:true,successTimeBasis:'source_completed_at',chargeSuccessTimeAvailable:true,withdrawSuccessTimeAvailable:true,paymentSuccessTimeAvailable:false,latencyAvailable:true,latencyBasis:'order_processing_duration',workordersAvailable:false,autoWithdrawAvailable:false,sourceCompletenessVerified:false}};
function scope(h){Object.assign(h.L,{country:'印度',currency:'INR',from:'2026-09-22T00:00:00',to:'2026-09-22T23:59:59',direction:'all',platform:KB.id});h.L.multi.platform=[KB.id];h.L.multi.direction=[];}
function result(empty=false,p=KB){const r=aggregate(p,10);r.capabilities=p.capabilities;r.startAt='2026-09-21T18:30:00.000Z';r.endAt='2026-09-22T18:30:00.000Z';r.summary=empty?[]:['charge','withdraw'].map(direction=>({...r.summary[0],direction,all_count:10,success_count:6,success_amount:600,created_success_count:4}));for(const key of Object.keys(r.groups))r.groups[key]=empty?[]:r.summary.map(row=>({...r.groups[key][0],...row}));return r;}
function show(h,empty=false,p=KB){Object.assign(h.L,{results:[result(empty,p)],queryPlatforms:[p],pageQueried:true,overviewQueried:true,dirty:false,loading:false,comparisonStatus:'idle',loadedView:'full',feeLookupRows:[],feeLookupLoading:false});h.c.render();}

test('KB native query carries its real UUID and India day; system and searchable fields respect catalog capabilities',async()=>{
 const h=harness({platforms:[KB],page:'orders'});await settle();scope(h);h.L.status='success';h.c.render();const filters=h.nodes.get('liveFilters').innerHTML;assert.match(filters,/KB系统/);assert.doesNotMatch(filters,/<option value="success" disabled/);assert.match(filters,/id="live-systemOrderId"[^>]*disabled/);assert.doesNotMatch(filters,/id="live-thirdPartyOrderNumber"[^>]*disabled/);
 await h.c.liveQuery();await settle();const q=h.calls.find(q=>q.action==='details');assert(q);assert.equal(q.platformId,KB.id);assert.equal(q.startAt,'2026-09-21T18:30:00.000Z');assert.equal(q.endAt,'2026-09-22T18:30:00.000Z');assert.equal(q.currency,'INR');assert.equal(q.status,'success');assert.match(h.html(),/成功时间（源订单完成时间）/);h.c.liveOrder(0);assert.match(h.drawers.at(-1).html,/成功时间（源订单完成时间）/);assert.doesNotMatch(h.drawers.at(-1).html,/>source-0</);
});

test('KB complete and empty order reads populate existing overview with completion basis and no unavailable-success zero fabrication',async()=>{
 const h=harness({platforms:[KB]});await settle();scope(h);
 for(const empty of [false,true]){show(h,empty);const html=h.html();assert.match(html,/data-kb-existing-source/);for(const id of ['df-collect','df-payout']){const card=html.match(new RegExp('<section class="df-card" id="'+id+'">([^]*?)</section>'))?.[1];assert(card);assert.match(card,new RegExp('本期成功 '+(empty?'0':'6')+' / 本期创建 '+(empty?'0':'10')+' 笔'));assert.match(card,/源订单完成时间/);if(!empty){assert.match(card,/600\.00/);assert.match(card,/60\.00%/);}}}
 const unavailable={...KB,capabilities:{...KB.capabilities,successTimeAvailable:false,chargeSuccessTimeAvailable:false,withdrawSuccessTimeAvailable:false}};show(h,true,unavailable);assert.match(h.html(),/成功时间口径未提供/);assert.doesNotMatch(h.html(),/本期成功 0 \/ 本期创建 0 笔/);
});

test('explicit KB missing success capability blocks success filtering rather than silently changing basis',async()=>{
 const p={...KB,capabilities:{...KB.capabilities,successTimeAvailable:false}},h=harness({platforms:[p],page:'orders'});await settle();scope(h);h.L.status='success';h.c.render();assert.match(h.nodes.get('liveFilters').innerHTML,/<option value="success" disabled selected/);const before=h.calls.length;await h.c.liveQuery();await settle();assert.equal(h.calls.slice(before).filter(q=>q.action==='details').length,0);
});

test('KB provider fee facts keep verified native identity through the existing aggregate bridge',async()=>{
 const h=harness({platforms:[KB],page:'collection'});await settle();scope(h);h.setHandler(q=>q.action==='aggregate'?result():{rows:[],total:0,options:{countries:[],platforms:[],providers:[]}});await h.c.liveQuery();await settle();const leaf=h.L.results[0].groups.provider[0];assert.equal(leaf.nativeFeeIdentityVerified,true);assert.equal(leaf.platformId,KB.id);assert.equal(leaf.source,'kb');assert.equal(leaf.country,'印度');
 const out=h.c.HensemProviderSummary.currentReferenceFeeFacts(leaf,[{provider:'Synthetic provider',scopeType:'country',country:'印度',collectFee:'4%',payoutFee:'2%'}],'印度');assert.equal(out.amount,24);assert.equal(out.matchedCount,6);
});

test('KB exports retain completion semantics and never inherit the DUOLI update-time note',async()=>{
 const h=harness({platforms:[KB],roleAllowed:()=>true});await settle();scope(h);show(h);const row={cells:[{innerText:'成功金额'},{innerText:'600.00'}],closest:()=>null};h.nodes.get('page').querySelectorAll=()=>[{closest:()=>null,querySelectorAll:()=>[row]}];h.c.liveExport();assert.equal(h.blobs.length,1);const csv=await h.blobs[0].text();assert.match(csv,/KB成功按成功状态＋源订单完成时间统计/);assert.match(csv,/不代表银行到账时效/);assert.doesNotMatch(csv,/多利成功/);
});

test('KB order support does not invent workorders or submission-risk statistics',async()=>{
 const h=harness({platforms:[KB],page:'providers'});await settle();scope(h);await h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='workorders').length,0);assert.equal(h.L.workordersUnsupported,true);
 const risk=harness({platforms:[KB],page:'events',submission:true});await settle();scope(risk);await risk.c.liveQuery();await settle();assert.equal(risk.calls.filter(q=>q.action==='submissionAnalysis'||q.action==='submissionStreaks').length,0);assert.match(risk.html(),/YASH\.BET：暂无此统计/);
});

test('KB success analysis shows both real success cohorts while workorders remain unavailable',()=>{
 const {api,props}=helpers('admin-success-analysis-ui.test.cjs','api,props'),a=api(),input=props({queryPlatforms:[KB],results:[result()],workorders:null});const model=a.buildModel(input);assert.equal(model.rows[0].charge[0].value,60);assert.equal(model.rows[0].withdraw[0].value,60);assert.equal(model.rows[0].workorder[0].value,null);const html=a.render(input);assert.match(html,/>KB</);assert.match(html,/KB成功按源订单完成时间统计/);
});

test('KB daily comparison uses current fees and completed success, exports basis, and does not call workorder RPC',async()=>{
 const {harness:daily}=helpers('admin-daily-comparison-ui.test.cjs','harness'),h=daily({platforms:[KB]});await h.module.load();assert.equal(h.module.model().now.success_count,25);assert.match(h.module.render(),/KB/);assert(h.module.exportRows()[0].some(v=>String(v).includes('KB成功按成功状态＋源订单完成时间')));h.c.liveDailyDirection('withdraw');assert.equal(h.module.model().now.success_count,40);h.c.liveDailyDirection('workorder');await h.module.load();assert.equal(h.workCalls.length,0);assert.equal(h.module.model().now.success_count,null);
});

test('KB memberDaily is opt-in and keeps unavailable or malformed counts unknown',async()=>{
 const {harness:members,response}=helpers('admin-member-counts-ui.test.cjs','harness,response'),h=members();for(const flag of [undefined,false]){h.select([{...KB,capabilities:{...KB.capabilities,memberDailyAvailable:flag}}]);await h.ui.load();assert.equal(h.calls.length,0);assert.match(h.ui.metric('charge'),/— \/ —/);}
 h.select([KB]);h.handler(q=>response(q,undefined,{platform:KB}));await h.ui.load();assert.equal(h.calls.length,1);assert.match(h.ui.metric('charge'),/12 \/ 9/);h.handler(q=>response(q,undefined,{platform:KB,capabilities:{memberIdentity:true}}));await h.ui.load();assert.equal(h.ui.state.status,'error');assert.match(h.ui.metric('charge'),/— \/ —/);
});

test('KB validated completion duration is labelled processing time, never bank-arrival latency; false flags remain closed',()=>{
 const {setup,result:durationResult}=helpers('admin-duration-drilldown.test.cjs','setup,result');const r=durationResult(KB.id);r.platform=KB;r.capabilities=KB.capabilities;const h=setup([r]),html=h.render('latency');assert.match(html,/订单处理耗时/);assert.match(html,/不代表银行到账时效/);assert.match(html,/100\.00%/);assert.doesNotMatch(html,/<h2>[^<]*(?:到账时效|到账较慢|成功到账)/);assert.doesNotMatch(html,/所选来源尚未提供实际支付成功时间/);
 for(const patch of [{latencyAvailable:false},{latencyBasis:null},{chargeSuccessTimeAvailable:false}]){const blocked=setup([{...r,capabilities:{...KB.capabilities,...patch}}]);assert.doesNotMatch(blocked.render('latency'),/>100\.00%/);}
});
