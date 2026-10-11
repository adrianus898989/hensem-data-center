// Synthetic native facts only; never creates production sessions or reads order identities.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const repo=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const baseline=read('tests/fixtures/newar-withdraw-projection-production.sql').trim().replace(/\$function\$$/,'$function$;');
const install=read('supabase/migrations/20261011064049_newar_withdraw_fact_projection.sql');
const migration=read('supabase/migrations/20261011064050_newar_withdraw_fact_reader_cutover.sql');
const sig='private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)';
const meta=async db=>(await db.query("select to_jsonb(p)-'prosrc' metadata,md5(prosrc) hash from pg_proc p where oid=$1::regprocedure",[sig])).rows[0];
async function fixture(){
 const db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;create role service_role bypassrls;
 create table public.newar_detail_platforms(platform text primary key,country text,country_code text,timezone text,launch_at timestamptz,enabled boolean);
 create table public.newar_detail_records (
  id uuid primary key default gen_random_uuid(),
  platform text not null references public.newar_detail_platforms(platform),
  dataset text not null check(dataset in ('charge','withdraw','workorder')),
  source_id text not null check(length(source_id) between 1 and 200),
  member_id text, order_number text, third_party_order_number text,
  provider text, provider_id text, channel_type text,
  currency text check(currency is null or currency ~ '^[A-Z0-9]{3,8}$'),
  amount numeric(24,8) not null check(amount>=0 and amount::text not in ('NaN','Infinity','-Infinity')),
  actual_amount numeric(24,8) check(actual_amount>=0 and actual_amount::text not in ('NaN','Infinity','-Infinity')),
  fee numeric(24,8) check(fee>=0 and fee::text not in ('NaN','Infinity','-Infinity')),
  status_code text,
  status_group text not null check(status_group in ('success','pending','failed','rejected','unknown')),
  created_at timestamptz not null,
  success_at timestamptz,
  processed_at timestamptz,
  source_updated_at timestamptz,
  captured_at timestamptz not null,
  workorder_type text, operator text, followup_count integer check(followup_count>=0),
  raw jsonb not null default '{}' check(jsonb_typeof(raw)='object'),
  received_at timestamptz not null default now(),
  unique(platform,dataset,source_id),
  check(success_at is null or (status_group='success' and success_at>=created_at)),
  check(processed_at is null or processed_at>=created_at)
);

 create table private.newar_detail_credentials(token_hash text);create table private.newar_detail_batches(batch_id uuid);
 alter table public.newar_detail_records enable row level security;revoke all on public.newar_detail_records from public,anon,authenticated;grant all on public.newar_detail_records to service_role;
 create table private.newar_detail_coverage_runs(platform text,dataset text,effective_start_at timestamptz,end_at timestamptz,observed_at timestamptz,invalidated_at timestamptz);
 create function private.dashboard_admin_live_platforms() returns table(name text,country text,source_name text,timezone text,source text) language sql stable set search_path='' as $$
 select case platform when 'MAANWIN' then 'MAAN.WIN' else platform end,country,platform,timezone,'newar' from public.newar_detail_platforms$$;
 create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable set search_path='' as $$
 select case when s ? 'targets' then s->'targets' @> jsonb_build_array(jsonb_build_array(c,p)) else true end$$;
 create function private.dashboard_admin_live_withdraw_key(p_name text) returns text language sql immutable set search_path='' as $$
 select case upper(btrim(p_name)) when 'MAAN.WIN' then 'MAANWIN' when 'DHANI.WIN' then 'DHANIWIN' when 'SHREE.WIN' then 'SHREEWIN' when 'VEER.GAME' then 'VEERGAME' else upper(btrim(p_name)) end$$;

 insert into public.newar_detail_platforms values
 ('MAANWIN','印度','IN','Asia/Kolkata',null,true),('DhaniWin','印度','IN','Asia/Kolkata',null,true),
 ('ZERO','印度','IN','Asia/Kolkata',null,true),('GAP','印度','IN','Asia/Kolkata',null,true),
 ('LATE','印度','IN','Asia/Kolkata','2026-01-09T03:00:00Z',true),
 ('DISABLED','印度','IN','Asia/Kolkata',null,false),('OTHER','巴西','BR','America/Sao_Paulo',null,true);`);
 await db.exec(baseline);await db.exec(`revoke all on function ${sig} from public,anon,authenticated,service_role;grant usage on schema private to anon,authenticated,service_role;`);
 await db.exec('revoke all on function private.newar_stats_time(text),private.ingest_newar_detail_batch(text,jsonb) from public,anon,authenticated,service_role;grant execute on function private.newar_stats_time(text),private.ingest_newar_detail_batch(text,jsonb) to postgres;grant execute on function private.ingest_newar_detail_batch(text,jsonb) to service_role');
 assert.equal((await meta(db)).hash,'47fe6d24232211930ea6c0aae3e2ea11');return db;
}
const request=extra=>({country:'印度',...extra});
async function call(db,extra={},scope={},a='2026-01-09',b='2026-01-10'){
 return(await db.query(`select to_jsonb(d) value from ${sig.slice(0,sig.indexOf('('))}($1::jsonb,$2::jsonb,$3::date,$4::date)d order by data_date,platform`,[JSON.stringify(request(extra)),JSON.stringify(scope),a,b])).rows.map(r=>r.value);
}
const raw=(type='manual',account='Synthetic operator',extra={})=>({businessSchemaVersion:'2',operatorSourceField:'verifiedField',operatorName:account,operatorType:type,sourceSubmittedSourceField:'created',sourceHandledSourceField:'handled',sourceSubmittedAt:'2026-01-09T00:00:00Z',sourceHandledAt:'2026-01-09T00:00:12.250Z',...extra});
async function order(db,id,platform='MAANWIN',value=raw(),extra={}){
 const r={dataset:'withdraw',status_group:'success',currency:'INR',created_at:'2026-01-09T00:00:00Z',captured_at:'2026-01-10T00:00:00Z',received_at:'2026-01-10T01:00:00Z',...extra};
 return(await db.query('insert into public.newar_detail_records(platform,dataset,source_id,status_group,currency,captured_at,received_at,created_at,raw,amount) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,0) returning id',[platform,r.dataset,id,r.status_group,r.currency,r.captured_at,r.received_at,r.created_at,JSON.stringify(value)])).rows[0].id;
}
async function coverage(db,platform,start,end,extra={}){
 await db.query('insert into private.newar_detail_coverage_runs values($1,$2,$3,$4,$5,$6)',[platform,extra.dataset||'withdraw',start,end,extra.observed_at||'2026-01-11T00:00:00Z',extra.invalidated_at||null]);
}
async function compare(db,queries){
 const before=[];for(const q of queries)before.push(await call(db,...q));await db.exec(migration);
 for(let i=0;i<queries.length;i++)assert.deepEqual(await call(db,...queries[i]),before[i]);return before;
}
async function backfill(db){await db.exec(`with locked as materialized (
 select n.* from public.newar_detail_records n where n.dataset='withdraw' for share of n skip locked
 ) insert into private.newar_withdraw_facts select f.* from locked n cross join lateral private.newar_withdraw_fact(n) f on conflict(record_id) do nothing`)}
test('install is private, does not backfill or switch the helper, and is idempotent',async()=>{
 const db=await fixture();try{await order(db,'historical');const before=await meta(db);await db.exec(install);assert.deepEqual(await meta(db),before);
 assert.equal((await db.query('select count(*) n from private.newar_withdraw_facts')).rows[0].n,0);await db.exec(install);assert.deepEqual(await meta(db),before);
 const perms=(await db.query(`select has_table_privilege(r,'private.newar_withdraw_facts','select') readable,
 has_table_privilege(r,'private.newar_withdraw_facts','insert') writable,
 has_function_privilege(r,'private.newar_withdraw_fact(public.newar_detail_records)','execute') projector,
 has_function_privilege(r,'private.sync_newar_withdraw_fact()','execute') trigger from unnest(array['anon','authenticated','service_role']) r`)).rows;
 assert.deepEqual(perms,Array(3).fill({readable:false,writable:false,projector:false,trigger:false}));
 assert.deepEqual((await db.query("select relrowsecurity rls,relforcerowsecurity forced from pg_class where oid='private.newar_withdraw_facts'::regclass")).rows[0],{rls:true,forced:false});
 assert.doesNotMatch(install,/\b(?:disable trigger|alter table public\.newar_detail_records|grant .* to (?:anon|authenticated|service_role))\b/i);
 }finally{await db.close()}
});
test('exact parser retains zero durations, verification rules and null timestamps without typed-column fallback',async()=>{
 const db=await fixture();try{await db.exec(install);
 const cases=[raw(),raw('auto','  Synthetic auto  '),raw('robot'),raw('manual',''),raw('manual','x',{operatorSourceField:' '}),raw('manual','x',{businessSchemaVersion:'1'}),raw('manual','x',{sourceSubmittedSourceField:''}),raw('manual','x',{sourceHandledAt:'2026-02-30T00:00:00Z'}),raw('manual','x',{sourceHandledAt:'infinity'}),raw('manual','x',{sourceHandledAt:'2026-01-09T00:00:00Z'})];
 for(let i=0;i<cases.length;i++)await order(db,'parser-'+i,'MAANWIN',cases[i]);
 const rows=(await db.query('select source_id,method,account,submitted_at,handled_at from private.newar_withdraw_facts order by source_id')).rows;
 assert.equal(rows[0].method,'manual');assert.equal(rows[1].method,'auto');assert.equal(rows[1].account,'Synthetic auto');
 for(const i of[2,3,4,5]){assert.equal(rows[i].method,null);assert.equal(rows[i].account,'（未知操作人）')}
 assert.equal(rows[6].submitted_at,null);assert.equal(rows[6].handled_at,null);for(const i of[7,8])assert.equal(rows[i].handled_at,null);assert.equal(rows[9].submitted_at.valueOf(),rows[9].handled_at.valueOf());
 await compare(db,[[{}]]);assert.doesNotMatch(install,/processing_seconds|statement_timestamp\(\)/);
 }finally{await db.close()}
});
test('trigger synchronizes updates, dataset/platform moves, ID changes and deletes without stale facts',async()=>{
 const db=await fixture();try{await db.exec(install);const id=await order(db,'mutable');await order(db,'charge','MAANWIN',raw(),{dataset:'charge'});
 assert.equal((await db.query('select count(*) n from private.newar_withdraw_facts')).rows[0].n,1);
 await db.query("update public.newar_detail_records set raw=$1::jsonb,status_group='pending',currency=null,received_at='2026-01-12T00:00:00Z' where id=$2",[JSON.stringify(raw('auto','New operator')),id]);
 let row=(await db.query('select * from private.newar_withdraw_facts where record_id=$1',[id])).rows[0];assert.equal(row.method,'auto');assert.equal(row.account,'New operator');assert.equal(row.status_group,'pending');assert.equal(row.currency,null);
 await db.query("update public.newar_detail_records set platform='DhaniWin',source_id='moved' where id=$1",[id]);row=(await db.query('select * from private.newar_withdraw_facts where record_id=$1',[id])).rows[0];assert.equal(row.platform,'DhaniWin');assert.equal(row.source_id,'moved');
 const newid='00000000-0000-4000-8000-000000000001';await db.query('update public.newar_detail_records set id=$1 where id=$2',[newid,id]);assert.equal((await db.query('select record_id from private.newar_withdraw_facts')).rows[0].record_id,newid);
 await db.query("update public.newar_detail_records set dataset='workorder' where id=$1",[newid]);assert.equal((await db.query('select count(*) n from private.newar_withdraw_facts')).rows[0].n,0);
 await db.query("update public.newar_detail_records set dataset='withdraw' where id=$1",[newid]);assert.equal((await db.query('select count(*) n from private.newar_withdraw_facts')).rows[0].n,1);
 await db.query('delete from public.newar_detail_records where id=$1',[newid]);assert.equal((await db.query('select count(*) n from private.newar_withdraw_facts')).rows[0].n,0);
 }finally{await db.close()}
});
test('existing service-role source DML works while projection remains hidden and wrong-table trigger execution fails',async()=>{
 const db=await fixture();try{await db.exec(install);await db.exec('set role service_role');const id=await order(db,'authorized-service-write');
 await db.query("update public.newar_detail_records set status_group='pending' where id=$1",[id]);await db.exec('reset role');assert.equal((await db.query('select status_group from private.newar_withdraw_facts')).rows[0].status_group,'pending');
 await db.exec('set role service_role');await db.query('delete from public.newar_detail_records where id=$1',[id]);await db.exec('reset role');assert.equal((await db.query('select count(*) n from private.newar_withdraw_facts')).rows[0].n,0);
 await db.exec('create table public.wrong_trigger_table(id uuid,dataset text);create trigger wrong_context after insert on public.wrong_trigger_table for each row execute function private.sync_newar_withdraw_fact()');
 await assert.rejects(db.exec("insert into public.wrong_trigger_table values(gen_random_uuid(),'withdraw')"),/trigger_context_invalid/);
 for(const role of['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(order(db,'denied-'+role),/permission denied/);await db.exec('reset role')}
 }finally{await db.close()}
});
test('locked backfill preserves newer trigger rows and cutover refuses missing facts',async()=>{
 const db=await fixture();try{const id=await order(db,'before-install');await db.exec(install);
 await assert.rejects(db.exec(migration),/newar_withdraw_fact_backfill_incomplete/);await db.exec('rollback');
 await backfill(db);await db.query('update public.newar_detail_records set raw=$1::jsonb where id=$2',[JSON.stringify(raw('auto','Newer operator')),id]);await backfill(db);
 assert.equal((await db.query('select account from private.newar_withdraw_facts')).rows[0].account,'Newer operator');await db.exec(migration);assert.equal((await meta(db)).hash,'450e601fef3810bf73c438d37762dd70');
 }finally{await db.close()}
});
test('cutover refuses extra/non-withdraw and same-count stale field projections',async()=>{
 for(const kind of['extra','stale']){const db=await fixture();try{await db.exec(install);const id=await order(db,'real');
 if(kind==='extra'){const charge=await order(db,'charge','MAANWIN',raw(),{dataset:'charge'});await db.query(`insert into private.newar_withdraw_facts select $1::uuid,platform,source_id,status_group,currency,created_at,captured_at,received_at,method,account,submitted_at,handled_at from private.newar_withdraw_facts where record_id=$2`,[charge,id])}
 else await db.query("update private.newar_withdraw_facts set account='Stale operator' where record_id=$1",[id]);
 const before=await meta(db);await assert.rejects(db.exec(migration),kind==='extra'?/backfill_extra/:/backfill_mismatch/);await db.exec('rollback');assert.deepEqual(await meta(db),before);
 }finally{await db.close()}}
});
test('all 21 fields and operator rows are exactly equivalent across dates, aliases and permission intersections',async()=>{
 const db=await fixture();try{
 await order(db,'auto','MAANWIN',raw('auto','Synthetic auto'));await order(db,'manual','MAANWIN',raw(),{status_group:'failed'});await order(db,'unknown','MAANWIN',raw('robot'),{status_group:'unknown',currency:null});
 await order(db,'pending','DhaniWin',raw('manual','Another operator'),{status_group:'pending',created_at:'2026-01-09T18:30:00Z'});for(const p of['OTHER','DISABLED'])await order(db,p,p);
 await db.exec(install);await backfill(db);const rows=await compare(db,[[{}],[{platform:'MAANWIN'}],[{platforms:['MAAN.WIN','DhaniWin']}],[{scopeTargets:[{country:'印度',platforms:['DhaniWin']}]}],[{}, {targets:[['IN','MAANWIN']]}],[{platform:'MAANWIN'},{targets:[['IN','DhaniWin']]}],[{scopeTargets:[{country:'巴西',platforms:['OTHER']}]},{}],[{}, {targets:[]}]]);
 assert.ok(rows[4].every(r=>r.platform==='MAAN.WIN'));assert.deepEqual(rows[5],[]);assert.ok(rows[6].every(r=>r.country==='巴西'));assert.deepEqual(rows[7],[]);
 const r=rows[0].find(r=>r.platform==='MAAN.WIN'&&r.data_date==='2026-01-09');assert.equal(r.total,3);assert.equal(r.auto_count,1);assert.equal(r.manual_count,1);assert.equal(r.unclassified_count,1);assert.equal(r.duration_sample_count,3);assert.equal(r.currency_unknown_count,1);
 }finally{await db.close()}
});
test('zero/unknown days, range gaps, future coverage and launch boundaries remain exactly equivalent',async()=>{
 const db=await fixture();try{
 await coverage(db,'ZERO','2026-01-08T18:30:00Z','2026-01-09T06:00:00Z');await coverage(db,'ZERO','2026-01-09T06:00:00Z','2026-01-09T18:30:00Z');
 await coverage(db,'GAP','2026-01-08T18:30:00Z','2026-01-09T06:00:00Z');await coverage(db,'GAP','2026-01-09T06:00:01Z','2026-01-09T18:30:00Z');
 await coverage(db,'GAP','2026-01-08T18:30:00Z','2026-01-09T18:30:00Z',{invalidated_at:'2026-01-12T00:00:00Z'});await coverage(db,'GAP','2026-01-08T18:30:00Z','2026-01-09T18:30:00Z',{observed_at:'2099-01-01T00:00:00Z'});
 await coverage(db,'LATE','2026-01-08T18:30:00Z','2026-01-09T18:30:00Z');await order(db,'prelaunch','LATE',raw(),{created_at:'2026-01-09T02:59:59Z'});await order(db,'postlaunch','LATE',raw(),{created_at:'2026-01-09T03:00:00Z'});
 await db.exec(install);await backfill(db);const[before]=await compare(db,[[{},{},'2026-01-09','2026-01-09']]);
 const zero=before.find(r=>r.platform==='ZERO');assert.equal(zero.total,0);assert.equal(zero.complete,true);assert.deepEqual(zero.operator_rows,[]);
 const gap=before.find(r=>r.platform==='GAP');assert.equal(gap.total,null);assert.equal(gap.complete,false);const late=before.find(r=>r.platform==='LATE');assert.equal(late.total,1);assert.equal(late.complete,false);
 }finally{await db.close()}
});
test('half-open midnight, malformed/future times and zero duration retain current runtime guards',async()=>{
 const db=await fixture();try{
 for(const[t,v]of[['before','2026-01-08T18:29:59.999Z'],['start','2026-01-08T18:30:00Z'],['end','2026-01-09T18:30:00Z']])await order(db,t,'MAANWIN',raw(),{created_at:v});
 const invalids=[{sourceHandledAt:'2026-01-08T23:59:59Z'},{sourceHandledAt:'infinity'},{sourceHandledAt:'2026-02-30T00:00:00Z'},{sourceHandledAt:'2099-01-01T00:00:00Z'},{sourceSubmittedSourceField:''},{businessSchemaVersion:'1'}];
 for(let i=0;i<invalids.length;i++)await order(db,'bad-'+i,'DhaniWin',raw('manual','Synthetic operator',invalids[i]));
 await order(db,'zero-duration','DhaniWin',raw('manual','Zero operator',{sourceHandledAt:'2026-01-09T00:00:00Z'}));await order(db,'future-captured','ZERO',raw(),{captured_at:'2099-01-01T00:00:00Z'});await coverage(db,'ZERO','2026-01-08T18:30:00Z','2026-01-09T18:30:00Z');
 await db.exec(install);await backfill(db);const[before]=await compare(db,[[{},{},'2026-01-09','2026-01-09']]);assert.equal(before.find(r=>r.platform==='MAAN.WIN').total,1);assert.equal(before.find(r=>r.platform==='DhaniWin').duration_sample_count,1);assert.equal(before.find(r=>r.platform==='DhaniWin').duration_total_seconds,0);assert.equal(before.find(r=>r.platform==='ZERO').complete,false);
 assert.deepEqual(await call(db,{},{},'2026-01-10','2026-01-09'),[]);assert.deepEqual(await call(db,{},{},null,'2026-01-09'),[]);
 }finally{await db.close()}
});
test('cutover/reinstall preserve helper OID, metadata, ACL and all business after facts verbatim',async()=>{
 const db=await fixture();try{const before=await meta(db),timeout=(await db.query('show statement_timeout')).rows[0].statement_timeout;await db.exec(install);await order(db,'replay');await db.exec(migration);assert.equal((await db.query('show statement_timeout')).rows[0].statement_timeout,timeout);assert.match(migration,/set local statement_timeout='120s'/);const after=await meta(db);assert.deepEqual(after.metadata,before.metadata);assert.equal(after.hash,'450e601fef3810bf73c438d37762dd70');await db.exec(migration);await db.exec(install);assert.deepEqual(await meta(db),after);
 const src=(await db.query('select prosrc from pg_proc where oid=$1::regprocedure',[sig])).rows[0].prosrc;const old=baseline.split('AS $function$').at(-1).split('$function$')[0];assert.equal(src.slice(src.indexOf(' ), facts as materialized (')),old.slice(old.indexOf(' ), facts as materialized (')));assert.match(src,/handled_at<=statement_timestamp\(\)/);assert.match(src,/c\.observed_at<=statement_timestamp\(\)/);assert.doesNotMatch(src,/jsonb_to_record|join public\.newar_detail_records/);
 }finally{await db.close()}
});
test('definition, parser, ingest, table ACL/RLS, trigger and index drift fail closed',async()=>{
 for(const kind of['reader','parser','ingest','fact-acl','fact-rls','trigger','index','projector']){const db=await fixture();try{await db.exec(install);await order(db,'drift');
 if(kind==='reader')await db.exec(`alter function ${sig} set search_path=public`);
 if(kind==='parser')await db.exec('alter function private.newar_stats_time(text) volatile');
 if(kind==='ingest')await db.exec('alter function private.ingest_newar_detail_batch(text,jsonb) security invoker');
 if(kind==='fact-acl')await db.exec('grant select on private.newar_withdraw_facts to authenticated');
 if(kind==='fact-rls')await db.exec('alter table private.newar_withdraw_facts disable row level security');
 if(kind==='trigger')await db.exec('alter table public.newar_detail_records disable trigger newar_detail_withdraw_fact_sync');
 if(kind==='index')await db.exec('drop index private.newar_withdraw_facts_platform_created_idx;create index newar_withdraw_facts_platform_created_idx on private.newar_withdraw_facts(created_at,platform)');
 if(kind==='projector')await db.exec('alter function private.newar_withdraw_fact(public.newar_detail_records) security definer');
 const before=await meta(db);await assert.rejects(db.exec(migration),/newar_withdraw_fact_.*drift/);await db.exec('rollback');assert.deepEqual(await meta(db),before);
 }finally{await db.close()}}
});
test('AFTER projection observes final values from existing BEFORE source triggers',async()=>{
 const db=await fixture();try{await db.exec(install);const id=await order(db,'before-trigger');
 await db.exec(`create function private.synthetic_source_before() returns trigger language plpgsql set search_path='' as $$begin
 NEW.raw=jsonb_set(NEW.raw,'{operatorName}','"Final source operator"'::jsonb);NEW.status_group='rejected';return NEW;end$$;
 create trigger synthetic_before before update on public.newar_detail_records for each row execute function private.synthetic_source_before()`);
 await db.query('update public.newar_detail_records set raw=$1::jsonb where id=$2',[JSON.stringify(raw('manual','Draft source operator')),id]);
 assert.deepEqual((await db.query('select account,status_group from private.newar_withdraw_facts where record_id=$1',[id])).rows[0],{account:'Final source operator',status_group:'rejected'});
 await compare(db,[[{}]]);
 }finally{await db.close()}
});
test('same canonical key and duplicate catalog evidence keep original multiplicity and operator/currency output',async()=>{
 const db=await fixture();try{
 await db.exec(`create or replace function private.dashboard_admin_live_platforms() returns table(name text,country text,source_name text,timezone text,source text) language sql stable set search_path='' as $$
 select case platform when 'MAANWIN' then 'MAAN.WIN' else platform end,country,platform,timezone,'newar' from public.newar_detail_platforms
 union all select 'MAANWIN',country,platform,timezone,'newar' from public.newar_detail_platforms where platform='MAANWIN'$$`);
 await order(db,'multiplicity');await order(db,'decimal','MAANWIN',raw('manual','Decimal operator',{sourceHandledAt:'2026-01-09T00:00:12.000001Z'}));
 await db.exec(install);await backfill(db);const[before]=await compare(db,[[{},{},'2026-01-09','2026-01-09']]);
 const rows=before.filter(r=>r.platform_key==='MAANWIN');assert.equal(rows.length,2);for(const row of rows){assert.equal(row.total,4);assert.equal(row.manual_count,4);assert.equal(row.duration_sample_count,4);assert.deepEqual(row.currencies,['INR']);assert.equal(row.operator_rows.reduce((n,r)=>n+r.processed,0),4)}
 }finally{await db.close()}
});
function parityQuery(){const start=migration.indexOf(' with expected as materialized ('),end=migration.indexOf(';\n if proof.missing',start);assert.ok(start>0&&end>start);return migration.slice(start,end).replace(' into proof\n','\n')}
test('single snapshot parity preserves simultaneous missing/extra/mismatch flags and original error priority',async()=>{
 const db=await fixture();try{await db.exec(install);assert.deepEqual((await db.query(parityQuery())).rows[0],{missing:false,extra:false,mismatch:false});
 const missing=await order(db,'missing'),stale=await order(db,'stale'),charge=await order(db,'charge','MAANWIN',raw(),{dataset:'charge'});
 await db.query('delete from private.newar_withdraw_facts where record_id=$1',[missing]);
 await db.query(`insert into private.newar_withdraw_facts select $1::uuid,platform,source_id,status_group,currency,created_at,captured_at,received_at,method,account,submitted_at,handled_at from private.newar_withdraw_facts where record_id=$2`,[charge,stale]);
 await db.query("update private.newar_withdraw_facts set account='Stale operator' where record_id=$1",[stale]);
 assert.deepEqual((await db.query(parityQuery())).rows[0],{missing:true,extra:true,mismatch:true});
 await assert.rejects(db.exec(migration),/backfill_incomplete/);await db.exec('rollback');await backfill(db);
 assert.deepEqual((await db.query(parityQuery())).rows[0],{missing:false,extra:true,mismatch:true});
 await assert.rejects(db.exec(migration),/backfill_extra/);await db.exec('rollback');await db.query('delete from private.newar_withdraw_facts where record_id=$1',[charge]);
 await assert.rejects(db.exec(migration),/backfill_mismatch/);await db.exec('rollback');
 await db.query("update public.newar_detail_records set raw=raw where id=$1",[stale]);await db.exec("set timezone='America/Sao_Paulo'");
 assert.deepEqual((await db.query(parityQuery())).rows[0],{missing:false,extra:false,mismatch:false});await db.exec(migration);
 }finally{await db.close()}
});
test('single-pass typed parity rejects a stale value in every projected data column, including null and timestamp differences',async()=>{
 const db=await fixture();try{await db.exec(install);const id=await order(db,'column-proof');
 const changes={platform:"'DhaniWin'",source_id:"'changed-source'",status_group:"'pending'",currency:'null',created_at:"'2026-01-08T00:00:00Z'::timestamptz",captured_at:"'2026-01-11T00:00:00Z'::timestamptz",received_at:"'2026-01-11T00:00:00Z'::timestamptz",method:'null',account:"'Changed operator'",submitted_at:'null',handled_at:'null'};
 for(const[col,value]of Object.entries(changes)){
  await db.query(`update private.newar_withdraw_facts set ${col}=${value} where record_id=$1`,[id]);assert.deepEqual((await db.query(parityQuery())).rows[0],{missing:false,extra:false,mismatch:true},col);
  await db.query('update public.newar_detail_records set raw=raw where id=$1',[id]);assert.deepEqual((await db.query(parityQuery())).rows[0],{missing:false,extra:false,mismatch:false},col);
 }
 }finally{await db.close()}
});
test('inline expected rows equal the fingerprinted projector for native text coercion, nulls and timestamp precision',async()=>{
 const db=await fixture();try{await db.exec(install);
 const values=[{},raw(),raw('auto','  Native operator  '),raw('manual','',{operatorSourceField:'verified'}),raw('manual','Operator',{operatorSourceField:'   '}),
 raw('manual','Operator',{businessSchemaVersion:2,operatorSourceField:false}),raw('manual',{synthetic:'operator'}),
 raw('manual','Operator',{sourceSubmittedSourceField:' ',sourceHandledSourceField:' '}),raw('manual','Operator',{sourceHandledSourceField:null}),
 raw('manual','Operator',{sourceSubmittedAt:'2026-02-30T00:00:00Z'}),raw('manual','Operator',{sourceHandledAt:'infinity'}),
 raw('manual','Operator',{sourceHandledAt:'2026-01-09T00:00:12.000001Z'}),raw('manual','Operator',{sourceHandledAt:'2026-01-08T23:59:59Z'})];
 for(let i=0;i<values.length;i++)await order(db,'inline-'+i,'MAANWIN',values[i],i%2?{currency:null}:{});
 await order(db,'excluded-charge','MAANWIN',raw(),{dataset:'charge'});
 const expected=parityQuery().split(' select coalesce(bool_or')[0];
 const rows=(await db.query(expected+` select to_jsonb(e) expected,to_jsonb(f) projector from expected e
 join public.newar_detail_records n on n.id=e.record_id cross join lateral private.newar_withdraw_fact(n) f order by e.record_id`)).rows;
 assert.equal(rows.length,values.length);for(const row of rows)assert.deepEqual(row.expected,row.projector);
 assert.deepEqual((await db.query(parityQuery())).rows[0],{missing:false,extra:false,mismatch:false});
 assert.doesNotMatch(expected,/private\.newar_withdraw_fact\(n\)|\bn\.\*/);assert.match(expected,/jsonb_to_record/);
 }finally{await db.close()}
});
