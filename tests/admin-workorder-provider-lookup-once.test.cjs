const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=name=>fs.readFileSync(path.join(__dirname,'../supabase',name),'utf8');
const patch=sql('admin-live-workorder-provider-lookup-once.sql');
const request={country:'印度',startAt:'2026-09-01T00:00:00+05:30',endAt:'2026-09-28T23:59:59+05:30',limit:20};
const cases=[{},...['charge','withdraw'].map(direction=>({direction})),...['Alpha','Beta','RAJA','RAJALOTTERY'].map(platform=>({platform})),
 ...['Example','Example-BANK','ArbPay','Absent'].map(provider=>({provider})),{platforms:['RAJA','RAJALOTTERY']},{platforms:[]},{providers:[]},{offset:1000},
 {endAt:'2026-09-01T23:59:59+05:30'},{startAt:'2026-09-29T00:00:00+05:30',endAt:'2026-09-29T23:59:59+05:30'},
 {platforms:['Alpha','Beta'],providers:['Example'],direction:'withdraw'}];
let db,beforeRows,oldDefinition,oldAcl,oldCallCount;
const call=async extra=>(await db.query('select private.dashboard_admin_live_workorders($1::jsonb) value',[JSON.stringify({...request,...extra})])).rows[0].value;
const calls=async()=>(await db.query('select last_value from private.provider_calls')).rows[0].last_value;
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin
 if current_setting('test.active',true)='false' then raise exception 'preview_denied';end if;
 return coalesce(nullif(current_setting('test.scope',true),'')::jsonb,'{"mode":"all"}'::jsonb);end$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select coalesce($1->>'mode'='all' or $1->'platforms' ? $3,false)$$;
 create table catalog(id uuid,name text,source_name text,country text,scope_group text,source text);
 create function private.dashboard_admin_live_platforms() returns setof public.catalog language sql stable as $$select * from public.catalog where private.dashboard_scope_allows(private.dashboard_admin_live_scope(),country,source_name)$$;
 create sequence private.provider_calls;
 create function private.dashboard_admin_live_workorder_provider(text,text,text,text) returns text language plpgsql volatile as $$begin
 perform nextval('private.provider_calls');return case when $3='ArbPayINR' then 'ArbPay' when $3='Example-QR' and $4='BANK' then 'Example-BANK' when $3='Example-QR' then 'Example' else $3 end;end$$;
 create table workorder_deposit_daily(stat_date date,country_code text,country text not null,platform text not null,third_party text,channel_type text,source_system text,submitted_count bigint,submitted_amount numeric,success_count bigint,success_amount numeric,withdraw_not_received_count bigint,withdraw_not_received_amount numeric,withdraw_success_count bigint,withdraw_success_amount numeric,source_updated_at timestamptz default now(),updated_at timestamptz default now());
 insert into catalog values('11111111-1111-4111-8111-111111111111','Alpha','Alpha','印度','IN','ar'),('22222222-2222-4222-8222-222222222222','Beta','Beta','印度','IN','newar'),
 ('33333333-3333-4333-8333-333333333333','RAJAGAMES','RAJA','印度','IN','ar'),('44444444-4444-4444-8444-444444444444','RAJALOTTERY','RAJALOTTERY','印度','IN','ar');
 insert into workorder_deposit_daily select date '2026-09-01'+day-1,'IN','印度',s.platform,s.provider,s.channel,'AR_WORKORDER',10,1000,4,400,3,300,1,100,now(),now()
 from generate_series(1,28) day cross join (values('Alpha','Example-QR','QR'),('Alpha','Example-QR','BANK'),('Beta','Example','QR'),('RAJA','ArbPayINR','BANK'),('RAJALOTTERY','ArbPayINR','BANK'))s(platform,provider,channel);`);
 await db.exec(sql('admin-live-workorder-platform-breakdown.sql'));
 // Keep an existing return hook, as in the deployed original-order release.
 await db.exec(`create function private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb) returns jsonb language sql stable as $$select $2||'{"uniqueOrderVersion":1}'::jsonb$$;
 do $$declare definition text;begin select pg_get_functiondef('private.dashboard_admin_live_workorders(jsonb)'::regprocedure) into definition;
 execute replace(definition,'  return v_result;','  return private.dashboard_admin_live_workorder_unique_totals(p_request,v_result);');end$$;`);
 beforeRows=[];for(const extra of cases)beforeRows.push(await call(extra));
 oldDefinition=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_workorders(jsonb)'::regprocedure) definition")).rows[0].definition;
 oldAcl=(await db.query("select prosecdef,proconfig,proacl::text from pg_proc where oid='private.dashboard_admin_live_workorders(jsonb)'::regprocedure")).rows;
 await db.exec('alter sequence private.provider_calls restart with 1');await call();oldCallCount=await calls();
 await db.exec(patch);
});
after(async()=>db?.close());

test('all full responses preserve aliases, RAJA identity, coverage, directions and filters',async()=>{
 for(let i=0;i<cases.length;i++)assert.deepEqual(await call(cases[i]),beforeRows[i],JSON.stringify(cases[i]));
 assert.equal((await call()).uniqueOrderVersion,1,'existing original-order return hook is preserved');
});
test('month-range provider lookups happen once per complete source identity',async()=>{
 await db.exec('alter sequence private.provider_calls restart with 1');const result=await call();
 assert.equal(oldCallCount,140);assert.equal(await calls(),5);assert.equal(result.summary.submittedCount,1820);
 const row=result.byProvider.find(x=>x.provider==='Example-BANK'&&x.direction==='charge');assert.equal(row.submittedCount,280,'different channel identity is not merged before classification');
});
test('scope is fresh on every request and execution ACLs do not change',async()=>{
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({platforms:['Beta']})]);try{
  const current=await call();await db.exec(oldDefinition);const previous=await call();assert.deepEqual(current,previous);await db.exec(patch);
  assert(current.byPlatformProvider.every(x=>x.sourcePlatform==='Beta'));
 }finally{await db.exec("set test.scope=''");}
 await db.exec("set test.active='false'");try{await assert.rejects(call(),/preview_denied/);}finally{await db.exec("set test.active='true'");}
 assert.deepEqual((await db.query("select prosecdef,proconfig,proacl::text from pg_proc where oid='private.dashboard_admin_live_workorders(jsonb)'::regprocedure")).rows,oldAcl);
});
test('guarded migration is idempotent and changes no source tables or authorization',async()=>{
 const before=await call();await db.exec(patch);assert.deepEqual(await call(),before);
 assert.equal(sql('migrations/20260928101637_admin_live_workorder_provider_lookup_once.sql'),patch);
 assert.doesNotMatch(patch,/\b(create table|alter table|insert into|delete from|update public\.|grant execute)\b/i);
 await db.exec('begin');try{
  await db.exec("create or replace function private.dashboard_admin_live_workorders(p_request jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$begin return '{}'::jsonb;end$$;");
  await assert.rejects(db.exec(patch),/baseline changed/);
 }finally{await db.exec('rollback');}
 assert.deepEqual(await call(),before);
});
