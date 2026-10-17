// Local synthetic PostgreSQL only. No sessions, secrets or production rows.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const repo=path.resolve(__dirname,'..'),file=path.join(__dirname,'ar-withdraw-auto-streaming-sql.test.cjs');
const ctx=vm.createContext({__dirname:path.dirname(file),require:n=>n==='node:test'?()=>{}:createRequire(file)(n),structuredClone});
vm.runInContext(fs.readFileSync(file,'utf8').split(/\ntest\(/)[0]+';globalThis.harness={h,fixture,seed,helper,g,migration,main};',ctx);const f=ctx.harness;
const patch=fs.readFileSync(path.join(repo,'supabase/migrations/20261017050859_ar_withdraw_bounded_calendar_cardinality.sql'),'utf8');
const hashes={readerBefore:'d372cd30224f4e1a6ff2e962d4df12b3',readerAfter:'173bf1a012f07d69942571724ff8f658',historicalBefore:'098abcff7a34ce44bbcb197cf3c4a9cc',historicalAfter:'43aa54260f120584133e30a78d01e0ba'};
const rsig='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)',hsig='private.ar_historical_duration_generation()';
async function fixture(){const db=await f.fixture();await db.exec(f.migration);assert.equal((await f.h.info(db,rsig)).hash,hashes.readerBefore);return db;}
test('all 1984 valid start/span calendars retain exact dates, lower cutoff, empty ranges and month transitions',async()=>{const db=await fixture();try{
 const r=await db.query(`with cases as(select date'2026-10-01'+d a,date'2026-10-01'+d+n b from generate_series(0,31)d cross join generate_series(0,61)n),old as(select a,b,array(select d::date from generate_series(greatest(a,date'2026-10-10')::timestamp,b::timestamp,interval'1 day')d)days from cases),new as(select a,b,array(select greatest(a,date'2026-10-10')+n from generate_series(0,61)n where n<=b-greatest(a,date'2026-10-10'))days from cases)select count(*)::int cases,count(*)filter(where old.days is distinct from new.days)::int mismatches from old join new using(a,b)`);assert.deepEqual(r.rows[0],{cases:1984,mismatches:0});
 for(const [a,b]of[['2026-10-12','2026-10-11'],['2026-10-01','2026-12-02']])await assert.rejects(f.helper(db,{},undefined,[a,b]),/invalid_ar_report_range/);
 }finally{await db.close();}});
test('all 17 helper fields match across raw/projection, aliases, scopes, auto/operators, detail fallback, empty and maximum ranges',async()=>{const db=await fixture();try{
 await f.seed(db);await f.h.add(db,'bound-lower','system',{applied_at:'2026-10-10 00:00:00',completed_at:'2026-10-10 00:00:30'});await f.h.add(db,'bound-month','Synthetic actor',{applied_at:'2026-10-31 23:59:59',completed_at:'2026-11-01 00:00:01'});
 const spans=[['2026-10-01','2026-10-09'],['2026-10-01','2026-10-10'],['2026-10-11','2026-10-12'],['2026-10-30','2026-11-01'],['2026-10-10','2026-12-10']];const cases=[];
 for(const view of['auto','operators'])for(const filter of[{},{platform:'91CLUB'},{platforms:[]},{platforms:['91CLUB','JAICLUB']},{platform:'RAJALOTTERY'},{scopeTargets:[{country:'印度',platforms:['91CLUB']}]}])for(const span of spans)cases.push({q:{view,...filter},span});
 for(const phase of['raw','projected']){
  if(phase==='projected')await db.exec("begin isolation level repeatable read;select private.approve_ar_withdraw_fact_day('91CLUB','2026-10-12');commit");
  const beforeReader=(await f.h.info(db,rsig)).d,beforeHistory=(await f.h.info(db,hsig)).d,results=[];for(const c of cases)results.push(await f.helper(db,c.q,undefined,c.span));
  const denied={mode:'selected',countries:[],platforms:[]},noAccess=await f.helper(db,{},denied),state=await f.h.snapshots(db),generation=await f.g(db),meta=(await f.h.info(db,rsig)).meta;
  await db.exec(patch);for(let i=0;i<cases.length;i++)assert.deepEqual(await f.helper(db,cases[i].q,undefined,cases[i].span),results[i],phase+JSON.stringify(cases[i]));
  assert.deepEqual(await f.helper(db,{},denied),noAccess);assert.deepEqual(await f.h.snapshots(db),state);assert.deepEqual(await f.g(db),generation);assert.deepEqual((await f.h.info(db,rsig)).meta,meta);
  const row=(await f.helper(db,{view:'operators',platform:'91CLUB'},undefined,['2026-10-12','2026-10-12']))[0].r;assert(row.operator_rows.some(x=>x.account==='Synthetic_manual'),'verified detail actor retained');
  await db.exec(beforeReader);await db.exec(beforeHistory);
 }
 }finally{await db.close();}});
test('current production main full DTO rows, totals, prior comparisons, sort and pagination remain identical',async()=>{const db=await fixture();try{
 await db.exec(`create function private.dashboard_admin_duoli_withdraw_days(jsonb,jsonb,date,date)returns table(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,pending_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,source_updated_at timestamptz,updated_at timestamptz,operator_rows jsonb)language sql stable as $$select null::date,null::text,null::text,null::text,null::bigint,null::bigint,null::bigint,null::bigint,null::bigint,null::numeric,null::bigint,null::numeric,null::timestamptz,null::timestamptz,null::jsonb where false$$`);
 const current=fs.readFileSync(path.join(__dirname,'fixtures/auto-withdraw-bounded-calendar-main-production.sql'),'utf8');await db.exec(current);await f.seed(db);
 assert.equal((await f.h.info(db,'private.dashboard_admin_live_auto_withdraw(jsonb)')).hash,'12fe721956fb291f2c2b93a5d5187fbd');
 const base={country:'印度',startAt:'2026-10-12T00:00:00Z',endAt:'2026-10-12T23:59:59Z',limit:500},cases=[];
 for(const view of['auto','operators'])for(const daily of[true,false])for(const sort of['platform','total','success','rejected','manualCount','avgSeconds','durationChange'])cases.push({...base,view,daily,sort});
 cases.push({...base,platforms:[]},{...base,platform:'91CLUB'},{...base,scopeTargets:[{country:'印度',platforms:['91CLUB']}]},{...base,limit:20,offset:20},{...base,startAt:'2026-10-10T00:00:00Z',endAt:'2026-10-10T23:59:59Z'});
 const call=q=>db.query('select private.dashboard_admin_live_auto_withdraw($1)r',[q]).then(x=>x.rows[0].r),old=[];for(const c of cases)old.push(await call(c));const generation=await f.g(db),state=await f.h.snapshots(db);await db.exec(patch);
 for(let i=0;i<cases.length;i++)assert.deepEqual(await call(cases[i]),old[i],JSON.stringify(cases[i]));assert.deepEqual(await f.g(db),generation);assert.deepEqual(await f.h.snapshots(db),state);
 }finally{await db.close();}});
test('guarded install and replay preserve metadata and generations, reject drift and roll back bad replacement',async()=>{const db=await fixture();try{
 const before=await f.h.info(db,rsig),history=await f.h.info(db,hsig),generation=await f.g(db),state=await f.h.snapshots(db);await db.exec(patch);assert.equal((await f.h.info(db,rsig)).hash,hashes.readerAfter);assert.equal((await f.h.info(db,hsig)).hash,hashes.historicalAfter);await db.exec(patch);assert.deepEqual(await f.g(db),generation);assert.deepEqual(await f.h.snapshots(db),state);assert.deepEqual((await f.h.info(db,rsig)).meta,before.meta);assert.deepEqual((await f.h.info(db,hsig)).meta,history.meta);
 await db.exec(before.d);await db.exec(history.d);const block=patch.slice(patch.indexOf('do $ar_calendar$'),patch.lastIndexOf('commit;'));
 for(const drift of[`alter function ${rsig}security definer`,`alter function ${rsig}volatile`,`alter function ${rsig}set search_path=public`,`grant execute on function ${rsig}to authenticated`,`alter function ${rsig}cost 200`,`alter function ${rsig}rows 2000`,before.d.replace('p_end date)','p_end date DEFAULT NULL)')]){await db.exec('begin');await db.exec(drift);await assert.rejects(db.exec(block),/ar_calendar_metadata_or_body_drift/);await db.exec('rollback');}
 await assert.rejects(db.exec(patch.replace('generate_series(0,61)','generate_series(0,60)')),/ar_calendar_after_hash_failed/);await db.exec('rollback');assert.deepEqual(await f.h.info(db,rsig),before);assert.deepEqual(await f.h.info(db,hsig),history);
 }finally{await db.close();}});
