const assert=require('node:assert/strict');
const {test,before,after}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260920051744_uploaded_order_sources.sql'),'utf8');
const game='00000000-0000-0000-0000-000000000001';
const hidden='00000000-0000-0000-0000-000000000002';
const start='2026-09-19T00:00:00+07:00',end='2026-09-20T00:00:00+07:00';
let db,ar,newar;
const defaults={platform:null,start,end,basis:'created',direction:'all',createdStart:null,createdEnd:null,providers:null,types:null,cursor:null,limit:50,member:null,order:null,status:'all',crossDay:false,min:null,max:null};
async function search(overrides={}){
 const p={...defaults,platform:ar,...overrides},args=Object.keys(defaults).map(k=>p[k]);
 return (await db.query('select public.dashboard_order_detail_search('+args.map((_,i)=>'$'+(i+1)).join(',')+') as data',args)).rows[0].data;
}
async function aggregate(overrides={}){
 const p={...defaults,platform:ar,reference:null,...overrides};
 const args=['platform','start','end','basis','direction','createdStart','createdEnd','member','order','status','crossDay','reference'].map(k=>p[k]);
 return (await db.query('select public.dashboard_order_time_query('+args.map((_,i)=>'$'+(i+1)).join(',')+') as data',args)).rows[0].data;
}
async function identity(allowed='yes',uid='10000000-0000-0000-0000-000000000001',scope='*'){
 await db.query("select set_config('test.allowed',$1,false),set_config('test.uid',$2,false),set_config('test.scope',$3,false)",[allowed,uid,scope]);
}
before(async()=>{
 db=new PGlite();
 await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;
 grant usage on schema auth,private to authenticated;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function public.dashboard_has_permission(text) returns boolean language sql as $$select case current_setting('test.allowed',true) when 'unset' then null else current_setting('test.allowed',true)='yes' end$$;
 create function private.dashboard_current_data_scope() returns jsonb language sql as $$select jsonb_build_object('scope',current_setting('test.scope',true))$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql as $$select $1->>'scope'='*' or $1->>'scope'=$2||':'||$3$$;
 create table game66_platforms(id uuid primary key,platform_name text,team_name text,team_code text);
 create table game66_charge_orders(id uuid primary key default gen_random_uuid(),platform_id uuid,uid text,order_num text,out_trade_no text,pay_time timestamptz,create_time timestamptz,status_code text,status_text text,pay_method_name text,pay_mode text,amount_display numeric,amount_minor numeric,last_seen_at timestamptz,raw_payload jsonb,phone text,bank_account text);
 create table game66_withdraw_orders(id uuid primary key default gen_random_uuid(),platform_id uuid,uid text,order_num text,out_trade_no text,update_time timestamptz,create_time timestamptz,status_code text,status_text text,pay_channel text,pay_method_name text,payout_mode text,amount_display numeric,amount_minor numeric,real_amount_display numeric,real_amount_minor numeric,fee_display numeric,fee_minor numeric,last_seen_at timestamptz,raw_payload jsonb,phone text,bank_account text);
 create index game66_charge_time_idx on game66_charge_orders(platform_id,create_time);
 create index game66_withdraw_time_idx on game66_withdraw_orders(platform_id,create_time);
 create table ar_config_targets(country_code text,platform text,country_name text,timezone text,currency text,source_system text not null default 'AR',primary key(country_code,platform));
 create table ar_collected_orders(source_system text,country_code text,platform text,order_kind text,order_no text,member_id text,amount numeric,status text,applied_at timestamp,completed_at timestamp,raw_channel text,channel_type text,updated_at timestamptz default now(),raw_payload jsonb,amount_text text,primary key(source_system,country_code,platform,order_kind,order_no));
 create index ar_collected_orders_applied_idx on ar_collected_orders(country_code,platform,order_kind,applied_at);
 create table newar_detail_platforms(platform text primary key,country_code text,country text,timezone text,currency text,enabled boolean,launch_at timestamptz);
 create table newar_detail_records(id uuid primary key default gen_random_uuid(),platform text,dataset text,source_id text,member_id text,order_number text,third_party_order_number text,provider text,channel_type text,currency text,amount numeric,actual_amount numeric,fee numeric,status_code text,status_group text,created_at timestamptz,success_at timestamptz,received_at timestamptz default now(),raw_payload jsonb);
 insert into game66_platforms values('${game}','EK7','香港','hong_kong'),('${hidden}','HIDDEN','红膏蟹','red_crab');
 insert into ar_config_targets(country_code,platform,country_name,timezone,currency) values('VN','VNTEST','越南','Asia/Ho_Chi_Minh','VND'),('BR','VNTEST','巴西','America/Sao_Paulo','BRL'),('MY','EMPTY','马来西亚','Asia/Kuala_Lumpur','MYR'),('US','DST','测试DST','America/New_York','USD');
 insert into newar_detail_platforms values('POPZAR','PK','巴基斯坦','Asia/Karachi','PKR',true,null),('EMPTY','IN','印度','Asia/Kolkata','INR',true,null),('FUTURE','PK','巴基斯坦','Asia/Karachi','PKR',true,'2200-01-01Z'),('WORKONLY','PK','巴基斯坦','Asia/Karachi','PKR',true,null),('DISABLED','PK','巴基斯坦','Asia/Karachi','PKR',false,null);
 insert into game66_charge_orders(platform_id,order_num,uid,create_time,pay_time,status_code,amount_display,amount_minor,pay_method_name,pay_mode) values('${game}','G-CHARGE','00123','2026-09-19T10:00+05:30','2026-09-19T10:01+05:30','1',100,99999,'PayG','UPI'),('${hidden}','HIDDEN','PRIVATE','2026-09-19T10:00Z',null,'0',1,100,'Secret','UPI');
 insert into game66_withdraw_orders(platform_id,order_num,uid,create_time,update_time,status_code,amount_minor,real_amount_minor,fee_minor,pay_channel,payout_mode) values('${game}','G-FAIL','00123','2026-09-19T10:00+05:30','2026-09-19T10:01+05:30','2',11000,11000,900,'PayG','BANK'),('${game}','G-SUCCESS','00123','2026-09-19T10:00+05:30','2026-09-19T10:01+05:30','3',10000,9800,200,'PayG','BANK'),('${game}','G-UNKNOWN-MONEY','00123','2026-09-19T10:00+05:30',null,'1',null,null,null,'PayG','BANK');
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,completed_at,raw_channel,channel_type) values
 ('AR','VN','VNTEST','recharge','A-START','00123',0,'已支付','2026-09-19 00:00','2026-09-19 00:00','PayA','BANK'),
 ('AR','VN','VNTEST','recharge','A-PAID','00123',100,'已支付','2026-09-19 05:00','2026-09-19 05:01','PayA','BANK'),
 ('AR','VN','VNTEST','recharge','A-MISSING','00123',null,'已支付','2026-09-19 05:00','2026-09-19 05:01','PayA','BANK'),
 ('AR','VN','VNTEST','recharge','A-PENDING','00123',20,'待支付','2026-09-19 05:00','2026-09-19 05:01','PayA','BANK'),
 ('AR','VN','VNTEST','recharge','A-CANCEL','00123',30,'已取消','2026-09-19 05:00','2026-09-19 05:01','PayA','BANK'),
 ('AR','VN','VNTEST','recharge','A-OLD','00123',50,'已支付','2026-09-18 23:59','2026-09-19 00:01','PayA','BANK'),
 ('AR','VN','VNTEST','recharge','A-EARLY','00123',70,'已支付','2026-09-19 01:00','2026-09-19 07:00','PayA','BANK'),
 ('AR','VN','VNTEST','recharge','A-FRACTION','00123',2,'已支付','2026-09-19 23:59:59.999','2026-09-19 23:59:59.999','PayA','BANK'),
 ('AR','VN','VNTEST','recharge','A-END','00123',900,'已支付','2026-09-20 00:00','2026-09-20 00:00','PayA','BANK'),
 ('AR','VN','VNTEST','withdraw','W-SUCCESS','00123',200,'已通过','2026-09-19 05:00','2026-09-19 05:01','PayB','BANK'),
 ('AR','VN','VNTEST','withdraw','W-PENDING','00123',300,'已提交','2026-09-19 05:00','2026-09-19 05:01','PayB','BANK'),
 ('AR','VN','VNTEST','withdraw','W-REJECT','00123',400,'未通过','2026-09-19 05:00','2026-09-19 05:01','PayB','BANK'),
 ('AR','VN','VNTEST','withdraw','W-UNKNOWN','00123',500,'未来状态','2026-09-19 05:00','2026-09-19 05:01',null,null),
 ('AR','BR','VNTEST','withdraw','BR-ORDER','1',10,'已通过','2026-09-19 05:00','2026-09-19 05:01','PayB','BANK'),
 ('AR','US','DST','withdraw','DST-ORDER','1',10,'已通过','2026-11-01 05:00','2026-11-01 05:01','PayB','BANK');
 insert into newar_detail_records(platform,dataset,source_id,member_id,order_number,third_party_order_number,provider,channel_type,currency,amount,actual_amount,fee,status_code,status_group,created_at,success_at) values
 ('POPZAR','charge','SRC-1','0007','N-CHARGE','THIRD-1','PayN','BANK','PKR',0,null,null,'1','success','2026-09-19T05:00+05:00','2026-09-19T05:01+05:00'),
 ('POPZAR','withdraw','SRC-2','0007','N-WITHDRAW','THIRD-2','PayN','BANK','PKR',100,98,2,'2','success','2026-09-18T23:59+05:00','2026-09-19T05:01+05:00'),
 ('POPZAR','withdraw','SRC-3','0007','N-USDT','THIRD-3','PayN','BANK','USDT',4,3,1,'2','success','2026-09-19T05:00+05:00','2026-09-19T05:01+05:00'),
 ('POPZAR','withdraw','SRC-4','0007','N-NULL','THIRD-4','PayN','BANK','PKR',null,null,null,'0','pending','2026-09-19T05:00+05:00','2026-09-19T05:01+05:00'),
 ('POPZAR','workorder','SRC-WO','0007','N-WO',null,'PayN','BANK','PKR',500,500,0,'2','success','2026-09-19T05:00+05:00','2026-09-19T05:01+05:00'),
 ('WORKONLY','workorder','SRC-WO','0007','ONLY-WO',null,'PayN','BANK','PKR',500,500,0,'2','success','2026-09-19T05:00+05:00','2026-09-19T05:01+05:00'),
 ('FUTURE','charge','SRC-F','0007','FUTURE',null,'PayN','BANK','PKR',500,500,0,'2','success','2026-09-19T05:00+05:00','2026-09-19T05:01+05:00'),
 ('DISABLED','charge','SRC-D','0007','DISABLED',null,'PayN','BANK','PKR',500,500,0,'2','success','2026-09-19T05:00+05:00','2026-09-19T05:01+05:00');`);
 for(const f of ['20260919083628_order_time_query.sql','20260919085244_order_time_details.sql','20260919095550_order_time_reference_start.sql','20260919101327_order_detail_search.sql'])await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8'));
 await db.exec(migration);
 await db.exec('alter table game66_charge_orders add column status_group text');
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260920102953_g66_charge_status_group.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260920130729_india_order_amount_read_contract.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260920134354_india_legacy_labelled_amount_read.sql'),'utf8'));
 await identity();
 ar=(await db.query("select md5('ar:VN:VNTEST')::uuid as id")).rows[0].id;
 newar=(await db.query("select md5('newar:PK:POPZAR')::uuid as id")).rows[0].id;
});
after(async()=>{if(db)await db.close();});

test('India amount migration preserves prior query/auth/catalog functions except the two narrow read expressions',()=>{
 const file=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
 const current=file('20260920130729_india_order_amount_read_contract.sql');
 const old=file('20260920062124_order_catalog_index_probes.sql')+'\n'+file('20260920102953_g66_charge_status_group.sql');
 const strip=s=>s.replace(/--[^\n]*/g,'').replace(/\s+/g,'');
 const restored=current.replace("coalesce(t.currency,case when t.country_code='IN' then 'INR' end)",'t.currency')
  .replace(/coalesce\(a\.amount,case[\s\S]*?then btrim\(a\.amount_text\)::numeric end\) as amount/, 'a.amount');
 assert.equal(strip(restored),strip(old));
 assert.doesNotMatch(current,/\b(?:insert into|delete from|update public\.|alter table|grant )/i);
});

test('India legacy null currency and signed manual adjustments retain full amounts without rewriting source rows',async()=>{
 await db.exec('begin');
 try{
  await db.exec(`insert into ar_config_targets(country_code,platform,country_name,timezone,currency) values
    ('IN','INTEST','印度','Asia/Kolkata',null),('IN','IN-EXPLICIT','印度','Asia/Kolkata','USD');`);
  const records=[['known',100,'100','PayA','recharge','已支付'],['adjustment',null,'-8085','人工充值','recharge','已支付'],
    ['decimal',null,' -19.57 ','人工充值','recharge','已支付'],['malformed',null,'-10 INR','人工充值','recharge','已支付'],
    ['unconfirmed',null,'10','人工充值','recharge','已支付'],['other-provider',null,'-10','PayA','recharge','已支付'],
    ['other-direction',null,'-10','人工充值','withdraw','已通过']];
  for(const [order,amount,raw,provider,kind,status] of records)await db.query(`insert into ar_collected_orders
   (source_system,country_code,platform,order_kind,order_no,member_id,amount,amount_text,status,applied_at,completed_at,raw_channel,channel_type)
   values('AR','IN','INTEST',$1,$2,'SIGNED',$3,$4,$5,'2026-09-19 10:00','2026-09-19 10:01',$6,'UPI')`,[kind,order,amount,raw,status,provider]);
  await db.exec(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,amount,status,applied_at,raw_channel)
   values('AR','IN','IN-EXPLICIT','recharge','explicit',3,'已支付','2026-09-19 10:00','PayA');`);
  const catalog=(await aggregate({platform:null})).platforms;
  const india=catalog.find(p=>p.name==='INTEST');assert.equal(india.currency,'INR');
  assert.equal(catalog.find(p=>p.name==='IN-EXPLICIT').currency,'USD');
  assert.equal(catalog.find(p=>p.name==='VNTEST'&&p.country_code==='VN').currency,'VND');
  const options={platform:india.id,start:'2026-09-19T00:00+05:30',end:'2026-09-20T00:00+05:30'};
  const details=(await search(options)).rows;
  for(const name of ['malformed','unconfirmed','other-provider','other-direction'])assert.equal(details.find(r=>r.order_number===name).amount,null,name);
  assert.equal(details.find(r=>r.order_number==='adjustment').amount,'-8085');
  assert.equal(details.find(r=>r.order_number==='decimal').amount,'-19.57');
  const total=(await aggregate({...options,order:'adjustment'})).rows[0];
  assert.equal(total.success_amount,-8085);assert.equal(total.success_count,1);assert.equal(total.missing_amount_count,0);assert.equal(total.currency,'INR');
  assert.equal((await db.query("select amount from ar_collected_orders where platform='INTEST' and order_no='adjustment'")).rows[0].amount,null,'source remains untouched');
 }finally{await db.exec('rollback');}
});

