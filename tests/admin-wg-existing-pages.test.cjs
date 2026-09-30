/* Synthetic-only regression coverage for WG in the original M8 pages. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
const shared=read('admin-navigation-performance.test.cjs').split(/\ntest\(/)[0];
const {harness,settle,aggregate,P}=new Function('require','__dirname',shared+';return {harness,settle,aggregate,P};')(require,__dirname);
const WG={...P,id:'77777777-7777-4777-8777-777777777777',name:'26BET',source:'wg',country:'巴西',scopeGroup:'BR',currency:'BRL',timezone:'America/Sao_Paulo',capabilities:{withdrawSuccessTimeAvailable:false,successTimeBasis:'recharge_notify_time_only'}};
function wgResult(){const r=aggregate(WG,10),s={...r.summary[0],direction:'withdraw',currency:'BRL',all_count:10,all_amount:100,success_count:null,success_amount:null,created_success_count:4};r.summary=[s];r.capabilities=WG.capabilities;for(const key of ['provider','daily','hourly','amount','matrix'])r.groups[key]=r.groups[key].map(row=>({...row,...s}));return r}
function scope(h){Object.assign(h.L,{country:'巴西',currency:'BRL',from:'2026-09-22T00:00:00',to:'2026-09-22T23:59:59',direction:'withdraw',platform:WG.id});h.L.multi.platform=[WG.id];h.L.multi.direction=['withdraw'];}
function emptyWgResult(){const r=wgResult();r.total=0;r.summary=[];for(const key of Object.keys(r.groups))r.groups[key]=[];return r}
function showResults(h,results,platforms=[WG]){Object.assign(h.L,{results,queryPlatforms:platforms,pageQueried:true,overviewQueried:true,dirty:false,loading:false,comparisonStatus:'idle',loadedView:'full',feeLookupRows:[],feeLookupLoading:false});h.c.render();}
const textCells=row=>[...row.matchAll(/<td[^>]*>([^]*?)<\/td>/g)].map(cell=>cell[1].replace(/<[^>]*>/g,'').trim());

test('empty WG summaries keep original overview success-time totals and fee unknown without inventing data',async()=>{
 const h=harness({platforms:[WG]});await settle();scope(h);const empty=emptyWgResult();showResults(h,[empty]);
 const html=h.html(),payout=html.match(/<section class="df-card" id="df-payout">([^]*?)<\/section>/)?.[1];assert(payout);
 assert.match(html,/data-wg-existing-source/);assert.match(html,/本期未收到订单数据/);assert.match(payout,/成功金额 \/ 笔数<\/span><strong class="metric-link">—<\/strong><small class="cell-sub">— 笔/);
 assert.match(payout,/本期成功 — \/ 本期创建 0 笔/);assert.match(payout,/成功时间口径未提供，手续费暂不可统计/);assert.doesNotMatch(payout,/本期无成功订单/);assert.equal(empty.summary.length,0);
 for(const id of ['df-teams','df-countries','df-platforms','df-providers']){
  const section=html.slice(html.indexOf('id="'+id+'-withdraw"'));const footer=section.match(/<tfoot[^>]*>([^]*?)<\/tfoot>/)?.[1];assert(footer,id+' footer');const cells=textCells(footer),offset=id==='df-providers'?1:0;
  assert.equal(cells[0],'代付汇总');assert.equal(cells[1+offset],'0.00');assert.equal(cells[2+offset],'0');assert.equal(cells[3+offset],'—');assert.equal(cells[4+offset+(offset?1:0)],'—');
 }
 h.L.direction='all';h.L.multi.direction=[];h.c.render();const collection=h.html().match(/<section class="df-card" id="df-collect">([^]*?)<\/section>/)?.[1];assert.match(collection,/本期成功 0 \/ 本期创建 0 笔/,'WG recharge success-time empty totals remain genuine zero');
});

test('empty WG results keep existing provider and team success totals unknown, including mixed sources',async()=>{
 const other={...WG,id:'88888888-8888-4888-8888-888888888888',name:'SYNTHETIC-OTHER',source:'ar',capabilities:{}},known=wgResult();known.platform=other;known.capabilities={};
 for(const rows of [known.summary,...Object.values(known.groups)])for(const row of rows){row.success_count=6;row.success_amount=60;row.created_success_count=6;}
 const h=harness({platforms:[WG,other]});await settle();scope(h);
 for(const page of ['provider_payout','teamops','teamcountries','teamplatforms']){h.c.state.page=page;showResults(h,[emptyWgResult()]);const footers=[...h.html().matchAll(/<tfoot[^>]*>([^]*?)<\/tfoot>/g)].filter(x=>x[1].includes(page==='provider_payout'?'合计':'代付汇总'));assert(footers.length,page+' payout footer');for(const footer of footers){const cells=textCells(footer[1]);if(page==='provider_payout'){assert.equal(cells[5],'—');assert.equal(cells[6],'—');}else{assert.equal(cells[3],'—');assert.equal(cells[4],'—');}}if(page==='provider_payout'){assert.match(h.html(),/代付成功金额<\/label><strong>—<\/strong>/);assert.match(h.html(),/代付成功笔数<\/label><strong>—<\/strong>/);}}
 h.c.state.page='overview';h.L.platform='all';h.L.multi.platform=[];showResults(h,[emptyWgResult(),known],[WG,other]);const payout=h.html().match(/<section class="df-card" id="df-payout">([^]*?)<\/section>/)?.[1];assert.match(payout,/本期成功 — \/ 本期创建 10 笔/);assert.doesNotMatch(payout,/本期成功 6 \/ 本期创建/);
});

test('WG withdrawal success-time filter is disabled and blocked instead of returning a false empty table',async()=>{
 const h=harness({platforms:[WG],page:'orders'});await settle();scope(h);
 for(const direction of ['all','withdraw']){
  h.L.direction=direction;h.L.multi.direction=direction==='all'?[]:[direction];h.L.status='success';h.c.render();
  const filter=h.nodes.get('liveFilters').innerHTML;assert.match(filter,/<option value="success" disabled selected/);assert.match(filter,/不能按成功时间筛选/);assert.match(filter,/不会自动更换统计口径/);
  const before=h.calls.length;await h.c.liveQuery();await settle();assert.equal(h.calls.slice(before).filter(q=>['aggregate','details','query'].includes(q.action)).length,0);assert.match(h.L.error,/不能按成功时间筛选/);assert.equal(h.L.detail,null);assert.equal(h.L.status,'success');
 }
 h.L.direction='charge';h.L.multi.direction=['charge'];h.c.render();assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/<option value="success" disabled/);const before=h.calls.length;await h.c.liveQuery();await settle();assert(h.calls.slice(before).some(q=>q.action==='details'&&q.direction==='charge'&&q.status==='success'));
 h.L.direction='withdraw';h.L.multi.direction=['withdraw'];h.L.status='all';h.L.orderNumber='SYNTHETIC-WG-SUCCESS';const after=h.calls.length;await h.c.liveQuery();await settle();assert(h.calls.slice(after).some(q=>q.action==='details'&&q.status==='all'&&q.orderNumber==='SYNTHETIC-WG-SUCCESS'));
});

test('mapped WG aliases suppress the matching old report and retain canonical config navigation',async()=>{
 const prefix=read('admin-report-data.test.cjs').split(/\ntest\(/)[0],{fixture,feed}=new Function('require','__dirname',prefix+';return {fixture,feed}')(require,__dirname);
 for(const rawField of ['sourceName','source_name']){
  const opened=[],base={country:'越南',rawCountry:'VN',name:'98VV',rawPlatform:'98VV',team:'M8',system:'WG',provenance:{kind:'direct'},directions:['withdraw']};
  const f=fixture({catalog:[{...WG,name:'98VV.COM',country:'越南',team:'M8',[rawField]:'98VV'}],feeds:[feed({...base,dataset:'auto'}),feed({...base,dataset:'wg_config'})],payoutConfig:{openTarget:q=>opened.push(q)}});
  await f.page.loadCatalog();const native=f.page.catalog().find(p=>p.id===WG.id);assert.deepEqual(JSON.parse(JSON.stringify(native.feeds.map(x=>x.dataset))),['wg_config']);assert.equal(native.name,'98VV.COM');
  f.context.liveReportConfig(JSON.stringify(['wg_config','WG','VN','98VV']));assert.equal(opened[0].platform,'98VV');assert.equal(opened[0].country,'VN');
 }
});

test('the existing order query admits WG, retains platform UUID and does not call the standalone API',async()=>{
 const h=harness({platforms:[WG],page:'orders'});await settle();scope(h);h.c.liveQuery();await settle();
 const query=h.calls.find(q=>q.action==='details');assert(query);assert.equal(query.platformId,WG.id);assert.equal(query.direction,'withdraw');assert.equal(query.startAt,'2026-09-22T03:00:00.000Z');
 assert(!h.calls.some(q=>/wg.realtime/i.test(q.action)));
});
test('original overview labels WG creation-cohort success separately from unavailable success-time facts',async()=>{
 const h=harness({platforms:[WG]});await settle();scope(h);h.L.results=[wgResult()];h.L.pageQueried=true;h.L.overviewQueried=true;h.L.dirty=false;h.L.loading=false;h.L.comparisonStatus='idle';h.c.render();
 assert.match(h.html(),/data-wg-existing-source/);assert.match(h.html(),/代付创建单当前成功 4 \/ 10 笔（40\.00%）/);assert.match(h.html(),/操作时间不能当作成功时间/);assert.doesNotMatch(h.html(),/WG 实时数据工作区/);
});
test('null success counts survive aggregation and cannot render a fabricated zero success rate',()=>{
 const source=read('../admin-preview/live-data.js'),names=['C','R','countKeys','amountKeys','empty'];
 const declarations=names.map(name=>source.split('\n').find(line=>line.trim().startsWith('const '+name+'=')));
 const plus=source.split('\n').find(line=>line.trim().startsWith('function plus('));
 const api=new Function(declarations.join('\n')+'\n'+plus+';return {plus,C,R}')();
 const row=api.plus([{all_count:10,success_count:null,success_amount:null,created_success_count:4},{all_count:2,success_count:1,success_amount:20,created_success_count:1}]);
 assert.equal(row.success_count,null);assert.equal(row.success_amount,null);assert.equal(row.created_success_count,5);assert.equal(api.C(row.success_count),'—');assert.equal(api.R(row.success_count,row.all_count),'—');assert.equal(api.R(0,12),'0.00%');
});
test('WG replaces only its own authorized legacy business reports and keeps config and other backends',async()=>{
 const reportPrefix=read('admin-report-data.test.cjs').split(/\ntest\(/)[0],{fixture,feed}=new Function('require','__dirname',reportPrefix+';return {fixture,feed}')(require,__dirname);
 const base={country:'巴西',rawCountry:'BR',name:'26BET',rawPlatform:'26BET',team:'M8',system:'WG',provenance:{kind:'direct'},directions:['withdraw']};
 const h=fixture({catalog:[{...WG,team:'M8'}],feeds:[feed({...base,dataset:'auto'}),feed({...base,dataset:'volume'}),feed({...base,dataset:'wg_config'}),feed({...base,system:'AR',dataset:'volume'}),feed({...base,name:'OTHER',rawPlatform:'OTHER',dataset:'auto'})]});
 await h.page.load({country:'巴西',direction:'withdraw',from:'2026-09-22',to:'2026-09-22'});
 const native=h.page.catalog().find(p=>p.id===WG.id);assert.deepEqual(JSON.parse(JSON.stringify(native.feeds.map(f=>f.dataset))),['wg_config']);
 const requests=h.calls.filter(q=>q.action==='reportSummary').flatMap(q=>q.feeds);assert(!requests.some(f=>f.system==='WG'&&f.platform==='26BET'));assert(requests.some(f=>f.system==='AR'&&f.platform==='26BET'));assert(requests.some(f=>f.system==='WG'&&f.platform==='OTHER'));
});
test('withdrawal coverage distinguishes current and previous completeness and current-last-operator',()=>{
 const source=read('../admin-preview/live-withdraw-pages.js'),root={window:null,HensemLiveFilters:{multi:()=>''}};root.window=root;vm.runInNewContext(source,root);
 for(const pageName of ['auto_withdraw','withdraw_operators']){const module=root.HensemLiveWithdrawPages.create({L:{catalogReady:true,catalog:[WG],country:'巴西',from:'2026-09-22',to:'2026-09-22'},page:()=>pageName,E:String,C:String,N:String,R:()=> '—',box:(title,body)=>body,table:()=>'',render:()=>{},request:async()=>({})});
  module.state.data={rows:[],totals:{},wgCoverage:{days:[{date:'2026-09-21',complete:true,collected:20},{date:'2026-09-22',complete:false,collected:10}],complete:false,currentComplete:false,previousComplete:true,timeBasis:'created_at',operatorBasis:'current_latest_operator'}};
  let html=module.render();assert.match(html,/data-wg-coverage="partial"/);assert.match(html,/当期所选创建日尚未完整采集/);assert.match(html,/不是完整总计/);assert.match(html,/当前最后操作者/);assert.match(html,/不代表历史操作次数/);assert.doesNotMatch(html,/当期所选创建日已完整采集|前期覆盖不完整/);
  module.state.data.wgCoverage={...module.state.data.wgCoverage,currentComplete:true,previousComplete:false,days:[{date:'2026-09-21',complete:false,collected:10},{date:'2026-09-22',complete:true,collected:20}]};
  html=module.render();assert.match(html,/data-wg-coverage="complete"/);assert.match(html,/当期所选创建日已完整采集/);assert.match(html,/前期覆盖不完整，跨期汇总暂不可比/);assert.doesNotMatch(html,/当期所选创建日尚未完整采集/);
 }
});
test('automatic withdrawal and operator pages label empty WG coverage as historical fallback only in the selected scope',()=>{
 const source=read('../admin-preview/live-withdraw-pages.js'),root={window:null,HensemLiveFilters:{multi:()=>''}};root.window=root;vm.runInNewContext(source,root);
 const other={...WG,id:'88888888-8888-4888-8888-888888888888',name:'SYNTHETIC-AR',source:'ar'};
 for(const pageName of ['auto_withdraw','withdraw_operators']){
  const L={catalogReady:true,catalog:[WG,other],country:'巴西',from:'2026-09-22',to:'2026-09-22'},module=root.HensemLiveWithdrawPages.create({L,page:()=>pageName,E:String,C:String,N:String,R:()=> '—',box:(title,body)=>body,table:()=>'',render:()=>{},request:async()=>({})});
  module.state.platforms=[WG.name];module.state.data={rows:[],totals:{total:300,processed:300}};
  for(const coverage of [undefined,{days:[]}]){module.state.data.wgCoverage=coverage;const html=module.render();assert.match(html,/data-wg-coverage="historical"/);assert.match(html,/WG 新明细尚未接入所选日期，当前沿用历史日报；不是本次实时采集结果/);assert.doesNotMatch(html,/data-wg-coverage="partial"/);}
  module.state.platforms=[other.name];assert.doesNotMatch(module.render(),/data-wg-coverage="historical"/);
  module.state.platforms=[WG.name];module.state.data.wgCoverage={days:[{date:'2026-09-22',complete:false}],currentComplete:false};assert.match(module.render(),/data-wg-coverage="partial"/);assert.doesNotMatch(module.render(),/data-wg-coverage="historical"/);
  L.country='越南';module.state.data.wgCoverage={days:[]};assert.doesNotMatch(module.render(),/data-wg-coverage="historical"/);
 }
});
test('WG mixed with a known source keeps combined success facts unknown and does not label them no successes',async()=>{
 const other={...WG,id:'88888888-8888-4888-8888-888888888888',name:'SYNTHETIC-OTHER',source:'ar',capabilities:{}},r=wgResult(),known=wgResult();known.platform=other;known.capabilities={};
 for(const rows of [known.summary,...Object.values(known.groups)])for(const row of rows){row.success_count=6;row.success_amount=60;row.created_success_count=6;}
 const h=harness({platforms:[WG,other]});await settle();scope(h);h.L.platform='all';h.L.multi.platform=[];h.L.results=[r,known];Object.assign(h.L,{pageQueried:true,overviewQueried:true,dirty:false,loading:false,comparisonStatus:'idle',feeLookupRows:[],feeLookupLoading:false});h.c.render();
 const payout=h.html().match(/<section class="df-card" id="df-payout">([^]*?)<\/section>/)?.[1];assert(payout);assert.match(payout,/本期成功 — \/ 本期创建 20 笔/);assert.match(payout,/成功时间口径未提供，手续费暂不可统计/);assert.doesNotMatch(payout,/本期无成功订单|本期成功 6 \/ 本期创建 20/);
 assert.match(h.html(),/代付创建单当前成功 4 \/ 10 笔/);
});
test('WG withdrawal latency remains unknown even if a response supplies zero bins, while recharge is unchanged',()=>{
 const durationPrefix=read('admin-duration-drilldown.test.cjs').split(/\ntest\(/)[0],{setup,result}=new Function('require','__dirname',durationPrefix+';return {setup,result}')(require,__dirname);
 const withdraw=result('wg',10,0,4);withdraw.platform=WG;withdraw.capabilities={...WG.capabilities,successTimeAvailable:false};withdraw.summary[0]={...withdraw.summary[0],direction:'withdraw',success_count:null,success_amount:null};for(const rows of Object.values(withdraw.groups))for(const row of rows)row.direction='withdraw';withdraw.latencySummary[0].direction='withdraw';
 const h=setup([withdraw],{direction:'withdraw'}),html=h.render('latency');assert.match(html,/到账时效暂不可统计/);const table=h.tables.find(t=>t.headers[0]==='成功耗时区间');assert(table);assert.equal(table.rows[0][2],'—');assert.equal(table.rows[0][3],'—');assert.doesNotMatch(html,/0\.00% 时间覆盖/);
 const charge=result('wg-charge');charge.platform=WG;charge.capabilities={...WG.capabilities,successTimeAvailable:false};assert.match(setup([charge]).render('latency'),/1分/);
});
test('provider fee totals cannot turn unknown WG success-time facts into zero cost or full coverage',()=>{
 const feePrefix=read('admin-overview-fees.test.cjs').split(/\ntest\(/)[0],{api,plus,combine}=new Function('require','__dirname',feePrefix+';return {api,plus,combine}')(require,__dirname);
 const row=api.buildRows({orders:[{provider:'SyntheticPay',direction:'withdraw',currency:'BRL',success_count:null,success_amount:null}],issues:[],rates:[],country:'巴西',direction:'withdraw',plus,combine})[0];
 assert.equal(row.estimated_fee,null);assert.equal(row.fee_complete,false);const sum=api.feeSummary([{...row,success_count:null,currency:'BRL'}]);assert.equal(sum.amount,null);assert.equal(sum.complete,false);assert.equal(sum.successCount,null);assert.match(api.feeCoverageText(sum),/不能计算手续费/);
});
