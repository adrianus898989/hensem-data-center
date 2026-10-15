const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const migration=read('supabase/migrations/20261015140304_yash_channel_provider_classification.sql');
const production=JSON.parse(read('tests/fixtures/yash-channel-production-functions.json'));
let setup,db,f;
const context=vm.createContext({__dirname,require:n=>n==='node:test'?{test(){},before:cb=>{setup=cb},beforeEach(){},after(){}}:require(n)});
vm.runInContext(read('tests/yash-submission-sql.test.cjs').split(/\ntest\(/)[0]+'\nglobalThis.fixture={get db(){return db},get yash(){return yash},daily,seed,cover,streak};',context);
before(async()=>{
 await setup();f=context.fixture;db=f.db;
 await db.exec('drop function private.dashboard_admin_live_expand_provider_filter(jsonb);set check_function_bodies=off;alter table private.yash_orders add column channel text;create table private.provider_snapshot_jobs(status text,lease_until timestamptz);');
 for(const item of production){await db.exec(item.definition);await db.exec('revoke all on function '+item.signature+' from public,anon,authenticated,service_role;'+(item.metadata.proacl.includes('authenticated=X/postgres')?'grant execute on function '+item.signature+' to authenticated;':''));}
 await db.exec(migration);
 await f.seed('SYNTHETIC',{count:16,split:8});
 await db.exec("update private.yash_orders set supplier='ArbPay',channel=case when supplier='Selected Pay' then 'Phonepe_QR' else 'Other-UPI' end");
 await f.cover('2026-10-02');
});
after(async()=>db?.close());
test('live and frozen submission use the same UPI-QR split, whole-member threshold and total',async()=>{
 const live=await f.daily();
 const request={operation:'summary',platformId:f.yash,startAt:'2026-10-02T00:00:00+05:30',endAt:'2026-10-03T00:00:00+05:30',direction:'charge'};
 const catalog=(await db.query('select to_jsonb(p) value from fixture_platforms p where id=$1',[f.yash])).rows[0].value;
 const frozen=(await db.query('select private.provider_snapshot_submission_kernel($1,$2) value',[request,[catalog]])).rows[0].value;
 for(const r of [live,frozen]){
  const totals=r.metrics.filter(m=>m.threshold===15);
  assert.equal(totals.find(m=>m.provider===null).invalid_count,16);
  assert.equal(totals.find(m=>m.provider==='UPI-QR').invalid_count,8);
  assert.equal(totals.find(m=>m.provider==='ArbPay').invalid_count,8);
 }
 assert.deepEqual(frozen.metrics,live.metrics);
});
test('selected-provider submission details do not pull all ArbPay supplier orders',async()=>{
 const rows=(await f.daily({operation:'members',providers:['UPI-QR']})).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].invalid_count,8);
 const arb=(await f.daily({operation:'members',providers:['ArbPay']})).rows;
 assert.equal(arb.length,1);assert.equal(arb[0].invalid_count,8);
});
