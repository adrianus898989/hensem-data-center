// Real current workorder SQL over synthetic records only. Local plans/timings
// do not demonstrate production speed or concurrent-build locking behavior.
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const operation=fs.readFileSync(path.join(__dirname,'../supabase/operations/workorder-usdt-created-index.sql'),'utf8');
const sql=operation.split('\n').filter(line=>!line.trim().startsWith('--')).join('\n').trim();
const indexName='newar_workorder_usdt_created_v1_idx',signature='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)';
const query={country:'印度',platforms:['Alpha','DhaniWin','DHANIWIN'],direction:'all',startAt:'2026-10-02T00:00:00Z',endAt:'2026-10-08T23:59:59Z',limit:20};
async function fixture(){
 const source=fs.readFileSync(path.join(__dirname,'admin-workorder-unique-provider-batch.test.cjs'),'utf8').split(/\ntest\(/)[0];let setup;
 const load=n=>n==='node:test'?{...require(n),before:fn=>setup=fn,after:()=>{},beforeEach:()=>{},afterEach:()=>{}}:require(n);
 const f=new Function('require','__dirname',source+';return {db,api,ar,dailyAr};')(load,__dirname);await setup();const db=f.db();
 // The existing public fixture supplies the original 770866 helper. Apply the
 // separately shipped daily-name-only replacement to test current 39393 SQL.
 const daily=fs.readFileSync(path.join(__dirname,'../supabase/operations/workorder-daily-provider-batch.sql'),'utf8');
 const before=daily.match(/before_text constant text:=\$before\$([\s\S]*?)\$before\$/)[1],after=daily.match(/after_text constant text:=\$after\$([\s\S]*?)\$after\$/)[1];
 const old=(await db.query('select pg_get_functiondef($1::regprocedure)v',[signature])).rows[0].v;assert.equal(old.split(before).length,2);await db.exec(old.replace(before,after));
 assert.equal((await db.query('select md5(prosrc)v from pg_proc where oid=$1::regprocedure',[signature])).rows[0].v,'39393d9ff3333631da2086cb42517fd9');
 const scalar=async(s,args=[])=>(await db.query(s,args)).rows[0]?.v;
 const call=extra=>scalar('select private.dashboard_admin_live_workorders($1::jsonb)::text v',[JSON.stringify({...query,...extra})]);
 const inputs=()=>scalar("select jsonb_build_object('ar',(select jsonb_agg(to_jsonb(r)order by work_order_id)from ar_workorder_issue_details r),'native',(select jsonb_agg(to_jsonb(r)order by platform,dataset,source_id)from newar_detail_records r),'daily',(select jsonb_agg(to_jsonb(r)order by stat_date,platform,third_party)from workorder_deposit_daily r))::text v");
 const metadata=()=>scalar("select jsonb_agg(to_jsonb(p)order by p.oid)::text v from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')");
 const indexes=()=>scalar("select jsonb_agg(jsonb_build_object('oid',c.oid,'definition',pg_get_indexdef(c.oid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive)order by c.relname)::text v from pg_class c join pg_index i on i.indexrelid=c.oid where i.indrelid='newar_detail_records'::regclass and c.relname<>'newar_workorder_usdt_created_v1_idx'");
 const same=async(extras=[{}],inspect)=>{const results=await Promise.all(extras.map(call)),raw=await inputs(),meta=await metadata(),existing=await indexes();if(inspect)await inspect(results);await db.exec(sql);for(let i=0;i<extras.length;i++)assert.equal(await call(extras[i]),results[i],JSON.stringify(extras[i]));assert.equal(await inputs(),raw);assert.equal(await metadata(),meta);assert.equal(await indexes(),existing);await db.exec('DROP INDEX CONCURRENTLY public.'+indexName);for(let i=0;i<extras.length;i++)assert.equal(await call(extras[i]),results[i]);assert.equal(await inputs(),raw);assert.equal(await metadata(),meta);assert.equal(await indexes(),existing);};
 return{...f,db,scalar,call,same,inputs,metadata,indexes,close:()=>db.close()};
}
const byProvider=(text,name)=>JSON.parse(text).byProvider.find(row=>row.provider===name);
const excluded=(f,id,extra={})=>f.api.ticket(id,null,{provider:'ExcludedPay',type:'USDT存款未到账自动化',raw:{},...extra});

test('maintenance is one exact concurrent nonunique partial access path without INCLUDE or semantic writes',()=>{
 assert.equal(sql,"CREATE INDEX CONCURRENTLY newar_workorder_usdt_created_v1_idx\nON public.newar_detail_records USING btree(platform,created_at)\nWHERE dataset='workorder' AND workorder_type='USDT存款未到账自动化';");
 assert.equal(sql.split(';').filter(x=>x.trim()).length,1);assert(!/\b(?:UNIQUE|INCLUDE|BEGIN|DO|INSERT|UPDATE|DELETE|GRANT|REVOKE|ALTER|FUNCTION|SCHEDULE|REINDEX|VACUUM|ANALYZE)\b/i.test(sql));
});

test('current39393 whole JSON text and all source/raw/metadata remain exact for three types, cross-day originals and every scope',async()=>{
 const f=await fixture();try{
  await f.ar('AR','AR-ORIGINAL',{amount:'9007199254740993.123456789012345678',status:4});await f.dailyAr();
  await f.api.ticket('first','CROSS-DAY',{provider:'SUPER',created:'2026-10-02T12:00:00+05:30',amount:'9007199254740993.123456789012345678',type:'存款未到账'});
  await f.api.ticket('second','CROSS-DAY',{provider:'SUPER',created:'2026-10-08T12:00:00+05:30',amount:'9007199254740993.123456789012345678',status:'4'});
  await f.api.ticket('unknown','CROSS-DAY',{provider:'未识别三方',status:'4',amount:null,raw:{depositOrderNo:'CROSS-DAY',retained:'synthetic raw field'}});
  await f.api.ticket('conflict-a','CONFLICT',{provider:'SUPER',amount:1});await f.api.ticket('conflict-b','CONFLICT',{provider:'OtherPay',amount:2});
  await excluded(f,'usdt',{currency:'USDT',amount:'0.123456789012345678'});await f.api.daily({provider:'ExcludedPay',submitted:1,amount:'0.123456789012345678'});
  await f.same([{}, {providers:['SUPER']},{providers:['OtherPay']},{providers:['SUPER','OtherPay']},{providers:[]},{providers:['Absent']},{provider:'SUPER'},{direction:'charge'},{direction:'withdraw'},{offset:999},{limit:100},{platforms:['Alpha']},{platforms:['DhaniWin','DHANIWIN']}],texts=>assert(texts.some(t=>t.includes('9007199254740993.123456789012345678'))));
 }finally{await f.close();}
});

test('excluded USDT diagnostic counts and null currency never become an INR original or a guessed complete result',async()=>{
 const f=await fixture();try{
  await f.api.ticket('FIAT','ORIGINAL',{provider:'SUPER',amount:200,status:'4'});
  await excluded(f,'U1',{amount:987,currency:null});await f.api.daily({provider:'ExcludedPay',submitted:1,amount:987});
  await f.same([{platforms:['DhaniWin']}],texts=>{const r=JSON.parse(texts[0]),u=byProvider(texts[0],'ExcludedPay'),d=u.uniqueCoverage.diagnosticDays[0];assert.equal(d.excludedWorkorderTypeCount,1);assert.equal(d.excludedTypeExplainedMismatchCount,1);assert.equal(d.unexplainedDetailMismatchCount,0);assert.equal(d.rawAmountComparison.excludedTypeCurrency,null);assert.equal(d.rawAmountComparison.currency,null);assert.equal(d.rawAmountComparison.excludedTypeAmount,987);assert.equal(u.uniqueOrderCount,null);assert.equal(u.uniqueCoverage.complete,false);assert.equal(r.summary.uniqueOrderCount,null);assert.equal(r.summary.uniqueOrderAmount,null);});
 }finally{await f.close();}
});

test('mixed currency and missing amounts retain nullable excluded evidence with high-precision SQL values',async()=>{
 const f=await fixture();try{
  await excluded(f,'M1',{currency:'USDT',amount:'9007199254740993.000000000000000001'});await excluded(f,'M2',{currency:'INR',amount:'0.000000000000000009'});
  await f.api.daily({provider:'ExcludedPay',submitted:2,amount:'9007199254740993.000000000000000010'});
  await f.same([{}],texts=>{const d=byProvider(texts[0],'ExcludedPay').uniqueCoverage.diagnosticDays[0];assert.equal(d.excludedWorkorderTypeCount,2);assert.equal(d.rawAmountComparison.excludedTypeCurrency,null);assert(texts[0].includes('9007199254740993.000000000000000010'));});
  await excluded(f,'M3',{currency:null,amount:null});await f.db.exec("update workorder_deposit_daily set submitted_count=3,submitted_amount=null where third_party='ExcludedPay'");
  await f.same([{}],texts=>{const d=byProvider(texts[0],'ExcludedPay').uniqueCoverage.diagnosticDays[0];assert.equal(d.excludedWorkorderTypeCount,3);assert.equal(d.rawAmountComparison.excludedTypeCurrency,null);assert.equal(d.rawAmountComparison.excludedTypeAmount,null);assert.equal(d.rawAmountComparison.excludedTypeDifferenceAmount,null);});
 }finally{await f.close();}
});

test('native, dataset, exact local date, launch and unrelated type exclusions remain the original predicates',async()=>{
 const f=await fixture();try{
  await excluded(f,'START',{created:'2026-10-01T18:30:00Z',amount:11});await excluded(f,'END',{created:'2026-10-08T18:29:59.999Z',amount:13});
  for(const[id,extra]of[['before',{created:'2026-10-01T18:29:59.999Z'}],['after',{created:'2026-10-08T18:30:00Z'}],['platform',{platform:'OtherSite'}],['country',{platform:'CrossCountry',currency:'PKR'}],['dataset',{dataset:'charge'}],['type',{type:'USDT存款未到账自动化-extra'}]])await excluded(f,id,extra);
  await f.api.daily({date:'2026-10-02',provider:'ExcludedPay',submitted:1,amount:11});await f.api.daily({date:'2026-10-08',provider:'ExcludedPay',submitted:1,amount:13});
  await f.same([{}, {platforms:['DhaniWin']},{platforms:['Alpha']},{providers:['Absent']}],texts=>{const days=byProvider(texts[0],'ExcludedPay').uniqueCoverage.diagnosticDays;assert.equal(days.reduce((n,d)=>n+d.excludedWorkorderTypeCount,0),2);});
  await f.db.exec("update newar_detail_platforms set launch_at='2026-10-03T00:00:00+05:30'where platform='DhaniWin'");await f.same([{}],texts=>{const days=byProvider(texts[0],'ExcludedPay').uniqueCoverage.diagnosticDays;assert.equal(days.reduce((n,d)=>n+d.excludedWorkorderTypeCount,0),1);});
 }finally{await f.close();}
});

test('a zero, empty or amount-mismatched excluded cohort stays explicit without manufacturing source completeness',async()=>{
 const f=await fixture();try{
  await f.api.daily({provider:'ExcludedPay',submitted:0,amount:0});await f.same([{}]);
  await excluded(f,'GAP',{currency:null,amount:987});await f.db.exec("update workorder_deposit_daily set submitted_count=1,submitted_amount=1000");
  await f.same([{}],texts=>{const u=byProvider(texts[0],'ExcludedPay'),d=u.uniqueCoverage.diagnosticDays[0];assert.equal(d.rawAmountComparison.excludedTypeDifferenceAmount,null);assert.equal(d.rawAmountComparison.unexplainedDifferenceAmount,13);assert.equal(u.uniqueCoverage.needsReview,true);assert.equal(u.uniqueOrderCount,null);});
 }finally{await f.close();}
});

test('index metadata is exact and session/scope/table permissions are unchanged',async()=>{
 const f=await fixture();try{
  await f.api.ticket('VISIBLE','VISIBLE',{provider:'SUPER'});const raw=await f.inputs(),meta=await f.metadata(),existing=await f.indexes();await f.db.exec(sql);
  const i=(await f.db.query("select i.indisvalid,i.indisready,i.indislive,i.indisunique,i.indnkeyatts,i.indnatts,i.indexprs,pg_get_expr(i.indpred,i.indrelid)predicate from pg_index i where i.indexrelid='newar_workorder_usdt_created_v1_idx'::regclass")).rows[0];
  assert(i.indisvalid&&i.indisready&&i.indislive);assert.equal(i.indisunique,false);assert.equal(i.indnkeyatts,2);assert.equal(i.indnatts,2);assert.equal(i.indexprs,null);assert.equal(i.predicate,"((dataset = 'workorder'::text) AND (workorder_type = 'USDT存款未到账自动化'::text))");
  await f.db.exec("set test.scope='{\"mode\":\"selected\",\"platforms\":[\"Alpha\"]}'");assert.equal(JSON.parse(await f.call({})).byPlatformProvider.length,0);
  await f.db.exec("set test.active='false'");await assert.rejects(f.call({}),/preview_denied/);await f.db.exec("set test.active='true';set role authenticated");await assert.rejects(f.db.query('select *from newar_detail_records'),/permission denied/);await f.db.exec('reset role');
  assert.equal(await f.inputs(),raw);assert.equal(await f.metadata(),meta);assert.equal(await f.indexes(),existing);
 }finally{await f.close();}
});
