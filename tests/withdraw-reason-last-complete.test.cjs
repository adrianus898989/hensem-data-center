// Synthetic immutable artifacts; no production account, session, payload or receipt.
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const{setup:sourceSetup}=require('./fixtures/withdraw-reasons-query-harness.cjs');
const files={install:'supabase/maintenance/withdraw-reason-last-complete.install-disabled.sql',enable:'supabase/maintenance/withdraw-reason-last-complete.enable.sql',disable:'supabase/maintenance/withdraw-reason-last-complete.disable.sql',remove:'supabase/maintenance/withdraw-reason-last-complete.remove-disabled.sql'};
const request=(platform,offset=0)=>({country:'印度',platform,date:'2026-10-17',kind:'blocking',offset,limit:20});
const definition=(text,name)=>{const m=text.match(new RegExp('CREATE OR REPLACE FUNCTION '+name.replaceAll('.','\\.')+'\\([\\s\\S]*?\\$function\\$;'));assert.ok(m,name);return m[0]};
async function fixture(){const db=await sourceSetup();try{
 await db.exec('set check_function_bodies=off');await db.exec(read('supabase/operations/withdraw-prepared/store.sql'));
 await db.exec(`create or replace function private.prepared_aggregate_native_catalog()returns setof public.synthetic_catalog language sql stable as $$select *from public.synthetic_catalog$$;
 create or replace function private.prepared_aggregate_dependency_common(text)returns text language sql stable as $$select 'synthetic-common'::text$$;
 create or replace function private.provider_snapshot_dependency_token(jsonb)returns text language sql stable as $$select 'synthetic-provider'::text$$;
 create or replace function private.ar_withdraw_fact_generation()returns text language sql stable as $$select 'synthetic-fact-generation'::text$$;
 create or replace function private.ar_historical_duration_generation()returns text language sql stable as $$select 'synthetic-history-generation'::text$$;
 alter table public.auto_withdraw_daily add column if not exists id uuid default gen_random_uuid();`);
 // Prior parent and its exact currentness guard are part of the audited undo,
 // not copied from a private captured fixture.
 const undo=read(files.disable);await db.exec(definition(undo,'private.withdraw_reason_parent_current'));
 await db.exec(definition(undo,'private.dashboard_admin_live_withdraw_reasons'));
 await db.exec(read('supabase/operations/withdraw-reasons/versions.sql'));
 await db.exec(read('tests/fixtures/withdraw-reason-last-complete.original.sql'));
 await db.exec(`create or replace function public.dashboard_admin_live_withdraw_reasons(p_request jsonb)
 RETURNS jsonb
 LANGUAGE sql
 VOLATILE
 SET search_path TO ''
AS $function$select private.dashboard_admin_live_withdraw_reasons(p_request)$function$;
 revoke all on function private.dashboard_admin_live_withdraw_reasons(jsonb)from public,anon,authenticated,service_role;
 grant execute on function private.dashboard_admin_live_withdraw_reasons(jsonb)to authenticated;
 revoke all on function public.dashboard_admin_live_withdraw_reasons(jsonb)from public,anon,authenticated,service_role;
 grant execute on function public.dashboard_admin_live_withdraw_reasons(jsonb)to authenticated,service_role;
 do $$declare p record;begin for p in select oid from pg_proc where pronamespace='private'::regnamespace and proname like'withdraw_reason_%'loop execute'revoke all on function '||p.oid::regprocedure||' from public,anon,authenticated,service_role';end loop;end$$;
 update private.withdraw_reason_version_state set hooks=private.withdraw_reason_hooks_fingerprint()where singleton;
 reset check_function_bodies;`);
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:'00000000-0000-4000-8000-000000000011',session_id:'00000000-0000-4000-8000-000000000022'})]);
 return db;
}catch(error){await db.close();throw error}}
async function seed(db,platform,label){
 // All original numbers/nulls stay PostgreSQL-side, including high precision.
 await db.query(`DO $seed$declare n jsonb;q jsonb;c jsonb;v jsonb;d text;k jsonb;j uuid;a uuid;r jsonb;begin
 select to_jsonb(p)into n from public.synthetic_catalog p where name=current_setting('test.platform');
 q:=jsonb_build_object('country','印度','platform',n->>'name','date','2026-10-17','kind','blocking','offset',0,'limit',500);
 c:=jsonb_build_object('native',n,'aliases',jsonb_build_array(n->>'name',n->>'name',n->>'source_name'),'rawOnly',n->>'source'='ar');
 v:=private.withdraw_reason_versions_ensure(n||jsonb_build_object('aliases',c->'aliases','rawOnly',c->'rawOnly'),'2026-10-17');
 if v is null then raise exception'synthetic_vector_missing';end if;
 d:=md5(jsonb_build_array(private.withdraw_reason_dependency(),c,v)::text);k:=jsonb_build_array('withdraw-reasons-blocking-v1',q,c);
 insert into private.withdraw_prepared_jobs(request_key,request,scope,catalog,dependency,status,fence)values(k,q,jsonb_build_object('context',c,'version',v),jsonb_build_array(n),d,'ready',1)returning id into j;
 r:=jsonb_build_object('available',true,'country','印度','platform',n->>'name','date','2026-10-17','kind','blocking','offset',0,'limit',500,'total',25,'rows',(select jsonb_agg(jsonb_build_object('reason','Synthetic reason '||i,'count',i,'value',12.34567890123456789,'unknown',null)order by i)from generate_series(1,25)i),'summary',jsonb_build_object('selectedCount',25,'unknown',null),'categories','[]'::jsonb,'coverage',jsonb_build_object('complete',false,'expected',null,'collected',25),'updatedAt','2026-10-18T00:01:00+00:00');
 insert into private.withdraw_prepared_artifacts(job_id,revision,fence,run_id,dependency,payload,computed_at,expires_at,bytes)values(j,1,1,gen_random_uuid(),d,jsonb_build_object('contract','withdraw-reasons-blocking-v1','request',q,'context',c,'version',v,'result',r),now()-interval'1minute',now()+interval'1hour',4000)returning id into a;
 insert into private.withdraw_prepared_heads values(j,a);perform set_config(current_setting('test.snapshot'),r::text,false);
 end;$seed$`,[]);
}
async function prepare(db,p,label){await db.query("select set_config('test.platform',$1,false),set_config('test.snapshot',$2,false)",[p,label]);await seed(db,p,label)}
async function call(db,p,offset=0){return(await db.query('select private.dashboard_admin_live_withdraw_reasons($1)r',[request(p,offset)])).rows[0].r}
async function exact(db,p,label,offset=0){const r=(await db.query("with x as materialized(select private.dashboard_admin_live_withdraw_reasons($1)a,private.withdraw_reason_page(current_setting($2)::jsonb,$1)b)select (a-'publication')=b eq,(a-'publication')::text=b::text exact,a->'publication'->>'contract'contract,a->'publication'->>'freshness'freshness,a->'publication'->'updatedAt'=a->'updatedAt'updated from x",[request(p,offset),label])).rows[0];assert.deepEqual(r,{eq:true,exact:true,contract:'withdraw-reasons-last-complete-v1',freshness:'refresh_due',updated:true})}

