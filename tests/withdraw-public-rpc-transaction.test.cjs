'use strict';
// Local PostgreSQL engine behavior; real PostgREST admission needs a separate live receipt.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const file=path.join(__dirname,'withdraw-prepared-sql.test.cjs');
const prefix=fs.readFileSync(file,'utf8').split(/\ntest\.afterEach/)[0];
const h=new Function('require','__dirname',prefix+'\nreturn {installed,val,publish,q,getDb:()=>db};')(createRequire(file),path.dirname(file));
const definition="CREATE OR REPLACE FUNCTION public.dashboard_admin_live_auto_withdraw(p_request jsonb DEFAULT '{}'::jsonb)\n RETURNS jsonb\n LANGUAGE sql\n STABLE\n SET search_path TO ''\nAS $function$select private.dashboard_admin_live_auto_withdraw(p_request)$function$\n";
async function setup(){await h.installed();const db=h.getDb();await db.exec(definition);await db.exec('revoke all on function public.dashboard_admin_live_auto_withdraw(jsonb)from public,anon;grant execute on function public.dashboard_admin_live_auto_withdraw(jsonb)to authenticated,service_role;');return db;}
const wrapper=()=>h.val("select to_jsonb(p)-array['oid','provolatile'] v from pg_proc p where oid='public.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure");
const vol=()=>h.val("select provolatile::text v from pg_proc where oid='public.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure");
test.afterEach(async()=>{await h.getDb()?.close()});
test('actual capture INSERT fails with 25006 in READ ONLY and is swallowed after successful validation; READ WRITE admits exact request',async()=>{
 const db=await setup();await h.val('select private.withdraw_prepared_begin_capture()v');
 // Recreate the old RPC metadata locally so the read-only regression is executable.
 await db.exec('alter function public.dashboard_admin_live_auto_withdraw(jsonb)stable');
 const oldCapture=await h.val("select pg_get_functiondef('private.withdraw_prepared_capture(jsonb)'::regprocedure)v");
 // Local diagnostic only: expose the SQLSTATE of the existing swallowed failure.
 await db.exec(oldCapture.replace('  NULL;',"  PERFORM set_config('test.capture_sqlstate',SQLSTATE,true);"));
 await db.exec('begin read only');const result=await h.val('select public.dashboard_admin_live_auto_withdraw($1)v',[h.q()]);
 assert.equal(typeof result,'object');assert.equal(await h.val("select current_setting('test.capture_sqlstate',true)v"),'25006');
 assert.equal(await h.val('select count(*)v from private.withdraw_prepared_jobs'),0);assert.equal(await h.val('select count(*)v from private.withdraw_prepared_admissions'),0);await db.exec('commit');
 await db.exec(oldCapture);const before=await wrapper();await h.val('select private.withdraw_prepared_begin_capture()v');assert.equal(await vol(),'v');assert.deepEqual(await wrapper(),before);
 const until=await h.val('select capture_ends_at::text v from private.withdraw_prepared_release');await h.val('select private.withdraw_prepared_begin_capture()v');assert.equal(await h.val('select capture_ends_at::text v from private.withdraw_prepared_release'),until);
 await db.exec('begin read write');const after=await h.val('select public.dashboard_admin_live_auto_withdraw($1)v',[h.q()]);await db.exec('commit');assert.deepEqual(after,result);
 assert.equal(await h.val('select count(*)v from private.withdraw_prepared_jobs'),1);assert.equal(await h.val('select sum(total)::int v from private.withdraw_prepared_admissions'),1);
 await h.val('select private.withdraw_prepared_abort_capture()v');assert.equal(await vol(),'s');assert.deepEqual(await wrapper(),before);await h.val('select private.withdraw_prepared_abort_capture()v');assert.equal(await vol(),'s');
});
test('fresh begin changes both wrappers atomically, rejects public ACL drift, and cutover leaves original public RPC writable',async()=>{
 const db=await setup();const before=await wrapper();await db.exec('grant execute on function public.dashboard_admin_live_auto_withdraw(jsonb)to anon');await assert.rejects(h.val('select private.withdraw_prepared_begin_capture()v'),/public_wrapper_drift/);assert.equal(await vol(),'s');assert.equal(await h.val("select provolatile::text v from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure"),'s');await db.exec('revoke execute on function public.dashboard_admin_live_auto_withdraw(jsonb)from anon');
 await h.val('select private.withdraw_prepared_begin_capture()v');assert.equal(await vol(),'v');assert.deepEqual(await wrapper(),before);await h.val('select private.withdraw_prepared_abort_capture()v');
 const today=await h.val("select(now()at time zone'Asia/Karachi')::date::text v"),yesterday=await h.val("select((now()at time zone'Asia/Karachi')::date-1)::text v");
 for(const view of['auto','operators']){const{j}=await h.publish({view,startAt:today+'T00:00:00Z',endAt:today+'T23:59:59Z'});await h.val('select private.withdraw_prepared_register_template($1,$2)v',[j.id,'Asia/Karachi']);await h.publish({view,startAt:yesterday+'T00:00:00Z',endAt:yesterday+'T23:59:59Z'});}
 const manifest=await h.val('select array_agg(fingerprint)v from private.withdraw_prepared_templates');await h.val('select private.withdraw_prepared_cutover($1)v',[manifest]);assert.equal(await vol(),'v');assert.deepEqual(await wrapper(),before);
 const q=h.q({startAt:today+'T00:00:00Z',endAt:today+'T23:59:59Z'});assert.equal((await h.val('select public.dashboard_admin_live_auto_withdraw($1)v',[q])).prepared.status,'ready');
 await db.exec("set test.denied='yes'");await assert.rejects(h.val('select public.dashboard_admin_live_auto_withdraw($1)v',[q]),/synthetic_session_denied|preview_denied/);
 assert.equal(await h.val("select count(*)v from pg_proc where pronamespace='private'::regnamespace and proname in('withdraw_prepared_capture','withdraw_prepared_begin_capture','withdraw_prepared_abort_capture')"),0);
});
