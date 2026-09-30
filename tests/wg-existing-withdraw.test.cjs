// Production function source baseline, synthetic records only. No network or credentials.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261001010000_wg_existing_withdraw.sql'),'utf8');
const baselines=require('./fixtures/wg-existing-production-functions.json').filter(x=>[
 'dashboard_admin_live_auto_withdraw','dashboard_admin_live_withdraw_reasons','dashboard_admin_live_payout_config','dashboard_admin_live_withdraw_platforms'
].includes(x.proname));
const source=n=>fs.readFileSync(path.join(__dirname,'../supabase',n),'utf8');
let db,legacyAnswers,legacyReason,legacyConfig,acl;
const req={country:'巴西',startAt:'2026-09-29T00:00:00Z',endAt:'2026-09-29T23:59:59Z',limit:20};
const call=async(name,r)=>(await db.query(`select private.${name}($1::jsonb) value`,[JSON.stringify(r)])).rows[0].value;
const daily=(r={})=>call('dashboard_admin_live_auto_withdraw',{...req,...r});
const reasons=(r={})=>call('dashboard_admin_live_withdraw_reasons',{country:'巴西',platform:'26BET',date:'2026-09-29',kind:'rejection',limit:20,...r});
const config=(r={})=>call('dashboard_admin_live_payout_config',{system:'WG',operation:'index',...r});
const legacyRequests=[{platform:'OTHER'},{platform:'OTHER',view:'operators'},{country:'印度'},{country:'印度',view:'operators'}];
before(async()=>{
 db=new PGlite();await db.exec(`
 create schema private;create role anon;create role authenticated;grant usage on schema private to authenticated;
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin
 if current_setting('test.active',true)='false' then raise exception 'preview_denied';end if;
 return coalesce(nullif(current_setting('test.scope',true),'')::jsonb,'{"mode":"all"}'::jsonb);end$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$
 select coalesce($1->>'mode'='all' or $1->'targets' @> jsonb_build_array(jsonb_build_array(case $2 when '巴西' then 'BR' when '越南' then 'VN' when '印度' then 'IN' else $2 end,$3)),false)$$;
 create function public.dashboard_has_permission(text) returns boolean language sql stable as $$select coalesce(current_setting('test.permission',true),'true')<>'false'$$;
 create function private.dashboard_admin_live_can_note() returns boolean language sql stable as $$select false$$;
 create function private.dashboard_admin_live_report_country(text,text) returns text language sql immutable as $$select case $1 when 'BR' then '巴西' when 'VN' then '越南' when 'IN' then '印度' else $1 end$$;
 create function private.dashboard_admin_live_deposit_platform_key(text,text) returns text language sql immutable as $$select upper($2)$$;
 create function private.dashboard_admin_live_clean_note(text) returns text language sql immutable as $$select nullif(btrim($1),'')$$;
 create function private.dashboard_admin_live_rejection_category(text,text) returns text language sql immutable as $$select coalesce($2,'源备注为空')$$;
 create function private.dashboard_admin_live_blocking_category(text) returns text language sql immutable as $$select $1$$;
 create function private.dashboard_admin_live_game66_withdraw(date,date,text,text[]) returns jsonb language sql stable as $$select '{}'::jsonb$$;
 create function private.dashboard_admin_wg_sites() returns table(site_code text,country_code text,country text,platform text,timezone text,currency text) language sql immutable as $$
 values('278','BR','巴西','26BET','America/Sao_Paulo','BRL'),('8311','BR','巴西','POPKKK','America/Sao_Paulo','BRL'),('12588','BR','巴西','POPMIU','America/Sao_Paulo','BRL'),('3257','VN','越南','98VV','Asia/Ho_Chi_Minh','VND'),('3605','VN','越南','XX98','Asia/Ho_Chi_Minh','VND')$$;
 create table auto_withdraw_daily(data_date date,country text,platform text,total bigint,success bigint,rejected bigint,auto_count bigint,manual_count bigint,avg_seconds numeric,source_updated_at timestamptz default '2026-09-30T00:00Z',updated_at timestamptz default '2026-09-30T00:00Z');
 create table withdraw_operator_daily(data_date date,country text,platform text,account text,processed bigint,rejected bigint,avg_seconds numeric,source_updated_at timestamptz default '2026-09-30T00:00Z',updated_at timestamptz default '2026-09-30T00:00Z');
 create table newar_business_snapshots(kind text,direction text,country text,country_code text,platform text,stat_date date,payload jsonb,captured_at timestamptz,updated_at timestamptz);
 create table auto_withdraw_notes(data_date date,country text,platform text,reason text,updated_at timestamptz);
 create table game66_platforms(team_name text);
 create table dashboard_platform_team_map(team_name text,source_country text,source_platform text,platform_name text,country_name text,country_code text,active boolean);
 create table wg_withdraw_details(site_code text,order_number text,created_at timestamptz,captured_at timestamptz,stored_at timestamptz,member_amount numeric,status_code integer,status_group text,business_fields jsonb);
 create table wg_detail_coverage(site_code text,business text,basis text,business_date date,complete boolean);
 create table ar_config_targets(country_code text,country_name text,platform text,timezone text,currency text,source_system text);
 create table panda_config_targets(country_code text,country_name text,platform text,timezone text,currency text);
 create table wg_config_targets(country_code text,country_name text,platform text,timezone text,site_code text,members jsonb);
 create table ar_config_daily(country_code text,platform text,timezone text,observed_at timestamptz,observed_local_date date,received_at timestamptz,parser_version text,configuration jsonb);
 create table panda_config_daily(like ar_config_daily);create table wg_config_daily(like ar_config_daily);
 create table wg_realtime_config_daily(like ar_config_daily);alter table wg_realtime_config_daily add column site_code text;
 create table panda_config_dictionary_daily(country_code text,platform text,timezone text,observed_at timestamptz,dictionary jsonb);
 create function public.dashboard_game66_review_rules() returns jsonb language sql as $$select '{"targets":[],"rules":[]}'::jsonb$$;
 create function private.dashboard_data_group(text,text) returns text language sql immutable as $$select $1$$;
 create table withdraw_reasons_daily(country_code text,platform text,stat_date date,source_system text,snapshot jsonb,updated_at timestamptz);
 create table withdraw_reasons_daily_grouped(like withdraw_reasons_daily);
 create function private.dashboard_admin_live_platforms() returns table(name text,source_name text,country text,scope_group text,source text) language sql stable as $$select platform,platform,country,country_code,'wg'::text from private.dashboard_admin_wg_sites()$$;
 insert into auto_withdraw_daily(data_date,country,platform,total,success,rejected,auto_count,manual_count,avg_seconds) values
 ('2026-09-29','巴西','26BET',999,990,9,500,499,88),('2026-09-28','巴西','26BET',100,90,10,80,20,77),
 ('2026-09-29','巴西','POPKKK',10,8,2,7,3,66),('2026-09-29','巴西','POPMIU',99,98,1,99,0,55),
 ('2026-09-29','巴西','OTHER',22,20,2,20,2,11),('2026-09-29','印度','OTHER',33,30,3,30,3,12);
 insert into withdraw_operator_daily(data_date,country,platform,account,processed,rejected,avg_seconds) values
 ('2026-09-29','巴西','26BET','alice',999,9,88),('2026-09-29','巴西','OTHER','bob',22,2,11);
 insert into dashboard_platform_team_map select 'M8',country,platform,platform,country,country_code,true from private.dashboard_admin_wg_sites();
 insert into dashboard_platform_team_map values('M8','巴西','OTHER','OTHER','巴西','BR',true);
 insert into withdraw_reasons_daily values('BR','OTHER','2026-09-29','PANDA','{"note_field":"remark","groups":[{"reason_label":"legacy reason","operator_class":"manual","count":2,"success":0,"reject":2,"other":0}],"totals":{"reject":2},"coverage":{"complete":true}}','2026-09-30T00:00Z');
 insert into ar_config_targets values('IN','印度','AR-A','Asia/Kolkata','INR','AR');
 insert into ar_config_daily values('IN','AR-A','Asia/Kolkata','2026-09-29T12:00Z','2026-09-29','2026-09-29T12:00Z','ar-v1','{"fields":[{"key":"autoWithdraw","kind":"boolean","value":true}],"groups":[]}');
 insert into wg_detail_coverage values('278','withdraw','created','2026-09-29',false),('12588','withdraw','created','2026-09-29',true);
 insert into wg_withdraw_details select '278','ORDER-'||status,'2026-09-29T03:00Z'::timestamptz+status*interval '1 minute','2026-09-30T00:00Z','2026-09-30T00:00Z',100,status,
 case status when 1 then 'pending' when 3 then 'paying' when 4 then 'success' when 5 then 'failed' when 6 then 'cancelled' when 7 then 'rejected' when 8 then 'forced' end,
 jsonb_build_object('operator_name',case when status in(1,3,4,8) then 'system' when status in(5,7) then 'alice' end,
 'operator_class',case when status in(1,3,4,8) then 'auto' when status in(5,7) then 'manual' else 'unknown' end,
 'interception_reason',case when status in(7,8) then '流水不足' end,'rejection_reason',case when status in(4,7) then '资料不符' end)
 from unnest(array[1,3,4,5,6,7,8]) status;
 insert into wg_withdraw_details values('3257','VN-ON','2026-09-28T17:00Z','2026-09-30T00:00Z','2026-09-30T00:00Z',500000,4,'success','{"operator_name":"system","operator_class":"auto"}'),
 ('3257','VN-BEFORE','2026-09-28T16:59:59Z','2026-09-30T00:00Z','2026-09-30T00:00Z',100000,7,'rejected','{"operator_name":"alice","operator_class":"manual","rejection_reason":"旧日期"}');
 `);
 const pages=source('admin-live-withdraw-pages.sql');await db.exec(pages.slice(pages.indexOf('create or replace function private.dashboard_admin_live_withdraw_key('),pages.indexOf('create or replace function private.dashboard_admin_live_game66_withdraw(')));
 const projection=source('admin-live-payout-config.sql');await db.exec(projection.slice(projection.indexOf('create function private.dashboard_admin_config_safe_json'),projection.indexOf('create function private.dashboard_admin_live_payout_config')));
 for(const f of baselines)await db.exec(f.definition);
 for(const n of ['auto_withdraw','withdraw_reasons','payout_config'])await db.exec(`revoke all on function private.dashboard_admin_live_${n}(jsonb) from public,anon;grant execute on function private.dashboard_admin_live_${n}(jsonb) to authenticated;`);
 acl=(await db.query("select proname,prosecdef,proconfig,proacl::text from pg_proc where oid in('private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure,'private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure,'private.dashboard_admin_live_payout_config(jsonb)'::regprocedure) order by proname")).rows;
 legacyAnswers=[];for(const r of legacyRequests)legacyAnswers.push(await daily(r));
 legacyReason=await reasons({platform:'OTHER'});legacyConfig=await config({system:'AR',operation:'snapshot',country:'IN',platform:'AR-A'});
 await db.exec(migration);
});
after(async()=>db?.close());
test('unchanged non-WG request contracts and ACLs',async()=>{
 for(let i=0;i<legacyRequests.length;i++)assert.deepEqual(await daily(legacyRequests[i]),legacyAnswers[i]);
 assert.deepEqual(await reasons({platform:'OTHER'}),legacyReason);assert.deepEqual(await config({system:'AR',operation:'snapshot',country:'IN',platform:'AR-A'}),legacyConfig);
 assert.deepEqual((await db.query("select proname,prosecdef,proconfig,proacl::text from pg_proc where oid in('private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure,'private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure,'private.dashboard_admin_live_payout_config(jsonb)'::regprocedure) order by proname")).rows,acl);
});
test('WG replaces only observed site-days, complete empty day replaces legacy with zero',async()=>{
 const r=await daily();assert.equal(r.totals.total,39);assert.equal(r.rows.find(x=>x.platform==='26BET').total,7);
 assert.equal(r.rows.find(x=>x.platform==='POPMIU').total,0);assert.equal(r.rows.find(x=>x.platform==='POPKKK').total,10);
 assert.equal(r.previousTotals.total,100);assert.equal(r.wgCoverage.complete,false);assert.equal(r.comparison.complete,false);
 const w=r.rows.find(x=>x.platform==='26BET');assert.equal(w.success,1);assert.equal(w.rejected,1);assert.equal(w.autoCount,4);assert.equal(w.manualCount,2);assert.equal(w.unclassifiedCount,1);assert.equal(w.avgSeconds,null);
});
test('operator success is status 4 only; paying, failure, forced and pending never become success',async()=>{
 const r=await daily({platform:'26BET',view:'operators'});assert.equal(r.totals.processed,7);assert.equal(r.totals.success,1);assert.equal(r.totals.rejected,1);assert.equal(r.totals.avgSeconds,null);
 assert.equal(r.rows.find(x=>x.account==='system').processed,4);assert.equal(r.rows.find(x=>x.account==='system').success,1);
 assert.equal(r.rows.find(x=>x.account==='alice').success,0);assert.equal(r.wgCoverage.operatorBasis,'current_latest_operator');
});
test('local date boundaries and VND amounts are not multiplied twice',async()=>{
 const r=await daily({country:'越南',platform:'98VV'});assert.equal(r.totals.total,1);assert.equal(r.totals.success,1);
 const b=await reasons({country:'越南',platform:'98VV',kind:'orders',date:'2026-09-28'});assert.equal(b.rows[0].amount,100000);
});
test('Brazil midnight cutoff and unknown status are separate from success',async()=>{
 await db.exec('begin');try{
  await db.exec(`insert into wg_withdraw_details values('278','BR-BEFORE','2026-09-29T02:59:59Z','2026-09-30T00:00Z','2026-09-30T00:00Z',100,4,'success','{}'),
  ('278','BR-NEXT','2026-09-30T03:00Z','2026-09-30T04:00Z','2026-09-30T04:00Z',100,4,'success','{}'),
  ('278','BR-LAST','2026-09-30T02:59:59Z','2026-09-30T04:00Z','2026-09-30T04:00Z',100,99,'unknown','{}')`);
  const r=await daily({platform:'26BET'});assert.equal(r.totals.total,8);assert.equal(r.totals.success,1);
  assert.equal(r.wgCoverage.days.find(x=>x.date==='2026-09-29').unknown,1);assert.equal(r.wgCoverage.days.find(x=>x.date==='2026-09-29').paying,1);assert.equal(r.wgCoverage.days.find(x=>x.date==='2026-09-29').forced,1);
 }finally{await db.exec('rollback');}
});
test('all reason kinds keep drill keys and expose only sanitized business fields',async()=>{
 const r=await reasons();assert.equal(r.noteCount,1);assert.equal(r.rows[0].count,1);assert.equal(r.coverage.complete,false);
 const key=r.rows[0].reasonKey,c=await reasons({kind:'categories'}),o=await reasons({kind:'operators'});
 assert.equal(c.rows[0].category,'资料不符');assert.equal(o.rows[0].operator,'alice');
 const list=await reasons({kind:'orders',reasonKey:key,category:c.rows[0].categoryKey,operatorKey:o.rows[0].operatorKey});
 assert.equal(list.rows.length,1);assert.equal(list.rows[0].orderNumber,'ORDER-7');assert.equal(list.rows[0].completedAt,null);
 assert(!Object.keys(list.rows[0]).some(k=>/raw|accountInfo|address|phone|bank/i.test(k)));
 const b=await reasons({kind:'blocking'});assert.equal(b.rows[0].count,2);assert.equal(b.rows[0].success,0);assert.equal(b.rows[0].other,1);
 assert.equal((await reasons({kind:'blockingOrders',reasonKey:b.rows[0].reasonKey})).rows.length,2);
 assert.equal((await reasons({kind:'blockingVariants',reasonKey:b.rows[0].reasonKey})).rows.length,1);
 assert.equal((await reasons({kind:'orders',query:'does-not-exist'})).rows.length,0);
 const z=await reasons({platform:'POPMIU'});assert.equal(z.available,true);assert.equal(z.total,0);assert.equal(z.coverage.complete,true);
});
test('catalog uses WG stable identities and existing ownership without duplicates',async()=>{
 const rows=(await db.query('select * from private.dashboard_admin_live_withdraw_platforms()')).rows;
 const wg=rows.filter(r=>r.source==='wg');assert.equal(wg.length,5);assert(wg.every(r=>r.team==='M8'));assert.equal(new Set(wg.map(r=>r.id)).size,5);
 assert.equal(wg.find(r=>r.name==='26BET').id,(await db.query("select md5('WG:278')::uuid as id")).rows[0].id);
});
test('config index/snapshot prefers new daily data and projects strictly to authorized children',async()=>{
 const cfg={settings:{0:{exemptSwitch:0},278:{exemptSwitch:1},8311:{exemptSwitch:0},12588:{exemptSwitch:1},3913:{exemptSwitch:1}},dictionaries:{levels:[],tags:[],activities:[],withdraw_types:[],merchants:[]},completeness:{available:[],unavailable:[]}};
 await db.query("insert into wg_realtime_config_daily values('BR','26BET','America/Sao_Paulo','2026-09-29T12:00Z','2026-09-29','2026-09-29T12:00Z','wg-config-v1',$1,'278')",[JSON.stringify(cfg)]);
 assert.equal((await config()).targets.length,2);let r=await config({operation:'snapshot',country:'BR',platform:'26BET'});assert.deepEqual(Object.keys(r.snapshot.configuration.settings),['0','278','8311','12588']);
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({targets:[['BR','POPMIU']]})]);try{
  const idx=await config();assert.equal(idx.targets.length,1);assert.deepEqual(idx.targets[0].members,[{name:'POPMIU',site_code:'12588'}]);
  r=await config({operation:'snapshot',country:'BR',platform:'26BET'});assert.deepEqual(Object.keys(r.snapshot.configuration.settings),['0','12588']);
  await assert.rejects(config({operation:'snapshot',country:'VN',platform:'98VV'}),/config_target_denied/);
  assert.deepEqual((await daily()).rows.map(x=>x.platform),['POPMIU']);await assert.rejects(reasons(),/scope_denied/);
 }finally{await db.exec("set test.scope=''");}
});
test('request validation, fresh scope and permission gates remain mandatory',async()=>{
 for(const request of [{date:'bad'},{limit:1000},{kind:'orders',reasonKey:'bad'},{kind:'bad'},{raw:true}])await assert.rejects(reasons(request),/invalid_/);
 await db.exec("set test.active='false'");try{await assert.rejects(daily(),/preview_denied/);await assert.rejects(config(),/preview_denied/);}finally{await db.exec("set test.active='true'");}
 await db.exec("set test.permission='false'");try{await assert.rejects(config(),/permission_denied/);}finally{await db.exec("set test.permission='true'");}
 assert.equal((await db.query("select has_function_privilege('authenticated','private.dashboard_admin_wg_withdraw_days(jsonb,jsonb,date,date)','execute') as allowed")).rows[0].allowed,false);
 assert.equal((await db.query("select has_table_privilege('authenticated','public.wg_withdraw_details','select') as allowed")).rows[0].allowed,false);
});
test('WG multi-team selectors cannot pull sites omitted from the selected target list',async()=>{
 assert.deepEqual(await daily({platforms:[]}),await daily());
 assert.deepEqual(await daily({platform:'26BET',platforms:['OTHER']}),await daily({platform:'26BET'}));
 const r=await daily({scopeTargets:[{country:'巴西',platforms:['26BET','OTHER']}]});
 assert.deepEqual(r.rows.map(x=>x.platform).sort(),['26BET','OTHER']);assert.equal(r.totals.total,29);
 const filtered=await daily({scopeTargets:[{country:'巴西',platforms:['26BET','POPMIU']}],platforms:['POPMIU']});
 assert.deepEqual(filtered.rows.map(x=>x.platform),['POPMIU']);assert.equal(filtered.totals.total,0);
});
test('pagination is globally stable after WG replacement and operator filters apply before totals',async()=>{
 await db.exec('begin');try{
  await db.exec(`insert into wg_withdraw_details select '278','PAGE-'||i,'2026-09-29T04:00Z','2026-09-30T00:00Z','2026-09-30T00:00Z',100,7,'rejected',
   jsonb_build_object('operator_name','actor-'||lpad(i::text,2,'0'),'operator_class','manual','rejection_reason','原因-'||lpad(i::text,2,'0')) from generate_series(1,25)i`);
  const a=await daily({platform:'26BET',view:'operators',sort:'account',ascending:true}),b=await daily({platform:'26BET',view:'operators',sort:'account',ascending:true,offset:20});
  assert.equal(a.total,28);assert.equal(a.rows.length,20);assert.equal(b.rows.length,8);assert.equal(new Set([...a.rows,...b.rows].map(x=>x.account)).size,28);assert.deepEqual(a.totals,b.totals);
  const f=await daily({platform:'26BET',view:'operators',account:'actor-'});assert.equal(f.total,25);assert.equal(f.totals.processed,25);assert.equal(f.totals.success,0);
  const r=await reasons(),r2=await reasons({offset:20});assert.equal(r.total,26);assert.equal(r.rows.length,20);assert.equal(r2.rows.length,6);
 }finally{await db.exec('rollback');}
});
test('comparison cannot claim complete when only one date in a multi-day window was collected',async()=>{
 await db.exec('begin');try{
  await db.exec("update wg_detail_coverage set complete=true where site_code='278'");
  let r=await daily({platform:'26BET'});assert.equal(r.wgCoverage.currentComplete,true);assert.equal(r.wgCoverage.previousComplete,false);assert.equal(r.comparison.complete,false);
  await db.exec("insert into wg_detail_coverage values('278','withdraw','created','2026-09-28',true)");
  r=await daily({platform:'26BET'});assert.equal(r.wgCoverage.complete,true);assert.equal(r.previousTotals.total,0);assert.equal(r.comparison.complete,true);
  r=await daily({platform:'26BET',startAt:'2026-09-28T00:00:00Z'});assert.equal(r.wgCoverage.currentComplete,true);assert.equal(r.wgCoverage.previousComplete,false);assert.equal(r.comparison.complete,false);
 }finally{await db.exec('rollback');}
});
test('an acknowledged future/current unfinished local day is never marked complete',async()=>{
 await db.exec('begin');try{
  const day=(await db.query("select ((statement_timestamp() at time zone 'America/Sao_Paulo')::date+1)::text as day")).rows[0].day;
  await db.query("insert into wg_detail_coverage values('278','withdraw','created',$1,true)",[day]);
  const r=await daily({platform:'26BET',startAt:day+'T00:00:00Z',endAt:day+'T23:59:59Z'});assert.equal(r.wgCoverage.currentComplete,false);assert.equal(r.wgCoverage.days[0].complete,false);
  assert.equal((await reasons({date:day})).coverage.complete,false);
 }finally{await db.exec('rollback');}
});
test('idempotent migration rejects changed live function baseline atomically',async()=>{
 const r=await daily();await db.exec(migration);assert.deepEqual(await daily(),r);
 await db.exec('begin');try{await db.exec("create or replace function private.dashboard_admin_live_auto_withdraw(p_request jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$begin return '{}'::jsonb;end$$;");
  await assert.rejects(db.exec(migration),/baseline changed/);
 }finally{await db.exec('rollback');}
});
