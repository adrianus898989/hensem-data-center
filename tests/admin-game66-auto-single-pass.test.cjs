// Same frozen semantic fixtures, plus guarded production-shape deployment cases.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,seed,read,meta,id,signature,baseline,candidate,migration,repo}=require('./fixtures/game66-auto-single-pass-harness.cjs');
test('daily and operator JSON remain exactly equal with display merging, raw scopes, all statuses, clock priorities and local-day boundaries',async()=>{
 const db=await fixture();try{
  await seed(db);const inputs=[['香港',null],['红膏蟹',null],['未来国',null],[' ',null],['香港',['DHANIWIN']],['香港',[]],['香港',['SAME']],['missing',null],[null,null]];
  const old=[];for(const q of inputs)old.push(await read(db,...q));
  await db.exec(candidate);
  for(let i=0;i<inputs.length;i++)assert.deepEqual(await read(db,...inputs[i]),old[i]);
  const hk=old[0],same=hk.rows.find(x=>x.platform==='SAME'&&x.country_code==='HK_TEAM'&&x.data_date==='2026-10-01');
  assert.equal(same.total,8);assert.equal(same.auto_count,2);assert.equal(same.manual_count,6);
  assert.equal(same.success,4);assert.equal(same.rejected,1);assert.equal(same.raw.payout_failed_count,1);
  assert.equal(hk.rows.filter(x=>x.platform==='SAME'&&x.country_code==='HK_TEAM'&&x.data_date==='2026-10-01').length,1,'different IDs and raw names merge at the same display grouping');
  assert(hk.operatorRows.some(x=>x.account==='Alice'&&x.processed===2&&x.rejected===1));
  assert(hk.operatorRows.some(x=>x.account==='自动审核'&&x.processed===3),'a manual account named 自动审核 keeps the existing merge and raw operator_source semantics');
  assert.equal(Date.parse(hk.latestWriteAt),Date.parse('2026-10-04T00:00:00Z'),'source latest prefers last_seen_at over processing-clock priority');
  assert.deepEqual(old[5],{ok:true,rows:[],operatorRows:[],latestWriteAt:null});
 }finally{await db.close()}
});
test('fresh authorization and exact untrimmed platform scope are preserved without expanding country/team access',async()=>{
 const db=await fixture();try{
  await seed(db);const scopes=[[{country:'HK_TEAM',platform:'SAME'}],[{country:'HK_TEAM',platform:' SAME '}],[{country:'RED_CRAB',platform:'SAME'}],[],[{country:'IN',platform:'SAME'}]],before=[];
  for(const scope of scopes){await db.query("select set_config('test.scope',$1,false)",[JSON.stringify(scope)]);before.push(await read(db))}
  await db.exec(candidate);for(let i=0;i<scopes.length;i++){await db.query("select set_config('test.scope',$1,false)",[JSON.stringify(scopes[i])]);assert.deepEqual(await read(db),before[i])}
  assert.equal(before[0].rows[0].total,6);assert.equal(before[1].rows[0].total,2);assert.equal(before[2].rows[0].country_code,'RED_CRAB');assert.equal(before[3].rows.length,0);assert.equal(before[4].rows.length,0);
  await db.exec("select set_config('test.denied','yes',false)");await assert.rejects(read(db),/synthetic_scope_denied/);
  assert.equal((candidate.match(/private\.dashboard_admin_live_scope\(\)/g)||[]).length,2);
 }finally{await db.close()}
});
test('OID/function metadata, private ACL and RLS are preserved; unauthorized direct calls stay rejected',async()=>{
 const db=await fixture();try{
  const before=await meta(db);await db.exec(candidate);const after=await meta(db);assert.deepEqual(after.metadata,before.metadata);assert.notEqual(after.md5,before.md5);
  for(const role of ['anon','authenticated','service_role']){assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,signature])).rows[0].allowed,false);await db.exec('set role '+role);await assert.rejects(read(db),/permission denied/);await db.exec('reset role')}
  assert((await db.query("select relrowsecurity from pg_class where oid in('public.game66_platforms'::regclass,'public.game66_withdraw_orders'::regclass)")).rows.every(x=>x.relrowsecurity));
 }finally{await db.close()}
});
test('empty sources and invalid dates preserve null/array semantics and exact validation SQLSTATE',async()=>{
 const db=await fixture();try{
  const old=await read(db);assert.deepEqual(old,{ok:true,rows:[],operatorRows:[],latestWriteAt:null});await db.exec(candidate);assert.deepEqual(await read(db),old);
  for(const q of [[null,'2026-10-01'],['2026-10-02','2026-10-01'],['2025-01-01','2026-10-01']])await assert.rejects(read(db,'香港',null,...q),e=>e.code==='22023'&&e.message==='GAME66_INVALID_DATE_RANGE');
 }finally{await db.close()}
});
test('duplicate-heavy multi-day data retains exact numeric AVG rather than average-of-averages',async()=>{
 const db=await fixture();try{
  await seed(db);await db.exec(`insert into game66_withdraw_orders
   select '${id(1)}',timestamptz '2026-10-01T00:00Z'+n*interval '13 seconds',
    (array['1','3','-1','2',null,'future'])[1+n%6],
    (array['2','1',null,''])[1+n%4],
    (array['Alice','Bob',null,' '])[1+n%4],null,null,
    timestamptz '2026-10-01T00:00Z'+n*interval '13 seconds'+(n%17)*interval '0.000001 seconds',null,null
   from generate_series(1,4000)n`);
  const old=await read(db);await db.exec(candidate);assert.deepEqual(await read(db),old);
  const daily=old.rows.find(x=>x.platform==='SAME'&&x.country_code==='HK_TEAM'&&x.data_date==='2026-10-01');assert(daily.total>1000);
  const detail=old.operatorRows.filter(x=>x.platform==='SAME'&&x.country_code==='HK_TEAM'&&x.data_date===daily.data_date);
  assert.equal(detail.reduce((sum,x)=>sum+x.processed,0),daily.total);
 }finally{await db.close()}
});
test('one source fact path uses a parameterized platform/time index and computes both aggregate levels from it',async()=>{
 const db=await fixture();try{
  await db.exec(`insert into game66_platforms select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'hong_kong','香港','P'||n,'P'||n from generate_series(1,35)n;
   insert into game66_withdraw_orders select p.id,timestamptz '2026-09-15Z'+n*interval '1 minute','3','2',null,null,null,null,null,timestamptz '2026-10-02Z' from game66_platforms p cross join generate_series(1,3000)n;
   insert into game66_withdraw_orders select p.id,timestamptz '2026-10-01Z'+n*interval '1 minute','3','2',null,null,null,null,null,timestamptz '2026-10-02Z' from game66_platforms p cross join generate_series(1,30)n;
   analyze game66_platforms;analyze game66_withdraw_orders;`);
  await db.exec(candidate);const query=candidate.slice(candidate.indexOf('  with allowed_platforms'),candidate.indexOf('\n  v_latest := greatest'))
   .replace(/\bv_scope\b/g,"'null'::jsonb").replace(/\bp_country\b/g,'$1::text').replace(/\bp_platforms\b/g,'$2::text[]')
   .replace(/\bv_start_at\b/g,'$3::timestamptz').replace(/\bv_end_at\b/g,'$4::timestamptz')
   .replace('  into v_rows,v_latest,v_operator_rows,v_operator_latest\n','');
  const plan=(await db.query('explain(analyze,buffers,format json) '+query,['香港',['P1'],'2026-09-30T18:30Z','2026-10-02T18:30Z'])).rows[0]['QUERY PLAN'][0];
  const nodes=[];function walk(n){nodes.push(n);for(const p of n.Plans||[])walk(p)}walk(plan.Plan);
  const facts=nodes.filter(n=>n['Relation Name']==='game66_withdraw_orders');assert.equal(facts.length,1);
  assert(['Index Scan','Bitmap Heap Scan'].includes(facts[0]['Node Type']));
  const index=nodes.find(n=>n['Index Name']==='game66_withdraw_orders_platform_time_idx');assert(index);
  assert.match(index['Index Cond'],/platform_id = p(?:_\d+)?\.id/);assert.match(index['Index Cond'],/create_time >=/);assert.match(index['Index Cond'],/create_time </);
  assert.equal(facts[0]['Actual Loops'],1);assert.equal(facts[0]['Actual Rows'],30);
  assert.equal(nodes.find(n=>n['Subplan Name']==='CTE source_stats')['Actual Rows'],2);
  // Physical source plan is synthetic; production may select another valid index.
 }finally{await db.close()}
});

