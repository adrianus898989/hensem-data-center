// Execute the guarded upgrade against synthetic PostgreSQL data; no network or customer rows.
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..');
const canonical=fs.readFileSync(path.join(root,'supabase/admin-live-intake-coverage.sql'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260930190000_ar_creation_coverage.sql'),'utf8');
const baseline=canonical.replace(/\n -- AR_CREATION_COVERAGE_DECL_BEGIN[\s\S]*? -- AR_CREATION_COVERAGE_DECL_END/,'')
 .replace(/\n     -- AR_CREATION_COVERAGE_BEGIN[\s\S]*?     -- AR_CREATION_COVERAGE_END/,'')
 .replace(/do \$baseline\$[\s\S]*?end;\$baseline\$;/,'-- Synthetic dependency baseline');
const fixture=fs.readFileSync(path.join(__dirname,'admin-sync-health.test.cjs'),'utf8')
 .match(/await db\.exec\(`([\s\S]*?)`\);await feed/)[1].replaceAll('${id}','10000000-0000-4000-8000-000000000003');
const body=source=>source.match(/create or replace function private.dashboard_admin_live_intake_coverage\([\s\S]*?as \$\$([\s\S]*?)\$\$;/)[1];
const md5=text=>crypto.createHash('md5').update(text).digest('hex');
const day='2026-09-25',snapshotId='20000000-0000-4000-8000-000000000001',snapshotAt='2026-09-26T00:00:00Z';
let db,chargeFeed,withdrawFeed;
const call=async request=>(await db.query('select public.dashboard_admin_live_intake_coverage($1::jsonb) data',[JSON.stringify(request)])).rows[0].data;
const rows=async (direction='charge',startAt=day,endAt=day)=>(await call({operation:'rows',feedIds:[direction==='charge'?chargeFeed:withdrawFeed],startAt,endAt})).rows;
const one=async direction=>(await rows(direction))[0];
const group=(channel,n,type='UPI')=>({raw_channel:channel,channel_type:type,submitted_count:n,success_count:0});
const snapshot=(groups=[group('A',2),group('B',1)])=>{const n=groups.reduce((sum,g)=>sum+g.submitted_count,0);return {
 schema_version:1,source_system:'RECHARGE_REVIEW',country_code:'IN',platform:'AR',stat_date:day,timezone:'Asia/Kolkata',snapshot_id:snapshotId,snapshot_at:snapshotAt,
 coverage:{complete:true,expected_count:n,fetched_count:n,unique_count:n},totals:{submitted_count:n,success_count:0},groups};};
const saveSnapshot=async (value=snapshot(),overrides={})=>{const meta={country:'IN',platform:'AR',day,source:'RECHARGE_REVIEW',id:snapshotId,at:snapshotAt,...overrides};
 await db.query('insert into collection_success_daily(country_code,platform,stat_date,source_system,snapshot_id,snapshot_at,updated_at,snapshot) values($1,$2,$3,$4,$5,$6,$6,$7::jsonb)',[meta.country,meta.platform,meta.day,meta.source,meta.id,meta.at,JSON.stringify(value)]);};
const orders=async (channel,count,overrides={})=>{const o={country:'IN',platform:'AR',kind:'recharge',source:'AR',applied:`${day} 10:00`,completed:null,type:'UPI',...overrides};
 await db.query('insert into ar_collected_orders(country_code,platform,order_kind,source_system,applied_at,completed_at,updated_at,raw_channel,channel_type) select $1,$2,$3,$4,$5::timestamp,$6::timestamp,$7::timestamptz,$8,$9 from generate_series(1,$10::integer)',[o.country,o.platform,o.kind,o.source,o.applied,o.completed,snapshotAt,channel,o.type,count]);};
const metadata=async()=>(await db.query("select n.nspname,p.prosrc,p.proacl::text,p.prosecdef,p.proconfig,p.proowner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid in ('private.dashboard_admin_live_intake_coverage(jsonb)'::regprocedure,'public.dashboard_admin_live_intake_coverage(jsonb)'::regprocedure) order by n.nspname")).rows;
before(async()=>{
 db=new PGlite();await db.exec(fixture);await db.exec(`
 create role service_role;
 alter table ar_collected_orders add raw_channel text,add channel_type text;
 alter table collection_success_daily add snapshot jsonb,add snapshot_id uuid;
 alter table collection_success_daily add unique(source_system,country_code,platform,stat_date);
 alter table lg_orders add paid_at timestamptz;
 alter table lg_sync_runs add source_total bigint;
 alter table game66_sync_runs add rows_upserted integer,add rows_skipped integer,add error_count integer;
 alter table auto_withdraw_daily add source_sheet text;
 `);await db.exec(baseline);
 assert.equal(md5(body(baseline)),'ec7507aca3dd677e9f4a85d6ad59b9a7');
 await db.exec('grant execute on function public.dashboard_admin_live_intake_coverage(jsonb) to service_role');
 const before=await metadata();await db.exec(migration);const after=await metadata();
 assert.equal(after[0].prosrc,body(canonical));assert.equal(after[1].prosrc,before[1].prosrc);
 for(let i=0;i<2;i++)for(const field of ['proacl','prosecdef','proconfig','proowner'])assert.deepEqual(after[i][field],before[i][field],field);
 const feeds=(await call({operation:'catalog'})).feeds;chargeFeed=feeds.find(f=>f.name==='AR'&&f.direction==='charge'&&f.dataset==='orders').id;withdrawFeed=feeds.find(f=>f.name==='AR'&&f.direction==='withdraw'&&f.dataset==='orders').id;
});
beforeEach(async()=>{await db.exec("delete from ar_collected_orders;delete from collection_success_daily;select set_config('test.scope','{\"mode\":\"all\"}',false)");});
after(async()=>db?.close());

test('guarded production-shaped upgrade preserves ACLs, exact canonical body and idempotent replay',async()=>{const before=await metadata();await db.exec(migration);assert.deepEqual(await metadata(),before);assert.match(before[1].proacl,/service_role=X/);});
test('matching raw creation totals and exact channels certify complete',async()=>{await orders('A',2);await orders('B',1);await saveSnapshot();const r=await one();assert.equal(r.status,'complete');assert(r.complete&&r.received&&!r.zeroConfirmed);assert.equal(r.expectedCount,3);assert.equal(r.fetchedCount,3);assert.equal(r.evidence,'source_created_counts_reconciled');});
test('valid full-day zero snapshot with no created orders certifies zero',async()=>{await saveSnapshot(snapshot([]));const r=await one();assert.equal(r.status,'zero_complete');assert(r.complete&&r.received&&r.zeroConfirmed);assert.equal(r.expectedCount,0);assert.equal(r.fetchedCount,0);assert.equal(r.evidence,'source_completed_zero_rows');});
test('absence and cross-day success do not certify a zero creation day',async()=>{let r=await one();assert.equal(r.status,'not_received');assert(!r.complete&&!r.received&&!r.zeroConfirmed);assert.equal(r.expectedCount,null);await orders('A',2,{applied:'2026-09-24 23:59',completed:`${day} 01:00`});r=await one();assert.equal(r.status,'not_received');assert.equal(r.evidence,'only_success_day_records_received');assert(!r.complete&&!r.zeroConfirmed);});
test('existing orders without a complete snapshot remain received and unverified',async()=>{await orders('A',2);const r=await one();assert.equal(r.status,'received');assert(r.received&&!r.complete&&!r.zeroConfirmed);assert.equal(r.evidence,'records_received_completeness_unverified');assert.equal(r.expectedCount,null);});
test('fewer created orders expose the exact expected and fetched counts',async()=>{await orders('A',1);await saveSnapshot();const r=await one();assert.equal(r.status,'partial');assert.equal(r.expectedCount,3);assert.equal(r.fetchedCount,1);assert.equal(r.evidence,'source_created_count_mismatch');assert(r.received&&!r.complete);});
test('zero received against a positive complete snapshot remains partial, not confirmed zero',async()=>{await saveSnapshot();const r=await one();assert.equal(r.status,'partial');assert.equal(r.fetchedCount,0);assert.equal(r.expectedCount,3);assert(!r.received&&!r.complete&&!r.zeroConfirmed);});
test('unexpected extra raw orders and a zero snapshot conflicting with rows fail completeness',async()=>{await orders('A',4);await saveSnapshot();let r=await one();assert.equal(r.status,'partial');assert.equal(r.fetchedCount,4);await db.exec('delete from collection_success_daily');await saveSnapshot(snapshot([]));r=await one();assert.equal(r.status,'partial');assert.equal(r.expectedCount,0);assert(!r.zeroConfirmed);});
test('same total cannot hide a missing channel or channel type',async()=>{await orders('A',3);await saveSnapshot();let r=await one();assert.equal(r.status,'partial');assert.equal(r.evidence,'source_created_channel_mismatch');await db.exec('delete from ar_collected_orders');await orders('A',2);await orders('B',1,{type:'BANK'});r=await one();assert.equal(r.status,'partial');assert.equal(r.evidence,'source_created_channel_mismatch');});
test('null raw channel is retained as mismatch, never dropped by the aggregate',async()=>{await orders('A',2);await orders(null,1);await saveSnapshot();const r=await one();assert.equal(r.fetchedCount,3);assert.equal(r.status,'partial');assert.equal(r.evidence,'source_created_channel_mismatch');});
test('completion is independent of success status changing after the snapshot',async()=>{await orders('A',2,{completed:'2026-09-28 14:00'});await orders('B',1,{completed:`${day} 10:10`});await saveSnapshot();assert.equal((await one()).status,'complete');await db.exec('update ar_collected_orders set completed_at=null');assert.equal((await one()).status,'complete');});
test('raw local day, country, platform, source and order kind are exact',async()=>{await orders('A',2,{applied:`${day} 00:00`});await orders('B',1,{applied:`${day} 23:59:59.999999`});
 for(const extra of [{applied:'2026-09-24 23:59:59'},{applied:'2026-09-26 00:00'},{country:'BR'},{platform:'AR-OTHER'},{source:'OTHER'},{kind:'withdraw'}])await orders('PRIVATE-UNRELATED',50,extra);
 await saveSnapshot();const r=await one();assert.equal(r.status,'complete');assert.equal(r.fetchedCount,3);assert.doesNotMatch(JSON.stringify(r),/PRIVATE-UNRELATED|raw_channel|member|order_no/);});
test('snapshot with another source identity cannot verify this AR feed',async()=>{await orders('A',3);for(const overrides of [{country:'BR'},{platform:'AR-OTHER'},{source:'OTHER'},{day:'2026-09-24'}])await saveSnapshot(snapshot(),overrides);const r=await one();assert.equal(r.status,'received');assert.equal(r.expectedCount,null);assert(!r.complete);});
test('snapshot metadata mismatches, malformed times and premature capture remain unverified',async()=>{for(const patch of [{platform:'OTHER'},{country_code:'BR'},{timezone:'UTC'},{stat_date:'2026-09-24'},{snapshot_id:'20000000-0000-4000-8000-000000000099'},{schema_version:'1'},{snapshot_at:'2026-02-31T00:00:00Z'},{snapshot_at:'not-a-time'},{snapshot_at:'2026-09-26T01:00:00Z'}]){
 await db.exec('delete from collection_success_daily');await saveSnapshot({...snapshot([]),...patch});const r=await one();assert.equal(r.collectorStatus,'snapshot_invalid',JSON.stringify(patch));assert(!r.complete&&!r.zeroConfirmed);}
 await db.exec('delete from collection_success_daily');await saveSnapshot({...snapshot([]),snapshot_at:'2026-09-25T12:00:00Z'},{at:'2026-09-25T12:00:00Z'});assert.equal((await one()).collectorStatus,'snapshot_invalid');});
test('future snapshot capture cannot certify zero',async()=>{const future='2099-01-01T00:00:00Z';await saveSnapshot({...snapshot([]),snapshot_at:future},{at:future});assert.equal((await one()).collectorStatus,'snapshot_invalid');});
test('invalid complete/count metadata fails closed without casting errors',async()=>{const bad=[null,'3',-1,1.5,9007199254740992,{},[]];for(const value of bad){await db.exec('delete from collection_success_daily');const s=snapshot();s.coverage.expected_count=value;await saveSnapshot(s);const r=await one();assert.equal(r.collectorStatus,'snapshot_invalid');assert.equal(r.expectedCount,null);assert(!r.complete);}
 for(const patch of [{complete:false},{fetched_count:2},{unique_count:2}]){await db.exec('delete from collection_success_daily');const s=snapshot();Object.assign(s.coverage,patch);await saveSnapshot(s);assert.equal((await one()).collectorStatus,'snapshot_invalid');}});
test('invalid groups, duplicate identity or group sum cannot certify an otherwise matching total',async()=>{for(const groups of [null,{},[group('A',3),group('A',1)],[group('A',0)],[group('A',-1)],[group('A',1.5)],[group('A','3')],[group('',3)],[group('A',3,'')],[group('A',2)],Array(2001).fill(group('A',1))]){
 await db.exec('delete from collection_success_daily');await saveSnapshot({...snapshot(),groups});const r=await one();assert.equal(r.collectorStatus,'snapshot_invalid');assert(!r.complete);}});
test('invalid snapshot still exposes received orders without asserting completeness',async()=>{await orders('A',1);const s=snapshot();s.coverage.complete=false;await saveSnapshot(s);const r=await one();assert.equal(r.status,'received');assert.equal(r.evidence,'source_snapshot_invalid');assert(r.received&&!r.complete);});
test('each day is reconciled independently and a later snapshot does not fill an earlier gap',async()=>{await orders('A',2);await orders('B',1);await saveSnapshot();const r=await rows('charge','2026-09-24',day);assert.equal(r[0].status,'not_received');assert.equal(r[1].status,'complete');});
test('withdraw branch is unchanged even when the charge snapshot is complete zero',async()=>{await saveSnapshot(snapshot([]));let r=await one('withdraw');assert.equal(r.status,'not_received');assert.equal(r.expectedCount,null);await orders('A',1,{kind:'withdraw'});r=await one('withdraw');assert.equal(r.status,'received');assert(r.received&&!r.complete&&!r.zeroConfirmed);assert.equal(r.collectorStatus,null);});
test('fresh authorization rejects unscoped source access before scanning counts',async()=>{await db.query("select set_config('test.scope',$1,false)",['{"countries":["巴西"]}']);await assert.rejects(one(),/coverage_feed_denied/);await db.query("select set_config('test.scope','',false)");await assert.rejects(one(),/unauthorized/);});
test('upgrade rejects anonymous, unexpected-role, grant-option and private service grants',async()=>{const changes=[
 'grant execute on function public.dashboard_admin_live_intake_coverage(jsonb) to anon',
 'grant execute on function public.dashboard_admin_live_intake_coverage(jsonb) to public',
 'grant execute on function public.dashboard_admin_live_intake_coverage(jsonb) to authenticated with grant option',
 'grant execute on function private.dashboard_admin_live_intake_coverage(jsonb) to service_role',
 'revoke execute on function private.dashboard_admin_live_intake_coverage(jsonb) from authenticated'];
 for(const change of changes){const before=await metadata();await db.exec('begin');await db.exec(change);await assert.rejects(db.exec(migration),/ar_creation_coverage_.*acl_drift/);await db.exec('rollback');assert.deepEqual(await metadata(),before);}});
test('upgrade rejects function-body and security drift and restores neither blindly',async()=>{for(const change of [
 "alter function private.dashboard_admin_live_intake_coverage(jsonb) security invoker",
 "alter function private.dashboard_admin_live_intake_coverage(jsonb) set search_path=public",
 "create or replace function public.dashboard_admin_live_intake_coverage(p_request jsonb default '{}') returns jsonb language sql stable security invoker set search_path='' as $$ select '{}'::jsonb $$"
 ]){const before=await metadata();await db.exec('begin');await db.exec(change);await assert.rejects(db.exec(migration),/ar_creation_coverage_.*drift/);await db.exec('rollback');assert.deepEqual(await metadata(),before);}});
