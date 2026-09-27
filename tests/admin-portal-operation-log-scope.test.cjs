// Fresh authorization and scope fixtures only. No network or real identities.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');let db;
const uid='10000000-0000-4000-8000-000000000001';
const request=(candidates,country='印度')=>({country,candidates});
const call=async q=>(await db.query('select public.dashboard_admin_live_portal_log_scope($1::jsonb) value',[JSON.stringify(q)])).rows[0].value;
const scope=async groups=>{await db.exec('reset role');await db.query('update dashboard_profiles set data_scope=$1,active=true,role=\'viewer\'',[JSON.stringify(groups)]);await db.exec('set role authenticated');};
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema private;create schema auth;grant usage on schema auth to authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table dashboard_profiles(auth_user_id uuid primary key,role text,active boolean,data_scope jsonb);
 create table dashboard_admin_preview_grants(auth_user_id uuid primary key,can_view boolean);
 create function private.dashboard_current_data_scope() returns jsonb language sql stable as $$select data_scope from public.dashboard_profiles where auth_user_id=auth.uid()$$;
 create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable as $$select case when jsonb_typeof(s)='array' then s ? c else s->c ? p end$$;
 create table native_catalog(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text);
 create function private.dashboard_admin_live_platforms() returns setof native_catalog language sql stable security definer set search_path='' as $$select * from public.native_catalog$$;
 insert into dashboard_profiles values('${uid}','viewer',true,'["IN"]');insert into dashboard_admin_preview_grants values('${uid}',true);
 insert into native_catalog(name,team,country,scope_group,source,source_name) values
 ('Same','M8','印度','IN','ar','Same'),('Same','香港','香港','HK_TEAM','game66','Same'),('Crab','红膏蟹','红膏蟹','RED_CRAB','game66','Crab'),
 ('RAJA','M8','印度','IN','ar','RAJA'),('VeerGame','M8','印度','IN','ar','Veer.Game'),('Brazil','M8','巴西','BR','ar','Brazil');`);
 const live=fs.readFileSync(path.join(__dirname,'../supabase/admin-live-query.sql'),'utf8'),start=live.indexOf('create function private.dashboard_admin_live_scope()'),end=live.indexOf('revoke all on function private.dashboard_admin_live_scope()',start);
 await db.exec(live.slice(start,end));await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/admin-live-portal-operation-logs.sql'),'utf8'));
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated');
});
after(async()=>db?.close());
test('same display country/name cannot cross original HK or Red Crab scope; candidate authority is not trusted',async()=>{
 await scope(['IN']);const q=request([{team:'M8',platform:'Same'},{team:'香港',platform:'Same'},{team:'红膏蟹',platform:'Crab'},{team:'Forged',platform:'Same'},{team:'M8',platform:'Missing'},{team:'M8',platform:'Brazil'}]);
 assert.deepEqual((await call(q)).pairs,[{team:'M8',platform:'Same'}]);await scope(['HK_TEAM']);assert.deepEqual((await call(q)).pairs,[{team:'香港',platform:'Same'}]);await scope(['RED_CRAB']);assert.deepEqual((await call(q)).pairs,[{team:'红膏蟹',platform:'Crab'}]);
});
test('fresh disable, preview-grant revocation, missing profile and absent authentication deny immediately',async()=>{
 await scope(['IN']);await db.exec('reset role;update dashboard_profiles set active=false;set role authenticated;');await assert.rejects(()=>call(request([])),/preview_denied/);
 await scope(['IN']);await db.exec('reset role;update dashboard_admin_preview_grants set can_view=false;set role authenticated;');await assert.rejects(()=>call(request([])),/preview_denied/);
 await db.exec("reset role;update dashboard_admin_preview_grants set can_view=true;set role authenticated;select set_config('request.jwt.claim.sub','',false)");await assert.rejects(()=>call(request([])),/login_required/);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",['10000000-0000-4000-8000-000000000002']);await assert.rejects(()=>call(request([])),/preview_denied/);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
});
test('raw/display names and only exact confirmed RAJA alias retain scope; punctuation is not guessed',async()=>{
 await scope(['IN']);const pairs=(await call(request([{team:'M8',platform:'RAJALOTTERY'},{team:'M8',platform:'RAJA'},{team:'M8',platform:'Veer.Game'},{team:'M8',platform:'VEER-GAME'},{team:'香港',platform:'RAJALOTTERY'},{team:'M8',platform:'Same'},{team:'M8',platform:'Same'}]))).pairs;
 assert.deepEqual(pairs.map(p=>p.platform),['RAJA','RAJALOTTERY','Same','Veer.Game']);
});
test('body is strict and bounded; anon has no execute privilege',async()=>{
 for(const q of [null,{},request([], '巴西'),{...request([]),scope:['all']},request([{team:'M8',platform:'Same',all:true}]),request([{team:'M8',platform:''}]),request(Array.from({length:1001},()=>({team:'M8',platform:'Same'})))])await assert.rejects(()=>call(q),/invalid_/);
 assert.equal((await db.query("select has_function_privilege('anon','public.dashboard_admin_live_portal_log_scope(jsonb)','execute') value")).rows[0].value,false);
 assert.equal((await db.query("select has_function_privilege('anon','private.dashboard_admin_live_portal_log_scope(jsonb)','execute') value")).rows[0].value,false);
 assert.equal((await db.query("select prosecdef from pg_proc where oid='public.dashboard_admin_live_portal_log_scope(jsonb)'::regprocedure")).rows[0].prosecdef,false);
});

test('per-platform scope remains exact even when full original country is visible',async()=>{
 await scope({IN:['Same']});const r=await call(request([{team:'M8',platform:'Same'},{team:'M8',platform:'RAJA'},{team:'香港',platform:'Same'}]));assert.deepEqual(r.pairs,[{team:'M8',platform:'Same'}]);
});
