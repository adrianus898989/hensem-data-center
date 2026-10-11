// Production modules + a minimal synthetic DOM. No I/O to any live service.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
let prefix=fs.readFileSync(path.join(root,'tests/admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const boot='  if(isSupervisorPage(state.page))render();else initializeLiveData();';
prefix=prefix.replace('vm.runInContext(source,context,','vm.runInContext(source.replace('+JSON.stringify(boot)+','+JSON.stringify(' window.__historyTest={readAggregate,aggregateReadStatus};\n'+boot)+'),context,');
const {ready,completeAggregate,aggregate,P,settle,deferred}=new Function('require','__dirname',prefix+';return {ready,completeAggregate,aggregate,P,settle,deferred};')(require,path.join(root,'tests'));
const Q={...P,id:'22222222-2222-4222-8222-222222222222',name:'Large <unread> platform'};
const queries=h=>h.calls.filter(q=>q.action==='aggregate');
function request(p=P,extra={}){return {action:'aggregate',view:'providers',platformId:p.id,startAt:'2026-10-07T18:30:00.000Z',endAt:'2026-10-08T18:30:00.000Z',direction:'all',status:'all',currency:'INR',offset:0,limit:20,...extra};}
const response=(q,p=P,count=1)=>({...completeAggregate(p,count,count),startAt:q.startAt,endAt:q.endAt});
const card=(html,id)=>html.slice(html.indexOf('<section class="df-card" id="df-'+id+'">'),html.indexOf('<div class="df-workorder-ranks',html.indexOf('<section class="df-card" id="df-'+id+'">')));

test('small returned platform remains explicitly a subtotal while larger platform is pending; missing direction is not zero',async()=>{
 const h=await ready({platforms:[P,Q]}),wait=deferred();
 h.setHandler(q=>q.action==='aggregate'?(q.platformId===P.id?response(q,P,5):wait.promise):aggregate());
 const run=h.c.liveQuery();await settle();
 assert.equal(h.L.results.length,1);assert.equal(h.L.loading,true);
 assert.match(h.L.progress,/完整返回 1 \/ 2/);
 const html=h.html(),collect=card(html,'collect'),payout=card(html,'payout');
 assert.match(html,/非完整总计：当前仅为已读小计/);
 assert.match(html,/Large &lt;unread&gt; platform：等待或正在读取/);
 assert.match(collect,/经营已读小计（非完整总计）/);
 assert.match(collect,/全部金额 \/ 笔数 · 已读小计/);
 assert.match(payout,/<strong class="metric-link">—<\/strong>/);
 assert.doesNotMatch(payout,/<strong class="metric-link">0(?:\.00)?<\/strong>/);
 wait.resolve(response(request(Q),Q,20));await run;await settle();
 assert.equal(h.L.results.length,2);assert.equal(h.c.__historyTest.aggregateReadStatus().incomplete,false);
 assert.doesNotMatch(h.html(),/经营已读小计|非完整总计：当前仅为已读小计/);
});

test('failed platform is listed by name and retry preserves successful results without rereading them',async()=>{
 const h=await ready({platforms:[P,Q]});
 h.setHandler(q=>{if(q.action==='aggregate'&&q.platformId===Q.id)throw Error('Synthetic offline');return response(q,P,5)});
 await h.c.liveQuery();
 assert.match(h.html(),/Large &lt;unread&gt; platform：Synthetic offline/);
 assert.match(h.html(),/onclick="liveRetryFailed\(false\)">重试未完成平台/);
 assert.match(h.L.progress,/完整返回 1 \/ 2 个平台，失败 1 个；已处理 2 个/);
 const calls=queries(h).length,kept=h.L.results[0];
 h.setHandler(q=>response(q,Q,20));await h.c.liveRetryFailed();
 assert.equal(queries(h).length,calls+1);assert.equal(queries(h).at(-1).platformId,Q.id);
 assert.equal(h.L.results[0],kept);assert.equal(h.L.queryFailures.length,0);
 assert.equal(h.c.__historyTest.aggregateReadStatus().incomplete,false);
 assert.doesNotMatch(h.html(),/非完整总计：当前仅为已读小计/);
});

test('a confirmed complete empty day may be zero, unlike an unread platform',async()=>{
 const h=await ready({platforms:[P]});h.setHandler(q=>({...response(q,P,0),summary:[],groups:{provider:[]}}));
 await h.c.liveQuery();assert.equal(h.c.__historyTest.aggregateReadStatus().incomplete,false);
 assert.doesNotMatch(h.html(),/非完整总计/);assert.match(card(h.html(),'collect'),/<strong class="metric-link">0\.00<\/strong>/);
});

test('only a timed-out AR overview switches directly to bounded hourly windows, preserving half-open endpoints and filters',async()=>{
 const h=await ready();let first=true;
 h.setHandler(q=>{if(first){first=false;throw Error('查询超时 57014')}return response(q)});
 const q=request(P,{providers:['Synthetic'],memberId:'M',amountMin:-2000,amountMax:12345}),result=await h.c.__historyTest.readAggregate(q,h.L.serial,false);
 const list=queries(h);assert.equal(list.length,25);assert.equal(result.total,24);assert.equal(result._parts.length,24);
 assert.equal(list[1].startAt,q.startAt);assert.equal(list.at(-1).endAt,q.endAt);
 for(let i=1;i<list.length;i++){
  assert.equal(Date.parse(list[i].endAt)-Date.parse(list[i].startAt),3600000);
  if(i>1)assert.equal(list[i].startAt,list[i-1].endAt);
  for(const key of ['providers','memberId','amountMin','amountMax','direction','status','currency'])assert.deepEqual(list[i][key],q[key]);
 }
 assert.equal(h.L.results.length,0,'partial subwindows never publish a whole-platform success');
});

test('failure of an hourly fallback stops after at most initial + first leaf; no endless subdivision',async()=>{
 const h=await ready();h.setHandler(()=>{throw Error('读取超时')});
 await assert.rejects(h.c.__historyTest.readAggregate(request(),h.L.serial,false),/超时/);
 assert.equal(queries(h).length,2);assert.equal(h.L.results.length,0);
});

test('navigation during a fallback leaf cancels further reads and cannot publish partial results',async()=>{
 const h=await ready(),wait=deferred();let reads=0;
 h.setHandler(q=>{if(++reads===1)throw Error('读取超时');return wait.promise});
 const run=h.c.__historyTest.readAggregate(request(),h.L.serial,false);await settle();
 assert.equal(reads,2);h.c.setPage('time');wait.resolve(response(request()));
 await assert.rejects(run,/替换/);assert.equal(reads,2);assert.equal(h.L.results.length,0);
});

test('fast full-day AR remains one request; non-AR overview keeps its existing timeout policy',async()=>{
 const h=await ready();h.setHandler(q=>response(q));await h.c.__historyTest.readAggregate(request(),h.L.serial,false);assert.equal(queries(h).length,1);
 const other={...P,source:'newar'},b=await ready({platforms:[other]});b.setHandler(()=>{throw Error('读取超时')});
 await assert.rejects(b.c.__historyTest.readAggregate(request(other),b.L.serial,false),/超时/);
 assert.equal(queries(b).length,4);assert.equal(Date.parse(queries(b).at(-1).endAt)-Date.parse(queries(b).at(-1).startAt),3*3600000);
});

test('partial overview platform tables and footer labels do not advertise a full total',async()=>{
 const h=await ready({platforms:[P,Q]}),wait=deferred();h.setHandler(q=>q.action==='aggregate'?(q.platformId===P.id?response(q):wait.promise):aggregate());
 const run=h.c.liveQuery();await settle();assert.match(h.html(),/代收已读小计（非完整总计）/);assert.match(h.html(),/平台经营汇总 · 代收 · 已读平台/);
 wait.resolve(response(request(Q),Q));await run;
});

test('eight timed-out days are bounded to 200 sequential calls with 192 contiguous hourly leaves and unchanged signed net amounts',async()=>{
 const h=await ready();let active=0,maxActive=0;
 h.setHandler(async q=>{
  active++;maxActive=Math.max(maxActive,active);
  try{
   if(Date.parse(q.endAt)-Date.parse(q.startAt)>3600000)throw Error('读取超时');
   const result=response(q);result.summary[0].all_amount='-1760.80';result.summary[0].success_amount='-1760.80';return result;
  }finally{active--;}
 });
 const q=request(P,{startAt:'2026-09-30T18:30:00.000Z'}),result=await h.c.__historyTest.readAggregate(q,h.L.serial,false);
 assert.equal(queries(h).length,200);assert.equal(maxActive,1);assert.equal(result._parts.length,192);
 assert.equal(result._parts[0].startAt,q.startAt);assert.equal(result._parts.at(-1).endAt,q.endAt);
 for(let i=1;i<result._parts.length;i++)assert.equal(result._parts[i].startAt,result._parts[i-1].endAt);
 assert(Math.abs(Number(result.summary[0].all_amount)-(-1760.80*192))<0.0001);
 assert.equal(result.summary[0].all_amount,result.summary[0].success_amount);
});

test('fractional final hour is preserved exactly and a short window failure is not retried automatically',async()=>{
 const h=await ready();h.setHandler(q=>{if(Date.parse(q.endAt)-Date.parse(q.startAt)>3600000)throw Error('读取超时');return response(q)});
 const q=request(P,{endAt:'2026-10-07T21:42:17.000Z'}),result=await h.c.__historyTest.readAggregate(q,h.L.serial,false);
 assert.equal(queries(h).length,5);assert.equal(result._parts.length,4);assert.equal(result._parts.at(-1).endAt,q.endAt);
 assert.equal(Date.parse(result._parts.at(-1).endAt)-Date.parse(result._parts.at(-1).startAt),737000);
 const b=await ready();b.setHandler(()=>{throw Error('读取超时')});
 await assert.rejects(b.c.__historyTest.readAggregate(request(P,{endAt:'2026-10-07T19:00:00.000Z'}),b.L.serial,false),/超时/);
 assert.equal(queries(b).length,1);
});
