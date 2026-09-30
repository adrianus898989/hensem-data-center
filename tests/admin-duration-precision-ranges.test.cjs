// Duration precision PostgreSQL regression. Synthetic source fixtures only; no network.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const repo=path.join(__dirname,'..'),sql=name=>fs.readFileSync(path.join(repo,'supabase',name),'utf8');
const amountPatch=sql('admin-live-dynamic-amount-bands.sql');
const patch=sql('migrations/20260930225000_duration_precision_ranges.sql');
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
const acl=async()=> (await db.query("select pronamespace::regnamespace::text as schema,proname,proacl::text,proowner,proconfig,prosecdef from pg_proc where pronamespace in('private'::regnamespace,'public'::regnamespace) and proname in ('dashboard_admin_live_query_raw','dashboard_admin_live_drilldown_raw','dashboard_admin_live_query','dashboard_admin_live_drilldown') order by schema,proname")).rows;
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
 await db.exec(amountPatch);
 await db.exec(`create function private.dashboard_admin_live_provider_canonical(text,text,text) returns text language sql immutable as $$select case when $3='PrecisionAlias' then 'PrecisionPay' else $3 end$$`);
 legacy=await call(request());originalAcl=await acl();
 await db.exec(patch);
});
after(async()=>db?.close());

const limits=[60000,180000,300000,1800000,3600000,10800000,21600000,43200000,86400000,172800000,259200000];
const durationEdges=[0,59999,60000,60000.001,120000,120000.001,179999.999,180000,180000.001,299999.999,300000,300000.001,1800000,3600000,10800000,21600000,43200000,86400000,172800000,259200000,259200000.001];
const durationScope=(source='newar',more={})=>request(source,{startAt:'2026-09-14T00:00:00Z',endAt:'2026-09-20T00:00:00Z',direction:'charge',providers:['PrecisionPay'],durationVersion:2,...more});
const sum=(rows,key)=>rows.reduce((n,x)=>n+Number(x[key]),0);
const pick=row=>Object.fromEntries(['count','amount','valid_count','valid_amount','count_share','amount_share'].map(k=>[k,row[k]]));
async function addDuration(source,direction,id,ms,amount,provider='PrecisionPay',status='success'){
 // SQL timestamp microseconds preserve fractional milliseconds at exact edges.
 if(source==='newar')return db.query(`insert into newar_detail_records(platform,dataset,source_id,order_number,amount,currency,status_code,status_group,created_at,success_at,provider,channel_type) values('NEW-BANDS',$1,$2,$2,$3,'INR',$4,$4,'2026-09-15T12:00Z','2026-09-15T12:00Z'::timestamptz+$5::numeric*interval '1 millisecond',$6,'BANK')`,[direction,id,amount,status,ms,provider]);
 if(source==='ar')return db.query(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,amount,status,applied_at,completed_at,raw_channel,channel_type) values('AR','IN','AR-BANDS',$1,$2,$3,$4,'2026-09-15 12:00','2026-09-15 12:00'::timestamp+$5::numeric*interval '1 millisecond',$6,'BANK')`,[direction==='charge'?'recharge':'withdraw',id,amount,direction==='charge'?'已支付':'已通过',ms,provider]);
 if(source==='lg')return db.query(`insert into lg_orders(country_code,platform,stat_date,order_kind,order_no,status_class,metric_amount,created_at,paid_at,third_party,raw_channel,payment_method) values('PH','LG-BANDS','2026-09-15',$1,$2,'success',$3,'2026-09-15T12:00Z','2026-09-15T12:00Z'::timestamptz+$4::numeric*interval '1 millisecond',$5,$5,'BANK')`,[direction==='charge'?'recharge':'withdraw',id,amount,ms,provider]);
 if(direction==='charge')return db.query(`insert into game66_charge_orders(platform_id,order_num,amount_display,status_code,status_group,create_time,pay_time,pay_method_name) values($1,$2,$3,'1','success','2026-09-15T12:00Z','2026-09-15T12:00Z'::timestamptz+$4::numeric*interval '1 millisecond',$5)`,[game,id,amount,ms,provider]);
 return db.query(`insert into game66_withdraw_orders(platform_id,order_num,amount_display,status_code,create_time,update_time,pay_channel) values($1,$2,$3,'3','2026-09-15T12:00Z','2026-09-15T12:00Z'::timestamptz+$4::numeric*interval '1 millisecond',$5)`,[game,id,amount,ms,provider]);
}
async function rollback(fn){await db.exec('begin');try{await fn()}finally{await db.exec('rollback')}}
async function rejects(fn,pattern){await db.exec('savepoint expected_duration_rejection');try{await assert.rejects(fn,pattern)}finally{await db.exec('rollback to savepoint expected_duration_rejection; release savepoint expected_duration_rejection')}}

test('legacy full reply, old ten bins and old drilldown indices remain exact',async()=>{
 assert.deepEqual(stableResult(await call(request())),stableResult(legacy));
 const full=await call(request('game66',{direction:'charge'}));
 assert.equal(full.groups.latency.length,10);assert.equal(full.groups.latency_thresholds.length,9);
 assert(!('durationVersion' in full));assert(!('latency_custom' in full.groups));
 const expanded=await drill({...request('game66',{direction:'charge'}),kind:'latency',bucket:0});
 assert.equal(expanded.summary[0].count,full.groups.latency[0].count);
 assert(!('min_ms' in expanded.summary[0]));assert(!('durationVersion' in expanded.segment));
});

test('four native sources and both directions preserve exact microsecond edges in disjoint twelve bins',async()=>rollback(async()=>{
 for(const source of ['game66','ar','newar','lg'])for(const direction of ['charge','withdraw']){
  for(const [i,ms]of durationEdges.entries())await addDuration(source,direction,source+direction+'precision'+i,ms,i+1);
  const q=durationScope(source,{direction}),r=await call(q),bins=r.groups.latency,expected=limits.map((max,i)=>durationEdges.filter(v=>(i===0||v>limits[i-1])&&v<=max).length).concat(durationEdges.filter(v=>v>limits.at(-1)).length);
  assert.equal(r.durationVersion,2);assert.equal(bins.length,12);assert.equal(r.groups.latency_thresholds.length,11);
  assert.deepEqual(bins.map(b=>b.count),expected,source+'/'+direction);assert.deepEqual(bins.map(b=>b.bucket),Array.from({length:12},(_,i)=>i));
  assert.equal(sum(bins,'count'),durationEdges.length);assert.equal(sum(bins,'amount'),durationEdges.reduce((n,_,i)=>n+i+1,0));
  assert.equal(sum(bins.slice(0,3),'count'),durationEdges.filter(v=>v<=300000).length,'fast five minutes includes all first three bins');
  const {durationVersion,...legacyQ}=q;const old=await call(legacyQ);
  assert.deepEqual(r.summary,old.summary);assert.deepEqual(r.latencySummary,old.latencySummary,'precision must not approximate mean or quantiles');
  assert.equal(sum(bins.slice(0,3),'count'),old.groups.latency[0].count);
  for(const cumulative of [false,true])for(let bucket=0;bucket<(cumulative?11:12);bucket++){
   const d=await drill({...q,kind:'latency',bucket,cumulative});
   assert.deepEqual(pick(d.summary[0]),pick((cumulative?r.groups.latency_thresholds:bins)[bucket]),source+'/'+direction+'/'+bucket+'/'+cumulative);
   assert.equal(sum(d.groups.daily,'count'),d.summary[0].count);assert.equal(sum(d.groups.provider_daily,'count'),d.summary[0].count);
  }
 }
}));

test('independent custom (120,180] interval uses raw duration, retains fixed bins and original denominator',async()=>rollback(async()=>{
 for(const [i,ms]of durationEdges.entries())await addDuration('newar','charge','custom'+i,ms,i+1);
 const q=durationScope(),base=await call(q),durationRange={minSeconds:120,maxSeconds:180},r=await call({...q,durationRange});
 assert.deepEqual(r.summary,base.summary);assert.deepEqual(r.latencySummary,base.latencySummary);assert.deepEqual(r.groups.latency,base.groups.latency);assert.deepEqual(r.groups.latency_thresholds,base.groups.latency_thresholds);
 const s=r.groups.latency_custom[0],selected=durationEdges.map((ms,i)=>({ms,amount:i+1})).filter(x=>x.ms>120000&&x.ms<=180000);
 assert.equal(s.count,selected.length);assert.equal(Number(s.amount),sum(selected,'amount'));assert.equal(s.valid_count,durationEdges.length);assert.equal(s.min_ms,120000);assert.equal(s.max_ms,180000);
 const d=await drill({...q,kind:'latency',durationRange});assert.deepEqual(pick(d.summary[0]),pick(s));assert.deepEqual(d.durationRange,durationRange);assert.deepEqual(d.segment.durationRange,durationRange);assert(!('bucket' in d.segment));
 assert.equal(d.summary[0].valid_count,durationEdges.length);assert.equal(d.summary[0].count_share,selected.length/durationEdges.length);assert.equal(sum(d.groups.provider,'count'),selected.length);
}));

test('one-sided custom boundaries include exact zero only when lower side is unbounded',async()=>rollback(async()=>{
 for(const [i,ms]of [0,1,60000,60001,120000,180000].entries())await addDuration('newar','charge','one-sided'+i,ms,100);
 for(const [range,want]of [[{maxSeconds:0},1],[{minSeconds:0},5],[{minSeconds:null,maxSeconds:60},3],[{minSeconds:60,maxSeconds:null},3],[{minSeconds:120,maxSeconds:180},1]]){
  const r=await call({...durationScope(),durationRange:range}),d=await drill({...durationScope(),kind:'latency',durationRange:range});
  assert.equal(r.groups.latency_custom[0].count,want);assert.equal(d.summary[0].count,want);
 }
}));

test('missing amounts propagate per selected interval but unrelated missing sums do not erase known range amounts',async()=>rollback(async()=>{
 await addDuration('newar','charge','missing-custom',150000,null);
 await addDuration('newar','charge','known-custom',200000,500);
 for(const [range,want]of [[{minSeconds:120,maxSeconds:180},null],[{minSeconds:180,maxSeconds:300},'500']]){
  const r=await call({...durationScope(),durationRange:range}),d=await drill({...durationScope(),kind:'latency',durationRange:range});
  assert.equal(r.groups.latency_custom[0].amount,want);assert.equal(d.summary[0].amount,want);assert.equal(d.summary[0].valid_amount,null);assert.equal(d.summary[0].amount_share,null);assert.equal(d.summary[0].count,1);
 }
}));

test('zero matches, missing/reversed times and currency separation keep complete valid-time denominators',async()=>rollback(async()=>{
 await addDuration('newar','charge','valid',60000,100);
 await addDuration('newar','charge','reverse',-1,200);
 await addDuration('newar','charge','missing-time',null,300);
 await addDuration('newar','charge','second-currency',150000,400);
 await db.exec("update newar_detail_records set currency='USDT' where source_id='second-currency'");
 const q={...durationScope(),durationRange:{minSeconds:120,maxSeconds:180}},r=await call(q),d=await drill({...q,kind:'latency'});
 assert.equal(r.groups.latency_custom.length,2);assert.equal(d.summary.length,2);
 const inr=d.summary.find(x=>x.currency==='INR'),usdt=d.summary.find(x=>x.currency==='USDT');
 assert.equal(inr.count,0);assert.equal(inr.amount,'0');assert.equal(inr.valid_count,1);assert.equal(inr.excluded_count,1);assert.equal(usdt.count,1);assert.equal(usdt.valid_count,1);
 assert.equal(r.latencySummary.find(x=>x.currency==='INR').candidate_count,2,'missing success timestamp does not enter the success-day cohort');
}));

test('pending payout ages always retain old ten disjoint bins and nine thresholds',async()=>{
 const old=await call(request('newar',{direction:'withdraw'})),v2=await call(request('newar',{direction:'withdraw',durationVersion:2,durationRange:{minSeconds:120,maxSeconds:180}}));
 assert.equal(v2.groups.pending_age.length,10);assert.equal(v2.groups.pending_age_thresholds.length,9);
 assert.deepEqual(v2.groups.pending_age,old.groups.pending_age);assert.deepEqual(v2.groups.pending_age_thresholds,old.groups.pending_age_thresholds);
 assert.equal(v2.pendingSummary[0].valid_count,old.pendingSummary[0].valid_count);assert.equal(v2.pendingSummary[0].valid_amount,old.pendingSummary[0].valid_amount);
});

test('dynamic amount bands still work alongside duration precision without changing either cohort',async()=>{
 const a=await call(request('newar',{amountBands:bands,durationVersion:2})),b=await call(request('newar',{amountBands:bands}));
 assert.deepEqual(a.groups.amount_range,b.groups.amount_range);assert.deepEqual(a.groups.matrix_range,b.groups.matrix_range);assert.deepEqual(a.amountBands,bands);
});

test('unknown, ambiguous, unsupported and unsafe range/version contracts reject at SQL boundary',async()=>rollback(async()=>{
 for(const extra of [{durationVersion:1},{durationVersion:'2'},{durationVersion:null},{durationVersion:3},{durationVersion:2,durationRange:null},{durationVersion:2,durationRange:{}},{durationVersion:2,durationRange:{minSeconds:null,maxSeconds:null}},{durationVersion:2,durationRange:{minSeconds:180,maxSeconds:120}},{durationVersion:2,durationRange:{minSeconds:120,maxSeconds:120}},{durationVersion:2,durationRange:{minSeconds:-1,maxSeconds:120}},{durationVersion:2,durationRange:{minSeconds:1.1,maxSeconds:120}},{durationVersion:2,durationRange:{minSeconds:'120',maxSeconds:180}},{durationVersion:2,durationRange:{maxSeconds:315360001}},{durationVersion:2,durationRange:{maxSeconds:180,sql:'bad'}},{durationVersion:2,view:'providers'},{durationVersion:2,action:'details'}])await rejects(()=>call({...request(),...extra}),/invalid_duration/);
 await rejects(()=>call({...request(),durationRange:{minSeconds:120,maxSeconds:180}}),/invalid_duration_version/);
 for(const extra of [{bucket:12},{bucket:11,cumulative:true},{bucket:0,durationRange:{maxSeconds:180}},{cumulative:false,durationRange:{maxSeconds:180}},{kind:'amount',bucket:'100'}])await rejects(()=>drill({...durationScope(),kind:'latency',...extra}),/invalid_|ambiguous_/);
}));

test('authorization and private helper ACLs survive, and migration is idempotent',async()=>{
 assert.deepEqual(await acl(),originalAcl);
 await as(viewer);await db.exec('set role authenticated');
 try{
  assert((await call(request('game66',{durationVersion:2}))).total>0);
  await assert.rejects(call(request('ar',{durationVersion:2})),/platform_denied/);
  await assert.rejects(drill({...request('ar',{durationVersion:2}),kind:'latency',durationRange:{maxSeconds:180}}),/platform_denied/);
  await assert.rejects(db.query('select private.dashboard_admin_validate_duration($1::jsonb)',[JSON.stringify({durationVersion:2})]),/permission denied/);
 }finally{await db.exec('reset role');await as(owner)}
 await db.exec('set role anon');try{await assert.rejects(call(request('game66',{durationVersion:2})),/permission denied/)}finally{await db.exec('reset role')}
 const before=await call(request('game66',{durationVersion:2}));await db.exec(patch);const after=await call(request('game66',{durationVersion:2}));assert.deepEqual(stableResult(after),stableResult(before));assert.deepEqual(await acl(),originalAcl);
});

test('custom interval respects success-date cohort, canonical grouping and selected currency/provider',async()=>rollback(async()=>{
 // The original amount fixture contains a two-minute cross-midnight success.
 const q=request('newar',{direction:'charge',durationVersion:2,providers:['SelectedPay'],durationRange:{minSeconds:60,maxSeconds:180}});
 const result=await call(q),expanded=await drill({...q,kind:'latency'});
 assert.equal(result.groups.latency_custom[0].count,1);assert.equal(expanded.summary[0].count,1);
 assert.equal(expanded.groups.daily[0].date,'2026-09-19','grouped by success day, not prior creation day');
 await addDuration('newar','charge','canonical-1',150000,100,'PrecisionPay');
 await addDuration('newar','charge','canonical-2',180000,200,'PrecisionAlias');
 await addDuration('newar','charge','other-channel',150000,999,'DifferentPay');
 const scope=durationScope('newar',{providers:['PrecisionPay','PrecisionAlias'],currency:'INR',durationRange:{minSeconds:120,maxSeconds:180}});
 const d=await drill({...scope,kind:'latency'});
 assert.equal(d.summary[0].count,2);assert.equal(d.summary[0].amount,'300');assert.equal(d.groups.provider.length,1);assert.equal(d.groups.provider[0].provider,'PrecisionPay');
 assert.equal(d.groups.provider_daily[0].amount,'300');
}));

test('precision migration only patches checked read bodies and never mutates data or grants access',()=>{
 assert.doesNotMatch(patch,/\b(create table|alter table|insert into|delete from|update public\.|grant execute)\b/i);
 assert.match(patch,/duration_anchor_drift/);assert.match(patch,/duration_parameter_baseline_drift/);assert.match(patch,/q\.proacl is distinct from old_acl/);
 assert.match(patch,/revoke all on function private\.dashboard_admin_validate_duration\(jsonb\) from public,anon,authenticated/);
});
