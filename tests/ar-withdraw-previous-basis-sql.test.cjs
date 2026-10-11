// Synthetic source-day facts; no production data, tokens or source login.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const source=path.join(__dirname,'auto-withdraw-canonical-partial-classification-sql.test.cjs');
const ctx=vm.createContext({__dirname,require:n=>n==='node:test'?()=>{}:createRequire(source)(n)});
vm.runInContext(fs.readFileSync(source,'utf8').split(/\ntest\(/)[0]+'\nglobalThis.f={fixture,native,legacy,meta};',ctx);
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const baseline=read('tests/fixtures/ar-withdraw-previous-production.sql');
const migration=read('supabase/migrations/20261011104320_ar_withdraw_keep_reported_previous.sql');
const sig='private.dashboard_admin_live_auto_withdraw(jsonb)';
const request=extra=>({country:'印度',startAt:'2026-10-10T00:00:00Z',endAt:'2026-10-10T23:59:59Z',limit:20,...extra});
const call=async(db,q={})=>(await db.query('select private.dashboard_admin_live_auto_withdraw($1::jsonb) r',[JSON.stringify(request(q))])).rows[0].r;
async function fixture(){
 const db=await ctx.f.fixture();
 await db.exec(read('supabase/migrations/20261010111216_auto_withdraw_canonical_partial_classification.sql'));
 await db.exec(`create function private.dashboard_admin_ar_withdraw_days(r jsonb,s jsonb,a date,b date)
 returns table(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,auto_count bigint,manual_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb,alias_keys text[])
 language sql stable set search_path='' as $$select n.data_date,n.country,n.platform,private.dashboard_admin_live_withdraw_key(n.platform),f.*
 from private.synthetic_native_days n cross join lateral jsonb_to_record(n.payload)f(total bigint,success bigint,rejected bigint,auto_count bigint,manual_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb,alias_keys text[])
 where n.source='ar' and n.data_date between greatest(a,date '2026-10-10') and b and private.synthetic_selected(r,s,n.country,n.platform,n.source_platform)$$;`);
 await db.exec(baseline);assert.equal((await ctx.f.meta(db,sig)).hash,'f9ac67304f2b5fae66a8b35f080ab981');return db;
}
const ar=async(db,p='91CLUB',date='2026-10-10',extra={})=>ctx.f.native(db,'ar',p,date,{total:30,success:25,rejected:2,auto_count:10,manual_count:17,avg_seconds:5,duration_sample_count:20,duration_total_seconds:100,complete:false,alias_keys:[p],...extra});
function stripIntentional(newValue,oldValue){
 const copy=structuredClone(newValue);copy.comparison.matchedRows=oldValue.comparison.matchedRows;
 for(const r of copy.rows)if(r.source==='AR'){delete r.comparisonComparable;delete r.comparisonBasis;r.previous=null;}
 return copy;
}
test('existing prior daily values and duration basis remain visible without certifying comparison or changing any other JSON',async()=>{
 const db=await fixture();try{
  await ar(db);await ctx.f.legacy(db,'91CLUB','2026-10-09',20,5,15);
  const before=await call(db);assert.equal(before.rows[0].previous,null);await db.exec(migration);const after=await call(db);
  assert.deepEqual(after.rows[0].previous,{total:20,success:20,rejected:0,autoCount:5,manualCount:15,avgSeconds:12,durationSampleCount:20,durationTotalSeconds:240,durationBasis:'source_reported_processing',coveredDays:1});
  assert.equal(after.rows[0].durationBasis,'applied_to_completed');assert.equal(after.rows[0].comparisonComparable,false);
  assert.equal(after.rows[0].comparisonBasis,'unverified_source_continuity');assert.equal(after.rows[0].complete,false);assert.equal(after.rows[0].sourceCompletenessVerified,false);
  assert.equal(after.comparison.complete,false);assert.equal(after.comparison.matchedRows,1);assert.equal(after.arCoverage.complete,false);
  assert.deepEqual(stripIntentional(after,before),before);
 }finally{await db.close();}
});
test('absent prior remains null, observed zero survives, and missing current duration does not erase known prior duration',async()=>{
 const db=await fixture();try{
  await ar(db,'ABSENT');await ar(db,'ZERO');await ar(db,'NULL-CURRENT','2026-10-10',{avg_seconds:null,duration_sample_count:0,duration_total_seconds:null});
  await ctx.f.legacy(db,'ZERO','2026-10-09',0,0,0);await ctx.f.legacy(db,'NULL-CURRENT','2026-10-09');
  const before=await call(db);await db.exec(migration);const r=await call(db);
  assert.equal(r.rows.find(x=>x.platform==='ABSENT').previous,null);
  const zero=r.rows.find(x=>x.platform==='ZERO').previous;assert.equal(zero.total,0);assert.equal(zero.autoCount,0);assert.equal(zero.avgSeconds,null);
  const unknown=r.rows.find(x=>x.platform==='NULL-CURRENT');assert.equal(unknown.avgSeconds,null);assert.equal(unknown.previous.avgSeconds,12);assert.equal(unknown.comparisonComparable,false);
  assert.deepEqual(stripIntentional(r,before),before);
 }finally{await db.close();}
});
test('same raw basis and multi-day daily presentation still require completeness and preserve their original prior facts',async()=>{
 const db=await fixture();try{
  for(const date of ['2026-10-10','2026-10-11','2026-10-12'])await ar(db,'91CLUB',date);
  await db.exec(migration);
  for(const q of [{startAt:'2026-10-11T00:00:00Z',endAt:'2026-10-11T23:59:59Z'},{startAt:'2026-10-11T00:00:00Z',endAt:'2026-10-12T23:59:59Z',daily:true}]){
   const r=await call(db,q);assert(r.rows.every(x=>x.previous?.durationBasis==='applied_to_completed'&&x.comparisonComparable===false&&x.complete===false));assert.equal(r.comparison.complete,false);
  }
 }finally{await db.close();}
});
test('duration-change sorting never evaluates cross-basis deltas; ordinary prior duration sorting keeps actual values',async()=>{
 const db=await fixture();try{
  await ar(db,'ZZZ','2026-10-10',{avg_seconds:100});await ar(db,'AAA','2026-10-10',{avg_seconds:1});
  await ctx.f.legacy(db,'ZZZ','2026-10-09',20);await ctx.f.legacy(db,'AAA','2026-10-09',20);
  await db.exec("update auto_withdraw_daily set avg_seconds=1 where platform='ZZZ';update auto_withdraw_daily set avg_seconds=100 where platform='AAA'");
  await db.exec(migration);
  for(const ascending of [true,false])assert.deepEqual((await call(db,{sort:'durationChange',ascending})).rows.map(x=>x.platform),['AAA','ZZZ']);
  assert.deepEqual((await call(db,{sort:'previousAvgSeconds',ascending:false})).rows.map(x=>x.platform),['AAA','ZZZ']);
 }finally{await db.close();}
});
test('platform/date/account scope remains enforced and non-AR source JSON remains byte-for-byte equivalent',async()=>{
 const db=await fixture();try{
  await ar(db);await ctx.f.legacy(db,'91CLUB','2026-10-09');
  for(const date of ['2026-10-09','2026-10-10']){await ctx.f.native(db,'newar','MAAN.WIN',date,{},'MAANWIN');await ctx.f.native(db,'yash','YASH.BET',date,{});await ctx.f.legacy(db,'LEGACY',date);}
  const qs=[{platform:'MAAN.WIN'},{platform:'YASH.BET'},{platform:'LEGACY'},{platform:'ABSENT'},{view:'operators',account:'ABSENT'}],before=[];
  for(const q of qs)before.push(await call(db,q));await db.exec(migration);for(let i=0;i<qs.length;i++)assert.deepEqual(await call(db,qs[i]),before[i]);
  await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({targets:[['印度','91CLUB']]})]);const r=await call(db);assert.deepEqual(r.rows.map(x=>x.platform),['91CLUB']);assert.equal(r.rows[0].previous.total,20);
  await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({targets:[]})]);assert.deepEqual((await call(db)).rows,[]);
  await db.exec("set test.denied='yes'");await assert.rejects(()=>call(db),/synthetic_session_denied/);
 }finally{await db.close();}
});
test('migration preserves the exact metadata/ACL and replay while all ordinary business totals are unchanged',async()=>{
 const db=await fixture();try{await ar(db);await ctx.f.legacy(db,'91CLUB','2026-10-09');const before=await ctx.f.meta(db,sig);await db.exec(migration);const after=await ctx.f.meta(db,sig);assert.equal(after.hash,'4130899363f159f93450b2915311aa6f');assert.deepEqual(after.metadata,before.metadata);await db.exec(migration);assert.deepEqual(await ctx.f.meta(db,sig),after);
  const p=(await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('service_role',$1,'execute') service,has_function_privilege('authenticated',$1,'execute') auth",[sig])).rows[0];assert.deepEqual(p,{anon:false,service:false,auth:true});
 }finally{await db.close();}
});
test('body/config/security/ACL drift fails closed before replacement, including on replay',async()=>{
 const db=await fixture();try{for(const drift of [baseline.replace('declare\n','declare\n -- unknown change\n'),"alter function "+sig+" set search_path=public",'alter function '+sig+' security invoker','grant execute on function '+sig+' to anon']){
  await db.exec('begin');await db.exec(drift);const before=await ctx.f.meta(db,sig);await assert.rejects(()=>db.exec(migration.slice(migration.indexOf('do $patch$'),migration.indexOf('\ncommit;'))),/AR_PREVIOUS_(?:METADATA|BODY)_MISMATCH/);await db.exec('rollback');assert.equal((await ctx.f.meta(db,sig)).hash,'f9ac67304f2b5fae66a8b35f080ab981');assert(before);
 }}finally{await db.close();}
});
