// Actual lookup/readers and metadata DDL, with synthetic archives/orders only.
const {test,before,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261004114022_pending_oct3_owner_confirmed_inr.sql'),'utf8');
const inherited=fs.readFileSync(path.join(__dirname,'admin-pending-confirmed-inr.test.cjs'),'utf8').split(/\ntest\(/)[0];
let setup;
const fixtureRequire=name=>name==='node:test'?{...require(name),before:fn=>{setup=fn}}:require(name);
const fixture=new Function('require','__dirname',inherited+'\nreturn {getDb:()=>db};')(fixtureRequire,__dirname);
const entries=[...new Map([...migration.matchAll(/\('([a-f0-9-]{36})'::uuid,'([^']+)','([a-f0-9-]{36})'::uuid,timestamptz '([^']+)','([a-f0-9]{64})'\)/g)].map(m=>[m[1],{id:m[1],platform:m[2],nativeId:m[3],at:m[4],hash:m[5]}])).values()];
const uuid=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0'),db=()=>fixture.getDb();
const scalar=async(sql,args=[])=>Object.values((await db().query(sql,args)).rows[0])[0];
const lookup=id=>scalar('select private.dashboard_admin_pending_archive_currency($1::uuid)',[id]);
const constraints="select md5(jsonb_agg(jsonb_build_object('name',c.conname,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated,'deferrable',c.condeferrable,'deferred',c.condeferred) order by c.conname)::text)from pg_constraint c where c.conrelid='private.withdraw_pending_capture_currency_confirmations'::regclass and c.contype<>'n'";
let catalog,synthetic,originalArchive,originalOrders,originalEvidence,originalFunctions;
const metadata=()=>scalar("select jsonb_object_agg(oid::regprocedure::text,to_jsonb(p))from pg_proc p where pronamespace='private'::regnamespace");
async function syntheticSQL(){
 let sql=migration;const rows=(await db().query("select id,platform,platform_id,encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')hash from private.withdraw_pending_capture_archive a where stat_date='2026-10-03'")).rows;
 for(const e of entries){const r=rows.find(r=>r.platform===e.platform);assert.ok(r);sql=sql.replaceAll(e.id,r.id).replaceAll(e.nativeId,r.platform_id).replaceAll(e.hash,r.hash)}
 const check=sql.match(/add constraint pending_currency_confirmed_scope check ([\s\S]*?);\n end if;/)[1];
 await db().exec('savepoint derive;alter table private.withdraw_pending_capture_currency_confirmations drop constraint withdraw_pending_capture_currency_confirmations_platform_check,drop constraint withdraw_pending_capture_currency_confirmations_stat_date_check,add constraint pending_currency_confirmed_scope check '+check);
 const target=await scalar(constraints);await db().exec('rollback to derive;release savepoint derive');
 return sql.replaceAll('c171210c319c4e5acaf8898e23294f10',target).replace(/^begin;$/m,'').replace(/^notify pgrst.*commit;$/m,'');
}
before(async()=>{
 assert.equal(entries.length,15);await setup();await db().exec('begin');
 const existing=await scalar('select value from public.synthetic_catalog');catalog=[];
 for(let i=0;i<entries.length;i++){
  const e=entries[i],id=uuid(i+1),nativeId=existing.find(r=>r.name===e.platform)?.id||uuid(i+101),snapshotId=uuid(i+201),count=i+1,amount=count*100;
  const onTime=Date.parse(e.at)>=Date.parse('2026-10-03T18:30:00Z')&&Date.parse(e.at)<=Date.parse('2026-10-03T18:35:00Z');
  const snapshot={schema_version:1,source_system:'WITHDRAW_REVIEW',country_code:'IN',platform:e.platform,stat_date:'2026-10-03',timezone:'Asia/Kolkata',snapshot_id:snapshotId,snapshot_at:e.at,coverage:{complete:true,expected_count:count,fetched_count:count,unique_count:count},totals:{pending_count:count,pending_amount:amount},groups:[{raw_channel:'SyntheticPay',channel_type:'BANK',pending_count:count,pending_amount:amount}]};
  await db().query(`insert into private.withdraw_pending_capture_archive(id,source_system,country_code,platform,stat_date,capture_date,window_start,window_end,window_days,snapshot_id,snapshot_at,snapshot,timezone,capture_basis,within_midnight_window,identity_status,native_source_system,platform_id,team_name,currency,partition_snapshots,pending_count,pending_amount,updated_at)
   values($1,'WITHDRAW_REVIEW','IN',$2,'2026-10-03','2026-10-04','2026-09-27','2026-10-03',7,$3,$4,$5,'Asia/Kolkata','actual_capture',$6,'resolved','AR',$7,'M8',null,'[]',$8,$9,$4)`,[id,e.platform,snapshotId,e.at,snapshot,onTime,nativeId,count,amount]);
  await db().query(`insert into private.withdraw_pending_capture_orders select $1,'OCT3-SYNTHETIC-'||i,'WITHDRAW_REVIEW','IN',$2,'2026-10-03',100,'2026-10-03T12:00:00'::timestamp,'Asia/Kolkata','SyntheticPay','BANK','已提交',$3,$4 from generate_series(1,$5::int)i`,[id,e.platform,snapshotId,e.at,count]);
  catalog.push({id:nativeId,scope_group:'IN',platform_key:e.platform.toUpperCase(),source:'ar',country:'印度',team:'M8',currency:'INR',timezone:'Asia/Kolkata',name:e.platform,mapping_ambiguous:false});
 }
 await db().query('update public.synthetic_catalog set value=$1',[catalog]);
 originalArchive=await scalar('select jsonb_agg(to_jsonb(a)order by id)from private.withdraw_pending_capture_archive a');originalOrders=await scalar('select jsonb_agg(to_jsonb(a)order by archive_id,order_no)from private.withdraw_pending_capture_orders a');
 originalEvidence=await scalar('select jsonb_agg(to_jsonb(e)order by archive_id)from private.withdraw_pending_capture_currency_confirmations e');originalFunctions=await metadata();
 synthetic=await syntheticSQL();await db().exec('commit');
});
beforeEach(async()=>db().exec('begin'));afterEach(async()=>db().exec('rollback'));
const heads=()=>scalar("select private.dashboard_admin_pending_capture_heads($1,$2,'2026-10-03','2026-10-03')",[catalog,{mode:'all'}]);
const request=(i,mode)=>({date:'2026-10-03',observedAt:new Date(entries[i].at).toISOString(),mode,platformIds:[catalog[i].id],offset:0,limit:50});
const orders=(i,mode)=>scalar('select private.dashboard_admin_live_pending_orders($1)',[request(i,mode)]);
test('exact owner metadata adds fifteen confirmations and preserves every archive/order/function and old confirmation value',async()=>{
 assert.equal((await heads()).length,0);await db().exec(synthetic);
 assert.equal(await scalar('select count(*)from private.withdraw_pending_capture_currency_confirmations'),28);
 assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(a)order by id)from private.withdraw_pending_capture_archive a'),originalArchive);
 assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(a)order by archive_id,order_no)from private.withdraw_pending_capture_orders a'),originalOrders);
 assert.deepEqual(await scalar("select jsonb_agg(to_jsonb(e)order by archive_id)from private.withdraw_pending_capture_currency_confirmations e where stat_date='2026-10-01'"),originalEvidence);
 assert.deepEqual(await metadata(),originalFunctions);assert.ok((await heads()).every(h=>h.currency==='INR'));
 for(let i=0;i<entries.length;i++)assert.equal(await lookup(uuid(i+1)),'INR');
});
test('three on-time captures qualify midnight and twelve late captures remain actual stock only',async()=>{
 await db().exec(synthetic);const h=await heads();assert.equal(h.length,15);assert.equal(h.filter(r=>r.within_midnight_window).length,3);
 for(let i=0;i<entries.length;i++){
  const onTime=Date.parse(entries[i].at)<=Date.parse('2026-10-03T18:35:00Z'),midnight=await orders(i,'midnight'),actual=await orders(i,'observed');
  assert.equal(midnight.available,onTime,entries[i].platform);assert.equal(actual.available,true);assert.equal(actual.total,i+1);assert.equal(actual.amount,String((i+1)*100));
  assert.equal(Date.parse(actual.observedAt),Date.parse(entries[i].at));assert.equal(actual.currency,'INR');
 }
 const day={rows:catalog.map((r,i)=>({id:r.id,source:'ar',scopeGroup:'IN',currency:'INR',state:'complete',timingState:Date.parse(entries[i].at)<=Date.parse('2026-10-03T18:35:00Z')?'on_time':'late'}))};
 const decorated=await scalar('select private.dashboard_admin_pending_capture_day($1,$2,$3)',[day,catalog,h]);assert.equal(decorated.onTimePlatformCount,3);assert.equal(decorated.latePlatformCount,12);assert.equal(decorated.rows.filter(r=>r.midnightEligible).length,3);
});
test('idempotent replay preserves confirmed_at, source rows, existing reader metadata and all grants',async()=>{
 await db().exec(synthetic);const confirmed=await scalar('select jsonb_agg(to_jsonb(e)order by archive_id)from private.withdraw_pending_capture_currency_confirmations e');await db().exec(synthetic);
 assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(e)order by archive_id)from private.withdraw_pending_capture_currency_confirmations e'),confirmed);assert.deepEqual(await metadata(),originalFunctions);
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await scalar("select has_table_privilege($1,'private.withdraw_pending_capture_currency_confirmations','SELECT,INSERT,UPDATE,DELETE')",[role]),false);
  assert.equal(await scalar("select has_function_privilege($1,'private.dashboard_admin_pending_archive_currency(uuid)','EXECUTE')",[role]),false);
 }
 await db().exec('savepoint immutable');await assert.rejects(db().exec('update private.withdraw_pending_capture_currency_confirmations set currency=currency'),/PENDING_CAPTURE_IMMUTABLE/);await db().exec('rollback to immutable');
});
test('unrecognized production content aborts atomically instead of confirming synthetic records',async()=>{
 await db().exec('savepoint unknown');await assert.rejects(db().exec(migration.replace(/^begin;$/m,'').replace(/^notify pgrst.*commit;$/m,'')),/manifest_drift/);await db().exec('rollback to unknown');
 assert.equal(await scalar('select count(*)from private.withdraw_pending_capture_currency_confirmations'),13);assert.equal(await scalar(constraints),'2b637c97b4114c7f1d9eb23fbf94c7c3');
});
test('explicit source USDT is never changed or treated as INR even with exact current content evidence',async()=>{
 await db().exec("alter table private.withdraw_pending_capture_archive disable trigger header_immutable;update private.withdraw_pending_capture_archive set currency='USDT'where id='"+uuid(1)+"'");
 const code=await syntheticSQL();await db().exec('savepoint currency');await assert.rejects(db().exec(code),/manifest_drift/);await db().exec('rollback to currency');assert.equal(await lookup(uuid(1)),'USDT');assert.equal(await scalar('select count(*)from private.withdraw_pending_capture_currency_confirmations'),13);
});
test('hash or identity mismatch cannot be confirmed and unrelated/future captures never inherit INR',async()=>{
 await db().exec(synthetic);
 for(const change of ["pending_amount=pending_amount+1","country_code='BR'","team_name='OTHER'","native_source_system='NEW_AR'","platform_id='"+uuid(999)+"'","snapshot_at=snapshot_at+interval'1 second'","window_start=window_start+1","timezone='UTC'","identity_status='legacy_unbound'"]){
  await db().exec('savepoint hash;alter table private.withdraw_pending_capture_archive disable trigger header_immutable');await db().exec('update private.withdraw_pending_capture_archive set '+change+" where id='"+uuid(1)+"'");assert.equal(await lookup(uuid(1)),null,change);await db().exec('rollback to hash');
 }
 await db().query("insert into private.withdraw_pending_capture_archive select $1,source_system,country_code,platform,stat_date,capture_date,window_start,window_end,window_days,snapshot_id,snapshot_at+interval'1 second',snapshot,timezone,capture_basis,within_midnight_window,identity_status,native_source_system,platform_id,team_name,currency,partition_snapshots,pending_count,pending_amount,updated_at from private.withdraw_pending_capture_archive where id=$2",[uuid(999),uuid(1)]);
 assert.equal(await lookup(uuid(999)),null);await db().exec('savepoint future');await assert.rejects(db().query("insert into private.withdraw_pending_capture_currency_confirmations select $1,source_system,country_code,platform,stat_date,snapshot_at,window_start,window_end,snapshot_id,platform_id,native_source_system,team_name,timezone,archive_content_sha256,currency,confirmation_basis,confirmed_at from private.withdraw_pending_capture_currency_confirmations where archive_id=$2",[uuid(999),uuid(1)]),/pending_currency_confirmed_scope/);await db().exec('rollback to future');
});
test('RLS, ACL, policies, immutable trigger, column, constraint and lookup definition drift fail before metadata inserts',async()=>{
 const changes=["alter table private.withdraw_pending_capture_currency_confirmations disable row level security","grant select on private.withdraw_pending_capture_currency_confirmations to authenticated","create policy unexpected on private.withdraw_pending_capture_currency_confirmations using(true)","alter table private.withdraw_pending_capture_currency_confirmations disable trigger pending_currency_confirmation_immutable","alter table private.withdraw_pending_capture_currency_confirmations add column unexpected text","alter table private.withdraw_pending_capture_currency_confirmations drop constraint withdraw_pending_capture_currency_confirmations_currency_check","alter function private.dashboard_admin_pending_archive_currency(uuid)security definer"];
 for(const change of changes){await db().exec('savepoint drift');await db().exec(change);await assert.rejects(db().exec(synthetic),/confirmation_(security|columns|constraints|lookup)_drift/);await db().exec('rollback to drift');assert.equal(await scalar('select count(*)from private.withdraw_pending_capture_currency_confirmations'),13);}
});
test('session timezone and authenticated scope remain constrained after confirmation',async()=>{
 await db().exec(synthetic);await db().exec("set local timezone='America/Sao_Paulo'");assert.equal(await lookup(uuid(1)),'INR');
 await db().query("select set_config('test.scope',$1,true)",[JSON.stringify({mode:'selected',countries:['BR'],platforms:[entries[0].platform]})]);await db().exec('savepoint scope');await assert.rejects(orders(0,'observed'),/platform_denied/);await db().exec('rollback to scope');
});
test('PostgreSQL 17 exact deparse is the same fifteen pinned tuples and old October 1 scope, with a separately pinned full constraint hash',async()=>{
 const printed=fs.readFileSync(path.join(__dirname,'fixtures/pending-analysis/owner-confirmed-oct3-check-pg17.sql'),'utf8').replace(/^--[^\n]*\n/,'').trim();
 const requested=migration.match(/add constraint pending_currency_confirmed_scope check ([\s\S]*?);\n end if;/)[1];
 assert.equal((printed.match(/archive_id = '/g)||[]).length,15);
 const rows=[];
 for(const e of entries){
  const r={archive_id:e.id,platform:e.platform,platform_id:e.nativeId,snapshot_at:e.at,archive_content_sha256:e.hash,stat_date:'2026-10-03'};rows.push(r);
  for(const [key,value]of Object.entries({archive_id:uuid(999),platform:'UNCONFIRMED',platform_id:uuid(998),snapshot_at:'2026-10-03 18:30:00+00',archive_content_sha256:'0'.repeat(64),stat_date:'2026-10-04'}))rows.push({...r,[key]:value});
  const other=entries[(entries.indexOf(e)+1)%entries.length];rows.push({...r,archive_id:other.id});
 }
 for(const platform of ['51GAME','55CLUB','6CLUB','82LOTTERY','91CLUB','BIGMUMBAI','IN999','JAICLUB','JALWA','LOTTERY7','OKWIN','RAJA','TPPLAY','Shree.Win','Veer.Game','UNCONFIRMED'])rows.push({...rows[0],platform,stat_date:'2026-10-01'});
 const evaluated=(await db().query(`select (${requested}) requested,(${printed.slice('CHECK '.length)}) printed from jsonb_to_recordset($1)as t(archive_id uuid,platform text,platform_id uuid,snapshot_at timestamptz,archive_content_sha256 text,stat_date date)`,[rows])).rows;
 assert.ok(evaluated.every(r=>r.requested===r.printed));assert.equal(evaluated.filter(r=>r.printed).length,28);
 // Reconstruct the observed complete hash using unchanged original constraints,
 // replacing only the two intended old CHECKs with the actual PG17 deparse.
 const actualHash=await scalar(`select md5(jsonb_agg(value order by value->>'name')::text)from(
  select jsonb_build_object('name',c.conname,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated,'deferrable',c.condeferrable,'deferred',c.condeferred)value from pg_constraint c
  where c.conrelid='private.withdraw_pending_capture_currency_confirmations'::regclass and c.contype<>'n'and c.conname not in('withdraw_pending_capture_currency_confirmations_platform_check','withdraw_pending_capture_currency_confirmations_stat_date_check')
  union all select jsonb_build_object('name','pending_currency_confirmed_scope','definition',$1::text,'validated',true,'deferrable',false,'deferred',false))x`,[printed]);
 assert.equal(actualHash,'70df0246a95d68d48b7e7c37b0217933');assert.match(migration,/constraint_hash not in \('c171210c319c4e5acaf8898e23294f10','70df0246a95d68d48b7e7c37b0217933'\)/);
});
