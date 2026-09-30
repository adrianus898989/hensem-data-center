'use strict';
const {test,before,after,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const read=file=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8');
const foundation=read('20260919115606_newar_raw_records_foundation.sql').split('-- Single-platform AND single-dataset keyset search.')[0]+'\ncommit;',patch=read('20260930224000_newar_workorder_preserve_original_on_empty.sql');
const token='1'.repeat(64),past=Date.now()-300000,at=n=>new Date(past+n*1000).toISOString();let db,baseMeta,wrapperMeta,patchedBody;
const record=(extra={})=>({source_id:'8000000000000000001',member_id:'SYNTHETIC',order_number:'RC_SYN_OLD',amount:'100',currency:'INR',status_code:'3',status_group:'pending',created_at:at(0),captured_at:at(30),workorder_type:'存款未到账自动化',raw:{id:'8000000000000000001',depositOrderNo:'RC_SYN_OLD',rechargeNumber:null,state:3},...extra});
const batch=(r=record(),extra={})=>({schema_version:1,batch_id:randomUUID(),platform:'DhaniWin',dataset:'workorder',records:[r],...extra});
const ingest=async b=>(await db.query('select public.ingest_newar_detail_batch($1,$2::jsonb) result',[token,JSON.stringify(b)])).rows[0].result;
const stored=async(platform='DhaniWin',dataset='workorder')=>(await db.query('select * from newar_detail_records where platform=$1 and dataset=$2',[platform,dataset])).rows[0];
const update=(extra={})=>record({order_number:null,captured_at:at(40),raw:{depositOrderNo:null,rechargeNumber:null,state:4},amount:'250',status_code:'4',status_group:'success',...extra});
before(async()=>{db=new PGlite();await db.exec('create schema private;create role anon;create role authenticated;create role service_role;');await db.exec(foundation);
 const keys=(await db.query('select private.newar_detail_raw_keys() keys')).rows[0].keys.concat(['depositOrderNo','utr','workOrderTypeId']);await db.exec("create or replace function private.newar_detail_raw_keys() returns text[] language sql immutable set search_path='' as $$select array["+keys.map(k=>"'"+k+"'").join(',')+"]::text[]$$;");
 await db.query("insert into private.newar_detail_credentials(token_hash,allowed_scopes,expires_at) values($1,$2::jsonb,now()+interval '1 day')",[token,JSON.stringify(['DhaniWin','POPZAR'].flatMap(platform=>['workorder','charge','withdraw'].map(dataset=>({platform,dataset}))))]);
 baseMeta=(await db.query("select to_jsonb(p)-'prosrc' meta from pg_proc p where oid='private.ingest_newar_detail_batch(text,jsonb)'::regprocedure")).rows[0].meta;wrapperMeta=(await db.query("select to_jsonb(p) meta from pg_proc p where oid='public.ingest_newar_detail_batch(text,jsonb)'::regprocedure")).rows[0].meta;
 await db.exec(patch);patchedBody=(await db.query("select prosrc from pg_proc where oid='private.ingest_newar_detail_batch(text,jsonb)'::regprocedure")).rows[0].prosrc;
});
after(async()=>db?.close());beforeEach(async()=>db.exec('delete from newar_detail_records;delete from private.newar_detail_batches;'));afterEach(async()=>db.exec('rollback'));
test('empty later source fields preserve the confirmed original but accept all new status and amount fields',async()=>{
 await ingest(batch());const before=await stored();const u=update({raw:{depositOrderNo:null,rechargeNumber:null,utr:'NEW-UTR',state:4}});await ingest(batch(u));const after=await stored();assert.equal(after.id,before.id);assert.equal(after.order_number,'RC_SYN_OLD');assert.deepEqual(after.raw,{depositOrderNo:'RC_SYN_OLD',rechargeNumber:null,utr:'NEW-UTR',state:4});assert.equal(Number(after.amount),250);assert.equal(after.status_code,'4');assert.equal(after.status_group,'success');assert.equal(after.raw.id,undefined,'old unrelated raw fields do not persist');assert.equal(new Date(after.captured_at).getTime(),Date.parse(u.captured_at));
});
test('missing keys, explicit nulls and whitespace-only original fields are all safely treated as absent',async()=>{
 for(const raw of [{},{depositOrderNo:null},{depositOrderNo:' ',rechargeNumber:''}]){await db.exec('delete from newar_detail_records');await ingest(batch());await ingest(batch(update({raw})));assert.equal((await stored()).raw.depositOrderNo,'RC_SYN_OLD');}
});
test('explicit rechargeNumber is preserved as itself, without fabricating a depositOrderNo field',async()=>{
 await ingest(batch(record({raw:{rechargeNumber:'RC_LEGACY'},order_number:'WRONG-FALLBACK'})));await ingest(batch(update({raw:{state:4}})));const r=await stored();assert.equal(r.order_number,'RC_LEGACY');assert.equal(r.raw.rechargeNumber,'RC_LEGACY');assert.equal(r.raw.depositOrderNo,undefined);
});
test('old fallback ticket IDs and non-RC values never become permanent originals',async()=>{
 for(const raw of [{},{orderNo:'8000000000000000001'},{depositOrderNo:12345},{depositOrderNo:false},{depositOrderNo:'false'},{depositOrderNo:'12345'},{depositOrderNo:'8000000000000000001'},{depositOrderNo:' RC_REAL '},{depositOrderNo:'RC_A',rechargeNumber:'RC_B'}]){await db.exec('delete from newar_detail_records');await ingest(batch(record({order_number:'8000000000000000001',raw})));await ingest(batch(update()));const r=await stored();assert.equal(r.order_number,null);assert.equal(r.raw.depositOrderNo,null);}
});
test('new nonempty order numbers or explicit references always take precedence',async()=>{
 for(const changed of [{order_number:'RC_NEW',raw:{depositOrderNo:'RC_NEW'}},{order_number:'RC_NEW',raw:{depositOrderNo:null,rechargeNumber:null}},{order_number:null,raw:{rechargeNumber:'RC_NEW'}},{order_number:null,raw:{depositOrderNo:'RC_NEW'}}]){await db.exec('delete from newar_detail_records');await ingest(batch());await ingest(batch(update(changed)));const r=await stored();assert.equal(r.order_number,changed.order_number);assert.deepEqual(r.raw,changed.raw);}
});
test('invalid but nonempty incoming fields are not rewritten as if they were absent',async()=>{
 for(const value of [false,12345,'false','12345']){await db.exec('delete from newar_detail_records');await ingest(batch());await ingest(batch(update({raw:{depositOrderNo:value}})));const r=await stored();assert.equal(r.order_number,null);assert.equal(r.raw.depositOrderNo,value);}
});
test('charge, withdrawal, another platform and another ticket never inherit a workorder original',async()=>{
 for(const dataset of ['charge','withdraw']){await ingest(batch(record(),{dataset}));await ingest(batch(update(),{dataset}));assert.equal((await stored('DhaniWin',dataset)).order_number,null);}
 await ingest(batch());await ingest(batch(update(),{platform:'POPZAR'}));assert.equal((await stored('POPZAR')).order_number,null);
 await ingest(batch(update({source_id:'8000000000000000002'})));assert.equal((await db.query("select order_number from newar_detail_records where platform='DhaniWin' and dataset='workorder' and source_id='8000000000000000002'")).rows[0].order_number,null);
});
test('matching private backfill evidence survives an empty response, and is dropped on a real correction',async()=>{
 await ingest(batch());const evidence={version:1,source:'typed-workorder-original-backfill',workOrderId:'8000000000000000001',depositOrderNo:'RC_SYN_OLD',sourceSha256:'a'.repeat(64)};await db.query("update newar_detail_records set raw=raw||jsonb_build_object('_depositOriginalBackfill',$1::jsonb)",[JSON.stringify(evidence)]);await ingest(batch(update()));assert.deepEqual((await stored()).raw._depositOriginalBackfill,evidence);
 await ingest(batch(update({captured_at:at(50),order_number:'RC_CORRECTED',raw:{depositOrderNo:'RC_CORRECTED'}})));assert.equal((await stored()).raw._depositOriginalBackfill,undefined);
});
test('unrelated audit objects are not carried into a newer source row',async()=>{
 await ingest(batch());await db.query("update newar_detail_records set raw=raw||jsonb_build_object('_depositOriginalBackfill',$1::jsonb)",[JSON.stringify({source:'typed-workorder-original-backfill',workOrderId:'8000000000000000999',depositOrderNo:'RC_SYN_OLD'})]);await ingest(batch(update()));assert.equal((await stored()).raw._depositOriginalBackfill,undefined);
});
test('batch replay, stale-row rejection, token validation and scope enforcement remain intact',async()=>{
 const original=batch();await ingest(original);assert.equal((await ingest(original)).status,'unchanged');const stale=await ingest(batch(update({captured_at:at(20)})));assert.equal(stale.stale_count,1);assert.equal(Number((await stored()).amount),100);
 await assert.rejects(db.query('select public.ingest_newar_detail_batch($1,$2::jsonb)',['2'.repeat(64),JSON.stringify(batch(update()))]),/NEWAR_AUTH_INVALID/);
 await assert.rejects(ingest(batch(update(),{platform:'92BLAZE'})),/NEWAR_SCOPE_DENIED/);
});
test('migration is idempotent and preserves the exact private metadata, owner, ACL and public wrapper',async()=>{
 await db.exec(patch);assert.deepEqual((await db.query("select to_jsonb(p)-'prosrc' meta from pg_proc p where oid='private.ingest_newar_detail_batch(text,jsonb)'::regprocedure")).rows[0].meta,baseMeta);assert.deepEqual((await db.query("select to_jsonb(p) meta from pg_proc p where oid='public.ingest_newar_detail_batch(text,jsonb)'::regprocedure")).rows[0].meta,wrapperMeta);assert.equal((await db.query("select prosrc from pg_proc where oid='private.ingest_newar_detail_batch(text,jsonb)'::regprocedure")).rows[0].prosrc,patchedBody);
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'private.ingest_newar_detail_batch(text,jsonb)','execute') allowed",[role])).rows[0].allowed,false);
});
test('unexpected function-body or ACL drift fails closed without installing over it',async()=>{
 await db.exec('begin;grant execute on function private.ingest_newar_detail_batch(text,jsonb) to authenticated');await assert.rejects(db.exec(patch),/NEWAR_ORIGINAL_GUARD_ACL_CHANGED/);await db.exec('rollback');
 await db.exec('begin');const changed=patchedBody+'\n-- synthetic other change\n';await db.exec("create or replace function private.ingest_newar_detail_batch(p_token_hash text,p_batch jsonb) returns jsonb language plpgsql security definer set search_path='' as '"+changed.replaceAll("'","''")+"';");await assert.rejects(db.exec(patch),/NEWAR_ORIGINAL_GUARD_PATCH_DRIFT/);await db.exec('rollback');assert.equal((await db.query("select prosrc from pg_proc where oid='private.ingest_newar_detail_batch(text,jsonb)'::regprocedure")).rows[0].prosrc,patchedBody);
});
