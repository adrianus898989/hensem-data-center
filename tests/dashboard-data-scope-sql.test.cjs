// Synthetic, offline Postgres RLS/RPC integration. No network or real accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require(process.env.PGLITE_PATH || '@electric-sql/pglite');
const {loadTs} = require('./load-typescript.cjs');
const repo = path.resolve(__dirname, '..');
const migrationDir = path.join(repo, 'supabase/migrations');
const files = fs.readdirSync(migrationDir).filter(name => name.endsWith('_dashboard_account_data_scope.sql'));
if (!process.env.DASHBOARD_DATA_SCOPE_SQL) assert.equal(files.length,1,'Expected exactly one CLI-generated account data scope migration');
const sqlPath = process.env.DASHBOARD_DATA_SCOPE_SQL || path.join(migrationDir,files[0]);
const migration = fs.readFileSync(sqlPath, 'utf8');
const {dashboardDataGroup, DASHBOARD_DATA_GROUPS} = loadTs(path.join(repo, 'src/lib/dashboardDataScope.ts'));
const sqlFunction = (filename, name) => {
  const source = fs.readFileSync(path.join(repo, 'supabase', filename), 'utf8');
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = source.indexOf('$$;', source.indexOf('as $$', start));
  assert.ok(end > start, `${name} body exists`);
  return source.slice(start, end + 3);
};
const plain = ['auto_withdraw_daily','withdraw_operator_daily','third_party_volume','third_party_platform_status'];
const coded = ['ar_config_daily','ar_config_targets','panda_config_daily','panda_config_targets',
  'panda_config_dictionary_daily','wg_config_daily','wg_config_targets','withdraw_reasons_daily','withdraw_member_notes_daily'];
const globalTables = ['auto_withdraw_history_backfill','auto_withdraw_sync_status','third_party_history_backfill','sync_status'];
const allTables = [...plain,...coded,'third_party_rates','auto_withdraw_notes',...globalTables];
const views = {ar_config_latest:'ar_config_daily',panda_config_latest:'panda_config_daily',
  panda_config_dictionary_latest:'panda_config_dictionary_daily',wg_config_latest:'wg_config_daily',
  withdraw_reasons_daily_grouped:'withdraw_reasons_daily'};
const moduleFor = name => name.startsWith('third_party') || name === 'sync_status' ? 'third_party' : 'auto_withdraw';
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const allScope = {mode:'all',countries:[]};
const selected = (...countries) => ({mode:'selected',countries});
const fixtures = [
  {id:'panghu',country:'BR',platform:'776F',amount:100,count:10,updated:'2026-09-10T01:00:00Z'},
  {id:'vip',country:'巴西',platform:'VIP345',amount:200,count:20,updated:'2026-09-10T02:00:00Z'},
  {id:'regular',country:'BR',platform:'26BET',amount:300,count:30,updated:'2026-09-10T03:00:00Z'},
  {id:'fixed',country:'胖虎巴西',platform:'POPNOV',amount:400,count:40,updated:'2026-09-10T04:00:00Z'},
  {id:'vn',country:'VN',platform:'98VV',amount:500,count:50,updated:'2026-09-10T05:00:00Z'},
  {id:'npg',country:'南美',platform:'NPG-CHILE',amount:600,count:60,updated:'2026-09-10T06:00:00Z'},
  {id:'sa',country:'南美',platform:'CO66',amount:700,count:70,updated:'2026-09-10T07:00:00Z'},
  {id:'unknown',country:'Unregistered',platform:'776F',amount:800,count:80,updated:'2026-09-10T08:00:00Z'},
];

