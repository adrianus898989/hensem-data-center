/* Synthetic-only VM tests for the production UI adapter. No credentials/network/real orders. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async()=>{for(let n=0;n<6;n++)await flush()};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const P={id:'11111111-1111-4111-8111-111111111111',name:'Synthetic platform',source:'AR',country:'印度',scopeGroup:'india',timezone:'Asia/Kolkata',currency:'INR'};
const stats=(count=5,amount='1000.25')=>({direction:'charge',currency:'INR',all_count:count,all_amount:amount,success_count:3,success_amount:'600.15',pending_count:1,pending_amount:'200.05',failed_count:1,failed_amount:'200.05',rejected_count:0,rejected_amount:'0',unknown_count:0,unknown_amount:'0',missing_amount_count:0});
function aggregate(p=P,count=5){const s=stats(count);return {platform:p,total:count,summary:[s],rows:[],groups:{provider:[{...s,provider:'Synthetic provider'}],daily:[{...s,provider:'Synthetic provider',date:'2026-09-22'}],hourly:[{...s,hour:12}],amount:[{...s,bucket:'200'}],matrix:[{...s,bucket:'200',hour:12}],latency:[],pending_age:[]}}}
function detail(p=P,total=65,offset=0,limit=20){return {platform:p,total,offset,limit,hasMore:offset+limit<total,summary:[],groups:{},rows:Array.from({length:Math.max(0,Math.min(limit,total-offset))},(_,i)=>({id:'row-'+(offset+i),system_order_id:'source-'+(offset+i),order_number:'order-'+(offset+i),third_party_order_number:'third-'+(offset+i),member_id:'member-'+(offset+i),provider:'Synthetic provider',direction:'charge',status:'1',status_group:'success',amount:'200.05',created_at:'2026-09-22T01:02:03Z',success_at:'2026-09-22T01:03:03Z',currency:'INR'}))}}
function harness(options={}){
 const nodes=new Map(),writes=[],calls=[],drawers=[],intervals=[],timers=[],blobs=[];let handler=options.handler;
 function node(id){let html='';const item={id,textContent:'',value:'',title:'',style:{setProperty(k,v){this[k]=v}},classList:{add(){},remove(){}},querySelector:s=>node(id+' '+s),querySelectorAll:()=>[],appendChild(n){if(n.id)nodes.set(n.id,n);return n},after(n){if(n.id)nodes.set(n.id,n)},remove(){nodes.delete(this.id)},setAttribute(){},click(){}};Object.defineProperty(item,'innerHTML',{get:()=>html,set:v=>{html=String(v);writes.push({id,html})}});return item}
 for(const id of ['pageTitle','pageSubtitle','crumbTitle','nav','filters','scope','page','headerActivityV3','.title-actions','.bottom-note','.top-right','.topbar'])nodes.set(id,node(id));
 const keys=['overview','providers','orders','time','amount','matrix','provider_daily','latency','stuck','collection','payout','risk','channelquality','teamops','teamcountries','teamplatforms','merchants','workorders','rates','data_health','deposit_tracking','dropped','anomaly','events','rules','access','ip','login_logs','operation_logs','teams','provider_config','platform_systems','merchantproviders'];
 const pages=keys.map(k=>[k,'',k,'',k]),groups=[['analysis','','数据分析',keys]];
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-09-23T12:00:00Z']))}static now(){return Date.parse('2026-09-23T12:00:00Z')}}
 class TestURL extends URL{static createObjectURL(blob){blobs.push(blob);return 'blob:synthetic'}static revokeObjectURL(){}}
 const context={console,Intl,Date:FixedDate,URL:TestURL,Blob,state:{page:options.page||'overview',navGroup:'analysis'},pages,navGroupsV3:groups,location:{hash:''},
  document:{title:'',body:{classList:{add(){},remove(){}}},getElementById:id=>nodes.get(id)||null,querySelector:selector=>nodes.get(selector)||null,createElement:tag=>node(tag)},
  render(){nodes.get('page').innerHTML='INDEPENDENT_SNAPSHOT'},syncFilters(){},groupForV3:()=>groups[0],toggleCenterV3(){},setPage(){},headerIconV3:()=>'<svg></svg>',openDrawer:(title,html)=>drawers.push({title,html}),toast(){},scrollTo(){},
  setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length},clearInterval(){},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout(){},
  HENSEM_PRODUCTION:options.production!==false,
  hensemLiveRequest:async request=>{calls.push(JSON.parse(JSON.stringify(request)));if(handler)return handler(request);if(request.action==='catalog')return {platforms:options.platforms||[P]};if(request.action==='details')return detail((options.platforms||[P]).find(p=>p.id===request.platformId)||P,65,request.offset,request.limit);if(request.action==='rates')return {rows:[],total:0,options:{countries:[],platforms:[],providers:[]}};return aggregate((options.platforms||[P]).find(p=>p.id===request.platformId)||P,65)}
 };context.window=context;vm.createContext(context);vm.runInContext(source,context,{filename:'live-data.js',timeout:2000});
 return {c:context,L:context.adminLive,calls,writes,nodes,drawers,intervals,timers,blobs,setHandler:fn=>handler=fn,html:()=>nodes.get('page').innerHTML};
}
async function ready(options){const h=harness(options);await settle();if(h.L){h.L.from='2026-09-22T00:00:00';h.L.to='2026-09-22T05:59:59'}return h}
function setScope(h,values={}){Object.assign(h.L,{from:'2026-09-22T00:00:00',to:'2026-09-22T05:59:59',...values})}

test('adapter does nothing outside production and never installs an automatic data refresh',async()=>{
 const offline=await ready({production:false});assert.equal(offline.L,undefined);assert.equal(offline.calls.length,0);
 const h=await ready();assert.equal(h.calls.filter(q=>q.action==='catalog').length,1);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,4);assert.equal(h.intervals.length,0);const n=h.calls.length;h.c.render();h.c.render();await settle();assert.equal(h.calls.length,n);h.c.liveSet('provider','chosen');assert.equal(h.calls.length,n);assert.match(h.html(),/点击查询/);await h.c.liveLoad();assert.equal(h.calls.at(-1).providers[0],'chosen');
});

test('catalog scopes select currency/country/source/platform strictly and query local seconds correctly',async()=>{
 const nepal={...P,id:'22222222-2222-4222-8222-222222222222',timezone:'Asia/Kathmandu',source:'NEW_AR'},usd={...P,id:'33333333-3333-4333-8333-333333333333',currency:'USD',country:'美国',timezone:'America/New_York'};
 const h=await ready({platforms:[P,nepal,usd]});setScope(h,{platform:'all',source:'NEW_AR',direction:'withdraw',status:'pending',provider:'P/Raw',orderNumber:'O/1',memberId:'M1',systemOrderId:'S1'});const before=h.calls.length;await h.c.liveLoad();const q=h.calls.slice(before);assert.equal(q.length,1);assert.equal(q[0].platformId,nepal.id);assert.equal(q[0].startAt,'2026-09-21T18:15:00.000Z');assert.equal(q[0].endAt,'2026-09-22T00:15:00.000Z');assert.equal(q[0].direction,'withdraw');assert.equal(q[0].status,'pending');assert.equal(q[0].providers[0],'P/Raw');assert.equal(q[0].orderNumber,'O/1');assert.equal(q[0].memberId,'M1');assert.equal(q[0].systemOrderId,'S1');assert.equal(q[0].currency,'INR');
 h.c.liveSet('platform',P.id);h.c.liveSet('country','美国');assert.equal(h.L.platform,'all');assert.equal(h.L.page,1);assert.equal(h.L.localPage,1);
});

test('invalid calendar/DST ambiguous or missing local seconds never become plausible timestamps',async()=>{
 for(const [zone,from,to] of [['Asia/Kolkata','2026-02-30T00:00:00','2026-03-01T00:00:00'],['America/New_York','2026-03-08T02:30:00','2026-03-08T03:30:00'],['America/New_York','2026-11-01T01:30:00','2026-11-01T03:30:00'],['Asia/Kolkata','2026-09-01T00:00:00','2026-10-02T23:59:59']]){const h=await ready({platforms:[{...P,timezone:zone}]});setScope(h,{from,to});const n=h.calls.length;await h.c.liveLoad();assert.equal(h.calls.length,n);assert(h.L.error);assert.equal(h.L.results.length,0)}
});

test('money strings aggregate and unknown amounts remain unknown rather than fabricated zero',async()=>{
 const h=await ready();const a=aggregate(),b=aggregate();b.platform={...P,id:'second'};b.summary[0].all_amount=null;b.summary[0].missing_amount_count=1;h.L.results=[a,b];h.c.render();assert.match(h.html(),/全部订单金额[\s\S]*?<strong>—<\/strong>/);assert.match(h.html(),/全部订单笔数[\s\S]*?<strong>10<\/strong>/);assert.match(h.html(),/成功金额[\s\S]*?<strong>1,200\.30<\/strong>/);assert(!h.html().includes('NaN'));assert(!h.html().includes('Infinity'));
});

test('all-or-nothing aggregate publication suppresses partial totals after one source fails',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222'},h=await ready({platforms:[P,p2]});setScope(h,{platform:'all'});h.setHandler(async q=>{if(q.platformId===p2.id)throw Error('Synthetic failure');return aggregate(P)});await h.c.liveLoad();assert.equal(h.L.results.length,0);assert.match(h.html(),/Synthetic failure/);assert(!h.html().includes('全部订单金额'));
});

test('later aggregate query wins over an earlier request regardless of completion order',async()=>{
 const h=await ready(),old=deferred(),fresh=deferred();let n=0;h.setHandler(()=>++n===1?old.promise:fresh.promise);const a=h.c.liveLoad(),b=h.c.liveLoad();fresh.resolve(aggregate(P,22));await b;old.resolve(aggregate(P,11));await a;assert.equal(h.L.results[0].total,22);assert.equal(h.L.loading,false);
});

test('editing filters invalidates outstanding aggregate results and leaves explicit query state',async()=>{
 const h=await ready(),wait=deferred();h.setHandler(()=>wait.promise);const pending=h.c.liveLoad();h.c.liveSet('provider','new-provider');wait.resolve(aggregate(P,91));await pending;assert.equal(h.L.dirty,true);assert.equal(h.L.results.length,0,'old-scope results must never be committed after a filter edit');assert.match(h.html(),/点击查询/);
});

test('switching to the independent deposit page prevents old aggregate progress/results overwrites',async()=>{
 const p2={...P,id:'22222222-2222-4222-8222-222222222222'},h=await ready({platforms:[P,p2]}),first=deferred(),second=deferred();let n=0;setScope(h,{platform:'all'});h.setHandler(()=>++n===1?first.promise:second.promise);const pending=h.c.liveLoad();h.c.setPage('deposit_tracking');const mark=h.writes.length;first.resolve(aggregate(P));await settle();assert.equal(h.html(),'INDEPENDENT_SNAPSHOT');second.resolve(aggregate(p2));await pending;assert(h.writes.slice(mark).filter(x=>x.id==='page').every(x=>!x.html.includes('正式数据读取')));
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
 const h=await ready();setScope(h,{platform:P.id});h.c.state.page='orders';const d=detail(P,1);d.rows[0].third_party_order_number='THIRD/KEEP';d.rows[0].provider='<img src=x onerror=alert(1)>';d.rows[0].order_number='O/RAW';h.L.detail=d;h.c.render();assert.match(h.html(),/THIRD\/KEEP/);assert.match(h.html(),/O\/RAW/);assert.match(h.html(),/>成功<\/span>/);assert(!h.html().includes('<img'));assert(h.html().includes('&lt;img'));h.c.liveOrder(0);assert(h.drawers[0].html.includes('O/RAW'));assert(!h.drawers[0].html.includes('<img'));
});

test('provider callback keeps quotes and slashes as a single literal value, never executable markup',async()=>{
 const h=await ready(),name='Raw/Pay\'\"<svg onload=alert(1)>';h.L.results[0].groups.provider[0].provider=name;h.c.state.page='providers';h.c.render();const html=h.html();assert(!html.includes('<svg onload'));const attr=html.match(/onclick="(liveProvider\([^]*?\))"/);assert(attr);const decoded=attr[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');let value;vm.runInNewContext(decoded,{liveProvider:v=>value=v});assert.equal(value,name);
});

test('duration bins use contract valid denominators and human time ranges instead of bucket indexes',async()=>{
 const h=await ready();h.c.state.page='latency';h.L.results[0].groups.latency=[{kind:'latency',direction:'charge',currency:'INR',bucket:0,min_ms:null,max_ms:300000,count:2,amount:'100',valid_count:4,valid_amount:'200',count_share:'0.5',amount_share:'0.5'}];h.c.render();assert.match(h.html(),/50\.00%/);assert.match(h.html(),/5\s*分钟|5min|5分/);assert(!h.html().includes('NaN'));
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
 await h.c.liveLoad();assert.equal(h.L.error,'');assert.equal(seen.length,8);assert(seen.every(q=>Date.parse(q.endAt)-Date.parse(q.startAt)===21600000));assert.equal(seen[0].startAt,'2026-09-20T07:04:56.000Z');for(let i=1;i<seen.length;i++)assert.equal(seen[i-1].endAt,seen[i].startAt);assert.equal(seen.at(-1).endAt,'2026-09-22T07:04:56.000Z');const merged=h.L.results[0];assert.equal(merged._parts.length,8);assert.equal(merged.total,360);assert.equal(merged.summary.length,1);assert.equal(merged.summary[0].all_count,360);assert.equal(Number(merged.summary[0].all_amount),3600);
 for(const key of ['provider','daily','hourly','amount','matrix']){assert.equal(merged.groups[key].length,1,key);assert.equal(merged.groups[key][0].all_count,360,key);assert.equal(Number(merged.groups[key][0].success_amount),2880,key)}
 for(const key of ['latency','latency_thresholds','pending_age','pending_age_thresholds']){const bin=merged.groups[key][0];assert.equal(bin.count,58,key);assert.equal(bin.valid_count,116,key);assert.equal(Number(bin.amount),580,key);assert.equal(Number(bin.valid_amount),1160,key)}
 h.c.state.page='latency';h.c.render();assert.match(h.html(),/50\.00%/);
});

test('timeout bisection covers the exact interval and stops retrying at or below the one-hour threshold',async()=>{
 const h=await ready();setScope(h,{platform:P.id});const accepted=[],attempts=[];h.setHandler(async q=>{attempts.push(q);if(Date.parse(q.endAt)-Date.parse(q.startAt)>1.5*3600000)throw Error('Synthetic timeout');accepted.push(q);return aggregate(P,5)});await h.c.liveLoad();assert.equal(h.L.error,'');assert.equal(attempts.length,7);assert.equal(accepted.length,4);assert(accepted.every(q=>Date.parse(q.endAt)-Date.parse(q.startAt)===1.5*3600000));for(let i=1;i<accepted.length;i++)assert.equal(accepted[i-1].endAt,accepted[i].startAt);assert.equal(accepted[0].startAt,'2026-09-21T18:30:00.000Z');assert.equal(accepted.at(-1).endAt,'2026-09-22T00:30:00.000Z');assert.equal(h.L.results[0].total,20);
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
