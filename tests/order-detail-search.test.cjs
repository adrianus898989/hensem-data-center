const assert=require('node:assert/strict');
const {test,before,after}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260919101327_order_detail_search.sql'),'utf8');
const platform='00000000-0000-0000-0000-000000000001';
const hiddenPlatform='00000000-0000-0000-0000-000000000002';
const start='2026-09-18T00:00:00+05:30',end='2026-09-19T00:00:00+05:30';
let db,oldDefinitions;
const signature='(uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz,text[],text[],jsonb,integer,text,text,text,boolean,numeric,numeric)';
const defaultArgs={platform,start,end,basis:'created',direction:'all',createdStart:null,createdEnd:null,providers:null,types:null,cursor:null,limit:50,member:null,order:null,status:'all',crossDay:false,min:null,max:null};
async function search(overrides={}){
  const p={...defaultArgs,...overrides};
  const args=Object.keys(defaultArgs).map(k=>p[k]);
  return (await db.query('select public.dashboard_order_detail_search('+args.map((_,i)=>'$'+(i+1)).join(',')+') as data',args)).rows[0].data;
}
async function identity(allowed='yes',uid='10000000-0000-0000-0000-000000000001'){
  await db.query("select set_config('test.allowed',$1,false),set_config('test.uid',$2,false)",[allowed,uid]);
}
before(async()=>{
  db=new PGlite();
  await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;
    grant usage on schema auth,private to authenticated;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function public.dashboard_has_permission(text) returns boolean language sql as $$select case current_setting('test.allowed',true) when 'unset' then null else current_setting('test.allowed',true)='yes' end$$;
    create function private.dashboard_current_data_scope() returns jsonb language sql as $$select '{}'::jsonb$$;
    create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql as $$select $2='HK_TEAM' and $3='EK7'$$;
    create table game66_platforms(id uuid primary key,platform_name text,team_name text,team_code text);
    create table game66_charge_orders(id uuid primary key default gen_random_uuid(),platform_id uuid,uid text,order_num text,out_trade_no text,pay_time timestamptz,create_time timestamptz,status_code text,status_text text,pay_method_name text,pay_mode text,amount_display numeric,amount_minor numeric,last_seen_at timestamptz,raw_payload jsonb,phone text,bank_account text);
    create table game66_withdraw_orders(id uuid primary key default gen_random_uuid(),platform_id uuid,uid text,order_num text,out_trade_no text,update_time timestamptz,create_time timestamptz,status_code text,status_text text,pay_channel text,pay_method_name text,payout_mode text,amount_display numeric,amount_minor numeric,real_amount_display numeric,real_amount_minor numeric,fee_display numeric,fee_minor numeric,last_seen_at timestamptz,raw_payload jsonb,phone text,bank_account text);
    create index game66_charge_orders_platform_time_idx on game66_charge_orders(platform_id,create_time desc);
    create index game66_withdraw_orders_platform_time_idx on game66_withdraw_orders(platform_id,create_time desc);
    insert into game66_platforms values('${platform}','EK7','香港','hong_kong'),('${hiddenPlatform}','66GAME','红膏蟹','red_crab');`);
  for(const filename of ['20260919083628_order_time_query.sql','20260919085244_order_time_details.sql','20260919095550_order_time_reference_start.sql']){
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',filename),'utf8'));
  }
  const oldSql="select n.nspname,p.proname,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('dashboard_order_time_query','dashboard_order_time_details') order by n.nspname,p.proname";
  oldDefinitions=(await db.query(oldSql)).rows;
  await db.exec(migration);
  assert.deepEqual((await db.query(oldSql)).rows,oldDefinitions,'new search must not mutate the old APIs');
  await identity();
  const charges=[
    ['C-OLD','00123','00009','2026-09-17T10:00:00+05:30','2026-09-18T10:00:00+05:30','1',100,99999],
    ['C-FRACTION','1','THIRD-FRACTION','2026-09-18T10:00:00+05:30','2026-09-18T23:59:59.999+05:30','1',200,20000],
    ['C-PENDING','00123','THIRD-PENDING','2026-09-18T10:00:00+05:30',null,'0',400,40000],
    ['C-MONTH','00123','THIRD-MONTH','2026-08-30T10:00:00+05:30','2026-09-18T11:00:00+05:30','1',50,5000],
    ['C-MINOR','00123','THIRD-MINOR','2026-09-18T10:00:00+05:30','2026-09-18T10:00:00+05:30','1',null,12345],
    ['C-NULL-STATUS','00123','THIRD-UNKNOWN','2026-09-18T10:00:00+05:30',null,null,0,0],
    ['C-END','00123','THIRD-END','2026-09-19T00:00:00+05:30','2026-09-19T00:00:00+05:30','1',900,90000],
    ['C-START','00123','THIRD-START','2026-09-18T00:00:00+05:30','2026-09-18T00:00:00+05:30','1',1,100],
  ];
  for(const [order,uid,third,created,paid,status,display,minor] of charges)await db.query(`insert into game66_charge_orders(platform_id,order_num,uid,out_trade_no,create_time,pay_time,status_code,amount_display,amount_minor,pay_method_name,pay_mode,last_seen_at,raw_payload,phone,bank_account) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'PayA','UPI',now(),'{"secret":true}','private','private')`,[platform,order,uid,third,created,paid,status,display,minor]);
  const withdrawals=[['W-OLD','3',80,78,2,'2026-09-17T10:00:00+05:30','2026-09-18T10:00:00+05:30'],['W-PENDING','1',90,88,2,'2026-09-18T10:00:00+05:30',null],['W-FAIL','2',13,12,1,'2026-09-18T10:00:00+05:30',null],['W-REJECT','-1',17,16,1,'2026-09-18T10:00:00+05:30',null],['W-UNKNOWN','future',19,18,1,'2026-09-18T10:00:00+05:30',null]];
  for(const [order,status,amount,actual,fee,created,paid] of withdrawals)await db.query(`insert into game66_withdraw_orders(platform_id,order_num,uid,out_trade_no,status_code,amount_display,real_amount_display,fee_display,create_time,update_time,pay_channel,payout_mode,last_seen_at,raw_payload,phone,bank_account) values($1,$2,'00123',$3,$4,$5,$6,$7,$8,$9,'PayB','BANK',now(),'{"secret":true}','private','private')`,[platform,order,'THIRD-'+order,status,amount,actual,fee,created,paid]);
  await db.query(`insert into game66_charge_orders(platform_id,order_num,uid,create_time,status_code,amount_display) values($1,'HIDDEN','00123',$2,'1',1)`,[hiddenPlatform,start]);
});
after(async()=>{if(db)await db.close();});

test('standalone API has one 17-argument signature per schema and least-privilege grants',async()=>{
  const records=(await db.query("select n.nspname,p.pronargs,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('authenticated',p.oid,'execute') as authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='dashboard_order_detail_search' order by n.nspname")).rows;
  assert.equal(records.length,2);
  for(const record of records){
    assert.equal(Number(record.pronargs),17);assert.equal(record.anon,false);assert.equal(record.authenticated,true);
    assert.ok(record.proconfig.includes('search_path=""'));
    assert.equal(record.prosecdef,record.nspname==='private');
  }
  await db.exec('set role authenticated');
  try{
    assert.ok((await search()).rows.length>0);
    await assert.rejects(()=>db.query('select uid from public.game66_charge_orders'),/permission denied/);
  }finally{await db.exec('reset role');}
  await db.exec('set role anon');
  try{await assert.rejects(()=>search(),/permission denied/);}finally{await db.exec('reset role');}
});
test('platform is required, singular and restricted by team/platform scope',async()=>{
  await assert.rejects(()=>search({platform:null}),/请选择单个平台/);
  await assert.rejects(()=>search({platform:hiddenPlatform}),/无权查看此平台/);
  await assert.rejects(()=>search({platform:'00000000-0000-0000-0000-000000000003'}),/无权查看此平台/);
  assert.ok((await search({member:'00123'})).rows.every(r=>r.order_number!=='HIDDEN'));
});
test('creation and success axes retain independent semantics and half-open timestamps',async()=>{
  const created=await search(),success=await search({basis:'success'});
  assert.ok(!created.rows.some(r=>r.order_number==='C-OLD'));
  assert.ok(success.rows.some(r=>r.order_number==='C-OLD'));
  assert.ok(success.rows.some(r=>r.order_number==='C-MONTH'),'success axis includes previous-month creation unless constrained');
  assert.ok(success.rows.some(r=>r.order_number==='C-FRACTION'),'include final fractional second before the exclusive end');
  assert.ok(success.rows.some(r=>r.order_number==='C-START'));
  assert.ok(!success.rows.some(r=>r.order_number==='C-END'));
  assert.ok(success.rows.every(r=>r.succeeded===true));
  const constrained=await search({basis:'success',createdStart:'2026-09-01T00:00:00+05:30',createdEnd:start});
  assert.deepEqual(constrained.rows.map(r=>r.order_number).sort(),['C-OLD','W-OLD']);
});
test('member and both order identifiers are trimmed exact strings, preserving leading zero',async()=>{
  assert.ok((await search({member:' 00123 '})).rows.length>0);
  assert.equal((await search({member:'123'})).rows.length,0);
  assert.deepEqual((await search({member:'1'})).rows.map(r=>r.order_number),['C-FRACTION']);
  for(const order of [' C-OLD ',' 00009 '])assert.equal((await search({basis:'success',order})).rows[0].order_number,'C-OLD');
  assert.equal((await search({basis:'success',order:'9'})).rows.length,0);
  assert.equal((await search({order:'C-%'})).rows.length,0);
  assert.equal((await search({order:"' OR true --"})).rows.length,0);
});
test('inclusive amount bounds use original display amount or minor units, never arrival/fees',async()=>{
  const exact=await search({basis:'success',min:'80.00',max:'80.00'});
  assert.equal(exact.rows.length,1);assert.equal(exact.rows[0].order_number,'W-OLD');
  assert.equal(exact.rows[0].amount,80);assert.equal(exact.rows[0].actual_amount,78);assert.equal(exact.rows[0].withdraw_fee,2);
  assert.equal((await search({basis:'success',min:78,max:78})).rows.length,0);
  assert.equal((await search({basis:'success',min:2,max:2})).rows.length,0);
  assert.equal((await search({basis:'success',min:100,max:100})).rows[0].amount,100,'display amount wins over stale/different minor value');
  assert.equal((await search({min:'123.45',max:'123.45'})).rows[0].order_number,'C-MINOR');
  assert.equal((await search({min:0,max:0})).rows[0].order_number,'C-NULL-STATUS');
  assert.ok((await search({max:19})).rows.every(r=>r.amount<=19));
  assert.ok((await search({min:200})).rows.every(r=>r.amount>=200));
});
test('status filters are direction-specific; success-time never treats pending as successful',async()=>{
  const expectations={pending:['C-PENDING','W-PENDING'],failed:['W-FAIL'],rejected:['W-REJECT'],unknown:['C-NULL-STATUS','W-UNKNOWN']};
  for(const [status,expected] of Object.entries(expectations)){
    const page=await search({status});
    assert.deepEqual(page.rows.map(r=>r.order_number).sort(),expected);
    assert.ok(page.rows.every(r=>r.status_group===status&&r.succeeded===false));
    assert.equal((await search({status,basis:'success'})).rows.length,0);
  }
  assert.ok((await search({status:'success'})).rows.every(r=>r.succeeded));
});
test('direction, provider/type, and cross-day filters combine before pagination',async()=>{
  assert.ok((await search({direction:'charge'})).rows.every(r=>r.direction==='charge'));
  assert.ok((await search({direction:'withdraw'})).rows.every(r=>r.direction==='withdraw'));
  assert.deepEqual((await search({basis:'success',providers:['PayB'],types:['BANK']})).rows.map(r=>r.order_number),['W-OLD']);
  assert.equal((await search({providers:['PayB'],types:['UPI']})).rows.length,0);
  assert.equal((await search({providers:[]})).rows.length,0);
  const cross=await search({basis:'success',crossDay:true});
  assert.deepEqual(cross.rows.map(r=>r.order_number).sort(),['C-MONTH','C-OLD','W-OLD']);
  assert.ok(cross.rows.every(r=>r.cross_day));
});
test('only the intended detail fields are returned, with no count-all or private payload',async()=>{
  const result=await search();
  assert.deepEqual(Object.keys(result).sort(),['hasMore','nextCursor','platform','rows','timezone']);
  assert.equal(result.platform,'EK7');assert.equal(result.timezone,'Asia/Kolkata');
  const expected=['id','axis','direction','order_number','member_id','third_party_order_number','provider','channel_type','status','status_code','status_group','succeeded','created_at','success_at','amount','actual_amount','withdraw_fee','synced_at','cross_day'].sort();
  for(const row of result.rows)assert.deepEqual(Object.keys(row).sort(),expected);
  assert.ok(result.rows.filter(r=>r.direction==='charge').every(r=>r.actual_amount===null&&r.withdraw_fee===null));
});
test('invalid amount, time, cursor and row-limit input fails closed',async()=>{
  for(const bad of [-1,'NaN','Infinity','-Infinity'])for(const key of ['min','max'])await assert.rejects(()=>search({[key]:bad}),/无效金额范围/);
  await assert.rejects(()=>search({min:2,max:1}),/无效金额范围/);
  for(const limit of [0,51,200,null])await assert.rejects(()=>search({limit}),/无效查询条件/);
  for(const override of [{start:null},{end:null},{start:'infinity'},{end:'infinity'},{end:start},{start:'2026-08-01T00:00:00+05:30'},{basis:'invalid'},{direction:'invalid'},{status:'invalid'},{crossDay:null},{member:'x'.repeat(201)},{order:'x'.repeat(201)},{createdStart:start},{basis:'success',createdStart:end,createdEnd:start}])await assert.rejects(()=>search(override),/无效查询条件/);
  for(const cursor of [{},[],{at:'infinity',direction:'charge',id:platform},{at:start,direction:'bad',id:platform},{at:start,direction:'charge',id:'not-uuid'},{at:'not-date',direction:'charge',id:platform}])await assert.rejects(()=>search({cursor}),/无效分页位置/);
});
test('authentication and module permission are required, including null permission',async()=>{
  for(const allowed of ['no','unset']){
    await identity(allowed);
    await assert.rejects(()=>search(),/没有三方查询权限/);
  }
  await identity('yes','');
  await assert.rejects(()=>search(),/请先登录/);
  await identity();
});
test('keyset pagination caps at 50, keeps timestamp ties and has no gaps across directions',async()=>{
  await db.query(`insert into game66_charge_orders(id,platform_id,uid,order_num,create_time,pay_time,status_code,amount_display,pay_method_name,pay_mode)
    select ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,$1,'PAGED','PAGE-C-'||n,$2::timestamptz,$2::timestamptz,'1',10,'PayA','UPI' from generate_series(1,57) n`,[platform,'2026-09-18T12:00:00+05:30']);
  await db.query(`insert into game66_withdraw_orders(id,platform_id,uid,order_num,create_time,update_time,status_code,amount_display,pay_channel,payout_mode)
    select ('30000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,$1,'PAGED','PAGE-W-'||n,$2::timestamptz,$2::timestamptz,'3',10,'PayB','BANK' from generate_series(1,7) n`,[platform,'2026-09-18T12:00:00+05:30']);
  const first=await search({member:'PAGED'});
  assert.equal(first.rows.length,50);assert.equal(first.hasMore,true);
  const second=await search({member:'PAGED',cursor:first.nextCursor});
  assert.equal(second.rows.length,14);assert.equal(second.hasMore,false);assert.equal(second.nextCursor,null);
  assert.equal(new Set([...first.rows,...second.rows].map(r=>r.id)).size,64);
  const ids=[];let cursor=null;
  do{
    const page=await search({member:'PAGED',limit:3,cursor,min:10,max:10,providers:['PayA']});
    ids.push(...page.rows.map(r=>r.id));cursor=page.nextCursor;
    assert.equal(page.hasMore,cursor!==null);
  }while(cursor);
  assert.equal(ids.length,57);assert.equal(new Set(ids).size,57);
});
test('migration stays read-only on order tables and limits both candidate branches before JSON encoding',()=>{
  assert.doesNotMatch(migration,/\b(?:create\s+index|alter\s+table|insert\s+into|update\s+public\.|delete\s+from|count\s*\(\s*\*\s*\))\b/i);
  assert.match(migration,/c\.%1\$I <= \(\$10->>'at'\)::timestamptz/);
  assert.match(migration,/w\.%2\$I <= \(\$10->>'at'\)::timestamptz/);
  assert.equal((migration.match(/order by axis desc,id desc limit \$11\+1/g)||[]).length,2);
  assert.match(migration,/select \* from charge_page union all select \* from withdraw_page/);
});
