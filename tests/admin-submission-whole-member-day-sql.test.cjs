// Reuse the reviewed predecessor setup; no production connection or real IDs.
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261001040000_submission_whole_member_day.sql'),'utf8');
const baseline=fs.readFileSync(path.join(__dirname,'admin-submission-analysis-sql.test.cjs'),'utf8').split(/\ntest\(/)[0];
let setup,db,f,baselineAcls;
const context=vm.createContext({__dirname,require:name=>name==='node:test'?{test(){},before:fn=>{setup=fn},after(){}}:name==='@electric-sql/pglite'&&process.env.PGLITE_PATH?require(process.env.PGLITE_PATH):require(name)});
vm.runInContext(baseline+'\nglobalThis.fixture={get db(){return db},call,request,as,ids,owner,viewer};',context);
const signatures="('private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure,'public.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure)";
const acls=async()=>(await db.query('select oid::regprocedure::text signature,proacl::text acl from pg_proc where oid in '+signatures+' order by 1')).rows;
const hashes=async()=>(await db.query('select oid::regprocedure::text signature,md5(prosrc) hash from pg_proc where oid in '+signatures+' order by 1')).rows;
const query=(extra={})=>f.request({startAt:'2026-10-25T00:00:00+05:30',endAt:'2026-10-26T00:00:00+05:30',...extra});
const call=extra=>f.call(query(extra));
const metric=(r,threshold=15,provider=null)=>r.metrics.find(x=>x.threshold===threshold&&x.provider===provider);
const total=r=>r.dashboard.monitoring.find(x=>x.provider===null);
async function seed(member,n,{day='2026-10-25',split=n,platform='AR-RAW',country='IN'}={}){
 await db.query(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel)
 select 'AR',$6,$5,'recharge',$1||'-'||$3||'-'||i,$1,i*10,'待支付',$3::date+time '10:00'+i*interval '1 second',case when i<=$4 then 'Whole A' else 'Whole B' end
 from generate_series(1,$2::int)i`,[member,n,day,split,platform,country]);
}
before(async()=>{await setup();f=context.fixture;db=f.db;baselineAcls=await acls();assert.equal((await hashes()).find(x=>x.signature.startsWith('private.')).hash,'96982df59a38fa6889a36634901ce94d');await db.exec(migration)});
beforeEach(async()=>{await f.as(f.owner);await db.exec('truncate ar_collected_orders')});
after(async()=>db?.close());

test('default strict 15 boundary counts every order only for 16 and 20, and all six thresholds are strict',async()=>{
 for(const n of [10,11,14,15,16,20,21,30,31,50,51,100,101])await seed('BOUNDARY-'+n,n);
 const r=await call();assert.equal(r.version,3);assert.equal(r.exemptCount,0);assert.equal(r.thresholdComparison,'gt');
 assert.equal(r.basis,'platform_local_day_all_providers_zero_success_whole_day_over_threshold');
 assert.equal(r.dashboard.version,3);assert.equal(r.dashboard.threshold,15);assert.equal(r.dashboard.thresholdComparison,'gt');assert.equal(r.dashboard.exemptCount,0);
 assert.equal(r.dashboard.frequency.reduce((n,x)=>n+x.count,0),metric(r,10).qualified_member_days);
 for(const threshold of [10,15,20,30,50,100]){
  const qualifying=[10,11,14,15,16,20,21,30,31,50,51,100,101].filter(n=>n>threshold),m=metric(r,threshold);
  assert.equal(m.member_count,qualifying.length);assert.equal(m.invalid_count,qualifying.reduce((a,b)=>a+b,0));
  const selected=await call({threshold,operation:'members'});
  assert.equal(selected.total,qualifying.length);assert.ok(selected.rows.every(x=>x.submitted_count>threshold&&x.invalid_count===x.submitted_count&&x.platform_day_invalid_count===x.submitted_count));
 }
 const selected=await call({operation:'members'});assert.ok(!selected.rows.some(x=>['BOUNDARY-14','BOUNDARY-15'].includes(x.member_id)));
 assert.equal(selected.rows.find(x=>x.member_id==='BOUNDARY-16').invalid_count,16);assert.equal(selected.rows.find(x=>x.member_id==='BOUNDARY-20').invalid_count,20);
});

test('14 plus 6 across providers counts the full 20; selected provider and clock retain only their actual orders and amounts',async()=>{
 await seed('SPLIT',20,{split:14});const r=await call();assert.equal(metric(r).invalid_count,20);assert.equal(metric(r).invalid_amount,'2100');
 assert.equal(metric(r,15,'Whole A').invalid_count,14);assert.equal(metric(r,15,'Whole B').invalid_count,6);
 const provider=await call({providers:['Whole A']});assert.equal(metric(provider).invalid_count,14);assert.equal(metric(provider).invalid_amount,'1050');
 const narrow={providers:['Whole A'],startAt:'2026-10-25T10:00:01+05:30',endAt:'2026-10-25T10:00:05+05:30'};
 const small=await call(narrow);assert.equal(metric(small).invalid_count,4);assert.equal(metric(small).invalid_amount,'100');
 const d=(await call({...narrow,operation:'members'})).rows[0];assert.equal(d.submitted_count,20);assert.equal(d.platform_day_invalid_count,20);
 assert.equal(d.platform_day_amount,'2100');assert.equal(d.platform_day_invalid_amount,'2100');assert.equal(d.selected_count,4);assert.equal(d.invalid_count,4);assert.equal(d.submitted_amount,'100');assert.equal(d.invalid_amount,'100');
});

test('one success excludes the whole member-day, including another provider, earlier creation and later completion',async()=>{
 for(const member of ['SAME-DAY','LATER','PRIOR','UNRELATED'])await seed(member,20,{split:19});
 await db.exec(`update ar_collected_orders set status='已支付',completed_at=case when member_id='LATER' then timestamp '2026-10-26 10:01' else timestamp '2026-10-25 10:01' end
 where member_id in ('SAME-DAY','LATER') and raw_channel='Whole B';
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,completed_at,raw_channel) values
 ('AR','IN','AR-RAW','recharge','PRIOR-PAID','PRIOR',100,'已支付','2026-10-24 10:00','2026-10-25 08:00','Other Pay'),
 ('AR','IN','AR-RAW','recharge','UNRELATED-NEXT-PAID','UNRELATED',100,'已支付','2026-10-26 10:00','2026-10-26 10:01','Other Pay');`);
 const r=await call({providers:['Whole A']});assert.equal(metric(r).member_count,1);assert.equal(metric(r).invalid_count,19);
 const d=await call({providers:['Whole A'],operation:'members'});assert.deepEqual(d.rows.map(x=>x.member_id),['UNRELATED']);
});

test('same ID never combines different dates or platforms to reach the threshold',async()=>{
 await seed('SHORT',10);await seed('SHORT',10,{day:'2026-10-26'});await seed('SHORT',10,{country:'BR'});
 await seed('VALID',16);await seed('VALID',20,{day:'2026-10-26'});
 const r=await call({endAt:'2026-10-27T00:00:00+05:30'});assert.equal(metric(r).invalid_count,36);assert.equal(metric(r).member_count,1);assert.equal(metric(r).member_days,2);
 await f.as(f.viewer);await assert.rejects(call({platformId:f.ids.hidden}),/platform_denied/);
});

test('summary, chart series, selected monetary totals and member details use the same full-day selection',async()=>{
 await seed('CHART',20,{split:14});await seed('SECOND',16,{day:'2026-10-26',split:8});
 const r=await call({endAt:'2026-10-27T00:00:00+05:30'}),m=metric(r),t=total(r);
 assert.equal(m.invalid_count,36);assert.equal(t.invalid_count,m.invalid_count);assert.equal(t.invalid_amount,m.invalid_amount);
 for(const key of ['hourly','amounts'])assert.equal(r.dashboard[key].reduce((n,x)=>n+x.count,0),m.invalid_count);
 assert.equal(r.dashboard.daily.reduce((n,x)=>n+x.invalid_count,0),m.invalid_count);
 assert.equal(r.dashboard.monitoring.filter(x=>x.provider!==null).reduce((n,x)=>n+x.invalid_count,0),m.invalid_count);
 const d=await call({endAt:'2026-10-27T00:00:00+05:30',operation:'members'});assert.equal(d.rows.reduce((n,x)=>n+x.invalid_count,0),m.invalid_count);
 assert.equal(d.rows.reduce((n,x)=>n+Number(x.invalid_amount),0),Number(m.invalid_amount));
 const absent=await call({providers:['ABSENT']});assert.equal(metric(absent).invalid_count,0);assert.equal(total(absent).order_count,0);
});

test('unknown status in another provider blocks that member-day and surfaces coverage, without tainting another member',async()=>{
 await seed('UNKNOWN',20,{split:19});await seed('GOOD',20,{split:19});
 await db.exec("update ar_collected_orders set status='unknown' where member_id='UNKNOWN' and raw_channel='Whole B'");
 const r=await call({providers:['Whole A']});assert.equal(r.coverage.unknownStatusCount,1);assert.equal(metric(r).invalid_count,19);assert.equal(metric(r).member_count,1);
});

test('missing member, blank or duplicate order IDs and missing dates keep the existing protection',async()=>{
 for(const member of ['MISSING-ID','BLANK-ORDER','MISSING-TIME','GOOD'])await seed(member,20);
 await db.exec(`update ar_collected_orders set member_id=null where member_id='MISSING-ID';
 update ar_collected_orders set order_no='' where member_id='BLANK-ORDER' and order_no='BLANK-ORDER-2026-10-25-1';
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel)
 values ('AR','IN','AR-RAW','recharge','MISSING-TIME-UNDATED','MISSING-TIME',100,'待支付',null,'Whole A');
 insert into newar_detail_records(platform,dataset,source_id,member_id,order_number,provider,currency,status_group,amount,created_at)
 select 'NEW-RAW','charge','DUP-'||i,'DUP','SAME-ORDER','Whole A','NPR','pending',100,'2026-10-25T10:00+05:45' from generate_series(1,20)i;`);
 const r=await call();assert.equal(r.coverage.missingMemberCount,20);assert.equal(r.coverage.orderSequenceUncertainCount,40);assert.equal(metric(r).invalid_count,20);
 const n=await call({platformId:f.ids.newar,startAt:'2026-10-25T00:00:00+05:45',endAt:'2026-10-26T00:00:00+05:45'});
 assert.equal(n.coverage.orderSequenceUncertainCount,20);assert.equal(metric(n).invalid_count,0);
});

test('missing amounts anywhere in a qualified full day remain unknown rather than preserving a fictitious exemption',async()=>{
 await seed('AMOUNT',20,{split:14});await db.exec("update ar_collected_orders set amount=null where order_no='AMOUNT-2026-10-25-1'");
 const all=await call();assert.equal(metric(all).invalid_count,20);assert.equal(metric(all).invalid_amount,null);assert.equal(total(all).invalid_amount,null);
 const selected=await call({providers:['Whole B'],operation:'members'}),d=selected.rows[0];assert.equal(d.platform_day_amount,null);assert.equal(d.platform_day_invalid_amount,null);assert.equal(d.invalid_count,6);assert.equal(d.invalid_amount,'1050');
});

test('native source local-day and launch boundaries remain enforced and WG is not added',async()=>{
 await db.exec(`insert into newar_detail_records(platform,dataset,source_id,member_id,order_number,provider,currency,status_group,amount,created_at)
 select 'NEW-RAW','charge','NATIVE-'||i,'NATIVE','NATIVE-'||i,'Whole A','NPR','pending',100,'2026-10-25T00:00+05:45' from generate_series(1,20)i;
 insert into lg_orders(source_system,country_code,platform,order_kind,order_no,member_id,metric_amount,status_class,created_at,third_party)
 select 'LG','PH','LG-RAW','recharge','WHOLE-LG-'||i,'NATIVE',100,'pending','2026-10-25T00:00+08','Whole A' from generate_series(1,20)i;
 insert into game66_charge_orders(platform_id,order_num,uid,create_time,status_code,pay_method_name,amount_display)
 select '${f.ids.game}','WHOLE-GAME-'||i,'NATIVE','2026-10-25T00:00+05:30','0','Whole A',100 from generate_series(1,20)i;`);
 for(const [platformId,zone] of [[f.ids.newar,'+05:45'],[f.ids.lg,'+08:00'],[f.ids.game,'+05:30']]){
  const r=await call({platformId,startAt:'2026-10-25T00:00:00'+zone,endAt:'2026-10-26T00:00:00'+zone});assert.equal(metric(r).invalid_count,20);assert.equal(metric(r).invalid_amount,'2000');
 }
 await db.exec(`insert into newar_detail_records(platform,dataset,source_id,member_id,order_number,provider,currency,status_group,amount,created_at)
 select 'NEW-RAW','charge','BEFORE-LAUNCH-'||i,'BEFORE-LAUNCH','BEFORE-LAUNCH-'||i,'Whole A','NPR','pending',100,'2026-09-24T10:00+05:45' from generate_series(1,20)i;`);
 const prelaunch=await call({platformId:f.ids.newar,startAt:'2026-09-24T00:00:00+05:45',endAt:'2026-09-25T00:00:00+05:45'});assert.equal(prelaunch.coverage.orderCount,0);assert.equal(metric(prelaunch).invalid_count,0);
 await db.query('update fixture_platforms set source=$1 where id=$2',['wg',f.ids.kp]);await assert.rejects(call({platformId:f.ids.kp}),/submission_source_unavailable/);
 await db.query('update fixture_platforms set source=$1 where id=$2',['kp',f.ids.kp]);
});

test('migration accepts only the reviewed predecessor or exact replay and retains production ACLs and settings',async()=>{
 const expected='e710510ebd81f76fc9b83379c4b59f8c';assert.equal((await hashes()).find(x=>x.signature.startsWith('private.')).hash,expected);assert.deepEqual(await acls(),baselineAcls);
 await db.exec(migration);assert.equal((await hashes()).find(x=>x.signature.startsWith('private.')).hash,expected);assert.deepEqual(await acls(),baselineAcls);
 const definition=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure) definition")).rows[0].definition;
 await db.exec(definition.replace('perform private.dashboard_admin_live_scope();','perform private.dashboard_admin_live_scope(); -- drift'));
 await assert.rejects(db.exec(migration),/submission_whole_day_definition_drift/);await db.exec('rollback;');await db.exec(definition);
 await db.exec('alter function private.dashboard_admin_live_submission_analysis(jsonb) set statement_timeout=1000');
 await assert.rejects(db.exec(migration),/submission_whole_day_definition_drift/);await db.exec('rollback;');await db.exec(definition);
 for(const [signature,role,grantable] of [['private.dashboard_admin_live_submission_analysis(jsonb)','anon',false],['private.dashboard_admin_live_submission_analysis(jsonb)','service_role',false],['public.dashboard_admin_live_submission_analysis(jsonb)','authenticated',true]]){
  await db.exec('grant execute on function '+signature+' to '+role+(grantable?' with grant option':''));
  await assert.rejects(db.exec(migration),/submission_whole_day_acl_drift/);await db.exec('rollback;');
  await db.exec((grantable?'revoke grant option for execute':'revoke execute')+' on function '+signature+' from '+role);
 }
 assert.deepEqual(await acls(),baselineAcls);await db.exec(migration);
 await db.exec('revoke execute on function public.dashboard_admin_live_submission_analysis(jsonb) from service_role');const reduced=await acls();await db.exec(migration);assert.deepEqual(await acls(),reduced);
 await db.exec('grant execute on function public.dashboard_admin_live_submission_analysis(jsonb) to service_role');assert.deepEqual(await acls(),baselineAcls);
});
