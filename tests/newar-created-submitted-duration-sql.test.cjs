// Real PostgreSQL execution of frozen production code with synthetic orders only.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const repo=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const auditedFile=path.join(__dirname,'newar-withdraw-audited-method-corrections.test.cjs');
const h=new Function('require','__dirname',fs.readFileSync(auditedFile,'utf8').split("test('schema migration")[0]+';return{fixture,old,sql};')(createRequire(auditedFile),__dirname);
const fullFile=path.join(__dirname,'ar-withdraw-bounded-projection-sql.test.cjs');
const full=new Function('require','__dirname',fs.readFileSync(fullFile,'utf8').split("test('projected native")[0]+';return{fixture:fullFixture,native:C.h.native,call,ar:candidate};')(createRequire(fullFile),__dirname);
const migration=read('supabase/migrations/20261012045404_newar_observed_created_to_submitted_duration.sql');
const repair=read('supabase/maintenance/newar_submitted_fact_one_hour.sql');
const beforeHelper=read('tests/fixtures/newar-created-submitted-helper-production.sql');
const beforeMain=read('tests/fixtures/newar-created-submitted-main-production.sql');
const extract=(j,i)=>{const a=migration.match(new RegExp('\\$old'+j+'_'+i+'\\$([\\s\\S]*?)\\$old'+j+'_'+i+'\\$'))[1];const b=migration.match(new RegExp('\\$new'+j+'_'+i+'\\$([\\s\\S]*?)\\$new'+j+'_'+i+'\\$'))[1];return[a,b]};
const candidate=(s,j,count)=>{for(let i=0;i<count;i++){const[a,b]=extract(j,i);assert.equal(s.split(a).length,2);s=s.replace(a,b)}return s};
const helper=candidate(beforeHelper,0,2),main=candidate(beforeMain,1,5);
const helperSig='private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)',mainSig='private.dashboard_admin_live_auto_withdraw(jsonb)';
const meta=(db,sig)=>db.query("select md5(prosrc) hash,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid=$1::regprocedure",[sig]).then(r=>r.rows[0]);
async function helperFixture(){const {db,ids}=await h.fixture();await db.exec(h.sql);await db.exec('set check_function_bodies=off');await db.exec(beforeMain);await db.exec('set check_function_bodies=on');await db.exec(`revoke all on function ${mainSig} from public,anon,service_role;grant execute on function ${mainSig} to authenticated;`);return{db,ids};}
const day=(db,q={},s={},from='2026-10-10',to='2026-10-11')=>db.query('select to_jsonb(d) item from private.dashboard_admin_newar_withdraw_days($1::jsonb,$2::jsonb,$3::date,$4::date)d order by country,platform,data_date',[{country:'印度',...q},s,from,to]).then(r=>r.rows.map(x=>x.item));
const noTimes=(v,mainDTO=false)=>{const r=structuredClone(v);const omit=mainDTO?['avgSeconds','durationSampleCount','durationTotalSeconds','durationBasis','durationSource','durationCompletenessVerified']:['avg_seconds','duration_sample_count','duration_total_seconds'];const walk=x=>{if(!x||typeof x!=='object')return;for(const k of Object.keys(x))if(omit.includes(k))delete x[k];else walk(x[k]);};walk(r);return r;};
async function source(db,id,p='MAANWIN',extra={}){return h.old.order(db,id,null,{platform:p,created:'2026-10-10T00:00:00Z',handled:null,...extra,raw:{sourceSubmittedAt:'2026-10-10T00:00:10.900Z',sourceSubmittedSourceField:'submittedTime',sourceHandledSourceField:null,...extra.raw}});}
async function fullFixture(){const db=await full.fixture();await db.exec(full.ar);await db.exec(read('supabase/migrations/20261011154529_ar_withdraw_historical_duration_cache.sql'));await db.exec(beforeMain);return db;}

