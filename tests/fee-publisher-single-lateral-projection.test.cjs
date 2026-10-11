// Offline real PostgreSQL tests. Every input is synthetic; no production calls.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const repo=path.join(__dirname,'..'),meta={signature:'public.fee_rate_publish_generation(uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb)',before_md5:'1da790f7dc39d5f58d7444dc1fcff4bc',after_md5:'e8138a9e0026e2b1fca10181abe34bee'};
const migration=fs.readFileSync(path.join(repo,'supabase/migrations/20261011130504_fee_publisher_single_lateral_projection.sql'),'utf8');
const patch=migration.match(/do \$fee_lateral_projection\$[\s\S]*?end \$fee_lateral_projection\$;/)[0];
const originalMigration=fs.readFileSync(path.join(repo,'supabase/migrations/20261002094103_fee_unchanged_content_publication.sql'),'utf8');
const originalDefinition=originalMigration.match(/execute \$candidate\$([\s\S]*?)\$candidate\$;/)[1];
const signature=meta.signature;
let setup,fixture,db;
const registered=[];
const filename=path.join(repo,'tests/fee-unchanged-publication.test.cjs'),req=createRequire(filename);
const context={require:n=>n==='node:test'?{test:(name,fn)=>registered.push([name,fn]),before:fn=>setup=fn,after(){}}:req(n),__dirname:path.dirname(filename),process,console,structuredClone,performance};
vm.createContext(context);
// Reuse the complete existing publisher regressions under the candidate. The
// one explicit current-body assertion must assert the candidate's fingerprint.
const fixtureSource=fs.readFileSync(filename,'utf8');
const oldAssertion="),'1da790f7dc39d5f58d7444dc1fcff4bc');";
assert.equal(fixtureSource.split(oldAssertion).length-1,1);
vm.runInContext(fixtureSource.replace(oldAssertion,"),'"+meta.after_md5+"');")+'\nglobalThis.fixture={get db(){return db},get f(){return f},snapshot,writes,clearWrites};',context,{filename});
before(async()=>{await setup();fixture=context.fixture;db=fixture.db;await db.exec(migration)});
after(()=>db?.close());
for(const [name,fn]of registered)test('existing semantics under LATERAL: '+name,fn);
const scalar=(sql,args=[])=>fixture.f.scalar(sql,args),rollback=fn=>fixture.f.rollback(fn);
const publisher=x=>fixture.f.publish(x),input=(...args)=>fixture.f.input(...args);
const metadata=()=>scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid=$1::regprocedure",[signature]);
const state=()=>scalar(`select jsonb_build_object(
 'rates',(select jsonb_agg(to_jsonb(r) order by id) from third_party_rates r),
 'statuses',(select jsonb_agg(to_jsonb(s) order by id) from third_party_platform_status s),
 'evidence',(select jsonb_agg(to_jsonb(e) order by source_id,direction) from private.fee_rate_current_evidence e),
 'versions',(select jsonb_agg(to_jsonb(v) order by rule_key,effective_from,id) from private.fee_rate_versions v),
 'generations',(select jsonb_agg(to_jsonb(g) order by id) from private.fee_rate_generations g),
 'head',(select jsonb_agg(to_jsonb(h) order by source_key) from private.fee_rate_head h),
 'sync',(select jsonb_agg(to_jsonb(s) order by module) from sync_status s),
 'writeAudit',(select jsonb_agg(to_jsonb(w) order by table_name,operation) from private.fee_write_audit w))`);
