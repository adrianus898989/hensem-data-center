/* Navigation regressions run real production modules in a synthetic DOM. No network. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8');
const layoutSources=['live-analysis-drilldown.js','live-reference-layout.js','live-pages-reference.js','live-empty-pages.js','live-duration-reference.js','live-payout-config.js','live-filter-controls.js','live-configuration.js','live-provider-aliases.js','live-provider-summary.js','live-provider-orders.js','live-provider-sticky.js','live-collected-data.js','live-report-data.js','live-withdraw-pages.js','live-workorder-operations.js','live-deposit-issues.js'].map(name=>({name,source:fs.readFileSync(path.join(__dirname,'../admin-preview',name),'utf8')}));
const comparisonSource=fs.readFileSync(path.join(__dirname,'../admin-preview/live-comparison.js'),'utf8');
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
  HENSEM_PRODUCTION:options.production!==false,hensemAdminInitialPage:options.initialPage,hensemAdminPageUrl:key=>'https://dashboard.example/app/#owner-admin-preview/'+key,scrollX:0,scrollY:0,
  hensemLiveRequest:async request=>{calls.push(JSON.parse(JSON.stringify(request)));if(!options.ancillaryHandler&&request.action==='providerOptions')return {providers:['Synthetic provider']};if(!options.ancillaryHandler&&request.action==='workorders')return {rows:[],byProvider:[],total:0,summary:{},byDirection:{}};if(handler)return handler(request);if(request.action==='catalog')return {platforms:options.platforms||[P]};if(request.action==='details')return detail((options.platforms||[P]).find(p=>p.id===request.platformId)||P,65,request.offset,request.limit);if(request.action==='rates')return {rows:[],total:0,options:{countries:[],platforms:[],providers:[]}};if(request.action==='payoutConfig')return payoutConfig(request,(options.platforms||[P]).length>0);return aggregate((options.platforms||[P]).find(p=>p.id===request.platformId)||P,65)}
 };if(options.observe)context.IntersectionObserver=class{constructor(callback){observations.push(callback)}observe(){}disconnect(){}};context.window=context;vm.createContext(context);vm.runInContext(comparisonSource,context,{filename:'live-comparison.js',timeout:2000});for(const module of layoutSources.filter(m=>m.name!=='live-report-data.js'||options.reports))vm.runInContext(module.source,context,{filename:module.name,timeout:2000});vm.runInContext(source,context,{filename:'live-data.js',timeout:2000});
 return {c:context,L:context.adminLive,calls,writes,nodes,drawers,intervals,timers,blobs,scrolled,observations,setHandler:fn=>handler=fn,setNow:value=>clock=Date.parse(value),html:()=>nodes.get('page').innerHTML};
}
async function ready(options){const h=harness(options);await settle();if(h.L){h.L.from='2026-09-22T00:00:00';h.L.to='2026-09-22T05:59:59'}return h}
function setScope(h,values={}){Object.assign(h.L,{from:'2026-09-22T00:00:00',to:'2026-09-22T05:59:59',...values})}
function completeAggregate(p=P,count=10,success=5){const r=aggregate(p,count),s={...stats(count,String(count*100)),success_count:success,created_success_count:success,success_amount:String(success*100),pending_count:count-success,pending_amount:String((count-success)*100),failed_count:0,failed_amount:'0',rejected_count:0,rejected_amount:'0',unknown_count:0,unknown_amount:'0'};r.summary=[s];for(const key of ['provider','daily','hourly','amount','matrix'])r.groups[key]=[{...r.groups[key][0],...s}];return r}

const pageWrites=h=>h.writes.filter(w=>w.id==='page').length;
const filterWrites=h=>h.writes.filter(w=>w.id==='section').length;

function manyProviderAggregate(){const r=aggregate(P,650);r.groups.provider=Array.from({length:130},(_,i)=>({...stats(),provider:'Synthetic provider '+i}));return r;}
const workorderResult={rows:[],byProvider:[],byDirection:{charge:{submittedCount:12,submittedAmount:1200,successCount:3,successAmount:300}},summary:{},total:0};
function setupHandler(h,{pending,error=false}={}){h.setHandler(q=>q.action==='catalog'?{platforms:[P]}:q.action==='providerOptions'?{providers:['Synthetic provider']}:q.action==='rates'?{rows:[],total:0}:q.action==='workorders'?pending?pending.promise:error?Promise.reject(Error('工单超时')):workorderResult:manyProviderAggregate());}
async function failedProvider(){const h=await ready({ancillaryHandler:true});setupHandler(h,{error:true});h.c.setPage('providers');await settle();await h.c.liveQuery();await settle();assert(h.L.results.length);assert.equal(h.L.workordersError,'工单超时');return h;}
test('failed workorder retry requests only workorders and retains orders, comparison, filters and table controls',async()=>{const h=await failedProvider(),results=h.L.results,comparison=h.L.comparisonResults,scope=h.L.queryScope;h.L.localPage=3;h.L.localSize=50;h.L.providerExpanded={'synthetic':true};h.L.tablePages={providers:3};h.L.providerSort='successAmount';h.L.providerSortAsc=true;const multi=JSON.stringify(h.L.multi);const pending=deferred();setupHandler(h,{pending});const start=h.calls.length,serial=h.L.serial;assert.match(h.html(),/liveProviderWorkordersRetry/);assert.match(h.html(),/只重试工单/);const retry=h.c.liveProviderWorkordersRetry();await h.c.liveProviderWorkordersRetry();assert.equal(h.L.workordersLoading,true);assert.equal(h.L.results,results);assert.equal(h.L.comparisonResults,comparison);assert.deepEqual(h.calls.slice(start).map(q=>q.action),['workorders']);pending.resolve(workorderResult);await retry;assert.equal(h.L.serial,serial);assert.equal(h.L.queryScope,scope);assert.equal(h.L.results,results);assert.equal(h.L.comparisonResults,comparison);assert.equal(h.L.localPage,3);assert.equal(h.L.localSize,50);assert.equal(h.L.tablePages.providers,3);assert.equal(h.L.providerSort,'successAmount');assert.equal(h.L.providerSortAsc,true);assert.equal(JSON.stringify(h.L.multi),multi);assert.equal(h.L.providerExpanded.synthetic,true);assert.equal(h.L.workordersError,'');assert.deepEqual(h.calls.slice(start).map(q=>q.action),['workorders']);});
test('same-scope provider tab round trip restores results/filter/pagination/scroll without rereading orders or workorders',async()=>{const h=await failedProvider();setupHandler(h);await h.c.liveProviderWorkordersRetry();h.L.localPage=2;h.L.localSize=20;h.L.tablePages={providers:2};h.L.providerExpanded={'kept':true};h.c.scrollX=14;h.c.scrollY=650;const results=h.L.results,workorders=h.L.workorders,filters=JSON.stringify(h.L.multi);h.c.setPage('orders');await settle();const n=h.calls.length;h.c.setPage('providers');await settle();assert.equal(h.calls.length,n);assert.equal(h.L.results,results);assert.equal(h.L.workorders,workorders);assert.equal(JSON.stringify(h.L.multi),filters);assert.equal(h.L.localPage,2);assert.equal(h.L.tablePages.providers,2);assert.equal(h.L.providerExpanded.kept,true);assert.equal(h.c.scrollX,14);assert.equal(h.c.scrollY,650);});
test('retry preserves nested table scroll at each repaint and never restores scroll to another destination',async()=>{const h=await failedProvider();const pane={id:'provider-scroll',tagName:'DIV',className:'df-provider-table-scroll',scrollLeft:360,scrollTop:42};h.nodes.get('page').querySelectorAll=()=>[pane];h.c.scrollX=0;h.c.scrollY=530;const pending=deferred();setupHandler(h,{pending});const retry=h.c.liveProviderWorkordersRetry();pane.scrollLeft=0;pane.scrollTop=0;h.c.scrollY=0;pending.resolve(workorderResult);await retry;assert.equal(pane.scrollLeft,360);assert.equal(pane.scrollTop,42);assert.equal(h.c.scrollY,530);
 const late=deferred();h.L.workordersError='再试';setupHandler(h,{pending:late});const old=h.c.liveProviderWorkordersRetry();h.c.setPage('orders');h.c.scrollY=19;const before=h.scrolled.length;late.resolve(workorderResult);await old;assert.equal(h.c.state.page,'orders');assert.equal(h.c.scrollY,19);assert.equal(h.scrolled.length,before);});
test('switching away from an inflight attachment preserves successful orders and resumes only attachment on return',async()=>{const h=await failedProvider(),rows=h.L.results;const pending=deferred();setupHandler(h,{pending});const old=h.c.liveProviderWorkordersRetry();h.c.setPage('orders');h.c.setPage('providers');await settle();assert.equal(h.L.results,rows);assert.match(h.L.workordersError,/已暂停/);assert.equal(h.L.workordersLoading,false);const n=h.calls.length;setupHandler(h);await h.c.liveProviderWorkordersRetry();assert.deepEqual(h.calls.slice(n).map(q=>q.action),['workorders']);pending.resolve({...workorderResult,total:999999});await old;assert.equal(h.L.workorders.total,0);assert.equal(h.L.results,rows);});
test('changed filters or scope and a still loading main query cannot invoke attachment retry',async()=>{const h=await failedProvider(),n=h.calls.length;h.L.dirty=true;await h.c.liveProviderWorkordersRetry();h.L.dirty=false;h.L.from='2026-09-01T00:00:00';await h.c.liveProviderWorkordersRetry();h.L.from='2026-09-22T00:00:00';h.L.loading=true;await h.c.liveProviderWorkordersRetry();assert.equal(h.calls.length,n);});

for(const previousPage of ['collection','latency','provider_daily'])test('opening providers from '+previousPage+' waits for manual query before loading workorders',async()=>{
 const h=harness({page:previousPage,ancillaryHandler:true});await settle();setupHandler(h);await h.c.liveQuery();await settle();
 const orders=h.L.results,before=h.calls.length;
 assert.equal(h.L.direction,'charge');assert.equal(h.L.dirty,false);assert.equal(h.L.loadedView,'full');assert(orders.length);
 h.c.setPage('providers');await settle();assert.equal(h.calls.length,before,'navigation waits');await h.c.liveQuery(false);await settle();
 const requests=h.calls.slice(before);
 assert.equal(requests.filter(q=>q.action==='aggregate').length,0,'navigation must retain the completed order query');
 assert.equal(requests.filter(q=>q.action==='workorders').length,1,'the workorder attachment has never been queried for this scope');
 assert.equal(h.L.results[0].total,orders[0].total);assert.equal(h.L.workorders?.byDirection.charge.submittedCount,12);
 assert.equal(h.L.workordersLoading,false);assert.equal(h.L.workordersError,'');
});

test('restoring a provider tab with an uninitialized attachment waits for manual retry',async()=>{
 const h=harness({page:'collection',ancillaryHandler:true,handler:q=>q.action==='catalog'?{platforms:[P]}:q.action==='providerOptions'?{providers:['Synthetic provider']}:q.action==='rates'?{rows:[],total:0}:q.action==='workorders'?workorderResult:manyProviderAggregate()});await settle();setupHandler(h);h.c.setPage('providers');await settle();await h.c.liveQuery();await settle();
 assert.equal(h.L.results[0].groups.provider.length,130,'the second page must be valid before testing that restoration preserves it');
 // A saved tab may predate loading the ancillary workorder report. It must not
 // remain a permanent all-dashes report when that tab is restored.
 Object.assign(h.L,{workorders:null,workordersScope:'',workordersError:'',workordersLoading:false});
 const orders=h.L.results;h.L.localPage=2;h.L.providerExpanded={kept:true};
 h.c.setPage('collection');await settle();const before=h.calls.length;
 h.c.setPage('providers');await settle();assert.equal(h.calls.length,before);await h.c.liveProviderWorkordersRetry();await settle();
 assert.deepEqual(h.calls.slice(before).map(q=>q.action),['workorders']);
 assert.equal(h.L.results,orders);assert.equal(h.L.localPage,2);assert.equal(h.L.providerExpanded.kept,true);
 assert.equal(h.L.workorders?.byDirection.charge.submittedCount,12);
});

for(const staleKind of ['direction','date'])test('opening providers rejects a successful workorder attachment from another '+staleKind+' scope',async()=>{
 const h=harness({page:'collection',ancillaryHandler:true});await settle();setupHandler(h);await h.c.liveQuery();await settle();
 const staleDirection=staleKind==='direction'?'withdraw':'charge',staleFrom=staleKind==='date'?'2026-09-01T00:00:00':h.L.from;
 h.L.workorders={rows:[],byProvider:[{provider:'Synthetic provider',direction:staleDirection,submittedCount:999999}],byDirection:{[staleDirection]:{submittedCount:999999}},total:1};
 h.L.workordersScope=JSON.stringify([h.L.country,staleFrom,h.L.to,staleDirection,[P.id],[]]);
 const orders=h.L.results,before=h.calls.length;h.c.setPage('providers');await settle();assert.equal(h.calls.length,before);assert.equal(h.L.workorders,null);await h.c.liveQuery(false);await settle();
 const requests=h.calls.slice(before);assert.equal(requests.filter(q=>q.action==='aggregate').length,0);
 assert.equal(requests.filter(q=>q.action==='workorders').length,1);
 assert.equal(requests.find(q=>q.action==='workorders').direction,'charge');
 assert.equal(h.L.results[0].total,orders[0].total);assert.equal(h.L.workorders?.byDirection.charge.submittedCount,12);
 assert(!h.html().includes('999,999'));
});

test('restoring a provider tab invalidates stale workorders and waits for manual retry',async()=>{
 const h=harness({page:'collection',ancillaryHandler:true});await settle();setupHandler(h);h.c.setPage('providers');await settle();await h.c.liveQuery();await settle();
 h.L.workordersScope=JSON.stringify([h.L.country,'2026-09-01T00:00:00',h.L.to,'withdraw',[P.id],[]]);
 h.L.workorders={...workorderResult,byDirection:{withdraw:{submittedCount:999999}}};
 const orders=h.L.results;h.c.setPage('collection');await settle();const before=h.calls.length;
 h.c.setPage('providers');await settle();assert.equal(h.calls.length,before);await h.c.liveProviderWorkordersRetry();await settle();
 assert.deepEqual(h.calls.slice(before).map(q=>q.action),['workorders']);
 assert.equal(h.L.results,orders);assert.equal(h.L.workorders?.byDirection.charge.submittedCount,12);
});

async function partiallyFailedProvider(){
 const other={...P,id:'22222222-2222-4222-8222-222222222222',name:'Other synthetic platform'};
 const h=await ready({platforms:[P,other],ancillaryHandler:true});let failed=true;
 h.setHandler(q=>{
  if(q.action==='catalog')return {platforms:[P,other]};
  if(q.action==='providerOptions')return {providers:['Synthetic provider']};
  if(q.action==='rates')return {rows:[],total:0};
  if(q.action==='workorders')return workorderResult;
  if(q.action==='aggregate'&&q.platformId===other.id&&failed)throw Error('Synthetic order source unavailable');
  return aggregate(q.platformId===other.id?other:P,65);
 });
 h.c.setPage('providers');await settle();await h.c.liveQuery();await settle();
 return {h,other,recover(){failed=false}};
}

test('a failed payment-order platform does not suppress the independent workorder summary',async()=>{
 const {h,other}=await partiallyFailedProvider();
 assert.equal(h.L.results.length,1);assert.equal(h.L.queryFailures.length,1);assert.equal(h.L.queryFailures[0].id,other.id);
 assert.equal(h.L.loading,false);assert.equal(h.L.workordersLoading,false);assert.equal(h.L.workordersError,'');
 const requests=h.calls.filter(q=>q.action==='workorders');assert.equal(requests.length,1);
 assert.deepEqual(requests[0].platforms,[P.name,other.name],'workorders use the full selected scope, independently of completed payment-order platforms');
 assert.equal(h.L.workorders?.byDirection.charge.submittedCount,12);
});

test('retrying failed payment-order platforms retains an already successful workorder summary',async()=>{
 const {h,other,recover}=await partiallyFailedProvider(),workorders=h.L.workorders,completed=h.L.results[0];
 assert.equal(workorders?.byDirection.charge.submittedCount,12);recover();const before=h.calls.length;
 await h.c.liveRetryFailed();await settle();
 assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.results.length,2);
 assert.equal(h.L.results.find(r=>r.platform.id===P.id),completed);assert.equal(h.L.workorders,workorders);
 assert.equal(h.calls.slice(before).filter(q=>q.action==='workorders').length,0,'successfully loaded ancillary data must not restart');
 assert(h.calls.slice(before).some(q=>q.action==='aggregate'&&q.platformId===other.id));
});

test('empty or malformed workorder responses show an error and can be retried independently',async()=>{
 for(const response of [null,{}, {rows:[]}]){
  const h=await ready({ancillaryHandler:true});
  h.setHandler(q=>q.action==='catalog'?{platforms:[P]}:q.action==='providerOptions'?{providers:['Synthetic provider']}:q.action==='rates'?{rows:[],total:0}:q.action==='workorders'?response:manyProviderAggregate());
  h.c.setPage('providers');await settle();await h.c.liveQuery();await settle();
  assert.equal(h.L.workorders,null);assert.equal(h.L.workordersLoading,false);assert(h.L.workordersError,'an unusable result must not become a silent successful attachment');
  assert.match(h.html(),/liveProviderWorkordersRetry/);
  const orders=h.L.results,comparison=h.L.comparisonResults,before=h.calls.length;setupHandler(h);
  await h.c.liveProviderWorkordersRetry();await settle();
  assert.deepEqual(h.calls.slice(before).map(q=>q.action),['workorders']);
  assert.equal(h.L.results,orders);assert.equal(h.L.comparisonResults,comparison);
  assert.equal(h.L.workordersError,'');assert.equal(h.L.workorders?.byDirection.charge.submittedCount,12);
 }
});