test('guarded migration preserves all JSON and complete function metadata, using only the existing verified index',async()=>{
 const db=await fixture();try{
  await seed(db);const before=await read(db),metadata=await meta(db);
  assert.equal(metadata.md5,'779033b18df07a6e6b59c7f5770ba083');
  assert.equal((await db.query('select md5(pg_get_functiondef($1::regprocedure)) md5',[signature])).rows[0].md5,'eb50e5bd5d588fc2bd4477dd22389ae4');
  const indexes=async()=>(await db.query("select pg_get_indexdef(indexrelid) definition from pg_index where indrelid='public.game66_withdraw_orders'::regclass order by indexrelid")).rows;
  const oldIndexes=await indexes();await db.exec(migration);
  assert.deepEqual(await read(db),before);assert.deepEqual((await meta(db)).metadata,metadata.metadata);
  assert.equal((await meta(db)).md5,'df9722109e2b1443531c017a3bcf7d5f');assert.deepEqual(await indexes(),oldIndexes);
  const statements=migration.replace(/'(?:''|[^'])*'/g,"''").replace(/--[^\n]*/g,'');
  assert.doesNotMatch(statements,/\b(?:create\s+(?:table|index)|alter\s+table|grant\s+|revoke\s+|insert\s+into|update\s+public|delete\s+from)\b/i);
  assert.match(migration,/set local lock_timeout='2s'/);assert.match(migration,/set local statement_timeout='10s'/);
  const source=fs.readFileSync(path.join(repo,'supabase/admin-live-withdraw-pages.sql'),'utf8');
  const start=source.search(/create\s+or\s+replace\s+function\s+private\.dashboard_admin_live_game66_withdraw\s*\(/i),end=source.indexOf('revoke all on function private.dashboard_admin_live_game66_withdraw(',start);
  assert(start>=0&&end>start,'canonical private reader must have bounded extraction');
  const normalized=s=>s.trim().replace(/^create\s+or\s+replace\s+function/i,'CREATE OR REPLACE FUNCTION');
  assert.equal(normalized(source.slice(start,end)),normalized(candidate),'canonical helper is the same reviewed definition');
 }finally{await db.close()}
});

