/* Navigation regressions run real production modules in a synthetic DOM. No network. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8');
const layoutSources=['live-analysis-drilldown.js','live-reference-layout.js','live-pages-reference.js','live-empty-pages.js','live-duration-reference.js','live-payout-config.js','live-filter-controls.js','live-configuration.js','live-provider-aliases.js','live-provider-summary.js','live-provider-orders.js','live-provider-sticky.js','live-collected-data.js','live-report-data.js','live-withdraw-pages.js','live-workorder-operations.js','live-deposit-issues.js'].map(name=>({name,source:fs.readFileSync(path.join(__dirname,'../admin-preview',name),'utf8')}));
const comparisonSource=fs.readFileSync(path.join(__dirname,'../admin-preview/live-comparison.js'),'utf8');
function clockHarness(){
 let constructed=0,formatted=0;
 const context={Intl:{DateTimeFormat:function(...args){constructed++;const value=new Intl.DateTimeFormat(...args);return {formatToParts(epoch){formatted++;return value.formatToParts(epoch)}}}},Date};
 const begin=source.indexOf(' const clockFormatters=new Map();'),end=source.indexOf(' function table(',begin);assert(begin>=0&&end>begin);
 vm.runInNewContext(source.slice(begin,end)+';globalThis.clock={localClock,instant,sizes:()=>[clockFormatters.size,instantCache.size]};',context);
 return {...context.clock,constructed:()=>constructed,formatted:()=>formatted};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async()=>{for(let n=0;n<24;n++)await flush()};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const P={id:'11111111-1111-4111-8111-111111111111',name:'Synthetic platform',source:'AR',country:'印度',scopeGroup:'india',timezone:'Asia/Kolkata',currency:'INR'};
const stats=(count=5,amount='1000.25')=>({direction:'charge',currency:'INR',all_count:count,all_amount:amount,success_count:3,created_success_count:3,success_amount:'600.15',pending_count:1,pending_amount:'200.05',failed_count:1,failed_amount:'200.05',rejected_count:0,rejected_amount:'0',unknown_count:0,unknown_amount:'0',missing_amount_count:0});
function aggregate(p=P,count=5){const s=stats(count);return {platform:p,total:count,startAt:'2026-09-21T18:30:00.000Z',endAt:'2026-09-22T00:30:00.000Z',summary:[s],rows:[],groups:{provider:[{...s,provider:'Synthetic provider'}],daily:[{...s,provider:'Synthetic provider',date:'2026-09-22'}],hourly:[{...s,hour:12}],amount:[{...s,bucket:'200'}],matrix:[{...s,bucket:'200',hour:12}],latency:[],pending_age:[]}}}
function detail(p=P,total=65,offset=0,limit=20){return {platform:p,total,offset,limit,hasMore:offset+limit<total,summary:[],groups:{},rows:Array.from({length:Math.max(0,Math.min(limit,total-offset))},(_,i)=>({id:'row-'+(offset+i),system_order_id:'source-'+(offset+i),order_number:'order-'+(offset+i),third_party_order_number:'third-'+(offset+i),member_id:'member-'+(offset+i),provider:'Synthetic provider',direction:'charge',status:'1',status_group:'success',amount:'200.05',created_at:'2026-09-22T01:02:03Z',success_at:'2026-09-22T01:03:03Z',currency:'INR'}))}}
function payoutConfig(request,hasTargets=true){const target={platform:'SYNTHETIC_CONFIG_PLATFORM',country_code:'IN',country_name:'印度',display_group:'IN',display_name:'印度',timezone:'Asia/Kolkata',members:[]};return request.operation==='index'?{version:1,system:request.system,readOnly:true,targets:hasTargets?[target]:[],summaries:hasTargets?[{...target,observed_local_date:'2026-09-22'}]:[]}:{version:1,system:request.system,readOnly:true,target,snapshot:{country_code:'IN',platform:target.platform,timezone:'Asia/Kolkata',observed_local_date:'2026-09-22',observed_at:'2026-09-22T00:00:00Z',configuration:{fields:[{key:'autoWithdraw',kind:'boolean',available:true,value:false},{key:'withdrawAmount',kind:'number',available:true,value:0}],groups:[]}}}}
function harness(options={}){
 const nodes=new Map(),writes=[],calls=[],drawers=[],intervals=[],timers=[],blobs=[],scrolled=[],observations=[];let handler=options.handler,clock=Date.parse('2026-09-23T12:00:00Z');
 function node(id){let html='';const item={id,textContent:'',value:'',title:'',style:{setProperty(k,v){this[k]=v}},classList:{add(){},remove(){}},querySelector:s=>node(id+' '+s),querySelectorAll:()=>[],appendChild(n){if(n.id)nodes.set(n.id,n);return n},after(n){if(n.id)nodes.set(n.id,n)},remove(){nodes.delete(this.id)},setAttribute(){},click(){},focus(){}};Object.defineProperty(item,'innerHTML',{get:()=>html,set:v=>{html=String(v);writes.push({id,html})}});return item}
 for(const id of ['pageTitle','pageSubtitle','eyebrow','crumbTitle','nav','filters','scope','page','headerActivityV3','.title-actions','.bottom-note','.top-right','.topbar'])nodes.set(id,node(id));
 const keys=['overview','providers','orders','time','amount','matrix','provider_daily','latency','stuck','collection','payout','risk','channelquality','teamops','teamcountries','teamplatforms','merchants','workorders','rates','data_health','deposit_tracking','dropped','anomaly','events','rules','access','ip','login_logs','operation_logs','teams','provider_config','platform_systems','merchantproviders'];
 const merchantKeys=['merchants','merchantproviders','workorders','deposit_tracking'];
 const pages=keys.map(k=>[k,'',k,'',k]),groups=[['analysis','','数据分析',keys.filter(k=>!merchantKeys.includes(k))],['merchant','','商户中心',merchantKeys]];
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}}
 class TestURL extends URL{static createObjectURL(blob){blobs.push(blob);return 'blob:synthetic'}static revokeObjectURL(){}}
 const context={console,Intl,Date:FixedDate,URL:TestURL,Blob,state:{page:options.page||'overview',navGroup:'analysis'},pages,navGroupsV3:groups,location:{hash:''},
  document:{title:'',body:{classList:{add(){},remove(){}},appendChild(n){nodes.set(n.id,n)}},getElementById:id=>nodes.get(id)||null,querySelector:selector=>nodes.get(selector)||null,createElement:tag=>node(tag)},
  render(){nodes.get('page').innerHTML='INDEPENDENT_SNAPSHOT'},syncFilters(){},groupForV3:key=>groups.find(g=>g[3].includes(key))||groups[0],toggleCenterV3(){},setPage(){},headerIconV3:()=>'<svg></svg>',openDrawer:(title,html)=>drawers.push({title,html}),toast(){},scrollTo(x,y){context.scrollX=x;context.scrollY=y;scrolled.push([x,y])},
  setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length},clearInterval(){},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout(){},
  hensemRoleAccess:options.roleAccess,hensemRoleAllowed:options.roleAllowed,HENSEM_PRODUCTION:options.production!==false,hensemAdminInitialPage:options.initialPage,hensemAdminPageUrl:key=>'https://dashboard.example/app/#owner-admin-preview/'+key,scrollX:0,scrollY:0,
  hensemLiveRequest:async request=>{calls.push(JSON.parse(JSON.stringify(request)));if(!options.ancillaryHandler&&request.action==='providerOptions')return {providers:['Synthetic provider']};if(!options.ancillaryHandler&&request.action==='workorders')return {rows:[],byProvider:[],total:0,summary:{},byDirection:{}};if(handler)return handler(request);if(request.action==='catalog')return {platforms:options.platforms||[P]};if(request.action==='details')return detail((options.platforms||[P]).find(p=>p.id===request.platformId)||P,65,request.offset,request.limit);if(request.action==='rates')return {rows:[],total:0,options:{countries:[],platforms:[],providers:[]}};if(request.action==='payoutConfig')return payoutConfig(request,(options.platforms||[P]).length>0);return aggregate((options.platforms||[P]).find(p=>p.id===request.platformId)||P,65)}
 };if(options.observe)context.IntersectionObserver=class{constructor(callback){observations.push(callback)}observe(){}disconnect(){}};context.window=context;vm.createContext(context);vm.runInContext(comparisonSource,context,{filename:'live-comparison.js',timeout:2000});for(const module of layoutSources.filter(m=>m.name!=='live-report-data.js'||options.reports))vm.runInContext(module.source,context,{filename:module.name,timeout:2000});if(options.submission){vm.runInContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-submission-analysis.js'),'utf8'),context);if(options.onSubmissionQuery){const create=context.HensemSubmissionAnalysis.create;context.HensemSubmissionAnalysis.create=config=>create({...config,query(...args){options.onSubmissionQuery();return config.query(...args)}})}}vm.runInContext(source,context,{filename:'live-data.js',timeout:2000});
 return {c:context,L:context.adminLive,calls,writes,nodes,drawers,intervals,timers,blobs,scrolled,observations,setHandler:fn=>handler=fn,setNow:value=>clock=Date.parse(value),html:()=>nodes.get('page').innerHTML};
}
async function ready(options){const h=harness(options);await settle();if(h.L){h.L.from='2026-09-22T00:00:00';h.L.to='2026-09-22T05:59:59';if(options?.page&&h.c.state.page!=='overview'){h.c.liveQuery();await settle();}}return h}
function setScope(h,values={}){Object.assign(h.L,{from:'2026-09-22T00:00:00',to:'2026-09-22T05:59:59',...values})}
function completeAggregate(p=P,count=10,success=5){const r=aggregate(p,count),s={...stats(count,String(count*100)),success_count:success,created_success_count:success,success_amount:String(success*100),pending_count:count-success,pending_amount:String((count-success)*100),failed_count:0,failed_amount:'0',rejected_count:0,rejected_amount:'0',unknown_count:0,unknown_amount:'0'};r.summary=[s];for(const key of ['provider','daily','hourly','amount','matrix'])r.groups[key]=[{...r.groups[key][0],...s}];return r}

const pageWrites=h=>h.writes.filter(w=>w.id==='page').length;
const filterWrites=h=>h.writes.filter(w=>w.id==='section').length;

test('opening or closing navigation groups updates only the menu, never recomputes the current report',async()=>{
 const h=await ready(),before=pageWrites(h),filters=filterWrites(h),requests=h.calls.length,html=h.html();
 let reportRenders=0;const original=h.c.HensemLivePages.create;h.c.HensemLivePages.create=function(...args){reportRenders++;return original(...args)};
 h.c.toggleCenterV3('merchant');h.c.toggleCenterV3('analysis');h.c.toggleCenterV3('analysis');
 assert.equal(pageWrites(h),before);assert.equal(filterWrites(h),filters);assert.equal(reportRenders,0);assert.equal(h.calls.length,requests);assert.equal(h.html(),html);
 assert.equal(h.c.state.navGroup,'');assert.doesNotMatch(h.nodes.get('nav').innerHTML,/class="subnav"/);
});

test('navigation paints once while destination queries are still pending and does not await IO',async()=>{
 const h=await ready({ancillaryHandler:false});await h.c.liveQuery();await settle();const pending=deferred();h.L.from='2026-09-20T00:00:00';h.L.to='2026-09-20T23:59:59';
 h.setHandler(q=>q.action==='aggregate'?pending.promise:Promise.resolve({rows:[],total:0}));
 const before=pageWrites(h);h.c.setPage('provider_payout');
 assert.equal(h.c.state.page,'provider_payout');assert.equal(h.c.location.hash,'provider_payout');assert.equal(h.L.direction,'withdraw');assert.equal(h.L.loading,false);assert.equal(pageWrites(h)-before,1,'all synchronous loader notifications share one destination paint');
 const reads=h.calls.length;assert.match(h.html(),/点击查询/);const afterNavigation=pageWrites(h);await settle();assert.equal(pageWrites(h),afterNavigation,'provider option completion updates its filters, not the whole report');
 assert.equal(h.calls.length,reads);h.c.liveQuery();await settle();assert.equal(h.L.loading,true);h.c.setPage('orders');assert.equal(h.c.state.page,'orders');assert.match(h.html(),/请先选择一个商户/);const afterOrders=pageWrites(h);
 pending.resolve(completeAggregate(P,987654,987653));await settle();
 assert.equal(pageWrites(h),afterOrders,'the old aggregate cannot repaint the new page');assert.doesNotMatch(h.html(),/987,654|98,765,400/);assert.equal(h.L.loading,false);
});

test('an already queried overview tab restores immediately without business or auxiliary reads',async()=>{
 const h=await ready();assert.equal(h.L.overviewQueried,false);assert.deepEqual(h.calls.map(q=>q.action),['catalog']);
 await h.c.liveQuery();await settle();const result=h.L.results;assert.equal(h.L.overviewQueried,true);assert(result.length>0);
 h.c.setPage('provider_payout');await settle();const calls=h.calls.length,before=pageWrites(h);
 h.c.setPage('overview');assert.equal(h.c.state.page,'overview');assert.equal(h.L.overviewQueried,true);assert.equal(h.L.dirty,false);assert.equal(h.L.loading,false);assert.equal(pageWrites(h)-before,1);assert.equal(h.L.results,result);assert.match(h.html(),/代收经营总数据/);
 await settle();assert.equal(h.calls.length,calls,'returning to a completed tab only restores data');assert.equal(pageWrites(h)-before,1);
 h.c.liveClosePage('overview');h.c.setPage('overview');await settle();assert.equal(h.L.overviewQueried,false);assert.equal(h.L.dirty,true);assert.match(h.html(),/点击查询/);
});

test('a pending catalog cannot resume another page automatic query after returning to overview',async()=>{
 const catalog=deferred(),h=harness({handler:q=>q.action==='catalog'?catalog.promise:q.action==='rates'?{rows:[],total:0}:aggregate()});
 h.c.setPage('collection');h.c.setPage('overview');
 assert.equal(h.c.state.page,'overview');assert.equal(h.L.overviewQueried,false);assert.deepEqual(h.calls.map(q=>q.action),['catalog']);
 catalog.resolve({platforms:[P]});await settle();
 assert.equal(h.L.catalogReady,true);assert.equal(h.L.overviewQueried,false);assert.equal(h.L.dirty,true);assert.equal(h.L.loading,false);assert.equal(h.L.results.length,0);assert.match(h.html(),/点击查询/);
 assert.deepEqual(h.calls.map(q=>q.action),['catalog'],'the old collection continuation cannot read orders, comparison, source reports, fees or provider choices on overview');
});

test('a manual query pending the catalog expires when leaving and returning to overview',async()=>{
 const catalog=deferred(),h=harness({handler:q=>q.action==='catalog'?catalog.promise:q.action==='rates'?{rows:[],total:0}:aggregate()});
 const oldQuery=h.c.liveQuery();h.c.setPage('collection');h.c.setPage('overview');
 catalog.resolve({platforms:[P]});await oldQuery;await settle();
 assert.equal(h.L.overviewQueried,false);assert.equal(h.L.dirty,true);assert.equal(h.L.results.length,0);assert.match(h.html(),/点击查询/);assert.deepEqual(h.calls.map(q=>q.action),['catalog'],'a previous visit cannot authorize the returned overview');
 await h.c.liveQuery();await settle();assert.equal(h.L.overviewQueried,true);assert.equal(h.L.dirty,false);assert.equal(h.L.loading,false);assert.equal(h.L.results.length,1);assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.calls.filter(q=>q.action==='aggregate').length,2,'a new explicit query still reads current and comparison once');
});

test('dedicated-page responses cache data but do not repaint a different destination',async()=>{
 const h=await ready(),old=deferred(),current=deferred();h.setHandler(q=>q.action==='providerConfig'?old.promise:q.action==='platformAssignments'?current.promise:Promise.resolve({rows:[],total:0}));
 h.c.setPage('provider_config');h.c.liveQuery();assert.equal(h.L.providerConfigLoading,true);
 const before=pageWrites(h);h.c.setPage('teams');assert.equal(pageWrites(h)-before,1);assert.equal(h.L.platformAssignmentsLoading,false);h.c.liveQuery();assert.equal(h.L.platformAssignmentsLoading,true);
 const waiting=pageWrites(h);old.resolve({rows:[],total:0});await settle();assert.equal(pageWrites(h),waiting);assert.equal(h.L.providerConfigLoading,false);assert(h.L.providerConfig,'completed old request remains reusable');
 current.resolve({rows:[],total:0});await settle();assert.equal(pageWrites(h)-waiting,1);assert.equal(h.L.platformAssignmentsLoading,false);assert.equal(h.c.state.page,'teams');
});

test('collected catalog response cannot redraw another menu and is reused on return',async()=>{
 const h=await ready(),pending=deferred();h.setHandler(q=>q.action==='collectedData'?pending.promise:Promise.resolve({rows:[],total:0}));
 h.c.setPage('collected_data');h.c.liveQuery();h.c.setPage('orders');const before=pageWrites(h),calls=h.calls.filter(q=>q.action==='collectedData').length;
 pending.resolve({rows:[]});await settle();assert.equal(pageWrites(h),before);assert.match(h.html(),/请先选择一个商户/);
 h.c.setPage('collected_data');assert.equal(h.calls.filter(q=>q.action==='collectedData').length,calls);assert.equal(pageWrites(h)-before,1);assert.doesNotMatch(h.html(),/请先选择一个商户/);
});

test('lazy fee lookup does not recursively rebuild the page during its first paint',async()=>{
 const h=await ready();await h.c.liveQuery();await settle();const pending=deferred();h.L.feeLookupRows=null;h.L.feeLookupLoading=false;h.L.feeLookupError='';h.c.state.page='providers';h.L.direction='charge';h.L.multi.direction=['charge'];h.setHandler(q=>q.action==='rates'?pending.promise:Promise.resolve(aggregate()));
 const before=pageWrites(h);h.c.render();assert.equal(pageWrites(h)-before,1);assert.equal(h.L.feeLookupLoading,true);
 pending.resolve({rows:[],total:0});await settle();assert.equal(pageWrites(h)-before,2,'completion still produces the required final view');assert.equal(h.L.feeLookupLoading,false);
});

test('provider options refresh updates search choices without touching business data',async()=>{
 const h=await ready({ancillaryHandler:true,handler:q=>q.action==='catalog'?Promise.resolve({platforms:[P]}):q.action==='providerOptions'?Promise.resolve({providers:['OLD']}):q.action==='rates'?Promise.resolve({rows:[],total:0}):Promise.resolve(aggregate())}),pending=deferred();
 h.setHandler(q=>q.action==='providerOptions'?pending.promise:Promise.resolve(aggregate()));h.c.liveSet('direction','withdraw');const before=pageWrites(h),filters=filterWrites(h);
 pending.resolve({providers:['NEW CHOICE']});await settle();assert.equal(pageWrites(h),before);assert(filterWrites(h)>filters);assert.match(h.nodes.get('liveFilters').innerHTML,/NEW CHOICE/);assert.match(h.html(),/点击查询/);
});


test('a late rate-table response remains cached without repainting the order selector',async()=>{
 const h=await ready(),pending=deferred();h.L.fees=null;h.setHandler(q=>q.action==='rates'?pending.promise:Promise.resolve(aggregate()));
 h.c.setPage('rates');h.c.liveQuery();assert.equal(h.L.feeLoading,true);h.c.setPage('orders');const before=pageWrites(h);
 pending.resolve({rows:[],total:0,options:{countries:[],platforms:[],providers:[]}});await settle();assert.equal(pageWrites(h),before);assert.equal(h.L.feeLoading,false);assert(h.L.fees);assert.match(h.html(),/请先选择一个商户/);
});

function reportCatalogFixture(){
 let reads=0,feeds=[];const native={id:'native-a',get name(){reads++;return 'ONE'},country:'印度',source:'ar',team:'M8',currency:'INR'},L={catalog:[native],withdrawCatalog:[]},context={};context.window=context;
 vm.runInNewContext(layoutSources.find(m=>m.name==='live-report-data.js').source,context);
 const page=context.HensemLiveReportData.create({L,E:String,N:String,C:String,R:()=>'',request:async()=>({rows:feeds}),render(){}});
 return {L,page,reads:()=>reads,setFeeds:rows=>{feeds=rows}};
}

test('repeated country, team and platform lookups reuse normalized directory identities',()=>{
 const f=reportCatalogFixture(),first=f.page.catalog(),reads=f.reads();assert(reads>0);
 for(let i=0;i<50;i++){assert.equal(f.page.catalog(),first);assert.equal(f.page.selected({country:'印度',teams:['M8']}).length,1);assert.equal(f.page.selected({country:'巴西',teams:['胖虎']}).length,0)}
 assert.equal(f.reads(),reads,'unchanged source rows are not normalized again on every filter or feed lookup');
 f.L.catalog=[{id:'native-b',name:'BRAZIL',country:'巴西',source:'PANDA',team:'胖虎'}];
 const replacement=f.page.catalog();assert.notEqual(replacement,first);assert.equal(replacement.length,1);assert.equal(replacement[0].id,'native-b');assert.equal(f.page.selected({country:'印度'}).length,0);assert.equal(f.page.selected({country:'巴西',teams:['胖虎']}).length,1);
 f.L.catalog=[];assert.equal(f.page.catalog().length,0,'a reduced authorized native directory invalidates immediately');
});

test('withdraw and refreshed source directories invalidate the identity memo without retaining removed feeds',async()=>{
 const f=reportCatalogFixture(),before=f.page.catalog();f.L.withdrawCatalog=[{id:'config',name:'CONFIG',country:'巴西',team:'胖虎',source:'PANDA'}];assert.notEqual(f.page.catalog(),before);assert.equal(f.page.catalog().length,2);
 const rows=[{dataset:'volume',system:'REPORT',country:'胖虎巴西',rawCountry:'胖虎巴西',name:'REPORT-A',rawPlatform:'REPORT-A',team:'胖虎',records:1,directions:['charge'],provenance:{kind:'google_sheets'}}];f.setFeeds(rows);await f.page.loadCatalog(true);const first=f.page.catalog();assert(first.some(p=>p.name==='REPORT-A'));assert.equal(f.page.selected({teams:['胖虎']}).length,2);
 rows[0]={...rows[0],name:'REPORT-B',rawPlatform:'REPORT-B'};await f.page.loadCatalog(true);const refreshed=f.page.catalog();assert.notEqual(refreshed,first,'even an adapter returning the same array invalidates after a fresh response');assert(refreshed.some(p=>p.name==='REPORT-B'));assert(!refreshed.some(p=>p.name==='REPORT-A'));
 f.setFeeds([]);f.L.withdrawCatalog=[];await f.page.loadCatalog(true);assert.equal(f.page.catalog().length,1);assert.equal(f.page.selected({teams:['胖虎']}).length,0,'removed source and configuration identities disappear');
});

function flowAggregate(platform,direction,count=10){const r=completeAggregate(platform,count,5);r.summary.forEach(row=>row.direction=direction);Object.values(r.groups).forEach(rows=>rows.forEach(row=>row.direction=direction));return r}

test('fixed business pages hide the direction selector and reject attempts to clear or switch it',async()=>{
 for(const [page,direction]of[['collection','charge'],['payout','withdraw'],['providers','charge'],['provider_payout','withdraw'],['stuck','withdraw']]){
  const h=await ready({page});assert.equal(h.L.direction,direction);assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/data-multi="direction"/);
  const calls=h.calls.length;h.c.liveSet('direction','all');h.c.liveSet('direction',direction==='charge'?'withdraw':'charge');h.c.liveMultiClear('direction');h.c.liveSetMultiOption('direction',{value:'all',checked:true});
  assert.equal(h.c.state.page,page);assert.equal(h.L.direction,direction);assert.equal(h.calls.length,calls,'invisible fixed controls cannot start new queries');
  h.c.liveReset();await settle();assert.equal(h.L.direction,direction);assert(h.calls.filter(q=>q.action==='aggregate').every(q=>q.direction===direction));
 }
 const h=await ready({page:'time'});assert.match(h.nodes.get('liveFilters').innerHTML,/data-multi="direction"/);h.c.liveSet('direction','all');assert.equal(h.L.direction,'all');
});

test('collection and payout show received orders while loading, with source reports and fees deferred',async()=>{
 for(const [page,direction]of[['collection','charge'],['payout','withdraw']]){
  const platforms=[P,{...P,id:'22222222-2222-4222-8222-222222222222'},{...P,id:'33333333-3333-4333-8333-333333333333'}],pending=platforms.map(()=>deferred());let initial=true;
  const h=harness({page,reports:true,handler:q=>{
   if(q.action==='catalog')return {platforms};if(q.action==='collectedData')throw Error('synthetic report timeout');if(q.action==='rates')return {rows:[],total:0};
   if(q.action==='aggregate'&&initial)return pending[platforms.findIndex(p=>p.id===q.platformId)].promise;
   return flowAggregate(platforms.find(p=>p.id===q.platformId)||P,direction);
  }});await settle();h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='aggregate').length,2,'only two heavy platform reads at once');assert.equal(h.calls.filter(q=>q.action==='collectedData'||q.action==='reportSummary').length,0);
  pending[0].resolve(flowAggregate(platforms[0],direction,17));await settle();assert.equal(h.L.loading,true);assert.equal(h.L.results.length,1);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,3);assert.match(h.html(),/尚非完整总计/);assert.match(h.html(),/Synthetic provider/);assert.match(h.html(),new RegExp('三方经营汇总 · '+(direction==='charge'?'代收':'代付')));assert.doesNotMatch(h.html(),/日报读取未完成/);assert.equal(h.calls.filter(q=>q.action==='rates').length,0);
  initial=false;pending[1].resolve(flowAggregate(platforms[1],direction,19));pending[2].resolve(flowAggregate(platforms[2],direction,23));await settle();assert.equal(h.L.loading,false);assert.equal(h.L.results.length,3);assert(!h.calls.some(q=>q.action==='collectedData'||q.action==='reportSummary'));assert.match(h.html(),/Synthetic provider/);assert.doesNotMatch(h.html(),/日报读取未完成|源日报数据/);assert.doesNotMatch(h.html(),/尚非完整总计/);
 }
});

test('leaving a pending flow query cannot launch its deferred reports or repaint the destination',async()=>{
 const pending=deferred(),h=harness({page:'collection',reports:true,handler:q=>q.action==='catalog'?{platforms:[P]}:q.action==='aggregate'?pending.promise:{rows:[],total:0}});await settle();h.c.liveQuery();await settle();assert.equal(h.L.loading,true);
 h.c.setPage('orders');const reads=h.calls.filter(q=>q.action==='collectedData'||q.action==='reportSummary').length,before=pageWrites(h);pending.resolve(flowAggregate(P,'charge'));await settle();assert.equal(h.c.state.page,'orders');assert.equal(pageWrites(h),before);assert.equal(h.calls.filter(q=>q.action==='collectedData'||q.action==='reportSummary').length,reads);assert.match(h.html(),/请先选择一个商户/);
});

test('flow query failures retain successful platforms and retry only the missing platform',async()=>{
 for(const [page,direction]of[['collection','charge'],['payout','withdraw']]){
  const p2={...P,id:'22222222-2222-4222-8222-222222222222'};let fail=true;
  const h=harness({page,reports:true,handler:q=>{if(q.action==='catalog')return {platforms:[P,p2]};if(q.action==='collectedData'||q.action==='rates')return {rows:[],total:0};if(q.action==='aggregate'&&q.platformId===p2.id&&fail)throw Error('missing platform');return flowAggregate(q.platformId===p2.id?p2:P,direction)}});await settle();h.c.liveQuery();await settle();assert.equal(h.L.queryFailures.length,1);assert.equal(h.L.results.length,1);assert(!h.calls.some(q=>q.action==='collectedData'||q.action==='reportSummary'),'removed source reports never hold partial results');assert.match(h.html(),/仅为已读取结果/);
  const before=h.calls.filter(q=>q.action==='aggregate').length;fail=false;await h.c.liveRetryFailed();await settle();const retry=h.calls.filter(q=>q.action==='aggregate').slice(before);assert.equal(retry.length,1);assert.equal(retry[0].platformId,p2.id);assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.results.length,2);assert.doesNotMatch(h.html(),/missing platform/);
 }
});

test('multi-day flow analysis preserves full groups and exact contiguous daily ranges',async()=>{
 for(const [page,direction]of[['collection','charge'],['payout','withdraw']]){
  const h=await ready({page});h.setNow('2026-09-26T12:00:00Z');setScope(h,{from:'2026-09-20T00:00:00',to:'2026-09-22T05:59:59'});h.calls.length=0;h.setHandler(q=>q.action==='rates'?{rows:[],total:0}:flowAggregate(P,direction));await h.c.liveQuery();await settle();
  const reads=h.calls.filter(q=>q.action==='aggregate'&&q.view!=='providers');assert.equal(reads.length,3);assert.deepEqual(reads.map(q=>[q.startAt,q.endAt]),[['2026-09-19T18:30:00.000Z','2026-09-20T18:30:00.000Z'],['2026-09-20T18:30:00.000Z','2026-09-21T18:30:00.000Z'],['2026-09-21T18:30:00.000Z','2026-09-22T00:30:00.000Z']]);assert(reads.every(q=>q.direction===direction));assert.equal(h.L.results[0]._parts.length,3);assert.equal(h.L.results[0].summary[0].all_count,30);assert.equal(h.L.results[0].groups.hourly[0].all_count,30);assert.equal(h.L.results[0].groups.provider[0].all_count,30);
 }
});

test('overview requires the explicit query action even when a background caller invokes liveLoad',async()=>{
 const h=await ready();const before=h.calls.length;h.L.dirty=false;
 await h.c.liveLoad();await h.c.liveLoad(false);await h.c.liveOverviewAnalysis();await h.c.liveOverviewWorkorders();await settle();
 assert.equal(h.calls.length,before);assert.equal(h.L.overviewQueried,false);assert.match(h.html(),/点击查询/);assert.doesNotMatch(h.html(),/df-flow-card/);
 const filter=h.nodes.get('liveFilters').innerHTML,actions=h.nodes.get('.title-actions').innerHTML;assert.match(filter,/onclick="liveDateRangeToggle\(false\);liveQuery\(\)"[^>]*>查询/);assert.doesNotMatch(actions,/读取最新数据|全部平台数据/);assert.match(actions,/导出当前表/);
 await h.c.liveQuery();await settle();assert.equal(h.L.overviewQueried,true);assert(h.L.results.length);const loaded=h.calls.length;
 await h.c.liveLoad(false);await settle();assert.equal(h.calls.length,loaded,'background refresh does not start a second overview query');assert.equal(h.L.dirty,false,'an ignored background call preserves the completed manual query');
 h.c.setPage('orders');h.c.liveClosePage('overview');h.c.setPage('overview');await settle();const returned=h.calls.length;h.L.dirty=false;h.c.render();await h.c.liveOverviewAnalysis();await h.c.liveOverviewWorkorders();assert.equal(h.calls.length,returned);assert.equal(h.L.overviewQueried,false);assert.match(h.html(),/点击查询/);assert.doesNotMatch(h.html(),/df-flow-card/);
});

test('overview and provider summaries prioritize two primary reads before ancillary reports and fees',async()=>{
 for(const page of ['overview','providers','provider_payout']){
  const direction=page==='provider_payout'?'withdraw':'charge',platforms=[P,{...P,id:'22222222-2222-4222-8222-222222222222'},{...P,id:'33333333-3333-4333-8333-333333333333'}],pending=platforms.map(()=>deferred());let initial=true;
  const h=harness({page,reports:true,handler:q=>{
   if(q.action==='catalog')return {platforms};if(q.action==='collectedData')return {rows:[]};if(q.action==='rates')return {rows:[],total:0};
   const platform=platforms.find(p=>p.id===q.platformId)||P;if(q.action==='aggregate'&&initial)return pending[platforms.indexOf(platform)].promise;return flowAggregate(platform,direction);
  }});await settle();const run=h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='aggregate').length,2,page+' bounds concurrent primary reads');
  pending[0].resolve(flowAggregate(platforms[0],direction));await settle();assert.equal(h.L.results.length,1);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,3);assert.equal(h.calls.filter(q=>['rates','collectedData','reportSummary'].includes(q.action)).length,0,'ancillary reads wait for primary completion');
  initial=false;pending[1].resolve(flowAggregate(platforms[1],direction));pending[2].resolve(flowAggregate(platforms[2],direction));await run;await settle();assert.equal(h.L.results.length,3);assert.equal(h.L.loading,false);assert.equal(h.calls.some(q=>q.action==='collectedData'),false,'source reports are removed from business queries');assert(h.calls.some(q=>q.action==='rates'));
 }
});


test('tabs isolate filters, controls, result references and both scroll axes past the request cache TTL',async()=>{
 const h=await ready({observe:true});await h.c.liveQuery();await settle();
 h.L.multi.team=['TEAM A'];h.L.team='TEAM A';h.L.multiSearch={platform:'saved search'};h.L.providerExpanded={saved:true};h.L.tablePages={sample:3};h.L.tableSizes={sample:50};h.L.localPage=3;
 const result=h.L.results,child={scrollLeft:124,scrollTop:43};h.nodes.get('page').querySelectorAll=()=>[child];h.c.scrollX=19;h.c.scrollY=480;
 h.c.setPage('time');await settle();h.L.multi.team=['TEAM B'];h.L.team='TEAM B';h.L.multiSearch.platform='other';h.L.providerExpanded.saved=false;h.L.tablePages.sample=1;h.L.localPage=1;child.scrollLeft=0;child.scrollTop=0;
 h.setNow('2026-09-23T12:02:00Z');const reads=h.calls.length;h.c.setPage('overview');await settle();
 assert.equal(h.calls.length,reads);assert.equal(h.L.results,result);assert.equal(h.L.team,'TEAM A');assert.deepEqual([...h.L.multi.team],['TEAM A']);assert.equal(h.L.multiSearch.platform,'saved search');assert.equal(h.L.providerExpanded.saved,true);assert.equal(h.L.tablePages.sample,3);assert.equal(h.L.tableSizes.sample,50);assert.equal(h.L.localPage,3);assert.equal(h.c.scrollX,19);assert.equal(h.c.scrollY,480);assert.equal(child.scrollLeft,124);assert.equal(child.scrollTop,43);
 const restoredReads=h.calls.length;for(const callback of h.observations)callback([{isIntersecting:true,target:{hasAttribute:()=>true}}]);await settle();assert.equal(h.calls.length,restoredReads,'old overview observers must not resume lazy reads after a tab restore');
 h.c.setPage('time');assert.equal(h.L.team,'TEAM B');assert.equal(h.L.multiSearch.platform,'other');assert.equal(h.L.localPage,1);
});

test('closing tabs releases their navigation state and the final tab returns to a fresh manual overview',async()=>{
 const h=await ready();await h.c.liveQuery();await settle();h.c.setPage('time');await settle();h.c.setPage('providers');await settle();
 h.c.liveClosePage('time');assert.doesNotMatch(h.nodes.get('livePageTabs').innerHTML,/关闭 time/);assert.equal(h.c.state.page,'providers');
 h.c.liveCloseOtherPages();assert.doesNotMatch(h.nodes.get('livePageTabs').innerHTML,/关闭 overview/);assert.match(h.nodes.get('livePageTabs').innerHTML,/关闭 代收汇总/);
 const reads=h.calls.length;h.c.liveCloseAllPages();await settle();assert.equal(h.c.state.page,'overview');assert.equal(h.L.overviewQueried,false);assert.match(h.html(),/点击查询/);assert.equal(h.calls.length,reads);assert.equal(h.L.results.length,0);assert.equal(h.nodes.get('livePageTabs').innerHTML.match(/class="live-page-tab"/g).length,1);
 h.c.liveClosePage('overview');assert.equal(h.c.state.page,'overview');assert.equal(h.L.overviewQueried,false);assert.equal(h.calls.length,reads);
});

test('returning to an unfinished risk tab waits for manual resume of only missing platforms and rejects the old response',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222'},old=deferred(),resumed=deferred();let attempt=0;
 const h=harness({page:'risk',handler:q=>q.action==='catalog'?{platforms:[P,p2]}:q.action==='rates'?{rows:[],total:0}:q.action==='aggregate'&&q.platformId===p2.id?(++attempt===1?old.promise:resumed.promise):completeAggregate(P,17,9)});
 await settle();h.c.liveQuery();await settle();assert.equal(h.L.loading,true);assert.equal(h.L.results.length,1);const first=h.L.results[0];
 h.c.setPage('workorder_workload');h.c.setPage('risk');await settle();
 assert.equal(h.L.queryRetrying,false);assert.equal(h.L.queryPaused,true);assert.match(h.html(),/继续查询/);const beforeResume=h.calls.length;h.c.render();await settle();assert.equal(h.calls.length,beforeResume);h.c.liveRetryFailed(true);await settle();assert.equal(h.L.queryRetrying,true);assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.results[0],first);assert.match(h.html(),/正在继续读取剩余平台/);assert.doesNotMatch(h.html(),/切换页面后已暂停读取|部分平台读取失败/);
 const reads=h.calls.length;old.resolve(completeAggregate(p2,987654,900000));await settle();assert.equal(h.calls.length,reads);assert.equal(h.L.results.length,1);assert.doesNotMatch(h.html(),/987,654/);
 resumed.resolve(completeAggregate(p2,19,10));await settle();assert.equal(h.L.queryRetrying,false);assert.equal(h.L.results.length,2);assert.equal(h.L.queryFailures.length,0);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,3,'only the uncompleted platform is resumed');
 const completeReads=h.calls.length;h.c.setPage('workorder_workload');h.c.setPage('risk');await settle();assert.equal(h.calls.length,completeReads,'a completed tab is restored without another query');
});

test('risk retry handles real failures, while changed filters prevent resuming the old scope',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222'};let fail=true;
 const h=harness({page:'risk',handler:q=>{if(q.action==='catalog')return {platforms:[P,p2]};if(q.action==='rates')return {rows:[],total:0};if(q.platformId===p2.id&&fail)throw Error('synthetic unavailable');return completeAggregate(q.platformId===p2.id?p2:P)}});
 await settle();h.c.liveQuery();await settle();assert.equal(h.L.results.length,1);assert.match(h.html(),/synthetic unavailable/);const before=h.calls.filter(q=>q.action==='aggregate').length;
 h.c.liveSet('from','2026-09-20T00:00:00');h.c.setPage('workorder_workload');h.c.setPage('risk');await h.c.liveRetryFailed();await settle();assert.equal(h.calls.filter(q=>q.action==='aggregate').length,before,'dirty filters require a new query');
 h.L.from='2026-09-22T00:00:00';h.L.to='2026-09-22T23:59:59';h.L.dirty=true;await h.c.liveQuery();await settle();const initial=h.calls.filter(q=>q.action==='aggregate').length;
 fail=false;await h.c.liveRetryFailed();await settle();assert.equal(h.L.results.length,2);assert.equal(h.L.queryFailures.length,0);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,initial+1);assert.doesNotMatch(h.html(),/synthetic unavailable/);
});

test('opening a new aggregate page during a query cannot inherit paused failures or an unrelated query scope',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222'},pending=deferred();let initial=true;
 const h=harness({page:'time',handler:q=>q.action==='catalog'?{platforms:[P,p2]}:q.action==='rates'?{rows:[],total:0}:q.action==='aggregate'&&q.platformId===p2.id&&initial?pending.promise:completeAggregate(q.platformId===p2.id?p2:P)});
 await settle();h.c.liveQuery();await settle();assert.equal(h.L.results.length,1);initial=false;h.c.setPage('risk');await settle();assert.equal(h.L.results.length,0);assert.equal(h.L.queryScope,'');assert.match(h.html(),/点击查询/);h.c.liveQuery();await settle();assert.equal(h.L.results.length,2);assert.equal(JSON.parse(h.L.queryScope)[0],'risk');assert.equal(h.L.queryFailures.length,0);assert.doesNotMatch(h.html(),/切换页面后已暂停读取|部分平台读取失败/);
 const current=h.L.results;pending.resolve(completeAggregate(p2,987654,900000));await settle();assert.equal(h.L.results,current);assert.doesNotMatch(h.html(),/987,654/);
});

test('sidebar exposes host page URLs without intercepting the browser modified-click action',async()=>{
 const h=await ready({initialPage:'provider_payout'});assert.equal(h.c.state.page,'provider_payout');assert.equal(h.L.direction,'withdraw');assert(h.calls.filter(q=>q.action==='aggregate').every(q=>q.direction==='withdraw'));
 const nav=h.nodes.get('nav').innerHTML;assert.match(nav,/<a[^>]+href="https:\/\/dashboard\.example\/app\/#owner-admin-preview\/overview"[^>]+target="_top"[^>]+rel="noopener"/);
 const page=h.c.state.page;let prevented=0;assert.equal(h.c.liveNavClick({button:0,ctrlKey:true,preventDefault(){prevented++}},'overview'),true);assert.equal(h.c.liveNavClick({button:0,metaKey:true,preventDefault(){prevented++}},'overview'),true);assert.equal(h.c.liveNavClick({button:1,preventDefault(){prevented++}},'overview'),true);assert.equal(h.c.state.page,page);assert.equal(prevented,0);
 assert.equal(h.c.liveNavClick({button:0,preventDefault(){prevented++}},'overview'),false);assert.equal(prevented,1);assert.equal(h.c.state.page,'overview');assert.equal(h.L.overviewQueried,false);
 const invalid=await ready({initialPage:'not_a_real_page'});assert.equal(invalid.c.state.page,'overview');assert.deepEqual(invalid.calls.map(q=>q.action),['catalog']);
});

test('a page left before catalog completion restores valid filters and waits for a new explicit query',async()=>{
 const catalog=deferred(),h=harness({page:'providers',handler:q=>q.action==='catalog'?catalog.promise:q.action==='rates'?{rows:[],total:0}:completeAggregate()});
 h.c.setPage('workorder_workload');catalog.resolve({platforms:[P]});await settle();assert.equal(h.L.catalogReady,true);const reads=h.calls.length;
 h.c.setPage('providers');await settle();assert.equal(h.L.country,'印度');assert.match(h.L.from,/^2026-/);assert.equal(h.L.dirty,true);assert.match(h.html(),/点击查询/);assert.equal(h.calls.length,reads);
 await h.c.liveQuery();await settle();assert.equal(h.L.results.length,1);assert.equal(h.L.dirty,false);assert(h.calls.some(q=>q.action==='aggregate'));
});

test('latency alone has a mandatory single direction, changing it never starts a query and restored scopes normalize',async()=>{
 const h=await ready({initialPage:'latency',handler:q=>q.action==='catalog'?{platforms:[P]}:q.action==='rates'?{rows:[],total:0}:flowAggregate(P,q.direction,10)});
 assert.equal(h.c.state.page,'latency');assert.equal(h.L.direction,'charge');assert.deepEqual([...h.L.multi.direction],['charge']);assert(h.calls.filter(q=>q.action==='aggregate').every(q=>q.direction==='charge'));
 const filters=h.nodes.get('liveFilters').innerHTML,select=filters.match(/<select[^>]*id="live-direction"[^>]*>(.*?)<\/select>/)?.[1];assert(select);assert.match(select,/value="charge"/);assert.match(select,/value="withdraw"/);assert.doesNotMatch(select,/all|全部/);assert.doesNotMatch(filters,/data-multi="direction"/);
 const reads=h.calls.length;h.c.liveSet('direction','withdraw');assert.equal(h.L.direction,'withdraw');assert.equal(h.L.dirty,true);assert.equal(h.calls.length,reads);assert.match(h.html(),/点击查询/);
 h.c.liveMultiClear('direction');h.c.liveSetMultiOption('direction',{value:'charge',checked:true});h.c.liveSet('direction','all');assert.equal(h.L.direction,'withdraw');assert.deepEqual([...h.L.multi.direction],['withdraw']);assert.equal(h.calls.length,reads);
 await h.c.liveQuery();await settle();assert(h.calls.filter(q=>q.action==='aggregate').slice(-2).every(q=>q.direction==='withdraw'));assert.match(h.html(),/提款 \/ 代付到账时效/);assert.doesNotMatch(h.html(),/充值 \/ 代收到帐时效|充值 \/ 代收到账时效/);
 h.c.setPage('time');await settle();assert.match(h.nodes.get('liveFilters').innerHTML,/data-multi="direction"/);h.c.liveSetMultiOption('direction',{value:'charge',checked:true});assert.deepEqual([...h.L.multi.direction].sort(),['charge','withdraw']);
 h.c.setPage('latency');assert.equal(h.L.direction,'withdraw');assert.deepEqual([...h.L.multi.direction],['withdraw']);h.L.direction='all';h.L.multi.direction=['charge','withdraw'];h.c.setPage('workorder_workload');const beforeRestore=h.calls.length;h.c.setPage('latency');assert.equal(h.L.direction,'charge');assert.deepEqual([...h.L.multi.direction],['charge']);assert.equal(h.calls.length,beforeRestore);assert.doesNotMatch(h.html(),/提款 \/ 代付到账时效/);
});

test('the visible admin brand and document title stay exact across normal and supervisor navigation without data reads',async()=>{
 const h=await ready(),brand='M8 | 数据中控后台',label={textContent:'Hensem 数据后台'};h.nodes.set('.sidebar .brand b',label);h.c.render();const calls=h.calls.length;
 assert.equal(h.c.document.title,brand);assert.equal(label.textContent,brand);assert.equal(h.nodes.get('.bottom-note').innerHTML,'');
 h.c.setPage('workorder_permissions');assert.equal(h.c.document.title,brand);assert.equal(label.textContent,brand);h.c.setPage('overview');assert.equal(h.c.document.title,brand);assert.equal(h.calls.length,calls);
 const metadata=fs.readFileSync(path.join(__dirname,'../src/app/layout.tsx'),'utf8');assert.match(metadata,/title: "M8 \| 数据中控后台"/);
 for(const file of ['Dashboard.tsx','DashboardAuthGate.tsx','CustomerServiceDashboard.tsx','ThirdPartyRatesDashboard.tsx']){const text=fs.readFileSync(path.join(__dirname,'../src/components',file),'utf8');assert(text.includes(brand));assert.doesNotMatch(text,/Hensem.?数据后台|Hensem 数据中控|HENSEM OPERATIONS/)}
});

test('failed catalogue has a dedicated retry and recovers without a phantom empty business query',async()=>{
 const pending=deferred();let attempts=0;
 const h=harness({handler:q=>{if(q.action==='catalog'){attempts++;if(attempts===1)throw Error('平台目录读取超时，请重试读取目录');return pending.promise}return aggregate()}});
 await settle();assert.equal(h.L.catalogReady,false);assert.equal(h.L.catalogLoading,false);assert.match(h.html(),/尚未开始查询订单/);assert.match(h.html(),/liveRetryCatalog/);assert.doesNotMatch(h.html(),/缩短日期|选择单个平台/);assert.deepEqual(h.calls.map(q=>q.action),['catalog']);
 const retry=h.c.liveRetryCatalog(),same=h.c.liveRetryCatalog();assert.equal(retry,same);assert.equal(attempts,2);assert.equal(h.L.catalogLoading,true);assert.equal(h.L.catalogError,'');assert.doesNotMatch(h.html(),/liveRetryCatalog/);
 pending.resolve({platforms:[P]});await retry;await settle();assert.equal(h.L.catalogReady,true);assert.equal(h.L.catalogLoading,false);assert.equal(h.L.catalogError,'');assert.equal(h.L.error,'');assert.equal(h.L.country,P.country);assert.match(h.html(),/点击查询/);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);
 h.c.liveQuery();await settle();assert(h.calls.some(q=>q.action==='aggregate'));assert.doesNotMatch(h.html(),/平台目录读取超时/);
});

test('malformed catalogue cannot masquerade as an authorized empty directory',async()=>{
 const h=harness({handler:q=>q.action==='catalog'?{}:aggregate()});await settle();assert.equal(h.L.catalogReady,false);assert.match(h.html(),/平台目录响应不完整/);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);
 h.setHandler(q=>q.action==='catalog'?{platforms:[]}:aggregate());await h.c.liveRetryCatalog();await settle();assert.equal(h.L.catalogReady,true);assert.equal(h.L.catalogError,'');assert.doesNotMatch(h.html(),/响应不完整/);
});

test('removed risk entries disappear from navigation and old page entry redirects to submission risk',async()=>{
 const h=await ready({initialPage:'anomaly'});assert.equal(h.c.state.page,'events');
 assert.equal(h.c.pages.find(p=>p[0]==='events')[2],'刷单风控');
 assert.ok(h.c.pages.every(p=>!['dropped','anomaly'].includes(p[0])));
 assert.ok(h.c.navGroupsV3.every(g=>g[3].every(k=>!['dropped','anomaly'].includes(k))));
});

test('provider loading shares bounded lanes with exclusions and avoids removed report sections',async()=>{
 const platforms=[P,{...P,id:'22222222-2222-4222-8222-222222222222'},{...P,id:'33333333-3333-4333-8333-333333333333'}],pending=deferred();
 const h=harness({page:'providers',submission:true,reports:true,handler:q=>{if(q.action==='catalog')return {platforms};if(q.action==='rates')return {rows:[],total:0};if(q.action==='submissionAnalysis')return pending.promise.then(()=>({platform:platforms.find(p=>p.id===q.platformId),startAt:q.startAt,endAt:q.endAt,version:3,exemptCount:0,thresholdComparison:'gt',basis:'platform_local_day_all_providers_zero_success_whole_day_over_threshold',metrics:[10,15,20,30,50,100].map(threshold=>({provider:null,threshold,qualified_member_count:0,qualified_member_days:0,member_count:0,member_days:0,invalid_count:0,invalid_amount:'0',l0_members:0,new_members:0,funded_members:0,unknown_members:0})),coverage:{missingMemberCount:0}}));return flowAggregate(platforms.find(p=>p.id===q.platformId)||P,'charge')}});await settle();h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='aggregate').length,2);assert.equal(h.calls.filter(q=>q.action==='submissionAnalysis').length,2);assert.equal(h.L.results.length,2,'received aggregates paint before exclusion finishes');pending.resolve();await settle();assert.equal(h.calls.filter(q=>q.action==='submissionAnalysis').length,3);assert.equal(h.L.loading,false);assert.doesNotMatch(h.html(),/自动出款配置接入|源日报数据|无充值人数 \/ 无效笔数：|成功数据按成功时间；/);assert.equal(h.calls.filter(q=>q.action==='reportSummary').length,0);
});

test('restored submission-only tab waits for a manual continuation without rereading completed platforms',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222'},pending=deferred();let interrupted=true;
 const h=harness({page:'events',submission:true,handler:q=>{
  if(q.action==='catalog')return {platforms:[P,p2]};if(q.action==='rates')return {rows:[],total:0};
  if(q.action==='submissionAnalysis'){const value={platform:q.platformId===p2.id?p2:P,startAt:q.startAt,endAt:q.endAt,version:3,exemptCount:0,thresholdComparison:'gt',basis:'platform_local_day_all_providers_zero_success_whole_day_over_threshold',metrics:[10,15,20,30,50,100].map(threshold=>({provider:null,threshold,qualified_member_count:0,qualified_member_days:0,member_count:0,member_days:0,invalid_count:0,invalid_amount:'0',l0_members:0,new_members:0,funded_members:0,unknown_members:0})),coverage:{missingMemberCount:0}};return q.platformId===p2.id&&interrupted?pending.promise.then(()=>value):value;}
  return completeAggregate(P);
 }});await settle();h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='submissionAnalysis').length,2);assert.match(h.html(),/已读取 1 \/ 2 平台/,'the completed v3 response must be accepted before testing cache restoration');assert.doesNotMatch(h.html(),/部分统计待核对|响应不完整/);h.c.setPage('workorder_workload');interrupted=false;h.c.setPage('events');await settle();assert.equal(h.calls.filter(q=>q.action==='submissionAnalysis').length,2);assert.match(h.html(),/读取已暂停/);h.c.liveSubmissionRetry();await settle();
 assert.deepEqual(h.calls.filter(q=>q.action==='submissionAnalysis').map(q=>q.platformId),[P.id,p2.id,p2.id]);assert.match(h.html(),/已读取 2 \/ 2 平台/);assert.doesNotMatch(h.html(),/读取已暂停/);
 const html=h.html();pending.resolve();await settle();assert.equal(h.html(),html);
});

// Reproduce the real providers render chain, including per-cell submission reads.
test('the full provider paint shares one submission scope instead of rebuilding it per cell',async()=>{
 let queries=0;const platforms=Array.from({length:16},(_,i)=>({...P,id:'synthetic-'+i,name:'Platform '+i}));
 const h=await ready({platforms,submission:true,onSubmissionQuery:()=>queries++});
 Object.assign(h.L,{pageQueried:true,dirty:false,loading:true,direction:'charge',feeLookupRows:[],queryPlatforms:platforms,results:platforms.map(p=>{const r=aggregate(p);r.groups.provider=Array.from({length:20},(_,i)=>({...stats(),provider:'Provider '+i}));return r})});
 h.c.state.page='providers';queries=0;h.c.render();assert.equal(queries,16);assert.match(h.html(),/Provider 19/);const html=h.html();
 queries=0;h.c.render();assert.equal(queries,16);assert.equal(h.html(),html,'reuse does not alter the report');
 h.L.platform=platforms[0].id;h.L.multi.platform=[platforms[0].id];queries=0;h.c.render();assert.equal(queries,1,'next paint uses the changed platform selection');
});

test('repeated platform date conversion reuses native formatters and bounded successful instants',()=>{
 const h=clockHarness(),date='2026-09-29T00:00:00';
 for(let i=0;i<1920;i++)assert.equal(h.instant(date,'Asia/Kolkata'),'2026-09-28T18:30:00.000Z');
 assert.equal(h.constructed(),1);assert.equal(h.formatted(),6,'the identical successful local second is checked only once');
 assert.equal(h.instant(date,'Asia/Kolkata',true),'2026-09-28T18:30:01.000Z');
 assert.equal(h.instant(date,'UTC'),'2026-09-29T00:00:00.000Z');
 for(let i=0;i<150;i++)h.instant(new Date(Date.parse(date+'Z')+i*1000).toISOString().slice(0,19),'Asia/Kolkata');
 assert.equal(h.sizes()[1],128);const before=h.formatted();assert.equal(h.instant(date,'UTC'),'2026-09-29T00:00:00.000Z');assert(h.formatted()>before,'evicted entries recompute correctly');
 for(const zone of Intl.supportedValuesOf('timeZone').slice(0,40))h.localClock(Date.parse(date+'Z'),zone);
 assert.equal(h.sizes()[0],32,'timezone cardinality cannot retain unbounded native formatters');
});
test('date caches preserve invalid calendar and both DST boundary rejections',()=>{
 const h=clockHarness();
 for(let repeat=0;repeat<2;repeat++)for(const date of ['2026-02-30T00:00:00','2026-03-08T02:30:00','2026-11-01T01:30:00'])assert.throws(()=>h.instant(date,'America/New_York'));
 assert.equal(h.sizes()[1],0,'failed and ambiguous instants are never cached');
 assert.equal(h.instant('2026-03-08T01:30:00','America/New_York'),'2026-03-08T06:30:00.000Z');
 assert.equal(h.instant('2026-03-08T03:30:00','America/New_York'),'2026-03-08T07:30:00.000Z');
 assert.equal(h.instant('2026-11-01T02:30:00','America/New_York'),'2026-11-01T07:30:00.000Z');
 assert.equal(h.instant('2026-11-01T01:30:00','Asia/Kolkata'),'2026-10-31T20:00:00.000Z');
 assert.throws(()=>h.instant('2026-11-01T01:30:00','America/New_York'),'another timezone cache must not bypass ambiguity');
});

// Exercise the production read/cache/merge engine independently of painting.
// This keeps every exact request field visible and models native aggregate
// facts without using order rows or member-day counts as an aggregate oracle.
const largeAr={...P,id:'5e952cbb-e42f-d6b1-a24a-a0d42d165df9',name:'91CLUB',source:'ar',scopeGroup:'IN'};
function aggregateReadHarness(handler,platform=largeAr){
 const context={Date,console,L:{serial:1,catalog:[platform],queryRetrying:false},state:{page:'overview'},isSuccessAnalysis:()=>context.state.page==='success_analysis',providerDirection:()=>null,isFlowPage:()=>false,orderSource:p=>String(p?.source||'').toLowerCase().replaceAll('_',''),displayIdentity:p=>p};
 const calls=[];let active=0,maxActive=0;context.window=context;context.hensemLiveRequest=async q=>{calls.push(JSON.parse(JSON.stringify(q)));active++;maxActive=Math.max(active,maxActive);try{return await handler(q,calls.length)}finally{active--}};
 const counts=source.slice(source.indexOf(' const countKeys='),source.indexOf(' const amountBands='));
 const read=source.slice(source.indexOf(' function mergeParts('),source.indexOf(' // Read deeper overview sections',source.indexOf(' function mergeParts(')));
 vm.runInNewContext(counts+read+';globalThis.engine={readAggregate,mergeParts,cachedAggregate};',context);
 return {c:context,...context.engine,calls,maxActive:()=>maxActive};
}
const largeRequest=extra=>({action:'aggregate',platformId:largeAr.id,startAt:'2026-09-29T18:45:00.000Z',endAt:'2026-09-30T01:10:00.000Z',direction:'charge',status:'all',currency:'INR',offset:0,limit:20,...extra});
const plain=value=>JSON.parse(JSON.stringify(value));
function splitFact(q,index=1){const r=completeAggregate(largeAr,index+2,index),s=r.summary[0];s.negative_amount_count=index;r.groups.provider[0]={...r.groups.provider[0],negative_amount_count:index,fee_low_count:index,fee_low_amount:String(index*100),fee_high_count:0,fee_high_amount:'0',fee_gap_count:0,fee_gap_amount:'0',fee_unpriced_count:0};r.latencySummary=[{direction:'charge',currency:'INR',valid_count:index,mean_ms:index*100,p50_ms:index*75,p95_ms:index*200}];return {...r,startAt:q.startAt,endAt:q.endAt};}
test('the measured AR platform starts exact contiguous two-hour full reads without waiting for a timeout',async()=>{
 const h=aggregateReadHarness(splitFact),q=largeRequest({providers:['ExactAlias'],channelTypes:['BANK'],memberId:'exact-member',amountMin:'200',amountMax:'250',amountMaxExclusive:true,durationVersion:2,amountBands:{charge:[100,200,300,400,500,750,1000,2000,5000,10000,50000]}}),r=await h.readAggregate(q,1);
 assert.deepEqual(h.calls.map(x=>[x.startAt,x.endAt]),[['2026-09-29T18:45:00.000Z','2026-09-29T20:45:00.000Z'],['2026-09-29T20:45:00.000Z','2026-09-29T22:45:00.000Z'],['2026-09-29T22:45:00.000Z','2026-09-30T00:45:00.000Z'],['2026-09-30T00:45:00.000Z','2026-09-30T01:10:00.000Z']]);
 for(const call of h.calls)assert.deepEqual({...call,startAt:q.startAt,endAt:q.endAt},q,'only half-open event-clock bounds change');
 assert.equal(h.maxActive(),1,'windows share the existing platform lane');assert.equal(r.startAt,q.startAt);assert.equal(r.endAt,q.endAt);assert.equal(r._parts.length,4);assert.equal(r.summary[0].all_count,18);assert.equal(r.summary[0].success_count,10);assert.equal(r.summary[0].created_success_count,10);assert.equal(r.summary[0].negative_amount_count,10);assert.equal(r.groups.provider[0].fee_low_count,10);assert.equal(r.groups.provider[0].fee_low_amount,1000);
 assert.deepEqual(plain(r.latencySummary),[],'quantiles are not averaged');assert.equal(r._parts[2].latencySummary[0].valid_count,3,'source statistics remain available to the validated timing adapter');
});
test('compact provider reads start with four-hour windows and preserve their explicit view',async()=>{
 const h=aggregateReadHarness(splitFact),q=largeRequest({view:'providers',endAt:'2026-09-30T04:45:00.000Z'}),r=await h.readAggregate(q,1);
 assert.equal(h.calls.length,3);assert.deepEqual(h.calls.map(x=>Date.parse(x.endAt)-Date.parse(x.startAt)),[14400000,14400000,7200000]);assert(h.calls.every(x=>x.view==='providers'));assert.equal(r.total,12);assert.equal(h.maxActive(),1);
});
test('window policy is exact to the authorized AR source and does not shorten member or withdrawal requests',async()=>{
 for(const [platform,extra]of [[P,{}],[{...largeAr,source:'newar'},{}],[largeAr,{direction:'withdraw'}],[largeAr,{action:'memberDaily'}]]){
  const h=aggregateReadHarness(splitFact,platform),q=largeRequest({...extra,platformId:platform.id});await h.readAggregate(q,1);assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0],q);
 }
});
test('a two-hour timeout retries only its exact one-hour children and never duplicates the failed range',async()=>{
 const h=aggregateReadHarness(q=>{if(Date.parse(q.endAt)-Date.parse(q.startAt)>3600000)throw Error('statement timeout');return splitFact(q)}),q=largeRequest({endAt:'2026-09-29T21:15:00.000Z',providers:['OnePay'],status:'success'}),r=await h.readAggregate(q,1);
 assert.equal(h.calls.length,4);assert.equal(r._parts.length,3);assert.deepEqual(plain(r._parts.map(p=>[p.startAt,p.endAt])),[['2026-09-29T18:45:00.000Z','2026-09-29T19:45:00.000Z'],['2026-09-29T19:45:00.000Z','2026-09-29T20:45:00.000Z'],['2026-09-29T20:45:00.000Z','2026-09-29T21:15:00.000Z']]);assert(h.calls.every(x=>x.status==='success'&&x.providers[0]==='OnePay'));assert.equal(r.total,9);
});
test('an incomplete range never becomes a whole result and retry reuses only the exact completed chunks',async()=>{
 let fail=true;const h=aggregateReadHarness((q,n)=>{if(fail&&n===2)throw Error('source unavailable');return splitFact(q)}),q=largeRequest({endAt:'2026-09-30T00:45:00.000Z'});
 await assert.rejects(h.readAggregate(q,1),/source unavailable/);assert.equal(h.calls.length,2);assert.equal(h.cachedAggregate(q),null);
 fail=false;h.c.L.queryRetrying=true;const r=await h.readAggregate(q,1);assert.equal(h.calls.length,4,'only the first exact successful two-hour chunk is reused');assert.equal(r._parts.length,3);assert.equal(r.total,9);assert.equal(h.cachedAggregate({...q,providers:['AnotherPay']}),null);
});
test('cancellation after a pending chunk prevents later windows and prevents stale cache writes',async()=>{
 const pending=deferred(),h=aggregateReadHarness(q=>pending.promise.then(()=>splitFact(q))),q=largeRequest(),run=h.readAggregate(q,1);assert.equal(h.calls.length,1);h.c.L.serial=2;pending.resolve();await assert.rejects(run,/查询已替换/);assert.equal(h.calls.length,1);assert.equal(h.cachedAggregate(q),null);
});
test('optional fee facts stay unknown if any contributing chunk lacks them',async()=>{
 const h=aggregateReadHarness((q,n)=>{const r=splitFact(q);if(n===2)delete r.groups.provider[0].fee_low_amount;return r;}),q=largeRequest({endAt:'2026-09-29T22:45:00.000Z'}),r=await h.readAggregate(q,1);assert.equal(r.groups.provider[0].fee_low_amount,null);assert.equal(r.groups.provider[0].fee_low_count,2);
 const ordinary=aggregateReadHarness(q=>completeAggregate(largeAr));const unknown=await ordinary.readAggregate(q,1);assert(!Object.hasOwn(unknown.groups.provider[0],'fee_low_amount'),'older source capabilities do not turn into fabricated zero fees');
});

test('split totals keep null and absent capability unknown rather than inventing zero',()=>{
 const h=aggregateReadHarness(splitFact),q=largeRequest(),a=splitFact(q),b=splitFact(q);
 for(const unknown of [null,undefined]){b.total=unknown;const r=h.mergeParts([a,b]);assert.equal(r.total,null);assert.equal(r.summary[0].all_count,6,'known scoped summary facts still merge');}
 delete a.total;delete b.total;assert(!Object.hasOwn(h.mergeParts([a,b]),'total'));
 a.total=0;b.total=0;assert.equal(h.mergeParts([a,b]).total,0,'a source-confirmed empty range remains zero');
});
