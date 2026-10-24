// Current production bodies and synthetic verified NPG receipts. No network or real orders.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const repo=process.env.NPG_TEST_REPO_ROOT||path.resolve(__dirname,'..'),file=path.join(repo,'tests/withdraw-npg-template-serving.test.cjs');
const h=new Function('require','__dirname',fs.readFileSync(file,'utf8').split(/\ntest.afterEach/)[0]+';return{install,report,template,call,getDb:()=>db};')(createRequire(file),path.dirname(file));
const dir=path.join(__dirname,'fixtures/npg-current-window');
// Reuse the released DUOLI contract captures; do not maintain duplicate renderers or guards.
const shared={
 'render.sql':'sql/withdraw_prepared_render.sql',
 'template.before.sql':'sql/dashboard_withdraw_npg_template_read.sql',
 'withdraw_window_result.sql':'actual-private-withdraw_window_result.sql',
 'dashboard_withdraw_npg_template_zone.sql':'actual-private-dashboard_withdraw_npg_template_zone.sql',
 'auto_team_previous_projection.sql':'actual-private-auto_team_previous_projection.sql',
 'dependency.sql':'actual-private-withdraw_prepared_dependency.sql'
};
const read=name=>fs.readFileSync(shared[name]?path.join(repo,'tests/fixtures/duoli-daily-fallback',shared[name]):path.join(dir,name),'utf8');
const maintenance=name=>fs.readFileSync(path.join(__dirname,'../supabase/maintenance',name),'utf8');
const scope={mode:'all',countries:[]},countries=[['哥伦比亚','CO','NPG-COLOMBIA'],['墨西哥','MX','NPG-MEXICO'],['智利','CL','NPG-CHILE']];
const q=(extra={})=>({country:'智利',view:'auto',windowVersion:2,platforms:['NPG-CHILE'],startAt:'2026-10-20T00:00:00.000Z',endAt:'2026-10-20T23:59:59.000Z',successStartAt:'2026-10-20T00:00:00.000Z',successEndAt:'2026-10-20T23:59:59.000Z',successBasis:'success',limit:500,...extra});
const withoutPublication=r=>{const{prepared,...rest}=r;return rest;};
async function setup(after=true){
 await h.install();const db=h.getDb();await db.exec(fs.readFileSync(path.join(repo,'supabase/maintenance/withdraw-npg-template-serving.sql'),'utf8'));
 for(const name of ['render.sql','withdraw_prepared_canonical.sql','withdraw_window_legacy.sql','withdraw_window_secondary.sql','withdraw_window_result.sql','dashboard_withdraw_npg_template_zone.sql','auto_team_previous_projection.sql','dependency.sql','withdraw_prepared_read.sql','template.before.sql'])await db.exec(read(name));
 await db.exec('revoke all on all functions in schema private from public,anon,authenticated,service_role;grant all on all functions in schema private to postgres;');
 if(after)await db.exec(maintenance('withdraw-npg-current-window.sql'));
 const value=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.v;
 assert.equal(await value("select md5(prosrc)v from pg_proc where oid='private.withdraw_window_result(jsonb,jsonb,jsonb)'::regprocedure"),'f5097173ef6236c708c1199d7507fd27');
 assert.equal(await value("select md5(prosrc)v from pg_proc where oid='private.withdraw_prepared_render(jsonb,jsonb)'::regprocedure"),'06baadf5408d14fd71b12e93c7ee8b68');
 assert.equal(await value("select md5(prosrc)v from pg_proc where oid='private.withdraw_prepared_canonical(jsonb)'::regprocedure"),'10d7041b097c97ef64012904d33cb627');
 const direct=(request,t)=>value('select private.auto_team_previous_projection($1,$2,private.withdraw_window_result(private.withdraw_prepared_canonical($1),private.withdraw_prepared_render(private.withdraw_window_legacy($1),$2),$2),$3)v',[request,t.payload,t.r]);
 const helper=request=>value('select private.dashboard_withdraw_npg_template_read($1,private.withdraw_prepared_canonical($1),$2,$3,private.withdraw_prepared_dependency())v',[request,scope,[]]);
 return{db,value,direct,helper};
}

