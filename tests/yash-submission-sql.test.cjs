// Reviewed production readers with synthetic YASH orders and receipts only.
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20261010072155_yash_submission_dual_stream_coverage.sql');
const production=JSON.parse(read('tests/fixtures/yash-submission-production-functions.json'));
const fixtureSource=read('tests/admin-submission-analysis-sql.test.cjs').split(/\ntest\(/)[0];
let setup,db,f,yash,metadataBefore;
const context=vm.createContext({__dirname,require:name=>name==='node:test'?{test(){},before:fn=>{setup=fn},after(){}}:require(name)});
vm.runInContext(fixtureSource+'\nglobalThis.fixture={get db(){return db},call,request,as,ids,owner,viewer};',context);
function fn(source,name){const start=source.search(new RegExp('create(?: or replace)? function private\\.'+name+'\\(','i'));assert(start>=0);const tail=source.slice(start),m=tail.match(/as\s+(\$[a-z_]*\$)/i),end=tail.indexOf(m[1]+';',m.index+m[0].length);return tail.slice(0,end+m[1].length+1);}
const info=async()=>(await db.query('select oid::regprocedure::text signature,md5(prosrc) hash,proacl::text acl,proowner,proconfig,prosecdef,provolatile from pg_proc where oid=any($1::regprocedure[]) order by 1',[production.map(p=>p.signature)])).rows;
const metadata=async()=>(await info()).map(({hash,...r})=>r);
const daily=extra=>f.call(f.request({platformId:yash,startAt:'2026-10-02T00:00:00+05:30',endAt:'2026-10-03T00:00:00+05:30',...extra}));
const members=extra=>daily({operation:'members',...extra});
const metric=(r,n=15)=>r.metrics.find(m=>m.provider===null&&m.threshold===n);
const evidence=async day=>(await db.query('select private.dashboard_admin_yash_submission_coverage($1::date) data',[day])).rows[0].data;
async function seed(member,{day='2026-10-02',days=1,count=16,split=count,amount='123.45',currency='INR'}={}){
 await db.query(`insert into private.yash_orders(source_site,order_type,order_no,uid,status,amount,currency,supplier,created_at,source_timezone)
 select 'yash','deposit',$1||'-'||($2::date+d)||'-'||i,$1,'已创建',$6::numeric,$7,case when i<=$5 then 'Selected Pay' else 'Other Pay' end,
 (($2::date+d)+time '10:00'+i*interval '1 second') at time zone 'Asia/Kolkata','UTC+08:00'
 from generate_series(0,$3::int-1)d cross join generate_series(1,$4::int)i`,[member,day,days,count,split,amount,currency]);
}
async function receipt(day,stream,{start=null,end=null,zone='UTC+08:00',complete=true,delta=0}={}){
 await db.query(`insert into private.yash_sync_windows(order_type,stream,start_at,end_exclusive,source_count,uploaded_count,stored_count,complete,observed_at,source_timezone)
 select 'deposit',$2,b.start_at,b.end_at,n+$6,n,n,$7,b.end_at+interval '1 hour',$5
 from (select coalesce($3::timestamptz,$1::date::timestamp at time zone 'Asia/Kolkata') start_at,
 coalesce($4::timestamptz,($1::date+1)::timestamp at time zone 'Asia/Kolkata') end_at)b
 cross join lateral(select count(*) n from private.yash_orders y where y.source_site='yash' and y.order_type='deposit'
 and (case when $2='createTime' then y.created_at else y.completed_at end)>=b.start_at
 and (case when $2='createTime' then y.created_at else y.completed_at end)<b.end_at)c
 on conflict(order_type,stream,start_at,end_exclusive) do update set source_count=excluded.source_count,uploaded_count=excluded.uploaded_count,
 stored_count=excluded.stored_count,complete=excluded.complete,observed_at=excluded.observed_at,source_timezone=excluded.source_timezone`,[day,stream,start,end,zone,delta,complete]);
}
async function cover(day,days=1){for(let i=0;i<days;i++){const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+i);const text=d.toISOString().slice(0,10);for(const s of ['createTime','completeTime'])await receipt(text,s);}}
const streakRpc=async q=>(await db.query('select public.dashboard_admin_live_submission_streak($1::jsonb) data',[JSON.stringify(q)])).rows[0].data;
async function streak(extra={}){
 let job=await streakRpc({operation:'start',platformId:yash,direction:'charge',startAt:'2026-10-01T00:00:00+05:30',endAt:'2026-10-08T00:00:00+05:30',lookbackDays:7,clientRequestId:require('node:crypto').randomUUID(),...extra});
 for(let i=0;job.status!=='complete'&&i<7;i++)job=await streakRpc({operation:'step',jobId:job.jobId});
 return streakRpc({operation:'summary',jobId:job.jobId});
}
before(async()=>{
 await setup();f=context.fixture;db=f.db;await db.exec(read('supabase/migrations/20261001040000_submission_whole_member_day.sql'));
 await db.exec(read('tests/fixtures/submission-streak-gateway.sql'));await db.exec(read('tests/fixtures/submission-streak-role-catalog.sql'));
 await db.exec(read('supabase/migrations/20261004125349_submission_consecutive_days.sql'));await db.exec(read('supabase/migrations/20261004132610_submission_streak_job_creation_lock.sql'));
 await db.exec(`alter table ar_collected_orders add column if not exists channel_type text,add column if not exists money_format_version integer,
 add column if not exists amount_local numeric,add column if not exists currency_local text,add column if not exists money_issue_code text;
 create function private.dashboard_admin_ar_local_amount(text,text,text,integer,numeric,text,text,numeric) returns numeric language sql immutable as $$select coalesce($5,$8)$$;
 create table private.yash_orders(source_site text,order_type text,order_no text,uid text,status text,amount numeric,currency text,supplier text,created_at timestamptz,completed_at timestamptz,source_timezone text);
 create table private.yash_sync_windows(order_type text,stream text,start_at timestamptz,end_exclusive timestamptz,source_count bigint,uploaded_count bigint,stored_count bigint,complete boolean,observed_at timestamptz,source_timezone text,primary key(order_type,stream,start_at,end_exclusive));
 alter table private.yash_orders enable row level security;alter table private.yash_sync_windows enable row level security;
 revoke all on private.yash_orders,private.yash_sync_windows from public,anon,authenticated;
 insert into fixture_platforms values(md5('kb:IN:YASH.BET')::uuid,'YASH.BET','M8','印度','IN','kb','Asia/Kolkata','INR','YASH.BET');`);
 const reader=read('supabase/migrations/20261009044023_yash_live_readers.sql');
 for(const name of ['dashboard_admin_yash_status','dashboard_admin_yash_provider','dashboard_admin_yash_completed_at']){
  await db.exec(fn(reader,name));await db.exec(`revoke all on function private.${name}(${name.endsWith('_completed_at')?'text,text,timestamptz,timestamptz,timestamptz':name.endsWith('_status')?'text,text':'text'}) from public,anon,authenticated,service_role`);
 }
 for(const p of production){await db.exec(p.definition);const actual=(await db.query('select md5(prosrc) hash from pg_proc where oid=$1::regprocedure',[p.signature])).rows[0].hash;assert.equal(actual,p.bodyHash);}
 metadataBefore=await metadata();yash=(await db.query("select md5('kb:IN:YASH.BET')::uuid id")).rows[0].id;
 await db.exec(migration);
});
beforeEach(async()=>{await f.as(f.owner);await db.exec('truncate ar_collected_orders,newar_detail_records,lg_orders,game66_charge_orders,private.yash_orders,private.yash_sync_windows,private.dashboard_submission_streak_jobs cascade');});
after(async()=>db?.close());

