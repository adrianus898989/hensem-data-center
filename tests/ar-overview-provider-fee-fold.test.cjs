// Real PostgreSQL execution using synthetic native orders; no cloud access.
const {test,before,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),fixture=path.join(__dirname,'admin-live-ar-amount-inline-sql.test.cjs');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261011150517_ar_overview_provider_fee_single_scan.sql'),'utf8');
const rollback=fs.readFileSync(path.join(__dirname,'fixtures/ar-overview-provider-fee-fold-rollback.sql'),'utf8');
const signature='private.dashboard_admin_live_query_raw(jsonb)',reference='private.history_fee_fold_reference(jsonb)';
const beforeHash='18be6ff6349345d21da91592231567bd',afterHash='4bf732e393208d69b6f61b1cb2dbe8d4';
const auxiliarySQL="select jsonb_agg(to_jsonb(p)order by oid) from pg_proc p where oid in('public.dashboard_admin_live_query(jsonb)'::regprocedure,'private.dashboard_admin_live_query(jsonb)'::regprocedure,'private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)'::regprocedure)";
let db,native,requests,baseline,beforeMetadata,auxiliaries;
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const definition=sig=>scalar('select pg_get_functiondef($1::regprocedure)',[sig]);
const bodyHash=sig=>scalar('select md5(prosrc)from pg_proc where oid=$1::regprocedure',[sig]);
const metadata=sig=>scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid=$1::regprocedure",[sig]);
const clone=(sql,name)=>sql.replace('FUNCTION private.dashboard_admin_live_query_raw(',`FUNCTION private.${name}(`);

before(async()=>{
 let setup;
 const req=createRequire(fixture),ctx=vm.createContext({require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,after(){}}:req(n),__dirname,process,console,structuredClone});
 vm.runInContext(fs.readFileSync(fixture,'utf8')+'\nglobalThis.historyFixture={get db(){return db},get native(){return native},requests,migration};',ctx,{filename:fixture});
 await setup();({db,native,requests}=ctx.historyFixture);
 assert.equal(await bodyHash(signature),'26b4cf0c448c9f001576d1a933aea8d9');
 await db.exec(ctx.historyFixture.migration);assert.equal(await bodyHash(signature),beforeHash);
 baseline=await definition(signature);beforeMetadata=await metadata(signature);auxiliaries=await scalar(auxiliarySQL);
 await db.exec(clone(baseline,'history_fee_fold_reference'));
 await db.exec('revoke all on function private.history_fee_fold_reference(jsonb) from public,anon,authenticated,service_role');
 await db.exec(migration);assert.equal(await bodyHash(signature),afterHash);
});
after(()=>db?.close());

async function equal(q){
 // One statement gives both functions the same asOf; compare every JSON value
 // and array order without normalizing or dropping any result fields.
 const r=(await db.query('select private.history_fee_fold_reference($1::jsonb)reference,private.dashboard_admin_live_query_raw($1::jsonb)candidate',[JSON.stringify(q)])).rows[0];
 assert.deepEqual(r.candidate,r.reference,JSON.stringify(q));return r.candidate;
}
async function denial(q){
 const errors=[];
 for(const fn of ['private.history_fee_fold_reference','private.dashboard_admin_live_query_raw']){
  try{await db.query(`select ${fn}($1::jsonb)`,[JSON.stringify(q)]);assert.fail('unexpected authorized call');}
  catch(e){assert.match(e.message,/platform_denied|preview_denied/);errors.push({code:e.code,message:e.message});}
 }
 assert.deepEqual(errors[1],errors[0]);assert.equal(errors[0].code,'42501');return errors[0];
}
async function capture(sql,name,key){
 const anchor='  execute v_sql into v_result using ';assert.equal(sql.split(anchor).length,2);
 await db.exec(clone(sql.replace(anchor,`  perform set_config('${key}',v_sql,false);\n  return '{}'::jsonb;\n`+anchor),name));
 await db.exec(`revoke all on function private.${name}(jsonb) from public,anon,authenticated,service_role`);
}

test('AR provider fee fold preserves all 135 native full JSON replies and complete function metadata',async()=>{
 assert.equal(await bodyHash(signature),afterHash);
 assert.deepEqual(await metadata(signature),beforeMetadata);assert.deepEqual(await scalar(auxiliarySQL),auxiliaries);
 const qs=requests();assert.equal(qs.length,135);for(const q of qs)await equal(q);
});

