// Isolated fixtures only. No database connection or production authentication.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');let db;
const read=n=>fs.readFileSync(path.join(__dirname,'../supabase',n),'utf8');
const call=async p=>(await db.query('select public.dashboard_admin_live_collected_data($1::jsonb) data',[JSON.stringify(p)])).rows[0].data;
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql as $$begin if coalesce(current_setting('test.scope',true),'')='' then raise exception 'unauthorized';end if;return current_setting('test.scope')::jsonb;end$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select $1->>'mode'='all' or coalesce($1->'countries' ? $2,false) and (not($1 ? 'platforms') or $1->'platforms' ? $3)$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select case upper($1) when 'VEER.GAME' then 'VEERGAME' else upper($1) end$$;
 create function private.dashboard_admin_live_deposit_platform_key(text,text) returns text language sql immutable as $$select case when $1='印度' and upper($2)='INDIA82' then '82LOTTERY' else private.dashboard_admin_live_withdraw_key($2) end$$;
 create table lg_orders(country_code text,platform text,order_no text,order_kind text,order_amount numeric,status_text text,status_class text,created_at timestamptz,paid_at timestamptz,finished_at timestamptz,third_party text,raw_channel text,updated_at timestamptz,member_id text);
 create index lg_created on lg_orders(country_code,platform,order_kind,created_at);
 create table lg_success_daily(country_code text,platform text,stat_date date,observed_at timestamptz,updated_at timestamptz,order_kind text,scope_type text,third_party text,raw_channel text,total_count bigint,success_count bigint,failed_count bigint,pending_count bigint,unknown_count bigint,total_amount numeric,success_amount numeric);
 create table lg_pending_daily(country_code text,platform text,stat_date date,updated_at timestamptz,snapshot jsonb);
 create table collection_success_daily(source_system text,country_code text,platform text,stat_date date,snapshot_at timestamptz,updated_at timestamptz,snapshot jsonb);
 create table withdraw_member_notes_daily(like collection_success_daily);
 create table workorder_daily_bundle(system_name text,country text,country_code text,platform text,stat_date date,source_updated_at timestamptz,updated_at timestamptz,daily_rows jsonb);
 create table panda_config_dictionary_daily(country_code text,platform text,observed_local_date date,received_at timestamptz);
 create table withdraw_pending_orders(source_system text,country_code text,platform text,stat_date date,snapshot_at timestamptz,updated_at timestamptz,raw_channel text,amount numeric);
 create table provider_midnight_snapshots(source_system text,country_code text,platform text,scheduled_at timestamptz,timezone text,received_at timestamptz);
 create table game66_platforms(id uuid,platform_name text,team_name text);
 create table game66_dictionary_snapshots(platform_id uuid,fetched_at timestamptz,data_type text);
 create table dashboard_platform_team_map(team_name text,source_system text,source_country text,source_platform text,platform_name text,active boolean default true);
 create table third_party_volume(country text,platform text,data_date date,updated_at timestamptz,direction text,raw_channel text,channel text,amount numeric,count int,success_count int,failed_count int,quarantined_at timestamptz,raw jsonb);
 create table panda_success_rate_daily(country text,country_code text,platform text,stat_date date,updated_at timestamptz,direction text,third_party text,submitted_count int,success_count int,failed_count int);
 create table auto_withdraw_daily(country text,platform text,data_date date,source_updated_at timestamptz,updated_at timestamptz,total int,success int,rejected int,auto_count int,manual_count int,avg_seconds numeric);
 create table withdraw_operator_daily(country text,platform text,data_date date,source_updated_at timestamptz,updated_at timestamptz,account text,processed int,rejected int,avg_seconds numeric);
 create table workorder_deposit_daily(source_system text,country text,country_code text,platform text,stat_date date,source_updated_at timestamptz,updated_at timestamptz,third_party text,submitted_count int,submitted_amount numeric,success_count int,success_amount numeric,withdraw_not_received_count int,withdraw_not_received_amount numeric,withdraw_success_count int,withdraw_success_amount numeric);
 create table withdraw_pending_daily(source_system text,country_code text,platform text,stat_date date,snapshot_at timestamptz,updated_at timestamptz,snapshot jsonb);
 create table withdraw_pending_backlog_daily(like withdraw_pending_daily);
 create table withdraw_reasons_daily(like withdraw_pending_daily);
 create table ar_config_daily(country_code text,platform text,observed_local_date date,received_at timestamptz,configuration jsonb);
 create table panda_config_daily(like ar_config_daily);create table wg_config_daily(like ar_config_daily);
 create table newar_business_snapshots(kind text,country text,country_code text,platform text,stat_date date,captured_at timestamptz,updated_at timestamptz,direction text,payload jsonb);
 create table admin_deposit_issue_rows(country text,platform text,record_date date,source_updated_at timestamptz,updated_at timestamptz,provider text,amount numeric);
 create table admin_deposit_followup_rows(country text,platform text,followup_date date,source_updated_at timestamptz,updated_at timestamptz,provider text,amount numeric);
 select set_config('test.scope','{"mode":"all"}',false);
 insert into dashboard_platform_team_map values('M8','AR','印度','VEERGAME','Veer.Game',true),('M8','WG','巴西','WG-DEMO','WG-DEMO',true);
 insert into lg_orders(country_code,platform,order_no,order_kind,order_amount,status_class,created_at,paid_at,member_id) values('PH','LG-ORDER-ONLY','O1','recharge',100,'success','2026-09-23T17:00:00Z','2026-09-24T01:00:00Z','PRIVATE-MEMBER');
 insert into lg_success_daily(country_code,platform,stat_date,order_kind,scope_type,total_count,total_amount) values('PH','LG-ONLY','2026-09-24','recharge','platform',10,500);
 insert into third_party_volume values('胖虎巴西','FUTURE-PANGHU','2026-09-24',now(),'代收','RAW','A',1234,12,10,2,null,'{"token":"NEVER-RETURN"}'),('印度','Veer.Game','2026-09-24',now(),'代收','UPI','UPI',500,5,4,1,null,'{}'),('印度','QUARANTINED','2026-09-24',now(),'代收','x','x',9999,99,0,99,now(),'{}'),('新地区','UNASSIGNED','2026-09-24',now(),'代付','x','x',50,1,1,0,null,'{}');
 insert into panda_success_rate_daily values('胖虎巴西','BR','FUTURE-PANGHU','2026-09-24',now(),'charge','P',12,10,2);
 insert into auto_withdraw_daily values('巴西','776F','2026-09-24',now(),now(),10,8,2,5,5,60);
 insert into withdraw_operator_daily values('新地区','OPERATOR-ONLY','2026-09-24',now(),now(),'agent',10,2,60);
 insert into wg_config_daily values('BR','WG-DEMO','2026-09-24',now(),'{"private":"NEVER-RETURN"}');
 insert into withdraw_pending_daily values('AR','IN','Veer.Game','2026-09-24',now(),now(),'{"totals":{"pending_count":3,"pending_amount":120},"private":"NEVER-RETURN"}');
 insert into newar_business_snapshots values('third_party_volume','印度','IN','NEW-DEMO','2026-09-24',now(),now(),'charge','{"rows":[{"amount":100,"count":2,"member":"NEVER-RETURN"}]}');`);
 const catalog=read('admin-live-platform-catalog-map.sql');await db.exec(catalog.slice(catalog.indexOf('create or replace function private.dashboard_admin_live_is_panghu_platform'),catalog.indexOf('create or replace function private.dashboard_admin_live_platforms()')));
 await db.exec(read('admin-live-collected-data.sql'));
});
after(async()=>{await db?.close()});
test('all received report/config/operator platforms are visible without an order target or static platform whitelist',async()=>{
 const data=await call({operation:'catalog'});const p=data.rows.find(x=>x.name==='FUTURE-PANGHU');assert.equal(p.team,'胖虎');assert.equal(p.country,'胖虎巴西');assert.equal(p.lastDate,'2026-09-24');
 assert(data.rows.some(x=>x.name==='OPERATOR-ONLY'));assert(data.rows.some(x=>x.name==='LG-ONLY'&&x.system==='LG'));assert(data.rows.some(x=>x.name==='WG-DEMO'&&x.system==='WG'&&x.team==='M8'));
 assert.equal(data.rows.find(x=>x.name==='UNASSIGNED').team,'待归类');assert(!data.rows.some(x=>x.name==='QUARANTINED'));
 assert(data.rows.some(x=>x.name==='Veer.Game'&&x.dataset==='volume'&&x.team==='M8'));assert(data.rows.some(x=>x.name==='776F'&&x.team==='胖虎'));
 assert.equal(data.rows.filter(x=>x.name==='FUTURE-PANGHU').length,2,'independent datasets remain identifiable');
});
test('detail reads exact source/date, projects approved numbers and never exposes raw payloads',async()=>{
 const data=await call({operation:'rows',dataset:'volume',country:'胖虎巴西',platform:'FUTURE-PANGHU',startAt:'2026-09-24',endAt:'2026-09-24'});
 assert.equal(data.total,1);assert.equal(data.rows[0].metrics.amount,1234);assert.equal(data.rows[0].metrics.count,12);assert.doesNotMatch(JSON.stringify(data),/NEVER-RETURN|token|member|raw/);
 const pending=await call({operation:'rows',dataset:'pending',country:'IN',platform:'Veer.Game',startAt:'2026-09-24',endAt:'2026-09-24'});assert.equal(pending.rows[0].metrics.pending,3);assert.equal(pending.rows[0].metrics.pendingAmount,120);
 const empty=await call({operation:'rows',dataset:'volume',country:'胖虎巴西',platform:'FUTURE-PANGHU',startAt:'2026-09-23',endAt:'2026-09-23'});assert.equal(empty.total,0);
});
test('every catalogue and detail request rechecks scope, including raw-code aliases',async()=>{
 await db.exec(`select set_config('test.scope','{"countries":["印度"],"platforms":["Veer.Game"]}',false)`);
 try {const data=await call({operation:'catalog'});assert.equal(data.rows.length,2);assert(data.rows.every(x=>x.name==='Veer.Game'));
 await assert.rejects(call({operation:'rows',dataset:'volume',country:'胖虎巴西',platform:'FUTURE-PANGHU',startAt:'2026-09-24',endAt:'2026-09-24'}),/scope_denied/);
 await db.exec("select set_config('test.scope','',false)");await assert.rejects(call({operation:'catalog'}),/unauthorized/);
 }finally{await db.exec(`select set_config('test.scope','{"mode":"all"}',false)`)}
});
test('unknown group rows are returned and newly arrived platforms are discovered without a deployment',async()=>{
 await db.exec("insert into auto_withdraw_daily(country,platform,data_date) values('胖虎巴西','NEW-AFTER-LOAD','2026-09-25')");const data=await call({operation:'catalog'});assert.equal(data.rows.find(x=>x.name==='NEW-AFTER-LOAD').team,'胖虎');
});
test('conflicting team mappings cannot silently assign a platform to the wrong team',async()=>{
 await db.exec("insert into dashboard_platform_team_map values('OTHER','WG','巴西','WG-DEMO','WG-DEMO',true)");const data=await call({operation:'catalog'});assert.equal(data.rows.find(x=>x.name==='WG-DEMO').team,'待归类');
});
test('pagination has complete counts and unprovided numeric metrics stay absent',async()=>{
 await db.exec("insert into withdraw_operator_daily(country,platform,data_date,account,processed) select '新地区','PAGED','2026-09-24','OP-'||lpad(n::text,3,'0'),n from generate_series(1,55)n");
 const q={operation:'rows',dataset:'operators',country:'新地区',platform:'PAGED',startAt:'2026-09-24',endAt:'2026-09-24',limit:20};const a=await call(q),b=await call({...q,offset:20});assert.equal(a.total,55);assert.equal(a.rows.length,20);assert.equal(b.rows.length,20);assert.equal(new Set([...a.rows,...b.rows].map(r=>r.provider)).size,40);assert(!('avgSeconds' in a.rows[0].metrics));
});
test('invalid request, oversized ranges and client table names cannot bypass the fixed read model',async()=>{
 for(const q of [{operation:'catalog',table:'dashboard_profiles'},{operation:'rows',dataset:'volume',country:'印度',platform:'X',startAt:'2026-08-01',endAt:'2026-09-24'},{operation:'catalog',limit:20}])await assert.rejects(call(q),/invalid_/);
 const result=await call({operation:'rows',dataset:'dashboard_profiles',country:'印度',platform:'X',startAt:'2026-09-24',endAt:'2026-09-24'});assert.equal(result.total,0);
});
test('upgrade bundles both catalog and collected feeds after their dependencies',()=>{
 const cp=require('node:child_process'),os=require('node:os'),file=path.join(os.tmpdir(),'hensem-test-upgrade-'+process.pid+'.sql');
 try{cp.execFileSync('python3',[path.join(__dirname,'../admin-preview/build-live-upgrade.py'),'--output',file]);const sql=fs.readFileSync(file,'utf8');assert(sql.includes('-- FILE: admin-live-platform-catalog-map.sql'));assert(sql.indexOf('-- FILE: admin-live-collected-data.sql')>sql.indexOf('-- FILE: admin-live-deposit-issues.sql'));assert.equal((sql.match(/^begin;$/gm)||[]).length,1);assert.equal((sql.match(/^commit;$/gm)||[]).length,1)}finally{fs.rmSync(file,{force:true})}
});

test('LG order-only platforms are discovered by index and details use creation time in the source timezone',async()=>{
 const catalog=await call({operation:'catalog'});assert(catalog.rows.some(r=>r.name==='LG-ORDER-ONLY'&&r.dataset==='lg_orders'));
 const q={operation:'rows',dataset:'lg_orders',country:'PH',platform:'LG-ORDER-ONLY',startAt:'2026-09-24',endAt:'2026-09-24'};
 const result=await call(q);assert.equal(result.total,1);assert.equal(result.rows[0].orderNumber,'O1');assert.equal(result.rows[0].date,'2026-09-24');assert(result.rows[0].successAt);assert.doesNotMatch(JSON.stringify(result),/PRIVATE-MEMBER|member_id/);
 assert.equal((await call({...q,startAt:'2026-09-23',endAt:'2026-09-23'})).total,0);
});
test('an authoritative Panghu label carries across feeds and cannot be read under ordinary Brazil scope',async()=>{
 await db.exec("insert into panda_config_daily values('BR','FUTURE-PANGHU','2026-09-24',now(),'{}')");
 const ownerCatalog=await call({operation:'catalog'});const r=ownerCatalog.rows.find(x=>x.rawPlatform==='FUTURE-PANGHU'&&x.dataset==='panda_config');assert.equal(r.team,'胖虎');assert.equal(r.country,'胖虎巴西');
 await db.exec(`select set_config('test.scope','{"countries":["巴西"]}',false)`);try{
  assert(!(await call({operation:'catalog'})).rows.some(x=>x.name==='FUTURE-PANGHU'));
  await assert.rejects(call({operation:'rows',dataset:'panda_config',country:'BR',platform:'FUTURE-PANGHU',startAt:'2026-09-24',endAt:'2026-09-24'}),/scope_denied/);
 }finally{await db.exec(`select set_config('test.scope','{"mode":"all"}',false)`)}
});
test('source date anomalies remain counted but cannot become the normal latest date',async()=>{
 await db.exec("insert into auto_withdraw_daily(country,platform,data_date) values('胖虎巴西','FUTURE-PANGHU','2611-01-12'),('胖虎巴西','FUTURE-PANGHU','2026-09-24')");
 const row=(await call({operation:'catalog'})).rows.find(r=>r.dataset==='auto'&&r.name==='FUTURE-PANGHU');assert.equal(row.dateIssues,1);assert.equal(row.lastDate,'2026-09-24');assert.equal(row.records,2);
});
