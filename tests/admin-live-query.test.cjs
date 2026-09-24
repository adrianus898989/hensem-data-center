// Offline synthetic database only. No production connection or source values.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const repo=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(repo,'supabase/admin-live-query.sql'),'utf8');
const owner='10000000-0000-0000-0000-000000000001',viewer='10000000-0000-0000-0000-000000000002';
const game='00000000-0000-0000-0000-000000000001',hidden='00000000-0000-0000-0000-000000000002';
const from='2026-09-19T00:00:00+05:30',to='2026-09-20T00:00:00+05:30';
let db,ar,newar,inTransaction=false;
const fixture=fs.readFileSync(path.join(repo,'tests/uploaded-order-sources.test.cjs'),'utf8').split('\n')
  .filter(line=>/^ create (table (game66_platforms|game66_charge_orders|game66_withdraw_orders|ar_config_targets|ar_collected_orders|newar_detail_platforms|newar_detail_records)\(|index (game66_charge_time_idx|game66_withdraw_time_idx|ar_collected_orders_applied_idx))/.test(line)).join('\n');
const req=(overrides={})=>({action:'query',platformId:game,startAt:from,endAt:to,direction:'all',status:'all',offset:0,limit:20,...overrides});
async function call(request={action:'catalog'}) {return (await db.query('select public.dashboard_admin_live_query($1::jsonb) as data',[JSON.stringify(request)])).rows[0].data;}
async function as(user=owner){await db.query("select set_config('test.uid',$1,false)",[user]);}
async function rollback(fn){await db.exec('begin');inTransaction=true;try{return await fn()}finally{await db.exec('rollback');inTransaction=false;}}
async function rejects(fn,expected){
  if(!inTransaction)return assert.rejects(fn,expected);
  await db.exec('savepoint expected_failure');
  try{return await assert.rejects(fn,expected)}finally{await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure');}
}
function count(rows,key='all_count'){return rows.reduce((n,r)=>n+Number(r[key]),0);}
function amount(rows,key='all_amount'){return rows.reduce((n,r)=>n+Number(r[key]),0);}
before(async()=>{
  db=new PGlite();
  await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;
    grant usage on schema auth,private to authenticated;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create table dashboard_profiles(auth_user_id uuid primary key,role text,active boolean,data_scope jsonb,permissions jsonb);
    create table dashboard_admin_preview_grants(auth_user_id uuid primary key,can_view boolean not null);
    create function private.dashboard_current_data_scope() returns jsonb language sql stable security definer set search_path='' as $$
      select coalesce((select case when p.role='owner' then '{"mode":"all","countries":[]}'::jsonb
        else p.data_scope end from public.dashboard_profiles p where p.auth_user_id=auth.uid() and p.active is true),
        '{"mode":"selected","countries":[]}'::jsonb)$$;
    create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$
      select coalesce($1->>'mode'='all' or ($1->>'mode'='selected' and $1->'countries' ? $2),false)$$;
    ${fixture}
    alter table game66_charge_orders add column status_group text;
    insert into dashboard_profiles values
      ('${owner}','owner',true,'{"mode":"all","countries":[]}','{}'),
      ('${viewer}','viewer',true,'{"mode":"selected","countries":["HK_TEAM"]}','{}');
    insert into dashboard_admin_preview_grants values('${viewer}',true);
    insert into game66_platforms values('${game}','EXAMPLE','香港','hong_kong'),('${hidden}','HIDDEN','红膏蟹','red_crab');
    insert into ar_config_targets values('IN','AR-EXAMPLE','印度','Asia/Kolkata',null,'AR');
    insert into newar_detail_platforms values('NEW-EXAMPLE','NP','尼泊尔','Asia/Kathmandu','NPR',true,null),
      ('DISABLED','IN','印度','Asia/Kolkata','INR',false,null),('FUTURE','IN','印度','Asia/Kolkata','INR',true,'2200-01-01Z');
    insert into game66_charge_orders(id,platform_id,order_num,uid,out_trade_no,create_time,pay_time,status_code,status_group,amount_display,pay_method_name,pay_mode,last_seen_at,raw_payload,phone,bank_account) values
      ('00000000-0000-0000-0000-000000000010','${game}','START','0001','TP-START','2026-09-19T00:00:00+05:30','2026-09-19T00:05:00+05:30','1','success',100,'P1','UPI','2026-09-19T01:00Z','{"phone":"SECRET-PHONE","bank":"SECRET-BANK"}','SECRET-PHONE','SECRET-BANK'),
      ('00000000-0000-0000-0000-000000000011','${game}','LAST','0001','TP-LAST','2026-09-19T23:59:59.999+05:30','2026-09-20T00:29:59.999+05:30','1','success',200,'P1','UPI','2026-09-19T20:00Z',null,null,null),
      ('00000000-0000-0000-0000-000000000012','${game}','FAIL','0002','TP-FAIL','2026-09-19T02:00:00+05:30',null,'0','failed',300,'P2','BANK','2026-09-19T20:00Z',null,null,null),
      ('00000000-0000-0000-0000-000000000013','${game}','PENDING','0003','TP-PENDING','2026-09-19T03:00:00+05:30',null,'0','pending',400,'P2','BANK','2026-09-19T20:00Z',null,null,null),
      ('00000000-0000-0000-0000-000000000014','${game}','END','0001','TP-END','2026-09-20T00:00:00+05:30',null,'1','success',999999,'P1','UPI',null,null,null,null),
      ('00000000-0000-0000-0000-000000000015','${hidden}','HIDDEN','0001','TP-HIDDEN','2026-09-19T00:00:00+05:30',null,'1','success',888888,'PRIVATE','UPI',null,null,null,null);
    insert into game66_withdraw_orders(id,platform_id,order_num,uid,out_trade_no,create_time,update_time,status_code,amount_minor,real_amount_minor,fee_minor,pay_channel,payout_mode,last_seen_at) values
      ('00000000-0000-0000-0000-000000000020','${game}','W-SUCCESS','0001','TP-W','2026-09-19T04:00:00+05:30','2026-09-19T05:00:00+05:30','3',50000,49000,1000,'P1','BANK','2026-09-19T20:00Z'),
      ('00000000-0000-0000-0000-000000000021','${game}','W-REJECT','0002',null,'2026-09-19T05:00:00+05:30',null,'-1',75000,null,null,'P2','BANK','2026-09-19T20:00Z'),
      ('00000000-0000-0000-0000-000000000022','${game}','W-UNKNOWN','0002',null,'2026-09-19T06:00:00+05:30',null,'77',100000,null,null,'P2','BANK','2026-09-19T20:00Z');
    insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,amount_text,status,applied_at,completed_at,raw_channel,channel_type) values
      ('AR','IN','AR-EXAMPLE','recharge','A-POS','0004',100,'100','已支付','2026-09-19 10:00','2026-09-19 10:05','P3','UPI'),
      ('AR','IN','AR-EXAMPLE','recharge','A-NEG','0004',null,'-19.57','已支付','2026-09-19 11:00','2026-09-19 11:00','人工充值','UPI'),
      ('AR','IN','AR-EXAMPLE','recharge','A-UNKNOWN','0004',null,'SECRET-FREE-TEXT','已支付','2026-09-19 12:00',null,'P3','UPI'),
      ('AR','IN','AR-EXAMPLE','withdraw','A-REJECT','0004',200,'200','未通过','2026-09-19 13:00',null,'P3','BANK');
    insert into newar_detail_records(platform,dataset,source_id,member_id,order_number,third_party_order_number,provider,channel_type,currency,amount,status_code,status_group,created_at,success_at) values
      ('NEW-EXAMPLE','charge','SYS-1','0005','N1','TP-N1','P4','BANK','NPR',1500,'1','success','2026-09-19T00:00:00+05:45','2026-09-19T00:05:00+05:45'),
      ('NEW-EXAMPLE','withdraw','SYS-2','0005','N2','TP-N2','P4','BANK','USD',20,'1','success','2026-09-19T01:00:00+05:45','2026-09-19T02:00:00+05:45'),
      ('NEW-EXAMPLE','workorder','SYS-W','0005','NOT-ORDER',null,'P4','BANK','NPR',99999,'1','success','2026-09-19T01:00:00+05:45',null),
      ('DISABLED','charge','D','0005','DISABLED',null,'P4','BANK','INR',1,'1','success','2026-09-19T01:00:00+05:30',null),
      ('FUTURE','charge','F','0005','FUTURE',null,'P4','BANK','INR',1,'1','success','2026-09-19T01:00:00+05:30',null);`);
  await db.exec(sql);await as();
  const catalog=await call();ar=catalog.platforms.find(x=>x.source==='ar').id;newar=catalog.platforms.find(x=>x.source==='newar').id;
});
after(async()=>{if(db)await db.close()});

test('only new functions are added; no old RPC, table or ingestion mutation',()=>{
  assert.doesNotMatch(sql,/\b(create or replace|insert into|update public\.|delete from|alter table|create table|create index)\b/i);
  assert.doesNotMatch(sql,/dashboard_has_permission\s*\(/);
  assert.doesNotMatch(sql,/\bselect\s+[^;]*raw_payload/i);
  for(const name of [...sql.matchAll(/create function (\S+)\(/g)].map(m=>m[1]))assert.match(name,/^private\.dashboard_admin_live_|^public\.dashboard_admin_live_query$/);
});

test('catalog keeps source identity, timezone/currency/scope; disabled/future/workorder-only sources excluded',async()=>{
  const r=await call();assert.equal(r.version,1);assert.equal(r.platforms.length,4);
  const a=r.platforms.find(p=>p.id===ar),n=r.platforms.find(p=>p.id===newar);
  assert.equal(a.currency,'INR');assert.equal(a.scopeGroup,'IN');assert.equal(a.source,'ar');
  assert.equal(a.team,null);assert.equal(n.team,null,'country is not a verified team assignment');
  assert.equal(n.timezone,'Asia/Kathmandu');assert.equal(n.capabilities.systemOrderId,true);
  assert.equal(r.platforms.find(p=>p.id===game).scopeGroup,'HK_TEAM');
  assert(!JSON.stringify(r).includes('NOT-ORDER'));assert(!r.platforms.some(p=>['DISABLED','FUTURE'].includes(p.name)));
});

test('independent granted viewer works without third_party grant and remains scoped; revocation/disable immediate',async()=>rollback(async()=>{
  await as(viewer);await db.exec('set role authenticated');
  try{
    assert.deepEqual((await call()).platforms.map(p=>p.id),[game]);
    assert.equal((await call(req())).total,7);
    await rejects(()=>call(req({platformId:hidden})),/platform_denied/);
    await rejects(()=>db.query('select * from public.game66_charge_orders'),/permission denied/);
    await rejects(()=>db.query('select private.dashboard_admin_live_platforms()'),/permission denied/);
  }finally{await db.exec('reset role');}
  await db.query('update dashboard_admin_preview_grants set can_view=false where auth_user_id=$1',[viewer]);
  await rejects(()=>call(),/preview_denied/);
  await db.query('update dashboard_admin_preview_grants set can_view=true where auth_user_id=$1',[viewer]);
  await db.query('update dashboard_profiles set data_scope=$2 where auth_user_id=$1',[viewer,'{"mode":"selected","countries":["IN"]}']);
  assert.deepEqual((await call()).platforms.map(p=>p.id),[ar]);
  await rejects(()=>call(req()),/platform_denied/);
  await db.query('update dashboard_profiles set active=false where auth_user_id=$1',[viewer]);
  await rejects(()=>call(),/preview_denied/);
}));

test('anonymous/absent/inactive owner denied; anonymous role has no execute',async()=>rollback(async()=>{
  await as('');await rejects(()=>call(),/login_required/);
  await as('10000000-0000-0000-0000-000000000099');await rejects(()=>call(),/preview_denied/);
  await as();await db.query('update dashboard_profiles set active=false where auth_user_id=$1',[owner]);
  await rejects(()=>call(),/preview_denied/);
  await db.exec('set role anon');try{await rejects(()=>call(),/permission denied/)}finally{await db.exec('reset role')}
}));

test('complete summary, every grouping and same page conserve all six status groups and money',async()=>{
  const r=await call(req());assert.equal(r.total,7);assert.equal(r.rows.length,7);assert.equal(r.hasMore,false);
  assert.equal(count(r.summary),7);assert.equal(amount(r.summary),3250);
  assert.equal(count(r.summary,'success_count'),3);assert.equal(amount(r.summary,'success_amount'),800);
  assert.equal(count(r.summary,'pending_count'),1);assert.equal(count(r.summary,'failed_count'),1);
  assert.equal(count(r.summary,'rejected_count'),1);assert.equal(count(r.summary,'unknown_count'),1);
  for(const name of ['provider','daily','hourly','amount','matrix','amount_range','matrix_range']){
    assert.equal(count(r.groups[name]),7,name);assert.equal(amount(r.groups[name]),3250,name);
  }
  assert(r.groups.daily.every(x=>x.provider&&x.date==='2026-09-19'));
  assert.deepEqual(r.rows.map(x=>x.order_number),['LAST','W-UNKNOWN','W-REJECT','W-SUCCESS','PENDING','FAIL','START']);
  assert.equal(Number(r.rows.find(x=>x.order_number==='W-SUCCESS').withdraw_fee),10);
  assert.equal(r.rows.find(x=>x.order_number==='START').amount,'100');
  const serialized=JSON.stringify(r);for(const secret of ['SECRET-PHONE','SECRET-BANK','SECRET-FREE-TEXT','raw_payload','bank_account','phone'])assert(!serialized.includes(secret),secret);
});

test('exact identifiers/provider/channel/direction/status/amount filters AND together for both page and all aggregates',async()=>{
  const r=await call(req({orderNumber:'LAST',thirdPartyOrderNumber:'TP-LAST',memberId:'0001',providers:['P1'],channelTypes:['UPI'],direction:'charge',status:'success',amountMin:'200',amountMax:'200'}));
  assert.equal(r.total,1);assert.equal(r.rows[0].order_number,'LAST');assert.equal(count(r.summary),1);
  assert.equal((await call(req({orderNumber:'LAST',memberId:'0002'}))).total,0);
  assert.equal((await call(req({orderNumber:'TP-LAST'}))).total,0,'order number must not match a third-party number');
  assert.equal((await call(req({thirdPartyOrderNumber:'LAST'}))).total,0,'third-party number must not match a local order number');
  assert.equal((await call(req({thirdPartyOrderNumber:'TP-LAS'}))).total,0);
  assert.equal((await call(req({status:'failed'}))).rows[0].order_number,'FAIL');
  const n=await call(req({platformId:newar,startAt:'2026-09-19T00:00:00+05:45',endAt:'2026-09-20T00:00:00+05:45',systemOrderId:'SYS-2',orderNumber:'N2',thirdPartyOrderNumber:'TP-N2',memberId:'0005'}));
  assert.equal(n.total,1);assert.equal(n.rows[0].currency,'USD');assert.equal(n.rows[0].system_order_id,'SYS-2');
});

test('unknown money remains null, zero and signed adjustment preserved; currencies never merge',async()=>{
  const a=await call(req({platformId:ar}));assert.equal(a.total,4);
  const charge=a.summary.find(x=>x.direction==='charge');assert.equal(charge.all_amount,null);assert.equal(charge.success_amount,null);assert.equal(charge.missing_amount_count,1);
  assert.equal(a.rows.find(x=>x.order_number==='A-NEG').amount,'-19.57');
  assert.equal(a.rows.find(x=>x.order_number==='A-UNKNOWN').amount,null);assert(!JSON.stringify(a).includes('amount_text'));
  assert.equal(a.capabilities.historicalFees,false);assert.equal(a.capabilities.actualAmount,false);
  const n=await call(req({platformId:newar,startAt:'2026-09-19T00:00:00+05:45',endAt:'2026-09-20T00:00:00+05:45'}));
  assert.equal(n.total,2);assert.deepEqual(new Set(n.summary.map(x=>x.currency)),new Set(['NPR','USD']));
  const only=await call(req({platformId:newar,startAt:'2026-09-19T00:00:00+05:45',endAt:'2026-09-20T00:00:00+05:45',currency:'NPR'}));
  assert.equal(only.total,1);assert.equal(only.summary[0].all_amount,'1500');
});

test('amount ranges are disjoint at every boundary and conserve each direction/currency/hour/status without changing exact buckets',async()=>rollback(async()=>{
  const cases=[
    [null,'unknown'],['NaN','unknown'],['Infinity','unknown'],['-Infinity','unknown'],
    ['-19.57','other'],['0','other'],['99.999','other'],
    ['100','100–200'],['199.999','100–200'],['200','200–300'],['299.999','200–300'],
    ['300','300–400'],['399.999','300–400'],['400','400–500'],['499.999','400–500'],
    ['500','500–1,000'],['999.999','500–1,000'],['1000','1,000–2,000'],['1999.999','1,000–2,000'],
    ['2000','2,000–5,000'],['4999.999','2,000–5,000'],['5000','≥5,000'],['5000.001','≥5,000'],['10000','≥5,000']
  ];
  const statusNames=['success','pending','failed','rejected','unknown'],expected=[];
  const exactAmounts=new Set([100,200,300,400,500,750,1000,1500,2000,5000]);
  for(const direction of ['charge','withdraw'])for(const currency of ['NPR','USD'])for(let i=0;i<cases.length;i++){
    const [raw,bucket]=cases[i],hour=Math.floor(i/2),status=statusNames[i%statusNames.length],id=`RANGE-${direction}-${currency}-${i}`;
    const created=`2026-09-19T${String(hour).padStart(2,'0')}:00:00+05:45`;
    await db.query(`insert into newar_detail_records(platform,dataset,source_id,member_id,order_number,provider,channel_type,currency,amount,status_code,status_group,created_at,success_at)
      values('NEW-EXAMPLE',$1,$2,'RANGES',$2,'Range Provider','BANK',$3,$4,$5,$5,$6::timestamptz,
        case when $5='success' then $6::timestamptz+interval '5 minutes' end)`,[direction,id,currency,raw,status,created]);
    const value=raw===null||!Number.isFinite(Number(raw))?null:Number(raw);
    expected.push({direction,currency,hour,bucket,status,amount:value,exact:value===null?'unknown':exactAmounts.has(value)?String(value):'other'});
  }
  const request=req({platformId:newar,startAt:'2026-09-19T00:00:00+05:45',endAt:'2026-09-20T00:00:00+05:45',memberId:'RANGES',limit:500});
  const r=await call(request);assert.equal(r.total,expected.length);assert.equal(r.rows.length,expected.length);
  function checkGroups(rows,matrix,exact=false,source=expected){
    const keys=new Map();for(const row of source){const key=[row.direction,row.currency,exact?row.exact:row.bucket,...(matrix?[row.hour]:[])].join('|');if(!keys.has(key))keys.set(key,[]);keys.get(key).push(row)}
    assert.equal(rows.length,keys.size,'only occupied buckets are returned without losing or duplicating records');
    for(const row of rows){const key=[row.direction,row.currency,row.bucket,...(matrix?[row.hour]:[])].join('|'),items=keys.get(key);assert(items,`unexpected group ${key}`);
      for(const status of ['all',...statusNames]){const set=status==='all'?items:items.filter(x=>x.status===status);assert.equal(row[status+'_count'],set.length,`${key} ${status} denominator`);
        if(set.some(x=>x.amount===null))assert.equal(row[status+'_amount'],null,`${key} missing amount is unknown`);
        else assert(Math.abs(Number(row[status+'_amount'])-set.reduce((sum,x)=>sum+x.amount,0))<1e-8,`${key} ${status} amount`);
      }
      assert.equal(row.missing_amount_count,items.filter(x=>x.amount===null).length);
      assert(!Object.hasOwn(row,'amount_range_bucket'),'internal classification column must not leak into the public metric shape');
    }
    assert.equal(count(rows),source.length);assert.equal(count(rows,'success_count'),source.filter(x=>x.status==='success').length);
  }
  checkGroups(r.groups.amount_range,false);checkGroups(r.groups.matrix_range,true);
  checkGroups(r.groups.amount,false,true);checkGroups(r.groups.matrix,true,true);
  assert(!r.groups.amount_range.some(x=>/^0[–-]100$/.test(x.bucket)),'sub-100 values stay in other');
  for(const direction of ['charge','withdraw'])for(const currency of ['NPR','USD']){
    assert.equal(count(r.groups.amount_range.filter(x=>x.direction===direction&&x.currency===currency)),cases.length);
    assert.equal(r.summary.find(x=>x.direction===direction&&x.currency===currency).all_amount,null);
  }
  const narrow=await call({...request,direction:'withdraw',currency:'USD',status:'success',providers:['Range Provider'],amountMin:'200',amountMax:'2000'});
  const scoped=expected.filter(x=>x.direction==='withdraw'&&x.currency==='USD'&&x.status==='success'&&x.amount!==null&&x.amount>=200&&x.amount<=2000);
  assert.equal(narrow.total,scoped.length);checkGroups(narrow.groups.amount_range,false,false,scoped);checkGroups(narrow.groups.matrix_range,true,false,scoped);
}));

test('query and aggregate identical full result; details counts full set but skips heavy groups',async()=>{
  const q=await call(req()),a=await call(req({action:'aggregate'})),d=await call(req({action:'details'}));
  assert.deepEqual(a.summary,q.summary);assert.deepEqual(a.groups,q.groups);assert.equal(a.rows.length,0);assert.equal(a.total,q.total);
  assert.equal(d.total,q.total);assert.deepEqual(d.rows,q.rows);assert.deepEqual(d.summary,[]);
  for(const v of Object.values(d.groups))assert.deepEqual(v,[]);
});

test('all page sizes and offsets preserve total; populated deep page cannot reduce aggregate values',async()=>rollback(async()=>{
  await db.exec(`insert into game66_charge_orders(platform_id,order_num,uid,create_time,pay_time,status_code,status_group,amount_display,pay_method_name)
    select '${game}','PAGE-'||n,'PAGE','2026-09-19T08:00:00+05:30'::timestamptz+n*interval '1 millisecond',null,'0','pending',1,'Paged' from generate_series(1,530) n`);
  for(const limit of [20,30,50,100,500]){
    const r=await call(req({memberId:'PAGE',limit}));assert.equal(r.total,530);assert.equal(r.rows.length,limit);assert.equal(r.hasMore,true);assert.equal(count(r.summary),530);
  }
  const last=await call(req({memberId:'PAGE',limit:500,offset:500}));assert.equal(last.total,530);assert.equal(last.rows.length,30);assert.equal(last.hasMore,false);assert.equal(count(last.summary),530);
  assert.equal((await call(req({memberId:'PAGE',limit:500,offset:999}))).rows.length,0);
}));

test('latency mutual bins inclusive maxima, strict cumulative thresholds, invalid time diagnostics and double shares',async()=>rollback(async()=>{
  const edges=[0,300000,1800000,3600000,10800000,21600000,43200000,86400000,172800000,259200000,259200001];
  for(let i=0;i<edges.length;i++)await db.query(`insert into game66_charge_orders(platform_id,order_num,uid,create_time,pay_time,status_code,status_group,amount_display,pay_method_name)
    values($1,$2,'LATENCY','2026-09-10T00:00:00+05:30','2026-09-10T00:00:00+05:30'::timestamptz+$3*interval '1 millisecond','1','success',$4,'Latency')`,[game,'LATENCY-'+i,edges[i],i===0?0:100*(i+1)]);
  for(const [id,time] of [['MISSING',null],['REVERSED','2026-09-09T00:00:00+05:30'],['FUTURE','2200-01-01Z']])await db.query(`insert into game66_charge_orders(platform_id,order_num,uid,create_time,pay_time,status_code,amount_display,pay_method_name)
    values($1,$2,'LATENCY','2026-09-10T00:00:00+05:30',$3,'1',10,'Latency')`,[game,id,time]);
  const r=await call(req({startAt:'2026-09-10T00:00:00+05:30',endAt:'2026-09-11T00:00:00+05:30',memberId:'LATENCY'}));
  assert.equal(r.total,14);const s=r.latencySummary[0];assert.equal(s.candidate_count,14);assert.equal(s.valid_count,11);assert.equal(s.excluded_count,3);
  assert.equal(s.excluded_reasons.missing_success_at,1);assert.equal(s.excluded_reasons.reversed_time,1);assert.equal(s.excluded_reasons.future_success_at,1);
  assert.equal(r.groups.latency.length,10);assert.equal(count(r.groups.latency,'count'),11);
  assert.equal(r.groups.latency[0].count,2);assert.equal(r.groups.latency[9].count,1);
  const first=r.groups.latency_thresholds[0];assert.equal(first.threshold_ms,300000);assert.equal(first.count,9);
  assert.equal(r.groups.latency_thresholds.at(-1).count,1);assert.notEqual(first.count_share,first.amount_share);
  assert.equal(amount(r.groups.latency,'amount'),Number(s.valid_amount));assert.equal(s.p50_ms,21600000);assert(s.p95_ms>172800000);
}));

test('pending ages explicitly describe selected payout creation cohort and query asOf; bins reconcile',async()=>rollback(async()=>{
  assert.deepEqual((await call(req())).groups.pending_age,[],'pending collections must not enter payout waiting');
  await db.exec(`insert into game66_withdraw_orders(platform_id,order_num,uid,create_time,status_code,amount_display,pay_channel)
    values('${game}','WAIT-PAYOUT','WAIT','2026-09-19T03:00:00+05:30','1',400,'Wait')`);
  const r=await call(req());assert.equal(r.capabilities.pendingBasis,'selected_created_cohort_current_stored_status');
  assert.equal(r.capabilities.asOfBasis,'query_time_not_source_snapshot');assert.equal(r.capabilities.sourceCompletenessVerified,false);
  assert.equal(count(r.groups.pending_age,'count'),1);assert.equal(r.pendingSummary[0].candidate_count,1);
  assert.equal(r.pendingSummary[0].valid_count,1);assert.equal(r.pendingSummary[0].valid_amount,'400');
}));

test('malformed/unknown fields and unsupported filters cannot silently broaden a query',async()=>{
  for(const bad of [{...req(),limit:200},{...req(),offset:-1},{...req(),offset:1.5},{...req(),startAt:'not-a-date'},
    {...req(),endAt:'2026-10-21T00:00:00+05:30'}, {...req(),providers:[{}]}, {...req(),providers:'P1'},
    {...req(),utr:'REF'}, {...req(),systemOrderId:'SYS'}, {...req(),status:'other'}, {...req(),direction:'deposit'},
    {...req(),amountMin:'NaN'}, {...req(),amountMin:'10',amountMax:'1'}, {...req(),unknown:'ignored'},
    {action:'catalog',platformId:game},null,[],{action:'other'}])await assert.rejects(()=>call(bad));
});

test('source-time range honors Nepal midnight and end-exclusive subsecond edge',async()=>{
  const n=await call(req({platformId:newar,startAt:'2026-09-18T18:15:00Z',endAt:'2026-09-18T18:15:00.001Z'}));
  assert.equal(n.total,1);assert.equal(n.groups.daily[0].date,'2026-09-19');assert.equal(n.groups.hourly[0].hour,0);
  const x=await call(req({startAt:'2026-09-19T18:29:59Z',endAt:'2026-09-19T18:30:00Z'}));assert.equal(x.total,1);assert.equal(x.rows[0].order_number,'LAST');
});

test('confirmed SHREEWIN source alias is explicit, traceable and used only when exact source is absent',async()=>rollback(async()=>{
  await db.exec(`insert into ar_config_targets values('IN','SHREEWIN','印度','Asia/Kolkata',null,'AR');
    insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,amount,status,applied_at)
      values('AR','IN','Shree.Win','recharge','SOURCE-ALIAS',42,'已支付','2026-09-19 12:00:00');`);
  const p=(await call()).platforms.find(x=>x.name==='SHREEWIN');assert(p);assert.equal(p.sourceName,'Shree.Win');
  const r=await call(req({platformId:p.id}));assert.equal(r.total,1);assert.equal(r.rows[0].order_number,'SOURCE-ALIAS');
  await db.exec(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,amount,status,applied_at)
    values('AR','IN','SHREEWIN','recharge','EXACT',13,'已支付','2026-09-19 12:00:00');`);
  const exact=(await call()).platforms.find(x=>x.name==='SHREEWIN');assert.equal(exact.sourceName,'SHREEWIN');
  const exactResult=await call(req({platformId:p.id}));assert.equal(exactResult.total,1);assert.equal(exactResult.rows[0].order_number,'EXACT');
}));

