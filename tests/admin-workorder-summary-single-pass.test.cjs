// PostgreSQL contract/performance regression, using synthetic tickets and real SQL migrations.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const summaryMigration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261001101453_workorder_summary_single_pass.sql'),'utf8');
const inTransaction=summaryMigration.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
const harness=fs.readFileSync(path.join(__dirname,'admin-workorder-team-filter.test.cjs'),'utf8').split(/\ntest\(/)[0]
 .replace('let db,baselineDefinitions;','let db,baselineDefinitions,beforeSummaryDefinition;')
 .replace(' await db.exec(migration());',` await db.exec(migration());
 beforeSummaryDefinition=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_workorder_analysis(jsonb)'::regprocedure) definition")).rows[0].definition;
 await db.exec(summaryMigration);`);
const api=new Function('require','__dirname','summaryMigration',harness+';return {query,record,ingest,filters,definitions,db:()=>db,oldDefinition:()=>beforeSummaryDefinition};')(require,__dirname,summaryMigration);
const added=['unprocessedTicketCount','unprocessedTicketAmount','uniqueUnprocessedCount','uniqueUnprocessedAmount'];
const linkage=['kycYesCount','kycNoCount','kycUnknownCount','utrYesCount','utrNoCount','utrUnknownCount'];
const strip=v=>Array.isArray(v)?v.map(strip):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!added.includes(k)).map(([k,x])=>[k,k==='changes'?Object.fromEntries(Object.entries(strip(x)).filter(([key])=>!linkage.includes(key))):strip(x)])):v;
const q=filters=>api.query({filters:api.filters(filters)});
const seed=async rows=>{await api.db().exec('delete from ar_workorder_issue_details');await api.ingest(rows.map(([id,x])=>api.record(id,x)));};

test('every existing summary, provider breakdown, list and exact original response is unchanged',async()=>{
 const requests=[{}, {filters:api.filters({team:'M8'})},{filters:api.filters({platform:'A',provider:'APay'})},
  {filters:api.filters({dateBasis:'operation'})},{filters:{platform:'A',orderNo:'SAME'}},
  {view:'orders',operation:'list'},{view:'orders',operation:'list',limit:20,offset:20},
  {view:'orders',operation:'orderDetail',filters:{platform:'A',orderNo:'SAME',issueKind:'deposit'}},
  {view:'records',operation:'list'}];
 const after=[];for(const request of requests)after.push(await api.query(request));
 await api.db().exec(api.oldDefinition());const before=[];for(const request of requests)before.push(await api.query(request));
 await api.db().exec(summaryMigration);assert.deepEqual(after.map(strip),before);
});

test('not-processed metrics include every non-4 status and close raw/unique totals without double counting',async()=>{
 await seed([
  ['DUP-REJECTED',{payment_order_no:'R1',amount:'100',status_code:3,kyc_connected:true,utr_matched:false}],
  ['DUP-PROCESSED',{payment_order_no:'R1',amount:'100',status_code:4,kyc_connected:false,utr_matched:true}],
  ['PENDING',{payment_order_no:'R2',amount:'200',status_code:1}],
  ['PROCESSING',{payment_order_no:'R3',amount:'300',status_code:2}],
  ['SYSTEM',{payment_order_no:'R4',amount:'400',status_code:5}],
  ['UNKNOWN',{payment_order_no:'R5',amount:'500',status_code:null}],
  ['OLD-PROCESSED',{amount:'50',status_code:4,submitted_date:'2026-09-25',submitted_at:'2026-09-25T00:00:00Z'}],
  ['OLD-REJECTED',{amount:'100',status_code:3,submitted_date:'2026-09-25',submitted_at:'2026-09-25T00:00:00Z'}],
 ]);
 const r=await q({platform:'A'}),c=r.current;
 assert.equal(c.ticketCount,6);assert.equal(c.ticketAmount,'1600.00000000');
 assert.equal(c.processedTicketCount,1);assert.equal(c.processedTicketAmount,'100.00000000');
 assert.equal(c.unprocessedTicketCount,5);assert.equal(c.unprocessedTicketAmount,'1500.00000000');
 assert.equal(c.uniqueOrderCount,5);assert.equal(c.uniqueOrderAmount,'1500.00000000');
 assert.equal(c.uniqueProcessedCount,1);assert.equal(c.uniqueProcessedAmount,'100.00000000');
 assert.equal(c.uniqueUnprocessedCount,4);assert.equal(c.uniqueUnprocessedAmount,'1400.00000000');
 assert.equal(c.ticketCount,c.processedTicketCount+c.unprocessedTicketCount);
 assert.equal(c.uniqueOrderCount,c.uniqueProcessedCount+c.uniqueUnprocessedCount);
 assert.equal(r.previous.unprocessedTicketCount,1);assert.equal(r.previous.uniqueUnprocessedAmount,'100.00000000');
 assert.deepEqual(r.changes.unprocessedTicketCount,{delta:'4',percent:'400.00',previous:1});
 assert.equal(r.changes.uniqueUnprocessedCount.percent,'300.00');assert.equal(r.changes.uniqueUnprocessedAmount.percent,'1300.00');
 for(const key of linkage){assert(key in r.changes);assert.equal(r.changes[key].previous,r.previous[key]);}
 assert.deepEqual([c.kycYesCount,c.kycNoCount,c.kycUnknownCount],[1,1,4]);
 assert.deepEqual([c.utrYesCount,c.utrNoCount,c.utrUnknownCount],[1,1,4]);
});

