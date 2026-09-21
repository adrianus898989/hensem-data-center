const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {root,loadTs}=require('./load-typescript.cjs');
const pending=loadTs(path.join(root,'src/lib/orderTimePending.ts'));
const selection={country:'印度',platforms:['91CLUB'],channel:'RsPay',types:[],direction:'',basis:'created',start:'2026-09-20T00:00:00',end:'2026-09-20T23:59:59',createdStart:'',createdEnd:''};
const result={selection,payloads:[{id:'91club',payload:{platform:'91CLUB',country:'印度',team:'AR',rows:[{direction:'withdraw',provider:'Rspay',channel_type:'BANK',created_date:'2026-09-20',pending_count:72,pending_amount:246290,success_count:29,success_amount:114595,submitted_count:101}]}}]};
const snapshot=(extra={})=>({schema_version:1,source_system:'WITHDRAW_REVIEW',country_code:'IN',platform:'91CLUB',stat_date:'2026-09-20',timezone:'Asia/Kolkata',snapshot_id:'fixture',snapshot_at:'2026-09-20T18:30:28Z',coverage:{complete:true,expected_count:262,fetched_count:262,unique_count:262},totals:{pending_count:262,pending_amount:812708},groups:[{raw_channel:'Rspay',channel_type:'提现',pending_count:262,pending_amount:812708}],...extra});
test('91CLUB reads the 262-order midnight balance, never the 72-order created-day cohort',()=>{
  const view=pending.timePendingSnapshotView(result,[snapshot()]);
  assert.deepEqual(view.compare().current,{amount:812708,count:262,captured:1,expected:1,state:'complete'});
  assert.equal(view.providers[0].channel,'RsPay');assert.match(view.basisHint,/近 7/);
});
test('multi-day/hour/success filters keep only the end-day closing snapshot and respect platform/provider scope',()=>{
  const earlier=snapshot({stat_date:'2026-09-19'}),other=snapshot({platform:'55CLUB'});
  for(const basis of ['created','success']){
    const r={...result,selection:{...selection,basis,start:'2026-09-14T12:00:00',end:'2026-09-20T13:00:00',types:['BANK'],direction:'代付'}};
    const view=pending.timePendingSnapshotView(r,[snapshot(),earlier,other]);
    assert.equal(view.compare().current.count,262);assert.equal(view.providers.length,1);
  }
  const empty={...result,payloads:[{...result.payloads[0],payload:{...result.payloads[0].payload,rows:[]}}]};
  assert.equal(pending.timePendingSnapshotView(empty,[snapshot()]).providers[0].count,262,'pending-only providers remain visible');
  assert.equal(pending.timePendingSnapshotView({...result,selection:{...selection,channel:'Another'}},[snapshot()]).providers.length,0);
});
test('missing/error/incomplete snapshots are distinct from a verified zero; missing platforms stay partial',()=>{
  assert.equal(pending.timePendingSnapshotView(result,[]).compare().current.state,'missing');
  assert.equal(pending.timePendingSnapshotView(result,[snapshot()],'offline').compare().current.state,'unavailable');
  assert.equal(pending.timePendingSnapshotView(result,[snapshot({coverage:{complete:false}})]).compare().current.state,'missing');
  const zero=snapshot({coverage:{complete:true,expected_count:0,fetched_count:0,unique_count:0},totals:{pending_count:0,pending_amount:0},groups:[]});
  assert.equal(pending.timePendingSnapshotView(result,[zero]).compare().current.state,'zero');
  const all={...result,selection:{...selection,platforms:[],availablePlatforms:['91CLUB','55CLUB']}};
  const metric=pending.timePendingSnapshotView(all,[snapshot()]).compare().current;
  assert.equal(metric.state,'partial');assert.equal(metric.count,262);assert.equal(metric.expected,2);
  assert.deepEqual(pending.timePendingSnapshotView(all,[snapshot()]).missingSnapshotPlatforms,['55CLUB']);
  assert.deepEqual(pending.timePendingSnapshotView(all,[snapshot()],'offline').missingSnapshotPlatforms,[],'an API failure is not evidence a named platform was missed');
});

