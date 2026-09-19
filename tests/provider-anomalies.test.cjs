const assert = require('node:assert/strict');
const {test, before, after} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require('@electric-sql/pglite');
const {loadTs, root} = require('./load-typescript.cjs');
const {buildProviderAnomalyResponse, anomalyDateRange} = loadTs(path.join(root, 'supabase/functions/dashboard-api/lib/providerAnomalies.ts'));
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260919161637_provider_anomaly_metrics.sql'), 'utf8');
const visible = '00000000-0000-0000-0000-000000000001', hidden = '00000000-0000-0000-0000-000000000002';
let db;
async function raw(start = '2026-09-17', end = '2026-09-18') {
  return (await db.query('select public.dashboard_provider_anomaly_inputs($1,$2) as data', [start,end])).rows[0].data;
}
async function result(start, end) {return buildProviderAnomalyResponse(await raw(start,end), start || '2026-09-17', end || '2026-09-18');}
async function identity(uid = '10000000-0000-0000-0000-000000000001', permission = 'yes') {
  await db.query("select set_config('test.uid',$1,false),set_config('test.permission',$2,false)", [uid,permission]);
}
function snapshot(overrides = {}) {
  return {schema_version:1,snapshot_id:'10000000-0000-0000-0000-000000000001',source_system:'GAME66',country_code:'HK_TEAM',platform:'EK7',currency:'INR',timezone:'Asia/Kolkata',
    scheduled_at:'2026-09-17T18:30:00Z',observation_started_at:'2026-09-17T18:30:00Z',captured_at:'2026-09-17T18:32:00Z',
    coverage:{complete:true,expected_count:2,fetched_count:2,unique_count:2},totals:{pending_count:2,pending_amount:100},
    groups:[{raw_channel:'PayA',channel_type:'BANK',currency:'INR',pending_count:2,pending_amount:100,
      age_buckets:[{min_days:0,max_days:1,count:1,amount:40},{min_days:1,max_days:2,count:0,amount:0},
        {min_days:2,max_days:3,count:0,amount:0},{min_days:3,max_days:7,count:1,amount:60},{min_days:7,max_days:null,count:0,amount:0}]}],...overrides};
}
const publish = async s => (await db.query('select public.publish_provider_midnight_snapshot($1) as data', [s])).rows[0].data;
before(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create schema private; create role anon; create role authenticated; create role service_role;
    grant usage on schema auth,private to authenticated;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function public.dashboard_has_permission(text) returns boolean language sql as $$select case current_setting('test.permission',true) when 'null' then null else current_setting('test.permission',true)='yes' end$$;
    create function private.dashboard_current_data_scope() returns jsonb language sql as $$select '{}'::jsonb$$;
    create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql as $$select ($2='HK_TEAM' and $3='EK7') or ($2='IN' and $3='IndiaA')$$;
    create table game66_platforms(id uuid primary key,platform_name text,team_code text);
    create table game66_charge_orders(platform_id uuid,create_time timestamptz,pay_time timestamptz,pay_method_name text,
      status_code text,amount_display numeric,amount_minor numeric,last_seen_at timestamptz,uid text,raw_payload jsonb);
    create index game66_charge_platform_created_idx on game66_charge_orders(platform_id,create_time);
    create index game66_charge_platform_paid_idx on game66_charge_orders(platform_id,pay_time) where status_code='1';
    create table collection_success_daily(source_system text,country_code text,platform text,stat_date date,snapshot_at timestamptz,snapshot jsonb);
    insert into game66_platforms values('${visible}','EK7','hong_kong'),('${hidden}','Hidden','red_crab');`);
  await db.exec(migration);
  await identity();
  // Delay cohort uses success time, so an old creation with current success is
  // included. A pending row with a spurious pay_time is never a delayed success.
  const charges = [
    ['PayA','2026-09-16T00:00:00+05:30','2026-09-18T00:00:00+05:30','1',10],
    ['PayA','2026-09-18T10:00:00+05:30','2026-09-18T10:10:00+05:30','1',30],
    ['PayA','2026-09-18T10:00:00+05:30','2026-09-18T10:30:00+05:30','1',60],
    ['PayA','2026-09-18T10:00:00+05:30','2026-09-18T12:00:00+05:30','0',900],
    ['PayB','2026-09-18T10:00:00+05:30','2026-09-18T10:00:30+05:30','1',10],
    ['PayBad','2026-09-18T11:00:00+05:30','2026-09-18T10:00:30+05:30','1',0],
    ['PayNull',null,'2026-09-18T10:00:30+05:30','1',0],
    ['ExcludedEnd','2026-09-19T00:00:00+05:30','2026-09-19T00:00:00+05:30','1',1],
  ];
  for (const [provider,created,paid,status,amount] of charges) await db.query(`insert into game66_charge_orders values($1,$2,$3,$4,$5,$6::numeric,$6::numeric*100,'2026-09-19T00:00:00Z','private-member','{"secret":"hidden"}')`,[visible,created,paid,provider,status,amount]);
  await db.query(`insert into game66_charge_orders values($1,'2026-09-18T00:00:00Z','2026-09-18T01:00:00Z','HiddenProvider','1',999,99900,now(),'hidden','{}')`,[hidden]);
  const success = {timezone:'Asia/Kolkata',coverage:{complete:true,expected_count:100,fetched_count:100,unique_count:100},
    totals:{submitted_count:100,success_count:10},groups:[{raw_channel:'UPI-QR',channel_type:'UPI',submitted_count:100,success_count:10}]};
  await db.query(`insert into collection_success_daily values('RECHARGE_REVIEW','IN','IndiaA','2026-09-18','2026-09-19T00:00:00Z',$1),
    ('WITHDRAW_REVIEW','IN','IndiaA','2026-09-18','2026-09-19T01:00:00Z',$1),
    ('RECHARGE_REVIEW','IN','Hidden','2026-09-18','2026-09-19T00:00:00Z',$1)`,[success]);
});
after(async () => {if (db) await db.close();});

test('read-only RPC requires login, non-null module permission, and applies server scope', async () => {
  const data = await raw();
  assert.ok(!JSON.stringify(data).includes('Hidden'));
  assert.equal(data.successSnapshots.length,1,'unverified WITHDRAW_REVIEW is not mixed or double-counted');
  assert.ok(!JSON.stringify(data).includes('private-member'));
  assert.ok(!JSON.stringify(data).includes('secret'));
  for (const permission of ['no','null']) {await identity(undefined,permission); await assert.rejects(raw,/没有三方查询权限/);}
  await identity(''); await assert.rejects(raw,/请先登录/); await identity();
});
test('least privilege: anon denied, raw data and publisher denied to viewer, invoker public facade', async () => {
  const funcs = (await db.query(`select n.nspname,p.prosecdef,has_function_privilege('anon',p.oid,'execute') as anon,
    has_function_privilege('authenticated',p.oid,'execute') as viewer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.proname='dashboard_provider_anomaly_inputs' order by n.nspname`)).rows;
  assert.equal(funcs.length,2);
  for (const f of funcs) {assert.equal(f.anon,false);assert.equal(f.viewer,true);assert.equal(f.prosecdef,f.nspname==='private');}
  await db.exec('set role authenticated');
  try {
    assert.ok((await raw()).detailRows.length);
    await assert.rejects(() => db.query('select * from public.game66_charge_orders'),/permission denied/);
    await assert.rejects(() => db.query('select * from public.provider_midnight_snapshots'),/permission denied/);
    await assert.rejects(() => publish(snapshot()),/permission denied/);
  } finally {await db.exec('reset role');}
  await db.exec('set role anon');
  try {await assert.rejects(raw,/permission denied/);} finally {await db.exec('reset role');}
});
test('ranges are real calendar dates, inclusive dates / exclusive local-day end, max31 days', async () => {
  for (const [start,end] of [['2026-02-30','2026-03-01'],['2026-09-18','2026-09-17'],['2026-08-01','2026-09-18'],['','']]) assert.throws(() => anomalyDateRange(start,end));
  for (const [start,end] of [[null,'2026-09-18'],['2026-09-18',null],['infinity','infinity'],['2026-09-18','2026-09-17'],['2026-08-01','2026-09-18']]) await assert.rejects(() => raw(start,end),/最多31天/);
  assert.ok(!(await raw()).detailRows.some(r => r.provider==='ExcludedEnd'));
});
test('delay proxy has exact disjoint mergeable buckets, old-create/current-success, no unpaid-lost claims', async () => {
  const data = await result(), a = data.sources.find(s => s.provider==='PayA');
  assert.equal(a.createdSuccess.sample,3);
  assert.equal(a.createdSuccess.basis,'created_to_success_proxy');
  assert.equal(a.createdSuccess.windowBasis,'success_time');
  assert.equal(a.createdSuccess.customerPaymentVerified,false);
  assert.equal(a.createdSuccess.p95Seconds,null,'raw percentiles must not be averaged after alias merge');
  assert.equal(a.createdSuccess.delayBuckets.find(b => b.minSeconds===600).count,1);
  assert.equal(a.createdSuccess.delayBuckets.find(b => b.minSeconds===1800).count,1);
  assert.equal(a.createdSuccess.delayBuckets.find(b => b.minSeconds===172800).count,1);
  assert.equal(a.createdSuccess.coverage,'unknown');
  assert.equal(data.sources.find(s => s.provider==='PayBad').createdSuccess.invalidTimeCount,1);
  assert.equal(data.sources.find(s => s.provider==='PayNull').createdSuccess.invalidTimeCount,1);
});
test('success-rate complete days use charge cohorts, missing days remain null, UPI is not exempted', async () => {
  const source = (await result()).sources.find(s => s.provider==='UPI-QR');
  assert.deepEqual(source.successDays.map(d => [d.date,d.total,d.success,d.coverage]),[
    ['2026-09-17',null,null,'unknown'],['2026-09-18',100,10,'complete']]);
  assert.equal(source.midnight.verified,false); assert.equal(source.midnight.count,null);
});
test('incomplete snapshot and corrupt delay bucket totals fail closed; denominator key deduplicates channels', async () => {
  const input = await raw();
  input.successSnapshots[0].coverage.unique_count=99;
  input.detailRows.find(r => r.provider==='PayA').delay_buckets[0]=100;
  const data = buildProviderAnomalyResponse(input,'2026-09-17','2026-09-18');
  assert.equal(data.sources.find(s => s.provider==='UPI-QR').successDays[1].total,null);
  const a=data.sources.find(s => s.provider==='PayA'), b=data.sources.find(s => s.provider==='PayB');
  assert.equal(a.createdSuccess.sample,null);
  assert.equal(a.share.denominatorKey,b.share.denominatorKey);
  assert.equal(a.share.totalAmount,100); assert.equal(a.share.providerAmount,90);
  assert.equal(a.currency,null); assert.equal(a.share.coverage,'unknown');
});
test('future archive is append-only, identical ID retries idempotent and changed ID payload rejected', async () => {
  const s = snapshot();
  await db.exec('set role service_role');
  try {assert.equal((await publish(s)).verified,true); assert.equal((await publish(s)).ok,true);}
  finally {await db.exec('reset role');}
  assert.equal((await db.query('select count(*)::int n from provider_midnight_snapshots')).rows[0].n,1);
  await assert.rejects(() => publish({...s,platform:'Other'}),/MIDNIGHT_ID_REUSE/);
  await assert.rejects(() => db.query("update provider_midnight_snapshots set platform='Other'"),/IMMUTABLE/);
  await assert.rejects(() => db.query('delete from provider_midnight_snapshots'),/IMMUTABLE/);
  const row=(await result()).sources.find(s => s.provider==='PayA'&&s.currency==='INR');
  assert.equal(row.midnight.count,2); assert.equal(row.midnight.amount,100); assert.equal(row.midnight.verified,true);
  assert.equal(row.midnight.maxAgeDays,null,'a bucket bound is not an exact maximum');
  assert.equal(row.midnight.basis,'observed_near_midnight'); assert.equal(row.midnight.toleranceSeconds,300);
  assert.equal(row.midnight.ageBasis,'created_at_to_scheduled_at');assert.equal(row.midnight.continuityVerified,false);
  assert.equal(row.midnight.ageBuckets.find(b => b.minDays===3).count,1);
  assert.equal(row.midnightDays[0].count,null,'cannot reconstruct earlier midnight');
});
test('midnight lateness or incomplete observation stays unknown and cannot replace timely archive', async () => {
  await publish(snapshot({snapshot_id:'10000000-0000-0000-0000-000000000002',captured_at:'2026-09-17T20:00:00Z'}));
  assert.equal(Date.parse((await result()).sources.find(s => s.provider==='PayA'&&s.currency==='INR').midnight.latestAt),Date.parse('2026-09-17T18:32:00Z'));
  await publish(snapshot({snapshot_id:'10000000-0000-0000-0000-000000000003',platform:'IndiaA',country_code:'IN',coverage:{complete:false,expected_count:3,fetched_count:2,unique_count:2}}));
  const incomplete=(await result()).sources.find(s => s.platform==='IndiaA'&&s.currency==='INR');
  assert.equal(incomplete.midnight.count,null);assert.equal(incomplete.midnight.verified,false);
});
test('midnight validates actual local midnight, times, bucket totals, currency, descriptors and PII whitelist', async () => {
  const bads=[{scheduled_at:'2026-09-17T00:00:00Z'},{captured_at:'2026-09-17T18:29:59Z'},
    {timezone:'Asia/NotAZone'},{raw_payload:{secret:true}},{currency:'inr'},
    {coverage:{complete:true,expected_count:3,fetched_count:2,unique_count:2}},{totals:{pending_count:2,pending_amount:101}}];
  for (const bad of bads) await assert.rejects(() => publish(snapshot(bad)),/MIDNIGHT_/);
  const wrongCurrency=snapshot();wrongCurrency.groups[0].currency='USDT';await assert.rejects(() => publish(wrongCurrency),/INVALID_GROUPS/);
  const wrongAge=snapshot();wrongAge.groups[0].age_buckets[0].count=2;await assert.rejects(() => publish(wrongAge),/AGE_TOTAL_MISMATCH/);
  const duplicate=snapshot();duplicate.groups.push(duplicate.groups[0]);await assert.rejects(() => publish(duplicate),/DUPLICATE_GROUP/);
  const missingBound=snapshot();delete missingBound.groups[0].age_buckets[4].max_days;await assert.rejects(() => publish(missingBound),/AGE_BUCKETS/);
});
test('route is authenticated GET via viewer token and never calls a service-role key', () => {
  const edge=fs.readFileSync(path.join(root,'supabase/functions/dashboard-api/index.ts'),'utf8');
  const block=edge.slice(edge.indexOf('if (route === "/api/provider-anomalies")'),edge.indexOf('if (route === "/api/auto-withdraw")'));
  assert.match(block,/requireDashboardDataAccess\(request, "third_party"\)/);
  assert.match(block,/dashboard_provider_anomaly_inputs/);
  assert.match(block,/anomaly_data_unavailable/);
  assert.doesNotMatch(block,/SERVICE_ROLE|publish_provider_midnight/);
});
