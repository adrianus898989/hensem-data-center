const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {root,loadTs}=require('./load-typescript.cjs');
const comparison=loadTs(path.join(root,'src/lib/orderTimeComparison.ts'));
const volume=loadTs(path.join(root,'src/lib/orderTimeVolume.ts'));
const selection={country:'印度',platforms:['DhaniWin'],availablePlatforms:['DhaniWin','BIG'],channel:'LKgoPay',types:['BANK'],direction:'代付',basis:'created',start:'2026-09-19T00:00:00',end:'2026-09-19T23:59:59',createdStart:'',createdEnd:'',status:'all'};
const row=(day='2026-09-19',count=10)=>({created_date:day,direction:'withdraw',provider:'LKgoPay',channel_type:'BANK',submitted_count:count,success_count:count,success_amount:100});
const result={selection,payloads:[{id:'ar:one',payload:{platform:'DhaniWin',country:'印度',timezone:'Asia/Kolkata',rows:[row()]}}]};
const previousPayloads=()=>[{...result.payloads[0],payload:{...result.payloads[0].payload,rows:[row('2026-09-18')]}}];
const daily=(extra={})=>({id:'daily',date:'2026-09-18',country:'印度',platform:'DHANIWIN(新AR)',direction:'代付',channel:'LKgoPay',rawChannel:'LKgoPayINR-Bank',channelType:'BANK',amount:100,count:10,successCount:10,failedCount:0,successRate:1,...extra});
const receipt=(date='2026-09-19',count=10,extra={})=>({schema_version:1,source_system:'WITHDRAW_REVIEW',country_code:'IN',platform:'DHANIWIN(新AR)',stat_date:date,timezone:'Asia/Kolkata',snapshot_id:'receipt',snapshot_at:'2026-09-20T00:00:00Z',coverage:{complete:true,expected_count:count,fetched_count:count,unique_count:count},totals:{submitted_count:count,success_count:count},groups:[{raw_channel:'LKgoPay',channel_type:'BANK',submitted_count:count,success_count:count}],...extra});

test('comparison retains clock, platform/provider/type/direction filters and shifts calendar days across month/year boundaries',()=>{
  const previous=comparison.previousTimeSelection(selection);
  assert.deepEqual(previous,{...selection,start:'2026-09-18T00:00:00',end:'2026-09-18T23:59:59'});
  assert.equal(comparison.timeComparisonLabel(selection),'较昨日');
  const multi={...selection,start:'2026-01-01T05:00:00',end:'2026-01-03T21:59:59',basis:'success',createdStart:'2025-12-25T01:00:00',createdEnd:'2026-01-01T01:00:00'};
  assert.deepEqual(comparison.previousTimeSelection(multi),{...multi,start:'2025-12-29T05:00:00',end:'2025-12-31T21:59:59',createdStart:'2025-12-22T01:00:00',createdEnd:'2025-12-29T01:00:00'});
  assert.equal(comparison.timeComparisonLabel(multi),'较前期');
  assert.throws(()=>comparison.previousTimeSelection({...selection,end:'2026-09-18T00:00:00'}));
});

const text=fs.readFileSync(path.join(root,'src/components/OrderTimeControls.tsx'),'utf8');
const source=ts.createSourceFile('controls.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const hook=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='useOrderTimeComparison');
const compiled=ts.transpileModule(hook.getText(source),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function harness(){
  const cells=[],effects=[],requests=[],receipts=[];let index=0,pending=[],dirty=true,current=result,paused=false,identity='viewer',output;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const context={...comparison,...volume,exports:{},useDashboardAuth:()=>({session:{user:{id:identity}},profile:{identity}}),dashboardScopeIdentity:p=>p.identity,
    useState(initial){const i=index++;if(!(i in cells))cells[i]=initial;return[cells[i],value=>{cells[i]=value;dirty=true;}];},
    useRef(initial){const i=index++;return cells[i]||(cells[i]={current:initial});},
    useEffect(fn,deps){const i=index++;if(!effects[i]||!same(effects[i].deps,deps))pending.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});},
    orderComparisonDailyRows(start,end,country,signal){const d=deferred();receipts.push({start,end,country,signal,...d});return d.promise;},
    queryOrderTimeBatches(filters,_fetcher,options){const d=deferred();requests.push({filters,...options,...d});return d.promise;},orderTimeRpc(){assert.fail('unexpected direct query');}};
  const useHook=new Function(...Object.keys(context),compiled+'\nreturn useOrderTimeComparison;')(...Object.values(context));
  function draw(){index=0;pending=[];dirty=false;output=useHook(current,paused);for(const effect of pending)effect();return output;}
  async function settle(){for(let n=0;n<15;n++){if(dirty)draw();await Promise.resolve();}return output;}
  return {requests,receipts,draw,settle,setResult(value){current=value;dirty=true;},pause(value){paused=value;dirty=true;},auth(value){identity=value;dirty=true;},unmount(){for(const e of effects)e?.cleanup?.();}};
}

test('background comparison uses exactly queried platform IDs, caches matching inputs and does not query during a new search',async()=>{
  const h=harness();await h.settle();assert.equal(h.requests.length,0);
  assert.equal(h.receipts[0].start,'2026-09-18');assert.equal(h.receipts[0].end,'2026-09-18');
  h.receipts[0].resolve([daily(),daily({platform:'BIG',amount:500})]);const state=await h.settle();assert.equal(state.status,'ready');
  assert.equal(state.basis,'daily');assert.equal(state.previousRows.length,1);assert.equal(state.previousRows[0].platform,'DhaniWin');
  h.setResult({...result});await h.settle();assert.equal(h.receipts.length,1,'repeat query reuses scoped daily cache');
  h.pause(true);h.setResult({...result,selection:{...selection,start:'2026-09-20T00:00:00',end:'2026-09-20T23:59:59'}});await h.settle();assert.equal(h.receipts.length,1);
  h.pause(false);await h.settle();assert.equal(h.receipts.length,2);h.unmount();assert.equal(h.receipts[1].signal.aborted,true);
  assert.equal(h.requests.length,0,'historical comparison never fans out raw-order reads');
});

