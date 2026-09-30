// Real production function definitions, synthetic orders only; no network or PII.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261001030000_wg_existing_members.sql'),'utf8');
const baseline=require('./fixtures/wg-existing-member-functions.json');
const br='10000000-0000-4000-8000-000000000001',vn='10000000-0000-4000-8000-000000000002',lg='10000000-0000-4000-8000-000000000003';
const request={platformId:br,startAt:'2026-09-29T00:00:00-03:00',endAt:'2026-09-30T00:00:00-03:00',direction:'all'};
let db,legacy,acl,submissionBody;
const call=async(extra={})=>(await db.query('select private.dashboard_admin_live_member_daily($1::jsonb) value',[JSON.stringify({...request,...extra})])).rows[0].value;
const row=(r,direction='withdraw',date='2026-09-29')=>r.rows.find(x=>x.direction===direction&&x.date===date);
const withoutClock=r=>{const{asOf,...rest}=r;return rest;};
before(async()=>{
 db=new PGlite();await db.exec(`
 create schema private;create role anon;create role authenticated;grant usage on schema private to authenticated;
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin
 if current_setting('test.active',true)='false' then raise exception 'preview_denied';end if;
 return coalesce(nullif(current_setting('test.scope',true),'')::jsonb,'{"mode":"all"}'::jsonb);end$$;
 create table fixture_platforms(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text);
 create function private.dashboard_admin_live_platforms() returns setof fixture_platforms language sql stable security definer set search_path='' as $$
 select p.* from public.fixture_platforms p where private.dashboard_admin_live_scope()->>'mode'='all'
 or private.dashboard_admin_live_scope()->'ids' ? p.id::text$$;
 create function private.dashboard_admin_wg_sites() returns table(site_code text,country_code text,country text,platform text,timezone text,currency text) language sql immutable as $$
 values('278','BR','巴西','26BET','America/Sao_Paulo','BRL'),('3257','VN','越南','98VV','Asia/Ho_Chi_Minh','VND')$$;
 create function private.dashboard_admin_live_expand_provider_filter(q jsonb) returns jsonb language sql stable as $$
 select case when q->'providers' ? 'Combined' then jsonb_set(q,'{providers}','["route-a","route-b"]') else q end$$;
 create function private.dashboard_admin_validate_amount_bands(jsonb,text) returns jsonb language sql immutable as $$select '{}'::jsonb$$;
 create table wg_recharge_details(site_code text,order_number text,member_id text,created_at timestamptz,success_at timestamptz,updated_at timestamptz,status_code integer,provider text,member_currency text);
 create table wg_withdraw_details(site_code text,order_number text,member_id text,created_at timestamptz,success_at timestamptz,operated_at timestamptz,completion_at_unverified timestamptz,status_code integer,provider text,member_currency text);
 create table lg_orders(source_system text,country_code text,platform text,order_kind text,member_id text,third_party text,raw_channel text,created_at timestamptz,paid_at timestamptz,status_class text);
 insert into fixture_platforms values
 ('${br}','26BET','M8','巴西','BR','wg','America/Sao_Paulo','BRL','26BET'),
 ('${vn}','98VV','M8','越南','VN','wg','Asia/Ho_Chi_Minh','VND','98VV'),
 ('${lg}','LG-A','M8','菲律宾','PH','lg','Asia/Manila','PHP','LG-A');
 insert into lg_orders values('LG','PH','LG-A','withdraw','SYNTH-LG','route-a','route-a','2026-09-29T03:00Z','2026-09-29T04:00Z','success');
 insert into wg_withdraw_details values
 ('278','W1','SYNTH-001','2026-09-29T03:00Z',null,'2026-09-29T04:00Z','2026-09-29T04:01Z',4,'route-a','BRL'),
 ('278','W2','SYNTH-001','2026-09-29T04:00Z',null,'2026-09-29T05:00Z','2026-09-29T05:01Z',7,'route-b','BRL'),
 ('278','W3','SYNTH-001','2026-09-29T05:00Z',null,'2026-09-29T06:00Z','2026-09-29T06:01Z',3,'route-a','BRL'),
 ('278','W4','SYNTH-002','2026-09-29T06:00Z',null,'2026-09-29T07:00Z','2026-09-29T07:01Z',8,'route-b','BRL'),
 ('278','W5',null,'2026-09-29T07:00Z',null,'2026-09-29T08:00Z','2026-09-29T08:01Z',4,'route-a','BRL'),
 ('278','W6','  ','2026-09-29T08:00Z',null,null,null,5,'route-b','BRL'),
 ('278','BEFORE','SYNTH-BEFORE','2026-09-29T02:59:59Z',null,'2026-09-29T04:00Z',null,4,'route-a','BRL'),
 ('278','NEXT','SYNTH-001','2026-09-30T03:00Z',null,'2026-09-30T03:01Z',null,4,'route-a','BRL'),
 ('3257','VN1','SYNTH-VN','2026-09-28T17:00Z',null,'2026-09-28T18:00Z',null,4,'route-a','VND');
 insert into wg_recharge_details values
 ('278','C1',null,'2026-09-29T03:00Z','2026-09-29T03:01Z','2026-09-29T03:01Z',2,'route-a','BRL'),
 ('278','C2',null,'2026-09-29T04:00Z',null,'2026-09-29T04:01Z',1,'route-b','BRL'),
 ('278','CROSS-IN',null,'2026-09-28T22:00Z','2026-09-29T04:00Z','2026-09-29T04:00Z',2,'route-a','BRL'),
 ('278','CROSS-OUT',null,'2026-09-29T22:00Z','2026-09-30T04:00Z','2026-09-30T04:00Z',2,'route-b','BRL'),
 ('278','WRONG-STATUS',null,'2026-09-29T06:00Z','2026-09-29T06:01Z','2026-09-29T06:01Z',1,'route-a','BRL');
 `);
 for(const f of baseline)await db.exec(f.definition);
 await db.exec('revoke all on function private.dashboard_admin_live_member_daily(jsonb) from public,anon;grant execute on function private.dashboard_admin_live_member_daily(jsonb) to authenticated;');
 legacy=withoutClock(await call({platformId:lg}));
 acl=(await db.query("select prosecdef,proconfig,proacl::text,proowner from pg_proc where oid='private.dashboard_admin_live_member_daily(jsonb)'::regprocedure")).rows;
 submissionBody=(await db.query("select prosrc from pg_proc where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure")).rows[0].prosrc;
 await db.exec(migration);
});
after(async()=>db?.close());
test('non-WG results and existing ACL/settings stay unchanged',async()=>{
 assert.deepEqual(withoutClock(await call({platformId:lg})),legacy);
 assert.deepEqual((await db.query("select prosecdef,proconfig,proacl::text,proowner from pg_proc where oid='private.dashboard_admin_live_member_daily(jsonb)'::regprocedure")).rows,acl);
});
test('withdraw creation members dedupe by ID across providers, missing IDs remain counted as missing',async()=>{
 const r=await call(),w=row(r);assert.equal(w.created_order_count,6);assert.equal(w.created_member_count,2);assert.equal(w.created_missing_member_count,2);
 assert.equal(w.created_available,true);assert.equal(w.created_members_ge2,1);assert.equal(w.created_members_ge3,1);assert.equal(w.created_members_ge4,0);assert.equal(w.created_members_ge5,0);
 assert.doesNotMatch(JSON.stringify(r),/SYNTH-|order_number|W1|CROSS-IN/);
});
test('charge unknown IDs are NULL members, never fake zero, while real timestamp order counts are retained',async()=>{
 const c=row(await call(),'charge');assert.equal(c.created_available,false);assert.equal(c.success_available,false);
 assert.equal(c.created_member_count,null);assert.equal(c.success_member_count,null);assert.equal(c.created_order_count,4);assert.equal(c.created_missing_member_count,4);
 assert.equal(c.success_order_count,2);assert.equal(c.success_missing_member_count,2);assert.equal(c.created_members_ge2,null);assert.equal(c.success_members_ge2,null);
 assert.equal(c.created_unavailable_reason,'source_member_id_unavailable');
});
test('withdraw success members/order/frequency all unavailable despite operation timestamps and status4',async()=>{
 const r=await call(),w=row(r);for(const k of ['success_member_count','success_order_count','success_missing_member_count','success_members_ge2','success_members_ge3','success_members_ge4','success_members_ge5'])assert.equal(w[k],null,k);
 assert.equal(w.success_available,false);assert.equal(w.success_unavailable_reason,'source_success_time_unavailable');
 assert.equal(r.capabilities.memberIdentity,false);assert.deepEqual(r.capabilities.memberIdentityByDirection,{charge:false,withdraw:true});
 assert.deepEqual(r.capabilities.availability,{charge:{created:false,success:false},withdraw:{created:true,success:false}});
});
test('actual PostgreSQL response passes the existing member-page WG availability validator',async()=>{
 const {requestFor,validate}=require('../admin-preview/live-member-counts.js');
 const r=await call(),item=requestFor(r.platform,()=>({...request,status:'all'})),parsed=validate(r,item);
 assert.equal(parsed.rows.find(x=>x.direction==='charge').created_member_count,null);
 assert.equal(parsed.rows.find(x=>x.direction==='withdraw').created_member_count,2);
 assert.equal(parsed.rows.find(x=>x.direction==='withdraw').success_member_count,null);
 assert.equal(parsed.frequencySupported,true);
});
test('exact local boundaries, direction and partial times are honored',async()=>{
 const w=row(await call({direction:'withdraw',startAt:'2026-09-29T04:00:00Z',endAt:'2026-09-29T06:00:00Z'}));assert.equal(w.created_order_count,2);assert.equal(w.created_member_count,1);
 const v=row(await call({platformId:vn,direction:'withdraw',startAt:'2026-09-29T00:00:00+07:00',endAt:'2026-09-30T00:00:00+07:00'}));assert.equal(v.created_order_count,1);
 const days=await call({direction:'withdraw',endAt:'2026-10-01T00:00:00-03:00'});assert.equal(days.rows.length,2);assert.equal(row(days,'withdraw','2026-09-30').created_member_count,1);
});
test('provider expansion dedupes selected provider set and currency filters do not fabricate observations',async()=>{
 assert.deepEqual(withoutClock(await call({providers:['Combined']})),withoutClock(await call()));
 const r=await call({direction:'withdraw',providers:['route-a']});assert.equal(row(r).created_order_count,3);assert.equal(row(r).created_member_count,1);assert.equal(row(r).created_members_ge2,1);
 const empty=await call({currency:'USD'});assert.equal(row(empty).created_order_count,0);assert.equal(row(empty).created_member_count,0);assert.equal(row(empty).success_member_count,null);assert.equal(row(empty,'charge').created_member_count,null);
});
test('empty days preserve unavailability rather than return unavailable metrics as zero',async()=>{
 const r=await call({startAt:'2026-10-02T00:00:00-03:00',endAt:'2026-10-03T00:00:00-03:00'});
 const c=row(r,'charge','2026-10-02'),w=row(r,'withdraw','2026-10-02');assert.equal(c.created_order_count,0);assert.equal(c.created_member_count,null);assert.equal(c.success_member_count,null);assert.equal(w.created_member_count,0);assert.equal(w.success_member_count,null);assert.equal(r.capabilities.sourceCompletenessVerified,false);
});
test('fresh platform scope, strict filters, and helper privileges remain closed',async()=>{
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({ids:[vn]})]);try{await assert.rejects(call(),/platform_denied/);}finally{await db.exec("set test.scope=''");}
 await db.exec("set test.active='false'");try{await assert.rejects(call(),/preview_denied/);}finally{await db.exec("set test.active='true'");}
 for(const p of [{extra:true},{direction:'refund'},{providers:[1]},{startAt:'2026-08-01T00:00:00Z'},{endAt:'2026-09-29T00:00:00-03:00'}])await assert.rejects(call(p),/invalid_/);
 assert.equal((await db.query("select has_function_privilege('authenticated','private.dashboard_admin_wg_member_daily(jsonb,timestamptz,timestamptz,text,text[],text)','execute') allowed")).rows[0].allowed,false);
 assert.equal((await db.query("select has_table_privilege('authenticated','public.wg_withdraw_details','select') allowed")).rows[0].allowed,false);
});
test('WG submission analysis stays unavailable without UID and its deployed function is untouched',async()=>{
 assert.equal((await db.query("select prosrc from pg_proc where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure")).rows[0].prosrc,submissionBody);
 await assert.rejects(db.query('select private.dashboard_admin_live_submission_analysis($1::jsonb)',[JSON.stringify({...request,direction:'charge',operation:'summary',threshold:15})]),/submission_source_unavailable/);
});
test('migration is repeatable and refuses a changed production baseline',async()=>{
 const r=withoutClock(await call());await db.exec(migration);assert.deepEqual(withoutClock(await call()),r);
 await db.exec('begin');try{await db.exec("create or replace function private.dashboard_admin_live_member_daily(p_request jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$begin return '{}'::jsonb;end$$;");await assert.rejects(db.exec(migration),/baseline changed/);}finally{await db.exec('rollback');}
});
