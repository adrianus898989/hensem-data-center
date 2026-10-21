// Real deployed render/window/receipt SQL with synthetic daily reports only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const base=new Function('require','__dirname',fs.readFileSync(path.join(__dirname,'withdraw-country-serving.test.cjs'),'utf8').split(/\ntest.afterEach/)[0]+';return{install,value,getDb:()=>db};')(require,__dirname);
const sql=read('supabase/maintenance/withdraw-npg-template-serving.sql'),rollback=read('supabase/maintenance/withdraw-npg-template-serving.rollback.sql');
let db;const value=(sql,args=[])=>base.value(sql,args),scope={mode:'all',countries:[]};
const q=(extra={})=>({country:'智利',view:'auto',platforms:['NPG-CHILE'],startAt:'2026-10-20T00:00:00.000Z',endAt:'2026-10-20T23:59:59.000Z',limit:500,...extra});
const call=(request=q())=>value('select private.withdraw_prepared_read($1)v',[request]);
async function install(){
 await base.install();db=base.getDb();await db.exec(read('supabase/maintenance/withdraw-country-serving.sql'));
 await db.exec(read('tests/fixtures/withdraw-npg-serving-functions.oct21.sql'));
 const previous=read('supabase/maintenance/auto-withdraw-team-reuse.sql').match(/CREATE OR REPLACE FUNCTION private\.auto_team_previous_projection\([\s\S]*?END;\$transport\$;/)[0];await db.exec('drop function private.auto_team_previous_projection(jsonb,jsonb,jsonb,jsonb);'+previous);
 await db.exec(`revoke all on function private.withdraw_prepared_render(jsonb,jsonb),private.withdraw_window_result(jsonb,jsonb,jsonb),private.auto_team_previous_projection(jsonb,jsonb,jsonb,jsonb)from public,anon,authenticated,service_role;
 create table public.npg_withdraw_daily(country_code text,stat_date date,platform text,run_id uuid,source_run_id uuid,observed_at timestamptz,source_order_count bigint,total_count bigint,paid_count bigint,rejected_count bigint,pending_count bigint,unknown_count bigint,legacy_rejected_count bigint,legacy_non_rejected_count bigint,auto_count bigint,manual_count bigint,unknown_operator_count bigint,handle_count bigint,total_handle_seconds numeric);
 create table public.npg_operator_daily(country_code text,stat_date date,platform text,run_id uuid,observed_at timestamptz,operator_key text,processed_count bigint,legacy_rejected_count bigint,handle_count bigint,total_handle_seconds numeric);
 create table private.npg_summary_heads(country_code text,stat_date date,task text,run_id uuid,observed_at timestamptz);
 create table private.npg_summary_receipts(country_code text,stat_date date,task text,run_id uuid,source_run_id uuid,observed_at timestamptz,source_order_count bigint,credential_hash text,received_at timestamptz);
 create table public.npg_order_coverage(country_code text,stat_date date,order_kind text,run_id uuid,observed_at timestamptz,order_count bigint,batch_count bigint,completed_at timestamptz);
 create table private.npg_ingest_runs(country_code text,stat_date date,order_kind text,run_id uuid,observed_at timestamptz,order_count bigint,batch_count bigint,completed_at timestamptz,status text,credential_hash text);`);
}
async function report(day,total=222,auto=166,country='CL',platform='NPG-CHILE'){
 const run=await value('select gen_random_uuid()v'),source=await value('select gen_random_uuid()v'),observed=new Date(Date.parse(day+'T06:05:00Z')+86400000).toISOString(),manual=total-auto;
 for(const table of ['public.npg_withdraw_daily','public.npg_operator_daily','private.npg_summary_heads'])await db.query('delete from '+table+' where country_code=$1 and stat_date=$2',[country,day]);
 await db.query(`insert into public.npg_withdraw_daily values($1,$2,$3,$4,$5,$6,$7,$7,$7,0,0,0,0,$7,$8,$9::bigint,0,$9::bigint,$9::bigint*10);
 `,[country,day,platform,run,source,observed,total,auto,manual]);
 await db.query('insert into public.npg_operator_daily values($1,$2,$3,$4,$5,$6,$7::bigint,0,$7::bigint,$7::bigint*10)',[country,day,platform,run,observed,'SYNTHETIC-OP',manual]);
 await db.query("insert into private.npg_summary_heads values($1,$2,'withdraw_daily',$3,$4)",[country,day,run,observed]);
 await db.query("insert into private.npg_summary_receipts values($1,$2,'withdraw_daily',$3,$4,$5,$6,'SYNTHETIC',$5)",[country,day,run,source,observed,total]);
 await db.query("insert into public.npg_order_coverage values($1,$2,'withdraw',$3,$4,$5,1,$4)",[country,day,source,observed,total]);
 await db.query("insert into private.npg_ingest_runs values($1,$2,'withdraw',$3,$4,$5,1,$4,'complete','SYNTHETIC')",[country,day,source,observed,total]);
}
async function template(request=q()){
 const r=await value('select private.withdraw_prepared_canonical($1)v',[{...request,platforms:[]}]),c=[];
 const id=await value('select private.withdraw_prepared_enqueue($1,$2,$3,private.withdraw_prepared_dependency())v',[r,scope,c]);
 const payload=await value('select private.withdraw_prepared_compute($1,$2,$3)v',[r,scope,c]);
 const artifact=await value("insert into private.withdraw_prepared_artifacts(job_id,revision,fence,run_id,dependency,payload,computed_at,expires_at,bytes)select id,revision,1,gen_random_uuid(),dependency,$2,clock_timestamp()-interval'1hour',clock_timestamp()-interval'50minutes',octet_length($2::jsonb::text)from private.withdraw_prepared_jobs where id=$1 returning id v",[id,payload]);
 await db.query('insert into private.withdraw_prepared_heads values($1,$2)',[id,artifact]);await db.query("update private.withdraw_prepared_jobs set status='failed',attempts=3,last_error='staged_source_expired'where id=$1",[id]);return{id,artifact,payload,r};
}
test.afterEach(async()=>{await db?.close();db=null;});
test('NPG singleton immediately reuses the template and preserves complete current/prior/windows DTO',async()=>{
 await install();await report('2026-10-19',197,150);await report('2026-10-20');const t=await template(),dep=await value('select private.withdraw_prepared_dependency()v');
 const expected=await value('select private.withdraw_window_result(private.withdraw_prepared_canonical($1),private.withdraw_prepared_render(private.withdraw_window_legacy($1),$2),$2)v',[q(),t.payload]);
 await db.exec(sql);const actual=await call();assert.equal(actual.prepared.status,'ready');assert.equal(actual.prepared.generation,t.artifact);assert.equal(actual.prepared.freshness,'refresh_due');assert.equal(actual.prepared.refreshState,'failed');assert.deepEqual({...actual,prepared:undefined},{...expected,prepared:undefined});
 assert.equal(actual.totals.total,222);assert.equal(actual.totals.autoCount,166);assert.equal(actual.totals.manualCount,56);assert.equal(actual.previousTotals.total,197);assert.deepEqual(actual.secondary.rows,[]);assert.equal(actual.secondary.complete,false);assert.equal(actual.npgCoverage.currentComplete,true);assert.equal(actual.npgCoverage.previousComplete,true);
 assert.equal(await value('select private.withdraw_prepared_dependency()v'),dep);assert.equal(await value('select count(*)v from private.withdraw_prepared_jobs'),1);
 assert.deepEqual((await db.query('select status,attempts,last_error from private.withdraw_prepared_jobs where id=$1',[t.id])).rows[0],{status:'failed',attempts:3,last_error:'staged_source_expired'});
 const times=await value("select jsonb_build_object('computedAt',computed_at,'expiresAt',expires_at)v from private.withdraw_prepared_artifacts where id=$1",[t.artifact]);assert.equal(actual.prepared.computedAt,times.computedAt);assert.equal(actual.prepared.expiresAt,times.expiresAt);
});

test('all three pinned countries preserve the independent secondary window and requested view metadata',async()=>{
 await install();const cases=[];
 for(const[country,code,platform]of[['哥伦比亚','CO','NPG-COLOMBIA'],['墨西哥','MX','NPG-MEXICO'],['智利','CL','NPG-CHILE']]){
  const request=q({country,platforms:[platform],successStartAt:'2026-10-18T02:00:00.000Z',successEndAt:'2026-10-19T03:00:00.000Z',successBasis:'source_updated',windowVersion:2});
  await report('2026-10-19',197,150,code,platform);await report('2026-10-20',222,166,code,platform);const t=await template(request);cases.push({request,t});
 }
 await db.exec(sql);
 for(const{request,t}of cases){const expected=await value('select private.withdraw_window_result(private.withdraw_prepared_canonical($1),private.withdraw_prepared_render(private.withdraw_window_legacy($1),$2),$2)v',[request,t.payload]),actual=await call(request);assert.equal(actual.prepared.generation,t.artifact);delete actual.prepared;assert.deepEqual(actual,expected);assert.equal(actual.secondary.startAt,request.successStartAt);assert.equal(actual.secondary.endAt,request.successEndAt);assert.equal(actual.windows.creationStartAt,request.startAt);assert.equal(actual.previousTotals.total,197);}
 assert.equal(await value('select count(*)v from private.withdraw_prepared_jobs'),3);
});

for(const missing of ['current','previous','invalid-receipt'])test('NPG '+missing+' stays unavailable when reusing a valid native shell',async()=>{
 await install();if(missing!=='previous')await report('2026-10-19',197,150);if(missing!=='current')await report('2026-10-20');const t=await template();await db.exec(sql);
 if(missing==='invalid-receipt')await db.exec("update private.npg_summary_receipts set source_order_count=999 where stat_date='2026-10-20'");
 const expected=await value('select private.withdraw_window_result(private.withdraw_prepared_canonical($1),private.withdraw_prepared_render(private.withdraw_window_legacy($1),$2),$2)v',[q(),t.payload]),actual=await call();assert.equal(actual.prepared.generation,t.artifact);delete actual.prepared;assert.deepEqual(actual,expected);
 assert.equal(actual.npgCoverage[missing==='previous'?'previousComplete':'currentComplete'],false);assert.equal(actual.comparison.complete,false);assert.equal(await value('select count(*)v from private.withdraw_prepared_jobs'),1);
});

test('verified NPG source heads remain live without changing the shell generation',async()=>{
 await install();await report('2026-10-19',197,150);const t=await template();await db.exec(sql);const before=await call();assert.equal(before.npgCoverage.currentComplete,false);
 await report('2026-10-20');const after=await call();assert.equal(after.prepared.generation,t.artifact);assert.equal(after.totals.total,222);assert.equal(after.npgCoverage.currentComplete,true);
 await report('2026-10-20',250,170);const replaced=await call();assert.equal(replaced.prepared.generation,t.artifact);assert.equal(replaced.totals.total,250);assert.equal(replaced.previousTotals.total,197);assert.equal(replaced.prepared.expiresAt,after.prepared.expiresAt);
});

test('unknown platform, changed query clocks/account/view and assigned scope retain normal admission',async()=>{
 await install();const t=await template();await db.exec(sql);
 const changes=[{platforms:['NPG-MEXICO']},{platforms:['NPG-CHILE','OTHER']},{country:'哥伦比亚',platforms:['NPG-COLOMBIA']},{startAt:'2026-10-19T00:00:00.000Z'},{successStartAt:'2026-10-18T00:00:00.000Z',successEndAt:'2026-10-18T23:59:59.000Z',windowVersion:2,successBasis:'success'},{account:'SYNTHETIC-OTHER'},{view:'operators'},{startAt:'2026-10-20T12:00:00.000Z'}];
 for(const change of changes){const before=await value('select count(*)v from private.withdraw_prepared_jobs'),r=await call(q(change));assert.notEqual(r.prepared.status,'ready');assert.equal(r.rows,null);assert.equal(await value('select count(*)v from private.withdraw_prepared_jobs'),before+1);await call(q(change));assert.equal(await value('select count(*)v from private.withdraw_prepared_jobs'),before+1);}
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({mode:'selected',countries:['智利']})]);assert.notEqual((await call()).prepared.status,'ready');
 assert.equal(await value('select artifact_id v from private.withdraw_prepared_heads where job_id=$1',[t.id]),t.artifact);
});

