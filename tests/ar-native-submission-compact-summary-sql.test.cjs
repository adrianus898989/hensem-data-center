// Local PostgreSQL only. All identities, orders and native scope conflicts are synthetic.
const test=require('node:test'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {readerFixture}=require('./fixtures/maan-submission-auth-rpc-harness.cjs');
const {readArtifact}=require('./fixtures/maan-submission-projection-harness.cjs');
const maan=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261015044337_maan_submission_proven_summary_reader.sql'),'utf8');
const [maanOld,maanNew]=maan.match(/definition:=replace\(definition,\$anchor\$([\s\S]*?)\$anchor\$,\$replacement\$([\s\S]*?)\$replacement\$\);/).slice(1);
const baseline=readArtifact('reader-candidate.sql').replace(maanOld,maanNew);
const install=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261015050057_ar_jaiclub_jalwa_native_compact_summary.sql'),'utf8');
const [anchor,replacement]=install.match(/definition:=replace\(definition,\$old\$([\s\S]*?)\$old\$,\$new\$([\s\S]*?)\$new\$\);/).slice(1);
assert.equal(baseline.split(anchor).length,2);
const candidate=baseline.replace(anchor,replacement),block=replacement.slice(0,-anchor.length);
const business=block.match(/v_sql:=\$ar_native_compact\$([\s\S]*?)\$ar_native_compact\$;/)[1];
const fragment=install.slice(install.indexOf('lock table'),install.lastIndexOf('commit;'));
const signature='private.dashboard_admin_live_submission_analysis(jsonb)';
let db,f,pairs=0,fast=0;
const base={operation:'summary',charts:false,currency:'INR',startAt:'2026-10-14T00:00:00+05:30',endAt:'2026-10-15T00:00:00+05:30'};
async function batch(sql,args){for(const part of sql.split(';').filter(x=>x.trim()))await db.query(part,args);}
async function call(q={}){let out=await f.call(f.request({...base,...q}));delete out.asOf;return out;}
async function compare(inputs){await db.exec('begin isolation level repeatable read');try{await db.exec(baseline);const out=[];for(const q of inputs)out.push(await call(q));await db.exec(candidate);for(let i=0;i<inputs.length;i++){assert.deepEqual(await call(inputs[i]),out[i],JSON.stringify(inputs[i]));pairs++;}return out;}finally{await db.exec('rollback');}}
async function capture(q={},body=candidate){await db.exec(body);const src=(await db.query("select prosrc from pg_proc where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure")).rows[0].prosrc;const i=src.search(/\bexecute\s+v_sql\s+into\s+v_result\s+using\b/i);assert(i>0);await db.exec("create or replace function private.capture_native_summary(p_request jsonb)returns jsonb language plpgsql stable security definer set search_path=''as $capture$"+src.slice(0,i)+"return jsonb_build_object('sql',v_sql,'nativeCompact',position('from public.ar_collected_orders a where a.source_system=''AR'' and a.country_code=$2 and a.platform=$3 and a.order_kind=''recharge'' and $2::text=''IN'''in v_sql)>0 and position('qualified_amounts as materialized'in v_sql)>0);end;$capture$;");return(await db.query('select private.capture_native_summary($1::jsonb)x',[JSON.stringify(f.request({...base,...q}))])).rows[0].x;}
async function seed(member,n=20,{platform,day='2026-10-14'}={}){await db.query(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,status,applied_at,raw_channel,member_level,recharge_count,amount)
select 'AR','IN',$3,'recharge',$1||'-'||i,$1,'待支付',$4::date+time'10:00'+i*interval'1 second',case when i%2=0 then'route-a'else'Other Pay'end,0,0,case when i=1 then 0 else 123.45 end from generate_series(1,$2::int)i`,[member,n,platform,day]);}
test('native JAI/JALWA compact summaries preserve complete authenticated DTOs, source boundaries and fallback',async()=>{const fixture=await readerFixture();({db,f}=fixture);try{await f.as(f.owner);const metadata=(await db.query("select to_jsonb(p)-'prosrc'x from pg_proc p where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure")).rows[0].x;const checks=[];
for(const platform of['JAICLUB','JALWA']){
 await db.query("update fixture_platforms set source_name=$1,name=$1,currency='INR',timezone='Asia/Kolkata'where id=$2",[platform,f.ids.ar]);
 for(const member of['VALID','PAID','PRIOR','LATER','UNKNOWN','UNDATED','UNKNOWN-MONEY','0001','1','汉字原生用户','NULLCOUNT','BADLEVEL'])await seed(member,20,{platform});for(const n of[10,11,15,16,20,21,30,31,50,51,100,101])await seed('T-'+n,n,{platform});await seed('DAY2',20,{platform,day:'2026-10-15'});
 for(const value of[null,-2147483648,-1,0,1,9999,10000,999999999,1000000000,2147483647]){const member='INT-'+String(value);await seed(member,20,{platform});await db.query('update ar_collected_orders set member_level=$1,recharge_count=$1 where platform=$2 and member_id=$3',[value,platform,member]);}
 await db.query(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,status,applied_at,raw_channel,amount)values
 ('OTHER','IN',$1,'recharge','VALID-2','VALID','待支付',null,'Other Pay',9999999.99),
 ('AR','PK',$1,'recharge','VALID-2','VALID','待支付',null,'Other Pay',8888888.88),
 ('AR','IN','OTHER-'||$1,'recharge','VALID-2','VALID','待支付',null,'Other Pay',7777777.77),
 ('AR','IN',$1,'withdraw','VALID-2','VALID','待支付',null,'Other Pay',6666666.66)`,[platform]);

 await batch(`update ar_collected_orders set status='已支付',completed_at='2026-10-14 14:00'where platform=$1 and order_no='PAID-19';update ar_collected_orders set status='已支付',completed_at='2026-10-15 14:00'where platform=$1 and order_no='LATER-19';update ar_collected_orders set status='unknown',raw_channel='unselected'where platform=$1 and order_no='UNKNOWN-19';update ar_collected_orders set applied_at=null,raw_channel='unselected'where platform=$1 and order_no='UNDATED-19';update ar_collected_orders set amount=null where platform=$1 and order_no='UNKNOWN-MONEY-19';update ar_collected_orders set recharge_count=null where platform=$1 and member_id='NULLCOUNT';update ar_collected_orders set member_level=10000,recharge_count=1000000000 where platform=$1 and member_id='BADLEVEL';`,[platform]);
 await db.query(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,status,applied_at,completed_at,raw_channel,amount,member_level,recharge_count)values
('AR','IN',$1,'recharge','PRIOR-SUCCESS','PRIOR','已支付','2026-10-13 10:00','2026-10-14 14:00','unselected',1,0,0),
('AR','IN',$1,'recharge','NO-MEMBER',null,'unknown','2026-10-14 10:00:02',null,'route-a',0,0,0),
('AR','IN',$1,'recharge','BLANK-MEMBER',' ','待支付','2026-10-14 10:00:03',null,'route-b',0,0,0),
('OTHER','IN',$1,'recharge','FOREIGN-SOURCE','VALID','unknown',null,null,'other',1,0,0),
('AR','PK',$1,'recharge','FOREIGN-COUNTRY','VALID','unknown',null,null,'other',1,0,0),
('AR','IN',$1,'withdraw','FOREIGN-KIND','VALID','unknown',null,null,'other',1,0,0);`,[platform]);
 const inputs=[{}, {charts:true},{providers:['CombinedPay']},{providers:['Other Pay']},{providers:['ABSENT']},{providers:[]},...[10,15,20,30,50,100].map(threshold=>({threshold})),{endAt:'2026-10-16T00:00:00+05:30'},{startAt:'2026-10-14T10:00:01+05:30',endAt:'2026-10-14T10:00:08+05:30'},{startAt:'2026-10-14T20:00:00+05:30',endAt:'2026-10-14T21:00:00+05:30'},...['all','new','funded','unknown','l0'].map(level=>({operation:'members',level,limit:20,offset:1})),...['VALID','PAID','PRIOR','LATER','UNKNOWN','UNDATED','UNKNOWN-MONEY','0001','1'].map(memberId=>({operation:'memberOrders',memberId,day:'2026-10-14',providers:['CombinedPay']}))];
 const out=await compare(inputs);assert.equal(out[0].dashboard,null);assert.equal(out[0].coverage.sourceCompletenessVerified,false);assert(out[0].coverage.orderCount>0);assert.equal(out[4].coverage.orderCount,0);assert(out[0].coverage.unknownStatusCount>0);assert(out[0].coverage.orderSequenceUncertainCount>0);let cap=await capture();assert(cap.nativeCompact);assert.equal(cap.sql.trimEnd(),business.trimEnd());assert(!cap.sql.includes('private.ar_91club_submission_facts'));assert.equal((cap.sql.match(/from public.ar_collected_orders a/g)||[]).length,4);assert.equal((cap.sql.match(/dashboard_admin_ar_local_amount/g)||[]).length,1);fast++;for(const q of[{charts:true},{operation:'members'},{operation:'memberOrders',memberId:'VALID',day:'2026-10-14'}])assert.equal((await capture(q)).sql,(await capture(q,baseline)).sql);
 // Integer grammar/native blank identity boundaries and money stay exact.
 await batch("update ar_collected_orders set money_format_version=1,amount_local=0,currency_local='INR'where platform=$1 and order_no='VALID-2';update ar_collected_orders set money_format_version=1,amount_local=12345678901234567890.12345678,currency_local='INR'where platform=$1 and order_no='VALID-4';update ar_collected_orders set money_format_version=1,amount_local=9,currency_local='USD'where platform=$1 and order_no='VALID-6';update ar_collected_orders set money_issue_code='LOCAL_AMOUNT_STALE_FOR_USDT'where platform=$1 and order_no='VALID-8';update ar_collected_orders set order_no=' 'where platform=$1 and order_no='BADLEVEL-20';",[platform]);await compare([{}, {providers:['CombinedPay']},{threshold:10},{threshold:100}]);
 // Guard failures use byte-identical old generic SQL, not partial new results.
 for(const drift of["alter table ar_collected_orders alter member_level type bigint","alter table ar_collected_orders drop constraint ar_collected_orders_pkey cascade","grant execute on function private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)to anon",`create table fixture_ar_child()inherits(ar_collected_orders);insert into fixture_ar_child select * from ar_collected_orders where platform='${platform}'and order_no='VALID-20'`]){await db.exec('begin;'+drift);try{await db.exec(baseline);const old=await call({});await db.exec(candidate);assert.deepEqual(await call({}),old);pairs++;assert.equal((await capture()).nativeCompact,false);}finally{await db.exec('rollback');}}
 await db.exec('begin');try{await db.exec('alter table ar_collected_orders drop constraint ar_collected_orders_pkey cascade');await db.query("insert into ar_collected_orders select * from ar_collected_orders where platform=$1 and order_no='VALID-20'",[platform]);await db.exec(baseline);let old=await call({});await db.exec(candidate);assert.deepEqual(await call({}),old);pairs++;assert.equal((await capture()).nativeCompact,false);}finally{await db.exec('rollback');}
 checks.push(platform+': native lane captured, full DTO/NULL/whole-day/provider/strict-threshold/money/PK/int/ACL drift scenarios passed');
}
await db.exec(candidate);assert.deepEqual((await db.query("select to_jsonb(p)-'prosrc'x from pg_proc p where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure")).rows[0].x,metadata);await f.as(f.viewer);await assert.rejects(()=>call({}),/platform_denied/);await f.as(f.owner);checks.push('Function metadata unchanged and existing synthetic viewer scope denial before new lane');

assert.equal(pairs,76);assert.equal(fast,2);console.log(JSON.stringify({completeRpcJsonPairs:pairs,genuineNativeCompactPlatforms:fast,productionCalls:false}));
}finally{await fixture.close();}});

const info=async database=>(await database.query("select md5(prosrc)h,pg_get_functiondef(oid)d,to_jsonb(p)-'prosrc'm from pg_proc p where oid=$1::regprocedure",[signature])).rows[0];
const executeFragment=async(database,sql)=>{await database.exec("begin;set local search_path=''");try{await database.exec(sql);await database.exec('commit');}catch(e){await database.exec('rollback');throw e;}};
// Build the inverse from the exact tested forward patch. It is maintenance SQL,
// not a separately scheduled migration and has no dependency outside this repo.
const reverse=fragment.replaceAll('3a8012390d65b3a698c749bee099d0d0','__OLD__').replaceAll('08f4fda2ac67706ff667addfca4ffdf2','3a8012390d65b3a698c749bee099d0d0').replaceAll('__OLD__','08f4fda2ac67706ff667addfca4ffdf2')
 .replaceAll('$old$'+anchor+'$old$','$inverse_old$'+replacement+'$inverse_old$').replaceAll('$new$'+replacement+'$new$','$inverse_new$'+anchor+'$inverse_new$');
test('guarded installer preserves OID/full metadata/MAAN body, replays, restores exact baseline and rejects drift atomically',async()=>{
 const x=await readerFixture(),database=x.db;
 try{
  await database.exec(baseline);const before=await info(database);assert.equal(before.h,'3a8012390d65b3a698c749bee099d0d0');
  const source=()=>database.query("select md5(coalesce(jsonb_agg(to_jsonb(a)order by source_system,country_code,platform,order_kind,order_no)::text,'[]'))h from ar_collected_orders a");
  const sourceBefore=(await source()).rows;
  await database.exec(install);const after=await info(database);assert.equal(after.h,'08f4fda2ac67706ff667addfca4ffdf2');assert.deepEqual(after.m,before.m);
  assert.equal(after.d.replace(block,''),before.d);assert.equal(candidate.replace(block,''),baseline);
  await database.exec(install);assert.deepEqual(await info(database),after);assert.deepEqual((await source()).rows,sourceBefore);
  await executeFragment(database,reverse);assert.deepEqual(await info(database),before);await executeFragment(database,reverse);assert.deepEqual(await info(database),before);
  const states=[
   'alter function '+signature+' set jit=on',
   'alter function '+signature+' strict',
   'alter function '+signature+' cost 101',
   'grant execute on function '+signature+' to anon',
   'alter table public.ar_collected_orders alter member_level type bigint',
   'alter table public.ar_collected_orders drop constraint ar_collected_orders_pkey cascade',
   'create table public.fixture_install_child()inherits(public.ar_collected_orders)',
   'grant execute on function private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)to anon',
  ];
  for(const state of states){await database.exec('begin;'+state);const old=await info(database);await assert.rejects(()=>database.exec(fragment),/native_summary_(metadata|native_prerequisite)_drift/);await database.exec('rollback');assert.deepEqual(await info(database),before);}
  await database.exec('begin');await database.exec(baseline.replace('perform private.dashboard_admin_live_scope();','perform private.dashboard_admin_live_scope(); -- synthetic drift'));await assert.rejects(()=>database.exec(fragment),/native_summary_definition_drift/);await database.exec('rollback');assert.deepEqual(await info(database),before);
  const damaged=fragment.replace("is distinct from '08f4fda2ac67706ff667addfca4ffdf2'","is distinct from '00000000000000000000000000000000'");
  await assert.rejects(()=>executeFragment(database,damaged),/native_summary_after_assertion_failed/);assert.deepEqual(await info(database),before);
 }finally{await x.close();}
});
