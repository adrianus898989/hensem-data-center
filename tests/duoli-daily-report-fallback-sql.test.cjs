// Real deployed PostgreSQL render bodies; exclusively synthetic daily facts.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const h=require('./fixtures/duoli-daily-fallback/base.cjs');
const read=f=>fs.readFileSync(path.join(__dirname,'fixtures/duoli-daily-fallback/sql',f+'.sql'),'utf8');
async function apply(db){await db.exec(read('withdraw_prepared_render'));}
const native=(p,date,n=5)=>h.day(p,date,{total:n,success:n-1,rejected:1,pending_count:0,unknown_count:0,avg_seconds:10,duration_sample_count:n,duration_total_seconds:n*10,operator_rows:[{account:'SYNTHETIC',processed:n,success:n-1,rejected:1,auto_count:0,manual_count:n,unclassified_count:0,operator_class:'manual',avg_seconds:10,duration_sample_count:n,duration_total_seconds:n*10}]});
async function run(fn){const db=await h.fixture();try{await fn(db);}finally{await db.close();}}
test('actual deployed render omits a received report when native has only null placeholders; candidate recovers the exact report subtotal',()=>run(async db=>{
 const totals=[1001,701,601,401,311];for(let i=0;i<5;i++)await h.report(db,['UANG','FB168','FB333','HOT985','IND666'][i],'2026-10-23',totals[i],{auto:totals[i]-10,manual:9});
 const before=await h.call(db);assert.deepEqual(before.rows,[]);assert.equal(before.totals.total,undefined);await apply(db);const after=await h.call(db);
 assert.equal(after.rows.length,5);assert.equal(after.totals.total,3015);assert.equal(after.rows.reduce((n,r)=>n+r.total,0),3015);assert.equal(after.totals.unclassifiedCount,5);
 for(const row of after.rows){assert.equal(row.countSource,'source_daily_report');assert.equal(row.durationBasis,'source_reported_processing');assert.equal(row.complete,false);assert.equal(row.sourceCompletenessVerified,false);assert.equal(row.statisticBasis,'created_at_current_status');}
 assert.deepEqual(after.duoliCoverage,before.duoliCoverage);assert.equal(after.comparison.complete,false);
}));
test('native facts win once on the same day; other day reports survive and never add to the native day',()=>run(async db=>{
 await h.report(db,'UANG','2026-10-23',100);await h.report(db,'UANG','2026-10-22',200,{auto:180,manual:20});
 const b=h.bundle();b.duoli=b.duoli.map(d=>d.platform==='UANG'&&d.data_date==='2026-10-23'?native('UANG','2026-10-23'):d);
 const before=await h.call(db,h.q(),b);assert.equal(before.rows[0].total,5);assert.equal(before.rows[0].previous,null);await apply(db);const r=await h.call(db,h.q(),b),row=r.rows[0];
 assert.equal(row.total,5);assert.equal(row.autoCount,0);assert.equal(row.manualCount,5);assert.equal(row.countSource,undefined);assert.equal(row.durationBasis,'source_reported_audit_duration');assert.equal(row.previous.total,200);assert.equal(row.previous.countSource,'source_daily_report');assert.equal(row.previous.durationBasis,'source_reported_processing');assert.equal(r.totals.total,5);
}));
test('multi-day rows retain mixed count and duration origin; daily mode chooses source per platform/day',()=>run(async db=>{
 for(const day of ['2026-10-22','2026-10-23'])await h.report(db,'UANG',day,100);
 const b=h.bundle();b.duoli=b.duoli.map(d=>d.platform==='UANG'&&d.data_date==='2026-10-22'?native('UANG','2026-10-22'):d);await apply(db);
 const q=h.q({startAt:'2026-10-22T00:00:00.000Z'}),r=await h.call(db,q,b);assert.equal(r.rows[0].total,105);assert.equal(r.rows[0].countSource,'mixed_native_and_daily_report');assert.equal(r.rows[0].durationBasis,'mixed_source_processing');
 const daily=await h.call(db,{...q,daily:true},b);assert.equal(daily.rows.length,2);assert.equal(daily.rows.find(x=>x.dataDate==='2026-10-22').total,5);assert.equal(daily.rows.find(x=>x.dataDate==='2026-10-23').total,100);assert.equal(daily.totals.total,105);
}));
test('partial creation windows keep daily reports excluded and never turn no data into zero',()=>run(async db=>{
 await h.report(db);const q=h.q({startAt:'2026-10-23T06:00:00.000Z'}),before=await h.call(db,q);await apply(db);const after=await h.call(db,q);assert.deepEqual(after,before);assert.deepEqual(after.rows,[]);
 await db.exec('delete from public.auto_withdraw_daily');assert.deepEqual((await h.call(db)).rows,[]);assert.equal((await h.call(db)).totals.total,undefined);
 await h.report(db,'UANG','2026-10-23',0,{success:0,rejected:0,auto:0,manual:0,avg:null});const zero=await h.call(db);assert.equal(zero.rows[0].total,0);assert.equal(zero.totals.total,0);assert.equal(zero.rows[0].avgSeconds,null);assert.equal(zero.rows[0].complete,false);
}));
test('operator daily reports restore their known original fields without inferring auto/manual classification',()=>run(async db=>{
 await db.query("insert into public.withdraw_operator_daily(data_date,country,platform,account,processed,rejected,avg_seconds,source_updated_at,updated_at) values('2026-10-23','印尼','UANG','SYNTHETIC',10,2,15,now(),now())");
 assert.deepEqual((await h.call(db,h.q({view:'operators'}))).rows,[]);await apply(db);const r=await h.call(db,h.q({view:'operators'})),row=r.rows[0];
 assert.equal(row.processed,10);assert.equal(row.rejected,2);assert.equal(row.avgSeconds,15);assert.equal(row.durationBasis,'source_reported_processing');assert.equal(row.countSource,'source_daily_report');assert.equal(row.autoCount,undefined);assert.equal(row.manualCount,undefined);assert.equal(row.complete,false);
 assert.deepEqual((await h.call(db,h.q({view:'operators',account:'ABSENT'}))).rows,[]);
}));
test('fresh permissions, explicit native filters, paging and missing countries keep original gates',()=>run(async db=>{
 for(const p of ['UANG','FB168'])await h.report(db,p);await apply(db);
 assert.deepEqual((await h.call(db,h.q({platform:'UANG'}))).rows.map(x=>x.platform),['UANG']);assert.deepEqual((await h.call(db,h.q({platforms:['FB168']}))).rows.map(x=>x.platform),['FB168']);assert.deepEqual((await h.call(db,h.q({scopeTargets:[{country:'印尼',platforms:['UANG']}]}))).rows.map(x=>x.platform),['UANG']);
 assert.equal((await h.call(db,h.q({offset:1,limit:20}))).rows.length,1);assert.equal((await h.call(db,h.q({offset:1,limit:20}))).totals.total,200);assert.deepEqual((await h.call(db,h.q({country:'菲律宾'}))).rows,[]);
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({mode:'selected',countries:[],platforms:[{country:'ID',platform:'UANG'}]})]);assert.deepEqual((await h.call(db)).rows.map(x=>x.platform),['UANG']);await db.exec("set test.denied='yes'");await assert.rejects(h.call(db),/denied/);
}));
test('native-only and unrelated report DTOs stay byte-equivalent',()=>run(async db=>{
 const b=h.bundle();b.duoli=b.duoli.map(d=>d.platform==='UANG'?native('UANG',d.data_date):d);await h.report(db,'OTHER');
 const qs=[h.q(),h.q({view:'operators'}),h.q({daily:true}),h.q({platform:'OTHER'}),h.q({sort:'avgSeconds',ascending:true})],before=[];for(const q of qs)before.push(await h.call(db,q,b));await apply(db);for(let i=0;i<qs.length;i++)assert.deepEqual(await h.call(db,qs[i],b),before[i]);
}));
test('explicit zero native day suppresses its positive report without producing missing data',()=>run(async db=>{
 await h.report(db);const b=h.bundle();b.duoli=b.duoli.map(d=>d.platform==='UANG'&&d.data_date==='2026-10-23'?h.day('UANG','2026-10-23',{total:0,success:0,rejected:0,operator_rows:[]}):d);
 const before=await h.call(db,h.q(),b);await apply(db);const after=await h.call(db,h.q(),b);assert.deepEqual(after,before);assert.equal(after.rows[0].total,0);assert.equal(after.rows[0].countSource,undefined);
}));
test('report-only and mixed operator classification remains unknown for the report portion in current and previous rows',()=>run(async db=>{
 await db.exec("insert into public.withdraw_operator_daily(data_date,country,platform,account,processed,rejected,avg_seconds)values('2026-10-23','印尼','UANG','SYNTHETIC',10,2,15),('2026-10-22','印尼','UANG','SYNTHETIC',6,1,12)");await apply(db);
 const pure=await h.call(db,h.q({view:'operators'}));for(const [row,n]of[[pure.rows[0],10],[pure.rows[0].previous,6]]){assert.equal(row.autoCount,undefined);assert.equal(row.manualCount,undefined);assert.equal(row.unclassifiedCount,n);assert.equal(row.operatorClass,'unknown');assert.equal(row.classificationAvailable,false);assert.equal(row.classificationPartial,true);assert.equal(row.durationBasis,'source_reported_processing');}
 assert.equal(pure.totals.unclassifiedCount,10);assert.equal(pure.previousTotals.unclassifiedCount,6);assert.equal(pure.totals.classificationAvailable,false);
 const b=h.bundle();b.duoli=b.duoli.map(d=>d.platform==='UANG'&&d.data_date==='2026-10-22'?native('UANG','2026-10-22'):d);
 const mixed=await h.call(db,h.q({view:'operators',startAt:'2026-10-22T00:00:00Z'}),b),row=mixed.rows[0];assert.equal(row.processed,15);assert.equal(row.manualCount,5);assert.equal(row.autoCount,0);assert.equal(row.unclassifiedCount,10);assert.equal(row.operatorClass,'unknown');assert.equal(row.classificationPartial,true);assert.equal(mixed.totals.unclassifiedCount,10);
}));
test('restored daily report never infers a missing manual count from the known total or turns an unknown total into zero',()=>run(async db=>{
 await h.report(db,'UANG','2026-10-23',100,{manual:null});await apply(db);const r=await h.call(db);assert.equal(r.rows[0].autoCount,70);assert.equal(r.rows[0].manualCount,null);assert.equal(r.rows[0].unclassifiedCount,30);assert.equal(r.totals.unclassifiedCount,30);assert.equal(r.rows[0].classificationAvailable,false);
 await db.exec('update public.auto_withdraw_daily set total=null,auto_count=null,manual_count=null');const u=await h.call(db);assert.equal(u.rows[0].total,null);assert.equal(u.rows[0].manualCount,null);assert.equal(u.rows[0].unclassifiedCount,null);assert.equal(u.totals.unclassifiedCount,null);
}));
test('actual legacy no-version endpoint uses the same restored source and v2 keeps its original single dispatch',()=>run(async db=>{
 const fixture=n=>fs.readFileSync(path.join(__dirname,'fixtures/duoli-daily-fallback',n),'utf8');await db.exec(fixture('actual-private-dashboard_admin_live_auto_withdraw.sql'));
 const call=async q=>(await db.query('select private.dashboard_admin_live_auto_withdraw($1)r',[q])).rows[0].r;
 await h.report(db);await db.exec("insert into public.withdraw_operator_daily(data_date,country,platform,account,processed,rejected,avg_seconds)values('2026-10-23','印尼','UANG','SYNTHETIC',10,2,15),('2026-10-22','印尼','UANG','SYNTHETIC',6,1,12)");assert.deepEqual((await call(h.q())).rows,[]);
 await db.exec(read('dashboard_admin_live_auto_withdraw'));await apply(db);for(const q of[h.q(),h.q({view:'operators'}),h.q({daily:true}),h.q({platform:'UANG'}),h.q({startAt:'2026-10-23T12:00:00Z'})]){const nativeDays=(await db.query("select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb)r from private.dashboard_admin_duoli_withdraw_days($1,private.dashboard_admin_live_scope(),left($1::jsonb->>'startAt',10)::date-(left($1::jsonb->>'endAt',10)::date-left($1::jsonb->>'startAt',10)::date+1),left($1::jsonb->>'endAt',10)::date)d",[q])).rows[0].r;const actual=await call(q),prepared=await h.call(db,q,h.bundle({duoli:nativeDays}));assert.deepEqual(actual,prepared);}
 await db.exec("insert into private.duoli_order_details(platform,business,source_order_id,country,system_name,created_at,status_code,operator,audit_duration_seconds,observed_at,received_at)select 'UANG','withdraw','SYNTHETIC-'||i,'ID','DOLI','2026-10-22T01:00:00+07'::timestamptz,'6','SYNTHETIC',10,now(),now()from generate_series(1,5)i");
 const mixedQ=h.q({view:'operators',startAt:'2026-10-22T00:00:00Z'}),mixed=await call(mixedQ);assert.equal(mixed.rows[0].processed,15);assert.equal(mixed.rows[0].manualCount,5);assert.equal(mixed.rows[0].unclassifiedCount,10);assert.equal(mixed.rows[0].operatorClass,'unknown');assert.equal(mixed.rows[0].classificationPartial,true);
 await db.exec("create or replace function private.withdraw_prepared_read(q jsonb)returns jsonb language sql volatile as $$select jsonb_build_object('singlePreparedDispatch',q)$$");const q={...h.q(),windowVersion:2,successStartAt:'2026-10-22T02:00:00Z',successEndAt:'2026-10-22T04:00:00Z',successBasis:'success'};assert.deepEqual(await call(q),{singlePreparedDispatch:q});
 await db.exec("set test.denied='yes'");await assert.rejects(call(h.q()),/denied/);
}));
test('explicit independent success windows remain separate and unchanged; report fallback supplies only the creation cohort',()=>run(async db=>{
 await h.report(db);const request={...h.q(),windowVersion:2,successStartAt:'2026-10-21T01:00:00Z',successEndAt:'2026-10-21T05:00:00Z',successBasis:'success'},b=h.bundle({secondary:{startAt:request.successStartAt,endAt:request.successEndAt,basis:'success',createdIntersection:false,complete:false,rows:[{platform:'UANG',country:'印尼',count:null,amount:null,state:'unavailable',capability:{available:false}}]}});
 const call=async()=> (await db.query('select private.withdraw_window_result(private.withdraw_prepared_canonical($1),private.withdraw_prepared_render(private.withdraw_window_legacy($1),$2),$2)r',[request,b])).rows[0].r;
 const before=await call();await apply(db);const after=await call();assert.deepEqual(after.windows,before.windows);assert.deepEqual(after.secondary,before.secondary);assert.equal(after.totals.total,100);assert.equal(after.rows[0].statisticBasis,'created_at_current_status');assert.equal(after.secondary.rows[0].count,null);assert.equal(after.secondary.complete,false);
}));
test('existing direct daily bundle precedence retains unknown method fields exactly and never doubles the daily report',()=>run(async db=>{
 await h.report(db);await db.query("insert into public.newar_business_snapshots(country,platform,kind,direction,stat_date,payload,captured_at,updated_at)values('印尼','UANG','auto_withdraw_bundle','all','2026-10-23',$1,now(),now())",[{rows:[{total_count:100,success_count:95,reject_count:5,auto_count:70,manual_count:null,handle_count:0,total_handle_seconds:null}]}]);await apply(db);const r=await h.call(db);assert.equal(r.rows.length,1);assert.equal(r.rows[0].total,100);assert.equal(r.totals.total,100);assert.equal(r.rows[0].manualCount,null);assert.equal(r.rows[0].unclassifiedCount,30);assert.equal(r.rows[0].classificationAvailable,false);assert.equal(r.totals.unclassifiedCount,30);assert.deepEqual((await h.call(db,h.q({startAt:'2026-10-23T12:00:00Z'}))).rows,[]);
}));
