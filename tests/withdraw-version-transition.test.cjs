'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const file=path.join(__dirname,'withdraw-prepared-sql.test.cjs'),prefix=fs.readFileSync(file,'utf8').split(/\ntest\.afterEach/)[0];
const h=new Function('require','__dirname',prefix+'\nreturn {installed,val,publish,q,getDb:()=>db,add:h.add};')(createRequire(file),path.dirname(file));
const sql=fs.readFileSync(path.join(__dirname,'../supabase/operations/withdraw-prepared/version-transition.sql'),'utf8'),hashes={"legacyMd5":"12fe721956fb291f2c2b93a5d5187fbd","transitionMd5":"e84cb272d9f9a417e5106169249a7b86","cutoverMd5":"4b0fbbe7dd50cd5679c001775dc9280c","sqlSha256":"e6537758eaf344958ae9a39832708f691d8bc9e2d18c9ac3259cf1e817151a9f","bytes":11622};
async function setup(){await h.installed();const db=h.getDb();await db.exec(`
 create table if not exists private.fee_rate_versions(id uuid,country text,rule_key text);
 create table if not exists private.fee_rate_current_evidence(generation_id uuid,source_id uuid,rule_key text,version_id uuid,state text,direction text);
 create table if not exists private.fee_rate_generations(id uuid,published_at timestamptz);
 create table if not exists public.third_party_rates(id uuid,country text,updated_at timestamptz,category text,third_party text);
 create table if not exists private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values jsonb);
 create table if not exists private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text,version text);
 create table if not exists private.dashboard_admin_order_provider_confirmations(source_system text,country_code text,platform text,active boolean,order_kind text,order_no text,confirmed_provider text);
 create table if not exists public.ar_config_targets(source_system text,country_code text,platform text,currency text);
 `);await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/withdraw-transition-dependency-functions.sql'),'utf8'));return db;}
const main=()=>h.val("select prosrc v from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure"),md5=s=>crypto.createHash('md5').update(s).digest('hex');
const metadata=()=>h.val("select jsonb_object_agg(p.oid::regprocedure::text,to_jsonb(p)-array['prosrc','provolatile'])v from pg_proc p where oid=any(array['private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure,'public.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure])");
const tokens=()=>h.val("select jsonb_build_array(private.withdraw_prepared_dependency(),private.provider_snapshot_dependency_token(to_jsonb(p)),private.prepared_aggregate_dependency(to_jsonb(p)))v from private.prepared_aggregate_native_catalog()p order by p.id limit 1");
const v2=extra=>({...h.q(extra),windowVersion:2,successStartAt:h.q(extra).startAt,successEndAt:h.q(extra).endAt,successBasis:'success'});
test.afterEach(async()=>{await h.getDb()?.close()});
test('expired capture transitions atomically; legacy DTO unchanged; v2 only enqueues or reads prepared; actual three dependency functions and permissions unchanged',async()=>{
 const db=await setup();await h.add(db);const legacy=[];for(const view of['auto','operators'])legacy.push(await h.val('select public.dashboard_admin_live_auto_withdraw($1)v',[h.q({view})]));
 await h.val('select private.withdraw_prepared_begin_capture()v');await db.exec("update private.withdraw_prepared_release set capture_ends_at=clock_timestamp()-interval'1 second'");const meta=await metadata(),before=await tokens();await db.exec(sql);assert.deepEqual(await metadata(),meta);assert.deepEqual(await tokens(),before);assert.equal(md5(await main()),hashes.transitionMd5);assert.equal(await h.val('select capture_ends_at is null v from private.withdraw_prepared_release'),true);
 for(const [i,view]of['auto','operators'].entries())assert.deepEqual(await h.val('select public.dashboard_admin_live_auto_withdraw($1)v',[h.q({view})]),legacy[i]);
 assert.equal(await h.val('select count(*)::int v from private.withdraw_prepared_jobs'),0);
 await db.exec('alter table private.newar_withdraw_facts rename to unavailable_source');const cold=await h.val('select public.dashboard_admin_live_auto_withdraw($1)v',[v2()]);assert.ok(['missing','building'].includes(cold.prepared.status));assert.equal(cold.rows,null);assert.equal(await h.val('select count(*)::int v from private.withdraw_prepared_jobs'),1);await db.exec('alter table private.unavailable_source rename to newar_withdraw_facts');
 await h.publish();await db.exec('alter table private.newar_withdraw_facts rename to unavailable_source');assert.equal((await h.val('select public.dashboard_admin_live_auto_withdraw($1)v',[v2()])).prepared.status,'ready');await db.exec('alter table private.unavailable_source rename to newar_withdraw_facts');
 await db.exec("set test.denied='yes'");await assert.rejects(h.val('select public.dashboard_admin_live_auto_withdraw($1)v',[v2()]),/synthetic_session_denied|preview_denied/);await db.exec("set test.denied='no'");await db.exec(sql);assert.deepEqual(await tokens(),before);
});
test('active capture is refused; final cutover accepts exact transitional body then drops legacy dispatch and capture helpers',async()=>{
 const db=await setup();await h.val('select private.withdraw_prepared_begin_capture()v');await assert.rejects(db.exec(sql),/capture_active_or_source_changed/);await db.exec('rollback');assert.equal(md5(await main()),'283677c316396e9c7b85aa21566eac1a');await h.val('select private.withdraw_prepared_abort_capture()v');await db.exec(sql);
 const today=await h.val("select(now()at time zone'Asia/Karachi')::date::text v"),yesterday=await h.val("select((now()at time zone'Asia/Karachi')::date-1)::text v");for(const view of['auto','operators']){const{j}=await h.publish({view,startAt:today+'T00:00:00Z',endAt:today+'T23:59:59Z'});await h.val('select private.withdraw_prepared_register_template($1,$2)v',[j.id,'Asia/Karachi']);await h.publish({view,startAt:yesterday+'T00:00:00Z',endAt:yesterday+'T23:59:59Z'});}
 const manifest=await h.val('select array_agg(fingerprint)v from private.withdraw_prepared_templates');await h.val('select private.withdraw_prepared_cutover($1)v',[manifest]);const body=await main();assert.ok(!body.includes('withdraw_prepared_version_dispatch_v1'));assert.ok(!body.includes('for v_target'));assert.ok(body.includes('RETURN private.withdraw_prepared_read(p_request)'));
 assert.equal(await h.val("select count(*)::int v from pg_proc where pronamespace='private'::regnamespace and proname in('withdraw_prepared_capture','withdraw_prepared_begin_capture','withdraw_prepared_abort_capture')"),0);assert.equal((await h.val('select public.dashboard_admin_live_auto_withdraw($1)v',[v2({startAt:today+'T00:00:00Z',endAt:today+'T23:59:59Z'})])).prepared.status,'ready');
});
