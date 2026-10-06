// Production reader definition, synthetic local PostgreSQL rows only; no network or customer orders.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const baseline=JSON.parse(read('tests/fixtures/vn-intake-channel-baseline.json')).definition;
const migration=read('supabase/migrations/20261006060307_vn_intake_channel_identity.sql');
const canonical=read('supabase/admin-live-intake-coverage.sql');
const publicWrapper=canonical.match(/create or replace function public\.dashboard_admin_live_intake_coverage\([\s\S]*?\$\$;/)[0];
const privateSignature='private.dashboard_admin_live_intake_coverage(jsonb)',publicSignature='public.dashboard_admin_live_intake_coverage(jsonb)',helperSignature='private.dashboard_admin_vn_intake_channel_identity(text,text,text)';
const md5=s=>crypto.createHash('md5').update(s).digest('hex');
const day='2026-10-03',captured='2026-10-04T00:00:00Z',snapshotId='20000000-0000-4000-8000-000000000001';
const clock='v_asof timestamptz:=statement_timestamp();',freeze=sql=>sql.replace(clock,"v_asof timestamptz:='2026-10-06T12:00:00Z'::timestamptz;");
const qr='Quét mã ngân hàng',bank='Chuyển khoản ngân hàng';
const group=(channel,count,type=qr)=>({raw_channel:channel,channel_type:type,submitted_count:count,success_count:0});
const feed=(platform='66CLUB',country='VN',direction='charge')=>({id:md5([country,platform,direction].join('|')),dataset:'orders',system:'ar',country:country==='VN'?'越南':'印度',rawCountry:country,rawPlatform:platform,name:platform,direction,timezone:country==='VN'?'Asia/Ho_Chi_Minh':'Asia/Kolkata',sourceKind:'direct'});
let db,patchedDefinition,originalMetadata;
const metadata=async()=>(await db.query("select n.nspname,to_jsonb(p)-'prosrc' metadata,p.prosrc body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid in ($1::regprocedure,$2::regprocedure) order by n.nspname",[privateSignature,publicSignature])).rows;
const defineFeed=async(f=feed())=>{await db.exec('delete from fixture_feeds');await db.query('insert into fixture_feeds values($1::jsonb)',[JSON.stringify(f)]);return f;};
const call=async(request)=>(await db.query('select public.dashboard_admin_live_intake_coverage($1::jsonb) data',[JSON.stringify(request)])).rows[0].data;
const one=async(f=feed())=>(await call({operation:'rows',feedIds:[f.id],startAt:day,endAt:day})).rows[0];
const identity=async(country,channel,type)=>(await db.query('select private.dashboard_admin_vn_intake_channel_identity($1,$2,$3)::jsonb value',[country,channel,type])).rows[0].value;
const orders=async(channel,n,type=qr,{platform='66CLUB',country='VN',kind='recharge',source='AR',applied=day+' 10:00',completed=null}={})=>db.query('insert into ar_collected_orders(country_code,platform,order_kind,source_system,applied_at,completed_at,updated_at,raw_channel,channel_type) select $1,$2,$3,$4,$5::timestamp,$6::timestamp,$7::timestamptz,$8,$9 from generate_series(1,$10::integer)',[country,platform,kind,source,applied,completed,captured,channel,type,n]);
const snapshot=(groups,opts={})=>{const f=feed(opts.platform,opts.country),n=groups.reduce((sum,g)=>sum+g.submitted_count,0);return {schema_version:1,source_system:'RECHARGE_REVIEW',country_code:f.rawCountry,platform:f.rawPlatform,stat_date:day,timezone:f.timezone,snapshot_id:snapshotId,snapshot_at:captured,coverage:{complete:true,expected_count:n,fetched_count:n,unique_count:n},totals:{submitted_count:n,success_count:0},groups};};
const save=async(value,{country=value.country_code,platform=value.platform,at=captured}={})=>db.query('insert into collection_success_daily values($1,$2,$3,$4,$5::jsonb,$6::uuid,$7::timestamptz,$7::timestamptz)',[country,platform,day,'RECHARGE_REVIEW',JSON.stringify(value),snapshotId,at]);
const rejection=async(run,pattern)=>{await db.exec('savepoint expected_rejection');try{await assert.rejects(run(),pattern);}finally{await db.exec('rollback to savepoint expected_rejection;release savepoint expected_rejection');}};
before(async()=>{
 db=new PGlite();await db.exec(`
 create schema private;create role anon;create role authenticated;create role service_role;
 grant usage on schema private to authenticated;
 create table fixture_feeds(value jsonb);
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin if coalesce(current_setting('test.scope',true),'')='' then raise exception 'unauthorized';end if;return current_setting('test.scope')::jsonb;end$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select $1->>'mode'='all' or (coalesce($1->'countries' ? $2,false) and (not ($1 ? 'platforms') or $1->'platforms' ? $3))$$;
 create function private.dashboard_admin_live_intake_feeds(timestamptz) returns jsonb language sql stable as $$select coalesce(jsonb_agg(value),'[]'::jsonb) from public.fixture_feeds where private.dashboard_scope_allows(private.dashboard_admin_live_scope(),value->>'country',value->>'name')$$;
 create function private.dashboard_admin_live_intake_order_feeds(timestamptz) returns jsonb language sql stable as $$select coalesce(jsonb_agg(value),'[]'::jsonb) from public.fixture_feeds where value->>'dataset'='orders' and private.dashboard_scope_allows(private.dashboard_admin_live_scope(),value->>'country',value->>'name')$$;
 create function private.dashboard_admin_wg_current_feeds(jsonb) returns jsonb language sql immutable as $$select $1$$;
 create table ar_config_targets(country_code text,platform text,source_system text);
 create table newar_detail_platforms(country_code text,platform text,enabled boolean,launch_at timestamptz);
 create table ar_collected_orders(country_code text,platform text,order_kind text,source_system text,applied_at timestamp,completed_at timestamp,updated_at timestamptz,raw_channel text,channel_type text);
 create table collection_success_daily(country_code text,platform text,stat_date date,source_system text,snapshot jsonb,snapshot_id uuid,snapshot_at timestamptz,updated_at timestamptz);
 select set_config('test.scope','{"mode":"all"}',false);
 `);
 await db.exec(baseline+';revoke all on function '+privateSignature+' from public,anon;grant execute on function '+privateSignature+' to authenticated;'+publicWrapper+'revoke all on function '+publicSignature+' from public,anon;grant execute on function '+publicSignature+' to authenticated,service_role;');
 originalMetadata=await metadata();assert.equal(md5(originalMetadata[0].body),'5816e612959fe8f9ffa0176140ac3b84');assert.equal(md5(originalMetadata[1].body),'697704eba7fc57c48dddfd78ec6043ff');
 assert(migration.trim(),'migration must exist before the executable regression runs');await db.exec(migration);
 patchedDefinition=(await db.query('select pg_get_functiondef($1::regprocedure) definition',[privateSignature])).rows[0].definition;
 assert.notEqual(patchedDefinition,baseline);assert.equal(patchedDefinition.split(clock).length,2);
});
after(async()=>db?.close());
beforeEach(async()=>{await db.exec('begin');await db.exec(freeze(patchedDefinition));await defineFeed();});
afterEach(async()=>db.exec('rollback'));

test('66CLUB 2816 and VN168 3798 exact collected totals change from false channel mismatch to complete',async()=>{
 for(const [platform,total,momoType] of [['66CLUB',2816,'MoMoPay'],['VN168',3798,'MOMO QR']]){
  await db.exec('delete from ar_collected_orders;delete from collection_success_daily');const f=await defineFeed(feed(platform));
  const parts=[['1VNPay-MoMo','1VNPay',701,momoType],['1VNPay-QR','1VNPay',503,qr],['FastPay','FASTPay',400,bank],['V8pay','V8Pay',300,bank],['Shijie-QR','SHIJIE',200,qr],['YesPay-QR','YesPay',total-2104,qr]];
  for(const [raw,,n,type] of parts)await orders(raw,n,type,{platform});await save(snapshot(parts.map(([,name,n,type])=>group(name,n,type)),{platform}));
  await db.exec(freeze(baseline));const old=await one(f);assert.equal(old.status,'partial');assert.equal(old.evidence,'source_created_channel_mismatch');assert.equal(old.expectedCount,total);assert.equal(old.fetchedCount,total);
  await db.exec(freeze(patchedDefinition));const current=await one(f);assert.equal(current.status,'complete');assert.equal(current.evidence,'source_created_counts_reconciled');assert.equal(current.expectedCount,total);assert.equal(current.fetchedCount,total);assert.equal(current.zeroConfirmed,false);
 }
});
test('one missing native order remains an explicit count mismatch after alias normalization',async()=>{
 await orders('FastPay',2,bank);await save(snapshot([group('FASTPay',3,bank)]));const r=await one();assert.equal(r.status,'partial');assert.equal(r.evidence,'source_created_count_mismatch');assert.equal(r.expectedCount,3);assert.equal(r.fetchedCount,2);assert.equal(r.complete,false);
});
test('matching total cannot hide a different provider or a different payment method',async()=>{
 for(const [channel,type] of [['V8pay',bank],['FASTPay',qr],['1VNPay-MoMo','MOMO QR']]){
  await db.exec('delete from ar_collected_orders;delete from collection_success_daily');await orders(channel,3,type);await save(snapshot([group('FASTPay',3,bank)]));const r=await one();assert.equal(r.status,'partial');assert.equal(r.evidence,'source_created_channel_mismatch');assert.equal(r.fetchedCount,r.expectedCount);
 }
});
test('1VNPay QR and MoMo stay separate even when the canonical provider matches',async()=>{
 await orders('1VNPay-QR',2,qr);await orders('1VNPay-MoMo',1,'MoMoPay');await save(snapshot([group('1VNPay',2,qr),group('1VNPay',1,'MoMoPay')]));assert.equal((await one()).status,'complete');
 await db.exec('delete from collection_success_daily');await save(snapshot([group('1VNPay',1,qr),group('1VNPay',2,'MoMoPay')]));assert.equal((await one()).evidence,'source_created_channel_mismatch');
 assert.deepEqual(await identity('VN','1VNPay-MoMo','MOMO QR'),['1VNPay','MOMO QR']);assert.deepEqual(await identity('VN','1VNPay-MoMo','MoMoPay'),['1VNPay','MoMoPay']);assert.deepEqual(await identity('VN','1VNPay-QR',qr),['1VNPay',qr]);
});
test('only the two confirmed USDT providers normalize USDT-TRC20; fiat and other USDT labels remain exact',async()=>{
 await orders('Tron-USDT',2,'USDT-TRC20');await orders('UniPayUSDT',1,'USDT-TRC20');await save(snapshot([group('Tron-USDT',2,'USDT'),group('UniPayUSDT',1,'USDT')]));assert.equal((await one()).status,'complete');
 assert.deepEqual(await identity('VN','UnknownUSDT','USDT-TRC20'),['UnknownUSDT','USDT-TRC20']);assert.deepEqual(await identity('VN','Tron-USDT',qr),['Tron-USDT',qr]);
 await db.exec('delete from collection_success_daily');await save(snapshot([group('Tron-USDT',3,'USDT')]));assert.equal((await one()).evidence,'source_created_channel_mismatch');
});
test('canonical collisions aggregate both snapshot aliases and observed raw groups without overwriting counts',async()=>{
 await orders('FastPay',2,bank);await orders('FASTPay',3,bank);await save(snapshot([group('FastPay',1,bank),group('FASTPay',4,bank)]));const r=await one();assert.equal(r.status,'complete');assert.equal(r.expectedCount,5);assert.equal(r.fetchedCount,5);
 await db.exec('delete from ar_collected_orders');await orders('FASTPay',5,bank);assert.equal((await one()).status,'complete');
});
test('unknown names, invalid pairings, whitespace, case and null identities are preserved instead of washed away',async()=>{
 for(const [channel,type] of [[null,qr],['FastPay',null],[null,null],['Unknown-QR',qr],['fastpay',bank],['FastPay ',bank],['FastPay',qr],['1VNPay-MoMo',qr],['1VNPay-QR','MOMO QR']])assert.deepEqual(await identity('VN',channel,type),[channel,type]);
 await orders('FastPay',2,bank);await orders(null,1,bank);await save(snapshot([group('FASTPay',3,bank)]));let r=await one();assert.equal(r.fetchedCount,3);assert.equal(r.evidence,'source_created_channel_mismatch');
 await db.exec('delete from ar_collected_orders;delete from collection_success_daily');await orders('UNKNOWN literal',3,'UNKNOWN type');await save(snapshot([group('UNKNOWN literal',3,'UNKNOWN type')]));r=await one();assert.equal(r.status,'complete','an exact unknown identity still reconciles, without inventing a known provider');
});
test('other countries retain byte-exact channel identity and alias mismatches',async()=>{
 const f=await defineFeed(feed('AR','IN'));await orders('FastPay',3,bank,{country:'IN',platform:'AR'});await save(snapshot([group('FASTPay',3,bank)],{country:'IN',platform:'AR'}));const r=await one(f);assert.equal(r.evidence,'source_created_channel_mismatch');assert.equal(r.complete,false);
 for(const country of ['IN','BR','vn','越南',null])assert.deepEqual(await identity(country,'FastPay',bank),['FastPay',bank]);
 await db.exec('delete from collection_success_daily');await save(snapshot([group('FastPay',3,bank)],{country:'IN',platform:'AR'}));assert.equal((await one(f)).status,'complete');
});
test('scope predicates still exclude other countries, platforms, dates, sources and directions',async()=>{
 await orders('FastPay',2,bank);for(const extra of [{country:'IN'},{platform:'VN168'},{kind:'withdraw'},{source:'OTHER'},{applied:'2026-10-02 23:59:59'},{applied:'2026-10-04 00:00'}])await orders('FastPay',7,bank,extra);
 await save(snapshot([group('FASTPay',2,bank)]));const r=await one();assert.equal(r.status,'complete');assert.equal(r.fetchedCount,2);assert.doesNotMatch(JSON.stringify(r),/raw_channel|channel_type|FastPay|order_no|member/);
});
test('raw snapshot duplicates remain invalid even when distinct aliases may legitimately converge',async()=>{
 await orders('FastPay',3,bank);await save(snapshot([group('FastPay',1,bank),group('FastPay',2,bank)]));const r=await one();assert.equal(r.collectorStatus,'snapshot_invalid');assert.equal(r.complete,false);assert.equal(r.expectedCount,null);
});
test('invalid metadata, counts, raw identities and premature snapshot capture cannot certify completeness',async()=>{
 const good=snapshot([group('FASTPay',3,bank)]);await orders('FastPay',3,bank);
 const variants=[{...good,platform:'OTHER'},{...good,country_code:'IN'},{...good,timezone:'UTC'},{...good,snapshot_id:'20000000-0000-4000-8000-000000000099'},{...good,snapshot_at:'not-a-time'},{...good,snapshot_at:'2026-10-04T01:00:00Z'},{...good,coverage:{...good.coverage,complete:false}},{...good,coverage:{...good.coverage,expected_count:'3'}},{...good,coverage:{...good.coverage,unique_count:2}},{...good,groups:[group(null,3,bank)]},{...good,groups:[group('FASTPay',3,null)]},{...good,groups:[group('',3,bank)]},{...good,groups:[group('FASTPay',-1,bank)]}];
 for(const s of variants){await db.exec('delete from collection_success_daily');await save(s,{country:'VN',platform:'66CLUB'});const r=await one();assert.equal(r.collectorStatus,'snapshot_invalid',JSON.stringify(s));assert.equal(r.complete,false);assert.equal(r.zeroConfirmed,false);}
 await db.exec('delete from collection_success_daily');const premature='2026-10-03T12:00:00Z';await save({...good,snapshot_at:premature},{at:premature});assert.equal((await one()).collectorStatus,'snapshot_invalid');
});
test('zero still requires a valid complete snapshot and success timestamps never change creation counts',async()=>{
 let r=await one();assert.equal(r.complete,false);assert.equal(r.zeroConfirmed,false);await save(snapshot([]));r=await one();assert.equal(r.status,'zero_complete');assert.equal(r.expectedCount,0);assert.equal(r.fetchedCount,0);
 await db.exec('delete from collection_success_daily');await orders('FastPay',2,bank,{completed:'2026-10-05 09:00'});await save(snapshot([group('FASTPay',2,bank)]));assert.equal((await one()).status,'complete');await db.exec('update ar_collected_orders set completed_at=null');assert.equal((await one()).status,'complete');
});
test('withdraw receipt is unchanged by a reconciled charge snapshot',async()=>{
 const f=await defineFeed(feed('66CLUB','VN','withdraw'));await save(snapshot([]));await orders('FastPay',2,bank,{kind:'withdraw'});const r=await one(f);assert.equal(r.status,'received');assert.equal(r.complete,false);assert.equal(r.expectedCount,null);assert.equal(r.collectorStatus,null);
});
test('fresh authorization and native feed allowlists remain required',async()=>{
 await db.query("select set_config('test.scope',$1,true)",[JSON.stringify({countries:['印度']})]);await rejection(()=>one(),/coverage_feed_denied/);
 await db.query("select set_config('test.scope',$1,true)",[JSON.stringify({countries:['越南'],platforms:['VN168']})]);await rejection(()=>one(),/coverage_feed_denied/);
 await db.exec("select set_config('test.scope','',true)");await rejection(()=>call({operation:'orderCatalog'}),/unauthorized/);
 await db.exec("select set_config('test.scope','{\"mode\":\"all\"}',true)");await rejection(()=>call({operation:'rows',feedIds:['f'.repeat(32)],startAt:day,endAt:day}),/coverage_feed_denied/);
 await db.exec('set local role anon');await rejection(()=>one(),/permission denied/);await db.exec('reset role');
 await db.exec('set local role authenticated');const r=await one();assert.equal(r.status,'not_received');await rejection(()=>identity('VN','FastPay',bank),/permission denied/);await db.exec('reset role');
});
test('reader and public wrapper metadata remain unchanged; helper is private and executable replay is idempotent',async()=>{
 await db.exec(patchedDefinition);const current=await metadata();for(let i=0;i<2;i++)assert.deepEqual(current[i].metadata,originalMetadata[i].metadata);assert.equal(current[1].body,originalMetadata[1].body);assert.notEqual(current[0].body,originalMetadata[0].body);
 const helper=(await db.query("select p.prosecdef,p.provolatile,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p where p.oid=$1::regprocedure",[helperSignature])).rows[0];assert.equal(helper.prosecdef,false);assert.equal(helper.provolatile,'i');assert.deepEqual(helper.proconfig,['search_path=""']);assert.equal(helper.anon,false);assert.equal(helper.authenticated,false);assert.equal(helper.service,false);
 const before=await metadata();await db.exec(migration);assert.deepEqual(await metadata(),before);await db.exec('begin');
});
test('reader body, security and permission drift fail closed rather than replacing unrelated changes',async()=>{
 for(const change of [patchedDefinition.replace('begin\n','begin\n -- unrelated reader update\n'),'alter function '+privateSignature+' security invoker','alter function '+privateSignature+' set search_path=public','grant execute on function '+privateSignature+' to anon','grant execute on function '+publicSignature+' to anon',publicWrapper.replace('select private.dashboard_admin_live_intake_coverage(p_request)',"select '{}'::jsonb")]){
  await db.exec(patchedDefinition);await db.exec(change);await assert.rejects(db.exec(migration),/drift/i);await db.exec('rollback;begin');
 }
});
test('helper body, permission, strictness, security or missing-helper drift is never silently repaired on replay',async()=>{
 const changes=['grant execute on function '+helperSignature+' to authenticated','alter function '+helperSignature+' security definer','alter function '+helperSignature+' strict','alter function '+helperSignature+' parallel unsafe',"create or replace function private.dashboard_admin_vn_intake_channel_identity(p_country text,p_channel text,p_type text) returns text language sql immutable security invoker parallel safe set search_path='' as $$select 'unexpected'::text$$",'drop function '+helperSignature];
 for(const change of changes){await db.exec(patchedDefinition);await db.exec(change);await assert.rejects(db.exec(migration),/vn_intake_channel_identity_(?:drift|missing)/);await db.exec('rollback;begin');}
});
