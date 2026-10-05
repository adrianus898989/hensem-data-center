// A real router migration plus synthetic authorized catalogs. Deliberately no
// collected-workorder or registration tables: the directory cannot scan them.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');let db,baseline,wrapper,registration;
const read=n=>fs.readFileSync(path.join(__dirname,'../supabase',n),'utf8');
const ddl=read('migrations/20261005141809_workorder_reconciliation_platform_directory.sql');
const migration=ddl.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
const request={view:'missing',operation:'reconciliationPlatforms',country:'IN',filters:{dateBasis:'submission',issueKind:'deposit'}};
const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
const call=(patch={})=>scalar('select public.dashboard_admin_live_workorder_records($1)',[{...request,...patch}]);
const proc=name=>scalar('select to_jsonb(p) from pg_proc p where p.oid=$1::regprocedure',[name]);
const rejects=async(fn,pattern)=>{await db.exec('savepoint expected_error');await assert.rejects(fn,pattern);await db.exec('rollback to savepoint expected_error;release savepoint expected_error')};
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql as $$begin if current_setting('test.denied',true)='yes' then raise exception 'preview_denied';end if;return '{"mode":"fixture"}'::jsonb;end$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql as $$select $2='IN' and $3<>'HIDDEN' and (coalesce(current_setting('test.authorized_platform',true),'')='' or $3=current_setting('test.authorized_platform',true))$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select case upper(btrim($1)) when 'RAJA' then 'RAJALOTTERY' when 'RAJAGAME' then 'RAJALOTTERY' when '82BET' then '82LOTTERY' when 'OK.WIN' then 'OKWIN' else upper(btrim($1)) end$$;
 create function private.dashboard_admin_live_deposit_platform_key(text,text) returns text language sql immutable as $$select private.dashboard_admin_live_withdraw_key($2)$$;
 create table private.test_catalog(source_name text,name text,scope_group text,country text,currency text,source text,team text default 'M8');
 insert into private.test_catalog(source_name,name,scope_group,country,currency,source,team) values
 ('RAJA','RAJALOTTERY','IN','印度','INR','ar','M8'),('RAJALOTTERY','RAJALOTTERY','IN','印度','INR','ar','M8'),
 ('OTHER','OTHER','IN','印度','INR','ar','OTHER-TEAM'),('HIDDEN','HIDDEN','IN','印度','INR','ar','M8'),
 ('DhaniWin','DHANIWIN','IN','印度','INR','newar','M8'),('MAANWIN','MAAN.WIN','IN','印度','INR','newar','M8'),
 ('INACTIVE','INACTIVE','IN','印度','INR','newar','M8'),('NOTREGISTERED','NOTREGISTERED','IN','印度','INR','newar','M8'),
 ('PK-NAME','PK-NAME','PK','巴基斯坦','PKR','ar','M8'),('WRONGCOUNTRY','WRONGCOUNTRY','IN','巴基斯坦','INR','ar','M8'),
 ('OTHER-SYSTEM','OTHER-SYSTEM','IN','印度','INR','wg','M8');
 create function private.dashboard_admin_live_platforms() returns table(source_name text,name text,scope_group text,country text,currency text,source text,team text) language sql as $$select * from private.test_catalog c where coalesce(current_setting('test.authorized_team',true),'')='' or c.team=current_setting('test.authorized_team',true)$$;
 create table public.newar_detail_platforms(platform text primary key,country_code text,country text,currency text,timezone text,enabled boolean,launch_at timestamptz);
 insert into public.newar_detail_platforms values ('DhaniWin','IN','印度','INR','Asia/Kolkata',true,null),('MAANWIN','IN','印度','INR','Asia/Kolkata',true,'2999-10-06T00:00:00Z'),('INACTIVE','IN','印度','INR','Asia/Kolkata',false,null),('NOTREGISTERED','PK','巴基斯坦','PKR','Asia/Karachi',true,null);
 revoke all on public.newar_detail_platforms,private.test_catalog from public,anon,authenticated,service_role;`);
 await db.exec(read('workorder-records/003-admin-read.sql'));
 await db.exec(read('admin-workorder-records-scope-first.sql'));
 await db.exec(read('admin-workorder-records-narrow-page.sql'));
 await db.exec(read('migrations/20260930160000_workorder_team_filter.sql').replaceAll("array['private.dashboard_admin_live_workorder_records(jsonb)','private.dashboard_admin_live_workorder_analysis(jsonb)']","array['private.dashboard_admin_live_workorder_records(jsonb)']"));
 const original=read('migrations/20261005113038_workorder_registration_reconciliation.sql');
 await db.exec(original.slice(original.indexOf('create or replace function private.dashboard_admin_workorder_registration'),original.indexOf('-- Preserve the existing function OID')));
 await db.exec(original.slice(original.indexOf('do $route$'),original.indexOf("notify pgrst,'reload schema'")));
 await db.exec(read('migrations/20261005114818_workorder_registration_route_compatibility.sql'));
 assert.equal(await scalar("select md5(prosrc) from pg_proc where oid='private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure"),'2fb4df122737456d9d5bbd8307786183');
 baseline=await proc('private.dashboard_admin_live_workorder_records(jsonb)');wrapper=await proc('public.dashboard_admin_live_workorder_records(jsonb)');registration=await proc('private.dashboard_admin_workorder_registration(jsonb)');
 await db.exec(ddl);
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));

test('directory is unique canonical authorized source names without touching records or registrations',async()=>{
 const r=await call();assert.deepEqual(r,{ok:true,version:2,operation:'reconciliationPlatforms',view:'missing',country:'印度',countryCode:'IN',currency:'INR',platforms:['DHANIWIN','OTHER','RAJALOTTERY']});
 assert.equal(await scalar("select count(*) from unnest(array['public.ar_workorder_issue_details','public.newar_detail_records','public.admin_deposit_followup_rows','public.admin_deposit_issue_rows']) names(name) where to_regclass(name) is not null"),0);
 assert.deepEqual((await call({country:'印度',filters:{...request.filters,platform:'RAJA'}})).platforms,['RAJALOTTERY']);
 assert.deepEqual((await call({filters:{...request.filters,platform:'HIDDEN'}})).platforms,[]);
 assert.deepEqual((await call({filters:{...request.filters,platform:'all'}})).platforms,r.platforms);
});
test('directory retains physical-source scope and server team authorization before alias canonicalization',async()=>{
 await db.exec("select set_config('test.authorized_platform','RAJA',true)");
 assert.deepEqual((await call()).platforms,['RAJALOTTERY']);
 assert.deepEqual((await call({filters:{...request.filters,platform:'DhaniWin'}})).platforms,[]);
 await db.exec("select set_config('test.authorized_platform','RAJAGAME',true)");
 assert.deepEqual((await call()).platforms,[],'an alias grant cannot invent an authorized source catalog row');
 await db.exec("select set_config('test.authorized_platform','',true);select set_config('test.authorized_team','M8',true)");
 assert.deepEqual((await call()).platforms,['DHANIWIN','RAJALOTTERY']);
 await db.exec("select set_config('test.denied','yes',true)");await rejects(()=>call(),/preview_denied/);
});
test('both sources of the same canonical platform yield one partition and launch eligibility matches the reader',async()=>{
 await db.exec("insert into private.test_catalog values ('RAJAGAME','RAJALOTTERY','IN','印度','INR','newar','M8');insert into public.newar_detail_platforms values ('RAJAGAME','IN','印度','INR','Asia/Kolkata',true,null)");
 assert.deepEqual((await call()).platforms,['DHANIWIN','OTHER','RAJALOTTERY']);
 await db.exec("update public.newar_detail_platforms set launch_at=statement_timestamp()-interval '1 second' where platform='MAANWIN'");
 assert.deepEqual((await call()).platforms,['DHANIWIN','MAANWIN','OTHER','RAJALOTTERY']);
 await db.exec("delete from private.test_catalog");assert.deepEqual((await call()).platforms,[]);
});
test('directory rejects unsupported countries, pages, businesses, detail filters, pagination and malformed JSON',async()=>{
 for(const patch of [{country:'PK'},{country:['IN']},{view:'records'},{view:'orders'},{view:'workload'},{offset:0},{limit:20},{action:'workorderRecords'},{filters:null},{filters:[]},{filters:{}},{filters:{dateBasis:'operation',issueKind:'deposit'}},{filters:{dateBasis:'submission',issueKind:'withdraw'}}])await rejects(()=>call(patch),/invalid_reconciliation_platform|unsupported_reconciliation_platform/);
 for(const extra of [{team:'M8'},{from:'2026-10-01'},{successBasis:'processed'},{registrationStatus:'missing'},{statusCode:'4'},{platform:null},{platform:['RAJA']},{platform:' RAJA '},{platform:'x'.repeat(201)},{platform:'RAJA\n'}])await rejects(()=>call({filters:{...request.filters,...extra}}),/invalid_reconciliation_platform/);
});
test('directory preserves router OID/config/grants, leaves generic helper and wrapper byte-identical, and replays idempotently',async()=>{
 const current=await proc('private.dashboard_admin_live_workorder_records(jsonb)');const {prosrc:oldSource,...oldMeta}=baseline,{prosrc:newSource,...newMeta}=current;
 assert.deepEqual(newMeta,oldMeta);assert.notEqual(newSource,oldSource);
 assert.deepEqual(await proc('public.dashboard_admin_live_workorder_records(jsonb)'),wrapper);
 assert.deepEqual(await proc('private.dashboard_admin_workorder_registration(jsonb)'),registration);
 const helper=await proc('private.dashboard_admin_workorder_reconciliation_platforms(jsonb)');assert.equal(helper.prosecdef,false);assert.equal(helper.provolatile,'s');assert.deepEqual(helper.proconfig,['search_path=""']);assert.equal(helper.proowner,current.proowner);
 assert.equal(await scalar("select count(*) from pg_proc p cross join lateral aclexplode(coalesce(proacl,acldefault('f',proowner))) a where p.oid='private.dashboard_admin_workorder_reconciliation_platforms(jsonb)'::regprocedure and a.grantee<>p.proowner"),0);
 await db.exec(migration);assert.deepEqual(await proc('private.dashboard_admin_live_workorder_records(jsonb)'),current);assert.deepEqual(await proc('private.dashboard_admin_workorder_reconciliation_platforms(jsonb)'),helper);
 await db.exec('set role authenticated');assert.deepEqual((await call()).platforms,['DHANIWIN','OTHER','RAJALOTTERY']);await rejects(()=>scalar('select private.dashboard_admin_workorder_reconciliation_platforms($1)',[request]),/permission denied/);await db.exec('reset role');
 await db.exec('set role anon');await rejects(()=>call(),/permission denied/);await db.exec('reset role');
});
test('replay refuses unexpected router/helper privileges or body drift without rewriting them',async()=>{
 for(const change of [
  'grant execute on function private.dashboard_admin_live_workorder_records(jsonb) to anon',
  'grant execute on function private.dashboard_admin_workorder_reconciliation_platforms(jsonb) to authenticated',
  'alter function private.dashboard_admin_workorder_reconciliation_platforms(jsonb) security definer',
  "alter function private.dashboard_admin_workorder_reconciliation_platforms(jsonb) set search_path=public"
 ]){await db.exec('savepoint drift');await db.exec(change);await rejects(()=>db.exec(migration),/RECONCILIATION_DIRECTORY/);await db.exec('rollback to savepoint drift;release savepoint drift');}
 const source=await scalar("select pg_get_functiondef('private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure)");await db.exec(source.replace('-- registration_reconciliation_v2:','-- unexpected drift:'));
 const changed=await proc('private.dashboard_admin_live_workorder_records(jsonb)');await rejects(()=>db.exec(migration),/RECONCILIATION_DIRECTORY_ROUTER_CHANGED/);assert.deepEqual(await proc('private.dashboard_admin_live_workorder_records(jsonb)'),changed);
});
