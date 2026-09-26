/* Navigation regressions run real production modules in a synthetic DOM. No network. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8');
const layoutSources=['live-analysis-drilldown.js','live-reference-layout.js','live-pages-reference.js','live-empty-pages.js','live-duration-reference.js','live-payout-config.js','live-filter-controls.js','live-configuration.js','live-provider-aliases.js','live-provider-summary.js','live-provider-orders.js','live-provider-sticky.js','live-collected-data.js','live-report-data.js','live-withdraw-pages.js','live-deposit-issues.js'].map(name=>({name,source:fs.readFileSync(path.join(__dirname,'../admin-preview',name),'utf8')}));
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
 const nodes=new Map(),writes=[],calls=[],drawers=[],intervals=[],timers=[],blobs=[];let handler=options.handler,clock=Date.parse('2026-09-23T12:00:00Z');
 function node(id){let html='';const item={id,textContent:'',value:'',title:'',style:{setProperty(k,v){this[k]=v}},classList:{add(){},remove(){}},querySelector:s=>node(id+' '+s),querySelectorAll:()=>[],appendChild(n){if(n.id)nodes.set(n.id,n);return n},after(n){if(n.id)nodes.set(n.id,n)},remove(){nodes.delete(this.id)},setAttribute(){},click(){},focus(){}};Object.defineProperty(item,'innerHTML',{get:()=>html,set:v=>{html=String(v);writes.push({id,html})}});return item}
 for(const id of ['pageTitle','pageSubtitle','eyebrow','crumbTitle','nav','filters','scope','page','headerActivityV3','.title-actions','.bottom-note','.top-right','.topbar'])nodes.set(id,node(id));
 const keys=['overview','providers','orders','time','amount','matrix','provider_daily','latency','stuck','collection','payout','risk','channelquality','teamops','teamcountries','teamplatforms','merchants','workorders','rates','data_health','deposit_tracking','dropped','anomaly','events','rules','access','ip','login_logs','operation_logs','teams','provider_config','platform_systems','merchantproviders'];
 const merchantKeys=['merchants','merchantproviders','workorders','deposit_tracking'];
 const pages=keys.map(k=>[k,'',k,'',k]),groups=[['analysis','','数据分析',keys.filter(k=>!merchantKeys.includes(k))],['merchant','','商户中心',merchantKeys]];
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}}
 class TestURL extends URL{static createObjectURL(blob){blobs.push(blob);return 'blob:synthetic'}static revokeObjectURL(){}}
 const context={console,Intl,Date:FixedDate,URL:TestURL,Blob,state:{page:options.page||'overview',navGroup:'analysis'},pages,navGroupsV3:groups,location:{hash:''},
  document:{title:'',body:{classList:{add(){},remove(){}},appendChild(n){nodes.set(n.id,n)}},getElementById:id=>nodes.get(id)||null,querySelector:selector=>nodes.get(selector)||null,createElement:tag=>node(tag)},
  render(){nodes.get('page').innerHTML='INDEPENDENT_SNAPSHOT'},syncFilters(){},groupForV3:key=>groups.find(g=>g[3].includes(key))||groups[0],toggleCenterV3(){},setPage(){},headerIconV3:()=>'<svg></svg>',openDrawer:(title,html)=>drawers.push({title,html}),toast(){},scrollTo(){},
  setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length},clearInterval(){},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout(){},
  HENSEM_PRODUCTION:options.production!==false,
  hensemLiveRequest:async request=>{calls.push(JSON.parse(JSON.stringify(request)));if(!options.ancillaryHandler&&request.action==='providerOptions')return {providers:['Synthetic provider']};if(!options.ancillaryHandler&&request.action==='workorders')return {rows:[],byProvider:[],total:0,summary:{},byDirection:{}};if(handler)return handler(request);if(request.action==='catalog')return {platforms:options.platforms||[P]};if(request.action==='details')return detail((options.platforms||[P]).find(p=>p.id===request.platformId)||P,65,request.offset,request.limit);if(request.action==='rates')return {rows:[],total:0,options:{countries:[],platforms:[],providers:[]}};if(request.action==='payoutConfig')return payoutConfig(request,(options.platforms||[P]).length>0);return aggregate((options.platforms||[P]).find(p=>p.id===request.platformId)||P,65)}
 };context.window=context;vm.createContext(context);vm.runInContext(comparisonSource,context,{filename:'live-comparison.js',timeout:2000});for(const module of layoutSources.filter(m=>m.name!=='live-report-data.js'||options.reports))vm.runInContext(module.source,context,{filename:module.name,timeout:2000});vm.runInContext(source,context,{filename:'live-data.js',timeout:2000});
 return {c:context,L:context.adminLive,calls,writes,nodes,drawers,intervals,timers,blobs,setHandler:fn=>handler=fn,setNow:value=>clock=Date.parse(value),html:()=>nodes.get('page').innerHTML};
}
async function ready(options){const h=harness(options);await settle();if(h.L){h.L.from='2026-09-22T00:00:00';h.L.to='2026-09-22T05:59:59'}return h}
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
 const h=await ready({ancillaryHandler:false});await h.c.liveLoad();await settle();const pending=deferred();h.L.from='2026-09-20T00:00:00';h.L.to='2026-09-20T23:59:59';
 h.setHandler(q=>q.action==='aggregate'?pending.promise:Promise.resolve({rows:[],total:0}));
 const before=pageWrites(h);h.c.setPage('provider_payout');
 assert.equal(h.c.state.page,'provider_payout');assert.equal(h.c.location.hash,'provider_payout');assert.equal(h.L.direction,'withdraw');assert.equal(h.L.loading,true);assert.equal(pageWrites(h)-before,1,'all synchronous loader notifications share one destination paint');
 const afterNavigation=pageWrites(h);await settle();assert.equal(pageWrites(h),afterNavigation,'provider option completion updates its filters, not the whole report');
 h.c.setPage('orders');assert.equal(h.c.state.page,'orders');assert.match(h.html(),/请先选择一个商户/);const afterOrders=pageWrites(h);
 pending.resolve(completeAggregate(P,987654,987653));await settle();
 assert.equal(pageWrites(h),afterOrders,'the old aggregate cannot repaint the new page');assert.doesNotMatch(h.html(),/987,654|98,765,400/);assert.equal(h.L.loading,false);
});

test('overview navigation paints immediately without starting business or auxiliary reads',async()=>{
 const h=await ready();assert.equal(h.L.overviewQueried,false);assert.deepEqual(h.calls.map(q=>q.action),['catalog']);
 await h.c.liveLoad();await settle();assert.equal(h.L.overviewQueried,true);assert(h.L.results.length>0);
 h.c.setPage('provider_payout');await settle();const calls=h.calls.length,before=pageWrites(h);
 h.c.setPage('overview');assert.equal(h.c.state.page,'overview');assert.equal(h.c.location.hash,'overview');assert.equal(h.L.overviewQueried,false);assert.equal(h.L.dirty,true);assert.equal(h.L.loading,false);assert.equal(pageWrites(h)-before,1);assert.match(h.html(),/查询/);assert.doesNotMatch(h.html(),/代收经营总数据|代付经营总数据/);
 await settle();assert.equal(h.calls.length,calls,'returning to overview does not fetch orders, comparison, fees, source reports or provider options');assert.equal(pageWrites(h)-before,1,'no background completion is needed to render the manual query screen');
});

test('dedicated-page responses cache data but do not repaint a different destination',async()=>{
 const h=await ready(),old=deferred(),current=deferred();h.setHandler(q=>q.action==='providerConfig'?old.promise:q.action==='platformAssignments'?current.promise:Promise.resolve({rows:[],total:0}));
 h.c.setPage('provider_config');assert.equal(h.L.providerConfigLoading,true);
 const before=pageWrites(h);h.c.setPage('teams');assert.equal(pageWrites(h)-before,1);assert.equal(h.L.platformAssignmentsLoading,true);
 const waiting=pageWrites(h);old.resolve({rows:[],total:0});await settle();assert.equal(pageWrites(h),waiting);assert.equal(h.L.providerConfigLoading,false);assert(h.L.providerConfig,'completed old request remains reusable');
 current.resolve({rows:[],total:0});await settle();assert.equal(pageWrites(h)-waiting,1);assert.equal(h.L.platformAssignmentsLoading,false);assert.equal(h.c.state.page,'teams');
});

test('collected catalog response cannot redraw another menu and is reused on return',async()=>{
 const h=await ready(),pending=deferred();h.setHandler(q=>q.action==='collectedData'?pending.promise:Promise.resolve({rows:[],total:0}));
 h.c.setPage('collected_data');h.c.setPage('orders');const before=pageWrites(h),calls=h.calls.filter(q=>q.action==='collectedData').length;
 pending.resolve({rows:[]});await settle();assert.equal(pageWrites(h),before);assert.match(h.html(),/请先选择一个商户/);
 h.c.setPage('collected_data');assert.equal(h.calls.filter(q=>q.action==='collectedData').length,calls);assert.equal(pageWrites(h)-before,1);assert.doesNotMatch(h.html(),/请先选择一个商户/);
});

test('lazy fee lookup does not recursively rebuild the page during its first paint',async()=>{
 const h=await ready();await h.c.liveLoad();await settle();const pending=deferred();h.L.feeLookupRows=null;h.L.feeLookupLoading=false;h.L.feeLookupError='';h.c.state.page='providers';h.L.direction='charge';h.L.multi.direction=['charge'];h.setHandler(q=>q.action==='rates'?pending.promise:Promise.resolve(aggregate()));
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
 h.c.setPage('rates');assert.equal(h.L.feeLoading,true);h.c.setPage('orders');const before=pageWrites(h);
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
