// Real offline PostgreSQL, captured production definitions, synthetic identities/data only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{setup}=require('./fixtures/provider-snapshot-retention/baseline-harness.cjs');
const{fixture,scalar}=require('./fixtures/provider-snapshot-retention/harness.cjs');
const root=path.resolve(__dirname,'..'),sig='private.dashboard_admin_live_provider_snapshot(jsonb)';
const install=fs.readFileSync(path.join(root,'supabase/migrations/20261015084703_provider_snapshot_current_revision_reader.sql'),'utf8');
const rollback=fs.readFileSync(path.join(__dirname,'fixtures/provider-snapshot-current-revision/rollback.sql'),'utf8');
const receipt=fs.readFileSync(path.join(__dirname,'fixtures/provider-snapshot-current-revision/receipt.sql'),'utf8');
const retention=fs.readFileSync(path.join(root,'supabase/migrations/20261015081222_provider_snapshot_tiered_retention.sql'),'utf8');
const OWNER='10000000-0000-4000-8000-000000000001',STAFF='10000000-0000-4000-8000-000000000002',ROLE='20000000-0000-4000-8000-000000000001';
const body=(db,s=sig)=>scalar(db,'select md5(prosrc)from pg_proc where oid=$1::regprocedure',[s]);
async function rejectSql(db,sql,pattern){await assert.rejects(()=>db.exec(sql),pattern);await db.exec('rollback');}
// Only the existing authorized-catalog test adapter differs from production.
// Match its actual installed-copy-guard metadata; keep every other byte/guard exact.
async function inSyntheticCatalog(db,sql){const match=sql.match(/\$deps\$([\s\S]*?)\$deps\$::jsonb/);assert(match);const deps=JSON.parse(match[1]);const contract=deps.find(x=>x.signature==='private.provider_snapshot_kernel_contract_current()');contract.body_md5=await body(db,contract.signature);return sql.replace(match[1],JSON.stringify(deps));}
async function patch(db){await db.exec(await inSyntheticCatalog(db,install));}
async function authenticated(db,fn,actor=OWNER){await db.exec('set role authenticated');await db.query("select set_config('test.actor',$1,false)",[actor]);try{return await fn()}finally{await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[OWNER]);}}
async function make({day='2026-10-10',hour=24,missing=false,patchFirst=false}={}){
 const h=await fixture({tiered:true}),{db,targets}=h,t=targets[0];
 await db.query("insert into public.dashboard_profiles values($1,'owner',true,'{\"mode\":\"all\",\"countries\":[]}')",[OWNER]);
 await db.exec("insert into private.test_native_catalog select *from private.provider_snapshot_native_catalog()where source='ar'");
 await db.query("select set_config('test.actor',$1,false),set_config('test.session_allowed','true',false),set_config('test.ip_allowed','true',false)",[OWNER]);
 const c=await h.cohort(day,hour,{lane:hour===24?'closed':'current',useTargets:[t],missing});
 const request={version:1,platformIds:[t.id],startAt:day+'T00:00:00',endAt:day+'T23:59:59',direction:'charge',status:'all',currency:'INR',components:['orders','submission','intake']};
 const read=q=>authenticated(db,()=>scalar(db,'select public.dashboard_admin_provider_snapshot($1)',[q||request]));
 if(patchFirst)await patch(db);
 return{...h,t,c,request,read};
}
async function supplement(db,c){const id=await scalar(db,"insert into private.provider_snapshot_cohorts(lane,local_date,cutoff,roster_token,targets,supplement_pass)select lane,local_date,cutoff,roster_token,targets,supplement_pass+1 from private.provider_snapshot_cohorts where id=$1 returning id",[c.id]);for(const job of c.jobs){assert.equal(await scalar(db,'select private.provider_snapshot_requeue($1)',[job]),true);await db.query('insert into private.provider_snapshot_cohort_jobs values($1,$2)',[id,job]);}return id;}
const claim=db=>scalar(db,"select private.provider_snapshot_claim('reader-revision-test',120)");
async function publish(db,j){assert(j);const old=(await db.query('select a.payload,a.provenance from private.provider_snapshot_heads h join private.provider_snapshot_artifacts a on a.id=h.snapshot_id where h.job_id=$1',[j.jobId])).rows[0];const r=await scalar(db,'select private.provider_snapshot_complete($1,$2,$3,$4,$5)',[j.jobId,j.runId,j.fence,{...old.payload,syntheticGeneration:'new'},old.provenance]);assert.equal(r.published,true);return r;}
const values=r=>r.platforms.map(p=>({platform:p.platform,current:p.current,previous:p.previous}));

