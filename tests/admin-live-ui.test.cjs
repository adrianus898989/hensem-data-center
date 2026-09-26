/* Synthetic-only VM tests for the production UI adapter. No credentials/network/real orders. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8');
const layoutSources=['live-analysis-drilldown.js','live-reference-layout.js','live-pages-reference.js','live-empty-pages.js','live-duration-reference.js','live-payout-config.js','live-filter-controls.js','live-configuration.js','live-provider-aliases.js','live-provider-summary.js', 'live-provider-orders.js','live-provider-sticky.js','live-collected-data.js','live-report-data.js', 'live-withdraw-pages.js','live-deposit-issues.js'].map(name=>({name,source:fs.readFileSync(path.join(__dirname,'../admin-preview',name),'utf8')}));
const comparisonSource=fs.readFileSync(path.join(__dirname,'../admin-preview/live-comparison.js'),'utf8');
test('overview merges same providers across sources while preserving stable platform identities and other source reports',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222',source:'NEW_AR'},p3={...P,id:'33333333-3333-4333-8333-333333333333'};
 const h=await ready({platforms:[P,p2,p3]});h.L.results=[completeAggregate(P,11,3),completeAggregate(p2,17,8),completeAggregate(p3,23,9)];h.L.platform='all';h.L.comparisonStatus='idle';h.L.direction='charge';h.L.dailyView='all';
 const tableFor=(page,view,first)=>{h.c.state.page=page;h.L.view=view;h.c.render();const found=renderedTables(h.html()).find(t=>t.headers[0]===first&&t.headers.includes('包网来源'));assert(found,page+'/'+view+' has an independent source column');for(const row of found.rows)assert.equal(row.length,found.headers.length,page+'/'+view+' cell alignment');return found};
 const numeric=(table,source,label)=>{const row=table.rows.find(r=>plain(r[table.headers.indexOf('包网来源')])===source);assert(row,'source '+source);return Number(plain(row[table.headers.indexOf(label)]).replaceAll(',',''))};
 h.c.state.page='overview';h.c.render();const overviewProviders=renderedTables(h.html()).find(t=>t.headers[0]==='三方');assert.equal(overviewProviders.rows.length,1);assert(!overviewProviders.headers.includes('包网来源'));assert(!overviewProviders.headers.includes('方向'));assert.equal(plain(overviewProviders.rows[0][overviewProviders.headers.indexOf('全部笔数')]),'51');assert.equal(plain(overviewProviders.rows[0][overviewProviders.headers.indexOf('全部金额')]),'5,100.00');
 for(const page of ['overview','teamplatforms','merchants']){h.c.state.page=page;h.L.view='business';h.c.render();const t=renderedTables(h.html()).find(t=>t.headers[0]==='平台');assert(t);assert(!t.headers.includes('包网来源'));assert(!t.headers.includes('方向'));assert.equal(t.rows.length,3,page+' stable platforms must not merge by display name or source');assert.deepEqual(t.rows.map(r=>Number(plain(r[t.headers.indexOf('全部笔数')]))).sort((a,b)=>a-b),[11,17,23]);assert.equal(t.rows.reduce((n,r)=>n+Number(plain(r[t.headers.indexOf('全部金额')]).replaceAll(',','')),0),5100);}
 const fees=tableFor('merchantproviders','fees','三方');assert.equal(fees.rows.length,2);assert.equal(numeric(fees,'AR','成功金额'),1200);assert.equal(numeric(fees,'NEW_AR','成功金额'),800);assert.equal(numeric(fees,'AR','成功笔数'),12);assert.equal(numeric(fees,'NEW_AR','成功笔数'),8);
 for(const [page,view]of [['channelquality','business'],['risk','business']]){const t=tableFor(page,view,'三方');assert.equal(t.rows.length,2);assert.deepEqual(t.rows.map(r=>plain(r[t.headers.indexOf('包网来源')])).sort(),['AR','NEW_AR']);}
 tableFor('provider_daily','business','三方');const daily=renderedTables(h.html()).find(t=>t.headers[0]==='日期');assert(daily);assert.equal(daily.rows.length,2);assert.equal(numeric(daily,'AR','全部笔数'),34);assert.equal(numeric(daily,'NEW_AR','全部笔数'),17);assert.equal(numeric(daily,'AR','成功笔数'),12);assert.equal(numeric(daily,'NEW_AR','成功笔数'),8);
});

test('overview separately displays rejected and unknown amounts and counts so every status reconciles',async()=>{
 const h=await ready(),r=completeAggregate(P,10,3);
 r.summary=[{...stats(10,'1000'),success_count:3,success_amount:'300',pending_count:2,pending_amount:'200',failed_count:1,failed_amount:'100',rejected_count:2,rejected_amount:'240',unknown_count:2,unknown_amount:'160'},{...stats(13,'1300'),direction:'withdraw',success_count:4,success_amount:'440',pending_count:3,pending_amount:'360',failed_count:2,failed_amount:'180',rejected_count:1,rejected_amount:'90',unknown_count:3,unknown_amount:'230'}];
 h.L.results=[r];h.L.comparisonStatus='idle';h.L.direction='all';h.c.state.page='overview';h.c.render();
 const number=text=>Number(text.replaceAll(',',''));
 for(const [id,expected]of [['df-collect',r.summary[0]],['df-payout',r.summary[1]]]){
  const html=h.html().match(new RegExp('<section class="df-card" id="'+id+'">([^]*?)</section>'))?.[1];assert(html,id);
  const cards=[...html.matchAll(/<div class="df-flow-metric"><span>([^]*?)金额 \/ 笔数<\/span><strong[^>]*>([^]*?)<\/strong><small[^>]*>([\d,]+) 笔<\/small>/g)].map(m=>({label:m[1],amount:number(plain(m[2])),count:number(m[3])}));assert.equal(cards.length,4);
  const tail=html.match(/<div class="df-state-tail">([^]*?)<\/div>/)?.[1];assert(tail);
  const tailItems=Object.fromEntries([...tail.matchAll(/<span>([^<]+) <b>([^]*?)<\/b><\/span>/g)].map(m=>[m[1],number(plain(m[2]))]));
  assert.deepEqual(tailItems,{'驳回金额':Number(expected.rejected_amount),'驳回笔数':expected.rejected_count,'未知状态金额':Number(expected.unknown_amount),'未知状态笔数':expected.unknown_count});
  assert.equal(cards.slice(1).reduce((n,s)=>n+s.amount,0)+tailItems['驳回金额']+tailItems['未知状态金额'],cards[0].amount);
  assert.equal(cards.slice(1).reduce((n,s)=>n+s.count,0)+tailItems['驳回笔数']+tailItems['未知状态笔数'],cards[0].count);
 }
 assert.match(h.html(),/所选创建日期内仍待付/);assert.doesNotMatch(h.html(),/所选提交日期内仍待付/);
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
const withoutWindow=q=>Object.fromEntries(Object.entries(q).filter(([key])=>!['startAt','endAt'].includes(key)));
const plain=html=>String(html).replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim();
function renderedTables(html){return [...html.matchAll(/<table\b[^>]*>([^]*?)<\/table>/g)].map(match=>({html:match[0],headers:[...match[1].matchAll(/<th\b[^>]*>([^]*?)<\/th>/g)].map(x=>plain(x[1])),rows:[...(match[1].match(/<tbody\b[^>]*>([^]*?)<\/tbody>/)?.[1]||'').matchAll(/<tr\b[^>]*>([^]*?)<\/tr>/g)].map(row=>[...row[1].matchAll(/<td\b[^>]*>([^]*?)<\/td>/g)].map(cell=>cell[1]))}));}


test('adapter does nothing outside production and never installs an automatic data refresh',async()=>{
 const offline=await ready({production:false});assert.equal(offline.L,undefined);assert.equal(offline.calls.length,0);
 const h=await ready();assert.equal(h.calls.filter(q=>q.action==='catalog').length,1);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,2);assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.intervals.length,0);const n=h.calls.length;h.c.render();h.c.render();await settle();assert.equal(h.calls.length,n);h.c.liveSet('provider','chosen');assert.equal(h.calls.length,n);assert.match(h.html(),/点击查询/);await h.c.liveLoad();assert.equal(h.calls.at(-1).providers[0],'chosen');
});

test('all direction remains selectable while charge and withdrawal totals are displayed separately',async()=>{
 const h=await ready();assert.equal(h.L.direction,'all');
 const filters=h.nodes.get('liveFilters').innerHTML,direction=filters.match(/<details[^>]*data-multi="direction"[^]*?<\/details>/)?.[0];
 assert(direction,'direction multiselect exists');assert.match(direction,/value="charge"/);assert.match(direction,/value="withdraw"/);assert.match(direction,/>全部</);assert.doesNotMatch(direction,/代收 \+ 代付/);
 assert(h.calls.filter(q=>q.action==='aggregate').every(q=>q.direction==='all'));
 h.c.liveSet('direction','withdraw');await h.c.liveLoad();assert(h.calls.slice(-2).every(q=>q.direction==='withdraw'));
 h.c.liveReset();await settle();assert.equal(h.L.direction,'all');assert(h.calls.filter(q=>q.action==='aggregate'||q.action==='details').every(q=>['all','charge','withdraw'].includes(q.direction)));
 const r=completeAggregate(P,10,3),withdraw=completeAggregate(P,20,15).summary[0];withdraw.direction='withdraw';r.summary.push(withdraw);for(const key of ['provider','daily','hourly','amount','matrix'])r.groups[key].push({...r.groups[key][0],...withdraw});h.L.results=[r];h.L.comparisonStatus='idle';h.c.render();assert.match(h.html(),/代收/);assert.match(h.html(),/代付/);assert.match(h.html(),/1,000\.00/);assert.match(h.html(),/2,000\.00/);assert.match(h.html(),/30\.00%/);assert.match(h.html(),/75\.00%/);assert.doesNotMatch(h.html(),/3,000\.00|60\.00%/);
 for(const page of ['providers','orders','time','amount','matrix','provider_daily','risk','teamops','merchants']){h.c.state.page=page;h.c.render();assert.doesNotMatch(h.html(),/3,000\.00|60\.00%/,page+' must not pool direction amounts or rates')}
});

test('yesterday comparison performs a real previous-day query with the identical non-time scope',async()=>{
 const h=await ready();setScope(h,{provider:'Provider/Exact',status:'pending',direction:'withdraw'});const calls=[];
 h.setHandler(async q=>{calls.push(q);const r=completeAggregate(P,calls.length===1?10:20,0);for(const s of r.summary)s.direction='withdraw';return r});
 await h.c.liveLoad();assert.equal(calls.length,2);assert.equal(calls[0].startAt,'2026-09-21T18:30:00.000Z');assert.equal(calls[0].endAt,'2026-09-22T00:30:00.000Z');assert.equal(calls[1].startAt,'2026-09-20T18:30:00.000Z');assert.equal(calls[1].endAt,'2026-09-21T00:30:00.000Z');assert.deepEqual(withoutWindow(calls[1]),withoutWindow(calls[0]));assert.equal(h.L.results[0].total,10);assert.equal(h.L.comparisonResults[0].total,20);assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.L.comparisonError,'');
});

test('current totals publish before the baseline; a failed baseline never erases current or fabricates zero change',async()=>{
 const h=await ready(),baseline=deferred();setScope(h);let n=0;
 h.setHandler(q=>++n===1?Promise.resolve(completeAggregate(P,10,5)):baseline.promise);
 const pending=h.c.liveLoad();await settle();assert.equal(h.L.loading,false);assert.equal(h.L.results[0].total,10);assert.equal(h.L.comparisonStatus,'loading');assert.match(h.html(),/1,000/);
 baseline.reject(Error('Synthetic baseline unavailable'));await pending;assert.equal(h.L.results[0].total,10);assert.equal(h.L.error,'');assert.equal(h.L.comparisonStatus,'error');assert.equal(h.L.comparisonResults.length,0);assert.match(h.html(),/Synthetic baseline unavailable|比较.*失败|对比.*失败|对比.*不可用/);assert.doesNotMatch(h.html(),/[+−-]0\.00%/);
});

test('late previous-period response cannot replace the comparison for a newer query',async()=>{
 const h=await ready(),oldBaseline=deferred();setScope(h);let phase='old',oldCalls=0;
 h.setHandler(q=>{if(phase==='old')return ++oldCalls===1?Promise.resolve(completeAggregate(P,11,5)):oldBaseline.promise;return Promise.resolve(completeAggregate(P,q.startAt==='2026-09-21T18:30:00.000Z'?22:44,5))});
 const old=h.c.liveLoad();await settle();assert.equal(h.L.results[0].total,11);assert.equal(h.L.comparisonStatus,'loading');phase='new';const fresh=h.c.liveLoad();await fresh;assert.equal(h.L.results[0].total,22);assert.equal(h.L.comparisonResults[0].total,44);oldBaseline.resolve(completeAggregate(P,999,5));await old;assert.equal(h.L.results[0].total,22);assert.equal(h.L.comparisonResults[0].total,44);assert.equal(h.L.comparisonStatus,'ready');
});

test('today comparison and detail pagination share the frozen query cutoff',async()=>{
 const h=await ready();setScope(h,{platform:P.id,from:'2026-09-23T17:00:00',to:'2026-09-23T23:59:59'});h.c.state.page='orders';
 const calls=[];h.setHandler(async q=>{calls.push(q);return q.action==='details'?detail(P,65,q.offset,q.limit):completeAggregate(P,65,39)});await h.c.liveLoad();
 const now=calls.find(q=>q.action==='aggregate'),prior=calls.filter(q=>q.action==='aggregate')[1];assert.equal(now.endAt,'2026-09-23T12:00:01.000Z');assert.equal(prior.endAt,'2026-09-22T12:00:01.000Z');const frozen=h.L.queryNow;
 h.setNow('2026-09-23T13:00:00Z');h.c.livePage(2,'server');await settle();const page=calls.at(-1);assert.equal(page.action,'details');assert.equal(page.startAt,now.startAt);assert.equal(page.endAt,now.endAt);assert.equal(page.offset,20);assert.equal(h.L.queryNow,frozen);
});

test('zero baseline is new activity and success-rate changes use percentage points',async()=>{
 const h=await ready();setScope(h);let n=0;h.setHandler(async()=>++n===1?completeAggregate(P,10,5):completeAggregate(P,0,0));await h.c.liveLoad();assert.match(h.html(),/新增/);assert.doesNotMatch(h.html(),/Infinity|NaN|\+100\.00%/);
 n=0;h.setHandler(async()=>++n===1?completeAggregate(P,10,5):completeAggregate(P,20,5));await h.c.liveLoad();assert.match(h.html(),/25(?:\.00)?\s*(?:个)?百分点/);assert.doesNotMatch(h.html(),/成功率[^]*?\+100\.00%/);
});

test('overview preserves the full reference dashboard and anchor navigation without extra queries',async()=>{
 const h=await ready();h.c.liveOverviewAnalysis();await settle();const calls=h.calls.length;h.c.render();const html=h.html();assert.match(html,/class="dashboard-full-v3"/);assert.match(html,/class="df-jumps"/);assert.doesNotMatch(html,/liveOverviewTab\(/);
 for(const id of ['df-collect','df-payout','df-backlog','df-risk','df-exceptions','df-order-trend','df-charge-trend','df-charge-money','df-withdraw-trend','df-withdraw-money','df-teams','df-countries','df-platforms','df-providers','df-amounts','df-hour-charge','df-hour-withdraw','df-workorders'])assert(html.includes('id="'+id+'"'),id+' is visible in the full overview');
 const navigation=html.match(/<nav class="df-jumps"[^>]*>([^]*?)<\/nav>/)?.[1];assert(navigation);assert.equal([...navigation.matchAll(/<a\b/g)].length,9);for(const [,id]of navigation.matchAll(/href="#([^"]+)"/g))assert(html.includes('id="'+id+'"'),'anchor '+id+' has a visible destination');assert.equal(h.calls.length,calls);assert.doesNotMatch(html,/NaN|Infinity/);
});

test('reference totals retain exactly six compact cards per direction with independent amounts and unknown fees',async()=>{
 const h=await ready(),r=completeAggregate(P,10,3),withdraw={...completeAggregate(P,20,15).summary[0],direction:'withdraw'};r.summary.push(withdraw);h.L.results=[r];h.L.comparisonStatus='idle';h.c.state.page='merchantproviders';h.c.render();
 const groups=[...h.html().matchAll(/<section class="live-reference-direction" data-direction="([^"]+)"[^>]*>([^]*?)<\/section>/g)];assert.equal(groups.length,2);assert.deepEqual(groups.map(x=>x[1]),['charge','withdraw']);
 for(const [,direction,html]of groups){assert.deepEqual([...html.matchAll(/data-metric="([^"]+)"/g)].map(x=>x[1]),['all','success','pending','failed','success_rate','fee'],direction);assert.match(html,/data-metric="fee"[^]*?class="kpi-value">—</);assert.doesNotMatch(html,/NaN|Infinity/)}
 assert.match(groups[0][2],/1,000\.00/);assert.match(groups[1][2],/2,000\.00/);assert.doesNotMatch(h.html(),/3,000\.00|60\.00%/);h.L.direction='charge';h.c.render();assert.equal([...h.html().matchAll(/data-metric=/g)].length,6);assert.doesNotMatch(h.html(),/data-direction="withdraw"/);
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

test('hour by amount matrix preserves one amount band per row, 24 hours and three independent cell values',async()=>{
 const h=await ready(),r=completeAggregate(P,10,3);h.L.results=[r];h.L.direction='charge';h.L.matrixMode='exact';h.c.state.page='matrix';h.c.render();
 const matrices=renderedTables(h.html()).filter(t=>t.headers[0]==='金额 / 时');assert.equal(matrices.length,1);const matrix=matrices[0];assert.equal(matrix.headers.length,26);assert.deepEqual(matrix.headers.slice(1,-1),Array.from({length:24},(_,hour)=>String(hour).padStart(2,'0')+'时'));assert.equal(matrix.rows.length,10);assert.equal(new Set(matrix.rows.map(row=>plain(row[0]))).size,10);
 for(const row of matrix.rows){assert.equal(row.length,26);for(const cell of row.slice(1,-1)){assert.equal([...cell.matchAll(/class="matrix-cell analysis-matrix-cell"/g)].length,1);assert.equal([...cell.matchAll(/<b\b/g)].length,1);assert.equal([...cell.matchAll(/<span\b/g)].length,2)}}
 const known=matrix.rows.find(row=>plain(row[0])==='200')[13];assert.match(known,/>10笔<\/b>/);assert.match(known,/>1,000<\/span>/);assert.match(known,/>30\.00%<\/span>/);
});

test('rejected and unknown statuses remain explicit in the reference direction analysis',async()=>{
 const h=await ready(),r=completeAggregate(P,10,3);r.summary=[{...r.summary[0],direction:'withdraw',all_amount:null,pending_count:2,pending_amount:'200',failed_count:1,failed_amount:'100',rejected_count:2,rejected_amount:'240',unknown_count:2,unknown_amount:null,missing_amount_count:1}];h.L.direction='withdraw';h.L.results=[r];h.L.comparisonStatus='idle';h.c.state.page='payout';h.L.view='trend';h.c.render();const table=renderedTables(h.html()).find(t=>t.headers.join('|')==='状态|金额|笔数');assert(table);assert.deepEqual(table.rows.find(r=>plain(r[0])==='拒绝').map(plain),['拒绝','240.00','2']);assert.deepEqual(table.rows.find(r=>plain(r[0])==='未知').map(plain),['未知','—','2']);assert.doesNotMatch(h.html(),/NaN|Infinity/);
});

test('catalog scopes country/source/platform without a currency selector and query local seconds correctly',async()=>{
 const nepal={...P,id:'22222222-2222-4222-8222-222222222222',timezone:'Asia/Kathmandu',source:'NEW_AR'},usd={...P,id:'33333333-3333-4333-8333-333333333333',currency:'USD',country:'美国',timezone:'America/New_York'};
 const h=await ready({platforms:[P,nepal,usd]});assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/liveSet\('currency'/);setScope(h,{platform:'all',source:'NEW_AR',direction:'withdraw',status:'pending',provider:'P/Raw',orderNumber:'O/1',memberId:'M1',systemOrderId:'S1'});const before=h.calls.length;await h.c.liveLoad();const q=h.calls.slice(before).filter(q=>q.action==='aggregate');assert.equal(q.length,2);assert.equal(q[0].platformId,nepal.id);assert.equal(q[0].startAt,'2026-09-21T18:15:00.000Z');assert.equal(q[0].endAt,'2026-09-22T00:15:00.000Z');assert.equal(q[0].direction,'withdraw');assert.equal(q[0].status,'pending');assert.equal(q[0].providers[0],'P/Raw');assert.equal(q[0].orderNumber,'O/1');assert.equal(q[0].memberId,'M1');assert.equal(q[0].systemOrderId,'S1');assert.equal(q[0].currency,'INR');assert.deepEqual(withoutWindow(q[1]),withoutWindow(q[0]));
 h.c.liveSet('platform',P.id);h.c.liveSet('country','美国');assert.equal(h.L.platform,'all');assert.equal(h.L.page,1);assert.equal(h.L.localPage,1);
});

test('removing the currency selector keeps each platform query on its own currency',async()=>{
 const usd={...P,id:'44444444-4444-4444-8444-444444444444',currency:'USD',country:'美国',timezone:'America/New_York'};
 const h=await ready({platforms:[P,usd]});assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/币种/);setScope(h,{platform:'all',source:'all'});const before=h.calls.length;await h.c.liveLoad();const currencies=new Set(h.calls.slice(before).filter(q=>q.action==='aggregate').map(q=>q.currency));assert.deepEqual([...currencies],['INR']);h.c.liveSet('country','美国');const next=h.calls.length;await h.c.liveLoad();assert.deepEqual([...new Set(h.calls.slice(next).filter(q=>q.action==='aggregate').map(q=>q.currency))],['USD']);h.c.liveSet('country','all');assert.equal(h.L.country,'美国','country remains a required single choice');
});

test('invalid calendar/DST ambiguous or missing local seconds never become plausible timestamps',async()=>{
 for(const [zone,from,to] of [['Asia/Kolkata','2026-02-30T00:00:00','2026-03-01T00:00:00'],['America/New_York','2026-03-08T02:30:00','2026-03-08T03:30:00'],['America/New_York','2026-11-01T01:30:00','2026-11-01T03:30:00'],['Asia/Kolkata','2026-09-01T00:00:00','2026-10-02T23:59:59']]){const h=await ready({platforms:[{...P,timezone:zone}]});setScope(h,{from,to});const n=h.calls.length;await h.c.liveLoad();assert.equal(h.calls.length,n);assert(h.L.error);assert.equal(h.L.results.length,0)}
});

test('money strings aggregate and unknown amounts remain unknown rather than fabricated zero',async()=>{
 const h=await ready();const a=aggregate(),b=aggregate();b.platform={...P,id:'second'};b.summary[0].all_amount=null;b.summary[0].missing_amount_count=1;h.L.results=[a,b];h.c.state.page='merchantproviders';h.c.render();const section=h.html().match(/<section class="live-reference-direction" data-direction="charge"[^>]*>([^]*?)<\/section>/)?.[1];assert(section);assert.match(section,/data-metric="all"[^]*?class="kpi-value">—<\/div>[^]*?>10 笔<\/span>/);assert.match(section,/data-metric="success"[^]*?class="kpi-value">1,200\.30<\/div>[^]*?>6 笔<\/span>/);assert.doesNotMatch(h.html(),/NaN|Infinity/);
});

test('partial platform results stay labeled and cannot masquerade as complete totals after a failure',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222'},h=await ready({platforms:[P,p2]});setScope(h,{platform:'all'});h.setHandler(async q=>{if(q.platformId===p2.id)throw Error('Synthetic failure');return aggregate(P)});await h.c.liveLoad();assert.equal(h.L.results.length,1);assert.match(h.html(),/Synthetic failure/);assert.match(h.html(),/以下仅为已读取结果/);assert.equal(h.L.comparisonStatus,'error');
});

test('later aggregate query wins over an earlier request regardless of completion order',async()=>{
 const h=await ready(),old=deferred(),fresh=deferred();let n=0;h.setHandler(()=>++n===1?old.promise:fresh.promise);const a=h.c.liveLoad();h.c.liveSet('provider','New scope');const b=h.c.liveLoad();fresh.resolve(aggregate(P,22));await b;old.resolve(aggregate(P,11));await a;assert.equal(h.L.results[0].total,22);assert.equal(h.L.loading,false);
});

test('editing filters invalidates outstanding aggregate results and leaves explicit query state',async()=>{
 const h=await ready(),wait=deferred();h.setHandler(()=>wait.promise);const pending=h.c.liveLoad();h.c.liveSet('provider','new-provider');wait.resolve(aggregate(P,91));await pending;assert.equal(h.L.dirty,true);assert.equal(h.L.results.length,0,'old-scope results must never be committed after a filter edit');assert.match(h.html(),/点击查询/);
});

test('switching to the independent deposit page prevents old aggregate progress/results overwrites',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222'},h=await ready({platforms:[P,p2]}),first=deferred(),second=deferred();let n=0;setScope(h,{platform:'all'});h.setHandler(q=>q.action==='depositIssues'?Promise.resolve({rows:[],total:0,summary:{},facets:{providers:[]}}):(++n===1?first.promise:second.promise));const pending=h.c.liveLoad();h.c.setPage('deposit_tracking');const mark=h.writes.length;first.resolve(aggregate(P));await settle();assert.match(h.html(),/核对结果/);assert.doesNotMatch(h.html(),/INDEPENDENT_SNAPSHOT/);second.resolve(aggregate(p2));await pending;assert(h.writes.slice(mark).filter(x=>x.id==='page').every(x=>!x.html.includes('正式数据读取')));
});

test('old detail responses cannot reappear after a new aggregate scope begins',async()=>{
 const h=await ready();setScope(h,{platform:P.id});h.c.state.page='orders';const old=deferred(),next=deferred();h.setHandler(q=>q.action==='details'?old.promise:next.promise);const a=h.c.liveDetails();h.c.liveSet('orderNumber','different-order');const b=h.c.liveLoad();old.resolve(detail(P,65));await a;assert.equal(h.L.detail,null,'previous order filter rows cannot reappear during the new aggregate request');next.resolve(aggregate());await settle();old.resolve(detail());await b;
});

test('server paging keeps exact IDs, default 20 and all requested page sizes without client totals',async()=>{
 const h=await ready();setScope(h,{platform:P.id});h.c.state.page='orders';await h.c.liveLoad();assert.equal(h.L.size,20);assert.equal(h.L.detail.rows.length,20);assert.match(h.html(),/共 <b>65<\/b> 条/);h.c.livePage(2,'server');await settle();assert.equal(h.calls.at(-1).offset,20);assert.equal(h.L.detail.rows[0].id,'row-20');assert.equal(h.L.detail.rows.at(-1).id,'row-39');for(const size of [30,50,100,500]){h.c.livePageSize(String(size),'server');await settle();assert.equal(h.L.page,1);assert.equal(h.calls.at(-1).limit,size);assert.equal(h.calls.at(-1).offset,0)}assert.match(h.html(),/首页/);assert.match(h.html(),/上一页/);assert.match(h.html(),/下一页/);assert.match(h.html(),/尾页|末页/);assert.match(h.html(),/跳转页码/);
});

test('out-of-range server page clamps to the available last page, including an empty result',async()=>{
 const h=await ready();setScope(h,{platform:P.id});h.c.state.page='orders';await h.c.liveLoad();h.c.livePage(999,'server');await settle();assert.equal(h.L.page,4);assert.equal(h.L.detail.rows.length,5);h.setHandler(q=>detail(P,0,q.offset,q.limit));h.c.livePage(4,'server');await settle();assert.equal(h.L.page,1);assert.equal(h.L.detail.rows.length,0);assert(!h.html().includes('NaN'));
});

test('detail contract uses canonical status and third-party order number, escaping untrusted fields',async()=>{
 const h=await ready();setScope(h,{platform:P.id});h.c.state.page='orders';const d=detail(P,1);d.rows[0].third_party_order_number='THIRD/KEEP';d.rows[0].provider='<img src=x onerror=alert(1)>';d.rows[0].order_number='O/RAW';h.L.detail=d;h.c.render();assert.match(h.html(),/O\/RAW/);assert.match(h.html(),/>成功<\/span>/);assert(!h.html().includes('<img'));assert(h.html().includes('&lt;img'));h.c.liveOrder(0);assert(h.drawers[0].html.includes('O/RAW'));assert(h.drawers[0].html.includes('THIRD/KEEP'));assert(h.drawers[0].html.includes('member-0'));assert(!h.drawers[0].html.includes('<img'));
});

test('orders preserve business, fee basis and historical rate tabs without changing the exact result set',async()=>{
 const h=await ready();setScope(h,{platform:P.id});h.c.state.page='orders';await h.c.liveLoad();const ids=Array.from(h.L.detail.rows,r=>r.id),calls=h.calls.length;
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

test('navigation reuses recent matching aggregates without mixing directions, but explicit queries and expired or changed scopes reread',async()=>{
 const h=await ready();h.L.overviewAnalysis=true;setScope(h,{platform:P.id,direction:'all'});h.c.state.page='overview';
 h.setHandler(async q=>{const r=aggregate(P,5),w={...stats(2,'400'),direction:'withdraw'};r.summary.push(w);for(const key of Object.keys(r.groups))if(r.groups[key].length)r.groups[key].push({...r.groups[key][0],...w});r.summary=r.summary.filter(row=>q.direction==='all'||row.direction===q.direction);for(const key of Object.keys(r.groups))r.groups[key]=r.groups[key].filter(row=>q.direction==='all'||row.direction===q.direction);r.total=r.summary.reduce((n,row)=>n+row.all_count,0);return r});
 const countReads=()=>h.calls.filter(q=>q.action==='aggregate').length;
 await h.c.liveLoad();const initial=countReads();assert.equal(h.L.results[0].total,7);
 h.c.setPage('providers');await settle();assert.equal(countReads(),initial);assert.equal(h.L.results[0].total,5);assert(h.L.results[0].summary.every(r=>r.direction==='charge'));assert.equal(h.L.comparisonStatus,'ready');
 h.c.setPage('payout');await settle();assert.equal(countReads(),initial);assert.equal(h.L.results[0].total,2);assert(h.L.results[0].summary.every(r=>r.direction==='withdraw'));assert.equal(h.L.comparisonResults[0].total,2);
 await h.c.liveLoad();assert.equal(countReads(),initial+2,'manual query rereads both dates');
 h.setNow('2026-09-23T12:01:01Z');await h.c.liveLoad(false);assert.equal(countReads(),initial+4,'navigation cache expires after one minute');
 h.L.provider='Another Provider';h.L.multi.provider=['Another Provider'];await h.c.liveLoad(false);assert.equal(countReads(),initial+6,'provider scope cannot reuse broader totals');
 h.L.currency='USD';h.L.catalog[0]={...h.L.catalog[0],currency:'USD'};await h.c.liveLoad(false);assert.equal(countReads(),initial+8,'currency scopes stay separate');
});

test('navigation keeps completion-cohort totals when narrowing a successful-order result by direction',async()=>{
 const h=await ready();setScope(h,{platform:P.id,direction:'all',status:'success'});h.c.state.page='overview';
 h.setHandler(async()=>{const r=aggregate(P,5);r.summary=[{...r.summary[0],success_count:7},{...stats(9),direction:'withdraw',success_count:2}];r.total=9;return r});
 await h.c.liveLoad();const reads=h.calls.filter(q=>q.action==='aggregate').length;
 h.c.setPage('providers');await settle();assert.equal(h.calls.filter(q=>q.action==='aggregate').length,reads);
 assert.equal(h.L.results[0].total,7);assert.equal(h.L.results[0]._parts[0].total,7);assert.equal(h.L.comparisonResults[0].total,7);
 h.c.setPage('payout');await settle();assert.equal(h.L.results[0].total,2);assert.equal(h.L.results[0]._parts[0].total,2);
});

test('unconnected modules preserve reference schemas and local controls without inventing source rows or queries',async()=>{
 const h=await ready(),calls=h.calls.length,expected={dropped:['订单 ID','订单号','平台','三方','方向','掉单金额','掉单笔数'],anomaly:['异常类型','订单 ID','订单号','平台','三方','方向','异常金额','异常笔数'],events:['事件编号','三方','方向','关联金额','关联笔数','处理状态'],rules:['最低订单量','超期账龄','数据不足处理','多项命中处理'],access:['账号','账号标识','角色','团队','商户（平台）范围'],ip:['IP / CIDR','适用入口','适用账号','状态'],login_logs:['账号','登录时间','IP','登录结果','白名单结果','会话状态'],operation_logs:['操作者','操作时间','动作','资源','请求 ID']};
 for(const [page,fields]of Object.entries(expected)){h.c.setPage(page);const html=h.html();assert(html.includes('data-empty-page="'+page+'"'),page);assert.match(html,/未接入/);assert.match(html,/data-empty-field=/);const tables=renderedTables(html),headers=tables.flatMap(t=>t.headers);for(const field of fields)assert(headers.includes(field),page+' preserves '+field);for(const table of tables){assert.equal(table.rows.length,1,page+' only shows the empty row');assert.equal(table.rows[0].length,1,page+' does not fabricate records');assert.match(table.rows[0][0],/未接入/);assert(table.html.includes('colspan="'+table.headers.length+'"'),page+' empty row spans schema')}assert.doesNotMatch(html,/Synthetic provider|order-0|row-0|NaN|Infinity/);assert.equal(h.calls.length,calls,page+' does not query an unrelated order dataset')}
 const empty=h.c.HensemLiveEmpty;const workorders=empty.tab('workorders','orders');for(const field of ['工单 ID','订单号','平台','三方','提交时间／日期','到账确认时间','工单金额','到账状态'])assert(renderedTables(workorders).some(t=>t.headers.includes(field)),field);const role=empty.tab('access','roles');assert.match(role,/页面访问/);assert.match(role,/按钮动作/);assert.match(role,/disabled[^>]*>保存权限|disabled[^]*?保存权限/);empty.search('events',{eventId:'SYNTHETIC-FILTER'});assert.equal(empty.snapshot('events').applied.eventId,'SYNTHETIC-FILTER');assert.equal(empty.snapshot('events').page,1);assert.equal(h.calls.length,calls);
});

test('provider callback keeps quotes and slashes as a single literal value, never executable markup',async()=>{
 const h=await ready(),name='Raw/Pay\'\"<svg onload=alert(1)>';h.L.results[0].groups.provider[0].provider=name;h.c.state.page='merchantproviders';h.c.render();const html=h.html();assert(!html.includes('<svg onload'));const attr=html.match(/onclick="(liveProviderOrders\([^]*?\))"/);assert(attr);const decoded=attr[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');let value;vm.runInNewContext(decoded,{liveProviderOrders:v=>value=v});assert.equal(value,name);
});

test('duration bins use contract valid denominators and human time ranges instead of bucket indexes',async()=>{
 const h=await ready();h.c.state.page='latency';h.L.results[0].groups.latency=[{kind:'latency',direction:'charge',currency:'INR',bucket:0,min_ms:null,max_ms:300000,count:2,amount:'100',valid_count:4,valid_amount:'200',count_share:'0.5',amount_share:'0.5'}];h.c.render();assert.match(h.html(),/50\.00%/);assert.match(h.html(),/5\s*分钟|5min|5分/);assert(!h.html().includes('NaN'));
});

test('restored latency page uses real direction cards, complete distributions and local detail tabs without a query',async()=>{
 const h=await ready(),r=completeAggregate(P,10,6),withdraw={...r.summary[0],direction:'withdraw'};r.summary.push(withdraw);r.groups.latency=['charge','withdraw'].flatMap(direction=>Array.from({length:10},(_,bucket)=>({direction,currency:'INR',bucket,count:bucket<2?2:0,amount:bucket<2?'200':'0',valid_count:4,valid_amount:'400'})));r.groups.latency_thresholds=['charge','withdraw'].flatMap(direction=>[300000,1800000,3600000,10800000,21600000,43200000,86400000,172800000,259200000].map((threshold_ms,bucket)=>({direction,currency:'INR',bucket,threshold_ms,count:bucket===0?2:0,amount:bucket===0?'200':'0',valid_count:4,valid_amount:'400'})));h.L.results=[r];h.c.state.page='latency';h.c.render();assert.match(h.html(),/data-duration-page="latency"/);assert.equal([...h.html().matchAll(/class="panel latency-summary"/g)].length,2);const t=renderedTables(h.html()).find(t=>t.headers[0]==='成功耗时区间');assert(t);assert.equal(t.rows.length,10);assert.equal(t.headers.length,10);assert.equal(t.headers.at(-1),'明细');assert(t.rows.every(row=>plain(row.at(-1))==='展开'));assert.match(t.rows[0].at(-1),/aria-expanded="false"/);assert.deepEqual(t.rows[0].slice(0,-1).map(plain),['≤ 5 分钟','200.00','2','50.00%','50.00%','200.00','2','50.00%','50.00%']);
 const before={calls:h.calls.length,serial:h.L.serial,results:JSON.stringify(h.L.results),direction:h.L.direction,from:h.L.from,to:h.L.to};h.c.liveDurationSet('durationMode','cumulative');const cumulative=renderedTables(h.html()).find(t=>t.headers[0]==='成功耗时阈值');assert.equal(cumulative.rows.length,9);assert.equal(cumulative.headers.length,10);assert.equal(cumulative.headers.at(-1),'明细');assert.deepEqual(cumulative.rows[0].slice(0,-1).map(plain),['超过 5 分钟','200.00','2','50.00%','50.00%','200.00','2','50.00%','50.00%']);assert(cumulative.rows.every(row=>plain(row.at(-1))==='展开'));assert.match(h.html(),/行间不相加/);h.c.liveDurationSet('durationGroup','platform');const groups=renderedTables(h.html()).find(t=>t.headers[0]==='平台');assert(groups);assert.equal(groups.rows.length,0);assert.match(h.html(),/上方耗时分档展开可查看各平台占比/);assert.match(h.html(),/此处独立平台分组汇总尚未接入/);h.c.liveDurationSet('durationDetail','orders');const orders=renderedTables(h.html()).find(t=>t.headers[0]==='订单号');assert(orders);assert.equal(orders.rows.length,0);for(const header of ['系统 ID','平台','三方','方向','提交时间','成功时间','成功耗时'])assert(orders.headers.includes(header));assert.match(h.html(),/尚未提供对应时长条件的逐笔接口/);assert.deepEqual({calls:h.calls.length,serial:h.L.serial,results:JSON.stringify(h.L.results),direction:h.L.direction,from:h.L.from,to:h.L.to},before,'duration tabs only change local presentation');
});

test('restored waiting page conserves known bands plus unknown orders and retains cohort limits',async()=>{
 const h=await ready(),r=completeAggregate(P,10,4);r.summary[0].direction='withdraw';r.groups.pending_age=Array.from({length:10},(_,bucket)=>({direction:'withdraw',currency:'INR',bucket,count:bucket<2?2:0,amount:bucket<2?'200':'0',valid_count:4,valid_amount:'400'}));r.groups.pending_age_thresholds=[300000,1800000,3600000,10800000,21600000,43200000,86400000,172800000,259200000].map((threshold_ms,bucket)=>({direction:'withdraw',currency:'INR',bucket,threshold_ms,count:bucket===0?2:0,amount:bucket===0?'200':'0',valid_count:4,valid_amount:'400'}));h.L.results=[r];h.L.direction='withdraw';h.c.state.page='stuck';h.c.render();assert.match(h.html(),/data-duration-page="stuck"/);for(const name of ['pending-stock','pending-secondary','pending-table','pending-detail'])assert(h.html().includes(name));const t=renderedTables(h.html()).find(t=>t.headers[0]==='已等待时长');assert.equal(t.headers.length,5);assert.equal(t.rows.length,12);const rows=t.rows.map(r=>r.map(plain));assert.deepEqual(rows[10],['等待时间待核对','200.00','2','—','—']);assert.deepEqual(rows[11],['本期仍代付中合计','600.00','6','—','—']);assert.equal(rows.slice(0,11).reduce((n,r)=>n+Number(r[2]),0),Number(rows[11][2]));assert.match(h.html(),/所选创建日期范围/);assert.match(h.html(),/不含窗口外历史积压/);assert.match(h.html(),/非同一冻结快照/);const calls=h.calls.length;h.c.liveDurationSet('durationMode','cumulative');assert.equal(renderedTables(h.html()).find(t=>t.headers[0]==='已等待时长').rows.length,11);h.c.liveDurationSet('durationDetail','orders');const orders=renderedTables(h.html()).find(t=>t.headers[0]==='订单号');assert.equal(orders.rows.length,0);for(const header of ['系统 ID','平台','团队','三方','创建时间','已等待时长'])assert(orders.headers.includes(header));assert.equal(h.calls.length,calls);
});

test('restored duration empty and missing-time states retain layouts without false zero success or quantiles',async()=>{
 const h=await ready();h.L.results=[];for(const page of ['latency','stuck']){h.c.state.page=page;h.L.direction=page==='stuck'?'withdraw':'all';h.c.render();assert(h.html().includes('data-duration-page="'+page+'"'));assert.doesNotMatch(h.html(),/NaN|Infinity|>0\.00%/);const t=renderedTables(h.html()).find(t=>/^成功耗时|已等待/.test(t.headers[0]));assert.equal(t.rows.length,page==='latency'?10:12)}
 const r=completeAggregate(P,10,6);r.groups.latency=[];r.latencySummary=[];h.L.results=[r];h.L.direction='charge';h.c.state.page='latency';h.c.render();assert.match(h.html(),/成功 6 笔/);assert.match(h.html(),/— 时间覆盖/);assert.match(h.html(),/<span>P95 耗时<\/span><strong>—<\/strong>/);const t=renderedTables(h.html()).find(t=>t.headers[0]==='成功耗时区间');assert.equal(t.headers.at(-1),'明细');assert.equal(t.headers.length,6);assert(t.rows.every(row=>row.slice(1,-1).every(cell=>plain(cell)==='—')));assert(t.rows.every(row=>plain(row.at(-1))==='展开'));assert.doesNotMatch(h.html(),/0\.00%|NaN|Infinity/);
});

test('split date and second-precision time inputs preserve the unchanged half-open request contract',async()=>{
 const h=await ready();const filters=h.nodes.get('liveFilters').innerHTML;for(const label of ['起始日期','截止日期','起始时间（含秒）','截止时间（含秒）'])assert(filters.includes('aria-label="'+label+'"'));assert.equal([...filters.matchAll(/type="date"/g)].length,2);assert.equal([...filters.matchAll(/type="time" step="1"/g)].length,2);const before=h.calls.length;h.c.liveDateSet('from','date','2026-09-22');h.c.liveDateSet('from','time','01:02:03');h.c.liveDateSet('to','date','2026-09-22');h.c.liveDateSet('to','time','04:05:06');assert.equal(h.calls.length,before,'date editing waits for query');assert.equal(h.L.from,'2026-09-22T01:02:03');assert.equal(h.L.to,'2026-09-22T04:05:06');await h.c.liveLoad();const q=h.calls.slice(before).find(q=>q.action==='aggregate');assert.equal(q.startAt,'2026-09-21T19:32:03.000Z');assert.equal(q.endAt,'2026-09-21T22:35:07.000Z');
});

test('automatic-payout configuration registers once after the deposit snapshot in the merchant center',async()=>{
 const h=await ready(),merchant=h.c.navGroupsV3.find(g=>g[0]==='merchant');assert(merchant);assert.equal(h.c.pages.filter(p=>p[0]==='payout_config').length,1);assert.deepEqual(Array.from(merchant[3]),['merchants','merchantproviders','workorders','deposit_tracking','payout_config','auto_withdraw','withdraw_operators']);assert.equal(h.c.groupForV3('payout_config')[0],'merchant');assert(!h.c.navGroupsV3.find(g=>g[0]==='analysis')[3].includes('payout_config'));const before=h.calls.length;h.c.setPage('payout_config');await settle();const requests=h.calls.slice(before);assert.deepEqual(requests.map(q=>[q.action,q.operation]),[['payoutConfig','index'],['payoutConfig','snapshot']]);assert.equal(h.c.state.navGroup,'merchant');assert.match(h.nodes.get('nav').innerHTML,/自动出款配置/);assert.match(h.html(),/class="live-payout-config"/);assert.match(h.html(),/SYNTHETIC_CONFIG_PLATFORM/);assert.match(h.html(),/原后台配置 · 只读同步/);assert.match(h.html(),/否（只读）/);assert.match(h.html(),/>0<\/span>/);assert.doesNotMatch(h.html(),/<(?:button|input)[^>]*>保存|onclick="[^"]*(?:save|update|delete)/);assert.equal(h.nodes.get('liveFilters').style.display,'none');
});

test('configuration route and refresh use only exact read-only index/snapshot requests despite dirty order filters',async()=>{
 const h=await ready();h.c.liveSet('orderNumber','SYNTHETIC_STALE_ORDER_QUERY');const before=h.calls.length,originalResults=JSON.stringify(h.L.results);h.c.setPage('payout_config');await settle();await h.c.liveLoad();const requests=h.calls.slice(before);assert.equal(requests.length,4);for(const q of requests){assert.equal(q.action,'payoutConfig');assert(['index','snapshot'].includes(q.operation));assert(!('startAt' in q));assert(!('orderNumber' in q));assert(!('direction' in q));assert(!('currency' in q));if(q.operation==='snapshot')assert.deepEqual(Object.keys(q).sort(),['action','country','operation','platform','system'])}assert.equal(JSON.stringify(h.L.results),originalResults);assert.match(h.html(),/当前保存值/);assert.doesNotMatch(h.html(),/筛选条件已修改/);const direct=await ready({page:'payout_config'});assert.equal(direct.calls.filter(q=>q.action==='catalog').length,1);assert.equal(direct.calls.filter(q=>['aggregate','details','rates'].includes(q.action)).length,0);assert.deepEqual(direct.calls.filter(q=>q.action==='payoutConfig').map(q=>q.operation),['index','snapshot']);assert.equal(direct.c.HensemLivePayoutConfig.state().snapshotStatus,'ready');
});

test('configuration permission failures clear the displayed snapshot and never fall back to order data',async()=>{
 const h=await ready({page:'payout_config'});assert.match(h.html(),/SYNTHETIC_CONFIG_PLATFORM/);const before=h.calls.length;h.setHandler(async q=>{assert.equal(q.action,'payoutConfig');throw Error('403 permission denied')});await h.c.liveLoad();assert.match(h.html(),/授权已失效/);assert.doesNotMatch(h.html(),/SYNTHETIC_CONFIG_PLATFORM|否（只读）/);assert.equal(h.calls.length,before+1);assert.equal(h.c.HensemLivePayoutConfig.state().indexStatus,'error');
});

test('later forced fee query wins over stale requests',async()=>{
 const h=await ready(),old=deferred(),fresh=deferred();h.c.state.page='rates';let n=0;h.setHandler(()=>++n===1?old.promise:fresh.promise);const a=h.c.liveRates(true),b=h.c.liveRates(true);fresh.resolve({rows:[],total:22,options:{countries:[],platforms:[],providers:[]}});await b;old.resolve({rows:[],total:11,options:{countries:[],platforms:[],providers:[]}});await a;assert.equal(h.L.fees.total,22);
});

test('late sibling completion keeps the failed platform warning alongside the successful result',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222'},h=await ready({platforms:[P,p2]}),late=deferred();
 h.setHandler(q=>q.platformId===P.id?Promise.reject(Error('Synthetic failure')):late.promise);
 const run=h.c.liveLoad();await settle();assert.equal(h.L.queryWarnings.length,1);late.resolve(aggregate(p2,8));await run;
 assert.equal(h.L.results.length,1);assert.match(h.html(),/Synthetic failure/);assert.match(h.html(),/仅为已读取结果/);
});

test('direct collection/payout/stuck entry starts in its explicit business direction',async()=>{
 for(const [page,direction]of[['collection','charge'],['payout','withdraw'],['stuck','withdraw']]){const h=await ready({page});assert.equal(h.L.direction,direction);assert(h.calls.filter(q=>q.action==='aggregate').every(q=>q.direction===direction));}
});

test('independent configuration gap remains readable without querying changed order filters',async()=>{
 const h=await ready();h.c.state.page='orders';h.c.liveSet('orderNumber','different');h.c.setPage('access');assert.match(h.html(),/实际账号|查看授权/);assert(!h.html().includes('筛选条件已修改'));
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
 await h.c.liveLoad();assert.equal(h.L.error,'');assert.equal(attempts.length,6);assert.equal(accepted.length,4);assert.equal(attempts[0].startAt,'2026-09-20T07:04:56.000Z');assert.equal(Date.parse(attempts[0].endAt)-Date.parse(attempts[0].startAt),12*3600000);assert(accepted.every(q=>{const width=Date.parse(q.endAt)-Date.parse(q.startAt);return width>5*3600000&&width<=6*3600000}));for(const period of [accepted.slice(0,2),accepted.slice(2)]){assert.equal(period.length,2);assert.equal(period[0].endAt,period[1].startAt)}
 const merged=h.L.results[0];assert.equal(merged._parts.length,2);assert.equal(merged.total,20);assert.equal(merged.summary[0].all_count,20);assert.equal(h.L.comparisonResults[0]._parts.length,2);assert.equal(merged.startAt,accepted[0].startAt);assert.equal(merged.endAt,accepted[1].endAt);assert.equal(h.L.comparisonResults[0].endAt,accepted[3].endAt);
});

test('timeout bisection covers the exact interval and stops retrying at or below the one-hour threshold',async()=>{
 const h=await ready();setScope(h,{platform:P.id});const accepted=[],attempts=[];h.setHandler(async q=>{attempts.push(q);if(Date.parse(q.endAt)-Date.parse(q.startAt)>1.5*3600000)throw Error('Synthetic timeout');accepted.push(q);return aggregate(P,5)});await h.c.liveLoad();assert.equal(h.L.error,'');assert.equal(attempts.length,14);assert.equal(accepted.length,8);assert(accepted.every(q=>Date.parse(q.endAt)-Date.parse(q.startAt)===1.5*3600000));for(const period of [accepted.slice(0,4),accepted.slice(4)])for(let i=1;i<period.length;i++)assert.equal(period[i-1].endAt,period[i].startAt);assert.equal(accepted[0].startAt,'2026-09-21T18:30:00.000Z');assert.equal(accepted[3].endAt,'2026-09-22T00:30:00.000Z');assert.equal(h.L.results[0].total,20);assert.equal(h.L.comparisonResults[0].total,20);
 const rejected=[];h.setHandler(async q=>{rejected.push(q);throw Error('Synthetic timeout still pending')});await h.c.liveLoad();assert.equal(rejected.length,4);const widths=rejected.map(q=>Date.parse(q.endAt)-Date.parse(q.startAt));assert(widths.at(-1)<=3600000);assert(widths.at(-2)>3600000);assert.equal(h.L.results.length,0);assert.match(h.L.queryWarnings.join(' '),/timeout/);const permanent=[];h.setHandler(async q=>{permanent.push(q);throw Error('Synthetic forbidden')});await h.c.liveLoad();assert.equal(permanent.length,1,'non-timeout errors are never retried by partitioning');
});

test('detail pages use the full-range aggregate count and exact page offsets',async()=>{
 const h=await ready();setScope(h,{platform:P.id,from:'2026-09-20T00:00:00',to:'2026-09-21T23:59:59'});h.c.state.page='orders';const detailRequests=[];let changed=false;
 h.setHandler(async q=>{if(q.action==='aggregate')return aggregate(P,28);detailRequests.push(q);const total=changed?29:28;const r=detail(P,total,q.offset,q.limit);r.rows=r.rows.map((row,i)=>({...row,id:'row-'+(q.offset+i),order_number:'SYNTHETIC-'+(q.offset+i)}));return r});
 await h.c.liveLoad();assert.equal(h.L.error,'');assert.equal(h.L.detail.total,28);assert.equal(h.L.detail.rows.length,20);assert.deepEqual(Array.from(h.L.detail.rows,r=>r.id),Array.from({length:20},(_,i)=>'row-'+i));h.c.livePage(2,'server');await settle();assert.deepEqual(Array.from(h.L.detail.rows,r=>r.id),Array.from({length:8},(_,i)=>'row-'+(i+20)));assert.equal(h.L.detail.hasMore,false);assert.equal(detailRequests.length,2);assert.deepEqual(detailRequests.map(q=>q.offset),[0,20]);assert(detailRequests.every(q=>q.startAt==='2026-09-19T18:30:00.000Z'&&q.endAt==='2026-09-21T18:30:00.000Z'));
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
 h.c.setPage('withdraw_operators');await settle();assert.equal(h.calls.at(-1).view,'operators');assert.equal(h.calls.at(-1).sort,'processed');assert.match(h.html(),/SYNTHETIC-OPERATOR/);assert.doesNotMatch(h.html(),/自动出款日报|>自动出款原因<|>驳回原因<|>日明细<|>原因 \/ 每日备注</);const op=renderedTables(h.html()).find(t=>t.headers.includes('操作人'));assert(op);assert(!op.headers.some(x=>x.startsWith('总提现笔数')));for(const t of [auto,op])for(const row of t.rows)assert.equal(row.length,t.headers.length);assert.doesNotMatch(h.html(),/NaN|Infinity/);
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
 const older=deferred();h.setHandler(q=>q.action==='autoWithdraw'&&q.view==='auto'?older.promise:withdrawalHandler(q));const second=h.c.withdrawLoad();h.c.setPage('withdraw_operators');await settle();older.resolve(stale);await second;assert.match(h.html(),/SYNTHETIC-OPERATOR/);assert.doesNotMatch(h.html(),/STALE-PLATFORM/);
});

test('direction provider summaries merge canonical names, match platform fees and split workorder cohorts',async()=>{
 const h=await ready(),p2={...P,id:'another-platform',name:'Second platform',source:'newar'},a=completeAggregate(P,10,4),b=completeAggregate(p2,20,6);
 a.groups.provider[0].created_success_count=3;b.groups.provider[0].created_success_count=5;h.L.results=[a,b];h.L.feeLookupRows=[{scopeType:'country',country:'印度',provider:'Synthetic provider',collectFee:'2%',collectSingleFee:'1'},{scopeType:'platform',country:'印度',platform:p2.name,provider:'Synthetic provider',collectFee:'3%',collectSingleFee:'2'}];h.L.workorders={byProvider:[{provider:'Synthetic provider',direction:'charge',submittedAmount:300,submittedCount:3,successAmount:100,successCount:1,notReceivedAmount:200,notReceivedCount:2},{provider:'Synthetic provider',direction:'withdraw',submittedAmount:9000,submittedCount:90,successAmount:8000,successCount:80,notReceivedAmount:1000,notReceivedCount:10}],coverage:{complete:true,capturedPlatformDays:2,expectedPlatformDays:2,platforms:[]}};h.c.state.page='providers';h.c.render();
 const t=renderedTables(h.html()).find(t=>t.headers[0]==='统一三方');assert(t);assert.equal(t.rows.length,1);const row=t.rows[0].map(plain),at=label=>row[t.headers.findIndex(v=>v===label||v.startsWith(label+' '))];assert.equal(at('平台'),'2');assert.equal(at('代收成功金额'),'1,000.00');assert.equal(at('代收成功笔数'),'10');assert.match(at('成功率'),/^33.33%/);assert(!t.headers.some(x=>/全部创建|处理中/.test(x)));assert.equal(at('估算手续费'),'42.00');assert.equal(at('工单提交金额'),'300.00');assert.equal(at('工单提交笔数'),'3');assert(!t.headers.some(x=>x.includes('取款未到账')));assert.doesNotMatch(t.html,/9,000/);assert.match(t.html,/>合计</);assert.doesNotMatch(t.html,/当前页汇总|全部汇总/);
 h.L.workorders.coverage={complete:false,capturedPlatformDays:0,expectedPlatformDays:2,platforms:[]};h.L.workorders.byProvider=[];h.c.render();const unknown=renderedTables(h.html()).find(t=>t.headers[0]==='统一三方');assert.equal(plain(unknown.rows[0][unknown.headers.indexOf('工单提交金额')]),'—');assert.match(h.html(),/未采集显示 —/);
 h.c.state.page='provider_payout';h.c.render();const withdrawal=renderedTables(h.html()).find(t=>t.headers[0]==='统一三方');assert(withdrawal.headers.includes('工单提交金额'));assert.match(h.html(),/取款未到账工单/);assert(!withdrawal.headers.some(x=>x.includes('存款未到账')));
});

test('provider catalog options do not wait for order aggregation and multiselect values remain scoped',async()=>{
 const pending=deferred(),h=await ready({ancillaryHandler:true,handler:q=>q.action==='catalog'?{platforms:[P]}:q.action==='providerOptions'?{providers:['Previously mapped pay']}:q.action==='aggregate'?pending.promise:{rows:[],total:0}});
 assert.equal(h.L.loading,true);assert.match(h.nodes.get('liveFilters').innerHTML,/Previously mapped pay/);assert.equal(h.L.providerOptionsBusy,false);h.c.liveSetMultiOption('provider',{value:'Previously mapped pay',checked:true});assert.deepEqual(Array.from(h.L.multi.provider),['Previously mapped pay']);assert.match(h.nodes.get('liveFilters').innerHTML,/搜索三方/);pending.resolve(aggregate());await settle();
});

test('team, system and platform selections retain each other and default systems to all',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222',name:'M8 platform',source:'NEW_AR',team:'M8'};
 const p3={...P,id:'33333333-3333-4333-8333-333333333333',name:'Other platform',source:'AR',team:'Other'};
 const h=await ready({platforms:[P,p2,p3]});
 assert.equal(h.L.source,'all');assert.deepEqual(Array.from(h.L.multi.source),[]);
 h.c.liveSetMultiOption('team',{value:'M8',checked:true});
 h.c.liveSetMultiOption('source',{value:'AR',checked:true});
 h.c.liveSetMultiOption('source',{value:'NEW_AR',checked:true});
 h.c.liveSetMultiOption('platform',{value:P.id,checked:true});
 h.c.liveSetMultiOption('platform',{value:p2.id,checked:true});
 await settle();
 assert.deepEqual(Array.from(h.L.multi.source).sort(),['AR','NEW_AR']);
 assert.deepEqual(Array.from(h.L.multi.platform).sort(),[P.id,p2.id].sort());
 const html=h.nodes.get('liveFilters').innerHTML;assert.match(html,/M8 platform/);assert.match(html,/Other platform/);
});

test('provider KPI comparisons use the same direction and distinguish money differences from percentage points',async()=>{
 const h=await ready(),current=completeAggregate(P,100,60),previous=completeAggregate(P,100,50);
 for(const r of [current,previous])r.groups.provider.push({...r.groups.provider[0],direction:'withdraw',success_count:900,success_amount:90000,created_success_count:90});
 h.L.results=[current];h.L.comparisonResults=[previous];h.L.comparisonStatus='ready';h.L.feeLookupRows=[{scopeType:'country',country:'印度',provider:'Synthetic provider',collectFee:'2%',payoutFee:'1%'}];h.c.state.page='providers';h.c.render();
 const cards=h.html().split('<div class="provider-summary-kpis">')[1].split('<div class="provider-comparison-context">')[0];
 assert.match(cards,/6,000\.00/);assert.match(cards,/昨日 5,000\.00/);assert.match(cards,/\+1,000\.00.*\+20\.00%/);assert.match(cards,/\+10\.00 个百分点/);assert.match(cards,/120\.00/);assert.match(cards,/昨日 100\.00/);assert.doesNotMatch(cards,/90,000/);
 assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/业务方向/);
 const table=renderedTables(h.html()).find(t=>t.headers[0]==='统一三方');assert.equal(table.headers[1],'平台');assert(!table.headers.some(h=>/金额 \/ 笔数/.test(h)));assert(table.rows.every(r=>r.length===table.headers.length));
 h.c.state.page='provider_payout';h.c.render();const payoutCards=h.html().split('<div class="provider-summary-kpis">')[1].split('<div class="provider-comparison-context">')[0];assert.match(payoutCards,/90,000\.00/);assert.doesNotMatch(payoutCards,/6,000\.00|\+10\.00 个百分点/);assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/业务方向/);
 h.c.state.page='overview';h.c.render();assert.match(h.nodes.get('liveFilters').innerHTML,/业务方向/);
});
test('provider comparisons suppress incomplete scopes and partial fees while preserving current values and zero-baseline semantics',async()=>{
 const h=await ready(),current=completeAggregate(P,100,60),previous=completeAggregate(P,0,0),cards=()=>h.html().split('<div class="provider-summary-kpis">')[1].split('<div class="provider-comparison-context">')[0];
 h.L.results=[current];h.L.comparisonResults=[previous];h.L.comparisonStatus='ready';h.L.feeLookupRows=[];h.c.state.page='providers';h.c.render();
 assert.match(cards(),/新增 \/ 无基数/);assert.match(cards(),/费率未完全匹配/);assert.doesNotMatch(cards(),/Infinity|NaN/);
 h.L.comparisonResults=[{...previous,platform:{...P,id:'different-platform'}}];h.c.render();assert.match(cards(),/6,000\.00/);assert.match(cards(),/两日平台范围不完整/);assert.doesNotMatch(cards(),/新增 \/ 无基数|\+100\.00%/);
 h.L.comparisonResults=[previous];h.L.comparisonStatus='error';h.L.comparisonError='昨日数据读取失败';h.c.render();assert.match(cards(),/昨日数据读取失败/);assert.doesNotMatch(cards(),/新增 \/ 无基数/);
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
 h.L.feeLookupRows=[inactive];h.c.render();t=renderedTables(h.html()).find(t=>t.headers[0]==='统一三方');row=t.rows[0].map(plain);assert.equal(at('匹配费率'),'未匹配');assert.equal(at('估算手续费'),'—');
 const api=h.c.HensemProviderSummary,order={provider:'UpiPay',direction:'charge',platform:P.name,success_amount:1000,success_count:10};
 assert.equal(api.estimate(order,[{...confirmed,country:'巴西',collectFee:'8%'}],'巴西'),80);
 assert.equal(api.estimate({...order,provider:'IndependentPay'},[{...confirmed,provider:'IndependentPay',collectFee:'3%'},{...confirmed,provider:'IndependentPay',scopeType:'platform',platform:P.name,collectFee:'',collectSingleFee:''}],'印度'),30);
});

test('provider expansion shows platform contributions without requests and leaves overview layout unwrapped',async()=>{
 const h=await ready(),p2={...P,id:'separate-id',source:'NEW_AR'},a=completeAggregate(P,20,4),b=completeAggregate(p2,30,6);
 h.L.results=[a,b];h.L.feeLookupRows=[];h.c.state.page='providers';h.c.render();const calls=h.calls.length;
 assert.match(h.html(),/代收创建金额/);assert.match(h.html(),/代收创建笔数/);assert.match(h.html(),/aria-expanded="false"/);
 h.c.providerSummaryToggle(0);assert.equal(h.calls.length,calls);assert.match(h.html(),/aria-expanded="true"/);
 const children=[...h.html().matchAll(/<tr class="provider-platform-row">([^]*?)<\/tr>/g)].map(m=>[...m[1].matchAll(/<td>([^]*?)<\/td>/g)].map(c=>c[1]));assert.equal(children.length,2);
 assert(children.every(r=>r.length===17));assert.deepEqual(children.map(r=>plain(r[1])).sort(),['AR','NEW_AR']);
 assert.deepEqual(children.map(r=>plain(r[5])).sort(),['40.00%','60.00%']);
 assert.deepEqual(children.map(r=>r[3].match(/笔数占比 ([0-9.]+%)/)[1]).sort(),['40.00%','60.00%']);
 assert.equal(children.reduce((n,r)=>n+Number(plain(r[2]).replaceAll(',','')),0),1000);
 h.c.providerSummaryToggle(0);assert.doesNotMatch(h.html(),/provider-platform-breakdown/);
 h.L.queryWarnings=['Synthetic failed platform'];h.c.render();assert.match(h.html(),/部分平台读取失败/);
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
 h.L.workorders={byProvider:[{provider:'LKgoPayINR',direction:'charge',submittedCount:2,submittedAmount:500,successCount:1,successAmount:100,notReceivedCount:1,notReceivedAmount:400}],coverage:{complete:true,capturedPlatformDays:1,expectedPlatformDays:1}};h.c.state.page='providers';h.c.render();
 const table=renderedTables(h.html()).find(t=>t.headers[0]==='统一三方');assert.equal(table.rows.length,2);assert(!table.rows.some(r=>/LKgoPayINR|PAYTM- RAPay/.test(plain(r[0]))));
 const l=table.rows.find(r=>plain(r[0])==='LKgoPay'),at=label=>plain(l[table.headers.findIndex(h=>h===label||h.startsWith(label+' '))]);assert.equal(at('代收成功金额'),'2,000.00');assert.equal(at('代收成功笔数'),'20');assert.equal(at('估算手续费'),'40.00');assert.equal(at('工单提交金额'),'500.00');assert.equal(at('工单提交笔数'),'2');
});
test('workorder page restores filters and resets the inherited payout or collection direction',async()=>{
 const h=await ready({ancillaryHandler:true,handler:q=>q.action==='catalog'?{platforms:[P]}:q.action==='workorders'?{total:0,rows:[],byDirection:{charge:{submittedCount:3,submittedAmount:300,successCount:1,successAmount:100,notReceivedCount:2,notReceivedAmount:200},withdraw:{submittedCount:5,submittedAmount:500,successCount:2,successAmount:200,notReceivedCount:3,notReceivedAmount:300}},summary:{}}:q.action==='providerOptions'?{providers:[]}:q.action==='rates'?{rows:[],total:0}:aggregate()});
 h.L.direction='charge';h.c.setPage('workorders');await settle();assert.equal(h.L.direction,'all');assert.equal(h.calls.filter(q=>q.action==='workorders').at(-1).direction,'all');assert.equal(h.nodes.get('liveFilters').style.display,'');assert.match(h.html(),/存款未到账|取款未到账/);assert.match(h.nodes.get('nav').innerHTML,/工单未到账/);
});
test('deposit requests preserve the sheet day and hide stale totals when filters change',async()=>{
 const h=await ready();h.setHandler(q=>q.action==='depositIssues'?{rows:[{recordDate:'2026-09-23',platform:'Synthetic platform',provider:'Synthetic Provider',orderNumber:'SYNTHETIC-ORDER',amount:900,status:'已入款',unreceivedDays:90,providerReply:'成功 <script>',utrMatch:'一致',kycCorrect:'正确'}],total:1,summary:{count:1,amount:900,unreceivedAmount:0,unreceivedCount:0,receivedCount:1,maxUnreceivedDays:0}}:{rows:[],total:0});
 h.L.from='2026-09-23T00:00:00';h.L.to='2026-09-23T23:59:59';h.c.setPage('deposit_tracking');await settle();const q=h.calls.at(-1);assert.equal(q.startAt,'2026-09-23T00:00:00.000Z');assert.equal(q.endAt,'2026-09-23T23:59:59.000Z');
 h.c.depositIssuesSection('details');const table=renderedTables(h.html()).find(t=>t.headers[0]==='原表日期');assert(table);assert.equal(plain(table.rows[0][7]),'—');assert.match(h.html(),/成功 &lt;script&gt;/);assert.doesNotMatch(h.html(),/<script>/);assert.doesNotMatch(h.html(),/查看回复|<details/);assert.equal(q.dateMode,'all');
 h.c.depositIssuesDate('from','2026-09-22');assert.match(h.html(),/点击查询/);assert.doesNotMatch(h.html(),/SYNTHETIC-ORDER/);await h.c.depositIssuesLoad();assert.equal(h.calls.at(-1).startAt,'2026-09-22T00:00:00.000Z');
});
test('revisiting a reason tab reuses its bounded cache, while refresh invalidates it',async()=>{
 const h=await ready({page:'auto_withdraw',handler:withdrawalHandler});h.c.withdrawReasons(0);await settle();h.c.withdrawReasonKind('categories');await settle();const n=h.calls.filter(q=>q.action==='withdrawReasons').length;
 h.c.withdrawReasonKind('blocking');await settle();assert.equal(h.calls.filter(q=>q.action==='withdrawReasons').length,n);
 await h.c.withdrawLoad(true);h.c.withdrawReasons(0);await settle();assert.equal(h.calls.filter(q=>q.action==='withdrawReasons').length,n+1);
});

test('deposit summaries cover the filtered dataset and source switches carry searchable replies without mixing totals',async()=>{
 const h=await ready();h.setHandler(q=>q.action==='depositIssues'?{view:q.view,rows:[],total:20,summary:{count:20,unreceivedCount:12,unreceivedAmount:900,receivedCount:8,linkedCount:17,unlinkedCount:2,reviewCount:1},facets:{platforms:['Synthetic platform'],providers:['UmoneyPay'],followupStatuses:['need to provide pdf/video']},providerSummary:[{provider:'UmoneyPay',matchStatus:'对得上',count:20,unreceivedCount:12,unreceivedAmount:900,maxDays:9,receivedCount:8}],dailySummary:[{date:'2026-09-23',count:20,matchedCount:15,unmatchedCount:5,receivedCount:8,unreceivedCount:12}],platformSummary:[{platform:'Synthetic platform',count:20,linkedCount:17,unlinkedCount:3}],statusSummary:[{status:'need to provide pdf/video',count:12,amount:900}]}:{rows:[]});
 h.c.setPage('deposit_tracking');await settle();assert.match(h.html(),/三方未入款统计/);assert.match(h.html(),/每日核对统计/);
 h.c.depositIssuesDrill('providers',0);await settle();assert.equal(h.calls.at(-1).provider,'UmoneyPay');assert.equal(h.calls.at(-1).match,'matched');assert.equal(h.L.depositIssuesSection,'details');
 h.c.depositIssuesSet('query','success to other');h.c.depositIssuesSource('entries');await settle();assert.equal(h.calls.at(-1).view,'entries');assert.equal(h.calls.at(-1).query,'success to other');assert.equal(h.calls.at(-1).status,undefined);assert.equal(h.calls.at(-1).match,undefined);assert.match(h.html(),/打开录入表/);assert.match(h.html(),/各平台录入进度/);assert.match(h.html(),/跟进状态分布/);
 h.c.depositIssuesDrill('statuses',0);await settle();assert.equal(h.calls.at(-1).followupStatus,'need to provide pdf/video');
});

test('collected platforms expose report-only teams, retain independent filters and read one source on demand',async()=>{
 const report={name:'NEW-PH',team:'胖虎',country:'胖虎巴西',system:'PANDA',dataset:'panda_success',rawCountry:'胖虎巴西',rawPlatform:'NEW-PH',lastDate:'2026-09-24'};
 const h=await ready({page:'collected_data',handler:q=>q.action==='catalog'?{platforms:[P]}:q.action==='collectedData'?(q.operation==='catalog'?{rows:[report,{...report,name:'UNKNOWN',rawPlatform:'UNKNOWN',team:'待归类',country:'新地区'}]}:{rows:[{date:'2026-09-24',metrics:{count:5,success:3}}],total:1}):aggregate(P)});
 assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);assert.match(h.html(),/NEW-PH/);assert.match(h.html(),/UNKNOWN/);assert.match(h.html(),/待归类/);
 h.c.collectedSet('team','胖虎');assert.match(h.html(),/NEW-PH/);assert.doesNotMatch(h.html(),/<td>UNKNOWN<\/td>/);assert.match(h.html(),/<option value="待归类"/);
 const calls=h.calls.length;h.c.collectedSearch('NEW-');h.c.collectedSearch('NEW-PH');assert.equal(h.calls.length,calls,'search needs no repeated database scan');h.c.collectedOpen(0,0);await settle();const q=h.calls.at(-1);assert.equal(q.action,'collectedData');assert.equal(q.platform,'NEW-PH');assert.equal(q.country,'胖虎巴西');assert.equal(q.dataset,'panda_success');assert.equal(q.startAt,'2026-09-24');assert.match(h.html(),/成功笔数/);h.c.collectedDate('from','2026-09-23');assert.match(h.html(),/日期已修改/);assert.doesNotMatch(h.html(),/<th>成功笔数<\/th>/);
});
test('Panghu withdrawal picker preserves displayed team scope with authorized catalogue platforms',async()=>{
 const ph={id:'44444444-4444-4444-4444-444444444444',name:'FUTURE-PH',country:'胖虎巴西',scopeGroup:'BR_PANGHU',team:'胖虎',source:'withdraw',timezone:'America/Sao_Paulo',currency:'BRL'};
 const h=await ready({page:'auto_withdraw',handler:q=>q.action==='catalog'?{platforms:[P],withdrawPlatforms:[ph]}:q.action==='autoWithdraw'?{country:q.country,rows:[],totals:{},platforms:['FUTURE-PH']}:{}});
 h.c.withdrawCountry('胖虎巴西');assert.equal(h.L.country,'巴西');assert.deepEqual(Array.from(h.L.multi.team),['胖虎']);assert.match(h.html(),/FUTURE-PH/);await h.c.withdrawLoad(true);const q=h.calls.filter(q=>q.action==='autoWithdraw').at(-1);assert.equal(q.country,'胖虎巴西');assert.deepEqual(Array.from(q.platforms),['FUTURE-PH']);
});

test('overview requests compact totals and providers, defers charts, and yesterday stays compact',async()=>{
 const h=await ready();assert(h.calls.filter(q=>q.action==='aggregate').every(q=>q.view==='providers'));
 assert.match(h.html(),/加载全部图表分析/);assert.match(h.html(),/滚动到这里会自动读取并展示/);assert.doesNotMatch(h.html(),/打开后读取对应分析/);
 assert(!h.calls.some(q=>q.action==='workorders'));
 const start=h.calls.length;h.c.liveOverviewAnalysis();await settle();
 const reads=h.calls.slice(start).filter(q=>q.action==='aggregate');assert(reads.some(q=>!q.view));assert(reads.filter(q=>q.view).every(q=>q.view==='providers'));
 assert.match(h.html(),/id="df-hour-charge"/);assert.match(h.html(),/id="df-charge-trend"/);
});

test('slow or failed platform keeps completed overview results visibly partial without duplicate queries',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222',name:'Slow platform'},wait=deferred();
 const h=await ready({platforms:[P,p2]});h.setHandler(q=>q.action==='aggregate'&&q.platformId===p2.id?wait.promise:aggregate(P));
 const run=h.c.liveLoad();await settle();assert.equal(h.L.loading,true);assert.equal(h.L.results.length,1);assert.match(h.html(),/部分结果/);assert.match(h.html(),/Synthetic platform/);
 const before=h.calls.length;await h.c.liveLoad();assert.equal(h.calls.length,before);
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
 await h.c.liveLoad();h.c.liveReset();h.c.livePeriod('week');h.c.livePeriod('yesterday');h.c.livePage(2,'server');h.c.livePageSize('500','server');await h.c.liveDetails();await settle();
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
 const requests=h.calls.length;await h.c.liveLoad();
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
 h.c.setPage('orders');await h.c.liveLoad();await settle();
 assert.equal(h.calls.length,before);assert.match(h.html(),/请先选择一个商户（平台）/);
 h.c.liveSet('platform',P.id);await settle();await h.c.liveLoad();assert(h.L.detail);
 before=h.calls.length;h.c.liveSet('team','Other team');await h.c.liveLoad();h.c.livePage(2,'server');await settle();
 assert.equal(h.calls.length,before);assert.match(h.html(),/请先选择一个商户（平台）/);assert.doesNotMatch(h.html(),/order-0/);
 before=h.calls.length;h.c.liveSet('country','美国');await h.c.liveLoad();await settle();
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
 const old=h.c.liveLoad();await settle();h.c.liveSet('platform',p2.id);await h.c.liveLoad();
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
 const p2={...P,id:'partial-retry',name:'Retry platform'},h=await ready({page:'providers',platforms:[P,p2]});h.L.feeLookupRows=[];setScope(h,{platform:'all'});h.setHandler(async q=>{if(q.platformId===p2.id)throw Error('Synthetic failure');return completeAggregate(P,20,7)});await h.c.liveLoad();const kept=h.L.results[0];assert.equal(h.L.queryPlatforms.length,2);assert.equal(h.L.queryFailures.length,1);assert.match(h.html(),/已返回 1 \/ 2 个平台/);
 const pending=deferred(),retried=[];h.setHandler(q=>{retried.push(q);assert.equal(q.platformId,p2.id);return pending.promise});const run=h.c.liveRetryFailed();await settle();assert.equal(h.L.queryRetrying,true);assert.equal(h.L.results[0],kept);assert.match(h.html(),/已读取代收成功金额/);await h.c.liveRetryFailed();assert.equal(retried.length,1,'duplicate clicks cannot repeat the retry');pending.resolve(completeAggregate(p2,30,8));await run;assert.equal(h.L.results.length,2);assert.equal(h.L.results[0],kept);assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.queryWarnings.length,0);assert.equal(h.L.queryRetrying,false);assert.equal(retried.length,1,'retry does not fan out into a new whole-platform comparison query');assert.doesNotMatch(h.html(),/仅显示已返回平台的部分结果/);
});
test('filter changes invalidate a failed-platform retry before its late result can join a different scope',async()=>{
 const p2={...P,id:'stale-retry',name:'Late retry'},h=await ready({page:'providers',platforms:[P,p2]});h.L.feeLookupRows=[];setScope(h,{platform:'all'});h.setHandler(async q=>{if(q.platformId===p2.id)throw Error('Synthetic failure');return completeAggregate(P,20,7)});await h.c.liveLoad();const pending=deferred();let calls=0;h.setHandler(()=>{calls++;return pending.promise});const run=h.c.liveRetryFailed();await settle();h.c.liveSet('provider','Changed provider');assert.equal(h.L.queryRetrying,false);await h.c.liveRetryFailed();assert.equal(calls,1,'dirty filters cannot use a stale retry scope');pending.resolve(completeAggregate(p2,1000,999));await run;assert.equal(h.L.results.length,1);assert.equal(h.L.results[0].platform.id,P.id);assert.match(h.html(),/筛选条件已修改/);
});
test('provider summaries bound a daily timeout to one bisection and discard incomplete successful pieces',async()=>{
 for(const page of ['providers','provider_payout']){
  const h=await ready({page});h.L.feeLookupRows=[];setScope(h,{platform:P.id});let requests=[];h.setHandler(async q=>{requests.push(q);throw Error('Synthetic timeout')});await h.c.liveLoad();assert.equal(requests.length,2,'a failed half must stop this platform instead of recursively subdividing to one hour');assert.equal(h.L.results.length,0);assert.equal(h.L.queryFailures.length,1);assert.match(h.html(),/本次尚无平台返回/);
  requests=[];const start='2026-09-21T18:30:00.000Z';h.setHandler(async q=>{requests.push(q);if(Date.parse(q.endAt)-Date.parse(q.startAt)>3*3600000||q.startAt!==start)throw Error('Synthetic timeout');return completeAggregate(P,9999,9999)});await h.c.liveLoad();assert.equal(requests.length,3);assert.equal(h.L.results.length,0,'one successful half cannot become a completed platform');assert.equal(h.L.queryFailures.length,1);assert.doesNotMatch(h.html(),/>999,900\.00</);
 }
});
test('provider multi-day timeout slices preserve exact endpoints and reject a partial-day result',async()=>{
 const h=await ready({page:'providers'});h.L.feeLookupRows=[];setScope(h,{platform:P.id,from:'2026-09-20T12:34:56',to:'2026-09-22T12:34:55'});const accepted=[],requests=[];h.setHandler(async q=>{requests.push(q);if(Date.parse(q.endAt)-Date.parse(q.startAt)>86400000)throw Error('Synthetic timeout');accepted.push(q);return completeAggregate(P,10,4)});await h.c.liveLoad();assert.equal(requests.length,6);assert.equal(accepted.length,4);assert.equal(h.L.results[0]._parts.length,2);assert.equal(h.L.results[0].summary[0].all_count,20);assert.equal(accepted[0].startAt,requests[0].startAt);assert.equal(accepted[0].endAt,accepted[1].startAt);assert.equal(accepted[1].endAt,requests[0].endAt);
 let attempts=0;h.setHandler(async q=>{attempts++;if(attempts===2)return completeAggregate(P,500,499);throw Error('Synthetic timeout')});await h.c.liveLoad();assert.equal(attempts,4);assert.equal(h.L.results.length,0);assert.equal(h.L.queryFailures.length,1);
});

test('overview fills all fee rollups, merges provider sources, and keeps manual amounts outside provider ranking',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222',name:'Other platform',source:'newar'},h=await ready({platforms:[P,p2]});
 const a=completeAggregate(P,10,3),b=completeAggregate(p2,20,7),manual={...stats(2,'200'),provider:'人工充值',success_count:2,created_success_count:2,success_amount:'200',pending_count:0,pending_amount:0,failed_count:0,failed_amount:0};
 a.groups.provider=[{...a.summary[0],provider:'UPI-QR'},manual];a.summary=[{...a.summary[0],all_count:12,all_amount:'1200',success_count:5,created_success_count:5,success_amount:'500'}];b.groups.provider=[{...b.summary[0],provider:'UPI-QR'}];
 h.L.results=[a,b];h.L.feeLookupRows=[{scopeType:'country',country:'印度',provider:'UPI-QR',collectFee:'4%'},{scopeType:'platform',country:'印度',platform:p2.name,provider:'UPI-QR',collectFee:'5%'}];h.L.direction='charge';h.L.comparisonStatus='idle';h.c.state.page='overview';h.c.render();
 const tables=renderedTables(h.html()),provider=tables.find(t=>t.headers[0]==='三方'),at=(t,row,label)=>plain(row[t.headers.indexOf(label)]);
 assert(!provider.headers.includes('包网来源'));assert(!provider.headers.includes('方向'));assert.equal(provider.rows.length,2);
 assert.deepEqual(provider.headers,['三方','全部金额','全部笔数','成功金额','金额占比','成功笔数','笔数占比','成功率','手续费率','估算手续费','手续费占比']);assert.match(h.html(),/table class="df-provider-business-table"/);
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
 const before=h.calls.length;h.c.render();const ranks=[...h.html().matchAll(/<div class="df-workorder-ranks"[^]*?(?=<\/div><div class="df-state-tail">)/g)].map(x=>x[0]);
 assert.equal(ranks.length,2);assert.match(ranks[0],/存款 · 未到账最多/);assert.match(ranks[0],/存款 · 工单到账率较高/);assert(ranks[0].indexOf('NoSuccess')<ranks[0].indexOf('Intnet'));assert.match(ranks[0],/30 笔/);assert.match(ranks[0],/3,000/);assert.match(ranks[0],/98\.00%/);assert.match(ranks[0],/196\/200/);assert.match(ranks[0],/19,600/);assert.doesNotMatch(ranks[0],/PayoutOnly|人工确认|PageOnlyFake|Intnet-QR/);assert.match(ranks[1],/PayoutOnly/);assert.doesNotMatch(ranks[1],/GoodPay|Intnet/);assert.equal(h.calls.length,before,'rendering ranks reuses the workorder summary');
 assert.match(h.html(),/估算手续费[^]*?df-workorder-ranks[^]*?df-state-tail/);
});
test('workorder ranks distinguish partial coverage, no data and failed reads',async()=>{
 const h=await ready();h.c.render();h.L.workorders={coverage:{complete:false,capturedPlatformDays:13,expectedPlatformDays:17,platforms:[{platform:'Missing <platform>',days:0,expectedDays:1,complete:false}]},unsupportedPlatforms:['Unsupported <source>'],byProvider:[{provider:'SomePay',direction:'charge',submittedCount:1,successCount:1,successAmount:10,notReceivedCount:0,notReceivedAmount:0}]};h.c.render();assert.match(h.html(),/工单覆盖 13 \/ 17 平台日/);assert.match(h.html(),/Missing &lt;platform&gt;/);assert.match(h.html(),/Unsupported &lt;source&gt;/);assert.match(h.html(),/不能据此认定漏抓/);assert.match(h.html(),/暂无达到30笔/);assert.match(h.html(),/暂无已采集的取款三方工单/);assert.match(h.html(),/已采集工单暂无未到账/);assert.doesNotMatch(h.html(),/工单到账率较高<small>部分/);
 h.L.workorders=null;h.L.workordersError='Synthetic timeout';h.c.render();assert.match(h.html(),/工单读取未完成/);assert.doesNotMatch(h.html(),/SomePay|已采集工单暂无未到账/);
});

test('overview shortlists major providers, excludes small samples and omits ArbPay only from collection high ranking',async()=>{
 const h=await ready(),r=completeAggregate(P,50000,30000),row=(provider,count,success,direction='charge')=>({...stats(count,String(count*100)),provider,direction,success_count:success,success_amount:String(success*100),created_success_count:1});
 r.groups.provider=[row('ArbPay',15000,15000),row('TinyPerfect',9,9),...Array.from({length:11},(_,i)=>row('Major'+i,10000-i*500,6000-i*400)),row('ArbPay',15000,15000,'withdraw'),row('PayoutOther',12000,11000,'withdraw')];
 h.L.results=[r];h.L.direction='all';h.L.feeLookupRows=[];h.c.render();
 const cards=[...h.html().matchAll(/<div class="df-provider-rank high">([^]*?)<\/div><div class="df-provider-rank low">/g)].map(x=>x[1]);assert.equal(cards.length,2);
 assert.doesNotMatch(cards[0],/<span>ArbPay<\/span>|TinyPerfect|Major10/);assert.match(cards[0],/不含 ArbPay/);assert.match(cards[0],/Major0/);assert.match(cards[1],/<span>ArbPay<\/span>/);
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
 const before=h.calls.length;h.c.liveSetMultiOption('team',{value:'胖虎',checked:true});assert.equal(h.L.country,'巴西');await h.c.liveLoad();await settle();
 const calls=h.calls.slice(before);assert(calls.some(q=>q.action==='reportSummary'));assert(!calls.some(q=>['aggregate','details','providerOptions'].includes(q.action)));
 assert.match(h.html(),/BET6867/);assert.match(h.html(),/Google 表格 → Supabase/);assert.match(h.html(),/500\.00/);assert.doesNotMatch(h.html(),/df-collect|df-payout/,'report-only data never paints misleading zero-order cards');assert.match(h.nodes.get('liveFilters').innerHTML,/1 平台/);
 h.c.setPage('time');await settle();assert.match(h.html(),/日报未提供|日报.*无法|源日报/);const n=h.calls.filter(q=>q.action==='reportSummary').length;h.c.setPage('overview');await settle();assert.match(h.html(),/BET6867/);assert.equal(h.calls.filter(q=>q.action==='reportSummary').length,n,'same-range navigation reuses the complete report');
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
 const filters=h.nodes.get('liveFilters').innerHTML,countries=filters.match(/id="live-country"[^]*?<\/select>/)[0];assert.match(filters,/value="胖虎"/);assert.match(countries,/>巴西<\/option>/);assert.doesNotMatch(countries,/>胖虎巴西<|>香港<|>红膏蟹</);assert.match(countries,/国家待核对/);
 const before=h.calls.length;h.c.liveSet('team','胖虎');assert.equal(h.L.country,'巴西');assert.match(h.nodes.get('liveFilters').innerHTML,/31 平台/);await h.c.liveLoad();await settle();assert(!h.calls.slice(before).some(q=>['aggregate','providerOptions','details'].includes(q.action)));assert.match(h.html(),/日报读取未完成/);assert.doesNotMatch(h.html(),/df-collect|df-payout/);
});

test('matrix cell selection renders only that hour below its band and supports closing it',async()=>{
 const h=await ready(),r=completeAggregate(P,10,4);r.groups.matrix.push({...r.groups.matrix[0],hour:13,success_amount:'99000',success_count:990,all_amount:'100000',all_count:1000});h.L.results=[r];h.L.matrixMode='exact';h.L.direction='charge';h.c.state.page='matrix';h.c.render();const before=h.calls.length,encoded=encodeURIComponent(JSON.stringify({kind:'matrix',direction:'charge',hour:12,bucket:'200'}));h.c.liveMatrixSegment(encoded);
 let html=h.html(),detail=html.match(/<div class="analysis-drilldown">([^]*?)<div class="analysis-note">/)[1];assert.match(detail,/12时 × 200/);assert.doesNotMatch(detail,/24小时合计|99,000/);assert.match(detail,/400\.00/);assert.match(detail,/金额占比 100\.00%/);assert(html.indexOf('<div class="analysis-drilldown">')<html.indexOf('<tr><td>300</td>'));assert.equal(h.calls.length,before);
 h.c.liveMatrixSegment(encoded);assert.doesNotMatch(h.html(),/<div class="analysis-drilldown">/);assert.equal(h.calls.length,before);
});
