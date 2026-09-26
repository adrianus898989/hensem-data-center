// Local synthetic fixtures only. No network, users, JWTs or production data.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_PATH||'@electric-sql/pglite');
const read=name=>fs.readFileSync(path.join(__dirname,'../supabase',name),'utf8');
const sql=read('admin-live-withdraw-team-inheritance.sql');
const fn=(file,name)=>{const src=read(file),start=src.indexOf('create or replace function private.'+name+'('),end=src.indexOf('revoke all on function private.'+name+'(',start);assert(start>=0&&end>start);return src.slice(start,end)};
async function fixture(){const db=new PGlite();await db.exec(`
 create role anon; create role authenticated; create schema private;
 create table public.auto_withdraw_daily(country text,platform text);
 create table public.withdraw_operator_daily(country text,platform text);
 create table public.newar_business_snapshots(country text,platform text,country_code text,kind text,direction text);
 create table public.dashboard_platform_team_map(source_system text,source_country text,source_platform text,platform_name text,team_name text,active boolean default true);
 alter table public.dashboard_platform_team_map enable row level security;
 create function private.dashboard_admin_live_scope() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('test.scope',true),''),'null')::jsonb$$;
 create function private.dashboard_scope_allows(scope jsonb,country text,platform text) returns boolean language sql immutable as $$select scope='null'::jsonb or scope @> jsonb_build_array(jsonb_build_object('country',country,'platform',platform))$$;
 `+fn('admin-live-platform-catalog-map.sql','dashboard_admin_live_is_panghu_platform')+fn('admin-live-platform-catalog-map.sql','dashboard_admin_live_report_country')+fn('admin-live-withdraw-pages.sql','dashboard_admin_live_withdraw_key')+fn('admin-live-deposit-issues.sql','dashboard_admin_live_deposit_platform_key'));
 await db.exec(sql);return db;}
async function add(db,country,platform,team,system='REPORT',sourceCountry=country,active=true){await db.query('insert into public.auto_withdraw_daily values($1,$2)',[country,platform]);if(team!==null)await db.query('insert into public.dashboard_platform_team_map values($1,$2,$3,$3,$4,$5)',[system,sourceCountry,platform,team,active]);}

test('initial report directory inherits only existing active teams while preserving exact legacy identities',async()=>{
 const db=await fixture();try{
  const expected=[];
  for(const name of ['LGBIGWIN','LGPARTY','LGSABONG','SUPERLG','PH19']){await add(db,'菲律宾',name,'M8',name==='PH19'?'PANDA':'LG','PH');expected.push(['菲律宾',name,'M8'])}
  for(const [country,names] of [['印尼',['HOT985','IND666','UANG']],['巴西',['SSSGAME','TGJOGO']],['南美',['NPG-MEXICO','NPG-CHILE','NPG-COLOMBIA']]])for(const name of names){await add(db,country,name,'M8');expected.push([name==='NPG-MEXICO'?'墨西哥':name==='NPG-CHILE'?'智利':name==='NPG-COLOMBIA'?'哥伦比亚':country,name,'M8'])}
  await db.exec("insert into public.withdraw_operator_daily values('LG','SUPERLG'),('菲律宾','SUPERLG');insert into public.auto_withdraw_daily values('胖虎巴西','5C555'),('巴西','5C555');insert into public.dashboard_platform_team_map values('LG','PH','NO_SOURCE','NO_SOURCE','M8',true)");
  const beforeMap=(await db.query('select * from public.dashboard_platform_team_map order by source_country,source_platform')).rows;
  const rows=(await db.query('select * from private.dashboard_admin_live_withdraw_platforms() order by country,name')).rows;
  assert.equal(rows.length,15,'duplicate source records and mappings without source rows must not add catalog identities');
  for(const [country,name,team]of expected)assert.equal(rows.find(r=>r.country===country&&r.name===name)?.team,team);
  assert.equal(rows.find(r=>r.country==='LG').team,'__unassigned__','historical LG label is not Philippines');
  assert.equal(rows.find(r=>r.country==='胖虎巴西').team,'胖虎');
  for(const r of rows){const check=(await db.query("select md5('withdraw:'||$1||':'||$2)::uuid id",[r.country,r.name])).rows[0];assert.equal(r.id,check.id);assert.equal(r.source,'withdraw');assert.equal(r.source_name,r.name)}
  assert.equal(rows.find(r=>r.country==='菲律宾').scope_group,'PH');assert.equal(rows.find(r=>r.country==='胖虎巴西').scope_group,'BR_PANGHU');assert.equal(rows.find(r=>r.country==='菲律宾').timezone,'Asia/Manila');assert.equal(rows.find(r=>r.country==='菲律宾').currency,'PHP');
  assert.deepEqual((await db.query('select * from public.dashboard_platform_team_map order by source_country,source_platform')).rows,beforeMap);
 }finally{await db.close()}
});

test('same-name countries, inactive mappings, source conflicts and unapproved punctuation fail closed',async()=>{
 const db=await fixture();try{
  await add(db,'菲律宾','SAME','M8','LG','PH');await add(db,'印尼','SAME','Other','PANDA','ID');
  await add(db,'菲律宾','INACTIVE','Old','LG','PH',false);await add(db,'菲律宾','CLASH','Team A','LG','PH');
  await db.exec("insert into public.dashboard_platform_team_map values('PANDA','PH','CLASH','CLASH','Team B',true),('LG','PH','VEER-GAME','VEER-GAME','M8',true);insert into public.auto_withdraw_daily values('菲律宾','VEER.GAME')");
  const rows=(await db.query('select country,name,team from private.dashboard_admin_live_withdraw_platforms() order by country,name')).rows;
  assert.equal(rows.length,5);assert.equal(rows.find(r=>r.country==='菲律宾'&&r.name==='SAME').team,'M8');assert.equal(rows.find(r=>r.country==='印尼').team,'Other');
  assert.equal(rows.find(r=>r.name==='CLASH').team,'__team_conflict__');assert.equal(rows.find(r=>r.name==='INACTIVE').team,'__unassigned__');assert.equal(rows.find(r=>r.name==='VEER.GAME').team,'__unassigned__');
 }finally{await db.close()}
});

test('existing scope predicate and private-only execute permissions remain unchanged',async()=>{
 const db=await fixture();try{
  await add(db,'菲律宾','SUPERLG','M8','LG','PH');await add(db,'印尼','SUPERLG','Other','LG','ID');
  await db.query("select set_config('test.scope',$1,false)",[JSON.stringify([{country:'PH',platform:'SUPERLG'}])]);
  assert.deepEqual((await db.query('select country,name,team from private.dashboard_admin_live_withdraw_platforms()')).rows,[{country:'菲律宾',name:'SUPERLG',team:'M8'}]);
  await db.query("select set_config('test.scope','[]',false)");assert.deepEqual((await db.query('select * from private.dashboard_admin_live_withdraw_platforms()')).rows,[]);
  const access=(await db.query("select p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon_execute,has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,(select relrowsecurity from pg_class where oid='public.dashboard_platform_team_map'::regclass) rls from pg_proc p where p.oid='private.dashboard_admin_live_withdraw_platforms()'::regprocedure")).rows[0];
  assert.deepEqual(access,{prosecdef:true,proconfig:['search_path=""'],anon_execute:false,authenticated_execute:false,rls:true});
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/gi)||[]).length,1);assert.doesNotMatch(sql,/\b(?:insert into|update public|delete from|grant execute|alter table|drop function)\b/i);
 }finally{await db.close()}
});
