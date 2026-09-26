// Offline synthetic fixtures only; this test never connects to production.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/admin-live-order-intake.sql'),'utf8');
let db;
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const call=async()=> (await db.query('select public.test_intake() as data')).rows[0].data;
const scope=async value=>db.query("select set_config('test.scope',$1,false)",[value]);
before(async()=>{
 db=new PGlite();await db.exec(`
 create schema private;create role anon;create role authenticated;
 grant usage on schema private to anon,authenticated;
 create table fixture_platforms(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text);
 create function private.dashboard_admin_live_platforms()
 returns table(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text)
 language plpgsql stable security definer set search_path='' as $$
 declare s text:=current_setting('test.scope',true);begin
  if coalesce(s,'')='' then raise exception 'unauthorized';end if;
  return query select p.* from public.fixture_platforms p where s='all' or p.source_name=s;
 end;$$;
 revoke all on function private.dashboard_admin_live_platforms() from public,anon,authenticated;
 create table ar_collected_orders(source_system text,country_code text,platform text,order_kind text,applied_at timestamp,updated_at timestamptz);
 create index ar_collected_orders_applied_idx on ar_collected_orders(country_code,platform,order_kind,applied_at);
 create table newar_detail_platforms(platform text primary key,country_code text,enabled boolean,launch_at timestamptz);
 create table newar_detail_records(platform text,dataset text,created_at timestamptz not null,received_at timestamptz);
 create index newar_detail_created_idx on newar_detail_records(platform,dataset,created_at desc);
 create table game66_charge_orders(platform_id uuid,create_time timestamptz,last_seen_at timestamptz);
 create table game66_withdraw_orders(platform_id uuid,create_time timestamptz,last_seen_at timestamptz);
 create index game66_charge_orders_platform_time_idx on game66_charge_orders(platform_id,create_time desc);
 create index game66_withdraw_orders_platform_time_idx on game66_withdraw_orders(platform_id,create_time desc);
 insert into fixture_platforms values
 ('${id(1)}','AR display','M8','印度','IN','ar','Asia/Kolkata','INR','AR-RAW'),
 ('${id(2)}','Configured only','M8','印度','IN','ar','Asia/Kolkata','INR','EMPTY'),
 ('${id(3)}','NEW display','M8','尼泊尔','NP','newar','Asia/Kathmandu','NPR','NEW-RAW'),
 ('${id(4)}','Hong Kong','香港','香港','HK_TEAM','game66','Asia/Kolkata','INR','GAME'),
 ('${id(5)}','Before launch','M8','印度','IN','newar','Asia/Kolkata','INR','OLD-ONLY'),
 ('${id(6)}','Future','M8','印度','IN','newar','Asia/Kolkata','INR','FUTURE'),
 ('${id(7)}','Disabled','M8','印度','IN','newar','Asia/Kolkata','INR','DISABLED'),
 ('${id(8)}','Missing timestamp',null,'印度','IN','ar','Asia/Kolkata','INR','NULL-TIME');
 insert into ar_collected_orders values
 ('AR','IN','AR-RAW','recharge','2026-09-25 00:30','2026-09-25T05:00Z'),
 ('AR','IN','AR-RAW','recharge','2026-09-24 23:30','2026-09-24T23:00Z'),
 ('AR','BR','AR-RAW','withdraw','2026-09-26','2026-09-26T00:00Z'),
 ('OTHER','IN','AR-RAW','withdraw','2026-09-26','2026-09-26T00:00Z'),
 ('AR','IN','NULL-TIME','withdraw',null,'2026-09-25T06:00Z');
 insert into newar_detail_platforms values
 ('NEW-RAW','NP',true,'2026-09-24T18:15Z'),('OLD-ONLY','IN',true,'2026-09-25T00:00Z'),
 ('FUTURE','IN',true,'2200-01-01Z'),('DISABLED','IN',false,null);
 insert into newar_detail_records values
 ('NEW-RAW','charge','2026-09-24T18:15Z','2026-09-25T08:00Z'),
 ('NEW-RAW','withdraw','2026-09-24T18:14:59Z','2026-09-25T09:00Z'),
 ('NEW-RAW','workorder','2026-09-26T00:00Z','2026-09-26T01:00Z'),
 ('OLD-ONLY','charge','2026-09-24T23:59:59Z','2026-09-25T09:00Z'),
 ('FUTURE','charge','2200-01-02Z','2026-09-25T09:00Z'),
 ('DISABLED','charge','2026-09-25T00:00Z','2026-09-25T09:00Z');
 insert into game66_withdraw_orders values('${id(4)}','2026-09-24T20:00Z','2026-09-25T10:00Z');
 select set_config('test.scope','all',false);
 `);
 await db.exec(sql);
 await db.exec(`create function public.test_intake() returns jsonb language sql stable security definer set search_path='' as $$select private.dashboard_admin_live_order_intake()$$;
 revoke all on function public.test_intake() from public,anon;grant execute on function public.test_intake() to authenticated;`);
});
after(async()=>{await db?.close()});

