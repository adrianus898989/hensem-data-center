// Real PostgreSQL contract tests using synthetic tickets only; no live order identifiers.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261001104634_workorder_original_known_provider.sql'),'utf8');
const summaryMigration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261001101453_workorder_summary_single_pass.sql'),'utf8');
const harness=fs.readFileSync(path.join(__dirname,'admin-workorder-team-filter.test.cjs'),'utf8').split(/\ntest\(/)[0]
 .replace('let db,baselineDefinitions;','let db,baselineDefinitions,beforeAttribution;')
 .replace(' await db.exec(migration());',` await db.exec(migration());await db.exec(summaryMigration);
 beforeAttribution=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_workorder_analysis(jsonb)'::regprocedure) definition")).rows[0].definition;
 await db.exec(attributionMigration);`);
const api=new Function('require','__dirname','summaryMigration','attributionMigration',harness+';return {query,record,ingest,filters,definitions,db:()=>db,oldDefinition:()=>beforeAttribution};')(require,__dirname,summaryMigration,migration);
const seed=async rows=>{await api.db().exec('delete from ar_workorder_issue_details');await api.ingest(rows.map(([id,x])=>api.record(id,x)));};
const compare=async request=>{const after=await api.query(request);await api.db().exec(api.oldDefinition());const before=await api.query(request);await api.db().exec(migration);return {before,after};};
const header=r=>Object.fromEntries(Object.entries(r).filter(([k])=>k!=='byProvider'));
const originalKeys=new Set(['uniqueOrderCount','uniqueOrderAmount','uniqueProcessedCount','uniqueProcessedAmount','coverage']);
const tickets=r=>r.byProvider.filter(p=>p.ticketCount>0).map(p=>Object.fromEntries(Object.entries(p).filter(([k])=>!originalKeys.has(k)))).sort((a,b)=>(a.issueKind+a.provider).localeCompare(b.issueKind+b.provider));
const provider=(r,name,kind='deposit')=>r.byProvider.find(p=>p.provider===name&&p.issueKind===kind);

test('one known provider plus unknown tickets resolves three synthetic originals without changing raw or global metrics',async()=>{
 await seed([
  ['INTERNET-KNOWN',{payment_order_no:'O-1',third_party:'InternetPay',amount:'10000',status_code:3}],
  ['INTERNET-UNKNOWN1',{payment_order_no:'O-1',third_party:'未标记三方',amount:'10000',status_code:3}],
  ['INTERNET-UNKNOWN2',{payment_order_no:'O-1',third_party:'未标记三方',amount:'10000',status_code:4}],
  ['WP-KNOWN',{payment_order_no:'O-2',third_party:'WPay',amount:'148',status_code:3}],
  ['WP-UNKNOWN',{payment_order_no:'O-2',third_party:'未标记三方',amount:'148',status_code:3}],
  ['SP-KNOWN',{payment_order_no:'O-3',third_party:'SUPER',amount:'100',status_code:4}],
  ...Array.from({length:4},(_,i)=>['SP-UNKNOWN'+i,{payment_order_no:'O-3',third_party:'未标记三方',amount:'100',status_code:3}]),
  ['ALL-UNKNOWN',{payment_order_no:'O-4',third_party:'未标记三方',amount:'20400',status_code:3}],
 ]);
 const {before,after}=await compare();assert.deepEqual(header(after),header(before));assert.deepEqual(tickets(after),tickets(before));
 assert.equal(provider(before,'三方归属待核对').uniqueOrderCount,3);assert.equal(provider(before,'三方归属待核对').uniqueOrderAmount,'10248.00000000');
 assert(!provider(after,'三方归属待核对'));assert.equal(after.current.uniqueOrderCount,4);assert.equal(after.current.uniqueOrderAmount,'30648.00000000');
 for(const [name,amount] of [['InternetPay','10000.00000000'],['WPay','148.00000000'],['SUPER','100.00000000']]){
  assert.equal(provider(after,name).uniqueOrderCount,1);assert.equal(provider(after,name).uniqueOrderAmount,amount);
 }
 assert.equal(provider(after,'InternetPay').uniqueProcessedCount,1,'unknown ticket retains processed evidence for same original');
 assert.equal(provider(after,'未标记三方').uniqueOrderCount,1);assert.equal(provider(after,'未标记三方').ticketCount,8);
});

test('two genuinely known providers stay conflicted even with unknown labels',async()=>{
 await seed([
  ['A',{payment_order_no:'REAL-CONFLICT',third_party:'APay',amount:'50'}],
  ['B',{payment_order_no:'REAL-CONFLICT',third_party:'BPay',amount:'50'}],
  ['U',{payment_order_no:'REAL-CONFLICT',third_party:'unknown',amount:'50'}],
 ]);
 const {before,after}=await compare();assert.deepEqual(after,before);assert.equal(provider(after,'三方归属待核对').uniqueOrderCount,1);
});

test('all unknown spellings remain unknown, with no invented known provider or false conflict',async()=>{
 const unknowns=[null,'未填写三方','未标记三方','未识别三方','未识别通道','未分类三方','未提供','Un_Known','UN-MARKED'];
 await seed(unknowns.map((name,i)=>['U'+i,{payment_order_no:'ALL-UNKNOWN',third_party:name,amount:'99'}]));
 const {before,after}=await compare();assert.deepEqual(header(after),header(before));assert.deepEqual(tickets(after),tickets(before));
 assert(!provider(after,'三方归属待核对'));assert.equal(provider(after,'未标记三方').uniqueOrderCount,1);
 assert.equal(after.byProvider.reduce((n,p)=>n+(p.uniqueOrderCount||0),0),1);
 await seed([['ONLY-NULL',{payment_order_no:'NULL-ONLY',third_party:null,amount:'3'}]]);
 assert.equal(provider(await api.query(),'未填写三方').uniqueOrderCount,1,'single existing placeholder label remains stable');
});

test('known attribution remains scoped to platform, direction, current range and applied filters',async()=>{
 await seed([
  ['A-UNKNOWN',{platform:'A',payment_order_no:'SAME',third_party:'unknown',amount:'10'}],
  ['B-KNOWN',{platform:'B',payment_order_no:'SAME',third_party:'KnownPay',amount:'10'}],
  ['A-WITHDRAW',{platform:'A',payment_order_no:'SAME',third_party:'KnownPay',issue_kind:'withdraw',amount:'10'}],
  ['A-PREVIOUS',{platform:'A',payment_order_no:'SAME',third_party:'KnownPay',amount:'10',submitted_date:'2026-09-25',submitted_at:'2026-09-25T00:00:00Z'}],
 ]);
 let r=await api.query();assert.equal(provider(r,'unknown').uniqueOrderCount,1);assert.equal(provider(r,'KnownPay').uniqueOrderCount,1);assert.equal(provider(r,'KnownPay','withdraw').uniqueOrderCount,1);
 r=await api.query({filters:api.filters({team:'M8',issueKind:'deposit'})});assert.equal(r.current.uniqueOrderCount,1);assert.equal(provider(r,'unknown').uniqueOrderCount,1);assert(!provider(r,'KnownPay'));
 await seed([['K',{payment_order_no:'FILTERED',third_party:'KnownPay',status_code:4}],['U',{payment_order_no:'FILTERED',third_party:'unknown',status_code:3}]]);
 r=await api.query({filters:api.filters({statusCode:'3'})});assert.equal(provider(r,'unknown').uniqueOrderCount,1,'cannot borrow known rows outside selected filters');
});

test('amount conflicts, missing amounts and missing original references preserve financial uncertainty',async()=>{
 await seed([
  ['CONFLICT-K',{payment_order_no:'C',third_party:'KnownPay',amount:'100'}],['CONFLICT-U',{payment_order_no:'C',third_party:'unknown',amount:'200'}],
  ['NULL-K',{payment_order_no:'N',third_party:'KnownPay',amount:null}],['NULL-U',{payment_order_no:'N',third_party:'unknown',amount:null}],
  ['MIX-K',{payment_order_no:'M',third_party:'KnownPay',amount:null}],['MIX-U',{payment_order_no:'M',third_party:'unknown',amount:'300',status_code:4}],
  ['NO-ID',{payment_order_no:null,third_party:'KnownPay',amount:'70'}],
 ]);
 const {before,after}=await compare();assert.deepEqual(header(after),header(before));assert.deepEqual(tickets(after),tickets(before));
 const p=provider(after,'KnownPay');assert.equal(p.uniqueOrderCount,3);assert.equal(p.uniqueOrderAmount,null);assert.equal(p.uniqueProcessedAmount,'300.00000000');
 assert.equal(p.coverage.amountConflictCount,1);assert.equal(p.coverage.missingAmountCount,1);
});

test('record, original list and exact original drawer responses remain byte-for-byte equivalent JSON',async()=>{
 for(const request of [{view:'records',operation:'list'},{view:'orders',operation:'list'},
  {view:'orders',operation:'orderDetail',filters:{platform:'A',issueKind:'deposit',orderNo:'M'}}]){
  const {before,after}=await compare(request);assert.deepEqual(after,before);
 }
});

test('one grouped scan is retained for large distinct original sets',async()=>{
 await api.db().exec('delete from ar_workorder_issue_details');
 await api.db().exec(`insert into ar_workorder_issue_details(system_name,country_code,country,platform,work_order_id,issue_kind,observed_at,query_date,schema_version,query_basis,field_gaps,submitted_date,submitted_at,work_order_no,payment_order_no,amount,status_code,third_party,channel_type)
 select 'AR','IN','印度','A','PERF-'||n,'deposit',now(),'2026-09-26',2,'submission','{}','2026-09-26','2026-09-26T00:00:00Z','WO-'||n,'ORDER-'||((n-1)/2),100,3,case when n%2=0 then 'unknown' else 'KnownPay' end,'BANK' from generate_series(1,12000) n;analyze ar_workorder_issue_details;`);
 const started=performance.now(),r=await api.query(),elapsed=performance.now()-started;
 assert.equal(r.current.ticketCount,12000);assert.equal(r.current.uniqueOrderCount,6000);assert.equal(provider(r,'KnownPay').uniqueOrderCount,6000);assert(!provider(r,'三方归属待核对'));
 const definition=(await api.definitions()).find(r=>r.definition.includes('workorder_analysis(')).definition;
 const section=definition.slice(definition.indexOf(' ), analysis_provider_originals_v1 as ('),definition.indexOf(' ), analysis_provider_tickets_v1 as ('));
 assert.match(section,/WORKORDER_SUMMARY_SINGLE_PASS_V2/);assert.doesNotMatch(section.replace(/--[^\n]*/g,''),/\bjoin\b/i);
 assert(elapsed<10000,'unexpected large single-pass summary regression: '+elapsed+'ms');
});

test('authorization, migration guards and replay preserve the reviewed RPC security contract',async()=>{
 const originalDefinitions=await api.definitions();await api.db().exec(migration);assert.deepEqual(await api.definitions(),originalDefinitions);
 assert.equal(originalDefinitions.find(r=>r.definition.includes('workorder_analysis(')).hash,'57937cdc782d6186b976ee1beebc84bc');
 await api.db().exec(`update dashboard_profiles set data_scope='{"countries":["IN"],"platforms":["B"]}'`);
 try{assert.equal((await api.query({filters:api.filters({platform:'A'})})).current.ticketCount,0);await api.db().exec('update dashboard_profiles set active=false');await assert.rejects(()=>api.query(),/preview_denied/);}
 finally{await api.db().exec(`update dashboard_profiles set active=true,data_scope='{"all":true}'`);}
 const transactional=migration.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
 await api.db().exec('begin');try{await api.db().exec('grant execute on function private.dashboard_admin_live_workorder_analysis(jsonb) to anon');await assert.rejects(()=>api.db().exec(transactional),/ACL changed/);}finally{await api.db().exec('rollback');}
 await api.db().exec('begin');try{await api.db().exec("create or replace function private.dashboard_admin_live_workorder_analysis(p_query jsonb) returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='20s' as $$begin return p_query;end$$");await assert.rejects(()=>api.db().exec(transactional),/baseline changed/);}finally{await api.db().exec('rollback');}
});
