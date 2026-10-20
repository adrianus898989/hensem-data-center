/* Exercise the real read-only page adapter with synthetic platform responses. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const harness=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {ready,completeAggregate,P,settle}=new Function('require','__dirname',harness+';return {ready,completeAggregate,P,settle};')(require,__dirname);
const platforms=Array.from({length:8},(_,i)=>({...P,id:'10000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),name:'PLATFORM-'+(i+1),team:'M8',source:'ar'}));
const section=(h,d='charge')=>h.html().match(new RegExp('<details class="live-platform-coverage" data-platform-coverage="'+d+'">[\\s\\S]*?<\\/details>'))?.[0]||'';
const row=(html,id)=>html.match(new RegExp('<tr data-platform-id="'+id+'"[^>]*>[\\s\\S]*?<\\/tr>'))?.[0]||'';
const sample=(p,charge,withdraw)=>{const r=completeAggregate(p,charge,Math.floor(charge*.5));r.summary=[r.summary[0],{...completeAggregate(p,withdraw,Math.floor(withdraw*.8)).summary[0],direction:'withdraw'}];return r;};
async function fixture(options={}){
 const list=options.platforms||platforms;
 const h=await ready({page:options.page||'matrix',platforms:list,reports:!!options.reports,handler:q=>{
  if(q.action==='catalog')return {platforms:list};if(q.action==='rates')return {rows:[],total:0};if(q.action==='collectedData')return {rows:[]};
  if(q.action==='aggregate'){const index=list.findIndex(p=>p.id===q.platformId),p=list[index];return {...sample(p,index<5?100+index:0,index<2?10+index:0),startAt:q.startAt,endAt:q.endAt};}
  return {rows:[],total:0};
 }});await settle();return h;
}

test('each direction counts only actual positive native results and exposes all eight selected platforms inline',async()=>{
 const h=await fixture(),charge=section(h),withdraw=section(h,'withdraw');
 assert.match(charge,/有数据平台 <strong>5 \/ 8<\/strong>/);assert.match(withdraw,/有数据平台 <strong>2 \/ 8<\/strong>/);
 assert.equal((charge.match(/data-platform-id=/g)||[]).length,8);assert.equal((withdraw.match(/data-platform-id=/g)||[]).length,8);
 assert.match(row(charge,platforms[6].id),/data-coverage-status="empty"/);assert.match(row(charge,platforms[6].id),/已读取无订单记录/);
 assert.match(charge,/不代表采集完整率/);assert.doesNotMatch(charge,/已核实零|确认零|未上线|openDrawer|onclick=/);
 assert.match(charge,/<th scope="col">提交笔数<\/th><th scope="col">成功笔数<\/th>/);
});

test('time and amount pages use the same direction-specific summary slot without extra business reads',async()=>{
 for(const page of ['time','amount']){const h=await fixture({page}),count=h.calls.length;assert.match(section(h),/5 \/ 8/);h.c.render();await settle();assert.equal(h.calls.length,count);assert.match(section(h,'withdraw'),/2 \/ 8/);}
});

test('duplicate returned native IDs are one platform, names alone do not merge distinct native IDs',async()=>{
 const list=platforms.map((p,i)=>({...p,name:i<2?'SAME NAME':p.name})),h=await fixture({platforms:list});
 h.L.results.push(h.L.results[0]);h.c.render();const html=section(h);
 assert.match(html,/5 \/ 8/);assert.equal((html.match(/>SAME NAME<\/td>/g)||[]).length,2);assert.equal((html.match(new RegExp('data-platform-id="'+list[0].id+'"','g'))||[]).length,1);
 assert.match(h.nodes.get('liveFilters').innerHTML,/所选日期有订单数据 5 平台/);
});

test('owner-confirmed RAJA alias selection retains one exact native query identity in the denominator',async()=>{
 const raw={...platforms[0],name:'RAJA',sourceName:'RAJA'},alias={...platforms[1],name:'RAJALOTTERY',sourceName:'RAJALOTTERY'},h=await fixture({platforms:[raw,alias],reports:true});
 assert.match(section(h),/1 \/ 1/);assert.equal((section(h).match(/data-platform-id=/g)||[]).length,1);
 assert(h.calls.filter(q=>q.action==='aggregate').every(q=>q.platformId===raw.id));assert.doesNotMatch(section(h),new RegExp(alias.id));
});

test('dirty filters or a mismatched saved query scope never show stale platform coverage',async()=>{
 const h=await fixture();assert(section(h));h.L.dirty=true;h.c.render();assert.equal(section(h),'');
 h.L.dirty=false;h.L.queryScope='different-native-scope';h.c.render();assert.equal(section(h),'');assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/所选日期有订单数据/);
});

test('failed, paused and unread results stay separate from successfully read empty results',async()=>{
 const h=await fixture();h.L.results=h.L.results.filter(r=>![platforms[0].id,platforms[1].id].includes(r.platform.id));h.L.queryFailures=[{id:platforms[0].id,name:platforms[0].name,message:'synthetic failure'}];h.L.queryPaused=true;h.c.render();let html=section(h);
 assert.match(html,/3 \/ 8/);assert.match(row(html,platforms[0].id),/data-coverage-status="failed"/);assert.match(row(html,platforms[1].id),/data-coverage-status="paused"/);assert.match(row(html,platforms[6].id),/data-coverage-status="empty"/);
 assert.match(row(html,platforms[0].id),/>synthetic failure<\/td>/,'the original failure reason stays visible');
 h.L.queryPaused=false;h.c.render();html=section(h);assert.match(row(html,platforms[1].id),/data-coverage-status="unread"/);
 h.L.queryRetrying=true;h.c.render();assert.match(row(section(h),platforms[1].id),/data-coverage-status="loading"/);
});

test('prepared coverage keeps every unavailable state distinct, preserves reasons and never converts failed reads into zeros',async()=>{
 const h=await fixture(),statuses=['missing','building','stale','unsupported','invalid','failed','future-status'];
 // Even if a prior response remains in memory, its unresolved read takes
 // precedence and cannot contribute its old counts to the current display.
 h.L.queryFailures=statuses.map((status,i)=>({id:platforms[i].id,name:platforms[i].name,status,message:'Original '+status+' <native>'}));
 const before=JSON.stringify(h.L.results),reads=h.calls.length;h.c.render();
 for(const direction of ['charge','withdraw']){
  const html=section(h,direction);assert.match(html,/0 \/ 8/);assert.match(html,/已读取无订单记录 1 · 待读取 \/ 待确认 7/);
  for(const [i,status]of statuses.entries()){
   const rendered=row(html,platforms[i].id);assert.match(rendered,new RegExp('data-coverage-status="'+(status==='future-status'?'failed':status)+'"'));
   assert.match(rendered,new RegExp('Original '+status+' &lt;native&gt;'));assert.match(rendered,/<td>—<\/td><td>—<\/td>/);assert.doesNotMatch(rendered,/<native>|已读取无订单记录/);
   if(status==='invalid')assert.match(rendered,/<td class="live-error">/);
  }
 }
 assert.equal(JSON.stringify(h.L.results),before);await settle();assert.equal(h.calls.length,reads,'status rendering never retries or requests data');
 const css=fs.readFileSync(path.join(__dirname,'../admin-preview/live-platform-coverage.css'),'utf8');assert.match(css,/\[data-coverage-status="failed"\] td:nth-child\(3\)\{color:#b34a43\}/,'ordinary failure keeps the existing red treatment');
});

test('time, amount and matrix share non-failing prepared states after waiting ends, including status fallbacks without a message',async()=>{
 const expected={missing:'统计尚未准备',building:'统计正在准备',stale:'统计已过期'};
 for(const page of ['time','amount','matrix']){
  const h=await fixture({page}),reads=h.calls.length;
  h.L.results=h.L.results.slice(1);h.L.loading=false;h.L.queryRetrying=false;
  for(const [status,label]of Object.entries(expected)){
   h.L.queryFailures=[{id:platforms[0].id,name:platforms[0].name,status}];h.c.render();
   const html=section(h),rendered=row(html,platforms[0].id);assert.match(html,/4 \/ 8/);assert.match(rendered,new RegExp('data-coverage-status="'+status+'"'));assert.match(rendered,new RegExp('>'+label+'</td>'));
   assert.doesNotMatch(rendered,/读取失败|live-error|data-coverage-status="failed"/);assert.match(rendered,/<td>—<\/td><td>—<\/td>/);
   if(page!=='matrix')assert.match(h.html(),/class="live-status" data-aggregate-read-status/,'the reference-page notice also treats this state as pending');
  }
  await settle();assert.equal(h.calls.length,reads);
 }
});

test('an actual platform error keeps its status through the shared query controller without changing successful sibling results',async()=>{
 const h=await fixture(),missing=platforms[0].id;
 h.setHandler(q=>{
  if(q.action==='aggregate'){if(q.platformId===missing)throw Object.assign(Error('该筛选的统计正在准备'),{status:'building'});const i=platforms.findIndex(p=>p.id===q.platformId);return {...sample(platforms[i],i<5?100+i:0,i<2?10+i:0),startAt:q.startAt,endAt:q.endAt};}
  return {rows:[],total:0};
 });
 await h.c.liveQuery(true);await settle();h.L.retainedContent=null;h.c.render();
 assert.equal(h.L.loading,false);assert.equal(h.L.queryFailures.length,1);assert.equal(h.L.queryFailures[0].status,'building');
 assert.match(section(h),/4 \/ 8/);assert.match(row(section(h),missing),/data-coverage-status="building"/);assert.match(row(section(h),missing),/该筛选的统计正在准备/);assert.doesNotMatch(row(section(h),missing),/读取失败/);
 assert.match(row(section(h),platforms[1].id),/<td>101<\/td><td>50<\/td>/);assert.match(row(section(h),platforms[6].id),/data-coverage-status="empty"/);
});

test('unsupported selected directory entries remain in the denominator without masquerading as queried zeros',async()=>{
 const extra={...P,id:'unsupported-platform',name:'DIRECTORY ONLY',country:'印度',source:'not_connected',team:'M8'},h=await fixture({platforms:[...platforms,extra]});
 assert.match(section(h),/5 \/ 9/);assert.match(row(section(h),extra.id),/data-coverage-status="unsupported"/);assert.match(row(section(h),extra.id),/仅目录，未接入订单/);
 assert(!h.calls.some(q=>q.action==='aggregate'&&q.platformId===extra.id));assert.match(row(section(h),extra.id),/<td>—<\/td><td>—<\/td>/);
});

test('a cross-day success is data even without new submissions; null metrics never become a confirmed empty day',async()=>{
 const h=await fixture(),id=platforms[6].id,r=h.L.results.find(r=>r.platform.id===id);r.summary=[{direction:'charge',all_count:0,success_count:2}];h.c.render();assert.match(section(h),/6 \/ 8/);assert.match(row(section(h),id),/data-coverage-status="data"/);
 r.summary=[{direction:'charge',all_count:0,success_count:null}];h.c.render();assert.match(section(h),/5 \/ 8/);assert.match(row(section(h),id),/data-coverage-status="unknown"/);assert.match(row(section(h),id),/<td>0<\/td><td>—<\/td>/);
 r.summary=[];h.c.render();assert.match(row(section(h),id),/已读取无订单记录/);
});

test('unrequested identities and untrusted labels cannot expand the displayed data scope or inject markup',async()=>{
 const list=platforms.map((p,i)=>i===0?{...p,name:'<img src=x onerror=alert(1)>',source:'ar'}:p),h=await fixture({platforms:list});
 h.L.results.push(sample({...P,id:'outside-scope',name:'PRIVATE OUTSIDE'},999,888));h.c.render();const html=section(h);
 assert.match(html,/5 \/ 8/);assert.doesNotMatch(html,/PRIVATE OUTSIDE|outside-scope|<img/);assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('an empty WG withdrawal response never invents an available successful-time count',async()=>{
 const wg={...platforms[0],source:'wg'},h=await fixture({platforms:[wg]}),r=h.L.results[0];
 r.summary=[];h.c.render();let html=section(h,'withdraw');assert.match(html,/0 \/ 1/);assert.match(row(html,wg.id),/data-coverage-status="unknown"/);assert.match(row(html,wg.id),/成功时间未提供/);assert.match(row(html,wg.id),/<td>0<\/td><td>—<\/td>/);assert.doesNotMatch(row(html,wg.id),/已读取无订单记录/);
 r.summary=[{direction:'withdraw',all_count:5,success_count:3}];h.c.render();html=section(h,'withdraw');assert.match(html,/1 \/ 1/);assert.match(row(html,wg.id),/<td>5<\/td><td>—<\/td>/);
 r.summary=undefined;h.c.render();html=section(h,'withdraw');assert.match(row(html,wg.id),/统计待确认/);assert.match(row(html,wg.id),/<td>—<\/td><td>—<\/td>/);
});

test('direction-unavailable metadata is applied to its native platform only',async()=>{
 const h=await fixture(),r=h.L.results[0];r.withdrawSuccessTimeAvailable=false;h.c.render();const html=section(h,'withdraw');
 assert.match(row(html,platforms[0].id),/<td>10<\/td><td>—<\/td>/);assert.match(row(html,platforms[1].id),/<td>11<\/td><td>8<\/td>/);assert.match(html,/2 \/ 8/);
});