test('each source keeps indexed platform/time predicates; no timezone function wraps indexed source clocks',async()=>{
  await db.exec('set enable_seqscan=off');
  try{
    const queries=[
      `select id from game66_charge_orders where platform_id='${game}' and create_time>='${from}'::timestamptz and create_time<'${to}'::timestamptz`,
      `select id from game66_withdraw_orders where platform_id='${game}' and create_time>='${from}'::timestamptz and create_time<'${to}'::timestamptz`,
      `select order_no from ar_collected_orders where country_code='IN' and platform='AR-EXAMPLE' and order_kind='recharge' and applied_at>=('${from}'::timestamptz at time zone 'Asia/Kolkata') and applied_at<('${to}'::timestamptz at time zone 'Asia/Kolkata')`,
    ];
    for(const query of queries){const plan=(await db.query('explain '+query)).rows.map(x=>x['QUERY PLAN']).join('\n');assert.match(plan,/Index (Only )?Scan|Bitmap Index Scan/);assert.match(plan,/Index Cond/);}
  }finally{await db.exec('reset enable_seqscan');}
  assert.match(sql,/a\.applied_at>=\(\$5 at time zone \$4\)/);
  assert.match(sql,/n\.created_at>=\$5 and n\.created_at<\$6/);
  assert.match(sql,/c\.create_time>=\$5 and c\.create_time<\$6/);
});

