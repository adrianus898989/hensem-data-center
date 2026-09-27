// Isolated fixtures only. No database connection or production authentication.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');let db;
const read=n=>fs.readFileSync(path.join(__dirname,'../supabase',n),'utf8');
const call=async p=>(await db.query('select public.dashboard_admin_live_collected_data($1::jsonb) data',[JSON.stringify(p)])).rows[0].data;
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql as $$begin if coalesce(current_setting('test.scope',true),'')='' then raise exception 'unauthorized';end if;return current_setting('test.scope')::jsonb;end$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select $1->>'mode'='all' or coalesce($1->'countries' ? $2,false) and (not($1 ? 'platforms') or $1->'platforms' ? $3)$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select case upper($1) when 'VEER.GAME' then 'VEERGAME' else upper($1) end$$;
 create function private.dashboard_admin_live_deposit_platform_key(text,text) returns text language sql immutable as $$select case when $1='印度' and upper($2)='INDIA82' then '82LOTTERY' else private.dashboard_admin_live_withdraw_key($2) end$$;
 create table lg_orders(country_code text,platform text,order_no text,order_kind text,order_amount numeric,status_text text,status_class text,created_at timestamptz,paid_at timestamptz,finished_at timestamptz,third_party text,raw_channel text,updated_at timestamptz,member_id text);
 create index lg_created on lg_orders(country_code,platform,order_kind,created_at);
 create table lg_success_daily(country_code text,platform text,stat_date date,observed_at timestamptz,updated_at timestamptz,order_kind text,scope_type text,third_party text,raw_channel text,total_count bigint,success_count bigint,failed_count bigint,pending_count bigint,unknown_count bigint,total_amount numeric,success_amount numeric);
 create table lg_pending_daily(country_code text,platform text,stat_date date,updated_at timestamptz,snapshot jsonb);
 create table collection_success_daily(source_system text,country_code text,platform text,stat_date date,snapshot_at timestamptz,updated_at timestamptz,snapshot jsonb);
 create table withdraw_member_notes_daily(like collection_success_daily);
 create table workorder_daily_bundle(system_name text,country text,country_code text,platform text,stat_date date,source_updated_at timestamptz,updated_at timestamptz,daily_rows jsonb);
 create table panda_config_dictionary_daily(country_code text,platform text,observed_local_date date,received_at timestamptz);
 create table withdraw_pending_orders(source_system text,country_code text,platform text,stat_date date,snapshot_at timestamptz,updated_at timestamptz,raw_channel text,amount numeric);
 create table provider_midnight_snapshots(source_system text,country_code text,platform text,scheduled_at timestamptz,timezone text,received_at timestamptz);
 create table game66_platforms(id uuid,platform_name text,team_name text);
 create table game66_dictionary_snapshots(platform_id uuid,fetched_at timestamptz,data_type text);
 create table dashboard_platform_team_map(team_name text,source_system text,source_country text,source_platform text,platform_name text,active boolean default true);
 create table third_party_volume(country text,platform text,data_date date,updated_at timestamptz,direction text,raw_channel text,channel text,amount numeric,count int,success_count int,failed_count int,quarantined_at timestamptz,raw jsonb);
 create table panda_success_rate_daily(country text,country_code text,platform text,stat_date date,updated_at timestamptz,direction text,third_party text,submitted_count int,success_count int,failed_count int);
 create table auto_withdraw_daily(country text,platform text,data_date date,source_updated_at timestamptz,updated_at timestamptz,total int,success int,rejected int,auto_count int,manual_count int,avg_seconds numeric);
 create table withdraw_operator_daily(country text,platform text,data_date date,source_updated_at timestamptz,updated_at timestamptz,account text,processed int,rejected int,avg_seconds numeric);
 create table workorder_deposit_daily(source_system text,country text,country_code text,platform text,stat_date date,source_updated_at timestamptz,updated_at timestamptz,third_party text,submitted_count int,submitted_amount numeric,success_count int,success_amount numeric,withdraw_not_received_count int,withdraw_not_received_amount numeric,withdraw_success_count int,withdraw_success_amount numeric);
 create table withdraw_pending_daily(source_system text,country_code text,platform text,stat_date date,snapshot_at timestamptz,updated_at timestamptz,snapshot jsonb);
 create table withdraw_pending_backlog_daily(like withdraw_pending_daily);
 create table withdraw_reasons_daily(like withdraw_pending_daily);
 create table ar_config_daily(country_code text,platform text,observed_local_date date,received_at timestamptz,configuration jsonb);
 create table panda_config_daily(like ar_config_daily);create table wg_config_daily(like ar_config_daily);
 create table newar_business_snapshots(kind text,country text,country_code text,platform text,stat_date date,captured_at timestamptz,updated_at timestamptz,direction text,payload jsonb);
 create table admin_deposit_issue_rows(country text,platform text,record_date date,source_updated_at timestamptz,updated_at timestamptz,provider text,amount numeric,stale_at timestamptz);
 create table admin_deposit_followup_rows(country text,platform text,followup_date date,source_updated_at timestamptz,updated_at timestamptz,provider text,amount numeric,stale_at timestamptz);
 select set_config('test.scope','{"mode":"all"}',false);
 insert into dashboard_platform_team_map values('M8','AR','印度','VEERGAME','Veer.Game',true),('M8','WG','巴西','WG-DEMO','WG-DEMO',true);
 insert into lg_orders(country_code,platform,order_no,order_kind,order_amount,status_class,created_at,paid_at,member_id) values('PH','LG-ORDER-ONLY','O1','recharge',100,'success','2026-09-23T17:00:00Z','2026-09-24T01:00:00Z','PRIVATE-MEMBER');
 insert into lg_success_daily(country_code,platform,stat_date,order_kind,scope_type,total_count,total_amount) values('PH','LG-ONLY','2026-09-24','recharge','platform',10,500);
 insert into third_party_volume values('胖虎巴西','FUTURE-PANGHU','2026-09-24',now(),'代收','RAW','A',1234,12,10,2,null,'{"token":"NEVER-RETURN"}'),('印度','Veer.Game','2026-09-24',now(),'代收','UPI','UPI',500,5,4,1,null,'{}'),('印度','QUARANTINED','2026-09-24',now(),'代收','x','x',9999,99,0,99,now(),'{}'),('新地区','UNASSIGNED','2026-09-24',now(),'代付','x','x',50,1,1,0,null,'{}');
 insert into panda_success_rate_daily values('胖虎巴西','BR','FUTURE-PANGHU','2026-09-24',now(),'charge','P',12,10,2);
 insert into auto_withdraw_daily values('巴西','776F','2026-09-24',now(),now(),10,8,2,5,5,60);
 insert into withdraw_operator_daily values('新地区','OPERATOR-ONLY','2026-09-24',now(),now(),'agent',10,2,60);
 insert into wg_config_daily values('BR','WG-DEMO','2026-09-24',now(),'{"private":"NEVER-RETURN"}');
 insert into withdraw_pending_daily values('AR','IN','Veer.Game','2026-09-24',now(),now(),'{"totals":{"pending_count":3,"pending_amount":120},"private":"NEVER-RETURN"}');
 insert into newar_business_snapshots values('third_party_volume','印度','IN','NEW-DEMO','2026-09-24',now(),now(),'charge','{"rows":[{"amount":100,"count":2,"member":"NEVER-RETURN"}]}');`);
 await db.exec("alter table auto_withdraw_daily add column source_sheet text default 'raw_daily_2026_09';alter table ar_config_daily add column parser_version text;create table ar_config_targets(country_code text,platform text,source_system text);alter table game66_platforms add column team_code text;create table game66_review_rules(platform_id uuid,last_seen_at timestamptz);alter table third_party_volume add column sheet_name text default '[三方量表1] fixture';alter table third_party_volume add column source_row integer default 7;create function private.dashboard_admin_live_order_intake() returns jsonb language sql as $$ select '[]'::jsonb $$;");
 const catalog=read('admin-live-platform-catalog-map.sql');await db.exec(catalog.slice(catalog.indexOf('create or replace function private.dashboard_admin_live_is_panghu_platform'),catalog.indexOf('create or replace function private.dashboard_admin_live_platforms()')));
 await db.exec(read('admin-live-collected-data.sql'));
});
after(async()=>{await db?.close()});
test('business intake shows received collection, payout and config without unrelated feeds',async()=>{
 const data=await call({operation:'catalog'});const p=data.rows.find(x=>x.name==='FUTURE-PANGHU');assert.equal(p.team,'胖虎');assert.equal(p.country,'胖虎巴西');assert.equal(p.lastDate,'2026-09-24');
 assert(!data.rows.some(x=>x.name==='OPERATOR-ONLY'));assert(!data.rows.some(x=>['pending','operators','member_notes'].includes(x.dataset)));assert(data.rows.some(x=>x.name==='LG-ONLY'&&x.system==='LG'));assert(data.rows.some(x=>x.name==='WG-DEMO'&&x.system==='WG'&&x.team==='M8'));
 assert.equal(data.rows.find(x=>x.name==='UNASSIGNED').team,'待归类');assert(!data.rows.some(x=>x.name==='QUARANTINED'));
 assert(data.rows.some(x=>x.name==='Veer.Game'&&x.dataset==='volume'&&x.team==='M8'));assert(data.rows.some(x=>x.name==='776F'&&x.dataset==='auto'&&x.provenance.kind==='google_sheets'&&x.directions[0]==='withdraw'),'automatic payout daily report is discoverable');assert(!data.rows.some(x=>x.name==='776F'&&x.dataset.endsWith('_config')),'automatic payout report alone is not configuration');
 assert.equal(data.rows.filter(x=>x.name==='FUTURE-PANGHU').length,2,'independent datasets remain identifiable');
});
test('detail reads exact source/date, projects approved numbers and never exposes raw payloads',async()=>{
 const data=await call({operation:'rows',dataset:'volume',country:'胖虎巴西',platform:'FUTURE-PANGHU',startAt:'2026-09-24',endAt:'2026-09-24'});
 assert.equal(data.total,1);assert.equal(data.rows[0].metrics.amount,1234);assert.equal(data.rows[0].metrics.count,12);assert.deepEqual(data.rows[0].sourceReference,{sheetName:'[三方量表1] fixture',row:7});assert.doesNotMatch(JSON.stringify(data),/NEVER-RETURN|token|member|raw/);
 const pending=await call({operation:'rows',dataset:'pending',country:'IN',platform:'Veer.Game',startAt:'2026-09-24',endAt:'2026-09-24'});assert.equal(pending.rows[0].metrics.pending,3);assert.equal(pending.rows[0].metrics.pendingAmount,120);
 const empty=await call({operation:'rows',dataset:'volume',country:'胖虎巴西',platform:'FUTURE-PANGHU',startAt:'2026-09-23',endAt:'2026-09-23'});assert.equal(empty.total,0);
});
test('soft-archived Sheet rows remain stored but do not duplicate collected view or detail totals, and can return to active',async()=>{
 for(const [table,dataset,dateColumn] of [
  ['admin_deposit_issue_rows','deposit_results','record_date'],
  ['admin_deposit_followup_rows','deposit_entries','followup_date']
 ]){
  await db.exec(`insert into ${table}(country,platform,${dateColumn},provider,amount,stale_at) values
   ('印度','ARCHIVE-SYNTHETIC','2026-09-24','Current synthetic provider',100,null),
   ('印度','ARCHIVE-SYNTHETIC','2026-09-24','Old synthetic provider',900,'2026-09-27T00:00:00Z')`);
  const q={operation:'rows',dataset,country:'印度',platform:'ARCHIVE-SYNTHETIC',startAt:'2026-09-24',endAt:'2026-09-24'};
  const before=await call(q);assert.equal(before.total,1);assert.equal(before.rows[0].metrics.amount,100);assert.equal(before.rows[0].provider,'Current synthetic provider');
  const view=(await db.query("select count(*)::int count,sum((metrics->>'amount')::numeric)::text amount from private.dashboard_admin_collected_feed_rows where dataset=$1 and platform='ARCHIVE-SYNTHETIC'",[dataset])).rows[0];
  assert.deepEqual(view,{count:1,amount:'100'});assert.equal((await db.query(`select count(*)::int count from ${table} where platform='ARCHIVE-SYNTHETIC'`)).rows[0].count,2,'archiving retains the original row');
  await db.exec(`update ${table} set stale_at=null where platform='ARCHIVE-SYNTHETIC' and provider='Old synthetic provider'`);
  const restored=await call(q);assert.equal(restored.total,2);assert.equal(restored.rows.reduce((sum,r)=>sum+r.metrics.amount,0),1000);
  await db.exec(`update ${table} set stale_at='2026-09-27T01:00:00Z' where platform='ARCHIVE-SYNTHETIC'`);
  assert.equal((await call(q)).total,0);assert.equal((await db.query(`select count(*)::int count from ${table} where platform='ARCHIVE-SYNTHETIC'`)).rows[0].count,2);
 }
});
test('standalone soft-archive migration replaces an existing collected view without restoring archived rows or changing other datasets',async()=>{
 await db.exec('create role service_role');
 const q={operation:'rows',dataset:'volume',country:'胖虎巴西',platform:'FUTURE-PANGHU',startAt:'2026-09-24',endAt:'2026-09-24'},before=await call(q);
 await db.exec(read('workorder-followup-soft-archive.sql'));await db.exec(read('workorder-followup-soft-archive.sql'));
 assert.deepEqual(await call(q),before,'the full view keeps unrelated source columns and semantics');
 for(const [table,dataset] of [['admin_deposit_issue_rows','deposit_results'],['admin_deposit_followup_rows','deposit_entries']]){
  assert.equal((await call({operation:'rows',dataset,country:'印度',platform:'ARCHIVE-SYNTHETIC',startAt:'2026-09-24',endAt:'2026-09-24'})).total,0);
  assert.equal((await db.query(`select count(*)::int count from ${table} where platform='ARCHIVE-SYNTHETIC'`)).rows[0].count,2);
 }
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);try{await assert.rejects(()=>db.query('select * from private.dashboard_admin_collected_feed_rows'),/permission denied/)}finally{await db.exec('reset role')}
 }
});
test('every catalogue and detail request rechecks scope, including raw-code aliases',async()=>{
 await db.exec(`select set_config('test.scope','{"countries":["印度"],"platforms":["Veer.Game"]}',false)`);
 try {const data=await call({operation:'catalog'});assert.equal(data.rows.length,1);assert(data.rows.every(x=>x.name==='Veer.Game'));
 await assert.rejects(call({operation:'rows',dataset:'volume',country:'胖虎巴西',platform:'FUTURE-PANGHU',startAt:'2026-09-24',endAt:'2026-09-24'}),/scope_denied/);
 await db.exec("select set_config('test.scope','',false)");await assert.rejects(call({operation:'catalog'}),/unauthorized/);
 }finally{await db.exec(`select set_config('test.scope','{"mode":"all"}',false)`)}
});
test('unknown group rows are returned and newly arrived platforms are discovered without a deployment',async()=>{
 await db.exec("insert into third_party_volume(country,platform,data_date,direction) values('胖虎巴西','NEW-AFTER-LOAD','2026-09-25','代收')");const data=await call({operation:'catalog'});assert.equal(data.rows.find(x=>x.name==='NEW-AFTER-LOAD').team,'胖虎');
});
test('conflicting team mappings cannot silently assign a platform to the wrong team',async()=>{
 await db.exec("insert into dashboard_platform_team_map values('OTHER','WG','巴西','WG-DEMO','WG-DEMO',true)");const data=await call({operation:'catalog'});assert.equal(data.rows.find(x=>x.name==='WG-DEMO').team,'待归类');
});
test('pagination has complete counts and unprovided numeric metrics stay absent',async()=>{
 await db.exec("insert into withdraw_operator_daily(country,platform,data_date,account,processed) select '新地区','PAGED','2026-09-24','OP-'||lpad(n::text,3,'0'),n from generate_series(1,55)n");
 const q={operation:'rows',dataset:'operators',country:'新地区',platform:'PAGED',startAt:'2026-09-24',endAt:'2026-09-24',limit:20};const a=await call(q),b=await call({...q,offset:20});assert.equal(a.total,55);assert.equal(a.rows.length,20);assert.equal(b.rows.length,20);assert.equal(new Set([...a.rows,...b.rows].map(r=>r.provider)).size,40);assert(!('avgSeconds' in a.rows[0].metrics));
});
test('invalid request, oversized ranges and client table names cannot bypass the fixed read model',async()=>{
 for(const q of [{operation:'catalog',table:'dashboard_profiles'},{operation:'rows',dataset:'volume',country:'印度',platform:'X',startAt:'2026-08-01',endAt:'2026-09-24'},{operation:'catalog',limit:20}])await assert.rejects(call(q),/invalid_/);
 const result=await call({operation:'rows',dataset:'dashboard_profiles',country:'印度',platform:'X',startAt:'2026-09-24',endAt:'2026-09-24'});assert.equal(result.total,0);
});
test('upgrade bundles both catalog and collected feeds after their dependencies',()=>{
 const cp=require('node:child_process'),os=require('node:os'),file=path.join(os.tmpdir(),'hensem-test-upgrade-'+process.pid+'.sql');
 try{cp.execFileSync('python3',[path.join(__dirname,'../admin-preview/build-live-upgrade.py'),'--output',file]);const sql=fs.readFileSync(file,'utf8');assert(sql.includes('-- FILE: admin-live-platform-catalog-map.sql'));assert(sql.indexOf('-- FILE: admin-live-collected-data.sql')>sql.indexOf('-- FILE: admin-live-deposit-issues.sql'));assert.equal((sql.match(/^begin;$/gm)||[]).length,1);assert.equal((sql.match(/^commit;$/gm)||[]).length,1)}finally{fs.rmSync(file,{force:true})}
});

test('LG order-only platforms are discovered by index and details use creation time in the source timezone',async()=>{
 const catalog=await call({operation:'catalog'});assert(catalog.rows.some(r=>r.name==='LG-ORDER-ONLY'&&r.dataset==='lg_orders'));
 const q={operation:'rows',dataset:'lg_orders',country:'PH',platform:'LG-ORDER-ONLY',startAt:'2026-09-24',endAt:'2026-09-24'};
 const result=await call(q);assert.equal(result.total,1);assert.equal(result.rows[0].orderNumber,'O1');assert.equal(result.rows[0].date,'2026-09-24');assert(result.rows[0].successAt);assert.doesNotMatch(JSON.stringify(result),/PRIVATE-MEMBER|member_id/);
 assert.equal((await call({...q,startAt:'2026-09-23',endAt:'2026-09-23'})).total,0);
});
test('an authoritative Panghu label carries across feeds and cannot be read under ordinary Brazil scope',async()=>{
 await db.exec("insert into panda_config_daily values('BR','FUTURE-PANGHU','2026-09-24',now(),'{}')");
 const ownerCatalog=await call({operation:'catalog'});const r=ownerCatalog.rows.find(x=>x.rawPlatform==='FUTURE-PANGHU'&&x.dataset==='panda_config');assert.equal(r.team,'胖虎');assert.equal(r.country,'胖虎巴西');
 await db.exec(`select set_config('test.scope','{"countries":["巴西"]}',false)`);try{
  assert(!(await call({operation:'catalog'})).rows.some(x=>x.name==='FUTURE-PANGHU'));
  await assert.rejects(call({operation:'rows',dataset:'panda_config',country:'BR',platform:'FUTURE-PANGHU',startAt:'2026-09-24',endAt:'2026-09-24'}),/scope_denied/);
 }finally{await db.exec(`select set_config('test.scope','{"mode":"all"}',false)`)}
});
test('source date anomalies remain counted but cannot become the normal latest date',async()=>{
 await db.exec("insert into third_party_volume(country,platform,data_date,direction) values('胖虎巴西','DATE-ISSUE','2611-01-12','代收'),('胖虎巴西','DATE-ISSUE','2026-09-24','代收')");
 const row=(await call({operation:'catalog'})).rows.find(r=>r.dataset==='volume'&&r.name==='DATE-ISSUE');assert.equal(row.dateIssues,1);assert.equal(row.lastDate,'2026-09-24');assert.equal(row.records,2);
});

test('catalog and detail separate transport and direction before pagination',async()=>{
 await db.exec("insert into third_party_volume(country,platform,data_date,direction,sheet_name,amount,count) values('菲律宾','DUAL','2026-09-24','代收','LG_DIRECT',100,1),('菲律宾','DUAL','2026-09-23','代收','[三方量表1] test',80,1),('菲律宾','DUAL','2026-09-25','代付','LG_DIRECT',50,1),('菲律宾','DUAL','2026-09-22','代收',null,20,1)");
 const catalog=await call({operation:'catalog'}),rows=catalog.rows.filter(r=>r.rawPlatform==='DUAL');assert.equal(rows.length,4);
 const direct=rows.find(r=>r.provenance.kind==='direct'&&r.directions.includes('charge'));assert.equal(direct.lastDate,'2026-09-24');
 const sheet=rows.find(r=>r.provenance.kind==='google_sheets');assert.equal(sheet.lastDate,'2026-09-23');
 const q={operation:'rows',dataset:'volume',country:'菲律宾',platform:'DUAL',startAt:'2026-09-22',endAt:'2026-09-25',direction:'charge',sourceKind:'direct'};
 const data=await call(q);assert.equal(data.total,1);assert.equal(data.rows[0].metrics.amount,100);assert(!('success' in data.rows[0].metrics));assert.equal((await call({...q,sourceKind:'google_sheets'})).rows[0].metrics.amount,80);assert.equal((await call({...q,sourceKind:'unknown'})).rows[0].metrics.amount,20);
 for(const bad of [{...q,direction:'all'},{...q,sourceKind:'mixed'},{...q,dataset:'panda_success'}])await assert.rejects(call(bad),/invalid_/);
});
test('the historical Panghu country total is not counted as a platform',async()=>{
 await db.exec("insert into third_party_volume(country,platform,data_date,direction) values('胖虎巴西','胖虎巴西','2026-05-17','代收')");assert(!(await call({operation:'catalog'})).rows.some(r=>r.rawPlatform==='胖虎巴西'));
});

test('recharge and withdrawal success snapshots retain their actual business direction',async()=>{
 await db.exec(`insert into collection_success_daily(source_system,country_code,platform,stat_date,snapshot) values('RECHARGE_REVIEW','IN','Veer.Game','2026-09-24','{"totals":{"success_count":3}}'),('WITHDRAW_REVIEW','IN','Veer.Game','2026-09-25','{"totals":{"success_count":4}}')`);
 const rows=(await call({operation:'catalog'})).rows.filter(x=>x.dataset==='collection_success'&&x.name==='Veer.Game');assert.equal(rows.length,2);assert(rows.every(x=>x.team==='M8'));assert.deepEqual(rows.find(x=>x.system==='WITHDRAW_REVIEW').directions,['withdraw']);
 const q={operation:'rows',dataset:'collection_success',country:'IN',platform:'Veer.Game',startAt:'2026-09-24',endAt:'2026-09-25',direction:'withdraw'};const d=await call(q);assert.equal(d.total,1);assert.equal(d.rows[0].metrics.success,4);
});

function intakeFixture({catalog=[],rows=[],failure=false,payoutConfig,detailResult}={}){
 const vm=require('node:vm'),calls=[],navigation=[],escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const context={document:{activeElement:null,querySelector:()=>null},HensemLivePayoutConfig:payoutConfig,liveSet:(...args)=>navigation.push(['set',...args]),liveChoosePlatform:id=>navigation.push(['orders',id]),setPage:page=>navigation.push(['page',page])};
 const feeds=rows.flatMap((r,i)=>(r.directions?.length?r.directions:[r.dataset.endsWith('_config')?'payout_config':'unknown']).map((direction,j)=>({timezone:'UTC',...r,id:'feed-'+i+'-'+j,direction,sourceKind:r.provenance?.kind||'direct',defaultEnd:'2026-09-25'})));
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-collected-data.js'),'utf8'),context);
 const page=context.HensemLiveCollectedData.create({L:{catalog,to:'2026-09-25T23:59:59'},E:escape,C:x=>String(Number(x)||0),N:x=>String(Number(x)||0),render:()=>{},box:(title,content,note)=>'<section><h2>'+title+'</h2>'+content+'<p>'+note+'</p></section>',table:(headers,values,cls)=>'<table class="'+cls+'"><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+values.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table>',request:async q=>{calls.push(q);if(failure)throw Error('timeout');if(q.action==='intakeCoverage')return q.operation==='catalog'?{version:1,complete:true,feeds}:{version:1,complete:true,checkedAt:'2026-09-26T00:00:00Z',feedIds:q.feedIds,startAt:q.startAt,endAt:q.endAt,rows:q.feedIds.flatMap(feedId=>Array.from({length:25},(_,n)=>({feedId,date:'2026-09-'+String(n+1).padStart(2,'0'),status:'received',received:true,complete:false,zeroConfirmed:false,expected:true,recordReceivedAt:'2026-09-25T08:30:00Z'})))};return detailResult!==undefined?detailResult:{total:1,rows:[{date:'2026-09-24',direction:q.direction,metrics:{amount:50,count:2}}]}}});
 return {page,context,calls,navigation,feeds};
}
const intakeFeed={name:'PANGHU-X',country:'胖虎巴西',rawCountry:'胖虎巴西',rawPlatform:'PANGHU-X',team:'胖虎',system:'REPORT',dataset:'volume',directions:['charge','withdraw'],lastDate:'2026-09-24',updatedAt:'2026-09-25T08:30:00Z',records:2,provenance:{kind:'google_sheets'}};
test('intake renders separate source and direction rows with range counts and proof labels',async()=>{
 const f=intakeFixture({rows:[intakeFeed,{...intakeFeed,dataset:'member_notes'},{...intakeFeed,dataset:'panda_config',system:'PANDA',directions:[],provenance:{kind:'direct'}}]});await f.page.load();await f.context.collectedCoverageQuery();const html=f.page.render();
 for(const label of ['团队','平台','数据类型','来源','方向','应检查天数','已收到天数','已完整天数','缺失日期','核对状态'])assert.match(html,new RegExp('<th[^>]*>'+label+'</th>'));
 assert.match(html,/源日报（原来源标签/);assert.match(html,/直接写入 Supabase/);assert.match(html,/收到 · 未证实完整/);assert.doesNotMatch(html,/<td>member_notes<\/td>/);assert.equal(f.calls.filter(q=>q.operation==='catalog').length,1);
 const reads=f.calls.length;f.context.collectedSet('team','胖虎');f.context.collectedSearch('PANGHU');assert.equal(f.calls.length,reads);assert.match(f.page.render(),/筛选或日期已修改/);assert(!f.calls.some(q=>q.action==='aggregate'));
});
test('catalog identity alone and a failed lookup never claim dated orders exist',async()=>{
 const catalog=[{id:'platform-a',name:'A',country:'印度',team:'M8',source:'ar'}],f=intakeFixture({catalog,failure:true});await f.page.load();await f.context.collectedCoverageQuery();assert.match(f.page.render(),/不能据此判断平台没有数据/);assert.doesNotMatch(f.page.render(),/已收到订单|查看订单/);
 const success=intakeFixture({catalog});await success.page.load();assert.match(success.page.render(),/当前筛选下没有匹配来源/);assert.doesNotMatch(success.page.render(),/未收到.*25天/);
});
test('daily report drilldown preserves the selected source date and exact raw identity and direction',async()=>{
 const f=intakeFixture({rows:[intakeFeed]});await f.page.load();await f.context.collectedCoverageQuery();f.context.collectedOpenDay('feed-0-1','2026-09-10');await new Promise(setImmediate);const q=f.calls.at(-1);assert.equal(q.action,'collectedData');assert.equal(q.country,'胖虎巴西');assert.equal(q.platform,'PANGHU-X');assert.equal(q.direction,'withdraw');assert.equal(q.sourceKind,'google_sheets');assert.equal(q.startAt,'2026-09-10');assert.equal(q.endAt,'2026-09-10');assert.match(f.page.render(),/成功时间统计/);
 const n=f.calls.length;f.context.collectedOpenDay('unapproved','2026-09-10');f.context.collectedOpenDay('feed-0-1','2026-08-10');assert.equal(f.calls.length,n);
});
test('order day drilldown navigates to the authorized native platform and exact date',async()=>{
 const catalog=[{id:'ar-1',name:'PLATFORM',country:'印度',team:'M8',source:'ar'}];const f=intakeFixture({catalog,rows:[{...intakeFeed,dataset:'orders',system:'AR',name:'PLATFORM',country:'印度',team:'M8',rawCountry:'IN',rawPlatform:'PLATFORM',directions:['charge'],platformId:'ar-1',provenance:{kind:'direct'}}]});await f.page.load();await f.context.collectedCoverageQuery();f.context.collectedOpenDay('feed-0-0','2026-09-12');assert.deepEqual(f.navigation,[['set','country','印度'],['set','from','2026-09-12T00:00:00'],['set','to','2026-09-12T23:59:59'],['set','direction','charge'],['orders','ar-1']]);assert(!f.calls.some(q=>q.action==='collectedData'));
});
test('configuration navigation is explicitly current and keeps exact source target',async()=>{
 const called=[],f=intakeFixture({rows:[{...intakeFeed,dataset:'panda_config',system:'PANDA',directions:[]}],payoutConfig:{openTarget:q=>called.push(q)}});await f.page.load();await f.context.collectedCoverageQuery();assert.match(f.page.render(),/当前配置/);f.context.collectedOpenDay('feed-0-0','2026-09-12');assert.equal(called.length,0,'dated configuration status cannot pretend the latest config is that date');f.context.collectedOpenConfig('feed-0-0');assert.deepEqual(JSON.parse(JSON.stringify(called)),[{system:'PANDA',country:'胖虎巴西',platform:'PANGHU-X'}]);assert.deepEqual(f.navigation,[['page','payout_config']]);
});
test('legacy volume metrics cannot expose guessed success and source paging remains isolated',async()=>{
 const f=intakeFixture({rows:[{...intakeFeed,directions:['charge'],provenance:{kind:'unknown'}}]});await f.page.load();await f.context.collectedCoverageQuery();f.context.collectedOpenDay('feed-0-0','2026-09-24');await new Promise(setImmediate);assert.equal(f.calls.at(-1).sourceKind,'unknown');f.page.state.detailRows={total:100,rows:[{date:'2026-09-24',direction:'charge',metrics:{amount:500,count:4,success:4,failed:4}}]};const html=f.page.render();assert.match(html,/<th>金额<\/th><th>笔数<\/th>/);assert.doesNotMatch(html,/<th>成功笔数<\/th>|<th>失败笔数<\/th>/);f.context.collectedDetailPage(1);await new Promise(setImmediate);assert.equal(f.calls.at(-1).offset,50);assert.equal(f.calls.at(-1).sourceKind,'unknown');
});
test('same named platforms retain country isolation and separate feed rows',async()=>{
 const f=intakeFixture({rows:[{...intakeFeed,name:'SAME',rawPlatform:'SAME',country:'印度',rawCountry:'IN',team:'M8',directions:['charge']},{...intakeFeed,name:'SAME',rawPlatform:'SAME',country:'巴西',rawCountry:'BR',team:'OTHER',directions:['withdraw']}]});await f.page.load();await f.context.collectedCoverageQuery();assert.match(f.page.render(),/2 个平台 · 当前 2 个平台 \/ 2 项来源/);assert.equal((f.page.render().match(/<td>SAME<\/td>/g)||[]).length,2);f.context.collectedSet('country','巴西');assert.equal((f.page.render().match(/<td>SAME<\/td>/g)||[]).length,1);
});
test('scope changes cancel stale report detail responses',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),f=intakeFixture({rows:[intakeFeed],detailResult:pending});await f.page.load();await f.context.collectedCoverageQuery();f.context.collectedOpenDay('feed-0-0','2026-09-24');assert.equal(f.page.state.detailBusy,true);f.context.collectedSearch('OTHER');resolve({total:1,rows:[{date:'2026-09-24',provider:'STALE',metrics:{amount:777}}]});await new Promise(setImmediate);assert.equal(f.page.state.detail,null);assert.equal(f.page.state.detailRows,null);assert.equal(f.page.state.detailBusy,false);assert.doesNotMatch(f.page.render(),/STALE/);
});
test('malformed detail responses remain errors rather than empty data',async()=>{
 const f=intakeFixture({rows:[intakeFeed],detailResult:{}});await f.page.load();await f.context.collectedCoverageQuery();f.context.collectedOpenDay('feed-0-0','2026-09-24');await new Promise(setImmediate);assert.match(f.page.render(),/平台数据返回不完整/);assert.doesNotMatch(f.page.render(),/共 0 条来源记录/);
});

// Automatic withdrawal remains a report capability, distinct from its configuration.
test('automatic report catalog isolates direct systems and sheets with their own dates',async()=>{
 await db.exec("insert into auto_withdraw_daily(country,platform,data_date,total,source_sheet) values('胖虎巴西','AUTO-ONLY','2026-09-23',10,'raw_daily_2026_09'),('胖虎巴西','AUTO-ONLY','2026-09-24',20,'AR_DIRECT'),('胖虎巴西','AUTO-ONLY','2026-09-25',30,'LG_DIRECT'),('胖虎巴西','胖虎巴西','2026-09-25',999,'raw_daily_2026_09')");
 const rows=(await call({operation:'catalog'})).rows.filter(r=>r.dataset==='auto'&&r.rawPlatform==='AUTO-ONLY');assert.equal(rows.length,3);
 assert.deepEqual(rows.map(r=>[r.system,r.provenance.kind,r.lastDate]).sort(),[['AR','direct','2026-09-24'],['LG','direct','2026-09-25'],['REPORT','google_sheets','2026-09-23']].sort());
 assert(rows.every(r=>r.team==='胖虎'&&r.country==='胖虎巴西'&&r.directions.join()==='withdraw'));assert(!(await call({operation:'catalog'})).rows.some(r=>r.rawPlatform==='胖虎巴西'));
 await db.exec(`select set_config('test.scope','{"countries":["印度"]}',false)`);try{assert(!(await call({operation:'catalog'})).rows.some(r=>r.rawPlatform==='AUTO-ONLY'))}finally{await db.exec(`select set_config('test.scope','{"mode":"all"}',false)`)}
});
