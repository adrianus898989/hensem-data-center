// Offline PostgreSQL eligibility/parity proof using a code-only production core.
// SET LOCAL planner switches prove eligibility, not production performance/SLA.
// No cloud calls, credentials, migrations, installations or service startup.
const {test,before,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const core=fs.readFileSync(path.join(__dirname,'fixtures/admin-newar-member-daily-core.sql'),'utf8');
// Only these fixed synthetic test request literals are interpolated, never user input.
// The fixture contains production query code, not production results or identities.
const captured={results:Object.fromEntries(['MAANWIN','DhaniWin'].map(platform=>{
 const literals=["'"+platform+"'","'all'","timestamptz '2026-10-07 18:30Z'",
  "timestamptz '2026-10-08 18:30Z'","'Asia/Kolkata'","null::text[]","null::text"];
 return [platform,{sql:core.replace(/^--.*$/gm,'').replace(/\$(\d+)/g,(_,n)=>literals[Number(n)-1])}];
}))};
const review=fs.readFileSync(path.join(__dirname,'../supabase/manual/newar_member_daily_cover.sql'),'utf8');
const names=['newar_member_two_created_cover_idx','newar_member_two_success_cover_idx'];
const ddl=names.map(name=>{
 const m=review.match(new RegExp('CREATE INDEX CONCURRENTLY '+name+'[\\s\\S]*?;'));
 assert.ok(m);return m[0].replace('CREATE INDEX CONCURRENTLY','CREATE INDEX');
}).join('\n');
let db,baselines;
const requests=[];
for(const platform of ['MAANWIN','DhaniWin'])for(const direction of ['all','charge','withdraw'])for(const currency of [null,'INR','USDT']){
 let sql=captured.results[platform].sql.replaceAll("'all'::text",`'${direction}'::text`);
 if(currency){
  const old="and (null::text::text is null or currency=null::text::text)";
  assert.ok(sql.includes(old));sql=sql.replace(old,`and ('${currency}'::text is null or currency='${currency}'::text)`);
 }
 requests.push({platform,direction,currency,sql});
}
const query=async sql=>Object.values((await db.query(sql)).rows[0])[0];
function nodes(plan){return[plan,...(plan.Plans||[]).flatMap(nodes)];}
async function plan(sql){
 await db.exec('begin;set local enable_seqscan=off;set local enable_bitmapscan=off;');
 try{return (await query('explain (format json) '+sql))[0].Plan;}finally{await db.exec('rollback');}
}
before(async()=>{
 db=new PGlite();
 await db.exec(`
 create table public.newar_detail_platforms(platform text primary key,launch_at timestamptz);
 create table public.newar_detail_records(
  id bigint generated always as identity primary key,platform text,dataset text,
  member_id text,provider text,channel_type text,currency text,status_group text,
  created_at timestamptz,success_at timestamptz);
 insert into newar_detail_platforms values
 ('MAANWIN','2026-10-05T18:30:00Z'),('DhaniWin',null),('OTHER',null);
 insert into newar_detail_records(platform,dataset,member_id,provider,channel_type,currency,status_group,created_at,success_at)
 select p,k,case when n%19=0 then null when n%23=0 then '  ' else ' M'||(n%31)||' ' end,
  case when n%2=0 then 'route-a' else 'route-b' end,'BANK',case when n%5=0 then 'USDT' else 'INR' end,
  case when n%3=0 then 'success' else 'pending' end,
  timestamptz '2026-10-01 18:30Z'+(n%12)*interval '1 day'+(n%17)*interval '1 hour',
  case when n%3=0 then timestamptz '2026-10-01 18:30Z'+(n%12)*interval '1 day'+(n%17)*interval '1 hour'+interval '12 hours' end
 from unnest(array['MAANWIN','DhaniWin','OTHER']) p
 cross join unnest(array['charge','withdraw','workorder']) k cross join generate_series(1,1800)n;
 -- Targeted boundary/launch/null fixtures. None of these are real identities.
 insert into newar_detail_records(platform,dataset,member_id,provider,channel_type,currency,status_group,created_at,success_at) values
 ('MAANWIN','charge','PRE_LAUNCH','route-a','BANK','INR','success','2026-10-05 18:29:59Z','2026-10-08 00:00Z'),
 ('MAANWIN','charge','CROSS_IN','route-a','BANK','INR','success','2026-10-07 18:29:59Z','2026-10-07 18:30Z'),
 ('MAANWIN','charge','CROSS_OUT','route-b','BANK','INR','success','2026-10-08 18:29:59Z','2026-10-08 18:30Z'),
 ('MAANWIN','withdraw','REPEATED','route-a','BANK','INR','success','2026-10-08 00:00Z','2026-10-08 00:01Z'),
 ('MAANWIN','withdraw','REPEATED','route-b','BANK','INR','success','2026-10-08 06:00Z','2026-10-08 06:01Z'),
 ('DhaniWin','withdraw','NULL_CREATED','route-a','BANK',null,'success',null,'2026-10-08 01:00Z'),
 ('MAANWIN','withdraw','NULL_CREATED_DENIED','route-a','BANK','INR','success',null,'2026-10-08 01:00Z');
 analyze public.newar_detail_records;analyze public.newar_detail_platforms;
 `);
 baselines=[];for(const r of requests)baselines.push(await query(r.sql));
 await db.exec(ddl);
 await db.exec('analyze public.newar_detail_records');
});
after(()=>db?.close());

test('both covering indexes are eligible as index-only scans for all 18 unchanged captured-core scopes',async()=>{
 assert.equal(requests.length,18);
 for(const r of requests){
  const p=await plan(r.sql),scans=nodes(p).filter(n=>n['Relation Name']==='newar_detail_records');
  assert.equal(scans.length,2,JSON.stringify(r));
  for(const name of names)assert.ok(scans.some(n=>n['Index Name']===name&&n['Node Type']==='Index Only Scan'),r.platform+'/'+r.direction+'/'+r.currency+'/'+name);
  assert.ok(scans.every(n=>!n.Filter||!n.Filter.includes('provider')));
 }
});
test('indexes preserve every output field, day/direction member dedupe and separate event clocks',async()=>{
 for(let i=0;i<requests.length;i++)assert.deepEqual(await query(requests[i].sql),baselines[i],JSON.stringify(requests[i]));
 const r=requests.find(r=>r.platform==='MAANWIN'&&r.direction==='all'&&!r.currency),before=await query(r.sql);
 // A pre-launch order is excluded even when its completion is in the day.
 await db.exec("delete from newar_detail_records where member_id in ('PRE_LAUNCH','NULL_CREATED_DENIED')");
 assert.deepEqual(await query(r.sql),before);
 // A success-day event is retained when the order was created before this day.
 await db.exec("delete from newar_detail_records where member_id='CROSS_IN'");
 const after=await query(r.sql),b=before.find(x=>x.direction==='charge'),a=after.find(x=>x.direction==='charge');
 assert.equal(a.created_order_count,b.created_order_count);assert.equal(a.success_order_count,b.success_order_count-1);
 const withdraw=before.find(x=>x.direction==='withdraw');
 assert.ok(withdraw.created_members_ge2>=1);assert.ok(withdraw.created_member_count<withdraw.created_order_count);
});
test('success index keeps created_at for launch filtering and NULL-created rows retain original null-launch semantics',async()=>{
 const sql="select indexdef from pg_indexes where schemaname='public' and indexname='newar_member_two_success_cover_idx'";
 assert.match(await query(sql),/INCLUDE \(member_id, currency, created_at\)/);
 const original=captured.results.DhaniWin.sql,withNull=await query(original);
 await db.exec("delete from newar_detail_records where member_id='NULL_CREATED'");
 const without=await query(original),b=withNull.find(x=>x.direction==='withdraw'),a=without.find(x=>x.direction==='withdraw');
 assert.equal(a.created_order_count,b.created_order_count);
 assert.equal(a.success_order_count,b.success_order_count-1);
});
test('partial scope never claims unrelated platforms or workorders are covered',async()=>{
 for(const sql of [
  "select member_id,currency,created_at from newar_detail_records where platform='OTHER' and dataset='charge' and created_at>='2026-10-07 18:30Z' and created_at<'2026-10-08 18:30Z'",
  "select member_id,currency,created_at from newar_detail_records where platform='MAANWIN' and dataset='workorder' and created_at>='2026-10-07 18:30Z' and created_at<'2026-10-08 18:30Z'"
 ])assert.ok(nodes(await plan(sql)).every(n=>!names.includes(n['Index Name'])));
});
test('review DDL is concurrently scoped; eligibility forcing and nonconcurrent create remain local-only',()=>{
 assert.equal((review.match(/^CREATE INDEX CONCURRENTLY /gm)||[]).length,2);
 assert.doesNotMatch(review,/^BEGIN;|^SET |^ALTER |^UPDATE |^DELETE |^INSERT /mi);
 assert.match(review,/DROP INDEX CONCURRENTLY public.newar_member_two_created_cover_idx/);
 assert.match(review,/DROP INDEX CONCURRENTLY public.newar_member_two_success_cover_idx/);
 assert.doesNotMatch(review.replace(/^--.*$/gm,''),/enable_seqscan|enable_bitmapscan/);
});