test('exact installer, replay and rollback preserve all other function metadata and snapshot data',async()=>{
 const db=await setup({protocol:false});try{
  await db.exec(retention);await db.exec('create schema cron;create table cron.job(jobname text,active boolean)');
  const check=async()=>{const results=await db.exec(receipt),r=results.filter(x=>x.rows?.[0]?.receipt).map(x=>x.rows[0].receipt);assert.equal(r.length,1,'MCP receives one complete JSON receipt');return r[0];};
  const beforeReceipt=await check();assert.equal(beforeReceipt.metadata.state,'baseline');assert.equal(beforeReceipt.metadata.dependenciesMatch,true);assert.equal(beforeReceipt.metadata.readOnly,'on');assert.equal(beforeReceipt.quiescence.activeProviderCronJobs,0);assert.ok(beforeReceipt.data_fingerprints);
  const metadata=()=>scalar(db,"select jsonb_agg(to_jsonb(p)order by p.oid)from pg_proc p where pronamespace='private'::regnamespace");const original=await metadata();const before=await body(db);
  assert.equal(before,'2f72c259502258b77ec8d1d387af2f36');await db.exec(install);assert.equal(await body(db),'db3cb50f56d94e9a1930ac321b160a91');await db.exec(install);
  const after=await metadata();assert.deepEqual(after.map(x=>x.oid===original.find(p=>p.proname==='dashboard_admin_live_provider_snapshot').oid?{...x,prosrc:original.find(p=>p.oid===x.oid).prosrc}:x),original);
  const afterReceipt=await check();assert.equal(afterReceipt.metadata.state,'installed');assert.equal(afterReceipt.metadata.dependenciesMatch,true);assert.deepEqual(afterReceipt.data_fingerprints,beforeReceipt.data_fingerprints);
  await db.exec(rollback);await db.exec(rollback);assert.deepEqual(await metadata(),original);await db.exec(install);assert.equal(await body(db),'db3cb50f56d94e9a1930ac321b160a91');
  assert.equal(await scalar(db,'select count(*)::int from private.provider_snapshot_jobs'),0);
 }finally{await db.close();}
});
test('unknown reader body, ACL or dependency metadata fails closed; rollback does not overwrite drift',async()=>{
 const db=await setup({protocol:false});try{await db.exec(retention);const definition=await scalar(db,'select pg_get_functiondef($1::regprocedure)',[sig]);
  await db.exec(definition.replace('v_all boolean:=true','v_all boolean:=false'));await rejectSql(db,install,/snapshot_reader_body_drift/);await db.exec(definition);
  await db.exec('grant execute on function '+sig+' to service_role');await rejectSql(db,install,/snapshot_reader_metadata_drift/);await db.exec('revoke execute on function '+sig+' from service_role');
  await db.exec('alter function private.provider_snapshot_iso(timestamptz) volatile');await rejectSql(db,install,/snapshot_reader_dependency_drift/);await db.exec('alter function private.provider_snapshot_iso(timestamptz) stable');
  await db.exec(install);const current=await scalar(db,'select pg_get_functiondef($1::regprocedure)',[sig]);await db.exec(current.replace('v_all boolean:=true','v_all boolean:=false'));await rejectSql(db,rollback,/snapshot_reader_body_drift/);
 }finally{await db.close();}
});
test('ready closed-day full DTO is unchanged; queued, running, 1/5 mixed and failed supplements keep payloads but never report complete',async()=>{
 const h=await make(),{db}=h;try{
  const before=await h.read();assert.equal(before.complete,true);await patch(db);assert.deepEqual(await h.read(),before);
  const dataBefore=await scalar(db,'select jsonb_agg(to_jsonb(a)order by id)from private.provider_snapshot_artifacts a');await supplement(db,h.c);
  const queued=await h.read();assert.equal(queued.complete,false);assert.equal(queued.status,'building');assert.equal(queued.missing.length,5);assert(queued.missing.every(x=>x.state==='building'));assert.deepEqual(values(queued),values(before));assert.equal(queued.publishedCutoff,before.publishedCutoff);
  const j=await claim(db);const running=await h.read();assert.equal(running.complete,false);assert.equal(running.missing.length,5);assert.deepEqual(values(running),values(before));await publish(db,j);
  const mixed=await h.read();assert.equal(mixed.complete,false);assert.equal(mixed.missing.length,4);assert(mixed.missing.every(x=>x.state==='building'));assert.equal(mixed.platforms[0].snapshots.length,5);
  const failed=await claim(db);assert.equal(await scalar(db,"select private.provider_snapshot_fail($1,$2,$3,'compute_timeout')",[failed.jobId,failed.runId,failed.fence]),true);const withFailure=await h.read();assert.equal(withFailure.complete,false);assert.equal(withFailure.missing.filter(x=>x.state==='failed').length,1);assert.equal(withFailure.missing.find(x=>x.state==='failed').errorCode,'compute_timeout');
  assert.equal(await scalar(db,'select private.provider_snapshot_requeue($1)',[failed.jobId]),true);for(let n=0;n<4;n++)await publish(db,await claim(db));assert.equal(await claim(db),null);
  const ready=await h.read();assert.equal(ready.complete,true);assert.equal(ready.status,'ready');assert.deepEqual(ready.missing,[]);assert.equal(ready.platforms[0].snapshots.length,5);assert.notDeepEqual(ready.platforms[0].snapshots.map(x=>x.snapshotId),before.platforms[0].snapshots.map(x=>x.snapshotId));
  const oldData=await scalar(db,'select jsonb_agg(to_jsonb(a)order by id)from private.provider_snapshot_artifacts a where id=any($1::uuid[])',[before.platforms[0].snapshots.map(x=>x.snapshotId)]);assert.deepEqual(oldData,dataBefore);
 }finally{await db.close();}
});
test('ready status with an older head revision is stale, and a failed head keeps its last-good payload',async()=>{
 const h=await make({patchFirst:true}),{db}=h;try{const before=await h.read();await supplement(db,h.c);await db.exec("update private.provider_snapshot_jobs set status='ready'");let r=await h.read();assert.equal(r.complete,false);assert.equal(r.status,'stale');assert(r.missing.every(x=>x.state==='stale'));assert(r.platforms[0].snapshots.every(x=>x.stale));assert.deepEqual(values(r),values(before));
  await db.exec("update private.provider_snapshot_jobs set status='failed',last_error_code='compute_failed'");r=await h.read();assert.equal(r.complete,false);assert(r.missing.every(x=>x.state==='failed'));assert.deepEqual(values(r),values(before));
 }finally{await db.close();}
});
test('a newer incomplete revision cannot evict an older fully published common cutoff',async()=>{
 const h=await make({hour:10,patchFirst:true}),{db}=h;try{const prior=await h.read(),next=await h.cohort('2026-10-10',12,{useTargets:[h.t]});assert.notEqual((await h.read()).publishedCutoff,prior.publishedCutoff);await supplement(db,next);assert.deepEqual(await h.read(),prior);await publish(db,await claim(db));assert.deepEqual(await h.read(),prior);}finally{await db.close();}
});
test('current-day refresh preserves the older fresh common cutoff until every newer slot is ready',async()=>{
 const h=await make({patchFirst:true}),{db}=h;try{
  const time=(await db.query("select to_char(statement_timestamp()at time zone'Asia/Kolkata','YYYY-MM-DD')as local_day,private.provider_snapshot_iso(date_trunc('day',statement_timestamp()at time zone'Asia/Kolkata')at time zone'Asia/Kolkata')as range_start,private.provider_snapshot_iso(statement_timestamp())as observed_now")).rows[0];
  const start=Date.parse(time.range_start),now=Date.parse(time.observed_now),elapsed=now-start;
  const cutoffA=new Date(now-Math.min(600000,elapsed/2)).toISOString(),cutoffB=new Date(now-Math.min(300000,elapsed/4)).toISOString();
  async function cohort(cutoff){
   const id=await scalar(db,"insert into private.provider_snapshot_cohorts(lane,local_date,cutoff,roster_token,targets,supplement_pass)values('current',$1,$2,md5($3::jsonb::text),$3,0)returning id",[time.local_day,cutoff,[h.t]]),jobs=[];
   for(const[component,previous]of[['orders',false],['orders',true],['intake',false],['intake',true],['submission',false]]){
    const from=previous?new Date(start-86400000).toISOString():time.range_start,to=previous?new Date(Date.parse(cutoff)-86400000).toISOString():cutoff;
    const request={action:'aggregate',view:'providers',platformId:h.t.id,startAt:from,endAt:to,direction:'charge',status:'all',currency:'INR'};
    const job=await scalar(db,'select private.provider_snapshot_enqueue($1,$2,$3)',[h.t,request,component]);jobs.push(job);await db.query('insert into private.provider_snapshot_cohort_jobs values($1,$2)',[id,job]);
    const j=await claim(db),payload={version:component==='submission'?3:1,platform:{id:h.t.id,source:h.t.source,sourceName:h.t.source_name,scopeGroup:h.t.scope_group,currency:h.t.currency,timezone:h.t.timezone},startAt:j.request.startAt,endAt:j.request.endAt};
    if(component==='orders')Object.assign(payload,{summary:[{amount:'9007199254740993.10',unknown:null}],groups:{provider:[]},rows:[]});else if(component==='submission')Object.assign(payload,{metrics:[],coverage:{complete:false},rows:null,members:null});else Object.assign(payload,{snapshotWindow:{startAt:j.request.startAt,endAt:j.request.endAt},rows:[]});
    const ts=new Date().toISOString();assert.equal((await scalar(db,'select private.provider_snapshot_complete($1,$2,$3,$4,$5)',[j.jobId,j.runId,j.fence,payload,{computationComplete:true,upstreamComplete:false,sourceWatermark:{kind:'synthetic'},sourceReadStartedAt:ts,sourceReadCompletedAt:ts}])).published,true);
   }await db.query("update private.provider_snapshot_cohorts set status='ready'where id=$1",[id]);return{id,jobs};
  }
  const request={...h.request,startAt:time.local_day+'T00:00:00',endAt:time.local_day+'T23:59:59'};await cohort(cutoffA);const older=await h.read(request);assert.equal(older.complete,true);const newer=await cohort(cutoffB);assert.equal((await h.read(request)).complete,true);await supplement(db,newer);assert.deepEqual(await h.read(request),older);await publish(db,await claim(db));assert.deepEqual(await h.read(request),older);
 }finally{await db.close();}
});
test('missing-head failure remains failed with null payload, never a fabricated zero or complete generation',async()=>{
 const h=await make({missing:true,patchFirst:true});try{const r=await h.read();assert.equal(r.complete,false);assert.equal(r.missing.length,1);assert.equal(r.missing[0].state,'failed');assert.equal(r.platforms[0].current.submission,null);assert.equal(r.platforms[0].snapshots.length,4);}finally{await h.db.close();}
});
test('fresh session/IP/account/scope and assigned export gateway checks are unchanged',async()=>{
 const h=await make({patchFirst:true}),{db}=h;try{
  for(const setting of ['test.session_allowed','test.ip_allowed']){await db.query('select set_config($1,$2,false)',[setting,'false']);await assert.rejects(h.read,e=>e.code==='42501'&&/application_session_denied/.test(e.message));await db.query('select set_config($1,$2,false)',[setting,'true']);}
  await db.query('update public.dashboard_profiles set active=false where auth_user_id=$1',[OWNER]);await assert.rejects(h.read,e=>e.code==='42501');await db.query('update public.dashboard_profiles set active=true where auth_user_id=$1',[OWNER]);
  await db.query("insert into public.dashboard_profiles values($1,'admin',true,'{\"mode\":\"all\"}')",[STAFF]);await db.query('insert into public.dashboard_admin_preview_grants values($1,true)',[STAFF]);await db.query("insert into private.dashboard_roles values($1,'Synthetic role',array['providers.view','providers.query'],1,true)",[ROLE]);await db.query('insert into private.dashboard_role_assignments values($1,$2,1)',[STAFF,ROLE]);
  const read=q=>authenticated(db,()=>scalar(db,"select public.dashboard_admin_execute('providers',$1)",[{action:'providerSnapshot',...q}]),STAFF);
  assert.equal((await read(h.request)).complete,true);await assert.rejects(()=>authenticated(db,()=>scalar(db,'select public.dashboard_admin_provider_snapshot($1)',[h.request]),STAFF),e=>e.code==='42501'&&/role_gateway_required/.test(e.message));
  await assert.rejects(()=>read({...h.request,export:true}),e=>e.code==='42501'&&/role_permission_denied/.test(e.message));await db.exec("update private.dashboard_roles set permissions=array['providers.view','providers.query','providers.export']");assert.equal((await read({...h.request,export:true})).complete,true);
  await db.query("update public.dashboard_profiles set data_scope='{\"mode\":\"selected\",\"platforms\":[]}'where auth_user_id=$1",[STAFF]);await assert.rejects(()=>read(h.request),e=>e.code==='42501'&&/platform_denied/.test(e.message));
 }finally{await db.close();}
});
