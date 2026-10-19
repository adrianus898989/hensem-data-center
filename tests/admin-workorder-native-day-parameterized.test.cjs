// Whole original PostgreSQL readers over existing synthetic fixtures. No network,
// captured account, business payload, private receipt or alternate aggregation.
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,n),'utf8');
const script='supabase/maintenance/workorder-native-day-parameterized.sql',undo='supabase/maintenance/workorder-native-day-parameterized.rollback.sql';
const pairs=JSON.parse(read(script).match(/\$pairs\$([\s\S]*?)\$pairs\$/)[1]);
const sharedPrefix=read('tests/admin-workorder-shared-provider-names.test.cjs').split(/\ntest\(/)[0];let initialize;
const load=n=>n==='node:test'?{...require(n),beforeEach:fn=>initialize=fn,afterEach:()=>{}}:require(n);
const fixture=new Function('require','__dirname',sharedPrefix+';return{db,fixture};')(load,__dirname);
const scalar=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0]?.value;
const q={country:'印度',platforms:['Alpha','DhaniWin','DHANIWIN'],direction:'all',startAt:'2026-10-02T00:00:00Z',endAt:'2026-10-08T23:59:59Z',limit:20};
async function setup(){await initialize();const db=fixture.db();try{
 await db.exec('commit');
 // The shared fixture reconstructs the exact prior unique helper from the
 // shipped batch patches. Parent code is also the real shipped reader.
 for(const p of pairs){const def=await scalar(db,'select pg_get_functiondef($1::regprocedure)value',[p.signature]);assert.equal(def.split(p.before).length,2);}
 const oldUnique=await scalar(db,'select pg_get_functiondef($1::regprocedure)value',[pairs[1].signature]);
 // The shared fixture leaves its old unique state installed; apply its existing
 // exact two shared-name patches so this operation's current hash is the baseline.
 const common=JSON.parse(read('supabase/operations/workorder-shared-provider-names.sql').match(/\$patches\$([\s\S]*?)\$patches\$/)[1]);let unique=oldUnique;
 if(await scalar(db,'select md5(prosrc)value from pg_proc where oid=$1::regprocedure',[pairs[1].signature])!==pairs[1].oldBody){for(const p of common){assert.equal(unique.split(p.before).length,2);unique=unique.replace(p.before,()=>p.after);}await db.exec(unique);}
 for(const p of pairs)assert.equal(await scalar(db,'select md5(prosrc)value from pg_proc where oid=$1::regprocedure',[p.signature]),p.oldBody);
 await db.exec(`create or replace function public.dashboard_admin_live_workorders(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO '' SET statement_timeout TO '30s'
AS $function$
  select private.dashboard_admin_live_workorders(p_request);
$function$;`);
 return db;
 }catch(error){await db.close();throw error;}}
async function definition(db,p,after){let def=await scalar(db,'select pg_get_functiondef($1::regprocedure)value',[p.signature]);if(after&&def.includes(p.before))def=def.replace(p.before,()=>p.after);if(!after&&def.includes(p.after))def=def.replace(p.after,()=>p.before);await db.exec(def);}
async function invoke(db,after,request){for(const p of pairs)await definition(db,p,after);await db.exec('savepoint invoke');try{const text=await scalar(db,'select public.dashboard_admin_live_workorders($1::jsonb)::text value',[JSON.stringify(request)]);await db.exec('release savepoint invoke');return{text};}catch(error){await db.exec('rollback to invoke;release savepoint invoke');return{error:{code:error.code,message:error.message}};}}
async function same(db,extra={}){const request={...q,...extra};const old=await invoke(db,false,request),next=await invoke(db,true,request);assert.deepEqual(next,old,JSON.stringify(extra));if(old.text!==undefined)assert.equal((await db.query('select $1::jsonb=$2::jsonb equal',[old.text,next.text])).rows[0].equal,true);return next;}

