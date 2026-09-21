const assert=require('node:assert/strict'),test=require('node:test');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {loadTs,root}=require('./load-typescript.cjs');
const volume=loadTs(path.join(root,'src/lib/orderTimeVolume.ts'));
const daily=loadTs(path.join(root,'src/lib/orderTimeDaily.ts'));
const comparison=loadTs(path.join(root,'src/lib/orderTimeComparison.ts'));
const {collectionSuccessProviderKey:key}=loadTs(path.join(root,'src/lib/collectionSuccess.ts'));
const selection={country:'巴基斯坦',platforms:[],availablePlatforms:['92GAME','3PATISUPER','3PATTI-SUPER','92BLAZE'],
  start:'2026-09-20T00:00:00',end:'2026-09-20T23:59:59',basis:'created',createdStart:'',createdEnd:'',channel:'',types:[],direction:''};
const row=(overrides={})=>({id:'legacy',date:'2026-09-20',country:'巴基斯坦',platform:'3PATTI-SUPER',channel:'TestPay',rawChannel:'TestPay',
  channelType:'EASYPAISA',direction:'代收',amount:673300,count:300,...overrides});
const fixture=(extra={})=>({selection,payloads:[{id:'ar:92',payload:{platform:'92.GAME',country:'巴基斯坦',timezone:'Asia/Karachi',rows:[
  {direction:'charge',provider:'TestPay',channel_type:'EASYPAISA',created_date:'2026-09-20',submitted_count:2204,success_count:1167,success_amount:1485056},
  {direction:'withdraw',provider:'TestPay',channel_type:'BANK',created_date:'2026-09-20',submitted_count:586,success_count:520,success_amount:1970773,actual_amount:1970773,withdraw_fee:0,pending_count:2,pending_amount:300}
]} }],dailyRows:[row(),row({id:'payout',direction:'代付',amount:505835,count:77})],...extra});

test('daily-only 3PATTI adds 300/673300 and 77/505835 once; aliases do not create another platform',()=>{
  const result=fixture(),data=volume.timeVolumeData(result),coverage=volume.timePlatformCoverage(result);
  assert.deepEqual(daily.dailyFallbackPlatforms(result),['3PATTI-SUPER']);
  for(const [direction,count,amount] of [['代收',1467,2158356],['代付',597,2476608]]){
    const rows=data.rows.filter(r=>r.direction===direction);
    assert.equal(rows.reduce((s,r)=>s+r.count,0),count);assert.equal(rows.reduce((s,r)=>s+r.amount,0),amount);
  }
  assert.deepEqual(coverage.daily,['3PATTI-SUPER']);assert.equal(coverage.queried.length,2);
  assert.deepEqual(coverage.unavailable,[]);assert.deepEqual(coverage.notOpen,['92BLAZE']);
});

test('details win even for an empty matched date; other dates, countries and unnamed platforms never enter totals',()=>{
  const result=fixture();result.dailyRows.push(row({platform:'92GAME',amount:999999}),row({country:'印度'}),row({date:'2026-09-19'}),row({platform:'OTHER'}),row({platform:'92BLAZE'}));
  assert.equal(daily.dailyVolumeRows(result).length,2);
  result.payloads.push({id:'new',payload:{platform:'3PATISUPER',country:'巴基斯坦',rows:[]}});
  assert.equal(daily.dailyVolumeRows(result).length,0,'do not interpret a detail query with zero matching rows as a missing collector');
});

test('daily totals obey direction/provider/wallet/platform filters and never enter hourly or successful-time searches',()=>{
  for(const filter of [{basis:'success'},{start:'2026-09-20T01:00:00'},{end:'2026-09-20T23:59:00'},
    {createdStart:'2026-09-19T00:00:00'},{createdEnd:'2026-09-19T23:59:59'},{status:'pending'},{memberId:'1'},{orderNumber:'WD1'},{crossDayOnly:true}])
    assert.equal(daily.dailyVolumeRows(fixture({selection:{...selection,...filter}})).length,0,JSON.stringify(filter));
  assert.equal(daily.dailyVolumeRows(fixture({selection:{...selection,direction:'代收'}})).length,1);
  for(const filter of [{platforms:['92GAME']},{channel:'Other'},{types:['BANK']}])
    assert.equal(daily.dailyVolumeRows(fixture({selection:{...selection,...filter}})).length,0);
});