(async () => {
  const db = new PGlite();
  let checks = 0;
  const eq = (a,b,label) => {assert.deepEqual(a,b,label);checks++;};
  const ok = (a,label) => {assert.ok(a,label);checks++;};
  const reject = async (p,re,label) => {await assert.rejects(p,re,label);checks++;};
  const scalar = async (sql,params=[]) => Object.values((await db.query(sql,params)).rows[0])[0];
  const profile = async (n,scope,role='viewer',active=true,permissions={auto_withdraw:true,third_party:true}) => {
    await db.query(`insert into public.dashboard_profiles(auth_user_id,role,active,permissions${scope===undefined?'':',data_scope'})
      values($1,$2,$3,$4::jsonb${scope===undefined?'':',$5::jsonb'})`,
    [uid(n),role,active,JSON.stringify(permissions),...(scope===undefined?[]:[JSON.stringify(scope)])]);
  };
  const asUser = async (n,role='authenticated') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n===null?'':uid(n)]);
    await db.exec(`set role ${role}`);
  };
  const rows = table => db.query(`select * from public.${table} order by id`);
  const ids = async table => (await rows(table)).rows.map(row=>row.id);
  const definition = name => scalar('select pg_get_functiondef($1::regprocedure)',[name]);
  const sync = () => scalar("select public.dashboard_third_party_sync_status('2026-09-10','2026-09-10')");
  const policyState = () => db.query(`select tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
    where schemaname='public' and policyname not like 'dashboard_data_scope_%' order by tablename,policyname`);
  const aclState = () => db.query(`select 'relation' kind,c.relname name,c.relacl::text acl,c.relrowsecurity::text flag,c.reloptions::text options
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v')
    union all select 'function',p.oid::regprocedure::text,p.proacl::text,p.prosecdef::text,p.proconfig::text
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by kind,name`);
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; grant usage on schema auth,public to anon,authenticated,service_role;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.dashboard_profiles(auth_user_id uuid primary key,role text not null,active boolean not null default true,
        permissions jsonb not null default '{}',updated_at timestamptz not null default now());
      alter table public.dashboard_profiles enable row level security;
      grant select on public.dashboard_profiles to anon,authenticated; grant all on public.dashboard_profiles to service_role;
      create policy dashboard_profile_read_self on public.dashboard_profiles for select to authenticated using(auth.uid()=auth_user_id);`);
    await db.exec(sqlFunction('dashboard-v250-owner-fast-query.sql','dashboard_has_permission'));
    for (const table of allTables) {
      const country = coded.includes(table) ? 'country_code' : 'country';
      await db.exec(`create table public.${table} (
        id text primary key, data_date date default '2026-09-10',${country} text,platform text,
        amount numeric default 0,count integer default 0,success_count integer default 0,failed_count integer default 0,
        success_rate numeric default 0,direction text default '代收',channel text default 'USDT',raw_channel text default '',
        channel_type text default '',sheet_name text default '',source_row integer default 0,status text default 'success',
        raw jsonb default '{}',snapshot jsonb default '{"synthetic":true}',updated_at timestamptz default now(),
        last_sync_at timestamptz default now(),rows_written bigint default 0,reason text default '',updated_by uuid,
        dataset text default 'auto_withdraw',row_count integer default 0,message text default '',
        auto_rows bigint default 0,operator_rows bigint default 0,last_attempt_at timestamptz,last_success_at timestamptz);
        alter table public.${table} enable row level security;
        grant select on public.${table} to anon,authenticated; grant all on public.${table} to service_role;`);
      if(table !== 'third_party_history_backfill') await db.exec(`create policy existing_module_read on public.${table}
        for select to authenticated using(public.dashboard_has_permission('${moduleFor(table)}'));`);
    }
    // Match the production model: rates are country-only (no platform column).
    await db.exec('alter table public.third_party_rates drop column platform');
    await db.exec(`grant insert,update on public.auto_withdraw_notes to authenticated;
      create policy existing_notes_insert on public.auto_withdraw_notes for insert to authenticated with check (
        public.dashboard_has_permission('auto_withdraw') and updated_by=auth.uid()
        and exists(select 1 from public.dashboard_profiles where auth_user_id=auth.uid() and active and role in ('owner','admin')));
      create policy existing_notes_update on public.auto_withdraw_notes for update to authenticated using (
        public.dashboard_has_permission('auto_withdraw')
        and exists(select 1 from public.dashboard_profiles where auth_user_id=auth.uid() and active and role in ('owner','admin')))
      with check(public.dashboard_has_permission('auto_withdraw') and updated_by=auth.uid()
        and exists(select 1 from public.dashboard_profiles where auth_user_id=auth.uid() and active and role in ('owner','admin')));
      create table public.withdraw_reasons_credentials(id text primary key,token_hash text);
      create table public.withdraw_reasons_snapshot_receipts(id text primary key);
      alter table public.withdraw_reasons_credentials enable row level security;
      alter table public.withdraw_reasons_snapshot_receipts enable row level security;
      grant all on public.withdraw_reasons_credentials,public.withdraw_reasons_snapshot_receipts to service_role;`);
    for (const [view,table] of Object.entries(views)) await db.exec(`create view public.${view} with (security_invoker=true) as select * from public.${table};grant select on public.${view} to authenticated;`);
    await db.exec(sqlFunction('dashboard-v250-owner-fast-query.sql','dashboard_third_party_volume_fast'));
    await db.exec(sqlFunction('21_V251_高速查询_数据完整状态.sql','dashboard_third_party_volume_fast_v2'));
    await db.exec(sqlFunction('21_V251_高速查询_数据完整状态.sql','dashboard_third_party_sync_status'));
    await profile(1,undefined,'owner'); await profile(2,undefined,'admin');
    for (const table of [...plain,...coded,'auto_withdraw_notes']) for(const f of fixtures) {
      const country = coded.includes(table) ? 'country_code' : 'country';
      await db.query(`insert into public.${table}(id,${country},platform,amount,count,updated_at,updated_by,raw)
        values($1,$2,$3,$4,$5,$6,$7,'{"mapping":"synthetic"}')`,[f.id,f.country,f.platform,f.amount,f.count,f.updated,uid(1)]);
    }
    for(const [id,country,stamp] of [['rate-br','巴西','2026-09-10T23:00:00Z'],['rate-panghu','胖虎巴西','2026-09-10T02:30:00Z'],['rate-vn','VN','2026-09-11T23:00:00Z']]) {
      await db.query('insert into public.third_party_rates(id,country,updated_at) values($1,$2,$3)',[id,country,stamp]);
    }
    for(const table of globalTables) await db.query(`insert into public.${table}(id,country,rows_written,last_sync_at) values('global','BR',999999,'2026-09-11T23:59:00Z')`);
    const dataBefore = {};
    for(const table of allTables) dataBefore[table] = (await rows(table)).rows;
    const beforePolicies = (await policyState()).rows, beforeAcl = (await aclState()).rows;
    const signatures = ['public.dashboard_has_permission(text)','public.dashboard_third_party_volume_fast(date,date,text)',
      'public.dashboard_third_party_volume_fast_v2(date,date,text)'];
    const beforeDefinitions = await Promise.all(signatures.map(definition));
    const beforeSyncDef = await definition('public.dashboard_third_party_sync_status(date,date)');
    const beforeViews = await Promise.all(Object.keys(views).map(view=>scalar('select pg_get_viewdef($1::regclass,true)',[`public.${view}`])));
    await asUser(1); const beforeOwnerSync = await sync(); const beforeOwnerRows = await ids('third_party_volume');
    await db.exec('reset role'); await db.exec(migration);

    eq((await policyState()).rows,beforePolicies,'Original permissive/module policies unchanged');
    eq((await aclState()).rows,beforeAcl,'Public ACL/RLS/view-invoker/RPC security unchanged');
    for(let i=0;i<signatures.length;i++) eq(await definition(signatures[i]),beforeDefinitions[i],'Existing permission and fast RPC definitions unchanged');
    for(let i=0;i<Object.keys(views).length;i++) eq(await scalar('select pg_get_viewdef($1::regclass,true)',[`public.${Object.keys(views)[i]}`]),beforeViews[i],'Existing view definition unchanged');
    for(const table of allTables) eq((await rows(table)).rows,dataBefore[table],`No business data rewritten: ${table}`);
    const afterSyncDef = await definition('public.dashboard_third_party_sync_status(date,date)');
    const start = afterSyncDef.indexOf('\n  -- dashboard_data_scope_restricted_v1');
    const end = afterSyncDef.indexOf('  select\n    count(*)::int,',start);
    eq(afterSyncDef.slice(0,start)+afterSyncDef.slice(end),beforeSyncDef,'Only an additive guarded branch changed in definer RPC');
    const scopePolicies = (await db.query("select * from pg_policies where policyname like 'dashboard_data_scope_%' order by tablename")).rows;
    eq(scopePolicies.length,19,'All 19 business base tables protected');
    ok(scopePolicies.every(p=>p.permissive==='RESTRICTIVE'),'Every new policy is AND, never OR');
    eq(scopePolicies.find(p=>p.tablename==='auto_withdraw_notes').cmd,'ALL','Notes read/write scope');
    ok(scopePolicies.find(p=>p.tablename==='auto_withdraw_notes').with_check,'Notes WITH CHECK enforced');
    for(const table of allTables) ok(scopePolicies.some(p=>p.tablename===table),`${table} has scope policy`);
    eq(await scalar('select data_scope from public.dashboard_profiles where auth_user_id=$1',[uid(2)]),allScope,'Legacy profile defaults to all');
    await profile(3,selected('BR_PANGHU'),'admin'); await profile(4,selected('BR'),'admin');
    await profile(5,selected('VN')); await profile(6,selected('BR_PANGHU'),'admin',false);
    await profile(7,selected('BR_PANGHU'),'admin',true,{auto_withdraw:false,third_party:false});
    await profile(8,selected('BR_PANGHU'),'viewer'); await profile(9,selected('CL')); await profile(10,selected('SA'));
    await profile(11,selected('BR_PANGHU','BR','BR_PANGHU'),'admin');
    for(const invalid of [null,[],{},'all',{mode:'all'},selected(),selected('INVALID'),selected('br'),selected(1),selected(null),{mode:'all',countries:['BR']},{mode:'selected',countries:'BR'},{mode:'anything',countries:[]}]) {
      await reject(profile(100,invalid),/constraint|null value/i,'Malformed/empty selected write rejected');
    }
    await reject(profile(100,selected('BR'),'owner'),/constraint/,'Owner cannot be stored restricted');
    await profile(100,allScope,'owner');
    await asUser(11);
    eq(await scalar('select private.dashboard_current_data_scope()'),selected('BR','BR_PANGHU'),'Trusted scope normalized/deduplicated');
    await db.exec('reset role');

    const countries = [...DASHBOARD_DATA_GROUPS.map(g=>g.key),'巴西','BRAZIL','胖虎巴西','PANGHU BRAZIL','印度','印度线下','INDIA',
      '巴基斯坦','PAKISTAN','印尼','印度尼西亚','INDONESIA','越南','VIETNAM','菲律宾','PHILIPPINES','马来','马来西亚','MALAYSIA',
      '缅甸','MYANMAR','尼日利亚','NIGERIA','哥伦比亚','COLOMBIA','墨西哥','MEXICO','智利','CHILE','南美','SOUTH AMERICA','巴西原生',
      'USDT通道','USDT 通道',' BR盘口 ','\tbr\n','\u00a0胖虎巴西\ufeff',null,'Unknown',''];
    const platforms = ['776F',' 776f ','776-F','VIP345','FF55','222VIP.COM','222-VIP','67-VIP','POPNOV','POPFEZ','POPCRA',
      '5C555','26BET','NPG-CHILE','NPG-COLOMBIA','NPG-MEXICO','CO66','\t776F\ufeff',null,''];
    const pairs = countries.flatMap(country=>platforms.map(platform=>({country,platform})));
    const parity = (await db.query(`select item->>'country' country,item->>'platform' platform,
      private.dashboard_data_group(item->>'country',item->>'platform') actual from jsonb_array_elements($1::jsonb) item`,[JSON.stringify(pairs)])).rows;
    for(const p of parity) eq(p.actual,dashboardDataGroup(p.country,p.platform),`JS/SQL mapping parity: ${p.country}/${p.platform}`);
    for(const value of [null,{},selected(),selected('INVALID'),{mode:'all',countries:['BR']}]) eq(await scalar('select private.dashboard_scope_allows($1::jsonb,$2,$3)',[JSON.stringify(value),'BR','776F']),false,'Invalid internal scope fails closed');

    const expectedByUser = [[1,fixtures.map(f=>f.id)],[2,fixtures.map(f=>f.id)],[3,['panghu','vip']],[4,['regular','fixed']],
      [5,['vn']],[6,[]],[7,[]],[8,['panghu','vip']],[9,['npg']],[10,['sa']],[11,['panghu','vip','regular','fixed']],[99,[]]];
    for(const [user,expected] of expectedByUser) {
      await asUser(user);
      for(const table of [...plain,...coded,'auto_withdraw_notes',...Object.keys(views)]) eq(await ids(table),expected.slice().sort(),`Actual RLS ${user}/${table}`);
      for(const table of globalTables) eq(await ids(table),user<=2 && table!=='third_party_history_backfill'?['global']:[],`Global metadata denied for scoped ${user}/${table}`);
    }
    await asUser(3); eq(await ids('third_party_rates'),['rate-panghu'],'Panghu cannot borrow ordinary Brazil rates');
    await asUser(4); eq(await ids('third_party_rates'),['rate-br'],'Brazil does not receive Panghu or Vietnam rates');
    await asUser(5); eq(await ids('third_party_rates'),['rate-vn'],'Country-only rate exact scope');
    await asUser(1); eq(await sync(),beforeOwnerSync,'Owner sync result exactly unchanged');eq(await ids('third_party_volume'),beforeOwnerRows,'Owner rows exactly unchanged');
    await asUser(2); eq(await sync(),beforeOwnerSync,'Legacy all account sync exactly unchanged');
    await asUser(3); const scopedSync = await sync();
    for(const key of ['historyTasks','historySuccess','historyRemaining','historyFailed','historyRowsWritten','historyLatestSyncAt']) eq(scopedSync[key],null,`No global leak: ${key}`);
    eq(scopedSync.historyComplete,false,'No fabricated scoped completeness');eq(scopedSync.dataScopeRestricted,true,'Scoped status explicit');
    eq(new Date(scopedSync.latestWriteAt).toISOString(),'2026-09-10T02:00:00.000Z','Only allowed row update time visible');
    eq(new Date(scopedSync.ratesLatestWriteAt).toISOString(),'2026-09-10T02:30:00.000Z','No disallowed rate/status time leak');
    eq([scopedSync.dataDays,scopedSync.collectDays,scopedSync.payoutDays],[1,1,0],'Scoped day/direction counts');
    for(const user of [6,7,99]) {await asUser(user);await reject(sync(),/没有三方量/,'Original module/active guard precedes scope branch');}
    for(const user of [3,4,5,9,10]) {
      await asUser(user);
      const allowed = expectedByUser.find(([n])=>n===user)[1];
      for(const name of ['dashboard_third_party_volume_fast','dashboard_third_party_volume_fast_v2']) for(const country of [null,'','BR','巴西','胖虎巴西','VN','所有国家USDT']) {
        const value = await scalar(`select public.${name}('2026-09-10','2026-09-10',$1)`,[country]);
        const expected = fixtures.filter(f=>allowed.includes(f.id) && (!country || country==='所有国家USDT' || f.country===country));
        eq(value.rows.map(r=>r.platform).sort(),expected.map(f=>f.platform).sort(),`Invoker RPC cannot widen scope: ${user}/${name}/${country}`);
        eq(value.rows.reduce((n,r)=>n+Number(r.amount),0),expected.reduce((n,f)=>n+f.amount,0),'Amounts unchanged/no double counting');
        eq(value.rows.reduce((n,r)=>n+Number(r.count),0),expected.reduce((n,f)=>n+f.count,0),'Order counts unchanged/no double counting');
      }
    }
    await asUser(3);
    await db.query("insert into public.auto_withdraw_notes(id,country,platform,reason,updated_by) values('allowed-note','BR','776F','synthetic',$1)",[uid(3)]);
    eq(await scalar("select reason from public.auto_withdraw_notes where id='allowed-note'"),'synthetic','Allowed note inserted');
    await db.query("update public.auto_withdraw_notes set reason='edited',updated_by=$1 where id='allowed-note'",[uid(3)]);
    eq(await scalar("select reason from public.auto_withdraw_notes where id='allowed-note'"),'edited','Allowed note edited');
    await reject(db.query("insert into public.auto_withdraw_notes(id,country,platform,updated_by) values('blocked-note','BR','26BET',$1)",[uid(3)]),/row-level security/,'Out-of-scope note INSERT denied');
    await reject(db.query("update public.auto_withdraw_notes set country='VN',platform='98VV',updated_by=$1 where id='allowed-note'",[uid(3)]),/row-level security/,'Cannot move note into forbidden scope');
    eq((await db.query("update public.auto_withdraw_notes set reason='should not change',updated_by=$1 where id='regular' returning id",[uid(3)])).rows,[],'Out-of-scope note UPDATE cannot find row');
    await reject(db.query("insert into public.auto_withdraw_notes(id,country,platform,updated_by) values('spoof-author','BR','776F',$1)",[uid(4)]),/row-level security/,'Original updated_by guard preserved');
    await asUser(8); await reject(db.query("insert into public.auto_withdraw_notes(id,country,platform,updated_by) values('viewer-write','BR','776F',$1)",[uid(8)]),/row-level security/,'Viewer still cannot edit notes');
    await asUser(3);await reject(db.query("update public.dashboard_profiles set data_scope=$1 where auth_user_id=$2",[JSON.stringify(allScope),uid(3)]),/permission denied|row-level security/,'Browser cannot self-escalate scope');
    await reject(db.query('create function private.attacker() returns boolean language sql as $$ select true $$'),/permission denied/,'Authenticated cannot create or replace trusted private helpers');
    await reject(db.query('select * from public.withdraw_reasons_credentials'),/permission denied/,'Credentials stay service-only');
    await reject(db.query('select * from public.withdraw_reasons_snapshot_receipts'),/permission denied/,'Receipts stay service-only');
    // Trusted helper ignores caller-created public/temporary lookalikes and editable claims.
    await db.exec('reset role');
    await db.exec(`create temporary table dashboard_profiles as select * from public.dashboard_profiles;
      update pg_temp.dashboard_profiles set data_scope='{"mode":"all","countries":[]}';grant select on pg_temp.dashboard_profiles to authenticated;`);
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({user_metadata:{data_scope:allScope},role:'owner'})]);
    await asUser(3);eq(await scalar('select private.dashboard_current_data_scope()'),selected('BR_PANGHU'),'No search_path/metadata spoofing');
    await db.exec('reset role');
    await db.query('update public.dashboard_profiles set data_scope=$1 where auth_user_id=$2',[JSON.stringify(selected('VN')),uid(11)]);
    await asUser(11);
    eq(await ids('third_party_volume'),['vn'],'Scope changes take effect with the same JWT, without login/token refresh');
    await db.exec('reset role');
    await db.query('update public.dashboard_profiles set active=false where auth_user_id=$1',[uid(11)]);
    await asUser(11);
    eq(await scalar('select private.dashboard_current_data_scope()'),selected(),'Immediate disable fails closed');
    eq(await ids('third_party_volume'),[],'Disabled account cannot retain cached DB permissions');
    // A later permissive SELECT policy cannot OR its way around the scope check.
    await db.exec('reset role');
    await db.exec('create policy synthetic_broad_allow on public.third_party_volume for select to authenticated using(true)');
    await asUser(3);eq(await ids('third_party_volume'),['panghu','vip'],'Restrictive scope survives a separate permissive policy');
    await db.exec('reset role');await db.exec('drop policy synthetic_broad_allow on public.third_party_volume');
    await asUser(null,'anon');
    for(const table of [...plain,...coded,...globalTables,'third_party_rates','auto_withdraw_notes']) eq(await ids(table),[],'Anonymous still has no rows');
    await reject(db.query('select private.dashboard_current_data_scope()'),/permission denied/,'Anonymous cannot invoke private helper');
    await reject(sync(),/没有三方量/,'Anonymous definer RPC retains guard');
    await asUser(99,'service_role');
    eq((await ids('third_party_volume')).length,fixtures.length,'Collector service_role bypass unaffected');
    await db.query("insert into public.withdraw_reasons_snapshot_receipts(id) values('synthetic-receipt')");
    eq(await ids('withdraw_reasons_snapshot_receipts'),['synthetic-receipt'],'Service receipt writes unaffected');
    await db.exec('reset role');
    const privateFunctions=(await db.query("select p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'")).rows;
    eq(privateFunctions.length,4,'Only four minimal private helpers');
    ok(privateFunctions.every(p=>p.anon===false && p.proconfig.includes('search_path=""')),'Helpers have empty search_path and no anonymous execute');
    eq(privateFunctions.filter(p=>p.prosecdef).map(p=>p.proname),['dashboard_current_data_scope'],'Only trusted profile lookup needs definer');
    const finalPolicies=(await db.query("select * from pg_policies where policyname like 'dashboard_data_scope_%' order by tablename")).rows;
    await db.exec(migration);
    eq(await definition('public.dashboard_third_party_sync_status(date,date)'),afterSyncDef,'Migration reapply does not duplicate scoped branch');
    eq((await db.query("select * from pg_policies where policyname like 'dashboard_data_scope_%' order by tablename")).rows,finalPolicies,'Policy reapply idempotent');
    if (process.env.DASHBOARD_SCOPE_ROLLBACK_SQL) {
      // Exercise the separately reviewed release-owner transaction script against
      // synthetic data only. The public suite does not depend on private files.
      await db.exec(`create table auth.users(id uuid primary key,encrypted_password text);
        alter table public.dashboard_profiles add column username text not null default 'offline-existing';
        alter table public.dashboard_profiles add column management_permissions jsonb not null default '{}';
        alter table public.auto_withdraw_notes alter column id set default gen_random_uuid()::text;
        alter table public.auto_withdraw_notes add column updated_by_name text not null default 'offline';
        alter table public.auto_withdraw_notes add column created_at timestamptz not null default now();
        alter table public.sync_status add column last_data_date date default '2026-09-11';`);
      for(const table of allTables) await db.exec(`update public.${table} set data_date='2026-09-11'`);
      for(const table of coded) await db.exec(`alter table public.${table} add column observed_local_date date default '2026-09-11';
        alter table public.${table} add column stat_date date default '2026-09-11';`);
      for(const [view,table] of Object.entries(views)) await db.exec(`drop view public.${view};
        create view public.${view} with(security_invoker=true) as select * from public.${table};grant select on public.${view} to authenticated;`);
      const noteSource=fs.readFileSync(path.join(repo,'supabase/migrations/20260910061510_auto_withdraw_daily_notes.sql'),'utf8');
      const noteStart=noteSource.indexOf('create function public.stamp_auto_withdraw_note()');
      const noteEnd=noteSource.indexOf('$$;',noteStart)+3;
      await db.exec(noteSource.slice(noteStart,noteEnd));
      await db.exec('create trigger stamp_auto_withdraw_note before insert or update on public.auto_withdraw_notes for each row execute function public.stamp_auto_withdraw_note()');
      const unchangedRows = async () => ({users:(await db.query('select * from auth.users order by id')).rows,
        profiles:(await db.query('select * from public.dashboard_profiles order by auth_user_id')).rows,
        notes:(await db.query('select * from public.auto_withdraw_notes order by id')).rows});
      const baselineRows=await unchangedRows();
      const rollbackSql=fs.readFileSync(process.env.DASHBOARD_SCOPE_ROLLBACK_SQL,'utf8');
      ok(/\bbegin;/.test(rollbackSql)&&/reset role;\s*rollback;\s*$/.test(rollbackSql),'Release verification explicitly ends RESET ROLE / ROLLBACK');
      const outputs=await db.exec(rollbackSql);
      const result=outputs.flatMap(item=>item.rows||[]).find(row=>Object.hasOwn(row,'all_checks_passed'));
      ok(result,'Rollback verification returned its safe boolean summary');
      eq(result.all_checks_passed,true,'Every release-owner verification check passed offline');
      eq(Number(result.failed_checks),0,'No hidden failed check in verification');
      ok(Number(result.checks)>70,'Actual table, view, RPC and note checks ran');
      for(const output of outputs) for(const row of output.rows||[]) {
        ok(Object.keys(row).every(key=>['check_name','passed','observed_count','expected_count','all_checks_passed','checks','failed_checks'].includes(key)),
          'Verification outputs no identifier, account field, business row or credential');
      }
      eq(await unchangedRows(),baselineRows,'ROLLBACK removed every temporary identity and note, preserved all existing rows');
      eq(await scalar("select count(*) from pg_tables where schemaname like 'pg_temp_%' and tablename like 'scope_verify_%'"),0,'Verification temporary tables were rolled back');
      eq(await scalar('select current_user'),'postgres','Verification reset role before rollback');
      console.log(`PASS release-owner rollback rehearsal: ${result.checks} boolean/count checks, all synthetic rows rolled back`);
    }
    console.log(`PASS ${checks} account data-scope checks (synthetic PGlite, no network)`);
  } finally {await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
