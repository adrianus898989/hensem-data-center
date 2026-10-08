/* Synthetic DUOLI facts only. The shared production UI harness makes no network requests. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const shared=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,aggregate,P}=new Function('require','__dirname',shared+';return {harness,settle,aggregate,P};')(require,__dirname);
const DUOLI={...P,id:'99999999-9999-4999-8999-999999999999',name:'UANG',source:'duoli',country:'印尼',scopeGroup:'ID',currency:'IDR',timezone:'Asia/Jakarta',capabilities:{sourceCompletenessVerified:false,chargeSuccessTimeAvailable:false,withdrawSuccessTimeAvailable:false,memberDailyAvailable:false}};
function scope(h){Object.assign(h.L,{country:'印尼',currency:'IDR',from:'2026-09-22T00:00:00',to:'2026-09-22T23:59:59',direction:'all',platform:DUOLI.id});h.L.multi.platform=[DUOLI.id];h.L.multi.direction=[];}
function result(empty=false){const r=aggregate(DUOLI,10);r.capabilities=DUOLI.capabilities;r.startAt='2026-09-21T17:00:00.000Z';r.endAt='2026-09-22T17:00:00.000Z';r.summary=empty?[]:['charge','withdraw'].map(direction=>({...r.summary[0],direction,currency:'IDR',all_count:10,success_count:null,success_amount:null,created_success_count:4}));for(const key of Object.keys(r.groups))r.groups[key]=empty?[]:r.summary.map(row=>({...r.groups[key][0],...row}));return r;}
function show(h,empty){Object.assign(h.L,{results:[result(empty)],queryPlatforms:[DUOLI],pageQueried:true,overviewQueried:true,dirty:false,loading:false,comparisonStatus:'idle',loadedView:'full',feeLookupRows:[],feeLookupLoading:false});h.c.render();}

test('DUOLI participates in the existing native order query with its UUID and Indonesia local clock',async()=>{
 const h=harness({platforms:[DUOLI],page:'orders'});await settle();scope(h);await h.c.liveQuery();await settle();const q=h.calls.find(q=>q.action==='details');assert(q);assert.equal(q.platformId,DUOLI.id);assert.equal(q.startAt,'2026-09-21T17:00:00.000Z');assert.equal(q.endAt,'2026-09-22T17:00:00.000Z');assert.equal(q.currency,'IDR');assert.match(h.nodes.get('liveFilters').innerHTML,/多利系统/);
});

test('DUOLI empty and active summaries preserve both unavailable success-time directions',async()=>{
 const h=harness({platforms:[DUOLI]});await settle();scope(h);
 for(const empty of [false,true]){show(h,empty);const html=h.html();assert.match(html,/data-duoli-existing-source/);assert.match(html,/完整性待核验，与旧日报独立展示/);if(!empty)assert.match(html,/代收创建单当前成功 4 \/ 10 笔/);for(const id of ['df-collect','df-payout']){const card=html.match(new RegExp('<section class="df-card" id="'+id+'">([^]*?)</section>'))?.[1];assert(card,id);assert.match(card,new RegExp('本期成功 — / 本期创建 '+(empty?'0':'10')+' 笔'));assert.match(card,/成功时间口径未提供，手续费暂不可统计/);assert.doesNotMatch(card,/本期无成功订单/);}}
});

test('DUOLI cannot be queried by an invented payment-success timestamp in either direction',async()=>{
 const h=harness({platforms:[DUOLI],page:'orders'});await settle();scope(h);
 for(const direction of ['all','charge','withdraw']){h.L.direction=direction;h.L.multi.direction=direction==='all'?[]:[direction];h.L.status='success';h.c.render();assert.match(h.nodes.get('liveFilters').innerHTML,/<option value="success" disabled selected/);const before=h.calls.length;await h.c.liveQuery();await settle();assert.equal(h.calls.slice(before).filter(q=>['aggregate','details'].includes(q.action)).length,0);assert.match(h.L.error,/多利.*成功时间/);}
 h.L.status='all';const before=h.calls.length;await h.c.liveQuery();await settle();assert(h.calls.slice(before).some(q=>q.action==='details'&&q.status==='all'));
});

test('DUOLI native collection does not enable unsupported submission-risk analysis',async()=>{
 const h=harness({platforms:[DUOLI],page:'events',submission:true});await settle();scope(h);await h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='submissionAnalysis'||q.action==='submissionStreaks').length,0);assert.match(h.html(),/UANG：暂无此统计/);assert.match(h.html(),/已读取 0 \/ 1 平台/);
});
