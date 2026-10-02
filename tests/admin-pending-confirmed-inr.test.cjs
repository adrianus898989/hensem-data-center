// Offline SQL tests. Archives and orders are entirely synthetic; no network/auth credentials.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=n=>fs.readFileSync(path.join(__dirname,'..',n),'utf8');
const migration=read('supabase/migrations/20261002095303_pending_capture_confirmed_inr.sql');
const baseline=read('tests/fixtures/pending-analysis/production-currency-readers.sql');
const entries=[...migration.matchAll(/\('([^']+)',timestamptz '([^']+)','([a-f0-9]{64})'\)/g)].map(m=>({platform:m[1],at:m[2],hash:m[3]}));
const uuid=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
const scalar=async(db,q,p=[])=>Object.values((await db.query(q,p)).rows[0])[0];
const helper=(db,id)=>scalar(db,'select private.dashboard_admin_pending_archive_currency($1::uuid)',[id]);
let db,catalog=[],syntheticMigration,originalArchive,originalOrders,baselineMetadata;
async function seed(database){
 await database.exec(`set timezone='UTC';create schema private;create role anon;create role authenticated;create role service_role;
 grant usage on schema private to authenticated,service_role,anon;
 ${read('tests/fixtures/pending-analysis/capture-schema.sql')}
 create table public.withdraw_pending_backlog_daily(source_system text,country_code text,platform text,stat_date date,capture_date date,window_start date,window_end date,window_days int,snapshot_id uuid,snapshot_at timestamptz,snapshot jsonb,updated_at timestamptz);
 create function private.withdraw_pending_capture_immutable()returns trigger language plpgsql set search_path=''as $$begin raise exception 'PENDING_CAPTURE_IMMUTABLE';end$$;
 revoke all on function private.withdraw_pending_capture_immutable()from public,anon,authenticated,service_role;
 create trigger header_immutable before update or delete on private.withdraw_pending_capture_archive for each row execute function private.withdraw_pending_capture_immutable();
 create trigger order_immutable before update or delete on private.withdraw_pending_capture_orders for each row execute function private.withdraw_pending_capture_immutable();
 revoke all on private.withdraw_pending_capture_archive,private.withdraw_pending_capture_orders from public,anon,authenticated,service_role;
 create table public.synthetic_catalog(value jsonb);
 create function private.dashboard_admin_pending_platform_key(text,text)returns text language sql immutable as $$select upper($2)$$;
 create function private.dashboard_scope_allows(s jsonb,c text,p text)returns boolean language sql stable as $$select coalesce(s->>'mode'='all'or (s->>'mode'='selected'and s->'countries'?c and s->'platforms'?p),false)$$;
 create function private.dashboard_admin_live_scope()returns jsonb language plpgsql stable security definer set search_path=''as $$begin if current_setting('test.authorized',true)is distinct from'true'then raise exception 'preview_denied';end if;return current_setting('test.scope')::jsonb;end$$;
 create function private.dashboard_role_require_gateway()returns void language plpgsql stable security definer set search_path=''as $$begin if current_setting('test.gateway',true)is distinct from'true'then raise exception 'gateway_required';end if;end$$;
 create function private.dashboard_role_access()returns jsonb language sql stable security definer set search_path=''as $$select current_setting('test.role')::jsonb$$;
 create function private.dashboard_admin_pending_resolve(q jsonb,s jsonb)returns jsonb language plpgsql stable security definer set search_path=''as $$declare c jsonb;begin
 select coalesce(jsonb_agg(x),'[]')into c from public.synthetic_catalog a,jsonb_array_elements(a.value)x where q->'platformIds'? (x->>'id');
 if jsonb_array_length(c)<>jsonb_array_length(q->'platformIds')or exists(select 1 from jsonb_array_elements(c)x where not private.dashboard_scope_allows(s,x->>'scope_group',x->>'platform_key'))then raise exception 'platform_denied';end if;return c;end$$;
 create function private.dashboard_admin_live_provider_canonical(text,text,text)returns text language sql immutable as $$select $3$$;
 select set_config('test.authorized','true',false),set_config('test.gateway','true',false),set_config('test.scope','{"mode":"all"}',false),set_config('test.role','{"mode":"assigned","permissions":["stuck.view","stuck.query","stuck.detail"]}',false);`);
 await database.exec(baseline);
 const targets=[];
 for(let i=0;i<entries.length;i++){
  const e=entries[i],count=i===12?309:303,id=uuid(i+1),nativeId=uuid(i+101),receipt=uuid(i+201),amount=count*60;
  targets.push({id:nativeId,scope_group:'IN',platform_key:e.platform,source:'ar',country:'印度',team:'M8',currency:'INR',timezone:'Asia/Kolkata',name:e.platform,mapping_ambiguous:false});
  const snapshot={schema_version:1,source_system:'WITHDRAW_REVIEW',country_code:'IN',platform:e.platform,stat_date:'2026-10-01',timezone:'Asia/Kolkata',snapshot_id:receipt,snapshot_at:e.at,coverage:{complete:true,expected_count:count,fetched_count:count,unique_count:count},totals:{pending_count:count,pending_amount:amount},groups:[{raw_channel:'SyntheticPay',channel_type:'BANK',pending_count:count,pending_amount:amount}]};
  await database.query(`insert into private.withdraw_pending_capture_archive(id,source_system,country_code,platform,stat_date,capture_date,window_start,window_end,window_days,snapshot_id,snapshot_at,snapshot,timezone,capture_basis,within_midnight_window,identity_status,native_source_system,platform_id,team_name,currency,partition_snapshots,pending_count,pending_amount,updated_at)
  values($1,'WITHDRAW_REVIEW','IN',$2,'2026-10-01','2026-10-02','2026-09-25','2026-10-01',7,$3,$4,$5,'Asia/Kolkata','actual_capture',true,'resolved','AR',$6,'M8',null,'[]',$7,$8,$4)`,[id,e.platform,receipt,e.at,snapshot,nativeId,count,amount]);
  await database.query(`insert into private.withdraw_pending_capture_orders select $1,'SYNTHETIC_'||i,'WITHDRAW_REVIEW','IN',$2,'2026-10-01',60,'2026-10-01T12:00:00'::timestamp,'Asia/Kolkata','SyntheticPay','BANK','已提交',$3,$4 from generate_series(1,$5::int)i`,[id,e.platform,receipt,e.at,count]);
 }
 await database.query('insert into public.synthetic_catalog values($1)',[targets]);
 return targets;
}
async function syntheticManifest(database){
 const hashes=(await database.query("select platform,encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex') hash from private.withdraw_pending_capture_archive a order by platform")).rows;
 let sql=migration;for(const e of entries){const h=hashes.find(x=>x.platform===e.platform);assert(h);sql=sql.replace(e.hash,h.hash)}return sql;
}
async function fresh(){const database=new PGlite();await seed(database);return database;}
const orderRequest=(i=0,extra={})=>({date:'2026-10-01',observedAt:entries[i].at.replace(' ','T').replace('+00','Z'),mode:'midnight',platformIds:[uuid(i+101)],offset:0,limit:50,...extra});
const orders=(extra={})=>scalar(db,'select private.dashboard_admin_live_pending_orders($1::jsonb)',[orderRequest(0,extra)]);
const heads=()=>scalar(db,"select private.dashboard_admin_pending_capture_heads($1::jsonb,$2::jsonb,'2026-10-01','2026-10-01')",[catalog,{mode:'all'}]);
before(async()=>{
 assert.equal(entries.length,13);db=await fresh();catalog=(await db.query('select value from public.synthetic_catalog')).rows[0].value;
 originalArchive=await scalar(db,'select jsonb_agg(to_jsonb(a)order by id)from private.withdraw_pending_capture_archive a');originalOrders=await scalar(db,'select jsonb_agg(to_jsonb(a)order by archive_id,order_no)from private.withdraw_pending_capture_orders a');
 baselineMetadata=await scalar(db,"select jsonb_object_agg(oid::regprocedure::text,to_jsonb(p)-'prosrc')from pg_proc p where oid in('private.dashboard_admin_live_pending_orders(jsonb)'::regprocedure,'private.dashboard_admin_pending_capture_heads(jsonb,jsonb,date,date)'::regprocedure,'private.dashboard_admin_pending_capture_day(jsonb,jsonb,jsonb)'::regprocedure)");
 assert.equal((await heads()).length,0,'unknown source currency must fail native INR identity validation before confirmation');
 assert.equal((await orders()).available,false);syntheticMigration=await syntheticManifest(db);await db.exec(syntheticMigration);
});
after(async()=>{await db?.close()});
test('13 exact owner confirmations expose 3945 synthetic orders without changing immutable archive/order rows',async()=>{
 assert.equal(await scalar(db,'select count(*)from private.withdraw_pending_capture_currency_confirmations'),13);
 assert.deepEqual(await scalar(db,'select jsonb_agg(to_jsonb(a)order by id)from private.withdraw_pending_capture_archive a'),originalArchive);
 assert.deepEqual(await scalar(db,'select jsonb_agg(to_jsonb(a)order by archive_id,order_no)from private.withdraw_pending_capture_orders a'),originalOrders);
 const h=await heads();assert.equal(h.length,13);assert.equal(h.reduce((n,r)=>n+r.pending_count,0),3945);assert(h.every(x=>x.currency==='INR'&&x.captureVerified===true));
 const page=await orders();assert.equal(page.available,true);assert.equal(page.currency,'INR');assert.equal(page.total,303);assert.equal(page.rows.length,50);assert.equal(page.amount,'18180');assert.equal(page.hasMore,true);assert(page.rows.every(x=>x.orderNumber.startsWith('SYNTHETIC_')));
});
test('daily decoration reads confirmed currency but keeps precise actual observation and midnight eligibility',async()=>{
 const h=await heads(),a=h[0],native=catalog.find(x=>x.platform_key===a.platform),day={rows:[{id:native.id,source:'ar',scopeGroup:'IN',currency:'INR',state:'complete',timingState:'on_time'}]};
 const out=await scalar(db,'select private.dashboard_admin_pending_capture_day($1,$2,$3)',[day,catalog,h]);assert.equal(out.rows[0].currency,'INR');assert.equal(out.rows[0].archiveId,a.id);assert.equal(out.rows[0].observationSource,'verified_archive');assert.equal(out.rows[0].midnightEligible,true);assert.equal(out.onTimePlatformCount,1);
 day.rows[0].timingState='late';const late=await scalar(db,'select private.dashboard_admin_pending_capture_day($1,$2,$3)',[day,catalog,h]);assert.equal(late.rows[0].midnightEligible,false);assert.equal(late.rows[0].timingState,'late');
});
test('confirmation lookup remains valid across session timezones and cannot change source currency precedence',async()=>{
 await db.exec("set timezone='America/Sao_Paulo'");assert.equal(await helper(db,uuid(1)),'INR');await db.exec("set timezone='UTC'");
 await db.exec('begin;alter table private.withdraw_pending_capture_archive disable trigger header_immutable');await db.query("update private.withdraw_pending_capture_archive set currency='USD'where id=$1",[uuid(1)]);assert.equal(await helper(db,uuid(1)),'USD');await db.exec('rollback');
});
test('future or different captures, countries, teams, native identities and content never inherit this INR confirmation',async()=>{
 for(const change of ["country_code='BR'","team_name='OTHER'","native_source_system='NEW_AR'","platform_id='20000000-0000-4000-8000-000000009999'","stat_date='2026-10-02'","snapshot_at=snapshot_at+interval'1 second'","window_start=window_start+1","snapshot=jsonb_set(snapshot,'{totals,pending_amount}','1')","pending_amount=pending_amount+1","timezone='UTC'","identity_status='legacy_unbound'"]){
  await db.exec('begin;alter table private.withdraw_pending_capture_archive disable trigger header_immutable');await db.exec('update private.withdraw_pending_capture_archive set '+change+" where id='"+uuid(1)+"'");assert.equal(await helper(db,uuid(1)),null,change);await db.exec('rollback');
 }
 await db.exec('begin');await db.query("insert into private.withdraw_pending_capture_archive select $1,source_system,country_code,platform,stat_date,capture_date,window_start,window_end,window_days,snapshot_id,snapshot_at+interval'1 second',snapshot,timezone,capture_basis,within_midnight_window,identity_status,native_source_system,platform_id,team_name,currency,partition_snapshots,pending_count,pending_amount,updated_at from private.withdraw_pending_capture_archive where id=$2",[uuid(999),uuid(1)]);assert.equal(await helper(db,uuid(999)),null);await db.exec('rollback');
});
test('native catalog identity/currency/timezone drift, foreign scope and absent providers remain denied or empty',async()=>{
 for(const [key,value]of [['team','OTHER'],['currency','USD'],['timezone','UTC'],['id',uuid(999)],['source','newar']]){
  const changed=catalog.map((c,i)=>i?c:{...c,[key]:value});const h=await scalar(db,"select private.dashboard_admin_pending_capture_heads($1::jsonb,$2::jsonb,'2026-10-01','2026-10-01')",[changed,{mode:'all'}]);assert.equal(h.length,12,key);
 }
 const limited=await scalar(db,"select private.dashboard_admin_pending_capture_heads($1::jsonb,$2::jsonb,'2026-10-01','2026-10-01')",[catalog,{mode:'selected',countries:['IN'],platforms:[entries[0].platform]}]);assert.equal(limited.length,1);
 assert.equal((await orders({provider:'AbsentPay'})).total,0);assert.equal((await orders({provider:'AbsentPay'})).rows.length,0);
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({mode:'selected',countries:['BR'],platforms:[entries[0].platform]})]);await assert.rejects(()=>orders(),/platform_denied/);await db.exec("select set_config('test.scope','{\"mode\":\"all\"}',false)");
});
test('existing authenticated RPC still enforces gateway, live authorization and view/query/detail permissions',async()=>{
 for(const [key,value,pattern]of [['test.gateway','false',/gateway_required/],['test.authorized','false',/preview_denied/],['test.role','{"mode":"assigned","permissions":["stuck.view","stuck.query"]}',/role_permission_denied/]]){
  const prior=await scalar(db,"select current_setting($1)",[key]);await db.query('select set_config($1,$2,false)',[key,value]);await assert.rejects(()=>orders(),pattern);await db.query('select set_config($1,$2,false)',[key,prior]);
 }
 await db.exec('set role authenticated');assert.equal((await orders()).available,true);await db.exec('reset role');
});
test('new private evidence/helper are owner-only, RLS-enabled and immutable; existing RPC metadata is identical',async()=>{
 const meta=await scalar(db,"select jsonb_object_agg(oid::regprocedure::text,to_jsonb(p)-'prosrc')from pg_proc p where oid in('private.dashboard_admin_live_pending_orders(jsonb)'::regprocedure,'private.dashboard_admin_pending_capture_heads(jsonb,jsonb,date,date)'::regprocedure,'private.dashboard_admin_pending_capture_day(jsonb,jsonb,jsonb)'::regprocedure)");assert.deepEqual(meta,baselineMetadata);
 assert.equal(await scalar(db,"select relrowsecurity from pg_class where oid='private.withdraw_pending_capture_currency_confirmations'::regclass"),true);
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await scalar(db,"select has_table_privilege($1,'private.withdraw_pending_capture_currency_confirmations','SELECT,INSERT,UPDATE,DELETE')",[role]),false);
  assert.equal(await scalar(db,"select has_function_privilege($1,'private.dashboard_admin_pending_archive_currency(uuid)','EXECUTE')",[role]),false);
 }
 await assert.rejects(()=>db.exec('update private.withdraw_pending_capture_currency_confirmations set currency=currency'),/PENDING_CAPTURE_IMMUTABLE/);await assert.rejects(()=>db.exec('delete from private.withdraw_pending_capture_currency_confirmations'),/PENDING_CAPTURE_IMMUTABLE/);
});
test('exact production manifest rejects synthetic/unrecognized content atomically rather than broadly confirming a country',async()=>{
 const freshDb=await fresh();try{await assert.rejects(()=>freshDb.exec(migration),/pending_currency_confirmation_manifest_drift/);await freshDb.exec('rollback');assert.equal(await scalar(freshDb,"select to_regclass('private.withdraw_pending_capture_currency_confirmations')"),null);assert.equal(await scalar(freshDb,'select count(*)from private.withdraw_pending_capture_orders'),3945);}finally{await freshDb.close()}
});
test('metadata drift aborts before writing confirmation evidence',async()=>{
 const freshDb=await fresh();try{const code=await syntheticManifest(freshDb);await freshDb.exec('alter function private.dashboard_admin_pending_capture_heads(jsonb,jsonb,date,date)security definer');await assert.rejects(()=>freshDb.exec(code),/pending_currency_reader_baseline_drift/);await freshDb.exec('rollback');assert.equal(await scalar(freshDb,"select to_regclass('private.withdraw_pending_capture_currency_confirmations')"),null);}finally{await freshDb.close()}
});
