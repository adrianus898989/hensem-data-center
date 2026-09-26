// Synthetic PostgreSQL fixtures; never connects to or impersonates a production account.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');let db;
const read=n=>fs.readFileSync(path.join(__dirname,'../supabase',n),'utf8');
const feed=(dataset,system,country,platform,direction='charge',sourceKind='direct')=>({dataset,system,country,platform,direction,sourceKind});
const sheet=platform=>feed('volume','REPORT','胖虎巴西',platform,'charge','google_sheets');
const query=(feeds,extra={})=>({startAt:'2026-09-24',endAt:'2026-09-25',feeds,...extra});
const call=async q=>(await db.query('select public.dashboard_admin_live_report_summary($1::jsonb) data',[JSON.stringify(q)])).rows[0].data;
const scope=async value=>db.query("select set_config('test.scope',$1,false)",[JSON.stringify(value)]);
before(async()=>{
 db=new PGlite();await db.exec(`
 create schema private;create role anon;create role authenticated;grant usage on schema private to authenticated;
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin if coalesce(current_setting('test.scope',true),'')='' then raise exception 'unauthorized';end if;return current_setting('test.scope')::jsonb;end$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select $1->>'mode'='all' or coalesce($1->'countries' ? $2,false) and (not($1 ? 'platforms') or $1->'platforms' ? $3)$$;
 create table third_party_volume(country text,platform text,data_date date,updated_at timestamptz,direction text,raw_channel text,channel text,amount numeric,count int,success_count int,failed_count int,quarantined_at timestamptz,sheet_name text,source_row int,raw jsonb);
 create table panda_success_rate_daily(country text,country_code text,platform text,stat_date date,updated_at timestamptz,direction text,third_party text,submitted_count int,success_count int,failed_count int);
 create table lg_success_daily(country_code text,platform text,stat_date date,observed_at timestamptz,updated_at timestamptz,order_kind text,scope_type text,third_party text,raw_channel text,total_count bigint,success_count bigint,failed_count bigint,pending_count bigint,unknown_count bigint,total_amount numeric,success_amount numeric);
 create table collection_success_daily(source_system text,country_code text,platform text,stat_date date,snapshot_at timestamptz,updated_at timestamptz,snapshot jsonb);
 create table newar_business_snapshots(kind text,country text,country_code text,platform text,stat_date date,captured_at timestamptz,updated_at timestamptz,direction text,payload jsonb);
 create table auto_withdraw_daily(country text,platform text,data_date date,source_updated_at timestamptz,updated_at timestamptz,total int,success int,rejected int,auto_count int,manual_count int,avg_seconds numeric,source_sheet text);
 insert into third_party_volume values
 ('胖虎巴西','FUTURE','2026-09-24','2026-09-25Z','代收','P','P',100,10,10,10,null,'[三方量表1] raw',1,'{"token":"PRIVATE-VALUE"}'),
 ('胖虎巴西','FUTURE','2026-09-25','2026-09-26Z','代收','P','P',200,20,20,20,null,'[三方量表1] raw',2,'{}'),
 ('胖虎巴西','FUTURE','2026-09-25','2026-09-26Z','代收','Q','Q',0,0,0,0,null,'[三方量表1] raw',3,'{}'),
 ('胖虎巴西','FUTURE','2026-09-25','2026-09-26Z','代收','BAD','BAD',999999,99,99,99,'2026-09-26Z','[三方量表1] raw',4,'{}'),
 ('胖虎巴西','FUTURE','2026-09-25','2026-09-26Z','代付','P','P',777,77,77,77,null,'[三方量表1] raw',5,'{}'),
 ('胖虎巴西','FUTURE','2026-09-26','2026-09-26Z','代收','P','P',888,88,88,88,null,'[三方量表1] raw',6,'{}');
 insert into third_party_volume(country,platform,data_date,direction,channel,amount,count,sheet_name) values
 ('印度','SHARED','2026-09-25','charge','P',100,1,'AR_DIRECT'),('印度','SHARED','2026-09-25','charge','P',200,2,'LG_DIRECT'),
 ('印度','SHARED','2026-09-25','charge','P',300,3,'[三方量表1] raw'),('印度','SHARED','2026-09-25','charge','P',400,4,'unknown_feed');
 insert into panda_success_rate_daily values ('胖虎巴西','BR','FUTURE','2026-09-24','2026-09-25Z','charge','P',10,8,2),('胖虎巴西','BR','FUTURE','2026-09-25','2026-09-26Z','charge','P',20,15,5),('胖虎巴西','BR','FUTURE','2026-09-25','2026-09-26Z','charge','Q',null,0,null);
 insert into lg_success_daily(country_code,platform,stat_date,order_kind,scope_type,third_party,raw_channel,total_count,success_count,failed_count,pending_count,unknown_count,total_amount,success_amount) values
 ('PH','LG','2026-09-24','recharge','platform',null,null,10,8,1,1,0,1000,800),
 ('PH','LG','2026-09-24','recharge','third_party','P',null,10,8,1,1,0,1000,800),
 ('PH','LG','2026-09-24','recharge','channel','P','C1',6,5,1,0,0,600,500),
 ('PH','LG','2026-09-24','recharge','channel','P','C2',4,3,0,1,0,400,300);
 insert into collection_success_daily values ('RECHARGE_REVIEW','IN','COLL','2026-09-24',now(),now(),'{"totals":{"submitted_count":12,"success_count":10,"success_amount":123.45},"private":"PRIVATE-VALUE"}'),('WITHDRAW_REVIEW','IN','COLL','2026-09-24',now(),now(),'{"totals":{"submitted_count":2,"success_count":1,"success_amount":55.50}}');
 insert into newar_business_snapshots values ('third_party_volume','印度','IN','NEW','2026-09-24',now(),now(),'charge','{"rows":[{"third_party":"P","count":4,"amount":50,"success_count":3,"success_amount":40,"failed_count":1,"private":"PRIVATE-VALUE"}]}'),('third_party_volume','印度','IN','NEW','2026-09-25',now(),now(),'charge','{"rows":[]}');
 insert into auto_withdraw_daily values ('胖虎巴西','FUTURE','2026-09-24',now(),now(),10,8,2,6,4,300,'raw_daily_2026_09'),('胖虎巴西','FUTURE','2026-09-25',now(),now(),20,15,5,10,10,400,'raw_daily_2026_09'),('胖虎巴西','FUTURE','2026-09-25',now(),now(),500,450,50,300,200,100,'AR_DIRECT');
 select set_config('test.scope','{"mode":"all"}',false);
 `);
 const countries=read('admin-live-platform-catalog-map.sql');await db.exec(countries.slice(countries.indexOf('create or replace function private.dashboard_admin_live_is_panghu_platform'),countries.indexOf('create or replace function private.dashboard_admin_live_platforms()')));
 const numbers=read('admin-live-collected-data.sql');await db.exec(numbers.slice(numbers.indexOf('create or replace function private.dashboard_admin_live_report_number'),numbers.indexOf('create or replace view')));
 await db.exec(read('admin-live-report-summary.sql'));
});
after(async()=>db?.close());
test('one batch returns complete multi-day provider/day aggregates and keeps source counts honest',async()=>{
 const result=await call(query([sheet('FUTURE')]));assert.equal(result.timeBasis,'source_report_date');const s=result.feeds[0],g=s.groups[0];
 assert.equal(s.country,'胖虎巴西');assert.equal(s.currency,null);assert.equal(s.currencyBasis,'source_not_provided');assert.equal(s.records,3);assert.equal(s.status,'received');
 assert.equal(g.grain,'provider');assert.equal(g.days,2);assert.equal(g.metrics.amount,300);assert.equal(g.metrics.count,30);assert.equal(g.metrics.successCount,null);assert.equal(g.metrics.failedCount,null);assert.equal(g.metricCoverage.successCount,0);
 assert.equal(g.providers.find(p=>p.provider==='P').metrics.amount,300);assert.equal(g.providers.find(p=>p.provider==='Q').metrics.amount,0);
 assert.deepEqual(g.daily.map(d=>d.date),['2026-09-24','2026-09-25']);assert.equal(g.daily[1].providers.length,2);assert.equal(g.daily[1].metrics.amount,200);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE-VALUE|token|quarantined|member/);
});
test('source kind and system both isolate duplicate transport reports while feed duplicates never double count',async()=>{
 const ar=feed('volume','AR','印度','SHARED');const lg={...ar,system:'LG'};const sheets={...ar,system:'REPORT',sourceKind:'google_sheets'};const unknown={...sheets,sourceKind:'unknown'};
 const data=await call(query([ar,lg,sheets,unknown,ar]));assert.equal(data.feeds.length,4);assert.deepEqual(data.feeds.map(x=>[x.system,x.sourceKind,x.groups[0].metrics.amount]).sort(),[['AR','direct',100],['LG','direct',200],['REPORT','google_sheets',300],['REPORT','unknown',400]].sort());
});
test('PANDA missing amount and partial submitted counts stay null, but explicit successes remain real',async()=>{
 const g=(await call(query([feed('panda_success','PANDA','胖虎巴西','FUTURE')]))).feeds[0].groups[0];
 assert.equal(g.metrics.amount,null);assert.equal(g.metrics.count,null);assert.equal(g.metricCoverage.count,2);assert.equal(g.records,3);assert.equal(g.metrics.successCount,23);assert.equal(g.metricCoverage.successCount,3);assert.equal(g.metrics.failedCount,null);
 assert.equal(g.daily[0].metrics.count,10);assert.equal(g.providers.find(p=>p.provider==='Q').metrics.successCount,0);assert.equal(g.providers.find(p=>p.provider==='Q').metrics.count,null);
});
test('LG platform, provider and channel grains stay separate and are never triple-summed',async()=>{
 const f=(await call(query([feed('lg_success','LG','PH','LG')]))).feeds[0];assert.equal(f.groups.length,3);
 for(const g of f.groups){assert.equal(g.metrics.count,10);assert.equal(g.metrics.amount,1000);assert.equal(g.metrics.successAmount,800);assert.equal(g.metrics.successCount,8)}
 assert.deepEqual(f.groups.find(g=>g.grain==='channel').providers.map(p=>p.provider),['C1','C2']);assert.equal(f.groups.find(g=>g.grain==='platform').providers[0].provider,null);
});
test('collection business source and NewAR empty snapshots preserve metrics without leaking raw payload',async()=>{
 const f=(await call(query([feed('collection_success','RECHARGE_REVIEW','IN','COLL'),feed('collection_success','WITHDRAW_REVIEW','IN','COLL','withdraw'),feed('newar_third_party_volume','NEW_AR','印度','NEW')]))).feeds;
 assert.equal(f.find(x=>x.system==='RECHARGE_REVIEW').groups[0].metrics.successAmount,123.45);assert.equal(f.find(x=>x.system==='WITHDRAW_REVIEW').groups[0].metrics.successAmount,55.5);
 const n=f.find(x=>x.system==='NEW_AR');assert.equal(n.status,'received');assert.equal(n.groups[0].metrics.amount,null,'empty snapshot cannot become a measured zero or a complete range value');assert.equal(n.groups[0].daily[0].metrics.amount,50);assert.equal(n.groups[0].daily[1].metrics.amount,null);assert.doesNotMatch(JSON.stringify(f),/PRIVATE-VALUE/);
});
test('automatic withdrawal sheets and direct statistics remain independent without averaging averages',async()=>{
 const s=feed('auto','REPORT','胖虎巴西','FUTURE','withdraw','google_sheets');const data=(await call(query([s,{...s,system:'AR',sourceKind:'direct'}]))).feeds;
 const sheets=data.find(f=>f.sourceKind==='google_sheets');assert.equal(sheets.groups[0].metrics.count,30);assert.equal(sheets.groups[0].metrics.autoCount,16);assert(!('avgSeconds' in sheets.groups[0].metrics));assert.equal(data.find(f=>f.system==='AR').groups[0].metrics.count,500);
});
test('missing days and feeds do not become fabricated zero records',async()=>{
 const empty=(await call(query([sheet('MISSING')]))).feeds[0];assert.equal(empty.status,'not_received');assert.equal(empty.records,0);assert.deepEqual(empty.groups,[]);
 const data=(await call(query([sheet('FUTURE')],{startAt:'2026-09-23',endAt:'2026-09-25'}))).feeds[0];assert.equal(data.groups[0].days,2);assert.equal(data.groups[0].daily.length,2);
});
test('aggregate contains all records beyond the source-detail page size',async()=>{
 await db.exec("insert into third_party_volume(country,platform,data_date,direction,channel,amount,count,sheet_name) select '胖虎巴西','MANY','2026-09-24','代收','P'||n,1,1,'[三方量表1] raw' from generate_series(1,650)n");
 const g=(await call(query([sheet('MANY')]))).feeds[0].groups[0];assert.equal(g.records,650);assert.equal(g.metrics.amount,650);assert.equal(g.providers.length,650);assert.equal(g.daily[0].providers.length,650);
});
test('fresh account scope authorizes every feed before any result and maps future Panghu aliases',async()=>{
 await db.exec("insert into panda_success_rate_daily values('BR','BR','FUTURE','2026-09-24',now(),'charge','P',1,1,0)");
 try{
  await scope({countries:['印度'],platforms:['SHARED']});await assert.rejects(call(query([feed('volume','AR','印度','SHARED'),sheet('FUTURE')])),/scope_denied/);
  await scope({countries:['巴西']});await assert.rejects(call(query([feed('panda_success','PANDA','BR','FUTURE')])),/scope_denied/);
  await scope({countries:['胖虎巴西'],platforms:['FUTURE']});assert.equal((await call(query([feed('panda_success','PANDA','BR','FUTURE')]))).feeds[0].country,'胖虎巴西');await assert.rejects(call(query([sheet('MANY')])),/scope_denied/);
  await db.exec("select set_config('test.scope','',false)");await assert.rejects(call(query([sheet('FUTURE')])),/unauthorized/);
 }finally{await scope({mode:'all'})}
});
test('requests reject unsupported tables, forged source directions, payload keys and unbounded ranges',async()=>{
 const f=sheet('FUTURE');for(const q of [null,{},query([]),query(Array(251).fill(f)),query([f],{startAt:'2026-08-01'}),query([f],{endAt:'2026-09-99'}),query([f],{endAt:'2026-09-23'}),query([{...f,dataset:'lg_orders'}]),query([{...f,system:'AR'}]),query([{...f,country:null}]),query([{...f,platform:'bad\nname'}]),query([{...f,sourceKind:'mixed'}]),query([{...f,table:'dashboard_profiles'}]),query([feed('collection_success','RECHARGE_REVIEW','IN','COLL','withdraw')]),query([{...f,platform:'胖虎巴西'}])])await assert.rejects(call(q),/invalid_report_/);
});
test('only authenticated RPC wrappers are granted and unscoped row helpers are not callable by clients',async()=>{
 const perms=(await db.query("select has_function_privilege('anon','public.dashboard_admin_live_report_summary(jsonb)','execute') anon,has_function_privilege('authenticated','public.dashboard_admin_live_report_summary(jsonb)','execute') auth,has_function_privilege('authenticated','private.dashboard_admin_live_report_source_rows(jsonb,date,date)','execute') helper")).rows[0];assert.deepEqual(perms,{anon:false,auth:true,helper:false});
 const f=(await db.query("select prosecdef,proconfig from pg_proc where oid='private.dashboard_admin_live_report_summary(jsonb)'::regprocedure")).rows[0];assert.equal(f.prosecdef,true);assert(f.proconfig.some(x=>x.startsWith('search_path=')));
});