test('duration rollup preserves missing amounts per range and empty valid denominators',async()=>rollback(async()=>{
  const values=[[0,null],[300000,0],[300001,100],[1800001,null],[3600001,200]];
  for(let i=0;i<values.length;i++)await db.query(`insert into game66_charge_orders(platform_id,order_num,uid,create_time,pay_time,status_code,amount_display,pay_method_name)
    values($1,$2,'ROLLUP','2026-09-10T00:00:00Z','2026-09-10T00:00:00Z'::timestamptz+$3*interval '1 millisecond','1',$4,'R')`,[game,'ROLL-'+i,values[i][0],values[i][1]]);
  const r=await call(req({startAt:'2026-09-10T00:00:00Z',endAt:'2026-09-11T00:00:00Z',memberId:'ROLLUP',action:'aggregate'}));
  assert.equal(r.latencySummary[0].valid_count,5);assert.equal(r.latencySummary[0].valid_amount,null);
  const b=r.groups.latency,t=r.groups.latency_thresholds;
  assert.deepEqual(b.map(x=>x.count),[2,1,1,1,0,0,0,0,0,0]);
  assert.equal(b[0].amount,null);assert.equal(b[1].amount,'100');assert.equal(b[2].amount,null);assert.equal(b[3].amount,'200');
  for(let i=0;i<t.length;i++){
    const tail=b.slice(i+1);assert.equal(t[i].count,count(tail,'count'));
    assert.equal(t[i].amount,tail.some(x=>x.amount===null)?null:String(amount(tail,'amount')));
  }
  assert.equal(t[2].amount,'200','unknown lower bins must not contaminate a later threshold');
  await db.exec(`update game66_charge_orders set pay_time=null where uid='ROLLUP'`);
  const empty=await call(req({startAt:'2026-09-10T00:00:00Z',endAt:'2026-09-11T00:00:00Z',memberId:'ROLLUP'}));
  assert.equal(empty.latencySummary[0].valid_count,0);assert.equal(empty.latencySummary[0].excluded_count,5);
  for(const row of [...empty.groups.latency,...empty.groups.latency_thresholds]){
    assert.equal(row.count,0);assert.equal(row.amount,'0');assert.equal(row.count_share,null);assert.equal(row.amount_share,null);
  }
}));

