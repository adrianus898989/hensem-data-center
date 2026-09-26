/* Synthetic-only VM tests for the production UI adapter. No credentials/network/real orders. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8');
const layoutSources=['live-reference-layout.js','live-pages-reference.js','live-empty-pages.js','live-duration-reference.js','live-payout-config.js','live-filter-controls.js','live-configuration.js','live-provider-aliases.js','live-provider-summary.js', 'live-provider-orders.js','live-provider-sticky.js','live-collected-data.js', 'live-withdraw-pages.js','live-deposit-issues.js'].map(name=>({name,source:fs.readFileSync(path.join(__dirname,'../admin-preview',name),'utf8')}));
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
 };context.window=context;vm.createContext(context);vm.runInContext(comparisonSource,context,{filename:'live-comparison.js',timeout:2000});for(const module of layoutSources)vm.runInContext(module.source,context,{filename:module.name,timeout:2000});vm.runInContext(source,context,{filename:'live-data.js',timeout:2000});
 return {c:context,L:context.adminLive,calls,writes,nodes,drawers,intervals,timers,blobs,setHandler:fn=>handler=fn,setNow:value=>clock=Date.parse(value),html:()=>nodes.get('page').innerHTML};
}
async function queried(options){const h=harness(options);await settle();assert.equal(h.L.overviewQueried,false);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0,'opening overview does not query business data');h.L.from='2026-09-22T00:00:00';h.L.to='2026-09-22T05:59:59';await h.c.liveQuery();await settle();assert.equal(h.L.overviewQueried,true);assert.equal(h.L.dirty,false);return h}
function setScope(h,values={}){Object.assign(h.L,{from:'2026-09-22T00:00:00',to:'2026-09-22T05:59:59',...values})}
function completeAggregate(p=P,count=10,success=5){const r=aggregate(p,count),s={...stats(count,String(count*100)),success_count:success,created_success_count:success,success_amount:String(success*100),pending_count:count-success,pending_amount:String((count-success)*100),failed_count:0,failed_amount:'0',rejected_count:0,rejected_amount:'0',unknown_count:0,unknown_amount:'0'};r.summary=[s];for(const key of ['provider','daily','hourly','amount','matrix'])r.groups[key]=[{...r.groups[key][0],...s}];return r}

// These tests exercise request lifetime and snapshots with synthetic platforms only.
test('inline analysis preserves visible provider totals and reads platforms sequentially',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222',name:'Second platform'},h=await queried({platforms:[P,p2]}),first=deferred(),second=deferred(),primary=h.L.results;
 const calls=[];h.setHandler(q=>{calls.push(q);return q.platformId===P.id?first.promise:second.promise});
 const run=h.c.liveOverviewAnalysis();await settle();assert.equal(h.L.loading,false);assert.equal(h.L.results,primary);assert.equal(h.L.overviewSections.status,'loading');assert.equal(calls.length,1);assert.equal(calls[0].view,undefined);
 await h.c.liveOverviewAnalysis();assert.equal(calls.length,1,'repeated visible/render events cannot start duplicates');
 first.resolve(completeAggregate(P,20,12));await settle();assert.equal(calls.length,2);assert.equal(h.L.overviewSections.done,1);assert.equal(h.L.overviewSections.results[0].total,20);assert.equal(h.L.results,primary);
 second.resolve(completeAggregate(p2,30,15));await run;assert.equal(h.L.overviewSections.status,'ready');assert.equal(h.L.overviewSections.done,2);assert.equal(h.L.results,primary);assert.equal(h.L.overviewAnalysis,false);assert.equal(h.L.loadedView,'providers');
});
test('inline partial analysis retains successful platforms and retries only failures',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222',name:'Failed platform'},h=await queried({platforms:[P,p2]}),calls=[];
 h.setHandler(async q=>{calls.push(q);if(q.platformId===p2.id)throw Error('Synthetic unavailable');return completeAggregate(P,20,12)});
 await h.c.liveOverviewAnalysis();assert.equal(h.L.overviewSections.status,'partial');assert.equal(h.L.overviewSections.done,1);assert.equal(h.L.overviewSections.total,2);assert.equal(h.L.overviewSections.failures[0].name,p2.name);
 h.setHandler(async q=>{calls.push(q);return completeAggregate(p2,30,15)});await h.c.liveOverviewAnalysis();assert.equal(calls.length,3);assert.equal(calls[2].platformId,p2.id);assert.equal(h.L.overviewSections.status,'ready');assert.equal(h.L.overviewSections.done,2);
});
test('no successful analysis leaves an explicit error state and keeps primary data intact',async()=>{
 const h=await queried(),primary=h.L.results;let calls=0;h.setHandler(async()=>{calls++;throw Error('读取超时')});
 await h.c.liveOverviewAnalysis();assert.equal(calls,4,'three bounded split levels, then stop without publishing partial platform data');assert.equal(h.L.overviewSections.status,'error');assert.equal(h.L.overviewSections.done,0);assert.equal(h.L.overviewSections.results.length,0);assert.equal(h.L.results,primary);assert.equal(h.L.error,'');
});
test('changing filters or leaving overview invalidates late analysis and prevents subsequent platform reads',async()=>{
 for(const change of [h=>h.c.liveSet('provider','Other provider'),h=>h.c.setPage('rates')]){
  const p2={...P,id:'22222222-2222-4222-8222-222222222222'},h=await queried({platforms:[P,p2]}),wait=deferred();let reads=0;
  h.setHandler(q=>{if(q.action==='aggregate'){reads++;return wait.promise}return {rows:[],total:0,options:{}}});
  const run=h.c.liveOverviewAnalysis();await settle();change(h);const next=h.L.overviewSections;wait.resolve(completeAggregate(P,999,999));await run;assert.equal(h.L.overviewSections,next);assert.equal(reads,1);assert(!h.L.results.some(r=>r.total===999));
 }
});
test('a fresh query cancels pending analysis and restarts with compact providers',async()=>{
 const h=await queried(),wait=deferred();h.setHandler(()=>wait.promise);const old=h.c.liveOverviewAnalysis();await settle();
 const calls=[];h.setHandler(async q=>{calls.push(q);return completeAggregate(P,30,15)});await h.c.liveQuery();assert.equal(h.L.overviewSections.status,'idle');assert(calls.filter(q=>q.action==='aggregate').every(q=>q.view==='providers'));
 wait.resolve(completeAggregate(P,999,999));await old;assert.equal(h.L.overviewSections.status,'idle');assert.equal(h.L.results[0].total,30);
});
test('analysis rendering uses only loaded analysis snapshots and restores core data even on exceptions',async()=>{
 const h=await queried(),primary=h.L.results;h.setHandler(async()=>completeAggregate(P,30,15));await h.c.liveOverviewAnalysis();
 let context;const create=h.c.HensemLivePages.create;h.c.HensemLivePages.create=c=>{context=c;return create(c)};h.c.render();
 assert.equal(context.overviewAnalysisRender(()=>h.L.results[0].total),30);assert.equal(h.L.results,primary);
 assert.throws(()=>context.overviewAnalysisRender(()=>{throw Error('render failed')}),/render failed/);assert.equal(h.L.results,primary);
});
test('visible overview sections load once; offscreen, primary loading and stale observers do not read',async()=>{
 const h=await queried(),observers=[];h.c.IntersectionObserver=class{constructor(callback){this.callback=callback;this.targets=[];observers.push(this)}observe(node){this.targets.push(node)}disconnect(){this.disconnected=true}};
 const target={hasAttribute:name=>name==='data-live-overview-analysis'};h.nodes.get('page').querySelectorAll=()=>[target];
 const before=h.calls.length;h.c.render();assert.equal(h.calls.length,before);const observer=observers.at(-1);observer.callback([{target,isIntersecting:false}]);assert.equal(h.calls.length,before);
 h.L.loading=true;h.c.render();assert(observer.disconnected);observer.callback([{target,isIntersecting:true}]);await settle();assert.equal(h.calls.length,before);h.L.loading=false;h.c.render();
 observers.at(-1).callback([{target,isIntersecting:true}]);await settle();assert.equal(h.L.overviewSections.status,'ready');const done=h.calls.length;observers.at(-1).callback([{target,isIntersecting:true}]);await settle();assert.equal(h.calls.length,done);
 h.c.liveSet('provider','Other provider');observer.callback([{target,isIntersecting:true}]);await settle();assert.equal(h.calls.length,done);
});
test('inline workorder errors remain distinct and changing scope discards stale results',async()=>{
 const h=await queried({ancillaryHandler:true,handler:q=>q.action==='catalog'?{platforms:[P]}:q.action==='providerOptions'?{providers:[]}:q.action==='rates'?{rows:[],total:0}:aggregate(P)}),wait=deferred();
 h.setHandler(q=>q.action==='workorders'?wait.promise:aggregate(P));const old=h.c.liveOverviewWorkorders();await settle();assert.equal(h.L.overviewWorkordersStatus,'loading');h.c.liveSet('provider','Other provider');wait.resolve({rows:[{id:'old'}],summary:{submittedCount:999}});await old;assert.equal(h.L.workorders,null);assert.equal(h.L.overviewWorkordersStatus,'idle');
 await h.c.liveQuery();h.setHandler(async q=>{if(q.action==='workorders')throw Error('Synthetic workorders offline');return aggregate(P)});await h.c.liveOverviewWorkorders();assert.equal(h.L.overviewWorkordersStatus,'error');assert.equal(h.L.workorders,null);assert.match(h.L.workordersError,/Synthetic workorders offline/);assert.equal(h.L.error,'');
});

test('leaving overview preserves the destination page workorder data and errors',async()=>{
 const h=await queried(),data={byProvider:[{provider:'Synthetic provider',direction:'charge',submittedAmount:300,submittedCount:3}]};
 h.L.workorders=data;h.L.workordersError='Destination error';h.c.state.page='providers';h.c.render();assert.equal(h.L.workorders,data);assert.equal(h.L.workordersError,'Destination error');assert.equal(h.L.overviewSections,null);
 h.c.state.page='provider_payout';h.c.render();assert.equal(h.L.workorders,data);assert.equal(h.L.workordersError,'Destination error');
});
test('leaving overview does not cancel a newer workorder request already owned by the destination',async()=>{
 const h=await queried();h.L.overviewWorkordersStatus='loading';h.L.overviewSections.workordersSerial=h.L.workordersSerial;h.L.workordersSerial++;h.L.workordersLoading=true;
 const nextSerial=h.L.workordersSerial;h.c.state.page='workorders';h.c.render();assert.equal(h.L.workordersSerial,nextSerial);assert.equal(h.L.workordersLoading,true);
});
test('single-direction business panels occupy both grid tracks while paired overview tables stay independent',async()=>{
 const h=await queried();let ctx;const create=h.c.HensemLivePages.create;
 h.c.HensemLivePages.create=value=>{ctx=value;return create(value)};h.L.feeLookupRows=[];h.c.render();assert(ctx);
 const css=fs.readFileSync(path.join(__dirname,'../admin-preview/live-reference-pages.css'),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
 const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m=>m[1].includes('.live-paired-dimensions'));
 assert(rules.some(m=>m[1].trim()==='body.live-admin .live-paired-dimensions>.panel:only-child'&&/grid-column\s*:\s*1\s*\/\s*-1/.test(m[2])),'the only panel must span the existing tracks');
 assert(!rules.some(m=>/grid-template-columns\s*:/.test(m[2])),'paired overview track widths are not overridden');
 assert(rules.some(m=>m[1].trim()==='body.live-admin .live-paired-dimensions>.panel'&&/min-width\s*:\s*0/.test(m[2])),'wide tables must not enlarge their parent track');
 assert(rules.some(m=>m[1].trim()==='body.live-admin .live-paired-dimensions>.panel>.table-wrap'&&/overflow-x\s*:\s*auto/.test(m[2])),'overflow remains scrollable inside the table');
 const before=h.calls.length;
 for(const direction of ['charge','withdraw','all']){
  h.L.direction=direction;
  for(const render of [ctx.providersView,ctx.platformsView,ctx.overviewAmounts]){
   const html=render();assert.match(html,/^<div class="grid equal live-paired-dimensions">/);
   assert.equal((html.match(/<section class="panel">/g)||[]).length,direction==='all'?2:1,'single-direction panel must match :only-child; overview keeps both panels');
   assert.match(html,/class="live-table table-wrap /);
  }
 }
 assert.equal(h.calls.length,before,'layout changes do not read data');
});
test('overview removes repeated navigation and captions but keeps each local lazy-read and retry entry',async()=>{
 const h=await queried();h.L.loadedView='providers';h.L.workorders=null;h.L.workordersLoading=false;h.L.workordersError='';h.c.render();
 const html=h.html();assert.match(html,/^<div class="dashboard-full-v3"><div class="df-grid df-two">/);
 assert.doesNotMatch(html,/df-jumps|总览分区|加载全部图表分析|df-rank-rule|创建≥1,000笔、量前10|不含 ArbPay/);
 assert.equal((html.match(/data-live-overview-analysis/g)||[]).length,3,'trend, amount and duration keep their lazy-read targets');
 assert.equal((html.match(/onclick="liveOverviewAnalysis\(\)"/g)||[]).length,3,'each nearby section keeps a read button');
 assert.match(html,/data-live-overview-workorders/);assert.match(html,/onclick="liveOverviewWorkorders\(\)">加载工单汇总/);
 const heads=[...html.matchAll(/<section class="df-card" id="df-(?:collect|payout)"><header class="df-head">([\s\S]*?)<\/header>/g)];assert.equal(heads.length,2);for(const head of heads)assert.doesNotMatch(head[1],/<small>/,'flow header has no repeated timing subtitle');
 h.L.overviewSections.status='error';h.L.overviewSections.failures=[{id:P.id,name:P.name,message:'Synthetic timeout'}];h.L.workordersError='Synthetic workorder timeout';h.c.render();
 assert.match(h.html(),/onclick="liveOverviewAnalysis\(\)">重试未完成平台/);assert.match(h.html(),/onclick="liveOverviewWorkorders\(\)">重试工单读取/);assert.doesNotMatch(h.html(),/加载全部图表分析/);
});
test('both flow cards retain rejected and unknown facts inside the fee area before workorder ranks',async()=>{
 const h=await queried(),r=completeAggregate();r.summary[0]={...r.summary[0],rejected_amount:123.45,rejected_count:7,unknown_amount:null,unknown_count:2};
 r.summary.push({...r.summary[0],direction:'withdraw',rejected_amount:9876.54,rejected_count:11,unknown_amount:678.9,unknown_count:3});h.L.results=[r];h.L.direction='all';
 const before=JSON.stringify(h.L.results),calls=h.calls.length;h.c.render();const html=h.html();
 const fees=[...html.matchAll(/<div class="df-flow-fee">([\s\S]*?)<\/div><\/div>(?=<div class="df-workorder-ranks")/g)];assert.equal(fees.length,2,'state rows belong to each fee card, not a full-width footer');
 for(const fee of fees){assert.match(fee[1],/估算手续费/);assert.match(fee[1],/<div class="df-state-tail">/);assert.equal((fee[1].match(/<b>/g)||[]).length,4)}
 assert.match(fees[0][1],/驳回金额 <b>123\.45<\/b>/);assert.match(fees[0][1],/驳回笔数 <b>7<\/b>/);assert.match(fees[0][1],/未知状态金额 <b>—<\/b>/);assert.match(fees[0][1],/未知状态笔数 <b>2<\/b>/);
 assert.match(fees[1][1],/驳回金额 <b>9,876\.54<\/b>/);assert.match(fees[1][1],/驳回笔数 <b>11<\/b>/);assert.match(fees[1][1],/未知状态金额 <b>678\.90<\/b>/);assert.match(fees[1][1],/未知状态笔数 <b>3<\/b>/);
 assert.equal(JSON.stringify(h.L.results),before);assert.equal(h.calls.length,calls);
});