test('unknown status originals count as not processed; amount uncertainty affects only its subset',async()=>{
 await seed([
  ['DONE',{amount:null,status_code:4,payment_order_no:'DONE'}],
  ['UNDONE',{amount:'200',status_code:null,payment_order_no:'UNKNOWN'}],
 ]);
 let c=(await q({platform:'A'})).current;
 assert.equal(c.ticketAmount,null);assert.equal(c.processedTicketAmount,null);assert.equal(c.unprocessedTicketAmount,'200.00000000');
 assert.equal(c.uniqueOrderAmount,null);assert.equal(c.uniqueProcessedAmount,null);assert.equal(c.uniqueUnprocessedAmount,'200.00000000');assert.equal(c.uniqueUnprocessedCount,1);
 await seed([['DONE',{amount:'100',status_code:4}],['UNDONE',{amount:null,status_code:3}]]);
 c=(await q({platform:'A'})).current;assert.equal(c.processedTicketAmount,'100.00000000');assert.equal(c.unprocessedTicketAmount,null);
 assert.equal(c.uniqueProcessedAmount,'100.00000000');assert.equal(c.uniqueUnprocessedAmount,null);
});

test('missing references never become fake unique orders and empty cohorts have known zero subsets',async()=>{
 await seed([['MISSING',{payment_order_no:null,amount:'100',status_code:3}]]);
 let c=(await q({platform:'A'})).current;assert.equal(c.ticketCount,1);assert.equal(c.unprocessedTicketCount,1);
 assert.equal(c.uniqueOrderCount,null);assert.equal(c.uniqueUnprocessedCount,null);assert.equal(c.uniqueUnprocessedAmount,null);
 c=(await q({platform:'A',from:'2026-09-01',to:'2026-09-01'})).current;
 for(const key of added)assert.equal(c[key],key.endsWith('Amount')?'0':0);
});

test('provider conflicts, mixed null amounts, source aliases and cross-direction identities retain exact legacy results',async()=>{
 await seed([
  ['ONE-A',{payment_order_no:'SHARED',third_party:'P1',amount:'100',status_code:3}],
  ['ONE-B',{payment_order_no:'SHARED',third_party:'P2',amount:'100',status_code:4}],
  ['ONE-W',{payment_order_no:'SHARED',third_party:'P1',amount:'200',issue_kind:'withdraw'}],
  ['AMOUNT-A',{payment_order_no:'CONFLICT',third_party:'P1',amount:'100'}],
  ['AMOUNT-B',{payment_order_no:'CONFLICT',third_party:'P1',amount:'200'}],
  ['NULL-AMOUNT',{payment_order_no:'NULL-MIX',third_party:'P1',amount:null}],
  ['KNOWN-AMOUNT',{payment_order_no:'NULL-MIX',third_party:'P1',amount:'300'}],
  ['ALIAS-A',{platform:'RAJA',payment_order_no:'ALIAS',third_party:'P3',amount:'400'}],
  ['ALIAS-B',{platform:'RAJALOTTERY',payment_order_no:'ALIAS',third_party:'P3',amount:'400'}],
  ['OTHER-PLATFORM',{platform:'B',payment_order_no:'SHARED',third_party:'P2',amount:'500'}],
  ['MISSING',{payment_order_no:null,third_party:'Missing',amount:'50'}],
 ]);
 const after=await api.query();await api.db().exec(api.oldDefinition());const before=await api.query();await api.db().exec(summaryMigration);
 assert.deepEqual(strip(after),before);assert.equal(after.byProvider.find(r=>r.provider==='三方归属待核对').uniqueOrderCount,1);
 assert.equal(after.current.uniqueOrderCount,6);assert.equal(after.current.uniqueUnprocessedCount,5);
 assert.equal(after.current.uniqueUnprocessedAmount,null);
});

test('comparison retains zero-baseline and full-history semantics for new subset fields',async()=>{
 await seed([['ONLY',{amount:'10',status_code:3}]]);
 const r=await q({platform:'A'});for(const key of added){assert.equal(r.changes[key].percent,null);assert.equal(r.changes[key].previous,key.endsWith('Amount')?'0':0);}
 const exact=await api.query({filters:{platform:'A',orderNo:'RC20260926-ONLY'}});assert.equal(exact.allHistory,true);assert.equal(exact.comparison,null);assert.equal(exact.previous,null);assert(!('changes' in exact));
});