test('daily success counts never create denominators, actual-amount totals or zero pending balances',()=>{
  const data=volume.timeVolumeData(fixture()),provider=key('巴基斯坦','TestPay');
  assert.equal(data.collectionSuccess.compare([provider]).current.rate,null);
  assert.equal(data.withdrawSuccess.compare([provider]).current.rate,null);
  assert.equal(data.withdrawActual.compare([provider]).current.state,'unavailable');
  assert.equal(data.withdrawPending.compare([provider]).current.state,'unavailable');
  assert.equal(data.withdrawSuccess.compare([provider],['BANK']).current.rate,520/586,'unaffected wallet denominator stays intact');
  const separate=volume.timeVolumeData(fixture({dailyRows:[row({channel:'AnotherPay'})]}));
  assert.equal(separate.collectionSuccess.compare([provider]).current.rate,1167/2204);
  assert.equal(separate.withdrawSuccess.compare([provider]).current.rate,520/586);
});

test('previous-day baseline must include the daily-only platform added to current totals',()=>{
  const previous=[row({date:'2026-09-19'}),row({date:'2026-09-19',direction:'代付'}),row({date:'2026-09-19',platform:'92GAME'}),row({date:'2026-09-19',platform:'92GAME',direction:'代付'})];
  const ready=comparison.historicalDailyComparison(fixture(),previous);
  assert.equal(ready.status,'ready');assert.equal(ready.previousRows.length,4);
  const missing=comparison.historicalDailyComparison(fixture(),previous.filter(r=>r.platform==='92GAME'));
  assert.equal(missing.status,'unavailable');assert.ok(missing.issues.every(r=>r.platform==='3PATTI-SUPER'));
});

const text=fs.readFileSync(path.join(root,'src/components/OrderTimeControls.tsx'),'utf8');
const source=ts.createSourceFile('controls.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const hook=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='useOrderTimeDaily');
const code=ts.transpileModule(hook.getText(source),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(){
  const cells=[],effects=[],requests=[];let index=0,dirty=true,pending=[],current=fixture({dailyRows:undefined}),identity='a',paused=false,output;
  const context={...daily,exports:{},useDashboardAuth:()=>({session:{user:{id:identity}},profile:{identity}}),dashboardScopeIdentity:p=>p.identity,
    useState(initial){const i=index++;if(!(i in cells))cells[i]=initial;return[cells[i],v=>{cells[i]=v;dirty=true;}];},
    useEffect(fn,deps){const i=index++;if(!effects[i]||!deps.every((v,j)=>Object.is(v,effects[i].deps[j])))pending.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});},
    orderComparisonDailyRows(start,end,country,signal){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});requests.push({start,end,country,signal,resolve,reject});return promise;}};
  const useHook=new Function(...Object.keys(context),code+'\nreturn useOrderTimeDaily;')(...Object.values(context));
  function draw(){index=0;pending=[];dirty=false;output=useHook(current,paused);for(const effect of pending)effect();return output;}
  async function settle(){for(let i=0;i<15;i++){if(dirty)draw();await Promise.resolve();}return output;}
  return {requests,settle,draw,setResult(v){current=v;dirty=true;},auth(v){identity=v;dirty=true;},pause(v){paused=v;dirty=true;},unmount(){effects.forEach(e=>e?.cleanup?.());}};
}
test('daily background read waits during a new query and rejects stale or cross-account responses',async()=>{
  const h=harness();assert.equal((await h.settle()).loading,true);assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].country,'巴基斯坦');assert.equal(h.requests[0].start,'2026-09-20');
  h.auth('b');assert.equal(h.draw().loading,true);assert.equal(h.requests[0].signal.aborted,true);
  h.requests[0].resolve([row()]);await h.settle();assert.equal(h.draw().rows,undefined);
  h.requests[1].resolve([row()]);assert.equal((await h.settle()).rows.length,1);
  h.pause(true);h.setResult(fixture({selection:{...selection,end:'2026-09-21T23:59:59'}}));await h.settle();assert.equal(h.requests.length,2);
  h.pause(false);await h.settle();assert.equal(h.requests.length,3);
  h.requests[2].reject(Error('offline'));const failure=await h.settle();assert.match(failure.error,/日汇总暂未载入/);assert.deepEqual(failure.rows,[]);h.unmount();
});
test('hourly and fully detailed selections never perform a fallback read',async()=>{
  for(const filter of [{basis:'success'},{platforms:['92GAME']},{start:'2026-09-20T01:00:00'}]){
    const h=harness();h.setResult(fixture({selection:{...selection,...filter}}));assert.equal((await h.settle()).loading,false);assert.equal(h.requests.length,0);h.unmount();
  }
});
