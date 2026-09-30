// Synthetic-only regression against the captured, current M8 function bodies.
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,'supabase',n),'utf8');
const production=require('./fixtures/wg-existing-production-functions.json');
const migration=read('migrations/20261001020000_wg_existing_coverage_pending.sql');
const owner='10000000-0000-0000-0000-000000000001',viewer='10000000-0000-0000-0000-000000000002';
const id=n=>'20000000-0000-0000-0000-'+String(n).padStart(12,'0');let db;
const date='2026-09-28',scheduled='2026-09-29T03:00:00Z';
const as=async uid=>db.query("select set_config('test.uid',$1,false)",[uid]);
const invoke=async(fn,request)=>(await db.query(`select public.${fn}($1::jsonb) data`,[JSON.stringify(request)])).rows[0].data;
before(async()=>{
 db=new PGlite();
 // Reuse the existing thorough preview/auth/source fixture, not an invented RPC stub.
 const fixture=fs.readFileSync(path.join(__dirname,'admin-pending-analysis.test.cjs'),'utf8');
 const begin=fixture.indexOf('before(async()=>{')+'before(async()=>{'.length,end=fixture.indexOf('\n});\nbeforeEach');
 assert(begin>20&&end>begin);
 const setup=fixture.slice(begin,end).replace('db=new PGlite();','');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 await new AsyncFunction('db','read','owner','viewer','sourceSql','sql',setup)(db,read,owner,viewer,read('admin-live-pending-snapshot.sql'),read('migrations/20260930130000_pending_analysis.sql'));
 await db.exec(`
 create function private.dashboard_admin_wg_sites() returns table(site_code text,country_code text,country text,platform text,timezone text,currency text)
 language sql immutable set search_path='' as $$select * from(values('278','BR','巴西','26BET','America/Sao_Paulo','BRL'),('3257','VN','越南','98VV','Asia/Ho_Chi_Minh','VND'))v$$;
 create table wg_withdraw_midnight_runs(site_code text,scheduled_at timestamptz,snapshot_date date,window_start timestamptz,window_end timestamptz,status text,observed_started_at timestamptz,observed_finished_at timestamptz,record_count int);
 create table wg_withdraw_midnight_items(site_code text,scheduled_at timestamptz,order_number text,safe_record jsonb);
 create table wg_recharge_details(site_code text,created_at timestamptz,stored_at timestamptz);
 create table wg_withdraw_details(like wg_recharge_details);
 create table wg_detail_coverage(site_code text,business text,basis text,business_date date,complete boolean);
 create table wg_realtime_config_daily(site_code text,country_code text,observed_local_date date,observed_at timestamptz);
 create table wg_config_daily(country_code text,platform text,observed_local_date date,received_at timestamptz);
 create table fixture_feeds(value jsonb);
 create function private.dashboard_admin_live_intake_order_feeds(timestamptz) returns jsonb language sql stable security definer set search_path='' as $$select coalesce(jsonb_agg(value),'[]') from public.fixture_feeds where private.dashboard_scope_allows(private.dashboard_admin_live_scope(),value->>'rawCountry',value->>'rawPlatform')$$;
 create function private.dashboard_admin_live_intake_feeds(timestamptz) returns jsonb language sql stable security definer set search_path='' as $$select private.dashboard_admin_live_intake_order_feeds($1)$$;
 create function private.dashboard_admin_live_collected_data(jsonb) returns jsonb language sql stable security definer set search_path='' as $$select '{"rows":[]}'::jsonb$$;
 create function private.dashboard_admin_live_report_country(text,text) returns text language sql immutable as $$select $1$$;
 create table ar_config_targets(source_system text,country_code text,country_name text,platform text,timezone text);
 create table panda_config_targets(country_code text,country_name text,platform text,timezone text);
 create table wg_config_targets(like panda_config_targets);
 create table auto_withdraw_daily(country text,platform text,data_date date);
 alter table wg_withdraw_midnight_runs enable row level security;
 alter table wg_withdraw_midnight_items enable row level security;
 `);
 for(const name of ['dashboard_admin_live_intake_coverage','dashboard_admin_live_sync_health_rows']) await db.exec(production.find(x=>x.proname===name).definition);
 await db.exec(`create function public.dashboard_admin_live_intake_coverage(p_request jsonb) returns jsonb language sql stable security invoker set search_path='' as $$select private.dashboard_admin_live_intake_coverage(p_request)$$;
 revoke all on function public.dashboard_admin_live_intake_coverage(jsonb),private.dashboard_admin_live_intake_coverage(jsonb) from public;
 grant execute on function public.dashboard_admin_live_intake_coverage(jsonb),private.dashboard_admin_live_intake_coverage(jsonb) to authenticated;`);
 await db.exec(migration);
});
beforeEach(async()=>{
 await db.exec('reset role; truncate native_catalog,seed_catalog,wg_withdraw_midnight_runs,wg_withdraw_midnight_items,wg_recharge_details,wg_withdraw_details,wg_detail_coverage,fixture_feeds,wg_realtime_config_daily,wg_config_daily,wg_config_targets;update dashboard_profiles set active=true;update dashboard_admin_preview_grants set can_view=true;');await as(owner);
 await db.query("insert into native_catalog values($1,'26BET','M8','巴西','BR','wg','America/Sao_Paulo','BRL','26BET')",[id(1)]);
});
after(async()=>{await db?.close()});
async function capture(rows=[{provider:'PAY',amount:25,created:'2026-09-27T03:00:00Z'},{provider:'OTHER',amount:75,created:'2026-09-28T23:00:00Z'}],status='complete'){
 await db.query("insert into wg_withdraw_midnight_runs values('278',$1,$2,$1::timestamptz-interval '7 days',$1::timestamptz-interval '1 second',$3,$1::timestamptz+interval '10 seconds',$1::timestamptz+interval '30 seconds',$4)",[scheduled,date,status,status==='complete'?rows.length:null]);
 for(const [i,r]of rows.entries()) await db.query('insert into wg_withdraw_midnight_items values($1,$2,$3,$4)', ['278',scheduled,'SYNTHETIC-'+i,JSON.stringify({site_code:'278',business:'withdraw',status_code:3,status_group:'paying',member_currency:'BRL',member_amount:String(r.amount),created_at:r.created,provider:r.provider,channel:'PIX'})]);
}
const snap=(extra={})=>invoke('dashboard_admin_live_pending_snapshot',{date,platformIds:[id(1)],...extra});
test('existing midnight RPC reads immutable WG observations, canonical groups and actual observation time',async()=>{
 await capture();const r=await snap();assert.equal(r.complete,true);assert.equal(r.count,2);assert.equal(r.amount,'100');assert.equal(r.rows[0].source,'wg');assert.equal(r.rows[0].windowStart,'2026-09-22');assert.equal(r.rows[0].captureDate,'2026-09-29');
 assert.equal(Date.parse(r.rows[0].snapshotAt),Date.parse(scheduled)+30000);assert.equal(r.rows[0].wgAging.over24Count,1);
 const selected=await snap({providers:['PAY']});assert.equal(selected.count,1);assert.equal(selected.amount,'25');
 assert.equal((await snap({providers:['NO_MATCH']})).count,0);
});
test('missing/missed/in-flight/invalid observations are not converted to zero',async()=>{
 assert.equal((await snap()).count,null);await capture([],'missed');assert.equal((await snap()).count,null);
 await db.exec("update wg_withdraw_midnight_runs set status='capturing'");assert.equal((await snap()).rows[0].state,'pending');
 await db.exec("update wg_withdraw_midnight_runs set status='complete',record_count=1");assert.equal((await snap()).rows[0].state,'invalid');
});
test('complete zero snapshot remains a certified zero',async()=>{await capture([]);const r=await snap();assert.equal(r.complete,true);assert.equal(r.count,0);assert.equal(r.amount,'0')});
test('wrong status, currency, timestamp and page totals fail closed',async()=>{
 await capture();for(const change of [{status_code:4},{member_currency:'USDT'},{created_at:'2026-09-29T03:00:01Z'},{member_amount:'NaN'},{member_amount:null},{created_at:null}]){
  const before=(await db.query("select safe_record from wg_withdraw_midnight_items where order_number='SYNTHETIC-0'")).rows[0].safe_record;
  await db.query("update wg_withdraw_midnight_items set safe_record=safe_record||$1::jsonb where order_number='SYNTHETIC-0'",[JSON.stringify(change)]);assert.equal((await snap()).count,null);
  await db.query("update wg_withdraw_midnight_items set safe_record=$1 where order_number='SYNTHETIC-0'",[before]);
 }
});
test('existing history and aging RPC uses WG capture ages, never current orders or query time',async()=>{
 await capture();const r=await invoke('dashboard_admin_live_pending_analysis',{startDate:'2026-09-27',endDate:date,platformIds:[id(1)]});
 assert.equal(r.daily[0].count,null);assert.equal(r.daily[1].count,2);assert.equal(r.aging.available,true);assert.equal(r.aging.complete,true);assert.equal(r.aging.count,2);assert.equal(r.aging.over24Count,1);assert.equal(r.aging.buckets.reduce((n,b)=>n+b.count,0),2);
});
test('caller authorization and raw snapshot privacy remain enforced',async()=>{
 await capture();await as(viewer);await db.exec('set role authenticated');await assert.rejects(()=>snap(),/platform_denied/);
 await assert.rejects(()=>db.query('select * from wg_withdraw_midnight_items'),/permission denied/);
 await assert.rejects(()=>db.query("select private.dashboard_admin_wg_pending_row('{}',current_date,'{}')"),/permission denied/);
 await db.exec('reset role');await as('');await assert.rejects(()=>snap(),/login_required/);
});
async function feed(){const value={id:'a'.repeat(32),dataset:'orders',system:'wg',platformId:id(1),name:'26BET',country:'巴西',rawCountry:'BR',rawPlatform:'26BET',timezone:'America/Sao_Paulo',direction:'charge',sourceKind:'direct'};await db.query('insert into fixture_feeds values($1)',[value]);return value.id;}
test('existing coverage accepts full acknowledged empty days and rejects partial/updated-only proof',async()=>{
 const f=await feed(),check=async()=> (await invoke('dashboard_admin_live_intake_coverage',{operation:'rows',feedIds:[f],startAt:date,endAt:date})).rows[0];
 assert.equal((await check()).status,'not_received');
 await db.query("insert into wg_detail_coverage values('278','recharge','updated',$1,true)",[date]);assert.equal((await check()).complete,false);
 await db.query("insert into wg_detail_coverage values('278','recharge','created',$1,false)",[date]);assert.equal((await check()).status,'partial');
 await db.exec("update wg_detail_coverage set complete=true where basis='created'");assert.equal((await check()).zeroConfirmed,true);
 await db.query("insert into wg_recharge_details values('278','2026-09-28T03:00Z',now())");const r=await check();assert.equal(r.complete,true);assert.equal(r.fetchedCount,1);assert.equal(r.zeroConfirmed,false);
});
test('migration is replayable without changing ACL or source records',async()=>{
 await capture();const before=(await db.query("select proname,proacl::text from pg_proc where proname like 'dashboard_admin_live_pending%' order by 1")).rows;
 await db.exec(migration);assert.deepEqual((await db.query("select proname,proacl::text from pg_proc where proname like 'dashboard_admin_live_pending%' order by 1")).rows,before);assert.equal((await snap()).count,2);
});
test('current feed catalog retires only exact WG summary identities, not config or other systems',async()=>{
 const order={id:'a'.repeat(32),dataset:'orders',system:'wg',rawCountry:'BR',rawPlatform:'26BET'};
 const old={id:'b'.repeat(32),dataset:'volume',system:'REPORT',rawCountry:'巴西',rawPlatform:'26bet'};
 const config={...old,id:'c'.repeat(32),dataset:'wg_config',system:'WG'};
 const other={...old,id:'d'.repeat(32),rawPlatform:'OTHER'};
 const lg={...old,id:'e'.repeat(32),system:'LG'};
 for(const v of [order,old,config,other,lg])await db.query('insert into fixture_feeds values($1)',[v]);
 const r=await invoke('dashboard_admin_live_intake_coverage',{operation:'catalog'});
 assert.deepEqual(r.feeds.map(x=>x.id),[order.id,config.id,other.id,lg.id]);
});
test('existing health distinguishes partial empty windows and reads the new daily configuration',async()=>{
 await db.query("insert into wg_detail_coverage values('278','recharge','created',$1,false)",[date]);
 await db.exec("insert into wg_config_targets values('BR','巴西','26BET','America/Sao_Paulo');insert into wg_realtime_config_daily values('278','BR','2026-09-28','2026-09-28T08:00Z')");
 const rows=(await db.query("select * from private.dashboard_admin_live_sync_health_rows('2026-09-29T04:00Z') where data_date='2026-09-28'")).rows;
 assert.equal(rows.find(r=>r.dataset==='orders'&&r.direction==='charge').status,'unverified');
 const config=rows.find(r=>r.dataset==='wg_config');assert.equal(config.received,true);assert.equal(Date.parse(config.last_received_at),Date.parse('2026-09-28T08:00Z'));
});