test('body/definition/metadata/ACL drift stops before replacing the private reader',async()=>{
 for(const change of [
  "alter function private.dashboard_admin_live_game66_withdraw(date,date,text,text[]) cost 101",
  "alter function private.dashboard_admin_live_game66_withdraw(date,date,text,text[]) security invoker",
  "alter function private.dashboard_admin_live_game66_withdraw(date,date,text,text[]) set search_path=public",
  "grant execute on function private.dashboard_admin_live_game66_withdraw(date,date,text,text[]) to authenticated",
  "grant execute on function private.dashboard_admin_live_game66_withdraw(date,date,text,text[]) to service_role",
  baseline.replace('  v_scope jsonb;','  v_scope jsonb; -- unrelated body drift'),
  `drop function ${signature};${baseline}`
 ]){
  const db=await fixture();try{
   await db.exec(change);const before=await meta(db);
   await assert.rejects(db.exec(migration),/game66_auto_single_pass_(body|metadata)_drift/);await db.exec('rollback');
   assert.deepEqual(await meta(db),before,'a guard rejection must leave the preexisting reader and ACL unchanged');
  }finally{await db.close()}
 }
});

test('source schema/RLS and missing, reversed or partial indexes fail closed before body changes',async()=>{
 for(const change of [
  'alter table public.game66_platforms disable row level security',
  'alter table public.game66_withdraw_orders force row level security',
  'alter table public.game66_withdraw_orders rename column audit_admin to wrong_name',
  'alter table public.game66_withdraw_orders alter column auto_commit type varchar(20)',
  'drop index public.game66_withdraw_orders_platform_time_idx',
  'drop index public.game66_withdraw_orders_platform_time_idx;create index game66_withdraw_orders_platform_time_idx on public.game66_withdraw_orders(create_time,platform_id)',
  "drop index public.game66_withdraw_orders_platform_time_idx;create index game66_withdraw_orders_platform_time_idx on public.game66_withdraw_orders(platform_id,create_time desc) where status_code='3'",
  "update pg_index set indisvalid=false where indexrelid='public.game66_withdraw_orders_platform_time_idx'::regclass",
  "update pg_index set indisready=false where indexrelid='public.game66_withdraw_orders_platform_time_idx'::regclass"
 ]){
  const db=await fixture();try{
   await db.exec(change);await assert.rejects(db.exec(migration),/game66_auto_single_pass_(relation|column|index)_drift/);await db.exec('rollback');
   assert.equal((await meta(db)).md5,'779033b18df07a6e6b59c7f5770ba083');
  }finally{await db.close()}
 }
});
