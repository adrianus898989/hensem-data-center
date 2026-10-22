const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const rollback=read('supabase/maintenance/manual-success-created-cohort.rollback.sql');
function baseline(name){
 if(name==='prepared_aggregate_source_clocks')return read('tests/fixtures/created-rollout-baseline/'+name+'.sql');
 const start=rollback.indexOf('CREATE OR REPLACE FUNCTION private.'+name+'(');assert.notEqual(start,-1,'exact rollback baseline '+name);
 const body=rollback.slice(start),match=body.match(/AS (\$[A-Za-z_0-9]*\$)/);assert(match,'baseline body '+name);
 const end=body.indexOf(match[1]+';',match.index+match[0].length);assert.notEqual(end,-1,'baseline terminator '+name);return body.slice(0,end+match[1].length+1);
}
async function fixture(){const filename=path.join(__dirname,'exact-prepared-native-adapters-sql.test.cjs'),c=vm.createContext({require:n=>n==='node:test'?{test(){}}:createRequire(filename)(n),__dirname,process,console,structuredClone});vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.fixture={boot};',c,{filename});return c.fixture;}
const manualClean=x=>{const r=structuredClone(x);delete r.asOf;return r;};
for(const[source,file]of [['duoli','duoli-updated-success.test.cjs'],['kb','yash-readers.test.cjs'],['wg','wg-existing-orders.test.cjs'],['panda','panda-native-readers.test.cjs']])test(source+' actual native status and money fields support explicit created mode without fabricating payment time',async()=>{
 const f=await(await fixture()).boot(file),db=f.db;try{
 const target=async q=>(await db.query('select to_jsonb(p)t from private.dashboard_admin_live_platforms()p where p.id=$1',[q.platformId])).rows[0].t;
 const raw=async q=>(await db.query('select private.prepared_aggregate_raw_kernel($1,jsonb_build_array($2::jsonb))r',[JSON.stringify(q),JSON.stringify(await target(q))])).rows[0].r;
 // Reuse the exact pre-migration production definitions already pinned by rollback.
 for(const name of ['prepared_aggregate_request_reason','prepared_aggregate_secondary_reason','prepared_aggregate_source_clocks','prepared_aggregate_raw_kernel'])await db.exec(baseline(name));
 if(['duoli','wg','panda'].includes(source))await db.exec(baseline('dashboard_admin_'+source+'_order_result'));
 const qs=['providers','full'].flatMap(view=>['charge','withdraw','all'].map(direction=>f.req({view,direction,status:'all',successBasis:source==='duoli'?'source_updated':'success',successStartAt:f.req({}).startAt,successEndAt:f.req({}).endAt}))),old=[];
 await db.exec(baseline('prepared_aggregate_raw_kernel').replace('FUNCTION private.prepared_aggregate_raw_kernel(', 'FUNCTION private.test_previous_manual_kernel('));
 for(const name of ['prepared_aggregate_request_reason','prepared_aggregate_secondary_reason','prepared_aggregate_canonical_request','prepared_aggregate_raw_kernel'])await db.exec(read('supabase/created-cohort/'+name+'.sql'));
 if(['duoli','wg','panda'].includes(source))await db.exec(read('supabase/created-cohort/dashboard_admin_'+source+'_order_result.sql'));
 for(let i=0;i<qs.length;i++){
  const parity=(await db.query('select private.test_previous_manual_kernel($1,jsonb_build_array($2::jsonb))old,private.prepared_aggregate_raw_kernel($1,jsonb_build_array($2::jsonb))current',[JSON.stringify(qs[i]),JSON.stringify(await target(qs[i]))])).rows[0];assert.deepEqual(parity.current,parity.old,source+' legacy manual exact full-field parity '+qs[i].view+'/'+qs[i].direction);
  const q={...qs[i],successBasis:'created'};delete q.successStartAt;delete q.successEndAt;
  const r=await raw(q);assert.equal(r.successBasis,'created');assert.equal(Object.hasOwn(r,'successStartAt'),false);assert.equal(r.capabilities.successCohort,'created_at_current_stored_status');
  for(const s of r.summary){assert.equal(s.success_count,s.created_success_count);assert.equal(s.success_amount,s.created_success_amount);assert.ok(s.success_count<=s.all_count);assert.ok(Number.isSafeInteger(s.created_success_missing_amount_count));if(s.created_success_missing_amount_count)assert.equal(s.success_amount,null);}
  for(const rows of Object.values(r.groups))for(const s of rows)if(Object.hasOwn(s,'success_count')){assert.equal(s.success_count,s.created_success_count);assert.equal(s.success_amount,s.created_success_amount);}
  if(['duoli','panda'].includes(source)&&q.view==='full')assert.deepEqual(r.groups.latency,[]);
  if(source==='wg')assert.equal(r.withdrawSuccessTimeAvailable,false);
 }
 }finally{await db.close()}
});
