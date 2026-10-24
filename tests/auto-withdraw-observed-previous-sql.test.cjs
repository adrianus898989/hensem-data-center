// Real PostgreSQL semantics in PGlite, exclusively synthetic source-day facts.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const repo=path.join(__dirname,'..');
const baselineTest=path.join(__dirname,'ar-withdraw-previous-basis-sql.test.cjs');
const ctx=vm.createContext({__dirname,require:n=>n==='node:test'?()=>{}:createRequire(baselineTest)(n)});
vm.runInContext(fs.readFileSync(baselineTest,'utf8').split(/\ntest\(/)[0]+';globalThis.h={fixture,call,migration,f:ctx.f};',ctx);
const migration=fs.readFileSync(path.join(repo,'supabase/migrations/20261011115024_auto_withdraw_keep_observed_newar_yash_previous.sql'),'utf8');
const sig='private.dashboard_admin_live_auto_withdraw(jsonb)';
const meta=async db=>(await db.query('select md5(prosrc) hash,to_jsonb(p)-\'prosrc\' metadata from pg_proc p where oid=$1::regprocedure',[sig])).rows[0];
async function fixture(){const db=await ctx.h.fixture();await db.exec("set timezone='UTC'");await db.exec(ctx.h.migration);assert.equal((await meta(db)).hash,'4130899363f159f93450b2915311aa6f');return db;}
const native=(db,source,day,values={})=>ctx.h.f.native(db,source,'SYNTHETIC-'+source,day,{total:100,success:70,rejected:10,auto_count:40,manual_count:50,unclassified_count:10,avg_seconds:12,duration_sample_count:80,duration_total_seconds:960,complete:true,...values});
const call=(db,extra={})=>ctx.h.call(db,extra);
const expectedPrior=source=>({total:100,success:70,rejected:10,autoCount:source==='yash'?null:40,manualCount:source==='yash'?null:50,avgSeconds:12,durationSampleCount:80,durationTotalSeconds:960,durationBasis:source==='yash'?'created_to_completed':'source_submitted_to_handled',coveredDays:1,...(source==='yash'?{source:'KB',classificationAvailable:false,reasonAvailable:true,sourceNotesAvailable:true,unclassifiedCount:100,complete:true,expectedDays:1,latestCollectedAt:'2026-10-10T00:00:00+00:00'}:{})});
function eraseIntentional(next,old){
 const copy=structuredClone(next);copy.comparison.matchedRows=old.comparison.matchedRows;
 for(let i=0;i<copy.rows.length;i++){
  if(copy.rows[i].comparisonBasis==='source_coverage_not_aligned'){
   delete copy.rows[i].comparisonBasis;delete copy.rows[i].comparisonComparable;
   copy.rows[i].previous=old.rows[i].previous;
  }
 }
 return copy;
}
test('known prior facts survive incomplete current coverage without changing totals, counts, basis, or comparison completeness',async()=>{
 const db=await fixture();try{
  for(const source of ['newar','yash']){await native(db,source,'2026-10-09');await native(db,source,'2026-10-10',{complete:false,avg_seconds:null,duration_sample_count:0,duration_total_seconds:null});}
  const before=await call(db);assert(before.rows.every(row=>row.previous===null));await db.exec(migration);const after=await call(db);
  assert.deepEqual(eraseIntentional(after,before),before);assert.equal(after.comparison.complete,false);
  for(const row of after.rows){assert.equal(row.previous.total,100);assert.equal(row.previous.avgSeconds,12);assert.equal(row.avgSeconds,null);assert.equal(row.comparisonComparable,false);assert.equal(row.comparisonBasis,'source_coverage_not_aligned');}
  const n=after.rows.find(r=>r.source==='NEWAR');assert.deepEqual(n.previous,expectedPrior('newar'));
  const y=after.rows.find(r=>r.source==='KB');assert.deepEqual(y.previous,expectedPrior('yash'));
 }finally{await db.close();}
});
test('known nonzero partial prior is retained without claiming a completed period or changing all other JSON',async()=>{
 const db=await fixture();try{
  for(const source of ['newar','yash']){await native(db,source,'2026-10-09',{complete:false});await native(db,source,'2026-10-10');}
  const before=await call(db);await db.exec(migration);const after=await call(db);assert.deepEqual(eraseIntentional(after,before),before);
  for(const row of after.rows){const expected=expectedPrior(row.source==='KB'?'yash':'newar');if(row.source==='KB'){expected.complete=false;expected.coveredDays=0;}assert.deepEqual(row.previous,expected);assert.equal(row.comparisonComparable,false);}
  assert.equal(after.comparison.complete,false);
 }finally{await db.close();}
});
test('incomplete prior observations stay partial and known zero stays zero, with no missing-day fabrication',async()=>{
 const db=await fixture();try{
  for(const source of ['newar','yash']){await native(db,source,'2026-10-09',{total:0,success:0,rejected:0,auto_count:0,manual_count:0,unclassified_count:0,avg_seconds:null,duration_sample_count:0,duration_total_seconds:null,complete:false});await native(db,source,'2026-10-10');}
  await ctx.h.f.native(db,'newar','SYNTHETIC-MISSING','2026-10-10',{total:20});
  const before=await call(db);await db.exec(migration);const after=await call(db);assert.deepEqual(eraseIntentional(after,before),before);
  const missing=after.rows.find(r=>r.platform==='SYNTHETIC-MISSING');assert.equal(missing.previous,null);
  for(const row of after.rows.filter(r=>r.platform!=='SYNTHETIC-MISSING')){assert.equal(row.previous.total,0);assert.equal(row.previous.avgSeconds,null);assert.equal(row.comparisonComparable,false);if(row.source==='KB')assert.equal(row.previous.complete,false);}
  assert.equal(after.comparison.complete,false);
 }finally{await db.close();}
});
test('explicit unknown prior values remain null rather than becoming zero or legacy classified facts',async()=>{
 const db=await fixture();try{
  await native(db,'newar','2026-10-09',{total:null,success:null,rejected:null,auto_count:null,manual_count:null,unclassified_count:null,avg_seconds:null,duration_sample_count:0,duration_total_seconds:null,complete:false});
  await native(db,'newar','2026-10-10');await ctx.h.f.legacy(db,'SYNTHETIC-newar','2026-10-09',999,400,599);
  await db.exec(migration);const after=await call(db),row=after.rows[0];
  assert.equal(row.previous.total,null);assert.equal(row.previous.autoCount,null);assert.equal(row.previous.manualCount,null);assert.equal(row.previous.avgSeconds,null);assert.equal(row.comparisonComparable,false);assert.equal(after.previousTotals.total,null);
 }finally{await db.close();}
});
test('fully aligned sources, unrelated AR/legacy rows, paging and daily/operator presentation keep complete old JSON',async()=>{
 const db=await fixture();try{
  for(const source of ['newar','yash'])for(const day of ['2026-10-09','2026-10-10'])await native(db,source,day,{operator_rows:[{account:'SyntheticOperator',processed:100,success:70,rejected:10,avg_seconds:12,duration_sample_count:80,duration_total_seconds:960,updated_at:'2026-10-11T00:00:00Z'}]});
  await ctx.h.f.native(db,'ar','SYNTHETIC-AR','2026-10-10',{total:30,auto_count:10,manual_count:17,alias_keys:['SYNTHETIC-AR'],complete:false});await ctx.h.f.legacy(db,'SYNTHETIC-AR','2026-10-09',20,5,15);
  await ctx.h.f.legacy(db,'SYNTHETIC-LEGACY','2026-10-09');await ctx.h.f.legacy(db,'SYNTHETIC-LEGACY','2026-10-10');
  for(let i=0;i<23;i++)for(const day of ['2026-10-09','2026-10-10'])await ctx.h.f.legacy(db,'SYNTHETIC-PAGE-'+i,day);
  const requests=[{}, {daily:true}, {view:'operators'}, {view:'operators',account:'SyntheticOperator'}, {platform:'SYNTHETIC-AR'}, {platform:'SYNTHETIC-LEGACY'}, {offset:20,limit:20}];
  const before=[];for(const q of requests)before.push(await call(db,q));await db.exec(migration);for(let i=0;i<requests.length;i++)assert.deepEqual(await call(db,requests[i]),before[i]);
 }finally{await db.close();}
});
test('multi-day and operator prior fields retain their real aggregation and require coverage alignment',async()=>{
 const db=await fixture();try{
  for(const source of ['newar','yash'])for(const day of ['2026-10-08','2026-10-09','2026-10-10','2026-10-11'])await native(db,source,day,{complete:day!=='2026-10-10',operator_rows:[{account:'SyntheticOperator',processed:100,success:70,rejected:10,avg_seconds:12,duration_sample_count:80,duration_total_seconds:960,updated_at:'2026-10-11T00:00:00Z'}]});
  const requests=[{endAt:'2026-10-11T23:59:59Z'}, {endAt:'2026-10-11T23:59:59Z',daily:true}, {view:'operators',account:'SyntheticOperator'}];
  const before=[];for(const q of requests)before.push(await call(db,q));await db.exec(migration);
  for(let i=0;i<requests.length;i++){const after=await call(db,requests[i]);assert.deepEqual(eraseIntentional(after,before[i]),before[i]);for(const row of after.rows.filter(r=>r.comparisonComparable===false)){assert(row.previous);assert.equal(row.previous.avgSeconds,12);}}
 }finally{await db.close();}
});
test('country/platform scope, denied session, aliases and unknown accounts remain fail-closed',async()=>{
 const db=await fixture();try{
  for(const source of ['newar','yash']){await native(db,source,'2026-10-09');await native(db,source,'2026-10-10',{complete:false});}
  await ctx.h.f.native(db,'newar','MAAN.WIN','2026-10-09',{},'MAANWIN');await ctx.h.f.native(db,'newar','MAAN.WIN','2026-10-10',{complete:false},'MAANWIN');
  await db.exec(migration);const alias=await call(db,{platform:'MAANWIN'});assert.equal(alias.rows.length,1);assert.equal(alias.rows[0].platform,'MAAN.WIN');
  await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({targets:[['印度','SYNTHETIC-newar']]})]);assert.deepEqual((await call(db)).rows.map(r=>r.platform),['SYNTHETIC-newar']);assert.deepEqual((await call(db,{view:'operators',account:'Absent'})).rows,[]);
  await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({targets:[]})]);assert.deepEqual((await call(db)).rows,[]);await db.exec("set test.denied='yes'");await assert.rejects(()=>call(db),/synthetic_session_denied/);
 }finally{await db.close();}
});
test('production UI compares observed same-platform shares while preserving unverified source flags, same-basis time samples and unknown YASH methods',async()=>{
 const file=path.join(repo,'tests/admin-withdraw-processing-duration-ui.test.cjs');
 const c=vm.createContext({__dirname:path.dirname(file),require:n=>n==='node:test'?()=>{}:createRequire(file)(n)});
 vm.runInContext(fs.readFileSync(file,'utf8').split("test('WG")[0]+';globalThis.setup=setup;',c);
 for(const source of ['NEWAR','KB']){
  const row={source,country:'印度',platform:'Synthetic',total:100,success:70,rejected:10,autoCount:source==='KB'?null:40,manualCount:source==='KB'?null:50,unclassifiedCount:source==='KB'?100:10,avgSeconds:24,durationBasis:source==='KB'?'created_to_completed':'source_submitted_to_handled',classificationAvailable:source!=='KB',comparisonComparable:false,comparisonBasis:'source_coverage_not_aligned',previous:{total:200,success:120,rejected:10,autoCount:source==='KB'?null:60,manualCount:source==='KB'?null:120,unclassifiedCount:source==='KB'?200:20,avgSeconds:12,durationBasis:source==='KB'?'created_to_completed':'source_submitted_to_handled',classificationAvailable:source!=='KB'}};
  row.complete=false;Object.assign(row.previous,{source,country:row.country,platform:row.platform,complete:false});
  const before=structuredClone(row),f=c.setup({rows:[row],total:1,totals:row,sourceComplete:false,comparison:{complete:false}});f.page.state.data.prepared.sourceComplete=false;
  const beforeData=JSON.stringify(f.page.state.data),html=f.page.render(),cells=f.tables.find(t=>t.headers.some(h=>h.includes('昨日处理用时'))).rows[0];
  const observedShares=source==='KB'?[[4,'70.00%','60.00%','+10.00 pp'],[5,'10.00%','5.00%','+5.00 pp']]:[[4,'70.00%','60.00%','+10.00 pp'],[5,'10.00%','5.00%','+5.00 pp'],[8,'40.00%','30.00%','+10.00 pp'],[9,'50.00%','60.00%','-10.00 pp']];
  for(const [index,current,prior,change]of observedShares){
   assert(cells[index].includes(current),source+' current stored share '+index);
   assert(cells[index].includes('昨日 '+prior),source+' retained prior share '+index);
   assert(cells[index].includes(change),source+' observed same-platform percentage-point change '+index);
   assert.match(cells[index],/按已入库数据计算；两期完整性尚未核验/);assert.doesNotMatch(cells[index],/暂不计算涨跌/);
  }
  assert.match(html,/data-withdraw-publication="subtotal"/);assert.match(html,/数值与涨跌按同平台、同口径的已入库记录计算，不代表全天完整数据；缺值不按零计算/);
  assert.match(cells[10],/24秒/);assert.match(cells[11],/12秒/);assert.match(cells[12],/\+12\.00 秒（\+100\.00%）/);
  assert.match(cells[12],/仅比较同口径有效时间样本，两期完整性尚未核验/);assert.doesNotMatch(cells[12],/ pp/,'time changes use seconds and percent, independently of count shares');
  if(source==='KB'){
   for(const index of [6,7])assert.equal(cells[index],'—','unknown YASH method count remains unknown');
   for(const index of [8,9]){assert.match(cells[index],/^—/);assert.match(cells[index],/对比值未提供/);assert.doesNotMatch(cells[index],/withdraw-delta| pp|0\.00%|NaN|Infinity/);}
   assert.equal(row.autoCount,null);assert.equal(row.manualCount,null);assert.equal(row.previous.autoCount,null);assert.equal(row.previous.manualCount,null);
  }
  assert.deepEqual(row,before,'rendering does not infer or change source facts');assert.equal(JSON.stringify(f.page.state.data),beforeData,'rendering preserves all completeness, comparison and source proof flags');
 }
});
test('guarded patch keeps full function metadata/ACL, replays, and rejects unreviewed body/security drift',async()=>{
 const db=await fixture();try{
  const before=await meta(db);await db.exec(migration);const after=await meta(db);assert.deepEqual(after.metadata,before.metadata);assert.equal(after.hash,'ff95fdfb022b8c4e6696697829372a19');await db.exec(migration);assert.deepEqual(await meta(db),after);
  const priv=(await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('service_role',$1,'execute') service,has_function_privilege('authenticated',$1,'execute') auth",[sig])).rows[0];assert.deepEqual(priv,{anon:false,service:false,auth:true});
  const block=migration.slice(migration.indexOf('do $patch$'),migration.indexOf('\ncommit;'));
  for(const drift of ['alter function '+sig+' set search_path=public','alter function '+sig+' security invoker','grant execute on function '+sig+' to anon']){
   await db.exec('begin');await db.exec(drift);await assert.rejects(()=>db.exec(block),/WITHDRAW_PREVIOUS_METADATA_MISMATCH/);await db.exec('rollback');assert.deepEqual(await meta(db),after);
  }
  const altered=(await db.query("select pg_get_functiondef($1::regprocedure) definition",[sig])).rows[0].definition.replace('declare\n','declare\n -- unreviewed change\n');await db.exec('begin');await db.exec(altered);await assert.rejects(()=>db.exec(block),/WITHDRAW_PREVIOUS_BODY_MISMATCH/);await db.exec('rollback');assert.deepEqual(await meta(db),after);
 }finally{await db.close();}
});
