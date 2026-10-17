// Real final withdrawal DTO and queue SQL; synthetic native fixtures, no credentials/JWT impersonation.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const base=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(base,f),'utf8');
const {build,sources}=require('../scripts/ops/build-withdraw-prepared-kernels.cjs');
function harness(){const file=path.join(__dirname,'pakistan-created-submitted-duration-sql.test.cjs');const context=vm.createContext({__dirname:path.dirname(file),require:n=>n==='node:test'?{test(){}}:createRequire(file)(n),structuredClone,console});vm.runInContext(fs.readFileSync(file,'utf8').replace('insert into public.newar_detail_records values','insert into public.newar_detail_records(id,platform,dataset,source_id,status_group,currency,created_at,captured_at,received_at,raw)values').split(/\ntest\(/)[0]+fs.readFileSync(file,'utf8').split('async function fullFixture()')[1].split('let comparisons=0;')[0].replace(/^/, 'async function fullFixture()')+';globalThis.fixture={fullFixture,add,apply,call};',context);return context.fixture;}
const h=harness();let db;
const val=async(sql,p=[])=>(await db.query(sql,p)).rows[0]?.v;
const q=(extra={})=>({country:'巴基斯坦',startAt:'2026-10-13T00:00:00Z',endAt:'2026-10-13T23:59:59Z',limit:500,...extra});
async function installed(){
 db=await h.fullFixture();await h.apply(db);await db.exec('alter table public.newar_detail_records add column amount numeric,add column success_at timestamptz,add column source_updated_at timestamptz');
 await db.exec(`create schema auth;create function auth.uid()returns uuid language sql stable as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
 CREATE OR REPLACE FUNCTION public.dashboard_admin_live_auto_withdraw(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$select private.dashboard_admin_live_auto_withdraw(p_request)$function$;
revoke all on function public.dashboard_admin_live_auto_withdraw(jsonb)from public,anon;grant execute on function public.dashboard_admin_live_auto_withdraw(jsonb)to authenticated,service_role;
 create function private.prepared_aggregate_native_catalog()returns table(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text)language sql stable as $$select *from public.synthetic_catalog$$;
 create table private.provider_snapshot_jobs(status text,lease_until timestamptz);create table private.prepared_aggregate_jobs(status text,lease_until timestamptz);
 create function private.prepared_aggregate_take_turn(text)returns boolean language sql volatile as $$select true$$;
 create function private.prepared_aggregate_prepare_claim(text)returns jsonb language sql volatile as $$select null::jsonb$$;
 create function private.prepared_aggregate_run_claimed(text)returns jsonb language sql volatile as $$select '{"status":"idle"}'::jsonb$$;
 set check_function_bodies=off;`);
 // GAME66 real helper has fresh scope calls, which become explicit scope in its worker clone.
 const game=read('supabase/migrations/20261002140700_admin_game66_auto_withdraw_single_pass.sql').match(/CREATE OR REPLACE FUNCTION private.dashboard_admin_live_game66_withdraw[\s\S]*?AS (\$\w*\$)[\s\S]*?\1\s*;/i)[0];
 await db.exec('drop function private.dashboard_admin_live_game66_withdraw(date,date,text,text[])');await db.exec(game);
 await db.exec('revoke all on function private.dashboard_admin_live_game66_withdraw(date,date,text,text[])from public,anon,authenticated,service_role');
 const expected={main:await val("select md5(prosrc)v from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure")};
 for(const [key,name]of sources){const sig=`private.${name}(${key==='game66'?'date,date,text,text[]':'jsonb,jsonb,date,date'})`;expected[key]=await val('select md5(prosrc)v from pg_proc where oid=$1::regprocedure',[sig]);await db.exec('revoke all on function '+sig+'from public,anon,authenticated,service_role');}
 await db.exec(read('supabase/operations/withdraw-windows/clocks.sql'));await db.exec(read('supabase/operations/withdraw-prepared/store.sql'));await db.exec(build(expected,{creationSources:['newar','duoli','game66']}));await db.exec(read('supabase/operations/withdraw-windows/secondary.sql'));await db.exec(read('supabase/operations/withdraw-windows/result.sql'));await db.exec(read('supabase/operations/withdraw-prepared/runtime.sql'));await db.exec(read('supabase/operations/withdraw-prepared/schedule.sql'));await db.exec(read('supabase/operations/withdraw-prepared/capture.sql'));await db.exec('set check_function_bodies=on');
}
const request=(extra={})=>val('select private.withdraw_prepared_read($1)v',[q(extra)]);
async function publish(extra={}){await request(extra);const claim=await val('select private.withdraw_prepared_claim()v');assert.ok(claim);const j=(await db.query('select *from private.withdraw_prepared_jobs where id=$1',[claim.jobId])).rows[0];const payload=await val('select private.withdraw_prepared_compute($1,$2,$3)v',[j.request,j.scope,j.catalog]);const complete=await val('select private.withdraw_prepared_complete($1,$2)v',[claim,payload]);assert.equal(complete.published,true);return {claim,j,payload};}
test.afterEach(async()=>{await db?.close();db=null});
test('source-bundle preparation preserves exact final creation cohort DTO, operators, prior period, nulls and pagination',async()=>{
 await installed();for(const date of['2026-10-12','2026-10-13'])for(const platform of['POPZAR','92BLAZE'])await h.add(db,platform,{created:date+'T01:00:00Z',submitted:date+'T01:00:15Z',method:platform==='POPZAR'?'auto':'manual'});
 for(const view of['auto','operators']){
  const before=await val('select private.dashboard_admin_live_auto_withdraw($1)v',[q({view})]);const first=await request({view});assert.equal(first.prepared.status,'missing');assert.equal(first.rows,null);
  await publish({view});const after=await request({view});delete after.prepared;delete after.windows;delete after.secondary;delete after.creationAvailability;assert.deepEqual(after,before);
  for(const extra of[{view,daily:true},{view,offset:20,limit:20},{view,sort:'avgSeconds',ascending:true}]){const expected=await val('select private.dashboard_admin_live_auto_withdraw($1)v',[q(extra)]),actual=await request(extra);delete actual.prepared;delete actual.windows;delete actual.secondary;delete actual.creationAvailability;assert.deepEqual(actual,expected);}
 }
 assert.equal(await val('select count(*)v from private.withdraw_prepared_jobs'),2);
});
test('ordinary reads execute no native order source and notes/authorization stay fresh',async()=>{
 await installed();await h.add(db);await publish();await db.exec('alter table private.newar_withdraw_facts rename to unavailable_source');
 const r=await request();assert.equal(r.prepared.status,'ready');assert.equal(r.rows.filter(x=>x.total>0).length,1);assert.equal(r.totals.total,1);
 await db.exec("insert into public.auto_withdraw_notes(data_date,country,platform,reason,updated_at)values('2026-10-13','巴基斯坦','POPZAR','Synthetic fresh note',now());create or replace function private.dashboard_admin_live_can_note()returns boolean language sql stable as $$select false$$");const refreshed=await request();assert.ok(refreshed.notes.some(n=>n.reason==='Synthetic fresh note'));assert.equal(refreshed.canWriteNotes,false);assert.equal(refreshed.prepared.generation,r.prepared.generation);
 await db.exec("set test.denied='yes'");await assert.rejects(request(),/synthetic_session_denied|preview_denied/);
});
test('scope identity and fence fail closed; expiry keeps the complete result and attempts remain bounded',async()=>{
 await installed();await h.add(db);const {claim,payload}=await publish();assert.equal((await val('select private.withdraw_prepared_complete($1,$2)v',[claim,payload])).published,false);
 await db.exec("update private.withdraw_prepared_jobs set status='queued'");assert.equal((await request()).prepared.status,'ready');
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({mode:'selected',countries:[],platforms:[{country:'PK',platform:'92BLAZE'}]})]);assert.notEqual((await request()).prepared.status,'ready');
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({mode:'all',countries:[]})]);
 await db.exec("alter table private.withdraw_prepared_artifacts disable trigger withdraw_prepared_immutable;update private.withdraw_prepared_artifacts set expires_at=clock_timestamp()-interval'1second';alter table private.withdraw_prepared_artifacts enable trigger withdraw_prepared_immutable;");assert.equal((await request()).prepared.status,'ready');assert.equal((await request()).prepared.freshness,'refresh_due');
 await db.exec("update private.withdraw_prepared_jobs set status='failed',attempts=3");assert.equal(await val('select private.withdraw_prepared_claim()v'),null);
});
test('private tables and workers are not callable by untrusted roles',async()=>{
 await installed();for(const role of['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(val('select private.withdraw_prepared_claim()v'),/permission denied|denied/);await assert.rejects(db.query('select *from private.withdraw_prepared_artifacts'),/permission denied/);await db.exec('reset role');}
});

test('registered defaults roll today/yesterday with exact native identity and never retry exhausted jobs automatically',async()=>{
 await installed();await publish();await publish({view:'operators'});
 for(const j of(await db.query('select id from private.withdraw_prepared_jobs')).rows)await val('select private.withdraw_prepared_register_template($1,$2)v',[j.id,'Asia/Karachi']);
 assert.equal(await val('select count(*)v from private.withdraw_prepared_templates'),2);
 await db.exec("set statement_timeout='3s'");assert.equal((await val('select private.withdraw_prepared_prewarm()v')).expected,4);assert.equal((await val('select private.withdraw_prepared_prewarm()v')).expected,4);
 const today=await val("select(now()at time zone'Asia/Karachi')::date::text v");
 assert.equal(await val("select count(*)v from private.withdraw_prepared_jobs where left(request->>'endAt',10)=$1",[today]),2);
 await db.exec("update private.withdraw_prepared_jobs set status='failed',attempts=3;select private.withdraw_prepared_maintenance();select private.withdraw_prepared_prewarm();");assert.equal(await val('select private.withdraw_prepared_claim()v'),null);
 await db.exec("delete from public.synthetic_catalog where source='newar'");assert.equal((await val('select private.withdraw_prepared_prewarm()v')).expected,0);
});
test('claimed execution has bounded deadline, backend/fence guards and failure never overwrites a ready head',async()=>{
 await installed();await h.add(db);const{j}=await publish();const old=await val('select artifact_id::text v from private.withdraw_prepared_heads where job_id=$1',[j.id]);
 await db.exec("update private.withdraw_prepared_jobs set status='queued';set statement_timeout='3s'");const claim=await val("select private.withdraw_prepared_claim()v");
 await db.query("select set_config('withdraw_prepared.claim',$1,false)",[JSON.stringify(claim)]);
 await db.exec("set statement_timeout='0'");await assert.rejects(val('select private.withdraw_prepared_run_claimed()v'),/deadline_required/);
 await db.exec("set statement_timeout='50s';alter table private.newar_withdraw_facts rename to unavailable_source");
 assert.equal((await val('select private.withdraw_prepared_run_claimed()v')).published,false);assert.equal(await val('select artifact_id::text v from private.withdraw_prepared_heads where job_id=$1',[j.id]),old);assert.equal((await request()).prepared.status,'ready');
 assert.equal(await val('select attempts v from private.withdraw_prepared_jobs where id=$1',[j.id]),1);
});
test('cutover refuses missing default generations and preserves live authorization with prepared-only original endpoint',async()=>{
 await installed();await assert.rejects(val('select private.withdraw_prepared_cutover(null)v'),/release_manifest_mismatch/);
 const today=await val("select(now()at time zone'Asia/Karachi')::date::text v"),yesterday=await val("select((now()at time zone'Asia/Karachi')::date-1)::text v");
 for(const view of['auto','operators']){const{j}=await publish({view,startAt:today+'T00:00:00Z',endAt:today+'T23:59:59Z'});await val('select private.withdraw_prepared_register_template($1,$2)v',[j.id,'Asia/Karachi']);}
 const manifest=await val('select array_agg(fingerprint)v from private.withdraw_prepared_templates');await assert.rejects(val('select private.withdraw_prepared_cutover($1)v',[manifest]),/not_warmed/);
 for(const view of['auto','operators'])await publish({view,startAt:yesterday+'T00:00:00Z',endAt:yesterday+'T23:59:59Z'});
 await val('select private.withdraw_prepared_cutover($1)v',[manifest]);assert.equal(await val("select count(*)v from pg_proc where pronamespace='private'::regnamespace and proname in('withdraw_prepared_capture','withdraw_prepared_begin_capture','withdraw_prepared_abort_capture')"),0);const args=q({startAt:today+'T00:00:00Z',endAt:today+'T23:59:59Z'});
 assert.equal((await val('select private.dashboard_admin_live_auto_withdraw($1)v',[args])).prepared.status,'ready');
 await db.exec('alter table private.newar_withdraw_facts rename to unavailable_source');assert.equal((await val('select private.dashboard_admin_live_auto_withdraw($1)v',[args])).prepared.status,'ready');
 await db.exec("set test.denied='yes'");await assert.rejects(val('select private.dashboard_admin_live_auto_withdraw($1)v',[args]),/synthetic_session_denied|preview_denied/);
});

test('temporary capture keeps original result, uses real current scope, expires and can be exactly reverted',async()=>{
 await installed();await h.add(db);const original=await val('select private.dashboard_admin_live_auto_withdraw($1)v',[q()]);
 await val('select private.withdraw_prepared_begin_capture()v');assert.equal(await val("select provolatile::text v from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure"),'v');
 assert.deepEqual(await val('select private.dashboard_admin_live_auto_withdraw($1)v',[q()]),original);assert.equal(await val('select count(*)v from private.withdraw_prepared_jobs'),1);
 await val('select private.withdraw_prepared_begin_capture()v');assert.deepEqual(await val('select private.dashboard_admin_live_auto_withdraw($1)v',[q()]),original);assert.equal(await val('select count(*)v from private.withdraw_prepared_jobs'),1);
 await db.exec("update private.withdraw_prepared_release set capture_ends_at=clock_timestamp()-interval'1second'");await val('select private.dashboard_admin_live_auto_withdraw($1)v',[q({view:'operators'})]);assert.equal(await val('select count(*)v from private.withdraw_prepared_jobs'),1);
 await val('select private.withdraw_prepared_abort_capture()v');await val('select private.withdraw_prepared_abort_capture()v');assert.equal(await val("select md5(prosrc)v from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure"),'12fe721956fb291f2c2b93a5d5187fbd');assert.equal(await val("select provolatile::text v from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure"),'s');assert.deepEqual(await val('select private.dashboard_admin_live_auto_withdraw($1)v',[q()]),original);assert.equal(await val('select count(*)v from private.withdraw_prepared_jobs'),1);
 await db.exec("set test.denied='yes'");await assert.rejects(val('select private.dashboard_admin_live_auto_withdraw($1)v',[q()]),/synthetic_session_denied|preview_denied/);
});
test('source-helper drift invalidates frozen publications and refuses to publish old clone under a new dependency',async()=>{
 await installed();await h.add(db);await publish();await db.exec('alter function private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)cost 101');
 assert.equal(await val('select private.withdraw_prepared_source_contract_current()v'),false);assert.equal((await request()).prepared.reason,'source_contract_changed');
 await db.exec("update private.withdraw_prepared_jobs set status='queued'");assert.equal(await val('select private.withdraw_prepared_claim()v'),null);assert.equal(await val('select last_error v from private.withdraw_prepared_jobs'),'source_contract_changed');
 assert.equal(await val('select count(*)v from private.withdraw_prepared_heads'),1);
});
test('recent expiry follows native local days across UTC midnight without depending on the session timezone',async()=>{
 await installed();const at='2026-10-17T00:30:00Z',la=[{timezone:'America/Los_Angeles'}],jakarta=[{timezone:'Asia/Jakarta'}];
 for(const tz of['UTC','Pacific/Honolulu']){await db.query("select set_config('TimeZone',$1,false)",[tz]);
  const seconds=async(day,c)=>val('select extract(epoch from(private.withdraw_prepared_expiry($1,$2,$3)-$1::timestamptz))::int v',[at,day,c]);
  assert.equal(await seconds('2026-10-15',la),600);assert.equal(await seconds('2026-10-16',jakarta),600);assert.equal(await seconds('2026-10-15',jakarta),21600);assert.equal(await seconds('2026-10-15',[...la,...jakarta]),600);
 }
});

test('expired complete generation is immediate, queues the same key once, and preserves original times and result',async()=>{
 await installed();await h.add(db);await publish();const fresh=await request();
 assert.equal(fresh.prepared.freshness,'fresh');assert.equal(fresh.prepared.refreshState,'idle');
 await db.exec("alter table private.withdraw_prepared_artifacts disable trigger withdraw_prepared_immutable;update private.withdraw_prepared_artifacts set expires_at=clock_timestamp()-interval'1second';alter table private.withdraw_prepared_artifacts enable trigger withdraw_prepared_immutable");
 const expired=await request(),again=await request();assert.equal(expired.prepared.status,'ready');assert.equal(expired.prepared.freshness,'refresh_due');assert.equal(expired.prepared.refreshState,'queued');assert.equal(expired.prepared.generation,fresh.prepared.generation);assert.equal(expired.prepared.computedAt,fresh.prepared.computedAt);assert.equal(again.prepared.expiresAt,expired.prepared.expiresAt);assert.deepEqual(expired.rows,fresh.rows);assert.deepEqual(expired.totals,fresh.totals);assert.equal(await val('select count(*)v from private.withdraw_prepared_jobs'),1);assert.equal(await val('select attempts v from private.withdraw_prepared_jobs'),0);
 const claim=await val('select private.withdraw_prepared_claim()v'),lease=await val('select lease_until::text v from private.withdraw_prepared_jobs');const running=await request();assert.equal(running.prepared.refreshState,'running');assert.equal(await val('select lease_until::text v from private.withdraw_prepared_jobs'),lease);assert.equal(await val('select attempts v from private.withdraw_prepared_jobs'),1);
 await db.exec("update private.withdraw_prepared_jobs set status='failed',attempts=3,last_error='compute_timeout',lease_until=null");const failed=await request();assert.equal(failed.prepared.status,'ready');assert.equal(failed.prepared.refreshState,'failed');assert.equal(failed.prepared.generation,expired.prepared.generation);assert.equal(await val('select attempts v from private.withdraw_prepared_jobs'),3);assert.equal(await val('select private.withdraw_prepared_claim()v'),null);assert.ok(claim);
});
test('last complete never bypasses revision, dependency, payload completeness, native or authorization changes',async()=>{
 await installed();await h.add(db);await publish();await db.exec("alter table private.withdraw_prepared_artifacts disable trigger withdraw_prepared_immutable;update private.withdraw_prepared_artifacts set expires_at=clock_timestamp()-interval'1second';alter table private.withdraw_prepared_artifacts enable trigger withdraw_prepared_immutable");
 const original=await request();await db.exec('update private.withdraw_prepared_jobs set revision=revision+1');let r=await request();assert.notEqual(r.prepared.status,'ready');assert.equal(r.rows,null);
 await db.exec("update private.withdraw_prepared_jobs set revision=revision-1,dependency='changed'");r=await request();assert.notEqual(r.prepared.status,'ready');assert.equal(r.rows,null);
 // Reset to the exact artifact semantics only within this synthetic fixture.
 await db.exec('update private.withdraw_prepared_jobs j set revision=a.revision,dependency=a.dependency from private.withdraw_prepared_artifacts a where a.job_id=j.id');assert.equal((await request()).prepared.generation,original.prepared.generation);
 await db.exec("alter table private.withdraw_prepared_artifacts disable trigger withdraw_prepared_immutable;update private.withdraw_prepared_artifacts set payload=payload-'ar';alter table private.withdraw_prepared_artifacts enable trigger withdraw_prepared_immutable");r=await request();assert.notEqual(r.prepared.status,'ready');assert.equal(r.rows,null);
 await db.exec("set test.denied='yes'");await assert.rejects(request(),/synthetic_session_denied|preview_denied/);await db.exec("set test.denied='no';update public.synthetic_catalog set timezone='UTC'where source='newar'");r=await request();assert.notEqual(r.prepared.status,'ready');assert.equal(r.rows,null);
});