test('midnight coverage identifies DhaniWin in India and 3PATTI/LG789 in Pakistan independently of order detail coverage',()=>{
  const india={...result,selection:{...selection,platforms:[],availablePlatforms:['91CLUB','DhaniWin']}};
  assert.deepEqual(pending.timePendingSnapshotView(india,[snapshot()]).missingSnapshotPlatforms,['DhaniWin']);
  const pk={...result,selection:{...selection,country:'巴基斯坦',platforms:[],availablePlatforms:['92GAME','3PATISUPER','LG789']},payloads:[]};
  const snap=snapshot({country_code:'PK',platform:'92.GAME'});
  assert.deepEqual(pending.timePendingSnapshotView(pk,[snap]).missingSnapshotPlatforms,['3PATTI-SUPER','LG789']);
});

const text=fs.readFileSync(path.join(root,'src/components/OrderTimeControls.tsx'),'utf8');
const source=ts.createSourceFile('controls.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function compile(name,context){
  const node=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
  const code=ts.transpileModule(node.getText(source),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function('exports',...Object.keys(context),code+`\nreturn ${name};`)({},...Object.values(context));
}
test('snapshot reader requests only the end date using existing authenticated RPC; failures never return empty success',async()=>{
  let response=Response.json({snapshots:[snapshot()]}),request;
  const session={user:{id:'fixture'}};
  const read=compile('readMidnightPending',{dashboardAuthenticatedFetch:async(url,init,auth)=>{request={url,init,auth};return response;}});
  const c=new AbortController();assert.equal((await read(session,'2026-09-20','印度',c.signal)).length,1);
  assert.equal(request.auth,session);assert.equal(request.init.signal,c.signal);
  assert.deepEqual(JSON.parse(request.init.body),{p_start:'2026-09-20',p_end:'2026-09-20',p_country:'印度'});
  assert.match(request.url,/dashboard_withdraw_pending$/);
  for(const value of [Response.json({snapshots:[]},{status:403}),Response.json({rows:[]}),Response.json({error:'x'},{status:500})]){
    response=value;await assert.rejects(()=>read(session,'2026-09-20','印度',c.signal));
  }
});

test('hook rejects stale dates/accounts, cancels old requests, and does not start during a new query',async()=>{
  const cells=[],effects=[],requests=[];let index=0,scheduled=[],dirty=true,current=result,paused=false,identity='a',output;
  const authSession={user:{id:'fixture'}};
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const context={usesMidnightPending:pending.usesMidnightPending,useDashboardAuth:()=>({session:authSession,profile:{identity}}),dashboardScopeIdentity:p=>p.identity,
    useState(initial){const i=index++;if(!(i in cells))cells[i]=initial;return[cells[i],v=>{cells[i]=v;dirty=true;}];},
    useEffect(fn,deps){const i=index++;if(!effects[i]||!same(effects[i].deps,deps))scheduled.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});},
    readMidnightPending(session,date,country,signal){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});requests.push({date,signal,resolve,reject});return promise;}};
  const hook=compile('useMidnightPending',context);
  async function settle(){for(let n=0;n<12;n++){if(dirty){index=0;scheduled=[];dirty=false;output=hook(current,paused);for(const fn of scheduled)fn();}await Promise.resolve();}return output;}
  await settle();const old=requests[0];current={...result,selection:{...selection,end:'2026-09-21T23:59:59'}};dirty=true;await settle();
  assert.equal(old.signal.aborted,true);old.resolve([snapshot()]);assert.equal((await settle()).snapshots.length,0);
  requests[1].resolve([snapshot({stat_date:'2026-09-21'})]);assert.equal((await settle()).snapshots.length,1);
  identity='b';dirty=true;assert.equal((await settle()).snapshots.length,0);
  requests[2].reject(Error('offline'));assert.match((await settle()).error,/暂未载入/);
  paused=true;current={...result};dirty=true;await settle();assert.equal(requests.length,3);
  for(const e of effects)e?.cleanup?.();
});