test('actual f509 window contract reproduces the old fail-closed state and only the exact new pin enables reuse',async()=>{
 const f=await setup(false);try{await h.report('2026-10-19',197,150);await h.report('2026-10-20');const request=q({includeSecondary:false}),t=await h.template(request),dep=await f.value('select private.withdraw_prepared_dependency()v');assert.equal(await f.helper(request),null);await f.db.exec(maintenance('withdraw-npg-current-window.sql'));const actual=await h.call(request);assert.equal(actual.prepared.status,'ready');assert.equal(actual.prepared.generation,t.artifact);assert.deepEqual(withoutPublication(actual),await f.direct(request,t));assert.equal(actual.windows.includeSecondary,false);assert.equal(actual.secondary.state,'not_requested');assert.equal(actual.secondary.complete,false);assert.equal(await f.value('select private.withdraw_prepared_dependency()v'),dep);assert.equal(await f.value('select count(*)v from private.withdraw_prepared_jobs'),1);}finally{await f.db.close();}
});

test('three countries preserve entire current/prior DTO with false, omitted, true and explicit independent success clocks',async()=>{
 const f=await setup();try{let templates=0;for(const[country,code,platform]of countries){await h.report('2026-10-19',197,150,code,platform);await h.report('2026-10-20',222,166,code,platform);
  for(const extra of [{},{includeSecondary:false},{includeSecondary:false,successStartAt:'2026-10-18T02:00:00.000Z',successEndAt:'2026-10-19T03:00:00.000Z',successBasis:'source_updated'}]){
   const request=q({country,platforms:[platform],...extra}),t=await h.template(request);templates++;const actual=await h.call(request);assert.equal(actual.prepared.generation,t.artifact);assert.deepEqual(withoutPublication(actual),await f.direct(request,t));assert.equal(actual.totals.total,222);assert.equal(actual.previousTotals.total,197);assert.equal(actual.npgCoverage.currentComplete,true);assert.equal(actual.npgCoverage.previousComplete,true);assert.equal(actual.secondary.complete,false);assert.equal(actual.prepared.calculationComplete,true);assert.equal(actual.prepared.sourceComplete,undefined);assert.equal(actual.prepared.freshness,'refresh_due');assert.equal(actual.prepared.refreshState,'failed');
   if(extra.includeSecondary===undefined){const explicit=await h.call({...request,includeSecondary:true});assert.deepEqual(explicit,actual);assert.equal(actual.windows.includeSecondary,undefined);}else assert.equal(actual.windows.includeSecondary,false);
  }
 }assert.equal(await f.value('select count(*)v from private.withdraw_prepared_jobs'),templates);}finally{await f.db.close();}
});

test('false and omitted templates remain separate, and exact current head takes precedence over a reusable shell',async()=>{
 const f=await setup();try{await h.report('2026-10-19');await h.report('2026-10-20');const request=q({includeSecondary:false}),legacy=await h.template(q());assert.equal(await f.helper(request),null);const t=await h.template(request);assert.notEqual(t.id,legacy.id);const r=await f.value('select private.withdraw_prepared_canonical($1)v',[request]),dep=await f.value('select private.withdraw_prepared_dependency()v'),id=await f.value('select private.withdraw_prepared_enqueue($1,$2,$3,$4)v',[r,scope,[],dep]);const payload={...t.payload,request:r};
  const artifact=await f.value("insert into private.withdraw_prepared_artifacts(job_id,revision,fence,run_id,dependency,payload,computed_at,expires_at,bytes)select id,revision,1,gen_random_uuid(),dependency,$2,clock_timestamp(),clock_timestamp()+interval'10minutes',octet_length($2::jsonb::text)from private.withdraw_prepared_jobs where id=$1 returning id v",[id,payload]);await f.db.query('insert into private.withdraw_prepared_heads values($1,$2)',[id,artifact]);await f.db.query("update private.withdraw_prepared_jobs set status='ready'where id=$1",[id]);const actual=await h.call(request);assert.equal(actual.prepared.generation,artifact);assert.notEqual(actual.prepared.generation,t.artifact);assert.equal(actual.prepared.freshness,'fresh');assert.deepEqual(withoutPublication(actual),await f.direct(request,{payload,r}));assert.equal(actual.windows.includeSecondary,false);
 }finally{await f.db.close();}
});