test('performance patch exactly replaces only the new private query and preserves authenticated output',async()=>rollback(async()=>{
  const patch=fs.readFileSync(path.join(repo,'supabase/admin-live-query-performance.sql'),'utf8');
  const fn=sql.slice(sql.indexOf('create function private.dashboard_admin_live_query('),sql.indexOf('revoke all on function private.dashboard_admin_live_query'));
  assert(patch.includes(fn.replace('create function private.dashboard_admin_live_query(','create or replace function private.dashboard_admin_live_query(')));
  assert.equal((patch.match(/create or replace function/g)||[]).length,1);
  assert.doesNotMatch(patch,/statement_timeout|alter table|insert into|delete from/i);
  const before=await call(req());await db.exec(patch.replace(/^begin;$/m,'').replace(/^commit;$/m,''));
  await db.exec('set role authenticated');let after;
  try{after=await call(req())}finally{await db.exec('reset role')}
  delete before.asOf;delete after.asOf;assert.deepEqual(after,before);
}));

test('additive range patch changes only the new private query and preserves ACL and authenticated results',async()=>rollback(async()=>{
  const patch=fs.readFileSync(path.join(repo,'supabase/admin-live-matrix-range.sql'),'utf8');
  const fn=sql.slice(sql.indexOf('create function private.dashboard_admin_live_query('),sql.indexOf('revoke all on function private.dashboard_admin_live_query'));
  assert(patch.includes(fn.replace('create function private.dashboard_admin_live_query(','create or replace function private.dashboard_admin_live_query(')));
  assert.equal((patch.match(/create or replace function/g)||[]).length,1);
  assert.doesNotMatch(patch.replace(/^\s*--.*$/gm,''),/statement_timeout|alter table|insert into|delete from|create index|\bgrant\s|\brevoke\s/i);
  assert.match(patch,/duration_bucket_totals as materialized/,'optimized duration classification remains');
  assert.match(patch,/case when v_action='details' then 'not materialized' else 'materialized' end/i,'details projection optimization remains');
  const acl=()=>db.query("select n.nspname,p.proname,p.proacl,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like 'dashboard_admin_live_%' order by n.nspname,p.proname");
  const beforeAcl=(await acl()).rows,before=await call(req());
  await db.exec(patch.replace(/^begin;$/m,'').replace(/^commit;$/m,''));
  assert.deepEqual((await acl()).rows,beforeAcl);
  await db.exec('set role authenticated');let after;
  try{after=await call(req())}finally{await db.exec('reset role')}
  delete before.asOf;delete after.asOf;assert.deepEqual(after,before);
}));

