// Offline synthetic pending-stock fixtures. Never connects to production.
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const repo=path.resolve(__dirname,'..');
const read=n=>fs.readFileSync(path.join(repo,'supabase',n),'utf8');
const sourceSql=read('admin-live-pending-snapshot.sql');
const sql=read('migrations/20260930130000_pending_analysis.sql');
const owner='10000000-0000-0000-0000-000000000001',viewer='10000000-0000-0000-0000-000000000002';
const id=n=>'20000000-0000-0000-0000-'+String(n).padStart(12,'0');
const date='2026-09-26';let db;let baselineMeta;
const candidate=read('migrations/20261002064434_pending_analysis_range_catalog_once.sql');
const fixture=n=>fs.readFileSync(path.join(__dirname,'fixtures/pending-analysis',n),'utf8').trim()+';';
const as=async uid=>db.query("select set_config('test.uid',$1,false)",[uid]);
async function call(ids,extra={}){return(await db.query('select public.dashboard_admin_live_pending_analysis($1::jsonb) data',[JSON.stringify({startDate:date,endDate:date,platformIds:ids,...extra})])).rows[0].data;}
async function target(n,name='SYNTHETIC',options={}){
 const {source='ar',country='IN',currency='INR',team='M8',sourceName=name}=options;
 await db.query('insert into '+(source==='withdraw'?'seed_catalog':'native_catalog')+' values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id(n),name,team,country==='IN'?'印度':country,country,source,'Asia/Kolkata',currency,sourceName]);
 return id(n);
}
async function snapshot(platform,groups=[{raw_channel:'SYNTHETIC_PAY',channel_type:'BANK',pending_count:2,pending_amount:120}],options={}){
 const count=groups.reduce((a,g)=>a+g.pending_count,0),amount=groups.reduce((a,g)=>a+g.pending_amount,0);
 const {country='IN',day=date,capture='2026-09-27',start='2026-09-20',end=day,at='2026-09-26T18:30:15Z',source='WITHDRAW_REVIEW',change={}}=options;
 const value={schema_version:1,source_system:source,country_code:country,platform,stat_date:day,timezone:'Asia/Kolkata',snapshot_id:id(900),snapshot_at:at,coverage:{complete:true,expected_count:count,fetched_count:count,unique_count:count},totals:{pending_count:count,pending_amount:amount},groups,...change};
 await db.query('insert into withdraw_pending_backlog_daily values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9)',[source,country,platform,day,capture,start,end,id(900),at,JSON.stringify(value)]);
}
before(async()=>{
 db=new PGlite();
 await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;create role service_role;
 grant usage on schema auth,private to authenticated;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table dashboard_profiles(auth_user_id uuid primary key,role text,active boolean,data_scope jsonb,permissions jsonb);
 create table dashboard_admin_preview_grants(auth_user_id uuid primary key,can_view boolean not null);
 create function private.dashboard_current_data_scope() returns jsonb language sql stable security definer set search_path='' as $$select coalesce((select p.data_scope from public.dashboard_profiles p where p.auth_user_id=auth.uid() and p.active),'{"mode":"selected","countries":[]}'::jsonb)$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select coalesce($1->>'mode'='all' or ($1->>'mode'='selected' and $1->'countries' ? $2 and (not ($1 ? 'platforms') or $1->'platforms' ? $3)),false)$$;
 insert into dashboard_profiles values('${owner}','owner',true,'{"mode":"all","countries":[]}','{}'),('${viewer}','viewer',true,'{"mode":"selected","countries":["IN"]}','{}');
 insert into dashboard_admin_preview_grants values('${viewer}',true);
 create table native_catalog(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text);
 create table seed_catalog(like native_catalog);
 create table dashboard_platform_team_map(country_code text,source_platform text,platform_name text,team_name text,active boolean);
 create table withdraw_pending_backlog_daily(source_system text,country_code text,platform text,stat_date date,capture_date date,window_start date,window_end date,snapshot_id uuid,snapshot_at timestamptz,snapshot jsonb,updated_at timestamptz,primary key(source_system,country_code,platform,stat_date));
 alter table withdraw_pending_backlog_daily enable row level security;
 create table withdraw_pending_daily(source_system text,country_code text,platform text,stat_date date,snapshot_id uuid unique,snapshot_at timestamptz,snapshot jsonb,updated_at timestamptz,primary key(source_system,country_code,platform,stat_date));
 create table withdraw_pending_orders(source_system text,country_code text,platform text,stat_date date,order_no text,member_id text,amount numeric,applied_at timestamp without time zone,timezone text,raw_channel text,channel_type text,status text,snapshot_id uuid,snapshot_at timestamptz,updated_at timestamptz,primary key(source_system,country_code,platform,stat_date,order_no));
 create index synthetic_pending_snapshot_idx on withdraw_pending_orders(snapshot_id);
 create table newar_detail_platforms(country_code text,platform text,timezone text,launch_at timestamptz);
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select case upper(btrim($1)) when 'VEER.GAME' then 'VEERGAME' when 'SHREE.WIN' then 'SHREEWIN' when 'DHANI.WIN' then 'DHANIWIN' else upper(btrim($1)) end$$;
 create function public.collection_success_safe_descriptor(text,integer) returns boolean language sql immutable as $$select $1 is not null and length($1) between 1 and $2 and $1!~'[[:cntrl:]]'$$;
 create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[]);
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text);`);
 const base=read('admin-live-query.sql');await db.exec(base.slice(base.indexOf('create function private.dashboard_admin_live_scope()'),base.indexOf('create function private.dashboard_admin_live_platforms()')));
 await db.exec(`create function private.dashboard_admin_live_platforms() returns setof public.native_catalog language plpgsql stable security definer set search_path='' as $$declare s jsonb:=private.dashboard_admin_live_scope();begin return query select * from public.native_catalog p where private.dashboard_scope_allows(s,p.scope_group,p.source_name);end$$;
 create function private.dashboard_admin_live_withdraw_platforms() returns setof public.seed_catalog language plpgsql stable security definer set search_path='' as $$declare s jsonb:=private.dashboard_admin_live_scope();begin return query select * from public.seed_catalog p where private.dashboard_scope_allows(s,p.scope_group,p.source_name);end$$;`);
 const pending=read('migrations/20260915113000_withdraw_pending_daily.sql');
 await db.exec(pending.slice(pending.indexOf('create function public.withdraw_pending_is_count'),pending.indexOf('create function public.publish_withdraw_pending_snapshot')).replace("v_coverage->'expected_count' <> v_coverage->'fetched_count'","(v_coverage->>'fetched_count')::numeric < (v_coverage->>'unique_count')::numeric").replace("(v_group->>'pending_count')::numeric <= 0","(v_group->>'pending_count')::numeric < 0"));
 await db.exec(read('admin-live-provider-aliases.sql'));
 const config=read('admin-live-configuration.sql');await db.exec(config.slice(config.indexOf('create or replace function private.dashboard_admin_live_provider_alias_values'),config.indexOf('revoke all on function private.dashboard_admin_live_provider_alias_values')));
 const canonical=read('admin-live-india-usdt-classification.sql');await db.exec(canonical.slice(canonical.indexOf('create or replace function private.dashboard_admin_live_provider_canonical('),canonical.indexOf('create or replace function private.dashboard_admin_live_provider_rows(')));
 await db.exec(sourceSql);await db.exec(sql);
 await db.exec(fixture('production-snapshot.sql'));await db.exec(fixture('production-analysis.sql'));
 await db.exec(`create sequence native_calls;create sequence seed_calls;
 create or replace function private.dashboard_admin_live_platforms() returns setof public.native_catalog language plpgsql stable security definer set search_path='' as $$declare s jsonb:=private.dashboard_admin_live_scope();begin perform nextval('public.native_calls');return query select * from public.native_catalog p where private.dashboard_scope_allows(s,p.scope_group,p.source_name);end$$;
 create or replace function private.dashboard_admin_live_withdraw_platforms() returns setof public.seed_catalog language plpgsql stable security definer set search_path='' as $$declare s jsonb:=private.dashboard_admin_live_scope();begin perform nextval('public.seed_calls');return query select * from public.seed_catalog p where private.dashboard_scope_allows(s,p.scope_group,p.source_name);end$$;
 create table wg_fixture(value jsonb);
 create function private.dashboard_admin_wg_pending_row(p jsonb,d date,providers text[])returns jsonb language sql stable as $$select coalesce((select value from public.wg_fixture limit 1),jsonb_build_object('id',p->>'id','name',p->>'name','source','wg','state','missing','timezone',p->>'timezone','groups','[]'::jsonb))$$;`);
 baselineMeta=(await db.query("select p.oid::text,to_jsonb(p)-'prosrc' meta from pg_proc p where oid in('private.dashboard_admin_live_pending_analysis(jsonb)'::regprocedure,'private.dashboard_admin_live_pending_snapshot(jsonb)'::regprocedure)")).rows;
 await db.exec(candidate);
});
beforeEach(async()=>{await db.exec('reset role;alter sequence native_calls restart with 1;alter sequence seed_calls restart with 1;truncate wg_fixture,native_catalog,seed_catalog,dashboard_platform_team_map,withdraw_pending_backlog_daily,withdraw_pending_daily,withdraw_pending_orders,newar_detail_platforms;update dashboard_profiles set active=true;update dashboard_admin_preview_grants set can_view=true;');await as(owner);});
after(async()=>{if(db)await db.close()});

let syntheticReceipt=2000;
async function details(platform,orders,options={}){
 const at=options.at||'2026-09-26T18:30:15Z',country=options.country||'IN',source='WITHDRAW_REVIEW',partitions=new Map();
 for(let i=0;i<orders.length;i++){
  const o=orders[i],applied=o.appliedAt===null?null:o.appliedAt||new Date(Date.parse(at)-(o.hours??1)*3600000+5.5*3600000).toISOString().slice(0,19);
  const day=o.day||applied?.slice(0,10)||date;
  if(!partitions.has(day)){
   const receipt=id(++syntheticReceipt);partitions.set(day,receipt);
   await db.query('insert into withdraw_pending_daily values($1,$2,$3,$4,$5,$6,$7,$6)',[source,country,platform,day,receipt,at,JSON.stringify({fixture:'synthetic'})]);
  }
  await db.query('insert into withdraw_pending_orders values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)',
   [source,country,platform,day,'SYNTHETIC_'+i,'SYNTHETIC_MEMBER',o.amount??60,applied,o.zone??'Asia/Kolkata',o.provider||'SYNTHETIC_PAY',o.type||'BANK',o.status||'已提交',o.receipt||partitions.get(day),o.at||at]);
 }
}
const group=(provider,count,amount)=>({raw_channel:provider,channel_type:'BANK',pending_count:count,pending_amount:amount});
const stripTiming=d=>{const copy=structuredClone(d);for(const k of ['businessDate','observationDate','toleranceSeconds','onTimePlatformCount','latePlatformCount'])delete copy[k];for(const r of copy.rows)for(const k of ['businessDate','observationDate','targetAt','observedAt','delaySeconds','toleranceSeconds','timingState'])delete r[k];return copy;};
test('one, seven and 31 days resolve each authorized catalog only once, including separate baseline',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC');
 for(const start of [date,'2026-09-20','2026-08-27']){
  await db.exec('alter sequence native_calls restart with 1;alter sequence seed_calls restart with 1');
  const r=await call([a],{startDate:start});
  assert.equal((await db.query('select last_value n from native_calls')).rows[0].n,1);
  assert.equal((await db.query('select last_value n from seed_calls')).rows[0].n,1);
  assert.equal(r.daily[0].snapshotDate,start);assert.equal(r.daily.at(-1).snapshotDate,date);
  assert.equal(r.baseline.snapshotDate,new Date(Date.parse(start)-86400000).toISOString().slice(0,10));
  assert.equal(r.daily.some(d=>d.snapshotDate===r.baseline.snapshotDate),false);
 }
});
test('daily projection preserves established single-day identity, currency, aliases and missing-state semantics',async()=>{
 const a=await target(1,'RAJA'),b=await target(2,'RAJALOTTERY',{source:'withdraw'}),c=await target(3,'MISSING');
 await snapshot('RAJA',[group('USDT(TRC20)-3',2,20),group('OTHER',3,300)]);
 for(const providers of [[],['TronPayUSDT'],['ABSENT']]){
  const r=await call([a,b,c],{providers});
  const original=(await db.query('select private.dashboard_admin_live_pending_snapshot($1) data',[{date,platformIds:[a,b,c],providers}])).rows[0].data;
  assert.deepEqual(stripTiming(r.daily[0]),original);assert.equal(r.daily[0].expectedPlatformCount,2);
  assert.equal(r.daily[0].rows.find(x=>x.name==='MISSING').count,null);
 }
});
test('baseline remains distinct stock, no range sum; lower-bound baseline is null',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC');
 await snapshot('SYNTHETIC',[group('SYNTHETIC_PAY',9,900)],{day:'2026-09-25',capture:'2026-09-26',start:'2026-09-19',at:'2026-09-25T18:30:15Z'});
 const r=await call([a]);assert.equal(r.baseline.count,9);assert.equal(r.daily[0].count,2);assert.equal(r.count,undefined);assert.equal(r.amount,undefined);
 const low=await call([a],{startDate:'2000-01-01',endDate:'2000-01-01'});assert.equal(low.baseline,null);assert.equal(low.daily.length,1);
});
test('business end date targets next local midnight, exact five-minute boundary remains distinct from late capture',async()=>{
 const ids=[];for(const [i,seconds]of [0,300,301].entries()){
  ids.push(await target(i+1,'P'+i));await snapshot('P'+i,[],{at:new Date(Date.parse('2026-09-26T18:30:00Z')+seconds*1000).toISOString()});
 }
 ids.push(await target(4,'MISSING'));const d=(await call(ids)).daily[0];
 assert.equal(d.snapshotDate,date);assert.equal(d.observationDate,'2026-09-27');assert.equal(d.onTimePlatformCount,2);assert.equal(d.latePlatformCount,1);
 for(const [i,state]of ['on_time','on_time','late'].entries()){
  const r=d.rows.find(r=>r.name==='P'+i);assert.equal(r.timingState,state);assert.equal(r.state,'complete');assert.equal(Date.parse(r.targetAt),Date.parse('2026-09-26T18:30:00Z'));assert.equal(r.delaySeconds,[0,300,301][i]);assert.equal(r.toleranceSeconds,300);
 }
 const missing=d.rows.find(r=>r.name==='MISSING');assert.equal(missing.timingState,'unknown');assert.equal(missing.observedAt,null);
});
test('actual capture-matched aging adds exact inclusive 24/48/72/168-hour counts and amounts at all levels',async()=>{
 const a=await target(1);const ages=[23,24,47,48,71,72,167,168];await snapshot('SYNTHETIC',[group('A',4,40),group('B',4,80)]);
 await details('SYNTHETIC',ages.map((hours,i)=>({hours,provider:i<4?'A':'B',amount:i<4?10:20})));
 const r=(await call([a])).aging;assert.equal(r.complete,true);
 const expected=[[24,7,110],[48,5,90],[72,3,60],[168,1,20]];
 const values=x=>x.thresholds.map(t=>[t.minHours,t.count,+t.amount]);
 assert.deepEqual(values(r),expected);assert.deepEqual(values(r.platforms[0]),expected);
 assert.deepEqual(values(r.platforms[0].groups.find(g=>g.provider==='A')),[[24,3,30],[48,1,10],[72,0,0],[168,0,0]]);
 assert.equal(JSON.stringify(r).includes('SYNTHETIC_MEMBER'),false);
});
test('overwritten or incompatible captures stay unavailable, invalid timestamps remain unknown, never fabricate historical age',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC');await details('SYNTHETIC',[{amount:60},{amount:60,appliedAt:null}]);
 let r=(await call([a])).aging;assert.equal(r.complete,false);assert.equal(r.unknownCount,1);assert.equal(r.count,1);assert.equal(r.thresholds[0].count,0);
 await db.query('update withdraw_pending_daily set snapshot_id=$1',[id(9999)]);r=(await call([a])).aging;
 assert.equal(r.available,false);assert.equal(r.count,null);assert.ok(r.thresholds.every(t=>t.count===null&&t.amount===null));
});
test('WG pre-existing capture remains compatible, greater age thresholds unknown when original feed only contains 24-hour threshold',async()=>{
 const a=await target(1,'WG',{source:'wg'});
 const aging={matchedCount:1,unknownCount:0,unknownAmount:'0',count:1,amount:'10',over24Count:1,over24Amount:'10',maxHours:30,avgHours:30,groups:[],buckets:[]};
 await db.query('insert into wg_fixture values($1)',[{id:a,name:'WG',source:'wg',state:'complete',currency:'INR',timezone:'Asia/Kolkata',count:1,amount:'10',snapshotAt:'2026-09-26T18:30:15Z',groups:[],wgAging:aging}]);
 const r=await call([a]);assert.equal(r.daily[0].rows[0].timingState,'on_time');assert.equal(r.aging.available,true);
 assert.deepEqual(r.aging.thresholds,[{minHours:24,count:1,amount:'10'},...[48,72,168].map(minHours=>({minHours,count:null,amount:null}))]);
});
test('fresh scope and single-currency checks remain fail-closed; internal helpers cannot accept forged caller scope',async()=>{
 const a=await target(1,'ALLOW'),b=await target(2,'OTHER',{country:'PK',currency:'PKR'});await snapshot('ALLOW');
 await assert.rejects(()=>call([a,b]),/mixed_currency/);await as(viewer);await db.exec('set role authenticated');assert.equal((await call([a])).daily[0].count,2);
 await assert.rejects(()=>call([b]),/platform_denied/);await assert.rejects(()=>db.query('select * from withdraw_pending_backlog_daily'),/permission denied/);
 for(const f of ['private.dashboard_admin_pending_resolve(\'{}\',\'{"mode":"all"}\')','private.dashboard_admin_pending_resolved_day(\'{}\',\'{}\',\'[]\',\'[]\')','private.dashboard_admin_pending_observation(\'{}\')'])await assert.rejects(()=>db.query('select '+f),/permission denied/);
 await db.exec('reset role;update dashboard_profiles set active=false');await assert.rejects(()=>call([a]),/preview_denied/);
});
test('new helper ACLs, original metadata and source tables remain unchanged by read',async()=>{
 const current=(await db.query("select p.oid::text,to_jsonb(p)-'prosrc' meta from pg_proc p where oid in('private.dashboard_admin_live_pending_analysis(jsonb)'::regprocedure,'private.dashboard_admin_live_pending_snapshot(jsonb)'::regprocedure)")).rows;
 assert.deepEqual(current,baselineMeta);const a=await target(1);await snapshot('SYNTHETIC');const rows=(await db.query('select * from withdraw_pending_backlog_daily')).rows;
 await call([a]);assert.deepEqual((await db.query('select * from withdraw_pending_backlog_daily')).rows,rows);
 for(const signature of ['private.dashboard_admin_pending_resolve(jsonb,jsonb)','private.dashboard_admin_pending_resolved_day(jsonb,jsonb,jsonb,jsonb)','private.dashboard_admin_pending_observation(jsonb)']){
  const a=(await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service",[signature])).rows[0];assert.deepEqual(a,{anon:false,authenticated:false,service:false});
 }
});
test('invalid range, duplicate identities, providers and unsupported inputs retain explicit errors',async()=>{
 const a=await target(1);for(const extra of [{startDate:'2026-08-26'},{endDate:'2026-02-30'},{operation:'summary'},{providers:['X','X']}])await assert.rejects(()=>call([a],extra),/invalid_|duplicate_/);
 await assert.rejects(()=>call([a,a]),/duplicate_platform/);await assert.rejects(()=>call([id(999)]),/platform_denied/);
});
test('guarded migration rejects private/public definition or ACL drift before adding helpers',async()=>{
 // Validate guard against original functions inside a rollback-only local transaction.
 for(const change of [
  'grant execute on function private.dashboard_admin_live_pending_analysis(jsonb) to service_role',
  'revoke execute on function private.dashboard_admin_live_pending_snapshot(jsonb) from authenticated',
  "alter function public.dashboard_admin_live_pending_analysis(jsonb) set search_path='public'",
  "create or replace function private.dashboard_admin_live_pending_analysis(p_request jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$begin return '{}'::jsonb;end$$"
 ]){
  await db.exec('begin;drop function private.dashboard_admin_pending_resolve(jsonb,jsonb);drop function private.dashboard_admin_pending_resolved_day(jsonb,jsonb,jsonb,jsonb);drop function private.dashboard_admin_pending_observation(jsonb);'+fixture('production-analysis.sql')+change+';');
  await assert.rejects(()=>db.exec(candidate),/pending_range_baseline_drift/);await db.exec('rollback');
 }
});
test('unsupported platform invalid timezone remains unsupported instead of aborting all platforms',async()=>{
 const a=await target(1,'BAD',{source:'lg'}),b=await target(2,'GOOD');await db.exec("update native_catalog set timezone='Not/A_Real_Zone'where name='BAD'");await snapshot('GOOD');
 const r=await call([a,b]);const bad=r.daily[0].rows.find(x=>x.name==='BAD');assert.equal(bad.state,'unsupported');assert.equal(bad.timingState,'unknown');assert.equal(bad.targetAt,null);assert.equal(r.daily[0].receivedPlatformCount,1);
});
test('exact country identities, ambiguous heads and invalid coverage are not silently merged or converted to zero',async()=>{
 const a=await target(1,'SAME'),b=await target(2,'SAME',{country:'BR'});await snapshot('SAME');await snapshot('SAME',[],{country:'BR'});
 let r=await call([a,b]);assert.equal(r.daily[0].expectedPlatformCount,2);assert.deepEqual(r.daily[0].rows.map(x=>[x.scopeGroup,x.count]).sort(),[['BR',0],['IN',2]]);
 await db.exec("insert into withdraw_pending_backlog_daily select 'OTHER_SOURCE',country_code,platform,stat_date,capture_date,window_start,window_end,snapshot_id,snapshot_at,snapshot,updated_at from withdraw_pending_backlog_daily where country_code='IN'");
 r=await call([a,b]);assert.equal(r.daily[0].rows.find(x=>x.scopeGroup==='IN').state,'ambiguous');assert.equal(r.daily[0].rows.find(x=>x.scopeGroup==='IN').count,null);
 await db.exec("delete from withdraw_pending_backlog_daily where source_system='OTHER_SOURCE';update withdraw_pending_backlog_daily set snapshot=jsonb_set(snapshot,'{coverage,complete}','false')where country_code='IN'");
 r=await call([a]);assert.equal(r.daily[0].rows[0].state,'invalid');assert.equal(r.daily[0].count,null);
});