test('date, account, source identity, scope and permission changes retain the original refusal and bounded admission',async()=>{
 const f=await setup();try{const request=q({includeSecondary:false}),t=await h.template(request);await h.report('2026-10-19');await h.report('2026-10-20');
  for(const change of [{account:'SYNTHETIC-OTHER'},{startAt:'2026-10-19T00:00:00.000Z'},{successStartAt:'2026-10-19T02:00:00.000Z'},{view:'operators'},{platforms:['NPG-MEXICO']},{platforms:['NPG-CHILE','OTHER']},{startAt:'2026-10-20T12:00:00.000Z'}]){
   const changed={...request,...change};assert.equal(await f.helper(changed),null);const before=await f.value('select count(*)v from private.withdraw_prepared_jobs');const actual=await h.call(changed);assert.notEqual(actual.prepared.status,'ready');assert.equal(actual.rows,null);assert.equal(await f.value('select count(*)v from private.withdraw_prepared_jobs'),before+1);await h.call(changed);assert.equal(await f.value('select count(*)v from private.withdraw_prepared_jobs'),before+1);
  }
  const before=await f.value('select count(*)v from private.withdraw_prepared_jobs');await f.db.exec("set test.denied='yes'");await assert.rejects(h.call(request),e=>e.code==='42501'||/denied/.test(e.message));assert.equal(await f.value('select count(*)v from private.withdraw_prepared_jobs'),before);await f.db.exec("set test.denied='no'");
  await f.db.query("select set_config('test.scope',$1,false)",[JSON.stringify({mode:'selected',countries:['智利']})]);assert.notEqual((await h.call(request)).prepared.status,'ready');await f.db.query("select set_config('test.scope',$1,false)",[JSON.stringify(scope)]);
  await f.db.exec("insert into public.synthetic_catalog values('00000000-0000-4000-8000-000000000444','NEW-CL','M8','智利','CL','ar','America/Santiago','CLP','NEW-CL')");assert.notEqual((await h.call(request)).prepared.status,'ready');
  assert.equal(await f.value('select artifact_id v from private.withdraw_prepared_heads where job_id=$1',[t.id]),t.artifact);assert.equal(await f.value('select attempts v from private.withdraw_prepared_jobs where id=$1',[t.id]),3);
 }finally{await f.db.close();}
});

test('missing or invalid source proof remains incomplete; later verified heads update facts without rewriting the shell',async()=>{
 const f=await setup();try{const request=q({includeSecondary:false}),t=await h.template(request);await h.report('2026-10-19',197,150);let actual=await h.call(request);assert.deepEqual(withoutPublication(actual),await f.direct(request,t));assert.equal(actual.npgCoverage.currentComplete,false);assert.equal(actual.comparison.complete,false);assert.notEqual(actual.sourceComplete,true);
  await h.report('2026-10-20',222,166);actual=await h.call(request);assert.equal(actual.prepared.generation,t.artifact);assert.equal(actual.totals.total,222);assert.equal(actual.npgCoverage.currentComplete,true);
  await f.db.exec("update public.npg_withdraw_daily set unknown_operator_count=6,paid_count=210,rejected_count=4,pending_count=5,unknown_count=3 where stat_date='2026-10-20'");actual=await h.call(request);assert.deepEqual(withoutPublication(actual),await f.direct(request,t));assert.equal(actual.totals.autoCount,166);assert.equal(actual.totals.manualCount,56);assert.equal(await f.value("select unknown_operator_count v from public.npg_withdraw_daily where stat_date='2026-10-20'"),6,'original legacy classification is unchanged; no invented new classification');
  await f.db.exec("update private.npg_summary_receipts set source_order_count=999 where stat_date='2026-10-20'");actual=await h.call(request);assert.deepEqual(withoutPublication(actual),await f.direct(request,t));assert.equal(actual.npgCoverage.currentComplete,false);assert.equal(actual.comparison.complete,false);
  await h.report('2026-10-20',250,170);const latest=await h.call(request);assert.equal(latest.totals.total,250);assert.equal(latest.prepared.generation,t.artifact);assert.equal(latest.prepared.computedAt,actual.prepared.computedAt);assert.equal(latest.prepared.expiresAt,actual.prepared.expiresAt);assert.equal(await f.value('select count(*)v from private.withdraw_prepared_jobs'),1);assert.equal(await f.value('select attempts v from private.withdraw_prepared_jobs where id=$1',[t.id]),3);
 }finally{await f.db.close();}
});

