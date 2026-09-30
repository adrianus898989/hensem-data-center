// Three migrations in order against all 14 captured production bodies.
// WG schemas come from collector DDL; all rows are synthetic. No network.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,'supabase',n),'utf8');
const production=require('./fixtures/wg-existing-production-functions.json');
const owner='10000000-0000-0000-0000-000000000001',viewer='10000000-0000-0000-0000-000000000002';
const migrations=['20261001000000_wg_existing_orders.sql','20261001010000_wg_existing_withdraw.sql','20261001020000_wg_existing_coverage_pending.sql'];
let db,br,vn,core,originalAcl;
const as=uid=>db.query("select set_config('test.uid',$1,false)",[uid]);
const call=async(name,q)=>(await db.query(`select private.${name}($1::jsonb) data`,[JSON.stringify(q)])).rows[0].data;
const daily=()=>call('dashboard_admin_live_auto_withdraw',{country:'巴西',platform:'26BET',startAt:'2026-09-29T00:00:00Z',endAt:'2026-09-29T23:59:59Z',limit:20});
const acl=async()=>(await db.query('select proname,proowner,proacl::text,prosecdef,proconfig from pg_proc where pronamespace=\'private\'::regnamespace and proname=any($1::text[]) order by proname',[production.map(x=>x.proname)])).rows;
function fn(src,name){const start=src.search(new RegExp('create(?: or replace)? function private\\.'+name+'\\(','i'));assert(start>=0,name);const s=src.slice(start),m=s.match(/as\s+(\$[a-z_]*\$)/i),end=s.indexOf(m[1]+';',m.index+m[0].length);return s.slice(0,end+m[1].length+1);}
before(async()=>{
 // Reuse the core's full synthetic schema/bootstrap without registering its
 // tests. The same six exact production bodies and core migration run first.
 let setup;const corePath=path.join(__dirname,'wg-existing-orders.test.cjs'),req=createRequire(corePath);
 const sandbox={require:n=>n==='node:test'?{test(){},before:f=>{setup=f;},after(){}}:req(n),__dirname,process,console};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(corePath,'utf8')+'\nglobalThis.fixture={get db(){return db},get br(){return br},get vn(){return vn},add,req,call};',sandbox,{filename:corePath});
 await setup();core=sandbox.fixture;db=core.db;br=core.br;vn=core.vn;
 await db.exec(`create role service_role;
 create or replace function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable as $$select coalesce(s->>'mode'='all' or (s->'countries'?(case c when '巴西' then 'BR' when '越南' then 'VN' when '印度' then 'IN' else c end) and (not(s?'platforms') or s->'platforms'?p)),false)$$;
 create function public.dashboard_has_permission(text) returns boolean language sql stable as $$select auth.uid() is not null$$;
 create function private.dashboard_admin_live_can_note() returns boolean language sql stable as $$select false$$;
 create function private.dashboard_admin_live_report_country(text,text) returns text language sql immutable as $$select case $1 when 'BR' then '巴西' when 'VN' then '越南' when 'IN' then '印度' else $1 end$$;
 create function private.dashboard_admin_live_deposit_platform_key(text,text) returns text language sql immutable as $$select upper($2)$$;
 create function private.dashboard_admin_live_clean_note(text) returns text language sql immutable as $$select nullif(btrim($1),'')$$;
 create function private.dashboard_admin_live_rejection_category(text,text) returns text language sql immutable as $$select coalesce($2,'源备注为空')$$;
 create function private.dashboard_admin_live_blocking_category(text) returns text language sql immutable as $$select $1$$;
 create function private.dashboard_admin_live_game66_withdraw(date,date,text,text[]) returns jsonb language sql stable as $$select '{}'::jsonb$$;
 create function private.dashboard_data_group(text,text) returns text language sql immutable as $$select $1$$;
 create function public.dashboard_game66_review_rules() returns jsonb language sql as $$select '{"targets":[],"rules":[]}'::jsonb$$;
 create table auto_withdraw_daily(data_date date,country text,platform text,total bigint,success bigint,rejected bigint,auto_count bigint,manual_count bigint,avg_seconds numeric,source_updated_at timestamptz default '2026-09-30T00:00Z',updated_at timestamptz default '2026-09-30T00:00Z');
 create table withdraw_operator_daily(data_date date,country text,platform text,account text,processed bigint,rejected bigint,avg_seconds numeric,source_updated_at timestamptz,updated_at timestamptz);
 create table newar_business_snapshots(kind text,direction text,country text,country_code text,platform text,stat_date date,payload jsonb,captured_at timestamptz,updated_at timestamptz);
 create table auto_withdraw_notes(data_date date,country text,platform text,reason text,updated_at timestamptz);
 create table panda_config_targets(country_code text,country_name text,platform text,timezone text,currency text);
 create table wg_config_targets(country_code text,country_name text,platform text,timezone text,site_code text,members jsonb);
 create table ar_config_daily(country_code text,platform text,timezone text,observed_at timestamptz,observed_local_date date,received_at timestamptz,parser_version text,configuration jsonb);
 create table panda_config_daily(like ar_config_daily);create table wg_config_daily(like ar_config_daily);
 create table panda_config_dictionary_daily(country_code text,platform text,timezone text,observed_at timestamptz,dictionary jsonb);
 create table withdraw_reasons_daily(country_code text,platform text,stat_date date,source_system text,snapshot jsonb,updated_at timestamptz);
 create table withdraw_reasons_daily_grouped(like withdraw_reasons_daily);
 create table withdraw_pending_backlog_daily(source_system text,country_code text,platform text,stat_date date,capture_date date,window_start date,window_end date,snapshot_id uuid,snapshot_at timestamptz,snapshot jsonb,updated_at timestamptz,primary key(source_system,country_code,platform,stat_date));
 create table withdraw_pending_daily(source_system text,country_code text,platform text,stat_date date,snapshot_id uuid unique,snapshot_at timestamptz,snapshot jsonb,updated_at timestamptz,primary key(source_system,country_code,platform,stat_date));
 create table withdraw_pending_orders(source_system text,country_code text,platform text,stat_date date,order_no text,member_id text,amount numeric,applied_at timestamp,timezone text,raw_channel text,channel_type text,status text,snapshot_id uuid,snapshot_at timestamptz,updated_at timestamptz);
 create function public.collection_success_safe_descriptor(text,integer) returns boolean language sql immutable as $$select $1 is not null and length($1) between 1 and $2 and $1!~'[[:cntrl:]]'$$;
 alter table private.wg_detail_progress add column floor bigint;
 create table private.wg_detail_history(site_code text,business text,basis text,range_start bigint,range_end bigint,cursor bigint,updated_at timestamptz);
 create table lg_sync_runs(country_code text,platform text,stat_date date,order_kind text,status text,sync_mode text,expected_count bigint,source_total bigint,fetched_count bigint,published_at timestamptz,observed_at timestamptz);
 create function private.dashboard_admin_live_collected_data(jsonb) returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('rows',private.dashboard_admin_live_order_intake())$$;
 drop function private.dashboard_admin_live_withdraw_platforms();
 insert into auto_withdraw_daily(data_date,country,platform,total,success,rejected,auto_count,manual_count,avg_seconds) values('2026-09-29','巴西','26BET',999,990,9,800,199,88),('2026-09-29','巴西','POPMIU',777,700,77,700,77,88);
 `);
 const pages=read('admin-live-withdraw-pages.sql');await db.exec(pages.slice(pages.indexOf('create or replace function private.dashboard_admin_live_withdraw_key('),pages.indexOf('create or replace function private.dashboard_admin_live_game66_withdraw(')));
 const projection=read('admin-live-payout-config.sql');await db.exec(projection.slice(projection.indexOf('create function private.dashboard_admin_config_safe_json'),projection.indexOf('create function private.dashboard_admin_live_payout_config')));
 await db.exec(fn(read('admin-live-pending-snapshot.sql'),'dashboard_admin_pending_platform_key'));
 const pending=read('migrations/20260915113000_withdraw_pending_daily.sql');await db.exec(pending.slice(pending.indexOf('create function public.withdraw_pending_is_count'),pending.indexOf('create function public.publish_withdraw_pending_snapshot')));
 const ddl=fs.readFileSync(path.join(__dirname,'fixtures/wg-existing-collector-ddl.sql'),'utf8');
 for(const part of ['CONFIG','COVERAGE','SNAPSHOT'])await db.exec(ddl.split('-- BEGIN '+part+'\n')[1].split('-- END '+part)[0]);
 await db.exec(fn(read('migrations/20260930222000_order_intake_fast_path.sql'),'dashboard_admin_live_intake_order_feeds'));
 await db.exec(`create function private.dashboard_admin_live_intake_feeds(timestamptz) returns jsonb language sql stable security definer set search_path='' as $$select private.dashboard_admin_live_intake_order_feeds($1)$$;`);
 const coreNames=['dashboard_admin_live_platforms','dashboard_admin_live_query_raw','dashboard_admin_live_drilldown_raw','dashboard_admin_live_provider_options','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_order_intake'];
 for(const f of production.filter(x=>!coreNames.includes(x.proname))){await db.exec(f.definition);const args=f.proname==='dashboard_admin_live_withdraw_platforms'?'':f.proname==='dashboard_admin_live_sync_health_rows'?'timestamptz':'jsonb';await db.exec(`revoke all on function private.${f.proname}(${args}) from public,anon,authenticated;grant execute on function private.${f.proname}(${args}) to authenticated;`);}
 originalAcl=await acl();
 await db.exec(read('migrations/'+migrations[1]));await db.exec(read('migrations/'+migrations[2]));
 // Actual committed-range view: completed empty POPMIU day is not old 777.
 await db.exec(`insert into private.wg_detail_history values('12588','withdraw','created',extract(epoch from '2026-09-29T03:00Z'::timestamptz)::bigint,extract(epoch from '2026-09-30T03:00Z'::timestamptz)::bigint-1,extract(epoch from '2026-09-30T03:00Z'::timestamptz)::bigint-1,now());`);
});
after(async()=>db?.close());
test('three source adapters coexist with one stable WG identity in both catalogs',async()=>{
 const r=await core.call({action:'catalog'}),native=r.platforms.filter(x=>x.source==='wg'),withdraw=r.withdrawPlatforms.filter(x=>x.source==='wg');
 assert.equal(native.length,5);assert.equal(withdraw.length,5);assert.equal(new Set([...native,...withdraw].map(x=>x.id)).size,5);
 const main=native.find(x=>x.sourceName==='26BET'),payout=withdraw.find(x=>x.source_name==='26BET');assert.equal(main.id,payout.id);assert.equal(main.team,payout.team);
 const orders=await core.call(core.req({direction:'withdraw'})),reports=await daily();assert.equal(orders.summary[0].all_count,9);assert.equal(reports.totals.total,9);assert.equal(reports.totals.success,1);assert.equal(orders.summary[0].created_success_count,1);assert.equal(orders.summary[0].success_count,null);
 const zero=await call('dashboard_admin_live_auto_withdraw',{country:'巴西',platform:'POPMIU',startAt:'2026-09-29T00:00:00Z',endAt:'2026-09-29T23:59:59Z',limit:20});assert.equal(zero.totals.total,0);assert.equal(zero.wgCoverage.currentComplete,true);assert.equal(zero.wgCoverage.previousComplete,false);
});
test('real coverage view drives existing intake and sync health without counting old WG daily rows',async()=>{
 const feeds=(await call('dashboard_admin_live_intake_coverage',{operation:'orderCatalog'})).feeds;
 const f=feeds.find(x=>x.rawPlatform==='POPMIU'&&x.direction==='withdraw');assert(f);const r=await call('dashboard_admin_live_intake_coverage',{operation:'rows',feedIds:[f.id],startAt:'2026-09-29',endAt:'2026-09-29'});assert.equal(r.rows[0].zeroConfirmed,true);assert.equal(r.rows[0].complete,true);assert.equal(r.rows[0].fetchedCount,0);
 const health=(await db.query("select * from private.dashboard_admin_live_sync_health_rows('2026-09-30T04:00Z') where source_system='wg' or source_system='WG'")).rows;assert(health.some(x=>x.platform==='POPMIU'&&x.direction==='withdraw'&&x.received));
});
test('native and withdrawal catalog overlap produces one immutable pending-stock target',async()=>{
 await db.exec(`insert into wg_withdraw_midnight_runs(site_code,scheduled_at,snapshot_date,window_start,window_end,status,observed_started_at,observed_finished_at,record_count,pages,received) values('278','2026-09-30T03:00Z','2026-09-29','2026-09-23T03:00Z','2026-09-30T02:59:59Z','complete','2026-09-30T03:00:05Z','2026-09-30T03:00:15Z',1,1,1);
 insert into wg_withdraw_midnight_items values('278','2026-09-30T03:00Z','SNAP-1','{"site_code":"278","business":"withdraw","status_code":3,"status_group":"paying","created_at":"2026-09-29T03:00:00Z","member_currency":"BRL","member_amount":"25","provider":"RawPay","channel":"PIX"}');`);
 const r=await call('dashboard_admin_live_pending_snapshot',{date:'2026-09-29',platformIds:[br]});assert.equal(r.expectedPlatformCount,1);assert.equal(r.receivedPlatformCount,1);assert.equal(r.count,1);assert.equal(r.amount,'25');assert.equal(r.groups[0].provider,'CanonicalPay');
 const a=await call('dashboard_admin_live_pending_analysis',{startDate:'2026-09-29',endDate:'2026-09-29',platformIds:[br]});assert.equal(a.daily[0].count,1);assert.equal(a.aging.count,1);assert.equal(a.aging.over24Count,1);
});
test('current detail, reason and configuration routes use safe current data',async()=>{
 await db.exec(`update wg_withdraw_details set business_fields=business_fields||'{"rejection_reason":"业务备注包含未识别或敏感自由文本，原文已隐藏，待核实"}'::jsonb where site_code='278' and status_code=7;`);
 const r=await call('dashboard_admin_live_withdraw_reasons',{country:'巴西',platform:'26BET',date:'2026-09-29',kind:'orders',limit:20});assert.equal(r.total,1);assert.equal(r.rows[0].orderNumber,'W7');
 const cfg={settings:{0:{exemptSwitch:0},278:{exemptSwitch:1},8311:{exemptSwitch:0},12588:{exemptSwitch:1}},dictionaries:{levels:[],tags:[],activities:[],withdraw_types:[],merchants:[]},completeness:{available:[],unavailable:[]}};
 await db.query("insert into wg_realtime_config_daily values('BR','26BET','278','2026-09-29','2026-09-29T12:00Z','33333333-3333-3333-3333-333333333333','America/Sao_Paulo','wg-config-v1',$1,'synthetic','synthetic',now())",[JSON.stringify(cfg)]);
 const c=await call('dashboard_admin_live_payout_config',{system:'WG',operation:'snapshot',country:'BR',platform:'26BET'});assert.deepEqual(Object.keys(c.snapshot.configuration.settings),['0','278','8311','12588']);
});
test('shared permissions constrain every existing route after all migrations',async()=>{
 await as(viewer);try{
  const c=await core.call({action:'catalog'});assert.deepEqual(c.platforms.filter(x=>x.source==='wg').map(x=>x.sourceName),['26BET']);assert.deepEqual(c.withdrawPlatforms.filter(x=>x.source==='wg').map(x=>x.source_name),['26BET']);
  await assert.rejects(call('dashboard_admin_live_pending_snapshot',{date:'2026-09-29',platformIds:[vn]}),/platform_denied/);
  await assert.rejects(core.call(core.req({platformId:vn})),/platform_denied/);
  const cfg=await call('dashboard_admin_live_payout_config',{system:'WG',operation:'snapshot',country:'BR',platform:'26BET'});assert.deepEqual(Object.keys(cfg.snapshot.configuration.settings),['0','278']);
  await db.exec('set role authenticated');try{await assert.rejects(db.query('select * from public.wg_withdraw_midnight_items'),/permission denied/);await assert.rejects(db.query('select * from public.wg_realtime_config_daily'),/permission denied/);}finally{await db.exec('reset role');}
 }finally{await as(owner);}
});
test('all three migrations replay together without guard or ACL conflict',async()=>{
 for(const name of migrations)await db.exec(read('migrations/'+name));assert.deepEqual(await acl(),originalAcl);
 assert.equal((await daily()).totals.total,9);assert.equal((await db.query('select count(*) n from wg_withdraw_midnight_items')).rows[0].n,1);
});