test('actual old/new projector leaves old submitted facts stale until a bounded source-proven repair; raw and classifications stay identical',async()=>{
 const {db,ids}=await h.fixture();try{
 const id=await source(db,'stale');const src=(await db.query('select to_jsonb(n) r from public.newar_detail_records n where id=$1',[id])).rows[0].r;
 await db.query("update public.newar_detail_records set raw=jsonb_set(raw,'{sourceSubmittedSourceField}','\"submittedTime\"') where id=any($1::uuid[])",[ids]);
 assert.equal((await db.query('select submitted_at from private.newar_withdraw_facts where record_id=$1',[id])).rows[0].submitted_at,null);
 await db.exec(h.sql);assert.equal((await db.query('select submitted_at from private.newar_withdraw_facts where record_id=$1',[id])).rows[0].submitted_at,null,'installation is not history backfill');
 await db.query(`insert into private.newar_withdraw_method_verifications(record_id,platform,dataset,source_id,confirmed_method,evidence_kind,evidence_ref)
 select id,platform,dataset,source_id,'auto','user_confirmed_source_ui','synthetic_three_order_confirmation' from public.newar_detail_records where id=any($1::uuid[])`,[ids]);
 await db.query('update private.newar_withdraw_facts set submitted_at=null where record_id=any($1::uuid[])',[ids]);
 const audits=(await db.query('select to_jsonb(v) r from private.newar_withdraw_method_verifications v order by record_id')).rows;
 const other=(await db.query("select to_jsonb(f)-'submitted_at' r from private.newar_withdraw_facts f order by record_id")).rows;
 const template=repair.replace('2026-10-09T18:30:00Z','2026-10-10T00:00:00Z').replace('2026-10-09T19:30:00Z','2026-10-10T01:00:00Z');
 await db.exec(template.replace(/commit;\s*$/,'').trim());
 assert.ok((await db.query("select mode from pg_locks where relation='public.newar_detail_records'::regclass and granted")).rows.some(r=>r.mode==='RowShareLock'),'real source FOR SHARE relation lock held before commit');
 await db.exec('commit');assert.ok((await db.query('select submitted_at from private.newar_withdraw_facts where record_id=$1',[id])).rows[0].submitted_at instanceof Date);
 await db.exec(template.replace("'MAANWIN',true","'DhaniWin',true"));
 assert.deepEqual((await db.query("select to_jsonb(f)-'submitted_at' r from private.newar_withdraw_facts f order by record_id")).rows,other);
 assert.ok((await db.query('select method from private.newar_withdraw_facts where record_id=any($1::uuid[])',[ids])).rows.every(r=>r.method==='auto'));
 assert.ok((await db.query('select submitted_at from private.newar_withdraw_facts where record_id=any($1::uuid[])',[ids])).rows.every(r=>r.submitted_at instanceof Date));
 assert.deepEqual((await db.query('select to_jsonb(v) r from private.newar_withdraw_method_verifications v order by record_id')).rows,audits);
 assert.deepEqual((await db.query('select to_jsonb(n) r from public.newar_detail_records n where id=$1',[id])).rows[0].r,src);
 await db.query("update private.newar_withdraw_facts set submitted_at='2026-10-10T00:00:20Z' where record_id=$1",[id]);
 const before=(await db.query('select to_jsonb(f) r from private.newar_withdraw_facts f order by record_id')).rows;await db.exec(template);assert.deepEqual((await db.query('select to_jsonb(f) r from private.newar_withdraw_facts f order by record_id')).rows,before,'existing nonnull is never overwritten');
 const oneHourRead=read('supabase/maintenance/newar_submitted_fact_missing_one_hour.sql').replace('2026-10-09T18:30:00Z','2026-10-10T00:00:00Z').replace('2026-10-09T19:30:00Z','2026-10-10T01:00:00Z');
 const remaining=(await db.exec(oneHourRead)).find(r=>r.rows?.[0]?.eligible_missing!==undefined);
 assert.equal(remaining.rows[0].platform,'MAANWIN');assert.equal(remaining.rows[0].eligible_missing,0);
 await assert.rejects(()=>db.exec(template.replace("'MAANWIN',true","'OTHER',true")),/SCOPE_INVALID/);await db.exec('rollback');
 await assert.rejects(()=>db.exec(template.replace('2026-10-10T01:00:00Z','2026-10-10T02:00:00Z')),/SCOPE_INVALID/);await db.exec('rollback');
 }finally{await db.close()}
});
test('typed-hour candidates drive locked native PK lookups; invalid prefixes cannot starve eligible rows and each repair stays capped',async()=>{
 const {db}=await helperFixture();try{
 await db.exec('delete from public.newar_detail_records');
 await db.exec(`create index if not exists newar_detail_created_idx on public.newar_detail_records(platform,dataset,created_at desc,id desc);
 insert into public.newar_detail_records(platform,dataset,source_id,status_group,currency,created_at,captured_at,received_at,raw,amount)
 select 'MAANWIN','withdraw','Synthetic typed-first '||i,'success','INR',
  timestamptz '2026-10-10T00:00:00Z'+i*interval '1 microsecond',timestamptz '2026-10-11T00:00:00Z',timestamptz '2026-10-11T00:01:00Z',
  jsonb_build_object('businessSchemaVersion','2','sourceSubmittedSourceField','submittedTime',
   'sourceSubmittedAt',case when i<=1001 then 'not a timestamp' else '2026-10-10T00:01:00Z' end),0
 from generate_series(1,2002)i;
 update private.newar_withdraw_facts set submitted_at=null;
 analyze public.newar_detail_records;analyze private.newar_withdraw_facts;`);
 const template=repair.replace('2026-10-09T18:30:00Z','2026-10-10T00:00:00Z').replace('2026-10-09T19:30:00Z','2026-10-10T01:00:00Z');
 const begin=template.slice(0,template.indexOf('with params'));
 const query=template.slice(template.indexOf('with params'),template.lastIndexOf('commit;'));
 const explain=(await db.exec(begin+'explain (analyze,buffers,timing false,format json) '+query+'rollback;')).find(r=>r.rows?.[0]?.['QUERY PLAN'])?.rows[0]['QUERY PLAN'];
 assert.ok(explain,'the complete maintenance statement was actually executed and rolled back for its plan');
 const nodes=[];const walk=n=>{nodes.push(n);for(const c of n.Plans||[])walk(c)};walk(explain[0].Plan);
 const native=nodes.filter(n=>n['Relation Name']==='newar_detail_records');
 assert.ok(native.some(n=>n['Index Name']==='newar_detail_records_pkey'&&n['Actual Loops']>0),'each materialized fact ID reaches the native PK');
 assert.ok(native.every(n=>n['Index Name']==='newar_detail_records_pkey'),'no native hour/raw scan replaces the bounded PK lookup');
 assert.ok(nodes.some(n=>n['Index Name']==='newar_withdraw_facts_platform_created_idx'),'narrow fact candidates use the platform/date index');
 assert.ok(nodes.some(n=>n['Index Name']==='newar_withdraw_facts_pkey'),'the update uses the exact fact primary key rather than repeated timestamp pools');
 const locks=nodes.filter(n=>n['Node Type']==='LockRows');assert.equal(locks.length,1);
 assert.equal(locks[0]['Actual Rows']*locks[0]['Actual Loops'],1000,'only the 1000 eligible source PKs are row-locked');
 assert.equal((await db.query('select count(*) n from private.newar_withdraw_facts where submitted_at is not null')).rows[0].n,0,'EXPLAIN repair rolled back');
 let r=(await db.exec(template)).find(x=>x.rows?.[0]?.submitted_facts_repaired!==undefined).rows[0];assert.equal(r.submitted_facts_repaired,1000);assert.equal(r.eligible_candidates,1000);assert.equal(r.source_rows_checked,1000);
 r=(await db.exec(template)).find(x=>x.rows?.[0]?.submitted_facts_repaired!==undefined).rows[0];assert.equal(r.submitted_facts_repaired,1);
 r=(await db.exec(template)).find(x=>x.rows?.[0]?.submitted_facts_repaired!==undefined).rows[0];assert.equal(r.submitted_facts_repaired,0);
 assert.equal((await db.query('select count(*) n from private.newar_withdraw_facts where submitted_at is null')).rows[0].n,1001,'invalid source timestamps remain unknown');
 }finally{await db.close()}
});
test('creation-to-submission agrees with the real old daily priority while preserving all other helper fields and unknowns',async()=>{
 const {db}=await helperFixture();try{
 await db.exec('delete from public.newar_detail_records');
 await source(db,'positive');
 await source(db,'fraction','MAANWIN',{raw:{sourceSubmittedAt:'2026-10-10T00:00:00.900Z'}});
 await source(db,'zero','MAANWIN',{raw:{sourceSubmittedAt:'2026-10-10T00:00:00Z'}});
 await source(db,'negative','MAANWIN',{raw:{sourceSubmittedAt:'2026-10-09T23:59:59Z'}});
 await source(db,'missing','MAANWIN',{raw:{sourceSubmittedAt:null}});
 await source(db,'future','MAANWIN',{raw:{sourceSubmittedAt:'2099-01-01T00:00:00Z'}});
 const old=await day(db,{platform:'MAAN.WIN'});await db.exec(migration);const now=await day(db,{platform:'MAAN.WIN'});
 assert.deepEqual(noTimes(now),noTimes(old));assert.equal(now[0].total,6);assert.equal(now[0].duration_sample_count,1);assert.equal(now[0].duration_total_seconds,10);assert.equal(now[0].avg_seconds,10);
 // Old get_finished_ms picks submittedTime before handled/payment/update timestamps.
 const native={created:Date.parse('2026-10-10T00:00:00Z'),submittedTime:Date.parse('2026-10-10T00:00:10.900Z'),lastUpdateTime:Date.parse('2026-10-11T00:00:00Z')};
 assert.equal(Math.trunc((native.submittedTime-native.created)/1000),now[0].avg_seconds);
 assert.notEqual(Math.trunc((native.lastUpdateTime-native.created)/1000),now[0].avg_seconds);
 }finally{await db.close()}
});
test('finite/capture/half-open local dates and exact native identity remain enforced; other dates/platforms retain handling semantics',async()=>{
 const {db}=await helperFixture();try{await db.exec('delete from public.newar_detail_records');
 await source(db,'left','MAANWIN',{created:'2026-10-09T18:30:00Z',raw:{sourceSubmittedAt:'2026-10-09T18:30:02Z'}});
 await source(db,'last','MAANWIN',{created:'2026-10-10T18:29:59.999999Z',captured:'2026-10-12T00:00:00Z',raw:{sourceSubmittedAt:'2026-10-10T18:30:03Z'}});
 await source(db,'next','MAANWIN',{created:'2026-10-10T18:30:00Z',captured:'2026-10-12T00:00:00Z',raw:{sourceSubmittedAt:'2026-10-10T18:30:04Z'}});
 await source(db,'after-capture','MAANWIN',{captured:'2026-10-10T00:00:01Z',raw:{sourceSubmittedAt:'2026-10-10T00:00:02Z'}});
 await source(db,'infinite','MAANWIN',{raw:{sourceSubmittedAt:'infinity'}});
 await source(db,'other','ZERO',{handled:'2026-10-10T00:00:20Z',raw:{sourceSubmittedAt:'2026-10-10T00:00:01Z',sourceHandledAt:'2026-10-10T00:00:20Z',sourceHandledSourceField:'handledTime'}});
 await source(db,'old-day','MAANWIN',{created:'2026-10-09T00:00:00Z',handled:'2026-10-09T00:00:05Z',raw:{sourceSubmittedAt:'2026-10-09T00:00:01Z',sourceHandledAt:'2026-10-09T00:00:05Z',sourceHandledSourceField:'handledTime'}});
 await db.exec("set timezone='America/Sao_Paulo'");const oldOther=await day(db,{platform:'ZERO'}),oldHistory=await day(db,{platform:'MAANWIN'},{},'2026-10-09','2026-10-09');await db.exec(migration);
 const d=await day(db,{platform:'MAANWIN'});assert.equal(d[0].total,4);assert.equal(d[0].duration_sample_count,2);assert.equal(d[0].duration_total_seconds,5);assert.equal(d[1].total,1);assert.equal(d[1].duration_total_seconds,4);
 assert.deepEqual(await day(db,{platform:'ZERO'}),oldOther);assert.deepEqual(await day(db,{platform:'MAANWIN'},{},'2026-10-09','2026-10-09'),oldHistory);
 assert.deepEqual(await day(db,{}, {targets:[]}),[]);
 assert.deepEqual((await day(db,{}, {targets:[['印度','MAANWIN']]})).map(r=>r.platform_key),['MAANWIN','MAANWIN']);
 }finally{await db.close()}
});
test('full main DTO keeps counts/classification/cache/coverage while current and prior explicit native submission time compare and sort',async()=>{
 const db=await fullFixture();try{
 await db.exec('delete from private.synthetic_native_days where source=\'newar\'');
 for(const [p,base]of [['MAAN.WIN',10],['DHANIWIN',20]])for(const d of ['2026-10-10','2026-10-11'])await full.native(db,'newar',p,d,{total:10,success:7,rejected:1,auto_count:4,manual_count:5,unclassified_count:1,avg_seconds:base+(d==='2026-10-11'?10:0),duration_sample_count:2,duration_total_seconds:2*(base+(d==='2026-10-11'?10:0)),complete:false},p==='MAAN.WIN'?'MAANWIN':'DhaniWin');
 const q={startAt:'2026-10-11T00:00:00Z',endAt:'2026-10-11T23:59:59Z'},old=await full.call(db,q);await db.exec(main);const now=await full.call(db,q);assert.deepEqual(noTimes(now,true),noTimes(old,true));
 for(const p of ['MAAN.WIN','DHANIWIN']){const r=now.rows.find(r=>r.platform===p);assert(r);assert.equal(r.durationBasis,'created_to_submitted');assert.equal(r.durationSource,'native_created_to_submitted');assert.equal(r.previous.durationBasis,'created_to_submitted');assert.equal(r.previous.durationSource,'native_created_to_submitted');assert.equal(r.comparisonComparable,false);}
 const sorted=(await full.call(db,{...q,sort:'durationChange',ascending:true})).rows.filter(r=>['MAAN.WIN','DHANIWIN'].includes(r.platform));assert.deepEqual(sorted.map(r=>r.platform),['DHANIWIN','MAAN.WIN']);
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({targets:[['印度','91CLUB']]})]);assert.deepEqual((await full.call(db,q)).rows.map(r=>r.platform),['91CLUB']);await db.exec("set test.denied='yes'");await assert.rejects(()=>full.call(db,q),/synthetic_session_denied/);
 }finally{await db.close()}
});
test('mixed historical report/native spans use sample weights without relabelling source reports or manufacturing a comparable basis',async()=>{
 const db=await fullFixture();try{
 await db.exec("delete from private.synthetic_native_days where source='newar'");
 for(const d of ['2026-10-09','2026-10-10','2026-10-11','2026-10-12'])await full.native(db,'newar','MAAN.WIN',d,{total:10,avg_seconds:d==='2026-10-09'?null:10,duration_sample_count:d==='2026-10-09'?0:2,duration_total_seconds:d==='2026-10-09'?null:20,complete:false},'MAANWIN');
 await db.query("insert into newar_business_snapshots values('auto_withdraw_bundle','all','印度','MAANWIN','2026-10-09',$1::jsonb,$2,$2)",[JSON.stringify({rows:[{total_count:999,success_count:900,reject_count:1,auto_count:499,manual_count:500,handle_count:8,total_handle_seconds:240}]}),'2026-10-11T00:00:00Z']);
 const q={platform:'MAAN.WIN',startAt:'2026-10-11T00:00:00Z',endAt:'2026-10-12T23:59:59Z'},old=await full.call(db,q);await db.exec(main);const r=(await full.call(db,q)).rows[0];
 assert.equal(r.previous.durationBasis,'mixed_source_processing');assert.equal(r.previous.durationSource,undefined);assert.equal(r.previous.durationSampleCount,10);assert.equal(r.previous.avgSeconds,26);assert.equal(r.durationBasis,'created_to_submitted');
 assert.equal(r.previous.total,old.rows[0].previous.total);assert.equal(r.total,old.rows[0].total);
 const daily=(await full.call(db,{...q,daily:true})).rows;assert.equal(daily.find(r=>r.dataDate==='2026-10-11').previous.durationBasis,'created_to_submitted');
 const oct10=(await full.call(db,{platform:'MAAN.WIN'})).rows[0];assert.equal(oct10.previous.durationBasis,'source_reported_processing');assert.equal(oct10.previous.durationSource,'historical_source_report');
 }finally{await db.close()}
});
test('actual migration executes atomically, preserves metadata/replay and rejects function/OUT/ACL drift',async()=>{
 const {db}=await helperFixture();try{
 const oldH=await meta(db,helperSig),oldM=await meta(db,mainSig);await db.exec(migration);const newH=await meta(db,helperSig),newM=await meta(db,mainSig);
 assert.equal(newH.hash,'46fa899cdbf78147c022e1813e197427');assert.equal(newM.hash,'4984364f524c3d3b5bf73d87ab69f0d2');assert.deepEqual(newH.metadata,oldH.metadata);assert.deepEqual(newM.metadata,oldM.metadata);await db.exec(migration);assert.deepEqual(await meta(db,helperSig),newH);assert.deepEqual(await meta(db,mainSig),newM);
 const block=migration.slice(migration.indexOf('do $patch$'),migration.lastIndexOf('commit;'));
 for(const drift of [`alter function ${mainSig} security invoker`,`alter function ${helperSig} set search_path=public`,`grant execute on function ${helperSig} to anon`,`alter function private.newar_stats_time(text) volatile`]){await db.exec('begin');await db.exec(drift);await assert.rejects(()=>db.exec(block),/DRIFT/);await db.exec('rollback')}
 await db.exec('begin');await db.exec(`drop function ${helperSig};`+beforeHelper.replace('data_date date, country','drifted_day date, country'));await db.exec(`revoke all on function ${helperSig} from public`);await assert.rejects(()=>db.exec(block),/METADATA_DRIFT/);await db.exec('rollback');
 for(const role of ['anon','service_role']){await db.exec('set role '+role);await assert.rejects(()=>day(db),/permission denied/);await db.exec('reset role')}
 }finally{await db.close()}
});