for(const change of ['native-catalog','revision','dependency','missing-head','native-payload','secondary-window','source-contract'])test('NPG '+change+' drift cannot borrow the template',async()=>{
 await install();const t=await template();await db.exec(sql);
 if(change==='native-catalog')await db.exec("insert into public.synthetic_catalog values('00000000-0000-4000-8000-000000000444','NEW-CL','M8','智利','CL','ar','America/Santiago','CLP','NEW-CL')");
 if(change==='revision')await db.query('update private.withdraw_prepared_jobs set revision=revision+1 where id=$1',[t.id]);
 if(change==='dependency')await db.query("update private.withdraw_prepared_jobs set dependency='obsolete'where id=$1",[t.id]);
 if(change==='missing-head')await db.query('delete from private.withdraw_prepared_heads where job_id=$1',[t.id]);
 if(change==='source-contract')await db.exec('alter function private.npg_withdraw_report_snapshots(date,date,jsonb,jsonb,jsonb)security definer');
 if(['native-payload','secondary-window'].includes(change)){await db.exec('alter table private.withdraw_prepared_artifacts disable trigger withdraw_prepared_immutable');await db.query(change==='native-payload'?"update private.withdraw_prepared_artifacts set payload=jsonb_set(payload,'{ar}','[{}]'::jsonb)where id=$1":"update private.withdraw_prepared_artifacts set payload=jsonb_set(payload,'{secondary,startAt}','\"2020-01-01T00:00:00.000Z\"'::jsonb)where id=$1",[t.artifact]);}
 const actual=await call();assert.notEqual(actual.prepared.status,'ready');assert.equal(actual.rows,null);
});

