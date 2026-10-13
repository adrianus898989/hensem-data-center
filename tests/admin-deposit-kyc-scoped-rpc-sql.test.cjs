// Real public wrapper/gateway definitions with explicit synthetic policy
// adapters. No JWTs, external calls or production account/data fixtures.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');let db;
const read=n=>fs.readFileSync(path.join(__dirname,'../supabase',n),'utf8');
const patch=read('migrations/20261013114955_deposit_kyc_scoped_rpc.sql');
const tx=s=>s.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
const extract=(s,tag)=>s.split('$'+tag+'$')[1];
const scalar=async(s,p=[])=>Object.values((await db.query(s,p)).rows[0])[0];
const original=read('migrations/20261004081041_deposit_collected_workorder_statistics.sql');
const prior=read('migrations/20261013084816_deposit_collected_indexed_related_records.sql');
const cover=read('migrations/20261013094702_deposit_collected_cover_related_records.sql');
const summaryPatch=read('migrations/20261013102323_deposit_collected_summary_once.sql');
let collected=original.match(/CREATE OR REPLACE FUNCTION private.dashboard_admin_deposit_collected_statistics[\s\S]*?\$collected\$;/)[0];
collected=collected.replace(extract(prior,'old_related'),extract(prior,'new_related')).replace(extract(prior,'old_followups'),extract(prior,'new_followups'));
for(const tag of ['related','seed','projection','newar_tail'])collected=collected.split(extract(cover,'old_'+tag)).join(extract(cover,'new_'+tag));
collected=collected.replace(extract(summaryPatch,'old_stats'),extract(summaryPatch,'new_stats')).replace(' AS $collected$'," SET plan_cache_mode TO 'force_custom_plan' AS $collected$");
const summary=original.match(/CREATE OR REPLACE FUNCTION private.dashboard_admin_deposit_collected_summary[\s\S]*?\$collected_summary\$;/)[0].replace(extract(summaryPatch,'old_summary'),extract(summaryPatch,'new_summary'));
const gateway=read('migrations/20261010071932_submission_member_order_details.sql').match(/CREATE OR REPLACE FUNCTION public.dashboard_admin_execute[\s\S]*?AS \$function\$[\s\S]*?\$function\$/)[0]+';';
const endpoint='public.dashboard_admin_deposit_kyc(jsonb,text)';
const request={section:'kyc',dimension:'platform',country:'印度',platform:'VISIBLE'};
const call=(q=request,page=null)=>scalar('select public.dashboard_admin_deposit_kyc($1,$2)',[q===null?null:JSON.stringify(q),page]);
const rejected=async(fn,pattern)=>{await db.exec('savepoint rejected');await assert.rejects(fn,pattern);await db.exec('rollback to savepoint rejected;release savepoint rejected')};
const deps=()=>scalar("select jsonb_object_agg(oid::text,to_jsonb(f))from pg_proc f where oid in('public.dashboard_admin_deposit_statistics(jsonb)'::regprocedure,'public.dashboard_admin_execute(text,jsonb)'::regprocedure,'private.dashboard_admin_deposit_collected_statistics(jsonb)'::regprocedure,'private.dashboard_admin_deposit_collected_summary(jsonb)'::regprocedure)");
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create schema auth;create role anon;create role authenticated;create role service_role;
 create function auth.uid()returns uuid language sql stable as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
 create function private.dashboard_admin_live_scope()returns jsonb language sql stable as $$select '{}'::jsonb$$;
 create function private.dashboard_admin_deposit_kyc_summary_v2(jsonb)returns jsonb language sql stable as $$select '{}'::jsonb$$;
 create table private.dashboard_role_context_secret(singleton boolean,secret bytea);insert into private.dashboard_role_context_secret values(true,decode('00','hex'));
 create function private.dashboard_role_hmac(text,bytea)returns text language sql stable as $$select 'synthetic-signature'$$;
 create function private.dashboard_role_access()returns jsonb language sql stable as $$select jsonb_build_object('mode','assigned','canView',current_setting('test.actor',true)='assigned','roleId','synthetic','version','1','assignmentVersion','1','permissions',case when current_setting('test.detail',true)='yes' then ' ["deposit_statistics.view","deposit_statistics.query","deposit_statistics.detail"]'::jsonb else '["deposit_statistics.view","deposit_statistics.query"]'::jsonb end)$$;
 create function private.dashboard_role_catalog()returns jsonb language sql stable as $$select '{"pages":[{"id":"deposit_statistics","requests":["depositStatistics"]}]}'::jsonb$$;
 create function private.dashboard_admin_deposit_statistics(p_request jsonb default '{}'::jsonb)returns jsonb language plpgsql stable security definer set search_path=''as $$
 declare actor text:=current_setting('test.actor',true);ctx jsonb;
 begin
  if actor='assigned' then
   ctx:=nullif(current_setting('hensem.dashboard_role_context',true),'')::jsonb;
   if ctx is null or ctx->>'signature'<>'synthetic-signature' or ctx->'payload'->>'page'<>'deposit_statistics' or ctx->'payload'->>'action'<>'depositStatistics' then raise exception using errcode='42501',message='role_gateway_required';end if;
  elsif actor is distinct from 'owner' then raise exception using errcode='42501',message='account_denied';end if;
  if p_request->>'platform' is distinct from 'VISIBLE' then raise exception using errcode='42501',message='scope_denied';end if;
  if p_request ? 'action' then raise exception using errcode='22023',message='invalid_request';end if;
  return jsonb_build_object('request',p_request,'platforms',jsonb_build_array('VISIBLE'),'timeoutInside',current_setting('statement_timeout'));
 end;$$;
 revoke all on function private.dashboard_admin_deposit_statistics(jsonb)from public,anon,service_role;grant usage on schema private to authenticated;grant execute on function private.dashboard_admin_deposit_statistics(jsonb)to authenticated;
 create or replace function public.dashboard_admin_deposit_statistics(p_request jsonb default '{}'::jsonb)returns jsonb language sql stable security invoker set search_path=''as $$select private.dashboard_admin_deposit_statistics(p_request);$$;
 revoke all on function public.dashboard_admin_deposit_statistics(jsonb)from public,anon;grant execute on function public.dashboard_admin_deposit_statistics(jsonb)to authenticated,service_role;`);
 await db.exec(collected);await db.exec(summary);await db.exec('revoke all on function private.dashboard_admin_deposit_collected_statistics(jsonb),private.dashboard_admin_deposit_collected_summary(jsonb)from public,anon,authenticated,service_role');
 await db.exec(gateway);await db.exec('revoke all on function public.dashboard_admin_execute(text,jsonb)from public,anon,service_role;grant execute on function public.dashboard_admin_execute(text,jsonb)to authenticated');
 for(const [identity,hash]of [['public.dashboard_admin_deposit_statistics(jsonb)','c7ec858ca1a3a08edc0f4960c949ee2c'],['public.dashboard_admin_execute(text,jsonb)','212a33785c64b3266f4eb84de8b0492b'],['private.dashboard_admin_deposit_collected_statistics(jsonb)','47a0a1b59aa96bda3ee6e91e5fe022b1'],['private.dashboard_admin_deposit_collected_summary(jsonb)','e7e1ba1ca1d4af4f39918283c215b125']])assert.equal(await scalar('select md5(prosrc)from pg_proc where oid=$1::regprocedure',[identity]),hash);
});
after(async()=>db?.close());beforeEach(async()=>db.exec("begin;select set_config('test.actor','owner',true);select set_config('test.detail','no',true)"));afterEach(async()=>db.exec('rollback'));
test('owner direct route is exact old public result; local function setting restores caller',async()=>{
 await db.exec(tx(patch));await db.exec("set local statement_timeout='8s';set local role authenticated");
 const a=await call(),b=await scalar('select public.dashboard_admin_deposit_statistics($1)',[JSON.stringify(request)]);
 assert.deepEqual(a.request,b.request);assert.deepEqual(a.platforms,b.platforms);assert.equal(a.timeoutInside,'20s');assert.equal(b.timeoutInside,'8s');assert.equal(await scalar('show statement_timeout'),'8s');
 await rejected(()=>call({...request,platform:'PRIVATE'}),/scope_denied/);
});
test('assigned delegates the real signed gateway; direct route, missing detail and forbidden user stay denied',async()=>{
 await db.exec(tx(patch));await db.exec("select set_config('test.actor','assigned',true);set local role authenticated");
 const a=await call(request,'deposit_statistics');assert.deepEqual(a.request,request);assert.deepEqual(a.platforms,['VISIBLE']);assert.equal(await scalar("select coalesce(current_setting('hensem.dashboard_role_context',true),'')"),'');
 await rejected(()=>call(),/role_gateway_required/);await rejected(()=>call({...request,dimension:'orders'},'deposit_statistics'),/role_permission_denied/);
 await db.exec("select set_config('test.detail','yes',true)");assert.equal((await call({...request,dimension:'orders'},'deposit_statistics')).request.dimension,'orders');
 await rejected(()=>call({...request,platform:'PRIVATE'},'deposit_statistics'),/scope_denied/);await db.exec("select set_config('test.actor','forbidden',true)");await rejected(()=>call(request,'deposit_statistics'),/assigned_role_required/);await rejected(()=>call(),/account_denied/);
});
test('null/nonobject/non-KYC/action/page inputs cannot invoke another operation',async()=>{
 await db.exec(tx(patch));
 for(const q of [null,[],true,{}, {section:null},{section:1},{section:'details'},{section:'KYC'},{section:'kyc',action:'withdrawNote'},{section:'kyc',action:null},{section:'kyc',action:[]},{section:'kyc',action:'configurationWrite'}])await rejected(()=>call(q),/invalid_kyc_(request|action)/);
 for(const page of ['','overview','withdraw_operators','deposit_statistics ','DEPOSIT_STATISTICS'])await rejected(()=>call(request,page),/invalid_kyc_page/);
 await db.exec("select set_config('test.actor','assigned',true);set local role authenticated");assert.deepEqual((await call({...request,action:'depositStatistics'},'deposit_statistics')).request,request);
});
test('service assigned path and anon stay denied; no grant to original gateway is added',async()=>{
 await db.exec(tx(patch));await db.exec('set local role service_role');await rejected(()=>call(request,'deposit_statistics'),/permission denied for function dashboard_admin_execute/);await db.exec('reset role;set local role anon');await rejected(()=>call(),/permission denied for function dashboard_admin_deposit_kyc/);await db.exec('reset role');
 assert.equal(await scalar("select has_function_privilege('service_role','public.dashboard_admin_execute(text,jsonb)','EXECUTE')"),false);
});
test('installer replay preserves all four dependencies and rejects target/dependency/collision drift',async()=>{
 const m=await deps();await db.exec(tx(patch));assert.deepEqual(await deps(),m);await db.exec(tx(patch));assert.deepEqual(await deps(),m);
 assert.equal(await scalar('select md5(prosrc)from pg_proc where oid=$1::regprocedure',[endpoint]),'ed104b631583bf42608fdac1f4984d0b');
 for(const [sql,msg]of [["grant execute on function public.dashboard_admin_deposit_kyc(jsonb,text)to anon",/definition_drift/],["alter function public.dashboard_admin_deposit_kyc(jsonb,text)set statement_timeout='21s'",/definition_drift/],["alter function public.dashboard_admin_deposit_collected_statistics(jsonb)cost 99",/dependency_drift/],["create function public.dashboard_admin_deposit_kyc(text)returns jsonb language sql as $$select '{}'::jsonb$$",/name_collision/]]){
  await db.exec('savepoint drift');await db.exec(sql.replace('public.dashboard_admin_deposit_collected_statistics','private.dashboard_admin_deposit_collected_statistics'));await assert.rejects(()=>db.exec(tx(patch)),msg);await db.exec('rollback to savepoint drift;release savepoint drift');
 }
});

const exactRollback="-- KYC-only REST entrypoint. The existing public owner and assigned-role routes\n-- keep all authorization and data-scope checks. No source/gateway/role changes.\n-- PostgREST hoists this top-level RPC's timeout; nested private settings do not\n-- replace a deadline already started by the API. Actual Auth UI verification required.\nbegin;\nset local statement_timeout='3s';set local lock_timeout='1s';\ndo $install$\ndeclare p record;r record;target regprocedure:=to_regprocedure('public.dashboard_admin_deposit_kyc(jsonb,text)');before_dependencies jsonb;\nbegin\n if current_user<>'postgres' then raise exception 'kyc_endpoint_owner_required';end if;\n for r in select * from(values\n ('public.dashboard_admin_deposit_statistics(jsonb)','sql','p_request jsonb DEFAULT ''{}''::jsonb','c7ec858ca1a3a08edc0f4960c949ee2c',false,'s',1,array['search_path=\"\"']::text[],'{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),\n ('public.dashboard_admin_execute(text,jsonb)','plpgsql','p_page text, p_request jsonb','212a33785c64b3266f4eb84de8b0492b',true,'v',0,array['search_path=\"\"']::text[],'{postgres=X/postgres,authenticated=X/postgres}'),\n ('private.dashboard_admin_deposit_collected_statistics(jsonb)','plpgsql','p_request jsonb','47a0a1b59aa96bda3ee6e91e5fe022b1',false,'s',0,array['search_path=\"\"','plan_cache_mode=force_custom_plan']::text[],'{postgres=X/postgres}'),\n ('private.dashboard_admin_deposit_collected_summary(jsonb)','sql','p_rows jsonb','e7e1ba1ca1d4af4f39918283c215b125',false,'s',0,array['search_path=\"\"']::text[],'{postgres=X/postgres}')\n )x(identity,language,args,body_hash,security_definer,volatility,defaults,config,acl)loop\n  select f.*,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure(r.identity);\n  if not found or md5(p.prosrc)<>r.body_hash or p.proowner<>'postgres'::regrole or p.lanname<>r.language or p.prokind<>'f'\n   or p.prosecdef<>r.security_definer or p.provolatile::text<>r.volatility or p.proparallel<>'u' or p.proretset or p.proisstrict or p.proleakproof\n   or p.prorettype<>'jsonb'::regtype or p.pronargdefaults<>r.defaults or p.provariadic<>0 or p.procost<>100 or p.prorows<>0\n   or pg_get_function_arguments(p.oid)<>r.args or p.proconfig is distinct from r.config or p.proacl::text is distinct from r.acl then raise exception 'kyc_endpoint_dependency_drift';end if;\n end loop;\n if exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='dashboard_admin_deposit_kyc' and (target is null or oid<>target))then raise exception 'kyc_endpoint_name_collision';end if;\n if target is not null then\n select f.*,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=target;\n if not found or md5(p.prosrc)<>'ed104b631583bf42608fdac1f4984d0b' or p.proowner<>'postgres'::regrole or p.lanname<>'plpgsql' or p.prokind<>'f'\n  or p.prosecdef or p.provolatile<>'v' or p.proparallel<>'u' or p.proretset or p.proisstrict or p.proleakproof\n  or p.prorettype<>'jsonb'::regtype or p.pronargs<>2 or p.pronargdefaults<>1 or p.provariadic<>0 or p.procost<>100 or p.prorows<>0\n  or pg_get_function_arguments(p.oid)<>'p_request jsonb, p_page text DEFAULT NULL::text'\n  or p.proconfig is distinct from array['search_path=\"\"','statement_timeout=20s']::text[]\n  or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' then raise exception 'kyc_endpoint_definition_drift';end if;\n  drop function public.dashboard_admin_deposit_kyc(jsonb,text);\n end if;\nend;$install$;\nselect pg_notify('pgrst','reload schema');\ncommit;\n";

test('exact rollback and replay remove only the new RPC and preserve every delegated function',async()=>{
 const m=await deps();await db.exec(tx(patch));await db.exec(tx(exactRollback));assert.equal(await scalar('select to_regprocedure($1)',[endpoint]),null);assert.deepEqual(await deps(),m);await db.exec(tx(exactRollback));assert.deepEqual(await deps(),m);
});
test('dependency/role drift before first install and postcondition failure leave no partial endpoint',async()=>{
 await db.exec('savepoint body');await db.exec("create or replace function public.dashboard_admin_deposit_statistics(p_request jsonb default '{}'::jsonb)returns jsonb language sql stable set search_path=''as $$select '{}'::jsonb$$");await assert.rejects(()=>db.exec(tx(patch)),/dependency_drift/);await db.exec('rollback to savepoint body;release savepoint body');assert.equal(await scalar('select to_regprocedure($1)',[endpoint]),null);
 await db.exec('savepoint badpost');const bad=tx(patch).replace("if (select jsonb_object_agg(f.oid::text,to_jsonb(f))", "if (select jsonb_object_agg(f.oid::text,to_jsonb(f))");
 // Replace only the final dependency-state assertion, so the CREATE/GRANT
 // succeeds inside DO before the exception proves transaction rollback.
 const marker=")is distinct from before_dependencies then";assert(patch.includes(marker));const failed=tx(patch).replace(marker,")is distinct from '{}'::jsonb then");await assert.rejects(()=>db.exec(failed),/postcondition_drift/);await db.exec('rollback to savepoint badpost;release savepoint badpost');assert.equal(await scalar('select to_regprocedure($1)',[endpoint]),null);
 await db.exec('savepoint wrongrole');await db.exec('set local role service_role');await assert.rejects(()=>db.exec(tx(patch)),/owner_required/);await db.exec('rollback to savepoint wrongrole;release savepoint wrongrole');
});