test('only the two joins change; full original DTO text agrees across range dedup, nullable evidence, types, filters, DST and permission errors',async()=>{
 const db=await setup();try{
  await fixture.fixture.ar('KNOWN','SHARED',{provider:'SUPER',date:'2026-10-02',amount:'123456789012345.123456789012345678',status:4});await fixture.fixture.ar('UNKNOWN','SHARED',{provider:'未识别三方',date:'2026-10-08',amount:'123456789012345.123456789012345678'});await fixture.fixture.ar('CONFLICT','SHARED',{provider:'OtherPay',date:'2026-10-08',amount:2});await fixture.fixture.ar('WITHDRAW','OTHER',{kind:'withdraw',amount:null});await fixture.fixture.dailyAr();
  await fixture.fixture.api.ticket('N1','NATIVE',{provider:'Super-QR',created:'2026-10-02T12:00:00+05:30'});await fixture.fixture.api.ticket('N2','NATIVE',{provider:'Super-QR',created:'2026-10-08T12:00:00+05:30',status:'4'});await fixture.fixture.api.ticket('N3',null,{provider:'Super-QR',amount:null,raw:{depositOrderNo:7}});await fixture.fixture.api.ticket('N4',null,{provider:'Super-QR',currency:'USD',raw:{rechargeNumber:'FALLBACK'}});await fixture.fixture.api.ticket('EXCLUDED',null,{type:'USDT存款未到账自动化',provider:'ExcludedPay',currency:null});await fixture.fixture.api.daily({provider:'ExcludedPay',submitted:1,amount:1});
  await db.exec('begin');for(const p of pairs){const before=await scalar(db,'select pg_get_functiondef($1::regprocedure)value',[p.signature]);await definition(db,p,true);const next=await scalar(db,'select pg_get_functiondef($1::regprocedure)value',[p.signature]);assert.equal(next.replace(p.after,()=>p.before),before);assert.equal(next.split('offset 0').length,before.split('offset 0').length+1);await definition(db,p,false);}
  for(const extra of[{}, {providers:['SUPER']},{providers:['未识别三方']},{providers:['OtherPay']},{providers:['Super-QR']},{providers:[]},{direction:'charge'},{direction:'withdraw'},{offset:20,limit:30},{platforms:['Alpha']},{platforms:['DhaniWin','DHANIWIN']}]){const result=await same(db,extra);assert.equal(typeof result.text,'string');assert.match(result.text,/"uniqueOrderCount"/);}
  await db.exec("update public.newar_detail_platforms set timezone='America/New_York'where platform='DhaniWin'");await fixture.fixture.api.ticket('DST-START','DST-A',{created:'2026-03-08T05:00:00Z'});await fixture.fixture.api.ticket('DST-END','DST-B',{created:'2026-03-09T04:00:00Z'});const dst=await same(db,{startAt:'2026-03-08T00:00:00Z',endAt:'2026-03-08T23:59:59Z',platforms:['DhaniWin'],direction:'charge'});assert.match(dst.text,/"submittedCount":\s*1(?:[,}])/);
  await db.exec("update public.newar_detail_platforms set launch_at='2026-10-08T12:00:01+05:30'where platform='DhaniWin'");await same(db);await db.exec("update public.newar_detail_platforms set enabled=false where platform='DhaniWin'");await same(db);
  await db.exec("set local test.active='false'");assert.match((await same(db)).error.message,/preview_denied/);await db.exec("set local test.active='true'");for(const extra of[{startAt:'bad'},{providers:null},{direction:'bad'}])await same(db,extra);
 }finally{await db.close();}});

async function dependencies(db){
 // Existing original dependency code, empty synthetic fee evidence. No fake
 // financial token function, no private definition fixture.
 const scopes=JSON.parse(read('tests/fixtures/scope-functions.json'));await db.exec(scopes.find(x=>x.proname==='dashboard_data_group').definition+';');
 await db.exec(`create table if not exists private.fee_rate_versions(id text,country text,rule_key text);create table if not exists private.fee_rate_current_evidence(generation_id text,source_id text,rule_key text,version_id text,state text,direction text);create table if not exists private.fee_rate_generations(id text,published_at timestamptz);create table if not exists public.third_party_rates(id text,updated_at timestamptz,category text,country text,third_party text);create table if not exists private.dashboard_admin_order_provider_confirmations(source_system text,order_kind text,order_no text,confirmed_provider text,country_code text,platform text,active boolean);create table if not exists public.ar_config_targets(source_system text,country_code text,platform text,currency text);alter table private.dashboard_admin_provider_overrides add column if not exists version bigint default 0;create or replace function private.prepared_aggregate_native_catalog()returns setof public.catalog language sql stable as $$select *from public.catalog$$;`);
 const defs=[read('supabase/migrations/20261015141000_exact_prepared_aggregates.sql').match(/create function private\.prepared_aggregate_dependency_common\([\s\S]*?\$fn\$;/i)[0],read('supabase/migrations/20261015080114_provider_snapshot_semantic_fee_dependencies.sql').match(/create or replace function private\.provider_snapshot_dependency_token\([\s\S]*?\$fn\$;/i)[0],read('supabase/operations/withdraw-prepared/store.sql').match(/CREATE FUNCTION private\.withdraw_prepared_dependency\(\)[\s\S]*?\$\$;/)[0]];await db.exec('set check_function_bodies=off');for(const d of defs)await db.exec(d);await db.exec('reset check_function_bodies');
}
async function adaptOIDMetadata(db,sql){for(const p of pairs){const meta=await scalar(db,"select md5((to_jsonb(p)-'prosrc')::text)value from pg_proc p where oid=$1::regprocedure",[p.signature]);assert(sql.includes(p.metadataMD5));sql=sql.replace(p.metadataMD5,meta);}return sql;}
test('complete paired CAS replay/rollback and malformed metadata states preserve all routines/source metadata and actual dependency results',async()=>{
 const db=await setup();try{await dependencies(db);const all=()=>scalar(db,'select md5(jsonb_agg(to_jsonb(p)order by oid)::text)value from pg_proc p'),before=await all();const install=await adaptOIDMetadata(db,read(script)),rollback=await adaptOIDMetadata(db,read(undo));
  await db.exec(install);await db.exec(install);await db.exec(rollback);await db.exec(rollback);assert.equal(await all(),before);
  const command=install.replace('BEGIN ISOLATION LEVEL REPEATABLE READ;','').replace(/COMMIT;\s*$/,'');for(const [change,error]of[["grant execute on function private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)to authenticated",/metadata_drift/],[null,/mixed_state/]]){await db.exec('begin');if(change)await db.exec(change);else await definition(db,pairs[1],true);const drift=await all();await db.exec('savepoint bad_install');await assert.rejects(db.exec(command),error);await db.exec('rollback to bad_install');assert.equal(await all(),drift);await db.exec('rollback');}
 }finally{await db.close();}});
