const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/admin-live-rate-sheet.sql'),'utf8');
const uid='10000000-0000-0000-0000-000000000001';let db;
async function call(request={}){return (await db.query('select public.dashboard_admin_live_rate_sheet($1::jsonb) as value',[JSON.stringify(request)])).rows[0].value;}
async function withProfile(changes,fn){await db.exec('reset role');try{for(const [key,value]of Object.entries(changes))await db.query('update public.test_profile set '+key+'=$1',[value]);await db.exec('set role authenticated');await fn();}finally{await db.exec("reset role;update public.test_profile set active=true,preview=true,third_party=true,scope='all',source_allowed=true;set role authenticated");}}
before(async()=>{
 db=new PGlite();await db.exec(`create schema auth;create schema private;create role authenticated;create role anon;
  grant usage on schema auth,private to authenticated;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
  create table test_profile(active boolean,preview boolean,third_party boolean,scope text,source_allowed boolean);
  insert into test_profile values(true,true,true,'all',true);
  create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable security definer set search_path='' as $$begin
   if auth.uid() is null or not exists(select 1 from public.test_profile where active and preview) then raise exception 'live_access_denied' using errcode='42501';end if;
   return (select jsonb_build_object('mode',scope) from public.test_profile);end$$;
  revoke all on function private.dashboard_admin_live_scope() from public,anon,authenticated;
  create function public.test_original_allowed() returns boolean language sql stable security definer set search_path='' as $$select active and third_party and scope='all' from public.test_profile$$;
  create function public.test_source_allowed() returns boolean language sql stable security definer set search_path='' as $$select source_allowed from public.test_profile$$;
  create table original_sheet_fixture(sheet_id bigint primary key,payload jsonb);
  insert into original_sheet_fixture values(0,'{"kind":"sheet","id":0}'),(2147483647,'{"kind":"sheet","id":2147483647}');
  alter table original_sheet_fixture enable row level security;
  grant select on original_sheet_fixture to authenticated;
  create policy source_read on original_sheet_fixture to authenticated using(public.test_source_allowed());
  create function public.dashboard_original_rate_sheet(p_sheet_id bigint default null) returns jsonb language plpgsql stable security invoker set search_path='' as $$begin
   if auth.uid() is null or public.test_original_allowed() is not true then raise exception 'original_rate_permission_denied' using errcode='42501';end if;
   if p_sheet_id is null then return jsonb_build_object('kind','meta','caller',current_user);end if;
   return (select payload||jsonb_build_object('caller',current_user) from public.original_sheet_fixture where sheet_id=p_sheet_id);end$$;
  revoke all on function public.dashboard_original_rate_sheet(bigint) from public,anon;
  grant execute on function public.dashboard_original_rate_sheet(bigint) to authenticated;
 `);await db.exec(sql);await db.query("select set_config('test.uid',$1,false)",[uid]);await db.exec('set role authenticated');
});
after(async()=>{await db?.close()});
test('adds isolated functions and does not redefine old RPC or policies',()=>{
 assert.doesNotMatch(sql,/create or replace|alter table|create policy|insert into|delete from|update public\./i);
 assert.equal((sql.match(/security definer/g)||[]).length,1);assert.equal((sql.match(/security invoker/g)||[]).length,2);
 assert(sql.includes('public.dashboard_original_rate_sheet(p_sheet_id=>v_sheet_id)'));
});
test('omitted sheetId yields metadata; integer boundaries pass unchanged under authenticated',async()=>{
 assert.deepEqual(await call(),{kind:'meta',caller:'authenticated'});
 for(const id of [0,2147483647])assert.deepEqual(await call({sheetId:id}),{kind:'sheet',id,caller:'authenticated'});
 assert.equal(await call({sheetId:123}),null,'missing original sheet stays unavailable');
});
test('rejects unexpected properties and noninteger/null IDs',async()=>{
 for(const value of [null,[],true,'bad',{sheetId:null},{sheetId:-1},{sheetId:1.5},{sheetId:'0'},{sheetId:true},{sheetId:{}},{sheetId:2147483648},{sheetId:1e100},{sheetId:0,action:'metadata'},{other:'value'}])await assert.rejects(()=>call(value),/invalid_rate_sheet/);
});
test('new independent grant, active profile and Auth must all remain fresh',async()=>{
 await withProfile({preview:false},()=>assert.rejects(()=>call(),/live_access_denied/));
 await withProfile({active:false},()=>assert.rejects(()=>call(),/live_access_denied/));
 await db.query("select set_config('test.uid','',false)");try{await assert.rejects(()=>call(),/live_access_denied/)}finally{await db.query("select set_config('test.uid',$1,false)",[uid]);}
});
test('old third_party and all-scope restrictions still apply in addition to new grant',async()=>{
 await withProfile({third_party:false},()=>assert.rejects(()=>call(),/original_rate_permission_denied/));
 await withProfile({scope:'selected'},()=>assert.rejects(()=>call(),/original_rate_permission_denied/));
 assert.equal((await call()).caller,'authenticated');
});
test('original source RLS remains effective; definer gate cannot expose source rows',async()=>{
 await withProfile({source_allowed:false},async()=>assert.equal(await call({sheetId:0}),null));
 await assert.rejects(()=>db.query('select private.dashboard_admin_live_scope()'),/permission denied/);
 assert.equal((await call({sheetId:0})).id,0);
});
test('anonymous role cannot execute any new entry or access gate',async()=>{
 await db.exec('reset role;set role anon');try{
  await assert.rejects(()=>call(),/permission denied/);
  await assert.rejects(()=>db.query('select private.dashboard_admin_live_rate_sheet_access()'),/permission denied/);
 }finally{await db.exec('reset role;set role authenticated');}
});
