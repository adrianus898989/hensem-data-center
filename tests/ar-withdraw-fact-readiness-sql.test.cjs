const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixture,row,install}=require('./fixtures/ar-withdraw-fact-projection-harness.cjs');
const w=__dirname,read=f=>fs.readFileSync(path.join(w,'../supabase/migrations',f==='stage2-controls-guarded-draft.sql'?'20261011120036_ar_in_withdraw_fact_partition_readiness.sql':'20261011120049_ar_in_withdraw_fact_reader.sql'),'utf8');
const baseline=fs.readFileSync(path.join(w,'fixtures/ar-withdraw-fact-reader-baseline.sql'),'utf8'),patch=read('stage3-reader-guarded-draft.sql'),candidate=baseline.replace(patch.match(/\$old\$([\s\S]*?)\$old\$/)[1],patch.match(/\$new\$([\s\S]*?)\$new\$/)[1]);
const all={mode:'all',countries:[]},query=async(db,q={country:'印度'},s=all,start='2026-10-09',end='2026-10-12')=>(await db.query('select to_jsonb(a) r from private.dashboard_admin_ar_withdraw_days($1,$2,$3::date,$4::date)a order by data_date,country,platform_key',[q,s,start,end])).rows.map(x=>x.r);
const generation=async db=>(await db.query('select private.ar_withdraw_fact_generation() g')).rows[0].g;
const approve=async(db,platform,day)=>{await db.exec('begin isolation level repeatable read');try{const r=await db.query('select private.approve_ar_withdraw_fact_day($1,$2::date) r',[platform,day]);await db.exec('commit');return r.rows[0].r;}catch(e){await db.exec('rollback');throw e;}};
const future=async(db,platform)=>{await db.exec('begin isolation level repeatable read');try{const r=await db.query('select private.approve_ar_withdraw_fact_future($1) r',[platform]);await db.exec('commit');return r.rows[0].r;}catch(e){await db.exec('rollback');throw e;}};
const backfill=async db=>{await db.exec(`insert into private.ar_withdraw_facts select p.* from ar_collected_orders a cross join lateral private.ar_withdraw_fact(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no,a.status,a.operator,a.applied_at,a.completed_at,a.observed_at,a.updated_at)p on conflict(source_system,country_code,platform,order_kind,order_no)do nothing`);};
async function main(){const db=await fixture();let checks=0;try{
 await db.exec(`create or replace function private.dashboard_admin_live_withdraw_key(p text) returns text language sql immutable as $$select case regexp_replace(upper(btrim(p)),'[^A-Z0-9]','','g') when 'RAJALOTTERY' then 'RAJA' else regexp_replace(upper(btrim(p)),'[^A-Z0-9]','','g') end$$;
 create or replace function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable as $$select s->>'mode'='all' or (s->>'mode'='selected' and (s->'countries' ? c or s->'countries' ? case c when '印度' then 'IN' when '巴基斯坦' then 'PK' end) and (not s?'platforms' or exists(select 1 from jsonb_array_elements(s->'platforms')x where x->>'country'=case c when '印度' then 'IN' when '巴基斯坦' then 'PK' else c end and private.dashboard_admin_live_withdraw_key(x->>'platform')=private.dashboard_admin_live_withdraw_key(p))))$$;
 insert into synthetic_catalog values
 (md5('ok')::uuid,'OK.WIN','M8','印度','IN','ar','Asia/Kolkata','INR','OKWIN'),
 (md5('veer')::uuid,'Veer.Game','M8','印度','IN','ar','Asia/Kolkata','INR','Veer.Game'),
 (md5('raja')::uuid,'RAJALOTTERY','M8','印度','IN','ar','Asia/Kolkata','INR','RAJA'),
 (md5('pk')::uuid,'92.GAME','M8','巴基斯坦','PK','ar','Asia/Karachi','PKR','92.GAME');`);
 const rows=[
 ['91CLUB','已通过',' Same account ','2026-10-10 00:00:00','2026-10-10 00:00:20'],
 ['91CLUB','已提交','Same account','2026-10-10 10:00:00','2026-10-10 10:00:05'],
 ['91CLUB','未通过','Same account','2026-10-10 11:00:00','2026-10-10 11:00:00'],
 ['91CLUB','success reject','System','2026-10-10 12:00:00','2026-10-10 11:59:59'],
 ['91CLUB','unknown','\u200b\ufeff\u00a0---\u3000','2026-10-10 13:00:00',null],
 ['91CLUB','failed','\n系统管理员\t','2026-10-10 14:00:00','2026-10-10 14:00:00.999'],
 ['91CLUB',null,null,'2026-10-10 15:00:00','2026-10-10 15:00:02'],
 ['91CLUB','驳回','Same account','2026-10-11 00:00:00','2026-10-11 00:00:10'],
 ['91CLUB','success','Other account','2026-10-09 23:59:59','2026-10-10 00:00:02'],
 ['91CLUB','success','Other account',null,null],
 ['OKWIN','成功','Same account','2026-10-10 01:00:00','2026-10-10 01:00:07'],
 ['OK.WIN','已提交','Same account','2026-10-10 02:00:00','2026-10-10 02:00:08'],
 ['RAJA','rejected','\tOperator\u202f','2026-10-10 03:00:00','2026-10-10 03:01:00'],
 ['RAJALOTTERY','unknown','----','2026-10-10 04:00:00',null],
 ['Veer.Game','submitted','system_automatic','2026-10-10 05:00:00','2026-10-10 05:00:05'],
 ['92.GAME','成功','Same account','2026-10-10 07:00:00','2026-10-10 07:00:30']
 ];
 for(let i=0;i<rows.length;i++){const [platform,status,operator,applied_at,completed_at]=rows[i];await row(db,'SYNTHETIC-'+i,{country_code:platform==='92.GAME'?'PK':'IN',platform,status,operator,applied_at,completed_at});}
 await row(db,'foreign-source',{source_system:'OTHER'});await row(db,'foreign-direction',{order_kind:'recharge'});await row(db,'foreign-country',{country_code:'PK'});await row(db,'foreign-platform',{platform:'FOREIGN'});
 const cases=[{q:{country:'印度'}},{q:{country:'印度',platforms:[]}},{q:{country:'印度',platforms:['91CLUB','OK.WIN']}},{q:{country:'印度',platform:'RAJALOTTERY'}},{q:{country:'印度',platform:'91CLUB'}},{q:{country:'印度',platforms:['Veer.Game']}},{q:{country:'印度',platforms:['ABSENT']}},{q:{country:'巴基斯坦'}},{q:{country:'印度',view:'operators'}},{q:{country:'印度',scopeTargets:[{country:'印度',platforms:['91CLUB']},{country:'巴基斯坦',platforms:['92.GAME']}]}},
 {q:{country:'印度'},s:{mode:'selected',countries:['PK']}},{q:{country:'印度'},s:{mode:'selected',countries:['IN'],platforms:[]}},{q:{country:'印度'},s:{mode:'selected',countries:['IN'],platforms:[{country:'IN',platform:'91CLUB'}]}},{q:{country:'印度'},start:'2026-10-09',end:'2026-10-09'},{q:{country:'印度'},start:'2026-10-12',end:'2026-10-12'},{q:{country:'印度',scopeTargets:[{country:'印度',platforms:[]}]}}];
 for(const q of cases.slice(0,5))cases.push({...q,start:'2026-10-10',end:'2026-10-10'});
 const checkAll=async(label)=>{await db.exec(baseline);const expected=[];for(const c of cases)expected.push(await query(db,c.q,c.s,c.start,c.end));await db.exec(candidate);for(let i=0;i<cases.length;i++){const c=cases[i];assert.deepEqual(await query(db,c.q,c.s,c.start,c.end),expected[i],label+' case '+i);assert.equal(expected[i].every(x=>Object.keys(x).length===17),true);}checks+=cases.length;};
 await db.exec(install);await db.exec(read('stage2-controls-guarded-draft.sql'));assert.ok(await generation(db));
 await checkAll('unapproved all fallback');
 await assert.rejects(()=>approve(db,'91CLUB','2026-10-10'),/parity_failed/);await backfill(db);await approve(db,'91CLUB','2026-10-10');await checkAll('mixed day/native alias readiness');
 for(const platform of ['91CLUB','OKWIN','OK.WIN','RAJA','RAJALOTTERY','Veer.Game'])for(const day of ['2026-10-10','2026-10-11'])await approve(db,platform,day);
 for(const platform of ['91CLUB','OKWIN','OK.WIN','RAJA','RAJALOTTERY','Veer.Game'])await future(db,platform);
 await checkAll('all existing IN approved and PK raw');
 const zero=await approve(db,'91CLUB','2026-10-12');assert.equal(zero.sourceCount,0);assert.equal((await query(db,{country:'印度',platform:'91CLUB'},all,'2026-10-12','2026-10-12'))[0].total,null,'approval is not zero-day proof');
 // Approved path genuinely avoids raw status/account/duration expressions.
 await db.exec(`create function private.raw_forbidden(text) returns text language plpgsql volatile as $$begin raise exception 'raw_path_executed';end$$;`);
 const spy=candidate.replace("coalesce(a.status,'') status","coalesce(private.raw_forbidden(a.status),'') status");await db.exec(spy);await query(db,{country:'印度',platform:'91CLUB'},all,'2026-10-10','2026-10-10');
 await assert.rejects(()=>query(db,{country:'巴基斯坦'},all,'2026-10-10','2026-10-10'),/raw_path_executed/);await db.exec(candidate);
 const before=await generation(db);await db.exec('alter table ar_collected_orders disable trigger ar_withdraw_fact_sync_update');assert.equal(await generation(db),null);await db.exec('alter table ar_collected_orders enable trigger ar_withdraw_fact_sync_update');assert.notEqual(await generation(db),before);await checkAll('disable/re-enable invalidates all prior generation');
 await approve(db,'91CLUB','2026-10-10');await future(db,'91CLUB');
 const g=await generation(db);await db.exec("update ar_collected_orders set operator='system_latest',status='success',observed_at='2026-10-12T12:00:00Z',updated_at='2026-10-12T12:00:00Z' where order_no='SYNTHETIC-0'");assert.equal(await generation(db),g);assert.equal((await db.query("select count(*)::int c from private.ar_withdraw_fact_ready where platform='91CLUB' and data_date='2026-10-10'")).rows[0].c,1,'source sync keeps readiness');await checkAll('source update while approved');
 await row(db,'FUTURE',{applied_at:'2026-10-12 00:00:00',completed_at:'2026-10-12 00:00:12',operator:'system'});await checkAll('future born under synchronized trigger');
 await db.exec("delete from private.ar_withdraw_facts where order_no='SYNTHETIC-0'");assert.equal((await db.query("select count(*)::int c from private.ar_withdraw_fact_ready where platform='91CLUB' and data_date='2026-10-10'")).rows[0].c,0);await checkAll('direct cleanup revokes day and falls back');
 await db.exec('truncate private.ar_withdraw_facts');assert.equal((await db.query('select count(*)::int c from private.ar_withdraw_fact_future_ready')).rows[0].c,0);await checkAll('truncate revokes future and days');
 await backfill(db);await approve(db,'91CLUB','2026-10-10');await db.exec("update private.ar_withdraw_facts set method='unknown' where order_no='SYNTHETIC-0'");await assert.rejects(()=>approve(db,'91CLUB','2026-10-10'),/parity_failed/);await checkAll('corrupt projection revoked and raw fallback');
 await db.exec('alter function private.ar_withdraw_fact(text,text,text,text,text,text,text,timestamp,timestamp,timestamptz,timestamptz) stable');assert.equal(await generation(db),null);await checkAll('projector metadata drift fallback');
 await db.exec('set role service_role');await assert.rejects(()=>db.query('select * from private.ar_withdraw_fact_ready'),/permission denied/);await assert.rejects(()=>db.query("select private.approve_ar_withdraw_fact_day('91CLUB','2026-10-10')"),/permission denied/);await db.exec('reset role');
 const report={synthetic_only:true,production_writes:0,requests:cases.length,full_json_comparisons:checks,output_columns:17,differences:0,approved_path_verified:true,exact_partition_proof:true,missing_and_corrupt_rejected:true,future_range_proved_empty:true,trigger_epoch_invalidation:true,legitimate_source_writes_keep_ready:true,private_cleanup_revokes:true,private_access_denied:true,cross_connection_lock_test:false};return report;
 }finally{await db.close();}}

