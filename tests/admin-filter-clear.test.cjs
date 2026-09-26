/* Clear-filter interactions use the production controls and adapter with synthetic data only. */
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

const controls=require('../admin-preview/live-filter-controls.js');
const clearButtons=html=>[...html.matchAll(/<button[^>]*class="live-multi-clear"[^>]*>/g)].map(m=>m[0]);
const event=()=>({prevented:0,stopped:0,preventDefault(){this.prevented++},stopPropagation(){this.stopped++}});

test('only selected optional filters expose a named keyboard-accessible clear button outside summary',()=>{
 const base={key:'provider',label:'三方',items:[['ONE','One provider'],['TWO','Two provider']]};
 for(const values of [[],[''],['all']])assert.equal(clearButtons(controls.multi({...base,values})).length,0);
 for(const values of [['ONE'],['ONE','TWO'],['removed-but-selected']]){const html=controls.multi({...base,values});assert.equal(clearButtons(html).length,1);assert.match(clearButtons(html)[0],/type="button"/);assert.match(clearButtons(html)[0],/aria-label="清除三方筛选，恢复全部"/);assert.doesNotMatch(html.match(/<summary[^]*?<\/summary>/)[0],/<button/);assert(html.indexOf('class="live-multi-clear"')>html.indexOf('</details>'),'the button remains visible when the dropdown is closed');}
 assert.equal(clearButtons(controls.multi({...base,values:['ONE'],single:true})).length,0);
 assert.equal(clearButtons(controls.multi({...base,values:['ONE'],clearable:false})).length,0);
});

test('clear click prevents dropdown activation and returns focus to its summary',()=>{
 const context={document:{querySelector:selector=>{assert.equal(selector,'details[data-multi="provider"] summary');return {focus(){focused++}}}}};context.window=context;let focused=0,cleared=[];vm.runInNewContext(layoutSources.find(m=>m.name==='live-filter-controls.js').source,context);const e=event();context.HensemLiveFilters.clear(e,'provider',key=>cleared.push(key));assert.equal(e.prevented,1);assert.equal(e.stopped,1);assert.deepEqual(cleared,['provider']);assert.equal(focused,1);
});

test('clearing any optional global selection preserves all other filters and waits for manual data query',async()=>{
 const h=await ready({platforms:[{...P,team:'M8'}]});
 for(const key of ['team','platform','source','provider','direction']){
  const original={team:['M8'],platform:[P.id],source:['AR'],provider:['ONE','TWO'],direction:['charge']};h.L.multi=structuredClone(original);Object.assign(h.L,{team:'M8',platform:P.id,source:'AR',provider:'',direction:'charge',country:'印度',openMulti:key,dirty:false});h.L.multiSearch[key]='search text';h.c.state.page='overview';h.c.render();const before=h.calls.length,from=h.L.from,to=h.L.to,e=event();
  h.c.HensemLiveFilters.clear(e,key,h.c.liveMultiClear);await settle();
  assert.deepEqual(Array.from(h.L.multi[key]),[]);assert.equal(h.L[key],key==='provider'?'':'all');for(const other of Object.keys(original).filter(name=>name!==key))assert.deepEqual(Array.from(h.L.multi[other]),original[other],key+' must preserve '+other);
  assert.equal(h.L.country,'印度');assert.equal(h.L.from,from);assert.equal(h.L.to,to);assert.equal(h.L.openMulti,'');assert.equal(h.L.multiSearch[key],'');assert.equal(h.L.dirty,true);assert.match(h.html(),/点击查询/);
  assert(h.calls.slice(before).every(q=>q.action==='providerOptions'),'only existing lightweight option metadata may refresh; business data waits for Query');
  const filter=h.nodes.get('liveFilters').innerHTML.match(new RegExp('<div class="live-field live-multi [^]*?data-multi="'+key+'"[^]*?</details>([^]*?)</div>'));
  assert(filter);assert.doesNotMatch(filter[1],/live-multi-clear/);
 }
});

test('country, required order platform and pinned payout direction cannot be cleared',async()=>{
 const h=await ready();h.L.platform=P.id;h.L.multi.platform=[P.id];h.c.state.page='orders';h.c.render();const from=h.L.from,country=h.L.country,before=h.calls.length;
 h.c.liveMultiClear('country');h.c.liveMultiClear('platform');assert.equal(h.L.country,country);assert.equal(h.L.platform,P.id);assert.equal(h.L.from,from);assert.equal(h.calls.length,before);
 const html=h.nodes.get('liveFilters').innerHTML;assert.match(html,/<select required aria-required="true" id="live-country"/);assert.doesNotMatch(html,/aria-label="清除国家/);assert.doesNotMatch(html,/aria-label="清除商户（平台，必选一个）/);
 h.c.state.page='stuck';h.L.direction='withdraw';h.L.multi.direction=['withdraw'];h.c.render();h.c.liveMultiClear('direction');assert.equal(h.L.direction,'withdraw');assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/aria-label="清除业务方向/);
});

test('automatic-withdrawal platform clear shares the control and never starts a data read',async()=>{
 const h=await ready({page:'auto_withdraw'});h.c.withdrawSetMultiOption('withdrawPlatform',{checked:true,value:'ONE'});h.c.withdrawMultiOpen('withdrawPlatform',true);h.c.withdrawMultiSearch('withdrawPlatform','one');h.c.render();assert.match(h.html(),/class="live-multi-clear"/);assert.match(h.html(),/withdrawMultiClear/);const before=h.calls.length,e=event();h.c.HensemLiveFilters.clear(e,'withdrawPlatform',h.c.withdrawMultiClear);await settle();assert.equal(h.calls.length,before);assert.match(h.html(),/点击查询/);assert.doesNotMatch(h.html(),/class="live-multi-clear"/);assert.doesNotMatch(h.html(),/data-multi="withdrawPlatform" open|value="one"/);
});
