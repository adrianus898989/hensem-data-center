// Real PostgreSQL claim/completion state machines, synthetic platform and totals.
// PGlite has one backend: committed claim interleavings are real; the separate
// heavy-lock test injects only the failed lock primitive into a copied runner.
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {setup}=require('./fixtures/provider-snapshot-retention/baseline-harness.cjs');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
let db,target,oldToken,beforeInstallToken,beforeWorkerMetadata;
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0];
const q=(day=10,direction='charge')=>({action:'aggregate',view:'providers',platformId:target.id,startAt:`2026-10-${String(day).padStart(2,'0')}T00:00:00+05:30`,endAt:`2026-10-${String(day+1).padStart(2,'0')}T00:00:00+05:30`,direction,status:'all',currency:'INR',offset:0,limit:20});
function payload(request){return{version:1,platform:{id:target.id,source:target.source,sourceName:target.source_name,scopeGroup:target.scope_group,country:target.country,currency:target.currency,timezone:target.timezone},startAt:request.startAt,endAt:request.endAt,successStartAt:request.startAt,successEndAt:request.endAt,successBasis:'success',asOf:new Date().toISOString(),rows:[],summary:[{direction:'charge',currency:'INR',all_count:3,all_amount:'12.345',success_count:2,success_amount:'8.125'}],groups:{provider:[]},total:3,hasMore:false};}
async function enqueue(kind,day=10){const request=q(day,kind==='provider'?'charge':'all');return scalar(kind==='provider'?"select private.provider_snapshot_enqueue($1,$2,'orders')":"select private.prepared_aggregate_enqueue($2,$1,private.prepared_aggregate_dependency($1))",[JSON.stringify(target),JSON.stringify(request)]);}
async function claim(kind){await db.exec("begin isolation level read committed;set local statement_timeout='3s'");try{const c=await scalar(`select private.${kind==='provider'?'provider_snapshot':'prepared_aggregate'}_prepare_claim('cross-worker')`);await db.exec('commit');return c;}catch(e){await db.exec('rollback');throw e;}}
async function complete(kind,c){const table=kind==='provider'?'provider_snapshot':'prepared_aggregate',request=await scalar(`select request from private.${table}_jobs where id=$1`,[c.jobId]);const p=payload(request);if(kind==='provider')return scalar('select private.provider_snapshot_complete($1,$2,$3,$4,$5)',[c.jobId,c.runId,c.fence,JSON.stringify(p),JSON.stringify({computationComplete:true,upstreamComplete:false,sourceWatermark:{kind:'synthetic'},sourceReadStartedAt:p.asOf,sourceReadCompletedAt:p.asOf})]);return scalar('select private.prepared_aggregate_complete($1,$2,$3,$4)',[c.jobId,c.runId,c.fence,JSON.stringify(p)]);}
const state=(kind,id)=>scalar(`select to_jsonb(j)from private.${kind==='provider'?'provider_snapshot':'prepared_aggregate'}_jobs j where id=$1`,[id]);
const heads=()=>scalar("select coalesce(jsonb_agg(jsonb_build_object('head',to_jsonb(h),'artifact',to_jsonb(a))order by h.job_id),'[]')from private.provider_snapshot_heads h join private.provider_snapshot_artifacts a on a.id=h.snapshot_id");
const allHeads=async()=>({provider:await heads(),prepared:await scalar("select coalesce(jsonb_agg(jsonb_build_object('head',to_jsonb(h),'artifact',to_jsonb(a))order by h.job_id),'[]')from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a on a.id=h.artifact_id")});
before(async()=>{
 db=await setup();
 for(const filename of ['20260930225000_duration_precision_ranges.sql','20260928092956_admin_live_dynamic_amount_bands.sql']){const sql=read('supabase/migrations/'+filename);await db.exec(sql.slice(sql.indexOf('create or replace function'),sql.indexOf('revoke all')));}
 await db.exec("insert into public.ar_config_targets values('AR','IN','CROSS_WORKER','INR','印度','Asia/Kolkata');insert into public.dashboard_platform_team_map values('AR','IN','CROSS_WORKER','CROSS_WORKER','M8','IN','印度',true);insert into private.test_native_catalog select *from private.provider_snapshot_native_catalog()where source='ar'");
 target=await scalar('select to_jsonb(p)from private.test_native_catalog p limit 1');
 await scalar('select private.provider_snapshot_register_target($1)',[JSON.stringify(target)]);
 beforeInstallToken=await scalar('select private.provider_snapshot_dependency_token($1)',[JSON.stringify(target)]);
 beforeWorkerMetadata=await scalar("select jsonb_object_agg(proname,to_jsonb(p)-'prosrc')from pg_proc p where oid in('private.provider_snapshot_claim(text,integer)'::regprocedure,'private.provider_snapshot_run_claimed(text)'::regprocedure)");
 await db.exec(read('supabase/migrations/20261015141000_exact_prepared_aggregates.sql'));
 // Only source discovery is synthetic; authorization, clocks, queues, worker
 // identities, fences, durable claims and complete() bodies remain installed.
 await db.exec("create or replace function private.prepared_aggregate_native_catalog()returns table(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text)language sql stable set search_path=''as $$select *from private.test_native_catalog$$;");
 oldToken=await scalar('select private.provider_snapshot_dependency_token($1)',[JSON.stringify(target)]);
});
after(()=>db?.close());
beforeEach(async()=>{await db.exec("reset role;truncate private.provider_snapshot_heads,private.provider_snapshot_artifacts,private.provider_snapshot_cohort_jobs,private.provider_snapshot_cohorts,private.provider_snapshot_jobs,private.prepared_aggregate_heads,private.prepared_aggregate_artifacts,private.prepared_aggregate_jobs;update private.prepared_aggregate_worker_turn set next_kind=null,waiting_since=null;select set_config('provider_snapshot.claim','',false),set_config('prepared_aggregate.claim','',false)");});

