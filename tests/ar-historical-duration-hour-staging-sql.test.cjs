// Synthetic single-connection SQL only. No production requests or cross-connection claim.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),assert=require('node:assert/strict'),{test}=require('node:test');
const repo=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const {fixture:baseline}=require('./fixtures/ar-historical-duration-harness.cjs');
const upgrade=read('supabase/migrations/20261011162549_ar_historical_duration_hour_staging.sql'),overlay=read('supabase/migrations/20261011162550_auto_withdraw_hour_staging_duration_overlay.sql');
const stage=async()=>{const db=await baseline();await db.exec(upgrade);return db;};
const g=async db=>(await db.query('select private.ar_historical_duration_generation()g')).rows[0].g;
const hour=(db,h,p='91CLUB',d='2026-10-09')=>db.query('select private.refresh_ar_historical_duration_hour($1,$2::date,$3)r',[p,d,h]).then(r=>r.rows[0].r);
const finish=(db,p='91CLUB',d='2026-10-09')=>db.query('select private.finalize_ar_historical_duration_day($1,$2::date)r',[p,d]).then(r=>r.rows[0].r);
const day=(db,p='91CLUB')=>db.query("select private.refresh_ar_historical_duration($1,'2026-10-09')r",[p]).then(r=>r.rows[0].r);
const parts=async db=>(await db.query('select count(*)::int n from private.ar_historical_duration_hour_parts')).rows[0].n;
const daily=async db=>(await db.query('select count(*)::int n from private.ar_historical_duration_cache')).rows[0].n;
const allHours=async(db,p='91CLUB',d='2026-10-09')=>{for(let i=0;i<24;i++)await hour(db,i,p,d);};
async function row(db,id,a='2026-10-09 00:00:00',c='2026-10-09 00:00:10',extra={}){const x={source_system:'AR',country_code:'IN',platform:'91CLUB',order_kind:'withdraw',order_no:id,applied_at:a,completed_at:c,observed_at:'2026-10-11T00:00:00Z',status:'success',operator:'system',...extra},k=Object.keys(x);await db.query(`insert into ar_collected_orders(${k.join(',')})values(${k.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(x));}
test('24 native hourly partitions exactly reproduce whole-day source counts and positive trunc seconds, with weighted empty pools',async()=>{const db=await stage();try{
 await row(db,'a');await row(db,'b','2026-10-09 00:59:59.999999','2026-10-09 01:00:20.9');await row(db,'c','2026-10-09 01:00:00','2026-10-09 01:02:00');await row(db,'z','2026-10-09 01:00:00','2026-10-09 01:00:00.9');await row(db,'n','2026-10-09 23:59:59.999999',null);
 await row(db,'outside','2026-10-10 00:00:00');await row(db,'no-applied',null);await row(db,'foreign','2026-10-09 00:00:00',null,{platform:'OTHER'});
 const exact=await day(db);await allHours(db);const staged=await finish(db);for(const k of ['sourceCount','durationSampleCount','durationTotalSeconds','avgSeconds'])assert.equal(staged[k],exact[k],k);assert.equal(staged.hours,24);assert.equal(staged.sourceCount,5);assert.equal(staged.durationSampleCount,3);assert.equal(staged.durationTotalSeconds,150);assert.equal(staged.avgSeconds,50);assert.equal(await parts(db),24);
 await allHours(db,'EMPTY');const empty=await finish(db,'EMPTY');assert.equal(empty.sourceCount,0);assert.equal(empty.durationSampleCount,0);assert.equal(empty.avgSeconds,null);
 }finally{await db.close();}});
test('missing or stale hours never publish a day, and related source changes remove the entire day before subsequent staging',async()=>{const db=await stage();try{
 await row(db,'a');await hour(db,0);for(let i=1;i<23;i++)await hour(db,i);await assert.rejects(()=>finish(db),/hours_incomplete/);assert.equal(await daily(db),0);
 await row(db,'late','2026-10-09 12:00:00','2026-10-09 12:01:00');assert.equal(await parts(db),0,'source insertion removes every prior-hour witness');for(let i=1;i<24;i++)await hour(db,i);await assert.rejects(()=>finish(db),/hours_incomplete/);
 await hour(db,0);const r=await finish(db);assert.equal(r.sourceCount,2);assert.equal(r.durationTotalSeconds,70);
 await db.exec("update private.ar_historical_duration_hour_parts set generation=md5('stale') where native_hour=17;delete from private.ar_historical_duration_cache");await assert.rejects(()=>finish(db),/hours_incomplete/);assert.equal(await daily(db),0);
 }finally{await db.close();}});
test('native business mutations invalidate all hours and old/new days; capture/status/operator updates preserve valid witnesses',async()=>{const db=await stage();try{
 await row(db,'a');await allHours(db);await finish(db);const before=(await db.query('select to_jsonb(c)r from private.ar_historical_duration_hour_parts c order by native_hour')).rows;
 await db.exec("update ar_collected_orders set observed_at='2026-10-12T00:00:00Z',status='failed',operator='Reviewer'");assert.deepEqual((await db.query('select to_jsonb(c)r from private.ar_historical_duration_hour_parts c order by native_hour')).rows,before);assert.equal(await daily(db),1);
 await db.exec("update ar_collected_orders set completed_at=null");assert.equal(await parts(db),0);assert.equal(await daily(db),0);
 await hour(db,0);await hour(db,0,'91CLUB','2026-10-08');await db.exec("update ar_collected_orders set applied_at='2026-10-08 12:00:00'");assert.equal(await parts(db),0);
 await hour(db,0,'91CLUB','2026-10-08');await db.exec("delete from ar_collected_orders");assert.equal(await parts(db),0);
 await hour(db,0);await day(db);await db.exec('truncate ar_collected_orders');assert.equal(await parts(db),0);assert.equal(await daily(db),0);
 }finally{await db.close();}});
test('hour maintenance and finalization are owner-only RC, and misgranted BYPASSRLS cannot write private parts',async()=>{const db=await stage();try{
 await hour(db,0);for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(()=>hour(db,0),/permission denied/);await assert.rejects(()=>finish(db),/permission denied/);await db.exec('reset role');}
 await db.exec('begin isolation level repeatable read');await assert.rejects(()=>hour(db,0),/maintenance_context/);await db.exec('rollback');await db.exec('begin isolation level repeatable read');await assert.rejects(()=>finish(db),/maintenance_context/);await db.exec('rollback');
 for(const n of [-1,24,null])await assert.rejects(()=>hour(db,n),/invalid_ar_historical_duration_partition/);
 await db.exec('alter role service_role bypassrls;grant select,insert,update,delete,truncate on private.ar_historical_duration_hour_parts to service_role');assert.equal(await g(db),null);await db.exec('set role service_role');
 for(const q of ['update private.ar_historical_duration_hour_parts set duration_total_seconds=999999','delete from private.ar_historical_duration_hour_parts','truncate private.ar_historical_duration_hour_parts'])await assert.rejects(()=>db.exec(q),/cache_write_denied/);await db.exec('reset role;revoke all on private.ar_historical_duration_hour_parts from service_role');assert.equal(await parts(db),1);
 }finally{await db.close();}});
test('source invalidation, staging and publishing roll back atomically; metadata generation changes prevent old-hour resurrection',async()=>{const db=await stage();try{
 await row(db,'a');await allHours(db);const out=await finish(db),old=await g(db);await db.exec('begin;update ar_collected_orders set completed_at=null;rollback');assert.equal(await parts(db),24);assert.equal((await finish(db)).durationTotalSeconds,out.durationTotalSeconds);
 await db.exec('begin');await hour(db,0);await db.exec('rollback');assert.equal(await parts(db),24);
 await db.exec('alter table private.ar_historical_duration_hour_parts disable trigger ar_historical_duration_hour_write_guard');assert.equal(await g(db),null);await db.exec('alter table private.ar_historical_duration_hour_parts enable trigger ar_historical_duration_hour_write_guard');assert.notEqual(await g(db),old);await assert.rejects(()=>finish(db),/hours_incomplete/);
 await allHours(db);assert.equal((await finish(db)).durationTotalSeconds,10);const fresh=await g(db);await db.exec('analyze private.ar_historical_duration_hour_parts');assert.equal(await g(db),fresh);
 }finally{await db.close();}});
test('upgrade/replay preserve old day maintenance and source rows; baseline, constraint and function drift rejects',async()=>{const db=await baseline();try{
 await row(db,'a');const source=(await db.query('select to_jsonb(c)r from ar_collected_orders c')).rows;await day(db);const before=await g(db);await db.exec(upgrade);assert.notEqual(await g(db),before);assert.equal(await daily(db),1,'no scan or rewrite; old-generation pool is simply stale');assert.deepEqual((await db.query('select to_jsonb(c)r from ar_collected_orders c')).rows,source);
 assert.equal((await day(db)).durationTotalSeconds,10);await hour(db,0);const now=await g(db);await db.exec(upgrade);assert.equal(await g(db),now);assert.equal(await parts(db),1);
 for(const q of ['alter function private.refresh_ar_historical_duration(text,date) security definer','alter table private.ar_historical_duration_hour_parts drop constraint ar_history_duration_hour_counts']){await db.exec('begin');await db.exec(q);await assert.rejects(()=>db.exec(upgrade.slice(upgrade.indexOf('do $upgrade_guard$'),upgrade.lastIndexOf('commit;'))),/AR_DURATION_HOUR_(BASELINE|CONSTRAINT|CHECK)_DRIFT/);await db.exec('rollback');}
 }finally{await db.close();}});
test('hour-staged prior overlay preserves complete main JSON outside time fields and adapts original-overlay replay safely',async()=>{const source=path.join(repo,'tests/auto-withdraw-native-historical-duration-sql.test.cjs'),ctx=vm.createContext({__dirname:path.dirname(source),require:createRequire(source),structuredClone});vm.runInContext(fs.readFileSync(source,'utf8').split("test('cache miss")[0]+';globalThis.h={fixture,call,history,withoutTime};',ctx);for(const originalApplied of [false,true]){const db=await ctx.h.fixture();try{
 await ctx.h.history(db);if(originalApplied)await db.exec(read('supabase/migrations/20261011155300_auto_withdraw_native_historical_duration.sql'));const before=await ctx.h.call(db,{platform:'91CLUB'});await db.exec(upgrade);await allHours(db);const verified=await finish(db);await db.exec(overlay);const after=await ctx.h.call(db,{platform:'91CLUB'});
 assert.deepEqual(ctx.h.withoutTime(after),ctx.h.withoutTime(before));assert.equal(after.rows[0].previous.avgSeconds,verified.avgSeconds);assert.equal(after.rows[0].previous.durationBasis,'applied_to_completed');assert.equal(after.rows[0].comparisonComparable,false);const once=JSON.stringify(after);await db.exec(overlay);assert.equal(JSON.stringify(await ctx.h.call(db,{platform:'91CLUB'})),once);
 }finally{await db.close();}}});
