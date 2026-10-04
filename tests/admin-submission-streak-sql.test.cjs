// Real PostgreSQL execution, synthetic IDs only. No network or source mutations.
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20261004125349_submission_consecutive_days.sql');
const baseline=read('tests/admin-submission-analysis-sql.test.cjs').split(/\ntest\(/)[0];
let setup,db,f,beforeMeta;
const context=vm.createContext({__dirname,require:name=>name==='node:test'?{test(){},before:fn=>{setup=fn},after(){}}:require(name)});
vm.runInContext(baseline+'\nglobalThis.fixture={get db(){return db},call,request,as,ids,owner,viewer};',context);
const q=(x={})=>f.request({startAt:'2026-09-30T00:00:00+05:30',endAt:'2026-10-01T00:00:00+05:30',operation:'streaks',lookbackDays:30,...x});
const rpc=async request=>(await db.query('select public.dashboard_admin_live_submission_streak($1::jsonb) data',[JSON.stringify(request)])).rows[0].data;
const call=async x=>{
 const request=q(x),isMembers=request.operation==='streakMembers',originalOperation=request.operation;
 let detail={};if(isMembers){for(const k of ['streakDays','memberId','offset','limit'])if(k in request){detail[k]=request[k];delete request[k]}}
 request.operation=['streaks','streakMembers'].includes(originalOperation)?'start':originalOperation;
 request.clientRequestId=require('node:crypto').randomUUID();let job=await rpc(request);
 for(let i=0;job.status!=='complete'&&i<30;i++)job=await rpc({operation:'step',jobId:job.jobId});
 return rpc({operation:isMembers?'members':'summary',jobId:job.jobId,...detail});
},details=x=>call({operation:'streakMembers',streakDays:3,...x});
const metric=(r,days=3)=>r.streaks.find(x=>x.days===days);
const metadata=async()=>(await db.query("select oid::regprocedure::text signature,to_jsonb(p)-'prosrc' data from pg_proc p where oid in ('private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure,'public.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure,'public.dashboard_admin_execute(text,jsonb)'::regprocedure) order by 1")).rows;
async function seed(member,{days=3,start='2026-09-20',count=10,country='IN',platform='AR-RAW',split=count,provider='Streak A'}={}){
 await db.query(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel)
 select 'AR',$5,$6,'recharge',$1||'-'||($3::date+d)||'-'||i,$1,100,'待支付',($3::date+d)+time '10:00'+i*interval '1 second',case when i<=$7 then $8 else 'Streak B' end
 from generate_series(0,$2::int-1)d cross join generate_series(1,$4::int)i`,[member,days,start,count,country,platform,split,provider]);
}
before(async()=>{await setup();f=context.fixture;db=f.db;await db.exec(read('supabase/migrations/20261001040000_submission_whole_member_day.sql'));
 await db.exec(read('tests/fixtures/submission-streak-gateway.sql'));await db.exec(read('tests/fixtures/submission-streak-role-catalog.sql'));beforeMeta=await metadata();await db.exec(migration);await db.exec(read('supabase/migrations/20261004132610_submission_streak_job_creation_lock.sql'));
});
beforeEach(async()=>{await f.as(f.owner);await db.exec('truncate ar_collected_orders,newar_detail_records,lg_orders,game66_charge_orders,private.dashboard_submission_streak_jobs cascade')});
after(async()=>db?.close());
test('>=10 independent rule counts overlapping >=3/5/10 native-ID cohorts and IDs dedupe across multiple runs',async()=>{
 for(const days of [2,3,5,10])await seed('D'+days,{days});await seed('NINE',{days:10,count:9});
 await seed('D3',{start:'2026-09-26',days:3});
 const r=await call();assert.equal(r.version,1);assert.equal(r.threshold,10);assert.equal(r.thresholdComparison,'gte');
 assert.deepEqual(r.streaks.map(m=>m.member_count),[3,2,1]);assert.equal(metric(r).member_days,21);assert.equal(metric(r).submitted_count,210);assert.equal(metric(r).submitted_amount,'21000');
 assert.doesNotMatch(JSON.stringify(r),/D10|D3|NINE/,'summary does not leak IDs');
 const d=await details();assert.equal(d.total,3);assert.deepEqual(d.rows.map(r=>r.member_id),['D10','D5','D3']);assert.equal(d.rows[2].qualifying_days,6);
 for(const row of d.rows){assert.equal(row.days.length,row.qualifying_days);assert.equal(row.days.reduce((n,d)=>n+d.submitted_count,0),row.submitted_count);}
 const old=await f.call(f.request({startAt:'2026-09-20T00:00:00+05:30',endAt:'2026-09-21T00:00:00+05:30'}));
 assert.equal(old.thresholdComparison,'gt');assert.equal(old.metrics.find(m=>m.provider===null&&m.threshold===15).member_count,0);
});
test('gaps and under-threshold days break streaks, different platforms and countries never combine IDs',async()=>{
 await seed('GAP',{days:2});await seed('GAP',{days:2,start:'2026-09-23'});await seed('SHORT',{days:2});await seed('SHORT',{days:1,start:'2026-09-22',count:9});
 await seed('CROSS',{days:2});await seed('CROSS',{days:1,start:'2026-09-22',country:'BR'});
 const r=await call();assert.equal(metric(r).member_count,0);assert.equal(metric(r).submitted_amount,'0');assert.equal((await details()).total,0);
 await f.as(f.viewer);await assert.rejects(call({platformId:f.ids.hidden}),/platform_denied/);
});
test('successful local day excludes across providers and prior creation; later payment only breaks payment day',async()=>{
 await seed('SAME',{days:3});await seed('PRIOR',{days:3});await seed('LATER',{days:3});
 await db.exec(`update ar_collected_orders set status='已支付',completed_at='2026-09-21 12:00',raw_channel='Other Pay' where order_no='SAME-2026-09-21-1';
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,completed_at,raw_channel) values
 ('AR','IN','AR-RAW','recharge','CROSS-PAID','PRIOR',100,'已支付','2026-09-19 10:00','2026-09-21 00:00','Other Pay');
 update ar_collected_orders set status='已支付',completed_at='2026-09-23 00:00',raw_channel='Other Pay' where order_no='LATER-2026-09-22-1';`);
 const r=await details({providers:['Streak A']});assert.deepEqual(r.rows.map(x=>x.member_id),['LATER']);assert.equal(r.rows[0].submitted_count,29);
 assert.equal(r.rows[0].days[2].platform_submitted_count,10);assert.equal(r.rows[0].days[2].success_count,0);
});
test('provider selection cannot create/break eligibility and days with zero selected-provider contribution remain evidence',async()=>{
 await seed('SPLIT',{days:3,split:5});await db.exec("update ar_collected_orders set raw_channel='Streak B' where applied_at::date='2026-09-21'");
 const r=await call({providers:['Streak A']});assert.equal(metric(r).member_count,1);assert.equal(metric(r).member_days,3);assert.equal(metric(r).submitted_count,10);
 const d=(await details({providers:['Streak A']})).rows[0];assert.equal(d.days[1].submitted_count,0);assert.equal(d.days[1].platform_submitted_count,10);assert.equal(d.qualifying_days,3);
 assert.equal(metric(await call({providers:['absent']})).member_count,0);
});
test('missing IDs/status/time and duplicate identities do not become verified zero; missing money preserves numeric counts',async()=>{
 await seed('GOOD');await seed('UNKNOWN');await seed('MISSING-TIME');
 await db.exec(`update ar_collected_orders set status='unknown' where order_no='UNKNOWN-2026-09-21-1';
 update ar_collected_orders set status='已支付',completed_at=null where order_no='MISSING-TIME-2026-09-21-1';
 update ar_collected_orders set amount=null where order_no='GOOD-2026-09-21-1';`);
 let r=await call();assert.equal(r.coverage.calculationComplete,false);assert.equal(metric(r).member_count,null);assert.equal(metric(r).observed_member_count,1);assert.equal(metric(r).observed_submitted_amount,null);assert.equal(r.coverage.missingSuccessTimeCount,1);
 const good=(await details()).rows[0];assert.equal(good.member_id,'GOOD');assert.equal(good.submitted_amount,null);
 await db.exec(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,completed_at,raw_channel)
 values('AR','IN','AR-RAW','recharge','UNKNOWN-ID-SUCCESS',null,100,'已支付','2026-09-19 10:00','2026-09-21 00:00','Other Pay');`);
 r=await call();assert.equal(metric(r).observed_member_count,0);assert.equal(metric(r).member_count,null);assert.ok(r.coverage.missingMemberCount>0);
});
test('new AR local timezone, cross-currency success, launch, duplicate native IDs and no WG inference',async()=>{
 await db.exec(`insert into newar_detail_records(platform,dataset,source_id,member_id,order_number,provider,currency,status_group,amount,created_at)
 select 'NEW-RAW','charge','N-'||d||'-'||i,'N','N-'||d||'-'||i,'Streak A','NPR','pending',100,('2026-09-26'::date+d+time '00:00') at time zone 'Asia/Kathmandu'
 from generate_series(0,2)d cross join generate_series(1,10)i;`);
 let r=await call({platformId:f.ids.newar});assert.equal(metric(r).member_count,1);
 await db.exec(`insert into newar_detail_records(platform,dataset,source_id,member_id,order_number,provider,currency,status_group,amount,created_at,success_at)
 values('NEW-RAW','charge','U-SUCCESS','N','U-SUCCESS','Other Pay','USDT','success',10,'2026-09-25T10:00+05:45','2026-09-27T00:00+05:45');`);
 r=await call({platformId:f.ids.newar,providers:['Streak A']});assert.equal(metric(r).member_count,0);
 await db.exec("delete from newar_detail_records where source_id='U-SUCCESS';update newar_detail_records set order_number='DUPLICATE' where created_at='2026-09-27T00:00+05:45'");
 r=await call({platformId:f.ids.newar});assert.equal(metric(r).member_count,null);assert.equal(metric(r).observed_member_count,0);assert.ok(r.coverage.orderSequenceUncertainCount>0);
 await db.query('update fixture_platforms set source=$1 where id=$2',['wg',f.ids.kp]);await assert.rejects(call({platformId:f.ids.kp}),/submission_source_unavailable/);
});
test('strict bounded input, stable pages and helper execute ACLs remain closed',async()=>{
 for(const bad of [{lookbackDays:31},{lookbackDays:'30'},{streakDays:3},{threshold:10},{charts:true},{amountBands:{}},{direction:'withdraw'},{providers:[7]},{currency:'USDT'},{offset:1},{operation:'streakMembers'},{operation:'streakMembers',streakDays:4},{operation:'streakMembers',streakDays:3,limit:1},{operation:'streakMembers',streakDays:3,memberId:5}])await assert.rejects(call(bad),/invalid_/);
 for(let i=0;i<22;i++)await seed('PAGE-'+String(i).padStart(2,'0'));
 const a=await details({limit:20}),b=await details({offset:20,limit:20});assert.equal(a.total,22);assert.equal(a.rows.length,20);assert.equal(b.rows.length,2);assert.equal(new Set([...a.rows,...b.rows].map(r=>r.member_id)).size,22);
 assert.equal((await details({memberId:'PAGE-03'})).rows[0].member_id,'PAGE-03');assert.equal((await details({memberId:'absent'})).total,0);
 assert.deepEqual(await metadata(),beforeMeta);
 const acl=(await db.query("select has_function_privilege('authenticated','private.dashboard_submission_streak_capture_day(jsonb,date,text[],text)','EXECUTE') a,has_function_privilege('anon','private.dashboard_submission_streak_capture_day(jsonb,date,text[],text)','EXECUTE') b,has_function_privilege('service_role','private.dashboard_submission_streak_capture_day(jsonb,date,text[],text)','EXECUTE') c")).rows[0];assert.deepEqual(acl,{a:false,b:false,c:false});
});
test('full-day lookback uses native calendar DST bounds and excludes unfinished current day',async()=>{
 await db.query("update fixture_platforms set timezone='America/New_York' where id=$1",[f.ids.ar]);
 const r=await call({startAt:'2026-03-08T00:00:00-05:00',endAt:'2026-03-09T00:00:00-04:00',lookbackDays:7});
 assert.equal(r.evaluatedStartDate,'2026-03-02');assert.equal(r.evaluatedEndDate,'2026-03-08');assert.equal((Date.parse(r.dayEnd)-Date.parse(r.dayStart))/3600000,167);
 await db.query("update fixture_platforms set timezone='Asia/Kolkata' where id=$1",[f.ids.ar]);
 const now=new Date(),future=new Date(now.getTime()+24*3600000),live=await call({startAt:now.toISOString(),endAt:future.toISOString(),lookbackDays:7});
 assert.equal(live.coverage.excludedPartialDayCount,1);assert.ok(Date.parse(live.dayEnd)<now.getTime());assert.equal(live.coverage.noRecordDayCount+live.coverage.coveredDayCount,7);assert.equal(live.coverage.sourceCompletenessVerified,false);
});

test('actor-creation lock follow-up is replay-safe and preserves exact original reader and job metadata',async()=>{
 const patch=read('supabase/migrations/20261004132610_submission_streak_job_creation_lock.sql');
 const current=async()=>(await db.query("select md5(prosrc) hash,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='private.dashboard_admin_live_submission_streak(jsonb)'::regprocedure")).rows[0];
 const before=await current();assert.equal(before.hash,'d154681ef237219a38343c4d3cc0b083');await db.exec(patch);assert.deepEqual(await current(),before);
 const original=(await db.query("select md5(prosrc) hash from pg_proc where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure")).rows[0];assert.equal(original.hash,'e710510ebd81f76fc9b83379c4b59f8c');
});
