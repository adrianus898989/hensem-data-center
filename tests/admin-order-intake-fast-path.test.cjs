// Real PostgreSQL regression for bounded order catalogs; synthetic fixtures only.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..');
const canonical=fs.readFileSync(path.join(root,'supabase/admin-live-intake-coverage.sql'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260930222000_order_intake_fast_path.sql'),'utf8');
const fixture=fs.readFileSync(path.join(__dirname,'admin-sync-health.test.cjs'),'utf8')
 .match(/await db\.exec\(`([\s\S]*?)`\);await feed/)[1].replaceAll('${id}','10000000-0000-4000-8000-000000000003');
const md5=text=>crypto.createHash('md5').update(text).digest('hex');
const call=async request=>(await db.query('select public.dashboard_admin_live_intake_coverage($1::jsonb) data',[JSON.stringify(request)])).rows[0].data;
const catalog=async operation=>(await call({operation:operation||'catalog'})).feeds;
const rejectsCall=async(request,pattern)=>{
 await db.exec('savepoint expected_rejection');
 try{await assert.rejects(call(request),pattern);}finally{await db.exec('rollback to savepoint expected_rejection;release savepoint expected_rejection');}
};
const withoutChecked=r=>{const {checkedAt,...rest}=r;return rest;};
const rowRequest=ids=>({operation:'rows',feedIds:ids,startAt:'2026-09-23',endAt:'2026-09-25'});
const metadata=async()=>(await db.query("select n.nspname,p.prosrc,p.proacl::text,p.prosecdef,p.proconfig,p.proowner,p.provolatile,p.pronargdefaults from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid in ('private.dashboard_admin_live_intake_coverage(jsonb)'::regprocedure,'public.dashboard_admin_live_intake_coverage(jsonb)'::regprocedure) order by n.nspname")).rows;
const forbidFull=async()=>db.exec("create or replace function private.dashboard_admin_live_intake_feeds(p_asof timestamptz) returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$begin raise exception 'full_catalog_must_not_be_called';end;$$");
let db,initialMetadata,allFeeds,nativeFeeds,reportFeed,configFeed,oldNativeRows,oldMixedRows,oldReportRows;
before(async()=>{
 db=new PGlite();await db.exec(fixture);
 await db.exec(`
 create role service_role;
 alter table ar_collected_orders add raw_channel text,add channel_type text;
 alter table collection_success_daily add snapshot jsonb,add snapshot_id uuid;
 alter table collection_success_daily add unique(source_system,country_code,platform,stat_date);
 alter table lg_orders add paid_at timestamptz;
 alter table lg_sync_runs add source_total bigint;update lg_sync_runs set source_total=expected_count;
 alter table game66_sync_runs add rows_upserted integer,add rows_skipped integer,add error_count integer;
 update game66_sync_runs set rows_upserted=rows_fetched,rows_skipped=0,error_count=0;
 alter table auto_withdraw_daily add source_sheet text;
 insert into fixture_platforms values('10000000-0000-4000-8000-000000000004','LG','M8','印度','印度','lg','Asia/Kolkata','INR','LG');
 insert into fixture_feeds values('{"dataset":"volume","system":"REPORT","name":"SHEET","country":"印度","rawCountry":"印度","rawPlatform":"SHEET","directions":["charge"],"provenance":{"kind":"google_sheets"}}');
 insert into fixture_feeds values('{"dataset":"lg_orders","system":"LG","name":"LG","country":"印度","rawCountry":"印度","rawPlatform":"LG","directions":["charge"],"provenance":{"kind":"direct"}}');
 `);
 await db.exec(canonical.replace(/do \$baseline\$[\s\S]*?end;\$baseline\$;/,'-- Synthetic dependency baseline'));
 await db.exec('grant execute on function public.dashboard_admin_live_intake_coverage(jsonb) to service_role');
 initialMetadata=await metadata();assert.equal(md5(initialMetadata[0].prosrc),'c8550ba902b18fed16dc60c26393cba8');
 allFeeds=await catalog();nativeFeeds=allFeeds.filter(f=>f.dataset==='orders');
 reportFeed=allFeeds.find(f=>f.dataset==='volume');configFeed=allFeeds.find(f=>f.dataset==='ar_config');
 assert.equal(nativeFeeds.length,8);assert(reportFeed&&configFeed);
 oldNativeRows=withoutChecked(await call(rowRequest(nativeFeeds.map(f=>f.id))));
 oldMixedRows=withoutChecked(await call(rowRequest([nativeFeeds[0].id,reportFeed.id,configFeed.id])));
 oldReportRows=withoutChecked(await call(rowRequest([reportFeed.id,configFeed.id])));
 await db.exec(migration);
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));

test('orderCatalog feed identities and every field equal full-catalog orders for all native systems',async()=>{
 const native=await catalog('orderCatalog'),full=await catalog();
 assert.deepEqual(full,allFeeds);assert.deepEqual(native,full.filter(f=>f.dataset==='orders'));
 assert.deepEqual(native,nativeFeeds);assert.equal(new Set(native.map(f=>f.id)).size,8);
 assert.deepEqual([...new Set(native.map(f=>f.system))].sort(),['ar','game66','lg','newar']);
 assert(native.every(f=>f.sourceKind==='direct'&&f.platformId&&['charge','withdraw'].includes(f.direction)));
 assert(!full.some(f=>f.dataset==='lg_orders'&&f.rawPlatform==='LG'),'native LG replaces duplicate report inventory');
});
test('order-only helper matches the original filter at the same timezone-sensitive instant',async()=>{
 const r=(await db.query(`select private.dashboard_admin_live_intake_order_feeds('2026-09-26T01:00:00Z') fast,
 (select coalesce(jsonb_agg(f order by ordinality),'[]'::jsonb) from jsonb_array_elements(private.dashboard_admin_live_intake_feeds('2026-09-26T01:00:00Z')) with ordinality t(f,ordinality) where f->>'dataset'='orders') expected`)).rows[0];
 assert.deepEqual(r.fast,r.expected);assert.equal(r.fast.find(f=>f.name==='NEW').timezone,'Asia/Kathmandu');
 assert.equal(r.fast.find(f=>f.name==='AR').defaultEnd,'2026-09-25');
});
test('orderCatalog never calls the full report/configuration catalog',async()=>{
 await forbidFull();const r=await call({operation:'orderCatalog'});
 assert.equal(r.complete,true);assert.equal(r.maxDays,93);assert.equal(r.maxFeeds,8);
 assert.deepEqual(r.feeds,nativeFeeds);
 await rejectsCall({operation:'catalog'},/full_catalog_must_not_be_called/);
});
test('all-native rows bypass full catalog and retain every old daily evidence result',async()=>{
 await forbidFull();const r=withoutChecked(await call(rowRequest(nativeFeeds.map(f=>f.id))));
 assert.deepEqual(r,oldNativeRows);
 assert.equal(r.rows.find(x=>x.feedId===nativeFeeds.find(f=>f.name==='NEW'&&f.direction==='charge').id&&x.date==='2026-09-23').status,'not_expected');
});
test('non-order and mixed requests retain old source-specific results through fallback',async()=>{
 assert.deepEqual(withoutChecked(await call(rowRequest([reportFeed.id,configFeed.id]))),oldReportRows);
 assert.deepEqual(withoutChecked(await call(rowRequest([nativeFeeds[0].id,reportFeed.id,configFeed.id]))),oldMixedRows);
});
test('non-order and mixed requests call the full catalog when a feed is not native',async()=>{
 await forbidFull();
 await rejectsCall(rowRequest([reportFeed.id]),/full_catalog_must_not_be_called/);
 await rejectsCall(rowRequest([nativeFeeds[0].id,reportFeed.id]),/full_catalog_must_not_be_called/);
});
test('native catalog avoids report enumeration and all configuration target tables',async()=>{
 await db.exec("create or replace function private.dashboard_admin_live_collected_data(jsonb) returns jsonb language plpgsql stable as $$begin raise exception 'report_inventory_must_not_be_called';end;$$");
 await db.exec('drop table ar_config_targets,panda_config_targets,wg_config_targets');
 const fast=await catalog('orderCatalog');assert.deepEqual(fast,nativeFeeds);
 assert.deepEqual(withoutChecked(await call(rowRequest(nativeFeeds.map(f=>f.id)))),oldNativeRows);
});
test('unknown timezones, fallback timezones and duplicate metadata preserve canonical feed results',async()=>{
 await db.exec(`insert into fixture_platforms values
 ('10000000-0000-4000-8000-000000000005','NO-ZONE','Other','未定义地区','XX','ar',null,'XXX','NO-ZONE'),
 ('10000000-0000-4000-8000-000000000006','FALLBACK','M8','印度','IN','ar','','INR','FALLBACK');
 insert into fixture_platforms select * from fixture_platforms where name='AR';`);
 const fast=await catalog('orderCatalog'),full=(await catalog()).filter(f=>f.dataset==='orders');assert.deepEqual(fast,full);
 assert.equal(fast.filter(f=>f.name==='AR').length,2);
 assert(fast.filter(f=>f.name==='NO-ZONE').every(f=>f.timezone===null&&f.defaultEnd===null));
 assert(fast.filter(f=>f.name==='FALLBACK').every(f=>f.timezone==='Asia/Kolkata'));
 const unknown=fast.find(f=>f.name==='NO-ZONE');await forbidFull();
 const r=await call(rowRequest([unknown.id]));assert.equal(r.rows.length,1);assert.equal(r.rows[0].evidence,'source_timezone_unknown');
});
test('fresh country scope restricts native catalog and rejects prior foreign feed IDs atomically',async()=>{
 await db.exec(`select set_config('test.scope','{"countries":["印度"]}',true)`);
 const scoped=await catalog('orderCatalog'),full=(await catalog()).filter(f=>f.dataset==='orders');
 assert.deepEqual(scoped,full);assert(scoped.every(f=>f.country==='印度'));
 assert(!scoped.some(f=>['NEW','GAME'].includes(f.name)));
 const foreign=nativeFeeds.find(f=>f.name==='NEW'),local=scoped[0];
 await rejectsCall(rowRequest([foreign.id]),/coverage_feed_denied/);
 await rejectsCall(rowRequest([local.id,foreign.id]),/coverage_feed_denied/);
});
test('no scope or an unknown well-formed feed cannot yield apparent coverage',async()=>{
 await rejectsCall(rowRequest(['f'.repeat(32)]),/coverage_feed_denied/);
 await db.exec("select set_config('test.scope','',true)");
 await rejectsCall({operation:'orderCatalog'},/unauthorized/);
 await rejectsCall(rowRequest([nativeFeeds[0].id]),/unauthorized/);
});
test('orderCatalog accepts no client-supplied scope, source list or date',async()=>{
 for(const extra of [{feedIds:[nativeFeeds[0].id]},{startAt:'2026-09-25'},{country:'印度'},{platform:'AR'},{scope:{mode:'all'}},{asOf:'2026-09-30'}])
  await rejectsCall({operation:'orderCatalog',...extra},/invalid_coverage_request/);
 for(const input of [null,[],{operation:'ordersCatalog'},{operation:4}])await rejectsCall(input,/invalid_coverage_request/);
});
test('native fast rows retain duplicate, size and range request bounds',async()=>{
 for(const input of [rowRequest([]),rowRequest([nativeFeeds[0].id,nativeFeeds[0].id]),rowRequest(Array(9).fill(nativeFeeds[0].id)),rowRequest(['bad-id']),{...rowRequest([nativeFeeds[0].id]),endAt:'2026-12-26'}])
  await rejectsCall(input,/invalid_coverage|duplicate_coverage_feed/);
});
test('AR complete zero and mismatched positive receipts keep the creation reconciliation rules',async()=>{
 await db.exec('delete from ar_collected_orders;delete from collection_success_daily');
 const id='20000000-0000-4000-8000-000000000001',day='2026-09-25',at='2026-09-26T00:00:00Z';
 const snapshot={schema_version:1,source_system:'RECHARGE_REVIEW',country_code:'IN',platform:'AR',stat_date:day,timezone:'Asia/Kolkata',snapshot_id:id,snapshot_at:at,
  coverage:{complete:true,expected_count:0,fetched_count:0,unique_count:0},totals:{submitted_count:0},groups:[]};
 await db.query('insert into collection_success_daily(country_code,platform,stat_date,source_system,snapshot_id,snapshot_at,updated_at,snapshot) values($1,$2,$3,$4,$5,$6,$6,$7)',
  ['IN','AR',day,'RECHARGE_REVIEW',id,at,JSON.stringify(snapshot)]);
 const feed=nativeFeeds.find(f=>f.name==='AR'&&f.direction==='charge');await forbidFull();
 let r=(await call({...rowRequest([feed.id]),startAt:day})).rows[0];assert.equal(r.status,'zero_complete');assert(r.zeroConfirmed&&r.complete);
 snapshot.coverage={complete:true,expected_count:2,fetched_count:2,unique_count:2};snapshot.totals.submitted_count=2;
 snapshot.groups=[{raw_channel:'A',channel_type:'UPI',submitted_count:2}];
 await db.query('update collection_success_daily set snapshot=$1',[JSON.stringify(snapshot)]);
 r=(await call({...rowRequest([feed.id]),startAt:day})).rows[0];assert.equal(r.status,'partial');assert.equal(r.expectedCount,2);assert.equal(r.fetchedCount,0);assert(!r.complete&&!r.zeroConfirmed);
});
test('helper is private and existing public/private function permissions are preserved',async()=>{
 const now=await metadata();assert.equal(md5(now[0].prosrc),'8bad6e11cb619395a8cc6ea75a19a978');
 assert.equal(now[1].prosrc,initialMetadata[1].prosrc);
 for(let i=0;i<2;i++)for(const k of ['proacl','prosecdef','proconfig','proowner','provolatile','pronargdefaults'])assert.deepEqual(now[i][k],initialMetadata[i][k],k);
 const grants=(await db.query("select has_function_privilege('anon','private.dashboard_admin_live_intake_order_feeds(timestamptz)','EXECUTE') anon,has_function_privilege('authenticated','private.dashboard_admin_live_intake_order_feeds(timestamptz)','EXECUTE') auth,has_function_privilege('service_role','private.dashboard_admin_live_intake_order_feeds(timestamptz)','EXECUTE') service,has_function_privilege('authenticated','public.dashboard_admin_live_intake_coverage(jsonb)','EXECUTE') public_read")).rows[0];
 assert.deepEqual(grants,{anon:false,auth:false,service:false,public_read:true});
 await db.exec('set local role authenticated');
 await assert.rejects(db.query("select private.dashboard_admin_live_intake_order_feeds(now())"),/permission denied/);
});
test('exact migration replay is idempotent without widening existing ACLs',async()=>{
 const before=await metadata();await db.exec(migration);assert.deepEqual(await metadata(),before);
});
test('unknown private body and public privilege drift are rejected by installation guards',async()=>{
 await db.exec("create or replace function private.dashboard_admin_live_intake_coverage(p_request jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$begin return '{}'::jsonb;end;$$");
 await assert.rejects(db.exec(migration),/order_intake_fast_path_private_drift/);
});
test('anonymous public execution drift is rejected instead of carried forward',async()=>{
 await db.exec('grant execute on function public.dashboard_admin_live_intake_coverage(jsonb) to anon');
 await assert.rejects(db.exec(migration),/order_intake_fast_path_public_acl_drift/);
});

test('same-country platform restrictions reject an unassigned native feed as well as a mixed batch',async()=>{
 await db.exec(`create or replace function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$
 select $1->>'mode'='all' or (coalesce($1->'countries' ? $2,false) and (not($1 ? 'platforms') or coalesce($1->'platforms' ? $3,false)))$$;
 select set_config('test.scope','{"countries":["印度"],"platforms":["AR"]}',true);`);
 const scoped=await catalog('orderCatalog');assert.equal(scoped.length,2);assert(scoped.every(f=>f.name==='AR'));
 assert.deepEqual(scoped,(await catalog()).filter(f=>f.dataset==='orders'));
 const excluded=nativeFeeds.find(f=>f.name==='LG');assert(excluded);
 await rejectsCall(rowRequest([excluded.id]),/coverage_feed_denied/);
 await rejectsCall(rowRequest([scoped[0].id,excluded.id]),/coverage_feed_denied/);
});
