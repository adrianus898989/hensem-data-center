const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {root,loadTs}=require('./load-typescript.cjs');
const comparison=loadTs(path.join(root,'src/lib/orderTimeComparison.ts'));
const volume=loadTs(path.join(root,'src/lib/orderTimeVolume.ts'));
const selection={country:'印度',platforms:[],availablePlatforms:['DhaniWin','BIG'],channel:'LKgoPay',types:['BANK'],direction:'代付',basis:'created',start:'2026-09-19T10:00:00',end:'2026-09-19T23:59:59',createdStart:'',createdEnd:'',status:'all'};
const result={selection,payloads:[{id:'ar:one',payload:{platform:'DhaniWin',country:'印度',timezone:'Asia/Kolkata',rows:[]}}]};

test('comparison retains clock, platform/provider/type/direction filters and shifts calendar days across month/year boundaries',()=>{
  const previous=comparison.previousTimeSelection(selection);
  assert.deepEqual(previous,{...selection,start:'2026-09-18T10:00:00',end:'2026-09-18T23:59:59'});
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
  const cells=[],effects=[],requests=[];let index=0,pending=[],dirty=true,current=result,paused=false,identity='viewer',output;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const context={...comparison,...volume,exports:{},useDashboardAuth:()=>({session:{user:{id:identity}},profile:{identity}}),dashboardScopeIdentity:p=>p.identity,
    useState(initial){const i=index++;if(!(i in cells))cells[i]=initial;return[cells[i],value=>{cells[i]=value;dirty=true;}];},
    useRef(initial){const i=index++;return cells[i]||(cells[i]={current:initial});},
    useEffect(fn,deps){const i=index++;if(!effects[i]||!same(effects[i].deps,deps))pending.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});},
    queryOrderTimeBatches(filters,_fetcher,options){const d=deferred();requests.push({filters,...options,...d});return d.promise;},orderTimeRpc(){assert.fail('unexpected direct query');}};
  const useHook=new Function(...Object.keys(context),compiled+'\nreturn useOrderTimeComparison;')(...Object.values(context));
  function draw(){index=0;pending=[];dirty=false;output=useHook(current,paused);for(const effect of pending)effect();return output;}
  async function settle(){for(let n=0;n<15;n++){if(dirty)draw();await Promise.resolve();}return output;}
  return {requests,draw,settle,setResult(value){current=value;dirty=true;},pause(value){paused=value;dirty=true;},auth(value){identity=value;dirty=true;},unmount(){for(const e of effects)e?.cleanup?.();}};
}

test('background comparison uses exactly queried platform IDs, caches matching inputs and does not query during a new search',async()=>{
  const h=harness();await h.settle();assert.equal(h.requests.length,1);
  const request=h.requests[0];assert.equal(request.filters.length,1);assert.equal(request.filters[0].platform,'ar:one');
  assert.equal(request.filters[0].start,'2026-09-18T10:00:00');assert.equal(request.filters[0].direction,'withdraw');assert.equal(request.filters[0].timezone,'Asia/Kolkata');
  request.resolve(result.payloads);assert.equal((await h.settle()).status,'ready');
  h.setResult({...result});await h.settle();assert.equal(h.requests.length,1,'repeat query reuses short-lived scoped comparison cache');
  h.pause(true);h.setResult({...result,selection:{...selection,end:'2026-09-19T22:00:00'}});await h.settle();assert.equal(h.requests.length,1);
  h.pause(false);await h.settle();assert.equal(h.requests.length,2);h.unmount();assert.equal(h.requests[1].signal.aborted,true);
});

test('late, failed and cross-account comparison responses cannot overwrite current data',async()=>{
  const h=harness();await h.settle();const first=h.requests[0];
  h.setResult({...result,selection:{...selection,start:'2026-09-19T11:00:00'}});await h.settle();assert.equal(first.signal.aborted,true);
  first.resolve(result.payloads);assert.equal((await h.settle()).status,'loading');
  h.requests[1].reject(Error('offline'));assert.equal((await h.settle()).status,'error');
  h.auth('new-viewer');assert.equal(h.draw().status,'loading');await h.settle();assert.equal(h.requests.length,3);
  h.requests[2].resolve(result.payloads);assert.equal((await h.settle()).status,'ready');h.unmount();
});
