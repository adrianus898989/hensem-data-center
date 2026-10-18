// PostgreSQL execution, synthetic inputs only. The repository's whole original
// workorder query is the before/after oracle; no replacement aggregation exists.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../supabase/operations/workorder-deposit-created-index.sql'),'utf8');
const sql=source.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n').trim();
test('maintenance is one exact concurrent nonunique partial access path, with no source/kernel/grant/scheduler writes',()=>{
 assert.equal(sql.split(';').filter(x=>x.trim()).length,1);
 assert.equal(sql,"CREATE INDEX CONCURRENTLY newar_workorder_deposit_created_v1_idx\nON public.newar_detail_records USING btree (platform,created_at)\nWHERE dataset='workorder'\n  AND workorder_type IN ('存款未到账','存款未到账自动化');");
 assert(!/\b(?:UNIQUE|INCLUDE|BEGIN|DO|INSERT|UPDATE|DELETE|GRANT|REVOKE|ALTER|FUNCTION|SCHEDULE|REINDEX|VACUUM|ANALYZE)\b/i.test(sql));
});
test('whole original JSONB text, global cross-day originals, unknown/conflicting money and source coverage are unchanged by creation/drop',async()=>{
 const prefix=fs.readFileSync(path.join(__dirname,'admin-newar-workorder-detail-cohorts.test.cjs'),'utf8').split(/\ntest\(/)[0];let setup;
 const fixtureRequire=n=>n==='node:test'?{...require(n),before:fn=>{setup=fn},after:()=>{},beforeEach:()=>{},afterEach:()=>{}}:require(n);
 const fixture=new Function('require','__dirname',prefix+';return {ticket,daily,db:()=>db};')(fixtureRequire,__dirname);await setup();const db=fixture.db();
 try{
  await db.exec(`delete from catalog;delete from newar_detail_platforms;
   insert into catalog values('10000000-0000-4000-8000-000000000001','SITE_A','SITE_A','印度','IN','ar','INR'),('10000000-0000-4000-8000-000000000002','SITE_N','SITE_N','印度','IN','newar','INR');
   insert into newar_detail_platforms values('SITE_N','IN','印度','Asia/Kolkata','INR',true,null);
   insert into ar_workorder_issue_details values('AR','IN','印度','SITE_A','AR-TEST','TEST-TICKET','AR-ORIGINAL',null,7.123456789012345678,'deposit','TestPay','BANK',4,'2025-02-01',true);
   insert into workorder_deposit_daily values('2025-02-01','IN','印度','SITE_A','TestPay','BANK','AR_WORKORDER',1,7.123456789012345678,1,7.123456789012345678,0,0,0,0,'2025-02-03T00:00:00Z','2025-02-03T00:00:00Z','{"存款/已处理":1}');`);
  for(const [id,ref,extra]of[
   ['first','CROSS-DAY',{created:'2025-02-01T12:00:00+05:30',amount:'9007199254740993.123456789012345678'}],
   ['second','CROSS-DAY',{created:'2025-02-02T12:00:00+05:30',status:'4',amount:'9007199254740993.123456789012345678'}],
   ['unknown','CROSS-DAY',{provider:'未识别三方',status:'4'}],
   ['conflict-a','CONFLICT',{amount:1}],['conflict-b','CONFLICT',{provider:'OtherTestPay',amount:2}],
   ['missing',null,{raw:{depositOrderNo:7},amount:null}],['standard','STANDARD',{type:'存款未到账'}],
   ['excluded','USDT-ONLY',{type:'USDT存款未到账自动化',currency:'USDT'}],['wrong-dataset','WRONG',{dataset:'charge'}]
  ])await fixture.ticket(id,ref,{provider:'TestPay-QR',platform:'SITE_N',created:'2025-02-01T13:00:00+05:30',...extra});
  const q={country:'印度',platforms:['SITE_A','SITE_N'],startAt:'2025-02-01T00:00:00Z',endAt:'2025-02-02T23:59:59Z',direction:'all',limit:20};
  const extras=[{},{providers:['TestPay']},{providers:['OtherTestPay']},{providers:['TestPay','OtherTestPay']},{providers:[]},{providers:['AbsentTestPay']},{provider:'TestPay'},{direction:'charge'},{direction:'withdraw'},{offset:999},{platforms:['SITE_A']},{platforms:['SITE_N']}];
  const call=async extra=>(await db.query('select private.dashboard_admin_live_workorders($1::jsonb)::text value',[JSON.stringify({...q,...extra})])).rows[0].value;
  const metadata=async()=>(await db.query("select jsonb_agg(to_jsonb(p)order by p.oid)value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')and p.proname like'dashboard_admin_live_workorder%'")).rows[0].value;
  const inputs=async()=>(await db.query("select jsonb_build_object('ar',(select jsonb_agg(to_jsonb(r)order by work_order_id)from ar_workorder_issue_details r),'native',(select jsonb_agg(to_jsonb(r)order by source_id)from newar_detail_records r),'daily',(select jsonb_agg(to_jsonb(r)order by stat_date,platform)from workorder_deposit_daily r))value")).rows[0].value;
  const existing=async()=>(await db.query("select jsonb_agg(jsonb_build_object('oid',c.oid,'definition',pg_get_indexdef(c.oid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive)order by c.relname)value from pg_class c join pg_index i on i.indexrelid=c.oid where i.indrelid='newar_detail_records'::regclass and c.relname<>'newar_workorder_deposit_created_v1_idx'")).rows[0].value;
  const before=await Promise.all(extras.map(call)),beforeMetadata=await metadata(),beforeInputs=await inputs(),beforeIndexes=await existing();assert(before.some(s=>s.includes('9007199254740993.123456789012345678')));
  await db.exec(sql);
  const i=(await db.query("select i.indisvalid,i.indisready,i.indislive,i.indisunique,i.indnkeyatts,i.indnatts,i.indexprs,pg_get_expr(i.indpred,i.indrelid)predicate from pg_index i where i.indexrelid='newar_workorder_deposit_created_v1_idx'::regclass")).rows[0];
  assert(i.indisvalid&&i.indisready&&i.indislive);assert.equal(i.indisunique,false);assert.equal(i.indnkeyatts,2);assert.equal(i.indnatts,2);assert.equal(i.indexprs,null);assert.equal(i.predicate,"((dataset = 'workorder'::text) AND (workorder_type = ANY (ARRAY['存款未到账'::text, '存款未到账自动化'::text])))");
  for(let n=0;n<extras.length;n++)assert.equal(await call(extras[n]),before[n],JSON.stringify(extras[n]));
  assert.deepEqual(await metadata(),beforeMetadata);assert.deepEqual(await inputs(),beforeInputs);assert.deepEqual(await existing(),beforeIndexes);
  await db.exec("set test.active='false'");await assert.rejects(call({}),/preview_denied/);await db.exec("set test.active='true';set role authenticated");await assert.rejects(db.query('select *from newar_detail_records'),/permission denied/);await db.exec('reset role');
  await db.exec('DROP INDEX CONCURRENTLY public.newar_workorder_deposit_created_v1_idx;');
  assert.equal((await db.query("select to_regclass('public.newar_workorder_deposit_created_v1_idx')value")).rows[0].value,null);assert.deepEqual(await existing(),beforeIndexes);assert.deepEqual(await metadata(),beforeMetadata);assert.deepEqual(await inputs(),beforeInputs);
 }finally{await db.close();}
});
