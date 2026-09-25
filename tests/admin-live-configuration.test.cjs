// Synthetic Postgres only: these tests never connect to production.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');const {PGlite}=require('@electric-sql/pglite');
const sql=name=>fs.readFileSync(path.join(__dirname,'../supabase',name),'utf8');
const owner='10000000-0000-0000-0000-000000000001',admin='10000000-0000-0000-0000-000000000002',viewer='10000000-0000-0000-0000-000000000003';
const sourceFixture=fs.readFileSync(path.join(__dirname,'uploaded-order-sources.test.cjs'),'utf8').split('\n').filter(x=>/^ create (table (game66_platforms|game66_charge_orders|game66_withdraw_orders|ar_config_targets|ar_collected_orders|newar_detail_platforms|newar_detail_records)\(|index (game66_charge_time_idx|game66_withdraw_time_idx|ar_collected_orders_applied_idx))/.test(x)).join('\n');
let db;const as=uid=>db.query("select set_config('test.uid',$1,false)",[uid]);
const call=async(name,request={})=>(await db.query('select public.dashboard_admin_live_'+name+'($1::jsonb) data',[JSON.stringify(request)])).rows[0].data;
const query=(id,extra={})=>({action:'aggregate',platformId:id,startAt:'2026-09-22T18:30:00.000Z',endAt:'2026-09-23T18:30:00.000Z',direction:'all',status:'all',...extra});
const autoReq=extra=>({startAt:'2026-09-23T00:00:00.000Z',endAt:'2026-09-23T23:59:59.000Z',country:'印度',...extra});
before(async()=>{
 db=new PGlite();await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;create role service_role;grant usage on schema auth,private to authenticated;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table dashboard_profiles(auth_user_id uuid primary key,username text,role text,active boolean,data_scope jsonb,permissions jsonb);
 create function public.dashboard_has_permission(name text) returns boolean language sql stable security definer as $$select coalesce((select active and (role='owner' or coalesce((permissions->>name)::boolean,true)) from public.dashboard_profiles where auth_user_id=auth.uid()),false)$$;
 create table dashboard_admin_preview_grants(auth_user_id uuid primary key,can_view boolean);
 create function private.dashboard_current_data_scope() returns jsonb language sql stable security definer as $$select data_scope from public.dashboard_profiles where auth_user_id=auth.uid() and active$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select coalesce($1->>'mode'='all' or ($1->'countries' ? case $2 when 'IN' then '印度' when 'NP' then '尼泊尔' else $2 end and (not($1 ? 'platforms') or $1->'platforms' ? $3)),false)$$;
 ${sourceFixture}
 alter table game66_charge_orders add column status_group text;
 alter table game66_withdraw_orders add column auto_commit text,add column submit_time timestamptz,add column audit_admin text,add column lock_admin text,add column lock_user_admin text;
 alter table ar_collected_orders add column operator text,add column manual_remark text,add column remark text;
 create table third_party_volume(country text,platform text,raw_channel text,channel text,direction text,count bigint,data_date date,updated_at timestamptz);
 create table dashboard_platform_team_map(id uuid primary key default gen_random_uuid(),team_name text,system_name text,source_system text,country_name text,country_code text,source_country text,platform_name text,source_platform text,active boolean default true,metadata jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now(),unique(source_system,source_country,source_platform));
 create table workorder_deposit_daily(stat_date date,country_code text,country text,platform text,third_party text,channel_type text,source_system text,submitted_count bigint,submitted_amount numeric,success_count bigint,success_amount numeric,withdraw_not_received_count bigint,withdraw_not_received_amount numeric,withdraw_success_count bigint,withdraw_success_amount numeric,source_updated_at timestamptz default now(),updated_at timestamptz default now());
 create table auto_withdraw_daily(data_date date,country text,platform text,total bigint,success bigint,rejected bigint,auto_count bigint,manual_count bigint,avg_seconds numeric,avg_time_text text,source_updated_at timestamptz,updated_at timestamptz);
 create table withdraw_operator_daily(data_date date,country text,platform text,account text,processed bigint,rejected bigint,avg_seconds numeric,avg_time_text text,source_updated_at timestamptz,updated_at timestamptz);
 create table newar_business_snapshots(kind text,platform text,country_code text,country text,stat_date date,direction text,captured_at timestamptz,payload jsonb,updated_at timestamptz);
 create table withdraw_reasons_daily(source_system text,country_code text,platform text,stat_date date,snapshot jsonb,updated_at timestamptz);
 create view withdraw_reasons_daily_grouped as select * from withdraw_reasons_daily;
 insert into dashboard_profiles values('${owner}','owner','owner',true,'{"mode":"all"}','{}'),('${admin}','editor','admin',true,'{"mode":"selected","countries":["印度"]}','{}'),('${viewer}','reader','viewer',true,'{"mode":"selected","countries":["印度"]}','{}');
 insert into dashboard_admin_preview_grants values('${admin}',true),('${viewer}',true);
 insert into dashboard_platform_team_map(team_name,system_name,source_system,country_name,country_code,source_country,platform_name,source_platform) values('M8','AR系统','AR','印度','IN','印度','EXAMPLE','EXAMPLE'),('M9','新AR','NEW_AR','尼泊尔','NP','尼泊尔','NEW','NEW');
 insert into third_party_volume values('印度','EXAMPLE','raw-a','PayA','代收',100,'2026-09-23',now()),('印度','EXAMPLE','raw-b','PayA','代付',50,'2026-09-23',now()),('印度','EXAMPLE','','','代付',3,'2026-09-23',now()),('印度','EXAMPLE','conflict','X','代收',1,'2026-09-23',now()),('印度','EXAMPLE','conflict','Y','代收',1,'2026-09-23',now()),('尼泊尔','NEW','private','HiddenPay','代收',9,'2026-09-23',now()),('印度','UNMAPPED','u','U','代收',1,'2026-09-23',now());
 insert into ar_config_targets values('IN','EXAMPLE','印度','Asia/Kolkata','INR','AR');
 insert into newar_detail_platforms values('NEW','NP','尼泊尔','Asia/Kathmandu','NPR',true,null);
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,amount,status,applied_at,completed_at,raw_channel,manual_remark,remark,operator) values
 ('AR','IN','EXAMPLE','recharge','C1',100,'已支付','2026-09-23 00:00','2026-09-23 00:05','raw-a',null,null,null),
 ('AR','IN','EXAMPLE','recharge','C2',200,'已支付','2026-09-22 23:00','2026-09-23 00:30','raw-a',null,null,null),
 ('AR','IN','EXAMPLE','withdraw','R1',50,'未通过','2026-09-23 01:00','2026-09-23 01:02','raw-b','未满足自动出款规则','Gift code policy','operator-1'),
 ('AR','IN','EXAMPLE','withdraw','R2',70,'未通过','2026-09-23 01:01','2026-09-23 01:03','raw-b','未满足自动出款规则',null,'operator-1');
 insert into newar_detail_records(platform,dataset,source_id,order_number,provider,currency,amount,status_code,status_group,created_at,success_at) values('NEW','charge','N1','N1','private','NPR',90,'1','success','2026-09-23T10:00:00+05:45','2026-09-23T10:05:00+05:45');
 insert into workorder_deposit_daily select '2026-09-23','IN','印度','EXAMPLE','raw-a','TYPE-'||i,'AR_WORKORDER',2,100,1,50,2,100,1,50,now(),now() from generate_series(1,25)i;
 insert into auto_withdraw_daily values('2026-09-22','印度','EXAMPLE',8,6,2,3,5,60,null,now(),now()),('2026-09-23','印度','EXAMPLE',10,8,2,4,5,90,null,now(),now()),('2026-09-23','印度','DhaniWin',9999,9999,0,9999,0,1,null,now(),now()),('2026-09-23','尼泊尔','SECRET',9999,9999,0,9999,0,1,null,now(),now());
 insert into withdraw_operator_daily values('2026-09-23','印度','EXAMPLE','operator-1',5,2,40,null,now(),now()),('2026-09-22','印度','EXAMPLE','operator-1',4,1,20,null,now(),now()),('2026-09-23','印度','DhaniWin','old-operator',9999,0,1,null,now(),now());
 insert into newar_business_snapshots values('auto_withdraw_bundle','DhaniWin','IN','印度','2026-09-23','all',now(),'{"rows":[{"total_count":20,"success_count":18,"reject_count":2,"auto_count":10,"manual_count":10,"total_handle_seconds":2000,"handle_count":20}],"operator_rows":[{"operator":"new-operator","processed_count":10,"reject_count":2,"total_handle_seconds":800,"handle_count":10}]}',now());`);
 await db.exec(sql('migrations/20260910061510_auto_withdraw_daily_notes.sql'));
 await db.exec(sql('migrations/20260910062211_allow_historical_auto_withdraw_notes.sql'));
 await db.exec(sql('admin-live-query.sql'));
 await db.exec(sql('admin-live-provider-aliases.sql'));
 await db.exec(sql('admin-live-platform-catalog-map.sql'));
 await db.exec(sql('admin-live-configuration.sql').split("select cron.schedule")[0]);
 await db.exec(sql('admin-live-configuration-platforms.sql'));
 await db.exec(sql('admin-live-configuration-query.sql'));
 await db.exec(sql('admin-live-provider-filter-normalization.sql'));
 await db.exec(sql('admin-live-configuration-workorders.sql'));
 await db.exec(sql('admin-live-withdraw-pages.sql'));
 await db.exec(sql('admin-live-withdraw-templates.sql'));
 await db.exec(sql('admin-live-withdraw-reasons.sql'));
 await db.exec(sql('admin-live-withdraw-notes.sql'));
 await db.exec(sql('admin-live-deposit-issues.sql'));
 await as(owner);
});
after(async()=>{await db?.close()});
test('confirmed provider aliases merge both directions and existing configuration before registry refresh',async()=>{
 await as(owner);await db.exec('begin');try{
  const pairs=[['LKgoPayINR','LKgoPay'],['LKgoPay','LKgoPay'],['PAYTM- RAPay','RAPay'],['PAYTM – RAPay','RAPay'],['RAPay','RAPay'],['VstarPay','VstarPay'],['VstarPayINR-Bank','VstarPay'],['UmoneyPay','UmoneyPay'],['UmoneyPayINR','UmoneyPay'],['MovPayINR-Bank','MovPay'],['MovPay','MovPay'],['FFPayINR','FFPay'],['FFPay','FFPay'],['UniPayUSDTCU','UniPayUSDT'],['UniPayUSDT','UniPayUSDT'],['CedarPayINR-wake','CedarPay'],['CedarPay-QR','CedarPay'],['WandaPay','WandaPay'],['WandaPay-QR','WandaPay'],['TimiPay','TimiPay'],['TimiPay-QR','TimiPay'],['Intnet','Intnet'],['Intnet-QR','Intnet'],['TyPay3','TyPay3'],['QR-TyPay3','TyPay3']];
  // Simulate a historical registry built before the aliases were confirmed.
  await db.exec("create or replace function private.dashboard_admin_live_provider_alias(p_country text,p_name text) returns text language sql immutable set search_path='' as $$select p_name$$");
  for(const [name] of pairs)for(const direction of ['代收','代付'])await db.query("insert into third_party_volume values('印度','EXAMPLE',$1,$1,$2,1,'2026-09-23',now())",[name,direction]);
  await db.exec("insert into third_party_volume values('印度','EXAMPLE','historical-route','UmoneyPay','代收',1,'2026-09-23',now()),('印度','EXAMPLE','historical-route','UmoneyPayINR','代付',1,'2026-09-23',now());refresh materialized view private.dashboard_admin_provider_registry");
  await db.exec(sql('admin-live-provider-aliases.sql').replace(/^begin;$/m,'').replace(/^commit;$/m,''));
  for(const [name,expected] of pairs){
   assert.equal((await db.query('select private.dashboard_admin_live_provider_alias($1,$2) name',['印度',name])).rows[0].name,expected);
   assert.equal((await db.query('select private.dashboard_admin_live_provider_canonical($1,$2,$3) name',['印度','EXAMPLE',name])).rows[0].name,expected);
   assert.equal((await db.query('select private.dashboard_admin_live_workorder_provider($1,$2,$3,$4) name',['印度','EXAMPLE',name,''])).rows[0].name,expected);
   const config=(await call('provider_config',{country:'印度',platform:'EXAMPLE',rawProvider:name,limit:500})).rows.find(r=>r.rawProvider===name);
   assert.equal(config.canonicalProvider,expected);assert.equal(config.status,'assigned');assert.deepEqual(config.directions,['代付','代收']);
  }
  const historical=(await call('provider_config',{country:'印度',rawProvider:'historical-route'})).rows[0];assert.equal(historical.status,'assigned');assert.equal(historical.canonicalProvider,'UmoneyPay');assert.deepEqual(historical.canonicalProviders,['UmoneyPay']);
  const id=(await call('query',{action:'catalog'})).platforms.find(p=>p.name==='EXAMPLE').id;
  for(const direction of ['all','charge','withdraw']){
   const options=(await call('provider_options',{platformIds:[id],direction})).providers;
   for(const [name,expected]of pairs){assert(options.includes(expected));if(name!==expected)assert(!options.includes(name));}
  }
  assert.equal((await db.query('select private.dashboard_admin_live_provider_alias($1,$2) name',['尼泊尔','PAYTM- RAPay'])).rows[0].name,'PAYTM- RAPay');
 }finally{await db.exec('rollback')}
});
test('no-provider failed and cancelled withdrawals are rejected with operators and unduplicated original notes',async()=>{
 await as(owner);await db.exec('begin');try{
  const raw='[Resubmit Order] Bank...\n \n[Resubmit Order] Bank information incomplete.';
  for(const [i,status,provider] of [[1,'失败',''],[2,'人工取消','人工取消'],[3,'未通过',''],[4,'失败','Actual Provider']]){
   await db.query("insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,amount,status,applied_at,raw_channel,operator,manual_remark,remark) values('AR','IN','EXAMPLE','withdraw',$1,100,$2,'2026-09-20 12:00',$3,'SYNTHETIC-OPERATOR','检查备注...\n检查备注完整内容',$4)",['NO-PROVIDER-'+i,status,provider,raw]);
  }
  const id=(await call('query',{action:'catalog'})).platforms.find(p=>p.name==='EXAMPLE').id;
  const r=await call('query',query(id,{startAt:'2026-09-19T18:30:00Z',endAt:'2026-09-20T18:30:00Z'}));
  assert.equal(r.summary[0].all_count,4);assert.equal(r.summary[0].rejected_count,3);assert.equal(r.summary[0].rejected_amount,'300');assert.equal(r.summary[0].failed_count,1);
  assert.equal(r.groups.provider.find(x=>x.provider==='无三方（驳回）').all_count,3);assert(!r.groups.provider.some(x=>x.provider==='未识别通道'));
  const q={date:'2026-09-20',country:'印度',platform:'EXAMPLE'};
  const reasons=await call('withdraw_reasons',{...q,kind:'rejection'});assert.equal(reasons.total,1);assert.equal(reasons.noteCount,3);assert.equal(reasons.rows[0].reason,'[Resubmit Order] Bank information incomplete.');assert.equal(reasons.rows[0].count,3);
  const orders=await call('withdraw_reasons',{...q,kind:'orders'});assert.equal(orders.total,3);assert(orders.rows.every(x=>x.operator==='SYNTHETIC-OPERATOR'&&x.rawRejectionReason===raw));
  assert(orders.rows.every(x=>x.manualRemark==='检查备注完整内容'));
  const distinct='第一行\n第二行\n不同补充说明';assert.equal((await db.query('select private.dashboard_admin_live_clean_note($1) value',[distinct])).rows[0].value,distinct);
 }finally{await db.exec('rollback')}
});
test('deposit totals use explicit source status, preserve source dates and details, and remain authorization-scoped',async()=>{
 await as(owner);await db.exec('begin');try{
  for(const [i,country,platform,status,amount,days,date] of [[1,'印度','EXAMPLE','未入款',100,2,'2026-09-23'],[2,'印度','EXAMPLE','已入款',900,99,'2026-09-23'],[3,'印度','EXAMPLE',null,300,7,'2026-09-23'],[4,'印度','EXAMPLE','未入款',400,10,'2026-09-22'],[5,'尼泊尔','NEW','未入款',800,4,'2026-09-23']]){
   await db.query("insert into admin_deposit_issue_rows(id,source_sheet,source_row,platform,country,order_number,utr,provider,amount,status,unreceived_days,record_date,provider_reply,utr_match,kyc_correct) values($1,'synthetic-sheet',$2,$3,$4,$5,'00001234','Synthetic Provider',$6,$7,$8,$9,'成功 2026-09-24','一致','正确')",['SHEET-'+i,i,platform,country,'SYNTHETIC-ORDER-'+i,amount,status,days,date]);
  }
  const q={startAt:'2026-09-23T00:00:00Z',endAt:'2026-09-23T23:59:59Z',country:'印度'};
  const r=await call('deposit_issues',q);assert.equal(r.total,3);assert.equal(r.summary.unreceivedAmount,100);assert.equal(r.summary.unreceivedCount,1);assert.equal(r.summary.receivedCount,1);assert.equal(r.summary.receivedAmount,900);assert.equal(r.summary.maxUnreceivedDays,2);assert.equal(r.summary.unresolvedStatusCount,1);
  const received=r.rows.find(x=>x.status==='已入款');assert.equal(received.unreceivedDays,99);assert.equal(received.recordDate,'2026-09-23');assert.equal(received.utr,'00001234');assert.equal(received.providerReply,'成功 2026-09-24');assert.equal(received.utrMatch,'一致');assert.equal(received.kycCorrect,'正确');
  assert.equal((await call('deposit_issues',{...q,status:'待核对'})).total,1);
  await as(viewer);const visible=await call('deposit_issues',{startAt:q.startAt,endAt:q.endAt});assert.equal(visible.total,3);assert(!visible.rows.some(x=>x.country==='尼泊尔'));
 }finally{await db.exec('rollback');await as(owner)}
 await db.exec('set role authenticated');try{await assert.rejects(()=>db.query('select * from admin_deposit_issue_rows'),/permission denied/)}finally{await db.exec('reset role')}
});
test('deposit result statistics and entry linkage use exact scoped orders, retain conflicts and search both original replies',async()=>{
 await as(owner);await db.exec('begin');try{
  for(const [id,order,utr,amount,status,date,match] of [
   ['a','A','0001',100,'未入款','2026-09-23','对得上'],['b','B','0002',200,'已入款','2026-09-23','对不上'],
   ['c','C','0003',300,'未入款',null,'对得上'],['d','D','0004',400,'未入款','2026-09-22','对不上'],
   ['e','E','0005',500,'未入款','2026-09-23','对得上']]){
   await db.query("insert into admin_deposit_issue_rows(id,source_sheet,source_row,country,platform,order_number,utr,amount,provider,status,record_date,match_status,unreceived_days,provider_reply) values($1,'synthetic',ascii($1),'印度','EXAMPLE',$2,$3,$4,'UmoneyPayINR',$5,$6,$7,12,'original result reply')",[id,order,utr,amount,status,date,match]);
  }
  for(const [id,platform,order,utr,amount,followup] of [
   ['f','EXAMPLE','A','0001',100,'Need to provide PDF/VIDEO'],['g','EXAMPLE','B','9999',200,'Success'],
   ['h','EXAMPLE','C','0003',300,'Success To Other Platform'],['i','EXAMPLE','C','0003',300,'REFUND'],
   ['j','OTHER','D','0004',400,'Success'],['k','EXAMPLE','E','0005',900,'Success'],['l','EXAMPLE','L','0007',500,'']]){
   await db.query("insert into admin_deposit_followup_rows(id,source_sheet,source_tab,source_row,country,platform,order_number,utr,amount,provider,followup_status,followup_date,provider_reply) values($1,'synthetic-entry',$2,ascii($1),'印度',$2,$3,$4,$5,'UmoneyPay',$6,'2026-09-23','unique follow-up reply')",[id,platform,order,utr,amount,followup]);
  }
  const q={startAt:'2026-09-23T00:00:00Z',endAt:'2026-09-23T23:59:59Z',country:'印度',platform:'EXAMPLE',dateMode:'all'};
  const r=await call('deposit_issues',q);assert.equal(r.total,5);assert.equal(r.summary.unreceivedAmount,1300);assert.equal(r.summary.receivedAmount,200);assert.equal(r.summary.undatedCount,1);assert.equal(r.summary.linkedCount,1);assert.equal(r.summary.reviewCount,3);assert.equal(r.summary.unlinkedCount,1);
  assert.equal(r.providerSummary.reduce((n,x)=>n+x.unreceivedAmount,0),1300);assert.equal(r.dailySummary.reduce((n,x)=>n+x.count,0),5);assert(r.rows.every(x=>x.provider==='UmoneyPay'));assert.equal(r.rows.find(x=>x.orderNumber==='D').linkStatus,'unlinked');
  assert.equal((await call('deposit_issues',{...q,query:'unique follow-up'})).total,1);assert.equal((await call('deposit_issues',{...q,query:'original result'})).total,5);
  assert.equal((await call('deposit_issues',{...q,dateMode:'range'})).total,3);assert.equal((await call('deposit_issues',{...q,match:'unmatched'})).total,2);
  const entries=await call('deposit_issues',{...q,view:'entries'});assert.equal(entries.total,6);assert.equal(entries.summary.count,6);assert.equal(entries.summary.evidenceCount,1);assert.equal(entries.rows.find(x=>x.orderNumber==='B').status,'待核对');assert.equal(entries.rows.find(x=>x.orderNumber==='C').linkStatus,'review');assert.equal(entries.rows.find(x=>x.orderNumber==='E').linkStatus,'review');assert.equal(entries.rows.find(x=>x.orderNumber==='L').linkStatus,'unlinked');
  assert.equal((await call('deposit_issues',{...q,view:'entries',followupStatus:'未填写'})).total,1);assert.equal((await call('deposit_issues',{...q,view:'entries',followupStatus:'success to other platform'})).total,1);
  await db.query("update dashboard_profiles set data_scope=$1::jsonb where auth_user_id=$2",[JSON.stringify({mode:'selected',countries:['印度'],platforms:['EXAMPLE']}),viewer]);await as(viewer);
  assert.equal((await call('deposit_issues',{...q,platform:undefined,view:'entries'})).total,6);
 }finally{await db.exec('rollback');await as(owner)}
 await db.exec('set role authenticated');try{await assert.rejects(()=>db.query('select * from admin_deposit_followup_rows'),/permission denied/)}finally{await db.exec('reset role')}
});
test('registry preserves historical mappings, conflicts, blanks and authorized options without live aggregate',async()=>{
 await as(viewer);const r=await call('provider_config',{country:'印度'});assert.equal(r.canManage,false);assert.equal(r.total,5);assert.equal(r.summary.conflict,1);assert.equal(r.summary.unassigned,1);assert(!JSON.stringify(r).includes('HiddenPay'));
 const catalog=await call('query',{action:'catalog'}),id=catalog.platforms.find(p=>p.name==='EXAMPLE').id;
 assert.deepEqual((await call('provider_options',{platformIds:[id]})).providers,['PayA','conflict','未识别通道']);
});
test('provider filters include approved raw aliases even before the volume mapping refresh',async()=>{
 await as(owner);await db.exec('begin');try{
  await db.query("insert into third_party_volume values('印度','EXAMPLE','Phonepe_QR','Phonepe_QR','代收',2,'2026-09-23',now()),('印度','EXAMPLE','UPI-QR','UPI-QR','代收',1,'2026-09-23',now())");
  await db.query("insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,amount,status,applied_at,completed_at,raw_channel) values('AR','IN','EXAMPLE','recharge','PHONEPE-1',100,'已支付','2026-09-23 01:00','2026-09-23 01:05','Phonepe_QR'),('AR','IN','EXAMPLE','recharge','UPI-1',200,'已支付','2026-09-23 02:00','2026-09-23 02:05','UPI-QR')");
  await db.exec('refresh materialized view private.dashboard_admin_provider_registry');
  const id=(await call('query',{action:'catalog'})).platforms.find(p=>p.name==='EXAMPLE').id;
  const r=await call('query',query(id,{providers:['UPI-QR']}));
  const row=r.groups.provider.find(x=>x.provider==='UPI-QR'&&x.direction==='charge');
  assert(row);assert.equal(row.all_count,2);assert.equal(row.created_success_count,2);assert.equal(row.success_count,2);assert.equal(Number(row.success_amount),300);
 }finally{await db.exec('rollback')}
});
test('write authorization is explicit, viewer stays read only, stale edits conflict and grants revoke immediately',async()=>{
 await as(admin);let row=(await call('provider_config',{country:'印度',rawProvider:'raw-a'})).rows[0];const write={operation:'provider',country:row.country,platform:row.platform,rawProvider:row.rawProvider,canonicalProvider:'EditedPay',expectedVersion:row.version};
 await assert.rejects(()=>call('configuration_write',write),/configuration_denied/);
 await as(owner);await call('configuration_write',{operation:'grant',userId:admin,canManage:true});await as(admin);await call('configuration_write',write);
 await assert.rejects(()=>call('configuration_write',write),/configuration_conflict/);
 const edited=(await call('provider_config',{country:'印度',rawProvider:'raw-a'})).rows[0];assert.equal(edited.canonicalProvider,'EditedPay');assert.equal(edited.manual,true);
 await assert.rejects(()=>call('configuration_write',{...write,country:'尼泊尔',platform:'NEW',rawProvider:'private'}),/scope_denied/);
 await assert.rejects(()=>call('configuration_write',{operation:'grant',userId:admin,canManage:false}),/configuration_denied/);
 await as(viewer);await assert.rejects(()=>call('configuration_write',{...write,expectedVersion:edited.version}),/configuration_denied/);
 await as(owner);await call('configuration_write',{operation:'grant',userId:admin,canManage:false});await as(admin);await assert.rejects(()=>call('configuration_write',{...write,expectedVersion:edited.version}),/configuration_denied/);
 await as(owner);const saved=(await db.query("select channel from third_party_volume where raw_channel='raw-a'")).rows[0];assert.equal(saved.channel,'PayA','old dashboard history was not rewritten');
});
test('team/platform changes update the catalog while preserving physical source and country',async()=>{
 await as(owner);const row=(await call('platform_assignments',{platform:'NEW'})).rows[0];const req={operation:'platform',mappingId:row.id,team:'NEW TEAM',system:'新AR',sourceSystem:row.sourceSystem,country:row.country,countryCode:row.countryCode,sourceCountry:row.sourceCountry,sourcePlatform:row.sourcePlatform,platformName:'RENAMED',expectedVersion:row.version};
 await call('configuration_write',req);const p=(await call('query',{action:'catalog'})).platforms.find(p=>p.sourceName==='NEW');assert.equal(p.name,'RENAMED');assert.equal(p.team,'NEW TEAM');
 assert.equal((await call('query',query(p.id))).total,1,'renaming a display label does not change the raw source predicate');
 await assert.rejects(()=>call('configuration_write',req),/configuration_conflict/);
 const current=(await call('platform_assignments',{platform:'RENAMED'})).rows[0];await assert.rejects(()=>call('configuration_write',{...req,expectedVersion:current.version,country:'印度',countryCode:'IN'}),/invalid_classification/);
});
test('compact provider aggregates preserve the full engine money and two independent time cohorts',async()=>{
 const id=(await call('query',{action:'catalog'})).platforms.find(p=>p.name==='EXAMPLE').id;
 const full=await call('query',query(id)),compact=await call('query',query(id,{view:'providers'}));
 assert.equal(compact.total,full.total);assert.deepEqual(Object.keys(compact.groups),['provider']);
 for(const row of compact.summary){const x=full.summary.find(x=>x.direction===row.direction&&x.currency===row.currency);for(const key of ['all_amount','all_count','success_amount','success_count','created_success_count','pending_amount','pending_count','rejected_count'])assert.equal(row[key],x[key],key)}
 const r=compact.summary.find(r=>r.direction==='charge');assert.equal(r.created_success_count,1);assert.equal(r.success_count,2);assert.equal(r.success_amount,'300');
 const selected=await call('query',query(id,{view:'providers',providers:['EditedPay']}));assert.equal(selected.groups.provider[0].provider,'EditedPay');assert.equal(selected.groups.provider[0].success_count,2);
 await assert.rejects(()=>call('query',query(id,{view:'providers',status:'pending'})),/unsupported_filter/);
});
test('workorder provider and overall totals span every page while directions remain separate',async()=>{
 const r=await call('workorders',{...autoReq(),platforms:['EXAMPLE'],limit:20});assert.equal(r.rows.length,20);assert.equal(r.total,50);
 assert.equal(r.byProvider.find(x=>x.direction==='charge').submittedCount,50);assert.equal(r.byProvider.find(x=>x.direction==='withdraw').submittedCount,50);
 const withdrawal=r.byProvider.find(x=>x.direction==='withdraw');assert.equal(withdrawal.successCount,25);assert.equal(withdrawal.notReceivedCount,25);assert.equal(withdrawal.submittedAmount,2500);assert.equal(withdrawal.successAmount+withdrawal.notReceivedAmount,withdrawal.submittedAmount);
 assert.equal(r.coverage.complete,true);assert.equal(r.coverage.capturedPlatformDays,1);
 assert.equal((await call('workorders',{...autoReq(),platforms:[]})).total,0);
 const missing=await call('workorders',{...autoReq(),startAt:'2026-09-22T00:00:00Z',endAt:'2026-09-22T23:59:59Z',platforms:['EXAMPLE']});assert.equal(missing.coverage.complete,false);assert.equal(missing.coverage.capturedPlatformDays,0);
 const next=await call('workorders',{...autoReq(),platforms:['EXAMPLE'],offset:20,limit:20});assert.deepEqual(next.byProvider,r.byProvider);assert.deepEqual(next.summary,r.summary);
});
test('automatic payout uses one local day, overlays NewAR once, and keeps baseline outside totals',async()=>{
 const r=await call('auto_withdraw',autoReq());assert.equal(r.totals.total,30);assert.equal(r.totals.success,26);assert.equal(r.totals.autoCount,14);assert.equal(r.totals.unclassifiedCount,1);assert.equal(r.previousTotals.total,8);assert.equal(r.comparison.complete,false);assert.equal(r.comparison.matchedRows,1);assert.equal(r.rows.length,2);assert.equal(r.rows.find(x=>x.platform==='EXAMPLE').previous.total,8);
 assert(Math.abs(r.totals.avgSeconds-2900/30)<0.001);assert.equal(r.rows.find(x=>x.platform==='DhaniWin').previous,null);
 const p=await call('auto_withdraw',autoReq({platforms:['EXAMPLE']}));assert.equal(p.totals.total,10);assert.equal(p.comparison.complete,true);assert(!JSON.stringify(p.rows).includes('DhaniWin'));
 const o=await call('auto_withdraw',autoReq({view:'operators',sort:'processed'}));assert.equal(o.totals.processed,15);assert(!JSON.stringify(o).includes('old-operator'));assert.equal(o.rows.find(x=>x.account==='operator-1').previous.processed,4);assert.equal(o.rows.find(x=>x.account==='operator-1').previous.success,3);
});
test('workorder rail/code attribution matches approved legacy names and preserves unknown pairs',async()=>{
 const pairs=[['印度','PAYTM','haoxpayinr','WPay'],['印度','WPay-QR','','WPay'],['印度','UPI','arbpayinr','UPI-QR'],['印度','ArbPay','arbpayinr','ArbPay'],['印度','PAYTM','unknown-new-code','PAYTM / unknown-new-code'],['缅甸','KBZPay','kingpaymmk','KingPay'],['马来','Touch n Go','truepaymyr','TruePay'],['越南','TruePay','','TruePay']];
 for(const [country,raw,channel,expected]of pairs){const r=await db.query('select private.dashboard_admin_live_workorder_provider($1,$2,$3,$4) name',[country,'EXAMPLE',raw,channel]);assert.equal(r.rows[0].name,expected)}
 await db.exec('begin');try{
  await db.exec("insert into workorder_deposit_daily values('2026-09-21','IN','印度','EXAMPLE','PAYTM','haoxpayinr','AR_WORKORDER',10,100,4,40,5,50,2,20,now(),now())");
  const r=await call('workorders',{...autoReq(),startAt:'2026-09-21T00:00:00Z',endAt:'2026-09-21T23:59:59Z',platforms:['EXAMPLE'],providers:['WPay'],direction:'withdraw'});
  assert.equal(r.byProvider[0].provider,'WPay');assert.equal(r.summary.submittedCount,5);assert.equal(r.summary.successCount,2);assert.equal(r.summary.notReceivedCount,3);
 }finally{await db.exec('rollback')}
});
test('all visible legacy daily sort columns sort before pagination, with null comparison values last',async()=>{
 for(const sort of ['country','platform','successRate','rejectRate','autoRate','manualRate','previousAvgSeconds','durationChange']){
  const r=await call('auto_withdraw',autoReq({sort,ascending:false,limit:20}));assert.equal(r.rows.length,2);assert.equal(r.total,2);
  if(sort==='successRate')assert.equal(r.rows[0].platform,'DhaniWin');if(sort==='previousAvgSeconds')assert.equal(r.rows[0].platform,'EXAMPLE');
 }
});
test('daily notes reuse legacy permissions and author stamping, with conflicts and order fields isolated',async()=>{
 await as(owner);const input={date:'2026-09-23',country:'印度',platform:'EXAMPLE',reason:'Synthetic daily operations note',expectedVersion:''};
 const saved=await call('withdraw_note',input);assert.equal(saved.reason,input.reason);assert.match(saved.version,/^[0-9a-f]{32}$/);
 assert.equal((await db.query('select updated_by from auto_withdraw_notes')).rows[0].updated_by,owner);
 await assert.rejects(()=>call('withdraw_note',{...input,reason:'stale overwrite'}),/note_conflict/);
 const rows=(await call('auto_withdraw',autoReq())).notes;assert.equal(rows[0].version,saved.version);
 await as(viewer);await assert.rejects(()=>call('withdraw_note',{...input,expectedVersion:saved.version}),/note_denied/);
 await as(admin);
 // Explicitly revoke the legacy module entitlement, without changing preview access.
 await db.query('update dashboard_profiles set permissions=$1::jsonb where auth_user_id=$2',[JSON.stringify({auto_withdraw:false}),admin]);
 await assert.rejects(()=>call('withdraw_note',{...input,expectedVersion:saved.version}),/note_denied/);
 await db.query("update dashboard_profiles set permissions='{}' where auth_user_id=$1",[admin]);
 await assert.rejects(()=>call('withdraw_note',{...input,country:'尼泊尔',platform:'SECRET'}),/scope_denied/);
 await as(owner);await assert.rejects(()=>call('withdraw_note',{...input,date:'2026-09-30'}),/note_date_unavailable/);
 assert.equal((await db.query("select remark from ar_collected_orders where order_no='R1'")).rows[0].remark,'Gift code policy');
});
test('withdrawal pages reject wrong countries/types, scope viewers, and preserve zero versus unavailable baseline',async()=>{
 await as(viewer);assert.equal((await call('auto_withdraw',autoReq({country:'尼泊尔'}))).total,0);
 for(const bad of [{country:'all'},{country:''},{view:'sql'},{platforms:[{}]},{ascending:'false'},{startAt:'2026-02-30T00:00:00Z'},{offset:-1},{endAt:'2026-12-24T23:59:59Z'}])await assert.rejects(()=>call('auto_withdraw',autoReq(bad)));
 await as(owner);
});
test('AR reason fields stay independent and include blank rejected remarks without exposing bank/member columns',async()=>{
 const q={date:'2026-09-23',country:'印度',platform:'EXAMPLE'};
 const blocks=await call('withdraw_reasons',q);assert.equal(blocks.rows[0].reason,'未满足自动出款规则');assert.equal(blocks.rows[0].count,2);assert.equal(blocks.basis,'manual_remark');assert.equal(blocks.snapshotFallback,true);
 const rejections=await call('withdraw_reasons',{...q,kind:'rejection'});assert.deepEqual(rejections.rows.map(x=>x.reason).sort(),['Gift code policy','（源备注为空）'].sort());assert(!JSON.stringify(rejections).includes('未满足自动出款规则'));
 const orders=await call('withdraw_reasons',{...q,kind:'orders'});assert.equal(orders.rows.length,2);assert.equal(orders.rows.find(r=>r.orderNumber==='R1').rejectionReason,'Gift code policy');assert.equal(orders.rows.find(r=>r.orderNumber==='R2').rejectionReason,null);
 assert(!JSON.stringify(orders).match(/bank_account|member_id|phone|raw_payload/));
 await as(viewer);await assert.rejects(()=>call('withdraw_reasons',{...q,country:'尼泊尔',platform:'NEW'}),/scope_denied/);await as(owner);
});
test('M8 reason categories support all eight countries, both bracket styles, and preserve unrecognized wording',async()=>{
 const cases=[
  ['IN','[Gift Codes] different original body','红包 / 兑换码（Gift Codes）'],
  ['PK','【gift code】other body','红包 / 兑换码（Gift Codes）'],
  ['NG','[ FIRST WITHDRAW ] policy','首次提现方式（First Withdraw）'],
  ['BR','O membro solicitou o cancelamento da retirada, obrigado','会员申请取消'],
  ['ID','Yth. Untuk mendapatkan informasi lebih lanjut, silahkan hubungi layanan Customer Service kami. Terima kasih','联系客服核实'],
  ['MM','လိုအပ်သောလိုအပ်အချက်အလက်များအတွက် ကျွန်ုပ်တို့၏ ဖောက်သည်ဝန်ဆောင်သို့ဆက်သွယ်ပါ။ ကျေးဇူးတင်ပါသည်။','联系客服核实'],
  ['MY','Dear customer, please contact our online customer service, thank you.','联系客服核实'],
  ['VN','Vui lòng liên hệ CSKH để được hỗ trợ, xin cảm ơn !','联系客服核实'],
  ['IN','Vui lòng liên hệ CSKH để được hỗ trợ, xin cảm ơn !','其他未归类备注'],
  ['IN','[Previously unseen rule] retain this reason','其他标签 · previously unseen rule'],
  ['IN','Unknown freeform note','其他未归类备注'],['IN','   ','源备注为空']
 ];
 for(const [country,note,expected]of cases){const r=await db.query('select private.dashboard_admin_live_rejection_category($1,$2) as category',[country,note]);assert.equal(r.rows[0].category,expected,country)}
});
test('multilingual source preview/tooltip formatting matches complete templates while ambiguous or truncated notes stay separate',async()=>{
 const templates=JSON.parse(sql('admin-live-withdraw-templates.sql').match(/\$templates\$([\s\S]*?)\$templates\$/)[1]);
 let checked=0;
 for(const [country,items]of Object.entries(templates))for(const [text,expected]of Object.entries(items)){
  // Construct variants only from the static whitelist: no production order data.
  const rendered=country==='MM'?text.replace(/\u1037/g,''):text;
  const note=rendered.slice(0,14)+'... '+rendered.replace(/ /g,' <br /> ');
  const result=await db.query('select private.dashboard_admin_live_rejection_category($1,$2) category',[country,note]);
  assert.equal(result.rows[0].category,expected,country+': '+text);checked++;
 }
 assert.equal(checked,53);
 const customer='Sayang, sila hubungi perkhidmatan pelanggan dalam talian kami, terima kasih';
 const suspicious='Sistem mengesan bahawa pertaruhan anda mencurigakan, sila hubungi Customer Service. Terima kasih.';
 for(const [country,note]of [['MY',customer+' '+suspicious],['IN',customer],['ID','Yth. Untuk mend...']]){
  const result=await db.query('select private.dashboard_admin_live_rejection_category($1,$2) category',[country,note]);
  assert.equal(result.rows[0].category,'其他未归类备注');
 }
});
test('single-platform daily rejection drilldowns conserve all orders and keep denominator independent of filters and pages',async()=>{
 await db.exec('begin');try{
  for(let i=0;i<29;i++){
   const remark=i<20?(i%2?'【Gift Codes】':'[gift codes]')+' original body '+i:i<25?'[Illegal Bet] turnover '+(i%2?5:20):i<27?'[Resubmit Order] bank or UPI '+i:i===27?null:'An unrecognized note';
   await db.query("insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,amount,status,applied_at,completed_at,operator,manual_remark,remark) values('AR','IN','EXAMPLE','withdraw',$1,10,'未通过','2026-09-21 12:00','2026-09-22 01:00',$2,'NEVER A REJECTION REASON',$3)",['ANALYSIS-'+String(i).padStart(3,'0'),i%2?'agent-b':'agent-a',remark]);
  }
  await db.exec("insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,amount,status,applied_at,operator,remark) values('AR','IN','EXAMPLE','withdraw','NOT-REJECTED',1,'已通过','2026-09-21','agent-a','[Gift Codes] success')");
  await db.exec("insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,amount,status,applied_at,operator,manual_remark,remark) select 'AR','IN','EXAMPLE','withdraw','SUCCESS-'||n,1,'已通过','2026-09-21','agent-c',case when n%2=0 then E'preview...\\npreview complete' else E' \\n\\t ' end,'[Gift Codes] Successful orders are not rejected' from generate_series(1,1000)n");
  const q={date:'2026-09-21',country:'印度',platform:'EXAMPLE',kind:'categories',limit:20};
  const all=await call('withdraw_reasons',q);assert.equal(all.noteCount,29);assert.equal(all.summary.totalRejected,29);assert.equal(all.summary.missingReason,1);assert.equal(all.summary.operators,2);assert.equal(all.categories.reduce((n,g)=>n+g.count,0),29);
  assert.equal(all.coverage.collected,1030);assert.equal(all.coverage.withManualRemark,529);
  const blocking=await call('withdraw_reasons',{...q,kind:'blocking'});assert.equal(blocking.noteCount,529);assert.equal(blocking.rows.find(r=>r.reason==='preview complete').count,500);
  assert.equal(all.rows[0].count,20);assert(!JSON.stringify(all).includes('NEVER A REJECTION REASON'));
  const gift=all.rows[0].categoryKey,filtered=await call('withdraw_reasons',{...q,kind:'orders',category:gift});
  assert.equal(filtered.noteCount,29);assert.equal(filtered.total,20);assert.equal(filtered.rows.length,20);assert.equal(filtered.summary.selectedCount,20);assert.equal(filtered.rows[0].operator,'agent-a');assert.equal(filtered.rows[0].manualRemark,'NEVER A REJECTION REASON');
  const next=await call('withdraw_reasons',{...q,kind:'orders',offset:20});assert.equal(next.rows.length,9);assert.equal(next.noteCount,29);
  const ops=await call('withdraw_reasons',{...q,kind:'operators',category:gift});assert.equal(ops.rows.length,2);assert(ops.rows.every(r=>r.count===10));
  const actor=await call('withdraw_reasons',{...q,kind:'orders',category:gift,operatorKey:ops.rows[0].operatorKey});assert.equal(actor.total,10);assert(actor.rows.every(r=>r.operator===ops.rows[0].operator));assert.equal(actor.noteCount,29);
  const raw=await call('withdraw_reasons',{...q,kind:'rejection',category:gift});assert.equal(raw.total,20);const exact=await call('withdraw_reasons',{...q,kind:'orders',reasonKey:raw.rows[0].reasonKey});assert.equal(exact.total,1);assert.equal(exact.noteCount,29);
  const found=await call('withdraw_reasons',{...q,kind:'orders',query:'ANALYSIS-028'});assert.equal(found.rows.length,1);assert.equal(found.rows[0].rejectionReason,'An unrecognized note');
  for(const bad of [{category:'sql'},{operatorKey:123},{query:['id']},{kind:'blocking',category:gift}])await assert.rejects(()=>call('withdraw_reasons',{...q,...bad}));
 }finally{await db.exec('rollback')}
});
test('snapshot-only rejections show coverage and categories without manufacturing order/operator details',async()=>{
 await db.exec('begin');try{
  await db.query("insert into withdraw_reasons_daily values('NEWAR','NP','RENAMED','2026-09-23',$1,now())",[JSON.stringify({note_field:'remark',totals:{reject:10},coverage:{complete:true,unique_count:15},groups:[{reason_label:'[Gift Codes] snapshot-only',operator_class:'manual',count:10,reject:10,success:0,other:0}]})]);
  const q={date:'2026-09-23',country:'尼泊尔',platform:'RENAMED',kind:'categories'};
  const r=await call('withdraw_reasons',q);assert.equal(r.available,true);assert.equal(r.rows[0].count,10);assert.equal(r.noteCount,10);assert.equal(r.canViewOrders,false);assert.equal(r.canViewOperators,false);
  assert.equal((await call('withdraw_reasons',{...q,kind:'orders'})).available,false);assert.equal((await call('withdraw_reasons',{...q,kind:'operators'})).available,false);assert.equal((await call('withdraw_reasons',{...q,kind:'blocking'})).available,false,'rejection remarks never substitute for interception notes');
 }finally{await db.exec('rollback')}
});
test('anonymous cannot call reads or writes and direct private tables remain inaccessible',async()=>{
 await as('');await assert.rejects(()=>call('provider_config'),/login_required/);await as(owner);await db.exec('set role authenticated');
 try{await assert.rejects(()=>db.query('select * from private.dashboard_admin_provider_overrides'),/permission denied/)}finally{await db.exec('reset role')}
 await db.exec('set role anon');try{for(const name of ['provider_config','provider_options','configuration_write','auto_withdraw','withdraw_reasons'])await assert.rejects(()=>call(name),/permission denied/)}finally{await db.exec('reset role')}
});
