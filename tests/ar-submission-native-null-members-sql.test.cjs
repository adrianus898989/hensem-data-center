// Exact reviewed SQL is compared in an offline PostgreSQL instance.
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const patch=read('supabase/migrations/20261011065859_ar_submission_native_null_members.sql');
const baseline=read('tests/fixtures/ar-submission-native-null-production.sql');
let setup,db,f,seed,receipts,yash,metadata;
const context=vm.createContext({__dirname,require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,beforeEach(){},after(){}}:require(n)});
vm.runInContext(read('tests/submission-shared-aggregation-single-pass-sql.test.cjs').split(/\ntest\(/)[0]+'\nglobalThis.fixture={get db(){return db},get f(){return f},seed,receipts,get yash(){return yash}};',context);
const info=async()=>(await db.query("select md5(prosrc) hash,to_jsonb(p)-'prosrc' metadata,pg_get_functiondef(oid) definition from pg_proc p where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure")).rows[0];
const q=extra=>f.request({startAt:'2026-10-02T00:00:00+05:30',endAt:'2026-10-03T00:00:00+05:30',...extra});
const call=async extra=>{const r=await f.call(q(extra));delete r.asOf;return r};
async function compare(requests){await db.exec(baseline);const old=[];for(const r of requests)old.push(await call(r));await db.exec(patch);for(let i=0;i<requests.length;i++)assert.deepEqual(await call(requests[i]),old[i]);return old;}
before(async()=>{await setup();({db,f,seed,receipts,yash}=context.fixture);await db.exec(read('supabase/migrations/20261010100701_submission_shared_aggregation_single_pass.sql'));await db.exec('alter table ar_collected_orders alter column money_format_version type smallint');await db.exec(read('tests/fixtures/ar-submission-native-null-amount-helper.sql'));await db.exec(baseline);metadata=(await info()).metadata;assert.equal((await info()).hash,'ab63c0ce48fe0ab393b4d5e6ef8a4d83');});
beforeEach(async()=>{await f.as(f.owner);await db.exec(baseline);await db.exec('truncate ar_collected_orders,newar_detail_records,lg_orders,game66_charge_orders,private.yash_orders,private.yash_sync_windows');});
after(async()=>db?.close());

test('whole-day cross-provider qualification, clock subsets and all three operations remain identical',async()=>{
 await seed('ar','VALID');await seed('ar','OTHER');const qs=[];
 for(const operation of ['summary','members','memberOrders'])for(const subset of [{},{providers:['CombinedPay']},{providers:['Other Pay'],startAt:'2026-10-02T10:00:01+05:30',endAt:'2026-10-02T10:00:08+05:30'}])qs.push({operation,...subset,...(operation==='memberOrders'?{memberId:'VALID',day:'2026-10-02',limit:20,offset:1}:{})});
 const r=await compare(qs);assert.equal(r[8].total,4);assert.equal(r[8].rows.length,3);
});
test('a native NULL-time row on any provider still blocks that member, without tainting unrelated members',async()=>{
 for(const m of ['VALID','UNDATED','UNKNOWN','BLANK'])await seed('ar',m);
 await db.exec(`update ar_collected_orders set applied_at=null,raw_channel='Unselected provider' where order_no='UNDATED-20';
 update ar_collected_orders set status='unknown' where order_no='UNKNOWN-19';
 update ar_collected_orders set member_id='   ' where order_no='BLANK-20';
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel) values
 ('AR','IN','OTHER-PLATFORM','recharge','FOREIGN-NULL','VALID',1,'unknown',null,'Unselected provider'),
 ('AR','PK','AR-RAW','recharge','FOREIGN-COUNTRY','VALID',1,'unknown',null,'Unselected provider'),
 ('AR','IN','AR-RAW','withdraw','FOREIGN-DIRECTION','VALID',1,'unknown',null,'Unselected provider'),
 ('OTHER','IN','AR-RAW','recharge','FOREIGN-SOURCE','VALID',1,'unknown',null,'Unselected provider');`);
 const qs=[{charts:false},...['VALID','UNDATED','UNKNOWN'].map(memberId=>({operation:'memberOrders',memberId,day:'2026-10-02',providers:['CombinedPay']}))];const r=await compare(qs);
 assert.equal(r[1].total,10);assert.equal(r[2].total,0);assert.equal(r[3].total,0);assert(r[0].coverage.orderSequenceUncertainCount>0);assert(r[0].coverage.unknownStatusCount>0);assert(r[0].coverage.missingMemberCount>0);
});
test('prior-day and later-paid exclusions, local midnight boundaries and single selected order stay exact',async()=>{
 for(const m of ['VALID','PRIOR','LATER'])await seed('ar',m);
 await db.exec(`update ar_collected_orders set status='已支付',completed_at='2026-10-03 01:00' where order_no='LATER-20';
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,completed_at,raw_channel) values
 ('AR','IN','AR-RAW','recharge','PRIOR-SUCCESS','PRIOR',1,'已支付','2026-10-01 10:00','2026-10-02 14:00','Other Pay');`);
 const r=await compare([{charts:false},...['VALID','PRIOR','LATER'].map(memberId=>({operation:'memberOrders',memberId,day:'2026-10-02',providers:['CombinedPay']})),{startAt:'2026-10-01T00:00:00+05:30',endAt:'2026-10-02T00:00:00+05:30'},{operation:'memberOrders',memberId:'VALID',day:'2026-10-02',startAt:'2026-10-02T10:00:01+05:30',endAt:'2026-10-02T10:00:02+05:30'}]);
 assert.equal(r[1].total,10);assert.equal(r[2].total,0);assert.equal(r[3].total,0);assert.equal(r[4].coverage.orderCount,1);assert.equal(r[5].total,1);
});
test('strict thresholds and native money including zero, invalid currency and stale values are unchanged',async()=>{
 await seed('ar','MONEY',16);await seed('ar','EXACT',15);
 await db.exec(`update ar_collected_orders set money_format_version=1,amount_local=0,currency_local='INR' where order_no='MONEY-1';
 update ar_collected_orders set money_format_version=1,amount_local=123.45678901,currency_local='INR' where order_no='MONEY-2';
 update ar_collected_orders set money_format_version=1,amount_local=1,currency_local='USD' where order_no='MONEY-3';
 update ar_collected_orders set money_issue_code='LOCAL_AMOUNT_STALE_FOR_USDT' where order_no='MONEY-4';`);
 const r=await compare([{operation:'memberOrders',memberId:'MONEY',day:'2026-10-02',limit:100},{operation:'members'},{charts:false}]);
 assert.deepEqual(r[0].rows.slice(0,4).map(x=>x.amount),['0','123.45678901',null,null]);assert.equal(r[1].total,1);
});
test('NEWAR, LG, GAME66 and YASH do not enter the AR-only rewrite',async()=>{
 for(const kind of ['newar','lg','game','yash'])await seed(kind,'VALID');await receipts();const qs=[];
 for(const [platformId,zone]of [[f.ids.newar,'+05:45'],[f.ids.lg,'+08:00'],[f.ids.game,'+05:30'],[yash,'+05:30']])for(const operation of ['summary','members','memberOrders'])qs.push({platformId,startAt:'2026-10-02T00:00:00'+zone,endAt:'2026-10-03T00:00:00'+zone,operation,...(operation==='memberOrders'?{memberId:'VALID',day:'2026-10-02'}:{})});
 await compare(qs);
});
test('metadata and all settings/ACL remain exact, replay is stable and hidden-platform access still fails',async()=>{
 await db.exec(patch);const next=await info();assert.equal(next.hash,'325c95878225f211b91aed89c7abae86');assert.deepEqual(next.metadata,metadata);await db.exec(patch);assert.deepEqual(await info(),next);
 await f.as(f.viewer);await assert.rejects(()=>call({platformId:f.ids.hidden}),/platform_denied/);await f.as(f.owner);
});
test('unreviewed definition, configuration or ACL changes fail before mutation',async()=>{
 for(const sql of ["alter function private.dashboard_admin_live_submission_analysis(jsonb) set jit=on","grant execute on function private.dashboard_admin_live_submission_analysis(jsonb) to anon","grant execute on function private.dashboard_admin_live_submission_analysis(jsonb) to public","grant execute on function private.dashboard_admin_live_submission_analysis(jsonb) to authenticated with grant option",baseline.replace('begin\n','begin\n -- drift\n')]){
  await db.exec('begin');await db.exec(sql);await assert.rejects(()=>db.exec(patch),/definition_drift|acl_drift/);await db.exec('rollback');assert.equal((await info()).hash,'ab63c0ce48fe0ab393b4d5e6ef8a4d83');assert.deepEqual((await info()).metadata,metadata);
 }
});