test('current guarded function and security drift cannot reuse a shell and revoked roles cannot call the helper',async()=>{
 const f=await setup();try{const request=q({includeSecondary:false});await h.template(request);const signatures=['dashboard_withdraw_npg_template_zone(jsonb,jsonb,jsonb)','withdraw_prepared_render(jsonb,jsonb)','withdraw_window_result(jsonb,jsonb,jsonb)','auto_team_previous_projection(jsonb,jsonb,jsonb,jsonb)','npg_withdraw_report_snapshots(date,date,jsonb,jsonb,jsonb)'];
  for(const signature of signatures){const original=await f.value('select pg_get_functiondef($1::regprocedure)v',['private.'+signature]);await f.db.exec('alter function private.'+signature+' security definer');assert.equal(await f.helper(request),null,signature+' security drift');await f.db.exec(original);const changed=original.replace(/AS (\$\w*\$)/,'AS $1\n-- synthetic changed body');await f.db.exec(changed);assert.equal(await f.helper(request),null,signature+' body drift');await f.db.exec(original);}
  for(const role of ['anon','authenticated','service_role']){await f.db.exec('set role '+role);await assert.rejects(f.helper(request),e=>e.code==='42501');await f.db.exec('reset role');}
  const actual=await h.call(request);assert.equal(actual.prepared.status,'ready');assert.equal(actual.npgCoverage.currentComplete,false);assert.equal(actual.npgCoverage.previousComplete,false);
 }finally{await f.db.close();}
});

test('invalid immutable shell identity, revision, secondary clocks and native contents remain unusable',async()=>{
 const f=await setup();try{const request=q({includeSecondary:false}),t=await h.template(request);
  await f.db.query('update private.withdraw_prepared_jobs set revision=revision+1 where id=$1',[t.id]);assert.equal(await f.helper(request),null);await f.db.query('update private.withdraw_prepared_jobs set revision=revision-1 where id=$1',[t.id]);
  const dep=await f.value('select dependency v from private.withdraw_prepared_jobs where id=$1',[t.id]);await f.db.query("update private.withdraw_prepared_jobs set dependency='obsolete'where id=$1",[t.id]);assert.equal(await f.helper(request),null);await f.db.query('update private.withdraw_prepared_jobs set dependency=$2 where id=$1',[t.id,dep]);
  await f.db.exec('alter table private.withdraw_prepared_artifacts disable trigger withdraw_prepared_immutable');for(const payload of [{...t.payload,ar:[{}]},{...t.payload,request:{...t.r,account:'OTHER'}},{...t.payload,secondary:{...t.payload.secondary,startAt:'2020-01-01T00:00:00.000Z'}},{...t.payload,secondary:{...t.payload.secondary,complete:true}}]){await f.db.query('update private.withdraw_prepared_artifacts set payload=$2 where id=$1',[t.artifact,payload]);assert.equal(await f.helper(request),null);}await f.db.query('update private.withdraw_prepared_artifacts set payload=$2 where id=$1',[t.artifact,t.payload]);await f.db.exec('alter table private.withdraw_prepared_artifacts enable trigger withdraw_prepared_immutable');assert.equal((await f.helper(request)).prepared.status,'ready');
 }finally{await f.db.close();}
});

