// Synthetic-only regression tests for confirmed manual blocking reasons.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const repo=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const baselineMigration=read('supabase/migrations/20261001061919_withdraw_manual_blocking_reasons.sql');
const migration=read('supabase/migrations/20261001064747_withdraw_manual_reason_coverage.sql');
let db,originalRejections,originalWgRejections,acl;
const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].value;
const call=extra=>scalar('select private.dashboard_admin_live_withdraw_reasons($1::jsonb) value',[JSON.stringify({country:'印度',platform:'AR-A',date:'2026-09-30',kind:'blocking',...extra})]);
const rejectKinds=['categories','rejection','operators','orders'];
const permissions=()=>db.query("select oid::regprocedure::text signature,proowner,prosecdef,proconfig,proacl::text from pg_proc where oid in('private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure,'private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb)'::regprocedure) order by signature").then(x=>x.rows);
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;
 create function private.dashboard_admin_live_scope() returns jsonb language sql stable as $$select '{}'::jsonb$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select $2 in('印度','IN') and $3 in('AR-A','SNAP-A','WG-A','WG-EMPTY')$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select upper($1)$$;
 create function private.dashboard_admin_live_platforms() returns table(name text,source_name text,country text,scope_group text,source text) language sql stable as $$values ('AR-A','AR-A','印度','IN','ar'),('SNAP-A','SNAP-A','印度','IN','panda')$$;
 create function private.dashboard_admin_wg_sites() returns table(country text,country_code text,platform text,site_code text,currency text,timezone text) language sql stable as $$values('印度','IN','WG-A','1','INR','Asia/Kolkata'),('印度','IN','WG-EMPTY','2','INR','Asia/Kolkata')$$;
 create function private.dashboard_admin_live_clean_note(text) returns text language sql immutable as $$select nullif(btrim($1),'')$$;
 create function private.dashboard_admin_live_blocking_details(text) returns jsonb language sql immutable as $$select jsonb_build_object('reason',$1)$$;
 create function private.dashboard_admin_live_blocking_category(text) returns text language sql immutable as $$select $1$$;
 create function private.dashboard_admin_live_rejection_category(text,text) returns text language sql immutable as $$select coalesce($2,'源备注为空')$$;
 create table ar_collected_orders(source_system text,country_code text,platform text,order_kind text,order_no text,amount numeric,status text,operator text,applied_at timestamp,completed_at timestamp,manual_remark text,remark text,raw_channel text,updated_at timestamptz default now());
 create table auto_withdraw_daily(country text,data_date date,platform text,total bigint,updated_at timestamptz);
 create table dashboard_platform_team_map(country_name text,country_code text,active boolean);
 create table withdraw_reasons_daily(country_code text,platform text,stat_date date,source_system text,snapshot jsonb,updated_at timestamptz);
 create view withdraw_reasons_daily_grouped as select * from withdraw_reasons_daily;
 create table wg_detail_coverage(site_code text,business text,basis text,business_date date,complete boolean);
 create table wg_withdraw_details(site_code text,order_number text,member_amount numeric,status_code integer,status_group text,created_at timestamptz,captured_at timestamptz,business_fields jsonb);
 insert into ar_collected_orders select 'AR','IN','AR-A','withdraw','HUMAN-'||n,100,case when n%2=0 then '已支付' else '未通过' end,'agent-a','2026-09-30 12:00','2026-09-30 12:01','同一拦截说明','驳回原文','',now() from generate_series(1,22)n;
 insert into ar_collected_orders select 'AR','IN','AR-A','withdraw','SYSTEM-'||n,100,'未通过',op,'2026-09-30 12:00',null,'同一拦截说明','驳回原文','',now() from unnest(array['system','System',' SYSTEM ',E'\\tSyStEm\\n']) with ordinality t(op,n);
 insert into ar_collected_orders select 'AR','IN','AR-A','withdraw','UNKNOWN-'||n,100,'未通过',op,'2026-09-30 12:00',null,'同一拦截说明','驳回原文','',now() from unnest(array[null::text,'',E' \\t\\n']) with ordinality t(op,n);
 insert into ar_collected_orders values('AR','IN','AR-A','withdraw','NAMED-SYSTEM-SUPPORT',100,'已支付','system_support','2026-09-30 12:00',null,'同一拦截说明',null,'',now()),('AR','IN','AR-A','withdraw','NO-REASON',100,'已支付','agent-a','2026-09-30 12:00',null,E' \\t\\n',null,'',now());
 insert into auto_withdraw_daily values('印度','2026-09-30','AR-A',31,now());
 insert into wg_detail_coverage values('1','withdraw','created','2026-09-30',true),('2','withdraw','created','2026-09-30',true);
 insert into wg_withdraw_details values
 ('1','WG-HUMAN-SUCCESS',100,4,'success','2026-09-30T05:00Z',now(),'{"operator_name":"alice","operator_class":"manual","interception_reason":"WG拦截"}'),
 ('1','WG-HUMAN-REJECT',100,7,'rejected','2026-09-30T05:00Z',now(),'{"operator_name":"bob","operator_class":"manual","interception_reason":"WG拦截","rejection_reason":"WG驳回"}'),
 ('1','WG-SYSTEM-MISCLASS',100,8,'forced','2026-09-30T05:00Z',now(),'{"operator_name":" System ","operator_class":"manual","interception_reason":"WG拦截"}'),
 ('1','WG-AUTO',100,4,'success','2026-09-30T05:00Z',now(),'{"operator_name":"auto-runner","operator_class":"auto","interception_reason":"WG拦截"}'),
 ('1','WG-UNKNOWN',100,1,'pending','2026-09-30T05:00Z',now(),'{"operator_class":"unknown","interception_reason":"WG拦截"}'),
 ('1','WG-EMPTY-OPERATOR',100,1,'pending','2026-09-30T05:00Z',now(),'{"operator_name":" ","operator_class":"manual","interception_reason":"WG拦截"}'),
 ('1','WG-HUMAN-NO-REASON',100,4,'success','2026-09-30T05:00Z',now(),'{"operator_name":"alice","operator_class":"manual","interception_reason":" "}'),
 ('1','WG-SYSTEM-NO-REASON',100,4,'success','2026-09-30T05:00Z',now(),'{"operator_name":"system","operator_class":"auto"}'),
 ('1','WG-UNKNOWN-NO-REASON',100,1,'pending','2026-09-30T05:00Z',now(),'{"operator_class":"unknown"}'),
 ('2','WG-ALL-SYSTEM',100,4,'success','2026-09-30T05:00Z',now(),'{"operator_name":"system","operator_class":"auto","interception_reason":"不该纳入"}');`);
 await db.exec(read('tests/fixtures/withdraw-blocking-manual-baseline.sql'));
 await db.exec(`revoke all on function private.dashboard_admin_live_withdraw_reasons(jsonb) from public,anon;grant execute on function private.dashboard_admin_live_withdraw_reasons(jsonb) to authenticated;revoke all on function private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb) from public,anon,authenticated;`);
 originalRejections=await Promise.all(rejectKinds.map(kind=>call({kind})));originalWgRejections=await Promise.all(rejectKinds.map(kind=>call({kind,platform:'WG-A'})));acl=await permissions();
 await db.exec(baselineMigration);await db.exec(migration);
});
after(async()=>{await db?.close()});

test('AR excludes every exact system spelling and unknown operator while retaining manual successes',async()=>{
 const result=await call();assert.equal(result.available,true);assert.equal(result.noteCount,23);assert.equal(result.total,1);assert.equal(result.rows[0].count,23);assert.equal(result.rows[0].success,12);assert.equal(result.rows[0].rejected,11);
 assert.deepEqual(result.summary.blockingCounts,{raw:30,manual:23,system:4,unknown:3});assert.equal(result.coverage.withManualRemark,23);assert.equal(result.coverage.collected,31);
 assert.deepEqual(result.summary.operatorCounts,{total:31,manual:24,system:4,unknown:3,manualWithReason:23,manualWithoutReason:1});
 const key=result.rows[0].reasonKey,variants=await call({kind:'blockingVariants',reasonKey:key}),first=await call({kind:'blockingOrders',reasonKey:key}),second=await call({kind:'blockingOrders',reasonKey:key,offset:20});
 for(const r of [variants,first,second]){assert.equal(r.noteCount,23);assert.deepEqual(r.summary.blockingCounts,result.summary.blockingCounts);assert.deepEqual(r.summary.operatorCounts,result.summary.operatorCounts)}
 assert.equal(variants.rows.reduce((n,r)=>n+r.count,0),23);assert.equal(first.total,23);assert.equal(first.rows.length,20);assert.equal(second.rows.length,3);
 const orders=[...first.rows,...second.rows];assert.equal(new Set(orders.map(r=>r.orderNumber)).size,23);assert(orders.some(r=>r.operator==='system_support'));assert(!orders.some(r=>r.orderNumber.startsWith('SYSTEM-')||r.orderNumber.startsWith('UNKNOWN-')));
 const query=await call({kind:'blockingOrders',reasonKey:key,query:'HUMAN-1'});assert.equal(query.noteCount,23);assert.equal(query.summary.selectedCount,11);assert.equal(query.total,11);
 assert.deepEqual(query.summary.operatorCounts,result.summary.operatorCounts);
});
test('rejection reasons, operators, and order results are exactly unchanged',async()=>{
 assert.deepEqual(await Promise.all(rejectKinds.map(kind=>call({kind}))),originalRejections);
 assert.deepEqual(await Promise.all(rejectKinds.map(kind=>call({kind,platform:'WG-A'}))),originalWgRejections);
});
test('WG manual class plus actual non-system operator is required, independent of final status',async()=>{
 const b=await call({platform:'WG-A'});assert.equal(b.noteCount,2);assert.deepEqual(b.summary.blockingCounts,{raw:6,manual:2,system:2,unknown:2});assert.equal(b.rows[0].count,2);assert.equal(b.rows[0].success,1);assert.equal(b.rows[0].rejected,1);assert.equal(b.coverage.withManualRemark,2);
 assert.deepEqual(b.summary.operatorCounts,{total:9,manual:3,system:3,unknown:3,manualWithReason:2,manualWithoutReason:1});
 for(const kind of ['blockingVariants','blockingOrders']){const d=await call({platform:'WG-A',kind,reasonKey:b.rows[0].reasonKey});assert.equal(d.noteCount,2);assert.deepEqual(d.summary.blockingCounts,b.summary.blockingCounts);assert.deepEqual(d.summary.operatorCounts,b.summary.operatorCounts)}
});
test('all-system WG returns a valid empty manual result without falling back to legacy snapshots',async()=>{
 const d=await call({platform:'WG-EMPTY'});assert.equal(d.available,true);assert.equal(d.total,0);assert.equal(d.noteCount,0);assert.deepEqual(d.rows,[]);assert.equal(d.snapshotFallback,false);assert.deepEqual(d.summary.blockingCounts,{raw:1,manual:0,system:1,unknown:0});assert.match(d.source,/WG 实时明细/);
 assert.deepEqual(d.summary.operatorCounts,{total:1,manual:0,system:1,unknown:0,manualWithReason:0,manualWithoutReason:0});
});
test('all-system AR retains collected coverage and cannot revive a legacy reason snapshot',async()=>{
 await db.exec('begin');try{
  await db.exec("insert into ar_collected_orders values('AR','IN','AR-A','withdraw','AR-ALL-SYSTEM',100,'已支付','system','2026-09-29 12:00',null,'系统说明',null,'',now());insert into withdraw_reasons_daily values('IN','AR-A','2026-09-29','AR','{\"note_field\":\"source_note\",\"groups\":[{\"reason_label\":\"旧人工说明\",\"operator_class\":\"manual\",\"count\":100,\"success\":100,\"reject\":0,\"other\":0}]}',now())");
  const d=await call({date:'2026-09-29'});assert.equal(d.available,true);assert.equal(d.noteCount,0);assert.equal(d.total,0);assert.deepEqual(d.rows,[]);assert.equal(d.source,'AR 已采集订单');assert.equal(d.coverage.collected,1);assert.deepEqual(d.summary.blockingCounts,{raw:1,manual:0,system:1,unknown:0});
 }finally{await db.exec('rollback')}
});
test('snapshots count only manual nonempty classifications and preserve source snapshots',async()=>{
 const snapshot={note_field:'source_note',totals:{reject:3},coverage:{unique_count:49},groups:[
  {reason_label:'规则A',count:7,success:4,reject:2,other:1,operator_class:'manual',classification:'template'},
  {reason_label:'规则A',count:3,success:0,reject:1,other:2,operator_class:'unknown',classification:'template'},
  {reason_label:'规则A',count:20,success:20,reject:0,other:0,operator_class:'auto',classification:'template'},
  {reason_label:'未填写备注',count:19,success:19,reject:0,other:0,operator_class:'manual',classification:'empty'}]};
 await db.query("insert into withdraw_reasons_daily values('IN','SNAP-A','2026-09-30','PANDA',$1,now())",[JSON.stringify(snapshot)]);
 const b=await call({platform:'SNAP-A'});assert.equal(b.noteCount,7);assert.equal(b.total,1);assert.equal(b.rows[0].count,7);assert.equal(b.canViewBlockingOrders,false);assert.deepEqual(b.summary.blockingCounts,{raw:30,manual:7,system:20,unknown:3});assert.equal(b.summary.operatorBasis,'snapshot_classification');
 assert.deepEqual(b.summary.operatorCounts,{total:null,manual:null,system:null,unknown:null,manualWithReason:7,manualWithoutReason:null});
 const variants=await call({platform:'SNAP-A',kind:'blockingVariants',reasonKey:b.rows[0].reasonKey});assert.equal(variants.noteCount,7);assert.deepEqual(variants.summary.blockingCounts,b.summary.blockingCounts);assert.deepEqual(variants.summary.operatorCounts,b.summary.operatorCounts);
 assert.deepEqual(await scalar("select snapshot value from withdraw_reasons_daily where platform='SNAP-A'"),snapshot);
});
test('idempotent migration preserves WG dispatch, privileges and scope protection',async()=>{
 assert.deepEqual(await permissions(),acl);const before=await call();await db.exec(migration);assert.deepEqual(await call(),before);assert.deepEqual(await permissions(),acl);
 await assert.rejects(()=>call({platform:'FOREIGN'}),/scope_denied/);
 assert.match(await scalar("select prosrc value from pg_proc where oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure"),/wg_existing_reasons_v1/);
});
test('synthetic 6188-order scope separates all 4271 manual orders into 2868 with reason and 1403 without',async()=>{
 await db.exec('begin');try{
  await db.exec(`insert into ar_collected_orders select 'AR','IN','AR-A','withdraw','SYNTHETIC-COUNT-'||n,100,'已支付',case when n<=4271 then 'synthetic-agent' else 'system' end,'2026-09-28 12:00',null,case when n<=2868 or n>4271 then '合成说明' when n%2=0 then null else E' \\t\\n' end,null,'',now() from generate_series(1,6188)n`);
  const d=await call({date:'2026-09-28'});assert.equal(d.noteCount,2868);assert.equal(d.rows[0].count,2868);assert.deepEqual(d.summary.operatorCounts,{total:6188,manual:4271,system:1917,unknown:0,manualWithReason:2868,manualWithoutReason:1403});assert.equal(d.total,1);
 }finally{await db.exec('rollback')}
});
test('observed empty WG detail scope returns known zero totals, distinct from snapshot unknown',async()=>{
 await db.exec('begin');try{
  await db.exec("insert into wg_detail_coverage values('2','withdraw','created','2026-09-29',true)");
  const d=await call({platform:'WG-EMPTY',date:'2026-09-29'});assert.equal(d.available,true);assert.deepEqual(d.summary.operatorCounts,{total:0,manual:0,system:0,unknown:0,manualWithReason:0,manualWithoutReason:0});assert.equal(d.noteCount,0);
 }finally{await db.exec('rollback')}
});
test('migration rejects an unreviewed definition before replacing it',async()=>{
 await db.exec('begin');try{await db.exec("create or replace function private.dashboard_admin_wg_withdraw_reasons(p_request jsonb,p_scope jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$begin return null;end$$");await assert.rejects(()=>db.exec(migration),/baseline changed/)}finally{await db.exec('rollback')}
});
