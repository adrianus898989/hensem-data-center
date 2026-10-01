/* Synthetic VM only. No credentials, network, database or production orders. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-matrix-custom-range.js'),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve))};
const platform=(id='A',currency='INR',source='ar')=>({id,name:'Platform '+id,currency,source,country:'印度',timezone:'Asia/Kolkata'});
const hour=(extra={})=>({direction:'charge',currency:'INR',hour:1,all_count:4,all_amount:'800',success_count:2,success_amount:'400',...extra});
const result=(id='A',rows=[hour()],extra={})=>({platform:{id},summary:[],groups:{hourly:rows},...extra});
const plain=html=>String(html).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const valid=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
function setup(options={}){
 const root={},calls=[],renders=[];let page='matrix',allowed=true,handler=options.handler,active=0,maxActive=0;
 const platforms=options.platforms||[platform()],L={serial:1,queryScope:'MAIN-SCOPE',queryNow:123,country:'印度',currency:'INR',from:'2026-09-29T00:00:00',to:'2026-09-29T23:59:59',direction:'all',status:'all',pageQueried:true,loading:false,queryRetrying:false,dirty:false,queryPlatforms:platforms,results:[result('MAIN',[hour({all_count:999,all_amount:'123456'})])],...options.L};
 const ctx={L,E:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),N:value=>valid(value)?Number(value).toFixed(2):'—',C:value=>valid(value)?String(Number(value)):'—',R:(n,d)=>valid(n)&&valid(d)&&Number(d)>0?(Number(n)/Number(d)*100).toFixed(2)+'%':'—',
  page:()=>page,allowed:()=>allowed,selected:()=>platforms,render:()=>renders.push(true),successUnavailable:direction=>options.successUnavailable?.(direction)||false,
  analysis:options.analysis,query:(p,action)=>({action,platformId:p.id,startAt:'2026-09-28T18:30:00.000Z',endAt:'2026-09-29T18:30:00.000Z',direction:L.direction,status:L.status,currency:L.currency,providers:['SelectedPay'],offset:80,limit:20,...options.baseRequest}),
  request:async(q,serial)=>{calls.push({q:copy(q),serial});active++;maxActive=Math.max(maxActive,active);try{return handler?await handler(q,serial):result(q.platformId)}finally{active--}}
 };
 vm.runInNewContext(source,{window:root},{filename:'live-matrix-custom-range.js'});const api=root.HensemMatrixCustomRange.create(ctx);
 const set=(min,max)=>{root.liveMatrixAmountSet('min',min);root.liveMatrixAmountSet('max',max)};
 return {root,api,L,calls,renders,platforms,set,query:(form,event)=>root.liveMatrixAmountQuery(form,event),clear:()=>root.liveMatrixAmountClear(),row:direction=>api.row(direction),controls:()=>api.controls(),setHandler:value=>handler=value,setPage:value=>page=value,setAllowed:value=>allowed=value,get maxActive(){return maxActive},get active(){return active}};
}

test('custom ranges include zero and the lower bound but exclude an optional upper bound',async()=>{
 for(const [min,max,expected]of [['200','250',{amountMin:200,amountMax:250,amountMaxExclusive:true}],['0','1',{amountMin:0,amountMax:1,amountMaxExclusive:true}],['','300',{amountMax:300,amountMaxExclusive:true}],['100','',{amountMin:100}],['  ','0',{amountMax:0,amountMaxExclusive:true}],['0.01','10.50',{amountMin:.01,amountMax:10.5,amountMaxExclusive:true}]]){
  const h=setup(),main=copy(h.L.results);h.set(min,max);assert.equal(h.renders.length,0,'draft edits retain focused controls');await h.query();const q=h.calls[0].q;
  assert.deepEqual(Object.fromEntries(Object.entries(q).filter(([key])=>key.startsWith('amount'))),expected);assert.equal(q.action,'aggregate');assert.equal(q.view,'full');assert.equal(q.offset,0);assert.deepEqual(q.providers,['SelectedPay']);assert.equal(q.currency,'INR');assert.equal(h.calls[0].serial,1);assert.deepEqual(h.L.results,main);
  assert.match(h.controls(),/下限含，上限不含/);assert.match(h.row('charge')[0],/金额/);
 }
});

test('invalid, negative, unsafe and reversed ranges reject before issuing any request',async()=>{
 for(const [min,max]of [['',''],['-1','100'],['abc','100'],['Infinity',''],['NaN',''],['9007199254740992',''],['100','99'],['200','200']]){
  const h=setup();h.set(min,max);await h.query();assert.equal(h.calls.length,0,min+'/'+max);assert.match(h.controls(),/role="alert"/);assert.doesNotMatch(h.row('charge').join(''),/NaN|Infinity/);
 }
 const h=setup();h.set('1','2');await h.query({reportValidity:()=>false});assert.equal(h.calls.length,0,'invalid native form cannot issue a request');
});

test('the footer opens a separate editor without increasing row height and submits its current values with exact half-open boundaries',async()=>{
 const amounts=[199.99,200,200.000001,249.999999,250,250.01],h=setup({handler:q=>{
  const selected=amounts.filter(amount=>(q.amountMin===undefined||amount>=q.amountMin)&&(q.amountMax===undefined||(q.amountMaxExclusive?amount<q.amountMax:amount<=q.amountMax)));
  return result('A',[hour({all_count:selected.length,all_amount:selected.reduce((a,b)=>a+b,0),success_count:2,success_amount:400.000001})]);
 }});
 assert.match(h.row('charge')[0],/onclick="liveMatrixAmountEdit\('charge'\)"/);h.root.liveMatrixAmountEdit('charge');
 assert.match(h.row('charge')[0],/aria-expanded="true"/);assert.doesNotMatch(h.row('charge')[0],/<form|<input/);assert.match(h.api.dialog(),/role="dialog"/);assert.match(h.api.dialog(),/name="matrix-min"/);assert.match(h.api.dialog(),/name="matrix-max"/);
 const form={reportValidity:()=>true,elements:{namedItem:name=>({value:name==='matrix-min'?'200':'250'})}};let prevented=false;
 await h.query(form,{key:'Enter',target:{tagName:'INPUT'},preventDefault(){prevented=true}});
 assert(prevented);assert.equal(h.calls.length,1);assert.equal(h.calls[0].q.amountMax,250);assert.equal(h.calls[0].q.amountMaxExclusive,true);
 assert.match(h.row('charge')[0],/200\.00 ≤ 金额 &lt; 250\.00/);assert.equal(plain(h.row('charge')[2]),'3笔 650 66.67%');assert.match(h.row('charge').at(-1),/成功率<\/small><b>66.67%/);
 assert.match(h.row('charge')[0],/aria-expanded="false"/);const saved=h.api.capture();h.clear();h.api.restore(saved);assert.match(h.row('charge')[0],/aria-expanded="false"/);h.root.liveMatrixAmountEdit('charge');assert.match(h.api.dialog(),/value="200"/);assert.match(h.api.dialog(),/value="250"/);assert.equal(h.calls.length,1);
});

test('failed footer queries keep a dialog retry and clear the error after success',async()=>{
 const h=setup({handler:()=>{throw Error('测试读取失败')}});h.root.liveMatrixAmountEdit('charge');h.set('200','250');await h.query();
 assert.match(h.api.dialog(),/测试读取失败/);assert.match(h.api.dialog(),/>重试区间<\/button>/);assert.equal(plain(h.row('charge').at(-1)),'全部笔数 — 笔 全部金额 — 成功笔数 — 笔 成功金额 — 成功率 —');
 h.setHandler(()=>result('A'));await h.query();assert.equal(h.calls.length,2);assert.doesNotMatch(h.row('charge')[0],/测试读取失败|重试区间/);assert.match(h.row('charge').at(-1),/成功率<\/small><b>50.00%/);
});

test('query requires the queried matrix page and its query permission',async()=>{
 for(const flag of ['pageQueried','loading','queryRetrying','dirty']){
  const h=setup();h.set('1','2');h.L[flag]=flag!=='pageQueried';await h.query();assert.equal(h.calls.length,0,flag);
 }
 const denied=setup();denied.set('1','2');denied.setAllowed(false);await denied.query();assert.equal(denied.calls.length,0);
 const other=setup();other.set('1','2');other.setPage('overview');await other.query();assert.equal(other.calls.length,0);
});

test('mixed or mismatched selected currencies reject instead of silently presenting a partial scope',async()=>{
 for(const platforms of [[platform('A'),platform('B','USD')],[platform('A','USD')]]){
  const h=setup({platforms});h.set('1','100');await h.query();assert.equal(h.calls.length,0);assert.match(h.controls(),/同一币种的平台/);assert.match(h.controls(),/disabled/);
 }
});

test('hourly metrics and totals with success rate isolate direction and currency without changing main results',async()=>{
 const h=setup({platforms:[platform('A'),platform('B')],handler:q=>result(q.platformId,[hour(),hour({hour:2,all_count:1,all_amount:'250.50',success_count:1,success_amount:'250.50'}),hour({direction:'withdraw',all_count:3,all_amount:'900',success_count:1,success_amount:'300'}),hour({currency:'USD',all_count:99,all_amount:'9900',success_count:99,success_amount:'9900'})])}),before=copy(h.L.results);
 h.set('200','300');await h.query();assert.deepEqual(h.calls.map(x=>x.q.platformId),['A','B']);const charge=h.row('charge'),withdraw=h.row('withdraw');assert.equal(charge.length,26);
 assert.equal(plain(charge[2]),'8笔 1600 50.00%');assert.equal(plain(charge[3]),'2笔 501 100.00%');assert.equal(plain(charge[1]),'0笔 0 —');
 assert.equal(plain(charge.at(-1)),'全部笔数 10 笔 全部金额 2101.00 成功笔数 6 笔 成功金额 1301.00 成功率 60.00%');assert.equal(plain(withdraw.at(-1)),'全部笔数 6 笔 全部金额 1800.00 成功笔数 2 笔 成功金额 600.00 成功率 33.33%');assert.deepEqual(h.L.results,before);
});

test('missing hourly metrics stay unknown and are never converted to zero',async()=>{
 for(const field of ['all_count','all_amount','success_count','success_amount']){
  const h=setup({handler:()=>result('A',[hour(),hour({hour:2,[field]:null})])});h.set('0','');await h.query();assert.match(h.row('charge').at(-1),/—/);assert.doesNotMatch(h.row('charge').join(''),/NaN|Infinity/);
  const expected={all_count:'全部笔数 — 笔',all_amount:'全部金额 —',success_count:'成功笔数 — 笔',success_amount:'成功笔数 4 笔 成功金额 —'}[field];assert(plain(h.row('charge').at(-1)).includes(expected),field);
 }
});

test('WG withdrawal capability or existing page coverage keeps success unknown, including empty hours',async()=>{
 for(const extra of [{withdrawSuccessTimeAvailable:false},{capabilities:{withdrawSuccessTimeAvailable:false}},{}]){
  const h=setup({platforms:[platform('A','INR','wg')],successUnavailable:direction=>Object.keys(extra).length===0&&direction==='withdraw',handler:()=>result('A',[hour({direction:'withdraw'})],extra)});h.set('0','');await h.query();
  assert.equal(plain(h.row('withdraw').at(-1)),'全部笔数 4 笔 全部金额 800.00 成功笔数 — 笔 成功金额 — 成功率 —');assert.equal(plain(h.row('withdraw')[2]),'4笔 800 —');assert.equal(plain(h.row('withdraw')[1]),'0笔 0 —');
 }
});

test('full aggregate hasMore is accepted and original split parts supply all hourly metrics',async()=>{
 const first=result('A',[hour()],{hasMore:true}),second=result('A',[hour({hour:2,all_count:6,all_amount:'900',success_count:3,success_amount:'500'})],{hasMore:true});
 const h=setup({handler:()=>({...result('A',[],{hasMore:true}),_parts:[first,second]})});h.set('0','1000');await h.query();assert.equal(plain(h.row('charge').at(-1)),'全部笔数 10 笔 全部金额 1700.00 成功笔数 5 笔 成功金额 900.00 成功率 50.00%');assert.doesNotMatch(h.controls(),/role="alert"/);
});

test('missing hourly, summary or explicitly incomplete original parts fail instead of showing zero',async()=>{
 for(const invalid of [{summary:[],groups:{}},{groups:{hourly:[]}},{summary:[],groups:{hourly:[]},complete:false}]){
  const h=setup({handler:()=>({...result(),_parts:[result(),invalid]})});h.set('0','');await h.query();assert.match(h.controls(),/小时汇总未完整返回/);assert.equal(plain(h.row('charge').at(-1)),'全部笔数 — 笔 全部金额 — 成功笔数 — 笔 成功金额 — 成功率 —');
 }
 const mismatch=setup({handler:()=>result('UNREQUESTED')});mismatch.set('0','');await mismatch.query();assert.match(mismatch.controls(),/平台返回不匹配/);
});

test('invalid hours reject the whole platform rather than silently omitting malformed facts',async()=>{
 for(const value of [null,undefined,'',-1,24,1.5,'invalid',Infinity]){
  const h=setup({handler:()=>result('A',[hour(),hour({hour:value,all_count:123})])});h.set('0','');await h.query();
  assert.match(h.controls(),/小时汇总未完整返回/);assert.equal(plain(h.row('charge').at(-1)),'全部笔数 — 笔 全部金额 — 成功笔数 — 笔 成功金额 — 成功率 —');assert.doesNotMatch(h.row('charge').join(''),/123笔/);
 }
});

test('empty or malformed split parts and top-level incomplete aggregates explicitly fail',async()=>{
 for(const extra of [{_parts:[]},{_parts:{}},{_parts:null},{complete:false},{complete:false,_parts:[result()]}]){
  const h=setup({handler:()=>result('A',[hour()],extra)});h.set('0','');await h.query();assert.match(h.controls(),/role="alert"/);assert.match(h.controls(),/小时汇总未完整返回|平台返回不匹配/);
  assert.equal(plain(h.row('charge').at(-1)),'全部笔数 — 笔 全部金额 — 成功笔数 — 笔 成功金额 — 成功率 —');assert.equal(h.api.capture().results.size,0,'malformed aggregate is never retained as a zero result');
 }
});

test('only two platform requests run concurrently and partial results never expose a complete success rate',async()=>{
 const pending=new Map(),h=setup({platforms:['A','B','C','D','E'].map(id=>platform(id)),handler:q=>{const task=deferred();pending.set(q.platformId,task);return task.promise}});h.set('0','');const task=h.query();await settle();assert.equal(h.calls.length,2);assert.equal(h.active,2);
 pending.get('A').resolve(result('A'));await settle();assert.equal(h.calls.length,3);assert.equal(h.active,2);assert.equal(plain(h.row('charge')[2]),'4笔 800 —');assert.match(h.row('charge')[0],/读取 1\/5 平台/);
 pending.get('B').resolve(result('B'));await settle();pending.get('C').resolve(result('C'));await settle();pending.get('D').resolve(result('D'));pending.get('E').resolve(result('E'));await task;
 assert.equal(h.maxActive,2);assert.equal(plain(h.row('charge').at(-1)),'全部笔数 20 笔 全部金额 4000.00 成功笔数 10 笔 成功金额 2000.00 成功率 50.00%');assert.equal(plain(h.row('charge')[2]),'20笔 4000 50.00%');
});

test('clearing an in-flight query suppresses its late result and old queued requests',async()=>{
 const old=deferred(),fresh=deferred(),h=setup({platforms:['A','B','C'].map(id=>platform(id)),handler:q=>q.amountMin===1?old.promise:fresh.promise});h.set('1','2');const a=h.query();await settle();assert.equal(h.calls.length,2);h.clear();h.set('100','200');const b=h.query();await settle();assert.equal(h.calls.length,2,'replacement waits for occupied transport slots');
 old.resolve(result('A',[hour({all_count:99})]));await settle();assert.equal(h.calls.filter(x=>x.q.amountMin===1).length,2,'old queued platform C was never requested');assert.equal(h.maxActive,2);
 fresh.resolve({summary:[],groups:{hourly:[hour({all_count:7,all_amount:'700',success_count:1,success_amount:'100'})]}});await Promise.all([a,b]);assert.equal(h.maxActive,2);assert.equal(plain(h.row('charge').at(-1)),'全部笔数 21 笔 全部金额 2100.00 成功笔数 3 笔 成功金额 300.00 成功率 14.29%');assert.doesNotMatch(h.row('charge').join(''),/99笔/);
});

test('capture and restore preserve the independent interval while main-query serial changes invalidate it',async()=>{
 const h=setup();h.set('200','300');await h.query();const saved=h.api.capture(),before=h.row('charge').join('');h.clear();assert.match(h.row('charge')[0],/点击设置区间/);h.L.serial++;h.api.restore(saved);assert.equal(h.row('charge').join(''),before);assert.match(h.controls(),/value="200"/);assert.match(h.controls(),/value="300"/);assert.equal(h.calls.length,1);
 h.L.serial++;assert.match(h.row('charge')[0],/点击设置区间/);assert.equal(plain(h.row('charge').at(-1)),'全部笔数 — 笔 全部金额 — 成功笔数 — 笔 成功金额 — 成功率 —');assert.match(h.controls(),/value="200"/,'new main query preserves draft but invalidates old statistics');
});

test('late response after a main-query serial change cannot repopulate the cleared interval',async()=>{
 const pending=deferred(),h=setup({handler:()=>pending.promise});h.set('0','10');const task=h.query();await settle();h.L.serial++;h.controls();pending.resolve(result('A',[hour({all_count:999})]));await task;assert.match(h.row('charge')[0],/点击设置区间/);assert.doesNotMatch(h.row('charge').join(''),/999笔/);
});

test('amount analysis runs an independent interval and supplies exact local platform details',async()=>{
 const configs=[],h=setup({analysis:{table:config=>{configs.push(config);return '<div>custom summary</div>'}},handler:q=>({...result(q.platformId),platform:platform(q.platformId)})});h.setPage('amount');const before=copy(h.L.results);h.set('200','250');await h.query();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].q.view,'full');assert.deepEqual(h.L.results,before);assert.match(h.api.pageControls('amount'),/最低金额（含）|custom summary/);
 const config=configs.at(-1),segment=config.segment(config.rows[0]);assert.deepEqual(copy(segment),{kind:'custom',direction:'charge',amountMin:200,amountMax:250,amountMaxExclusive:true,placement:'analysis-custom-amount'});assert.equal(h.api.detailRows(segment)[0].all_count,4);assert.equal(h.api.detailRows({...segment,amountMax:251}).length,0,'another interval cannot borrow current custom values');
});

test('time custom controls include their lower hour and exclude the upper hour without new requests',()=>{
 const configs=[],source={...result('A',[hour({hour:1,all_count:10}),hour({hour:2,all_count:20}),hour({hour:3,all_count:30}),hour({hour:4,all_count:40}),hour({hour:2,direction:'withdraw',all_count:90}),hour({hour:2,currency:'USD',all_count:200})]),platform:platform()},h=setup({L:{results:[source]},analysis:{table:config=>{configs.push(config);return '<div>hour summary</div>'}}});h.setPage('time');const before=copy(h.L.results);
 assert.match(h.api.pageControls('time'),/自定义时段/);h.root.liveAnalysisHourSet('hourMin','2');h.root.liveAnalysisHourSet('hourMax','4');assert.equal(configs.length,0,'draft selection does not apply itself');h.root.liveAnalysisHourQuery();assert.match(h.api.pageControls('time'),/hour summary/);assert.equal(h.calls.length,0);assert.deepEqual(h.L.results,before);
 const config=configs.at(-1),charge=config.rows.find(row=>row.direction==='charge'),selected=config.segment(charge);assert.deepEqual(copy(selected.hourRange),{minHour:2,maxHour:4});assert.equal(charge.all_count,50);assert.equal(h.api.detailRows(selected)[0].all_count,50);assert.equal(config.rows.find(row=>row.direction==='withdraw').all_count,90);assert.equal(h.api.customResults(selected).complete,true);
 const saved=h.api.capture();h.api.restore(saved);assert.match(h.api.pageControls('time'),/hour summary/);assert.equal(h.calls.length,0);h.root.liveAnalysisHourClear();assert.doesNotMatch(h.api.pageControls('time'),/hour summary/);
});

test('invalid or unauthorized time queries cannot apply a range and partial scopes suppress the rate',()=>{
 for(const [min,max]of [['','3'],['-1','3'],['3','3'],['4','2'],['0','25'],['1.5','3'],['bad','3']]){const h=setup();h.setPage('time');h.root.liveAnalysisHourSet('hourMin',min);h.root.liveAnalysisHourSet('hourMax',max);h.root.liveAnalysisHourQuery();assert.match(h.api.pageControls('time'),/请选择有效时段/);assert.equal(h.calls.length,0)}
 const configs=[],h=setup({L:{queryFailures:[{id:'B'}],results:[{...result(),platform:platform()}]},analysis:{table:config=>{configs.push(config);return 'partial';}}});h.setPage('time');h.setAllowed(false);h.root.liveAnalysisHourQuery();h.api.pageControls('time');assert.equal(configs.length,0);h.setAllowed(true);h.root.liveAnalysisHourQuery();h.api.pageControls('time');const config=configs.at(-1),row=config.rows[0];assert.equal(config.cells(row).at(-1),'—');assert.equal(h.api.customResults(config.segment(row)).complete,false);
});