test('permission checks precede template serving; helper remains private',async()=>{
 await install();await template();await db.exec(sql);await db.exec("set test.denied='yes'");await assert.rejects(call(),/denied/);assert.equal(await value('select count(*)v from private.withdraw_prepared_jobs'),1);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await value("select has_function_privilege($1,'private.dashboard_withdraw_npg_template_read(jsonb,jsonb,jsonb,jsonb,text)','EXECUTE')v",[role]),false);
});

test('guarded rollback restores the reader and preserves all immutable and retry state',async()=>{
 await install();const t=await template(),dep=await value('select private.withdraw_prepared_dependency()v');await db.exec(sql);await call();await db.exec(rollback);assert.equal(await value("select md5(prosrc)v from pg_proc where oid='private.withdraw_prepared_read(jsonb)'::regprocedure"),'d994db6ea7d4b7ed4d4ae627aabf803f');assert.equal(await value('select private.withdraw_prepared_dependency()v'),dep);assert.equal(await value('select artifact_id v from private.withdraw_prepared_heads where job_id=$1',[t.id]),t.artifact);assert.equal(await value('select attempts v from private.withdraw_prepared_jobs where id=$1',[t.id]),3);
});

for(const change of ['helper-body','helper-security'])test('rollback refuses later '+change+' changes',async()=>{
 await install();await template();await db.exec(sql);
 if(change==='helper-security')await db.exec('alter function private.dashboard_withdraw_npg_template_read(jsonb,jsonb,jsonb,jsonb,text)security definer');
 else{const d=await value("select pg_get_functiondef('private.dashboard_withdraw_npg_template_read(jsonb,jsonb,jsonb,jsonb,text)'::regprocedure)v");await db.exec(d.replace('declare base_request','-- synthetic later change\ndeclare base_request'));}
 await assert.rejects(db.exec(rollback),/withdraw_npg_template_rollback_helper_drift/);await db.exec('rollback');assert.notEqual(await value("select to_regprocedure('private.dashboard_withdraw_npg_template_read(jsonb,jsonb,jsonb,jsonb,text)')::text v"),null);
});
