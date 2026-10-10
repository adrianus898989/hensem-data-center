// Performance follow-up: preserve coverage semantics without per-row SQL helpers.
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const patch=read('supabase/migrations/20261010073211_yash_submission_coverage_native_predicates.sql');
let setup,f,db,original,beforeMetadata;
const ctx=vm.createContext({__dirname,require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,beforeEach(){},after(){}}:require(n)});
vm.runInContext(read('tests/yash-submission-sql.test.cjs').split(/\ntest\(/)[0]+'\nglobalThis.fixture={get db(){return db},seed,cover,evidence};',ctx);
const info=async()=>(await db.query("select pg_get_functiondef(oid) definition,md5(prosrc) hash,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='private.dashboard_admin_yash_submission_coverage(date)'::regprocedure")).rows[0];
before(async()=>{await setup();f=ctx.fixture;db=f.db;const p=await info();assert.equal(p.hash,'c64aba6321106d2c566cab95a14382b8');original=p.definition;beforeMetadata=p.metadata;});
beforeEach(async()=>{await db.exec('truncate private.yash_orders,private.yash_sync_windows');await db.exec(original);});
after(async()=>db?.close());
test('native status and finite ordered completion predicates exactly match old helpers across null/infinity/future and every source label',async()=>{
 const r=(await db.query(`with fixture as (
 select status,created,completed from unnest(array['充值成功','人工确认成功','已创建','处理中','充值失败','订单过期','用户取消','unrecognized','',null])status
 cross join unnest(array['2026-10-01T10:00:00Z'::timestamptz,null,'infinity','-infinity'])created
 cross join unnest(array['2026-10-01T09:00:00Z'::timestamptz,'2026-10-01T10:00:00Z','2026-10-01T11:00:00Z',null,'infinity','-infinity',statement_timestamp()+interval '1 day'])completed
 ) select count(*) cases,
 count(*) filter(where (private.dashboard_admin_yash_status('deposit',status)='unknown') is distinct from
 coalesce(status not in ('充值成功','人工确认成功','已创建','处理中','充值失败','订单过期','用户取消'),true)) status_mismatch,
 count(*) filter(where ((private.dashboard_admin_yash_status('deposit',status)='success' and private.dashboard_admin_yash_completed_at('deposit',status,created,completed,statement_timestamp()) is null) is true)
 is distinct from ((status in ('充值成功','人工确认成功') and not coalesce(isfinite(created) and isfinite(completed) and isfinite(statement_timestamp()) and completed>=created and completed<=statement_timestamp(),false)) is true)) time_mismatch
 from fixture`)).rows[0];assert.deepEqual(r,{cases:280,status_mismatch:0,time_mismatch:0});
});
test('dual-stream proofs and bad native-data evidence are unchanged after predicate optimization',async()=>{
 await f.seed('GOOD');await db.exec(`insert into private.yash_orders(source_site,order_type,order_no,uid,status,amount,currency,created_at,completed_at)
 select 'yash','deposit','EDGE-'||i,case when i=2 then null else 'EDGE' end,
 case when i=1 then 'unrecognized' when i<5 then '充值成功' else '人工确认成功' end,0,'INR',
 case when i=3 then null when i=4 then '-infinity'::timestamptz else '2026-10-01T10:00Z'::timestamptz end,
 case when i=2 then '2026-10-02T00:00+05:30'::timestamptz when i=4 then 'infinity'::timestamptz when i=5 then statement_timestamp()+interval '1 day' else null end
 from generate_series(1,5)i;`);
 await f.cover('2026-10-01',3);const days=['2026-09-30','2026-10-01','2026-10-02','2026-10-03'];
 const before=await Promise.all(days.map(f.evidence));await db.exec(patch);assert.deepEqual(await Promise.all(days.map(f.evidence)),before);
 assert.equal((await info()).hash,'38e9b7d9a8e994d40896e29c85769892');assert.deepEqual((await info()).metadata,beforeMetadata);
});
test('guard retains owner/ACL/settings, is replay safe, and rejects unexpected source code or grants',async()=>{
 await db.exec(patch);const optimized=await info();await db.exec(patch);assert.deepEqual(await info(),optimized);assert.deepEqual(optimized.metadata,beforeMetadata);
 assert.doesNotMatch(optimized.definition,/dashboard_admin_yash_status|dashboard_admin_yash_completed_at/,'the full-history aggregate calls no scalar SQL helper');
 await db.exec(optimized.definition.replace('with bounds as (','with bounds as ( -- drift'));await assert.rejects(()=>db.exec(patch),/definition_drift/);await db.exec('rollback');await db.exec(optimized.definition);
 await db.exec('grant execute on function private.dashboard_admin_yash_submission_coverage(date) to authenticated');await assert.rejects(()=>db.exec(patch),/acl_drift/);await db.exec('rollback');await db.exec('revoke execute on function private.dashboard_admin_yash_submission_coverage(date) from authenticated');assert.deepEqual((await info()).metadata,beforeMetadata);
});
