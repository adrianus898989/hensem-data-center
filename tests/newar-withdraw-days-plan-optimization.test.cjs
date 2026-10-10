// Synthetic native facts only; never creates production sessions or reads order identities.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const repo=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const baseline=read('tests/fixtures/newar-withdraw-days-plan-baseline.sql');
const migration=read('supabase/migrations/20261010111853_newar_withdraw_days_plan_optimization.sql');
const sig='private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)';
const meta=async db=>(await db.query("select to_jsonb(p)-'prosrc' metadata,md5(prosrc) hash from pg_proc p where oid=$1::regprocedure",[sig])).rows[0];
async function fixture(){
 const db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
 create table public.newar_detail_platforms(platform text primary key,country text,country_code text,timezone text,launch_at timestamptz,enabled boolean);
 create table public.newar_detail_records(platform text,dataset text,source_id text,status_group text,currency text,captured_at timestamptz,received_at timestamptz,created_at timestamptz,raw jsonb);
 create table private.newar_detail_coverage_runs(platform text,dataset text,effective_start_at timestamptz,end_at timestamptz,observed_at timestamptz,invalidated_at timestamptz);
 create function private.dashboard_admin_live_platforms() returns table(name text,country text,source_name text,timezone text,source text) language sql stable set search_path='' as $$
 select case platform when 'MAANWIN' then 'MAAN.WIN' else platform end,country,platform,timezone,'newar' from public.newar_detail_platforms$$;
 create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable set search_path='' as $$
 select case when s ? 'targets' then s->'targets' @> jsonb_build_array(jsonb_build_array(c,p)) else true end$$;
 create function private.dashboard_admin_live_withdraw_key(p_name text) returns text language sql immutable set search_path='' as $$
 select case upper(btrim(p_name)) when 'MAAN.WIN' then 'MAANWIN' when 'DHANI.WIN' then 'DHANIWIN' when 'SHREE.WIN' then 'SHREEWIN' when 'VEER.GAME' then 'VEERGAME' else upper(btrim(p_name)) end$$;
 create function private.newar_stats_time(p_text text) returns timestamptz language plpgsql immutable set search_path='' as $$begin
 if p_text is null or p_text !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$' then return null;end if;
 return p_text::timestamptz;exception when datetime_field_overflow or invalid_datetime_format then return null;end$$;
 insert into public.newar_detail_platforms values
 ('MAANWIN','印度','IN','Asia/Kolkata',null,true),('DhaniWin','印度','IN','Asia/Kolkata',null,true),
 ('ZERO','印度','IN','Asia/Kolkata',null,true),('GAP','印度','IN','Asia/Kolkata',null,true),
 ('LATE','印度','IN','Asia/Kolkata','2026-01-09T03:00:00Z',true),
 ('DISABLED','印度','IN','Asia/Kolkata',null,false),('OTHER','巴西','BR','America/Sao_Paulo',null,true);`);
 await db.exec(baseline);await db.exec(`revoke all on function ${sig} from public,anon,authenticated,service_role;grant usage on schema private to anon,authenticated,service_role;`);
 assert.equal((await meta(db)).hash,'6f1f1f97205482e9ec637c27693064dc');return db;
}
const request=extra=>({country:'印度',...extra});
async function call(db,extra={},scope={},a='2026-01-09',b='2026-01-10'){
 return(await db.query(`select to_jsonb(d) value from ${sig.slice(0,sig.indexOf('('))}($1::jsonb,$2::jsonb,$3::date,$4::date)d order by data_date,platform`,[JSON.stringify(request(extra)),JSON.stringify(scope),a,b])).rows.map(r=>r.value);
}
const raw=(type='manual',account='Synthetic operator',extra={})=>({businessSchemaVersion:'2',operatorSourceField:'verifiedField',operatorName:account,operatorType:type,sourceSubmittedSourceField:'created',sourceHandledSourceField:'handled',sourceSubmittedAt:'2026-01-09T00:00:00Z',sourceHandledAt:'2026-01-09T00:00:12.250Z',...extra});
async function order(db,id,platform='MAANWIN',value=raw(),extra={}){
 const r={dataset:'withdraw',status_group:'success',currency:'INR',created_at:'2026-01-09T00:00:00Z',captured_at:'2026-01-10T00:00:00Z',received_at:'2026-01-10T01:00:00Z',...extra};
 await db.query('insert into public.newar_detail_records values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[platform,r.dataset,id,r.status_group,r.currency,r.captured_at,r.received_at,r.created_at,JSON.stringify(value)]);
}
async function coverage(db,platform,start,end,extra={}){
 await db.query('insert into private.newar_detail_coverage_runs values($1,$2,$3,$4,$5,$6)',[platform,extra.dataset||'withdraw',start,end,extra.observed_at||'2026-01-11T00:00:00Z',extra.invalidated_at||null]);
}
async function compare(db,queries){
 const before=[];for(const q of queries)before.push(await call(db,...q));await db.exec(migration);
 for(let i=0;i<queries.length;i++)assert.deepEqual(await call(db,...queries[i]),before[i]);return before;
}
test('all platform/day and operator fields survive exactly across source classification, timestamps and currencies',async()=>{
 const db=await fixture();try{
  await order(db,'auto','MAANWIN',raw('auto','Synthetic auto'));
  await order(db,'manual','MAANWIN',raw(),{status_group:'failed'});
  await order(db,'unknown','MAANWIN',raw('robot','Ignored'),{status_group:'future-status',currency:null});
  await order(db,'pending','DhaniWin',raw('manual','Another operator'),{status_group:'pending',created_at:'2026-01-09T18:30:00Z'});
  await order(db,'scalar','DhaniWin',['not an object'],{status_group:'rejected',currency:''});
  const before=await compare(db,[[{}],[{platform:'MAANWIN'}],[{platforms:['MAAN.WIN','DhaniWin']}],[{scopeTargets:[{country:'印度',platforms:['DhaniWin']}]}]]);
  const row=before[0].find(r=>r.platform==='MAAN.WIN'&&r.data_date==='2026-01-09');
  assert.equal(row.total,3);assert.equal(row.auto_count,1);assert.equal(row.manual_count,1);assert.equal(row.unclassified_count,1);assert.equal(row.unknown_count,1);assert.equal(row.duration_sample_count,3);assert.equal(row.currency_unknown_count,1);
  assert.equal(row.operator_rows.reduce((sum,r)=>sum+Number(r.processed),0),2);
 }finally{await db.close()}
});
test('zero observations remain unknown unless exact whole-day coverage is proven; gaps and invalidated/future evidence remain incomplete',async()=>{
 const db=await fixture();try{
  await coverage(db,'ZERO','2026-01-08T18:30:00Z','2026-01-09T06:00:00Z');await coverage(db,'ZERO','2026-01-09T06:00:00Z','2026-01-09T18:30:00Z');
  await coverage(db,'GAP','2026-01-08T18:30:00Z','2026-01-09T06:00:00Z');await coverage(db,'GAP','2026-01-09T06:00:01Z','2026-01-09T18:30:00Z');
  await coverage(db,'GAP','2026-01-08T18:30:00Z','2026-01-09T18:30:00Z',{invalidated_at:'2026-01-12T00:00:00Z'});
  await coverage(db,'GAP','2026-01-08T18:30:00Z','2026-01-09T18:30:00Z',{observed_at:'2099-01-01T00:00:00Z'});
  await coverage(db,'MAANWIN','2026-01-08T18:30:00Z','2026-01-09T18:30:00Z',{dataset:'deposit'});
  const [before]=await compare(db,[[{}, {},'2026-01-09','2026-01-09']]);
  const zero=before.find(r=>r.platform==='ZERO'),gap=before.find(r=>r.platform==='GAP'),unknown=before.find(r=>r.platform==='MAAN.WIN');
  assert.equal(zero.complete,true);assert.equal(zero.total,0);assert.equal(zero.auto_count,0);assert.deepEqual(zero.operator_rows,[]);
  for(const r of[gap,unknown]){assert.equal(r.complete,false);assert.equal(r.total,null);assert.equal(r.auto_count,null);assert.equal(r.duration_sample_count,0);assert.equal(r.avg_seconds,null)}
 }finally{await db.close()}
});
test('Indian midnight, half-open windows, launch limits and invalid/future durations keep their native semantics',async()=>{
 const db=await fixture();try{
  await order(db,'before','MAANWIN',raw(),{created_at:'2026-01-08T18:29:59.999Z'});
  await order(db,'start','MAANWIN',raw(),{created_at:'2026-01-08T18:30:00Z'});
  await order(db,'end','MAANWIN',raw(),{created_at:'2026-01-09T18:30:00Z'});
  const invalids=[{sourceHandledAt:'2026-01-08T23:59:59Z'},{sourceHandledAt:'infinity'},{sourceHandledAt:'2026-02-30T00:00:00Z'},{sourceHandledAt:'2099-01-01T00:00:00Z'},{sourceSubmittedSourceField:''},{businessSchemaVersion:'1'}];
  for(let i=0;i<invalids.length;i++)await order(db,'bad-'+i,'DhaniWin',raw('manual','Synthetic operator',invalids[i]));
  await order(db,'prelaunch','LATE',raw(),{created_at:'2026-01-09T02:59:59Z'});await order(db,'postlaunch','LATE',raw(),{created_at:'2026-01-09T03:00:00Z'});
  await coverage(db,'LATE','2026-01-08T18:30:00Z','2026-01-09T18:30:00Z');
  const [before]=await compare(db,[[{}, {},'2026-01-09','2026-01-09']]);
  assert.equal(before.find(r=>r.platform==='MAAN.WIN').total,1);assert.equal(before.find(r=>r.platform==='DhaniWin').duration_sample_count,0);assert.equal(before.find(r=>r.platform==='LATE').total,1);assert.equal(before.find(r=>r.platform==='LATE').complete,false);
 }finally{await db.close()}
});
test('country, platform, disabled configuration and request/scope intersections remain enforced',async()=>{
 const db=await fixture();try{
  for(const p of['MAANWIN','DhaniWin','OTHER','DISABLED'])await order(db,p,p);
  const before=await compare(db,[[{}, {targets:[['IN','MAANWIN']]}],[{platform:'MAANWIN'}, {targets:[['IN','DhaniWin']]}],[{scopeTargets:[{country:'巴西',platforms:['OTHER']}]}, {}],[{}, {targets:[]}]]);
  assert.ok(before[0].every(r=>r.platform==='MAAN.WIN'));assert.deepEqual(before[1],[]);assert.ok(before[2].every(r=>r.country==='巴西'));assert.deepEqual(before[3],[]);
  assert.deepEqual(await call(db,{}, {},'2026-01-10','2026-01-09'),[]);assert.deepEqual(await call(db,{}, {},null,'2026-01-09'),[]);
 }finally{await db.close()}
});
test('helper OID, all metadata/ACL and replay are unchanged; no new privilege or production object is added',async()=>{
 const db=await fixture();try{
  const before=await meta(db);await db.exec(migration);const after=await meta(db);assert.deepEqual(after.metadata,before.metadata);assert.equal(after.hash,'47fe6d24232211930ea6c0aae3e2ea11');await db.exec(migration);assert.deepEqual(await meta(db),after);
  const privileges=(await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service_role",[sig])).rows[0];assert.deepEqual(privileges,{anon:false,authenticated:false,service_role:false});
  assert.doesNotMatch(migration,/\b(?:create table|alter table|create index|insert into|delete from|grant execute)\b/i);
 }finally{await db.close()}
});
test('unknown body, ACL, configuration and ownership drift fail closed without changing the helper',async()=>{
 for(const drift of['body','acl','config','owner']){const db=await fixture();try{
  if(drift==='body')await db.exec(baseline.replace(' with sites as materialized (',' -- unreviewed drift\n with sites as materialized ('));
  if(drift==='acl')await db.exec('grant execute on function '+sig+' to anon');
  if(drift==='config')await db.exec('alter function '+sig+' set search_path=public');
  if(drift==='owner')await db.exec('create role unexpected_owner;alter function '+sig+' owner to unexpected_owner');
  const before=await meta(db);await assert.rejects(db.exec(migration),/newar_withdraw_plan_(metadata|definition)_drift/);await db.exec('rollback');assert.deepEqual(await meta(db),before);
 }finally{await db.close()}}
});
