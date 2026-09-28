// Synthetic read-only source fixtures. No production session or payout operations.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=name=>fs.readFileSync(path.join(__dirname,'../supabase',name),'utf8'),patch=sql('admin-live-auto-withdraw-scope-targets.sql');
const request={country:'巴西',startAt:'2026-09-27T00:00:00Z',endAt:'2026-09-27T23:59:59Z',limit:20};
const targets=[{country:'巴西',platforms:['M8-A','DIRECT','NOT-SELECTED']},{country:'胖虎巴西',platforms:['PH-A']}];
const oldCases=[{},...['巴西','胖虎巴西','印度','香港','红膏蟹','Absent'].flatMap(country=>[{country},{country,view:'operators'},{country,daily:true},{country,platforms:[]},{country,platforms:['SAME']}]),{platform:'DIRECT'},{platforms:['M8-A','DIRECT']},{sort:'autoRate',ascending:true},{offset:20},{view:'operators',account:'alice'},{startAt:'2026-09-26T00:00:00Z'},{endAt:'2026-09-28T23:59:59Z'}];
let db,oldResponses,oldAcl;
const call=async extra=>(await db.query('select private.dashboard_admin_live_auto_withdraw($1::jsonb) value',[JSON.stringify({...request,...extra})])).rows[0].value;
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin
 if current_setting('test.active',true)='false' then raise exception 'preview_denied';end if;
 return coalesce(nullif(current_setting('test.scope',true),'')::jsonb,'{"mode":"all"}'::jsonb);end$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select coalesce($1->>'mode'='all' or $1->'targets' @> jsonb_build_array(jsonb_build_array($2,$3)),false)$$;
 create function private.dashboard_admin_live_can_note() returns boolean language sql stable as $$select false$$;
 create function private.dashboard_admin_live_report_country(text,text) returns text language sql immutable as $$select case $1 when 'BR' then '巴西' when 'IN' then '印度' else $1 end$$;
 create table auto_withdraw_daily(data_date date,country text,platform text,total bigint,success bigint,rejected bigint,auto_count bigint,manual_count bigint,avg_seconds numeric,source_updated_at timestamptz default '2026-09-28T00:00:00Z',updated_at timestamptz default '2026-09-28T00:00:00Z');
 create table withdraw_operator_daily(data_date date,country text,platform text,account text,processed bigint,rejected bigint,avg_seconds numeric,source_updated_at timestamptz default '2026-09-28T00:00:00Z',updated_at timestamptz default '2026-09-28T00:00:00Z');
 create table newar_business_snapshots(kind text,direction text,country text,platform text,stat_date date,payload jsonb,captured_at timestamptz default '2026-09-28T00:00:00Z',updated_at timestamptz default '2026-09-28T00:00:00Z');
 create table auto_withdraw_notes(data_date date,country text,platform text,reason text,updated_at timestamptz default '2026-09-28T00:00:00Z');
 create table game66_platforms(team_name text);insert into game66_platforms values('香港'),('红膏蟹');
 create table game_fixture(country text,platform text,data_date date,payload jsonb,operator_payload jsonb);
 create function private.dashboard_admin_live_game66_withdraw(date,date,text,text[]) returns jsonb language sql stable as $$
 select jsonb_build_object('rows',coalesce(jsonb_agg(payload),'[]'::jsonb),'operatorRows',coalesce(jsonb_agg(operator_payload),'[]'::jsonb)) from public.game_fixture
 where data_date between $1 and $2 and country=$3 and ($4 is null or upper(platform)=any($4)) and private.dashboard_scope_allows(private.dashboard_admin_live_scope(),country,platform)$$;
 insert into auto_withdraw_daily(data_date,country,platform,total,success,rejected,auto_count,manual_count,avg_seconds) values
 ('2026-09-26','巴西','M8-A',10,8,1,4,6,10),('2026-09-27','巴西','M8-A',20,16,2,12,8,20),
 ('2026-09-26','胖虎巴西','PH-A',20,16,2,12,8,20),('2026-09-27','胖虎巴西','PH-A',30,24,3,18,12,40),
 ('2026-09-27','巴西','DIRECT',999,999,0,999,0,999),('2026-09-26','巴西','DIRECT',5,4,1,3,2,15),
 ('2026-09-27','巴西','UNSELECTED',1000,900,100,800,200,50),
 ('2026-09-27','印度','SAME',9,8,1,4,5,10),('2026-09-26','印度','SAME',7,6,1,3,4,10);
 insert into newar_business_snapshots(kind,direction,country,platform,stat_date,payload) values
 ('auto_withdraw_bundle','all','巴西','DIRECT','2026-09-27','{"rows":[{"total_count":10,"success_count":9,"reject_count":1,"auto_count":7,"manual_count":3,"total_handle_seconds":300,"handle_count":10}],"operator_rows":[{"operator":"alice","processed_count":10,"reject_count":1,"total_handle_seconds":300,"handle_count":10}]}');
 insert into withdraw_operator_daily(data_date,country,platform,account,processed,rejected,avg_seconds) values
 ('2026-09-26','巴西','M8-A','alice',10,1,10),('2026-09-27','巴西','M8-A','alice',20,2,20),
 ('2026-09-26','胖虎巴西','PH-A','alice',20,2,20),('2026-09-27','胖虎巴西','PH-A','alice',30,3,40),
 ('2026-09-27','巴西','DIRECT','alice',999,0,999),('2026-09-26','巴西','DIRECT','alice',5,1,15),
 ('2026-09-27','印度','SAME','alice',9,1,10);
 insert into auto_withdraw_notes(data_date,country,platform,reason) values('2026-09-27','巴西','M8-A','M8 note'),('2026-09-27','胖虎巴西','PH-A','PH note'),('2026-09-27','巴西','UNSELECTED','Must not appear'),('2026-09-27','印度','SAME','India same'),('2026-09-27','香港','SAME','HK same');
 insert into game_fixture select country,platform,date '2026-09-26'+day,
 jsonb_build_object('country',country,'platform',platform,'data_date',date '2026-09-26'+day,'total',cnt,'success',cnt-1,'rejected',1,'auto_count',cnt-2,'manual_count',2,'avg_seconds',100,'source_updated_at','2026-09-28T00:00:00Z','updated_at','2026-09-28T00:00:00Z'),
 jsonb_build_object('country',country,'platform',platform,'data_date',date '2026-09-26'+day,'account','alice','processed',cnt,'rejected',1,'avg_seconds',100,'source_updated_at','2026-09-28T00:00:00Z','updated_at','2026-09-28T00:00:00Z')
 from (values('香港','SAME',15),('红膏蟹','RC',25))s(country,platform,cnt) cross join generate_series(0,1)day;`);
 const baseline=sql('admin-live-withdraw-pages.sql');const fn=baseline.slice(baseline.indexOf('create or replace function private.dashboard_admin_live_auto_withdraw('),baseline.indexOf('create or replace function public.dashboard_admin_live_auto_withdraw('));
 await db.exec(baseline.slice(baseline.indexOf('create or replace function private.dashboard_admin_live_withdraw_key('),baseline.indexOf('create or replace function private.dashboard_admin_live_game66_withdraw(')));
 await db.exec(fn);oldAcl=(await db.query("select prosecdef,proconfig,proacl::text from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure")).rows;
 oldResponses=[];for(const extra of oldCases)oldResponses.push(await call(extra));await db.exec(patch);
});
after(async()=>db?.close());
test('all legacy single-source complete responses remain unchanged',async()=>{for(let i=0;i<oldCases.length;i++)assert.deepEqual(await call(oldCases[i]),oldResponses[i],JSON.stringify(oldCases[i]));});
test('multiple authorized source teams share global totals, source precedence, weighted means and comparison',async()=>{
 const r=await call({scopeTargets:targets});assert.equal(r.total,3);assert.equal(r.totals.total,60);assert.equal(r.totals.success,49);assert.equal(r.totals.autoCount,37);assert.equal(r.totals.avgSeconds,1900/60);assert.equal(r.totals.platforms,3);assert.equal(r.totals.coveredDays,1);assert.equal(r.previousTotals.total,35);assert.equal(r.comparison.complete,true);assert.deepEqual(r.rows.map(x=>[x.country,x.platform,x.total]),[['胖虎巴西','PH-A',30],['巴西','M8-A',20],['巴西','DIRECT',10]]);assert.deepEqual(r.notes.map(x=>x.reason).sort(),['M8 note','PH note']);
 const o=await call({scopeTargets:targets,view:'operators'});assert.equal(o.totals.processed,60);assert.equal(o.totals.operators,3);assert.equal(o.totals.avgSeconds,1900/60);assert.equal(o.rows.find(x=>x.platform==='DIRECT').processed,10);
 const filtered=await call({scopeTargets:targets,platforms:['M8-A']});assert.equal(filtered.total,1);assert.equal(filtered.totals.total,20);assert.deepEqual(filtered.notes.map(x=>x.reason),['M8 note']);
});
test('same platform/account names under different teams retain source identity and independent detail notes',async()=>{
 const scopes=[{country:'印度',platforms:['SAME']},{country:'香港',platforms:['SAME']},{country:'红膏蟹',platforms:['RC']}];
 const r=await call({country:'印度',scopeTargets:scopes});assert.equal(r.total,3);assert.equal(r.totals.total,49);assert.equal(r.totals.platforms,3);assert.deepEqual(r.rows.map(x=>[x.country,x.platform,x.total]),[['红膏蟹','RC',25],['香港','SAME',15],['印度','SAME',9]]);assert.deepEqual(r.notes.map(x=>[x.country,x.reason]),[['印度','India same'],['香港','HK same']]);
 const o=await call({country:'印度',scopeTargets:scopes,view:'operators'});assert.equal(o.totals.operators,3);assert.equal(o.totals.platforms,3);assert.equal(o.total,3);
});
test('global order and pagination run after all source teams are combined',async()=>{
 await db.exec('begin');try{
 await db.exec(`insert into auto_withdraw_daily(data_date,country,platform,total,success,rejected,auto_count,manual_count,avg_seconds) select '2026-09-27',country,'P-'||i,i,i,0,i,0,null from (values('印度'),('香港'))c(country) cross join generate_series(1,14)i`);
 const scopeTargets=['印度','香港'].map(country=>({country,platforms:Array.from({length:14},(_,i)=>'P-'+(i+1))}));const a=await call({country:'印度',scopeTargets}),b=await call({country:'印度',scopeTargets,offset:20});assert.equal(a.total,28);assert.equal(a.rows.length,20);assert.equal(b.rows.length,8);assert.equal(a.totals.total,210);assert.deepEqual(a.totals,b.totals);assert.equal(a.rows[0].total,14);assert.equal(b.rows.at(-1).total,1);assert.equal(a.totals.avgSeconds,null);
 }finally{await db.exec('rollback');}
});
test('scopeTargets never replaces fresh platform/country authorization',async()=>{
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({targets:[['巴西','M8-A'],['香港','SAME']]})]);try{
 const r=await call({scopeTargets:targets});assert.deepEqual(r.rows.map(x=>[x.country,x.platform]),[['巴西','M8-A']]);assert.equal(r.totals.total,20);assert.deepEqual(r.notes.map(x=>x.reason),['M8 note']);
 const g=await call({country:'印度',scopeTargets:[{country:'印度',platforms:['SAME']},{country:'香港',platforms:['SAME']}]});assert.equal(g.total,1);assert.equal(g.rows[0].country,'香港');assert.equal(g.notes.length,1);
 }finally{await db.exec("set test.scope=''");}await db.exec("set test.active='false'");try{await assert.rejects(call({scopeTargets:targets}),/preview_denied/);}finally{await db.exec("set test.active='true'");}
});
test('malformed, unbounded or mismatched scope targets are rejected',async()=>{
 for(const scopeTargets of [null,{},[],Array(9).fill(targets[0]),[null],[{}],[{country:'巴西',platforms:[]}],[{country:'巴西',platforms:null}],[{country:'巴西',platforms:['']}],[{country:'巴西',platforms:[' A']}],[{country:'巴西',platforms:[1]}],[{country:'巴西',platforms:Array(201).fill('A')}],[{country:'印度',platforms:['A']}],[targets[0],targets[0]],[{...targets[0],sql:'private'}]])await assert.rejects(call({scopeTargets}),undefined,JSON.stringify(scopeTargets));
});
test('patch preserves ACL, is idempotent and refuses unknown baselines without changing sources',async()=>{
 assert.deepEqual((await db.query("select prosecdef,proconfig,proacl::text from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure")).rows,oldAcl);const r=await call({scopeTargets:targets});await db.exec(patch);assert.deepEqual(await call({scopeTargets:targets}),r);assert.equal(patch,sql('migrations/20260928102906_admin_live_auto_withdraw_scope_targets.sql'));assert.doesNotMatch(patch,/\b(create table|alter table|insert into|delete from|update public\.|grant execute)\b/i);
 await db.exec('begin');try{await db.exec("create or replace function private.dashboard_admin_live_auto_withdraw(p_request jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$begin return '{}'::jsonb;end$$;");await assert.rejects(db.exec(patch),/baseline changed/);}finally{await db.exec('rollback');}assert.deepEqual(await call({scopeTargets:targets}),r);
});
