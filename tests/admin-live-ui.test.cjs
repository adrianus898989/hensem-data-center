/* Synthetic-only VM tests for the production UI adapter. No credentials/network/real orders. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8');
const layoutSources=['live-reference-layout.js','live-pages-reference.js','live-empty-pages.js','live-duration-reference.js','live-payout-config.js'].map(name=>({name,source:fs.readFileSync(path.join(__dirname,'../admin-preview',name),'utf8')}));
const comparisonSource=fs.readFileSync(path.join(__dirname,'../admin-preview/live-comparison.js'),'utf8');
test('reference views keep same-name providers separated by source and platforms by stable identity',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222',source:'NEW_AR'},p3={...P,id:'33333333-3333-4333-8333-333333333333'};
 const h=await ready({platforms:[P,p2,p3]});h.L.results=[completeAggregate(P,11,3),completeAggregate(p2,17,8),completeAggregate(p3,23,9)];h.L.platform='all';h.L.comparisonStatus='idle';h.L.direction='charge';h.L.dailyView='all';
 const tableFor=(page,view,first)=>{h.c.state.page=page;h.L.view=view;h.c.render();const found=renderedTables(h.html()).find(t=>t.headers[0]===first&&t.headers.includes('包网来源'));assert(found,page+'/'+view+' has an independent source column');for(const row of found.rows)assert.equal(row.length,found.headers.length,page+'/'+view+' cell alignment');return found};
 const numeric=(table,source,label)=>{const row=table.rows.find(r=>plain(r[table.headers.indexOf('包网来源')])===source);assert(row,'source '+source);return Number(plain(row[table.headers.indexOf(label)]).replaceAll(',',''))};
 const overviewProviders=tableFor('overview','business','三方');assert.equal(overviewProviders.rows.length,2);assert.equal(numeric(overviewProviders,'AR','全部笔数'),34);assert.equal(numeric(overviewProviders,'NEW_AR','全部笔数'),17);assert.equal(numeric(overviewProviders,'AR','全部金额'),3400);assert.equal(numeric(overviewProviders,'NEW_AR','全部金额'),1700);
 for(const page of ['overview','teamplatforms','merchants']){const t=tableFor(page,'business','平台');assert.equal(t.rows.length,3,page+' stable platforms must not merge by display name or source');assert.deepEqual(t.rows.map(r=>Number(plain(r[t.headers.indexOf('全部笔数')]))).sort((a,b)=>a-b),[11,17,23]);assert.equal(t.rows.reduce((n,r)=>n+Number(plain(r[t.headers.indexOf('全部金额')]).replaceAll(',','')),0),5100);}
 const fees=tableFor('providers','fees','三方');assert.equal(fees.rows.length,2);assert.equal(numeric(fees,'AR','成功金额'),1200);assert.equal(numeric(fees,'NEW_AR','成功金额'),800);assert.equal(numeric(fees,'AR','成功笔数'),12);assert.equal(numeric(fees,'NEW_AR','成功笔数'),8);
 for(const [page,view]of [['channelquality','business'],['risk','business'],['providers','decision']]){const t=tableFor(page,view,'三方');assert.equal(t.rows.length,2);assert.deepEqual(t.rows.map(r=>plain(r[t.headers.indexOf('包网来源')])).sort(),['AR','NEW_AR']);}
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
  assert.deepEqual(tailItems,{'拒绝金额':Number(expected.rejected_amount),'拒绝笔数':expected.rejected_count,'未知状态金额':Number(expected.unknown_amount),'未知状态笔数':expected.unknown_count});
  assert.equal(cards.slice(1).reduce((n,s)=>n+s.amount,0)+tailItems['拒绝金额']+tailItems['未知状态金额'],cards[0].amount);
  assert.equal(cards.slice(1).reduce((n,s)=>n+s.count,0)+tailItems['拒绝笔数']+tailItems['未知状态笔数'],cards[0].count);
 }
 assert.match(h.html(),/所选创建日期内仍待付/);assert.doesNotMatch(h.html(),/所选提交日期内仍待付/);
 r.summary[0].unknown_amount=null;r.summary[0].all_amount=null;h.c.render();const collect=h.html().match(/<section class="df-card" id="df-collect">([^]*?)<\/section>/)?.[1];assert.match(collect,/未知状态金额 <b>—<\/b>/);assert.match(collect,/未知状态笔数 <b>2<\/b>/);assert.doesNotMatch(collect,/NaN|Infinity/);
});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async()=>{for(let n=0;n<24;n++)await flush()};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const P={id:'11111111-1111-4111-8111-111111111111',name:'Synthetic platform',source:'AR',country:'印度',scopeGroup:'india',timezone:'Asia/Kolkata',currency:'INR'};
const stats=(count=5,amount='1000.25')=>({direction:'charge',currency:'INR',all_count:count,all_amount:amount,success_count:3,success_amount:'600.15',pending_count:1,pending_amount:'200.05',failed_count:1,failed_amount:'200.05',rejected_count:0,rejected_amount:'0',unknown_count:0,unknown_amount:'0',missing_amount_count:0});
function aggregate(p=P,count=5){const s=stats(count);return {platform:p,total:count,startAt:'2026-09-21T18:30:00.000Z',endAt:'2026-09-22T00:30:00.000Z',summary:[s],rows:[],groups:{provider:[{...s,provider:'Synthetic provider'}],daily:[{...s,provider:'Synthetic provider',date:'2026-09-22'}],hourly:[{...s,hour:12}],amount:[{...s,bucket:'200'}],matrix:[{...s,bucket:'200',hour:12}],latency:[],pending_age:[]}}}
function detail(p=P,total=65,offset=0,limit=20){return {platform:p,total,offset,limit,hasMore:offset+limit<total,summary:[],groups:{},rows:Array.from({length:Math.max(0,Math.min(limit,total-offset))},(_,i)=>({id:'row-'+(offset+i),system_order_id:'source-'+(offset+i),order_number:'order-'+(offset+i),third_party_order_number:'third-'+(offset+i),member_id:'member-'+(offset+i),provider:'Synthetic provider',direction:'charge',status:'1',status_group:'success',amount:'200.05',created_at:'2026-09-22T01:02:03Z',success_at:'2026-09-22T01:03:03Z',currency:'INR'}))}}
function payoutConfig(request,hasTargets=true){const target={platform:'SYNTHETIC_CONFIG_PLATFORM',country_code:'IN',country_name:'印度',display_group:'IN',display_name:'印度',timezone:'Asia/Kolkata',members:[]};return request.operation==='index'?{version:1,system:request.system,readOnly:true,targets:hasTargets?[target]:[],summaries:hasTargets?[{...target,observed_local_date:'2026-09-22'}]:[]}:{version:1,system:request.system,readOnly:true,target,snapshot:{country_code:'IN',platform:target.platform,timezone:'Asia/Kolkata',observed_local_date:'2026-09-22',observed_at:'2026-09-22T00:00:00Z',configuration:{fields:[{key:'autoWithdraw',kind:'boolean',available:true,value:false},{key:'withdrawAmount',kind:'number',available:true,value:0}],groups:[]}}}}
function harness(options={}){
 const nodes=new Map(),writes=[],calls=[],drawers=[],intervals=[],timers=[],blobs=[];let handler=options.handler,clock=Date.parse('2026-09-23T12:00:00Z');
 function node(id){let html='';const item={id,textContent:'',value:'',title:'',style:{setProperty(k,v){this[k]=v}},classList:{add(){},remove(){}},querySelector:s=>node(id+' '+s),querySelectorAll:()=>[],appendChild(n){if(n.id)nodes.set(n.id,n);return n},after(n){if(n.id)nodes.set(n.id,n)},remove(){nodes.delete(this.id)},setAttribute(){},click(){}};Object.defineProperty(item,'innerHTML',{get:()=>html,set:v=>{html=String(v);writes.push({id,html})}});return item}
 for(const id of ['pageTitle','pageSubtitle','eyebrow','crumbTitle','nav','filters','scope','page','headerActivityV3','.title-actions','.bottom-note','.top-right','.topbar'])nodes.set(id,node(id));
 const keys=['overview','providers','orders','time','amount','matrix','provider_daily','latency','stuck','collection','payout','risk','channelquality','teamops','teamcountries','teamplatforms','merchants','workorders','rates','data_health','deposit_tracking','dropped','anomaly','events','rules','access','ip','login_logs','operation_logs','teams','provider_config','platform_systems','merchantproviders'];
 const merchantKeys=['merchants','merchantproviders','workorders','deposit_tracking'];
 const pages=keys.map(k=>[k,'',k,'',k]),groups=[['analysis','','数据分析',keys.filter(k=>!merchantKeys.includes(k))],['merchant','','商户中心',merchantKeys]];
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}}
 class TestURL extends URL{static createObjectURL(blob){blobs.push(blob);return 'blob:synthetic'}static revokeObjectURL(){}}
 const context={console,Intl,Date:FixedDate,URL:TestURL,Blob,state:{page:options.page||'overview',navGroup:'analysis'},pages,navGroupsV3:groups,location:{hash:''},
  document:{title:'',body:{classList:{add(){},remove(){}}},getElementById:id=>nodes.get(id)||null,querySelector:selector=>nodes.get(selector)||null,createElement:tag=>node(tag)},
  render(){nodes.get('page').innerHTML='INDEPENDENT_SNAPSHOT'},syncFilters(){},groupForV3:key=>groups.find(g=>g[3].includes(key))||groups[0],toggleCenterV3(){},setPage(){},headerIconV3:()=>'<svg></svg>',openDrawer:(title,html)=>drawers.push({title,html}),toast(){},scrollTo(){},
  setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length},clearInterval(){},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout(){},
  HENSEM_PRODUCTION:options.production!==false,
  hensemLiveRequest:async request=>{calls.push(JSON.parse(JSON.stringify(request)));if(handler)return handler(request);if(request.action==='catalog')return {platforms:options.platforms||[P]};if(request.action==='details')return detail((options.platforms||[P]).find(p=>p.id===request.platformId)||P,65,request.offset,request.limit);if(request.action==='rates')return {rows:[],total:0,options:{countries:[],platforms:[],providers:[]}};if(request.action==='payoutConfig')return payoutConfig(request,(options.platforms||[P]).length>0);return aggregate((options.platforms||[P]).find(p=>p.id===request.platformId)||P,65)}
 };context.window=context;vm.createContext(context);vm.runInContext(comparisonSource,context,{filename:'live-comparison.js',timeout:2000});for(const module of layoutSources)vm.runInContext(module.source,context,{filename:module.name,timeout:2000});vm.runInContext(source,context,{filename:'live-data.js',timeout:2000});
 return {c:context,L:context.adminLive,calls,writes,nodes,drawers,intervals,timers,blobs,setHandler:fn=>handler=fn,setNow:value=>clock=Date.parse(value),html:()=>nodes.get('page').innerHTML};
}
async function ready(options){const h=harness(options);await settle();if(h.L){h.L.from='2026-09-22T00:00:00';h.L.to='2026-09-22T05:59:59'}return h}
function setScope(h,values={}){Object.assign(h.L,{from:'2026-09-22T00:00:00',to:'2026-09-22T05:59:59',...values})}
function completeAggregate(p=P,count=10,success=5){const r=aggregate(p,count),s={...stats(count,String(count*100)),success_count:success,success_amount:String(success*100),pending_count:count-success,pending_amount:String((count-success)*100),failed_count:0,failed_amount:'0',rejected_count:0,rejected_amount:'0',unknown_count:0,unknown_amount:'0'};r.summary=[s];for(const key of ['provider','daily','hourly','amount','matrix'])r.groups[key]=[{...r.groups[key][0],...s}];return r}
const withoutWindow=q=>Object.fromEntries(Object.entries(q).filter(([key])=>!['startAt','endAt'].includes(key)));
const plain=html=>String(html).replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim();
function renderedTables(html){return [...html.matchAll(/<table\b[^>]*>([^]*?)<\/table>/g)].map(match=>({html:match[0],headers:[...match[1].matchAll(/<th\b[^>]*>([^]*?)<\/th>/g)].map(x=>plain(x[1])),rows:[...(match[1].match(/<tbody\b[^>]*>([^]*?)<\/tbody>/)?.[1]||'').matchAll(/<tr\b[^>]*>([^]*?)<\/tr>/g)].map(row=>[...row[1].matchAll(/<td\b[^>]*>([^]*?)<\/td>/g)].map(cell=>cell[1]))}));}


test('adapter does nothing outside production and never installs an automatic data refresh',async()=>{
 const offline=await ready({production:false});assert.equal(offline.L,undefined);assert.equal(offline.calls.length,0);
 const h=await ready();assert.equal(h.calls.filter(q=>q.action==='catalog').length,1);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,8);assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.intervals.length,0);const n=h.calls.length;h.c.render();h.c.render();await settle();assert.equal(h.calls.length,n);h.c.liveSet('provider','chosen');assert.equal(h.calls.length,n);assert.match(h.html(),/点击查询/);await h.c.liveLoad();assert.equal(h.calls.at(-1).providers[0],'chosen');
});

test('all direction remains selectable while charge and withdrawal totals are displayed separately',async()=>{
 const h=await ready();assert.equal(h.L.direction,'all');
 const filters=h.nodes.get('liveFilters').innerHTML,direction=filters.match(/<select[^>]*liveSet\('direction'[^]*?<\/select>/)?.[0];
 assert(direction,'direction select exists');assert.match(direction,/value="charge"/);assert.match(direction,/value="withdraw"/);assert.match(direction,/value="all"[^>]*>全部</);assert.doesNotMatch(direction,/代收 \+ 代付/);
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
 const h=await ready(),calls=h.calls.length;h.c.render();const html=h.html();assert.match(html,/class="dashboard-full-v3"/);assert.match(html,/class="df-jumps"/);assert.doesNotMatch(html,/liveOverviewTab\(/);
 for(const id of ['df-collect','df-payout','df-backlog','df-risk','df-exceptions','df-order-trend','df-charge-trend','df-charge-money','df-withdraw-trend','df-withdraw-money','df-teams','df-countries','df-platforms','df-providers','df-amounts','df-hour-charge','df-hour-withdraw','df-workorders'])assert(html.includes('id="'+id+'"'),id+' is visible in the full overview');
 const navigation=html.match(/<nav class="df-jumps"[^>]*>([^]*?)<\/nav>/)?.[1];assert(navigation);assert.equal([...navigation.matchAll(/<a\b/g)].length,9);for(const [,id]of navigation.matchAll(/href="#([^"]+)"/g))assert(html.includes('id="'+id+'"'),'anchor '+id+' has a visible destination');assert.equal(h.calls.length,calls);assert.doesNotMatch(html,/NaN|Infinity/);
});

test('reference totals retain exactly six compact cards per direction with independent amounts and unknown fees',async()=>{
 const h=await ready(),r=completeAggregate(P,10,3),withdraw={...completeAggregate(P,20,15).summary[0],direction:'withdraw'};r.summary.push(withdraw);h.L.results=[r];h.L.comparisonStatus='idle';h.c.state.page='providers';h.c.render();
 const groups=[...h.html().matchAll(/<section class="live-reference-direction" data-direction="([^"]+)"[^>]*>([^]*?)<\/section>/g)];assert.equal(groups.length,2);assert.deepEqual(groups.map(x=>x[1]),['charge','withdraw']);
 for(const [,direction,html]of groups){assert.deepEqual([...html.matchAll(/data-metric="([^"]+)"/g)].map(x=>x[1]),['all','success','pending','failed','success_rate','fee'],direction);assert.match(html,/data-metric="fee"[^]*?class="kpi-value">—</);assert.doesNotMatch(html,/NaN|Infinity/)}
 assert.match(groups[0][2],/1,000\.00/);assert.match(groups[1][2],/2,000\.00/);assert.doesNotMatch(h.html(),/3,000\.00|60\.00%/);h.L.direction='charge';h.c.render();assert.equal([...h.html().matchAll(/data-metric=/g)].length,6);assert.doesNotMatch(h.html(),/data-direction="withdraw"/);
});

test('hour by amount matrix preserves one amount band per row, 24 hours and three independent cell values',async()=>{
 const h=await ready(),r=completeAggregate(P,10,3);h.L.results=[r];h.L.direction='charge';h.L.matrixMode='exact';h.c.state.page='matrix';h.c.render();
 const matrices=renderedTables(h.html()).filter(t=>t.headers[0]==='金额 / 时');assert.equal(matrices.length,1);const matrix=matrices[0];assert.equal(matrix.headers.length,25);assert.deepEqual(matrix.headers.slice(1),Array.from({length:24},(_,hour)=>String(hour).padStart(2,'0')+'时'));assert.equal(matrix.rows.length,10);assert.equal(new Set(matrix.rows.map(row=>plain(row[0]))).size,10);
 for(const row of matrix.rows){assert.equal(row.length,25);for(const cell of row.slice(1)){assert.equal([...cell.matchAll(/class="matrix-cell"/g)].length,1);assert.equal([...cell.matchAll(/<b\b/g)].length,1);assert.equal([...cell.matchAll(/<span\b/g)].length,2)}}
 const known=matrix.rows.find(row=>plain(row[0])==='200')[13];assert.match(known,/>10笔<\/b>/);assert.match(known,/>1,000<\/span>/);assert.match(known,/>30\.00%<\/span>/);
});

test('rejected and unknown statuses remain explicit in the reference direction analysis',async()=>{
 const h=await ready(),r=completeAggregate(P,10,3);r.summary=[{...r.summary[0],direction:'withdraw',all_amount:null,pending_count:2,pending_amount:'200',failed_count:1,failed_amount:'100',rejected_count:2,rejected_amount:'240',unknown_count:2,unknown_amount:null,missing_amount_count:1}];h.L.direction='withdraw';h.L.results=[r];h.L.comparisonStatus='idle';h.c.state.page='payout';h.L.view='trend';h.c.render();const table=renderedTables(h.html()).find(t=>t.headers.join('|')==='状态|金额|笔数');assert(table);assert.deepEqual(table.rows.find(r=>plain(r[0])==='拒绝').map(plain),['拒绝','240.00','2']);assert.deepEqual(table.rows.find(r=>plain(r[0])==='未知').map(plain),['未知','—','2']);assert.doesNotMatch(h.html(),/NaN|Infinity/);
});

test('catalog scopes select currency/country/source/platform strictly and query local seconds correctly',async()=>{
 const nepal={...P,id:'22222222-2222-4222-8222-222222222222',timezone:'Asia/Kathmandu',source:'NEW_AR'},usd={...P,id:'33333333-3333-4333-8333-333333333333',currency:'USD',country:'美国',timezone:'America/New_York'};
 const h=await ready({platforms:[P,nepal,usd]});setScope(h,{platform:'all',source:'NEW_AR',direction:'withdraw',status:'pending',provider:'P/Raw',orderNumber:'O/1',memberId:'M1',systemOrderId:'S1'});const before=h.calls.length;await h.c.liveLoad();const q=h.calls.slice(before);assert.equal(q.length,2);assert.equal(q[0].platformId,nepal.id);assert.equal(q[0].startAt,'2026-09-21T18:15:00.000Z');assert.equal(q[0].endAt,'2026-09-22T00:15:00.000Z');assert.equal(q[0].direction,'withdraw');assert.equal(q[0].status,'pending');assert.equal(q[0].providers[0],'P/Raw');assert.equal(q[0].orderNumber,'O/1');assert.equal(q[0].memberId,'M1');assert.equal(q[0].systemOrderId,'S1');assert.equal(q[0].currency,'INR');assert.deepEqual(withoutWindow(q[1]),withoutWindow(q[0]));
 h.c.liveSet('platform',P.id);h.c.liveSet('country','美国');assert.equal(h.L.platform,'all');assert.equal(h.L.page,1);assert.equal(h.L.localPage,1);
});

test('invalid calendar/DST ambiguous or missing local seconds never become plausible timestamps',async()=>{
 for(const [zone,from,to] of [['Asia/Kolkata','2026-02-30T00:00:00','2026-03-01T00:00:00'],['America/New_York','2026-03-08T02:30:00','2026-03-08T03:30:00'],['America/New_York','2026-11-01T01:30:00','2026-11-01T03:30:00'],['Asia/Kolkata','2026-09-01T00:00:00','2026-10-02T23:59:59']]){const h=await ready({platforms:[{...P,timezone:zone}]});setScope(h,{from,to});const n=h.calls.length;await h.c.liveLoad();assert.equal(h.calls.length,n);assert(h.L.error);assert.equal(h.L.results.length,0)}
});

test('money strings aggregate and unknown amounts remain unknown rather than fabricated zero',async()=>{
 const h=await ready();const a=aggregate(),b=aggregate();b.platform={...P,id:'second'};b.summary[0].all_amount=null;b.summary[0].missing_amount_count=1;h.L.results=[a,b];h.c.state.page='providers';h.c.render();const section=h.html().match(/<section class="live-reference-direction" data-direction="charge"[^>]*>([^]*?)<\/section>/)?.[1];assert(section);assert.match(section,/data-metric="all"[^]*?class="kpi-value">—<\/div>[^]*?>10 笔<\/span>/);assert.match(section,/data-metric="success"[^]*?class="kpi-value">1,200\.30<\/div>[^]*?>6 笔<\/span>/);assert.doesNotMatch(h.html(),/NaN|Infinity/);
});

test('all-or-nothing aggregate publication suppresses partial totals after one source fails',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222'},h=await ready({platforms:[P,p2]});setScope(h,{platform:'all'});h.setHandler(async q=>{if(q.platformId===p2.id)throw Error('Synthetic failure');return aggregate(P)});await h.c.liveLoad();assert.equal(h.L.results.length,0);assert.match(h.html(),/Synthetic failure/);assert(!h.html().includes('live-reference-totals'));assert(!h.html().includes('dashboard-full-v3'));
});

test('later aggregate query wins over an earlier request regardless of completion order',async()=>{
 const h=await ready(),old=deferred(),fresh=deferred();let n=0;h.setHandler(()=>++n===1?old.promise:fresh.promise);const a=h.c.liveLoad(),b=h.c.liveLoad();fresh.resolve(aggregate(P,22));await b;old.resolve(aggregate(P,11));await a;assert.equal(h.L.results[0].total,22);assert.equal(h.L.loading,false);
});

test('editing filters invalidates outstanding aggregate results and leaves explicit query state',async()=>{
 const h=await ready(),wait=deferred();h.setHandler(()=>wait.promise);const pending=h.c.liveLoad();h.c.liveSet('provider','new-provider');wait.resolve(aggregate(P,91));await pending;assert.equal(h.L.dirty,true);assert.equal(h.L.results.length,0,'old-scope results must never be committed after a filter edit');assert.match(h.html(),/点击查询/);
});

test('switching to the independent deposit page prevents old aggregate progress/results overwrites',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222'},h=await ready({platforms:[P,p2]}),first=deferred(),second=deferred();let n=0;setScope(h,{platform:'all'});h.setHandler(q=>q.action==='depositIssues'?Promise.resolve({rows:[],total:0,summary:{},facets:{providers:[]}}):(++n===1?first.promise:second.promise));const pending=h.c.liveLoad();h.c.setPage('deposit_tracking');const mark=h.writes.length;first.resolve(aggregate(P));await settle();assert.match(h.html(),/存款未到账明细/);assert.doesNotMatch(h.html(),/INDEPENDENT_SNAPSHOT/);second.resolve(aggregate(p2));await pending;assert(h.writes.slice(mark).filter(x=>x.id==='page').every(x=>!x.html.includes('正式数据读取')));
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

test('unconnected modules preserve reference schemas and local controls without inventing source rows or queries',async()=>{
 const h=await ready(),calls=h.calls.length,expected={dropped:['订单 ID','订单号','平台','三方','方向','掉单金额','掉单笔数'],anomaly:['异常类型','订单 ID','订单号','平台','三方','方向','异常金额','异常笔数'],events:['事件编号','三方','方向','关联金额','关联笔数','处理状态'],rules:['最低订单量','超期账龄','数据不足处理','多项命中处理'],access:['账号','账号标识','角色','团队','商户（平台）范围'],ip:['IP / CIDR','适用入口','适用账号','状态'],login_logs:['账号','登录时间','IP','登录结果','白名单结果','会话状态'],operation_logs:['操作者','操作时间','动作','资源','请求 ID']};
 for(const [page,fields]of Object.entries(expected)){h.c.setPage(page);const html=h.html();assert(html.includes('data-empty-page="'+page+'"'),page);assert.match(html,/未接入/);assert.match(html,/data-empty-field=/);const tables=renderedTables(html),headers=tables.flatMap(t=>t.headers);for(const field of fields)assert(headers.includes(field),page+' preserves '+field);for(const table of tables){assert.equal(table.rows.length,1,page+' only shows the empty row');assert.equal(table.rows[0].length,1,page+' does not fabricate records');assert.match(table.rows[0][0],/未接入/);assert(table.html.includes('colspan="'+table.headers.length+'"'),page+' empty row spans schema')}assert.doesNotMatch(html,/Synthetic provider|order-0|row-0|NaN|Infinity/);assert.equal(h.calls.length,calls,page+' does not query an unrelated order dataset')}
 const empty=h.c.HensemLiveEmpty;const workorders=empty.tab('workorders','orders');for(const field of ['工单 ID','订单号','平台','三方','提交时间／日期','到账确认时间','工单金额','到账状态'])assert(renderedTables(workorders).some(t=>t.headers.includes(field)),field);const role=empty.tab('access','roles');assert.match(role,/页面访问/);assert.match(role,/按钮动作/);assert.match(role,/disabled[^>]*>保存权限|disabled[^]*?保存权限/);empty.search('events',{eventId:'SYNTHETIC-FILTER'});assert.equal(empty.snapshot('events').applied.eventId,'SYNTHETIC-FILTER');assert.equal(empty.snapshot('events').page,1);assert.equal(h.calls.length,calls);
});

test('provider callback keeps quotes and slashes as a single literal value, never executable markup',async()=>{
 const h=await ready(),name='Raw/Pay\'\"<svg onload=alert(1)>';h.L.results[0].groups.provider[0].provider=name;h.c.state.page='providers';h.c.render();const html=h.html();assert(!html.includes('<svg onload'));const attr=html.match(/onclick="(liveProvider\([^]*?\))"/);assert(attr);const decoded=attr[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');let value;vm.runInNewContext(decoded,{liveProvider:v=>value=v});assert.equal(value,name);
});

test('duration bins use contract valid denominators and human time ranges instead of bucket indexes',async()=>{
 const h=await ready();h.c.state.page='latency';h.L.results[0].groups.latency=[{kind:'latency',direction:'charge',currency:'INR',bucket:0,min_ms:null,max_ms:300000,count:2,amount:'100',valid_count:4,valid_amount:'200',count_share:'0.5',amount_share:'0.5'}];h.c.render();assert.match(h.html(),/50\.00%/);assert.match(h.html(),/5\s*分钟|5min|5分/);assert(!h.html().includes('NaN'));
});

test('restored latency page uses real direction cards, complete distributions and local detail tabs without a query',async()=>{
 const h=await ready(),r=completeAggregate(P,10,6),withdraw={...r.summary[0],direction:'withdraw'};r.summary.push(withdraw);r.groups.latency=['charge','withdraw'].flatMap(direction=>Array.from({length:10},(_,bucket)=>({direction,currency:'INR',bucket,count:bucket<2?2:0,amount:bucket<2?'200':'0',valid_count:4,valid_amount:'400'})));r.groups.latency_thresholds=['charge','withdraw'].flatMap(direction=>[300000,1800000,3600000,10800000,21600000,43200000,86400000,172800000,259200000].map((threshold_ms,bucket)=>({direction,currency:'INR',bucket,threshold_ms,count:bucket===0?2:0,amount:bucket===0?'200':'0',valid_count:4,valid_amount:'400'})));h.L.results=[r];h.c.state.page='latency';h.c.render();assert.match(h.html(),/data-duration-page="latency"/);assert.equal([...h.html().matchAll(/class="panel latency-summary"/g)].length,2);const t=renderedTables(h.html()).find(t=>t.headers[0]==='成功耗时区间');assert(t);assert.equal(t.rows.length,10);assert.equal(t.headers.length,9);assert.deepEqual(t.rows[0].map(plain),['≤ 5 分钟','200.00','2','50.00%','50.00%','200.00','2','50.00%','50.00%']);
 const before={calls:h.calls.length,serial:h.L.serial,results:JSON.stringify(h.L.results),direction:h.L.direction,from:h.L.from,to:h.L.to};h.c.liveDurationSet('durationMode','cumulative');const cumulative=renderedTables(h.html()).find(t=>t.headers[0]==='成功耗时阈值');assert.equal(cumulative.rows.length,9);assert.match(h.html(),/行间不相加/);h.c.liveDurationSet('durationGroup','platform');const groups=renderedTables(h.html()).find(t=>t.headers[0]==='平台');assert(groups);assert.equal(groups.rows.length,0);h.c.liveDurationSet('durationDetail','orders');const orders=renderedTables(h.html()).find(t=>t.headers[0]==='订单号');assert(orders);assert.equal(orders.rows.length,0);for(const header of ['系统 ID','平台','三方','方向','提交时间','成功时间','成功耗时'])assert(orders.headers.includes(header));assert.match(h.html(),/尚未提供对应时长条件的逐笔接口/);assert.deepEqual({calls:h.calls.length,serial:h.L.serial,results:JSON.stringify(h.L.results),direction:h.L.direction,from:h.L.from,to:h.L.to},before,'duration tabs only change local presentation');
});

test('restored waiting page conserves known bands plus unknown orders and retains cohort limits',async()=>{
 const h=await ready(),r=completeAggregate(P,10,4);r.summary[0].direction='withdraw';r.groups.pending_age=Array.from({length:10},(_,bucket)=>({direction:'withdraw',currency:'INR',bucket,count:bucket<2?2:0,amount:bucket<2?'200':'0',valid_count:4,valid_amount:'400'}));r.groups.pending_age_thresholds=[300000,1800000,3600000,10800000,21600000,43200000,86400000,172800000,259200000].map((threshold_ms,bucket)=>({direction:'withdraw',currency:'INR',bucket,threshold_ms,count:bucket===0?2:0,amount:bucket===0?'200':'0',valid_count:4,valid_amount:'400'}));h.L.results=[r];h.L.direction='withdraw';h.c.state.page='stuck';h.c.render();assert.match(h.html(),/data-duration-page="stuck"/);for(const name of ['pending-stock','pending-secondary','pending-table','pending-detail'])assert(h.html().includes(name));const t=renderedTables(h.html()).find(t=>t.headers[0]==='已等待时长');assert.equal(t.headers.length,5);assert.equal(t.rows.length,12);const rows=t.rows.map(r=>r.map(plain));assert.deepEqual(rows[10],['等待时间待核对','200.00','2','—','—']);assert.deepEqual(rows[11],['本期仍代付中合计','600.00','6','—','—']);assert.equal(rows.slice(0,11).reduce((n,r)=>n+Number(r[2]),0),Number(rows[11][2]));assert.match(h.html(),/所选创建日期范围/);assert.match(h.html(),/不含窗口外历史积压/);assert.match(h.html(),/非同一冻结快照/);const calls=h.calls.length;h.c.liveDurationSet('durationMode','cumulative');assert.equal(renderedTables(h.html()).find(t=>t.headers[0]==='已等待时长').rows.length,11);h.c.liveDurationSet('durationDetail','orders');const orders=renderedTables(h.html()).find(t=>t.headers[0]==='订单号');assert.equal(orders.rows.length,0);for(const header of ['系统 ID','平台','团队','三方','创建时间','已等待时长'])assert(orders.headers.includes(header));assert.equal(h.calls.length,calls);
});

test('restored duration empty and missing-time states retain layouts without false zero success or quantiles',async()=>{
 const h=await ready();h.L.results=[];for(const page of ['latency','stuck']){h.c.state.page=page;h.L.direction=page==='stuck'?'withdraw':'all';h.c.render();assert(h.html().includes('data-duration-page="'+page+'"'));assert.doesNotMatch(h.html(),/NaN|Infinity|>0\.00%/);const t=renderedTables(h.html()).find(t=>/^成功耗时|已等待/.test(t.headers[0]));assert.equal(t.rows.length,page==='latency'?10:12)}
 const r=completeAggregate(P,10,6);r.groups.latency=[];r.latencySummary=[];h.L.results=[r];h.L.direction='charge';h.c.state.page='latency';h.c.render();assert.match(h.html(),/成功 6 笔/);assert.match(h.html(),/— 时间覆盖/);assert.match(h.html(),/<span>P95 耗时<\/span><strong>—<\/strong>/);const t=renderedTables(h.html()).find(t=>t.headers[0]==='成功耗时区间');assert(t.rows.every(row=>row.slice(1).every(cell=>plain(cell)==='—')));assert.doesNotMatch(h.html(),/0\.00%|NaN|Infinity/);
});

test('split date and second-precision time inputs preserve the unchanged half-open request contract',async()=>{
 const h=await ready();const filters=h.nodes.get('liveFilters').innerHTML;for(const label of ['起始日期','截止日期','起始时间（含秒）','截止时间（含秒）'])assert(filters.includes('aria-label="'+label+'"'));assert.equal([...filters.matchAll(/type="date"/g)].length,2);assert.equal([...filters.matchAll(/type="time" step="1"/g)].length,2);const before=h.calls.length;h.c.liveDateSet('from','date','2026-09-22');h.c.liveDateSet('from','time','01:02:03');h.c.liveDateSet('to','date','2026-09-22');h.c.liveDateSet('to','time','04:05:06');assert.equal(h.calls.length,before,'date editing waits for query');assert.equal(h.L.from,'2026-09-22T01:02:03');assert.equal(h.L.to,'2026-09-22T04:05:06');await h.c.liveLoad();const q=h.calls.slice(before).find(q=>q.action==='aggregate');assert.equal(q.startAt,'2026-09-21T19:32:03.000Z');assert.equal(q.endAt,'2026-09-21T22:35:07.000Z');
});

test('automatic-payout configuration registers once after the deposit snapshot in the merchant center',async()=>{
 const h=await ready(),merchant=h.c.navGroupsV3.find(g=>g[0]==='merchant');assert(merchant);assert.equal(h.c.pages.filter(p=>p[0]==='payout_config').length,1);assert.deepEqual(Array.from(merchant[3]),['merchants','merchantproviders','workorders','deposit_tracking','payout_config','auto_withdraw']);assert.equal(h.c.groupForV3('payout_config')[0],'merchant');assert(!h.c.navGroupsV3.find(g=>g[0]==='analysis')[3].includes('payout_config'));const before=h.calls.length;h.c.setPage('payout_config');await settle();const requests=h.calls.slice(before);assert.deepEqual(requests.map(q=>[q.action,q.operation]),[['payoutConfig','index'],['payoutConfig','snapshot']]);assert.equal(h.c.state.navGroup,'merchant');assert.match(h.nodes.get('nav').innerHTML,/自动出款配置/);assert.match(h.html(),/class="live-payout-config"/);assert.match(h.html(),/SYNTHETIC_CONFIG_PLATFORM/);assert.match(h.html(),/原后台配置 · 只读同步/);assert.match(h.html(),/否（只读）/);assert.match(h.html(),/>0<\/span>/);assert.doesNotMatch(h.html(),/<(?:button|input)[^>]*>保存|onclick="[^"]*(?:save|update|delete)/);assert.equal(h.nodes.get('liveFilters').style.display,'none');
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

test('late sibling completion cannot hide an aggregate error behind progress text',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222'},h=await ready({platforms:[P,p2]}),a=deferred(),b=deferred();setScope(h,{platform:'all'});let n=0;h.setHandler(()=>++n===1?a.promise:b.promise);const request=h.c.liveLoad();a.reject(Error('Synthetic failed source'));await request;assert.match(h.html(),/Synthetic failed source/);b.resolve(aggregate(p2));await settle();assert.match(h.html(),/Synthetic failed source/);assert.equal(h.L.results.length,0);
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

test('aggregate queries split into adjacent six-hour windows and merge full groups with weighted duration denominators',async()=>{
 const h=await ready();setScope(h,{platform:P.id,from:'2026-09-20T12:34:56',to:'2026-09-22T12:34:55'});const seen=[];
 h.setHandler(async q=>{seen.push(q);const i=seen.length,s={...stats(),all_count:10*i,all_amount:String(100*i),success_count:8*i,success_amount:String(80*i),pending_count:2*i,pending_amount:String(20*i),failed_count:0,failed_amount:'0'},r=aggregate();r.total=10*i;r.summary=[s];for(const key of ['provider','daily','hourly','amount','matrix'])r.groups[key]=[{...r.groups[key][0],...s}];for(const key of ['latency','latency_thresholds','pending_age','pending_age_thresholds'])r.groups[key]=[{direction:'charge',currency:'INR',bucket:0,min_ms:null,max_ms:300000,threshold_ms:300000,count:i===1?2:8,amount:i===1?'20':'80',valid_count:i===1?4:16,valid_amount:i===1?'40':'160'}];return r});
 await h.c.liveLoad();assert.equal(h.L.error,'');assert.equal(seen.length,16);assert(seen.every(q=>Date.parse(q.endAt)-Date.parse(q.startAt)===21600000));assert.equal(seen[0].startAt,'2026-09-20T07:04:56.000Z');for(const period of [seen.slice(0,8),seen.slice(8)])for(let i=1;i<period.length;i++)assert.equal(period[i-1].endAt,period[i].startAt);assert.equal(seen[7].endAt,'2026-09-22T07:04:56.000Z');const merged=h.L.results[0];assert.equal(merged._parts.length,8);assert.equal(merged.total,360);assert.equal(merged.summary.length,1);assert.equal(merged.summary[0].all_count,360);assert.equal(Number(merged.summary[0].all_amount),3600);assert.equal(h.L.comparisonResults[0]._parts.length,8);assert.equal(merged.startAt,seen[0].startAt);assert.equal(merged.endAt,seen[7].endAt);assert.equal(h.L.comparisonResults[0].endAt,seen[15].endAt);
 for(const key of ['provider','daily','hourly','amount','matrix']){assert.equal(merged.groups[key].length,1,key);assert.equal(merged.groups[key][0].all_count,360,key);assert.equal(Number(merged.groups[key][0].success_amount),2880,key)}
 for(const key of ['latency','latency_thresholds','pending_age','pending_age_thresholds']){const bin=merged.groups[key][0];assert.equal(bin.count,58,key);assert.equal(bin.valid_count,116,key);assert.equal(Number(bin.amount),580,key);assert.equal(Number(bin.valid_amount),1160,key)}
 h.c.state.page='latency';h.c.render();assert.match(h.html(),/50\.00%/);
});

test('timeout bisection covers the exact interval and stops retrying at or below the one-hour threshold',async()=>{
 const h=await ready();setScope(h,{platform:P.id});const accepted=[],attempts=[];h.setHandler(async q=>{attempts.push(q);if(Date.parse(q.endAt)-Date.parse(q.startAt)>1.5*3600000)throw Error('Synthetic timeout');accepted.push(q);return aggregate(P,5)});await h.c.liveLoad();assert.equal(h.L.error,'');assert.equal(attempts.length,14);assert.equal(accepted.length,8);assert(accepted.every(q=>Date.parse(q.endAt)-Date.parse(q.startAt)===1.5*3600000));for(const period of [accepted.slice(0,4),accepted.slice(4)])for(let i=1;i<period.length;i++)assert.equal(period[i-1].endAt,period[i].startAt);assert.equal(accepted[0].startAt,'2026-09-21T18:30:00.000Z');assert.equal(accepted[3].endAt,'2026-09-22T00:30:00.000Z');assert.equal(h.L.results[0].total,20);assert.equal(h.L.comparisonResults[0].total,20);
 const rejected=[];h.setHandler(async q=>{rejected.push(q);throw Error('Synthetic timeout still pending')});await h.c.liveLoad();assert.equal(rejected.length,4);const widths=rejected.map(q=>Date.parse(q.endAt)-Date.parse(q.startAt));assert(widths.at(-1)<=3600000);assert(widths.at(-2)>3600000);assert.equal(h.L.results.length,0);assert.match(h.L.error,/timeout/);const permanent=[];h.setHandler(async q=>{permanent.push(q);throw Error('Synthetic forbidden')});await h.c.liveLoad();assert.equal(permanent.length,1,'non-timeout errors are never retried by partitioning');
});

test('cross-date detail pages use per-shard counts without missing IDs and reject a changed source count',async()=>{
 const h=await ready();setScope(h,{platform:P.id,from:'2026-09-20T00:00:00',to:'2026-09-21T23:59:59'});h.c.state.page='orders';const olderStart=Date.parse('2026-09-20T12:30:00Z'),newerStart=Date.parse('2026-09-21T12:30:00Z'),detailRequests=[];let changed=false;
 h.setHandler(async q=>{const at=Date.parse(q.startAt),newer=at===newerStart,n=newer?13:at===olderStart?15:0;if(q.action==='aggregate')return aggregate(P,n);detailRequests.push(q);const r=detail(P,n+(changed&&!newer?1:0),q.offset,q.limit);r.rows=r.rows.map((row,i)=>({...row,id:(newer?'newer-':'older-')+(q.offset+i),order_number:'SYNTHETIC-'+(newer?'NEWER-':'OLDER-')+(q.offset+i)}));return r});
 await h.c.liveLoad();assert.equal(h.L.error,'');assert.equal(h.L.detail.total,28);assert.equal(h.L.detail.rows.length,20);const first=Array.from(h.L.detail.rows,r=>r.id);assert.deepEqual(first,[...Array.from({length:13},(_,i)=>'newer-'+i),...Array.from({length:7},(_,i)=>'older-'+i)]);h.c.livePage(2,'server');await settle();const second=Array.from(h.L.detail.rows,r=>r.id);assert.deepEqual(second,Array.from({length:8},(_,i)=>'older-'+(i+7)));assert.equal(new Set([...first,...second]).size,28);assert.equal(h.L.detail.hasMore,false);assert.equal(detailRequests.length,3);assert.deepEqual(detailRequests.map(q=>q.offset),[0,0,7]);assert(detailRequests.every(q=>Date.parse(q.endAt)-Date.parse(q.startAt)===21600000));
 changed=true;h.c.livePage(1,'server');await settle();assert.equal(h.L.detail,null);assert.match(h.L.error,/源订单已更新|同步总数/);assert(!h.html().includes('SYNTHETIC-NEWER-'),'changed source cannot publish a partial page or invented total');
});

test('Dashboard preview grants retain a stable account dependency while reading the latest session',()=>{
 const text=fs.readFileSync(path.join(__dirname,'../src/components/Dashboard.tsx'),'utf8');const start=text.indexOf('const detailedPreviewSessionRef=useRef(session)');assert(start>=0);const block=text.slice(start,text.indexOf('  useEffect(() => {\n    const followPreviewLink',start));assert(block.includes('detailedPreviewSessionRef.current=session'));assert(block.includes('const current=detailedPreviewSessionRef.current'));assert(block.includes('readAdminPreviewAccess(current)'));assert.match(block,/setInterval\(check,60000\)/);const deps=block.match(/\},\s*\[([^\]]*)\]\)/)?.[1];assert(deps);assert(deps.includes('profile?.auth_user_id'));assert(deps.includes('profile?.active'));assert(!/\bsession\b/.test(deps),'session object/token refresh cannot reset the non-Owner grant to false');
});
