// Actual snapshot protocol and frozen SQL with synthetic 18-platform data only.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const {prepare,promote}=require('../scripts/ops/build-yash-channel-release.cjs');
const {patch}=require('../scripts/ops/build-yash-stage-refresh-patch.cjs');
const installedHelpers=JSON.parse(read('tests/fixtures/yash-channel-shadow-installed-refresh.json'));
const production=JSON.parse(read('tests/fixtures/yash-channel-production-functions.json'));
const scale=Number(process.env.YASH_RELEASE_SCALE||90),expectedJobs=[90,1584,2192].includes(scale)?scale:90,expectedRecomputed=expectedJobs===2192?73:expectedJobs>90?53:3;
function fn(source,name){const start=source.search(new RegExp('create(?: or replace)? function private\\.'+name+'\\(','i'));assert(start>=0,name);const tail=source.slice(start),m=tail.match(/as\s+(\$[a-z_]*\$)/i);const end=tail.indexOf(m[1]+';',m.index+m[0].length);return tail.slice(0,end+m[1].length+1);}
let db,batch,targets,cohort;const unchanged=new Map();
const value=async(q,p=[])=>(await db.query(q,p)).rows[0].value;
const heads=()=>db.query('select *from private.provider_snapshot_heads order by job_id').then(r=>r.rows);
async function installProduction(){await db.exec('set check_function_bodies=off;create table private.dashboard_submission_streak_jobs(id text,platform_id uuid,expires_at timestamptz)');for(const x of production){await db.exec(x.definition);await db.exec('revoke all on function '+x.signature+' from public,anon,authenticated,service_role;'+(x.metadata.proacl.includes('authenticated=X/postgres')?'grant execute on function '+x.signature+' to authenticated;':''));}}
async function seedCohort(){
 targets=(await db.query("select to_jsonb(t) value from private.provider_snapshot_native_catalog()t order by id")).rows.map(x=>x.value);assert.equal(targets.length,18);
 for(const t of targets)await value('select private.provider_snapshot_register_target($1) value',[t]);
 cohort=await value("insert into private.provider_snapshot_cohorts(lane,local_date,cutoff,roster_token,targets,supplement_pass)values('closed','2026-10-07','2026-10-08T00:00:00+05:30',md5($1::jsonb::text),$1,0)returning id value",[targets]);
 for(const [component,prior]of [['orders',false],['orders',true],['intake',false],['intake',true],['submission',false]])for(const t of targets){
  const q={action:'aggregate',view:'providers',platformId:t.id,startAt:prior?'2026-10-05T18:30:00.000000Z':'2026-10-06T18:30:00.000000Z',endAt:prior?'2026-10-06T18:30:00.000000Z':'2026-10-07T18:30:00.000000Z',direction:'charge',status:'all',currency:'INR',offset:0,limit:20};
  const id=await value('select private.provider_snapshot_enqueue($1,$2,$3) value',[t,q,component]);await db.query('insert into private.provider_snapshot_cohort_jobs values($1,$2)',[cohort,id]);
  let payload={version:component==='submission'?3:1,platform:{id:t.id,source:t.source,sourceName:t.source_name,scopeGroup:t.scope_group,currency:t.currency,timezone:t.timezone},startAt:q.startAt,endAt:q.endAt};
  if(component==='orders')Object.assign(payload,{summary:[{all_count:7,all_amount:70}],groups:{provider:[{provider:t.source==='kb'?'ArbPay':'UnaffectedPay',all_count:7}]},rows:[]});
  else if(component==='submission')Object.assign(payload,{metrics:[{provider:'UnaffectedPay',invalid_count:7}],coverage:{sourceCompletenessVerified:false},rows:null,members:null});
  else Object.assign(payload,{snapshotWindow:{startAt:q.startAt,endAt:q.endAt},rows:[]});
  const p={computationComplete:true,upstreamComplete:false,sourceWatermark:{kind:'synthetic-original'},sourceReadStartedAt:new Date().toISOString(),sourceReadCompletedAt:new Date().toISOString()};
  const j=await value("select private.provider_snapshot_claim('test',120) value");assert.equal(j.jobId,id);
  assert.equal((await value('select private.provider_snapshot_complete($1,$2,$3,$4,$5) value',[id,j.runId,j.fence,payload,p])).published,true);
 }
 await db.query("update private.provider_snapshot_cohorts set status='ready'where id=$1",[cohort]);
}
before(async()=>{
 db=await require('./fixtures/provider-snapshot-retention/baseline-harness.cjs').setup({protocol:false});await installProduction();
 const retention=read('supabase/migrations/20261015081222_provider_snapshot_tiered_retention.sql');
 await db.exec(retention.slice(retention.indexOf('create function private.provider_snapshot_storage_class('),retention.indexOf('-- BEGIN enqueue-after.sql')));
 await db.exec(fn(retention,'provider_snapshot_enqueue'));await db.exec(fn(retention,'provider_snapshot_complete'));
 for(const name of ['dashboard_admin_yash_status','dashboard_admin_yash_provider','dashboard_admin_yash_completed_at','dashboard_admin_yash_capabilities'])await db.exec(fn(read('supabase/migrations/20261009044023_yash_live_readers.sql'),name));
 await db.exec(fn(read('supabase/admin-live-dynamic-amount-bands.sql'),'dashboard_admin_validate_amount_bands'));
 await db.exec(fn(read('supabase/migrations/20260930225000_duration_precision_ranges.sql'),'dashboard_admin_validate_duration'));
 await db.exec("create function private.dashboard_admin_fee_category(text,text)returns text language sql immutable as $$select $2$$;create function private.dashboard_admin_fee_intervals(text,text,text,text,text,text)returns table(effective_from timestamptz,effective_until timestamptz,percent_rate numeric,fixed_fee numeric)language sql stable as $$select null::timestamptz,null::timestamptz,null::numeric,null::numeric where false$$;");
 for(const name of ['dashboard_admin_order_business_text','dashboard_admin_order_business_result'])await db.exec(fn(read('supabase/migrations/20261012121350_native_order_business_details.sql'),name));
 await db.exec(fn(read('supabase/migrations/20261010072155_yash_submission_dual_stream_coverage.sql'),'dashboard_admin_yash_submission_coverage'));
 await db.exec("create function private.dashboard_admin_live_provider_canonical(text,text,text)returns text language sql stable as $$select $3$$;");
 const source=read('tests/yash-readers.test.cjs');for(const name of ['yash_orders','yash_sync_windows'])await db.exec(source.match(new RegExp('create table private\\.'+name+'\\([^;]+;'))[0]);
 const sources=read('tests/uploaded-order-sources.test.cjs');
 await db.exec('drop table public.ar_collected_orders');for(const name of ['ar_collected_orders','newar_detail_records'])await db.exec(sources.match(new RegExp('create table '+name+'\\([^;]+;'))[0]);
 await db.exec('alter table ar_collected_orders add column money_format_version smallint,add column amount_local numeric,add column currency_local text,add column money_issue_code text;alter table newar_detail_records add column raw jsonb');
 await db.exec(read('tests/fixtures/ar-submission-native-null-amount-helper.sql'));
 await db.exec("insert into public.ar_config_targets select 'AR','IN','SYNTHETIC_'||g,'INR','印度','Asia/Kolkata'from generate_series(1,16)g;insert into public.newar_detail_platforms values('SYNTHETIC_NEWAR','IN','印度',true,null,'Asia/Kolkata','INR');");
 await db.exec("insert into public.ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel,channel_type)select 'AR','IN','SYNTHETIC_'||p,'recharge','SYNTHETIC-'||n,'synthetic-member',10,'待支付','2026-10-07 01:00','ArbPay','Phonepe_QR'from generate_series(1,16)p cross join generate_series(1,16)n;insert into public.newar_detail_records(platform,dataset,source_id,member_id,order_number,provider,channel_type,currency,amount,status_code,status_group,created_at,raw)select 'SYNTHETIC_NEWAR','charge','SYNTHETIC-'||n,'synthetic-member','SYNTHETIC-'||n,'ArbPay','Phonepe_QR','INR',10,'0','pending','2026-10-07T01:00+05:30','{}'from generate_series(1,16)n;");
 await db.exec("insert into private.yash_orders(source_site,order_type,order_no,uid,status,amount,created_at,completed_at,source_timezone,supplier,channel,currency,raw_fields,received_at) values('yash','deposit','synthetic-phonepe','synthetic-member','充值成功',10,'2026-10-07T01:00+05:30','2026-10-07T02:00+05:30','Asia/Kolkata','ArbPay','Phonepe_QR','INR','{}',now()),('yash','deposit','synthetic-other','synthetic-member','充值成功',20,'2026-10-07T01:00+05:30','2026-10-07T02:00+05:30','Asia/Kolkata','ArbPay','Other-UPI','INR','{}',now())");
 await seedCohort();if(expectedJobs>90){await db.query("select set_config('yash.test_extra_count',$1,false)",[String(expectedJobs-90)]);await db.exec(read('tests/fixtures/yash-channel-scale-heads.sql'));}await db.exec(prepare());
 // Reproduce the already installed revision before applying the small patch.
 for(const x of installedHelpers)await db.exec(x.definition.replace(/^create function /,'create or replace function '));
 const original=await heads(),objects=await value("select jsonb_object_agg(relname,oid::text)value from pg_class where relname in('yash_channel_shadow_batches','yash_channel_shadow_items')"),fingerprint=await value('select private.yash_channel_shadow_fingerprint()value');
 await db.exec(patch());await db.exec(patch());assert.deepEqual(await heads(),original);assert.deepEqual(await value("select jsonb_object_agg(relname,oid::text)value from pg_class where relname in('yash_channel_shadow_batches','yash_channel_shadow_items')"),objects);assert.equal(await value('select private.yash_channel_shadow_fingerprint()value'),fingerprint);
 await db.exec("set statement_timeout='10s'");batch=(await value('select private.yash_channel_shadow_begin() value')).batchId;
});
after(()=>db?.close());
test('preparation preserves live heads and stages one real YASH or equivalent copy at a time',async()=>{
 const original=await heads(),tokens=await value('select jsonb_object_agg(platform_id,private.provider_snapshot_dependency_token(target))value from private.provider_snapshot_targets');
 const captured=await value("select jsonb_build_object('items',count(*),'payloadCopies',count(*)filter(where source_artifact?'payload'or source_artifact?'provenance'),'metadataBytes',sum(octet_length(source_artifact::text)),'sourceBytes',sum((source_artifact->>'stored_bytes')::bigint))value from private.yash_channel_shadow_items where batch_id=$1",[batch]);assert.equal(captured.items,expectedJobs);assert.equal(captured.payloadCopies,0);assert(captured.metadataBytes<expectedJobs*1024);if(expectedJobs>90)console.log('Synthetic manifest-only capture:',captured);
 if(expectedJobs===2192){const counts=await value("select jsonb_object_agg(component,n)value from(select source_job->>'component'component,count(*)n from private.yash_channel_shadow_items where source_job#>>'{target,source}'='kb'group by 1)counts");assert.deepEqual(counts,{orders:48,submission:25,intake:49});console.log('Synthetic YASH component counts:',counts);}
 let copied=0;while(copied<expectedJobs-expectedRecomputed){const r=await value('select private.yash_channel_shadow_copy($1,100)value',[batch]);assert(r.items>0&&r.items<=100);copied+=r.items;}assert.equal(copied,expectedJobs-expectedRecomputed);
 for(let n=0;n<expectedRecomputed;n++){await db.exec('begin');const r=await value('select private.yash_channel_shadow_step($1)value',[batch]);assert.equal(r.status,'staged');const held=await value("select exists(select 1 from pg_locks where locktype='advisory'and pid=pg_backend_pid()and granted and classid=((hashtextextended('provider_snapshot_shadow_worker_v1',0)>>32)&4294967295)::oid and objid=(hashtextextended('provider_snapshot_shadow_worker_v1',0)&4294967295)::oid)value");assert.equal(held,true);await db.exec('commit');}
 assert.equal((await value('select private.yash_channel_shadow_step($1)value',[batch])).status,'prepared');assert.deepEqual(await heads(),original);
 assert.deepEqual(await value('select jsonb_object_agg(platform_id,private.provider_snapshot_dependency_token(target))value from private.provider_snapshot_targets'),tokens);
 const copies=(await db.query("select i.payload,i.provenance,i.source_artifact,a.payload original_payload,a.provenance original_provenance from private.yash_channel_shadow_items i join private.provider_snapshot_artifacts a on a.id=i.source_snapshot where i.batch_id=$1 and i.mode='reuse_equivalent'",[batch])).rows;assert.equal(copies.length,expectedJobs-expectedRecomputed);
 for(const x of copies){assert.deepEqual(x.payload,x.original_payload);assert.deepEqual(x.provenance.sourceWatermark,x.original_provenance.sourceWatermark);assert.equal(x.provenance.sourceReadCompletedAt,x.original_provenance.sourceReadCompletedAt);assert.equal(x.provenance.upstreamComplete,false);assert.equal(Object.hasOwn(x.source_artifact,'payload'),false);}
 assert.equal(await value('select bool_and((source_artifact->>\'prepared_bytes\')::bigint=octet_length(payload::text)+octet_length(provenance::text))value from private.yash_channel_shadow_items where batch_id=$1',[batch]),true);
 const row=await value("select payload value from private.yash_channel_shadow_items where batch_id=$1 and mode='recompute_yash'and source_job->>'component'='orders'and(source_job->>'window_from')::timestamptz='2026-10-06T18:30Z'",[batch]);
 assert.equal(row.groups.provider.find(x=>x.provider==='UPI-QR').all_count,1);assert.equal(row.groups.provider.find(x=>x.provider==='ArbPay').all_count,1);
});
test('helper-only patch refuses live staging and unexpected installed definitions without changing heads',async()=>{
 const old=await heads();await assert.rejects(db.exec(patch()),/patch_requires_empty_stage/);await db.exec('rollback');assert.deepEqual(await heads(),old);
 await db.exec('begin');try{
  await value('select private.yash_channel_shadow_discard($1)value',[batch]);
  await db.exec("create or replace function private.yash_channel_shadow_copy(p_batch uuid,p_limit integer default 100)returns jsonb language plpgsql volatile security invoker set search_path=''as $$begin return '{}'::jsonb;end;$$");
  await assert.rejects(db.exec(patch().replace(/^begin;$/m,'').replace(/^commit;$/m,'')),/installed_helper_changed/);
 }finally{await db.exec('rollback');}assert.deepEqual(await heads(),old);
});
test('manifest budgets keep every head through 8192 and reject 8193 atomically', {skip:expectedJobs!==90},async()=>{
 const old=await heads();await db.exec('begin');try{
  await value('select private.yash_channel_shadow_discard($1)value',[batch]);
  await db.exec("set local yash.test_extra_count='8102';set local yash.test_base_date='2022-01-01';set local yash.test_padding='0'");await db.exec(read('tests/fixtures/yash-channel-scale-heads.sql'));
  const r=await value('select private.yash_channel_shadow_begin()value');assert.equal(r.items,8192);assert.equal(await value('select count(*)::int value from private.provider_snapshot_heads'),8192);
  await value('select private.yash_channel_shadow_discard($1)value',[r.batchId]);
  await db.exec("set local yash.test_extra_count='1';set local yash.test_base_date='2020-01-01'");await db.exec(read('tests/fixtures/yash-channel-scale-heads.sql'));
  await db.exec('savepoint limit_attempt');await assert.rejects(value('select private.yash_channel_shadow_begin()value'),/incomplete_or_oversize/);await db.exec('rollback to limit_attempt');
  assert.equal(await value('select count(*)::int value from private.provider_snapshot_heads'),8193);assert.equal(await value('select count(*)::int value from private.yash_channel_shadow_batches'),0);assert.equal(await value('select count(*)::int value from private.yash_channel_shadow_items'),0);
 }finally{await db.exec('rollback');}assert.deepEqual(await heads(),old);
});
test('metadata capacity accounting enforces 256 MiB without serializing prior prepared payloads',async()=>{
 const old=await heads();await db.exec('begin');try{
  // Corrupted/over-budget accounting is rejected before any publication. The
  // exact accounting values themselves are asserted against real payloads above.
  await db.exec("update private.yash_channel_shadow_items set source_artifact=jsonb_set(source_artifact,'{prepared_bytes}','268435456')where job_id=(select job_id from private.yash_channel_shadow_items limit 1)");
  await assert.rejects(value('select private.yash_channel_shadow_refresh($1)value',[batch]),/yash_shadow_capacity/);
 }finally{await db.exec('rollback');}assert.deepEqual(await heads(),old);
});
test('a committed ordinary-worker lease makes shadow recomputation yield without touching the pending item',async()=>{
 await db.exec('begin');try{
  await db.exec("update private.yash_channel_shadow_items set payload=null,provenance=null where job_id=(select job_id from private.yash_channel_shadow_items where mode='recompute_yash'limit 1);update private.provider_snapshot_jobs set status='running',lease_until=clock_timestamp()+interval'1 minute'where id=(select job_id from private.yash_channel_shadow_items where mode='reuse_equivalent'limit 1)");
  const old=await heads(),r=await value('select private.yash_channel_shadow_step($1)value',[batch]);assert.equal(r.status,'busy');assert.equal(await value('select payload is null value from private.yash_channel_shadow_items where job_id=$1',[r.jobId]),true);assert.deepEqual(await heads(),old);
 }finally{await db.exec('rollback');}
});
test('all 17 non-YASH platforms retain real aggregate and whole-day submission results',async()=>{
 for(const t of targets.filter(x=>x.source!=='kb')){
  const q={action:'aggregate',view:'providers',platformId:t.id,startAt:'2026-10-06T18:30:00.000000Z',endAt:'2026-10-07T18:30:00.000000Z',direction:'charge',status:'all',currency:'INR',offset:0,limit:20};
  const sub={platformId:t.id,startAt:q.startAt,endAt:q.endAt,direction:'charge',currency:'INR',operation:'summary',charts:false};
  const r=(await db.query('select private.provider_snapshot_orders_raw_kernel($1,$2) original,private.yash_channel_shadow_orders_raw_kernel($1,$2) shadow,private.provider_snapshot_submission_kernel($3,$2) submission,private.yash_channel_shadow_submission_kernel($3,$2) shadow_submission',[q,[t],sub])).rows[0];
  assert.deepEqual(r.shadow,r.original);assert.deepEqual(r.shadow_submission,r.submission);assert.equal(r.original.summary[0].all_count,16);assert.equal(r.original.groups.provider[0].provider,'ArbPay');assert.equal(r.submission.metrics.find(x=>x.provider===null&&x.threshold===15).invalid_count,16);
  unchanged.set(t.id,{q,sub,orders:r.original,submission:r.submission});
 }
 assert.equal(unchanged.size,17);
});
test('preflight rejects an incomplete stage, an active lease and a non-atomic finalize',async()=>{
 await assert.rejects(value('select private.yash_channel_shadow_promote($1)value',[batch]),/atomic_transaction_required/);
 await assert.rejects(db.exec(read('supabase/migrations/20261015140304_yash_channel_provider_classification.sql')),/atomic_publication_required/);await db.exec('rollback');
 for(const change of ["update private.yash_channel_shadow_items set payload=null,provenance=null where job_id=(select job_id from private.yash_channel_shadow_items limit 1)","update private.provider_snapshot_jobs set status='running',lease_until=clock_timestamp()+interval'1minute'where id=(select id from private.provider_snapshot_jobs limit 1)"]){await db.exec('begin');try{await db.exec(change);await assert.rejects(value('select private.yash_channel_shadow_preflight($1)value',[batch]),/incomplete|active_lease/);}finally{await db.exec('rollback');}}
});
test('temporary completion clone preserves every original per-item check and needs verified same-transaction context',async()=>{
 const normal=await value("select prosrc value from pg_proc where oid='private.provider_snapshot_complete(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure"),clone=await value("select prosrc value from pg_proc where oid='private.yash_channel_shadow_complete(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure");
 const guards=" if not private.provider_snapshot_kernel_contract_current()then return jsonb_build_object('published',false,'reason','kernel_contract_changed');end if;\n if not private.provider_snapshot_target_current(j.target)then return jsonb_build_object('published',false,'reason','target_changed');end if;\n if j.dependency_token is distinct from private.provider_snapshot_dependency_token(j.target)then return jsonb_build_object('published',false,'reason','dependency_changed');end if;";
 assert.equal(clone.replace(" if not private.yash_channel_shadow_completion_context(p_run_id,j.target,j.dependency_token)then return jsonb_build_object('published',false,'reason','unverified_release_context');end if;",guards),normal);
 const t=targets[0],dep=await value('select private.provider_snapshot_dependency_token($1)value',[t]);assert.equal(await value('select private.yash_channel_shadow_completion_context($1,$2,$3)value',[batch,t,dep]),false);
 await db.exec('begin');try{await value('select private.yash_channel_shadow_preflight($1)value',[batch]);assert.equal(await value('select private.yash_channel_shadow_completion_context($1,$2,$3)value',[batch,t,dep]),false);const i=await value('select to_jsonb(i)value from private.yash_channel_shadow_items i where batch_id=$1 limit 1',[batch]);await db.query("update private.provider_snapshot_jobs set status='running',run_id=$2,lease_until=clock_timestamp()+interval'1minute'where id=$1",[i.job_id,batch]);const old=await heads(),r=await value('select private.yash_channel_shadow_complete($1,$2,$3,$4,$5)value',[i.job_id,batch,i.source_job.fence,i.payload,i.provenance]);assert.equal(r.published,false);assert.equal(r.reason,'unverified_release_context');assert.deepEqual(await heads(),old);}finally{await db.exec('rollback');}
});
test('queued or failed extra heads stay readable before release and cannot be omitted from promotion',async()=>{
 for(const state of ['queued','failed']){await db.exec('begin');try{
  const t=targets.find(x=>x.source==='ar'),q={action:'aggregate',view:'providers',platformId:t.id,startAt:'2026-10-02T18:30:00.000000Z',endAt:'2026-10-03T18:30:00.000000Z',direction:'charge',status:'all',currency:'INR',offset:0,limit:20};
  const id=await value('select private.provider_snapshot_enqueue($1,$2,$3)value',[t,q,'orders']),j=await value("select private.provider_snapshot_claim('extra-head',120)value");assert.equal(j.jobId,id);
  const payload={version:1,platform:{id:t.id,source:t.source,sourceName:t.source_name,scopeGroup:t.scope_group,currency:t.currency,timezone:t.timezone},startAt:q.startAt,endAt:q.endAt,summary:[],groups:{provider:[]},rows:[]},provenance={computationComplete:true,upstreamComplete:false,sourceWatermark:{kind:'synthetic'},sourceReadStartedAt:new Date().toISOString(),sourceReadCompletedAt:new Date().toISOString()};
  assert.equal((await value('select private.provider_snapshot_complete($1,$2,$3,$4,$5)value',[id,j.runId,j.fence,payload,provenance])).published,true);
  await value('select private.provider_snapshot_requeue($1)value',[id]);if(state==='failed')await db.query("update private.provider_snapshot_jobs set status='failed'where id=$1",[id]);
  assert.equal(await value('select count(*)::int value from private.provider_snapshot_heads h join private.provider_snapshot_jobs j on j.id=h.job_id join private.provider_snapshot_artifacts a on a.id=h.snapshot_id where j.id=$1 and a.dependency_token=private.provider_snapshot_dependency_token(j.target)',[id]),1);
  const refreshed=await value('select private.yash_channel_shadow_refresh($1)value',[batch]);assert.equal(refreshed.items,expectedJobs);assert.equal(refreshed.pending,0);
  await assert.rejects(value('select private.yash_channel_shadow_preflight($1)value',[batch]),/unstaged_live_head/);
 }finally{await db.exec('rollback');}}
});
test('drift refresh preserves other prepared items and restages only the changed source head',async()=>{
 const old=await heads();const job=await value("select job_id value from private.yash_channel_shadow_items where mode='reuse_equivalent'limit 1");
 const source=(await db.query('select payload,provenance from private.provider_snapshot_artifacts a join private.provider_snapshot_heads h on h.snapshot_id=a.id where h.job_id=$1',[job])).rows[0];
 await db.query("update private.provider_snapshot_cohorts set status='building'where id=$1",[cohort]);assert.equal(await value('select private.provider_snapshot_requeue($1)value',[job]),true);const claimed=await value("select private.provider_snapshot_claim('test-drift',120)value");assert.equal(claimed.jobId,job);assert.equal((await value('select private.provider_snapshot_complete($1,$2,$3,$4,$5)value',[job,claimed.runId,claimed.fence,source.payload,source.provenance])).published,true);await db.query("update private.provider_snapshot_cohorts set status='ready'where id=$1",[cohort]);const published=await heads();assert.equal(published.filter((h,i)=>h.snapshot_id!==old[i].snapshot_id).length,1);
 await assert.rejects(value('select private.yash_channel_shadow_preflight($1)value',[batch]),/heads_changed/);
 const r=await value('select private.yash_channel_shadow_refresh($1)value',[batch]);assert.equal(r.changedItems,1);assert.equal(r.pending,1);assert.equal((await value('select private.yash_channel_shadow_copy($1,100)value',[batch])).items,1);assert.deepEqual(await heads(),published);
});
test('post-patch validation failure rolls back all definitions and heads; complete promote links all revisions atomically',async()=>{
 const old=await heads(),body=await value("select prosrc value from pg_proc where oid='private.dashboard_admin_yash_order_source()'::regprocedure");
 const sql=promote(batch);assert.equal((sql.match(/^begin;/mg)||[]).length,1);assert.equal((sql.match(/^commit;/mg)||[]).length,1);
 const broken=sql.replace('select private.yash_channel_shadow_promote(',"update private.yash_channel_shadow_batches set tokens='{}';\nselect private.yash_channel_shadow_promote(");await assert.rejects(db.exec(broken),/future_token_mismatch/);await db.exec('rollback');assert.deepEqual(await heads(),old);assert.equal(await value("select prosrc value from pg_proc where oid='private.dashboard_admin_yash_order_source()'::regprocedure"),body);
 const artifactsBefore=await value('select count(*)::int value from private.provider_snapshot_artifacts');
 const quotaFailure=sql.replace('select private.yash_channel_shadow_promote(',"update private.provider_snapshot_storage_usage set artifacts=25000 where storage_class='history';\nselect private.yash_channel_shadow_promote(");await assert.rejects(db.exec(quotaFailure),/snapshot_artifact_capacity/);await db.exec('rollback');assert.deepEqual(await heads(),old);assert.equal(await value('select count(*)::int value from private.provider_snapshot_artifacts'),artifactsBefore);
 const lateFailure=sql.replace('select private.yash_channel_shadow_promote(',"update private.yash_channel_shadow_items set payload=jsonb_set(payload,'{platform,id}','\"00000000-0000-0000-0000-000000000000\"')where job_id=(select job_id from private.yash_channel_shadow_items where mode='recompute_yash'order by job_id desc limit 1);\nselect private.yash_channel_shadow_promote(");
 await assert.rejects(db.exec(lateFailure),/snapshot_scope_mismatch/);await db.exec('rollback');assert.deepEqual(await heads(),old);assert.equal(await value('select count(*)::int value from private.provider_snapshot_artifacts'),artifactsBefore);assert.equal(await value("select prosrc value from pg_proc where oid='private.dashboard_admin_yash_order_source()'::regprocedure"),body);
 const driftFailure=sql.replace('select private.yash_channel_shadow_promote(',()=>"create function private.synthetic_yash_release_drift() returns trigger language plpgsql as $$begin if not exists(select 1 from private.dashboard_admin_provider_registry where raw_provider='synthetic-release-drift')then insert into private.dashboard_admin_provider_registry(country,platform,raw_provider,canonical_values)select 'IN',j.target->>'source_name','synthetic-release-drift',array['ChangedPay']from private.provider_snapshot_jobs j where j.id=new.job_id;end if;return new;end;$$;create trigger synthetic_yash_release_drift after insert on private.provider_snapshot_artifacts for each row execute function private.synthetic_yash_release_drift();\nselect private.yash_channel_shadow_promote(");await assert.rejects(db.exec(driftFailure),/future_token_mismatch/);await db.exec('rollback');assert.deepEqual(await heads(),old);assert.equal(await value('select count(*)::int value from private.provider_snapshot_artifacts'),artifactsBefore);assert.equal(await value("select count(*)::int value from private.dashboard_admin_provider_registry where raw_provider='synthetic-release-drift'"),0);
 const started=performance.now();await db.exec(sql);if(expectedJobs>90)console.log('Synthetic '+expectedJobs+'-head atomic promotion milliseconds:',Math.round(performance.now()-started),'(not a production timing)');const fresh=await heads();assert.equal(fresh.length,expectedJobs);assert(fresh.every((h,i)=>h.job_id===old[i].job_id&&h.snapshot_id!==old[i].snapshot_id));
 assert.equal(await value("with tokens as materialized(select target,private.provider_snapshot_dependency_token(target)token from private.provider_snapshot_targets) select count(*)::int value from private.provider_snapshot_jobs j join tokens t on t.target=j.target join private.provider_snapshot_heads h on h.job_id=j.id join private.provider_snapshot_artifacts a on a.id=h.snapshot_id join private.yash_channel_shadow_items stage on stage.job_id=j.id where j.status='ready'and j.revision=(stage.source_job->>'revision')::bigint+1 and a.revision=j.revision and a.dependency_token=t.token"),expectedJobs);
 assert.equal(await value('select count(*)::int value from private.provider_snapshot_artifacts'),expectedJobs*2+1,'all original immutable artifacts remain');assert.equal(await value('select status value from private.provider_snapshot_cohorts where id=$1',[cohort]),'ready');
 assert.equal(await value('select private.provider_snapshot_kernel_contract_current()value'),true);await assert.rejects(value('select private.yash_channel_shadow_preflight($1)value',[batch]),/invalid_stage/);
});
test('promoted non-YASH bodies preserve the actual computed metrics, including ArbPay on Phonepe_QR',async()=>{
 for(const t of targets.filter(x=>x.source!=='kb')){
  const prior=unchanged.get(t.id);const r=(await db.query('select private.provider_snapshot_orders_raw_kernel($1,$2) orders,private.provider_snapshot_submission_kernel($3,$2) submission',[prior.q,[t],prior.sub])).rows[0];
  for(const key of ['summary','groups','total','rows'])assert.deepEqual(r.orders[key],prior.orders[key]);
  for(const key of ['metrics','coverage','rows','members'])assert.deepEqual(r.submission[key],prior.submission[key]);
 }
 const old=await heads();await db.exec(read('supabase/migrations/20261015140304_yash_channel_provider_classification.sql'));assert.deepEqual(await heads(),old,'exact migration replay never changes heads');
});
test('all deployment-only tables/functions remain inaccessible to application roles',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await value("select bool_or(has_function_privilege($1,p.oid,'execute'))value from pg_proc p where p.pronamespace='private'::regnamespace and p.proname like 'yash_channel_shadow_%'",[role]),false);
  for(const t of ['batches','items'])assert.equal(await value("select has_table_privilege($1,'private.yash_channel_shadow_"+t+"','select,insert,update,delete')value",[role]),false);
 }
});

test('deployment cleanup removes temporary code without changing the published generation',async()=>{
 const old=await heads(),count=await value('select count(*)::int value from private.provider_snapshot_artifacts');await db.exec(read('supabase/operations/yash-channel-shadow-cleanup.sql'));assert.deepEqual(await heads(),old);assert.equal(await value('select count(*)::int value from private.provider_snapshot_artifacts'),count);assert.equal(await value("select to_regclass('private.yash_channel_shadow_batches')::text value"),null);assert.equal(await value("select count(*)::int value from pg_proc where pronamespace='private'::regnamespace and left(proname,20)='yash_channel_shadow_'"),0);assert.equal(await value('select private.provider_snapshot_kernel_contract_current()value'),true);await db.exec(read('supabase/migrations/20261015140304_yash_channel_provider_classification.sql'));assert.deepEqual(await heads(),old);
});