test('scheduler installation preserves current provider dependency and superseded completion handling',async()=>{
 assert.equal(oldToken,beforeInstallToken,'all existing provider heads keep their semantic dependency');
 assert.equal(await scalar('select private.provider_snapshot_kernel_contract_current()'),true);
 assert.deepEqual(await scalar("select jsonb_object_agg(proname,to_jsonb(p)-'prosrc')from pg_proc p where oid in('private.provider_snapshot_claim(text,integer)'::regprocedure,'private.provider_snapshot_run_claimed(text)'::regprocedure)"),beforeWorkerMetadata,'old worker ACL, owner, invoker, volatility and settings stay exact');
 const body=await scalar("select prosrc from pg_proc where oid='private.provider_snapshot_run_claimed(text)'::regprocedure");
 assert.match(body,/private\.provider_snapshot_fail\(j\.id,j\.run_id,j\.fence,'dependency_changed'\)/);
 assert.match(body,/kernel_contract_changed/);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("select has_function_privilege($1,'private.prepared_aggregate_take_turn(text)','EXECUTE')",[role]),false);
});

test('either committed claim blocks the other lane without consuming its attempt or changing last-good heads',async()=>{
 for(const first of ['provider','prepared']){
  await db.exec("truncate private.provider_snapshot_heads,private.provider_snapshot_artifacts,private.provider_snapshot_cohort_jobs,private.provider_snapshot_jobs,private.prepared_aggregate_heads,private.prepared_aggregate_artifacts,private.prepared_aggregate_jobs;update private.prepared_aggregate_worker_turn set next_kind=null,waiting_since=null");
  await enqueue('provider',7);const warm=await claim('provider');assert.equal((await complete('provider',warm)).published,true);const old=await heads();
  const ids={provider:await enqueue('provider',10),prepared:await enqueue('prepared',10)};
  await db.query('update private.prepared_aggregate_worker_turn set next_kind=$1,waiting_since=null',[first]);
  const c=await claim(first);assert.ok(c);const other=first==='provider'?'prepared':'provider';const waiting=await state(other,ids[other]);
  assert.equal(await claim(other),null);assert.deepEqual(await state(other,ids[other]),waiting);assert.deepEqual(await heads(),old);
  assert.equal((await complete(first,c)).published,true);const next=await claim(other);assert.ok(next);assert.equal((await state(other,next.jobId)).attempts,1);assert.equal((await complete(other,next)).published,true);
 }
});

test('both populated queues alternate even when one scheduler always polls first',async()=>{
 for(const [index,first]of ['provider','prepared'].entries()){
  for(let day=8+index*3;day<11+index*3;day++){await enqueue('provider',day);await enqueue('prepared',day);}
  await db.query('update private.prepared_aggregate_worker_turn set next_kind=$1,waiting_since=null',[first]);
  const order=[];
  for(let n=0;n<6;n++){
   let c=await claim('provider'),kind='provider';if(!c){kind='prepared';c=await claim(kind);}assert.ok(c,'a runnable queue must advance');
   const other=kind==='provider'?'prepared':'provider';assert.equal(await claim(other),null,'only one committed lease across both queues');
   order.push(kind);assert.equal((await complete(kind,c)).published,true);
  }
  const second=first==='provider'?'prepared':'provider';assert.deepEqual(order,[first,second,first,second,first,second]);
 }
 assert.equal(await scalar("select count(*)from private.provider_snapshot_jobs where status='ready'"),6);
 assert.equal(await scalar("select count(*)from private.prepared_aggregate_jobs where status='ready'"),6);
});

