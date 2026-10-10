// Synthetic local PostgreSQL only; production fixtures contain definitions, never source notes or orders.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20261010113500_withdraw_reasons_report_catalog.sql');
const baseline=read('tests/fixtures/withdraw-reasons-report-only-production.sql');
const directory=read('tests/fixtures/withdraw-catalog-identity-baseline.sql');
const directoryMigration=read('supabase/migrations/20261002124810_withdraw_catalog_identity_walk.sql');
const fragment=(file,name)=>{const s=read('supabase/'+file),a=s.indexOf('create or replace function private.'+name+'('),b=s.indexOf('revoke all on function private.'+name+'(',a);assert(a>=0&&b>a);return s.slice(a,b)};
let db,readerMeta,otherMetadata,sourceChecksum,nativeBefore,wgBefore;
const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].value;
const call=extra=>scalar('select private.dashboard_admin_live_withdraw_reasons($1::jsonb) value',[JSON.stringify({country:'胖虎巴西',platform:'559K',date:'2026-10-09',kind:'blocking',...extra})]);
const meta=()=>scalar("select to_jsonb(p)-'prosrc' value from pg_proc p where oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure");
const others=()=>db.query("select p.oid,to_jsonb(p) value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname<>'dashboard_admin_live_withdraw_reasons' order by p.oid").then(x=>x.rows);
const checksum=()=>scalar("select md5(jsonb_build_array((select jsonb_agg(to_jsonb(d) order by country_code,platform,stat_date) from withdraw_reasons_daily d),(select jsonb_agg(to_jsonb(d) order by country,platform,data_date) from auto_withdraw_daily d),(select jsonb_agg(to_jsonb(d) order by source_platform) from dashboard_platform_team_map d),(select jsonb_agg(to_jsonb(d) order by order_no) from ar_collected_orders d))::text) value");
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
 create function private.dashboard_admin_live_scope() returns jsonb language sql stable as $$select case when current_setting('test.scope',true)='denied' then '{"denied":true}'::jsonb else '{}'::jsonb end$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select not coalesce(($1->>'denied')::boolean,false) and ($2 in ('胖虎巴西','BR_PANGHU','BR') and $3 in ('559K','NO-SNAPSHOT','WRONG-GROUP') or $2 in ('印度','IN') and $3 in ('AR-A','WG-A','REPORT-IN'))$$;
 create table test_native(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text);
 create function private.dashboard_admin_live_platforms() returns table(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) language sql stable security definer set search_path='' as $$select * from public.test_native p where private.dashboard_scope_allows(private.dashboard_admin_live_scope(),p.country,p.name)$$;
 create function private.dashboard_admin_wg_sites() returns table(site_code text,country_code text,country text,platform text,timezone text,currency text) language sql stable as $$select 'SYNTHETIC-WG','IN','印度','WG-A','Asia/Kolkata','INR' where private.dashboard_scope_allows(private.dashboard_admin_live_scope(),'IN','WG-A')$$;
 create function private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb) returns jsonb language sql stable as $$select case when $1->>'platform'='WG-A' then jsonb_build_object('available',true,'source','SYNTHETIC WG','noteCount',3,'rows','[]'::jsonb) end$$;
 create function private.dashboard_admin_live_clean_note(text) returns text language sql immutable as $$select nullif(btrim($1),'')$$;
 create function private.dashboard_admin_live_blocking_category(text) returns text language sql immutable as $$select $1$$;
 create function private.dashboard_admin_live_blocking_details_cleaned(text) returns jsonb language sql immutable as $$select jsonb_build_object('reason',$1)$$;
 create function private.dashboard_admin_live_rejection_exact_note(text) returns text language sql immutable as $$select case when $1~'[^[:space:]]' then $1 end$$;
 create function private.dashboard_admin_live_rejection_exact_key(text) returns text language sql immutable as $$select md5(jsonb_build_array('source_rejection_note_v1',private.dashboard_admin_live_rejection_exact_note($1))::text)$$;
 create function private.dashboard_admin_ar_local_amount(text,text,text,integer,numeric,text,text,numeric) returns numeric language sql immutable as $$select $8$$;
 create table ar_collected_orders(source_system text,country_code text,platform text,order_kind text,order_no text,amount numeric,status text,operator text,applied_at timestamp,completed_at timestamp,manual_remark text,remark text,raw_channel text,updated_at timestamptz,channel_type text,money_format_version integer,amount_local numeric,currency_local text,money_issue_code text);
 create table auto_withdraw_daily(country text,platform text,data_date date,total bigint,updated_at timestamptz);
 create table withdraw_operator_daily(country text,platform text);
 alter table auto_withdraw_daily enable row level security;
 alter table withdraw_operator_daily enable row level security;
 create table newar_business_snapshots(country text,platform text,country_code text,kind text,direction text);
 create table dashboard_platform_team_map(source_system text,source_country text,source_platform text,platform_name text,team_name text,active boolean,country_name text,country_code text);
 create table withdraw_reasons_daily(country_code text,platform text,stat_date date,source_system text,snapshot jsonb,updated_at timestamptz);
 create view withdraw_reasons_daily_grouped as select * from withdraw_reasons_daily;
 insert into test_native values('00000000-0000-4000-8000-000000000001','AR-A','M8','印度','IN','ar','Asia/Kolkata','INR','AR-A');
 insert into auto_withdraw_daily values('胖虎巴西','559K','2026-10-09',1421,'2026-10-10T00:00Z'),('胖虎巴西','NO-SNAPSHOT','2026-10-09',3,'2026-10-10T00:00Z'),('印度','REPORT-IN','2026-10-09',4,'2026-10-10T00:00Z');
 insert into dashboard_platform_team_map values('PANDA','巴西','559K','559K','胖虎',true,'巴西','BR_PANGHU'),('REPORT','胖虎巴西','559K','559K','胖虎',true,'巴西','BR_PANGHU'),('REPORT','印度','REPORT-IN','REPORT-IN','M8',true,'印度','IN');
 insert into ar_collected_orders values('AR','IN','AR-A','withdraw','SYNTHETIC-MANUAL',10,'未通过','synthetic-agent','2026-10-09 12:00','2026-10-09 12:01','SYNTHETIC-AR-RULE','SYNTHETIC-REJECT','',now(),null,null,null,null,null),('AR','IN','AR-A','withdraw','SYNTHETIC-AUTO',20,'已支付','system','2026-10-09 12:00','2026-10-09 12:01',null,null,'',now(),null,null,null,null,null);`);
 await db.exec(fragment('admin-live-platform-catalog-map.sql','dashboard_admin_live_is_panghu_platform')+fragment('admin-live-platform-catalog-map.sql','dashboard_admin_live_report_country')+fragment('admin-live-withdraw-pages.sql','dashboard_admin_live_withdraw_key')+fragment('admin-live-deposit-issues.sql','dashboard_admin_live_deposit_platform_key')+directory+baseline);
 await db.exec(directoryMigration);
 await db.exec("revoke all on function private.dashboard_admin_live_withdraw_reasons(jsonb) from public,anon,authenticated,service_role;grant execute on function private.dashboard_admin_live_withdraw_reasons(jsonb) to authenticated;revoke all on function private.dashboard_admin_live_withdraw_platforms() from public,anon,authenticated,service_role");
 const snapshot={totals:{count:1421,success:1368,reject:53},coverage:{unique_count:1421},groups:[{reason_label:'SYNTHETIC-RULE-A',operator_class:'manual',classification:'template',count:600,success:560,reject:40,other:0},{reason_label:'',operator_class:'manual',classification:'empty',count:104,success:91,reject:13,other:0},{reason_label:'SYNTHETIC-SYSTEM',operator_class:'auto',classification:'template',count:717,success:717,reject:0,other:0}]};
 await db.query("insert into withdraw_reasons_daily values('BR','559K','2026-10-09','PANDA',$1,'2026-10-10T00:00Z')",[snapshot]);
 assert.equal(await scalar("select md5(prosrc) value from pg_proc where oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure"),'2148081a9d792a23e994763d75ac3a41');
 assert.equal(await scalar("select md5(prosrc) value from pg_proc where oid='private.dashboard_admin_live_withdraw_platforms()'::regprocedure"),'ca2897d0e2e76182e61256bdfaccf089');
 await assert.rejects(call(),/platform_denied/);
 nativeBefore=await Promise.all(['blocking','categories','orders'].map(kind=>call({country:'印度',platform:'AR-A',kind})));wgBefore=await call({country:'印度',platform:'WG-A'});
 readerMeta=await meta();otherMetadata=await others();sourceChecksum=await checksum();await db.exec(migration);
});
after(async()=>db?.close());
test('scoped report-only Panghu resolves exact withdrawal metadata and exposes actual manual snapshot counts',async()=>{
 const catalog=(await db.query("select * from private.dashboard_admin_live_withdraw_platforms() where name='559K'")).rows;assert(catalog.length>0);assert(catalog.every(p=>p.country==='胖虎巴西'&&p.scope_group==='BR_PANGHU'&&p.source==='withdraw'));
 const d=await call();assert.equal(d.available,true);assert.equal(d.country,'胖虎巴西');assert.equal(d.source,'PANDA 原因采集快照');assert.equal(d.noteCount,704);assert.equal(d.total,2);assert.equal(d.rows.reduce((n,r)=>n+r.count,0),704);assert.equal(d.rows.find(r=>r.reason==='检测没备注').count,104);assert(!d.rows.some(r=>r.reason==='SYNTHETIC-SYSTEM'));assert.equal(d.summary.totalRejected,53);assert.equal(d.canViewBlockingOrders,false);assert.equal(d.summary.operatorCounts.manual,null);
 const variants=await call({kind:'blockingVariants',reasonKey:d.rows.find(r=>r.reason==='SYNTHETIC-RULE-A').reasonKey});assert.equal(variants.noteCount,704);assert.equal(variants.rows[0].count,600);assert.equal(variants.rows[0].sourceReason,'SYNTHETIC-RULE-A');
});
test('missing source snapshot stays unavailable and no reason or order detail is fabricated',async()=>{
 const d=await call({platform:'NO-SNAPSHOT'});assert.equal(d.available,false);assert.deepEqual(d.rows,[]);assert.equal(d.total,0);assert.match(d.message,/尚无.*原因采集记录/);
 const orders=await call({kind:'blockingOrders',reasonKey:'a'.repeat(32)});assert.equal(orders.available,false);assert.equal(orders.canViewBlockingOrders,false);assert.match(orders.message,/没有逐笔订单编号/);
 const rejection=await call({kind:'categories'});assert.equal(rejection.available,false);assert.match(rejection.message,/尚未单独采集驳回订单/);
});
test('fresh authorization and exact country/platform prevent report-directory fallback from broadening access',async()=>{
 await db.exec("select set_config('test.scope','denied',false)");try{await assert.rejects(call(),/scope_denied/);assert.equal((await db.query('select * from private.dashboard_admin_live_withdraw_platforms()')).rows.length,0)}finally{await db.exec("select set_config('test.scope','',false)")}
 await assert.rejects(call({country:'巴西'}),/scope_denied/);await assert.rejects(call({platform:'NOT-559K'}),/scope_denied/);
 await db.exec('begin');try{await db.exec("create or replace function private.dashboard_admin_live_withdraw_platforms() returns table(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) language sql stable security definer set search_path='' as $$values('00000000-0000-4000-8000-000000000002'::uuid,'WRONG-GROUP','胖虎','胖虎巴西','BR','withdraw','America/Sao_Paulo','BRL','WRONG-GROUP')$$");await assert.rejects(call({platform:'WRONG-GROUP'}),/platform_denied/)}finally{await db.exec('rollback')}
});
test('native AR precedence and existing WG requests, source data and every function metadata attribute remain unchanged',async()=>{
 assert.deepEqual(await Promise.all(['blocking','categories','orders'].map(kind=>call({country:'印度',platform:'AR-A',kind}))),nativeBefore);assert.deepEqual(await call({country:'印度',platform:'WG-A'}),wgBefore);assert.deepEqual(await meta(),readerMeta);assert.deepEqual(await others(),otherMetadata);assert.equal(await checksum(),sourceChecksum);
 for(const role of ['anon','service_role'])assert.equal(await scalar("select has_function_privilege($1,'private.dashboard_admin_live_withdraw_reasons(jsonb)','execute') value",[role]),false);assert.equal(await scalar("select has_function_privilege('authenticated','private.dashboard_admin_live_withdraw_reasons(jsonb)','execute') value"),true);
});
test('migration is idempotent and rejects production body or ACL drift atomically',async()=>{
 const d=await call();await db.exec(migration);assert.deepEqual(await call(),d);assert.equal(await scalar("select md5(prosrc) value from pg_proc where oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure"),'47d5a425eebe03f4150f6b9657f0dac6');
 await db.exec('begin');try{await db.exec('grant execute on function private.dashboard_admin_live_withdraw_reasons(jsonb) to service_role');await assert.rejects(db.exec(migration),/metadata_drift/)}finally{await db.exec('rollback')}
 await db.exec('begin');try{await db.exec(baseline.replace('begin\n','begin\n -- synthetic drift\n'));await assert.rejects(db.exec(migration),/body_drift/)}finally{await db.exec('rollback')}
 await db.exec('begin');try{await db.exec(directory.replace('begin\n','begin\n -- synthetic directory drift\n'));await assert.rejects(db.exec(migration),/directory_drift/)}finally{await db.exec('rollback')}
 assert.doesNotMatch(migration.replace(/--[^\n]*/g,''),/\b(?:grant\s|insert\s+into|delete\s+from|update\s+public|truncate\s|drop\s+(?:table|view|function))\b/i);assert.equal(await checksum(),sourceChecksum);
});
