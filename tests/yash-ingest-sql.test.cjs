const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261009044014_yash_order_ingest.sql','utf8');
const timezoneFix=fs.readFileSync('supabase/migrations/20261009073115_yash_ingest_timezone_batch_cache.sql','utf8');
let db; const token='a'.repeat(64), at='2026-10-02T10:00:00Z';
function row(id,changes={}) {return {source_site:'yash',order_type:'deposit',order_no:id,uid:'SYNTHETIC-UID',status:'充值成功',amount:'123.45',fee:null,created_at:at,completed_at:'2026-10-02T10:10:00Z',observed_at:'2026-10-03T00:00:00Z',source_timezone:'Asia/Kolkata',currency:'INR',currency_basis:'platform_default',raw_fields:{'订单号':id,'备注':'PRIVATE-NOTE','提现账号':'PRIVATE-ACCOUNT','UID':'SYNTHETIC-UID'},...changes};}
const call=async(request,key=token)=>(await db.query('select public.yash_order_ingest($1,$2) result',[key,request])).rows[0].result;
const ingest=records=>call({action:'ingest',schema_version:1,records});
function receipt(keys,changes={}) {return {action:'receipt',schema_version:1,order_type:'deposit',stream:'createTime',start_at:'2026-10-02T09:00:00Z',end_exclusive:'2026-10-02T11:00:00Z',snapshot_at:'2026-10-03T00:00:00Z',source_timezone:'Asia/Kolkata',source_count:keys.length,order_keys:keys,...changes};}
before(async()=>{db=new PGlite(); await db.exec('create role anon;create role authenticated;create role service_role;');await db.exec(migration);await db.exec(timezoneFix);await db.query("insert into private.yash_ingest_credentials(token_hash,label,expires_at) values($1,'synthetic',now()+interval '1 day')",[token]);});
after(async()=>db?.close());
test('scope has no anonymous/authenticated execution or raw-table grants; credential revocation enforced',async()=>{
 for(const role of ['anon','authenticated']){assert.equal((await db.query("select has_function_privilege($1,'public.yash_order_ingest(text,jsonb)','execute') ok",[role])).rows[0].ok,false);assert.equal((await db.query("select has_table_privilege($1,'private.yash_orders','select') ok",[role])).rows[0].ok,false);}
 assert.deepEqual(await call({action:'check'}),{ok:true,schema_version:1,source_site:'yash'});
 await assert.rejects(()=>call({action:'check'},'b'.repeat(64)),/YASH_UNAUTHORIZED/);
 await db.query('update private.yash_ingest_credentials set revoked_at=now() where token_hash=$1',[token]);await assert.rejects(()=>call({action:'check'}),/YASH_UNAUTHORIZED/);await db.query('update private.yash_ingest_credentials set revoked_at=null where token_hash=$1',[token]);
});
test('idempotent writes preserve exact decimal values and newest source snapshot, strip private raw data',async()=>{
 const r=row('SYNTHETIC-1');assert.equal((await ingest([r])).accepted,1);await ingest([r]);await ingest([row(r.order_no,{amount:'99',observed_at:'2026-10-02T12:00:00Z'})]);
 const got=(await db.query('select * from private.yash_orders where order_no=$1',[r.order_no])).rows[0];assert.equal(got.amount,'123.45000000');assert.deepEqual(got.raw_fields,{'订单号':r.order_no,UID:'SYNTHETIC-UID'});assert.equal((await db.query('select count(*) n from private.yash_orders')).rows[0].n,1);
});
test('invalid second record rolls back the entire batch, duplicate keys and wrong source are rejected',async()=>{
 await assert.rejects(()=>ingest([row('ROLLBACK'),row('BAD',{amount:'-1'})]));assert.equal((await db.query("select count(*) n from private.yash_orders where order_no='ROLLBACK'")).rows[0].n,0);
 await assert.rejects(()=>ingest([row('DUP'),row('DUP')]),/YASH_DUPLICATE_KEYS/);await assert.rejects(()=>ingest([row('WRONG',{source_site:'other'})]),/YASH_SCOPE_DENIED/);
 await assert.rejects(()=>ingest([row('TIME',{completed_at:'2026-10-02T09:59:00Z'})]));
});
test('unknown token currency cannot silently become INR; source currency retained',async()=>{
 await ingest([row('USDT',{currency:'USDT',currency_basis:'source_field',created_at:'2026-10-01T10:00:00Z'}),row('UNKNOWN',{currency:null,currency_basis:'token_type_unverified',created_at:'2026-10-01T10:00:00Z'})]);
 await assert.rejects(()=>ingest([row('BAD-CURRENCY',{currency:'INR',currency_basis:'token_type_unverified'})]));
 const rows=(await db.query("select currency from private.yash_orders where order_no in ('USDT','UNKNOWN') order by order_no")).rows;assert.deepEqual(rows.map(r=>r.currency),[null,'USDT']);
});
test('receipt checks distinct exact keys against stored full window; zero is only verified for empty windows',async()=>{
 assert.equal((await call(receipt(['SYNTHETIC-1']))).verified,true);
 assert.equal((await call(receipt([]))).verified,false);assert.equal((await call(receipt(['MISSING']))).verified,false);
 await assert.rejects(()=>call(receipt(['SYNTHETIC-1','SYNTHETIC-1'])),/YASH_INVALID_KEYS/);
 assert.equal((await call(receipt([],{start_at:'2026-10-02T11:00:00Z',end_exclusive:'2026-10-02T12:00:00Z'}))).verified,true);
});
test('late orders invalidate earlier complete receipts and exact millisecond boundaries count correctly',async()=>{
 await call(receipt(['SYNTHETIC-1']));await ingest([row('LATE',{created_at:'2026-10-02T10:59:59.500Z',completed_at:null})]);
 assert.equal((await db.query("select complete from private.yash_sync_windows where start_at='2026-10-02T09:00:00Z'")).rows[0].complete,false);
 assert.equal((await call(receipt(['SYNTHETIC-1','LATE']))).verified,true);
 await ingest([row('BOUNDARY',{created_at:'2026-10-02T11:00:00Z',completed_at:null})]);assert.equal((await call(receipt(['SYNTHETIC-1','LATE']))).verified,true);
});
test('completion receipts count actual completion timestamps and reject future/inverted windows',async()=>{
 assert.equal((await call(receipt(['SYNTHETIC-1','USDT','UNKNOWN'],{stream:'completeTime'}))).verified,true);
 await assert.rejects(()=>call(receipt([],{end_exclusive:'2026-10-01T00:00:00Z'})),/YASH_INVALID_WINDOW/);
 await assert.rejects(()=>call(receipt([],{source_timezone:'Bogus/Zone'})),/YASH_INVALID_WINDOW/);
});
test('full 500-order batches accept fixed offsets, IANA names and mixed zones without changing timestamps',async()=>{
 for(const [label,zones] of [['OFFSET',['UTC+05:30']],['IANA',['Asia/Kolkata']],['MIX',['UTC+05:30','Asia/Kolkata','UTC-08:00','Etc/UTC']]]) {
  const rows=Array.from({length:500},(_,i)=>row(`BATCH-${label}-${i}`,{source_timezone:zones[i%zones.length]}));
  assert.deepEqual(await ingest(rows),{ok:true,accepted:500});
  const result=(await db.query('select count(*) n,count(distinct created_at) timestamps,min(created_at) created from private.yash_orders where order_no like $1',[`BATCH-${label}-%`])).rows[0];
  assert.equal(result.n,500);assert.equal(result.timestamps,1);assert.equal(new Date(result.created).toISOString(),'2026-10-02T10:00:00.000Z');
 }
});
test('invalid timezone in a later record rolls back the whole batch; invalid receipts remain rejected',async()=>{
 for(const [i,zone] of [null,'','Bogus/Zone','UTC+14:01','UTC-15:00','UTC+05:60'].entries()) {
  await assert.rejects(()=>ingest([row(`TZ-ROLLBACK-${i}`),row(`TZ-BAD-${i}`,{source_timezone:zone})]),/YASH_INVALID_TIME/);
  assert.equal((await db.query('select count(*) n from private.yash_orders where order_no=$1',[`TZ-ROLLBACK-${i}`])).rows[0].n,0);
  await assert.rejects(()=>call(receipt([],{source_timezone:zone})),/YASH_INVALID_WINDOW/);
 }
 for(const zone of ['UTC+05:30','UTC+14:00','UTC-14:00','Asia/Kolkata']) {
  assert.equal((await call(receipt([],{source_timezone:zone,start_at:'2026-10-04T11:00:00Z',end_exclusive:'2026-10-04T12:00:00Z',snapshot_at:'2026-10-05T00:00:00Z'}))).verified,true);
 }
});