test('native precision, signed manual recharge, unknown local money and USDT proof are unchanged',async()=>{
 const rows=(await equal(native.request('ar',{action:'details',direction:'all',limit:100}))).rows;
 for(const[id,amount]of [['PRECISE','123456789012345678901234567.12345678'],['ZERO','0'],['NEGATIVE','-0.00000001'],['LOCAL','1.23000000'],['LOCAL_ZERO','0'],['STALE',null],['BAD_CURRENCY',null],['BAD_VERSION',null],['NAN_LOCAL',null],['INF_LOCAL',null],['MISSING',null],['MANUAL','-12.12345678'],['DUAL','1000'],['USDT_WITHDRAW',null]])assert.equal(rows.find(r=>r.order_number===id).amount,amount,id);
});

test('runtime SQL changes only AR providers; AR full and other native sources remain byte-identical',async()=>{
 await capture(baseline,'history_fee_reference_capture','test.history_reference_sql');
 await capture(await definition(signature),'history_fee_candidate_capture','test.history_candidate_sql');
 for(const source of ['ar','newar','game66','lg'])for(const view of ['providers','full']){
  const q=native.request(source,{view,direction:'all'});
  await db.query('select private.history_fee_reference_capture($1::jsonb),private.history_fee_candidate_capture($1::jsonb)',[JSON.stringify(q)]);
  const old=await scalar("select current_setting('test.history_reference_sql')"),candidate=await scalar("select current_setting('test.history_candidate_sql')");
  if(source==='ar'&&view==='providers'){
   assert.match(old,/fee_bands as/);assert.doesNotMatch(candidate,/fee_bands as/);
   assert.match(candidate,/to_jsonb\(m\)-array\['kind','fee_facts'\]/);assert.notEqual(old,candidate);
  }else assert.equal(candidate,old,source+'/'+view+' SQL remains byte-identical');
 }
});

test('private raw ACL, fresh platform denial and inactive-profile denial remain unchanged',async()=>{
 for(const role of ['anon','authenticated','service_role'])for(const sig of [signature,reference])assert.equal(await scalar("select has_function_privilege($1,$2,'EXECUTE')",[role,sig]),false);
 await native.as('10000000-0000-0000-0000-000000000002');
 try{assert.equal((await denial(native.request('ar'))).message,'platform_denied');}
 finally{await native.as('10000000-0000-0000-0000-000000000001');}
 // Expected statement errors must not poison a transaction before comparison.
 await db.exec("update dashboard_profiles set active=false where role='owner'");
 try{assert.equal((await denial(native.request('ar'))).message,'preview_denied');}
 finally{await db.exec("update dashboard_profiles set active=true where role='owner'");}
});

test('rollback restores exact source and all 135 replies; the candidate can then be reapplied',async()=>{
 await db.exec(rollback);assert.equal(await bodyHash(signature),beforeHash);assert.deepEqual(await metadata(signature),beforeMetadata);
 for(const q of requests())await equal(q);
 await db.exec(migration);assert.equal(await bodyHash(signature),afterHash);assert.deepEqual(await metadata(signature),beforeMetadata);
 assert.deepEqual(await scalar(auxiliarySQL),auxiliaries);
});

test('replay and metadata or source drift fail closed without partial replacement',async()=>{
 const block=migration.match(/DO \$guard\$[\s\S]*?\$guard\$;/)[0];
 await assert.rejects(()=>db.exec(block),/ar_provider_fee_fold_live_contract_drift/);
 assert.equal(await bodyHash(signature),afterHash);assert.deepEqual(await metadata(signature),beforeMetadata);
 await db.exec(rollback);
 await db.exec('begin');
 try{
  for(const change of [baseline.replace('declare\n','declare\n -- synthetic unknown reader\n'),
   'alter function '+signature+' security invoker','alter function '+signature+' set jit=on',
   'grant execute on function '+signature+' to authenticated']){
   await db.exec('savepoint drift');await db.exec(change);
   await assert.rejects(()=>db.exec(block),/ar_provider_fee_fold_live_contract_drift/);
   await db.exec('rollback to drift');assert.equal(await bodyHash(signature),beforeHash);assert.deepEqual(await metadata(signature),beforeMetadata);
  }
 }finally{await db.exec('rollback');}
 await db.exec(migration);assert.equal(await bodyHash(signature),afterHash);assert.deepEqual(await metadata(signature),beforeMetadata);
});
