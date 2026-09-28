// Synthetic PostgreSQL only. No production connection or business records.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const repo=path.join(__dirname,'..'),sql=name=>fs.readFileSync(path.join(repo,'supabase',name),'utf8');
const patch=sql('admin-live-dynamic-amount-bands.sql');
const owner='10000000-0000-0000-0000-000000000001',viewer='10000000-0000-0000-0000-000000000002';
const game='00000000-0000-0000-0000-000000000001',lg='00000000-0000-0000-0000-000000000002';
const edges=[100,200,300,500,750,1000,2000,5000,10000,20000,50000];
const payoutEdges=[200,500,1000,2000,3000,5000,10000,15000,20000,30000,50000];
const bands={charge:edges,withdraw:payoutEdges};
const fixture=fs.readFileSync(path.join(__dirname,'uploaded-order-sources.test.cjs'),'utf8').split('\n')
 .filter(line=>/^ create table (game66_platforms|game66_charge_orders|game66_withdraw_orders|ar_config_targets|ar_collected_orders|newar_detail_platforms|newar_detail_records)\(/.test(line)).join('\n');
const sourceFunction=(name)=>{const native=sql('admin-live-lg-native.sql'),start=native.indexOf('CREATE OR REPLACE FUNCTION private.'+name+'(');assert(start>=0,name);return native.slice(start,native.indexOf('$function$;',start)+11)};
let db,platforms,originalAcl,legacy;
const as=uid=>db.query("select set_config('test.uid',$1,false)",[uid]);
const request=(source='game66',overrides={})=>({action:'aggregate',platformId:platforms[source],startAt:'2026-09-19T00:00:00+05:30',endAt:'2026-09-20T00:00:00+05:30',direction:'all',status:'all',...overrides});
const call=async q=>(await db.query('select public.dashboard_admin_live_query($1::jsonb) data',[JSON.stringify(q)])).rows[0].data;
const drill=async q=>(await db.query('select public.dashboard_admin_live_drilldown($1::jsonb) data',[JSON.stringify({...q,view:'drilldown'})])).rows[0].data;
const acl=async()=> (await db.query("select proname,proacl::text from pg_proc where pronamespace='private'::regnamespace and proname in ('dashboard_admin_live_query_raw','dashboard_admin_live_drilldown_raw','dashboard_admin_live_query','dashboard_admin_live_drilldown') order by proname")).rows;
const keys=['all_count','all_amount','success_count','success_amount','created_success_count','pending_count','pending_amount','failed_count','failed_amount','rejected_count','rejected_amount','unknown_count','unknown_amount','missing_amount_count','negative_amount_count'];
const fields=row=>Object.fromEntries(keys.map(k=>[k,row[k]]));
function stableResult(value){const r=structuredClone(value);delete r.asOf;for(const row of r.pendingSummary||[])for(const k of ['mean_ms','max_ms','p50_ms','p95_ms'])delete row[k];return r;}
async function add(source,direction,id,amount,{created='2026-09-19 01:00',success='2026-09-19 01:05',status='success',provider='SelectedPay'}={}){
 const time=x=>x?x.replace(' ','T')+'+05:30':null;
 if(source==='ar')return db.query("insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,amount,status,applied_at,completed_at,raw_channel,channel_type) values('AR','IN','AR-BANDS',$1,$2,$3,$4,$5,$6,$7,'BANK')",[direction==='charge'?'recharge':'withdraw',id,amount,status==='success'?(direction==='charge'?'已支付':'已通过'):status==='pending'?(direction==='charge'?'待支付':'已提交'):'失败',created,success,provider]);
 if(source==='newar')return db.query("insert into newar_detail_records(platform,dataset,source_id,order_number,amount,currency,status_code,status_group,created_at,success_at,provider,channel_type) values('NEW-BANDS',$1,$2,$2,$3,'INR',$4,$4,$5,$6,$7,'BANK')",[direction,id,amount,status,time(created),time(success),provider]);
 if(source==='lg')return db.query("insert into lg_orders(country_code,platform,stat_date,order_kind,order_no,status_class,metric_amount,created_at,paid_at,third_party,raw_channel,payment_method) values('PH','LG-BANDS','2026-09-19',$1,$2,$3,$4,$5,$6,$7,$7,'BANK')",[direction==='charge'?'recharge':'withdraw',id,status,amount,time(created),time(success),provider]);
 if(direction==='charge')return db.query("insert into game66_charge_orders(platform_id,order_num,amount_display,status_code,status_group,create_time,pay_time,pay_method_name,pay_mode) values($1,$2,$3,$4,$5,$6,$7,$8,'BANK')",[game,id,amount,status==='success'?'1':'0',status,time(created),time(success),provider]);
 return db.query("insert into game66_withdraw_orders(platform_id,order_num,amount_display,status_code,create_time,update_time,pay_channel,payout_mode) values($1,$2,$3,$4,$5,$6,$7,'BANK')",[game,id,amount,status==='success'?'3':status==='pending'?'1':'2',time(created),time(success),provider]);
}
before(async()=>{
 db=new PGlite();
 await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;grant usage on schema private,auth to authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table dashboard_profiles(auth_user_id uuid primary key,role text,active boolean,data_scope jsonb,permissions jsonb);
 create table dashboard_admin_preview_grants(auth_user_id uuid primary key,can_view boolean);
 create function private.dashboard_current_data_scope() returns jsonb language sql stable security definer set search_path='' as $$select case when role='owner' then '{"mode":"all"}'::jsonb else data_scope end from public.dashboard_profiles where auth_user_id=auth.uid() and active$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select coalesce($1->>'mode'='all' or $1->'countries'?$2,false)$$;
 ${fixture}
 alter table game66_charge_orders add column status_group text;
 create table lg_orders(source_system text default 'LG',country_code text,platform text,stat_date date,order_kind text,order_no text,member_id text,status_text text,status_class text,metric_amount numeric,order_amount numeric,actual_amount numeric,created_at timestamptz,paid_at timestamptz,finished_at timestamptz,third_party text,raw_channel text,payment_method text,updated_at timestamptz default now());
 insert into dashboard_profiles values('${owner}','owner',true,'{"mode":"all"}','{}'),('${viewer}','viewer',true,'{"countries":["HK_TEAM"]}','{}');
 insert into dashboard_admin_preview_grants values('${viewer}',true);
 insert into game66_platforms values('${game}','GAME-BANDS','香港','hong_kong');
 insert into ar_config_targets values('IN','AR-BANDS','印度','Asia/Kolkata','INR','AR');
 insert into newar_detail_platforms values('NEW-BANDS','IN','印度','Asia/Kolkata','INR',true,null);
 `);
 for(const source of ['game66','ar','newar','lg'])for(const direction of ['charge','withdraw']){
   for(const [i,value]of [-1,0,99.99,100,199.99,200,200.01,300,500,750,1000,2000,5000,10000,20000,50000,50000.01,null].entries())await add(source,direction,source+direction+i,value);
   await add(source,direction,source+direction+'CROSS-IN',150,{created:'2026-09-18 23:59',success:'2026-09-19 00:01'});
   await add(source,direction,source+direction+'CROSS-OUT',250,{created:'2026-09-19 23:59',success:'2026-09-20 00:01'});
   await add(source,direction,source+direction+'PENDING',350,{success:null,status:'pending'});
   await add(source,direction,source+direction+'OTHER',450,{provider:'OtherPay'});
 }
 await db.exec(sql('admin-live-query.sql'));
 await db.exec(`alter function private.dashboard_admin_live_query(jsonb) rename to dashboard_admin_live_query_raw;
 create function private.dashboard_admin_live_query(jsonb) returns jsonb language sql stable security definer set search_path='' as $$select private.dashboard_admin_live_query_raw($1)$$;
 revoke all on function private.dashboard_admin_live_query_raw(jsonb),private.dashboard_admin_live_query(jsonb) from public,anon,authenticated;
 grant execute on function private.dashboard_admin_live_query(jsonb) to authenticated;
 create function private.dashboard_admin_live_expand_provider_filter(jsonb) returns jsonb language sql immutable as $$select $1$$;
 alter function private.dashboard_admin_live_platforms() rename to dashboard_admin_bands_fixture_platforms;
 create function private.dashboard_admin_live_platforms() returns table(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) language sql stable security definer set search_path='' as $$
 select * from private.dashboard_admin_bands_fixture_platforms()
 union all select '${lg}'::uuid,'LG-BANDS','M8','菲律宾','PH','lg','Asia/Kolkata','PHP','LG-BANDS' where private.dashboard_scope_allows(private.dashboard_admin_live_scope(),'PH','LG-BANDS')$$;
 `);
 await db.exec(sourceFunction('dashboard_admin_live_query_raw'));
 await db.exec(sql('admin-live-drilldown.sql'));
 await db.exec(sourceFunction('dashboard_admin_live_drilldown_raw'));
 // The latest production latency engine is an independent replacement with
 // stricter success-window filtering. Preserve it when applying the patch.
 await db.exec(sql('admin-live-drilldown-latency-performance.sql').replace(/do \$latency_baseline\$[\s\S]*?\$latency_baseline\$;/,''));
 const remapSource=sql('admin-live-configuration-query.sql'),start=remapSource.indexOf('create or replace function private.dashboard_admin_live_remap_groups(');
 await db.exec(remapSource.slice(start,remapSource.indexOf('\n$$;',start)+4));
 await db.exec(sql('admin-live-fee-bands.sql'));
 await as(owner);
 const catalog=(await call({action:'catalog'})).platforms;platforms=Object.fromEntries(catalog.map(p=>[p.source,p.id]));
 legacy=await call(request());originalAcl=await acl();await db.exec(patch);
});
after(async()=>db?.close());

test('legacy requests are unchanged, including exact amounts and compact provider totals',async()=>{
 const current=await call(request());assert.deepEqual(stableResult(current),stableResult(legacy));
 for(const view of ['full','providers']){
   const plain=await call(request('game66',{view})),dynamic=await call(request('game66',{view,amountBands:bands}));
   assert.deepEqual(dynamic.summary,plain.summary);assert.deepEqual(dynamic.groups.provider,plain.groups.provider);
   if(view==='full')for(const kind of ['amount','matrix','hourly','daily','latency','latency_thresholds'])assert.deepEqual(dynamic.groups[kind],plain.groups[kind],kind);
   assert.deepEqual(dynamic.amountBands,bands);assert.equal(dynamic.amountBandsVersion,1);
 }
});
test('four native sources and both directions use original-order boundaries without loss or overlap',async()=>{
 for(const source of ['game66','ar','newar','lg']){
  const r=await call(request(source,{amountBands:bands}));
  for(const direction of ['charge','withdraw'])for(const kind of ['amount_range','matrix_range']){
   const rows=r.groups[kind].filter(x=>x.direction===direction),summary=r.summary.find(x=>x.direction===direction);
   for(const field of ['all_count','success_count','created_success_count','pending_count','missing_amount_count','negative_amount_count'])assert.equal(rows.reduce((n,row)=>n+row[field],0),summary[field],source+'/'+direction+'/'+kind+'/'+field);
   assert(rows.every(x=>/^(band:[0-9]|below|above|unknown)$/.test(x.bucket)));
  }
  const charge=r.groups.amount_range.filter(x=>x.direction==='charge');
  assert.equal(charge.find(x=>x.bucket==='below').all_count,3);
  assert.equal(charge.find(x=>x.bucket==='above').all_count,1);
  assert.equal(charge.find(x=>x.bucket==='unknown').all_count,1);
  assert.equal(charge.find(x=>x.bucket==='band:0').all_count,2,'100 and 199.99; 200 belongs to the next band');
  assert.equal(charge.find(x=>x.bucket==='band:1').all_count,3,'200, 200.01 and 250 creation');
  assert.equal(charge.find(x=>x.bucket==='band:9').all_count,2,'last band includes 20000 and exactly 50000');
 }
});
test('range and matrix drills reproduce exact parent metrics including success across midnight',async()=>{
 for(const source of ['game66','ar','newar','lg'])for(const direction of ['charge','withdraw']){
  const q=request(source,{direction,providers:['SelectedPay'],amountBands:bands}),full=await call(q);
  for(const kind of ['amount_range','matrix_range'])for(const row of full.groups[kind]){
   const result=await drill({...q,kind,bucket:row.bucket,...(kind==='matrix_range'?{hour:row.hour}:{})});
   assert.deepEqual(fields(result.summary[0]),fields(row),source+'/'+direction+'/'+kind+'/'+row.bucket+'/'+row.hour);
   assert.deepEqual(result.amountBands,bands);assert.equal(result.rows.length,0);assert.equal(result.complete,true);
   for(const key of keys){const daily=result.groups.daily;if(daily.some(x=>x[key]===null))assert.equal(result.summary[0][key],null);else assert.equal(daily.reduce((n,x)=>n+Number(x[key]),0),Number(result.summary[0][key]),key);}
  }
 }
});
test('changing edges reclassifies the underlying orders; amount filters still filter, exact amounts stay exact',async()=>{
 const changed={...bands,charge:[100,250,350,500,750,1000,2000,5000,10000,20000,50000]};
 const first=await call(request('game66',{amountBands:bands})),second=await call(request('game66',{amountBands:changed}));
 assert.equal(first.groups.amount_range.find(x=>x.direction==='charge'&&x.bucket==='band:0').all_count,2);
 assert.equal(second.groups.amount_range.find(x=>x.direction==='charge'&&x.bucket==='band:0').all_count,4);
 assert.deepEqual(first.groups.amount,second.groups.amount);
 const q=request('game66',{direction:'charge',amountBands:{charge:edges},amountMin:200,amountMax:300});
 const r=await call(q);assert.equal(r.total,4);assert.equal(r.groups.amount_range.reduce((n,x)=>n+x.all_count,0),4);
 const exact=await drill({...q,kind:'amount',bucket:'200'});assert.equal(exact.total,1);
 await assert.rejects(drill({...q,kind:'amount',bucket:'band:1'}),/invalid_drilldown_bucket/);
});
test('malformed, missing, duplicate, reversed, nonnumeric and unsupported band definitions reject before reading facts',async()=>{
 const bad=[null,[],{}, {charge:edges}, {charge:edges,withdraw:edges,evil:[]}, {charge:edges.slice(1),withdraw:edges},
  {charge:[100,100,...edges.slice(2)],withdraw:edges}, {charge:[...edges].reverse(),withdraw:edges},
  {charge:['100',...edges.slice(1)],withdraw:edges}, {charge:[-1,...edges.slice(1)],withdraw:edges},
  {charge:[null,...edges.slice(1)],withdraw:edges}, {charge:[...edges.slice(0,10),1e16],withdraw:edges}];
 for(const amountBands of bad){await assert.rejects(call(request('game66',{amountBands})),/invalid_amount_bands/);await assert.rejects(drill({...request('game66',{amountBands}),kind:'amount_range',bucket:'band:0'}),/invalid_amount_bands/);}
 for(const bucket of ['band:-1','band:10','band:01','100–200','other','band:0); select 1'])await assert.rejects(drill({...request('game66',{amountBands:bands}),kind:'amount_range',bucket}),/invalid_drilldown_bucket/);
 await assert.rejects(drill({...request(),kind:'amount_range',bucket:'band:0'}),/invalid_drilldown_bucket/);
});
test('fractional bounds and non-finite source amounts retain exact decimal and missing-value semantics',async()=>{
 await db.exec('begin');try{
  const decimalEdges=[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1,1.1];
  for(const [i,value]of [0.0999,0.1,0.1999,0.2,1.0999,1.1,1.1001,'NaN','Infinity','-Infinity'].entries())await add('newar','charge','DECIMAL-'+i,value,{provider:'DecimalPay'});
  const q=request('newar',{direction:'charge',providers:['DecimalPay'],amountBands:{charge:decimalEdges}}),r=await call(q);
  const counts=Object.fromEntries(r.groups.amount_range.map(x=>[x.bucket,x.all_count]));
  assert.deepEqual(counts,{below:1,'band:0':2,'band:1':1,'band:9':2,above:1,unknown:3});
  const missing=await drill({...q,kind:'amount_range',bucket:'unknown'});assert.equal(missing.total,3);assert.equal(missing.summary[0].all_amount,null);assert.equal(missing.summary[0].success_amount,null);
  const exact=await drill({...q,kind:'amount_range',bucket:'band:1'});assert.equal(exact.summary[0].all_amount,'0.2');
 }finally{await db.exec('rollback');}
});
test('fresh authorization, source ACLs and migration idempotency stay intact',async()=>{
 assert.deepEqual(await acl(),originalAcl);
 await as(viewer);await db.exec('set role authenticated');
 try{assert((await call(request('game66',{amountBands:bands}))).total>0);await assert.rejects(call(request('ar',{amountBands:bands})),/platform_denied/);await assert.rejects(db.query('select * from game66_charge_orders'),/permission denied/);await assert.rejects(db.query('select private.dashboard_admin_validate_amount_bands($1,\'all\')',[bands]),/permission denied/);}finally{await db.exec('reset role');}
 await db.query('update dashboard_admin_preview_grants set can_view=false where auth_user_id=$1',[viewer]);
 await assert.rejects(call(request('game66',{amountBands:bands})),/preview_denied/);await as(owner);
 const before=await call(request('game66',{amountBands:bands}));await db.exec(patch);const after=await call(request('game66',{amountBands:bands}));assert.deepEqual(stableResult(after),stableResult(before));assert.deepEqual(await acl(),originalAcl);
});
test('deployment script is identical and changes only two raw bodies plus a private validator',()=>{
 assert.equal(sql('migrations/20260928092956_admin_live_dynamic_amount_bands.sql'),patch);
 assert.doesNotMatch(patch,/\b(create table|alter table|insert into|delete from|update public\.|grant execute)\b/i);
 assert.match(patch,/width_bucket\(amount,/);assert.match(patch,/v_charge_edges,v_withdraw_edges/);
 assert.match(patch,/anchor missing or ambiguous/);assert.doesNotMatch(patch,/v_amount_bands->.*amount_range_bucket/);
});
