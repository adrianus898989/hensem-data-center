// Actual production PostgreSQL functions with synthetic aggregate bundles only.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const h=require('./fixtures/duoli-daily-fallback/base.cjs');
const finance=require('./fixtures/withdraw-reason-atomic-rules/tests/financial-fixture.cjs');
const contract=JSON.parse(read('tests/fixtures/yash-auto-review/contract.json'));
const install=()=>read('supabase/maintenance/yash-auto-review.install.sql');
let db,oldDependency,oldMetadata,oldDefinitions,baseline,yashKey;
const value=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.v;
const req=(extra={})=>({country:'印度',view:'auto',startAt:'2026-10-29T00:00:00.000Z',endAt:'2026-10-29T23:59:59.000Z',limit:500,...extra});
const op=(account,processed)=>({account,processed,rejected:0,avg_seconds:60,duration_sample_count:processed,duration_total_seconds:processed*60,source_updated_at:'2026-10-30T00:00:00Z',updated_at:'2026-10-30T00:00:00Z'});
const day=(date,auto=3,extra={})=>({data_date:date,country:'印度',platform:'YASH.BET',platform_key:yashKey,total:auto+9,success:auto+6,rejected:1,pending_count:1,failed_count:1,unknown_count:0,avg_seconds:60,duration_sample_count:auto+9,duration_total_seconds:(auto+9)*60,source_updated_at:'2026-10-30T00:00:00Z',updated_at:'2026-10-30T00:00:00Z',complete:false,operator_rows:[op('自动审核',auto),op('SYSTEM',2),op('Synthetic human',3),op('自动审核 suffix',2),op('（未知操作人）',2)],...extra});
const bundle=(extra={})=>({wg:[],newar:[],ar:[],arHistory:[],duoli:[],game66:{},yash:[day('2026-10-28',2),day('2026-10-29',3)],...extra});
const multiBundle=()=>bundle({yash:[day('2026-10-26',1),day('2026-10-27',2),day('2026-10-28',2),day('2026-10-29',3)]});
const render=(q=req(),b=bundle())=>value('select private.withdraw_prepared_render($1,$2)v',[q,b]);
const metadata=()=>value("select jsonb_object_agg(oid::regprocedure::text,to_jsonb(p)-'prosrc')v from pg_proc p where oid=any($1::regprocedure[])",[contract.map(s=>s.signature)]);
const dataState=()=>value("select jsonb_build_object('jobs',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from private.withdraw_prepared_jobs x),'heads',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from private.withdraw_prepared_heads x),'artifacts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from private.withdraw_prepared_artifacts x),'reports',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from public.auto_withdraw_daily x))v");
const classificationKeys=new Set(['autoCount','manualCount','unclassifiedCount','classificationBasis','automaticWithdrawalEnabled','classificationAvailable','classificationPartial','classificationComparable']);
function withoutClassification(v){if(Array.isArray(v))return v.map(withoutClassification);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!classificationKeys.has(k)).map(([k,x])=>[k,withoutClassification(x)]));return v;}
before(async()=>{
 db=await h.fixture();await finance.install(db);
 await db.exec(read('tests/fixtures/duoli-daily-fallback/sql/dashboard_admin_live_auto_withdraw.sql'));
 await db.exec(read('tests/fixtures/duoli-daily-fallback/sql/withdraw_prepared_render.sql'));
 await db.exec(read('tests/fixtures/yash-auto-review/auto_team_previous_projection.before.sql'));
 await db.exec(read('tests/fixtures/yash-auto-review/withdraw_prepared_dependency.before.sql'));
 for(const s of contract){await db.exec('revoke all on function '+s.signature+' from public,anon,authenticated,service_role');if(s.signature.includes('dashboard_admin_live_auto_withdraw'))await db.exec('grant execute on function '+s.signature+' to authenticated');assert.equal(await value('select md5(prosrc)v from pg_proc where oid=$1::regprocedure',[s.signature]),s.beforeHash,s.signature);}
 await db.exec("delete from public.synthetic_catalog;insert into public.synthetic_catalog values(md5('yash')::uuid,'YASH.BET','M8','印度','IN','kb','Asia/Kolkata','INR','YASH.BET'),(md5('other')::uuid,'OTHER-KB','M8','印度','IN','kb','Asia/Kolkata','INR','OTHER-KB');");
 await db.query("insert into public.auto_withdraw_daily(data_date,country,platform,total,success,rejected,auto_count,manual_count,avg_seconds,source_updated_at,updated_at)values('2026-10-29','印度','OTHER-KB',20,18,1,5,12,45,'2026-10-30','2026-10-30'),('2026-10-28','印度','OTHER-KB',18,16,1,4,11,40,'2026-10-30','2026-10-30')");
 yashKey=await value("select private.dashboard_admin_live_withdraw_key('YASH.BET')v");
 oldDependency=await value('select private.withdraw_prepared_dependency()v');oldMetadata=await metadata();oldDefinitions=await db.query('select oid::regprocedure::text sig,pg_get_functiondef(oid)definition from pg_proc where oid=any($1::regprocedure[])',[contract.map(s=>s.signature)]);
 baseline=[];for(const extra of [{},{daily:true},{view:'operators'},{startAt:'2026-10-28T00:00:00.000Z'},{platform:'OTHER-KB'},{platform:'YASH.BET'},{offset:20}])baseline.push([extra,await render(req(extra),extra.startAt?multiBundle():bundle())]);
 const data=await dataState();await db.exec(install());assert.deepEqual(await dataState(),data);
});
after(async()=>db?.close());
test('real renderer classifies the exact marker across all statuses and leaves unknown operators unknown',async()=>{
 const r=await render(),y=r.rows.find(x=>x.platform==='YASH.BET');assert.equal(y.total,12);assert.equal(y.autoCount,3);assert.equal(y.manualCount,7);assert.equal(y.unclassifiedCount,2);assert.equal(y.classificationBasis,'confirmed_latest_operator_auto_review');assert.equal(y.automaticWithdrawalEnabled,true);assert.equal(y.complete,false);assert.equal(y.previous.autoCount,2);assert.equal(y.previous.manualCount,7);assert.equal(y.previous.unclassifiedCount,2);assert.equal(r.totals.autoCount,8);assert.equal(r.totals.manualCount,19);assert.equal(r.totals.unclassifiedCount,5);assert.equal(r.previousTotals.autoCount,6);assert.equal(r.comparison.complete,false);
 const x=await render(req(),bundle({yash:[day('2026-10-29',3,{operator_rows:[op('自动审核',3),op('',1),op(null,1),op(' 自动审核',2),op('自动审核 ',2),op('SYSTEM',3)]})]}));const row=x.rows.find(x=>x.platform==='YASH.BET');assert.equal(row.autoCount,3);assert.equal(row.manualCount,7);assert.equal(row.unclassifiedCount,2);
});
test('current/prior/daily/multiday/operators/selection/pagination preserve all nonclassification values',async()=>{
 for(const [extra,old]of baseline){const actual=await render(req(extra),extra.startAt?multiBundle():bundle());assert.deepEqual(withoutClassification(actual),withoutClassification(old),JSON.stringify(extra));if(extra.platform==='OTHER-KB'){assert.deepEqual(actual.rows,old.rows);assert.deepEqual(actual.totals,old.totals);assert.deepEqual(actual.previousTotals,old.previousTotals);}}
 const multi=(await render(req({startAt:'2026-10-28T00:00:00.000Z'}),multiBundle())).rows.find(x=>x.platform==='YASH.BET');assert.equal(multi.autoCount,5);assert.equal(multi.manualCount,14);assert.equal(multi.previous.autoCount,3);assert.equal(multi.previous.manualCount,14);
 const operators=await render(req({view:'operators'}));for(const [account,a,m,u]of [['自动审核',3,0,0],['SYSTEM',0,2,0],['Synthetic human',0,3,0],['自动审核 suffix',0,2,0],['（未知操作人）',0,0,2]]){const row=operators.rows.find(x=>x.platform==='YASH.BET'&&x.account===account);assert(row,account);assert.equal(row.autoCount,a);assert.equal(row.manualCount,m);assert.equal(row.unclassifiedCount,u);}
});
test('verified zero remains zero while missing native days stay unavailable and cannot become complete',async()=>{
 const zero=(await render(req({platform:'YASH.BET'}),bundle({yash:[day('2026-10-29',0,{total:0,success:0,rejected:0,pending_count:0,failed_count:0,unknown_count:0,complete:true,operator_rows:[],duration_sample_count:0,duration_total_seconds:0,avg_seconds:null})]}))).rows.find(x=>x.platform==='YASH.BET');assert.equal(zero.total,0);assert.equal(zero.autoCount,0);assert.equal(zero.manualCount,0);assert.equal(zero.previous,null);
 const empty=await render(req({platform:'YASH.BET'}),bundle({yash:[day('2026-10-29',0,{total:null,success:null,rejected:null,pending_count:null,failed_count:null,unknown_count:null,operator_rows:[],duration_sample_count:null,duration_total_seconds:null,avg_seconds:null})]}));assert.equal(empty.yashCoverage.currentComplete,false);assert(empty.rows.every(x=>x.total==null));assert.notEqual(empty.sourceComplete,true);
});
test('installer is idempotent, preserves source/queue state, function metadata and the exact dependency token',async()=>{
 assert.equal(await value('select private.withdraw_prepared_dependency()v'),oldDependency);assert.deepEqual(await metadata(),oldMetadata);for(const s of contract)assert.equal(await value('select md5(prosrc)v from pg_proc where oid=$1::regprocedure',[s.signature]),s.afterHash);
 const state=await dataState();await db.exec(install());assert.deepEqual(await dataState(),state);assert.deepEqual(await metadata(),oldMetadata);assert.equal(await value('select private.withdraw_prepared_dependency()v'),oldDependency);
});
test('unknown code, ACL, metadata or mixed versions are rejected without partial installation',async()=>{
 for(const [sig,alter]of [[contract[1].signature,'cost 101'],[contract[0].signature,'security invoker']]){await db.exec('begin;alter function '+sig+' '+alter);await assert.rejects(db.exec(install().replace(/^.*?begin;/s,'').replace(/commit;\s*$/,'')),/yash_auto_review_metadata_drift/);await db.exec('rollback');}
 await db.exec('begin;grant execute on function private.withdraw_prepared_render(jsonb,jsonb)to anon');await assert.rejects(db.exec(install().replace(/^.*?begin;/s,'').replace(/commit;\s*$/,'')),/yash_auto_review_metadata_drift/);await db.exec('rollback');
 await db.exec('begin');await db.exec(oldDefinitions.rows.find(x=>x.sig===contract[0].signature).definition);await assert.rejects(db.exec(install().replace(/^.*?begin;/s,'').replace(/commit;\s*$/,'')),/yash_auto_review_partial_install/);await db.exec('rollback');assert.equal(await value('select private.withdraw_prepared_dependency()v'),oldDependency);
});
test('unknown future renderer revisions cannot reuse the preserved bundle dependency',async()=>{
 const current=await value("select pg_get_functiondef('private.withdraw_prepared_render(jsonb,jsonb)'::regprocedure)v");await db.exec('begin');await db.exec(current.replace('AS $function$','AS $function$\n-- future unknown change'));assert.notEqual(await value('select private.withdraw_prepared_dependency()v'),oldDependency);await db.exec('rollback');
 await db.exec('begin;alter function private.withdraw_prepared_render(jsonb,jsonb)cost 101');assert.notEqual(await value('select private.withdraw_prepared_dependency()v'),oldDependency);await db.exec('rollback');
});
test('real live reader and retained source helper classify all statuses identically to the prepared renderer without rewriting orders',async()=>{
 await db.exec('begin');try{
  const source=read('tests/fixtures/yash-withdraw-confirmed-manual-production.sql');
  const fn=name=>source.match(new RegExp('CREATE OR REPLACE FUNCTION private\\.'+name+'\\([\\s\\S]*?AS (\\$\\w*\\$)[\\s\\S]*?\\1\\s*;','i'))[0];
  await db.exec(`create table if not exists private.yash_orders(source_site text,order_type text,order_no text,operator text,status text,created_at timestamptz,completed_at timestamptz,observed_at timestamptz,received_at timestamptz,raw_fields jsonb,primary key(order_type,order_no));
   create table if not exists private.yash_sync_windows(order_type text,stream text,start_at timestamptz,end_exclusive timestamptz,source_count bigint,uploaded_count bigint,stored_count bigint,complete boolean,observed_at timestamptz,received_at timestamptz,source_timezone text,primary key(order_type,stream,start_at,end_exclusive));`);
  await db.exec(fn('dashboard_admin_yash_status'));
  await db.exec(read('tests/fixtures/yash-withdraw-day-evidence-baseline.sql'));
  await db.exec('drop function private.dashboard_admin_yash_withdraw_days(jsonb,jsonb,date,date);'+fn('dashboard_admin_yash_withdraw_days'));
  for(const date of ['2026-10-28','2026-10-29'])await db.query(`insert into private.yash_orders select 'yash','withdrawal',$1||'-'||g,(array['自动审核','自动审核','自动审核','SYSTEM',null,' ','Synthetic human'])[g],(array['已提现','提现中','已驳回','已提现','审核中','提现失败','未知原生状态'])[g],$1::date::timestamp at time zone 'Asia/Kolkata'+g*interval'1 second',$1::date::timestamp at time zone 'Asia/Kolkata'+(g+60)*interval'1 second','2026-10-30','2026-10-30','{}'::jsonb from generate_series(1,7)g`,[date]);
  const snapshot=()=>value("select jsonb_agg(to_jsonb(y)order by order_no)v from private.yash_orders y");const before=await snapshot();
  for(const extra of [{platform:'YASH.BET'},{platform:'YASH.BET',daily:true},{platform:'YASH.BET',view:'operators'},{platform:'YASH.BET',sort:'autoCount',ascending:true}]){
   const q=req(extra),live=await value('select private.dashboard_admin_live_auto_withdraw($1)v',[q]);
   const days=await value("select jsonb_agg(to_jsonb(y))v from private.dashboard_admin_yash_withdraw_days($1,'{\"mode\":\"all\",\"countries\":[]}', '2026-10-28','2026-10-29')y",[q]);
   const prepared=await render(q,bundle({yash:days}));assert.deepEqual(prepared,live,'entire live/prepared DTO '+JSON.stringify(extra));
   if(extra.view!=='operators'){assert.equal(live.rows[0].total,7);assert.equal(live.rows[0].autoCount,3);assert.equal(live.rows[0].manualCount,2);assert.equal(live.rows[0].unclassifiedCount,2);assert.equal(live.rows[0].success,2);assert.equal(live.rows[0].rejected,1);assert.equal(live.rows[0].complete,false);}
  }
  assert.deepEqual(await snapshot(),before);
 }finally{await db.exec('rollback');}
});
test('cleaning the old previous projection does not enable its inactive renderer version guard',async()=>{
 const q=req({platforms:[],scopeTargets:['印度','香港','红膏蟹'].map(country=>({country,platforms:['YASH.BET']}))});
 const v={view:'auto',version:2,total:0,rows:[],previousTotals:{total:1234,autoCount:567}};
 const b={...bundle(),request:q,scope:{mode:'all'},game66:'guarded sentinel: projection must not scan this'};
 assert.deepEqual(await value('select private.auto_team_previous_projection($1,$2,$3,$1)v',[q,b,v]),v);
});