test('legacy INR labelled amount reads exact account money, never the exchange rate or USDT quantity',async()=>{
 await db.exec('begin');
 try{
  await db.exec("insert into ar_config_targets values('IN','LABELLED','印度','Asia/Kolkata',null,'AR')");
  const encoded='金额：1030\\n \\n 兑换比例：103\\n \\n USDT：8.5';
  const actual='金额：5150\n \n 兑换比例：103\n \n USDT：22';
  const records=[['encoded',null,encoded,'USDT(TRC20)-3','recharge','已支付','IN'],
    ['real-newline',null,actual,'USDT(TRC20)-4','recharge','已支付','IN'],
    ['known',999,actual,'USDT(TRC20)-4','recharge','已支付','IN'],
    ['zero',null,'金额：0\n兑换比例：103\nUSDT：0','USDT(TRC20)-3','recharge','已支付','IN'],
    ['missing-label',null,'USDT：22','USDT(TRC20)-3','recharge','已支付','IN'],
    ['malformed',null,actual+' extra','USDT(TRC20)-3','recharge','已支付','IN'],
    ['negative',null,actual.replace('5150','-5150'),'USDT(TRC20)-3','recharge','已支付','IN'],
    ['different-rail',null,actual,'PayA','recharge','已支付','IN'],
    ['different-direction',null,actual,'USDT(TRC20)-3','withdraw','已通过','IN']];
  for(const [order,amount,raw,channel,kind,status,country] of records)await db.query(`insert into ar_collected_orders
   (source_system,country_code,platform,order_kind,order_no,member_id,amount,amount_text,status,applied_at,raw_channel)
   values('AR',$1,'LABELLED',$2,$3,'LABELLED',$4,$5,$6,'2026-09-19 10:00',$7)`,[country,kind,order,amount,raw,status,channel]);
  const platform=(await aggregate({platform:null})).platforms.find(p=>p.name==='LABELLED').id;
  const options={platform,start:'2026-09-19T00:00+05:30',end:'2026-09-20T00:00+05:30'};
  const details=(await search(options)).rows,amounts=Object.fromEntries(details.map(r=>[r.order_number,r.amount]));
  assert.deepEqual(amounts,{encoded:'1030','real-newline':'5150',known:'999',zero:'0','missing-label':null,malformed:null,negative:null,'different-rail':null,'different-direction':null});
  assert.equal((await aggregate({...options,order:'encoded'})).rows[0].success_amount,1030);
  assert.equal((await db.query("select amount from ar_collected_orders where platform='LABELLED' and order_no='encoded'")).rows[0].amount,null);
  await db.exec("update ar_config_targets set country_code='VN',country_name='越南',currency='VND' where platform='LABELLED';update ar_collected_orders set country_code='VN' where platform='LABELLED'");
  const vietnam=(await aggregate({platform:null})).platforms.find(p=>p.name==='LABELLED').id;
  assert.equal((await search({...options,platform:vietnam,order:'encoded'})).rows[0].amount,null);
 }finally{await db.exec('rollback');}
});