test('absence never proves zero; dual complete empty receipts prove a closed native day independently of source display timezone',async()=>{
 let e=await evidence('2026-10-02');assert.equal(e.complete,false);assert.equal(e.dataComplete,false);
 let r=await daily();assert.equal(r.coverage.coverageUnknownDays,1);assert.equal(r.coverage.calculationComplete,false);assert.equal(r.coverage.sourceCompletenessVerified,false);
 await receipt('2026-10-02','createTime');e=await evidence('2026-10-02');assert.equal(e.createTimeComplete,true);assert.equal(e.completeTimeComplete,false);assert.equal(e.complete,false);
 await receipt('2026-10-02','completeTime',{zone:'UTC'});e=await evidence('2026-10-02');assert.equal(e.complete,true);assert.equal(e.dataComplete,true);
 r=await daily();assert.equal(r.coverage.coverageUnknownDays,0);assert.equal(r.coverage.calculationComplete,true);assert.equal(metric(r).invalid_count,0);
});
test('contiguous half-open windows cover both streams; gaps, incomplete flags, all three counts and current-table drift fail closed',async()=>{
 await seed('COVER');for(const s of ['createTime','completeTime']){
  await receipt('2026-10-02',s,{end:'2026-10-02T12:00:00+05:30'});await receipt('2026-10-02',s,{start:'2026-10-02T12:00:00+05:30'});
 }
 assert.equal((await evidence('2026-10-02')).complete,true);
 await db.exec("update private.yash_sync_windows set start_at=start_at+interval '1 second' where stream='completeTime' and start_at='2026-10-02T12:00:00+05:30'");assert.equal((await evidence('2026-10-02')).complete,false);
 await db.exec('truncate private.yash_sync_windows');await cover('2026-10-02');await db.exec("update private.yash_sync_windows set uploaded_count=uploaded_count+1 where stream='createTime'");assert.equal((await evidence('2026-10-02')).complete,false);
 await cover('2026-10-02');await db.exec("update private.yash_sync_windows set complete=false where stream='completeTime'");assert.equal((await evidence('2026-10-02')).complete,false);
 await cover('2026-10-02');await db.exec("update private.yash_sync_windows set source_count=source_count+1 where stream='createTime'");assert.equal((await evidence('2026-10-02')).complete,false);
 await cover('2026-10-02');await db.exec("update private.yash_sync_windows set source_count=source_count+1,uploaded_count=uploaded_count+1,stored_count=stored_count+1 where stream='createTime'");assert.equal((await evidence('2026-10-02')).complete,false,'equal historical counts still need a current-table recount');
 await cover('2026-10-02');await seed('NEW',{count:1});assert.equal((await evidence('2026-10-02')).complete,false);await cover('2026-10-02');assert.equal((await evidence('2026-10-02')).complete,true);
 await db.exec("delete from private.yash_orders where uid='NEW'");assert.equal((await evidence('2026-10-02')).complete,false);
});
test('completion-only unknown identities/statuses and unresolved historical successes prevent false zero-success qualification',async()=>{
 await seed('CANDIDATE');await db.exec(`insert into private.yash_orders(source_site,order_type,order_no,uid,status,amount,currency,supplier,created_at,completed_at)
 values('yash','deposit','OUTSIDE',null,'待核实',1,'USD','Other Pay','2026-10-01T23:00+05:30','2026-10-02T00:00+05:30');`);
 await cover('2026-10-02');let e=await evidence('2026-10-02');assert.equal(e.complete,true);assert.equal(e.missingMemberCount,1);assert.equal(e.unknownStatusCount,1);assert.equal(e.dataComplete,false);assert.equal((await members()).total,0);
 await db.exec("update private.yash_orders set uid='UNPLACED',status='充值成功',completed_at=null where order_no='OUTSIDE'");await cover('2026-10-02');e=await evidence('2026-10-02');assert.equal(e.missingSuccessTimeCount,1);assert.equal((await daily()).coverage.calculationComplete,false);assert.equal((await members()).total,0);
});
test('open or future days cannot be declared complete and withdrawal receipts cannot prove deposit coverage',async()=>{
 await cover('2026-10-02');await db.exec("update private.yash_sync_windows set order_type='withdrawal'");assert.equal((await evidence('2026-10-02')).complete,false);
 const current=(await db.query("select (statement_timestamp() at time zone 'Asia/Kolkata')::date::text as day_value")).rows[0].day_value;
 await cover(current);const e=await evidence(current);assert.equal(e.complete,false);assert.equal(e.dataComplete,false);
});
test('YASH daily uses native decimal money, strict >15, exact provider/time details, real statuses and unknown level/history',async()=>{
 await seed('VALID',{count:16,split:15,amount:'0'});await seed('FIFTEEN',{count:15});await cover('2026-10-02');
 let r=await daily();assert.equal(metric(r).member_count,1);assert.equal(metric(r).invalid_count,16);assert.equal(metric(r).invalid_amount,'0');assert.equal(metric(r).unknown_members,1);
 const row=(await members({providers:['Other Pay']})).rows[0];assert.equal(row.invalid_count,1);assert.equal(row.invalid_amount,'0');assert.equal(row.recharge_count,null);assert.equal(row.member_level,null);assert.equal(row.first_invalid_at,row.last_invalid_at);
 const orders=await daily({operation:'memberOrders',memberId:'VALID',day:'2026-10-02',providers:['Other Pay'],startAt:'2026-10-02T10:00:16+05:30',endAt:'2026-10-02T10:00:17+05:30',limit:100});
 assert.equal(orders.total,1);assert.equal(orders.rows[0].order_id,'VALID-2026-10-02-16');assert.equal(orders.rows[0].status,'已创建');assert.equal(orders.rows[0].amount,'0');assert.equal(orders.amountGroups[0].count,1);
 await seed('DECIMAL',{count:16,amount:'123.45'});await cover('2026-10-02');r=await daily();assert.equal(metric(r).invalid_amount,'1975.20');
});
test('daily preserves current paid creation-cohort exclusion and all-provider/all-currency same-day success exclusion',async()=>{
 for(const uid of ['LATER','PRIOR','SAME','GOOD'])await seed(uid);
 await db.exec(`update private.yash_orders set status='充值成功',completed_at='2026-10-04T00:00+05:30',supplier='Other Pay',currency='USD' where order_no='LATER-2026-10-02-1';
 update private.yash_orders set status='人工确认成功',completed_at='2026-10-02T11:00+05:30',supplier='Other Pay',currency='USD' where order_no='SAME-2026-10-02-1';
 insert into private.yash_orders(source_site,order_type,order_no,uid,status,amount,currency,supplier,created_at,completed_at)
 values('yash','deposit','PRIOR-PAID','PRIOR','充值成功',1,'USD','Other Pay','2026-10-01T23:59+05:30','2026-10-02T00:00+05:30');`);
 await cover('2026-10-02');const r=await members({providers:['Selected Pay']});assert.deepEqual(r.rows.map(r=>r.member_id),['GOOD']);
});
test('receipt proof cannot overcome missing ID/status/native sequence/success time or fabricate currency',async()=>{
 await seed('GOOD');await cover('2026-10-02');await db.exec("update private.yash_orders set currency=null where uid='GOOD'");
 assert.equal(metric(await daily()).member_count,0);assert.equal((await evidence('2026-10-02')).dataComplete,true);
 await db.exec("update private.yash_orders set currency='INR',status='unrecognized' where order_no='GOOD-2026-10-02-1'");assert.equal((await members()).total,0);assert.ok((await daily()).coverage.unknownStatusCount>0);
 await db.exec("update private.yash_orders set status='已创建',uid=null where order_no='GOOD-2026-10-02-1'");assert.equal((await daily()).coverage.calculationComplete,false);
 await db.exec("update private.yash_orders set uid='GOOD',order_no='' where uid is null");assert.ok((await evidence('2026-10-02')).orderSequenceUncertainCount>0);
 await db.exec("update private.yash_orders set order_no='GOOD-2026-10-02-1',status='充值成功',completed_at=null where order_no=''");assert.ok((await daily()).coverage.missingSuccessTimeCount>0);assert.equal((await members()).total,0);
});
test('streak keeps >=10 and later payment only excludes payment day; cross-provider/currency success breaks a run',async()=>{
 await seed('LATER',{days:3,count:10});await seed('PRIOR',{days:3,count:10});await seed('NINE',{days:3,count:9});
 await db.exec(`update private.yash_orders set status='充值成功',completed_at='2026-10-05T00:00+05:30',currency='USD',supplier='Other Pay' where order_no='LATER-2026-10-04-1';
 insert into private.yash_orders(source_site,order_type,order_no,uid,status,amount,currency,supplier,created_at,completed_at)
 values('yash','deposit','PRIOR-PAID','PRIOR','人工确认成功',1,'USD','Other Pay','2026-10-01T23:59+05:30','2026-10-03T00:00+05:30');`);
 await cover('2026-10-01',7);const r=await streak({providers:['Selected Pay']});const m=r.streaks.find(m=>m.days===3);
 assert.equal(r.threshold,10);assert.equal(r.thresholdComparison,'gte');assert.equal(r.coverage.coverageUnknownDays,0);assert.equal(r.coverage.calculationComplete,true);assert.equal(r.coverage.sourceCompletenessVerified,true);
 assert.equal(m.member_count,1);assert.equal(m.submitted_count,29);assert.doesNotMatch(JSON.stringify(r),/LATER|PRIOR|NINE/);
});
test('streak counts uncovered empty days as unknown, masks formal metrics, preserves observed verified runs and never bridges gaps',async()=>{
 await seed('KNOWN',{days:3,count:10});await cover('2026-10-01',7);
 await db.exec("delete from private.yash_sync_windows where stream='completeTime' and start_at='2026-10-01T00:00+05:30'");
 let r=await streak(),m=r.streaks.find(m=>m.days===3);assert.equal(r.coverage.coverageUnknownDays,1);assert.equal(r.coverage.calculationComplete,false);assert.equal(m.member_count,null);assert.equal(m.submitted_count,null);assert.equal(m.observed_member_count,1);assert.equal(m.observed_submitted_count,30);
 await cover('2026-10-01');await db.exec("delete from private.yash_sync_windows where stream='completeTime' and start_at='2026-10-03T00:00+05:30'");r=await streak();m=r.streaks.find(m=>m.days===3);assert.equal(m.observed_member_count,0);assert.equal(m.member_count,null);
 const captured=(await db.query("select result from private.dashboard_submission_streak_days where day='2026-10-03' order by captured_at desc limit 1")).rows[0].result;assert.equal(captured.coverage.order_count,10);assert.deepEqual(captured.rows,[]);
});
test('native identity, authorization, private helper ACLs and source isolation remain strict',async()=>{
 await f.as(f.viewer);await assert.rejects(()=>daily(),/platform_denied/);await f.as(f.owner);
 await db.query("update fixture_platforms set source='kb',scope_group='IN',source_name='YASH.BET',timezone='Asia/Kolkata' where id=$1",[f.ids.kp]);await assert.rejects(()=>daily({platformId:f.ids.kp}),/submission_source_unavailable/);await assert.rejects(()=>streak({platformId:f.ids.kp}),/submission_source_unavailable/);
 const grants=(await db.query("select has_function_privilege('authenticated','private.dashboard_admin_yash_submission_coverage(date)','execute') a,has_function_privilege('anon','private.dashboard_admin_yash_submission_coverage(date)','execute') b,has_function_privilege('service_role','private.dashboard_admin_yash_submission_coverage(date)','execute') c,has_table_privilege('authenticated','private.yash_orders','select') d")).rows[0];assert.deepEqual(grants,{a:false,b:false,c:false,d:false});
 assert.deepEqual(await metadata(),metadataBefore);
});
test('patches preserve existing sources, all reader metadata, replay safely and reject unexpected code or ACL drift',async()=>{
 await db.exec(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel)
 select 'AR','IN','AR-RAW','recharge','AR-'||i,'AR-MEMBER',0,'待支付','2026-10-02 10:00'::timestamp+i*interval '1 second','Selected Pay' from generate_series(1,16)i;`);
 const current=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure) definition")).rows[0].definition;
 const q=f.request({startAt:'2026-10-02T00:00+05:30',endAt:'2026-10-03T00:00+05:30'});q.startAt='2026-10-02T00:00:00+05:30';q.endAt='2026-10-03T00:00:00+05:30';
 const strip=r=>{delete r.asOf;return r;};const updated=strip(await f.call(q));await db.exec(production[0].definition);assert.deepEqual(strip(await f.call(q)),updated);await db.exec(current);
 await db.exec(migration);assert.deepEqual(await metadata(),metadataBefore);
 await db.exec(current.replace('perform private.dashboard_admin_live_scope();','perform private.dashboard_admin_live_scope(); -- unexpected drift'));await assert.rejects(()=>db.exec(migration),/definition_drift_0/);await db.exec('rollback');await db.exec(current);
 await db.exec('grant execute on function private.dashboard_submission_streak_capture_day(jsonb,date,text[],text) to anon');await assert.rejects(()=>db.exec(migration),/acl_drift_2/);await db.exec('rollback');await db.exec('revoke execute on function private.dashboard_submission_streak_capture_day(jsonb,date,text[],text) from anon');assert.deepEqual(await metadata(),metadataBefore);
});
