// Pure local source/cache invariants; no network or real credentials.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture,migration}=require('./fixtures/ar-historical-duration-harness.cjs');
const row=async(db,id,extra={})=>{const r={source_system:'AR',country_code:'IN',platform:'91CLUB',order_kind:'withdraw',order_no:id,applied_at:'2026-10-09 12:00:00',completed_at:'2026-10-09 12:00:20',observed_at:'2026-10-11T00:00:00Z',status:'success',operator:'system',...extra};const ks=Object.keys(r);await db.query(`insert into public.ar_collected_orders(${ks.join(',')}) values(${ks.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(r));};
const refresh=async(db,p='91CLUB',d='2026-10-09')=>(await db.query('select private.refresh_ar_historical_duration($1,$2::date)r',[p,d])).rows[0].r;
const read=async(db,q={country:'印度'},scope={mode:'all',countries:[]},start='2026-10-09',end='2026-10-09')=>(await db.query('select to_jsonb(h)r from private.dashboard_admin_ar_historical_duration_days($1,$2,$3::date,$4::date)h',[q,scope,start,end])).rows.map(x=>x.r);
const count=async db=>(await db.query('select count(*)::int c from private.ar_historical_duration_cache')).rows[0].c;
const g=async db=>(await db.query('select private.ar_historical_duration_generation()g')).rows[0].g;
const catalog=async db=>db.exec("insert into private.test_catalog values('ar','IN','印度','91CLUB','91CLUB'),('ar','IN','印度','Veer.Game','VEERGAME'),('ar','PK','巴基斯坦','92.GAME','92.GAME'),('newar','IN','印度','FOREIGN','FOREIGN')");
test('native timestamp pool preserves exact positive trunc seconds, half-open days, null/zero and scope',async()=>{const db=await fixture();try{
 await catalog(db);
 await row(db,'begin',{applied_at:'2026-10-09 00:00:00',completed_at:'2026-10-09 00:00:20.9'});
 await row(db,'fraction',{completed_at:'2026-10-09 12:00:00.9'});await row(db,'zero',{completed_at:'2026-10-09 12:00:00'});await row(db,'negative',{completed_at:'2026-10-09 11:00:00'});await row(db,'unknown',{completed_at:null});
 await row(db,'end',{applied_at:'2026-10-09 23:59:59.999999',completed_at:'2026-10-10 00:00:10'});
 for(const [id,x] of [['outside',{applied_at:'2026-10-10 00:00:00'}],['null',{applied_at:null}],['infinity',{applied_at:'infinity'}],['foreign',{source_system:'OTHER'}],['direction',{order_kind:'recharge'}],['country',{country_code:'PK'}]])await row(db,id,x);
 assert.equal(await count(db),0);const a=await refresh(db);assert.equal(a.sourceCount,6);assert.equal(a.durationSampleCount,2);assert.equal(a.durationTotalSeconds,30);assert.equal(a.avgSeconds,15);
 const r=await read(db,{country:'印度',platform:'91CLUB'});assert.equal(r.length,1);assert.equal(r[0].duration_sample_count,2);assert.equal(r[0].duration_total_seconds,30);
 for(const zone of ['UTC','Asia/Kolkata','Asia/Shanghai']){await db.query('select set_config(\'TimeZone\',$1,false)',[zone]);assert.equal((await refresh(db)).durationTotalSeconds,30);}
 assert.deepEqual(await read(db,{}, {allow:[]}),[]);assert.deepEqual(await read(db,{country:'巴基斯坦'}),[]);assert.deepEqual(await read(db,{country:'印度',scopeTargets:[{country:'印度',platforms:[]}]}),[]);
 assert.equal((await read(db,{country:'印度',platforms:[]})).length,1);assert.deepEqual(await read(db,{country:'印度'}, {allow:[['印度','Veer.Game']]}),[]);
 }finally{await db.close();}});
test('all native aliases must have matching generation, unknown is never converted to zero',async()=>{const db=await fixture();try{
 await catalog(db);await row(db,'alias-a',{platform:'Veer.Game'});await row(db,'alias-b',{platform:'VEERGAME',completed_at:'2026-10-09 12:00:40'});
 await refresh(db,'Veer.Game');assert.deepEqual(await read(db,{country:'印度',platform:'VEERGAME'}),[]);
 await refresh(db,'VEERGAME');const r=await read(db,{country:'印度',platform:'Veer.Game'});assert.equal(r.length,1);assert.equal(r[0].duration_sample_count,2);assert.equal(r[0].duration_total_seconds,60);
 const z=await refresh(db,'91CLUB');assert.equal(z.sourceCount,0);assert.equal(z.durationSampleCount,0);assert.equal(z.avgSeconds,null);assert.equal((await read(db,{country:'印度',platform:'91CLUB'}))[0].duration_sample_count,0);
 await db.exec("update private.ar_historical_duration_cache set generation=md5('stale') where platform='VEERGAME'");assert.deepEqual(await read(db,{country:'印度',platform:'Veer.Game'}),[]);
 await assert.rejects(()=>read(db,{}, {},'2026-10-10','2026-10-09'),/invalid_ar_historical_duration_range/);
 }finally{await db.close();}});
test('business time or native identity changes and deletes invalidate both old and new days; capture-only changes preserve the pool',async()=>{const db=await fixture();try{
 await row(db,'s');await refresh(db);const before=(await db.query('select to_jsonb(c)r from private.ar_historical_duration_cache c')).rows;
 await db.exec("update ar_collected_orders set observed_at='2026-10-12T00:00:00Z',status='failed',operator='Latest' where order_no='s'");assert.deepEqual((await db.query('select to_jsonb(c)r from private.ar_historical_duration_cache c')).rows,before);
 for(const mutation of ["completed_at=null","completed_at='2026-10-09 12:01:00'","country_code='PK'","country_code='IN'","source_system='OTHER'","source_system='AR'","order_kind='recharge'","order_kind='withdraw'","platform='VEERGAME'","platform='91CLUB'","applied_at='2026-10-08 12:00:00'","applied_at='2026-10-09 12:00:00'"]){
  await refresh(db);await refresh(db,'91CLUB','2026-10-08');await refresh(db,'VEERGAME');await db.exec('update ar_collected_orders set '+mutation+" where order_no='s'");
  const r=(await db.query('select platform,data_date::text d from private.ar_historical_duration_cache')).rows;
  assert(!r.some(x=>x.platform==='91CLUB'&&x.d==='2026-10-09'),'old/new active partition is revoked: '+mutation);
 }
 await refresh(db);await db.exec("delete from ar_collected_orders where order_no='s'");assert.equal((await db.query("select count(*)::int c from private.ar_historical_duration_cache where platform='91CLUB' and data_date='2026-10-09'")).rows[0].c,0);
 await refresh(db);await row(db,'late');assert.equal((await db.query("select count(*)::int c from private.ar_historical_duration_cache where platform='91CLUB' and data_date='2026-10-09'")).rows[0].c,0,'late historical inserts revoke a verified empty pool');
 await db.exec('truncate ar_collected_orders');assert.equal(await count(db),0);
 }finally{await db.close();}});
test('source changes and cache refresh roll back together; install and replay do not scan or change native rows',async()=>{const db=await fixture();try{
 await row(db,'s');await refresh(db);const source=(await db.query('select to_jsonb(a)r from ar_collected_orders a')).rows,cache=(await db.query('select to_jsonb(c)r from private.ar_historical_duration_cache c')).rows,oldG=await g(db);
 await db.exec(migration);assert.equal(await g(db),oldG);assert.deepEqual((await db.query('select to_jsonb(c)r from private.ar_historical_duration_cache c')).rows,cache);assert.deepEqual((await db.query('select to_jsonb(a)r from ar_collected_orders a')).rows,source);
 await db.exec("begin;update ar_collected_orders set completed_at=null;rollback;");assert.deepEqual((await db.query('select to_jsonb(c)r from private.ar_historical_duration_cache c')).rows,cache);
 await db.exec('begin');await refresh(db);await db.exec('rollback');assert.deepEqual((await db.query('select to_jsonb(c)r from private.ar_historical_duration_cache c')).rows,cache);
 }finally{await db.close();}});
test('maintenance is postgres-only READ COMMITTED; private cache cannot be read or refreshed by application roles',async()=>{const db=await fixture();try{
 await db.exec('begin isolation level repeatable read');await assert.rejects(()=>refresh(db),/ar_historical_duration_maintenance_context/);await db.exec('rollback');
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(()=>refresh(db),/permission denied/);await assert.rejects(()=>db.query('select * from private.ar_historical_duration_cache'),/permission denied/);await db.exec('reset role');}
 for(const [p,d] of [[' 91CLUB','2026-10-09'],['91CLUB','2026-10-10'],['91CLUB','infinity']])await assert.rejects(()=>refresh(db,p,d),/invalid_ar_historical_duration_partition/);
 }finally{await db.close();}});
test('metadata and trigger drift fail closed without altering cache or enabling a historical live raw scan',async()=>{const db=await fixture();try{
 await catalog(db);await row(db,'s');await refresh(db);const old=await g(db);
 await db.exec('alter table ar_collected_orders disable trigger ar_historical_duration_update');assert.equal(await g(db),null);assert.deepEqual(await read(db),[]);await db.exec('alter table ar_collected_orders enable trigger ar_historical_duration_update');assert.notEqual(await g(db),old);assert.deepEqual(await read(db),[]);
 for(const drift of ['grant execute on function private.refresh_ar_historical_duration(text,date) to anon','alter table private.ar_historical_duration_cache disable row level security','alter table private.ar_historical_duration_cache drop constraint ar_history_duration_counts','alter function private.invalidate_ar_historical_duration_cache() security invoker']){
  await db.exec('begin');await db.exec(drift);await assert.rejects(()=>db.exec(migration.slice(migration.indexOf('do $guard$'),migration.lastIndexOf('commit;'))),/AR_HISTORY_DURATION_(FUNCTION|TABLE|CONSTRAINT|CHECK)_DRIFT/);await db.exec('rollback');
 }
 }finally{await db.close();}});
test('accidental cache grants and BYPASSRLS cannot write or revive poisoned aggregates',async()=>{const db=await fixture();try{
 await catalog(db);await row(db,'s');await refresh(db);const before=await g(db);
 await db.exec('alter role service_role bypassrls;grant select,insert,update,delete,truncate on private.ar_historical_duration_cache to service_role');assert.equal(await g(db),null);
 await db.exec('set role service_role');await assert.rejects(()=>db.exec('update private.ar_historical_duration_cache set duration_total_seconds=999999'),/ar_historical_duration_cache_write_denied/);
 await assert.rejects(()=>db.exec('delete from private.ar_historical_duration_cache'),/ar_historical_duration_cache_write_denied/);
 await assert.rejects(()=>db.exec('truncate private.ar_historical_duration_cache'),/ar_historical_duration_cache_write_denied/);
 await assert.rejects(()=>db.exec("insert into private.ar_historical_duration_cache select country_code,platform,'2026-10-08',source_row_count,duration_sample_count,duration_total_seconds,generation,generated_at from private.ar_historical_duration_cache"),/ar_historical_duration_cache_write_denied/);
 await db.exec('reset role;revoke all on private.ar_historical_duration_cache from service_role');
 assert.equal(await g(db),before);assert.equal((await read(db))[0].duration_total_seconds,20,'restore is safe because the writer was rejected before touching the cache');
 await db.exec('alter table private.ar_historical_duration_cache disable trigger ar_historical_duration_cache_write_guard');assert.equal(await g(db),null);assert.deepEqual(await read(db),[]);
 await db.exec('update private.ar_historical_duration_cache set duration_total_seconds=999999');
 await db.exec('alter table private.ar_historical_duration_cache enable trigger ar_historical_duration_cache_write_guard');assert.notEqual(await g(db),before);assert.deepEqual(await read(db),[]);
 await refresh(db);assert.equal((await read(db))[0].duration_total_seconds,20);
 }finally{await db.close();}});
test('normal cache statistics maintenance preserves verified duration pools without a table-xmin dependency',async()=>{const db=await fixture();try{
 await catalog(db);await row(db,'s');await refresh(db);const before=await g(db);await db.exec('analyze private.ar_historical_duration_cache');
 assert.equal(await g(db),before);assert.equal((await read(db))[0].duration_total_seconds,20);
 }finally{await db.close();}});
