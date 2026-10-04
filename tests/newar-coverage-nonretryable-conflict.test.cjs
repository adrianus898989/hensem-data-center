// Local PostgreSQL execution with a synthetic minimum function only.
// Production function definitions, credentials and orders remain private.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261004054155_newar_coverage_nonretryable_conflict.sql'),'utf8');
const oldAnchor="ERRCODE='40001',MESSAGE='NEWAR_COVERAGE_PENDING'",newAnchor="ERRCODE='PT409',MESSAGE='NEWAR_COVERAGE_PENDING'";
const source=`
DECLARE n integer := 1; proof_n integer; db_n integer; proof_digest text; db_digest text;
BEGIN
 IF p_token_hash<>'SYNTHETIC' THEN RAISE EXCEPTION USING ERRCODE='28000',MESSAGE='NEWAR_AUTH_INVALID'; END IF;
 IF p_coverage->>'scope'<>'SYNTHETIC' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='NEWAR_SCOPE_DENIED'; END IF;
 IF coalesce((p_coverage->>'missing_batch')::boolean,false)
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='NEWAR_COVERAGE_PENDING'; END IF;
 proof_n:=(p_coverage->>'proof_n')::integer; db_n:=(p_coverage->>'db_n')::integer;
 proof_digest:=p_coverage->>'proof_digest'; db_digest:=p_coverage->>'db_digest';
 IF proof_n<>n OR db_n<>n OR proof_digest<>db_digest
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='NEWAR_COVERAGE_PENDING'; END IF;
 RETURN jsonb_build_object('ok',true,'complete',true,'status','accepted','record_count',n);
END `;
const definition=body=>`create or replace function private.ingest_newar_detail_coverage(p_token_hash text,p_coverage jsonb) returns jsonb language plpgsql security definer set search_path to '' as $fixture$${body}$fixture$;`;
let db,repair,baselineHash,repairedHash;
const request=extra=>({scope:'SYNTHETIC',proof_n:1,db_n:1,proof_digest:'SYNTHETIC_DIGEST',db_digest:'SYNTHETIC_DIGEST',...extra});
const call=async(extra,token='SYNTHETIC')=>(await db.query('select private.ingest_newar_detail_coverage($1,$2::jsonb) data',[token,JSON.stringify(request(extra))])).rows[0].data;
const info=async()=> (await db.query("select oid,prosrc,md5(prosrc) body_hash,proowner,proacl::text acl,prosecdef,proconfig from pg_proc where oid='private.ingest_newar_detail_coverage(text,jsonb)'::regprocedure")).rows[0];
before(async()=>{
 db=new PGlite();await db.exec('create schema private;create role service_role;');await db.exec(definition(source));
 await db.exec('revoke all on function private.ingest_newar_detail_coverage(text,jsonb) from public;grant execute on function private.ingest_newar_detail_coverage(text,jsonb) to service_role;');
 baselineHash=(await info()).body_hash;repairedHash=(await db.query('select md5($1::text) value',[source.replaceAll(oldAnchor,newAnchor)])).rows[0].value;
 // Execute the real migration logic, substituting only the synthetic fixture's
 // two approved hashes. Its signature, anchor count and metadata guards are real.
 repair=migration.replace('4632a0889b11e68defaa1473ca4541ed',baselineHash).replace('b74b197a2b326fddc8eef613d038c370',repairedHash);
 assert.notEqual(repair,migration);assert.equal((source.match(/ERRCODE='40001'/g)||[]).length,2);
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));

test('guarded migration replaces exactly two pending codes and preserves proof text and execution metadata',async()=>{
 const before=await info();await db.exec(repair);const after=await info();assert.equal(after.body_hash,repairedHash);assert.equal(after.prosrc,before.prosrc.replaceAll(oldAnchor,newAnchor));
 for(const key of ['oid','proowner','acl','prosecdef','proconfig'])assert.deepEqual(after[key],before[key],key);
});
test('a second migration application is an exact no-op',async()=>{
 await db.exec(repair);const first=await info();await db.exec(repair);assert.deepEqual(await info(),first);
});
test('missing batch proof remains a pending rejection with non-retryable PT409',async()=>{
 await db.exec(repair);await assert.rejects(call({missing_batch:true}),error=>error.code==='PT409'&&error.message==='NEWAR_COVERAGE_PENDING');
});
test('mismatching record counts or digests still reject with the same pending message',async()=>{
 for(const fields of [{proof_n:0},{db_n:0},{db_digest:'MISMATCH'}]){
  await db.exec(repair);await assert.rejects(call(fields),error=>error.code==='PT409'&&error.message==='NEWAR_COVERAGE_PENDING');await db.exec('rollback;begin');
 }
});
test('matching proofs retain the identical success acknowledgement',async()=>{
 const prior=await call();await db.exec(repair);assert.deepEqual(await call(),prior);assert.deepEqual(prior,{ok:true,complete:true,status:'accepted',record_count:1});
});
test('authentication and scope rejections retain their original codes',async()=>{
 await db.exec(repair);await assert.rejects(call({},'UNKNOWN'),error=>error.code==='28000'&&error.message==='NEWAR_AUTH_INVALID');await db.exec('rollback;begin');
 await db.exec(repair);await assert.rejects(call({scope:'UNKNOWN'}),error=>error.code==='42501'&&error.message==='NEWAR_SCOPE_DENIED');
});
test('baseline drift fails closed and rolls the attempted replacement back',async()=>{
 await db.exec(definition(source.replace('SYNTHETIC_DIGEST','UNREVIEWED_CHANGE')+'-- unreviewed fixture edit\n'));await assert.rejects(db.exec(repair),/NEWAR_COVERAGE_BASELINE_CHANGED/);
 await db.exec('rollback;begin');assert.equal((await info()).body_hash,baselineHash);
});
test('missing function fails closed without creating an unreviewed function',async()=>{
 await db.exec('drop function private.ingest_newar_detail_coverage(text,jsonb)');await assert.rejects(db.exec(repair),/NEWAR_COVERAGE_FUNCTION_MISSING/);
});