test('blank provider grouping stays non-null and invalid financial values remain rejected by storage',async()=>{
 await seed([
  ['NULL-PROVIDER',{payment_order_no:'BLANK',third_party:null,amount:'100'}],
  ['EMPTY-PROVIDER',{payment_order_no:'BLANK',third_party:null,amount:'100'}],
  ['MIXED-BLANK',{payment_order_no:'MIXED',third_party:null,amount:'200'}],
  ['MIXED-KNOWN',{payment_order_no:'MIXED',third_party:'KnownPay',amount:'200'}],
 ]);
 const after=await api.query();await api.db().exec(api.oldDefinition());const before=await api.query();await api.db().exec(summaryMigration);
 assert.deepEqual(strip(after),before);
 assert.equal(after.byProvider.find(r=>r.provider==='未填写三方').uniqueOrderCount,1);
 assert.equal(after.byProvider.find(r=>r.provider==='三方归属待核对').uniqueOrderCount,1);
 for(const value of ['-1','NaN','Infinity','-Infinity']){
  await assert.rejects(()=>api.db().exec(`update ar_workorder_issue_details set amount='${value}'::numeric`));
 }
 assert.deepEqual((await api.query()).byProvider,after.byProvider);
});

test('authorization, team selection and actor denial retain the same protected entrypoint',async()=>{
 await seed([['A',{platform:'A',amount:'100'}],['B',{platform:'B',amount:'500'}]]);
 const m8=await q({team:'M8'});assert.equal(m8.current.ticketCount,1);assert.equal(m8.current.unprocessedTicketAmount,'100.00000000');
 await api.db().exec(`update dashboard_profiles set data_scope='{"countries":["IN"],"platforms":["B"]}'`);
 try{const hidden=await q({team:'M8'});assert.equal(hidden.current.ticketCount,0);assert.equal(hidden.current.uniqueUnprocessedCount,0);
  await api.db().exec('update dashboard_profiles set active=false');await assert.rejects(()=>api.query(),/preview_denied/);
 }finally{await api.db().exec(`update dashboard_profiles set active=true,data_scope='{"all":true}'`);}
});

test('single-pass provider aggregation avoids the original-to-original nested-loop regression',async()=>{
 // Enough distinct references to make the old quadratic join material. No live data.
 await api.db().exec('delete from ar_workorder_issue_details');
 await api.db().exec(`insert into ar_workorder_issue_details(system_name,country_code,country,platform,work_order_id,issue_kind,observed_at,query_date,schema_version,query_basis,field_gaps,submitted_date,submitted_at,work_order_no,payment_order_no,amount,status_code,third_party,channel_type)
  select 'AR','IN','印度',case when n%2=0 then 'A' else 'B' end,'PERF-'||n,'deposit',now(),'2026-09-26',2,'submission','{}','2026-09-26','2026-09-26T00:00:00Z','WO-'||n,'ORDER-'||(n/2),100,case when n%3=0 then 4 else 3 end,'Pay-'||(n%10),'BANK' from generate_series(1,12000) n;analyze ar_workorder_issue_details;`);
 const started=performance.now(),r=await api.query(),elapsed=performance.now()-started;
 assert.equal(r.current.ticketCount,12000);assert.equal(r.current.uniqueOrderCount,12000);
 assert.equal(r.byProvider.reduce((n,p)=>n+p.ticketCount,0),12000);assert.equal(r.byProvider.reduce((n,p)=>n+(p.uniqueOrderCount||0),0),12000);
 const definition=(await api.definitions()).find(r=>r.definition.includes('workorder_analysis(')).definition;
 const section=definition.slice(definition.indexOf(' ), analysis_provider_originals_v1 as ('),definition.indexOf(' ), analysis_provider_tickets_v1 as ('));
 assert.match(section,/WORKORDER_SUMMARY_SINGLE_PASS_V2/);assert.doesNotMatch(section.replace(/--[^\n]*/g,''),/\bjoin\b/i);assert.match(section,/from analysis_provider_details_v1 where original_order_no is not null/);
 assert(elapsed<10000,'synthetic summary exceeded the broad 10s regression bound: '+elapsed+'ms');
});

test('migration replay preserves execution metadata and grants; drift is rejected',async()=>{
 const before=await api.definitions();await api.db().exec(summaryMigration);assert.deepEqual(await api.definitions(),before);
 await api.db().exec('begin');try{await api.db().exec('grant execute on function private.dashboard_admin_live_workorder_analysis(jsonb) to anon');await assert.rejects(()=>api.db().exec(inTransaction),/ACL changed/);}finally{await api.db().exec('rollback');}
 await api.db().exec('begin');try{await api.db().exec("create or replace function private.dashboard_admin_live_workorder_analysis(p_query jsonb) returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='20s' as $$begin return p_query;end$$");await assert.rejects(()=>api.db().exec(inTransaction),/baseline changed/);}finally{await api.db().exec('rollback');}
});