test('paired guards and exact old/new-token pages preserve financial JSON/text, coverage and timestamps',async()=>{
 const db=await fixture();try{
  for(const[p,label]of[['91CLUB','test.ar'],['MAAN.WIN','test.nw']])await prepare(db,p,label);
  const old=(await db.query('select private.withdraw_reason_dependency()v')).rows[0].v;
  await db.exec(read(files.install));assert.equal((await db.query('select private.withdraw_reason_dependency()v')).rows[0].v,old);
  await db.exec("update public.ar_collected_orders set manual_remark='Synthetic changed'where order_no='SYNTHETIC-AR17';update public.newar_detail_records set raw=raw||'{\"automaticReasonLabel\":\"Synthetic changed\"}'::jsonb where platform='MAANWIN';");
  assert.equal((await call(db,'91CLUB')).prepared.status,'building');await call(db,'MAAN.WIN');
  await db.exec(read(files.enable));
  for(const[p,label]of[['91CLUB','test.ar'],['MAAN.WIN','test.nw']])for(const offset of[0,20])await exact(db,p,label,offset);
  await db.exec('create function private.withdraw_reason_synthetic_drift()returns boolean language sql stable as $$select true$$');assert.equal((await call(db,'91CLUB')).publication,undefined);await db.exec('drop function private.withdraw_reason_synthetic_drift()');await exact(db,'91CLUB','test.ar');
  await db.exec("update private.withdraw_prepared_jobs set status='failed',attempts=3,last_error='synthetic_compute_failed'where request->>'platform'='91CLUB'");assert.equal((await call(db,'91CLUB')).publication.refreshState,'failed');
  // A newly completed artifact belongs to the sealed current token, not the
  // narrow old-token bridge. Keep its complete financial result unchanged.
  await db.exec(`with fresh as (insert into private.withdraw_prepared_artifacts(job_id,revision,fence,run_id,dependency,payload,computed_at,expires_at,bytes)
   select j.id,j.revision,j.fence,gen_random_uuid(),j.dependency,a.payload||jsonb_build_object('version',j.scope->'version'),clock_timestamp(),clock_timestamp()+interval'1hour',a.bytes
   from private.withdraw_prepared_jobs j join private.withdraw_prepared_heads h on h.job_id=j.id join private.withdraw_prepared_artifacts a on a.id=h.artifact_id
   where j.request->>'platform'='91CLUB'returning id,job_id)
   update private.withdraw_prepared_heads h set artifact_id=f.id from fresh f where h.job_id=f.job_id;
   update private.withdraw_prepared_jobs set status='ready',attempts=0,last_error=null where request->>'platform'='91CLUB'`);
  assert.equal((await call(db,'91CLUB')).publication,undefined);
  await db.exec("update public.ar_collected_orders set manual_remark='Synthetic newest'where order_no='SYNTHETIC-AR17'");
  await exact(db,'91CLUB','test.ar',20);
  await db.exec(read(files.disable));assert.equal((await db.query('select private.withdraw_reason_dependency()v')).rows[0].v,old);await db.exec(read(files.remove));
  assert.equal((await db.query("select to_regprocedure('private.withdraw_prepared_reason_last_complete(jsonb,jsonb,jsonb,jsonb,boolean,jsonb)')v")).rows[0].v,null);
 }finally{await db.close()}
});
test('current config, future-source, date and owner/metadata gates reject stale fallback',async()=>{
 const db=await fixture();try{
  await prepare(db,'MAAN.WIN','test.nw');await db.exec(read(files.install));await db.exec(read(files.enable));
  await db.exec("update public.newar_detail_platforms set launch_at='2026-10-17T01:30:00Z'where platform='MAANWIN'");assert.equal((await call(db,'MAAN.WIN')).publication,undefined);
  await db.exec("update public.newar_detail_platforms set launch_at=null where platform='MAANWIN';update public.newar_detail_records set captured_at=clock_timestamp()+interval'1day'where platform='MAANWIN'");const future=await call(db,'MAAN.WIN');assert.equal(future.publication,undefined);assert.equal(future.rows,null);
  const other=(await db.query('select private.dashboard_admin_live_withdraw_reasons($1)r',[{...request('MAAN.WIN'),date:'2026-10-16'}])).rows[0].r;assert.equal(other.publication,undefined);
  await db.exec('set role authenticated');await assert.rejects(db.query("select private.withdraw_prepared_reason_last_complete('{}','{}','{}','[]',false,'{}')"),e=>e.code==='42501');await db.exec('reset role');
  await db.exec('grant execute on function private.withdraw_prepared_reason_last_complete(jsonb,jsonb,jsonb,jsonb,boolean,jsonb)to authenticated');await assert.rejects(db.exec(read(files.disable)),/withdraw_reason_last_complete_function_drift/);await db.exec('rollback;revoke all on function private.withdraw_prepared_reason_last_complete(jsonb,jsonb,jsonb,jsonb,boolean,jsonb)from authenticated');
 }finally{await db.close()}
});
