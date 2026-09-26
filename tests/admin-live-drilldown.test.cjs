// Offline segment drilldown regression. All users, orders and scopes below are synthetic.
// Source schemas match the shared query fixtures; no production connection is used.
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
  
  await db.exec(`create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[]);
    create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text);`);
  await db.exec(fs.readFileSync(path.join(repo,'supabase/admin-live-provider-aliases.sql'),'utf8'));
  const config=fs.readFileSync(path.join(repo,'supabase/admin-live-configuration.sql'),'utf8');
  await db.exec(config.slice(config.indexOf('create or replace function private.dashboard_admin_live_provider_alias_values'),config.indexOf('revoke all on function private.dashboard_admin_live_provider_alias_values')));
  await db.exec(fs.readFileSync(path.join(repo,'supabase/admin-live-provider-filter-performance.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(repo,'supabase/admin-live-drilldown.sql'),'utf8'));
  const catalog=await call();ar=catalog.platforms.find(x=>x.source==='ar').id;newar=catalog.platforms.find(x=>x.source==='newar').id;
});
after(async()=>{if(db)await db.close()});

const segment=(kind,extra={})=>req({action:'aggregate',view:'drilldown',kind,...extra});
const drill=async request=>(await db.query('select public.dashboard_admin_live_drilldown($1::jsonb) data',[JSON.stringify(request)])).rows[0].data;
const metricKeys=['all_count','all_amount','success_count','success_amount','created_success_count','pending_count','pending_amount','failed_count','failed_amount','rejected_count','rejected_amount','unknown_count','unknown_amount','missing_amount_count','negative_amount_count'];
async function add(source,direction,id,value,created,success,status='success',provider='DrillPay'){
 const z=source==='newar'?'+05:45':'+05:30',time=v=>v?v.replace(' ','T')+z:null;
 if(source==='ar')return db.query(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,completed_at,raw_channel,channel_type) values('AR','IN','AR-EXAMPLE',$1,$2,'DRILL',$3,$4,$5,$6,$7,'BANK')`,[direction==='charge'?'recharge':'withdraw',id,value,status==='success'?(direction==='charge'?'已支付':'已通过'):status==='pending'?(direction==='charge'?'待支付':'已提交'):(direction==='charge'?'已取消':'失败'),created,success,provider]);
 if(source==='newar')return db.query(`insert into newar_detail_records(platform,dataset,source_id,order_number,member_id,amount,currency,status_code,status_group,created_at,success_at,provider,channel_type) values('NEW-EXAMPLE',$1,$2,$2,'DRILL',$3,'NPR',$4,$4,$5,$6,$7,'BANK')`,[direction,id,value,status,time(created),time(success),provider]);
 if(direction==='charge')return db.query(`insert into game66_charge_orders(platform_id,order_num,uid,amount_display,status_code,status_group,create_time,pay_time,pay_method_name,pay_mode) values($1,$2,'DRILL',$3,$4,$5,$6,$7,$8,'BANK')`,[game,id,value,status==='success'?'1':'0',status,time(created),time(success),provider]);
 return db.query(`insert into game66_withdraw_orders(platform_id,order_num,uid,amount_display,status_code,create_time,update_time,pay_channel,payout_mode) values($1,$2,'DRILL',$3,$4,$5,$6,$7,'BANK')`,[game,id,value,status==='success'?'3':status==='pending'?'1':'2',time(created),time(success),provider]);
}
function dates(source,start=18,end=21){const z=source==='newar'?'+05:45':'+05:30';return {startAt:`2026-09-${start}T00:00:00${z}`,endAt:`2026-09-${end}T00:00:00${z}`}}
function fields(row){return Object.fromEntries(metricKeys.map(k=>[k,row[k]]))}

test('all analytical segments conserve the full engine totals and each daily sum across three sources and both directions',async()=>rollback(async()=>{
 const cases=[['CROSS-IN',100,'2026-09-18 23:59','2026-09-19 00:00','success'],['LATE',200,'2026-09-18 22:00','2026-09-19 01:00','success'],['CROSS-OUT',300,'2026-09-19 01:00','2026-09-20 02:00','success'],['SAME',400,'2026-09-19 01:00','2026-09-19 01:10','success'],['PENDING',500,'2026-09-19 01:00',null,'pending'],['FAILED',1000,'2026-09-19 01:00',null,'failed'],['NULL',null,'2026-09-19 01:00','2026-09-19 01:20','success'],['OTHER',99,'2026-09-19 01:00','2026-09-19 03:00','success']];
 const segments=[['hourly',{hour:1}],['amount',{bucket:'100'}],['amount',{bucket:'unknown'}],['amount',{bucket:'other'}],['amount_range',{bucket:'100–200'}],['amount_range',{bucket:'other'}],['matrix',{hour:1,bucket:'400'}],['matrix_range',{hour:1,bucket:'301–400'}]];
 for(const [source,platformId]of [['ar',ar],['newar',newar],['game66',game]])for(const direction of ['charge','withdraw']){
  for(const [id,value,created,success,status]of cases)await add(source,direction,source+'-'+direction+'-'+id,value,created,success,status);
  const q={platformId,direction,memberId:'DRILL',...dates(source)},full=await call(req({...q,action:'aggregate'}));
  for(const [kind,choice]of segments){
   const result=await drill(segment(kind,{...q,...choice})),expected=full.groups[kind].find(r=>(choice.hour===undefined||r.hour===choice.hour)&&(choice.bucket===undefined||r.bucket===choice.bucket));
   assert.equal(result.complete,true);assert.equal(result.hasMore,false);assert.equal(result.total,result.summary[0].all_count);assert.deepEqual(result.rows,[]);assert.deepEqual(Object.keys(result.groups),['daily']);
   assert.deepEqual(fields(result.summary[0]),fields(expected),source+'/'+direction+'/'+kind+'/'+JSON.stringify(choice));
   for(const key of metricKeys){const daily=result.groups.daily;if(daily.some(r=>r[key]===null))assert.equal(result.summary[0][key],null,key+' unknown stays unknown');else assert.equal(daily.reduce((s,r)=>s+Number(r[key]),0),Number(result.summary[0][key]),key+' day/range conservation')}
   assert.doesNotMatch(JSON.stringify(result),/order_number|member_id|raw_payload|PHONE|BANK-ACCOUNT/);
  }
  const cross=await drill(segment('amount',{...q,bucket:'100'})),before=cross.groups.daily.find(r=>r.date==='2026-09-18'),after=cross.groups.daily.find(r=>r.date==='2026-09-19');
  assert.equal(before.all_count,1);assert.equal(before.success_count,0);assert.equal(after.all_count,0);assert.equal(after.success_count,1);assert.equal(after.success_amount,'100');
 }
}));

test('amount range boundaries, other and unknown remain disjoint including decimals and signed adjustments',async()=>rollback(async()=>{
 const values=[-1,0,99.999,100,200,200.001,300,300.001,400,400.001,500,500.001,750,750.001,1000,1000.001,2000,2000.001,5000,5000.001,null,'NaN','Infinity'];
 for(let i=0;i<values.length;i++)await add('newar','charge','BOUND-'+i,values[i],'2026-09-19 01:00','2026-09-19 01:05');
 const buckets=['100–200','201–300','301–400','401–500','501–750','751–1,000','1,001–2,000','2,001–5,000','≥5,001','other','unknown'];let created=0,success=0;
 for(const bucket of buckets){const r=await drill(segment('amount_range',{platformId:newar,direction:'charge',memberId:'DRILL',bucket,...dates('newar')}));const s=r.summary[0];created+=s.all_count;success+=s.success_count;if(bucket==='unknown'){assert.equal(s.success_count,3);assert.equal(s.all_amount,null);assert.equal(s.success_amount,null)}if(bucket==='other')assert.equal(s.success_count,3)}
 assert.equal(created,values.length);assert.equal(success,values.length);
}));

test('latency mutual bins and strict cumulative thresholds preserve success-day totals and independent denominators',async()=>rollback(async()=>{
 const edges=[0,300000,300001,1800000,1800001,3600000,10800000,21600000,43200000,86400000,172800000,259200000,259200001];
 for(let i=0;i<edges.length;i++)await db.query(`insert into game66_charge_orders(platform_id,order_num,uid,create_time,pay_time,status_code,status_group,amount_display,pay_method_name) values($1,$2,'LATENCY-DRILL','2026-09-10T23:55:00+05:30','2026-09-10T23:55:00+05:30'::timestamptz+$3*interval '1 millisecond','1','success',$4,'Latency')`,[game,'LATENCY-DRILL-'+i,edges[i],i===0?null:i===1?0:100*i]);
 const scope={platformId:game,memberId:'LATENCY-DRILL',direction:'charge',startAt:'2026-09-10T00:00:00+05:30',endAt:'2026-09-15T00:00:00+05:30'},full=await call(req({...scope,action:'aggregate'}));
 for(const cumulative of [false,true])for(let bucket=0;bucket<(cumulative?9:10);bucket++){
  const r=await drill(segment('latency',{...scope,bucket,cumulative})),s=r.summary[0],expected=full.groups[cumulative?'latency_thresholds':'latency'][bucket];
  for(const key of ['count','amount','valid_count','valid_amount','count_share','amount_share'])assert.equal(s[key],expected[key],key+'/'+bucket+'/'+cumulative);
  assert.equal(s.success_count,s.count);assert.equal(s.success_amount,s.amount);assert.equal(r.total,s.count);assert(!('all_count' in s),'latency does not fabricate creation totals');
  assert.equal(r.groups.daily.reduce((n,d)=>n+d.count,0),s.count);assert.equal(r.groups.daily.reduce((n,d)=>n+d.valid_count,0),s.valid_count);
  if(bucket===0&&!cumulative){assert.equal(s.count,2);assert.equal(r.groups.daily.find(d=>d.date==='2026-09-10').count,1);assert.equal(r.groups.daily.find(d=>d.date==='2026-09-11').count,1)}
 }
}));

test('latency invalid timestamps remain excluded and missing completion dates are never invented',async()=>rollback(async()=>{
 await add('game66','charge','REVERSED-DRILL',500,'2026-09-20 01:00','2026-09-19 01:00');
 await add('game66','charge','NO-TIME-DRILL',500,'2026-09-19 01:00',null);
 const q=segment('latency',{direction:'charge',memberId:'DRILL',bucket:0,...dates('game66')}),r=await drill(q),s=r.summary[0];
 assert.equal(s.candidate_count,1);assert.equal(s.excluded_count,1);assert.equal(s.valid_count,0);assert.equal(s.count,0);assert.equal(s.amount,'0');assert.equal(s.count_share,null);assert.equal(s.amount_share,null);assert.equal(r.groups.daily.length,1);assert.equal(r.groups.daily[0].date,'2026-09-19');
 await add('game66','charge','FUTURE-DRILL',100,'2099-01-01 01:00','2099-01-01 01:01');
 const future=await drill({...q,startAt:'2099-01-01T00:00:00+05:30',endAt:'2099-01-02T00:00:00+05:30'});assert.equal(future.summary[0].excluded_count,1);assert.equal(future.summary[0].valid_count,0);
}));

test('Nepal nonwhole-hour local midnight, half-open end and subsecond boundaries remain exact',async()=>rollback(async()=>{
 await add('newar','withdraw','NP-BOUND',100,'2026-09-18 23:59:59.999','2026-09-19 00:00:00.000');
 const q=segment('hourly',{platformId:newar,direction:'withdraw',memberId:'DRILL',hour:0,startAt:'2026-09-18T18:15:00Z',endAt:'2026-09-18T18:15:00.001Z'}),r=await drill(q);
 assert.equal(r.summary[0].all_count,0);assert.equal(r.summary[0].success_count,1);assert.equal(r.groups.daily[0].date,'2026-09-19');
 const prior=await drill({...q,startAt:'2026-09-18T18:14:59Z',endAt:'2026-09-18T18:15:00Z'});assert.deepEqual(prior.summary,[]);assert.deepEqual(prior.groups.daily,[]);
}));

test('canonical provider expansion and all existing exact filters apply before segment aggregation',async()=>rollback(async()=>{
 await db.exec(`insert into private.dashboard_admin_provider_registry values('印度','AR-EXAMPLE','LegacyPay',array['SyntheticPay']),('印度','OTHER','PrivateRaw',array['SyntheticPay']);`);
 await add('ar','charge','FILTER-ONE',200,'2026-09-19 01:00','2026-09-19 01:05','success','LegacyPay');await add('ar','charge','FILTER-OTHER',300,'2026-09-19 01:00','2026-09-19 01:05','success','Unrelated');
 const q=segment('hourly',{platformId:ar,direction:'charge',memberId:'DRILL',hour:1,providers:['SyntheticPay'],currency:'INR',amountMin:200,amountMax:200,channelTypes:['BANK'],...dates('ar')});
 const r=await drill(q);assert.equal(r.summary[0].success_count,1);assert.equal(r.summary[0].success_amount,'200');
 assert.deepEqual((await drill({...q,orderNumber:'FILTER-OTHER'})).summary,[]);assert.deepEqual((await drill({...q,channelTypes:['UPI']})).summary,[]);
 const privateRaw=await db.query('select private.dashboard_admin_live_expand_provider_filter($1::jsonb) request',[JSON.stringify(q)]);assert(!privateRaw.rows[0].request.providers.includes('PrivateRaw'));
}));

test('fresh authentication, platform scope, helper grants and invalid segments cannot broaden reads',async()=>{
 const q=segment('hourly',{hour:0});
 for(const patch of [{kind:'unknown'},{kind:'latency',hour:undefined,bucket:'0'},{hour:24},{hour:-1},{hour:0.5},{hour:'0'},{bucket:'other'},{cumulative:false},{view:'full'},{action:'details'},{offset:20},{status:'success'},{country:'印度'},{endAt:'2026-11-01T00:00:00Z'}])await assert.rejects(()=>drill({...q,...patch}));
 for(const choice of [{kind:'amount',bucket:'201'},{kind:'amount_range',bucket:'100-200'},{kind:'latency',bucket:9,cumulative:true},{kind:'latency',bucket:1,cumulative:'true'}])await assert.rejects(()=>drill(segment(choice.kind,choice)));
 await as(viewer);try{await assert.rejects(()=>drill({...q,platformId:ar}),/platform_denied/);await assert.rejects(()=>drill({...q,platformId:hidden}),/platform_denied/);assert((await drill(q)).platform.id===game)}finally{await as()}
 await as('');try{await assert.rejects(()=>drill(q),/login_required/)}finally{await as()}
 const privileges=(await db.query("select has_function_privilege('anon','public.dashboard_admin_live_drilldown(jsonb)','execute') anon,has_function_privilege('authenticated','private.dashboard_admin_live_drilldown_raw(jsonb)','execute') raw,has_function_privilege('authenticated','public.dashboard_admin_live_drilldown(jsonb)','execute') authorized")).rows[0];assert.deepEqual(privileges,{anon:false,raw:false,authorized:true});
});

test('migration leaves existing engines untouched and returns complete bounded aggregates with no order paging',async()=>{
 const patch=fs.readFileSync(path.join(repo,'supabase/admin-live-drilldown.sql'),'utf8'),original=fs.readFileSync(path.join(repo,'supabase/admin-live-query-performance.sql'),'utf8');
 const source=value=>value.slice(value.indexOf("  if v_platform.source='ar' then"),value.indexOf('  -- Group and page')<0?value.indexOf('  v_prefix:='):value.indexOf('  -- Group and page')).trim();
 assert.equal(source(patch),source(original),'source allowlist, country/platform predicates, local time and launch filters match existing engine');
 assert.doesNotMatch(patch,/create or replace function (?:public|private)\.dashboard_admin_live_query\(/);assert.doesNotMatch(patch,/create index|alter table|insert into|delete from|update public|\blimit \$18|\boffset \$17/i);
 const before=await call(req());await db.exec(patch);const after=await call(req());delete before.asOf;delete after.asOf;assert.deepEqual(after,before);
});