test('labelled amount read leaves the authenticated query body, ACL and filters otherwise unchanged',()=>{
 const old=fs.readFileSync(path.join(root,'supabase/migrations/20260920130729_india_order_amount_read_contract.sql'),'utf8').split('create or replace function private.dashboard_uploaded_order_query(')[1];
 const current=fs.readFileSync(path.join(root,'supabase/migrations/20260920134354_india_legacy_labelled_amount_read.sql'),'utf8').split('create or replace function private.dashboard_uploaded_order_query(')[1];
 const restored=current.replace(/\n          when a\.country_code='IN' and a\.order_kind='recharge' and btrim\(a\.raw_channel\) ~ '\^USDT[\s\S]*?\)::numeric end\) as amount/,' end) as amount');
 assert.equal(restored,old);
});

test('G66 failed and EK pending charge code 0 retain distinct collector semantics without changing totals',async()=>{
 await db.exec('begin');
 try{
  const items=[['G66-FAILED','0','failed','付款失败'],['EK-PENDING','0','pending','待支付'],
   ['LEGACY-ZERO','0',null,'0'],['BAD-ZERO','0','success','0'],
   ['CODE1','1','failed','已支付'],['UNKNOWN','77','success','未来状态']];
  for(const [order,code,group,label] of items)await db.query(`insert into game66_charge_orders
   (platform_id,order_num,uid,create_time,pay_time,status_code,status_group,status_text,amount_display,pay_method_name)
   values($1,$2,'STATUS-TEST','2026-09-19T12:00+05:30','2026-09-19T12:01+05:30',$3,$4,$5,10,'StatusProvider')`,[game,order,code,group,label]);
  const options={platform:game,member:'STATUS-TEST',direction:'charge'};
  const all=await search(options);
  const groups=Object.fromEntries(all.rows.map(r=>[r.order_number,r.status_group]));
  assert.deepEqual(groups,{'G66-FAILED':'failed','EK-PENDING':'pending','LEGACY-ZERO':'pending','BAD-ZERO':'pending','CODE1':'success','UNKNOWN':'unknown'});
  assert.deepEqual((await search({...options,status:'failed'})).rows.map(r=>r.order_number),['G66-FAILED']);
  assert.deepEqual(new Set((await search({...options,status:'pending'})).rows.map(r=>r.order_number)),new Set(['EK-PENDING','LEGACY-ZERO','BAD-ZERO']));
  assert.deepEqual((await search({...options,basis:'success'})).rows.map(r=>r.order_number),['CODE1']);
  assert.ok(all.rows.filter(r=>!r.succeeded).every(r=>r.success_at===null));
  const totals=(await aggregate(options)).rows;
  const sum=field=>totals.reduce((n,r)=>n+Number(r[field]),0);
  assert.equal(sum('submitted_count'),6);assert.equal(sum('submitted_amount'),60);
  assert.equal(sum('success_count'),1);assert.equal(sum('success_amount'),10);
  assert.equal(sum('pending_count'),3);assert.equal(sum('pending_amount'),30);
 }finally{await db.exec('rollback');}
});