test('an unavailable scheduler yields its turn after the bounded grace period',async()=>{
 await enqueue('provider');await enqueue('prepared');
 await db.exec("update private.prepared_aggregate_worker_turn set next_kind='prepared',waiting_since=null");
 assert.equal(await claim('provider'),null);assert.equal(await scalar('select waiting_since is not null from private.prepared_aggregate_worker_turn'),true);
 await db.exec("update private.prepared_aggregate_worker_turn set waiting_since=clock_timestamp()-interval'4seconds'");
 const c=await claim('provider');assert.ok(c);assert.equal((await complete('provider',c)).published,true);
 assert.ok(await claim('prepared'),'healthy prepared queue still receives the next turn');
});

async function busyRunner(kind){
 const prefix=kind==='provider'?'provider_snapshot':'prepared_aggregate',sig=`private.${prefix}_run_claimed(text)`;
 let definition=await scalar('select pg_get_functiondef($1::regprocedure)',[sig]);
 const primitive="if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))then";
 assert.equal(definition.split(primitive).length,2,'inject only one heavy-lock result');
 definition=definition.replace(`FUNCTION private.${prefix}_run_claimed(`,`FUNCTION private.test_busy_${kind}_run(`).replace(primitive,'if true then');await db.exec(definition);
 await db.exec("set statement_timeout='50s'");return scalar(`select private.test_busy_${kind}_run('cross-worker')`);
}

test('heavy-lock contention returns every attempt, preserves old heads, and permits more than three later claims',async()=>{
 await enqueue('provider',7);const warm=await claim('provider');assert.equal((await complete('provider',warm)).published,true);
 for(const kind of ['provider','prepared']){
  const id=await enqueue(kind),seed=await claim(kind);assert.ok(seed);assert.equal((await complete(kind,seed)).published,true);
  if(kind==='provider')await scalar('select private.provider_snapshot_requeue($1)',[id]);else await db.query("update private.prepared_aggregate_jobs set status='queued'where id=$1",[id]);
  const old=await allHeads(),table=kind==='provider'?'provider_snapshot':'prepared_aggregate';
  for(let n=0;n<4;n++){
   await db.query(`update private.${table}_jobs set not_before=clock_timestamp()where id=$1`,[id]);
   const c=await claim(kind);assert.ok(c);assert.equal((await state(kind,id)).attempts,1);
   assert.equal((await busyRunner(kind)).status,'busy');const s=await state(kind,id);
   assert.equal(s.status,'queued');assert.equal(s.attempts,0);assert.equal(s.lease_until,null);assert.equal(s.worker,null);
   assert.equal(s[kind==='provider'?'claim_backend_pid':'claim_pid'],null);assert.deepEqual(await allHeads(),old);
   assert.equal(await scalar(`select nullif(current_setting('${table==='provider_snapshot'?'provider_snapshot':'prepared_aggregate'}.claim',true),'')is null`),true);
   assert.equal((await busyRunner(kind)).status,'idle','replaying the released session claim cannot refund twice');assert.deepEqual(await state(kind,id),s);
   assert.equal(await claim(kind),null,'one-second contention backoff prevents a tight retry');
  }
  await db.query(`update private.${table}_jobs set not_before=clock_timestamp()where id=$1`,[id]);const c=await claim(kind);assert.ok(c);assert.equal((await complete(kind,c)).published,true);
 }
});

test('a late busy response cannot refund or requeue a newer fence',async()=>{
 for(const kind of ['provider','prepared']){
  const id=await enqueue(kind),c=await claim(kind);assert.ok(c);const table=kind==='provider'?'provider_snapshot':'prepared_aggregate';
  await db.query(`update private.${table}_jobs set fence=fence+1 where id=$1`,[id]);const newer=await state(kind,id);
  assert.equal((await busyRunner(kind)).status,kind==='provider'?'busy':'obsolete');assert.deepEqual(await state(kind,id),newer);
  // End the synthetic superseding worker before checking the opposite lane.
  await db.query(`update private.${table}_jobs set status='ready',lease_until=null where id=$1`,[id]);
 }
});
