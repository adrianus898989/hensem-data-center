const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite'),{loadTs,root}=require('./load-typescript.cjs');
const edge=loadTs(path.join(root,'BACKEND_CURRENT/newar-detail-ingest.ts'));
const read=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
const foundation=read('20260919115606_newar_raw_records_foundation.sql').split('-- Single-platform AND single-dataset keyset search.')[0]+'\ncommit;';
const migration=read('20260929210000_newar_charge_wait_status.sql');
const token='2'.repeat(64),now=Date.now(),at=new Date(now-60000).toISOString();let db,legacy,beforeRow;
const batch=(changes={},dataset='charge')=>({schema_version:1,batch_id:randomUUID(),platform:'DhaniWin',dataset,records:[{source_id:randomUUID(),member_id:'SYNTHETIC-MEMBER',order_number:'SYNTHETIC-ORDER',amount:'100',status_code:'Wait',status_group:'unknown',created_at:at,captured_at:at,raw:{rechargeState:'Wait'},...changes}]});
const ingest=b=>db.query('select public.ingest_newar_detail_batch($1,$2::jsonb) result',[token,JSON.stringify(edge.validateNewarBatch(b,now))]).then(r=>r.rows[0].result);
const stored=b=>db.query('select * from public.newar_detail_records where source_id=$1',[b.records[0].source_id]).then(r=>r.rows[0]);
before(async()=>{db=new PGlite();await db.exec('create schema private;create role anon;create role authenticated;create role service_role;');await db.exec(foundation);
 await db.query("insert into private.newar_detail_credentials(token_hash,allowed_scopes,expires_at) values($1,$2,now()+interval '1 day')",[token,['charge','withdraw','workorder'].map(dataset=>({platform:'DhaniWin',dataset}))]);
 legacy=batch();await ingest(legacy);beforeRow=await stored(legacy);await db.exec(migration);
});
after(async()=>db?.close());
test('backfill repairs only the derived Wait classification, preserving original order facts and batch receipts',async()=>{
 const afterRow=await stored(legacy);assert.equal(beforeRow.status_group,'unknown');assert.equal(afterRow.status_group,'pending');
 assert.deepEqual({...afterRow,status_group:'unknown'},beforeRow);assert.equal((await ingest(legacy)).status,'unchanged');assert.equal((await stored(legacy)).status_group,'pending');
});
test('existing collectors can keep sending Wait as unknown and storage normalizes new rows and refreshes',async()=>{
 const b=batch();await ingest(b);assert.equal((await stored(b)).status_group,'pending');
 const refreshed={...b,batch_id:randomUUID(),records:[{...b.records[0],amount:'200'}]};await ingest(refreshed);const row=await stored(b);assert.equal(row.status_group,'pending');assert.equal(Number(row.amount),200);assert.deepEqual(row.raw,{rechargeState:'Wait'});
});
test('success and cancellation transitions stay governed by the original source state',async()=>{
 const b=batch();await ingest(b);
 const paid={...b,batch_id:randomUUID(),records:[{...b.records[0],status_code:'Payed',status_group:'success',success_at:at,raw:{rechargeState:'Payed'}}]};await ingest(paid);assert.equal((await stored(b)).status_group,'success');
 const cancelled=batch({status_code:'Cancel',status_group:'failed',raw:{rechargeState:'Cancel'}});await ingest(cancelled);assert.equal((await stored(cancelled)).status_group,'failed');
});
test('unrecognized or contradictory source states and other datasets are never guessed as pending',async()=>{
 for(const b of [batch({status_code:'FutureState',raw:{rechargeState:'FutureState'}}),batch({raw:{rechargeState:'Payed'}}),batch({},'withdraw'),batch({},'workorder')]){await ingest(b);assert.equal((await stored(b)).status_group,'unknown');}
});
test('migration replay is safe and does not expose the private trigger function',async()=>{
 await db.exec(migration);assert.equal((await stored(legacy)).status_group,'pending');
 const privileges=(await db.query("select has_function_privilege('anon','private.newar_detail_normalize_wait_status()','execute') anon,has_function_privilege('authenticated','private.newar_detail_normalize_wait_status()','execute') authenticated")).rows[0];assert.deepEqual(privileges,{anon:false,authenticated:false});
});