test('guarded install and rollback preserve dependency, original metadata and every existing queue/head/artifact value',async()=>{
 const f=await setup(false);try{const request=q({includeSecondary:false}),t=await h.template(request);await h.report('2026-10-19');await h.report('2026-10-20');
  const snapshot=()=>f.value("select jsonb_build_object('jobs',(select jsonb_agg(to_jsonb(j)order by id)from private.withdraw_prepared_jobs j),'heads',(select jsonb_agg(to_jsonb(h)order by job_id)from private.withdraw_prepared_heads h),'artifacts',(select jsonb_agg(to_jsonb(a)order by id)from private.withdraw_prepared_artifacts a),'dependency',private.withdraw_prepared_dependency(),'metadata',(select to_jsonb(p)-'prosrc'from pg_proc p where oid='private.dashboard_withdraw_npg_template_read(jsonb,jsonb,jsonb,jsonb,text)'::regprocedure))v");
  const before=await snapshot();await f.db.exec(maintenance('withdraw-npg-current-window.sql'));assert.deepEqual(await snapshot(),before);const actual=await h.call(request);assert.equal(actual.prepared.generation,t.artifact);assert.deepEqual(withoutPublication(actual),await f.direct(request,t));assert.deepEqual(await snapshot(),before);await f.db.exec(maintenance('withdraw-npg-current-window.rollback.sql'));assert.deepEqual(await snapshot(),before);assert.equal(await f.helper(request),null);
 }finally{await f.db.close();}
});

test('installation and rollback refuse metadata drift and never broaden an unreviewed renderer',async()=>{
 const f=await setup(false);try{const signature='private.withdraw_prepared_render(jsonb,jsonb)',original=await f.value('select pg_get_functiondef($1::regprocedure)v',[signature]);await f.db.exec('alter function '+signature+' cost 101');await assert.rejects(f.db.exec(maintenance('withdraw-npg-current-window.sql')),/install_contract_drift/);await f.db.exec('rollback');await f.db.exec(original);await f.db.exec(maintenance('withdraw-npg-current-window.sql'));
  await f.db.exec('alter function private.dashboard_withdraw_npg_template_read(jsonb,jsonb,jsonb,jsonb,text)security definer');await assert.rejects(f.db.exec(maintenance('withdraw-npg-current-window.rollback.sql')),/rollback_contract_drift/);await f.db.exec('rollback');assert.equal(await f.value("select prosecdef v from pg_proc where oid='private.dashboard_withdraw_npg_template_read(jsonb,jsonb,jsonb,jsonb,text)'::regprocedure"),true);
 }finally{await f.db.close();}
});

test('canonical body or metadata drift changes the actual dependency and cannot reuse an earlier exact shell',async()=>{
 const f=await setup();try{const request=q({includeSecondary:false});await h.template(request);const signature='private.withdraw_prepared_canonical(jsonb)',original=await f.value('select pg_get_functiondef($1::regprocedure)v',[signature]),dep=await f.value('select private.withdraw_prepared_dependency()v');
  assert.equal((await f.helper(request)).prepared.status,'ready');
  await f.db.exec(original.replace(/AS (\$\w*\$)/,'AS $1\n-- synthetic canonical identity drift'));
  assert.notEqual(await f.value('select private.withdraw_prepared_dependency()v'),dep);assert.equal(await f.helper(request),null);
  await f.db.exec(original);assert.equal(await f.value('select private.withdraw_prepared_dependency()v'),dep);assert.equal((await f.helper(request)).prepared.status,'ready');
  await f.db.exec('alter function '+signature+' cost 101');assert.notEqual(await f.value('select private.withdraw_prepared_dependency()v'),dep);assert.equal(await f.helper(request),null);
  await f.db.exec(original);assert.equal(await f.value('select private.withdraw_prepared_dependency()v'),dep);assert.equal((await f.helper(request)).prepared.status,'ready');
 }finally{await f.db.close();}
});
