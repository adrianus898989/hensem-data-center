// Portable synthetic cohort fixture. Uses the existing source setup and actual cohort SQL.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initializeSources}=require('./source-fixture.cjs');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8'),sql=p=>read(p+'.sql');
async function initialize(){
 let f=await initializeSources(),db=f.db;
const query=(extra={})=>f.request({operation:'summary',threshold:15,charts:false,startAt:'2026-10-11T00:00:00+05:30',endAt:'2026-10-13T00:00:00+05:30',currency:'INR',...extra});
const call=async(q=query())=>(await db.query('select private.submission_cohort_read($1)x',[JSON.stringify({...q,preparedVersion:1})])).rows[0].x;
async function worker(){const j=(await db.query("update private.withdraw_prepared_jobs set status='running',fence=fence+1,run_id=gen_random_uuid(),attempts=attempts+1,lease_until=clock_timestamp()+interval'120second',claim_pid=pg_backend_pid(),claim_backend_start=(select backend_start from pg_stat_activity where pid=pg_backend_pid())where id=(select id from private.withdraw_prepared_jobs where status='queued'and not_before<=clock_timestamp()order by not_before,created_at limit 1)returning id,run_id,fence")).rows[0];if(!j)return false;await db.query("select set_config('withdraw_prepared.claim',$1,false)",[JSON.stringify({jobId:j.id,runId:j.run_id,fence:j.fence})]);await db.exec("set statement_timeout='8s'");return(await db.query('select private.withdraw_prepared_run_claimed()x')).rows[0].x;}
async function drain(){let n=0;for(;n<10;n++){const x=await worker();if(!x)break;assert.equal(x.published,true,JSON.stringify(x));}assert.ok(n<10);return n;}
await f.as(f.owner);await db.exec('drop table public.ar_collected_orders cascade;drop table public.newar_detail_records cascade');await db.exec(read('native-source-schema.sql'));
await db.exec(`create table private.yash_sync_windows(order_type text,stream text,start_at timestamptz,end_exclusive timestamptz,complete boolean,source_count bigint,uploaded_count bigint,stored_count bigint,observed_at timestamptz);
create function private.provider_snapshot_kernel_contract_current()returns boolean language sql stable as $$select true$$;
create function private.provider_snapshot_dependency_token(t jsonb)returns text language sql stable as $$select md5(t::text)$$;
create function private.prepared_aggregate_native_catalog()returns setof fixture_platforms language sql stable as $$select *from public.fixture_platforms$$;
`);await db.exec(read('native-amount-helper.sql'));await db.exec(read('original-parent.sql'));await db.exec(read('original-kernel.sql'));
const store=read('withdraw-store.sql');await db.exec(store);await db.exec('create table private.fixture_generations(x text)');
for(const n of ['day-kernel','project','versions','store','context','admission','compute','read'])await db.exec(sql(n));
// Existing wrappers outside the new branch are present as exact actual sources;
// their old unrelated kernels are never called in this synthetic family.
await db.exec(sql('complete'));await db.exec(sql('run'));await db.exec(sql('public'));
await db.exec("update private.submission_cohort_control set enabled=true,hooks=private.submission_cohort_hooks_current()");
await db.exec(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel,member_level,recharge_count)
select 'AR','IN','AR-RAW','recharge','SAME-'||d||'-'||i,'SAME',123.45,'待支付',d::date+time'10:00'+i*interval'1second',case when i<=14 then'A'else'B'end,0,0 from generate_series(date'2026-10-11',date'2026-10-12',interval'1day')d cross join generate_series(1,20)i;`);

 return {db,f,query,call,drain};
}
module.exports={initialize};