test('late, failed and cross-account comparison responses cannot overwrite current data',async()=>{
  const h=harness();await h.settle();const first=h.receipts[0];
  h.setResult({...result,selection:{...selection,channel:'Different'}});await h.settle();assert.equal(first.signal.aborted,true);
  first.resolve([daily()]);assert.equal((await h.settle()).status,'loading');
  h.receipts[1].reject(Error('offline'));assert.equal((await h.settle()).status,'error');
  h.auth('new-viewer');assert.equal(h.draw().status,'loading');await h.settle();assert.equal(h.receipts.length,3);
  h.receipts[2].resolve([daily()]);assert.equal((await h.settle()).status,'ready');h.unmount();
});

test('missing daily summaries retain platform/date/direction reasons and never request old raw orders',async()=>{
  const h=harness();await h.settle();h.receipts[0].resolve([]);
  const state=await h.settle();assert.equal(state.status,'unavailable');assert.equal(h.requests.length,0);
  assert.deepEqual(state.issues.map(x=>[x.period,x.date,x.platform,x.direction]),[['previous','2026-09-18','DhaniWin','代付']]);h.unmount();
});

test('historical details and snapshot receipts are not required; cached daily data rechecks newly selected platforms',async()=>{
  const h=harness();await h.settle();h.receipts[0].resolve([daily()]);assert.equal((await h.settle()).status,'ready');
  h.setResult({...result,payloads:[...result.payloads,{id:'big',payload:{...result.payloads[0].payload,platform:'BIG'}}]});
  const state=await h.settle();assert.equal(state.status,'unavailable');assert.equal(state.issues[0].platform,'BIGMUMBAI');
  assert.equal(h.receipts.length,1);assert.equal(h.requests.length,0);h.unmount();
});

test('daily baseline excludes extra days/countries/platforms and covers every date and direction before provider filtering',()=>{
  const inputs=[daily(),daily({date:'2026-09-17'}),daily({date:'2026-09-19'}),daily({country:'巴基斯坦'}),daily({platform:'BIG'})];
  assert.equal(comparison.historicalDailyComparison(result,inputs).previousRows.length,1);
  assert.equal(comparison.historicalDailyComparison(result,[daily({channel:'Another',amount:0,count:0})]).status,'ready');
  assert.equal(comparison.historicalDailyComparison(result,[daily({amount:null})]).status,'unavailable');
  const multiple={...result,selection:{...selection,direction:'',end:'2026-09-20T23:59:59'}};
  const issues=comparison.historicalDailyComparison(multiple,[daily()]).issues;
  assert.ok(issues.some(x=>x.date==='2026-09-17'&&x.direction==='代收'));
  assert.ok(issues.some(x=>x.date==='2026-09-17'&&x.direction==='代付'));
  assert.ok(issues.some(x=>x.date==='2026-09-18'&&x.direction==='代收'));
});

test('daily evidence is not used as proof for hourly, success-time, status, member or cross-day subsets',async()=>{
  for(const filter of [{start:'2026-09-19T10:00:00'},{end:'2026-09-19T23:59:00'},{basis:'success'},{status:'success'},{memberId:'123'},{orderNumber:'x'},{crossDayOnly:true}]){
    const h=harness();h.setResult({...result,selection:{...selection,...filter}});
    assert.equal((await h.settle()).status,'unavailable');assert.equal(h.requests.length,0);assert.equal(h.receipts.length,0);h.unmount();
  }
});

test('Sep18 91CLUB 100000 uploaded versus 199537 fetched is incomplete; zero, invalid, duplicate and timezone checks fail closed',()=>{
  const value={...result,payloads:[{id:'91',payload:{...result.payloads[0].payload,platform:'91CLUB',rows:[row('2026-09-19',100000)]}}]};
  value.selection={...selection,platforms:['91CLUB']};
  const full=receipt('2026-09-19',199537,{platform:'91CLUB'});
  const issues=comparison.timeComparisonIssues(value,[full],'previous');
  assert.equal(issues.length,1);assert.equal(issues[0].stored,100000);assert.equal(issues[0].expected,199537);
  const zero={...result,payloads:[{...result.payloads[0],payload:{...result.payloads[0].payload,rows:[]}}]};
  assert.deepEqual(comparison.timeComparisonIssues(zero,[receipt('2026-09-19',0)],'previous'),[]);
  for(const snapshots of [[],[receipt(),receipt()],[receipt('2026-09-19',10,{timezone:'UTC'})],[receipt('2026-09-19',10,{coverage:{complete:false}})]])
    assert.ok(comparison.timeComparisonIssues(result,snapshots,'previous').length);
});

test('every intermediate date, selected platform and direction must have its own evidence; pending-only does not prove recharge coverage',()=>{
  const value={...result,selection:{...selection,platforms:[],availablePlatforms:['DhaniWin','BIG'],direction:'',end:'2026-09-21T23:59:59'}};
  const issues=comparison.timeComparisonIssues(value,[receipt(),receipt('2026-09-21')],'previous',false);
  assert.ok(issues.some(x=>x.platform==='BIGMUMBAI'));assert.ok(issues.some(x=>x.date==='2026-09-20'&&x.direction==='代付'));
  assert.equal(issues.filter(x=>x.direction==='代收').length,3);
});
