const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {test,before,after}=require('node:test');
const {PGlite}=require('@electric-sql/pglite');
const {loadTs,root}=require('./load-typescript.cjs');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20260919174456_third_party_filter_options.sql');
function sqlFunction(source,name,delimiter='$$'){
  const start=source.indexOf('create or replace function '+name+'('),body=source.indexOf('as '+delimiter,start);
  const end=source.indexOf(delimiter+';',body+delimiter.length+3);
  assert.ok(start>=0&&body>start&&end>body);return source.slice(start,end+delimiter.length+1);
}
function loadEdge(entry){
  const cache=new Map();
  function load(file){
    if(cache.has(file))return cache.get(file).exports;
    const module={exports:{}};cache.set(file,module);
    const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function('require','module','exports',output)(s=>{assert.ok(s.startsWith('.'));return load(path.resolve(path.dirname(file),s));},module,module.exports);
    return module.exports;
  }
  return load(path.join(root,entry));
}
const readers=[
  ['app',loadTs(path.join(root,'src/lib/thirdPartyFilterOptionsServer.ts')).readSupabaseThirdPartyFilterOptions],
  ['edge',loadEdge('supabase/functions/dashboard-api/lib/thirdPartyFilterOptionsServer.ts').readSupabaseThirdPartyFilterOptions],
];
let db;
const catalog=async()=>(await db.query('select public.dashboard_third_party_filter_options() data')).rows[0].data;
async function identity(countries=null,permission='true',uid='00000000-0000-4000-8000-000000000001'){
  await db.query("select set_config('test.scope',$1,false),set_config('test.permission',$2,false),set_config('test.uid',$3,false)",[
    JSON.stringify(countries===null?{mode:'all',countries:[]}:{mode:'selected',countries}),permission,uid]);
}
before(async()=>{
  db=new PGlite();
  await db.exec([
    'create schema auth;create schema private;create role anon;create role authenticated;create role service_role;',
    'grant usage on schema auth,private to authenticated;',
    "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;",
    "create function public.dashboard_has_permission(text) returns boolean language sql stable as $$select case current_setting('test.permission',true) when 'true' then $1='third_party' when 'null' then null else false end$$;",
    "create function private.dashboard_current_data_scope() returns jsonb language sql stable as $$select current_setting('test.scope',true)::jsonb$$;",
    'create table public.ar_config_targets(country_name text,country_code text,platform text);',
    'create table public.panda_config_targets(country_name text,country_code text,platform text);',
    'create table public.wg_config_targets(country_name text,country_code text,platform text,members jsonb);',
    'create table public.newar_detail_platforms(country text,country_code text,platform text,enabled boolean);',
    'create table public.game66_platforms(team_code text,team_name text,platform_name text,enabled boolean,base_url text,auth_secret_name text,request_config jsonb);',
    'create table public.third_party_platform_status(country text,platform text,third_party text,status text);',
    // Only two metadata columns exist: any attempt to read volume data fails.
    'create table public.third_party_volume(country text,platform text);',
    'create index idx_tpv_country_platform_date on public.third_party_volume(country,platform);',
  ].join('\n'));
  const scopeSql=read('supabase/migrations/20260912150854_dashboard_account_data_scope.sql');
  const teamSql=read('supabase/migrations/20260916183000_game66_team_dashboard.sql');
  for(const name of ['private.dashboard_data_scope_valid','private.dashboard_data_group'])await db.exec(sqlFunction(teamSql,name));
  await db.exec(sqlFunction(scopeSql,'private.dashboard_scope_allows','$function$'));
  for(const table of ['ar_config_targets','panda_config_targets','wg_config_targets','newar_detail_platforms','game66_platforms','third_party_platform_status','third_party_volume'])
    await db.exec('alter table public.'+table+' enable row level security;revoke all on public.'+table+' from public,anon,authenticated;');
  await db.exec("insert into public.ar_config_targets values ('巴基斯坦','PK','92R'),('巴基斯坦','PK','POPZAR'),('印度','IN','DhaniWin'),('印度','IN','Shree.Win');");
  await db.exec("insert into public.panda_config_targets values ('巴西','BR','VIP345'),('巴西','BR','POPNOV'),('菲律宾','PH','PH19');");
  await db.query('insert into public.wg_config_targets values($1,$2,$3,$4)', ['巴西','BR','26BET',[{name:'26BET',site_code:'hidden'},{name:'POPKKK',site_code:'hidden'},{name:'POPMIU',site_code:'hidden'}]]);
  await db.query('insert into public.wg_config_targets values($1,$2,$3,$4)', ['越南','VN','98VV',[{name:'XX98',site_code:'hidden'}]]);
  await db.exec("insert into public.newar_detail_platforms values ('巴基斯坦','PK','POPZAR',true),('巴基斯坦','PK','92BLAZE',false),('印度','IN','DhaniWin',true);");
  for(const [team,name] of [['hong_kong','EK7'],['hong_kong','GEM7'],['hong_kong','MAX7'],['red_crab','66GAME'],['unverified','WrongTeam']])
    await db.query('insert into public.game66_platforms values($1,$2,$3,false,$4,$5,$6)',[team,team==='hong_kong'?'香港':'红膏蟹',name,'hidden-url','hidden-secret',{secret:'private'}]);
  for(const [country,platform] of [['巴基斯坦','LG789'],['巴基斯坦','92R'],['巴基斯坦','92R'],['印度','SHREEWIN(AR)'],['南美','NPG-CHILE'],['南美','NPG-COLOMBIA'],['南美','NPG-MEXICO'],['巴西原生','NativeTest'],['USDT通道','POPZAR'],['胖虎巴西','POPNOV'],['BR','VIP345'],['未知国家','UnknownPlatform']])
    await db.query('insert into public.third_party_platform_status values($1,$2,$3,$4)',[country,platform,'PayA','enabled']);
  await db.exec("insert into public.third_party_volume values ('智利','NPG智利盘口'),('墨西哥','NPG墨西哥盘口'),('哥伦比亚','NPG哥伦比亚盘口'),('巴西原生','LegacyNative'),('印度','LegacyOnly'),(null,'SkipNull'),('印度',null);");
  await db.exec("insert into public.third_party_volume select '智利','NPG智利盘口' from generate_series(1,1000);");
  await db.exec(migration);await identity();
});
after(async()=>{if(db)await db.close();});
test('catalog needs no dates or transactions, includes paused registered platforms and WG members',async()=>{
  const result=await catalog(),has=(country,platform)=>result.platforms.some(r=>r.country===country&&r.platform===platform);
  for(const platform of ['92R','POPZAR','92BLAZE','LG789'])assert.ok(has('巴基斯坦',platform));
  for(const platform of ['EK7','GEM7','MAX7'])assert.ok(has('香港',platform));
  assert.ok(has('红膏蟹','66GAME'));assert.ok(has('印度','DhaniWin'));assert.ok(has('巴西','POPKKK'));assert.ok(has('巴西','POPMIU'));assert.ok(has('越南','XX98'));
  assert.equal(result.platforms.filter(r=>r.country==='巴基斯坦'&&r.platform==='92R').length,1);
  assert.ok(result.platforms.every(row=>Object.keys(row).sort().join(',')==='country,platform'));
  assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!JSON.stringify(result).includes('WrongTeam'));
  assert.ok(has('智利','NPG智利盘口'));assert.ok(has('墨西哥','NPG墨西哥盘口'));assert.ok(has('哥伦比亚','NPG哥伦比亚盘口'));
  assert.ok(has('巴西原生','LegacyNative'));assert.ok(has('印度','LegacyOnly'));
  assert.equal(result.platforms.filter(r=>r.platform==='NPG智利盘口').length,1);
  // No order/snapshot table exists, and legacy metadata has no metric columns.
});
test('SQL permissions retain India/HK/Red Crab, Brazil splits and existing NPG mapping',async()=>{
  const countries={HK_TEAM:'香港',RED_CRAB:'红膏蟹',IN:'印度',PK:'巴基斯坦',BR:'巴西',BR_PANGHU:'胖虎巴西',CO:'哥伦比亚',MX:'墨西哥',CL:'智利',BR_NATIVE:'巴西原生',USDT:'USDT通道'};
  for(const [key,country] of Object.entries(countries)){await identity([key]);const result=await catalog();assert.ok(result.platforms.length,key);assert.ok(result.platforms.every(row=>row.country===country),key);}
  await identity(['BR']);assert.ok((await catalog()).platforms.some(r=>r.platform==='POPNOV'));assert.ok(!(await catalog()).platforms.some(r=>r.platform==='VIP345'));
  await identity(['BR_PANGHU']);assert.ok((await catalog()).platforms.some(r=>r.platform==='VIP345'));assert.ok(!(await catalog()).platforms.some(r=>r.platform==='POPNOV'));await identity();
});
test('third_party-only authenticated can read RPC but cannot read protected source tables',async()=>{
  await identity(['PK']);await db.exec('set role authenticated');
  try{assert.ok((await catalog()).platforms.some(r=>r.platform==='92R'));
    for(const table of ['ar_config_targets','game66_platforms','third_party_platform_status','third_party_volume'])await assert.rejects(()=>db.query('select * from public.'+table),/permission denied/);
  }finally{await db.exec('reset role');await identity();}
});
test('anonymous, no UID, missing/null module grant and malformed/empty scope fail closed',async()=>{
  await db.exec('set role anon');try{await assert.rejects(()=>catalog(),/permission denied/);}finally{await db.exec('reset role');}
  await identity(null,'true','');await assert.rejects(()=>catalog(),/请先登录/);
  for(const grant of ['false','null']){await identity(null,grant);await assert.rejects(()=>catalog(),/没有查询权限/);}
  await identity([]);assert.deepEqual(await catalog(),{platforms:[]});
  await identity();await db.query("select set_config('test.scope','{}',false)");assert.deepEqual(await catalog(),{platforms:[]});await identity();
});
test('fixed search_path/private definer/public invoker, no source-table ACL changes or historic metrics',async()=>{
  const rows=(await db.query("select n.nspname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='dashboard_third_party_filter_options' order by n.nspname")).rows;
  assert.deepEqual(rows.map(r=>[r.nspname,r.prosecdef]),[['private',true],['public',false]]);
  assert.ok(rows.every(r=>r.proconfig.includes('search_path=""')));
  assert.ok(!/\bgrant\s+(select|all)\s+on\s+(table\s+)?public\./i.test(migration));
  const sqlWithoutComments=migration.replace(/--[^\n]*/g,'');
  assert.ok(!/\b(game66_(charge|withdraw)_orders|newar_detail_records|newar_business_snapshots|data_date|amount|success_count)\b/.test(sqlWithoutComments));
  assert.match(migration,/where \(country,platform\) > \(previous.country,previous.platform\)/);
  assert.match(migration,/order by country,platform limit 1/);
});
test('bounded legacy index catalog reports overflow instead of claiming truncated completeness',async()=>{
  await identity();
  await db.exec("insert into public.third_party_volume select '巴基斯坦','SafetyOverflow-'||lpad(n::text,5,'0') from generate_series(1,10001) n;");
  try{await assert.rejects(()=>catalog(),/平台目录超出安全上限/);}
  finally{await db.exec("delete from public.third_party_volume where platform like 'SafetyOverflow-%'");}
});
const metadata={platforms:[{country:'巴基斯坦',platform:'92R',config:'never expose'},{country:'巴基斯坦',platform:'92BLAZE'},{country:'香港',platform:'EK7'},{country:'红膏蟹',platform:'66GAME'},{country:'印度',platform:'SHREEWIN(AR)'},{country:'印度',platform:'Shree.Win'},{country:'巴西',platform:'VIP345'},{country:'胖虎巴西',platform:'POPNOV'}],private:'never expose'};
async function httpFixture(options,run){
  const oldFetch=global.fetch,oldDeno=global.Deno,names=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_URL','SUPABASE_ANON_KEY'],oldEnv=names.map(n=>process.env[n]),calls=[];
  const env={SUPABASE_URL:'https://catalog.invalid',SUPABASE_ANON_KEY:'synthetic-anon'};
  for(const name of names)process.env[name]=env[name.replace('NEXT_PUBLIC_','')];global.Deno={env:{get:name=>env[name]}};
  global.fetch=async(input,init={})=>{
    const url=new URL(input);calls.push(url.pathname);assert.equal(init.headers.Authorization,'Bearer session-only');assert.equal(init.headers.apikey,'synthetic-anon');assert.equal(init.cache,'no-store');
    if(url.pathname==='/auth/v1/user')return Response.json({id:'synthetic-user'});
    if(url.pathname==='/rest/v1/dashboard_profiles')return Response.json([{auth_user_id:'synthetic-user',username:'synthetic',role:'viewer',active:options.active!==false,permissions:{third_party:options.allowed!==false,auto_withdraw:false},data_scope:options.scope||{mode:'all',countries:[]}}]);
    assert.equal(url.pathname,'/rest/v1/rpc/dashboard_third_party_filter_options');assert.equal(init.body,'{}');assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.ok(init.signal instanceof AbortSignal);
    if(options.onFetch)options.onFetch(init);
    return options.response?options.response():Response.json(options.payload===undefined?metadata:options.payload);
  };
  try{await run(calls);}finally{global.fetch=oldFetch;global.Deno=oldDeno;names.forEach((name,i)=>{if(oldEnv[i]===undefined)delete process.env[name];else process.env[name]=oldEnv[i];});}
}
const request=()=>new Request('https://dashboard.invalid/api/third-party-filter-options?start=1999-01-01',{headers:{Authorization:'Bearer session-only'}});
for(const [name,reader] of readers){
  test(name+': India fee headings and uploaded platforms share one directory identity',async()=>{
    const payload={platforms:['BIG(AR)','BIGMUMBAI','INDIA82(AR)','82LOTTERY'].map(platform=>({country:'印度',platform}))};
    payload.platforms.push({country:'越南',platform:'BIG'});
    await httpFixture({payload},async()=>{
      const result=await reader(request());
      assert.deepEqual(result.platforms.filter(p=>p.country==='印度').map(p=>p.platform),['82LOTTERY','BIGMUMBAI']);
      assert.ok(result.platforms.some(p=>p.country==='越南'&&p.platform==='BIG'));
    });
  });
  test(name+': one independent RPC, canonical aliases, minimal projection and correct display groups',async()=>{
    await httpFixture({},async calls=>{
      const result=await reader(request());assert.equal(calls.length,3);assert.ok(result.platforms.some(r=>r.country==='香港'&&r.platform==='EK7'));
      assert.ok(result.platforms.some(r=>r.country==='胖虎巴西'&&r.platform==='VIP345'));assert.ok(result.platforms.some(r=>r.country==='巴西'&&r.platform==='POPNOV'));
      assert.equal(result.platforms.filter(r=>r.platform==='ShreeWin').length,1);assert.ok(!JSON.stringify(result).includes('never expose'));assert.deepEqual(Object.keys(result),['platforms']);
    });
  });
  test(name+': scope recheck removes foreign rows; module denial never fetches metadata',async()=>{
    await httpFixture({scope:{mode:'selected',countries:['PK']}},async()=>{const result=await reader(request());assert.deepEqual(result.platforms.map(r=>r.platform),['92BLAZE','92R']);});
    for(const options of [{allowed:false},{active:false}])await httpFixture(options,async calls=>{await assert.rejects(()=>reader(request()),e=>e.status===403);assert.equal(calls.length,2);});
    await httpFixture({},async calls=>{await assert.rejects(()=>reader(new Request('https://dashboard.invalid')),e=>e.status===401);assert.equal(calls.length,0);});
  });
  test(name+': unavailable/malformed catalog is an explicit error, not empty fallback',async()=>{
    for(const payload of [null,{}, {platforms:null},{platforms:[{country:'PK'}]}, {platforms:[{country:'PK',platform:'invalid\ntext'}]}])
      await httpFixture({payload},async()=>{await assert.rejects(()=>reader(request()),e=>e.status===503);});
    for(const status of [401,403,500])await httpFixture({response:()=>Response.json({message:'private'},{status})},async()=>{await assert.rejects(()=>reader(request()),e=>e.status===(status===500?503:status)&&!e.message.includes('private'));});
    await httpFixture({payload:{platforms:[]}},async()=>assert.deepEqual(await reader(request()),{platforms:[]}));
  });
  test(name+': cancellation is forwarded and fresh requests revalidate permissions',async()=>{
    const controller=new AbortController();
    await httpFixture({onFetch:init=>{controller.abort();assert.equal(init.signal.aborted,true);}},async()=>{await reader(new Request('https://dashboard.invalid',{headers:{Authorization:'Bearer session-only'},signal:controller.signal}));});
    await httpFixture({},async calls=>{await reader(request());await reader(request());assert.equal(calls.filter(p=>p==='/rest/v1/dashboard_profiles').length,2);});
  });
}
test('Edge routing uses GET/private headers; production reader mirrors app source',()=>{
  const entry=read('supabase/functions/dashboard-api/index.ts');
  assert.match(entry,/route === "\/api\/third-party-filter-options"\) return json\(await readSupabaseThirdPartyFilterOptions\(request\)\)/);
  assert.ok(entry.indexOf('request.method !== "GET"')<entry.indexOf('route === "/api/third-party-filter-options"'));
  assert.match(entry,/"Cache-Control": "private, no-store/);
  assert.equal(read('supabase/functions/dashboard-api/lib/thirdPartyFilterOptionsServer.ts').replace(/from "(\.\/[^"]+)\.ts"/g,'from "$1"'),read('src/lib/thirdPartyFilterOptionsServer.ts'));
  assert.equal(read('supabase/functions/dashboard-api/lib/thirdPartyPlatform.ts'),read('src/lib/thirdPartyPlatform.ts'));
});