test('intake requires actual order facts and reports only the received direction',async()=>{
 const rows=await call();assert.deepEqual(rows.map(x=>x.rawPlatform),['AR-RAW','NEW-RAW','GAME','NULL-TIME']);
 assert.deepEqual(rows.find(x=>x.rawPlatform==='AR-RAW').directions,['charge']);
 assert.deepEqual(rows.find(x=>x.rawPlatform==='GAME').directions,['withdraw']);
 assert(rows.every(x=>x.dataset==='orders'&&x.provenance.kind==='direct'));
 assert(!rows.some(x=>x.name==='Configured only'));
});
test('latest dates follow each source timezone rather than the database session date',async()=>{
 await db.exec("set timezone='America/Los_Angeles'");
 try{const rows=await call();for(const name of ['AR-RAW','NEW-RAW','GAME'])assert.equal(rows.find(x=>x.rawPlatform===name).lastDate,'2026-09-25');
 const ar=rows.find(x=>x.rawPlatform==='AR-RAW');assert.equal(ar.platformId,id(1));assert.equal(ar.rawCountry,'IN');assert.equal(ar.name,'AR display');assert.equal(ar.system,'AR');
 assert.equal(new Date(ar.updatedAt).toISOString(),'2026-09-25T05:00:00.000Z');assert.equal(rows.find(x=>x.rawPlatform==='GAME').system,'GAME66_HK');
 }finally{await db.exec("set timezone='UTC'")}
});
test('NewAR keeps launch boundaries, enabled state, dataset and country isolation',async()=>{
 const rows=await call();assert.deepEqual(rows.find(x=>x.rawPlatform==='NEW-RAW').directions,['charge']);
 assert(!rows.some(x=>['OLD-ONLY','FUTURE','DISABLED'].includes(x.rawPlatform)));
 await db.exec("begin;update newar_detail_platforms set country_code='IN' where platform='NEW-RAW'");
 try{assert(!(await call()).some(x=>x.rawPlatform==='NEW-RAW'))}finally{await db.exec('rollback')}
});
test('directions retain independent freshness without inventing order counts',async()=>{
 await db.exec("begin;insert into ar_collected_orders values('AR','IN','AR-RAW','withdraw','2026-09-26 00:01','2026-09-26T03:00Z')");
 try{const rows=(await call()).filter(x=>x.rawPlatform==='AR-RAW');assert.equal(rows.length,2);assert.deepEqual(rows.map(x=>x.directions),[['charge'],['withdraw']]);
  assert.deepEqual(rows.map(x=>x.lastDate),['2026-09-25','2026-09-26']);
  assert.deepEqual(rows.map(x=>new Date(x.updatedAt).toISOString()),['2026-09-25T05:00:00.000Z','2026-09-26T03:00:00.000Z']);
  assert(rows.every(x=>!('records' in x)&&!('count' in x)));}
 finally{await db.exec('rollback')}
});
test('orders with missing creation time remain received but have no invented date',async()=>{
 const row=(await call()).find(x=>x.rawPlatform==='NULL-TIME');assert.deepEqual(row.directions,['withdraw']);assert.equal(row.lastDate,null);assert.equal(row.team,'待归类');
 await db.exec("begin;insert into ar_collected_orders values('AR','IN','AR-RAW','recharge',null,'2026-09-26T03:00Z')");
 try{assert.equal((await call()).find(x=>x.rawPlatform==='AR-RAW').lastDate,'2026-09-25')}finally{await db.exec('rollback')}
});
test('helper is private and reuses live authorization on every enclosing catalog call',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);try{await assert.rejects(db.query('select private.dashboard_admin_live_order_intake()'),/permission denied/)}finally{await db.exec('reset role')}
 }
 await db.exec('set role authenticated');
 try{await scope('NEW-RAW');const rows=await call();assert.equal(rows.length,1);assert.equal(rows[0].rawPlatform,'NEW-RAW');await scope('');await assert.rejects(call(),/unauthorized/)}
 finally{await db.exec('reset role');await scope('all')}
});
test('bounded metadata projections never aggregate complete order tables or expose order payloads',()=>{
 const body=sql.replace(/--[^\n]*/g,'');
 assert.doesNotMatch(body,/\b(count|max|min|sum)\s*\(|raw_payload|member_id|order_no|order_number|amount/i);
 assert.match(body,/for p in select \* from private\.dashboard_admin_live_platforms\(\)/);
 for(const segment of body.split(/\bselect\b/i).slice(1).filter(x=>/from public\.(ar_collected_orders|newar_detail_records|game66_charge_orders|game66_withdraw_orders)/.test(x))){assert.match(segment,/limit 1/i)}
});
test('each newest-order probe can stop at the first matching production-shaped index entry',async()=>{
 await db.exec(`insert into ar_collected_orders select 'AR','IN','AR-RAW','recharge',timestamp '2026-01-01'+i*interval '1 minute',now() from generate_series(1,12000)i;
 insert into newar_detail_records select 'NEW-RAW','charge',timestamptz '2026-09-25Z'+i*interval '1 minute',now() from generate_series(1,12000)i;
 insert into game66_charge_orders select '${id(4)}',timestamptz '2026-01-01Z'+i*interval '1 minute',now() from generate_series(1,12000)i;
 insert into game66_withdraw_orders select '${id(4)}',timestamptz '2026-01-01Z'+i*interval '1 minute',now() from generate_series(1,12000)i;analyze;`);
 const probes=[
 "select applied_at,updated_at from ar_collected_orders where country_code='IN' and platform='AR-RAW' and source_system='AR' and order_kind='recharge' and applied_at is not null order by applied_at desc limit 1",
 "select created_at,received_at from newar_detail_records where platform='NEW-RAW' and dataset='charge' and created_at>=timestamptz '2026-09-24T18:15Z' order by created_at desc limit 1",
 ...['charge','withdraw'].map(kind=>`select create_time,last_seen_at from game66_${kind}_orders where platform_id='${id(4)}' and create_time is not null order by create_time desc limit 1`)];
 for(const query of probes){const plan=(await db.query('explain (analyze,format json) '+query)).rows[0]['QUERY PLAN'][0].Plan;assert.equal(plan['Node Type'],'Limit');assert.equal(plan['Actual Rows'],1);assert.match(JSON.stringify(plan),/Index Scan/);assert.doesNotMatch(JSON.stringify(plan),/Seq Scan|Sort/);assert.equal(plan.Plans[0]['Actual Rows'],1)}
});
