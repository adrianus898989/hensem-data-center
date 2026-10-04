// Independent job-boundary checks using the real PostgreSQL job implementation.
// Fixture records and account identities are synthetic; no network is used.
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),{randomUUID}=require('node:crypto');
const filename=path.join(__dirname,'admin-submission-streak-sql.test.cjs'),req=createRequire(filename);
let setup,db,f,rpc,captureDefinition;
const context=vm.createContext({__dirname,require:name=>name==='node:test'?{test(){},before:fn=>{setup=fn},beforeEach(){},after(){}}:req(name)});
vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.jobFixture={get db(){return db},get f(){return f},rpc};',context,{filename});
const admin=()=>db.exec('reset role');
const as=async uid=>{await admin();await f.as(uid);await db.exec('set role authenticated');};
const start=(patch={})=>({operation:'start',platformId:f.ids.ar,startAt:'2026-09-30T00:00:00+05:30',endAt:'2026-10-01T00:00:00+05:30',direction:'charge',lookbackDays:7,clientRequestId:randomUUID(),...patch});
const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
const operations=jobId=>['step','summary','members'].map(operation=>({operation,jobId,...(operation==='members'?{streakDays:3}:{})}));
before(async()=>{
 await setup();({db,f,rpc}=context.jobFixture);
 captureDefinition=await scalar("select pg_get_functiondef('private.dashboard_submission_streak_capture_day(jsonb,date,text[],text)'::regprocedure)");
});
beforeEach(async()=>{
 await admin();await db.exec('truncate ar_collected_orders,newar_detail_records,lg_orders,game66_charge_orders,private.dashboard_submission_streak_jobs cascade');
 await db.query('update dashboard_profiles set active=true,data_scope=$1::jsonb where auth_user_id=$2',[JSON.stringify({countries:['IN'],platforms:['AR-RAW']}),f.viewer]);
 await db.query("update fixture_platforms set currency='INR',timezone='Asia/Kolkata',scope_group='IN',source='ar',source_name='AR-RAW' where id=$1",[f.ids.ar]);
 await db.exec(captureDefinition);await as(f.owner);
});
after(async()=>db?.close());

test('start is actor-owned and idempotent; changed request and incomplete reads are rejected',async()=>{
 const request=start(),job=await rpc(request);
 assert.equal(job.processedDays,0);assert.equal(job.status,'pending');assert.equal((await rpc(request)).jobId,job.jobId);
 await assert.rejects(rpc({...request,lookbackDays:15}),/analysis_nonce_conflict/);
 for(const operation of ['summary','members'])await assert.rejects(rpc({operation,jobId:job.jobId,...(operation==='members'?{streakDays:3}:{})}),/analysis_not_ready/);
 await as(f.viewer);
 for(const request of operations(job.jobId))await assert.rejects(rpc(request),/analysis_job_denied/);
 const ownJob=await rpc({...start(),clientRequestId:request.clientRequestId});assert.notEqual(ownJob.jobId,job.jobId);
 for(const patch of [{platformId:f.ids.hidden},{providers:['other']},{currency:'USD'},{lookbackDays:30}])await assert.rejects(rpc({operation:'step',jobId:ownJob.jobId,...patch}),/invalid_request/);
});

test('every existing-job operation checks fresh scope, profile status and native platform metadata',async()=>{
 await as(f.viewer);const job=await rpc(start());
 await admin();await db.query("update dashboard_profiles set data_scope='{}'::jsonb where auth_user_id=$1",[f.viewer]);await as(f.viewer);
 for(const request of operations(job.jobId))await assert.rejects(rpc(request),/platform_denied/);
 await admin();await db.query('update dashboard_profiles set active=false where auth_user_id=$1',[f.viewer]);await as(f.viewer);
 await assert.rejects(rpc({operation:'step',jobId:job.jobId}),/preview_denied/);
 await as(f.owner);const ownJob=await rpc(start());
 for(const [column,value,original] of [['currency','USD','INR'],['timezone','UTC','Asia/Kolkata'],['source_name','OTHER','AR-RAW'],['scope_group','BR','IN'],['source','lg','ar']]){
  await admin();await db.query(`update fixture_platforms set ${column}=$1 where id=$2`,[value,f.ids.ar]);await as(f.owner);
  for(const request of operations(ownJob.jobId))await assert.rejects(rpc(request),/platform_denied/);
  await admin();await db.query(`update fixture_platforms set ${column}=$1 where id=$2`,[original,f.ids.ar]);await as(f.owner);
 }
});

test('expired jobs cannot expose progress, results or members',async()=>{
 const job=await rpc(start());await admin();
 await db.query("update private.dashboard_submission_streak_jobs set expires_at=statement_timestamp()-interval '1 second' where id=$1",[job.jobId]);await as(f.owner);
 for(const request of operations(job.jobId))await assert.rejects(rpc(request),/analysis_job_expired/);
});

test('each step commits one day; failure preserves progress and completed jobs do not recapture',async()=>{
 let job=await rpc(start());job=await rpc({operation:'step',jobId:job.jobId});assert.equal(job.processedDays,1);
 const failCapture="create or replace function private.dashboard_submission_streak_capture_day(p_platform jsonb,p_day date,p_providers text[],p_currency text) returns jsonb language plpgsql stable security invoker set search_path='' as $$begin raise exception 'fixture_capture_failure';end$$";
 await admin();await db.exec(failCapture);await as(f.owner);
 await assert.rejects(rpc({operation:'step',jobId:job.jobId}),/fixture_capture_failure/);
 await admin();assert.equal(await scalar('select count(*)::int from private.dashboard_submission_streak_days where job_id=$1',[job.jobId]),1);await db.exec(captureDefinition);await as(f.owner);
 for(let expected=2;expected<=7;expected++){job=await rpc({operation:'step',jobId:job.jobId});assert.equal(job.processedDays,expected);}
 const summary=await rpc({operation:'summary',jobId:job.jobId});assert.equal(summary.status,'complete');assert.equal(summary.rows,null);assert.equal(summary.streaks[0].member_count,0);
 await admin();await db.exec(failCapture);await as(f.owner);assert.equal((await rpc({operation:'step',jobId:job.jobId})).processedDays,7);
 await admin();assert.equal(await scalar('select count(*)::int from private.dashboard_submission_streak_days where job_id=$1',[job.jobId]),7);await db.exec(captureDefinition);
});

test('authenticated callers cannot read private job state or execute raw-result helpers',async()=>{
 for(const table of ['dashboard_submission_streak_jobs','dashboard_submission_streak_days'])await assert.rejects(db.query(`select * from private.${table}`),/permission denied/);
 await assert.rejects(db.query("select private.dashboard_submission_streak_result(null,'summary',3,null,20,0)"),/permission denied/);
 await assert.rejects(db.query("select private.dashboard_submission_streak_capture_day('{}','2026-09-20',null,'INR')"),/permission denied/);
});
