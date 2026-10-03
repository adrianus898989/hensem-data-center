// Real local PostgreSQL (PGlite); synthetic rows only, no network or production mutation.
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sql=read('supabase/admin-live-pending-stock.sql');
const id=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0');
let db,beforeMeta;
async function target(n,source='lg',o={}){
 const currency=o.currency||'PHP',country=o.country||'PH',name=o.name||'SYNTHETIC_'+n;
 await db.query('insert into native_catalog values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id(n),name,'TEAM',country,country,source,o.timezone||'Asia/Manila',currency,name]);return id(n);
}
async function call(ids,extra={mode:'current'}){return(await db.query('select public.dashboard_admin_live_pending_snapshot($1::jsonb) value',[JSON.stringify({platformIds:ids,...extra})])).rows[0].value;}
async function order(platform,no,amount,options={}){
 await db.query(`insert into lg_orders(source_system,platform,country_code,order_kind,order_no,status_class,metric_amount,third_party,raw_channel,payment_method,updated_at,stat_date)
 values('LG',$1,$2,'withdraw',$3,$4,$5,$6,$6,'BANK',statement_timestamp()-interval '2 hours','2020-01-01')`,[platform,options.country||'PH',no,options.status||'pending',amount,options.provider||'PAY']);
}
async function capture(platform,orders=[],o={}){
 const sid=id(1000+(o.n||0));
 const query=`insert into lg_pending_runs(snapshot_id,platform,country_code,capture_date,observed_at,captured_at,expected_count,expected_chunks,source_total,fetched_count,status,pending_window_days)
 values($1,$2,'PH',coalesce($7::date,(statement_timestamp() at time zone 'Asia/Manila')::date),coalesce($8::timestamptz,statement_timestamp()-$11::integer*interval '1 minute'),coalesce($8::timestamptz+interval '1 second',statement_timestamp()-interval '1 minute'),$3,$4,$5,$6,$9,$10)`;
 await db.query(query,[sid,platform,o.expected??orders.length,orders.length?1:0,o.total??orders.length,o.fetched??orders.length,o.date||null,o.at||null,o.status||'published',o.window??null,o.age||5]);
 if(orders.length)await db.query('insert into lg_pending_chunks values($1,0,$2)',[sid,o.chunkCount??orders.length]);
 for(let i=0;i<orders.length;i++)await db.query('insert into lg_pending_snapshot_orders values($1,$2,$3,$4,$5,$6,$7,$8)',[sid,'SYNTHETIC_'+i,orders[i].amount,orders[i].actual??null,'2020-01-01',orders[i].provider||'PAY',orders[i].provider||'PAY','BANK']);return sid;
}
before(async()=>{
 db=new PGlite();
 await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
 grant usage on schema private to authenticated;
 create table native_catalog(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text);
 create table seed_catalog(like native_catalog);
 create table dashboard_platform_team_map(country_code text,source_platform text,platform_name text,team_name text,active boolean);
 create table withdraw_pending_backlog_daily(source_system text,country_code text,platform text,stat_date date,capture_date date,window_start date,window_end date,snapshot_id uuid,snapshot_at timestamptz,snapshot jsonb,updated_at timestamptz);
 create table newar_detail_platforms(country_code text,platform text,timezone text,launch_at timestamptz);
 create function private.dashboard_admin_live_scope()returns jsonb language plpgsql stable security definer set search_path=''as $$begin if current_setting('test.allow',true)<>'yes'then raise exception 'preview_denied';end if;return '{"mode":"all"}';end$$;
 create function private.dashboard_scope_allows(jsonb,text,text)returns boolean language sql immutable as $$select coalesce($1->>'mode'='all'and $2<>'DENIED',false)$$;
 create function private.dashboard_admin_live_platforms()returns setof native_catalog language sql stable security definer set search_path=''as $$select *from public.native_catalog n where private.dashboard_scope_allows(private.dashboard_admin_live_scope(),n.scope_group,n.source_name)$$;
 create function private.dashboard_admin_live_withdraw_platforms()returns setof seed_catalog language sql stable security definer set search_path=''as $$select *from public.seed_catalog n where private.dashboard_scope_allows(private.dashboard_admin_live_scope(),n.scope_group,n.source_name)$$;
 create function private.dashboard_admin_pending_platform_key(text,text)returns text language sql immutable set search_path=''as $$select upper(btrim($2))$$;
 create function private.dashboard_admin_live_provider_canonical(text,text,text)returns text language sql stable set search_path=''as $$select upper(coalesce(nullif(btrim($3),''),'未识别通道'))$$;
 create function public.withdraw_pending_assert_snapshot(jsonb)returns void language plpgsql as $$begin if $1#>>'{coverage,complete}'<>'true'then raise exception 'invalid_snapshot';end if;end$$;
 create function private.dashboard_admin_wg_pending_row(jsonb,date,text[])returns jsonb language sql stable set search_path=''as $$select jsonb_build_object('id',$1->>'id','source','wg','state','missing','groups','[]'::jsonb)$$;
 create table wg_sites(site_code text,country_code text,platform text);
 create function private.dashboard_admin_wg_sites()returns setof wg_sites language sql stable set search_path=''as $$select *from public.wg_sites$$;
 create table game66_withdraw_orders(id uuid,platform_id uuid,status_code text,amount_display numeric,amount_minor numeric,pay_channel text,pay_method_name text,payout_mode text,last_seen_at timestamptz);
 create index game66_withdraw_orders_platform_status_idx on game66_withdraw_orders(platform_id,status_code);
 create table wg_withdraw_details(site_code text,status_group text,status_code integer,member_amount numeric,member_currency text,provider text,channel text,settlement_currency text,settlement_amount numeric,stored_at timestamptz);
 create index wg_withdraw_details_status on wg_withdraw_details(site_code,status_group);
 create table lg_orders(source_system text,platform text,country_code text,order_kind text,order_no text,status_class text,metric_amount numeric,third_party text,raw_channel text,payment_method text,updated_at timestamptz,stat_date date);
 create index lg_orders_pending_dates on lg_orders(platform,order_kind,stat_date)where status_class=any(array['pending'::text,'unknown'::text]);
 create table lg_pending_runs(snapshot_id uuid primary key,platform text,country_code text,capture_date date,observed_at timestamptz,captured_at timestamptz,expected_count bigint,expected_chunks integer,source_total bigint,fetched_count bigint,status text,pending_window_days integer);
 create index lg_pending_runs_scope on lg_pending_runs(platform,country_code,capture_date,status);
 create table lg_pending_chunks(snapshot_id uuid,chunk_index integer,order_count integer,primary key(snapshot_id,chunk_index));
 create table lg_pending_snapshot_orders(snapshot_id uuid,order_no text,order_amount numeric,actual_amount numeric,created_at timestamptz,third_party text,raw_channel text,payment_method text,primary key(snapshot_id,order_no));`);
 await db.exec(read('tests/fixtures/pending-analysis/capture-schema.sql'));
 await db.exec(`create function private.dashboard_admin_pending_archive_currency(uuid)returns text language sql stable set search_path=''as $$select currency from private.withdraw_pending_capture_archive where id=$1$$;`);
 await db.exec(read('tests/fixtures/pending-analysis/production-stock-dependencies.sql'));
 await db.exec(read('tests/fixtures/pending-analysis/production-snapshot.sql'));
 await db.exec(`revoke all on function private.dashboard_admin_live_pending_snapshot(jsonb)from public,anon,service_role;grant execute on function private.dashboard_admin_live_pending_snapshot(jsonb)to authenticated;
 create function public.dashboard_admin_live_pending_snapshot(jsonb)returns jsonb language sql stable security invoker set search_path=''as $$select private.dashboard_admin_live_pending_snapshot($1)$$;
 revoke all on function public.dashboard_admin_live_pending_snapshot(jsonb)from public,anon,service_role;grant execute on function public.dashboard_admin_live_pending_snapshot(jsonb)to authenticated;
 revoke all on function private.dashboard_admin_pending_resolve(jsonb,jsonb),private.dashboard_admin_pending_capture_heads(jsonb,jsonb,date,date),private.dashboard_admin_pending_capture_day(jsonb,jsonb,jsonb)from public,anon,authenticated,service_role;`);
 beforeMeta=(await db.query("select oid::text,proacl::text,proconfig,proowner::text,prosecdef,provolatile from pg_proc where oid in('private.dashboard_admin_live_pending_snapshot(jsonb)'::regprocedure,'public.dashboard_admin_live_pending_snapshot(jsonb)'::regprocedure)order by oid")).rows;
 await db.exec('create role custom_observer;alter default privileges grant execute on functions to custom_observer;');
 await db.exec(sql);
});
beforeEach(async()=>{await db.exec(`reset role;select set_config('test.allow','yes',false);truncate native_catalog,seed_catalog,dashboard_platform_team_map,withdraw_pending_backlog_daily,newar_detail_platforms,private.withdraw_pending_capture_archive,private.withdraw_pending_capture_orders,wg_sites,game66_withdraw_orders,wg_withdraw_details,lg_orders,lg_pending_runs,lg_pending_chunks,lg_pending_snapshot_orders;`);});
after(async()=>{if(db)await db.close()});
test('LG current stored subtotal includes old creation dates and excludes successful/foreign rows',async()=>{
 const a=await target(1);await order('SYNTHETIC_1','OLD',56596);await order('SYNTHETIC_1','PAID',999999,{status:'success'});await order('SYNTHETIC_1','FOREIGN',999999,{country:'BR'});
 const r=await call([a]);assert.equal(r.basis,'current_all_pending_stock');assert.equal(r.knownCount,1);assert.equal(r.knownAmount,'56596');assert.equal(r.complete,false);assert.equal(r.count,null);assert.equal(r.amount,null);assert.equal(r.rows[0].groups[0].provider,'PAY');assert.equal(r.rows[0].observedAt,null);assert.equal(r.rows[0].freshnessState,'unverified');
});
test('empty stored status rows and unsupported AR/NEWAR remain unknown, never source zero',async()=>{
 const ids=await Promise.all(['lg','game66','wg','ar','newar'].map((s,i)=>target(i+1,s)));
 await db.exec("insert into wg_sites values('S','PH','SYNTHETIC_3')");const r=await call(ids);assert.equal(r.knownCount,null);assert.equal(r.knownAmount,null);assert.equal(r.count,null);assert.equal(r.complete,false);assert.equal(r.rows.length,5);assert(r.rows.every(x=>x.count===null&&x.amount===null));
});
test('GAME66 decimal/minor amount projection matches existing aggregate and has no date cutoff',async()=>{
 const a=await target(1,'game66',{currency:'INR',country:'IN'});await db.query("insert into game66_withdraw_orders values($1,$2,'1',null,12345,'PAY','METHOD','BANK','2020-01-01')",[id(11),a]);
 const r=await call([a]);assert.equal(r.knownAmount,'123.4500000000000000');assert.equal(r.knownCount,1);assert.equal(r.rows[0].wholeStockComplete,false);assert.deepEqual(r.rows[0].settlementAmounts,[]);
});
test('WG fiat amount and independently labelled settlement currencies never add together',async()=>{
 const a=await target(1,'wg',{currency:'VND',country:'VN'});await db.exec("insert into wg_sites values('S','VN','SYNTHETIC_1');insert into wg_withdraw_details values('S','paying',3,25000,'VND','Pay','BANK','USDT',1.02,'2020-01-01'),('S','paying',3,50000,'VND','Pay','BANK','PHP',2,'2020-01-01'),('S','success',2,999999,'VND','Pay','BANK','USDT',999,'2020-01-01')");
 const r=await call([a]);assert.equal(r.knownAmount,'75000');assert.equal(r.currency,'VND');assert.equal(r.rows[0].settlementAmounts.length,2);assert.deepEqual(r.rows[0].settlementAmounts.map(x=>x.currency),['PHP','USDT']);assert.equal(r.rows[0].settlementAmounts.find(x=>x.currency==='USDT').amount,'1.02');
});
test('missing amount stays null independently of an available pending count',async()=>{
 const a=await target(1);await order('SYNTHETIC_1','MISSING_MONEY',null);const r=await call([a]);assert.equal(r.knownCount,1);assert.equal(r.knownAmount,null);assert.equal(r.rows[0].knownAmount,null);assert.equal(r.rows[0].wholeStockComplete,false);
});
test('receipt-verified fresh whole LG capture accepts true zero and rejects incomplete head counts',async()=>{
 const a=await target(1);await capture('SYNTHETIC_1',[]);let r=await call([a]);assert.equal(r.complete,true);assert.equal(r.count,0);assert.equal(r.amount,'0');assert.equal(r.rows[0].captureVerified,true);
 await db.exec('truncate lg_pending_runs');await capture('SYNTHETIC_1',[],{total:1});r=await call([a]);assert.equal(r.complete,false);assert.equal(r.knownAmount,null);assert.equal(r.rows[0].reason,'receipt_inconsistent');
});
test('latest complete full capture includes superseded finish, while 7-day and collecting captures cannot replace it',async()=>{
 const a=await target(1);await capture('SYNTHETIC_1',[{amount:10}],{n:1,age:10});await capture('SYNTHETIC_1',[{amount:20}],{n:2,age:5,status:'superseded'});await capture('SYNTHETIC_1',[{amount:900}],{n:3,age:3,window:7});await capture('SYNTHETIC_1',[{amount:999}],{n:4,age:2,status:'collecting'});
 const r=await call([a]);assert.equal(r.complete,true);assert.equal(+r.amount,20);assert.equal(r.rows[0].captureId,id(1002));
});
test('stale source capture is labelled with actual source time, not the query time',async()=>{
 const a=await target(1);await capture('SYNTHETIC_1',[{amount:10}],{age:90});const r=await call([a]);assert.equal(r.complete,false);assert.equal(r.rows[0].state,'stale');assert.equal(r.knownAmount,'10');assert.notEqual(r.rows[0].observedAt,r.queriedAt);
});
test('broken published detail/chunk receipts do not become trusted subtotals',async()=>{
 const a=await target(1);await capture('SYNTHETIC_1',[{amount:10}],{chunkCount:0});let r=await call([a]);assert.equal(r.knownCount,null);assert.equal(r.rows[0].state,'invalid');
 await db.exec('truncate lg_pending_runs,lg_pending_chunks,lg_pending_snapshot_orders');const sid=await capture('SYNTHETIC_1',[{amount:10}]);await db.query('delete from lg_pending_snapshot_orders where snapshot_id=$1',[sid]);r=await call([a]);assert.equal(r.knownAmount,null);assert.equal(r.rows[0].reason,'receipt_inconsistent');
});
test('midnight selected 2nd maps to source business 1st and rejects later mutable/late observations',async()=>{
 const a=await target(1);await capture('SYNTHETIC_1',[{amount:20}],{date:'2026-10-02',at:'2026-10-01T16:00:10Z'});await capture('SYNTHETIC_1',[{amount:99}],{n:2,date:'2026-10-02',at:'2026-10-01T17:00:00Z'});
 const r=await call([a],{mode:'midnight',date:'2026-10-02'});assert.equal(r.sourceDate,'2026-10-01');assert.equal(r.date,'2026-10-02');assert.equal(r.complete,true);assert.equal(+r.amount,20);assert.equal(r.rows[0].midnightEligible,true);
});
test('historical seven-day LG capture is a verified window subtotal, not whole inventory',async()=>{
 const a=await target(1);await capture('SYNTHETIC_1',[{amount:20}],{date:'2026-10-02',at:'2026-10-01T16:00:10Z',window:7});const r=await call([a],{mode:'midnight',date:'2026-10-02'});assert.equal(r.complete,false);assert.equal(r.knownAmount,'20');assert.equal(r.rows[0].coverageScope,'last_7_created_days');assert.equal(r.rows[0].windowComplete,true);assert.equal(r.count,null);
});
test('provider filters use canonical names without changing source receipt verification',async()=>{
 const a=await target(1);await capture('SYNTHETIC_1',[{amount:10,provider:' pay '},{amount:20,provider:'OTHER'}]);const r=await call([a],{mode:'current',providers:['PAY']});assert.equal(r.complete,true);assert.equal(r.count,1);assert.equal(+r.amount,10);assert.equal(r.rows[0].groups.length,1);
});
test('future local midnight, mixed currency, unauthorized identity, malformed mode and duplicate IDs are rejected',async()=>{
 const a=await target(1),b=await target(2,'lg',{currency:'INR',country:'IN'}),denied=await target(3,'lg',{country:'DENIED'});
 const future=(await db.query("select ((statement_timestamp()at time zone 'Asia/Manila')::date+1)::text d")).rows[0].d;
 for(const [ids,extra,pattern]of [[[a],{mode:'midnight',date:future},/invalid_date/],[[a,b],{mode:'current'},/mixed_currency/],[[denied],{mode:'current'},/platform_denied/],[[a],{mode:'current',date:'2026-10-02'},/invalid_request/],[[a],{mode:'latest'},/invalid_request/],[[a,a],{mode:'current'},/duplicate_platform/]])await assert.rejects(()=>call(ids,extra),pattern);
 await db.exec("select set_config('test.allow','no',false)");await assert.rejects(()=>call([a]),/preview_denied/);
});
test('read API leaves every source row unchanged and preserves original entrypoint OIDs/ACLs',async()=>{
 const a=await target(1);await order('SYNTHETIC_1','OLD',10);const prior=(await db.query('select to_jsonb(s)r from lg_orders s')).rows;await call([a]);assert.deepEqual((await db.query('select to_jsonb(s)r from lg_orders s')).rows,prior);
 assert.deepEqual((await db.query("select oid::text,proacl::text,proconfig,proowner::text,prosecdef,provolatile from pg_proc where oid in('private.dashboard_admin_live_pending_snapshot(jsonb)'::regprocedure,'public.dashboard_admin_live_pending_snapshot(jsonb)'::regprocedure)order by oid")).rows,beforeMeta);
 for(const f of ['private.dashboard_admin_pending_stock_legacy_v1(jsonb)','private.dashboard_admin_pending_stock_row_v1(jsonb,text[],integer,text,date)'])for(const role of ['anon','authenticated','service_role','custom_observer'])assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\')a',[role,f])).rows[0].a,false);
});
test('bounded LG index candidates include unknown/foreign rows in budget, without leaking their counts publicly',async()=>{
 const a=await target(1);await order('SYNTHETIC_1','UNKNOWN_1',999,{status:'unknown'});await order('SYNTHETIC_1','UNKNOWN_2',999,{status:'unknown'});await order('SYNTHETIC_1','PENDING',10);
 const p=(await db.query('select to_jsonb(p) p from native_catalog p where id=$1',[a])).rows[0].p;
 const r=(await db.query("select private.dashboard_admin_pending_stock_row_v1($1,'{}',1,'current',null) r",[p])).rows[0].r;
 assert.equal(r.readRows,1);assert.equal(r.reason,'query_budget_exhausted');assert.equal(r.knownCount,null);
 const response=await call([a]);assert.equal(response.knownCount,1);assert.equal(response.rows[0].readRows,undefined);assert.equal(response.rows[0].sourceRows,undefined);
});
test('invalid capture receipts stay invalid even when their expected count exceeds the row budget',async()=>{
 const a=await target(1);await capture('SYNTHETIC_1',[{amount:10},{amount:20}],{total:99});const p=(await db.query('select to_jsonb(p)p from native_catalog p where id=$1',[a])).rows[0].p;
 let r=(await db.query("select private.dashboard_admin_pending_stock_row_v1($1,'{}',1,'current',null)r",[p])).rows[0].r;
 assert.equal(r.state,'invalid');assert.equal(r.reason,'receipt_inconsistent');assert.equal(r.knownCount,undefined);
 await db.exec('truncate lg_pending_runs,lg_pending_chunks,lg_pending_snapshot_orders');await capture('SYNTHETIC_1',[{amount:10},{amount:20}]);r=(await db.query("select private.dashboard_admin_pending_stock_row_v1($1,'{}',1,'current',null)r",[p])).rows[0].r;
 assert.equal(r.state,'partial');assert.equal(r.reason,'query_budget_exhausted');assert.equal(r.wholeStockComplete,false);assert.equal(r.knownCount,1);
});
test('same-time conflicting full heads stay ambiguous instead of choosing a plausible first receipt',async()=>{
 const a=await target(1),at=(await db.query("select (statement_timestamp()-interval '2 minutes')::text a")).rows[0].a;
 await capture('SYNTHETIC_1',[{amount:10}],{at,n:1});await capture('SYNTHETIC_1',[{amount:20}],{at,n:2});const r=await call([a]);assert.equal(r.rows[0].state,'ambiguous');assert.equal(r.knownAmount,null);
});
test('verified AR seven-day zero is only window zero; mutable zero is not historical proof',async()=>{
 const a=await target(1,'ar'),sid=id(9000),aid=id(9001),at='2026-10-01T16:00:10Z';
 const snapshot={schema_version:1,source_system:'WITHDRAW_REVIEW',country_code:'PH',platform:'SYNTHETIC_1',stat_date:'2026-10-01',timezone:'Asia/Manila',snapshot_id:sid,snapshot_at:at,coverage:{complete:true,expected_count:0,fetched_count:0,unique_count:0},totals:{pending_count:0,pending_amount:0},groups:[]};
 await db.query("insert into withdraw_pending_backlog_daily values('WITHDRAW_REVIEW','PH','SYNTHETIC_1','2026-10-01','2026-10-02','2026-09-25','2026-10-01',$1,$2,$3,$2)",[sid,at,snapshot]);
 await db.query(`insert into private.withdraw_pending_capture_archive(id,source_system,country_code,platform,stat_date,capture_date,window_start,window_end,window_days,snapshot_id,snapshot_at,snapshot,timezone,capture_basis,within_midnight_window,identity_status,native_source_system,platform_id,team_name,currency,partition_snapshots,pending_count,pending_amount)
 values($1,'WITHDRAW_REVIEW','PH','SYNTHETIC_1','2026-10-01','2026-10-02','2026-09-25','2026-10-01',7,$2,$3,$4,'Asia/Manila','actual_capture',true,'resolved','AR',$5,'TEAM','PHP','[]',0,0)`,[aid,sid,at,snapshot,a]);
 let r=await call([a],{mode:'midnight',date:'2026-10-02'});assert.equal(r.rows[0].windowComplete,true);assert.equal(r.knownCount,0);assert.equal(r.knownAmount,'0');assert.equal(r.complete,false);assert.equal(r.count,null);assert.equal(r.rows[0].coverageScope,'last_7_created_days');
 await db.exec('truncate private.withdraw_pending_capture_archive cascade');r=await call([a],{mode:'midnight',date:'2026-10-02'});assert.equal(r.knownCount,null);assert.equal(r.rows[0].reason,'capture_not_verified');
});
test('legacy request keeps original v1 contract and explicit modes never use it',async()=>{
 const a=await target(1,'game66',{currency:'INR',country:'IN'});const r=await call([a],{date:'2026-10-01'});assert.equal(r.version,1);assert.equal(r.basis,'seven_day_pending_snapshot');
});
test('query cancellation is propagated instead of being disguised as partial platform data',async()=>{
 const a=await target(1);await order('SYNTHETIC_1','ONE',10);await db.exec('begin');
 try{await db.exec("create or replace function private.dashboard_admin_live_provider_canonical(text,text,text)returns text language plpgsql stable set search_path=''as $$begin raise query_canceled;end$$");await assert.rejects(()=>call([a]),e=>e.code==='57014');}finally{await db.exec('rollback');}
});
test('baseline and index/predicate drift reject the whole update before replacing any reader',async()=>{
 for(const [mutation,pattern]of [
  ['grant execute on function private.dashboard_admin_live_pending_snapshot(jsonb)to service_role',/pending_stock_baseline_drift/],
  ['drop index game66_withdraw_orders_platform_status_idx',/pending_stock_safe_index_required/],
  ["drop index lg_orders_pending_dates;create index lg_orders_pending_dates on lg_orders(platform,order_kind,stat_date)where status_class='success'",/pending_stock_safe_index_required/]
 ]){
  await db.exec('begin');
  try{
   await db.exec(read('tests/fixtures/pending-analysis/production-snapshot.sql'));
   await db.exec('drop function private.dashboard_admin_pending_stock_legacy_v1(jsonb);drop function private.dashboard_admin_pending_stock_row_v1(jsonb,text[],integer,text,date);'+mutation);
   await assert.rejects(()=>db.exec(sql),pattern);
  }finally{await db.exec('rollback');}
 }
 assert.equal((await db.query("select to_regprocedure('private.dashboard_admin_pending_stock_row_v1(jsonb,text[],integer,text,date)')is not null present")).rows[0].present,true);
});
