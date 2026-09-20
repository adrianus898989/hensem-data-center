// Execute the production component and effects with a deterministic hook
// scheduler. Requests are local promises, including transports ignoring abort.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const React=require('react');
const {root,loadTs}=require('./load-typescript.cjs');
const text=fs.readFileSync(path.join(root,'src/components/ThirdPartyVolumeDashboard.tsx'),'utf8');
const source=ts.createSourceFile('dashboard.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const statements=source.statements.filter(n=>!ts.isImportDeclaration(n));
const compiled=ts.transpileModule(statements.map(n=>n.getText(source)).join('\n'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const libs=['format','thirdPartyNameMap','thirdPartyPlatform','platformDisplayCountry','dashboardDataScope','collectionSuccess','withdrawPending','withdrawActual','workOrderDeposit','orderTimeVolume','orderTimeQuery'];
const dependencies=Object.assign({},...libs.map(name=>loadTs(path.join(root,`src/lib/${name}.ts`))));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const response=data=>({ok:true,status:200,json:async()=>data,text:async()=>JSON.stringify(data)});
const directory=[{country:'印度',platform:'91CLUB'},{country:'巴基斯坦',platform:'POPZAR'},{country:'巴基斯坦',platform:'92BLAZE'},{country:'香港',platform:'EK7'}];
function elements(value,predicate){if(Array.isArray(value))return value.flatMap(x=>elements(x,predicate));if(!React.isValidElement(value))return [];return [...(predicate(value)?[value]:[]),...elements(value.props.children,predicate)];}
function harness(fetcher,cache={}){
  const cells=[],effects=[],calls=[],writes=[];let index=0,pending=[],dirty=true,tree,profile={auth_user_id:'one',role:'owner',active:true},token='token-one';
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const hooks={
    useState(initial){const i=index++;if(!(i in cells))cells[i]=typeof initial==='function'?initial():initial;return[cells[i],value=>{const next=typeof value==='function'?value(cells[i]):value;if(!Object.is(cells[i],next)){cells[i]=next;dirty=true;}}];},
    useRef(initial){const i=index++;return cells[i]||(cells[i]={current:initial});},
    useMemo(fn,deps){const i=index++;if(!cells[i]||!same(cells[i].deps,deps))cells[i]={deps,value:fn()};return cells[i].value;},
    useEffect(fn,deps){const i=index++;if(!effects[i]||!same(effects[i].deps,deps)){pending.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});}}
  };
  const time={mode:'created',startClock:'00:00:00',endClock:'23:59:59',platforms:[],optionsLoading:false,optionsError:'',active:false,result:null,error:'',clearCount:0,
    clearResult(){this.clearCount++;this.active=false;this.result=null;},showDaily(){this.active=false;},setStartClock(v){this.startClock=v;dirty=true;},setEndClock(v){this.endClock=v;dirty=true;},
    async run(input){this.active=true;this.result={selection:{...input,basis:this.mode,createdStart:'',createdEnd:''},payloads:[]};return true;}};
  const context={...dependencies,...hooks,exports:{},useDashboardAuth:()=>({session:{user:{id:profile.auth_user_id},access_token:token},profile}),useOrderTimeQuery:()=>time,
    dashboardBusinessFetch:async(url,init)=>{calls.push({url,...init});return fetcher(url,init,calls.length);},isDashboardDataDenied:error=>[401,403,409].includes(error?.status),
    readDashboardDataCache:key=>cache[key]||null,writeDashboardDataCache:(...args)=>writes.push(args),TimeQueryExtra:()=>null,ThirdPartyRatesDashboard:()=>null,OrderRecordModal:()=>null};
  const component=new Function('require',...Object.keys(context),compiled+'\nreturn exports.default;')(require,...Object.values(context));
  function draw(){index=0;pending=[];dirty=false;tree=component();for(const effect of pending)effect();return tree;}
  async function settle(){for(let n=0;n<25;n++){if(dirty)draw();await Promise.resolve();}assert.equal(dirty,false,'effects converge');return tree;}
  const select=(label)=>elements(tree,e=>typeof e.type==='function'&&e.type.name==='VolumeMultiSelect'&&e.props.label===label)[0];
  return {calls,writes,time,settle,draw,get tree(){return tree;},select,
    country(name){const button=elements(tree,e=>e.type==='button'&&e.props.children===name)[0];assert.ok(button,name);button.props.onClick();},
    submit(){const form=elements(tree,e=>e.type==='form')[0];form.props.onSubmit({preventDefault(){}});},
    date(index,value){elements(tree,e=>e.type==='input'&&e.props.type==='datetime-local')[index].props.onChange({target:{value}});},
    summaries(){return elements(tree,e=>typeof e.type==='function'&&e.type.name==='CountryVolumeSinglePage');},
    alerts(){return elements(tree,e=>e.props.role==='alert');},
    setAuth(next,newToken=token){profile=next;token=newToken;dirty=true;},
    tokenRefresh(){token+='-refresh';dirty=true;},
    unmount(){for(const effect of effects)effect?.cleanup?.();}
  };
}
const report=(country,platform,date='2026-09-17')=>({rows:[{date,country,platform,channel:'FixturePay',rawChannel:'FixturePay',channelType:'BANK',direction:'代收',amount:120,count:2}],meta:{}});
const isVolume=url=>url.includes('third-party-volume');
const normal=(url)=>response(url.includes('filter-options')?{platforms:directory}:url.includes('rates')?{rates:[]}:{});

test('mount requests only the independent name directory; PK has all platforms before a business query',async()=>{
  const h=harness(normal);await h.settle();
  assert.deepEqual(h.calls.map(c=>c.url),['/api/third-party-filter-options']);assert.equal(h.summaries().length,0);
  h.country('巴基斯坦盘口');await h.settle();
  assert.deepEqual(h.select('平台').props.options,['92BLAZE','POPZAR']);assert.equal(h.calls.length,1);
  h.tokenRefresh();await h.settle();assert.deepEqual(h.select('平台').props.options,['92BLAZE','POPZAR']);assert.equal(h.calls.length,1);
  h.unmount();
});

test('default dates and shortcuts follow catalog timezone while custom dates survive a platform change',async()=>{
  const previousNow=Date.now;
  Date.now=()=>Date.parse('2026-09-18T18:45:00Z');
  const h=harness(normal);
  const dates=()=>elements(h.tree,e=>e.type==='input'&&e.props.type==='datetime-local').map(e=>e.props.value);
  try{
    await h.settle();assert.deepEqual(dates(),['2026-09-18T00:00:00','2026-09-18T23:59:59']);
    h.time.platforms=[{id:'pk',name:'POPZAR',team:'NEWAR',country:'巴基斯坦',timezone:'Asia/Karachi',source:'newar'}];
    h.country('巴基斯坦盘口');await h.settle();
    assert.deepEqual(dates(),['2026-09-17T00:00:00','2026-09-17T23:59:59']);
    elements(h.tree,e=>e.type==='button'&&e.props.children==='今天')[0].props.onClick();await h.settle();
    assert.deepEqual(dates(),['2026-09-18T00:00:00','2026-09-18T23:59:59']);
    h.date(0,'2026-08-25T10:00:00');h.date(1,'2026-08-27T20:00:00');await h.settle();
    h.country('印度线下盘口');await h.settle();
    assert.deepEqual(dates(),['2026-08-25T10:00:00','2026-08-27T20:00:00']);
    assert.equal(h.calls.filter(c=>isVolume(c.url)).length,0,'no metadata or date change triggers an order/report fetch');
  }finally{Date.now=previousNow;h.unmount();}
});

test('uploaded AR aliases use the canonical pre-query directory for all and explicit time queries',async()=>{
  for(const [raw,display] of [['Shree.Win','ShreeWin'],['SYNTHETIC(AR)','SYNTHETIC']])for(const explicit of [false,true]){
    const h=harness(url=>url.includes('filter-options')?response({platforms:[{country:'印度',platform:raw}]}):normal(url));
    h.time.platforms=[{id:'fixture-ar',name:raw,team:'AR',country:'印度',timezone:'Asia/Kolkata',source:'ar'}];
    await h.settle();assert.deepEqual(h.select('平台').props.options,[display]);
    if(explicit){h.select('平台').props.onChange([display]);await h.settle();}
    h.submit();await h.settle();
    assert.equal(h.time.active,true);assert.deepEqual(h.time.result.selection.platforms,explicit?[display]:[]);
    assert.deepEqual(h.time.result.selection.availablePlatforms,[display]);
    assert.equal(h.calls.filter(c=>isVolume(c.url)).length,0,'raw catalog alias must not force legacy or drop the platform');h.unmount();
  }
});

test('switching country aborts and discards a late India report even when transport ignores abort',async()=>{
  const slow=deferred();const h=harness(url=>isVolume(url)?slow.promise:normal(url));await h.settle();
  h.date(0,'2026-09-17T00:00:00');h.date(1,'2026-09-17T23:59:59');await h.settle();h.submit();await h.settle();
  const request=h.calls.find(c=>isVolume(c.url));assert.ok(request);assert.match(request.url,/country=/);
  h.country('巴基斯坦盘口');await h.settle();assert.equal(request.signal.aborted,true);assert.equal(h.summaries().length,0);
  slow.resolve(response(report('印度','91CLUB')));await h.settle();assert.equal(h.summaries().length,0);assert.equal(h.writes.length,0);
  assert.deepEqual(h.select('平台').props.options,['92BLAZE','POPZAR']);h.unmount();
});

test('late rate body cannot publish old country data or undo a newer successful query',async()=>{
  const oldRate=deferred();let rateCalls=0;
  const h=harness(url=>url.includes('rates')?(++rateCalls===1?{ok:true,status:200,text:async()=>JSON.stringify(await oldRate.promise)}:response({rates:[]})):
    isVolume(url)?response(report(url.includes(encodeURIComponent('巴基斯坦'))?'巴基斯坦':'印度',url.includes(encodeURIComponent('巴基斯坦'))?'POPZAR':'91CLUB')):normal(url));
  await h.settle();h.date(0,'2026-09-17T00:00:00');h.date(1,'2026-09-17T23:59:59');await h.settle();h.submit();await h.settle();
  assert.equal(h.summaries().length,0,'all response bodies commit atomically');
  h.country('巴基斯坦盘口');await h.settle();h.submit();await h.settle();assert.equal(h.summaries()[0]?.props.country,'巴基斯坦');
  oldRate.resolve({rates:[{country:'印度',platform:'91CLUB',channel:'FixturePay'}]});await h.settle();
  assert.equal(h.summaries()[0]?.props.country,'巴基斯坦');assert.equal(h.summaries()[0]?.props.rows[0]?.platform,'POPZAR');h.unmount();
});

test('draft date and platform changes do not alter an in-flight or published query snapshot',async()=>{
  const slow=deferred();const h=harness(url=>isVolume(url)?slow.promise:normal(url));await h.settle();h.country('巴基斯坦盘口');await h.settle();
  h.date(0,'2026-09-17T00:00:00');h.date(1,'2026-09-17T23:59:59');h.select('平台').props.onChange(['POPZAR']);await h.settle();h.submit();await h.settle();
  h.date(0,'2026-09-18T00:00:00');h.date(1,'2026-09-18T23:59:59');h.select('平台').props.onChange(['92BLAZE']);await h.settle();
  slow.resolve(response(report('巴基斯坦','POPZAR')));await h.settle();
  assert.equal(h.summaries()[0]?.props.dateRangeLabel,'2026-09-17 至 2026-09-17');assert.equal(h.summaries()[0]?.props.rows[0]?.platform,'POPZAR');
  assert.deepEqual(h.select('平台').props.value,['92BLAZE']);assert.equal(h.calls.filter(c=>isVolume(c.url)).length,1);h.unmount();
});

test('empty, pending and failed catalogs are distinct; retry does not query reports',async()=>{
  const slow=deferred();let attempts=0;const h=harness(()=>++attempts===1?slow.promise:response({platforms:[]}));await h.settle();
  assert.ok(elements(h.tree,e=>e.props.role==='status'&&e.props.children==='正在读取平台目录…').length);
  slow.reject(Error('fixture directory unavailable'));await h.settle();assert.equal(h.alerts().length,1);assert.equal(h.summaries().length,0);
  elements(h.tree,e=>e.type==='button'&&e.props.children==='重新读取平台目录')[0].props.onClick();await h.settle();
  assert.ok(elements(h.tree,e=>e.props.role==='status'&&e.props.children==='当前国家暂无可查询平台。').length);assert.equal(h.alerts().length,0);
  assert.ok(h.calls.every(c=>c.url==='/api/third-party-filter-options'));h.unmount();
});

test('account change hides existing data immediately and rejects old in-flight response',async()=>{
  const slow=deferred();const h=harness(url=>isVolume(url)?slow.promise:normal(url));await h.settle();h.submit();await h.settle();
  h.setAuth({auth_user_id:'two',role:'viewer',active:true,data_scope:{mode:'selected',countries:['PK']}});h.draw();assert.equal(h.summaries().length,0);await h.settle();
  slow.resolve(response(report('印度','91CLUB')));await h.settle();assert.equal(h.summaries().length,0);assert.deepEqual(h.select('平台').props.options,['92BLAZE','POPZAR']);
  assert.ok(h.calls.find(c=>isVolume(c.url)).signal.aborted);h.unmount();
});

test('there is no unscoped periodic refresh and the separate detail lookup stays single-platform',()=>{
  assert.doesNotMatch(text,/setInterval\(|checkCurrentSnapshotAndRefresh/);
  const detail=fs.readFileSync(path.join(root,'src/components/OrderDetailSearch.tsx'),'utf8');assert.match(detail,/<select required value=\{draft\.platform\}/);
});

test('an explicit order-time query reads rates independently without silently loading a daily report',async()=>{
  const h=harness(url=>url.includes('rates')?response({rates:[{country:'印度',platform:'91CLUB',channel:'FixturePay'}]}):normal(url));await h.settle();
  h.time.platforms=[{id:'one',name:'EK7',team:'香港'}];h.country('香港盘口');await h.settle();h.submit();await h.settle();
  assert.equal(h.time.active,true);assert.equal(h.calls.filter(c=>isVolume(c.url)).length,0);
  assert.deepEqual(h.calls.filter(c=>c.url.includes('rates')).map(c=>c.url),['/api/supabase-third-party-rates?includeStatuses=0']);
  assert.equal(h.writes.length,1);h.unmount();
});

test('rate failure does not discard orders, and a late rate response cannot cross a country switch',async()=>{
  for(const reject of [true,false]){
    const rates=deferred();const h=harness(url=>url.includes('rates')?rates.promise:normal(url));await h.settle();
    h.time.platforms=[{id:'one',name:'EK7',team:'香港'}];h.country('香港盘口');await h.settle();h.submit();await h.settle();assert.equal(h.time.active,true);
    if(reject){rates.reject(Error('rate transport failed'));await h.settle();assert.equal(h.time.active,true);assert.equal(h.writes.length,0);
      assert.ok(elements(h.tree,e=>e.type==='b'&&Array.isArray(e.props.children)&&e.props.children.some(x=>typeof x==='string'&&x.includes('不会按 0 展示'))).length);
    }else{h.country('巴基斯坦盘口');await h.settle();rates.resolve(response({rates:[{country:'印度',platform:'91CLUB',channel:'FixturePay'}]}));await h.settle();assert.equal(h.writes.length,0);assert.equal(h.time.active,false);}
    h.unmount();
  }
});

test('a failed wider date range retains the previous applied day, never relabels overlapping rows as the range',async()=>{
  let reports=0;const h=harness(url=>isVolume(url)?(++reports===1?response(report('印度','91CLUB','2026-09-18')):Promise.reject(Error('range timed out'))):normal(url));
  await h.settle();h.date(0,'2026-09-18T00:00:00');h.date(1,'2026-09-18T23:59:59');await h.settle();h.submit();await h.settle();
  assert.equal(h.summaries()[0]?.props.dateRangeLabel,'2026-09-18 至 2026-09-18');
  h.date(0,'2026-09-01T00:00:00');await h.settle();h.submit();await h.settle();
  assert.equal(reports,2);assert.equal(h.summaries()[0]?.props.dateRangeLabel,'2026-09-18 至 2026-09-18');
  assert.equal(h.summaries()[0]?.props.rows.length,1);assert.equal(h.summaries()[0]?.props.rows[0].date,'2026-09-18');
  assert.ok(elements(h.tree,e=>e.type==='b'&&Array.isArray(e.props.children)&&e.props.children.some(x=>typeof x==='string'&&x.includes('查询失败，未切换当前结果'))).length);h.unmount();
});

test('an overlapping browser cache is not published as a successful query after a transport failure',async()=>{
  const cached=report('印度','91CLUB','2026-09-18');
  const h=harness(url=>isVolume(url)?Promise.reject(Error('range failed')):normal(url),{'hensem:last-good:third-party-volume:v252-submission-success':cached});
  await h.settle();h.date(0,'2026-09-01T00:00:00');h.date(1,'2026-09-18T23:59:59');await h.settle();h.submit();await h.settle();
  assert.equal(h.summaries().length,0);assert.equal(h.writes.length,0);h.unmount();
});

test('a successful empty response replaces the prior day and applies the requested range',async()=>{
  let reports=0;const h=harness(url=>isVolume(url)?response(++reports===1?report('印度','91CLUB','2026-09-18'):{rows:[],meta:{}}):normal(url));
  await h.settle();h.date(0,'2026-09-18T00:00:00');h.date(1,'2026-09-18T23:59:59');await h.settle();h.submit();await h.settle();
  assert.equal(h.summaries()[0]?.props.rows.length,1);
  h.date(0,'2026-09-01T00:00:00');await h.settle();h.submit();await h.settle();
  assert.equal(h.summaries()[0]?.props.dateRangeLabel,'2026-09-01 至 2026-09-18');assert.deepEqual(h.summaries()[0]?.props.rows,[]);h.unmount();
});
