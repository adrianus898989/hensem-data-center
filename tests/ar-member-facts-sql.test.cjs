'use strict';
// Exact reviewed SQL, synthetic orders and credential hashes; no network.
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {loadTs}=require('./load-typescript.cjs');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const baseline=read('tests/fixtures/ar-member-facts-publisher-baseline.sql');
const migration=read('supabase/migrations/20261010113000_ar_order_member_facts.sql');
const ddl=read('tests/fixtures/collector-identity-baseline-schema.sql');
const helpers=read('tests/fixtures/collector-identity-baseline-functions.sql');
const apiKey='synthetic_ar_order_scoped_key_'+ 'x'.repeat(40),token=createHash('sha256').update(apiKey).digest('hex'),past=Date.now()-3600000,instant=n=>new Date(past+n*1000).toISOString();
let db,originalMetadata;
const info=async()=>(await db.query("select md5(prosrc) hash,proacl::text acl,proowner,proconfig,prosecdef,provolatile,pg_get_functiondef(oid) definition from pg_proc where oid='public.publish_ar_collected_orders(text,jsonb)'::regprocedure")).rows[0];
const meta=x=>Object.fromEntries(['acl','proowner','proconfig','prosecdef','provolatile'].map(k=>[k,x[k]]));
function order(extra={}){return {order_no:'SYNTHETIC',member_id:'MEMBER',amount:'100.00',amount_text:'100.00',status:'待支付',applied_at:'2026-10-01 10:00:00',completed_at:null,operator:null,raw_channel:'Pay A',channel_type:'UPI',remark:null,manual_remark:null,...extra};}
const batch=(extra={},fields={})=>({action:'ingest',batch_id:randomUUID(),source_system:'AR',country_code:'IN',platform:'JALWA',order_kind:'recharge',observed_at:instant(10),orders:[order(fields)],...extra});
const ingest=async b=>(await db.query('select public.publish_ar_collected_orders($1,$2::jsonb) result',[token,JSON.stringify(b)])).rows[0].result;
const stored=async()=>(await db.query('select member_level,recharge_count,member_id,amount,status,money_format_version,amount_local,amount_usdt from ar_collected_orders')).rows[0];
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create schema extensions;create role anon;create role authenticated;create role service_role bypassrls;
 create function extensions.digest(v text,algorithm text) returns bytea language sql immutable as $$select sha256(convert_to(v,'UTF8'))$$;
 create function private.collector_record_receipt_route_v1(text,text,jsonb,text,uuid) returns void language sql as $$select null::void$$;`);
 const tables=[...ddl.matchAll(/create table public\.(ar_business_direct_credentials|ar_collected_order_receipts|ar_collected_orders) \([\s\S]*?\n\);/g)].map(m=>m[0]);assert.equal(tables.length,3);await db.exec(tables.join('\n'));
 for(const name of ['ar_order_valid_local_time','ar_order_valid_text']){
  const definition=[...helpers.matchAll(/CREATE OR REPLACE FUNCTION ([\s\S]*?)\$function\$\s*;/g)].map(m=>m[0]).find(x=>x.startsWith('CREATE OR REPLACE FUNCTION public.'+name+'('));assert(definition);await db.exec(definition);
 }
 await db.exec(`alter table ar_collected_orders add column amount_local numeric,add column amount_usdt numeric,add column currency_local text,
 add column money_format_version smallint,add column money_observed_at timestamptz,add column money_issue_code text;
 grant usage on schema private,extensions to service_role;grant select,insert,update on all tables in schema public to service_role;`);
 await db.query("insert into ar_business_direct_credentials(token_hash,allowed_scopes,expires_at) values($1,$2::jsonb,now()+interval '1 day')",[token,JSON.stringify([{country_code:'IN',platform:'JALWA'}])]);
 await db.exec(baseline);await db.exec('revoke all on function public.publish_ar_collected_orders(text,jsonb) from public,anon,authenticated;grant execute on function public.publish_ar_collected_orders(text,jsonb) to service_role;');
 const initial=await info();assert.equal(initial.hash,'a43ce2f21c203d20d425b4685f3c8310');originalMetadata=meta(initial);
});
beforeEach(async()=>{await db.exec('rollback;truncate ar_collected_orders,ar_collected_order_receipts;alter table ar_collected_orders drop column if exists member_level cascade;alter table ar_collected_orders drop column if exists recharge_count cascade;');await db.exec(baseline);await db.exec(migration);});
after(async()=>db?.close());
test('old twelve-field clients and either optional field stay compatible; null and absent never become zero',async()=>{
 for(const fields of [{},{member_level:null,recharge_count:null},{member_level:0},{recharge_count:0},{member_level:5,recharge_count:123}]){
  await db.exec('truncate ar_collected_orders,ar_collected_order_receipts');const b=batch({},fields),ack=await ingest(b);assert.equal(ack.status,'accepted');assert.equal((await ingest(b)).status,'unchanged');
  const row=await stored();assert.equal(row.member_level,fields.member_level??null);assert.equal(row.recharge_count,fields.recharge_count??null);assert.equal(Number(row.amount),100);assert.equal(row.member_id,'MEMBER');
 }
});
test('newer old clients/null fields preserve captured facts; valid newer zero updates and stale facts cannot overwrite',async()=>{
 await ingest(batch({observed_at:instant(1)},{member_level:5,recharge_count:12}));
 await ingest(batch({observed_at:instant(2)},{status:'支付失败'}));let row=await stored();assert.equal(row.member_level,5);assert.equal(row.recharge_count,12);assert.equal(row.status,'支付失败');
 await ingest(batch({observed_at:instant(3)},{member_level:null,recharge_count:null}));row=await stored();assert.equal(row.member_level,5);assert.equal(row.recharge_count,12);
 await ingest(batch({observed_at:instant(4)},{member_level:0,recharge_count:0}));row=await stored();assert.equal(row.member_level,0);assert.equal(row.recharge_count,0);
 await ingest(batch({observed_at:instant(2)},{member_level:9,recharge_count:999}));row=await stored();assert.equal(row.member_level,0);assert.equal(row.recharge_count,0);
});
test('invalid grade/count types, fractions, negative, oversized and extra keys fail atomically',async()=>{
 for(const field of ['member_level','recharge_count'])for(const value of ['0','L0',true,{},[],1.5,-1,field==='member_level'?10000:1000000000]){
  await assert.rejects(()=>ingest(batch({orders:[order({order_no:'VALID'}),order({order_no:'INVALID',[field]:value})]})),/ARO_INVALID_MEMBER_FACT/);
  assert.equal((await db.query('select count(*) n from ar_collected_orders')).rows[0].n,0);
 }
 await assert.rejects(()=>ingest(batch({}, {vipLevel:5})),/ARO_INVALID_ORDER/);
 const missing=order({member_level:0,recharge_count:0});delete missing.status;await assert.rejects(()=>ingest(batch({orders:[missing]})),/ARO_INVALID_ORDER/);
});
test('dual-money withdrawal proof remains independent and compatible with optional member facts',async()=>{
 const b=batch({order_kind:'withdraw',money_format_version:1},{amount_local:'100.00',amount_usdt:'2.00',currency_local:'INR',member_level:2,recharge_count:3});
 const ack=await ingest(b);assert.equal(ack.money_format_version,1);assert.equal(ack.money_local_count,1);let row=await stored();assert.equal(row.member_level,2);assert.equal(row.money_format_version,1);assert.equal(Number(row.amount_usdt),2);
 await ingest(batch({order_kind:'withdraw',observed_at:instant(20)},{status:'已通过'}));row=await stored();assert.equal(row.member_level,2);assert.equal(row.recharge_count,3);assert.equal(row.money_format_version,1);assert.equal(Number(row.amount_local),100);
});
test('scope/auth and duplicate/batch-conflict contracts remain enforced',async()=>{
 await assert.rejects(()=>ingest(batch({platform:'91CLUB'})),/ARO_SCOPE_DENIED/);
 await db.query('update ar_business_direct_credentials set revoked=true');await assert.rejects(()=>ingest(batch()),/ARO_AUTH_INVALID/);await db.query('update ar_business_direct_credentials set revoked=false');
 await assert.rejects(()=>ingest(batch({orders:[order(),order()]})),/ARO_INVALID_DUPLICATE/);
 const b=batch({}, {member_level:3,recharge_count:4});await ingest(b);await assert.rejects(()=>ingest({...b,orders:[order({member_level:3,recharge_count:5})]}),/ARO_BATCH_CONFLICT/);
});
test('guarded migration preserves ACL/settings, replays safely, uses nullable integer schema and rejects definition/ACL drift',async()=>{
 const updated=await info();assert.equal(updated.hash,'04d9083ce37811be6b184f397f6a65be');assert.deepEqual(meta(updated),originalMetadata);await db.exec(migration);assert.deepEqual(meta(await info()),originalMetadata);
 const cols=(await db.query("select attname,atttypid::regtype::text type,attnotnull,atthasdef from pg_attribute where attrelid='ar_collected_orders'::regclass and attname in ('member_level','recharge_count') and not attisdropped order by attname")).rows;assert(cols.every(x=>x.type==='integer'&&!x.attnotnull&&!x.atthasdef));
 await db.exec(updated.definition.replace('BEGIN\n', 'BEGIN\n -- drift\n'));await assert.rejects(()=>db.exec(migration),/definition_drift/);await db.exec('rollback');await db.exec(updated.definition);
 await db.exec('grant execute on function public.publish_ar_collected_orders(text,jsonb) to anon');await assert.rejects(()=>db.exec(migration),/acl_drift/);await db.exec('rollback');await db.exec('revoke execute on function public.publish_ar_collected_orders(text,jsonb) from anon');assert.deepEqual(meta(await info()),originalMetadata);
});
test('NOT VALID checks avoid historical validation while enforcing new writes and allow separate later validation',async()=>{
 const checks=(await db.query("select conname,convalidated from pg_constraint where conrelid='ar_collected_orders'::regclass and conname in ('ar_member_level_range','ar_recharge_count_range') order by conname")).rows;
 assert.equal(checks.length,2);assert(checks.every(c=>c.convalidated===false));
 await ingest(batch({}, {member_level:0,recharge_count:0}));
 await assert.rejects(()=>db.exec('update ar_collected_orders set member_level=-1'),/ar_member_level_range/);
 await assert.rejects(()=>db.exec('update ar_collected_orders set recharge_count=1000000000'),/ar_recharge_count_range/);
 await db.exec('alter table ar_collected_orders validate constraint ar_member_level_range;alter table ar_collected_orders validate constraint ar_recharge_count_range;');
 await db.exec(migration);assert((await db.query("select convalidated from pg_constraint where conname in ('ar_member_level_range','ar_recharge_count_range')")).rows.every(c=>c.convalidated));
});
test('migration rejects same-name weakened checks and incompatible column defaults',async()=>{
 await db.exec('alter table ar_collected_orders drop constraint ar_member_level_range;alter table ar_collected_orders add constraint ar_member_level_range check(member_level>=0) not valid;');
 await assert.rejects(()=>db.exec(migration),/constraint_drift/);await db.exec('rollback');
 await db.exec('alter table ar_collected_orders drop constraint ar_member_level_range;alter table ar_collected_orders add constraint ar_member_level_range check(member_level between 0 and 9999) not valid;alter table ar_collected_orders alter column member_level set default 0;');
 await assert.rejects(()=>db.exec(migration),/column_drift/);await db.exec('rollback');
});
test('real HTTP handler and guarded publisher deliver optional facts under service role and retain them through old-client replays',async()=>{
 const {createAROrderHandler}=loadTs(path.join(root,'supabase/functions/ar-order-ingest/handler.ts'));
 const h=createAROrderHandler({SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'},async(url,init)=>{
  assert.equal(url,'https://synthetic.supabase.co/rest/v1/rpc/publish_ar_collected_orders');const p=JSON.parse(init.body);
  assert.equal(p.p_token_hash,token);await db.exec('set role service_role');
  try{return Response.json((await db.query('select public.publish_ar_collected_orders($1,$2::jsonb) result',[p.p_token_hash,JSON.stringify(p.p_payload)])).rows[0].result);}
  finally{await db.exec('reset role');}
 });
 const request=b=>new Request('https://synthetic/functions/v1/ar-order-ingest',{method:'POST',headers:{'X-AR-Key':apiKey,'content-type':'application/json'},body:JSON.stringify(b)});
 const p=batch({observed_at:instant(1)},{member_level:0,recharge_count:12});let response=await h(request(p));assert.equal(response.status,200);assert.equal((await response.json()).status,'accepted');
 response=await h(request(p));assert.equal(response.status,200);assert.equal((await response.json()).status,'unchanged');
 response=await h(request(batch({observed_at:instant(2)})));assert.equal(response.status,200);assert.equal((await stored()).member_level,0);assert.equal((await stored()).recharge_count,12);
});