function normalize(value,now,versionIds){
 if(value===now)return '$publisher_statement_timestamp';
 if(typeof value==='string'&&versionIds.has(value))return versionIds.get(value);
 if(Array.isArray(value))return value.map(x=>normalize(x,now,versionIds));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['projection_hash','evidence_hash'].includes(k)).map(([k,v])=>[k,normalize(v,now,versionIds)]));
 return value;
}
async function fullResult(x){
 const receipt=await publisher(x),snapshot=await state();
 const anchor=snapshot.generations.find(g=>g.id===x.id).published_at;
 assert.equal(await scalar(`select bool_and(h.projection_hash=private.fee_rate_snapshot_hashes(h.source_key)->>'projection'
 and h.evidence_hash=private.fee_rate_snapshot_hashes(h.source_key)->>'evidence') from private.fee_rate_head h`),true);
 // Fresh versions receive random UUIDs in both unchanged implementations.
 // Compare their exact semantic identity, remapping every FK and quote ID to
 // that identity. Retained/new rows and all their remaining fields still match.
 const versionIds=new Map((snapshot.versions||[]).map(v=>[v.id,JSON.stringify([v.rule_key,v.effective_from])]));
 assert.equal(new Set(versionIds.values()).size,versionIds.size);
 const quote=await fixture.f.quote();
 for(const id of quote.fee_version_ids)assert(versionIds.has(id));
 return {receipt,state:normalize(snapshot,anchor,versionIds),quote:normalize(quote,anchor,versionIds)};
}
async function differential(x){
 await db.exec(originalDefinition);await db.exec('savepoint before_publication');
 const original=await fullResult(x);await db.exec('rollback to before_publication');
 await db.exec(patch);const optimized=await fullResult(x);
 // Each statement has its own actual publication time. Values at that exact
 // instant are normalized; both actual hash fingerprints are verified above.
 assert.deepEqual(optimized,original);
}
test('full result parity: first publication keeps all typed/null fields, unknown fields ignored, source timestamps overridden',async()=>rollback(async()=>{
 const f=fixture.f,x=input([
  f.rate({id:'r-null',category:null,total_fee:null,collect_limit:null,payout_limit:'1-5000',source_row:'4',status:null,created_at:'1900-01-01Z',updated_at:'1900-01-01Z',ignored:'synthetic'}),
  f.rate({id:'r-multilingual',third_party:'合成Pay',collect_fee:'2.345%',collect_single_fee:'8.000',channel_info:'BANK / UPI',leak:'',whitelist:null})
 ],[f.evidence({id:'r-null'}),f.evidence({id:'r-multilingual',currency:'INR'})]);
 x.status=[{...x.status[0],source_row:'12',source_column:'0',raw_status:null,collect_fee:null,created_at:'1900-01-01Z',updated_at:'1900-01-01Z',ignored:'synthetic'},{...x.status[0],id:'s-second',platform:'第二合成平台',category:null}];
 await differential(x);
 assert.equal(await scalar("select source_row from third_party_rates where id='r-null'"),4);
 assert.equal(await scalar("select raw_status from third_party_platform_status where id='status'"),null);
}));
test('full result parity: existing-row upsert retains created time, updates every field, removes absent rows, and keeps historical versions',async()=>rollback(async()=>{
 const f=fixture.f,first=input([f.rate(),f.rate({id:'removed',third_party:'RemovedPay'})],[f.evidence(),f.evidence({id:'removed'})]);
 first.status.push({...first.status[0],id:'removed-status'});await publisher(first);
 const created=await scalar("select created_at::text from third_party_rates where id='rate'");
 const x=input([f.rate({collect_fee:'4.25%',payout_fee:'5%',collect_single_fee:'12',payout_single_fee:'3',country:'IN',category:'QR',channel_info:'changed',source_row:20,status:'disabled',leak:'synthetic',whitelist:'synthetic'})],[f.evidence({effectiveFrom:'2026-09-19T12:00:00Z',currency:'INR',effectiveCell:'BC20'})]);
 x.status[0]={...x.status[0],sheet_name:'Synthetic',country:'IN',platform:'Changed',category:'QR',third_party:'ChangedPay',collect_fee:'2%',payout_fee:'3%',total_fee:'',collect_single_fee:'4',payout_single_fee:'5',collect_limit:'100-1000',payout_limit:'200-5000',status:'disabled',raw_status:'off',source_row:20,source_column:7};
 await differential(x);assert.equal(await scalar("select created_at::text from third_party_rates where id='rate'"),created);
 assert.equal(await scalar("select count(*)::int from third_party_rates where id='removed'"),0);
 assert.equal(await scalar("select count(*)::int from third_party_platform_status where id='removed-status'"),0);
}));
test('full result parity: unchanged observations and exact generation retries retain zero writes',async()=>rollback(async()=>{
 await publisher(input());await fixture.clearWrites();const x=input();await differential(x);
 assert.equal((await publisher(x)).unchanged,true);assert.equal(await fixture.writes(),0);
}));
test('full result parity: damaged current projections/evidence still take full repair path',async()=>rollback(async()=>{
 await publisher(input());await db.exec("delete from third_party_platform_status;update private.fee_rate_current_evidence set state='synthetic-drift'");await differential(input());
}));
test('full result parity: conflicting history, unparseable prices and missing effective time stay unknown',async()=>rollback(async()=>{
 await publisher(input());const f=fixture.f;
 await differential(input([f.rate({collect_fee:'阶梯费率',collect_single_fee:'unknown',payout_fee:'9%'})],[f.evidence({effectiveFrom:null,state:'missing_effective_time'})]));
}));
test('full publisher projection parity at production-shaped row counts, without claiming production timing',async()=>rollback(async()=>{
 const f=fixture.f,rates=Array.from({length:538},(_,i)=>f.rate({id:'r-'+i,third_party:'SyntheticPay'+i,source_row:i+2}));
 const x=input(rates,rates.map(r=>f.evidence({id:r.id,effectiveFrom:null,state:'missing_effective_time'})));
 x.status=Array.from({length:5431},(_,i)=>({...x.status[0],id:'s-'+i,platform:'SyntheticPlatform'+i%20,source_row:i+2,source_column:i%100}));
 await differential(x);assert.equal(await scalar('select count(*)::int from third_party_rates'),538);assert.equal(await scalar('select count(*)::int from third_party_platform_status'),5431);
}));
test('malformed typed conversion rolls back the complete publication identically',async()=>rollback(async()=>{
 await publisher(input());const before=await state(),x=input();x.status[0].source_column='not-an-integer';
 for(const candidate of [false,true]){
  await db.exec(originalDefinition);if(candidate)await db.exec(patch);await db.exec('savepoint rejected_typed');
  await assert.rejects(publisher(x),e=>e.code==='22P02');await db.exec('rollback to rejected_typed');assert.deepEqual(await state(),before);
 }
}));
test('guard is idempotent, retains all function metadata, rejects baseline and replay metadata drift',async()=>rollback(async()=>{
 await db.exec(originalDefinition);const before=await metadata();await db.exec(patch);assert.deepEqual(await metadata(),before);
 assert.equal(await scalar('select md5(prosrc) from pg_proc where oid=$1::regprocedure',[signature]),meta.after_md5);
 await db.exec(patch);assert.deepEqual(await metadata(),before);
 for(const change of [
  `grant execute on function ${signature} to authenticated`,
  `alter function ${signature} set work_mem='8MB'`,
  `alter function ${signature} stable`,
  `alter function ${signature} parallel safe`,
  `alter function ${signature} security invoker`
 ]){
  await db.exec('savepoint metadata_drift');await db.exec(change);await assert.rejects(db.exec(patch),/fee_lateral_metadata_drift/);await db.exec('rollback to metadata_drift');
 }
 await db.exec(originalDefinition.replace('begin\n if p_generation_id','begin\n -- synthetic drift\n if p_generation_id'));await db.exec('savepoint body_drift');await assert.rejects(db.exec(patch),/fee_lateral_baseline_drift/);await db.exec('rollback to body_drift');
}));
test('publisher remains service-only after patch and exact retry preserves receipt',async()=>rollback(async()=>{
 const x=input();await db.exec('savepoint service_writer;set role service_role');const receipt=await publisher(x);assert.equal(receipt.ok,true);assert.deepEqual(await publisher(x),receipt);await db.exec('rollback to service_writer');
 for(const role of ['anon','authenticated']){await db.exec('savepoint denied;set role '+role);await assert.rejects(publisher(input()),/permission denied/);await db.exec('rollback to denied');}
}));
