const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const patch=read('supabase/migrations/20261010074310_yash_submission_invalid_completion_index.sql');
let setup,db,f,original,beforeMetadata;
const ctx=vm.createContext({__dirname,require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,beforeEach(){},after(){}}:require(n)});
vm.runInContext(read('tests/yash-submission-sql.test.cjs').split(/\ntest\(/)[0]+'\nglobalThis.fixture={get db(){return db},seed,cover,evidence};',ctx);
const info=async()=>(await db.query("select pg_get_functiondef(oid) definition,md5(prosrc) hash,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='private.dashboard_admin_yash_submission_coverage(date)'::regprocedure")).rows[0];
before(async()=>{await setup();f=ctx.fixture;db=f.db;await db.exec(read('supabase/migrations/20261010073211_yash_submission_coverage_native_predicates.sql'));const p=await info();assert.equal(p.hash,'38e9b7d9a8e994d40896e29c85769892');original=p.definition;beforeMetadata=p.metadata;});
beforeEach(async()=>{await db.exec('truncate private.yash_orders,private.yash_sync_windows');await db.exec(original);await db.exec('drop index if exists private.yash_submission_invalid_completion_idx');});
after(async()=>db?.close());
test('static-invalid plus finite future branches partition old completion failures exactly without double counting',async()=>{
 const r=(await db.query(`with fixture as (
 select created,completed from unnest(array['2026-10-01T10:00:00Z'::timestamptz,null,'infinity','-infinity'])created
 cross join unnest(array['2026-10-01T09:00:00Z'::timestamptz,'2026-10-01T10:00:00Z','2026-10-01T11:00:00Z',null,'infinity','-infinity',statement_timestamp()+interval '1 day'])completed
 ), checks as (
 select not coalesce(isfinite(created) and isfinite(completed) and isfinite(statement_timestamp()) and completed>=created and completed<=statement_timestamp(),false) old_invalid,
 (created is null or completed is null or not isfinite(created) or not isfinite(completed) or completed<created) static_invalid,
 (isfinite(created) and isfinite(completed) and completed>=created and completed>statement_timestamp()) future_invalid from fixture
 ) select count(*) cases,count(*) filter(where old_invalid is distinct from (coalesce(static_invalid,false) or coalesce(future_invalid,false))) mismatch,
 count(*) filter(where static_invalid and future_invalid) double_count from checks`)).rows[0];assert.deepEqual(r,{cases:28,mismatch:0,double_count:0});
});
test('optimized indexed helper retains exact aggregate receipts and null/infinite/future bad-time evidence',async()=>{
 await f.seed('GOOD');await db.exec(`insert into private.yash_orders(source_site,order_type,order_no,uid,status,amount,currency,created_at,completed_at)
 select 'yash','deposit','EDGE-'||i,'EDGE','充值成功',0,'INR',
 case when i=1 then null when i=2 then '-infinity'::timestamptz when i=3 then 'infinity'::timestamptz else '2026-10-01T10:00Z'::timestamptz end,
 case when i=4 then '2026-10-01T09:00Z'::timestamptz when i=5 then statement_timestamp()+interval '1 day' when i=6 then 'infinity'::timestamptz else null end
 from generate_series(1,6)i;`);
 await f.cover('2026-10-01',3);const days=['2026-09-30','2026-10-01','2026-10-02','2026-10-03'];const before=await Promise.all(days.map(f.evidence));await db.exec(patch);assert.deepEqual(await Promise.all(days.map(f.evidence)),before);
 const updated=await info();assert.equal(updated.hash,'10d09a786ea5dfd56a4ec90a9e0597d4');assert.deepEqual(updated.metadata,beforeMetadata);
 const index=(await db.query("select indisvalid,indisready,indisunique,pg_get_expr(indpred,indrelid) predicate from pg_index where indexrelid='private.yash_submission_invalid_completion_idx'::regclass")).rows[0];assert.equal(index.indisvalid,true);assert.equal(index.indisready,true);assert.equal(index.indisunique,false);assert.doesNotMatch(index.predicate,/statement_timestamp|now\(/,'partial predicate is immutable; future times use existing time indexes');
});
test('patch preserves grants/settings, replays safely, and rejects a weaker same-name index instead of trusting it',async()=>{
 await db.exec(patch);const optimized=await info();await db.exec(patch);assert.deepEqual(await info(),optimized);
 await db.exec('drop index private.yash_submission_invalid_completion_idx;create index yash_submission_invalid_completion_idx on private.yash_orders(created_at) where completed_at is null');await assert.rejects(()=>db.exec(patch),/index_drift/);await db.exec('rollback');
 await db.exec('drop index private.yash_submission_invalid_completion_idx');await db.exec(patch);assert.deepEqual((await info()).metadata,beforeMetadata);
});
