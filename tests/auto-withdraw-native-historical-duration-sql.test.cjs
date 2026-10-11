// Full synthetic main-reader regression; no Auth impersonation.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test'),{createRequire}=require('node:module');
const w=__dirname,repo=path.resolve(w,'..'),source=path.join(repo,'tests/ar-withdraw-bounded-projection-sql.test.cjs');
const c=vm.createContext({__dirname:path.dirname(source),require:n=>n==='node:test'?{test(){}}:createRequire(source)(n),structuredClone});
vm.runInContext(fs.readFileSync(source,'utf8').split("test('projected native")[0]+';globalThis.h={fixture:fullFixture,row,ar:candidate};',c);
const read=f=>fs.readFileSync(path.join(repo,f),'utf8'),objects=read('supabase/migrations/20261011154529_ar_withdraw_historical_duration_cache.sql'),migration=read('supabase/migrations/20261011155300_auto_withdraw_native_historical_duration.sql');
const call=(db,q={})=>db.query('select private.dashboard_admin_live_auto_withdraw($1::jsonb)r',[{country:'印度',startAt:'2026-10-10T00:00:00Z',endAt:'2026-10-10T23:59:59Z',limit:20,...q}]).then(x=>x.rows[0].r);
const refresh=async(db,p='91CLUB')=>(await db.query("select private.refresh_ar_historical_duration($1,'2026-10-09')r",[p])).rows[0].r;
async function fixture(){const db=await c.h.fixture();await db.exec(c.h.ar);await db.exec(objects);return db;}
function withoutTime(v){const r=structuredClone(v);function visit(x){if(!x||typeof x!=='object')return;for(const k of Object.keys(x))if(['avgSeconds','durationSampleCount','durationTotalSeconds','durationBasis','durationSource','durationCacheVerified','durationCompletenessVerified'].includes(k))delete x[k];else visit(x[k]);}visit(r);return r;}
async function history(db,p='91CLUB',seconds=10){await c.h.row(db,'HISTORY-'+p,{platform:p,applied_at:'2026-10-09 00:00:00',completed_at:'2026-10-09 00:00:'+String(seconds).padStart(2,'0'),status:'failed'});await c.h.row(db,'HISTORY-2-'+p,{platform:p,applied_at:'2026-10-09 23:59:59',completed_at:'2026-10-10 00:00:29',status:'success'});}
test('cache miss/zero pool retains all prior source-report JSON, operators and scopes without raw fallback',async()=>{const db=await fixture();try{
 const qs=[{}, {platforms:[]},{platform:'91CLUB'},{view:'operators'},{daily:true},{offset:20},{sort:'previousAvgSeconds'},{country:'巴基斯坦'},{endAt:'2026-10-11T23:59:59Z'}],before=[];
 for(const q of qs)before.push(await call(db,q));await refresh(db,'91CLUB'); // fixture already has a prior outside-cutover row; its completed interval is intentionally positive.
 await db.exec('delete from private.ar_historical_duration_cache');await refresh(db,'55CLUB');
 await db.exec(migration);for(let i=0;i<qs.length;i++)assert.deepEqual(await call(db,qs[i]),before[i],'missing/zero cache '+i);
 }finally{await db.close();}});
test('historical native samples change only time and basis, retain counts/coverage/timestamps, and current native time remains unchanged',async()=>{const db=await fixture();try{
 await history(db);const before=await call(db,{platform:'91CLUB'});const seeded=await refresh(db);await db.exec(migration);const now=await call(db,{platform:'91CLUB'}),r=now.rows[0];
 assert.deepEqual(withoutTime(now),withoutTime(before));assert.equal(r.avgSeconds,before.rows[0].avgSeconds);assert.equal(r.previous.total,before.rows[0].previous.total);
 assert.equal(r.previous.durationBasis,'applied_to_completed');assert.equal(r.previous.durationSampleCount,seeded.durationSampleCount);assert.equal(r.previous.durationTotalSeconds,seeded.durationTotalSeconds);assert.equal(r.previous.avgSeconds,seeded.avgSeconds);
 assert.equal(r.previous.durationCacheVerified,true);assert.equal(r.previous.durationCompletenessVerified,false);assert.equal(r.previous.durationSource,'native_historical_cache');assert.equal(r.comparisonComparable,false);assert.equal(now.arCoverage.complete,false);
 }finally{await db.close();}});
test('multiple report rows/aliases preserve every count and attach one native pool, not repeated time samples',async()=>{const db=await fixture();try{
 await history(db);await db.query("insert into newar_business_snapshots values('auto_withdraw_bundle','all','印度','91CLUB','2026-10-09',$1::jsonb,$2,$2)",[JSON.stringify({rows:[{total_count:10,success_count:7,reject_count:3,auto_count:2,manual_count:8,handle_count:10,total_handle_seconds:700},{total_count:11,success_count:6,reject_count:5,auto_count:3,manual_count:8,handle_count:11,total_handle_seconds:1100}]}),'2026-10-11T00:00:00Z']);
 const before=await call(db,{platform:'91CLUB'}),native=await refresh(db);await db.exec(migration);const after=await call(db,{platform:'91CLUB'});assert.deepEqual(withoutTime(after),withoutTime(before));assert.equal(after.rows[0].previous.total,21);assert.equal(after.rows[0].previous.durationSampleCount,native.durationSampleCount);assert.equal(after.rows[0].previous.durationTotalSeconds,native.durationTotalSeconds);
 }finally{await db.close();}});
