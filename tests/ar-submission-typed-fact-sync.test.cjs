const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');const repo=path.resolve(__dirname,'..'),h=require(path.join(repo,'tests/fixtures/ar-91club-submission-projection-harness.cjs'));let db;
const read=n=>fs.readFileSync(path.join(__dirname,n),'utf8');const generation=async()=>(await db.query("select private.ar_submission_fact_generation('IN','OKWIN')g")).rows[0].g;
const facts=async()=>(await db.query('select order_no,amount_local::text amount_local,amount::text amount,member_id,status,applied_at::text applied_at,completed_at::text completed_at from private.ar_submission_typed_facts order by order_no')).rows;
async function row(id,patch={}){await h.row(db,id,{platform:'OKWIN',...patch});}
async function approveSynthetic(){const g=await generation();await db.query("insert into private.ar_submission_day_ready values('IN','OKWIN','2026-10-10', $1,1,clock_timestamp())",[g]);await db.query("insert into private.ar_submission_null_ready values('IN','OKWIN',$1,0,clock_timestamp())",[g]);return g;}
before(async()=>{db=await h.fixture();await db.exec(fs.readFileSync(path.join(repo,'tests/fixtures/ar-submission-typed-fact-production.sql'),'utf8'));await db.exec(fs.readFileSync(path.join(repo,'supabase/migrations/20261012063352_ar_submission_typed_fact_install.sql'),'utf8'));});
beforeEach(async()=>{await db.exec('rollback;reset role;truncate public.ar_collected_orders,private.ar_submission_typed_facts');});
after(async()=>db?.close());
test('source-population proof is exact across native dates, NULL history, paid completed windows and foreign scopes',async()=>{
 await row('COHORT');await row('NULL',{applied_at:null,status:'unknown',completed_at:null});await row('PAID',{applied_at:'2026-10-09 00:00',completed_at:'2026-10-10 00:00',status:'已支付'});await row('OUT',{applied_at:'2026-10-09 00:00',completed_at:'2026-10-10 00:00',status:'待支付'});
 await row('FOREIGN',{platform:'91CLUB'});await row('WITHDRAW',{order_kind:'withdraw'});await row('PK',{country_code:'PK'});assert.deepEqual((await facts()).map(x=>x.order_no),['COHORT','NULL','PAID']);assert(await generation());
 for(const args of [['IN','91CLUB'],['PK','OKWIN'],['IN','OK.WIN']])assert.equal((await db.query('select private.ar_submission_fact_generation($1,$2)g',args)).rows[0].g,null);
});
test('source identity/population moves, delete, fractional money scale and observation-only captures are synchronized without unrelated writes',async()=>{
 await row('A',{amount_local:'10.0'});await approveSynthetic();const g=await generation();const before=(await db.query('select xmin::text x from private.ar_submission_typed_facts')).rows[0].x;
 await db.exec("update ar_collected_orders set observed_at=clock_timestamp(),raw_payload='{\"observation\":true}'where order_no='A'");assert.equal((await db.query('select xmin::text x from private.ar_submission_typed_facts')).rows[0].x,before);assert.equal(await generation(),g);
 await db.exec("update ar_collected_orders set amount_local='10.00'where order_no='A'");assert.equal((await facts())[0].amount_local,'10.00');assert.equal(await generation(),g);assert.equal((await db.query('select count(*)n from private.ar_submission_day_ready')).rows[0].n,1);
 await db.exec("update ar_collected_orders set order_no='B'where order_no='A'");assert.equal((await facts())[0].order_no,'B');
 await db.exec("update ar_collected_orders set applied_at='2026-10-09'where order_no='B'");assert.equal((await facts()).length,0);
 await db.exec("update ar_collected_orders set status='已支付',completed_at='2026-10-10'where order_no='B'");assert.equal((await facts()).length,1);
 await db.exec("delete from ar_collected_orders where order_no='B'");assert.equal((await facts()).length,0);assert.equal(await generation(),g,'atomic native FK deletion preserves invariant, not stale data');
});
test('direct facts maintenance withdraws every receipt and serializes via epoch, while valid empty batches do not churn generation',async()=>{
 await row('A');const g=await approveSynthetic();await db.exec('update private.ar_submission_typed_facts set amount_local=0 where false');assert.equal(await generation(),g);
 await db.exec("update private.ar_submission_typed_facts set amount_local=42 where order_no='A'");assert.notEqual(await generation(),g);assert.equal((await db.query('select count(*)n from private.ar_submission_day_ready')).rows[0].n,0);assert.equal((await db.query('select count(*)n from private.ar_submission_null_ready')).rows[0].n,0);
});
test('unproved or stale partitions fail closed; null and per-day proof domains are independent from 91CLUB',async()=>{
 assert.equal((await db.query("select private.ar_submission_fact_can_read('IN','OKWIN','2026-10-10','2026-10-11')b")).rows[0].b,false);await approveSynthetic();assert.equal((await db.query("select private.ar_submission_fact_can_read('IN','OKWIN','2026-10-10','2026-10-11')b")).rows[0].b,true);
 assert.equal((await db.query("select private.ar_submission_fact_can_read('IN','OKWIN','2026-10-10','2026-10-12')b")).rows[0].b,false);assert.equal((await db.query("select private.ar_submission_fact_can_read('IN','91CLUB','2026-10-10','2026-10-11')b")).rows[0].b,false);
 await db.exec('begin');try{await db.exec('alter table public.ar_collected_orders disable trigger ar_sub_fact_source_insert');assert.equal(await generation(),null);await db.exec('alter table public.ar_collected_orders enable trigger ar_sub_fact_source_insert');assert.equal((await db.query("select private.ar_submission_fact_can_read('IN','OKWIN','2026-10-10','2026-10-11')b")).rows[0].b,false);}finally{await db.exec('rollback');}
});
test('source service-role writes use the SECDEF sync but misgranted direct facts DML remains denied even after ACL restoration',async()=>{
 await db.exec('set role service_role');await row('SERVICE');await db.exec("update ar_collected_orders set order_no='SERVICE-RENAMED',status='已支付',completed_at='2026-10-11'where order_no='SERVICE'");await db.exec('reset role');assert.equal((await facts())[0].order_no,'SERVICE-RENAMED');await db.exec('set role service_role');await db.exec("delete from ar_collected_orders where order_no='SERVICE-RENAMED'");await row('SERVICE');await db.exec('reset role');assert.equal((await facts()).length,1);
 const g=await generation();await db.exec('grant usage on schema private to service_role;grant all on private.ar_submission_typed_facts to service_role');assert.equal(await generation(),null);
 await db.exec('set role service_role');try{await assert.rejects(()=>db.exec("update private.ar_submission_typed_facts set amount_local=999"),/AR_SUB_FACT_WRITE_DENIED/);}finally{await db.exec('reset role');}
 await db.exec('revoke all on private.ar_submission_typed_facts from service_role');assert.equal(await generation(),g);assert.equal((await facts())[0].amount_local,'123.45678900');
});
test('ANALYZE leaves generation stable, source/fact layout drift fails closed, and TRUNCATE revokes receipts atomically',async()=>{
 await row('A');const g=await approveSynthetic();await db.exec('analyze private.ar_submission_typed_facts');assert.equal(await generation(),g);
 for(const sql of ['alter table private.ar_submission_typed_facts disable row level security','alter table private.ar_submission_typed_facts drop constraint ar_sub_fact_population','alter table private.ar_submission_typed_facts add column unexplained text','alter function private.sync_ar_submission_typed_fact()security invoker','create table source_child()inherits(ar_collected_orders)','create table fact_child()inherits(private.ar_submission_typed_facts)']){await db.exec('begin');try{await db.exec(sql);assert.equal(await generation(),null);}finally{await db.exec('rollback');}}
 await db.exec('truncate public.ar_collected_orders,private.ar_submission_typed_facts');assert.equal((await facts()).length,0);assert.equal((await db.query('select count(*)n from private.ar_submission_day_ready')).rows[0].n,0);assert.notEqual(await generation(),g);
});

test('misgranted control-row writes cannot forge receipts after ACL repair',async()=>{
 const g=await generation();await db.exec('grant usage on schema private to service_role;grant all on private.ar_submission_day_ready to service_role');assert.equal(await generation(),null);await db.exec('set role service_role');try{await assert.rejects(()=>db.query("insert into private.ar_submission_day_ready values('IN','OKWIN','2026-10-10',$1,0,clock_timestamp())",[g]),/AR_SUB_FACT_CONTROL_WRITE_DENIED/);}finally{await db.exec('reset role');}await db.exec('revoke all on private.ar_submission_day_ready from service_role');assert.equal(await generation(),g);assert.equal((await db.query('select count(*)n from private.ar_submission_day_ready')).rows[0].n,0);
});
