const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite'),{loadTs,root}=require('./load-typescript.cjs');
const edge=loadTs(path.join(root,'BACKEND_CURRENT/newar-detail-ingest.ts'));
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260929180000_newar_recharge_level.sql'),'utf8');
const foundation=fs.readFileSync(path.join(root,'supabase/migrations/20260919115606_newar_raw_records_foundation.sql'),'utf8').split('-- Single-platform AND single-dataset keyset search.')[0]+'\ncommit;';
const token='1'.repeat(64),now=Date.now(),at=new Date(now-60000).toISOString();let db;
const make=(raw={})=>({schema_version:1,batch_id:randomUUID(),platform:'DhaniWin',dataset:'charge',records:[{source_id:randomUUID(),member_id:'SYNTHETIC-01',order_number:'SYNTHETIC-ORDER',amount:'100',status_code:'Cancel',status_group:'failed',created_at:at,captured_at:at,raw}]});
const ingest=async batch=>(await db.query('select public.ingest_newar_detail_batch($1,$2) as result',[token,batch])).rows[0].result;
before(async()=>{db=new PGlite();await db.exec('create schema private;create role anon;create role authenticated;create role service_role;');await db.exec(foundation);
 const keys=(await db.query('select private.newar_detail_raw_keys() as keys')).rows[0].keys.concat(['depositOrderNo','utr','kycConnectState','utrMatched','workOrderTypeId','syntheticFutureKey']);
 await db.exec("create or replace function private.newar_detail_raw_keys() returns text[] language sql immutable set search_path='' as $$select array["+keys.map(k=>"'"+k+"'").join(',')+"]::text[]$$;");
 await db.query('insert into private.newar_detail_credentials(token_hash,allowed_scopes,expires_at) values($1,$2,now()+interval \'1 day\')',[token,[{platform:'DhaniWin',dataset:'charge'}]]);await db.exec(migration);
});
after(async()=>db?.close());
test('grade extension retains current and future fields and function permissions on replay',async()=>{
 await db.exec(migration);const keys=(await db.query('select private.newar_detail_raw_keys() as keys')).rows[0].keys;
 for(const key of ['depositOrderNo','utr','kycConnectState','utrMatched','workOrderTypeId','syntheticFutureKey'])assert(keys.includes(key));assert.equal(keys.filter(k=>k==='rechargeLevel').length,1);
 assert.equal((await db.query("select has_function_privilege('anon','private.newar_detail_raw_keys()','execute') allowed")).rows[0].allowed,false);
});
test('source LV0, LV5 and numeric zero survive receiver and atomic storage without changing order facts',async()=>{
 for(const rechargeLevel of ['LV0','LV5',0]){
  const batch=make({rechargeLevel,orderNo:'SYNTHETIC-ORDER',bankAccount:'PRIVATE-EXCLUDED',token:'PRIVATE-EXCLUDED',vipLevel:'L9'}),clean=edge.validateNewarBatch(batch,now);assert.deepEqual(clean.records[0].raw,{orderNo:'SYNTHETIC-ORDER',rechargeLevel});
  const ack=await ingest(clean);assert.equal(ack.written_count,1);
  const row=(await db.query('select raw,amount,member_id,status_group from newar_detail_records where source_id=$1',[clean.records[0].source_id])).rows[0];assert.equal(row.raw.rechargeLevel,rechargeLevel);assert.equal(Number(row.amount),100);assert.equal(row.member_id,'SYNTHETIC-01');assert.equal(row.status_group,'failed');assert.equal((await ingest(clean)).status,'unchanged');
 }
});
test('old collectors and missing/null grade remain valid without becoming L0',async()=>{
 for(const raw of [{},{rechargeLevel:null},{rechargeLevel:''}]){const b=edge.validateNewarBatch(make(raw),now);await ingest(b);const stored=(await db.query('select raw from newar_detail_records where source_id=$1',[b.records[0].source_id])).rows[0].raw;assert.deepEqual(stored,raw);}
});
test('grade does not permit compound private data or a different platform scope',async()=>{
 const b=edge.validateNewarBatch(make({rechargeLevel:{token:'PRIVATE'},utr:'SYNTHETIC-UTR',kycConnectState:1}),now);assert.deepEqual(b.records[0].raw,{utr:'SYNTHETIC-UTR',kycConnectState:1});await ingest(b);
 const forbidden=edge.validateNewarBatch({...make({rechargeLevel:'LV0'}),platform:'POPZAR'},now);await assert.rejects(()=>ingest(forbidden),/NEWAR_SCOPE_DENIED/);
});