test('existing UUID API signatures and invoker wrappers remain unchanged; internals are not callable',async()=>{
 const rows=(await db.query("select n.nspname,p.proname,p.pronargs,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('authenticated',p.oid,'execute') as authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('dashboard_order_time_query','dashboard_order_time_details','dashboard_order_detail_search','dashboard_uploaded_order_platforms','dashboard_uploaded_order_query')")).rows;
 assert.equal(rows.length,8);
 for(const r of rows){
  assert.equal(r.anon,false); assert.ok(r.proconfig.includes('search_path=""'));
  if(r.proname.startsWith('dashboard_uploaded'))assert.equal(r.authenticated,false);
  else{assert.equal(r.authenticated,true); assert.equal(r.prosecdef,r.nspname==='private'); assert.equal(Number(r.pronargs),({dashboard_order_time_query:12,dashboard_order_time_details:15,dashboard_order_detail_search:17})[r.proname]);}
 }
 await db.exec('set role authenticated');try{assert.ok((await search()).rows.length);await assert.rejects(()=>db.query('select * from ar_collected_orders'),/permission denied/);await assert.rejects(()=>db.query('select private.dashboard_uploaded_order_platforms()'),/permission denied/);}finally{await db.exec('reset role');}
 await db.exec('set role anon');try{await assert.rejects(()=>search(),/permission denied/);}finally{await db.exec('reset role');}
});
test('catalog uses actual order sources, stable country-qualified ids and metadata, not empty/workorder-only targets',async()=>{
 const {platforms}=await aggregate({platform:null});
 assert.equal(platforms.length,6);
 assert.deepEqual(platforms.filter(p=>p.source==='newar').map(p=>p.name),['POPZAR']);
 assert.equal(platforms.find(p=>p.id===ar).timezone,'Asia/Ho_Chi_Minh');
 assert.equal(platforms.find(p=>p.id===ar).country,'越南');
 assert.equal(platforms.find(p=>p.id===ar).currency,'VND');
 assert.equal(platforms.find(p=>p.id===game).source,'game66');
 assert.equal(platforms.filter(p=>p.name==='VNTEST').length,2);
 assert.equal(new Set(platforms.map(p=>p.id)).size,platforms.length);
});
test('authentication, null module permission and platform/country scope fail closed for catalog and data',async()=>{
 for(const allowed of ['no','unset']){await identity(allowed);await assert.rejects(()=>aggregate({platform:null}),/没有三方查询权限/);await assert.rejects(()=>search(),/没有三方查询权限/);}
 await identity('yes','');await assert.rejects(()=>search(),/请先登录/);
 await identity('yes','10000000-0000-0000-0000-000000000001','VN:VNTEST');
 assert.deepEqual((await aggregate({platform:null})).platforms.map(p=>p.id),[ar]);
 await assert.rejects(()=>search({platform:game}),/无权查看/);await assert.rejects(()=>search({platform:newar}),/无权查看/);await identity();
});
test('AR queries platform-local time, preserves fractional end and never treats pending/rejected completion as success',async()=>{
 const result=await search({start:'2026-09-19T05:00:00+07:00'});
 assert.equal(result.source,'ar');assert.equal(result.country,'越南');assert.equal(result.timezone,'Asia/Ho_Chi_Minh');
 assert.ok(!result.rows.some(r=>['A-START','A-OLD','A-END'].includes(r.order_number)));
 assert.ok(result.rows.some(r=>r.order_number==='A-FRACTION'));
 assert.equal(new Date(result.rows.find(r=>r.order_number==='A-PAID').created_at).toISOString(),'2026-09-18T22:00:00.000Z');
 const success=await search({basis:'success'});
 assert.ok(success.rows.every(r=>r.succeeded));assert.ok(success.rows.some(r=>r.order_number==='A-OLD'));
 for(const order of ['A-PENDING','A-CANCEL','W-PENDING','W-REJECT','W-UNKNOWN'])assert.ok(!success.rows.some(r=>r.order_number===order));
 for(const r of result.rows.filter(r=>!r.succeeded))assert.equal(r.success_at,null);
});
test('AR exact identifiers and combined status/provider/type/amount filters retain zero and reject unknown amounts',async()=>{
 assert.equal((await search({member:'123'})).rows.length,0);assert.ok((await search({member:' 00123 '})).rows.length);
 assert.equal((await search({order:' A-PAID '})).rows[0].amount,'100');
 assert.equal((await search({order:"' or true --"})).rows.length,0);assert.equal((await search({order:'A-%'})).rows.length,0);
 assert.deepEqual((await search({min:0,max:0})).rows.map(r=>r.order_number),['A-START']);
 assert.equal((await search({order:'A-MISSING'})).rows[0].amount,null);
 assert.equal((await search({order:'A-MISSING',min:0})).rows.length,0);
 assert.deepEqual((await search({direction:'withdraw',status:'pending',providers:['PayB'],types:['BANK'],min:300,max:300})).rows.map(r=>r.order_number),['W-PENDING']);
 assert.equal((await search({providers:[]})).rows.length,0);
});
test('nullable aggregates propagate missing money without losing valid order counts',async()=>{
 const result=await aggregate({direction:'charge'});
 const cohort=result.rows.find(r=>r.created_date==='2026-09-19'&&r.success_date==='2026-09-19');
 assert.equal(cohort.submitted_count,5);assert.equal(cohort.success_count,5);assert.equal(cohort.missing_amount_count,1);
 assert.equal(cohort.submitted_amount,null);assert.equal(cohort.success_amount,null);assert.equal(cohort.actual_amount,null);assert.equal(cohort.withdraw_fee,null);assert.equal(cohort.currency,'VND');
 assert.equal(result.country,'越南');assert.equal(result.source,'ar');
 const withdrawal=(await aggregate({direction:'withdraw',status:'success'})).rows[0];
 assert.equal(withdrawal.success_amount,200);assert.equal(withdrawal.actual_amount,null);assert.equal(withdrawal.withdraw_fee,null);
 const pending=(await aggregate({direction:'withdraw',status:'pending'})).rows[0];assert.equal(pending.actual_amount,null);assert.equal(pending.withdraw_fee,null);
 await db.query("update ar_collected_orders set amount_text='invalid-original-amount' where order_no='A-MISSING'");
 assert.equal((await search({order:'A-MISSING'})).rows[0].amount_text,'invalid-original-amount');
});
test('cross-day, created-range and earlier-reference semantics remain independent of success query slices',async()=>{
 assert.deepEqual((await search({basis:'success',crossDay:true})).rows.map(r=>r.order_number),['A-OLD']);
 assert.deepEqual((await search({basis:'success',createdEnd:start})).rows.map(r=>r.order_number),['A-OLD']);
 const first=await aggregate({basis:'success',start:'2026-09-19T05:00:00+07:00',end:'2026-09-19T06:00:00+07:00',reference:start});
 const second=await aggregate({basis:'success',start:'2026-09-19T06:00:00+07:00',end:'2026-09-19T08:00:00+07:00',reference:start});
 assert.equal([...first.rows,...second.rows].reduce((n,r)=>n+r.earlier_count,0),0,'earlier uses original whole-query boundary, not each slice');
 const midnight=await aggregate({basis:'success',end:'2026-09-19T02:00:00+07:00',reference:start});
 assert.equal(midnight.rows.reduce((n,r)=>n+r.earlier_count,0),1);assert.equal(midnight.rows.reduce((n,r)=>n+r.cross_day_count,0),1);
});
test('NEWAR exposes only launched charge/withdraw rows, preserves original currency, and aggregates local currency only',async()=>{
 const p={platform:newar,start:'2026-09-19T00:00:00+05:00',end:'2026-09-20T00:00:00+05:00',basis:'success'};
 const rows=(await search(p)).rows;
 assert.deepEqual(rows.map(r=>r.order_number).sort(),['N-CHARGE','N-USDT','N-WITHDRAW']);
 assert.equal(rows.find(r=>r.order_number==='N-CHARGE').amount,'0');assert.equal(rows.find(r=>r.order_number==='N-USDT').currency,'USDT');
 const n=rows.find(r=>r.order_number==='N-WITHDRAW');assert.equal(n.actual_amount,'98');assert.equal(n.withdraw_fee,'2');assert.equal(n.cross_day,true);
 for(const order of ['SRC-2','THIRD-2','N-WITHDRAW'])assert.equal((await search({...p,order})).rows[0].order_number,'N-WITHDRAW');
 const aggregated=await aggregate(p);assert.ok(aggregated.rows.every(r=>r.currency==='PKR'));assert.equal(aggregated.rows.reduce((n,r)=>n+r.success_amount,0),100);
 const drill=(await db.query('select public.dashboard_order_time_details($1,$2,$3,$4) as data',[newar,p.start,p.end,p.basis])).rows[0].data;
 assert.deepEqual(drill.rows.map(r=>r.order_number).sort(),['N-CHARGE','N-WITHDRAW']);assert.ok(drill.rows.every(r=>r.currency==='PKR'));
 assert.equal((await search({...p,basis:'created',status:'pending'})).rows[0].success_at,null);
});
test('GAME66 regression: failed payout has no success timestamp; amount display/units and unknown monetary values preserved',async()=>{
 const p={platform:game,start:'2026-09-19T00:00:00+05:30',end:'2026-09-20T00:00:00+05:30'};
 const result=await search(p);assert.equal(result.source,'game66');assert.equal(result.country,'香港');
 const c=result.rows.find(r=>r.order_number==='G-CHARGE');assert.equal(c.amount,'100');assert.equal(c.currency,'INR');
 const fail=result.rows.find(r=>r.order_number==='G-FAIL');assert.equal(fail.status_group,'failed');assert.equal(fail.success_at,null);assert.equal(Number(fail.amount),110);
 const success=result.rows.find(r=>r.order_number==='G-SUCCESS');assert.equal(Number(success.amount),100);assert.equal(Number(success.actual_amount),98);assert.equal(Number(success.withdraw_fee),2);
 assert.equal(result.rows.find(r=>r.order_number==='G-UNKNOWN-MONEY').amount,null);
 assert.equal((await search({...p,basis:'success'})).rows.length,2);
 const pending=(await aggregate({...p,status:'pending'})).rows[0];assert.equal(pending.pending_amount,null);assert.equal(pending.missing_amount_count,1);
});
test('AR keyset pagination has no gaps or duplicates across timestamp ties and both directions',async()=>{
 await db.exec(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,completed_at,raw_channel,channel_type)
 select 'AR','VN','VNTEST',case when n%2=0 then 'recharge' else 'withdraw' end,'PAGE-'||n,'PAGED',10,case when n%2=0 then '已支付' else '已通过' end,'2026-09-19 12:00'::timestamp,'2026-09-19 12:01'::timestamp,'PayP','BANK' from generate_series(1,67) n`);
 const ids=[];let cursor=null,pages=0;do{const p=await search({member:'PAGED',limit:17,cursor});ids.push(...p.rows.map(r=>r.id));cursor=p.nextCursor;assert.equal(p.hasMore,cursor!==null);pages++;}while(cursor);
 assert.equal(pages,4);assert.equal(ids.length,67);assert.equal(new Set(ids).size,67);
 const first=await search({member:'PAGED',limit:50});assert.equal(first.rows.length,50);assert.equal(first.hasMore,true);
 const again=await search({member:'PAGED',limit:50});assert.deepEqual(first.rows.map(r=>r.id),again.rows.map(r=>r.id));
});
test('detail payloads do not expose raw payload, phone, bank fields or unrequested full counts',async()=>{
 for(const platform of [ar,newar,game]){
  const result=await search({platform});assert.ok(!('count' in result));
  for(const row of result.rows)for(const field of ['raw_payload','phone','bank_account','source_id'])assert.ok(!(field in row));
 }
});
test('detail JSON money is lossless decimal text, including values beyond JavaScript safe integer precision',async()=>{
 const amount='1234567890123456.12345678';
 await db.query("insert into newar_detail_records(platform,dataset,source_id,order_number,currency,amount,actual_amount,fee,status_group,created_at) values('POPZAR','withdraw','PRECISE','PRECISE','PKR',$1::numeric,$1::numeric,$1::numeric,'pending','2026-09-19T05:00+05:00')",[amount]);
 const row=(await search({platform:newar,order:'PRECISE'})).rows[0];
 assert.equal(row.amount,amount);assert.equal(row.actual_amount,amount);assert.equal(row.withdraw_fee,amount);
});
test('NEW_AR catalog switches from historical AR only after dedicated full orders exist, without double counting',async()=>{
 await db.exec(`insert into ar_config_targets values('PK','MIGRATING','巴基斯坦','Asia/Karachi','PKR','NEW_AR');
 insert into newar_detail_platforms values('MIGRATING','PK','巴基斯坦','Asia/Karachi','PKR',true,null);
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,amount,status,applied_at) values('AR','PK','MIGRATING','recharge','OLD',10,'已支付','2026-09-19 05:00');`);
 assert.deepEqual((await aggregate({platform:null})).platforms.filter(p=>p.name==='MIGRATING').map(p=>p.source),['ar']);
 await db.exec(`insert into newar_detail_records(platform,dataset,source_id,order_number,currency,amount,status_group,created_at) values('MIGRATING','charge','NEW','NEW','PKR',10,'success','2026-09-19T05:00+05:00');`);
 const platforms=(await aggregate({platform:null})).platforms.filter(p=>p.name==='MIGRATING');assert.equal(platforms.length,1);assert.equal(platforms[0].source,'newar');
 const oldId=(await db.query("select md5('ar:PK:MIGRATING')::uuid as id")).rows[0].id;
 await assert.rejects(()=>search({platform:oldId}),/无权查看/);
});
test('all selectors validate bounded date, finite amounts, limits and cursor; DST limit uses local calendar',async()=>{
 for(const overrides of [{platform:null},{start:null},{end:start},{end:'infinity'},{start:'2026-08-01Z'},{basis:'bad'},{direction:'bad'},{status:'bad'},{crossDay:null},{limit:0},{limit:51},{providers:Array(201).fill('a')},{createdStart:start},{member:'a'.repeat(201)}])await assert.rejects(()=>search(overrides),/请选择单个平台|无效查询条件/);
 for(const bad of [-1,'NaN','Infinity','-Infinity'])await assert.rejects(()=>search({min:bad}),/无效金额范围/);
 await assert.rejects(()=>search({min:2,max:1}),/无效金额范围/);
 for(const cursor of [{},[],{at:start,id:ar,direction:'bad'},{at:'infinity',id:ar,direction:'charge'},{at:start,id:'bad',direction:'charge'}])await assert.rejects(()=>search({cursor}),/无效分页位置/);
 const dst=(await aggregate({platform:null})).platforms.find(p=>p.name==='DST').id;
 assert.equal((await search({platform:dst,start:'2026-10-10T00:00:00-04:00',end:'2026-11-10T00:00:00-05:00'})).rows.length,1);
 await assert.rejects(()=>search({platform:dst,start:'2026-10-09T23:59:59-04:00',end:'2026-11-10T00:00:00-05:00'}),/最多31天/);
});
test('AR native timestamp index boundaries remain sargable and completed index is installed',async()=>{
 assert.match(migration,/a\.%1\$I>=\(\$5 at time zone \$4\)/);assert.match(migration,/a\.%1\$I<\(\$6 at time zone \$4\)/);
 assert.doesNotMatch(migration,/where[^;]*a\.%1\$I at time zone \$4\s*[<>=]/);
 const index=(await db.query("select indexdef from pg_indexes where indexname='ar_collected_orders_completed_idx'")).rows[0];assert.match(index.indexdef,/country_code, platform, order_kind, completed_at/);
 await db.exec('set enable_seqscan=off');try{
  const plan=(await db.query("explain select order_no from ar_collected_orders where country_code='VN' and platform='VNTEST' and order_kind='recharge' and completed_at>=('2026-09-19T00:00+07:00'::timestamptz at time zone 'Asia/Ho_Chi_Minh') and completed_at<('2026-09-20T00:00+07:00'::timestamptz at time zone 'Asia/Ho_Chi_Minh')")).rows.map(r=>r['QUERY PLAN']).join('\n');assert.match(plan,/ar_collected_orders_completed_idx/);assert.match(plan,/Index Cond/);
 }finally{await db.exec('reset enable_seqscan');}
 assert.doesNotMatch(migration,/\b(?:insert\s+into|delete\s+from|truncate|drop\s+table)\b/i);
});
test('legacy GAME66 SQL/query/search fixtures also pass after overlaying the unified migration',()=>{
 // Reuse the original behavioral assertions, but execute this migration last.
 // Only the explicitly changed wire contract (lossless decimal strings and
 // additive metadata) is projected back to its legacy shape for those tests.
 const {spawnSync}=require('node:child_process');
 const fixture=fs.readFileSync(__filename,'utf8').split('\n').filter(line=>/^ create table (ar_config_targets|ar_collected_orders|newar_detail_platforms|newar_detail_records)\(/.test(line)).join('\n');
 for(const filename of ['order-time-query.test.cjs','order-detail-search.test.cjs']){
  const program=`const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
   const fixture=${JSON.stringify(fixture)},migration=${JSON.stringify(migration)};
   const {PGlite}=require('@electric-sql/pglite');
   const exec=PGlite.prototype.exec,query=PGlite.prototype.query;let overlays=0;
   process.on('beforeExit',()=>{if(!overlays)throw Error('Unified migration was not overlaid');});
   const isSearch=${filename==='order-detail-search.test.cjs'};
   PGlite.prototype.exec=async function(sql,...rest){
    const result=await exec.call(this,sql,...rest);
    const target=isSearch ? sql.includes('create or replace function private.dashboard_order_detail_search') : sql.includes('p_reference_start timestamptz');
    if(target && !this.__unifiedOverlay){this.__unifiedOverlay=true;await exec.call(this,fixture);await exec.call(this,migration);overlays++;}
    return result;
   };
   PGlite.prototype.query=async function(...args){const result=await query.apply(this,args);
    for(const record of result.rows||[]){const data=record.data;if(!data||!Array.isArray(data.rows))continue;
     if('hasMore' in data){delete data.source;delete data.country;
      for(const row of data.rows){delete row.currency;delete row.amount_text;for(const key of ['amount','actual_amount','withdraw_fee'])if(row[key]!=null)row[key]=Number(row[key]);}}
    }return result;
   };
   const file=${JSON.stringify(path.join(__dirname,filename))};
   let source=fs.readFileSync(file,'utf8').replace("assert.deepEqual((await db.query(oldSql)).rows,oldDefinitions,'new search must not mutate the old APIs');",'');
   const mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));mod._compile(source,file);`;
  const result=spawnSync(process.execPath,['-e',program],{cwd:root,encoding:'utf8',timeout:60000,env:process.env});
  assert.equal(result.status,0,`${filename} against unified SQL:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout,/fail 0/);
 }
});
