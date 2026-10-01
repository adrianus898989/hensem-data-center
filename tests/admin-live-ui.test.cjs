/* Synthetic-only VM tests for the production UI adapter. No credentials/network/real orders. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8');
const layoutSources=['live-amount-bands.js','live-member-counts.js','live-submission-analysis.js','live-analysis-drilldown.js','live-matrix-custom-range.js','live-reference-layout.js','live-pages-reference.js','live-pending-snapshot.js','live-pending-analysis.js','live-empty-pages.js','live-duration-reference.js','live-payout-config.js','live-filter-controls.js','live-configuration.js','live-provider-aliases.js','live-provider-summary.js', 'live-provider-orders.js','live-provider-sticky.js','live-collected-data.js','live-report-data.js', 'live-withdraw-pages.js','live-workorder-operations.js','live-deposit-issues.js'].map(name=>({name,source:fs.readFileSync(path.join(__dirname,'../admin-preview',name),'utf8')}));
const comparisonSource=fs.readFileSync(path.join(__dirname,'../admin-preview/live-comparison.js'),'utf8');
test('overview merges same providers across sources while preserving stable platform identities and other source reports',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222',source:'NEW_AR'},p3={...P,id:'33333333-3333-4333-8333-333333333333'};
 const h=await ready({platforms:[P,p2,p3]});h.L.results=[completeAggregate(P,11,3),completeAggregate(p2,17,8),completeAggregate(p3,23,9)];h.L.platform='all';h.L.comparisonStatus='idle';h.L.direction='charge';h.L.dailyView='all';
 const tableFor=(page,view,first)=>{h.c.state.page=page;h.L.view=view;h.c.render();const found=renderedTables(h.html()).find(t=>t.headers[0]===first&&t.headers.includes('包网来源'));assert(found,page+'/'+view+' has an independent source column');for(const row of found.rows)assert.equal(row.length,found.headers.length,page+'/'+view+' cell alignment');return found};
 const numeric=(table,source,label)=>{const row=table.rows.find(r=>plain(r[table.headers.indexOf('包网来源')])===source);assert(row,'source '+source);return Number(plain(row[table.headers.indexOf(label)]).replaceAll(',',''))};
 h.c.state.page='overview';h.c.render();const overviewProviders=renderedTables(h.html()).find(t=>t.headers[0]==='三方');assert.equal(overviewProviders.rows.length,1);assert(!overviewProviders.headers.includes('包网来源'));assert(!overviewProviders.headers.includes('方向'));assert.equal(plain(overviewProviders.rows[0][overviewProviders.headers.indexOf('全部笔数')]),'51');assert.equal(plain(overviewProviders.rows[0][overviewProviders.headers.indexOf('全部金额')]),'5,100.00');
 for(const page of ['overview','teamplatforms','merchants']){h.c.state.page=page;h.L.view='business';h.c.render();const t=renderedTables(h.html()).find(t=>t.headers[0]==='平台');assert(t);assert(!t.headers.includes('包网来源'));assert(!t.headers.includes('方向'));assert.equal(t.rows.length,3,page+' stable platforms must not merge by display name or source');assert.deepEqual(t.rows.map(r=>Number(plain(r[t.headers.indexOf('全部笔数')]))).sort((a,b)=>a-b),[11,17,23]);assert.equal(t.rows.reduce((n,r)=>n+Number(plain(r[t.headers.indexOf('全部金额')]).replaceAll(',','')),0),5100);}
 const fees=tableFor('merchantproviders','fees','三方');assert.equal(fees.rows.length,2);assert.equal(numeric(fees,'AR','成功金额'),1200);assert.equal(numeric(fees,'NEW_AR','成功金额'),800);assert.equal(numeric(fees,'AR','成功笔数'),12);assert.equal(numeric(fees,'NEW_AR','成功笔数'),8);
 for(const [page,view]of [['risk','business']]){const t=tableFor(page,view,'三方');assert.equal(t.rows.length,2);assert.deepEqual(t.rows.map(r=>plain(r[t.headers.indexOf('包网来源')])).sort(),['AR','NEW_AR']);}
 tableFor('provider_daily','business','三方');const daily=renderedTables(h.html()).find(t=>t.headers[0]==='日期');assert(daily);assert.equal(daily.rows.length,2);assert.equal(numeric(daily,'AR','全部笔数'),34);assert.equal(numeric(daily,'NEW_AR','全部笔数'),17);assert.equal(numeric(daily,'AR','成功笔数'),12);assert.equal(numeric(daily,'NEW_AR','成功笔数'),8);
});

test('overview separately displays rejected and unknown amounts and counts so every status reconciles',async()=>{
 const h=await ready(),r=completeAggregate(P,10,3);
 r.summary=[{...stats(10,'1000'),success_count:3,success_amount:'300',pending_count:2,pending_amount:'200',failed_count:1,failed_amount:'100',rejected_count:2,rejected_amount:'240',unknown_count:2,unknown_amount:'160'},{...stats(13,'1300'),direction:'withdraw',success_count:4,success_amount:'440',pending_count:3,pending_amount:'360',failed_count:2,failed_amount:'180',rejected_count:1,rejected_amount:'90',unknown_count:3,unknown_amount:'230'}];
 h.L.results=[r];h.L.comparisonStatus='idle';h.L.direction='all';h.c.state.page='overview';h.c.render();
 const number=text=>Number(text.replaceAll(',',''));
 for(const [id,expected]of [['df-collect',r.summary[0]],['df-payout',r.summary[1]]]){
  const html=h.html().match(new RegExp('<section class="df-card" id="'+id+'">([^]*?)</section>'))?.[1];assert(html,id);
  const cards=[...html.matchAll(/<div class="df-flow-metric"><span>([^]*?)金额 \/ 笔数<\/span><strong[^>]*>([^]*?)<\/strong><small[^>]*>([\d,]+) 笔<\/small>/g)].map(m=>({label:m[1],amount:number(plain(m[2])),count:number(m[3])}));assert.equal(cards.length,id==='df-collect'?4:3);
  const tail=html.match(/<div class="df-state-tail">([^]*?)<\/div>/)?.[1];assert(tail);
  const tailItems=Object.fromEntries([...tail.matchAll(/<span>([^<]+) <b>([^]*?)<\/b><\/span>/g)].map(m=>[m[1],number(plain(m[2]))]));
  assert.deepEqual(tailItems,{'驳回金额':Number(expected.rejected_amount),'驳回笔数':expected.rejected_count,'未知状态金额':Number(expected.unknown_amount),'未知状态笔数':expected.unknown_count});
  if(id==='df-collect')assert.equal(cards.slice(1).reduce((n,s)=>n+s.amount,0)+tailItems['驳回金额']+tailItems['未知状态金额'],cards[0].amount);
  if(id==='df-collect')assert.equal(cards.slice(1).reduce((n,s)=>n+s.count,0)+tailItems['驳回笔数']+tailItems['未知状态笔数'],cards[0].count);
 }
 assert.match(h.html(),/近7天代付中快照/);assert.doesNotMatch(h.html(),/所选创建日期内仍待付/);assert.doesNotMatch(h.html(),/所选提交日期内仍待付/);
 r.summary[0].unknown_amount=null;r.summary[0].all_amount=null;h.c.render();const collect=h.html().match(/<section class="df-card" id="df-collect">([^]*?)<\/section>/)?.[1];assert.match(collect,/未知状态金额 <b>—<\/b>/);assert.match(collect,/未知状态笔数 <b>2<\/b>/);assert.doesNotMatch(collect,/NaN|Infinity/);
});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async()=>{for(let n=0;n<24;n++)await flush()};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const P={id:'11111111-1111-4111-8111-111111111111',name:'Synthetic platform',source:'AR',country:'印度',scopeGroup:'india',timezone:'Asia/Kolkata',currency:'INR'};
const stats=(count=5,amount='1000.25')=>({direction:'charge',currency:'INR',all_count:count,all_amount:amount,success_count:3,created_success_count:3,success_amount:'600.15',pending_count:1,pending_amount:'200.05',failed_count:1,failed_amount:'200.05',rejected_count:0,rejected_amount:'0',unknown_count:0,unknown_amount:'0',missing_amount_count:0});
function aggregate(p=P,count=5){const s=stats(count);return {platform:p,total:count,startAt:'2026-09-21T18:30:00.000Z',endAt:'2026-09-22T00:30:00.000Z',summary:[s],rows:[],groups:{provider:[{...s,provider:'Synthetic provider'}],daily:[{...s,provider:'Synthetic provider',date:'2026-09-22'}],hourly:[{...s,hour:12}],amount:[{...s,bucket:'200'}],matrix:[{...s,bucket:'200',hour:12}],latency:[],pending_age:[]}}}
function detail(p=P,total=65,offset=0,limit=20){return {platform:p,total,offset,limit,hasMore:offset+limit<total,summary:[],groups:{},rows:Array.from({length:Math.max(0,Math.min(limit,total-offset))},(_,i)=>({id:'row-'+(offset+i),system_order_id:'source-'+(offset+i),order_number:'order-'+(offset+i),third_party_order_number:'third-'+(offset+i),member_id:'member-'+(offset+i),provider:'Synthetic provider',direction:'charge',status:'1',status_group:'success',amount:'200.05',created_at:'2026-09-22T01:02:03Z',success_at:'2026-09-22T01:03:03Z',currency:'INR'}))}}
function payoutConfig(request,hasTargets=true){const target={platform:'SYNTHETIC_CONFIG_PLATFORM',country_code:'IN',country_name:'印度',display_group:'IN',display_name:'印度',timezone:'Asia/Kolkata',members:[]};return request.operation==='index'?{version:1,system:request.system,readOnly:true,targets:hasTargets?[target]:[],summaries:hasTargets?[{...target,observed_local_date:'2026-09-22'}]:[]}:{version:1,system:request.system,readOnly:true,target,snapshot:{country_code:'IN',platform:target.platform,timezone:'Asia/Kolkata',observed_local_date:'2026-09-22',observed_at:'2026-09-22T00:00:00Z',configuration:{fields:[{key:'autoWithdraw',kind:'boolean',available:true,value:false},{key:'withdrawAmount',kind:'number',available:true,value:0}],groups:[]}}}}
function pendingAnalysisResult(request,marker='Synthetic snapshot platform'){
 const days=(Date.parse(request.endDate)-Date.parse(request.startDate))/86400000+1;
 return {version:1,basis:'seven_day_pending_snapshot',startDate:request.startDate,endDate:request.endDate,daily:Array.from({length:days},(_,i)=>({basis:'seven_day_pending_snapshot',snapshotDate:new Date(Date.parse(request.startDate)+i*86400000).toISOString().slice(0,10),complete:true,expectedPlatformCount:request.platformIds.length,receivedPlatformCount:request.platformIds.length,currency:'INR',amount:'875.50',count:7,rows:request.platformIds.map(id=>({id,name:marker,state:'complete',count:7,amount:'875.50',groups:[{provider:'Synthetic snapshot provider',count:7,amount:'875.50'}]}))})),aging:{complete:false,message:'Synthetic snapshot waiting-time coverage'}};
}
function harness(options={}){
 const nodes=new Map(),writes=[],calls=[],drawers=[],intervals=[],timers=[],blobs=[];let handler=options.handler,clock=Date.parse('2026-09-23T12:00:00Z');
 function node(id){let html='';const item={id,textContent:'',value:'',title:'',style:{setProperty(k,v){this[k]=v}},classList:{add(){},remove(){}},querySelector:s=>node(id+' '+s),querySelectorAll:()=>[],appendChild(n){if(n.id)nodes.set(n.id,n);return n},after(n){if(n.id)nodes.set(n.id,n)},remove(){nodes.delete(this.id)},setAttribute(){},click(){},focus(){}};Object.defineProperty(item,'innerHTML',{get:()=>html,set:v=>{html=String(v);writes.push({id,html})}});return item}
 for(const id of ['pageTitle','pageSubtitle','eyebrow','crumbTitle','nav','filters','scope','page','headerActivityV3','.title-actions','.bottom-note','.top-right','.topbar'])nodes.set(id,node(id));
 const keys=['overview','providers','orders','time','amount','matrix','provider_daily','latency','stuck','collection','payout','risk','channelquality','teamops','teamcountries','teamplatforms','merchants','workorders','rates','data_health','deposit_tracking','dropped','anomaly','events','rules','access','ip','login_logs','operation_logs','teams','provider_config','platform_systems','merchantproviders'];
 const merchantKeys=['merchants','merchantproviders','workorders','deposit_tracking'];
 const pages=keys.map(k=>[k,'',k,'',k]),groups=[['analysis','','数据分析',keys.filter(k=>!merchantKeys.includes(k))],['merchant','','商户中心',merchantKeys]];
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}}
 class TestURL extends URL{static createObjectURL(blob){blobs.push(blob);return 'blob:synthetic'}static revokeObjectURL(){}}
 const context={console,Intl,Date:FixedDate,URL:TestURL,Blob,state:{page:options.page||'overview',navGroup:'analysis'},pages,navGroupsV3:groups,location:{hash:options.hash||''},
  document:{title:'',body:{classList:{add(){},remove(){}},appendChild(n){nodes.set(n.id,n)}},getElementById:id=>nodes.get(id)||null,querySelector:selector=>nodes.get(selector)||null,createElement:tag=>node(tag)},
  render(){nodes.get('page').innerHTML='INDEPENDENT_SNAPSHOT'},syncFilters(){},groupForV3:key=>groups.find(g=>g[3].includes(key))||groups[0],toggleCenterV3(){},setPage(){},headerIconV3:()=>'<svg></svg>',openDrawer:(title,html)=>drawers.push({title,html}),toast(){},scrollTo(){},
  setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length},clearInterval(){},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout(){},
  HENSEM_PRODUCTION:options.production!==false,
  hensemLiveCancelRequests:actions=>options.onCancel?.(actions),
  hensemLiveRequest:async request=>{calls.push(JSON.parse(JSON.stringify(request)));if(request.action==='pendingAnalysis')return options.pendingAnalysisHandler?options.pendingAnalysisHandler(request):pendingAnalysisResult(request);if(request.action==='pendingSnapshot')return options.pendingSnapshotHandler?options.pendingSnapshotHandler(request):{basis:'seven_day_pending_snapshot',snapshotDate:request.date,windowStart:new Date(Date.parse(request.date+'T00:00:00Z')-6*86400000).toISOString().slice(0,10),windowEnd:request.date,complete:true,expectedPlatformCount:request.platformIds.length,receivedPlatformCount:request.platformIds.length,amount:'875.50',count:7,observedAt:'2026-09-23T00:00:00Z',rows:request.platformIds.map(id=>({id,name:'Synthetic snapshot platform',state:'complete',count:7,amount:'875.50',currency:'INR',timezone:'Asia/Kolkata'}))};if(!options.ancillaryHandler&&request.action==='providerOptions')return {providers:['Synthetic provider']};if(!options.ancillaryHandler&&request.action==='workorders')return {rows:[],byProvider:[],total:0,summary:{},byDirection:{}};if(handler)return handler(request);if(request.action==='catalog')return {platforms:options.platforms||[P]};if(request.action==='details')return detail((options.platforms||[P]).find(p=>p.id===request.platformId)||P,65,request.offset,request.limit);if(request.action==='rates')return {rows:[],total:0,options:{countries:[],platforms:[],providers:[]}};if(request.action==='payoutConfig')return payoutConfig(request,(options.platforms||[P]).length>0);return aggregate((options.platforms||[P]).find(p=>p.id===request.platformId)||P,65)}
 };context.window=context;vm.createContext(context);vm.runInContext(comparisonSource,context,{filename:'live-comparison.js',timeout:2000});for(const module of layoutSources.filter(m=>(m.name!=='live-report-data.js'||options.reports)&&(m.name!=='live-submission-analysis.js'||options.submissions)&&(!['live-amount-bands.js','live-member-counts.js'].includes(m.name)||options.adaptive)))vm.runInContext(module.source,context,{filename:module.name,timeout:2000});vm.runInContext(source,context,{filename:'live-data.js',timeout:2000});
 return {c:context,L:context.adminLive,calls,writes,nodes,drawers,intervals,timers,blobs,setHandler:fn=>handler=fn,setNow:value=>clock=Date.parse(value),html:()=>nodes.get('page').innerHTML};
}
async function ready(options={}){const h=harness(options);await settle();if(h.L){h.L.from='2026-09-22T00:00:00';h.L.to='2026-09-22T05:59:59';if(options.manualOverview!==true){h.c.liveQuery();await settle();}}return h}
function setScope(h,values={}){Object.assign(h.L,{from:'2026-09-22T00:00:00',to:'2026-09-22T05:59:59',...values})}
function completeAggregate(p=P,count=10,success=5){const r=aggregate(p,count),s={...stats(count,String(count*100)),success_count:success,created_success_count:success,success_amount:String(success*100),pending_count:count-success,pending_amount:String((count-success)*100),failed_count:0,failed_amount:'0',rejected_count:0,rejected_amount:'0',unknown_count:0,unknown_amount:'0'};r.summary=[s];for(const key of ['provider','daily','hourly','amount','matrix'])r.groups[key]=[{...r.groups[key][0],...s}];return r}
const withoutWindow=q=>Object.fromEntries(Object.entries(q).filter(([key])=>!['startAt','endAt'].includes(key)));
const plain=html=>String(html).replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim();
function renderedTables(html){return [...html.matchAll(/<table\b[^>]*>([^]*?)<\/table>/g)].map(match=>({html:match[0],headers:[...match[1].matchAll(/<th\b[^>]*>([^]*?)<\/th>/g)].map(x=>plain(x[1].replace(/<span\b[^>]*aria-hidden="true"[^>]*>[^]*?<\/span>/g,''))),rows:[...(match[1].match(/<tbody\b[^>]*>([^]*?)<\/tbody>/)?.[1]||'').matchAll(/<tr\b[^>]*>([^]*?)<\/tr>/g)].map(row=>[...row[1].matchAll(/<td\b[^>]*>([^]*?)<\/td>/g)].map(cell=>cell[1]))}));}

test('data health filters the authorized directory locally on Query without replacing focused drafts',async()=>{
 const platforms=[{...P,id:'health-india-ar',name:'ALPHA INDIA',team:'M8'}, {...P,id:'health-india-new',name:'ALPHA NEW',source:'NEW_AR',team:'M8'}, {...P,id:'health-brazil',name:'ALPHA BRAZIL',country:'巴西',scopeGroup:'brazil',team:'HK'}, ...Array.from({length:22},(_,i)=>({...P,id:'health-other-'+i,name:'OTHER '+i,team:'Other team'}))];
 const h=harness({page:'data_health',platforms});await settle();const calls=h.calls.length,ids=Array.from(h.L.catalog,p=>p.id),form={reportValidity:()=>true};
 const names=()=>renderedTables(h.html()).find(t=>t.headers[0]==='平台').rows.map(row=>plain(row[0]));
 assert.equal(h.L.groups.length,25);h.c.livePage(2,'local');assert.equal(h.L.localPage,2);const writes=h.writes.filter(w=>w.id==='page').length;
 h.c.liveHealthSet('query','  alpha  ');h.c.liveHealthSet('source','AR');h.c.liveHealthSet('group','印度');
 assert.equal(h.writes.filter(w=>w.id==='page').length,writes,'typing/selecting only updates drafts and keeps focus');assert.equal(h.L.groups.length,25,'drafts do not silently change the displayed result');
 h.c.liveHealthQuery(form);assert.equal(h.L.localPage,1);assert.deepEqual(names(),['ALPHA INDIA']);
 h.c.liveHealthSet('group','brazil');h.c.liveHealthQuery(form);assert.deepEqual(names(),['ALPHA BRAZIL'],'authorization-group values filter as well as country names');
 h.c.liveHealthSet('source','');h.c.liveHealthSet('group','');h.c.liveHealthSet('query','m8');let prevented=false;
 h.c.liveHealthQuery(form,{key:'Enter',target:{tagName:'INPUT',type:'search'},preventDefault(){prevented=true}});assert.equal(prevented,true);assert.deepEqual(names(),['ALPHA INDIA','ALPHA NEW'],'team keywords match case-insensitively');
 h.c.setPage('overview');h.c.setPage('data_health');assert.deepEqual(names(),['ALPHA INDIA','ALPHA NEW'],'returning to the page retains the applied filter');
 h.c.liveHealthSet('query','not authorized or not present');h.c.liveHealthQuery(form);assert.equal(h.L.groups.length,0);
 h.c.liveHealthReset();assert.equal(h.L.localPage,1);assert.equal(h.L.groups.length,25);assert.equal(names().length,20);assert.match(h.html(),/id="healthQuery"[^>]*value=""/);
 assert.deepEqual(Array.from(h.L.catalog,p=>p.id),ids,'filtering never mutates the authorized catalog');assert.equal(h.calls.length,calls,'query, reset, pagination and page return make no extra API request');
});


const supervisorRoutes=[['workorder_permissions','权限与预警']];

test('all workorder entries share one menu while supervisor pages never reuse production results',async()=>{
 const h=await ready(),groups=h.c.navGroupsV3,merchant=groups.findIndex(g=>g[0]==='merchant'),work=groups[merchant+1];
 assert.equal(work[0],'workorder');assert.equal(work[2],'工单运营中心');assert.deepEqual(Array.from(work[3]),['workorders','deposit_tracking','deposit_statistics','workorder_reconciliation','workorder_workload','workorder_operation_logs',...supervisorRoutes.map(([id])=>id)]);
 const before=h.calls.length;h.L.results=structuredClone(h.L.results);h.L.results[0].platform.name='UNRELATED_PRODUCTION_PLATFORM';h.L.dirty=true;
 for(const [id,label]of supervisorRoutes){
  h.c.setPage(id);await settle();assert.equal(h.c.state.navGroup,'workorder');assert.equal(h.c.location.hash,id);assert.equal(h.c.groupForV3(id)[0],'workorder');assert.equal(h.c.pages.filter(p=>p[0]===id).length,1);
  assert.equal(h.nodes.get('crumbTitle').textContent,'工单运营中心 / '+label);assert.match(h.html(),/员工测试站尚未接通/);assert.match(h.html(),/数据来源与现有入口/);assert.doesNotMatch(h.html(),/UNRELATED_PRODUCTION_PLATFORM|class="kpi-value"|0 条|0 笔/);
  assert.equal(h.nodes.get('liveFilters').style.display,'none');assert.doesNotMatch(h.c.document.title,/正式数据/);assert.match(h.nodes.get('.title-actions').innerHTML,/setPage\('workorders'\)/);assert.match(h.nodes.get('.title-actions').innerHTML,/setPage\('deposit_tracking'\)/);assert.doesNotMatch(h.nodes.get('.title-actions').innerHTML,/liveLoad|liveExport/);
  await h.c.liveLoad();h.c.liveExport();assert.equal(h.calls.length,before);assert.equal(h.blobs.length,0);
 }
 assert.equal(h.c.groupForV3('operation_logs')[0],'analysis','existing system audit menu remains separate');
});

test('direct supervisor routes and bookmarks defer all requests until an existing data entry is opened',async()=>{
 for(const [page]of supervisorRoutes){
  for(const options of [{page,reports:true},{hash:'#'+page,reports:true}]){
   const h=await ready(options);assert.equal(h.c.state.page,page);assert.equal(h.c.state.navGroup,'workorder');assert.equal(h.calls.length,0);assert.match(h.html(),/员工测试站尚未接通/);
   h.c.setPage('workorders');await settle();await h.c.liveQuery();await settle();assert.equal(h.c.state.page,'workorders');assert.equal(h.c.state.navGroup,'workorder');assert.equal(h.calls.filter(q=>q.action==='catalog').length,1);assert(h.calls.some(q=>q.action==='workorderRecords'));assert(!h.calls.some(q=>q.action==='aggregate'));
   h.c.setPage('deposit_tracking');await settle();await h.c.liveQuery();await settle();assert.equal(h.c.state.page,'deposit_tracking');assert(h.calls.some(q=>q.action==='depositIssues'));assert.match(h.nodes.get('crumbTitle').textContent,/工单运营中心 \/ 存款未到账-跟进记录/);
  }
 }
});

test('a pending production catalogue cannot start report reads after navigation to a supervisor page',async()=>{
 const pending=deferred(),h=harness({reports:true,handler:q=>q.action==='catalog'?pending.promise:aggregate()});
 assert.deepEqual(h.calls.map(q=>q.action),['catalog']);h.c.setPage('workorder_permissions');pending.resolve({platforms:[P]});await settle();
 assert.deepEqual(h.calls.map(q=>q.action),['catalog']);assert.equal(h.L.country,P.country);assert.match(h.html(),/员工测试站尚未接通/);
 h.setHandler(q=>q.action==='rates'?{rows:[],total:0}:q.action==='reportSummary'?{rows:[],summary:{}}:aggregate());h.c.setPage('providers');await settle();await h.c.liveQuery();await settle();
 assert.equal(h.c.state.page,'providers');assert(h.calls.some(q=>q.action==='aggregate'&&q.direction==='charge'));assert.doesNotMatch(h.html(),/员工测试站尚未接通/);
});

test('returning from supervisor initializes the default report-only country',async()=>{
 const pending=deferred(),rows=[
  {dataset:'volume',system:'PANDA',name:'REPORT_IN',country:'印度',rawCountry:'IN',rawPlatform:'REPORT_IN',directions:['charge'],records:1,available:true,currency:'INR',timezone:'Asia/Kolkata',provenance:{kind:'google_sheets'}},
  {dataset:'volume',system:'PANDA',name:'REPORT_PK',country:'巴基斯坦',rawCountry:'PK',rawPlatform:'REPORT_PK',directions:['charge'],records:1,available:true,currency:'PKR',timezone:'Asia/Karachi',provenance:{kind:'google_sheets'}}
 ];
 const h=harness({reports:true,handler:q=>q.action==='catalog'?pending.promise:q.action==='collectedData'?{rows}:q.action==='reportSummary'?{feeds:q.feeds.map(f=>({...f,rawCountry:f.country,rawPlatform:f.platform,status:'not_received',groups:[]}))}:q.action==='rates'?{rows:[],total:0}:aggregate()});
 h.c.setPage('workorder_permissions');pending.resolve({platforms:[]});await settle();assert.deepEqual(h.calls.map(q=>q.action),['catalog']);
 h.c.setPage('providers');await settle();await h.c.liveQuery();await settle();assert.equal(h.L.country,'印度');assert.equal(h.calls.filter(q=>q.action==='catalog').length,1,'reuse the already authorized native directory');
 const reports=h.calls.filter(q=>q.action==='reportSummary');assert.equal(reports.length,0);assert.doesNotMatch(h.html(),/REPORT_IN|REPORT_PK|自动出款配置接入|源日报数据/);
});

test('returning from supervisor preserves a paused directory without automatically reading it again',async()=>{
 const pending=deferred(),h=harness({page:'providers',ancillaryHandler:true,handler:q=>q.action==='catalog'?{platforms:[P]}:q.action==='providerOptions'?pending.promise:q.action==='rates'?{rows:[],total:0}:q.action==='workorders'?{rows:[],summary:{},total:0}:aggregate()});
 await settle();h.c.liveQuery();await settle();assert.equal(h.L.providerOptionsBusy,true);assert.equal(h.calls.filter(q=>q.action==='providerOptions').length,1);
 h.c.setPage('workorder_workload');const requestsOnSupervisor=h.calls.length;pending.resolve({providers:['Synthetic provider']});await settle();assert.equal(h.calls.length,requestsOnSupervisor);assert.equal(h.L.providerOptionsBusy,false);
 h.c.setPage('providers');await settle();assert.equal(h.L.providerOptionsBusy,false);assert.equal(h.calls.filter(q=>q.action==='providerOptions').length,1);await h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='providerOptions').length,2);assert(h.L.providerOptions.includes('Synthetic provider'));
});

test('adapter does nothing outside production and never installs an automatic data refresh',async()=>{
 const offline=await ready({production:false});assert.equal(offline.L,undefined);assert.equal(offline.calls.length,0);
 const h=await ready();assert.equal(h.calls.filter(q=>q.action==='catalog').length,1);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,2);assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.intervals.length,0);const n=h.calls.length;h.c.render();h.c.render();await settle();assert.equal(h.calls.length,n);h.c.liveSet('provider','chosen');assert.equal(h.calls.length,n);assert.match(h.html(),/点击查询/);await h.c.liveQuery();assert.equal(h.calls.at(-1).providers[0],'chosen');
});

const businessCalls=h=>h.calls.filter(q=>['aggregate','details','reportSummary','workorders','pendingSnapshot'].includes(q.action));

test('overview first opening waits for query and existing queried tabs restore without fetching data',async()=>{
 const h=await ready({manualOverview:true,reports:true,handler:q=>q.action==='catalog'?{platforms:[P]}:q.action==='collectedData'?{rows:[]}:q.action==='rates'?{rows:[],total:0}:aggregate()});
 assert.equal(h.L.catalogReady,true);assert.equal(h.L.overviewQueried,false);assert.equal(businessCalls(h).length,0);assert.equal(h.calls.filter(q=>q.action==='catalog').length,1);assert.match(h.html(),/点击查询/);
 h.c.render();h.c.render();await settle();assert.equal(businessCalls(h).length,0);
 await h.c.liveQuery();await settle();assert.equal(h.L.overviewQueried,true);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,2);assert.equal(h.L.comparisonStatus,'ready');
 h.c.setPage('time');await settle();const before=businessCalls(h).length;h.c.setPage('overview');await settle();assert.equal(businessCalls(h).length,before);assert.equal(h.L.overviewQueried,true);assert.equal(h.L.dirty,false);assert.match(h.html(),/代收经营总数据/);
 const prior=h.calls.filter(q=>q.action==='aggregate').length;await h.c.liveQuery();await settle();assert.equal(h.L.overviewQueried,true);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,prior+2,'an explicit returned overview reads current and comparison once');
});

test('overview quick dates and reset update only the filters, before and after a query',async()=>{
 const h=await ready({manualOverview:true});
 for(const queried of [false,true]){
  if(queried){h.c.livePeriod('yesterday',false);await h.c.liveQuery();await settle();}
  const before=businessCalls(h).length;
  for(const [mode,from]of [['yesterday','2026-09-22'],['before','2026-09-21'],['week','2026-09-17'],['month','2026-09-01']]){h.c.livePeriod(mode);await settle();assert.equal(h.L.from.slice(0,10),from);assert.equal(businessCalls(h).length,before);assert.equal(h.L.dirty,true);assert.match(h.html(),/点击查询/);}
  h.c.liveReset();await settle();assert.equal(h.L.from,'2026-09-22T00:00:00');assert.equal(h.L.to,'2026-09-22T23:59:59');assert.equal(businessCalls(h).length,before);assert.equal(h.L.direction,'all');
 }
});

test('an explicit query while the initial catalog is pending reads each business period once',async()=>{
 for(const page of ['overview','collection']){
  const catalog=deferred(),h=harness({page,handler:q=>q.action==='catalog'?catalog.promise:q.action==='rates'?{rows:[],total:0}:aggregate()});
  const clicked=h.c.liveQuery();await flush();assert.equal(businessCalls(h).length,0);assert.equal(h.calls.filter(q=>q.action==='catalog').length,1);
  catalog.resolve({platforms:[P]});await clicked;await settle();assert.equal(h.L.catalogReady,true);assert.equal(h.L.loading,false);assert.equal(h.L.comparisonStatus,'ready');
  const aggregates=h.calls.filter(q=>q.action==='aggregate');assert.equal(aggregates.length,2,page+' must not repeat initialization work');assert.equal(new Set(aggregates.map(q=>q.startAt+'|'+q.endAt)).size,2);
 }
});

test('an explicit overview retry recovers a failed catalog without an automatic business read',async()=>{
 let catalogs=0;const h=harness({handler:q=>{if(q.action==='catalog'){catalogs++;if(catalogs===1)throw Error('目录暂不可用');return {platforms:[P]};}return q.action==='rates'?{rows:[],total:0}:aggregate();}});await settle();assert.equal(h.L.catalogReady,false);assert.equal(businessCalls(h).length,0);assert.match(h.html(),/目录暂不可用/);
 await h.c.liveQuery();await settle();assert.equal(catalogs,2);assert.equal(h.L.catalogReady,true);assert.equal(h.L.error,'');assert.equal(h.calls.filter(q=>q.action==='aggregate').length,2);assert.equal(h.L.comparisonStatus,'ready');
});

test('cancelling an in-flight report and manually querying the same scope starts a new read without stale cancellation errors',async()=>{
 const pending=[];let reportReads=0;
 const rawFeed={dataset:'volume',system:'REPORT',country:'印度',rawCountry:'印度',name:P.name,rawPlatform:P.name,team:'M8',directions:['charge'],records:2,provenance:{kind:'google_sheets'}};
 const h=harness({page:'collection',reports:true,onCancel:actions=>{if(actions.includes('reportSummary'))for(const item of pending.splice(0))item.reject(Object.assign(Error('查询已取消'),{name:'AbortError',code:'ADMIN_LIVE_CANCELLED'}));},handler:q=>{
  if(q.action==='catalog')return {platforms:[P]};if(q.action==='collectedData')return {rows:[rawFeed]};if(q.action==='reportSummary'){reportReads++;if(reportReads===1){const d=deferred();pending.push(d);return d.promise;}return {feeds:q.feeds.map(f=>({...f,rawCountry:f.country,rawPlatform:f.platform,records:0,status:'empty',groups:[]}))};}return q.action==='rates'?{rows:[],total:0}:aggregate();
 }});await settle();h.c.liveQuery();await settle();assert.equal(reportReads,1);const first=h.calls.find(q=>q.action==='reportSummary');h.c.setPage('merchants');await settle();await h.c.liveQuery();await settle();assert.equal(reportReads,2);assert.deepEqual(h.calls.filter(q=>q.action==='reportSummary')[1],first,'the destination needs the same exact source/date scope');assert.doesNotMatch(h.html(),/查询已取消/);assert.equal(h.c.state.page,'merchants');assert.equal(h.L.loading,false);
});

test('monthly overview and provider reads cover the exact half-open range in contiguous bounded parts',async()=>{
 for(const page of ['overview','providers']){
  const h=await ready({page,manualOverview:true});h.setNow('2026-09-26T12:00:00Z');h.calls.length=0;
  setScope(h,{from:'2026-09-01T00:00:00',to:'2026-09-25T23:59:59',direction:'charge',multi:{team:[],platform:[],source:[],provider:['Synthetic provider'],direction:['charge']}});
  h.setHandler(q=>q.action==='rates'?{rows:[],total:0}:completeAggregate(P,1,1));await h.c.liveQuery();await settle();
  const reads=h.calls.filter(q=>q.action==='aggregate'),from=Date.parse('2026-08-31T18:30:00Z'),to=Date.parse('2026-09-25T18:30:00Z'),day=86400000;
  const current=reads.filter(q=>Date.parse(q.startAt)>=from),previous=reads.filter(q=>Date.parse(q.startAt)<from);assert.equal(current.length,25,page+' current calendar days');assert.equal(previous.length,25,page+' matching previous period');
  for(const [parts,start,end]of [[current,from,to],[previous,from-25*day,from]]){const ordered=parts.slice().sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt));assert.equal(Date.parse(ordered[0].startAt),start);assert.equal(Date.parse(ordered.at(-1).endAt),end);for(let i=0;i<ordered.length;i++){const q=ordered[i];assert.equal(Date.parse(q.endAt)-Date.parse(q.startAt),day);if(i)assert.equal(q.startAt,ordered[i-1].endAt);assert.equal(q.platformId,P.id);assert.equal(q.view,'providers');assert.equal(q.direction,'charge');assert.equal(q.currency,'INR');assert.deepEqual(q.providers,['Synthetic provider']);}}
  assert.equal(h.L.results.length,1);assert.equal(h.L.results[0].total,25);assert.equal(h.L.results[0].summary[0].all_count,25);assert.equal(h.L.results[0].summary[0].success_count,25);assert.equal(h.L.results[0].summary[0].success_amount,2500);assert.equal(h.L.results[0]._parts.length,25);assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.comparisonStatus,'ready');
 }
});

test('bounded monthly reads preserve a partial final day and reuse successful chunks when retrying failures',async()=>{
 const h=await ready({manualOverview:true});h.setNow('2026-09-26T12:00:00Z');h.calls.length=0;setScope(h,{from:'2026-09-20T00:00:00',to:'2026-09-22T05:59:59'});
 const from='2026-09-19T18:30:00.000Z',middle='2026-09-20T18:30:00.000Z',last='2026-09-21T18:30:00.000Z',end='2026-09-22T00:30:00.000Z';let failed=true;
 h.setHandler(q=>{if(q.action==='aggregate'&&q.startAt===middle&&failed)throw Error('暂时读取失败');return q.action==='rates'?{rows:[],total:0}:completeAggregate(P,1,1)});
 await h.c.liveQuery();await settle();assert.equal(h.L.queryFailures.length,1);assert.equal(h.L.results.length,0);assert.deepEqual(h.calls.filter(q=>q.action==='aggregate').map(q=>[q.startAt,q.endAt]),[[from,middle],[middle,last]]);
 failed=false;await h.c.liveRetryFailed();await settle();const reads=h.calls.filter(q=>q.action==='aggregate');assert.equal(reads.filter(q=>q.startAt===from).length,1,'completed first day is reused');assert.equal(reads.filter(q=>q.startAt===middle).length,2,'only failed day is retried');assert(reads.some(q=>q.startAt===last&&q.endAt===end),'six-hour final chunk is included');assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.results[0].total,3);assert.equal(h.L.results[0]._parts.length,3);
});

test('all direction remains selectable while charge and withdrawal totals are displayed separately',async()=>{
 const h=await ready();assert.equal(h.L.direction,'all');
 const filters=h.nodes.get('liveFilters').innerHTML,direction=filters.match(/<details[^>]*data-multi="direction"[^]*?<\/details>/)?.[0];
 assert(direction,'direction multiselect exists');assert.match(direction,/value="charge"/);assert.match(direction,/value="withdraw"/);assert.match(direction,/>全部</);assert.doesNotMatch(direction,/代收 \+ 代付/);
 assert(h.calls.filter(q=>q.action==='aggregate').every(q=>q.direction==='all'));
 h.c.liveSet('direction','withdraw');await h.c.liveQuery();assert(h.calls.filter(q=>q.action==='aggregate').slice(-2).every(q=>q.direction==='withdraw'));
 h.c.liveReset();await settle();assert.equal(h.L.direction,'all');assert(h.calls.filter(q=>q.action==='aggregate'||q.action==='details').every(q=>['all','charge','withdraw'].includes(q.direction)));await h.c.liveQuery();
 const r=completeAggregate(P,10,3),withdraw=completeAggregate(P,20,15).summary[0];withdraw.direction='withdraw';r.summary.push(withdraw);for(const key of ['provider','daily','hourly','amount','matrix'])r.groups[key].push({...r.groups[key][0],...withdraw});h.L.results=[r];h.L.comparisonStatus='idle';h.c.render();assert.match(h.html(),/代收/);assert.match(h.html(),/代付/);assert.match(h.html(),/1,000\.00/);assert.match(h.html(),/2,000\.00/);assert.match(h.html(),/30\.00%/);assert.match(h.html(),/75\.00%/);assert.doesNotMatch(h.html(),/3,000\.00|60\.00%/);
 for(const page of ['providers','orders','time','amount','matrix','provider_daily','risk','teamops','merchants']){h.c.state.page=page;h.c.render();assert.doesNotMatch(h.html(),/3,000\.00|60\.00%/,page+' must not pool direction amounts or rates')}
});

test('yesterday comparison performs a real previous-day query with the identical non-time scope',async()=>{
 const h=await ready();setScope(h,{provider:'Provider/Exact',status:'pending',direction:'withdraw'});const calls=[];
 h.setHandler(async q=>{calls.push(q);const r=completeAggregate(P,calls.length===1?10:20,0);for(const s of r.summary)s.direction='withdraw';return r});
 await h.c.liveQuery();assert.equal(calls.length,2);assert.equal(calls[0].startAt,'2026-09-21T18:30:00.000Z');assert.equal(calls[0].endAt,'2026-09-22T00:30:00.000Z');assert.equal(calls[1].startAt,'2026-09-20T18:30:00.000Z');assert.equal(calls[1].endAt,'2026-09-21T00:30:00.000Z');assert.deepEqual(withoutWindow(calls[1]),withoutWindow(calls[0]));assert.equal(h.L.results[0].total,10);assert.equal(h.L.comparisonResults[0].total,20);assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.L.comparisonError,'');
});

test('current totals publish before the baseline; a failed baseline never erases current or fabricates zero change',async()=>{
 const h=await ready(),baseline=deferred();setScope(h);let n=0;
 h.setHandler(q=>++n===1?Promise.resolve(completeAggregate(P,10,5)):baseline.promise);
 const pending=h.c.liveQuery();await settle();assert.equal(h.L.loading,false);assert.equal(h.L.results[0].total,10);assert.equal(h.L.comparisonStatus,'loading');assert.match(h.html(),/1,000/);
 baseline.reject(Error('Synthetic baseline unavailable'));await pending;assert.equal(h.L.results[0].total,10);assert.equal(h.L.error,'');assert.equal(h.L.comparisonStatus,'error');assert.equal(h.L.comparisonResults.length,0);assert.match(h.html(),/Synthetic baseline unavailable|比较.*失败|对比.*失败|对比.*不可用/);assert.doesNotMatch(h.html(),/[+−-]0\.00%/);
});

test('late previous-period response cannot replace the comparison for a newer query',async()=>{
 const h=await ready(),oldBaseline=deferred();setScope(h);let phase='old',oldCalls=0;
 h.setHandler(q=>{if(phase==='old')return ++oldCalls===1?Promise.resolve(completeAggregate(P,11,5)):oldBaseline.promise;return Promise.resolve(completeAggregate(P,q.startAt==='2026-09-21T18:30:00.000Z'?22:44,5))});
 const old=h.c.liveQuery();await settle();assert.equal(h.L.results[0].total,11);assert.equal(h.L.comparisonStatus,'loading');phase='new';const fresh=h.c.liveQuery();await fresh;assert.equal(h.L.results[0].total,22);assert.equal(h.L.comparisonResults[0].total,44);oldBaseline.resolve(completeAggregate(P,999,5));await old;assert.equal(h.L.results[0].total,22);assert.equal(h.L.comparisonResults[0].total,44);assert.equal(h.L.comparisonStatus,'ready');
});

test('today comparison and detail pagination share the frozen query cutoff',async()=>{
 const h=await ready();setScope(h,{platform:P.id,from:'2026-09-23T17:00:00',to:'2026-09-23T23:59:59'});h.c.state.page='orders';
 const calls=[];h.setHandler(async q=>{calls.push(q);return q.action==='details'?detail(P,65,q.offset,q.limit):completeAggregate(P,65,39)});await h.c.liveQuery();
 const now=calls.find(q=>q.action==='aggregate'),prior=calls.filter(q=>q.action==='aggregate')[1];assert.equal(now.endAt,'2026-09-23T12:00:01.000Z');assert.equal(prior.endAt,'2026-09-22T12:00:01.000Z');const frozen=h.L.queryNow;
 h.setNow('2026-09-23T13:00:00Z');h.c.livePage(2,'server');await settle();const page=calls.at(-1);assert.equal(page.action,'details');assert.equal(page.startAt,now.startAt);assert.equal(page.endAt,now.endAt);assert.equal(page.offset,20);assert.equal(h.L.queryNow,frozen);
});

test('zero baseline is new activity and success-rate changes use percentage points',async()=>{
 const h=await ready();setScope(h);let n=0;h.setHandler(async()=>++n===1?completeAggregate(P,10,5):completeAggregate(P,0,0));await h.c.liveQuery();assert.match(h.html(),/新增/);assert.doesNotMatch(h.html(),/Infinity|NaN|\+100\.00%/);
 n=0;h.setHandler(async()=>++n===1?completeAggregate(P,10,5):completeAggregate(P,20,5));await h.c.liveQuery();assert.match(h.html(),/25(?:\.00)?\s*(?:个)?百分点/);assert.doesNotMatch(h.html(),/成功率[^]*?\+100\.00%/);
});

test('overview preserves all dashboard sections without the redundant navigation row or extra queries',async()=>{
 const h=await ready();h.c.liveOverviewAnalysis();await settle();const calls=h.calls.length;h.c.render();const html=h.html();assert.match(html,/class="dashboard-full-v3"/);assert.doesNotMatch(html,/class="df-jumps"|加载全部图表分析/);assert.doesNotMatch(html,/liveOverviewTab\(/);
 for(const id of ['df-collect','df-payout','df-backlog','df-risk','df-exceptions','df-order-trend','df-charge-trend','df-charge-money','df-withdraw-trend','df-withdraw-money','df-teams','df-countries','df-platforms','df-providers','df-amounts','df-hour-charge','df-hour-withdraw','df-workorders'])assert(html.includes('id="'+id+'"'),id+' is visible in the full overview');
 assert.equal(h.calls.length,calls);assert.doesNotMatch(html,/NaN|Infinity/);
});

test('reference totals retain exactly six compact cards per direction with independent amounts and unknown fees',async()=>{
 const h=await ready(),r=completeAggregate(P,10,3),withdraw={...completeAggregate(P,20,15).summary[0],direction:'withdraw'};r.summary.push(withdraw);h.L.results=[r];h.L.comparisonStatus='idle';h.c.state.page='merchantproviders';h.c.render();
 const groups=[...h.html().matchAll(/<section class="live-reference-direction" data-direction="([^"]+)"[^>]*>([^]*?)<\/section>/g)];assert.equal(groups.length,2);assert.deepEqual(groups.map(x=>x[1]),['charge','withdraw']);
 for(const [,direction,html]of groups){assert.deepEqual([...html.matchAll(/data-metric="([^"]+)"/g)].map(x=>x[1]),['all','success','pending','failed','success_rate','fee'],direction);assert.match(html,/data-metric="fee"[^]*?class="kpi-value">—</);assert.doesNotMatch(html,/NaN|Infinity/)}
 assert.match(groups[0][2],/1,000\.00/);assert.match(groups[1][2],/2,000\.00/);assert.doesNotMatch(h.html(),/3,000\.00|60\.00%/);h.L.direction='charge';h.c.render();assert.equal([...h.html().matchAll(/data-metric=/g)].length,6);assert.doesNotMatch(h.html(),/data-direction="withdraw"/);
});

test('shared metric cards and overview show independent amount and count changes without rereading data',async()=>{
 const h=await ready(),current=completeAggregate(P,80,8),previous=completeAggregate(P,100,12);
 current.summary[0].all_amount=8000;current.summary[0].success_amount=1200;previous.summary[0].all_amount=10000;previous.summary[0].success_amount=900;
 h.L.results=[current];h.L.comparisonResults=[previous];h.L.comparisonStatus='ready';h.L.direction='charge';h.L.comparisonLabel='较前一日同一时段';const before=JSON.stringify([h.L.results,h.L.comparisonResults]),calls=h.calls.length;
 for(const page of ['matrix','time','amount','orders','merchants','teamops']){h.c.state.page=page;h.L.platform=P.id;h.L.multi.platform=[P.id];h.c.render();const cards=h.html().match(/<section class="live-reference-direction"[^]*?<\/section>/)?.[0];assert(cards,page);const visible=plain(cards);assert.match(visible,/较昨日 -2,000\.00（-20\.00%）/,page);assert.match(visible,/较昨日 -20 笔（-20\.00%）/,page);assert.match(visible,/较昨日 \+300\.00（\+33\.33%）/,page);assert.match(visible,/较昨日 -4 笔（-33\.33%）/,page);assert.match(visible,/较昨日 -2\.00 个百分点/,page)}
 h.c.state.page='overview';h.c.render();const flow=h.html().match(/<section class="df-card" id="df-collect">([^]*?)<\/section>/)?.[1];assert(flow);assert.match(plain(flow),/较昨日 -2,000\.00（-20\.00%）/);assert.match(plain(flow),/较昨日 -20 笔（-20\.00%）/);assert.match(plain(flow),/较昨日 -2\.00 个百分点/);
 assert.equal(JSON.stringify([h.L.results,h.L.comparisonResults]),before);assert.equal(h.calls.length,calls);
});

test('paired business tables retain unknown totals without a provider confirmation panel',async()=>{
 const h=await ready(),r=completeAggregate(P,10,3),withdraw={...completeAggregate(P,20,15).summary[0],direction:'withdraw'};
 r.summary.push(withdraw);
 r.groups.provider=[{...r.summary[0],provider:'未识别通道'},{...withdraw,provider:'未识别通道'}];
 h.L.results=[r];h.L.direction='all';h.c.state.page='overview';h.c.render();
 assert.doesNotMatch(h.html(),/需要你确认的未识别三方|原始通道字段为空|请.*归类/);assert.match(h.html(),/未识别通道/);
 const providers=renderedTables(h.html()).filter(t=>t.headers[0]==='三方');assert.equal(providers.length,2);assert.match(providers.map(t=>t.html).join(''),/代收汇总/);assert.match(providers.map(t=>t.html).join(''),/代付汇总/);
 const platforms=renderedTables(h.html()).filter(t=>t.headers[0]==='平台');assert.equal(platforms.length,2);assert.match(platforms.map(t=>t.html).join(''),/代收汇总/);assert.match(platforms.map(t=>t.html).join(''),/代付汇总/);
});

test('overview duration sections split collection and payout and retain explicit totals',async()=>{
 const h=await ready(),r=completeAggregate(P,10,3),withdraw={...completeAggregate(P,20,15).summary[0],direction:'withdraw'};
 r.summary.push(withdraw);
 r.groups.latency=['charge','withdraw'].flatMap(direction=>Array.from({length:10},(_,bucket)=>({direction,currency:'INR',bucket,count:bucket===0?2:0,amount:bucket===0?'200':'0',valid_count:3,valid_amount:'300'})));
 r.groups.pending_age=[{direction:'withdraw',currency:'INR',bucket:0,count:2,amount:'200',valid_count:2,valid_amount:'200'}];
 h.L.loadedView='full';h.L.results=[r];h.L.direction='all';h.c.state.page='overview';h.c.render();
 assert.match(h.html(),/class="grid equal live-duration-paired"/);assert.match(h.html(),/充值 \/ 代收成功耗时/);assert.match(h.html(),/提款 \/ 代付成功耗时/);assert.match(h.html(),/成功订单合计/);assert.match(h.html(),/所选创建范围 · 仍待付订单等待时长/);assert.match(h.html(),/本期仍代付中合计/);
});

test('hour by amount matrix preserves each band label and adds four totals and the ratio after the 24 hourly cells',async()=>{
 const h=await ready(),r=completeAggregate(P,10,3);h.L.results=[r];h.L.direction='charge';h.L.matrixMode='exact';h.c.state.page='matrix';h.c.render();
 const matrices=renderedTables(h.html()).filter(t=>t.headers[0]==='金额 / 时');assert.equal(matrices.length,1);const matrix=matrices[0];assert.equal(matrix.headers.length,27);assert.deepEqual(matrix.headers.slice(1,25),Array.from({length:24},(_,hour)=>String(hour).padStart(2,'0')+'时'));assert.deepEqual(matrix.headers.slice(25),['24小时合计','整段明细']);assert.equal(matrix.rows.length,10);assert.equal(new Set(matrix.rows.map(row=>plain(row[0]))).size,10);
 for(const row of matrix.rows){assert.equal(row.length,27);assert.doesNotMatch(row[0],/成功|金额合计|matrix-band-total/);for(const cell of row.slice(1,25)){assert.equal([...cell.matchAll(/class="matrix-cell analysis-matrix-cell"/g)].length,1);assert.equal([...cell.matchAll(/<b\b/g)].length,1);assert.equal([...cell.matchAll(/<span\b/g)].length,2)}}
 const row=matrix.rows.find(row=>plain(row[0])==='200'),known=row[13];assert.match(known,/>10笔<\/b>/);assert.match(known,/>1,000<\/span>/);assert.match(known,/>30\.00%<\/span>/);
 assert.deepEqual([...row[25].matchAll(/<small>([^<]+)<\/small><b>([^<]+)<\/b>/g)].map(m=>[m[1],m[2]]),[['全部笔数','10 笔'],['全部金额','1,000.00'],['成功笔数','3 笔'],['成功金额','300.00'],['成功率','30.00%']]);
 const footer=matrix.html.match(/<tfoot>([^]*?)<\/tfoot>/)?.[1];assert(footer);const customCells=[...footer.matchAll(/<td\b[^>]*>([^]*?)<\/td>/g)].map(m=>m[1]);assert.equal(customCells.length,27);assert.match(customCells[0],/自定义金额/);assert.match(customCells[25],/matrix-row-total/);assert.match(h.html(),/aria-label="自定义金额区间"/);
});

test('matrix 24-hour totals preserve direction, currency, missing fields and daily aggregate completeness',async()=>{
 const h=await ready({adaptive:true}),r=completeAggregate(P,100,1),s=r.summary[0];
 r.groups.matrix_range=[{...s,bucket:'band:0',hour:0,success_count:2,success_amount:'250.50'},{...s,bucket:'band:0',hour:23,success_count:3,success_amount:'499.75'},{...s,direction:'withdraw',bucket:'band:0',hour:12,success_count:99,success_amount:'99999'},{...s,bucket:'band:1',hour:12,success_count:7,success_amount:'1800'}];
 h.L.results=[r];h.L.direction='charge';h.L.matrixMode='range';h.L.amountBandProfiles={charge:{edges:[100,200,300,400,500,1000,2000,5000,10000,20000,50000]}};h.c.state.page='matrix';h.c.render();
 const first=()=>renderedTables(h.html()).find(t=>t.headers[0]==='金额 / 时').rows[0],totals=()=>Object.fromEntries([...first()[25].matchAll(/<small>([^<]+)<\/small><b>([^<]+)<\/b>/g)].map(m=>[m[1],m[2]]));
 assert.match(first()[0],/100 ≤ 金额 &lt; 200/);assert.doesNotMatch(first()[0],/成功|合计/);assert.deepEqual(totals(),{'全部笔数':'200 笔','全部金额':'20,000.00','成功笔数':'5 笔','成功金额':'750.25','成功率':'2.50%'});assert.match(first()[25],/所选日期范围内 00–23 时合计/);assert.match(first()[25],/金额单位 INR/);
 h.L.to='2026-09-24T23:59:59';r._parts=[{complete:true,groups:{matrix_range:[{...r.groups.matrix_range[0]}]}},{complete:true,groups:{matrix_range:[{...r.groups.matrix_range[1]}]}}];h.c.render();assert.equal(totals()['成功金额'],'750.25');
 r.hasMore=true;h.c.render();assert.equal(totals()['成功笔数'],'5 笔','detail pagination does not invalidate a complete aggregate');
 delete r._parts[1].groups.matrix_range[0].success_count;h.c.render();assert.equal(totals()['成功笔数'],'— 笔','original part fields remain unknown even if merged rows contain numeric totals');r._parts[1].groups.matrix_range[0].success_count=3;
 delete r._parts[1].groups.matrix_range;h.c.render();assert.deepEqual(totals(),{'全部笔数':'— 笔','全部金额':'—','成功笔数':'— 笔','成功金额':'—','成功率':'—'});delete r._parts;
 const validRows=r.groups.matrix_range.slice();r.groups.matrix_range.push(...[null,'',-1,24].map(hour=>({...s,bucket:'band:0',hour,all_count:900,all_amount:'90000',success_count:900,success_amount:'90000'})));h.c.render();assert.equal(totals()['全部笔数'],'200 笔');assert.equal(totals()['成功金额'],'750.25');r.groups.matrix_range=validRows;
 r.groups.matrix_range[1].currency='USD';h.c.render();assert.deepEqual(totals(),{'全部笔数':'200 笔','全部金额':'—','成功笔数':'5 笔','成功金额':'—','成功率':'2.50%'});
 r.groups.matrix_range[1].currency='INR';delete r.groups.matrix_range[1].all_count;r.groups.matrix_range[1].all_amount=null;delete r.groups.matrix_range[1].success_count;r.groups.matrix_range[1].success_amount=null;h.c.render();assert.deepEqual(totals(),{'全部笔数':'— 笔','全部金额':'—','成功笔数':'— 笔','成功金额':'—','成功率':'—'});
 r.groups.matrix_range=[];h.c.render();assert.deepEqual(totals(),{'全部笔数':'0 笔','全部金额':'0.00','成功笔数':'0 笔','成功金额':'0.00','成功率':'—'});
 delete r.groups.matrix_range;h.c.render();assert.deepEqual(totals(),{'全部笔数':'— 笔','全部金额':'—','成功笔数':'— 笔','成功金额':'—','成功率':'—'});
 r.groups.matrix_range=[];r.complete=false;h.c.render();assert.equal(totals()['成功笔数'],'— 笔');
 r.complete=true;h.L.queryWarnings=['Synthetic missing platform'];h.c.render();assert.match(first()[25],/部分平台已读取/);assert.match(first()[25],/部分已读/);
 h.L.direction='withdraw';r.withdrawSuccessTimeAvailable=false;h.c.render();assert.equal(totals()['成功笔数'],'— 笔');assert.equal(totals()['成功金额'],'—');
});

test('matrix custom interval queries independently and restores its footer without changing primary totals or bands',async()=>{
 const h=await ready({page:'matrix'}),main=completeAggregate(P,10,3),custom=completeAggregate(P,4,3);
 custom.groups.hourly=[{...custom.summary[0],hour:12,all_amount:'935.50',success_amount:'731.25'}];
 h.setHandler(q=>structuredClone(q.amountMin!==undefined?custom:main));setScope(h,{direction:'charge'});await h.c.liveQuery();await settle();
 assert.equal(h.L.pageQueried,true);assert.equal(h.L.dirty,false);assert.match(h.html(),/aria-label="自定义金额区间"/);
 const matrix=()=>renderedTables(h.html()).find(t=>t.headers[0]==='金额 / 时'),primary=()=>[...h.html().matchAll(/class="kpi-value">([^]*?)<\/div>/g)].map(m=>plain(m[1]));
 const fixedBefore=JSON.stringify(matrix().rows),primaryBefore=primary(),sourceBefore=JSON.stringify(h.L.results),callsBefore=h.calls.length;
 assert.equal(primaryBefore.length,6);h.c.liveMatrixAmountSet('min','115.25');h.c.liveMatrixAmountSet('max','360.50');await h.c.liveMatrixAmountQuery({reportValidity:()=>true});await settle();
 const requests=h.calls.slice(callsBefore).filter(q=>q.action==='aggregate');assert.equal(requests.length,1);assert.equal(requests[0].amountMin,115.25);assert.equal(requests[0].amountMax,360.5);assert.equal(requests[0].amountMaxExclusive,true);assert.equal(requests[0].platformId,P.id);assert.equal(requests[0].direction,'charge');assert.equal(requests[0].view,'full');assert.equal(requests[0].startAt,'2026-09-21T18:30:00.000Z');assert.equal(requests[0].endAt,'2026-09-22T00:30:00.000Z');
 assert.deepEqual(primary(),primaryBefore);assert.equal(JSON.stringify(matrix().rows),fixedBefore);assert.equal(JSON.stringify(h.L.results),sourceBefore);
 const footer=()=>matrix().html.match(/<tfoot>([^]*?)<\/tfoot>/)?.[1],footerBefore=footer(),cells=[...footerBefore.matchAll(/<td\b[^>]*>([^]*?)<\/td>/g)].map(m=>m[1]);
 assert.equal(cells.length,27);assert.match(cells[0],/115\.25 ≤ 金额 &lt; 360\.50/);assert.match(cells[13],/>4笔<\/b>/);assert.match(cells[13],/>935\.50<\/span>/);assert.match(cells[13],/>75\.00%<\/span>/);assert.deepEqual([...cells[25].matchAll(/<small>([^<]+)<\/small><b>([^<]+)<\/b>/g)].map(m=>[m[1],m[2]]),[['全部笔数','4 笔'],['全部金额','935.50'],['成功笔数','3 笔'],['成功金额','731.25'],['成功率','75.00%']]);
 const afterQuery=h.calls.length;h.c.setPage('amount');await settle();h.c.setPage('matrix');await settle();
 assert.equal(h.c.state.page,'matrix');assert.equal(h.calls.length,afterQuery,'restoring a page tab reuses the primary and independent interval results');assert.equal(footer(),footerBefore);assert.equal(JSON.stringify(matrix().rows),fixedBefore);assert.deepEqual(primary(),primaryBefore);assert.match(h.html(),/aria-label="自定义最低金额"[^>]*value="115\.25"/);assert.match(h.html(),/aria-label="自定义最高金额"[^>]*value="360\.50"/);
});

test('the matrix hides only the below-range row without moving its data or changing totals and other pages',async()=>{
 const h=await ready({adaptive:true}),r=completeAggregate(P,10,3),s=r.summary[0];
 const rows=[{...s,bucket:'below',hour:0,all_count:2,all_amount:'150',success_count:1,success_amount:'50'},{...s,bucket:'band:0',hour:0,all_count:8,all_amount:'850',success_count:2,success_amount:'250'},{...s,bucket:'above',hour:1,all_count:1,all_amount:'60000',success_count:0,success_amount:'0'}];
 r.groups.matrix_range=rows;r.groups.amount_range=rows.map(({hour,...row})=>row);h.L.results=[r];h.L.direction='charge';h.L.matrixMode='range';h.L.amountBandProfiles={charge:{edges:[100,200,300,400,500,1000,2000,5000,10000,20000,50000]}};h.c.state.page='matrix';const source=JSON.stringify(h.L.results),calls=h.calls.length;h.c.render();
 const matrix=renderedTables(h.html()).find(t=>t.headers[0]==='金额 / 时');assert.equal(matrix.rows.length,11,'ten fixed bands plus the separately retained above row');assert(!matrix.rows.some(row=>/class="matrix-band-label">&lt; 100</.test(row[0])));
 const first=matrix.rows.find(row=>/100 ≤ 金额 &lt; 200/.test(row[0]));assert.match(first[1],/>8笔<\/b>/);assert.match(first[25],/成功率<\/small><b>25\.00%/);assert.doesNotMatch(first[25],/>10 笔<\/b>/);assert.match(h.html(),/1,000\.00/,'main total still contains below-range data');
 h.c.state.page='amount';h.c.render();assert.match(h.html(),/>&lt; 100<\/td>/,'amount distribution retains the below-range data');assert.equal(JSON.stringify(h.L.results),source);assert.equal(h.calls.length,calls);
});

test('rejected and unknown statuses remain explicit in the reference direction analysis',async()=>{
 const h=await ready(),r=completeAggregate(P,10,3);r.summary=[{...r.summary[0],direction:'withdraw',all_amount:null,pending_count:2,pending_amount:'200',failed_count:1,failed_amount:'100',rejected_count:2,rejected_amount:'240',unknown_count:2,unknown_amount:null,missing_amount_count:1}];h.L.direction='withdraw';h.L.results=[r];h.L.comparisonStatus='idle';h.c.state.page='payout';h.L.view='trend';h.c.render();const table=renderedTables(h.html()).find(t=>t.headers.join('|')==='状态|金额|笔数');assert(table);assert.deepEqual(table.rows.find(r=>plain(r[0])==='拒绝').map(plain),['拒绝','240.00','2']);assert.deepEqual(table.rows.find(r=>plain(r[0])==='未知').map(plain),['未知','—','2']);assert.doesNotMatch(h.html(),/NaN|Infinity/);
});

test('catalog scopes country/source/platform without a currency selector and query local seconds correctly',async()=>{
 const nepal={...P,id:'22222222-2222-4222-8222-222222222222',timezone:'Asia/Kathmandu',source:'NEW_AR'},usd={...P,id:'33333333-3333-4333-8333-333333333333',currency:'USD',country:'美国',timezone:'America/New_York'};
 const h=await ready({platforms:[P,nepal,usd]});assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/liveSet\('currency'/);setScope(h,{platform:'all',source:'NEW_AR',direction:'withdraw',status:'pending',provider:'P/Raw',orderNumber:'O/1',memberId:'M1',systemOrderId:'S1'});const before=h.calls.length;await h.c.liveQuery();const q=h.calls.slice(before).filter(q=>q.action==='aggregate');assert.equal(q.length,2);assert.equal(q[0].platformId,nepal.id);assert.equal(q[0].startAt,'2026-09-21T18:15:00.000Z');assert.equal(q[0].endAt,'2026-09-22T00:15:00.000Z');assert.equal(q[0].direction,'withdraw');assert.equal(q[0].status,'pending');assert.equal(q[0].providers[0],'P/Raw');assert.equal(q[0].orderNumber,'O/1');assert.equal(q[0].memberId,'M1');assert.equal(q[0].systemOrderId,'S1');assert.equal(q[0].currency,'INR');assert.deepEqual(withoutWindow(q[1]),withoutWindow(q[0]));
 h.c.liveSet('platform',P.id);h.c.liveSet('country','美国');assert.equal(h.L.platform,'all');assert.equal(h.L.page,1);assert.equal(h.L.localPage,1);
});

test('removing the currency selector keeps each platform query on its own currency',async()=>{
 const usd={...P,id:'44444444-4444-4444-8444-444444444444',currency:'USD',country:'美国',timezone:'America/New_York'};
 const h=await ready({platforms:[P,usd]});assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/币种/);setScope(h,{platform:'all',source:'all'});const before=h.calls.length;await h.c.liveQuery();const currencies=new Set(h.calls.slice(before).filter(q=>q.action==='aggregate').map(q=>q.currency));assert.deepEqual([...currencies],['INR']);h.c.liveSet('country','美国');const next=h.calls.length;await h.c.liveQuery();assert.deepEqual([...new Set(h.calls.slice(next).filter(q=>q.action==='aggregate').map(q=>q.currency))],['USD']);h.c.liveSet('country','all');assert.equal(h.L.country,'美国','country remains a required single choice');
});

test('invalid calendar/DST ambiguous or missing local seconds never become plausible timestamps',async()=>{
 for(const [zone,from,to] of [['Asia/Kolkata','2026-02-30T00:00:00','2026-03-01T00:00:00'],['America/New_York','2026-03-08T02:30:00','2026-03-08T03:30:00'],['America/New_York','2026-11-01T01:30:00','2026-11-01T03:30:00'],['Asia/Kolkata','2026-09-01T00:00:00','2026-10-02T23:59:59']]){const h=await ready({platforms:[{...P,timezone:zone}]});setScope(h,{from,to});const n=h.calls.length;await h.c.liveQuery();assert.equal(h.calls.length,n);assert(h.L.error);assert.equal(h.L.results.length,0)}
});

test('money strings aggregate and unknown amounts remain unknown rather than fabricated zero',async()=>{
 const h=await ready();const a=aggregate(),b=aggregate();b.platform={...P,id:'second'};b.summary[0].all_amount=null;b.summary[0].missing_amount_count=1;h.L.results=[a,b];h.c.state.page='merchantproviders';h.c.render();const section=h.html().match(/<section class="live-reference-direction" data-direction="charge"[^>]*>([^]*?)<\/section>/)?.[1];assert(section);assert.match(section,/data-metric="all"[^]*?class="kpi-value">—<\/div>[^]*?>10 笔<\/span>/);assert.match(section,/data-metric="success"[^]*?class="kpi-value">1,200\.30<\/div>[^]*?>6 笔<\/span>/);assert.doesNotMatch(h.html(),/NaN|Infinity/);
});

test('partial platform results stay labeled and cannot masquerade as complete totals after a failure',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222'},h=await ready({platforms:[P,p2]});setScope(h,{platform:'all'});h.setHandler(async q=>{if(q.platformId===p2.id)throw Error('Synthetic failure');return aggregate(P)});await h.c.liveQuery();assert.equal(h.L.results.length,1);assert.match(h.html(),/Synthetic failure/);assert.match(h.html(),/以下仅为已读取结果/);assert.equal(h.L.comparisonStatus,'error');
});

test('later aggregate query wins over an earlier request regardless of completion order',async()=>{
 const h=await ready(),old=deferred(),fresh=deferred();let n=0;h.setHandler(()=>++n===1?old.promise:fresh.promise);const a=h.c.liveQuery();h.c.liveSet('provider','New scope');const b=h.c.liveQuery();fresh.resolve(aggregate(P,22));await b;old.resolve(aggregate(P,11));await a;assert.equal(h.L.results[0].total,22);assert.equal(h.L.loading,false);
});

test('editing filters invalidates outstanding aggregate results and leaves explicit query state',async()=>{
 const h=await ready(),wait=deferred();h.setHandler(()=>wait.promise);const pending=h.c.liveQuery();h.c.liveSet('provider','new-provider');wait.resolve(aggregate(P,91));await pending;assert.equal(h.L.dirty,true);assert.equal(h.L.results.length,0,'old-scope results must never be committed after a filter edit');assert.match(h.html(),/点击查询/);
});

test('switching to the independent deposit page prevents old aggregate progress/results overwrites',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222'},h=await ready({platforms:[P,p2]}),first=deferred(),second=deferred();let n=0;setScope(h,{platform:'all'});h.setHandler(q=>q.action==='depositIssues'?Promise.resolve({rows:[],total:0,summary:{},facets:{providers:[]}}):(++n===1?first.promise:second.promise));const pending=h.c.liveQuery();h.c.setPage('deposit_tracking');const mark=h.writes.length;first.resolve(aggregate(P));await settle();assert.match(h.html(),/点击查询/);assert.doesNotMatch(h.html(),/INDEPENDENT_SNAPSHOT/);second.resolve(aggregate(p2));await pending;assert(h.writes.slice(mark).filter(x=>x.id==='page').every(x=>!x.html.includes('正式数据读取')));
});

test('old detail responses cannot reappear after a new aggregate scope begins',async()=>{
 const h=await ready();setScope(h,{platform:P.id});h.c.state.page='orders';const old=deferred(),next=deferred();h.setHandler(q=>q.action==='details'?old.promise:next.promise);const a=h.c.liveDetails();h.c.liveSet('orderNumber','different-order');const b=h.c.liveQuery();old.resolve(detail(P,65));await a;assert.equal(h.L.detail,null,'previous order filter rows cannot reappear during the new aggregate request');next.resolve(aggregate());await settle();old.resolve(detail());await b;
});

test('server paging keeps exact IDs, default 20 and all requested page sizes without client totals',async()=>{
 const h=await ready();setScope(h,{platform:P.id});h.c.state.page='orders';await h.c.liveQuery();assert.equal(h.L.size,20);assert.equal(h.L.detail.rows.length,20);assert.match(h.html(),/共 <b>65<\/b> 条/);h.c.livePage(2,'server');await settle();assert.equal(h.calls.at(-1).offset,20);assert.equal(h.L.detail.rows[0].id,'row-20');assert.equal(h.L.detail.rows.at(-1).id,'row-39');for(const size of [30,50,100,500]){h.c.livePageSize(String(size),'server');await settle();assert.equal(h.L.page,1);assert.equal(h.calls.at(-1).limit,size);assert.equal(h.calls.at(-1).offset,0)}assert.match(h.html(),/首页/);assert.match(h.html(),/上一页/);assert.match(h.html(),/下一页/);assert.match(h.html(),/尾页|末页/);assert.match(h.html(),/跳转页码/);
});

test('out-of-range server page clamps to the available last page, including an empty result',async()=>{
 const h=await ready();setScope(h,{platform:P.id});h.c.state.page='orders';await h.c.liveQuery();h.c.livePage(999,'server');await settle();assert.equal(h.L.page,4);assert.equal(h.L.detail.rows.length,5);h.setHandler(q=>detail(P,0,q.offset,q.limit));h.c.livePage(4,'server');await settle();assert.equal(h.L.page,1);assert.equal(h.L.detail.rows.length,0);assert(!h.html().includes('NaN'));
});

test('detail contract uses canonical status and third-party order number, escaping untrusted fields',async()=>{
 const h=await ready();setScope(h,{platform:P.id});h.c.state.page='orders';const d=detail(P,1);d.rows[0].third_party_order_number='THIRD/KEEP';d.rows[0].provider='<img src=x onerror=alert(1)>';d.rows[0].order_number='O/RAW';h.L.detail=d;h.c.render();assert.match(h.html(),/O\/RAW/);assert.match(h.html(),/>成功<\/span>/);assert(!h.html().includes('<img'));assert(h.html().includes('&lt;img'));h.c.liveOrder(0);assert(h.drawers[0].html.includes('O/RAW'));assert(h.drawers[0].html.includes('THIRD/KEEP'));assert(h.drawers[0].html.includes('member-0'));assert(!h.drawers[0].html.includes('<img'));
});

test('orders preserve business, fee basis and historical rate tabs without changing the exact result set',async()=>{
 const h=await ready();setScope(h,{platform:P.id});h.c.state.page='orders';await h.c.liveQuery();const ids=Array.from(h.L.detail.rows,r=>r.id),calls=h.calls.length;
 for(const [view,required]of [['business',['订单号','系统 ID','平台','团队','国家','三方','方向','订单金额','状态','核对标记','创建时间','操作']],['orderFees',['订单号','系统 ID','平台','团队','三方','方向','订单金额','实际手续费']],['orderRates',['订单号','系统 ID','平台','三方','方向','百分比费率','固定费']]]){h.c.liveReferenceSet('view',view);const html=h.html();for(const label of ['业务明细','费用依据','费率版本'])assert(html.includes(label),view+' retains tab '+label);const headers=renderedTables(html).flatMap(t=>t.headers);for(const field of required)assert(headers.includes(field),view+' retains '+field);if(view==='orderFees')assert(headers.some(x=>/手续费|费用/.test(x)), 'fee tab has fee columns');if(view==='orderRates'){assert(headers.some(x=>/版本/.test(x)),'rate tab has version column');assert(headers.some(x=>/生效/.test(x)),'rate tab has effective time column')}assert.equal(h.calls.length,calls,'tab switch reuses the exact authorized page');assert.deepEqual(Array.from(h.L.detail.rows,r=>r.id),ids);assert.match(html,/共 <b>65<\/b> 条/);for(const t of renderedTables(html))for(const row of t.rows)assert.equal(row.length,t.headers.length,view+' header/body field counts')}h.c.liveOrder(0);const drawer=h.drawers.at(-1).html;for(const field of ['订单号','系统 ID','三方订单号','会员 ID','平台','团队','国家','三方','方向'])assert(drawer.includes(field),field+' remains independently identified in the drawer');for(const value of ['order-0','source-0','third-0','member-0'])assert(drawer.includes(value),'exact original identifier '+value+' survives all views');
});

test('successful orders show the completion column first while all-order views retain creation time first',async()=>{
 const h=await ready();setScope(h,{platform:P.id});h.c.state.page='orders';h.L.detail=detail(P,1);
 for(const status of ['all','success']){
  h.L.status=status;h.c.render();const t=renderedTables(h.html()).find(t=>t.headers[0]==='订单号');assert(t);
  const created=t.headers.indexOf('创建时间'),completed=t.headers.indexOf('成功时间');assert(created>=0&&completed>=0);
  assert.equal(completed<created,status==='success');assert.notEqual(t.rows[0][created],t.rows[0][completed]);
  assert.match(h.html(),/成功订单按成功时间；全部拉单按创建时间/);
 }
});

test('explicit cache queries reuse recent matching aggregates without mixing directions, but explicit queries and expired or changed scopes reread',async()=>{
 const h=await ready();h.L.overviewAnalysis=true;setScope(h,{platform:P.id,direction:'all'});h.c.state.page='overview';
 h.setHandler(async q=>{const r=aggregate(P,5),w={...stats(2,'400'),direction:'withdraw'};r.summary.push(w);for(const key of Object.keys(r.groups))if(r.groups[key].length)r.groups[key].push({...r.groups[key][0],...w});r.summary=r.summary.filter(row=>q.direction==='all'||row.direction===q.direction);for(const key of Object.keys(r.groups))r.groups[key]=r.groups[key].filter(row=>q.direction==='all'||row.direction===q.direction);r.total=r.summary.reduce((n,row)=>n+row.all_count,0);return r});
 const countReads=()=>h.calls.filter(q=>q.action==='aggregate').length;
 await h.c.liveQuery();const initial=countReads();assert.equal(h.L.results[0].total,7);
 h.c.setPage('providers');await settle();await h.c.liveQuery(false);await settle();assert.equal(countReads(),initial);assert.equal(h.L.results[0].total,5);assert(h.L.results[0].summary.every(r=>r.direction==='charge'));assert.equal(h.L.comparisonStatus,'ready');
 h.c.setPage('payout');await settle();await h.c.liveQuery(false);await settle();assert.equal(countReads(),initial);assert.equal(h.L.results[0].total,2);assert(h.L.results[0].summary.every(r=>r.direction==='withdraw'));assert.equal(h.L.comparisonResults[0].total,2);
 await h.c.liveQuery();assert.equal(countReads(),initial+2,'manual query rereads both dates');
 h.setNow('2026-09-23T12:01:01Z');await h.c.liveQuery(false);assert.equal(countReads(),initial+4,'navigation cache expires after one minute');
 h.L.provider='Another Provider';h.L.multi.provider=['Another Provider'];await h.c.liveQuery(false);assert.equal(countReads(),initial+6,'provider scope cannot reuse broader totals');
 h.L.currency='USD';h.L.catalog[0]={...h.L.catalog[0],currency:'USD'};await h.c.liveQuery(false);assert.equal(countReads(),initial+8,'currency scopes stay separate');
});

test('manual cached queries keep completion-cohort totals when narrowing a successful-order result by direction',async()=>{
 const h=await ready();setScope(h,{platform:P.id,direction:'all',status:'success'});h.c.state.page='overview';
 h.setHandler(async()=>{const r=aggregate(P,5);r.summary=[{...r.summary[0],success_count:7},{...stats(9),direction:'withdraw',success_count:2}];r.total=9;return r});
 await h.c.liveQuery();const reads=h.calls.filter(q=>q.action==='aggregate').length;
 h.c.setPage('providers');await settle();await h.c.liveQuery(false);await settle();assert.equal(h.calls.filter(q=>q.action==='aggregate').length,reads);
 assert.equal(h.L.results[0].total,7);assert.equal(h.L.results[0]._parts[0].total,7);assert.equal(h.L.comparisonResults[0].total,7);
 h.c.setPage('payout');await settle();await h.c.liveQuery(false);await settle();assert.equal(h.L.results[0].total,2);assert.equal(h.L.results[0]._parts[0].total,2);
});

test('unconnected modules preserve reference schemas and local controls without inventing source rows or queries',async()=>{
 const h=await ready(),calls=h.calls.length,expected={rules:['最低订单量','超期账龄','数据不足处理','多项命中处理'],ip:['IP / CIDR','适用入口','适用账号','状态'],login_logs:['账号','登录时间','IP','登录结果','白名单结果','会话状态'],operation_logs:['操作者','操作时间','动作','资源','请求 ID']};
 for(const [page,fields]of Object.entries(expected)){h.c.setPage(page);const html=h.html();assert(html.includes('data-empty-page="'+page+'"'),page);assert.match(html,/未接入/);assert.match(html,/data-empty-field=/);const tables=renderedTables(html),headers=tables.flatMap(t=>t.headers);for(const field of fields)assert(headers.includes(field),page+' preserves '+field);for(const table of tables){assert.equal(table.rows.length,1,page+' only shows the empty row');assert.equal(table.rows[0].length,1,page+' does not fabricate records');assert.match(table.rows[0][0],/未接入/);assert(table.html.includes('colspan="'+table.headers.length+'"'),page+' empty row spans schema')}assert.doesNotMatch(html,/Synthetic provider|order-0|row-0|NaN|Infinity/);assert.equal(h.calls.length,calls,page+' does not query an unrelated order dataset')}
 const empty=h.c.HensemLiveEmpty;const workorders=empty.tab('workorders','orders');for(const field of ['工单 ID','订单号','平台','三方','提交时间／日期','到账确认时间','工单金额','到账状态'])assert(renderedTables(workorders).some(t=>t.headers.includes(field)),field);const access=empty.render('access');assert.match(access,/data-account-workspace/);assert.match(access,/正在读取账号页面/);assert.doesNotMatch(access,/<table|管理后台账号|管理工单账号|data-account-entries|账号数量|保存权限|团队分析员/);empty.search('events',{eventId:'SYNTHETIC-FILTER'});assert.equal(empty.snapshot('events').applied.eventId,'SYNTHETIC-FILTER');assert.equal(empty.snapshot('events').page,1);assert.equal(h.calls.length,calls);
});

test('provider callback keeps quotes and slashes as a single literal value, never executable markup',async()=>{
 const h=await ready(),name='Raw/Pay\'\"<svg onload=alert(1)>';h.L.results[0].groups.provider[0].provider=name;h.c.state.page='merchantproviders';h.c.render();const html=h.html();assert(!html.includes('<svg onload'));const attr=html.match(/onclick="(liveProviderOrders\([^]*?\))"/);assert(attr);const decoded=attr[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');let value;vm.runInNewContext(decoded,{liveProviderOrders:v=>value=v});assert.equal(value,name);
});

test('duration bins use contract valid denominators and human time ranges instead of bucket indexes',async()=>{
 const h=await ready();h.c.state.page='latency';h.L.results[0].durationVersion=2;h.L.results[0].groups.latency=[{kind:'latency',direction:'charge',currency:'INR',bucket:0,min_ms:null,max_ms:60000,count:2,amount:'100',valid_count:4,valid_amount:'200',count_share:'0.5',amount_share:'0.5'}];h.c.render();assert.match(h.html(),/50\.00%/);assert.match(h.html(),/5\s*分钟|5min|5分/);assert(!h.html().includes('NaN'));
});

test('restored latency page uses real direction cards, complete distributions and local detail tabs without a query',async()=>{
 const h=await ready(),r=completeAggregate(P,10,6),withdraw={...r.summary[0],direction:'withdraw'};r.durationVersion=2;r.summary.push(withdraw);r.groups.latency=['charge','withdraw'].flatMap(direction=>Array.from({length:12},(_,bucket)=>({direction,currency:'INR',bucket,count:bucket<2?2:0,amount:bucket<2?'200':'0',valid_count:4,valid_amount:'400'})));r.groups.latency_thresholds=['charge','withdraw'].flatMap(direction=>[60000,180000,300000,1800000,3600000,10800000,21600000,43200000,86400000,172800000,259200000].map((threshold_ms,bucket)=>({direction,currency:'INR',bucket,threshold_ms,count:bucket===0?2:0,amount:bucket===0?'200':'0',valid_count:4,valid_amount:'400'})));h.L.results=[r];h.c.state.page='latency';h.c.render();assert.match(h.html(),/data-duration-page="latency"/);assert.equal([...h.html().matchAll(/class="panel latency-summary"/g)].length,1);assert.equal(h.L.direction,'charge');assert.doesNotMatch(h.html(),/data-duration-direction="withdraw"/);const t=renderedTables(h.html()).find(t=>t.headers[0]==='成功耗时区间');assert(t);assert.equal(t.rows.length,12);assert.equal(t.headers.length,6);assert.equal(t.headers.at(-1),'明细');assert(t.rows.every(row=>plain(row.at(-1))==='三方展开 平台展开'));assert.match(t.rows[0].at(-1),/aria-expanded="false"/);assert.deepEqual(t.rows[0].slice(0,-1).map(plain),['≤ 60 秒','200.00','2','50.00%','50.00%']);
 const before={calls:h.calls.length,serial:h.L.serial,results:JSON.stringify(h.L.results),direction:h.L.direction,from:h.L.from,to:h.L.to};h.c.liveDurationSet('durationMode','cumulative');const cumulative=renderedTables(h.html()).find(t=>t.headers[0]==='成功耗时阈值');assert.equal(cumulative.rows.length,11);assert.equal(cumulative.headers.length,6);assert.equal(cumulative.headers.at(-1),'明细');assert.deepEqual(cumulative.rows[0].slice(0,-1).map(plain),['超过 60 秒','200.00','2','50.00%','50.00%']);assert(cumulative.rows.every(row=>plain(row.at(-1))==='三方展开 平台展开'));assert.match(h.html(),/行间不相加/);h.c.liveDurationSet('durationGroup','platform');assert.match(h.html(),/点击“平台展开”/);const expand=[...h.html().matchAll(/onclick="([^"]+)"[^>]*>平台展开<\/button>/g)].at(-1);assert(expand);vm.runInNewContext(expand[1],{liveAnalysisAction:h.c.liveAnalysisAction});const groups=renderedTables(h.html()).find(t=>t.headers[0]==='平台');assert(groups);assert(groups.rows.length>0);assert.doesNotMatch(h.html(),/此处独立平台分组汇总尚未接入/);h.c.liveDurationSet('durationDetail','orders');const orders=renderedTables(h.html()).find(t=>t.headers[0]==='订单号');assert(orders);assert.equal(orders.rows.length,0);for(const header of ['系统 ID','平台','三方','方向','提交时间','成功时间','成功耗时'])assert(orders.headers.includes(header));assert.match(h.html(),/尚未提供对应时长条件的逐笔接口/);assert.deepEqual({calls:h.calls.length,serial:h.L.serial,results:JSON.stringify(h.L.results),direction:h.L.direction,from:h.L.from,to:h.L.to},before,'duration tabs only change local presentation');
});

test('stuck reads daily snapshots without generic order-cohort aggregates or durations',async()=>{
 const h=await ready({page:'stuck'});assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);assert.equal(h.calls.filter(q=>q.action==='pendingAnalysis').length,1);assert.match(h.html(),/data-pending-analysis="ready"/);assert.doesNotMatch(h.html(),/本期仍代付中合计|data-duration-page="stuck"/);
});

test('restored duration empty and missing-time states retain layouts without false zero success or quantiles',async()=>{
 const h=await ready();h.L.results=[];for(const page of ['latency']){h.c.state.page=page;h.L.direction='all';h.c.render();assert(h.html().includes('data-duration-page="'+page+'"'));assert.doesNotMatch(h.html(),/NaN|Infinity|>0\.00%/);const t=renderedTables(h.html()).find(t=>/^成功耗时|已等待/.test(t.headers[0]));assert.equal(t.rows.length,12)}
 const r=completeAggregate(P,10,6);r.groups.latency=[];r.latencySummary=[];h.L.results=[r];h.L.direction='charge';h.c.state.page='latency';h.c.render();assert.match(h.html(),/成功 6 笔/);assert.match(h.html(),/— 时间覆盖/);assert.match(h.html(),/<span>P95 耗时<\/span><strong>—<\/strong>/);const t=renderedTables(h.html()).find(t=>t.headers[0]==='成功耗时区间');assert.equal(t.headers.at(-1),'明细');assert.equal(t.headers.length,6);assert(t.rows.every(row=>row.slice(1,-1).every(cell=>plain(cell)==='—')));assert(t.rows.every(row=>plain(row.at(-1))==='三方展开 平台展开'));assert.doesNotMatch(h.html(),/0\.00%|NaN|Infinity/);
});

test('split date and second-precision time inputs preserve the unchanged half-open request contract',async()=>{
 const h=await ready();const filters=h.nodes.get('liveFilters').innerHTML;for(const label of ['起始日期','截止日期','起始时间（含秒）','截止时间（含秒）'])assert(filters.includes('aria-label="'+label+'"'));assert.equal([...filters.matchAll(/type="date"/g)].length,2);assert.equal([...filters.matchAll(/type="time" step="1"/g)].length,2);const before=h.calls.length;h.c.liveDateSet('from','date','2026-09-22');h.c.liveDateSet('from','time','01:02:03');h.c.liveDateSet('to','date','2026-09-22');h.c.liveDateSet('to','time','04:05:06');assert.equal(h.calls.length,before,'date editing waits for query');assert.equal(h.L.from,'2026-09-22T01:02:03');assert.equal(h.L.to,'2026-09-22T04:05:06');await h.c.liveQuery();const q=h.calls.slice(before).find(q=>q.action==='aggregate');assert.equal(q.startAt,'2026-09-21T19:32:03.000Z');assert.equal(q.endAt,'2026-09-21T22:35:07.000Z');
});

test('automatic-payout configuration stays in the merchant center after workorders move out',async()=>{
 const h=await ready(),merchant=h.c.navGroupsV3.find(g=>g[0]==='merchant');assert(merchant);assert.equal(h.c.pages.filter(p=>p[0]==='payout_config').length,1);assert.deepEqual(Array.from(merchant[3]),['merchants','merchantproviders','payout_config','auto_withdraw','withdraw_operators']);assert.equal(h.c.groupForV3('payout_config')[0],'merchant');assert(!h.c.navGroupsV3.find(g=>g[0]==='analysis')[3].includes('payout_config'));const before=h.calls.length;h.c.setPage('payout_config');await settle();await h.c.liveQuery();await settle();const requests=h.calls.slice(before);assert.equal(requests.length,12);assert.equal(requests.filter(q=>q.operation==='index').length,6);assert.equal(requests.filter(q=>q.operation==='snapshot').length,6);assert.equal(h.c.state.navGroup,'merchant');assert.match(h.nodes.get('nav').innerHTML,/自动出款配置/);assert.match(h.html(),/class="live-payout-config"/);assert.match(h.html(),/SYNTHETIC_CONFIG_PLATFORM/);assert.match(h.html(),/原后台配置 · 只读同步/);assert.match(h.html(),/否（只读）/);assert.match(h.html(),/>0<\/span>/);assert.doesNotMatch(h.html(),/<(?:button|input)[^>]*>保存|onclick="[^"]*(?:save|update|delete)/);assert.equal(h.nodes.get('liveFilters').style.display,'none');
});

test('configuration route and refresh use only exact read-only index/snapshot requests despite dirty order filters',async()=>{
 const h=await ready();h.c.liveSet('orderNumber','SYNTHETIC_STALE_ORDER_QUERY');const before=h.calls.length,originalResults=JSON.stringify(h.L.results);h.c.setPage('payout_config');await settle();await h.c.liveQuery();const requests=h.calls.slice(before);assert.equal(requests.length,12);for(const q of requests){assert.equal(q.action,'payoutConfig');assert(['index','snapshot'].includes(q.operation));assert(!('startAt' in q));assert(!('orderNumber' in q));assert(!('direction' in q));assert(!('currency' in q));if(q.operation==='snapshot')assert.deepEqual(Object.keys(q).sort(),['action','country','operation','platform','system'])}assert.equal(h.L.results.length,0);assert.match(h.html(),/当前保存值/);assert.doesNotMatch(h.html(),/筛选条件已修改/);const direct=await ready({page:'payout_config'});assert.equal(direct.calls.filter(q=>q.action==='catalog').length,1);assert.equal(direct.calls.filter(q=>['aggregate','details','rates'].includes(q.action)).length,0);assert.equal(direct.calls.filter(q=>q.action==='payoutConfig'&&q.operation==='index').length,6);assert.equal(direct.calls.filter(q=>q.action==='payoutConfig'&&q.operation==='snapshot').length,6);assert.equal(direct.c.HensemLivePayoutConfig.state().snapshotStatus,'ready');h.c.setPage('overview');await settle();assert.equal(JSON.stringify(h.L.results),originalResults);
});

test('configuration permission failures clear the displayed snapshot and never fall back to order data',async()=>{
 const h=await ready({page:'payout_config'});assert.match(h.html(),/SYNTHETIC_CONFIG_PLATFORM/);const before=h.calls.length;h.setHandler(async q=>{assert.equal(q.action,'payoutConfig');throw Error('403 permission denied')});await h.c.liveQuery();assert.match(h.html(),/授权已失效/);assert.doesNotMatch(h.html(),/SYNTHETIC_CONFIG_PLATFORM|否（只读）/);assert.equal(h.calls.length,before+3);assert.equal(h.c.HensemLivePayoutConfig.state().indexStatus,'error');
});

test('later forced fee query wins over stale requests',async()=>{
 const h=await ready(),old=deferred(),fresh=deferred();h.c.state.page='rates';let n=0;h.setHandler(()=>++n===1?old.promise:fresh.promise);const a=h.c.liveRates(true),b=h.c.liveRates(true);fresh.resolve({rows:[],total:22,options:{countries:[],platforms:[],providers:[]}});await b;old.resolve({rows:[],total:11,options:{countries:[],platforms:[],providers:[]}});await a;assert.equal(h.L.fees.total,22);
});

test('late sibling completion keeps the failed platform warning alongside the successful result',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222'},h=await ready({platforms:[P,p2]}),late=deferred();
 h.setHandler(q=>q.platformId===P.id?Promise.reject(Error('Synthetic failure')):late.promise);
 const run=h.c.liveQuery();await settle();assert.equal(h.L.queryWarnings.length,1);late.resolve(aggregate(p2,8));await run;
 assert.equal(h.L.results.length,1);assert.match(h.html(),/Synthetic failure/);assert.match(h.html(),/仅为已读取结果/);
});

test('direct collection/payout/stuck entry starts in its explicit business direction',async()=>{
 for(const [page,direction]of[['collection','charge'],['payout','withdraw'],['stuck','withdraw']]){const h=await ready({page});assert.equal(h.L.direction,direction);assert(h.calls.filter(q=>q.action==='aggregate').every(q=>q.direction===direction));}
});

test('independent configuration gap remains readable without querying changed order filters',async()=>{
 const h=await ready();h.c.state.page='orders';h.c.liveSet('orderNumber','different');h.c.setPage('access');assert.match(h.html(),/data-account-workspace/);assert(!h.html().includes('筛选条件已修改'));
});

test('rates preserve complex raw text and nulls; filtering keeps the agreed independent request fields',async()=>{
 const h=await ready();h.c.state.page='rates';h.L.feeScope='platform';h.L.feeCountry='india';h.L.feeQuery='Raw/Pay';h.L.feePage=2;h.L.feeSize=30;
 const row={id:'rate-synthetic',scopeType:'platform',provider:'Raw/Pay<img onerror=alert(1)>',country:'印度',scopeGroup:'india',platform:'PLATFORM/A',collectFee:'100–200: 4%; 201+: 3.5%',payoutFee:'0..8%',collectSingleFee:null,payoutSingleFee:'0',collectLimit:'100/200',payoutLimit:null,status:'启用',updatedAt:'2026-09-22T00:00:00Z'};
 h.setHandler(async q=>({rows:[row],total:65,offset:q.offset,limit:q.limit,options:{countries:[{value:'india',label:'印度'}],platforms:[],providers:['Raw/Pay']}}));await h.c.liveRates(true);const request=h.calls.at(-1);assert.equal(request.action,'rates');assert.equal(request.scopeType,'platform');assert.equal(request.country,'india');assert.equal(request.query,'Raw/Pay');assert.equal(request.offset,30);assert.equal(request.limit,30);assert(h.html().includes('100–200: 4%; 201+: 3.5%'));assert(h.html().includes('0..8%'));assert(h.html().includes('100/200'));assert(!h.html().includes('<img'));assert(h.html().includes('—'));
});

test('all menu pages can render with an empty authorized catalog without NaN or fabricated rows',async()=>{
 const h=await ready({platforms:[]});for(const [key]of h.c.pages){h.c.setPage(key);await settle();assert(!h.html().includes('NaN'),key);assert(!h.html().includes('Infinity'),key);assert.equal(h.L.results.length,0,key)}assert.equal(h.calls.filter(q=>q.action==='aggregate'||q.action==='details').length,0);
});

test('current-page CSV export escapes formulas and quotes from untrusted cells',async()=>{
 const h=await ready();h.nodes.get('page').querySelectorAll=()=>[{querySelectorAll:()=>[{cells:[{innerText:'订单号'},{innerText:'金额'}]},{cells:[{innerText:'=HYPERLINK("bad")'},{innerText:'200.00'}]},{cells:[{innerText:'@formula'},{innerText:'Raw/Pay'}]}]}];h.c.liveExport();assert.equal(h.blobs.length,1);const csv=await h.blobs[0].text();assert(csv.includes('"\'=HYPERLINK(""bad"")"'));assert(csv.includes('"\'@formula"'));assert(csv.includes('"Raw/Pay"'));assert(csv.includes('"200.00"'));
});

test('aggregate queries use the full interval and bisect only after a timeout',async()=>{
 const h=await ready();setScope(h,{platform:P.id,from:'2026-09-20T12:34:56',to:'2026-09-21T00:34:55'});const attempts=[],accepted=[];
 h.setHandler(async q=>{attempts.push(q);const width=Date.parse(q.endAt)-Date.parse(q.startAt);if(width>6*3600000)throw Error('Synthetic timeout');accepted.push(q);return aggregate(P,10)});
 await h.c.liveQuery();assert.equal(h.L.error,'');assert.equal(attempts.length,6);assert.equal(accepted.length,4);assert.equal(attempts[0].startAt,'2026-09-20T07:04:56.000Z');assert.equal(Date.parse(attempts[0].endAt)-Date.parse(attempts[0].startAt),12*3600000);assert(accepted.every(q=>{const width=Date.parse(q.endAt)-Date.parse(q.startAt);return width>5*3600000&&width<=6*3600000}));for(const period of [accepted.slice(0,2),accepted.slice(2)]){assert.equal(period.length,2);assert.equal(period[0].endAt,period[1].startAt)}
 const merged=h.L.results[0];assert.equal(merged._parts.length,2);assert.equal(merged.total,20);assert.equal(merged.summary[0].all_count,20);assert.equal(h.L.comparisonResults[0]._parts.length,2);assert.equal(merged.startAt,accepted[0].startAt);assert.equal(merged.endAt,accepted[1].endAt);assert.equal(h.L.comparisonResults[0].endAt,accepted[3].endAt);
});

test('full analysis timeout bisection covers the exact interval and stops retrying at or below the one-hour threshold',async()=>{
 const h=await ready({page:'time'});setScope(h,{platform:P.id});const accepted=[],attempts=[];h.setHandler(async q=>{attempts.push(q);if(Date.parse(q.endAt)-Date.parse(q.startAt)>1.5*3600000)throw Error('Synthetic timeout');accepted.push(q);return aggregate(P,5)});await h.c.liveQuery();assert.equal(h.L.error,'');assert.equal(attempts.length,14);assert.equal(accepted.length,8);assert(accepted.every(q=>Date.parse(q.endAt)-Date.parse(q.startAt)===1.5*3600000));for(const period of [accepted.slice(0,4),accepted.slice(4)])for(let i=1;i<period.length;i++)assert.equal(period[i-1].endAt,period[i].startAt);assert.equal(accepted[0].startAt,'2026-09-21T18:30:00.000Z');assert.equal(accepted[3].endAt,'2026-09-22T00:30:00.000Z');assert.equal(h.L.results[0].total,20);assert.equal(h.L.comparisonResults[0].total,20);
 const rejected=[];h.setHandler(async q=>{rejected.push(q);throw Error('Synthetic timeout still pending')});await h.c.liveQuery();assert.equal(rejected.length,4);const widths=rejected.map(q=>Date.parse(q.endAt)-Date.parse(q.startAt));assert(widths.at(-1)<=3600000);assert(widths.at(-2)>3600000);assert.equal(h.L.results.length,0);assert.match(h.L.queryWarnings.join(' '),/timeout/);const permanent=[];h.setHandler(async q=>{permanent.push(q);throw Error('Synthetic forbidden')});await h.c.liveQuery();assert.equal(permanent.length,1,'non-timeout errors are never retried by partitioning');
});

test('detail pages use the full-range aggregate count and exact page offsets',async()=>{
 const h=await ready();setScope(h,{platform:P.id,from:'2026-09-20T00:00:00',to:'2026-09-21T23:59:59'});h.c.state.page='orders';const detailRequests=[];let changed=false;
 h.setHandler(async q=>{if(q.action==='aggregate')return aggregate(P,28);detailRequests.push(q);const total=changed?29:28;const r=detail(P,total,q.offset,q.limit);r.rows=r.rows.map((row,i)=>({...row,id:'row-'+(q.offset+i),order_number:'SYNTHETIC-'+(q.offset+i)}));return r});
 await h.c.liveQuery();assert.equal(h.L.error,'');assert.equal(h.L.detail.total,28);assert.equal(h.L.detail.rows.length,20);assert.deepEqual(Array.from(h.L.detail.rows,r=>r.id),Array.from({length:20},(_,i)=>'row-'+i));h.c.livePage(2,'server');await settle();assert.deepEqual(Array.from(h.L.detail.rows,r=>r.id),Array.from({length:8},(_,i)=>'row-'+(i+20)));assert.equal(h.L.detail.hasMore,false);assert.equal(detailRequests.length,2);assert.deepEqual(detailRequests.map(q=>q.offset),[0,20]);assert(detailRequests.every(q=>q.startAt==='2026-09-19T18:30:00.000Z'&&q.endAt==='2026-09-21T18:30:00.000Z'));
 changed=true;h.c.livePage(1,'server');await settle();assert.equal(h.L.error,'');assert.equal(h.L.detail.total,29);assert.equal(h.L.detail.rows.length,20);
});

test('Dashboard preview grants retain a stable account dependency while reading the latest session',()=>{
 const text=fs.readFileSync(path.join(__dirname,'../src/components/Dashboard.tsx'),'utf8');const start=text.indexOf('const detailedPreviewSessionRef=useRef(session)');assert(start>=0);const block=text.slice(start,text.indexOf('  useEffect(() => {\n    const followPreviewLink',start));assert(block.includes('detailedPreviewSessionRef.current=session'));assert(block.includes('const current=detailedPreviewSessionRef.current'));assert(block.includes('readAdminPreviewAccess(current)'));assert.match(block,/setInterval\(check,60000\)/);const deps=block.match(/\},\s*\[([^\]]*)\]\)/)?.[1];assert(deps);assert(deps.includes('profile?.auth_user_id'));assert(deps.includes('profile?.active'));assert(!/\bsession\b/.test(deps),'session object/token refresh cannot reset the non-Owner grant to false');
});

function withdrawalData(q={}){
 const operators=q.view==='operators',row={country:'印度',platform:'Synthetic platform',dataDate:'2026-09-23',total:100,processed:60,success:operators?50:80,rejected:operators?10:20,autoCount:35,manualCount:60,unclassifiedCount:5,avgSeconds:120,account:'SYNTHETIC-OPERATOR',previous:{total:80,processed:50,success:operators?45:60,rejected:operators?5:20,autoCount:20,manualCount:55,avgSeconds:100}};
 return {canWriteNotes:true,comparison:{complete:true,matchedRows:1,totalRows:1},view:q.view||'auto',startDate:'2026-09-23',endDate:'2026-09-23',previousStartDate:'2026-09-22',previousEndDate:'2026-09-22',rows:[row],total:1,totals:{...row,platforms:1,operators:1},previousTotals:row.previous,platforms:['Synthetic platform'],notes:[]};
}
function withdrawalHandler(q){if(q.action==='catalog')return {platforms:[P]};if(q.action==='autoWithdraw')return withdrawalData(q);if(q.action==='withdrawNote')return {date:q.date,country:q.country,platform:q.platform,reason:q.reason,version:'a'.repeat(32)};if(q.action==='withdrawReasons')return {available:true,source:'Synthetic source',basis:q.kind==='blocking'?'manual_remark':'remark',noteCount:4,total:1,canViewOrders:true,canViewOperators:true,categories:[{category:'SYNTHETIC-REJECT',categoryKey:'a'.repeat(32),count:2}],summary:{totalRejected:4,operators:2,missingReason:1,selectedCount:2},coverage:{collected:100,expected:100,complete:true},rows:q.kind==='orders'?[{orderNumber:'SYNTHETIC-ORDER',amount:100,status:'未通过',operator:'SYNTHETIC-OPERATOR',manualRemark:'SYNTHETIC-BLOCK',rejectionReason:'SYNTHETIC-REJECT',category:'SYNTHETIC-REJECT',createdAt:'2026-09-23 00:00:00'}]:[{reason:q.kind==='blocking'?'SYNTHETIC-BLOCK':'SYNTHETIC-REJECT',category:'SYNTHETIC-REJECT',categoryKey:'a'.repeat(32),reasonKey:'b'.repeat(32),operatorKey:'c'.repeat(32),operator:'SYNTHETIC-OPERATOR',categoryCount:1,missingReasonCount:0,count:2}]};return aggregate()}

test('automatic payout and operator pages use separate requests, local dates and tables',async()=>{
 const h=await ready({page:'auto_withdraw',handler:withdrawalHandler});assert(h.calls.some(q=>q.action==='autoWithdraw'));assert(!h.calls.some(q=>q.action==='aggregate'));assert.match(h.html(),/自动出款日报/);assert.doesNotMatch(h.html(),/SYNTHETIC-OPERATOR/);assert.match(h.html(),/>自动出款原因<\/button>/);assert.match(h.html(),/>驳回原因<\/button>/);
 h.c.withdrawDate('from','2026-09-23');h.c.withdrawDate('to','2026-09-23');await h.c.withdrawLoad();const q=h.calls.at(-1);assert.equal(q.startAt,'2026-09-23T00:00:00.000Z');assert.equal(q.endAt,'2026-09-23T23:59:59.000Z');assert.equal(q.view,'auto');assert.equal(q.country,'印度');
 const auto=renderedTables(h.html()).find(t=>t.headers.includes('总提现笔数 ↓'));assert(auto);assert(!auto.headers.includes('操作人'));assert.match(auto.html,/>合计</);assert.doesNotMatch(auto.html,/当前页汇总|全部汇总/);
 h.c.setPage('withdraw_operators');await settle();await h.c.liveQuery();await settle();assert.equal(h.calls.at(-1).view,'operators');assert.equal(h.calls.at(-1).sort,'processed');assert.match(h.html(),/SYNTHETIC-OPERATOR/);assert.doesNotMatch(h.html(),/自动出款日报|>自动出款原因<|>驳回原因<|>日明细<|>原因 \/ 每日备注</);const op=renderedTables(h.html()).find(t=>t.headers.includes('操作人'));assert(op);assert(!op.headers.some(x=>x.startsWith('总提现笔数')));for(const t of [auto,op])for(const row of t.rows)assert.equal(row.length,t.headers.length);assert.doesNotMatch(h.html(),/NaN|Infinity/);
 h.c.withdrawAccount('specific');await h.c.withdrawLoad();assert.equal(h.calls.at(-1).account,'specific');h.c.withdrawSort('avgSeconds');await settle();assert.equal(h.calls.at(-1).sort,'avgSeconds');assert.equal(h.calls.at(-1).ascending,false);h.c.withdrawSize('50');await settle();assert.equal(h.calls.at(-1).limit,50);
});

test('withdrawal reason tabs preserve field meaning, exact order numbers and stale-response protection',async()=>{
 const h=await ready({page:'auto_withdraw',handler:withdrawalHandler});h.c.withdrawReasons(0);await settle();assert.equal(h.calls.at(-1).kind,'blocking');assert.match(h.html(),/SYNTHETIC-BLOCK/);assert.doesNotMatch(h.html(),/SYNTHETIC-REJECT/);
 h.c.withdrawReasonClose();h.c.withdrawReasons(0,'rejection');await settle();assert.equal(h.calls.at(-1).kind,'categories');assert.match(h.html(),/SYNTHETIC-REJECT/);assert.doesNotMatch(h.html(),/SYNTHETIC-BLOCK/);h.c.withdrawReasonKind('orders');await settle();assert.match(h.html(),/SYNTHETIC-ORDER/);assert.match(h.html(),/SYNTHETIC-BLOCK/);assert.match(h.html(),/SYNTHETIC-REJECT/);
 const pending=deferred();h.setHandler(q=>q.action==='withdrawReasons'?pending.promise:withdrawalHandler(q));h.c.withdrawReasonKind('blocking');h.c.withdrawReasonClose();pending.resolve({available:true,rows:[{reason:'STALE-REASON',count:1}],total:1});await settle();assert.doesNotMatch(h.html(),/STALE-REASON/);
});
test('rejection drawer drills through categories, raw notes and operators without changing the denominator or claiming an error',async()=>{
 const h=await ready({page:'auto_withdraw',handler:withdrawalHandler});h.c.withdrawReasons(0,'rejection');await settle();
 assert.match(h.html(),/role="dialog" aria-modal="true" aria-label="平台原因详情"/);assert.match(h.html(),/全部 4 笔驳回订单/);assert.match(h.html(),/50\.00%/);assert.doesNotMatch(h.html(),/确认误驳回|确认错误|复核保存/);
 h.c.withdrawReasonDrill(0,'category');await settle();assert.equal(h.calls.at(-1).category,'a'.repeat(32));assert.equal(h.calls.at(-1).kind,'orders');assert.match(h.html(),/SYNTHETIC-ORDER/);assert.match(h.html(),/SYNTHETIC-OPERATOR/);
 h.c.withdrawReasonKind('operators');await settle();h.c.withdrawReasonDrill(0,'operator');await settle();assert.equal(h.calls.at(-1).operatorKey,'c'.repeat(32));assert.equal(h.calls.at(-1).category,'a'.repeat(32));
 h.c.withdrawReasonQuery('ORDER <input>');h.c.withdrawReasonSearch();await settle();assert.equal(h.calls.at(-1).query,'ORDER <input>');assert.match(h.html(),/ORDER &lt;input&gt;/);
 h.c.withdrawReasonDate('2026-09-22');await settle();assert.equal(h.calls.at(-1).date,'2026-09-22');assert.equal(h.calls.at(-1).category,undefined);assert.equal(h.calls.at(-1).operatorKey,undefined);assert.equal(h.calls.at(-1).query,undefined);
 h.c.withdrawReasonKind('categories');await settle();h.c.withdrawReasonVariants(0);await settle();assert.equal(h.calls.at(-1).kind,'rejection');h.c.withdrawReasonDrill(0,'reason');await settle();assert.equal(h.calls.at(-1).reasonKey,'b'.repeat(32));
 h.c.withdrawReasonKey({key:'Escape',preventDefault(){}});assert.doesNotMatch(h.html(),/aria-label="平台原因详情"/);
 assert(h.calls.filter(q=>q.action.startsWith('withdraw')).every(q=>q.action==='withdrawReasons'),'analysis is read only');
});
test('daily operational notes retain failed input and use an independent versioned save, never the reasons endpoint',async()=>{
 const h=await ready({page:'auto_withdraw',handler:withdrawalHandler});h.c.withdrawNoteOpen(0);assert.match(h.html(),/aria-label="每日备注"/);
 h.c.withdrawNoteInput('SYNTHETIC NOTE <script>');h.setHandler(q=>{if(q.action==='withdrawNote')throw Error('CONFLICT');return withdrawalHandler(q)});
 await h.c.withdrawNoteSave();assert.match(h.html(),/CONFLICT/);assert.match(h.html(),/SYNTHETIC NOTE &lt;script&gt;/);assert.doesNotMatch(h.html(),/<script>/);
 h.setHandler(withdrawalHandler);await h.c.withdrawNoteSave();const saved=h.calls.at(-1);assert.equal(saved.action,'withdrawNote');assert.equal(saved.reason,'SYNTHETIC NOTE <script>');assert.equal(saved.expectedVersion,'');assert.doesNotMatch(h.html(),/aria-label="每日备注"/);
 h.c.withdrawNoteOpen(0);h.c.withdrawNoteInput('UPDATED NOTE');await h.c.withdrawNoteSave();assert.equal(h.calls.at(-1).expectedVersion,'a'.repeat(32));
});
test('incomplete previous platform coverage suppresses total growth without hiding actual daily counts',async()=>{
 const h=await ready({page:'auto_withdraw',handler:q=>q.action==='autoWithdraw'?{...withdrawalData(q),comparison:{complete:false,matchedRows:0,totalRows:1}}:withdrawalHandler(q)});
 const kpis=h.html().split('withdraw-kpis')[1].split('</section>')[0];assert.match(kpis,/汇总不可比/);assert.match(kpis,/100/);assert.doesNotMatch(kpis,/25\.00%/);
});

test('late payout results cannot replace an edited scope or another subpage',async()=>{
 const h=await ready({page:'auto_withdraw',handler:withdrawalHandler}),pending=deferred();h.setHandler(q=>q.action==='autoWithdraw'?pending.promise:withdrawalHandler(q));const first=h.c.withdrawLoad();h.c.withdrawDate('from','2026-09-20');const stale=withdrawalData();stale.rows[0].platform='STALE-PLATFORM';pending.resolve(stale);await first;assert.match(h.html(),/点击查询/);assert.doesNotMatch(h.html(),/STALE-PLATFORM/);
 const older=deferred();h.setHandler(q=>q.action==='autoWithdraw'&&q.view==='auto'?older.promise:withdrawalHandler(q));const second=h.c.withdrawLoad();h.c.setPage('withdraw_operators');await settle();await h.c.liveQuery();await settle();older.resolve(stale);await second;assert.match(h.html(),/SYNTHETIC-OPERATOR/);assert.doesNotMatch(h.html(),/STALE-PLATFORM/);
});

test('direction provider summaries merge canonical names, match platform fees and split workorder cohorts',async()=>{
 const h=await ready(),p2={...P,id:'another-platform',name:'Second platform',source:'newar'},a=completeAggregate(P,10,4),b=completeAggregate(p2,20,6);
 a.groups.provider[0].created_success_count=3;b.groups.provider[0].created_success_count=5;h.L.results=[a,b];h.L.feeLookupRows=[{scopeType:'country',country:'印度',provider:'Synthetic provider',collectFee:'2%',collectSingleFee:'1'},{scopeType:'platform',country:'印度',platform:p2.name,provider:'Synthetic provider',collectFee:'3%',collectSingleFee:'2'}];const coverage={status:'complete',complete:true,detailCount:3,missingOrderNumberCount:0,missingDetailCount:0,amountConflictCount:0,providerConflictCount:0};h.L.workorders={byProvider:[{provider:'Synthetic provider',direction:'charge',submittedAmount:300,submittedCount:3,successAmount:100,successCount:1,notReceivedAmount:200,notReceivedCount:2,uniqueOrderAmount:300,uniqueOrderCount:3,uniqueSuccessAmount:100,uniqueSuccessCount:1,uniqueNotReceivedAmount:200,uniqueNotReceivedCount:2,uniqueCoverage:coverage},{provider:'Synthetic provider',direction:'withdraw',submittedAmount:9000,submittedCount:90,successAmount:8000,successCount:80,notReceivedAmount:1000,notReceivedCount:10,uniqueOrderAmount:9000,uniqueOrderCount:90,uniqueSuccessAmount:8000,uniqueSuccessCount:80,uniqueNotReceivedAmount:1000,uniqueNotReceivedCount:10,uniqueCoverage:{...coverage,detailCount:90}}],coverage:{complete:true,capturedPlatformDays:2,expectedPlatformDays:2,platforms:[]}};h.c.state.page='providers';h.c.render();
 const t=renderedTables(h.html()).find(t=>t.headers[0]==='统一三方');assert(t);assert.equal(t.rows.length,1);const row=t.rows[0].map(plain),at=label=>row[t.headers.findIndex(v=>v===label||v.startsWith(label+' '))];assert.equal(at('平台'),'2');assert.equal(at('成功金额'),'1,000.00');assert.equal(at('成功笔数'),'10');assert.match(at('成功率'),/^33.33%/);assert(!t.headers.some(x=>/全部创建|处理中/.test(x)));assert.equal(at('估算手续费'),'42.00');assert.equal(at('工单提交金额'),'300.00');assert.equal(at('工单提交笔数'),'3');assert(!t.headers.some(x=>x.includes('取款未到账')));assert.doesNotMatch(t.html,/9,000/);assert.match(t.html,/>合计</);assert.doesNotMatch(t.html,/当前页汇总|全部汇总/);
 h.L.workorders.coverage={complete:false,capturedPlatformDays:0,expectedPlatformDays:2,platforms:[]};h.L.workorders.byProvider=[];h.c.render();const unknown=renderedTables(h.html()).find(t=>t.headers[0]==='统一三方');assert.equal(plain(unknown.rows[0][unknown.headers.indexOf('工单提交金额')]),'—');assert.doesNotMatch(h.html(),/成功数据按成功时间；成功率为|未采集显示 —/);
 h.c.state.page='provider_payout';h.c.render();const withdrawal=renderedTables(h.html()).find(t=>t.headers[0]==='统一三方');assert(withdrawal.headers.includes('工单提交金额'));assert.match(h.html(),/取款未到账工单/);assert(!withdrawal.headers.some(x=>x.includes('存款未到账')));
});

test('provider catalog options do not wait for order aggregation and multiselect values remain scoped',async()=>{
 const pending=deferred(),h=await ready({ancillaryHandler:true,handler:q=>q.action==='catalog'?{platforms:[P]}:q.action==='providerOptions'?{providers:['Previously mapped pay']}:q.action==='aggregate'?pending.promise:{rows:[],total:0}});
 assert.equal(h.L.loading,true);assert.match(h.nodes.get('liveFilters').innerHTML,/Previously mapped pay/);assert.equal(h.L.providerOptionsBusy,false);h.c.liveSetMultiOption('provider',{value:'Previously mapped pay',checked:true});assert.deepEqual(Array.from(h.L.multi.provider),['Previously mapped pay']);assert.match(h.nodes.get('liveFilters').innerHTML,/搜索三方/);pending.resolve(aggregate());await settle();
});

test('valid team system and platform selections retain each other while candidates exclude other teams',async()=>{
 const p1={...P,team:'M8'};
 const p2={...P,id:'22222222-2222-4222-8222-222222222222',name:'M8 platform',source:'NEW_AR',team:'M8'};
 const p3={...P,id:'33333333-3333-4333-8333-333333333333',name:'Other platform',source:'AR',team:'Other'};
 const h=await ready({platforms:[p1,p2,p3]});
 assert.equal(h.L.source,'all');assert.deepEqual(Array.from(h.L.multi.source),[]);
 h.c.liveSetMultiOption('team',{value:'M8',checked:true});
 h.c.liveSetMultiOption('source',{value:'AR',checked:true});
 h.c.liveSetMultiOption('source',{value:'NEW_AR',checked:true});
 h.c.liveSetMultiOption('platform',{value:P.id,checked:true});
 h.c.liveSetMultiOption('platform',{value:p2.id,checked:true});
 await settle();
 assert.deepEqual(Array.from(h.L.multi.source).sort(),['AR','NEW_AR']);
 assert.deepEqual(Array.from(h.L.multi.platform).sort(),[P.id,p2.id].sort());
 const html=h.nodes.get('liveFilters').innerHTML;assert.match(html,/M8 platform/);assert.doesNotMatch(html,/Other platform/);
});

function verifiedProviderIntake(h){
 const period=h.c.HensemLiveCompare.windowFor(h.L.from,h.L.to,h.L.results[0].platform.timezone,h.L.queryNow);
 const make=(results,from,to)=>({status:'ready',from:from.slice(0,10),to:to.slice(0,10),platforms:results.map(result=>{
  const zero=(result.groups.provider||[]).every(r=>r.all_count===0),status=zero?'zero_complete':'complete',days=[];
  for(let day=Date.parse(from.slice(0,10));day<=Date.parse(to.slice(0,10));day+=86400000)days.push({date:new Date(day).toISOString().slice(0,10),dataset:'orders',status,received:!zero,complete:true,zeroConfirmed:zero,expected:true});
  return {...result.platform,status,received:true,complete:true,missingDates:[],days};
 })});
 h.L.providerIntake=make(h.L.results,h.L.from,h.L.to);h.L.providerComparisonIntake=make(h.L.comparisonResults,period.previousFrom,period.previousTo);
}

test('provider KPI comparisons use the same direction and distinguish money differences from percentage points',async()=>{
 const h=await ready(),current=completeAggregate(P,100,60),previous=completeAggregate(P,100,50);
 for(const r of [current,previous])r.groups.provider.push({...r.groups.provider[0],direction:'withdraw',success_count:900,success_amount:90000,created_success_count:90});
 h.L.results=[current];h.L.comparisonResults=[previous];h.L.comparisonStatus='ready';h.L.feeLookupRows=[{scopeType:'country',country:'印度',provider:'Synthetic provider',collectFee:'2%',payoutFee:'1%'}];h.c.state.page='providers';verifiedProviderIntake(h);h.c.render();
 const cards=h.html().split('<div class="provider-summary-kpis">')[1].split('<div class="provider-comparison-context">')[0];
 assert.match(cards,/6,000\.00/);assert.match(cards,/昨日 5,000\.00/);assert.match(cards,/\+1,000\.00.*\+20\.00%/);assert.match(cards,/\+10\.00 个百分点/);assert.match(cards,/120\.00/);assert.match(cards,/昨日 100\.00/);assert.doesNotMatch(cards,/90,000/);
 assert.equal((cards.match(/<strong>/g)||[]).length,8,'all eight primary metrics remain visible');
 assert.doesNotMatch(plain(cards),/5,000\.00/,'the previous value stays in hover details');assert.match(plain(cards),/\+1,000\.00（\+20\.00%）/,'absolute amount difference is directly visible');assert.match(plain(cards),/\+10 笔（\+20\.00%）/,'absolute count difference is directly visible');
 assert.match(plain(cards),/\+20\.00%/);assert.match(plain(cards),/\+10\.00个百分点/,'percentage-point change remains distinct from relative percent');
 assert.match(cards,/title="[^"]*昨日 5,000\.00 · 较昨日同期 \+1,000\.00 · \+20\.00%"/);
 assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/业务方向/);
 const table=renderedTables(h.html()).find(t=>t.headers[0]==='统一三方');assert.equal(table.headers[1],'平台');assert(!table.headers.some(h=>/金额 \/ 笔数/.test(h)));assert(table.rows.every(r=>r.length===table.headers.length));
 h.c.state.page='provider_payout';h.c.render();const payoutCards=h.html().split('<div class="provider-summary-kpis">')[1].split('<div class="provider-comparison-context">')[0];assert.match(payoutCards,/90,000\.00/);assert.doesNotMatch(payoutCards,/6,000\.00|\+10\.00 个百分点/);assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/业务方向/);
 assert.equal((payoutCards.match(/<strong>/g)||[]).length,8);assert.doesNotMatch(plain(payoutCards),/昨日|同期/,'payout uses the same compact comparison presentation');
 h.c.state.page='overview';h.c.render();assert.match(h.nodes.get('liveFilters').innerHTML,/业务方向/);
});
test('provider comparisons suppress incomplete scopes and partial fees while preserving current values and zero-baseline semantics',async()=>{
 const h=await ready(),current=completeAggregate(P,100,60),previous=completeAggregate(P,0,0),cards=()=>h.html().split('<div class="provider-summary-kpis">')[1].split('<div class="provider-comparison-context">')[0];
 h.L.results=[current];h.L.comparisonResults=[previous];h.L.comparisonStatus='ready';h.L.feeLookupRows=[];h.c.state.page='providers';verifiedProviderIntake(h);h.c.render();
 assert.match(cards(),/新增 \/ 无基数/);assert.match(cards(),/费率未完全匹配/);assert.doesNotMatch(cards(),/Infinity|NaN/);
 h.L.comparisonResults=[{...previous,platform:{...P,id:'different-platform'}}];h.c.render();assert.match(cards(),/6,000\.00/);assert.match(cards(),/没有同范围的两期数据/);assert.doesNotMatch(cards(),/新增 \/ 无基数|\+100\.00%/);
 assert.doesNotMatch(plain(cards()),/没有同范围的两期数据/,'the same unavailable explanation is not repeated across the eight cards');assert.match(plain(cards()),/部分|费率未齐/,'incomplete fee state remains visible');
 h.L.comparisonResults=[previous];h.L.comparisonStatus='error';h.L.comparisonError='昨日数据读取失败';h.c.render();assert.match(cards(),/昨日数据读取失败/);assert.doesNotMatch(cards(),/新增 \/ 无基数/);
});

test('provider comparisons label the read scope when current or previous intake proof is unavailable',async()=>{
 const h=await ready();h.L.results=[completeAggregate(P,100,60)];h.L.comparisonResults=[completeAggregate(P,100,50)];h.L.comparisonStatus='ready';h.L.feeLookupRows=[];h.c.state.page='providers';verifiedProviderIntake(h);
 const current=h.L.providerIntake,previous=h.L.providerComparisonIntake;h.L.providerIntake=null;h.c.render();assert.match(h.html(),/较昨日 · 按已读 1 平台/);assert.match(h.html(),/6,000\.00/);assert.match(h.html(),/\+20\.00%/);
 h.L.providerIntake=current;h.L.providerComparisonIntake=null;h.c.render();assert.match(h.html(),/较昨日 · 按已读 1 平台/);assert.match(h.html(),/\+20\.00%/);
 h.L.providerComparisonIntake=previous;h.c.render();assert.match(h.html(),/\+20\.00%/);
});

test('confirmed India UpiPay row 4 drives both labels and estimates without falling back to the inactive tier',async()=>{
 const h=await ready(),r=completeAggregate(P,20,10);r.groups.provider[0].provider='UpiPay';h.L.results=[r];h.c.state.page='providers';
 // Deliberately synthetic prices: prove the selected sheet row drives arithmetic, not a hardcoded fee.
 const confirmed={scopeType:'country',country:'印度',provider:'UpiPay',category:'USDT',sheetName:'印度线下',sourceRow:4,collectFee:'5.20%',payoutFee:'3.10%',payoutSingleFee:'7',status:'开启'};
 const inactive={...confirmed,category:'UPI',sourceRow:47,collectFee:'6.30%',payoutFee:'3.80%',status:'停用'};
 h.L.feeLookupRows=[inactive,confirmed,{...confirmed,scopeType:'platform',platform:P.name,collectFee:'',payoutFee:'',payoutSingleFee:''}];h.c.render();
 let t=renderedTables(h.html()).find(t=>t.headers[0]==='统一三方'),row=t.rows[0].map(plain),at=label=>row[t.headers.findIndex(v=>v===label||v.startsWith(label+' '))];
 assert.equal(at('匹配费率'),'5.20%');assert.equal(at('估算手续费'),'52.00');assert.doesNotMatch(t.html,/多档费率/);
 h.c.providerSummaryRate(0);assert.match(h.drawers.at(-1).html,/已确认.*第 4 行/);assert.match(h.drawers.at(-1).html,/印度线下 \/ 4/);assert.match(h.drawers.at(-1).html,/印度线下 \/ 47/);
 r.groups.provider[0].direction='withdraw';h.c.state.page='provider_payout';h.c.render();t=renderedTables(h.html()).find(t=>t.headers[0]==='统一三方');row=t.rows[0].map(plain);assert.equal(at('匹配费率'),'3.10% / 单笔 7');assert.equal(at('估算手续费'),'101.00');
 h.L.feeLookupRows=[inactive];h.c.render();t=renderedTables(h.html()).find(t=>t.headers[0]==='统一三方');row=t.rows[0].map(plain);assert.equal(at('匹配费率'),'未匹配');assert.equal(at('估算手续费'),'—未匹配');assert.match(t.html,/当前方向未找到可用费率/);
 const api=h.c.HensemProviderSummary,order={provider:'UpiPay',direction:'charge',platform:P.name,success_amount:1000,success_count:10};
 assert.equal(api.estimate(order,[{...confirmed,country:'巴西',collectFee:'8%'}],'巴西'),80);
 assert.equal(api.estimate({...order,provider:'IndependentPay'},[{...confirmed,provider:'IndependentPay',collectFee:'3%'},{...confirmed,provider:'IndependentPay',scopeType:'platform',platform:P.name,collectFee:'',collectSingleFee:''}],'印度'),30);
});

test('provider expansion shows platform contributions without requests and leaves overview layout unwrapped',async()=>{
 const h=await ready(),p2={...P,id:'separate-id',source:'NEW_AR'},a=completeAggregate(P,20,4),b=completeAggregate(p2,30,6);
 h.L.results=[a,b];h.L.queryPlatforms=[P,p2];h.L.feeLookupRows=[];h.c.state.page='providers';h.c.render();const calls=h.calls.length;
 assert.match(h.html(),/代收创建金额/);assert.match(h.html(),/代收创建笔数/);assert.match(h.html(),/aria-expanded="false"/);
 h.c.providerSummaryToggle(0);assert.equal(h.calls.length,calls);assert.match(h.html(),/aria-expanded="true"/);
 const children=[...h.html().matchAll(/<tr class="provider-platform-row">([^]*?)<\/tr>/g)].map(m=>[...m[1].matchAll(/<td>([^]*?)<\/td>/g)].map(c=>c[1]));assert.equal(children.length,2);
 assert(children.every(r=>r.length===26));assert.deepEqual(children.map(r=>plain(r[1])).sort(),['AR','NEW_AR']);
 assert.deepEqual(children.map(r=>plain(r[8])).sort(),['40.00%','60.00%']);
 assert.deepEqual(children.map(r=>plain(r[7])).sort(),['40.00%','60.00%']);
 assert.equal(children.reduce((n,r)=>n+Number(plain(r[5]).replaceAll(',','')),0),1000);
 h.c.providerSummaryToggle(0);assert.doesNotMatch(h.html(),/provider-platform-breakdown/);
 const failed={...P,id:'failed-platform',name:'Synthetic failed platform'};h.L.queryPlatforms.push(failed);h.L.queryFailures=[{...failed,message:'Synthetic timeout'}];h.L.queryWarnings=['Synthetic failed platform'];h.c.render();assert.match(h.html(),/订单 2 \/ 3 · 读取未完成/);assert.match(h.html(),/>未读 Synthetic failed platform<\/button>/);h.c.providerSummaryPlatformCoverage();assert.match(h.drawers.at(-1).html,/Synthetic failed platform/);assert.match(h.drawers.at(-1).html,/读取失败/);assert.equal(h.calls.length,calls);
 h.c.state.page='overview';h.c.render();assert.doesNotMatch(h.html(),/provider-summary-report|provider-floating-head/);
});

test('amount ranges are sorted numerically in each direction with missing and other bands last',async()=>{
 const h=await ready(),r=completeAggregate(P),bands=['≥5,001','1,001–2,000','2,001–5,000','100–200','201–300','301–400','401–500','501–750','751–1,000','unknown','other'];
 r.groups.amount_range=['charge','withdraw'].flatMap(direction=>bands.map(bucket=>({...r.summary[0],direction,bucket})));h.L.loadedView='full';h.L.results=[r];h.L.direction='all';h.c.state.page='overview';h.c.render();
 const tables=renderedTables(h.html()).filter(t=>t.headers[0].startsWith('金额档位 ·'));
 assert.equal(tables.length,2);for(const table of tables)assert.deepEqual(table.rows.map(r=>plain(r[0])).slice(0,9),['100–200','201–300','301–400','401–500','501–750','751–1,000','1,001–2,000','2,001–5,000','≥5,001']);
});
test('overview uses success-time ratios including cross-day completions and matches fees independently',async()=>{
 const h=await ready(),r=completeAggregate(P,100,120);r.summary[0].created_success_count=60;r.summary.push({...r.summary[0],direction:'withdraw'});
 r.groups.provider=['charge','withdraw'].flatMap(direction=>[900,750,500,250].map((success,i)=>({...stats(1000,'10000'),direction,provider:'TestPay'+i,success_count:1200,success_amount:'12000',created_success_count:success})));
 h.L.results=[r];h.L.direction='all';h.L.feeLookupRows=[{scopeType:'country',country:'印度',provider:'TestPay0',collectFee:'2%',payoutFee:'1%'}];h.c.render();
 for(const [id,fee] of [['df-collect','240.00'],['df-payout','120.00']]){
  const card=h.html().match(new RegExp('<section class="df-card" id="'+id+'">([^]*?)</section>'))[1];
  assert.match(card,/120\.00%/);assert.doesNotMatch(card,/60\.00%/);assert.match(card,/成功率较高/);assert.match(card,/成功率较低/);assert(card.indexOf('TestPay0')<card.indexOf('TestPay3'));assert(card.includes('<strong>'+fee+'</strong>'));assert.match(card,/已匹配 1,200 \/ 4,800 笔 · 部分匹配/);assert.match(card,/含跨日成功/);
 }
});
test('canonical aliases combine collection orders, issue-only names and current fees into one provider row',async()=>{
 const h=await ready(),r=completeAggregate(P,20,10);r.groups.provider=[{...r.summary[0],provider:'LKgoPayINR'},{...r.summary[0],provider:'LKgoPay'},{...r.summary[0],provider:'PAYTM- RAPay'},{...r.summary[0],provider:'RAPay'}];h.L.results=[r];h.L.country='印度';h.L.feeLookupRows=[{scopeType:'country',country:'印度',provider:'LKgoPay',collectFee:'2%'},{scopeType:'country',country:'印度',provider:'RAPay',collectFee:'3%'}];
 h.L.workorders={byProvider:[{provider:'LKgoPayINR',direction:'charge',submittedCount:2,submittedAmount:500,successCount:1,successAmount:100,notReceivedCount:1,notReceivedAmount:400,uniqueOrderAmount:500,uniqueOrderCount:2,uniqueSuccessAmount:100,uniqueSuccessCount:1,uniqueNotReceivedAmount:400,uniqueNotReceivedCount:1,uniqueCoverage:{status:'complete',complete:true,detailCount:2,missingOrderNumberCount:0,missingDetailCount:0,amountConflictCount:0,providerConflictCount:0}}],coverage:{complete:true,capturedPlatformDays:1,expectedPlatformDays:1}};h.c.state.page='providers';h.c.render();
 const table=renderedTables(h.html()).find(t=>t.headers[0]==='统一三方');assert.equal(table.rows.length,2);assert(!table.rows.some(r=>/LKgoPayINR|PAYTM- RAPay/.test(plain(r[0]))));
 const l=table.rows.find(r=>plain(r[0])==='LKgoPay'),at=label=>plain(l[table.headers.findIndex(h=>h===label||h.startsWith(label+' '))]);assert.equal(at('成功金额'),'2,000.00');assert.equal(at('成功笔数'),'20');assert.equal(at('估算手续费'),'40.00');assert.equal(at('工单提交金额'),'500.00');assert.equal(at('工单提交笔数'),'2');
});
test('workorder page restores filters and resets the inherited payout or collection direction',async()=>{
 const h=await ready({ancillaryHandler:true,handler:q=>q.action==='catalog'?{platforms:[P]}:q.action==='workorders'?{total:0,rows:[],byDirection:{charge:{submittedCount:3,submittedAmount:300,successCount:1,successAmount:100,notReceivedCount:2,notReceivedAmount:200},withdraw:{submittedCount:5,submittedAmount:500,successCount:2,successAmount:200,notReceivedCount:3,notReceivedAmount:300}},summary:{}}:q.action==='providerOptions'?{providers:[]}:q.action==='rates'?{rows:[],total:0}:aggregate()});
 h.L.direction='charge';h.c.setPage('workorders');await settle();h.c.workorderOperationsMode('daily');await h.c.liveQuery();await settle();assert.equal(h.L.direction,'all');assert.equal(h.calls.filter(q=>q.action==='workorders').at(-1).direction,'all');assert.equal(h.nodes.get('liveFilters').style.display,'');assert.match(h.html(),/存款未到账|取款未到账/);assert.match(h.nodes.get('nav').innerHTML,/工单未到账/);
});
test('deposit tracking and statistics are separate pages and receipt dates never reuse source day counts',async()=>{
 const h=await ready();h.setHandler(q=>['depositIssues','depositStatistics'].includes(q.action)?{rows:[{platform:'Synthetic platform',provider:'Synthetic Provider',orderNumber:'SYNTHETIC-ORDER',amount:900,status:'已入款',unreceivedDays:90,providerReply:'成功 <script>',utrMatch:'一致',kycCorrect:'正确'}],total:1,summary:{count:1,amount:900,unreceivedAmount:0,unreceivedCount:0,receivedCount:1}}:{rows:[],total:0});
 h.L.from='2026-09-23T00:00:00';h.L.to='2026-09-23T23:59:59';h.c.setPage('deposit_tracking');await settle();await h.c.liveQuery();await settle();const q=h.calls.at(-1);assert.equal(q.action,'depositIssues');assert.equal(q.view,'entries');assert.equal(q.dateMode,'range');assert.equal(q.startAt,'2026-09-17T00:00:00.000Z');assert.equal(q.endAt,'2026-09-23T23:59:59.000Z');assert.match(h.html(),/员工跟进明细/);assert.doesNotMatch(h.html(),/表格核对结果|onclick="depositIssuesSource/);
 h.c.setPage('deposit_statistics');await settle();h.c.depositIssuesSection('details');await h.c.liveQuery();await settle();assert.equal(h.calls.at(-1).action,'depositStatistics');assert.equal(h.calls.at(-1).section,'details');const stats=renderedTables(h.html()).find(t=>t.headers[0]==='凭证日期');assert(stats);assert.equal(plain(stats.rows[0][stats.headers.indexOf('距今天数')]),'—');assert.match(h.html(),/成功 &lt;script&gt;/);assert.doesNotMatch(h.html(),/<script>/);
 h.c.setPage('deposit_tracking');await settle();await h.c.liveQuery();await settle();assert.match(h.html(),/员工跟进明细/);h.c.depositIssuesDate('from','2026-09-22');assert.match(h.html(),/SYNTHETIC-ORDER/,'old result stays visible until an explicit query');await h.c.depositIssuesLoad();assert.equal(h.calls.at(-1).startAt,'2026-09-22T00:00:00.000Z');
});
test('revisiting a reason tab reuses its bounded cache, while refresh invalidates it',async()=>{
 const h=await ready({page:'auto_withdraw',handler:withdrawalHandler});h.c.withdrawReasons(0);await settle();h.c.withdrawReasonKind('categories');await settle();const n=h.calls.filter(q=>q.action==='withdrawReasons').length;
 h.c.withdrawReasonKind('blocking');await settle();assert.equal(h.calls.filter(q=>q.action==='withdrawReasons').length,n);
 await h.c.withdrawLoad(true);h.c.withdrawReasons(0);await settle();assert.equal(h.calls.filter(q=>q.action==='withdrawReasons').length,n+1);
});

test('statistics tabs derive from one source while tracking never requests result summaries',async()=>{
 const h=await ready();h.setHandler(q=>['depositIssues','depositStatistics'].includes(q.action)?{rows:[],total:20,summary:{count:20},facets:{platforms:['Synthetic platform'],providers:['UmoneyPay']},providerSummary:[{provider:'UmoneyPay',matchStatus:'对得上',count:20}],dailySummary:[{date:'2026-09-23',count:20}]}:{rows:[]});
 h.c.setPage('deposit_statistics');await settle();await h.c.liveQuery();await settle();assert.equal(h.calls.at(-1).action,'depositStatistics');assert.match(h.html(),/三方查看/);assert.match(h.html(),/每日汇总/);assert.match(h.html(),/不重复累计/);
 h.c.depositIssuesDrill('providers',0);await settle();assert.equal(h.calls.at(-1).provider,'UmoneyPay');assert.equal(h.calls.at(-1).match,'matched');assert.equal(h.calls.at(-1).section,'details');
 h.c.setPage('deposit_tracking');await settle();await h.c.liveQuery();await settle();assert.equal(h.calls.at(-1).action,'depositIssues');assert.equal(h.calls.at(-1).view,'entries');assert.equal(h.calls.at(-1).match,undefined);assert.match(h.html(),/员工跟进明细/);assert.doesNotMatch(h.html(),/三方查看|每日汇总/);
});

test('collected platforms expose report-only teams, retain independent filters and read one source on demand',async()=>{
 const report={id:'ph-report',timezone:'UTC',name:'NEW-PH',team:'胖虎',country:'胖虎巴西',system:'PANDA',dataset:'panda_success',rawCountry:'胖虎巴西',rawPlatform:'NEW-PH',lastDate:'2026-09-24',direction:'charge',sourceKind:'direct',defaultEnd:'2026-09-25'};
 const feeds=[report,{...report,id:'unknown-report',name:'UNKNOWN',rawPlatform:'UNKNOWN',team:'待归类',country:'新地区'}];
 const h=await ready({page:'collected_data',handler:q=>q.action==='catalog'?{platforms:[P]}:q.action==='intakeCoverage'?intakeCoverageFixtureReply(q,feeds):q.action==='collectedData'?{rows:[{date:'2026-09-24',metrics:{count:5,success:3}}],total:1}:aggregate(P)});
 assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);assert.match(h.html(),/NEW-PH/);assert.match(h.html(),/UNKNOWN/);assert.match(h.html(),/待归类/);
 h.c.collectedSet('team','胖虎');assert.match(h.html(),/NEW-PH/);assert.doesNotMatch(h.html(),/<td>UNKNOWN<\/td>/);assert.match(h.html(),/<option value="待归类"/);
 const calls=h.calls.length;h.c.collectedSearch('NEW-');h.c.collectedSearch('NEW-PH');assert.equal(h.calls.length,calls,'search needs no repeated database scan');await h.c.collectedCoverageQuery();h.c.collectedOpenDay('ph-report','2026-09-24');await settle();const q=h.calls.at(-1);assert.equal(q.action,'collectedData');assert.equal(q.platform,'NEW-PH');assert.equal(q.country,'胖虎巴西');assert.equal(q.dataset,'panda_success');assert.equal(q.startAt,'2026-09-24');assert.match(h.html(),/成功笔数/);h.c.collectedDate('from','2026-09-23');assert.match(h.html(),/日期已修改/);assert.doesNotMatch(h.html(),/<th>成功笔数<\/th>/);
});
test('Panghu withdrawal picker preserves displayed team scope with authorized catalogue platforms',async()=>{
 const ph={id:'44444444-4444-4444-4444-444444444444',name:'FUTURE-PH',country:'胖虎巴西',scopeGroup:'BR_PANGHU',team:'胖虎',source:'withdraw',timezone:'America/Sao_Paulo',currency:'BRL'};
 const h=await ready({page:'auto_withdraw',handler:q=>q.action==='catalog'?{platforms:[P],withdrawPlatforms:[ph]}:q.action==='autoWithdraw'?{country:q.country,rows:[],totals:{},platforms:['FUTURE-PH']}:{}});
 h.c.withdrawCountry('胖虎巴西');assert.equal(h.L.country,'巴西');assert.deepEqual(Array.from(h.L.multi.team),['胖虎']);assert.match(h.html(),/FUTURE-PH/);await h.c.withdrawLoad(true);const q=h.calls.filter(q=>q.action==='autoWithdraw').at(-1);assert.equal(q.country,'胖虎巴西');assert.deepEqual(Array.from(q.platforms),['FUTURE-PH']);
});

test('overview requests compact totals and providers, defers charts, and yesterday stays compact',async()=>{
 const h=await ready();assert(h.calls.filter(q=>q.action==='aggregate').every(q=>q.view==='providers'));
 assert.doesNotMatch(h.html(),/加载全部图表分析/);assert.match(h.html(),/加载本页分析/);assert.match(h.html(),/滚动到这里会自动读取并展示/);assert.doesNotMatch(h.html(),/打开后读取对应分析/);
 assert(!h.calls.some(q=>q.action==='workorders'));
 const start=h.calls.length;h.c.liveOverviewAnalysis();await settle();
 const reads=h.calls.slice(start).filter(q=>q.action==='aggregate');assert(reads.some(q=>!q.view));assert(reads.filter(q=>q.view).every(q=>q.view==='providers'));
 assert.match(h.html(),/id="df-hour-charge"/);assert.match(h.html(),/id="df-charge-trend"/);
});

test('slow or failed platform keeps completed overview results visibly partial without duplicate queries',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222',name:'Slow platform'},wait=deferred();
 const h=await ready({platforms:[P,p2]});h.setHandler(q=>q.action==='aggregate'&&q.platformId===p2.id?wait.promise:aggregate(P));
 const run=h.c.liveQuery();await settle();assert.equal(h.L.loading,true);assert.equal(h.L.results.length,1);assert.match(h.html(),/部分结果/);assert.match(h.html(),/Synthetic platform/);
 const before=h.calls.length;await h.c.liveQuery();assert.equal(h.calls.length,before);
 wait.reject(Error('连接中断'));await run;assert.equal(h.L.results.length,1);assert.match(h.html(),/部分平台读取失败/);assert.match(h.html(),/Slow platform/);assert.equal(h.L.comparisonStatus,'error');
});

test('provider drilldown shows prior-created successful unknown orders across platforms and keeps filters unchanged',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222',name:'Another platform'},h=await ready({platforms:[P,p2]});
 h.L.results=[P,p2].map(p=>{const r=completeAggregate(p,0,1);r.groups.provider=[{...r.summary[0],provider:'未识别通道',direction:'withdraw'}];return r});
 const before=JSON.stringify(h.L.multi);h.setHandler(q=>({platform:q.platformId===P.id?P:p2,total:1,rows:[{order_number:q.platformId===P.id?'CROSS-DAY-1':'CROSS-DAY-2',provider:'未识别通道',raw_provider:null,channel_type:'ARPay',direction:'withdraw',status:'已通过',amount:'100',created_at:'2026-09-21T17:00:00Z',success_at:'2026-09-22T01:00:00Z'}]}));
 const start=h.calls.length;await h.c.liveProviderOrders('未识别通道','AR','withdraw');
 const calls=h.calls.slice(start);assert.equal(calls.length,2);assert(calls.every(q=>q.action==='details'&&q.status==='success'&&q.direction==='withdraw'&&q.providers[0]==='未识别通道'));
 const html=h.drawers.at(-1).html;assert.match(html,/CROSS-DAY-1/);assert.match(html,/CROSS-DAY-2/);assert.match(html,/原始三方字段为空/);assert.match(html,/此前创建、本期成功/);assert.match(html,/创建时间 · 0 笔/);
 assert.equal(JSON.stringify(h.L.multi),before);await h.c.liveProviderOrderBasis('created');assert.equal(h.calls.length,start+2);assert.doesNotMatch(h.drawers.at(-1).html,/CROSS-DAY/);
});

test('provider drilldown pages across platform boundaries and rejects changed totals',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222',name:'Z platform'},h=await ready({platforms:[P,p2]});
 h.L.results=[P,p2].map(p=>{const r=completeAggregate(p,15,15);r.groups.provider=[{...r.summary[0],provider:'Manual'}];return r});
 h.setHandler(q=>detail(q.platformId===P.id?P:p2,15,q.offset,q.limit));
 await h.c.liveProviderOrders('Manual','AR','charge');assert.equal((h.drawers.at(-1).html.match(/liveProviderOrder\(\d+\)/g)||[]).length,20);
 await h.c.liveProviderOrderPage(2);assert.equal(h.calls.at(-1).offset,5);assert.equal(h.calls.at(-1).platformId,p2.id);assert.equal((h.drawers.at(-1).html.match(/liveProviderOrder\(\d+\)/g)||[]).length,10);
 h.setHandler(q=>detail(P,16,0,20));await h.c.liveProviderOrderBasis('created');assert.match(h.drawers.at(-1).html,/来源订单已更新/);assert.doesNotMatch(h.drawers.at(-1).html,/liveProviderOrder\(0\)/);
});

test('order explorer requires an explicit platform even when the catalogue has only one platform',async()=>{
 const h=await ready({page:'orders'});
 assert.deepEqual(h.calls.map(q=>q.action),['catalog']);
 assert.match(h.html(),/请先选择一个商户（平台）/);
 assert.equal(h.L.platform,'all');assert.equal(h.L.detail,null);
 const picker=h.nodes.get('liveFilters').innerHTML.match(/<details[^>]*data-multi="platform"[^]*?<\/details>/)?.[0];
 assert(picker);assert.match(picker,/type="search"/);assert.match(picker,/type="radio"/);
 assert.doesNotMatch(picker,/type="checkbox"|全选结果/);
 const before=h.calls.length;
 await h.c.liveQuery();h.c.liveReset();h.c.livePeriod('week');h.c.livePeriod('yesterday');h.c.livePage(2,'server');h.c.livePageSize('500','server');await h.c.liveDetails();await settle();
 assert.equal(h.calls.length,before,'query, reset, date presets and paging cannot read all-platform orders');
 assert.match(h.html(),/请先选择一个商户（平台）/);assert.equal(h.L.detail,null);
});

test('order platform search retains searchable radio choices and selecting B replaces A',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222',name:'Other searchable platform'};
 const h=await ready({page:'orders',platforms:[P,p2]});
 h.c.liveSetMultiOption('platform',{value:P.id,checked:true});await settle();
 assert.equal(h.L.platform,P.id);assert.deepEqual(Array.from(h.L.multi.platform),[P.id]);
 assert.deepEqual(h.calls.filter(q=>q.action==='providerOptions').at(-1).platformIds,[P.id]);
 h.c.liveMultiSearch('platform','Other searchable');h.c.render();
 let picker=h.nodes.get('liveFilters').innerHTML.match(/<details[^>]*data-multi="platform"[^]*?<\/details>/)?.[0];
 assert.match(picker,/value="Other searchable"/);assert.match(picker,/<label class="live-multi-option" hidden[^]*?Synthetic platform/);
 assert.match(picker,/type="radio"[^>]*value="22222222-2222-4222-8222-222222222222"/);
 h.c.liveSetMultiOption('platform',{value:p2.id,checked:true});await settle();
 assert.equal(h.L.platform,p2.id);assert.deepEqual(Array.from(h.L.multi.platform),[p2.id]);
 const requests=h.calls.length;await h.c.liveQuery();
 const reads=h.calls.slice(requests).filter(q=>['aggregate','details'].includes(q.action));
 assert(reads.some(q=>q.action==='aggregate'));assert(reads.some(q=>q.action==='details'));
 assert(reads.every(q=>q.platformId===p2.id));assert(reads.filter(q=>q.action==='aggregate').every(q=>q.view==='providers'));
 assert.equal(h.L.detail.platform.id,p2.id);assert.equal(h.L.detail.rows.length,20);
 h.c.livePage(2,'server');await settle();assert.equal(h.calls.at(-1).platformId,p2.id);assert.equal(h.calls.at(-1).offset,20);assert.equal(h.L.detail.rows[0].id,'row-20');
});

test('order explorer blocks inherited multiselect and a selected platform excluded by team or country',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222',team:'Other team'},p3={...P,id:'33333333-3333-4333-8333-333333333333',country:'美国',currency:'USD',timezone:'America/New_York'};
 const h=await ready({platforms:[{...P,team:'First team'},p2,p3]});
 h.L.platform='all';h.L.multi.platform=[P.id,p2.id];let before=h.calls.length;
 h.c.setPage('orders');h.c.liveQuery();await settle();
 assert.equal(h.calls.length,before);assert.match(h.html(),/请先选择一个商户（平台）/);
 h.c.liveSet('platform',P.id);await settle();await h.c.liveQuery();assert(h.L.detail);
 before=h.calls.length;h.c.liveSet('team','Other team');await h.c.liveQuery();h.c.livePage(2,'server');await settle();
 assert.equal(h.calls.length,before);assert.match(h.html(),/请先选择一个商户（平台）/);assert.doesNotMatch(h.html(),/order-0/);
 before=h.calls.length;h.c.liveSet('country','美国');h.c.liveQuery();await settle();
 assert.equal(h.calls.length,before);assert.match(h.html(),/请先选择一个商户（平台）/);
});

test('order platform select-all callback cannot broaden the scope and overview keeps multiselect',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222',name:'Another platform'},h=await ready({page:'orders',platforms:[P,p2]});
 h.c.liveSetMultiOption('platform',{value:P.id,checked:true});await settle();
 h.nodes.set('details[data-multi="platform"]',{querySelectorAll:()=>[{value:P.id},{value:p2.id}]});
 h.c.liveMultiAll('platform',true);await settle();assert.deepEqual(Array.from(h.L.multi.platform),[P.id]);
 h.c.setPage('overview');await settle();
 let picker=h.nodes.get('liveFilters').innerHTML.match(/<details[^>]*data-multi="platform"[^]*?<\/details>/)?.[0];
 assert.match(picker,/type="checkbox"/);assert.match(picker,/全选结果/);
 h.c.liveSetMultiOption('platform',{value:p2.id,checked:true});await settle();
 assert.deepEqual(Array.from(h.L.multi.platform).sort(),[P.id,p2.id].sort());assert.equal(h.L.platform,'all');
});

test('resetting required order platform invalidates a late provider directory response',async()=>{
 const h=await ready({page:'orders',ancillaryHandler:true}),oldOptions=deferred();
 h.setHandler(q=>q.action==='providerOptions'?oldOptions.promise:aggregate(P));
 h.c.liveSet('platform',P.id);assert.equal(h.L.providerOptionsBusy,true);
 h.c.liveReset();const reads=h.calls.length;oldOptions.resolve({providers:['STALE-PLATFORM-PROVIDER']});await settle();
 assert.equal(h.calls.length,reads);assert.equal(h.L.platform,'all');assert.equal(h.L.providerOptionsBusy,false);
 assert.deepEqual(Array.from(h.L.providerOptions),[]);assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/STALE-PLATFORM-PROVIDER/);assert.match(h.html(),/请先选择一个商户（平台）/);
});

test('resetting or replacing the required platform prevents old detail and aggregate results returning',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222',name:'Fresh selected platform'},h=await ready({page:'orders',platforms:[P,p2]}),oldDetail=deferred(),oldAggregate=deferred();
 h.c.liveSet('platform',P.id);await settle();h.setHandler(q=>q.action==='details'?oldDetail.promise:aggregate(P));
 const details=h.c.liveDetails();h.c.liveReset();oldDetail.resolve(detail(P,65));await details;
 assert.equal(h.L.detail,null);assert.match(h.html(),/请先选择一个商户（平台）/);
 h.c.liveSet('platform',P.id);await settle();h.setHandler(q=>q.action==='aggregate'&&q.platformId===P.id?oldAggregate.promise:q.action==='details'?detail(p2,65,q.offset,q.limit):aggregate(p2));
 const old=h.c.liveQuery();await settle();h.c.liveSet('platform',p2.id);await h.c.liveQuery();
 assert.equal(h.L.results[0].platform.id,p2.id);assert.equal(h.L.detail.platform.id,p2.id);
 oldAggregate.resolve(aggregate(P,999));await old;assert.equal(h.L.results[0].platform.id,p2.id);assert.equal(h.L.detail.platform.id,p2.id);assert.doesNotMatch(h.html(),/999/);
});

test('resetting a split order read stops subsequent chunks from querying the old platform',async()=>{
 const h=await ready({page:'orders'}),firstChunk=deferred();h.c.liveSet('platform',P.id);await settle();
 h.L.results=[{...aggregate(P,2),_parts:[{total:1,startAt:'2026-09-21T18:30:00.000Z',endAt:'2026-09-21T21:30:00.000Z'},{total:1,startAt:'2026-09-21T21:30:00.000Z',endAt:'2026-09-22T00:30:00.000Z'}]}];
 let count=0;h.setHandler(q=>q.action==='details'&&++count===1?firstChunk.promise:detail(P,1,0,20));
 const old=h.c.liveDetails();assert.equal(count,1);h.c.liveReset();firstChunk.resolve(detail(P,1,0,20));await old;
 assert.equal(count,1,'late first chunk must not continue into another database read after reset');assert.equal(h.L.detail,null);assert.match(h.html(),/请先选择一个商户（平台）/);
});

test('provider-only retry keeps returned data and only requests the failed platform',async()=>{
 const p2={...P,id:'partial-retry',name:'Retry platform'},h=await ready({page:'providers',platforms:[P,p2]});h.L.feeLookupRows=[];setScope(h,{platform:'all'});h.setHandler(async q=>{if(q.platformId===p2.id)throw Error('Synthetic failure');return completeAggregate(P,20,7)});await h.c.liveQuery();const kept=h.L.results[0];assert.equal(h.L.queryPlatforms.length,2);assert.equal(h.L.queryFailures.length,1);assert.match(h.html(),/已返回 1 \/ 2 个平台/);
 const pending=deferred(),retried=[];h.setHandler(q=>{retried.push(q);assert.equal(q.platformId,p2.id);return pending.promise});const run=h.c.liveRetryFailed();await settle();assert.equal(h.L.queryRetrying,true);assert.equal(h.L.results[0],kept);assert.match(h.html(),/代收成功金额/);assert.match(h.html(),/代收三方汇总（部分结果）/);await h.c.liveRetryFailed();assert.equal(retried.length,1,'duplicate clicks cannot repeat the retry');pending.resolve(completeAggregate(p2,30,8));await run;assert.equal(h.L.results.length,2);assert.equal(h.L.results[0],kept);assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.queryWarnings.length,0);assert.equal(h.L.queryRetrying,false);assert.equal(retried.length,1,'retry does not fan out into a new whole-platform comparison query');assert.doesNotMatch(h.html(),/仅显示已返回平台的部分结果/);
});
test('filter changes invalidate a failed-platform retry before its late result can join a different scope',async()=>{
 const p2={...P,id:'stale-retry',name:'Late retry'},h=await ready({page:'providers',platforms:[P,p2]});h.L.feeLookupRows=[];setScope(h,{platform:'all'});h.setHandler(async q=>{if(q.platformId===p2.id)throw Error('Synthetic failure');return completeAggregate(P,20,7)});await h.c.liveQuery();const pending=deferred();let calls=0;h.setHandler(()=>{calls++;return pending.promise});const run=h.c.liveRetryFailed();await settle();h.c.liveSet('provider','Changed provider');assert.equal(h.L.queryRetrying,false);await h.c.liveRetryFailed();assert.equal(calls,1,'dirty filters cannot use a stale retry scope');pending.resolve(completeAggregate(p2,1000,999));await run;assert.equal(h.L.results.length,1);assert.equal(h.L.results[0].platform.id,P.id);assert.match(h.html(),/筛选条件已修改/);
});
test('provider summaries bound a daily timeout to three-hour pieces and discard incomplete platforms',async()=>{
 for(const page of ['providers','provider_payout']){
  const h=await ready({page});h.L.feeLookupRows=[];setScope(h,{platform:P.id,from:'2026-09-22T00:00:00',to:'2026-09-22T23:59:59'});let requests=[];h.setHandler(async q=>{requests.push(q);throw Error('Synthetic timeout')});await h.c.liveQuery();assert.equal(requests.length,4,'a failed three-hour segment stops this platform without unbounded retries');assert.equal(h.L.results.length,0);assert.equal(h.L.queryFailures.length,1);assert.match(h.html(),/本次尚无平台返回/);
  requests=[];const start='2026-09-21T18:30:00.000Z';h.setHandler(async q=>{requests.push(q);if(Date.parse(q.endAt)-Date.parse(q.startAt)>3*3600000||q.startAt!==start)throw Error('Synthetic timeout');return completeAggregate(P,9999,9999)});await h.c.liveQuery();assert.equal(requests.length,5);assert.equal(h.L.results.length,0,'one successful segment cannot become a completed platform');assert.equal(h.L.queryFailures.length,1);assert.doesNotMatch(h.html(),/>999,900\.00</);
 }
});
test('provider multi-day reads start bounded, preserve exact endpoints and reject a partial-day result',async()=>{
 const h=await ready({page:'providers'});h.L.feeLookupRows=[];setScope(h,{platform:P.id,from:'2026-09-20T12:34:56',to:'2026-09-22T12:34:55'});const accepted=[],requests=[];h.setHandler(async q=>{requests.push(q);if(Date.parse(q.endAt)-Date.parse(q.startAt)>86400000)throw Error('Synthetic timeout');accepted.push(q);return completeAggregate(P,10,4)});await h.c.liveQuery();assert.equal(requests.length,4);assert.equal(accepted.length,4);assert(requests.every(q=>Date.parse(q.endAt)-Date.parse(q.startAt)===86400000),'no failing whole-range attempt precedes the daily requests');assert.equal(h.L.results[0]._parts.length,2);assert.equal(h.L.results[0].summary[0].all_count,20);assert.equal(accepted[0].startAt,'2026-09-20T07:04:56.000Z');assert.equal(accepted[0].endAt,accepted[1].startAt);assert.equal(accepted[1].endAt,'2026-09-22T07:04:56.000Z');
 let attempts=0;h.setHandler(async q=>{attempts++;if(attempts===2)return completeAggregate(P,500,499);throw Error('Synthetic timeout')});await h.c.liveQuery();assert.equal(attempts,5);assert.equal(h.L.results.length,0);assert.equal(h.L.queryFailures.length,1);
});

test('overview fills all fee rollups, merges provider sources, and keeps manual amounts outside provider ranking',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222',name:'Other platform',source:'newar'},h=await ready({platforms:[P,p2]});
 const a=completeAggregate(P,10,3),b=completeAggregate(p2,20,7),manual={...stats(2,'200'),provider:'人工充值',success_count:2,created_success_count:2,success_amount:'200',pending_count:0,pending_amount:0,failed_count:0,failed_amount:0};
 a.groups.provider=[{...a.summary[0],provider:'UPI-QR'},manual];a.summary=[{...a.summary[0],all_count:12,all_amount:'1200',success_count:5,created_success_count:5,success_amount:'500'}];b.groups.provider=[{...b.summary[0],provider:'UPI-QR'}];
 h.L.results=[a,b];h.L.feeLookupRows=[{scopeType:'country',country:'印度',provider:'UPI-QR',collectFee:'4%'},{scopeType:'platform',country:'印度',platform:p2.name,provider:'UPI-QR',collectFee:'5%'}];h.L.direction='charge';h.L.comparisonStatus='idle';h.c.state.page='overview';h.c.render();
 const tables=renderedTables(h.html()),provider=tables.find(t=>t.headers[0]==='三方'),at=(t,row,label)=>plain(row[t.headers.indexOf(label)]);
 assert(!provider.headers.includes('包网来源'));assert(!provider.headers.includes('方向'));assert.equal(provider.rows.length,2);
 assert.deepEqual(provider.headers,['三方','类型','全部金额','全部笔数','成功金额','金额占比','成功笔数','笔数占比','成功率','手续费率','估算手续费','手续费占比']);assert.match(h.html(),/table class="df-provider-business-table"/);
 const pay=provider.rows.find(r=>plain(r[0])==='UPI-QR'),man=provider.rows.find(r=>plain(r[0])==='人工充值');
 assert.equal(at(provider,pay,'估算手续费'),'47.00');assert.match(at(provider,pay,'手续费率'),/4\.00%/);assert.match(at(provider,pay,'手续费率'),/5\.00%/);assert.equal(at(provider,pay,'手续费占比'),'100.00%');assert.equal(at(provider,pay,'成功金额'),'1,000.00');assert.equal(at(provider,pay,'金额占比'),'83.33%');assert.equal(at(provider,pay,'成功笔数'),'10');assert.equal(at(provider,pay,'笔数占比'),'83.33%');assert.equal(at(provider,pay,'成功率'),'33.33%');assert.equal(at(provider,man,'成功率'),'不适用');assert.equal(at(provider,man,'估算手续费'),'不适用');
 for(const first of ['团队','国家']){const t=tables.find(t=>t.headers[0]===first);assert.equal(at(t,t.rows[0],'估算手续费'),'47.00');assert.equal(at(t,t.rows[0],'成功金额'),'1,200.00')}
 const platform=tables.find(t=>t.headers[0]==='平台');assert.deepEqual(platform.rows.map(r=>at(platform,r,'估算手续费')).sort(),['12.00','35.00']);
 const ranks=h.html().match(/<div class="df-flow-provider-extremes"[^]*?<div class="df-flow-foot">/)[0];assert.doesNotMatch(ranks,/人工充值|人工确认/);assert.match(ranks,/暂无符合笔数条件的三方/);
 for(const t of tables.filter(t=>['团队','国家','平台','三方'].includes(t.headers[0])))for(const row of t.rows)assert.equal(row.length,t.headers.length,'compact columns align');
});
test('merged canonical provider order drawer includes matching aliases from each source',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222',source:'newar'},h=await ready({platforms:[P,p2]}),a=completeAggregate(P,5,3),b=completeAggregate(p2,5,3);a.groups.provider[0].provider='Intnet';b.groups.provider[0].provider='Intnet-QR';h.L.results=[a,b];h.L.loading=false;h.L.dirty=false;
 const reads=[];h.setHandler(q=>{reads.push(q);return detail(q.platformId===P.id?P:p2,3,q.offset,q.limit)});await h.c.liveProviderOrders('Intnet','','charge');assert.equal(reads.length,2);assert.deepEqual(reads.map(q=>q.platformId).sort(),[P.id,p2.id].sort());assert(reads.every(q=>q.providers[0]==='Intnet'&&q.status==='success'));assert.match(h.drawers.at(-1).html,/6 笔/);
});

test('overview adds direction-specific workorder rankings only beside the fee totals',async()=>{
 const h=await ready();h.c.render();h.L.workorders={coverage:{complete:true},byProvider:[
  {provider:'Intnet',direction:'charge',submittedCount:100,successCount:80,successAmount:8000,notReceivedCount:20,notReceivedAmount:2000},
  {provider:'Intnet-QR',direction:'charge',submittedCount:50,successCount:40,successAmount:4000,notReceivedCount:10,notReceivedAmount:1000},
  {provider:'GoodPay',direction:'charge',submittedCount:200,successCount:196,successAmount:19600,notReceivedCount:4,notReceivedAmount:400},
  {provider:'NoSuccess',direction:'charge',submittedCount:40,successCount:0,successAmount:0,notReceivedCount:40,notReceivedAmount:5000},
  {provider:'人工确认',direction:'charge',submittedCount:900,successCount:900,successAmount:900000,notReceivedCount:0,notReceivedAmount:0},
  {provider:'PayoutOnly',direction:'withdraw',submittedCount:10,successCount:9,successAmount:900,notReceivedCount:1,notReceivedAmount:100}
 ],rows:[{provider:'PageOnlyFake',direction:'charge',submittedCount:99999}]};
 const before=h.calls.length;h.c.render();const ranks=[...h.html().matchAll(/<div class="df-workorder-ranks"[^]*?(?=<\/div><\/div><\/section>)/g)].map(x=>x[0]);
 assert.equal(ranks.length,2);assert.match(ranks[0],/存款 · 未到账最多/);assert.match(ranks[0],/存款 · 工单到账率较高/);assert(ranks[0].indexOf('NoSuccess')<ranks[0].indexOf('Intnet'));assert.match(ranks[0],/30 笔/);assert.match(ranks[0],/3,000/);assert.match(ranks[0],/98\.00%/);assert.match(ranks[0],/196\/200/);assert.match(ranks[0],/19,600/);assert.doesNotMatch(ranks[0],/PayoutOnly|人工确认|PageOnlyFake|Intnet-QR/);assert.match(ranks[1],/PayoutOnly/);assert.doesNotMatch(ranks[1],/GoodPay|Intnet/);assert.equal(h.calls.length,before,'rendering ranks reuses the workorder summary');
 assert.match(h.html(),/估算手续费[^]*?df-state-tail[^]*?df-workorder-ranks/);
});
test('workorder ranks distinguish partial coverage, no data and failed reads',async()=>{
 const h=await ready();h.c.render();h.L.workorders={coverage:{complete:false,capturedPlatformDays:13,expectedPlatformDays:17,platforms:[{platform:'Missing <platform>',days:0,expectedDays:1,complete:false}]},unsupportedPlatforms:['Unsupported <source>'],byProvider:[{provider:'SomePay',direction:'charge',submittedCount:1,successCount:1,successAmount:10,notReceivedCount:0,notReceivedAmount:0}]};h.c.render();assert.match(h.html(),/工单覆盖 13 \/ 17 平台日/);assert.match(h.html(),/Missing &lt;platform&gt;/);assert.match(h.html(),/Unsupported &lt;source&gt;/);assert.doesNotMatch(h.html(),/<details class="df-workorder-coverage"/);for(const card of h.html().matchAll(/<section class="df-workorder-rank [^"]*">([\s\S]*?)<\/section>/g))assert.doesNotMatch(card[1],/<small class="df-rank-rule"/);assert.match(h.html(),/暂无达到30笔/);assert.match(h.html(),/暂无已采集的取款三方工单/);assert.match(h.html(),/已采集工单暂无未到账/);assert.doesNotMatch(h.html(),/工单到账率较高<small>部分/);
 h.L.workorders=null;h.L.workordersError='Synthetic timeout';h.c.render();assert.match(h.html(),/工单读取未完成/);assert.doesNotMatch(h.html(),/SomePay|已采集工单暂无未到账/);
});

test('overview shortlists major providers, excludes small samples and omits ArbPay only from collection high ranking',async()=>{
 const h=await ready(),r=completeAggregate(P,50000,30000),row=(provider,count,success,direction='charge')=>({...stats(count,String(count*100)),provider,direction,success_count:success,success_amount:String(success*100),created_success_count:1});
 r.groups.provider=[row('ArbPay',15000,15000),row('TinyPerfect',9,9),...Array.from({length:11},(_,i)=>row('Major'+i,10000-i*500,6000-i*400)),row('ArbPay',15000,15000,'withdraw'),row('PayoutOther',12000,11000,'withdraw')];
 h.L.results=[r];h.L.direction='all';h.L.feeLookupRows=[];h.c.render();
 const cards=[...h.html().matchAll(/<div class="df-provider-rank high">([^]*?)<\/div><div class="df-provider-rank low">/g)].map(x=>x[1]);assert.equal(cards.length,2);
 assert.doesNotMatch(cards[0],/<span>ArbPay<\/span>|TinyPerfect|Major10/);assert.doesNotMatch(cards[0],/不含 ArbPay/);assert.match(cards[0],/Major0/);assert.match(cards[1],/<span>ArbPay<\/span>/);
 const providers=renderedTables(h.html()).filter(t=>t.headers[0]==='三方');assert(providers.some(t=>t.rows.some(r=>plain(r[0])==='ArbPay')),'ArbPay remains in ledger');
});

test('success-time comparison permits over 100 percent while old cohort validation and zero denominator remain intact',async()=>{
 const h=await ready(),api=h.c.HensemLiveCompare;assert.equal(api.ratioDelta(120,100,90,100).display,'+30.00 个百分点');assert.equal(api.rateDelta(120,100,90,100).value,null);
 for(const input of [[1,0,1,1],[1,1,1,0],[null,1,1,1],[-1,1,1,1],[1,1,'bad',1]])assert.equal(api.ratioDelta(...input).value,null);
 const a=completeAggregate(P,100,120),b=completeAggregate(P,100,90);a.summary[0].created_success_count=60;b.summary[0].created_success_count=50;h.L.results=[a];h.L.comparisonResults=[b];h.L.comparisonStatus='ready';h.c.render();
 const card=h.html().match(/id="df-collect">([^]*?)<\/section>/)[1];assert.match(card,/120\.00%/);assert.match(card,/\+30\.00 个百分点/);assert.doesNotMatch(card,/\+10\.00 个百分点/);
});

test('daily success metrics retain cross-day completions when that day has no created orders',async()=>{
 const h=await ready(),a=completeAggregate(P,0,4);a.groups.daily=[{...a.summary[0],provider:'Synthetic provider',date:'2026-09-25'}];h.L.results=[a];h.L.to='2026-09-25T23:59:59';h.L.from='2026-09-25T00:00:00';h.L.dailyMetric='success_amount';h.c.state.page='provider_daily';h.c.render();
 let matrix=h.html().match(/<div class="[^"]*pd-matrix-wrap live-daily-matrix">([^]*?)<\/div>/)[1];assert.match(matrix,/2026-09-25[^]*?>400\.00<\/button>/);
 h.L.dailyMetric='success_count';h.c.render();matrix=h.html().match(/<div class="[^"]*pd-matrix-wrap live-daily-matrix">([^]*?)<\/div>/)[1];assert.match(matrix,/2026-09-25[^]*?>4<\/button>/);
 h.L.dailyMetric='rate';h.c.render();matrix=h.html().match(/<div class="[^"]*pd-matrix-wrap live-daily-matrix">([^]*?)<\/div>/)[1];assert.doesNotMatch(matrix,/Infinity|NaN|400\.00/);
});

test('analysis matrix expands cell and row aggregates without querying and keeps overview free of expansion controls',async()=>{
 const h=await ready();h.L.results=[completeAggregate(P,10,4)];h.L.results[0].groups.matrix[0].success_count=12;h.L.results[0].groups.matrix[0].success_amount='1200';h.L.matrixMode='exact';h.L.direction='charge';h.c.state.page='matrix';h.c.render();const before=h.calls.length;assert.match(h.html(),/liveMatrixSegment/);assert.match(h.html(),/明细/);assert.match(h.html(),/120\.00%/);h.c.liveMatrixSegment(encodeURIComponent(JSON.stringify({kind:'matrix',direction:'charge',hour:12,bucket:'200'})));assert.match(h.html(),/各平台占比/);assert.match(h.html(),/Synthetic platform/);assert.equal(h.calls.length,before);h.c.state.page='overview';h.c.render();assert.doesNotMatch(h.html(),/liveMatrixSegment|analysis-expand-table/);
});

test('overview discovers report-only teams across countries and reads them without issuing order or provider-option queries',async()=>{
 const report={name:'BET6867',team:'胖虎',country:'胖虎巴西',system:'REPORT',dataset:'volume',rawCountry:'胖虎巴西',rawPlatform:'BET6867',directions:['charge','withdraw'],records:2,provenance:{kind:'google_sheets'}};
 const h=await ready({reports:true,handler:q=>q.action==='catalog'?{platforms:[{...P,team:'M8'}]}:q.action==='collectedData'?{rows:[report]}:q.action==='reportSummary'?{feeds:q.feeds.map(f=>({...f,rawCountry:f.country,rawPlatform:f.platform,status:'received',groups:[{grain:'provider',records:1,metrics:{amount:500,count:5,successAmount:null,successCount:null},providers:[{provider:'Example',records:1,metrics:{amount:500,count:5}}],daily:[]}]}))}:q.action==='rates'?{rows:[],total:0}:aggregate(P)});
 assert.match(h.nodes.get('liveFilters').innerHTML,/value="胖虎"/);assert.match(h.nodes.get('liveFilters').innerHTML,/value="M8"/);
 const before=h.calls.length;h.c.liveSetMultiOption('team',{value:'胖虎',checked:true});assert.equal(h.L.country,'巴西');h.c.liveQuery();await settle();
 const calls=h.calls.slice(before);assert(calls.some(q=>q.action==='reportSummary'));assert(!calls.some(q=>['aggregate','details','providerOptions'].includes(q.action)));
 assert.match(h.html(),/BET6867/);assert.match(h.html(),/Google 表格 → Supabase/);assert.match(h.html(),/500\.00/);assert.doesNotMatch(h.html(),/df-collect|df-payout/,'report-only data never paints misleading zero-order cards');assert.match(h.nodes.get('liveFilters').innerHTML,/已接入日报 \/ 配置 1 平台/);
 h.c.setPage('time');await settle();await h.c.liveQuery();await settle();assert.match(h.html(),/日报未提供|日报.*无法|源日报/);const n=h.calls.filter(q=>q.action==='reportSummary').length;h.c.setPage('overview');await settle();assert.match(h.html(),/BET6867/);assert.equal(h.calls.filter(q=>q.action==='reportSummary').length,n,'returning to a report-only overview restores its exact result without a report read');await h.c.liveQuery();await settle();assert.match(h.html(),/BET6867/);assert.equal(h.calls.filter(q=>q.action==='reportSummary').length,n+1,'the explicit query refreshes the exact report scope once');
});
test('incomplete report read cannot remove already loaded native order summaries',async()=>{
 const report={name:P.name,country:P.country,team:'M8',system:'REPORT',dataset:'volume',rawCountry:P.country,rawPlatform:P.name,directions:['charge'],records:1,provenance:{kind:'google_sheets'}};
 const h=await ready({reports:true,handler:q=>q.action==='catalog'?{platforms:[{...P,team:'M8'}]}:q.action==='collectedData'?{rows:[report]}:q.action==='reportSummary'?Promise.reject(Error('synthetic report timeout')):q.action==='rates'?{rows:[],total:0}:aggregate(P)});
 assert.equal(h.L.results.length,1);assert.match(h.html(),/df-collect/);assert.match(h.html(),/日报读取未完成/);assert.match(h.html(),/synthetic report timeout/);assert.doesNotMatch(h.html(),/所选日期未收到日报/);
});

test('report-only Panghu quick dates follow Brazil calendar at the India midnight boundary',async()=>{
 const report={name:'BET6867',team:'胖虎',country:'胖虎巴西',system:'REPORT',dataset:'volume',rawCountry:'胖虎巴西',rawPlatform:'BET6867',directions:['charge'],records:1,provenance:{kind:'google_sheets'}};
 const h=await ready({reports:true,handler:q=>q.action==='catalog'?{platforms:[P]}:q.action==='collectedData'?{rows:[report]}:aggregate(P)});h.setNow('2026-09-26T02:00:00Z');h.c.liveSet('team','胖虎');h.c.livePeriod('yesterday',false);assert.equal(h.L.country,'巴西');assert.equal(h.L.from,'2026-09-24T00:00:00');assert.equal(h.L.to,'2026-09-24T23:59:59');assert.match(h.nodes.get('liveFilters').innerHTML,/America\/Sao_Paulo/);
});

test('main filters retain all authorized Panghu seeds after report catalog failure without querying native Brazil orders',async()=>{
 const brazil={...P,id:'44444444-4444-4444-8444-444444444444',name:'BET6867',country:'巴西',team:'M8',currency:'BRL',timezone:'America/Sao_Paulo'},seeds=Array.from({length:31},(_,i)=>({id:'withdraw-'+i,name:i===0?'BET6867':i===1?'5C555':'PANGHU-'+i,country:'胖虎巴西',team:'胖虎',scopeGroup:'BR_PANGHU',currency:'BRL',timezone:'America/Sao_Paulo'}));
 const h=await ready({reports:true,handler:q=>q.action==='catalog'?{platforms:[{...P,team:'M8'},brazil,{...P,id:'hk',country:'香港',team:'香港'},{...P,id:'red',country:'红膏蟹',team:'红膏蟹'}],withdrawPlatforms:seeds}:q.action==='collectedData'?Promise.reject(Error('synthetic catalog timeout')):q.action==='rates'?{rows:[],total:0}:aggregate(P)});
 const filters=h.nodes.get('liveFilters').innerHTML,countries=filters.match(/id="live-country"[^]*?<\/select>/)[0];assert.match(filters,/value="胖虎"/);assert.match(countries,/>巴西<\/option>/);assert.doesNotMatch(countries,/>胖虎巴西<|>香港<|>红膏蟹</);assert.doesNotMatch(countries,/国家待核对/);assert.match(countries,/>印度<\/option>/);
 const before=h.calls.length;h.c.liveSet('team','胖虎');assert.equal(h.L.country,'巴西');assert.match(h.nodes.get('liveFilters').innerHTML,/仅目录 31 平台 · 数据待确认/);h.c.liveQuery();await settle();assert(!h.calls.slice(before).some(q=>['aggregate','providerOptions','details'].includes(q.action)));assert.match(h.html(),/日报读取未完成/);assert.doesNotMatch(h.html(),/df-collect|df-payout/);
});

test('matrix cell selection renders only that hour below its band and supports closing it',async()=>{
 const h=await ready(),r=completeAggregate(P,10,4);r.groups.matrix.push({...r.groups.matrix[0],hour:13,success_amount:'99000',success_count:990,all_amount:'100000',all_count:1000});h.L.results=[r];h.L.matrixMode='exact';h.L.direction='charge';h.c.state.page='matrix';h.c.render();const before=h.calls.length,encoded=encodeURIComponent(JSON.stringify({kind:'matrix',direction:'charge',hour:12,bucket:'200'}));h.c.liveMatrixSegment(encoded);
 let html=h.html(),detail=html.match(/<div class="analysis-drilldown">([^]*?)<div class="analysis-note">/)[1];assert.match(detail,/12时 × 200/);assert.doesNotMatch(detail,/24小时合计|99,000/);assert.match(detail,/400\.00/);assert.match(detail,/金额占比 100\.00%/);assert(html.indexOf('<div class="analysis-drilldown">')<html.indexOf('<span class="matrix-band-label">300</span>'));assert.equal(h.calls.length,before);
 h.c.liveMatrixSegment(encoded);assert.doesNotMatch(h.html(),/<div class="analysis-drilldown">/);assert.equal(h.calls.length,before);
});

test('provider business type columns remain separate and reuse loaded source labels on all provider reports',async()=>{
 const h=await ready();h.L.results=[completeAggregate(P,20,5)];const provider=h.L.results[0].groups.provider[0].provider;
 h.L.feeLookupRows=[{country:'印度',scopeType:'country',provider,collectFee:'4%',payoutFee:'2%',sourceType:'跑分',sourceTypeProvider:provider,sheetName:'Synthetic original',sourceTypeCell:'B2'}];
 for(const [page,first] of [['overview','三方'],['providers','统一三方'],['provider_payout','统一三方'],['provider_daily','三方'],['risk','三方']]){
  h.c.state.page=page;h.L.view='business';h.L.direction='all';h.c.render();const table=renderedTables(h.html()).find(t=>t.headers[0]===first&&t.headers.includes('类型'));assert(table,page+' type column');
  for(const row of table.rows)assert.equal(row.length,table.headers.length,page+' aligned type cells');
  if(table.rows.length)assert.equal(plain(table.rows[0][table.headers.indexOf('类型')]),'跑分',page+' uses source business type');
 }
 h.L.feeLookupError='Synthetic type lookup failure';h.L.feeLookupRows=[];h.c.state.page='providers';h.c.render();assert.match(h.html(),/provider-business-type review[^>]*>读取失败</);
});


test('platform summary retains successful empty reads with dashes without changing totals or adding failed platforms',async()=>{
 const empty={...P,id:'empty-native',name:'Empty <platform>'},failed={...P,id:'failed-native',name:'Failed platform'},unselected={...P,id:'unselected-native',name:'Unselected platform'},h=await ready({platforms:[P,empty,failed]}),populated=completeAggregate(P,10,3),noData=p=>({platform:p,total:0,summary:[],groups:{}});
 h.L.results=[populated,noData(empty),noData(unselected)];h.L.queryPlatforms=[P,empty,failed];h.L.queryFailures=[{id:failed.id,name:failed.name,message:'Synthetic timeout'}];h.L.direction='all';h.L.comparisonStatus='idle';h.L.feeLookupRows=[];const before=JSON.stringify(h.L.results);h.c.render();
 const platforms=renderedTables(h.html()).filter(t=>t.headers[0]==='平台');assert.equal(platforms.length,2);
 const charge=platforms[0],missing=charge.rows.find(row=>row[0].includes('Empty &lt;platform&gt;'));assert(missing);assert.match(missing[0],/本期未收到订单数据/);assert.deepEqual(missing.slice(1).map(plain),Array(charge.headers.length-1).fill('—'));assert.equal(charge.rows.length,2);
 const footer=charge.html.match(/<tfoot>([^]*?)<\/tfoot>/)[1];assert.match(footer,/1,000\.00/);assert.match(footer,/>10</);assert.match(footer,/300\.00/);assert.doesNotMatch(charge.html,/Failed platform|Unselected platform|<platform>/);
 assert.equal(platforms[1].rows.length,2,'each successfully queried platform stays visible when only the opposite direction had records');assert(platforms[1].rows.every(row=>row.slice(1).map(plain).every(value=>value==='—')));
 const ranks=[...h.html().matchAll(/<div class="df-flow-provider-extremes"[^]*?<div class="df-flow-foot">/g)].map(m=>m[0]).join('');assert.doesNotMatch(ranks,/Empty|Failed|Unselected/);assert.equal(JSON.stringify(h.L.results),before);
});

test('empty platform placeholders require a complete success response and stay out of other dimensions',async()=>{
 const p={...P,id:'empty-native',name:'NoData platform'},h=await ready({platforms:[P,p]}),r=completeAggregate(P,10,3);h.L.direction='charge';h.L.feeLookupRows=[];h.L.queryPlatforms=[P,p];
 const platformTable=()=>renderedTables(h.html()).find(t=>t.headers[0]==='平台');
 for(const empty of [{platform:p,total:0,groups:{}},{platform:p,total:2,summary:[],groups:{}},{platform:p,total:0,summary:[],groups:{provider:[{direction:'charge',all_count:1}]}}]){h.L.results=[r,empty];h.c.render();assert.doesNotMatch(platformTable().html,/NoData platform/,'an incomplete or inconsistent response is not evidence of no data');}
 h.L.results=[r,{platform:p,total:0,summary:[],groups:{}}];h.c.render();assert.match(platformTable().html,/NoData platform/);
 for(const table of renderedTables(h.html()).filter(t=>['团队','国家','三方'].includes(t.headers[0])))assert.doesNotMatch(table.html,/本期未收到订单数据/);
 h.L.queryFailures=[{id:p.id,message:'Synthetic failure'}];h.c.render();assert.doesNotMatch(platformTable().html,/NoData platform/,'a failed request never becomes an empty result');
});

test('zero-success ordinary payouts leave both overview rankings and the next provider fills the volume shortlist',async()=>{
 const h=await ready(),r=completeAggregate({...P,source:'game66',team:'香港'},50000,30000),row=(provider,count,success)=>({...stats(count,String(count*100)),provider,direction:'withdraw',success_count:success,success_amount:String(success*100)});
 r.groups.provider=[row('普通提现',20000,0),row('RealFailedPay',19000,0),...Array.from({length:8},(_,i)=>row('RankedPay'+i,18000-i*1000,Math.floor((18000-i*1000)*(0.9-i*0.1)))),row('ReplacementPay',10000,100)];
 const before=JSON.stringify(r.groups.provider);h.L.results=[r];h.L.direction='withdraw';h.L.feeLookupRows=[];h.c.render();
 const ranks=h.html().match(/<div class="df-flow-provider-extremes"[^]*?<div class="df-flow-foot">/)[0];
 assert.doesNotMatch(ranks,/<span>普通提现<\/span>/);assert.match(ranks,/RealFailedPay/,'real zero-success providers remain visible');assert.match(ranks,/ReplacementPay/,'remove the excluded row before taking the top ten by volume');
 const providers=renderedTables(h.html()).find(t=>t.headers[0]==='三方'),ordinary=providers.rows.find(r=>plain(r[0])==='普通提现');assert(ordinary,'ordinary payouts remain in the ledger');assert.equal(plain(ordinary[providers.headers.indexOf('全部笔数')]),'20,000');assert.equal(plain(ordinary[providers.headers.indexOf('成功金额')]),'0.00');assert.equal(JSON.stringify(r.groups.provider),before,'ranking leaves source aggregates intact');
});

test('ordinary withdrawal exclusion requires both known success metrics to be zero and never applies to collections',async()=>{
 const h=await ready(),r=completeAggregate({...P,source:'game66',team:'红膏蟹'},5000,1000),row=(amount,count,direction='withdraw')=>({...stats(5000,'500000'),provider:'普通提现',direction,success_amount:amount,success_count:count});
 h.L.results=[r];h.L.feeLookupRows=[];
 for(const [amount,count,direction]of [['0',1,'withdraw'],['100',0,'withdraw'],[null,0,'withdraw'],['0',0,'charge']]){
  r.groups.provider=[row(amount,count,direction)];h.L.direction=direction;h.c.render();const ranks=h.html().match(/<div class="df-flow-provider-extremes"[^]*?<div class="df-flow-foot">/)[0];assert.match(ranks,/<span>普通提现<\/span>/,JSON.stringify({amount,count,direction}));
 }
 r.groups.provider=[row('0',0),row('100',1)];h.L.direction='withdraw';h.c.render();const ranks=h.html().match(/<div class="df-flow-provider-extremes"[^]*?<div class="df-flow-foot">/)[0];assert.match(ranks,/<span>普通提现<\/span>/,'evaluate after the same provider has been merged');
});

test('provider summaries recover day and half-day timeouts with exact three-hour segments',async()=>{
 const h=await ready({page:'providers'});setScope(h,{platform:P.id,from:'2026-09-20T00:00:00',to:'2026-09-20T23:59:59'});const accepted=[];
 h.setHandler(async q=>{if(q.action!=='aggregate')return {rows:[],total:0};if(Date.parse(q.endAt)-Date.parse(q.startAt)>3*3600000)throw Error('Synthetic timeout');accepted.push(q);return completeAggregate(P,10,3)});
 await h.c.liveQuery();assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.results.length,1);assert.equal(h.L.results[0]._parts.length,8);assert.equal(h.L.results[0].summary[0].all_count,80);assert.equal(h.L.results[0].summary[0].success_count,24);
 const parts=h.L.results[0]._parts;assert.equal(parts[0].startAt,'2026-09-19T18:30:00.000Z');assert.equal(parts.at(-1).endAt,'2026-09-20T18:30:00.000Z');for(let i=1;i<parts.length;i++)assert.equal(parts[i-1].endAt,parts[i].startAt);assert(accepted.every(q=>Date.parse(q.endAt)-Date.parse(q.startAt)===3*3600000));
 const failed=[];h.setHandler(async q=>{if(q.action!=='aggregate')return {rows:[],total:0};failed.push(q);throw Error('Synthetic timeout persists')});await h.c.liveQuery();assert.equal(failed.length,4);assert.equal(h.L.results.length,0,'failed subsegments never publish a partial platform as complete');assert.equal(h.L.queryFailures.length,1);
});

test('analysis navigation hides only the three retired entries and daily performance has two directions',async()=>{
 const h=await ready();h.c.state.navGroup='analysis';h.c.render();const nav=h.nodes.get('nav').innerHTML;for(const page of ['orders','collection','payout'])assert(!nav.includes('setPage(\''+page+'\')'));
 h.c.setPage('provider_daily');await settle();assert.equal(h.L.direction,'charge');assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/data-multi="direction"/);h.c.liveSet('direction','withdraw');assert.equal(h.L.direction,'withdraw');h.c.liveSet('direction','all');assert.equal(h.L.direction,'withdraw');h.c.liveReset();await settle();assert.equal(h.L.direction,'charge');
 h.c.setPage('providers');await settle();assert.equal(h.L.direction,'charge');h.c.setPage('provider_payout');await settle();assert.equal(h.L.direction,'withdraw');assert(h.c.pages.some(p=>p[0]==='orders'),'internal drilldown capabilities remain available');
});

test('platform candidates intersect team country and system and prune only invalid downstream selections',async()=>{
 const platforms=[{...P,id:'m8-ar',name:'M8 India AR',team:'M8',source:'ar'},
  {...P,id:'m8-new',name:'M8 India New',team:'M8',source:'newar'},
  {...P,id:'m8-br',name:'M8 Brazil',team:'M8',country:'巴西',currency:'BRL',source:'ar'},
  {...P,id:'crab',name:'XX5',team:'红膏蟹',country:'红膏蟹',source:'game66'},
  {...P,id:'hk',name:'HK ONLY',team:'香港',country:'香港',source:'game66'}];
 const h=await ready({reports:true,platforms});
 const control=key=>h.nodes.get('liveFilters').innerHTML.match(new RegExp('<details[^>]+data-multi="'+key+'"[^]*?</details>'))?.[0]||'';
 h.c.liveSet('team','M8');h.c.liveSet('source','ar');
 assert.match(control('platform'),/M8 India AR/);assert.doesNotMatch(control('platform'),/M8 India New|XX5|HK ONLY|M8 Brazil/);
 assert.match(control('source'),/AR系统/);assert.doesNotMatch(control('source'),/AA包网/);
 h.c.liveSet('platform','m8-ar');h.c.liveSetMultiOption('team',{value:'红膏蟹',checked:true});
 assert.equal(h.L.source,'ar');assert.equal(h.L.platform,'m8-ar','valid selected platform is retained when team range widens');
 assert.doesNotMatch(control('platform'),/XX5/,'system still intersects the widened team scope');
 h.c.liveSet('source','game66');assert.equal(h.L.platform,'all');assert.deepEqual(Array.from(h.L.multi.platform),[]);assert.match(control('platform'),/XX5/);assert.doesNotMatch(control('platform'),/HK ONLY|M8 India/);
 h.c.liveSet('platform','crab');h.c.liveSet('team','M8');assert.equal(h.L.source,'all','unavailable system is cleared');assert.equal(h.L.platform,'all');assert.doesNotMatch(control('platform'),/XX5|HK ONLY/);
 h.c.liveSet('platform','hk');assert.equal(h.L.platform,'all','stale hidden platform selections cannot survive dependency reconciliation');
 h.c.liveSet('country','巴西');assert.equal(h.L.team,'M8');assert.match(control('platform'),/M8 Brazil/);assert.doesNotMatch(control('platform'),/M8 India|XX5|HK ONLY/);
 assert.equal(h.L.catalog.length,5);assert.deepEqual(h.L.catalog.map(p=>p.id),platforms.map(p=>p.id),'authorized catalog is untouched');
});

test('dependency options preserve a restricted authorized catalog and never recreate ungranted team platforms',async()=>{
 const only={...P,id:'only',name:'AUTHORIZED ONLY',team:'红膏蟹',country:'红膏蟹',source:'game66'},h=await ready({reports:true,platforms:[only]});
 h.c.liveSet('team','红膏蟹');const html=h.nodes.get('liveFilters').innerHTML;
 assert.match(html,/AUTHORIZED ONLY/);assert.doesNotMatch(html,/XX5|XX6|HK ONLY|M8 India/);assert.equal(h.L.catalog.length,1);
 h.c.liveSet('country','巴西');assert.equal(h.L.country,'印度','country outside the selected authorized team is not accepted');
});

test('filter coverage distinguishes directory membership from returned transaction platform coverage',async()=>{
 const missing={...P,id:'missing',name:'REGISTERED WITHOUT DATA'},h=await ready({platforms:[P,missing]});
 h.L.queryPlatforms=[P,missing];h.L.results=[completeAggregate(P,20,10),{platform:missing,summary:[],groups:{}}];h.L.dirty=false;h.L.overviewQueried=true;h.c.render();
 let html=h.nodes.get('liveFilters').innerHTML;assert.match(html,/订单目录 2 平台/);assert.match(html,/所选日期有订单数据 1 平台/);
 h.L.queryFailures=[{id:'missing'}];h.c.render();assert.match(h.nodes.get('liveFilters').innerHTML,/已返回有订单数据 1 平台/);
 h.c.liveSet('from','2026-09-20T00:00:00');html=h.nodes.get('liveFilters').innerHTML;assert.doesNotMatch(html,/所选日期有订单数据|已返回有订单数据/,'old coverage is hidden after dates change');
});

test('pending and conflicting report ownership are status messages rather than selectable teams',async()=>{
 const h=await ready({reports:true,platforms:[{...P,team:'M8'}]});h.L.withdrawCatalog=[{name:'SUPERLG',country:'菲律宾',team:'M8',source:'withdraw'},{name:'PENDING',country:'巴基斯坦',team:null},{name:'CONFLICT',country:'印尼',team:'__team_conflict__'},{name:'LEGACY',country:'LG',team:'__unassigned__'}];h.c.render();
 const teams=()=>h.nodes.get('liveFilters').innerHTML.match(/<details[^>]+data-multi="team"[^]*?<\/details>/)[0];assert.match(teams(),/M8|未绑定团队/);assert.doesNotMatch(teams(),/__team_pending__|__team_conflict__|团队待读取|归属待核对/);assert.match(h.nodes.get('liveFilters').innerHTML,/部分平台团队待读取/);assert.match(h.nodes.get('liveFilters').innerHTML,/部分平台归属待核对/);
 h.c.liveSet('team','M8');h.c.liveSet('country','菲律宾');assert.equal(h.L.team,'M8');assert.match(h.nodes.get('liveFilters').innerHTML,/1 团队/);assert.match(h.nodes.get('liveFilters').innerHTML,/SUPERLG/);
 h.setHandler(q=>{if(q.action==='collectedData')throw Error('Synthetic directory timeout');return {rows:[],feeds:[],summary:[],groups:{}}});await h.c.liveQuery();assert.equal(h.L.team,'M8');assert.deepEqual(Array.from(h.L.multi.team),['M8']);assert.equal(h.L.country,'菲律宾');assert.match(teams(),/M8/);assert.doesNotMatch(teams(),/__team_pending__|__team_conflict__/);
});

test('LG native platforms enter the core overview with local order queries and keep report totals separate',async()=>{
 const lg={...P,id:'77777777-7777-4777-8777-777777777777',name:'LG-SYNTHETIC',source:'lg',sourceName:'LG-RAW',country:'菲律宾',scopeGroup:'PH',team:'M8',timezone:'Asia/Manila',currency:'PHP',capabilities:{systemOrderId:false,thirdPartyOrderNumber:false,utr:false,historicalFees:false,recordedFee:false,actualAmount:true}};
 const outside={...lg,id:'88888888-8888-4888-8888-888888888888',country:'巴基斯坦',scopeGroup:'PK',currency:'PKR',timezone:'Asia/Karachi'};
 const feed={dataset:'lg_success',system:'LG',name:lg.name,rawPlatform:lg.sourceName,country:lg.country,rawCountry:'PH',team:'M8',directions:['charge'],records:1,provenance:{kind:'direct'}};
 const h=await ready({reports:true,handler:q=>{
  if(q.action==='catalog')return {platforms:[lg,outside]};if(q.action==='collectedData')return {rows:[feed]};
  if(q.action==='reportSummary')return {feeds:q.feeds.map(f=>({...f,rawCountry:f.country,rawPlatform:f.platform,status:'received',groups:[{grain:'platform',records:1,metrics:{amount:900000,count:9000,successAmount:800000,successCount:8000},providers:[],daily:[]}]}))};
  if(q.action==='rates')return {rows:[],total:0};const result=completeAggregate(lg,43,7);for(const row of [...result.summary,...Object.values(result.groups).flat()])row.currency='PHP';return result;
 }});
 assert.equal(h.L.country,'菲律宾');assert.equal(h.L.currency,'PHP');assert.equal(h.L.results.length,1);assert.equal(h.L.results[0].summary[0].all_count,43);assert.equal(h.L.results[0].summary[0].success_count,7);assert.match(h.html(),/df-collect/);assert.match(h.html(),/900,000\.00/,'source-native report remains available as an independent comparison');
 const calls=h.calls.filter(q=>q.action==='aggregate');assert(calls.length);assert(calls.every(q=>q.platformId===lg.id&&q.currency==='PHP'));assert.equal(calls[0].startAt,'2026-09-21T16:00:00.000Z');assert.equal(calls[0].endAt,'2026-09-21T22:00:00.000Z');
 const filters=h.nodes.get('liveFilters').innerHTML;assert.match(filters,/LG系统/);assert.match(filters,/订单目录 1 平台/);assert.doesNotMatch(filters,/LG-SYNTHETIC · 日报/);assert.equal(h.L.results[0].summary[0].all_amount,'4300','report amount is never added to order metrics');
 h.c.setPage('provider_payout');await settle();await h.c.liveQuery();await settle();assert(h.calls.some(q=>q.action==='aggregate'&&q.platformId===lg.id&&q.direction==='withdraw'));assert.equal(h.L.direction,'withdraw');
});

test('LG order filters reject unavailable identifiers and do not label internal keys or raw zeros as source fees',async()=>{
 const lg={...P,id:'77777777-7777-4777-8777-777777777777',name:'LG-SYNTHETIC',source:'lg',country:'菲律宾',scopeGroup:'PH',team:'M8',timezone:'Asia/Manila',currency:'PHP',capabilities:{systemOrderId:false,thirdPartyOrderNumber:false,utr:false,historicalFees:false,recordedFee:false,actualAmount:true}};
 const h=await ready({platforms:[lg]});h.c.liveChoosePlatform(lg.id);await settle();
 for(const key of ['systemOrderId','thirdPartyOrderNumber','utr'])assert.match(h.nodes.get('liveFilters').innerHTML.match(new RegExp('<input[^>]*id="live-'+key+'"[^>]*>'))[0],/disabled/);
 Object.assign(h.L,{systemOrderId:'UNAVAILABLE-SYSTEM',thirdPartyOrderNumber:'UNAVAILABLE-THIRD',utr:'UNAVAILABLE-UTR',orderNumber:'REAL-ORDER'});const before=h.calls.length;await h.c.liveQuery();await settle();
 for(const q of h.calls.slice(before).filter(q=>['aggregate','details'].includes(q.action))){assert.equal(q.orderNumber,'REAL-ORDER');for(const key of ['systemOrderId','thirdPartyOrderNumber','utr'])assert(!Object.hasOwn(q,key));}
 h.L.detail={platform:lg,total:1,rows:[{id:'INTERNAL-HASH-NOT-SOURCE-ID',order_number:'REAL-ORDER',system_order_id:null,third_party_order_number:'UNAVAILABLE-THIRD',utr:'UNAVAILABLE-UTR',amount:100,actual_amount:99,withdraw_fee:0,direction:'withdraw',status_group:'success',currency:'PHP'}]};h.c.liveReferenceSet('view','orderFees');
 const table=renderedTables(h.html()).find(t=>t.headers.includes('实际手续费'));assert(table);assert.equal(plain(table.rows[0][table.headers.indexOf('系统 ID')]),'—');assert.equal(plain(table.rows[0][table.headers.indexOf('实际手续费')]),'—');
 h.c.liveOrder(0);const html=h.drawers.at(-1).html;assert.doesNotMatch(html,/INTERNAL-HASH-NOT-SOURCE-ID|UNAVAILABLE-THIRD|UNAVAILABLE-UTR/);assert.match(html,/99\.00/);assert.match(html,/不将空值当作零费用/);
});

test('native capability filters retain NEW_AR and GAME66 support and clear incompatible fields when changing to LG',async()=>{
 const base={...P,country:'菲律宾',scopeGroup:'PH',currency:'PHP',timezone:'Asia/Manila'},lg={...base,id:'lg-native',source:'lg'},newar={...base,id:'newar-native',source:'NEW_AR'},game={...base,id:'game-native',source:'game66'};
 const h=await ready({platforms:[lg,newar,game]});h.c.liveChoosePlatform(newar.id);await settle();
 const input=key=>h.nodes.get('liveFilters').innerHTML.match(new RegExp('<input[^>]*id="live-'+key+'"[^>]*>'))[0];assert.doesNotMatch(input('systemOrderId'),/disabled/);assert.doesNotMatch(input('thirdPartyOrderNumber'),/disabled/);assert.match(input('utr'),/disabled/);
 h.c.liveSet('systemOrderId','NEW-SYSTEM');h.c.liveSet('thirdPartyOrderNumber','NEW-THIRD');h.c.liveChoosePlatform(lg.id);await settle();assert.equal(h.L.systemOrderId,'');assert.equal(h.L.thirdPartyOrderNumber,'');assert.match(input('thirdPartyOrderNumber'),/disabled/);
 h.c.liveChoosePlatform(game.id);await settle();assert.doesNotMatch(input('thirdPartyOrderNumber'),/disabled/);assert.match(input('systemOrderId'),/disabled/);
});

test('an LG report directory row alone is not promoted to native orders',async()=>{
 const feed={dataset:'lg_success',system:'LG',name:'LG-REPORT-ONLY',rawPlatform:'LG-REPORT-ONLY',country:'菲律宾',rawCountry:'PH',team:'M8',directions:['charge'],records:1,provenance:{kind:'direct'}};
 const h=await ready({reports:true,handler:q=>q.action==='catalog'?{platforms:[],withdrawPlatforms:[{name:feed.name,country:feed.country,team:'M8',source:'withdraw'}]}:q.action==='collectedData'?{rows:[feed]}:q.action==='reportSummary'?{feeds:q.feeds.map(f=>({...f,rawCountry:f.country,rawPlatform:f.platform,status:'received',groups:[{grain:'platform',records:1,metrics:{amount:300,count:3},providers:[],daily:[]}]}))}:q.action==='rates'?{rows:[],total:0}:aggregate()});
 assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);assert.doesNotMatch(h.html(),/df-collect/);assert.match(h.html(),/LG-REPORT-ONLY/);assert.match(h.nodes.get('liveFilters').innerHTML,/LG-REPORT-ONLY · 日报 \/ 配置/);
});

test('LG intake order links use the exact authorized native platform while retaining the chosen direction',async()=>{
 const lg={...P,id:'77777777-7777-4777-8777-777777777777',name:'LG-SYNTHETIC',source:'lg',country:'菲律宾',scopeGroup:'PH',sourceName:'LG-RAW',team:'M8',timezone:'Asia/Manila',currency:'PHP'};
 const feed={id:'lg-order',timezone:'Asia/Manila',dataset:'lg_orders',system:'LG',name:lg.name,rawPlatform:lg.sourceName,country:lg.country,rawCountry:'PH',team:'M8',direction:'withdraw',defaultEnd:'2026-09-25',lastDate:'2026-09-22',sourceKind:'direct',platformId:lg.id};
 const h=await ready({page:'collected_data',reports:true,handler:q=>q.action==='catalog'?{platforms:[lg]}:q.action==='intakeCoverage'?intakeCoverageFixtureReply(q,[feed]):q.action==='collectedData'?{rows:[feed]}:q.action==='details'?detail(lg):q.action==='rates'?{rows:[],total:0}:aggregate(lg)});await h.c.collectedCoverageQuery();h.c.collectedExpand('lg-order');assert.match(h.html(),/查看当日数据/);h.c.collectedOpenDay('lg-order','2026-09-22');await settle();assert(!h.calls.some(q=>q.action==='details'));await h.c.liveQuery();await settle();assert.equal(h.c.state.page,'orders');assert.equal(h.L.platform,lg.id);assert.equal(h.L.country,'菲律宾');assert.equal(h.L.direction,'withdraw');assert.equal(h.L.from,'2026-09-22T00:00:00');assert(h.calls.some(q=>q.action==='details'&&q.platformId===lg.id&&q.direction==='withdraw'));assert(!h.calls.some(q=>q.action==='collectedData'&&q.operation==='rows'),'native orders must not return to the old report-only reader');
});

test('LG and GAME66-only workorder scopes clear stale results without querying the whole country',async()=>{
 for(const source of ['lg','game66']){
  const p={...P,id:source+'-native',name:source.toUpperCase()+' ONLY',source},h=await ready({page:'workorders',platforms:[p]});h.c.workorderOperationsMode('daily');await h.c.liveQuery();await settle();
  assert.equal(h.calls.filter(q=>q.action==='workorders').length,0,source+' never sends empty platforms to the workorder RPC');
  h.L.workorders={rows:[{platform:'OTHER SOURCE PRIVATE ROW'}],summary:{submittedAmount:999999,submittedCount:999},byProvider:[{provider:'OTHER SOURCE PRIVATE PAY',submittedCount:999}]};
  await h.c.liveQuery();assert.equal(h.L.workorders,null);assert.equal(h.L.workordersLoading,false);assert.match(h.html(),/所选平台来源尚未接入工单数据/);assert.doesNotMatch(h.html(),/OTHER SOURCE PRIVATE|999,999/);assert.equal(h.calls.filter(q=>q.action==='workorders').length,0);
  h.c.setPage('providers');await settle();await h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='workorders').length,0);assert.match(h.html(),/工单未接入/);assert.equal(h.L.workorders,null);
 }
});

test('mixed workorder scopes query only selected AR and NEW_AR source names and retain unsupported-source evidence',async()=>{
 const ar={...P,id:'ar-native',name:'AR DISPLAY',sourceName:'AR RAW',source:'AR'},newar={...P,id:'newar-native',name:'NEW DISPLAY',sourceName:'NEW RAW',source:'NEW_AR'},lg={...P,id:'lg-native',name:'LG ONLY',source:'lg'},game={...P,id:'game-native',name:'GAME ONLY',source:'game66'};
 const h=await ready({page:'workorders',platforms:[ar,newar,lg,game]});h.c.workorderOperationsMode('daily');await h.c.liveQuery();await settle();let q=h.calls.filter(q=>q.action==='workorders').at(-1);assert(q);assert.deepEqual(q.platforms.sort(),['AR DISPLAY','AR RAW','NEW DISPLAY','NEW RAW'].sort());assert.deepEqual(Array.from(h.L.workorders.unsupportedPlatforms),['LG ONLY','GAME ONLY']);
 h.c.liveSet('platform',lg.id);await h.c.liveQuery();assert.equal(h.L.workorders,null);assert.match(h.html(),/尚未接入工单/);assert.equal(h.calls.filter(q=>q.action==='workorders').length,1,'unsupported scope cannot fall back to the previously selected AR platform');
 h.c.liveSet('platform',newar.id);await h.c.liveQuery();q=h.calls.filter(q=>q.action==='workorders').at(-1);assert.deepEqual(q.platforms.sort(),['NEW DISPLAY','NEW RAW'].sort());assert.equal(h.L.workordersError,'');
});

test('backend system filter excludes report and configuration transport labels without removing their platforms',async()=>{
 const lg={...P,id:'lg-native',name:'LG NATIVE',country:'菲律宾',source:'lg',team:'M8'},report={dataset:'volume',system:'REPORT',name:'REPORT ONLY',rawPlatform:'REPORT ONLY',country:'菲律宾',rawCountry:'PH',team:'M8',directions:['charge'],records:1,provenance:{kind:'direct'}};
 const h=await ready({reports:true,handler:q=>q.action==='catalog'?{platforms:[lg]}:q.action==='collectedData'?{rows:[report]}:q.action==='reportSummary'?{feeds:q.feeds.map(f=>({...f,rawCountry:f.country,rawPlatform:f.platform,status:'not_received',groups:[]}))}:q.action==='rates'?{rows:[],total:0}:aggregate(lg)});
 const filters=h.nodes.get('liveFilters').innerHTML,system=filters.match(/<details[^>]*data-multi="source"[^]*?<\/details>/)?.[0];
 assert(system);assert.match(system,/LG系统/);assert.doesNotMatch(system,/日报|配置来源|value="reports"|value="REPORT"/);assert.match(filters,/REPORT ONLY/);
 h.c.liveSet('source','lg');assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/REPORT ONLY/);h.c.liveMultiClear('source');assert.match(h.nodes.get('liveFilters').innerHTML,/REPORT ONLY/);
});

// Local-only coverage receipt fixture for intake integration; no live database reads.
function intakeCoverageFixtureReply(q,feeds){if(q.operation==='catalog')return {version:1,complete:true,feeds};return {version:1,complete:true,checkedAt:'2026-09-26T01:00:00Z',feedIds:q.feedIds,startAt:q.startAt,endAt:q.endAt,rows:q.feedIds.flatMap(feedId=>{const rows=[];for(let t=Date.parse(q.startAt);t<=Date.parse(q.endAt);t+=86400000)rows.push({feedId,date:new Date(t).toISOString().slice(0,10),status:'received',received:true,complete:false,zeroConfirmed:false,expected:true});return rows})}}


test('confirmed RAJA catalog alias queries the authorized source once and displays RAJA without an empty duplicate',async()=>{
 const raw={...P,id:'11111111-1111-4111-8111-111111111111',name:'RAJA',sourceName:'RAJA',team:'M8'},alias={...raw,id:'22222222-2222-4222-8222-222222222222',name:'RAJALOTTERY',sourceName:'RAJALOTTERY'},platforms=[alias,raw];
 const h=await ready({reports:true,platforms,handler:async q=>q.action==='catalog'?{platforms}:q.action==='collectedData'?{rows:[]}:q.action==='rates'?{rows:[],total:0}:completeAggregate(platforms.find(p=>p.id===q.platformId)||raw,10,8)});
 const nativeCalls=h.calls.filter(q=>q.action==='aggregate');assert(nativeCalls.length>0);assert(nativeCalls.every(q=>q.platformId===raw.id));assert.equal(h.L.queryPlatforms.length,1);assert.equal(h.L.results[0].platform.name,'RAJA');assert.equal(h.L.results[0].platform.sourceName,'RAJA');
 const table=renderedTables(h.html()).find(t=>t.headers[0]==='平台');assert(table);assert.equal(table.rows.length,1);assert.equal(plain(table.rows[0][0]),'RAJA');assert.equal(plain(table.rows[0][table.headers.indexOf('成功笔数')]),'8');
 h.c.liveSet('platform',alias.id);assert.deepEqual(Array.from(h.L.multi.platform),[raw.id]);await h.c.liveQuery(true);assert.equal(h.L.queryPlatforms.length,1);assert.equal(h.L.queryPlatforms[0].id,raw.id);
 const subset=await ready({reports:true,platforms:[alias],handler:async q=>q.action==='catalog'?{platforms:[alias]}:q.action==='collectedData'?{rows:[]}:q.action==='rates'?{rows:[],total:0}:completeAggregate(alias,4,2)});assert(subset.calls.filter(q=>q.action==='aggregate').every(q=>q.platformId===alias.id),'no unauthorized source ID may be synthesized');
});


test('Brazil selectable directory keeps all 8 native and 60 report seeds without claiming current-day coverage',async()=>{
 const platforms=Array.from({length:8},(_,i)=>({...P,id:'BR-'+i,name:'SYNTHETIC-BR-'+i,country:'巴西',scopeGroup:'BR',team:'Synthetic Brazil',currency:'BRL',timezone:'America/Sao_Paulo'}));
 const seeds=Array.from({length:60},(_,i)=>({name:'SYNTHETIC-REPORT-'+i,country:'巴西',team:'Synthetic Brazil',source:'withdraw',currency:'BRL',timezone:'America/Sao_Paulo'}));
 const feeds=[0,1].map(i=>({name:seeds[i].name,rawPlatform:seeds[i].name,country:'巴西',rawCountry:'BR',team:'Synthetic Brazil',system:'REPORT',dataset:'volume',directions:['charge'],records:4,available:true,provenance:{kind:'direct'}}));
 const h=await ready({manualOverview:true,reports:true,platforms,handler:q=>q.action==='catalog'?{platforms,withdrawPlatforms:[...seeds,seeds[0],{...platforms[0],source:'withdraw'}]}:q.action==='collectedData'?{rows:feeds}:q.action==='reportSummary'?{feeds:q.feeds.map(f=>({...f,rawCountry:f.country,rawPlatform:f.platform,status:'not_received',groups:[]}))}:q.action==='rates'?{rows:[],total:0}:completeAggregate(platforms.find(p=>p.id===q.platformId)||platforms[0],10,8)});
 let html=h.nodes.get('liveFilters').innerHTML;
 assert.match(html,/可选目录 68 个平台/);assert.match(html,/订单目录 8 平台/);assert.match(html,/仅目录 60 平台 · 数据待确认/);assert.doesNotMatch(html,/已接入日报|所选日期有订单数据|仅日报/);
 assert.match(html,/live-filter-fields/);assert.match(html,/live-date-trigger/);assert.match(html,/live-query-actions/);assert.doesNotMatch(h.html(),/>查询数据<\/button>/);
 assert.equal(businessCalls(h).length,0);assert.equal(h.calls.filter(q=>q.action==='collectedData').length,0);
 await h.c.liveQuery();await settle();html=h.nodes.get('liveFilters').innerHTML;
 assert.match(html,/可选目录 68 个平台/);assert.match(html,/已接入日报 \/ 配置 2 平台/);assert.match(html,/仅目录 58 平台 · 数据待确认/);assert.equal(h.L.queryPlatforms.length,8);assert.equal(new Set(h.L.queryPlatforms.map(p=>p.id)).size,8);
 h.c.liveSet('from','2026-09-20T00:00:00');assert.doesNotMatch(h.html(),/>查询数据<\/button>/);assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/所选日期有订单数据/);
});

test('platform assignment input changes invalidate in-flight results and successful scopes are stamped',async()=>{
 const old=deferred(),h=await ready({manualOverview:true});h.c.state.page='teams';h.setHandler(q=>q.action==='platformAssignments'&&q.country==='巴西'?old.promise:q.action==='platformAssignments'?{rows:[{platform:'CURRENT INDIA',country:'印度'}],total:1,options:{},summary:{}}:aggregate());
 h.c.platformAssignmentsSet('teamPlatformCountry','巴西');const pending=h.c.platformAssignmentsLoad(true);await flush();const sent=h.calls.findLast(q=>q.action==='platformAssignments');assert.equal(sent.country,'巴西');
 h.c.platformAssignmentsSet('teamPlatformCountry','印度');assert.equal(h.L.platformAssignmentsDirty,true);assert.equal(h.L.platformAssignmentsLoading,false);old.resolve({rows:[{platform:'STALE BRAZIL',country:'巴西'}],total:1});await pending;
 assert.equal(h.L.platformAssignments,null);assert.equal(h.L.platformAssignmentsAppliedRequest,undefined);await h.c.platformAssignmentsLoad(true);assert.equal(h.L.platformAssignmentsAppliedRequest.country,'印度');assert.equal(h.L.platformAssignmentsDirty,false);assert.equal(h.L.platformAssignments.rows[0].platform,'CURRENT INDIA');
 h.c.platformAssignmentsSet('teamPlatformQuery','new query');assert.equal(h.L.platformAssignmentsDirty,true);assert.equal(h.L.platformAssignmentsAppliedRequest.platform,undefined,'applied scope is a captured object, not a live view of edited filters');
});


test('compact time panel keeps exact drafts and manual shortcuts while chrome keeps only export',async()=>{
 const h=await ready({manualOverview:true});h.c.render();let html=h.nodes.get('liveFilters').innerHTML;
 assert.match(html,/id="liveDatePanel" class="live-date-panel" hidden/);assert.match(html,/aria-controls="liveDatePanel"/);
 assert.equal(h.nodes.get('eyebrow').textContent,'');assert.equal(h.nodes.get('.bottom-note').innerHTML,'');
 assert.match(h.nodes.get('.title-actions').innerHTML,/liveExport/);assert.doesNotMatch(h.nodes.get('.title-actions').innerHTML,/全部平台数据|读取最新数据/);
 const before=businessCalls(h).length;h.c.liveDateRangeToggle(true);const filterWrites=h.writes.filter(w=>w.id==='liveFilters').length;h.c.liveDateSet('from','time','01:02:03');h.c.liveDateSet('to','time','04:05:06');
 assert.equal(h.writes.filter(w=>w.id==='liveFilters').length,filterWrites,'native date/time edits must not replace focused inputs or swallow the first Query/Done click');h.c.render();
 html=h.nodes.get('liveFilters').innerHTML;assert.match(html,/aria-expanded="true"/);assert.doesNotMatch(html,/class="live-date-panel" hidden/);assert.match(html,/value="01:02:03"/);assert.match(html,/value="04:05:06"/);assert.equal(businessCalls(h).length,before);
 h.c.liveDateRangeToggle(false);h.c.render();assert.match(h.nodes.get('liveFilters').innerHTML,/class="live-date-panel" hidden/);assert.equal(h.L.from,'2026-09-22T01:02:03');
 await h.c.liveQuery();const sent=businessCalls(h).slice(before).find(q=>q.action==='aggregate');assert.equal(sent.startAt,'2026-09-21T19:32:03.000Z');assert.equal(sent.endAt,'2026-09-21T22:35:07.000Z');
 h.c.state.page='providers';h.c.render();html=h.nodes.get('liveFilters').innerHTML;const previous=businessCalls(h).length;
 for(const [,handler]of html.matchAll(/onclick="(livePeriod[^";]+)"/g))vm.runInContext(handler,h.c);
 await settle();assert.equal(businessCalls(h).length,previous,'date shortcuts only stage conditions even on provider pages');assert.equal(h.L.dirty,true);
 h.L.catalogReady=false;h.L.catalogLoading=true;h.c.render();html=h.nodes.get('liveFilters').innerHTML;assert.match(html,/平台目录读取中/);assert.doesNotMatch(html,/可选目录 0|订单目录 0|0 三方|0 团队|0 国家/);
});

test('report empty states keep the filter Query action without a duplicate lower button',async()=>{
 const h=await ready({manualOverview:true,submissions:true});const before=businessCalls(h).length;
 for(const page of ['overview','providers','payout','merchantproviders','events','stuck','latency','time','amount','matrix','provider_daily','teamops','teamcountries','teamplatforms','merchants','collection','risk']){
  h.c.state.page=page;h.L.pageQueried=false;h.c.render();
  assert.notEqual(h.nodes.get('liveFilters').style.display,'none',page+' has visible filters');
  assert.match(h.nodes.get('liveFilters').innerHTML,/onclick="liveDateRangeToggle\(false\);liveQuery\(\)"/);
  assert.match(h.html(),/请选择筛选条件，点击查询/);assert.doesNotMatch(h.html(),/查询数据<\/button>|onclick="liveQuery\(\)"/);
 }
 h.c.state.page='providers';h.L.pageQueried=true;h.L.dirty=true;h.c.render();
 assert.match(h.html(),/筛选条件已修改，点击查询/);assert.doesNotMatch(h.html(),/查询数据<\/button>/);assert.equal(businessCalls(h).length,before);
});

test('standalone rates empty state retains its only Query action',async()=>{
 const h=await ready({manualOverview:true});h.c.state.page='rates';h.L.feeView='normalized';h.L.fees=null;h.L.feeLoading=false;h.L.feeError='';h.c.render();
 assert.equal(h.nodes.get('liveFilters').style.display,'none');assert.match(h.html(),/onclick="liveQuery\(\)">查询数据<\/button>/);
 const before=h.calls.filter(q=>q.action==='rates').length;await h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='rates').length,before+1);assert.match(h.html(),/当前三方费率表/);
});


test('overview uses one independent end-day backlog snapshot in both withdrawal cards while collection keeps its order cohort',async()=>{
 const h=await ready();const snapshot=h.calls.filter(q=>q.action==='pendingSnapshot');assert.equal(snapshot.length,1);assert.equal(snapshot[0].date,'2026-09-22');assert.deepEqual(snapshot[0].platformIds,[P.id]);
 const payout=h.html().match(/<section class="df-card" id="df-payout">([^]*?)<\/section>/)?.[1];assert(payout);const pending=payout.match(/<div class="df-flow-metric df-pending-snapshot">([^]*?)<\/div>/)?.[1];assert.match(pending,/875.50/);assert.match(pending,/7 笔/);assert.doesNotMatch(pending,/200.05|较前|按创建时间/);
 const collect=h.html().match(/<section class="df-card" id="df-collect">([^]*?)<\/section>/)?.[1];assert.match(collect,/处理中金额/);assert.match(collect,/200.05/);
 const backlog=h.html().match(/<section class="df-card" id="df-backlog">([^]*?)<\/section>/)?.[1];assert.match(backlog,/875.50/);assert.doesNotMatch(backlog,/超过 1 天|所选创建/);
 h.c.liveSet('from','2026-09-01T12:13:14');assert.match(h.html(),/点击查询/);await h.c.liveQuery();assert.equal(h.calls.filter(q=>q.action==='pendingSnapshot').at(-1).date,'2026-09-22');
 h.c.liveSet('direction','charge');const count=h.calls.filter(q=>q.action==='pendingSnapshot').length;await h.c.liveQuery();assert.equal(h.calls.filter(q=>q.action==='pendingSnapshot').length,count,'collection-only queries do not read withdrawal snapshots');
});

test('first overview snapshot waits for delayed report directory and keeps new unresolved platforms visible as partial',async()=>{
 let resolveCatalog;const catalogPromise=new Promise(resolve=>resolveCatalog=resolve);
 const native={...P,team:'Synthetic Team'},late={name:'Synthetic Late Report',rawPlatform:'Synthetic Late Report',country:'印度',rawCountry:'IN',team:'Synthetic Team',system:'REPORT',dataset:'volume',directions:['withdraw'],records:1,provenance:{kind:'direct'}};
 const h=await ready({manualOverview:true,reports:true,handler:q=>q.action==='catalog'?{platforms:[native]}:q.action==='collectedData'?catalogPromise:q.action==='reportSummary'?{feeds:q.feeds.map(f=>({...f,rawCountry:f.country,rawPlatform:f.platform,status:'not_received',groups:[]}))}:q.action==='rates'?{rows:[],total:0}:aggregate(native)});
 const query=h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='pendingSnapshot').length,0);resolveCatalog({rows:[late]});await query;await settle();assert.equal(h.calls.filter(q=>q.action==='pendingSnapshot').length,1);assert.match(h.html(),/已采集 1 \/ 2 平台/);assert.match(h.html(),/已采集小计/);h.c.livePendingSnapshotDetails();assert.match(h.drawers.at(-1).html,/Synthetic Late Report/);assert.match(h.drawers.at(-1).html,/尚未接入快照/);
});


test('workorder records and deposit follow-up pages manually query the last seven business days',async()=>{
 const routes=['workorders','deposit_tracking','deposit_statistics','workorder_reconciliation','workorder_workload','workorder_operation_logs'];
 for(const page of routes){
  const h=harness({page,handler:q=>q.action==='catalog'?{platforms:[P]}:{rows:[],total:0,summary:{}}});await settle();assert.deepEqual(h.calls.map(q=>q.action),['catalog']);await h.c.liveQuery();await settle();
  const q=h.calls.find(q=>['workorderRecords','depositIssues','depositStatistics','portalOperationLogs'].includes(q.action));assert(q,page+' reads after clicking query');
  if(q.filters){assert.equal(q.filters.from,page==='workorders'?'2026-09-17':'2026-09-01',page);assert.equal(q.filters.to,page==='workorders'?'2026-09-23':'2026-09-30',page);}else{assert.equal(q.dateMode,'range',page);assert.equal(q.startAt,'2026-09-17T00:00:00.000Z',page);assert.equal(q.endAt,'2026-09-23T23:59:59.000Z',page);}
 }
 const h=await ready();h.c.setPage('deposit_tracking');await settle();h.c.depositIssuesDate('from','2026-08-01');h.c.depositIssuesDate('to','2026-08-31');await h.c.depositIssuesLoad();h.c.setPage('deposit_statistics');await settle();await h.c.liveQuery();await settle();assert.equal(h.calls.at(-1).startAt,'2026-09-17T00:00:00.000Z');h.c.setPage('deposit_tracking');await settle();assert.equal(h.L.from,'2026-08-01T00:00:00');
 h.c.depositIssuesSet('dateMode','all');await h.c.depositIssuesLoad();assert.equal(h.calls.at(-1).dateMode,'all');h.c.depositIssuesReset();await h.c.liveQuery();await settle();assert.equal(h.calls.at(-1).dateMode,'range');assert.equal(h.calls.at(-1).startAt,'2026-09-17T00:00:00.000Z');
 h.c.setPage('workorders');await settle();await h.c.liveQuery();await settle();h.c.workorderOperationsSet('from','2026-08-01');h.c.workorderOperationsSet('to','2026-08-31');await h.c.workorderOperationsLoad(true);h.c.liveClosePage('workorders');h.c.setPage('workorders');await settle();await h.c.liveQuery();await settle();assert.equal(h.calls.at(-1).filters.from,'2026-09-17');assert.equal(h.calls.at(-1).filters.to,'2026-09-23');
});


test('YayaPay 924 renders one current source fee and identifies the unused 923 original row',async()=>{
 const h=await ready(),r=completeAggregate(P,20,10);r.groups.provider[0].provider='YayaPay';h.L.results=[r];h.c.state.page='providers';
 const selected={scopeType:'country',country:'印度',provider:'YayaPay',category:'UPI',sheetName:'印度线下',sourceRow:22,sourceTypeProvider:'YAYAPAY-924',sourceType:'混合四方',collectFee:'5.20%',payoutFee:'3.10%',payoutSingleFee:'7'};
 const other={...selected,sourceRow:30,sourceTypeProvider:'YAYAPAY-923',sourceType:'跑分',collectFee:'6.30%'};
 h.L.feeLookupRows=[other,selected];h.c.render();
 const read=()=>{const t=renderedTables(h.html()).find(t=>t.headers[0]==='统一三方');return [t,label=>plain(t.rows[0][t.headers.findIndex(v=>v===label||v.startsWith(label+' '))])];};
 let [t,at]=read();assert.equal(at('匹配费率'),'5.20%');assert.equal(at('估算手续费'),'52.00');assert.equal(at('类型'),'混合四方');assert.doesNotMatch(t.html,/多档费率|待核对费率/);
 h.c.providerSummaryRate(0);const drawer=h.drawers.at(-1).html;assert.match(drawer,/原表三方/);assert.match(drawer,/YAYAPAY-924/);assert.match(drawer,/YAYAPAY-923/);assert.match(drawer,/当前匹配/);assert.match(drawer,/未采用/);
 selected.collectFee='5.60%';h.L.feeLookupRows=[other,{...selected,sourceRow:40}];h.c.render();[t,at]=read();assert.equal(at('匹配费率'),'5.60%');assert.equal(at('估算手续费'),'56.00');
 h.L.feeLookupRows=[other];h.c.render();[t,at]=read();assert.equal(at('匹配费率'),'未匹配');assert.equal(at('估算手续费'),'—未匹配');
});

test('adaptive ten-band UI uses same edges for parent, matrix and daily drilldown and counts stay separate',async()=>{
 const h=await ready({adaptive:true});h.setNow('2026-09-28T12:00:00Z');h.L.from='2026-09-27T00:00:00';h.L.to='2026-09-27T23:59:59';h.L.currency='INR';h.L.direction='all';
 h.setHandler(q=>{
  if(q.action==='rates')return {total:0,rows:[]};
  if(q.action==='memberDaily')return {platform:P,startAt:q.startAt,endAt:q.endAt,capabilities:{memberIdentity:true,createdBasis:'created_at',successBasis:'success_at',dedupe:'platform_local_date_direction_member'},rows:['charge','withdraw'].map(direction=>({date:'2026-09-27',direction,created_member_count:2,success_member_count:1,created_order_count:5,success_order_count:2,created_missing_member_count:0,success_missing_member_count:0}))};
  if(q.view==='drilldown')return {platform:P,startAt:q.startAt,endAt:q.endAt,complete:true,hasMore:false,summary:[stats()],groups:{daily:[{...stats(),date:'2026-09-27'}]}};
  const r=completeAggregate(P);r.amountBands=q.amountBands;r.amountBandsVersion=1;r.groups.amount_range=[{...stats(),bucket:'band:0'}];r.groups.matrix_range=[{...stats(),bucket:'band:0',hour:12}];return r;
 });
 await h.c.liveQuery();await settle();assert.equal(h.L.amountBandProfiles.charge.edges.length,11);assert.match(h.html(),/充值人数 \/ 成功充值人数/);assert.match(h.html(),/>2 \/ 1</);
 h.c.liveMemberCountsDetails();assert.match(h.drawers.at(-1).html,/2026-09-27/);assert.match(h.drawers.at(-1).html,/充值人数/);
 h.L.overviewAnalysis=true;h.L.loadedView='full';h.c.render();assert.match(h.html(),/100 ≤ 金额 &lt; 200/);assert.doesNotMatch(h.html(),/>band:0</);
 h.c.state.page='matrix';h.c.render();assert.equal((h.html().match(/金额 \/ 时/g)||[]).length,2);
 const parent=h.calls.filter(q=>q.action==='aggregate'&&q.amountBands).at(-1);assert.equal(parent.amountBands.charge.length,11);
 const segment={kind:'matrix_range',direction:'charge',hour:12,bucket:'band:0'};h.c.liveMatrixSegment(encodeURIComponent(JSON.stringify(segment)));h.c.liveAnalysisAction(encodeURIComponent(JSON.stringify(segment)),'daily');await settle();
 const drill=h.calls.filter(q=>q.view==='drilldown').at(-1);assert(drill);assert.deepEqual(drill.amountBands,parent.amountBands);assert.equal(drill.bucket,'band:0');
});

test('submission analysis navigation uses its own scoped reader and updates the menu without unrelated aggregate reads',async()=>{
 const h=await ready({submissions:true});setScope(h,{platform:P.id,direction:'charge',status:'all'});h.L.dirty=false;
 h.setHandler(async q=>q.action==='submissionAnalysis'?{platform:P,startAt:q.startAt,endAt:q.endAt,version:3,basis:'platform_local_day_all_providers_zero_success_whole_day_over_threshold',exemptCount:0,thresholdComparison:'gt',coverage:{missingMemberCount:0,orderSequenceUncertainCount:0},metrics:[10,15,20,30,50,100].map(threshold=>({provider:null,threshold,member_count:1,member_days:1,qualified_member_count:1,qualified_member_days:1,invalid_count:35,l0_members:0,new_members:0,funded_members:0,unknown_members:1}))}:aggregate(P));
 const before=h.calls.filter(q=>q.action==='aggregate').length;h.c.setPage('events');await settle();await h.c.liveQuery();await settle();
 assert(h.calls.some(q=>q.action==='submissionAnalysis'));assert.equal(h.calls.filter(q=>q.action==='aggregate').length,before);assert.match(h.html(),/符合条件整日/);assert.match(h.html(),/充值情况未提供/);assert.equal(h.c.pages.find(p=>p[0]==='events')[2],'刷单风控');
});


test('stuck initializes and resets to seven completed local days without starting a query',async()=>{
 const h=harness({page:'stuck'});await settle();assert.deepEqual(h.calls.map(q=>q.action),['catalog']);assert.equal(h.L.from,'2026-09-16T00:00:00');assert.equal(h.L.to,'2026-09-22T23:59:59');assert.match(h.html(),/点击查询/);
 h.setNow('2026-10-01T01:00:00Z');h.c.livePeriod('week');assert.equal(h.L.from,'2026-09-24T00:00:00');assert.equal(h.L.to,'2026-09-30T23:59:59');h.c.liveReset();await settle();assert.equal(h.L.from,'2026-09-24T00:00:00');assert.equal(h.L.to,'2026-09-30T23:59:59');assert.deepEqual(h.calls.map(q=>q.action),['catalog']);
 h.c.liveSet('from','2026-09-01T00:00:00');h.c.liveSet('to','2026-09-15T23:59:59');await h.c.liveLoad();assert.equal(h.calls.length,1,'background callers do not submit the date range');
 await h.c.liveQuery();assert.deepEqual(h.calls.filter(q=>q.action==='pendingAnalysis').map(q=>[q.startDate,q.endDate]),[['2026-09-01','2026-09-15']]);assert(!h.calls.some(q=>['aggregate','reportSummary','workorders','details','pendingSnapshot'].includes(q.action)));
 const before=h.calls.length;h.c.setPage('amount');h.c.setPage('stuck');await settle();assert.equal(h.calls.length,before);assert.equal(h.L.from,'2026-09-01T00:00:00');assert.equal(h.L.to,'2026-09-15T23:59:59');assert.match(h.html(),/data-pending-analysis="ready"/);
});

test('opening a fresh stuck tab defaults independently while revisits restore snapshot data and local controls',async()=>{
 const h=await ready();h.L.from='2026-09-01T04:00:00';h.L.to='2026-09-01T05:00:00';const n=h.calls.length;h.c.setPage('stuck');await settle();assert.equal(h.calls.length,n);assert.equal(h.L.from,'2026-09-16T00:00:00');assert.equal(h.L.to,'2026-09-22T23:59:59');
 await h.c.liveQuery();h.c.livePendingAnalysisMetric('count');h.c.livePendingAnalysisExpand(P.id);assert.match(h.html(),/aria-pressed="true"[^>]*>按笔数/);assert.match(h.html(),/class="pa-provider"/);const calls=h.calls.length;
 h.c.setPage('amount');h.c.setPage('stuck');await settle();assert.equal(h.calls.length,calls);assert.match(h.html(),/aria-pressed="true"[^>]*>按笔数/);assert.match(h.html(),/class="pa-provider"/);assert.match(h.html(),/875.50/);
});

test('leaving or editing a pending snapshot query cancels its action and ignores late results until a new manual query',async()=>{
 for(const edit of [false,true]){
  const pending=deferred(),cancelled=[];let requests=0;
  const h=harness({page:'stuck',onCancel:actions=>cancelled.push(...actions),pendingAnalysisHandler:q=>++requests===1?pending.promise:pendingAnalysisResult(q,'Fresh snapshot platform')});await settle();const task=h.c.liveQuery();await settle();const first=h.calls.find(q=>q.action==='pendingAnalysis');assert(first);
  if(edit)h.c.liveSet('from','2026-09-18T00:00:00');else h.c.setPage('amount');const before=h.calls.length;
  pending.resolve(pendingAnalysisResult(first,'Stale snapshot platform'));await task;await settle();assert.equal(h.calls.length,before);assert(cancelled.includes('pendingAnalysis'));assert.doesNotMatch(h.html(),/Stale snapshot platform/);
  if(!edit){h.c.setPage('stuck');await settle();assert.equal(h.calls.length,before);assert.match(h.html(),/暂停|点击查询/);}
  await h.c.liveQuery();assert.equal(requests,2);assert.match(h.html(),/Fresh snapshot platform/);assert.doesNotMatch(h.html(),/Stale snapshot platform/);
 }
});

test('a report-only withdrawal snapshot platform still renders without native order aggregates',async()=>{
 const seed={...P,name:'Synthetic report-only snapshot platform',team:'M8',source:'withdraw',directions:['withdraw']};
 const h=harness({page:'stuck',reports:true,handler:q=>q.action==='catalog'?{platforms:[],withdrawPlatforms:[seed]}:q.action==='collectedData'?{rows:[]}:q.action==='rates'?{rows:[],total:0}:{rows:[]}});await settle();assert.deepEqual(h.calls.map(q=>q.action),['catalog']);await h.c.liveQuery();await settle();
 assert.equal(h.calls.filter(q=>q.action==='pendingAnalysis').length,1);assert.deepEqual(h.calls.find(q=>q.action==='pendingAnalysis').platformIds,[P.id]);assert.match(h.html(),/data-pending-analysis="ready"/);assert(!h.calls.some(q=>['aggregate','reportSummary','details'].includes(q.action)));
});


test('snapshot date controls offer calendar days only while other analyses keep hour inputs',async()=>{
 const h=harness({page:'stuck'});await settle();let html=h.nodes.get('liveFilters').innerHTML;assert.match(html,/<label>快照日期<\/label>/);assert.match(html,/>日快照<\/small>/);assert.doesNotMatch(html,/type="time"|时间（含秒）/);const before=h.calls.length;
 h.c.liveDateSet('from','date','2026-09-10');h.c.liveDateSet('to','date','2026-09-17');assert.equal(h.L.from,'2026-09-10T00:00:00');assert.equal(h.L.to,'2026-09-17T23:59:59');h.c.liveDateSet('from','time','03:30:00');assert.equal(h.L.from,'2026-09-10T00:00:00');assert.equal(h.calls.length,before);
 h.c.livePeriod('month');assert.equal(h.L.from,'2026-08-24T00:00:00');assert.equal(h.L.to,'2026-09-22T23:59:59');h.c.setPage('amount');html=h.nodes.get('liveFilters').innerHTML;assert.match(html,/<label>统计时间<\/label>/);assert.match(html,/type="time"/);
});

test('new successful-duration queries use v2 without changing other pages or reusing legacy bucket caches',async()=>{
 const h=await ready();const previous=h.calls.filter(q=>q.action==='aggregate').length;
 h.c.setPage('latency');await settle();await h.c.liveQuery();await settle();
 const duration=h.calls.filter(q=>q.action==='aggregate').slice(previous);assert(duration.length>0);assert(duration.filter(q=>q.view!=='providers').every(q=>q.durationVersion===2));assert(duration.filter(q=>q.view==='providers').every(q=>!('durationVersion'in q)));
 const count=h.calls.filter(q=>q.action==='aggregate').length;h.c.liveDurationSet('durationMode','cumulative');h.c.liveDurationSet('durationThreshold',180000);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,count,'local duration controls never query implicitly');
 h.c.setPage('overview');await settle();await h.c.liveQuery();await settle();const overview=h.calls.filter(q=>q.action==='aggregate').slice(count);assert(overview.length>0);assert(overview.every(q=>!('durationVersion'in q)));
});


test('fresh latency comparisons keep provider requests on the legacy contract and only the current full query uses v2',async()=>{
 for(const status of ['all','pending']){
  const h=await ready({manualOverview:true}),calls=[];h.c.setPage('latency');await settle();setScope(h,{status,platform:P.id});
  h.setHandler(q=>{if(q.action!=='aggregate')return aggregate();calls.push(q);if(q.view==='providers'&&q.durationVersion)throw Error('invalid_duration_view');const r=completeAggregate(P);if(q.durationVersion===2)r.durationVersion=2;return r});
  await h.c.liveQuery();await settle();assert.equal(calls.length,2,status);const [current,previous]=calls;assert.equal(current.durationVersion,2);assert.notEqual(current.view,'providers');assert(!('durationVersion'in previous));assert.equal(previous.view,status==='all'?'providers':undefined);assert(Date.parse(previous.endAt)<=Date.parse(current.startAt));assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.L.comparisonError,'');assert.equal(h.L.results[0].durationVersion,2);
 }
});
