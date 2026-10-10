const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const patch=read('supabase/migrations/20261010074216_submission_member_order_native_status.sql');
let setup,db,f,original,beforeMetadata;
const ctx=vm.createContext({__dirname,require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,beforeEach(){},after(){}}:require(n)});
vm.runInContext(read('tests/yash-submission-sql.test.cjs').split(/\ntest\(/)[0]+'\nglobalThis.fixture={get db(){return db},get sourceFixture(){return f}};',ctx);
const info=async()=>(await db.query("select pg_get_functiondef(oid) definition,md5(prosrc) hash,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure")).rows[0];
const call=extra=>f.call(f.request({startAt:'2026-10-02T00:00:00Z',endAt:'2026-10-03T00:00:00Z',...extra}));
before(async()=>{await setup();db=ctx.fixture.db;f=ctx.fixture.sourceFixture;await db.exec('alter table newar_detail_records add column if not exists status_code text;alter table lg_orders add column if not exists status_text text,add column if not exists status_code integer');const p=await info();assert.equal(p.hash,'189d9c7ee57ee9cbcad72d29f8b124bc');original=p.definition;beforeMetadata=p.metadata;});
beforeEach(async()=>{await f.as(f.owner);await db.exec('truncate newar_detail_records,lg_orders');await db.exec(original);await db.exec(patch);});
after(async()=>db?.close());
test('newAR exposes the native status code while qualification, money, dates and parent reconciliation use the original normalized status',async()=>{
 await db.exec(`insert into newar_detail_records(platform,dataset,source_id,order_number,member_id,provider,currency,status_group,status_code,amount,created_at)
 select 'NEW-RAW','charge','N-'||i,'N-'||i,'NATIVE','Pay','NPR','pending','7',0,'2026-10-02T10:00:00+05:45'::timestamptz+i*interval '1 second' from generate_series(1,16)i;`);
 const p={platformId:f.ids.newar,operation:'memberOrders',memberId:'NATIVE',day:'2026-10-02'};const r=await call(p);assert.equal(r.total,16);assert.ok(r.rows.every(x=>x.status==='7'&&x.amount==='0'));
 const parent=(await call({platformId:f.ids.newar,operation:'members'})).rows[0];assert.equal(r.total,parent.invalid_count);assert.equal(r.rows[0].created_at,parent.first_invalid_at);
 await db.exec(original);const before=await call(p);assert.ok(before.rows.every(x=>x.status==='pending'));for(const row of before.rows)row.status='7';delete before.asOf;delete r.asOf;assert.deepEqual(r,before);
});
test('LG displays native text first, code for absent/empty text, and null remains unknown; normalized paid status still excludes members',async()=>{
 await db.exec(`insert into lg_orders(source_system,country_code,platform,order_kind,order_no,member_id,third_party,metric_amount,created_at,status_class,status_text,status_code)
 select 'LG','PH','LG-RAW','recharge','L-'||i,'LG-MEMBER','Pay',1,'2026-10-02T10:00:00+08:00'::timestamptz+i*interval '1 second','pending',
 case when i=1 then 'Native Waiting' when i=2 then '' else null end,case when i=4 then null else 9 end from generate_series(1,16)i;`);
 const p={platformId:f.ids.lg,operation:'memberOrders',memberId:'LG-MEMBER',day:'2026-10-02'},r=await call(p);assert.equal(r.total,16);assert.deepEqual(r.rows.slice(0,4).map(x=>x.status),['Native Waiting','9','9',null]);
 await db.exec("update lg_orders set status_class='success',paid_at='2026-10-02T12:00:00+08:00' where order_no='L-16'");assert.equal((await call(p)).total,0);
});
test('migration changes only native display fields and preserves metadata, replays safely and rejects drift',async()=>{
 const current=await info();assert.equal(current.hash,'219db2fb64d519ce975a5a2a907cd6db');assert.deepEqual(current.metadata,beforeMetadata);await db.exec(patch);assert.deepEqual(await info(),current);
 assert.equal(current.definition.replace('n.status_code::text source_status','n.status_group::text source_status').replace("coalesce(nullif(l.status_text,''),l.status_code::text) source_status",'l.status_class::text source_status'),original);
 await db.exec(current.definition.replace('perform private.dashboard_admin_live_scope();','perform private.dashboard_admin_live_scope(); -- drift'));await assert.rejects(()=>db.exec(patch),/definition_drift/);await db.exec('rollback');await db.exec(current.definition);
});