const controls=read('stage2-controls-guarded-draft.sql'),reader=read('stage3-reader-guarded-draft.sql');
const epoch=async db=>(await db.query('select private.ar_withdraw_fact_generation() g')).rows[0].g;
const prepare=async()=>{const db=await fixture();await db.exec(install);await db.exec(controls);return db;};
const drifts=[
 ['control-function-public-execute',`grant execute on function private.approve_ar_withdraw_fact_day(text,date) to public`,/function_metadata_drift/],
 ['control-function-definer',`alter function private.approve_ar_withdraw_fact_day(text,date) security definer`,/function_metadata_drift/],
 ['ready-table-grant',`grant select on private.ar_withdraw_fact_ready to authenticated`,/table_metadata_drift/],
 ['ready-table-rls',`alter table private.ar_withdraw_fact_future_ready disable row level security`,/table_metadata_drift/],
 ['disabled-cleanup-trigger',`alter table private.ar_withdraw_facts disable trigger ar_withdraw_fact_ready_change`,/control_trigger_drift/],
 ['reader-return-drift',`alter function private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date) security definer`,/reader_baseline_drift/]
];
async function guards(){let db=await prepare();try{
 await row(db,'READY');await db.exec(`begin isolation level repeatable read;select private.approve_ar_withdraw_fact_day('91CLUB','2026-10-10');select private.approve_ar_withdraw_fact_future('91CLUB');commit;`);
 const before=await epoch(db),ready=(await db.query('select to_jsonb(r) j from private.ar_withdraw_fact_ready r')).rows;
 await db.exec(controls);assert.equal(await epoch(db),before,'control replay preserves generation');assert.deepEqual((await db.query('select to_jsonb(r) j from private.ar_withdraw_fact_ready r')).rows,ready,'control replay preserves valid approvals');
 const oldMeta=(await db.query("select to_jsonb(p)-'prosrc' m from pg_proc p where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure")).rows[0].m;
 await db.exec(reader);await db.exec(reader);assert.deepEqual((await db.query("select to_jsonb(p)-'prosrc' m from pg_proc p where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure")).rows[0].m,oldMeta);
 await db.exec(controls);assert.equal(await epoch(db),before,'control replay supports deployed candidate reader');
 await assert.rejects(()=>db.query("select private.approve_ar_withdraw_fact_day('91CLUB','2026-10-10')"),/requires_repeatable_read/);
 await row(db,'INFINITY',{applied_at:'infinity',completed_at:null});await db.exec(`begin isolation level repeatable read;select private.approve_ar_withdraw_fact_future('91CLUB');commit;`);assert.equal((await db.query("select future_from::text d from private.ar_withdraw_fact_future_ready where platform='91CLUB'")).rows[0].d,'2026-10-11','non-finite non-query day does not approve existing finite day');
 }finally{await db.close();}
 for(const [name,mutation,expected] of drifts){db=await prepare();try{await db.exec(mutation);await assert.rejects(()=>db.exec(controls),expected,name);await db.exec('rollback');}finally{await db.close();}}
 return {drift_cases:drifts.length,all_passed:true};
}

const test=require('node:test');
test('AR partition/future proofs preserve every output field; metadata epochs and direct cleanup safely fall back',main);
test('AR readiness and reader replay preserve metadata and approvals; privilege and metadata drift fail closed',guards);
