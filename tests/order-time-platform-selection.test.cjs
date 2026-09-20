const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {loadTs,root}=require('./load-typescript.cjs');
const {selectOrderTimePlatforms}=loadTs(path.join(root,'src/lib/orderTimePlatforms.ts'));
const {queryOrderTimeBatches}=loadTs(path.join(root,'src/lib/orderTimeBatch.ts'));
const {timeOrderFilters,timePlatformCoverage}=loadTs(path.join(root,'src/lib/orderTimeVolume.ts'));
const {timeMetricKeys,timeTotals}=loadTs(path.join(root,'src/lib/orderTimeQuery.ts'));
const platform=(n,name,team='香港')=>({id:`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,name,team});
const catalog=[platform(1,'EK7'),platform(2,'GEM7','香港团队'),platform(3,'MAX7'),platform(4,'66GAME','红膏蟹'),platform(5,'GEM7','印度')];
const input={country:'香港',platforms:[],channel:'',types:[],direction:'',start:'2026-09-17T18:00:00',end:'2026-09-17T23:59:59'};
test('three displayed aliases select the same uploaded platform ID exactly once',()=>{
  const platforms=[{...platform(90,'DhaniWin','NEWAR'),country:'印度',source:'newar'}, {...platform(91,'Veer.Game','AR'),country:'印度',source:'ar'}];
  const directory=['DhaniWin','DHANIWIN','DHANIWIN(新AR)','Veer.Game','VEER.GAME','VEERGAME'];
  assert.deepEqual(selectOrderTimePlatforms(platforms,'印度',[],directory),platforms);
  for(const names of [['DhaniWin'],['DHANIWIN'],['DHANIWIN(新AR)'],directory.slice(0,3)])assert.deepEqual(selectOrderTimePlatforms(platforms,'印度',names,directory),[platforms[0]]);
  for(const names of [['Veer.Game'],['VEER.GAME'],['VEERGAME'],directory.slice(3)])assert.deepEqual(selectOrderTimePlatforms(platforms,'印度',names,directory),[platforms[1]]);
});

test('all, multiple and single selections stay in the active group of the authorized catalog',()=>{
  assert.deepEqual(selectOrderTimePlatforms(catalog,'香港',[]).map(p=>p.name),['EK7','GEM7','MAX7']);
  assert.deepEqual(selectOrderTimePlatforms(catalog,'香港',['MAX7','EK7']).map(p=>p.name),['EK7','MAX7']);
  assert.deepEqual(selectOrderTimePlatforms(catalog,'香港',['GEM7']),[catalog[1]]);
  assert.deepEqual(selectOrderTimePlatforms(catalog.filter(p=>p.name==='EK7'),'香港',[]),[catalog[0]],'all never expands beyond the supplied permission catalog');
  assert.deepEqual(selectOrderTimePlatforms(catalog,'红膏蟹',[]),[catalog[3]]);
});

test('India fee aliases yield 16 real platforms, no false gaps, and the same two uploaded IDs',()=>{
  const names=['6CLUB','51GAME','55CLUB','82LOTTERY','91CLUB','BIGMUMBAI','DhaniWin','IN999','JAICLUB','JALWA','LOTTERY7','OKWIN','RAJA','ShreeWin','TPPLAY','VEER.GAME'];
  const uploaded=names.map((name,i)=>({...platform(i+100,name,'AR'),country:'印度',source:'ar'}));
  const available=[...names,'BIG(AR)','INDIA82(AR)'];
  assert.equal(selectOrderTimePlatforms(uploaded,'印度',[],available).length,16);
  for(const [oldName,name] of [['BIG','BIGMUMBAI'],['BIG(AR)','BIGMUMBAI'],['INDIA82','82LOTTERY'],['INDIA82(AR)','82LOTTERY']]){
    assert.deepEqual(selectOrderTimePlatforms(uploaded,'印度',[oldName,name],available).map(p=>p.id),[uploaded.find(p=>p.name===name).id]);
  }
  const result={selection:{...input,country:'印度',availablePlatforms:available},payloads:uploaded.map(p=>({id:p.id,payload:{platform:p.name,country:'印度',rows:[{direction:'charge',provider:'PayA',channel_type:'UPI'}]}}))};
  const coverage=timePlatformCoverage(result);
  assert.equal(coverage.expected.length,16);assert.equal(coverage.queried.length,16);assert.equal(coverage.contributing.length,16);
  assert.deepEqual(coverage.unavailable,[]);assert.deepEqual(coverage.empty,[]);
  result.payloads=result.payloads.filter(p=>p.payload.platform!=='BIGMUMBAI');
  assert.deepEqual(timePlatformCoverage(result).unavailable,['BIGMUMBAI'],'a real missing source must still be reported');
  assert.throws(()=>selectOrderTimePlatforms(uploaded.filter(p=>p.name!=='BIGMUMBAI'),'印度',['BIG'],available),/未接入订单明细或当前无权限/,'aliases never grant access to an absent source');
});

test('default all is the intersection of current country, permitted details and the independent directory',()=>{
  assert.deepEqual(selectOrderTimePlatforms(catalog,'香港',[],['EK7','91CLUB']),[catalog[0]]);
  assert.deepEqual(selectOrderTimePlatforms(catalog,'香港',[],['MAX7','66GAME','MISSING']),[catalog[2]],'another group and unconnected platforms cannot broaden the query');
  assert.deepEqual(selectOrderTimePlatforms(catalog,'香港',['EK7'],['EK7','91CLUB']),[catalog[0]],'unrelated legacy entries do not block a selected detail platform');
  for(const availableNames of [[],['91CLUB'],['66GAME']])
    assert.throws(()=>selectOrderTimePlatforms(catalog,'香港',[],availableNames),/没有可查询|暂无.*明细/,'an explicitly empty/mismatched directory must not fall back to every RPC platform');
  assert.throws(()=>selectOrderTimePlatforms(catalog,'香港',['MAX7'],['EK7']),/未接入订单明细或当前无权限/);
  assert.throws(()=>selectOrderTimePlatforms(catalog,'香港',['EK7','91CLUB'],['EK7','91CLUB']),/未接入订单明细或当前无权限/,'explicit legacy selections fail rather than disappear');
  assert.throws(()=>selectOrderTimePlatforms(catalog.filter(p=>p.name!=='MAX7'),'香港',[],['MAX7']),/没有可查询|暂无.*明细/,'directory membership cannot grant missing RPC permission');
});

test('repeated catalog entries and selected names are deduplicated by stable platform ID',()=>{
  const duplicated=[...catalog,catalog[0],{...catalog[1],team:'香港'}];
  assert.deepEqual(selectOrderTimePlatforms(duplicated,'香港',['GEM7','EK7','EK7']),catalog.slice(0,2));
  const upper={...platform(10,'Case'),id:'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'};
  assert.equal(selectOrderTimePlatforms([upper,{...upper,id:upper.id.toLowerCase()}],'香港',[]).length,1);
  assert.equal(selectOrderTimePlatforms([upper],'香港',[])[0].id,upper.id.toLowerCase());
});

test('unknown, unauthorized and other-group explicit selections fail rather than shrink results',()=>{
  for(const names of [['MISSING'],['EK7','MISSING'],['66GAME'],['EK7','66GAME']])
    assert.throws(()=>selectOrderTimePlatforms(catalog,'香港',names),/未接入订单明细或当前无权限/);
  assert.throws(()=>selectOrderTimePlatforms(catalog.filter(p=>p.name!=='MAX7'),'香港',['MAX7']),/无权限/);
  assert.throws(()=>selectOrderTimePlatforms(catalog,'巴基斯坦',[]),/没有可查询/);
  assert.throws(()=>selectOrderTimePlatforms([],'香港',[]),/没有可查询/);
});

test('same-name different IDs fail only for the selected group and platforms',()=>{
  const duplicate=[...catalog,platform(6,'GEM7')];
  for(const names of [[],['GEM7'],['EK7','GEM7']])
    assert.throws(()=>selectOrderTimePlatforms(duplicate,'香港',names),/重名/);
  assert.deepEqual(selectOrderTimePlatforms(duplicate,'香港',['EK7']),[catalog[0]]);
  assert.deepEqual(selectOrderTimePlatforms(catalog,'香港',['GEM7']),[catalog[1]],'same name in another group never widens scope');
});

test('same ID with conflicting names or groups cannot be queried',()=>{
  for(const conflict of [{...catalog[0],name:'ChangedName'},{...catalog[0],team:'印度'}])
    assert.throws(()=>selectOrderTimePlatforms([...catalog,conflict],'香港',['EK7']),/标识配置冲突/);
});

// Execute the real hook's run function together with the production batch queue,
// with fixture RPC responses only. No browser session or external requests.
const text=fs.readFileSync(path.join(root,'src/components/OrderTimeControls.tsx'),'utf8');
const source=ts.createSourceFile('OrderTimeControls.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const hook=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='useOrderTimeQuery');
const run=hook.body.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='run');
const denied=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='isOrderQueryDenied');
const compile=code=>ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const isOrderQueryDenied=new Function('exports',compile(denied.getText(source))+'\nreturn isOrderQueryDenied;')({});
function payload(request){
  const p=catalog.find(p=>p.id===request.p_platform);
  return {platforms:catalog,platform:p.name,team:p.team,timezone:'Asia/Kolkata',rows:(request.p_direction==='all'?['charge','withdraw']:[request.p_direction]).map(direction=>({
    ...Object.fromEntries(timeMetricKeys.map(k=>[k,0])),direction,provider:'PayA',channel_type:'UPI',
    created_date:'2026-09-17',success_date:'2026-09-18',submitted_count:2,submitted_amount:200,success_count:1,success_amount:100,
    first_created_at:request.p_start_at,last_created_at:request.p_end_at,first_success_at:null,last_success_at:null,last_synced_at:request.p_end_at
  }))};
}
function harness(overrides={}){
  const state={stored:'previous',active:true,error:'',busy:false,progress:[],cleared:false,calls:[]};
  const context={selectOrderTimePlatforms,timeOrderFilters,queryOrderTimeBatches,isOrderQueryDenied,
    mode:'created',identity:'viewer',currentIdentity:{current:'viewer'},requestSerial:{current:0},flight:{current:null},
    setBusy:v=>state.busy=v,setError:v=>state.error=v,setProgress:v=>state.progress.push(v),
    optionsLoading:false,optionsError:'',platforms:catalog,createdStart:'',createdEnd:'',session:{},
    setStored:v=>state.stored=v,setActive:v=>state.active=v,setPlatforms:()=>state.cleared=true,
    orderTimeRpc:async(_session,name,body)=>{assert.equal(name,'dashboard_order_time_query');state.calls.push(body);return payload(body);},...overrides};
  const invoke=new Function(...Object.keys(context),compile(run.getText(source))+'\nreturn run;')(...Object.values(context));
  return {run:invoke,state,context};
}

test('summary hook defaults to creation time, while keeping the legacy internal mode union',()=>{
  assert.match(text,/useState<"daily"\|"created"\|"success">\("created"\)/);
});

test('actual unified hook uses each catalog source timezone and keeps single-platform UUID routing',async()=>{
  const platforms=[{...platform(20,'POPZAR','NEWAR'),country:'巴基斯坦',timezone:'Asia/Karachi',source:'newar'},
    {...platform(21,'AR-PK','AR'),country:'巴基斯坦',timezone:'Asia/Karachi',source:'ar'}];
  const calls=[];
  const h=harness({platforms,orderTimeRpc:async(_session,name,body)=>{
    assert.equal(name,'dashboard_order_time_query');calls.push(body);
    const selected=platforms.find(p=>p.id===body.p_platform);
    return {platforms,platform:selected.name,team:selected.team,country:selected.country,timezone:selected.timezone,source:selected.source,rows:[]};
  }});
  assert.equal(await h.run({...input,country:'巴基斯坦',start:'2026-09-19T00:00:00',end:'2026-09-19T23:59:59',availablePlatforms:['POPZAR','AR-PK','LEGACY']}),true);
  assert.equal(calls.length,2);assert.equal(h.state.stored.data.payloads.length,2);
  for(const body of calls){assert.equal(body.p_start_at,'2026-09-18T19:00:00.000Z');assert.equal(body.p_end_at,'2026-09-19T19:00:00.000Z');}
});

test('actual summary query accepts all, multiple and single platforms and publishes all shards once',async()=>{
  for(const names of [[],['EK7','GEM7'],['MAX7'],['MAX7','MAX7'],['MAX7','EK7']]){
    const h=harness();
    assert.equal(await h.run({...input,platforms:names}),true);
    const count=new Set(names).size||3;
    assert.equal(h.state.calls.length,count);
    assert.equal(h.state.stored.data.payloads.length,count);
    assert.equal(timeTotals(h.state.stored.data.payloads.flatMap(p=>p.payload.rows)).success_count,count*2);
    assert.equal(h.state.stored.data.selection.platforms.length,names.length?count:0);
    assert.deepEqual(h.state.stored.data.selection.platforms,[...new Set(names)],'applied selection preserves click order so the pending-filter label clears');
    assert.equal(h.state.busy,false);assert.equal(h.state.error,'');
    for(const body of h.state.calls){
      assert.equal(body.p_start_at,'2026-09-17T12:30:00.000Z');
      assert.equal(body.p_end_at,'2026-09-17T18:30:00.000Z');
      assert.equal(body.p_member_id,null);assert.equal(body.p_order_number,null);assert.equal(body.p_status,'all');
      assert.ok(catalog.slice(0,3).some(p=>p.id===body.p_platform));
    }
  }
});

test('default partial-hour query reads only directory-authorized available detail platforms',async()=>{
  for(const mode of ['created','success']){
    const h=harness({mode});
    assert.equal(await h.run({...input,availablePlatforms:['EK7','91CLUB']}),true);
    assert.equal(h.state.calls.length,1);
    assert.ok(h.state.calls.every(body=>body.p_platform===catalog[0].id));
    assert.deepEqual(h.state.stored.data.selection.platforms,[],'empty means the user kept default all, not an invented explicit selection');
    assert.deepEqual(h.state.stored.data.selection.availablePlatforms,['EK7','91CLUB']);
    assert.deepEqual(h.state.stored.data.payloads.map(item=>item.id),[catalog[0].id]);
  }
});

test('missing directory intersections and unsupported explicit choices never fall back to all platforms',async()=>{
  for(const selection of [
    {...input,availablePlatforms:[]},
    {...input,availablePlatforms:['91CLUB']},
    {...input,availablePlatforms:['EK7'],platforms:['MAX7']},
    {...input,availablePlatforms:['EK7','91CLUB'],platforms:['EK7','91CLUB']},
  ]){
    const h=harness();
    assert.equal(await h.run(selection),false);
    assert.equal(h.state.calls.length,0);assert.equal(h.state.stored,'previous');assert.ok(h.state.error);
  }
});

test('success-time multi query retains separate optional creation bounds on every shard',async()=>{
  const h=harness({mode:'success',createdStart:'2026-09-01T00:00:00',createdEnd:'2026-09-16T23:59:59'});
  assert.equal(await h.run({...input,platforms:['EK7','MAX7']}),true);
  assert.equal(h.state.calls.length,2);
  for(const body of h.state.calls){
    assert.equal(body.p_basis,'success');
    assert.equal(body.p_created_start,'2026-08-31T18:30:00.000Z');
    assert.equal(body.p_created_end,'2026-09-16T18:30:00.000Z');
  }
});

test('selection, scope and date validation reject the entire query before an order request',async()=>{
  for(const [overrides,selection] of [
    [{}, {...input,platforms:['EK7','UNKNOWN']}],
    [{}, {...input,platforms:['EK7','66GAME']}],
    [{platforms:[...catalog,platform(6,'EK7')]}, input],
    [{optionsLoading:true},input],
    [{optionsError:'catalog failed'},input],
    [{}, {...input,start:'2026-09-19T00:00:00'}],
    [{}, {...input,start:'2026-08-01T00:00:00'}],
  ]){
    const h=harness(overrides);
    assert.equal(await h.run(selection),false);assert.equal(h.state.calls.length,0);
    assert.equal(h.state.stored,'previous');assert.ok(h.state.error);
  }
});

test('one platform failure discards completed siblings, while authorization denial also clears prior results',async()=>{
  for(const failure of [new Error('network failed'),Object.assign(new Error('denied'),{code:'42501'}),Object.assign(new Error('denied'),{status:403})]){
    let calls=0;
    const h=harness({orderTimeRpc:async(_session,_name,body)=>{
      calls++;if(body.p_platform===catalog[1].id)throw failure;return payload(body);
    }});
    assert.equal(await h.run({...input,direction:'代收'}),false);
    assert.ok(calls>=2);
    const clear=isOrderQueryDenied(failure);
    assert.equal(h.state.stored,clear?null:'previous');assert.equal(h.state.active,!clear);assert.equal(h.state.cleared,clear);
    assert.equal(h.state.busy,false);
  }
});

test('an identity change during a multi-platform query prevents publishing the completed result',async()=>{
  const identity={current:'viewer'};
  const h=harness({currentIdentity:identity,orderTimeRpc:async(_session,_name,body)=>{identity.current='different-viewer';return payload(body);}});
  assert.equal(await h.run(input),false);assert.equal(h.state.stored,'previous');
});

test('a new query aborts an unfinished all-platform query and only publishes the new selection',async()=>{
  let firstStarted;
  const started=new Promise(resolve=>firstStarted=resolve);
  const h=harness({orderTimeRpc:async(_session,_name,body)=>{
    if(body.p_start_at==='2026-09-17T12:30:00.000Z'){firstStarted();return new Promise(()=>{});}
    return payload(body);
  }});
  const first=h.run(input);await started;
  assert.equal(await h.run({...input,start:'2026-09-17T19:00:00',platforms:['MAX7']}),true);
  assert.equal(await first,false);
  assert.equal(h.state.stored.data.payloads.length,1);
  assert.equal(h.state.stored.data.payloads[0].id,catalog[2].id);
  assert.equal(h.state.stored.data.selection.start,'2026-09-17T19:00:00');
});
