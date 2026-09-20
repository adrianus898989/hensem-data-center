const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const test=require('node:test');
const {loadTs,root}=require('./load-typescript.cjs');
function loadEdge(entry){
  const cache=new Map();
  function load(file){
    if(cache.has(file))return cache.get(file).exports;
    const m={exports:{}};cache.set(file,m);
    const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function('require','module','exports',code)(s=>{assert.ok(s.startsWith('.'));return load(path.resolve(path.dirname(file),s));},m,m.exports);
    return m.exports;
  }
  return load(path.join(root,entry));
}
const readers=[['app',loadTs(path.join(root,'src/lib/supabaseDashboardServer.ts'))],['edge',loadEdge('supabase/functions/dashboard-api/lib/supabaseDashboardServer.ts')]];
const row=(country_code='IN',platform='DhaniWin')=>({source_system:'AR_WORKORDER',system_name:'AR',stat_date:'2026-09-19',country_code,platform,third_party:'PayA',channel_type:'BANK',submitted_count:2,submitted_amount:200,success_count:1,success_amount:100});
async function fixture(options,run){
  const oldFetch=global.fetch,oldDeno=global.Deno,calls=[];
  global.Deno={env:{get:name=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'synthetic-anon'})[name]}};
  global.fetch=async(input,init={})=>{
    const url=new URL(input);calls.push({url,init});
    assert.equal(init.headers.Authorization,'Bearer synthetic-session');assert.equal(init.headers.apikey,'synthetic-anon');
    if(url.pathname==='/auth/v1/user')return Response.json({id:'synthetic'});
    if(url.pathname==='/rest/v1/dashboard_profiles')return Response.json([{auth_user_id:'synthetic',username:'test',active:true,role:'viewer',permissions:{third_party:options.allowed!==false},data_scope:options.scope||{mode:'all',countries:[]}}]);
    assert.equal(url.pathname,'/rest/v1/workorder_deposit_daily');assert.equal(init.method,undefined);assert.equal(init.cache,'no-store');assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(url.searchParams.getAll('stat_date'),['gte.2026-09-19','lte.2026-09-19']);assert.equal(url.searchParams.get('source_system'),'eq.AR_WORKORDER');
    assert.ok(!url.searchParams.get('select').includes('*'));
    options.onFetch?.(init);
    return options.response?options.response(url):Response.json(options.rows||[row(),row('PK','POPZAR'),{...row(),stat_date:'2026-09-18'},{...row(),source_system:'OTHER'}]);
  };
  try{await run(calls);}finally{global.fetch=oldFetch;global.Deno=oldDeno;}
}
const req=signal=>new Request('https://dashboard.invalid/api/third-party-workorder-metrics',{headers:{Authorization:'Bearer synthetic-session'},signal});
for(const [name,server] of readers){
  const read=(request=req(),start='2026-09-19',end=start,country='印度')=>server.readSupabaseThirdPartyWorkOrderMetrics(request,start,end,country);
  test(name+': independent daily workorders never fetch payment totals; country/date/source are rechecked',async()=>{
    await fixture({},async calls=>{const result=await read();assert.equal(calls.length,3);assert.deepEqual(result,{basis:'daily',start:'2026-09-19',end:'2026-09-19',country:'印度',rows:[row()]});});
  });
  test(name+': anonymous/module/scope failures do not access aggregates',async()=>{
    await fixture({},async calls=>{await assert.rejects(()=>read(new Request('https://dashboard.invalid')),e=>e.status===401);assert.equal(calls.length,0);});
    for(const options of [{allowed:false},{scope:{mode:'selected',countries:['PK']}}])await fixture(options,async calls=>{await assert.rejects(()=>read(),e=>e.status===403);assert.equal(calls.length,2);});
    await fixture({scope:{mode:'selected',countries:['IN']}},async()=>assert.equal((await read()).rows.length,1));
  });
  test(name+': invalid ranges are rejected, malformed/partial data never becomes zero',async()=>{
    for(const [start,end] of [['2026-02-30','2026-03-01'],['2026-09-19','2026-09-18'],['2026-08-01','2026-09-19']])await fixture({},async calls=>{await assert.rejects(()=>read(req(),start,end),e=>e.status===400);assert.equal(calls.length,2);});
    for(const response of [()=>Response.json({}),()=>Response.json([row()],{headers:{'content-range':'0-0/1001'}}),()=>Response.json({error:'private'},{status:500})])await fixture({response},async()=>{await assert.rejects(()=>read(),e=>e.status===503&&!e.message.includes('private'));});
    await fixture({rows:[]},async()=>assert.deepEqual((await read()).rows,[]));
  });
  test(name+': cancellation reaches the underlying request',async()=>{
    const c=new AbortController();await fixture({onFetch:init=>{c.abort();assert.equal(init.signal.aborted,true);}},()=>read(req(c.signal)));
  });
}
test('app and live Edge readers and platform aliases remain identical',()=>{
  const app=fs.readFileSync(path.join(root,'src/lib/supabaseDashboardServer.ts'),'utf8'),edge=fs.readFileSync(path.join(root,'supabase/functions/dashboard-api/lib/supabaseDashboardServer.ts'),'utf8');
  const block=s=>s.slice(s.indexOf('/** Independent daily work-order'),s.indexOf('export async function readSupabaseThirdPartyVolume'));
  assert.equal(block(app),block(edge));
  assert.equal(fs.readFileSync(path.join(root,'src/lib/thirdPartyPlatform.ts'),'utf8'),fs.readFileSync(path.join(root,'supabase/functions/dashboard-api/lib/thirdPartyPlatform.ts'),'utf8'));
  const entry=fs.readFileSync(path.join(root,'supabase/functions/dashboard-api/index.ts'),'utf8');
  assert.ok(entry.indexOf('request.method !== "GET"')<entry.indexOf('route === "/api/third-party-workorder-metrics"'));
});