test('source time update invalidates old historical duration and safely restores original report basis until refreshed',async()=>{const db=await fixture();try{
 await history(db);await refresh(db);await db.exec(migration);assert.equal((await call(db,{platform:'91CLUB'})).rows[0].previous.durationBasis,'applied_to_completed');
 await db.exec("update ar_collected_orders set completed_at=null where order_no='HISTORY-91CLUB'");const after=await call(db,{platform:'91CLUB'});assert.equal(after.rows[0].previous.durationBasis,'source_reported_processing');assert.equal(after.rows[0].previous.durationCacheVerified,undefined);assert.equal(after.rows[0].previous.avgSeconds,12);
 const seed=await refresh(db);assert.equal((await call(db,{platform:'91CLUB'})).rows[0].previous.avgSeconds,seed.avgSeconds);
 }finally{await db.close();}});
test('durationChange sorts observed samples with the same explicit basis, but never mixed, missing or cross-basis periods',async()=>{const db=await fixture();try{
 await history(db);await refresh(db);await history(db,'RAJA');await refresh(db,'RAJA');await refresh(db,'RAJALOTTERY');
 await db.query("insert into auto_withdraw_daily values('2026-10-09','印度','RAJA',20,20,0,5,15,12,$1,$1)",['2026-10-11T00:00:00Z']);
 await db.exec("update ar_collected_orders set completed_at=applied_at+interval '60 seconds' where platform='RAJA' and applied_at::date='2026-10-10' and completed_at>applied_at");
 await db.exec(migration);const r=await call(db,{sort:'durationChange'});const names=r.rows.map(x=>x.platform);assert(names.indexOf('RAJALOTTERY')<names.indexOf('91CLUB'));assert.equal(r.rows.find(x=>x.platform==='RAJALOTTERY').comparisonComparable,false);
 const restricted=await call(db,{platform:'Veer.Game',sort:'durationChange'});assert.equal(restricted.rows[0].previous,null);
 }finally{await db.close();}});
test('multi-day partially cached prior pools remain weighted and explicitly mixed; daily metadata only follows its actual prior day',async()=>{const db=await fixture();try{
 await history(db);const native=await refresh(db);await db.query("insert into auto_withdraw_daily values('2026-10-08','印度','91CLUB',10,10,0,4,6,100,$1,$1)",['2026-10-11T00:00:00Z']);
 const q={platform:'91CLUB',endAt:'2026-10-11T23:59:59Z'},before=await call(db,q);await db.exec(migration);const after=await call(db,q),prior=after.rows[0].previous;
 assert.deepEqual(withoutTime(after),withoutTime(before));assert.equal(prior.durationSampleCount,native.durationSampleCount+10);assert.equal(prior.durationTotalSeconds,native.durationTotalSeconds+1000);assert.equal(prior.avgSeconds,(native.durationTotalSeconds+1000)/(native.durationSampleCount+10));assert.equal(prior.durationBasis,'mixed_source_processing');assert.equal(prior.durationCacheVerified,undefined,'mixed period is not mislabeled as a fully native pool');
 const sorted=await call(db,{...q,platform:undefined,sort:'durationChange',ascending:true});const names=sorted.rows.map(r=>r.platform);assert(names.indexOf('LEGACY')<names.indexOf('91CLUB'),'a mixed-basis delta stays NULL after known same-basis zero in ascending sort');
 const daily=await call(db,{...q,daily:true});const first=daily.rows.find(r=>r.dataDate==='2026-10-10'),second=daily.rows.find(r=>r.dataDate==='2026-10-11');assert.equal(first.previous.durationCacheVerified,true);assert.equal(first.previous.durationBasis,'applied_to_completed');assert.equal(second.previous.durationCacheVerified,undefined);assert.equal(second.previous.durationBasis,'applied_to_completed');
 }finally{await db.close();}});
test('main migration preserves metadata/replay and authorization; new prerequisite or main body drift rejects',async()=>{const db=await fixture();try{
 const sig='private.dashboard_admin_live_auto_withdraw(jsonb)',meta=async()=> (await db.query('select md5(prosrc) h,to_jsonb(p)-\'prosrc\' m from pg_proc p where oid=$1::regprocedure',[sig])).rows[0];
 const before=await meta();await db.exec(migration);const after=await meta();assert.deepEqual(after.m,before.m);await db.exec(migration);assert.deepEqual(await meta(),after);
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({targets:[['印度','91CLUB']]})]);assert.deepEqual((await call(db)).rows.map(x=>x.platform),['91CLUB']);await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({targets:[]})]);assert.deepEqual((await call(db)).rows,[]);
 await db.exec("set test.denied='yes'");await assert.rejects(()=>call(db),/synthetic_session_denied/);await db.exec("set test.denied='no';set test.scope='{}'");
 for(const drift of ["grant execute on function private.dashboard_admin_ar_historical_duration_days(jsonb,jsonb,date,date) to anon",'alter function '+sig+' security invoker','alter function '+sig+' set search_path=public']){await db.exec('begin');await db.exec(drift);await assert.rejects(()=>db.exec(migration.slice(migration.indexOf('do $patch$'),migration.lastIndexOf('commit;'))),/AR_DURATION_CACHE_(PREREQUISITE|MAIN_METADATA)_DRIFT/);await db.exec('rollback');}
 }finally{await db.close();}});