test('bounded synthetic day conserves every full aggregate while details stay one page',async t=>rollback(async()=>{
  const size=Number(process.env.ADMIN_LIVE_LOAD_SIZE||10000);assert(Number.isInteger(size)&&size>=10000&&size<=250000);
  await db.exec(`insert into game66_charge_orders(platform_id,order_num,uid,create_time,pay_time,status_code,status_group,amount_display,pay_method_name)
    select '${game}','LOAD-'||n,'LOAD','2026-09-19T08:00:00+05:30'::timestamptz+n*interval '1 millisecond',
      '2026-09-19T08:05:00+05:30'::timestamptz+n*interval '1 millisecond','1','success',100,'Provider-'||(n%5)
    from generate_series(1,${size}) n`);
  const begin=performance.now(),a=await call(req({action:'aggregate',memberId:'LOAD'}));
  const aggregateMs=Math.round(performance.now()-begin),pageStart=performance.now();
  const d=await call(req({action:'details',memberId:'LOAD',limit:20,offset:5000}));
  const detailsMs=Math.round(performance.now()-pageStart);
  assert.equal(a.total,size);assert.equal(count(a.summary),size);assert.equal(amount(a.summary),size*100);
  for(const group of ['provider','daily','hourly','amount','matrix','amount_range','matrix_range'])assert.equal(count(a.groups[group]),size);
  assert.equal(count(a.groups.latency,'count'),size);assert.equal(a.rows.length,0);
  assert.equal(d.total,size);assert.equal(d.rows.length,20);assert.equal(d.summary.length,0);
  t.diagnostic(`Offline PGlite synthetic ${size}-order day: aggregate ${aggregateMs}ms, count+page ${detailsMs}ms. Not a production latency claim.`);
}));
