// Real local PostgreSQL against code-only production definitions; no network or production data.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createRequire}=require('node:module'),{test}=require('node:test');
const repo=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const parent=path.join(__dirname,'auto-withdraw-report-scope-once-sql.test.cjs'),ctx=vm.createContext({__dirname:path.dirname(parent),require:n=>n==='node:test'?{test(){}}:createRequire(parent)(n),structuredClone});vm.runInContext(fs.readFileSync(parent,'utf8').split(/\ntest\(/)[0]+';globalThis.h={fixture,call,scope};',ctx);const H=ctx.h;
const {row}=require('./fixtures/ar-withdraw-fact-projection-harness.cjs');
const migration=read('supabase/migrations/20261012055629_ar_withdraw_parameterized_partition_reads.sql'),baseline=read('tests/fixtures/ar-withdraw-parameterized-partition-production.sql'),sig='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)',gsig='private.ar_historical_duration_generation()';
const info=async(db,s)=>(await db.query("select md5(prosrc)hash,to_jsonb(p)-'prosrc'meta,pg_get_functiondef(oid)d from pg_proc p where oid=$1::regprocedure",[s])).rows[0];
const helper=(db,q,s={mode:'all',countries:[]},from='2026-10-10',to='2026-10-11')=>db.query('select to_jsonb(a)r from private.dashboard_admin_ar_withdraw_days($1,$2,$3::date,$4::date)a order by data_date,country,platform_key',[q,s,from,to]).then(x=>x.rows.map(r=>r.r));
const generations=async db=>(await db.query('select private.ar_withdraw_fact_generation()fact,private.ar_historical_duration_generation()duration')).rows[0];
const sourceState=async db=>(await db.query("select jsonb_build_object('source',(select jsonb_agg(to_jsonb(a)order by order_no)from ar_collected_orders a),'facts',(select jsonb_agg(to_jsonb(f)order by order_no)from private.ar_withdraw_facts f),'ready',(select jsonb_agg(to_jsonb(r)order by platform,data_date)from private.ar_withdraw_fact_ready r),'future',(select jsonb_agg(to_jsonb(r)order by platform)from private.ar_withdraw_fact_future_ready r),'cache',(select jsonb_agg(to_jsonb(c)order by platform,data_date)from private.ar_historical_duration_cache c),'hours',(select jsonb_agg(to_jsonb(h)order by platform,data_date,native_hour)from private.ar_historical_duration_hour_parts h))r")).rows[0].r;
async function fixture(){const db=await H.fixture();try{await db.exec(read('supabase/migrations/20261012052136_auto_withdraw_report_scope_once.sql'));await db.exec(baseline);assert.equal((await info(db,sig)).hash,'b8b971e82282e984bcdfc90c17c9a471');assert.equal((await info(db,gsig)).hash,'7782a45c2346c6b5cecffab74801a324');return db;}catch(e){await db.close();throw e}}
test('parameterized range reads preserve complete main and all 17 helper fields across ready/mixed/raw/invalid-generation paths',async()=>{const db=await fixture();try{
 await db.exec("insert into synthetic_catalog values(md5('lottery')::uuid,'LOTTERY77','M8','印度','IN','ar','Asia/Kolkata','INR','LOTTERY7')");
 for(const[id,platform,time,status,operator]of[
  ['native-midnight','LOTTERY7','2026-10-11 00:00:00','未通过',null],
  ['alias-midnight','LOTTERY77','2026-10-11 00:00:00','驳回','---'],
  ['left-edge','91CLUB','2026-10-10 00:00:00','已通过','system'],
  ['right-edge','91CLUB','2026-10-12 00:00:00','已通过','system'],
  ['null-time','91CLUB',null,'已通过',null],
  ['before-cutover','91CLUB','2026-10-09 23:59:59','未通过',null]])await row(db,'BOUNDARY-'+id,{platform,applied_at:time,completed_at:null,status,operator});
 await db.exec('begin isolation level repeatable read');for(const p of['91CLUB','LOTTERY7','LOTTERY77'])for(const day of['2026-10-10','2026-10-11'])await db.query('select private.approve_ar_withdraw_fact_day($1,$2::date)',[p,day]);await db.exec('commit');
 await db.exec(migration);const candidate=(await info(db,sig)).d,gCandidate=(await info(db,gsig)).d;
 const cases=[];for(const view of['auto','operators'])for(const daily of[false,true])for(const sort of['country','platform','account','total','processed','success','rejected','autoCount','manualCount','avgSeconds','successRate','rejectRate','autoRate','manualRate','previousAvgSeconds','durationChange'])cases.push({view,daily,sort});cases.push({},{platforms:[]},{platform:'91CLUB'},{platform:'Veer.Game'},{platform:'RAJALOTTERY'},{platform:'LOTTERY77'},{platform:'OPERATOR-ONLY'},{view:'operators',account:'Same'},{country:'巴基斯坦'},{offset:20},{endAt:'2026-10-11T23:59:59Z'});
 const scopes=[{mode:'all',countries:[]},{mode:'selected',countries:[],platforms:[]},{mode:'selected',countries:[],platforms:[{country:'IN',platform:'91CLUB'}]},{mode:'selected',countries:[],platforms:[{country:'PK',platform:'92.GAME'}]},null];
 for(const state of['all_ready','mixed_ready','no_receipts','generation_invalid']){
  await db.exec('begin');await db.exec(baseline);if(state==='mixed_ready')await db.exec("delete from private.ar_withdraw_fact_ready where platform='91CLUB'and data_date='2026-10-11';delete from private.ar_withdraw_fact_future_ready where platform='91CLUB'");
  if(state==='no_receipts')await db.exec('delete from private.ar_withdraw_fact_ready;delete from private.ar_withdraw_fact_future_ready');if(state==='generation_invalid')await db.exec('alter table public.ar_collected_orders disable trigger ar_withdraw_fact_sync_update');
  const expected=[];for(const q of cases)expected.push(await H.call(db,q));const expectedHelper=[];for(const s of scopes)for(const q of[{country:'印度'},{country:'印度',view:'operators'},{country:'巴基斯坦'}])expectedHelper.push(await helper(db,q,s));
  const beforeG=await generations(db);await db.exec(candidate);await db.exec(gCandidate);
  for(let i=0;i<cases.length;i++)assert.deepEqual(await H.call(db,cases[i]),expected[i],state+' main '+i);
  let i=0;for(const s of scopes)for(const q of[{country:'印度'},{country:'印度',view:'operators'},{country:'巴基斯坦'}])assert.deepEqual(await helper(db,q,s),expectedHelper[i++],state+' scoped helper '+i);
  assert.deepEqual(await generations(db),beforeG,'no readiness or historical-duration generation change');
  const lottery=(await helper(db,{country:'印度',platform:'LOTTERY77'},undefined,'2026-10-11','2026-10-11'))[0];assert.equal(lottery.total,2);assert.equal(lottery.manual_count,2,'native+display alias retain b8b rejected-unknown manual rule');
  await db.exec('rollback');
 }
 }finally{await db.close()}});
test('actual prepared generic query keeps both readiness lanes behind correlated country/platform/day range scans',async()=>{const db=await fixture();try{
 const aliases=(await db.query("select distinct x.platform from synthetic_catalog c cross join lateral unnest(array[c.source_name,c.name])x(platform)where c.source='ar'and c.scope_group='IN'and x.platform is not null")).rows;await db.exec('begin isolation level repeatable read');for(const x of aliases)for(const day of['2026-10-10','2026-10-11'])await db.query('select private.approve_ar_withdraw_fact_day($1,$2::date)',[x.platform,day]);await db.exec('commit');
 await db.exec(migration);const definition=(await info(db,sig)).d,body=definition.match(/AS (\$[a-z_0-9]*\$)([\s\S]*?)\1/i)[2];let core=body.split(' RETURN QUERY\n')[1].split(';\nEND;')[0];for(const[k,v]of[['p_request','$1'],['p_scope','$2'],['p_start','$3'],['p_end','$4']])core=core.replace(new RegExp('\\b'+k+'\\b','g'),v);
 assert.deepEqual((await db.query("select indnkeyatts,indnatts from pg_index where indexrelid='public.ar_collected_withdraw_report_cover_idx'::regclass")).rows[0],{indnkeyatts:3,indnatts:8});
 // Small fixtures may choose the native PK with an in-scan date filter. The saved production plan confirms the full four-part IndexCond.
 await db.exec('set plan_cache_mode=force_generic_plan;set enable_seqscan=off;prepare ar_parameterized_test(jsonb,jsonb,date,date)as '+core);
 const plan=(await db.query("explain(analyze,format json,timing false)execute ar_parameterized_test('{\"country\":\"印度\",\"view\":\"auto\",\"platforms\":[]}','{\"mode\":\"all\",\"countries\":[]}','2026-10-10','2026-10-11')")).rows[0]['QUERY PLAN'][0].Plan,scans=[];const walk=n=>{if(['ar_collected_orders','ar_withdraw_facts'].includes(n['Relation Name']))scans.push(n);for(const p of n.Plans||[])walk(p)};walk(plan);
 for(const table of['ar_collected_orders','ar_withdraw_facts']){const scan=scans.find(n=>n['Relation Name']===table);assert(scan,table);const identity=scan['Index Cond']||'',bounds=identity+' '+(scan.Filter||'');assert.match(identity,/country_code.*q[._0-9]*\.code|country_code.*q\.code/);assert.match(identity,/platform.*q[._0-9]*\.native_alias|platform.*q\.native_alias/);assert.match(bounds,/applied_at.*q[._0-9]*\.data_date|applied_at.*q\.data_date/)}
 assert.equal(scans.find(n=>n['Relation Name']==='ar_collected_orders')['Actual Loops'],0,'ready-only input does not execute raw fallback');
 }finally{await db.close()}});
test('guarded installation/replay preserves main/reasons, metadata, source/facts/receipts and existing historical duration caches',async()=>{const db=await fixture();try{
 const untouched=['private.dashboard_admin_live_auto_withdraw(jsonb)','private.dashboard_admin_live_withdraw_reasons(jsonb)','private.ar_withdraw_fact_generation()'],old=[];for(const s of untouched)old.push(await info(db,s));const meta=await info(db,sig),gm=await info(db,gsig),stored=await sourceState(db),g=await generations(db);
 await db.exec(migration);assert.equal((await info(db,sig)).hash,'1bfc6398524bc3194b91f1d411960425');assert.deepEqual((await info(db,sig)).meta,meta.meta);assert.deepEqual((await info(db,gsig)).meta,gm.meta);assert.deepEqual(await generations(db),g);assert.deepEqual(await sourceState(db),stored);for(let i=0;i<untouched.length;i++)assert.deepEqual(await info(db,untouched[i]),old[i]);
 await db.exec(migration);assert.deepEqual(await sourceState(db),stored);assert.deepEqual(await generations(db),g);for(const role of['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(()=>helper(db,{country:'印度'}),/permission denied/);await db.exec('reset role')}
 }finally{await db.close()}});
test('unknown bodies, changed OUT/security/ACL/generation validators reject atomically before apply or replay',async()=>{const db=await fixture();try{
 const block=migration.slice(migration.indexOf('do $partition_reads$'),migration.lastIndexOf('commit;'));
 for(const installed of[false,true]){
  if(installed)await db.exec(migration);const expected=await info(db,sig),g=await info(db,gsig);
  for(const change of[expected.d.replace('BEGIN\n','BEGIN\n -- unexpected body drift\n'),'alter function '+sig+'security definer','alter function '+sig+'strict','grant execute on function '+sig+'to authenticated','alter function '+sig+'set search_path=public','alter function '+gsig+'volatile','alter function '+gsig+'security definer','grant execute on function '+gsig+'to service_role']){
   await db.exec('begin');await db.exec(change);await assert.rejects(()=>db.exec(block),/AR_PARTITION_(READER|DURATION_GUARD)_DRIFT/);await db.exec('rollback');assert.deepEqual(await info(db,sig),expected);assert.deepEqual(await info(db,gsig),g);
  }
  await db.exec('begin');await db.exec('drop function '+sig);await db.exec(expected.d.replace('manual_count bigint','renamed_manual bigint'));await assert.rejects(()=>db.exec(block),/AR_PARTITION_READER_DRIFT/);await db.exec('rollback');assert.deepEqual(await info(db,sig),expected);
 }
 }finally{await db.close()}});
