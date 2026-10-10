// Synthetic PostgreSQL fixtures exercise the production scoped reader and guarded migration.
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20261010071932_submission_member_order_details.sql');
const reader=read('tests/fixtures/submission-member-orders-reader.sql'),gateway=read('tests/fixtures/submission-member-orders-gateway.sql');
const fixtureSource=read('tests/admin-submission-analysis-sql.test.cjs').split(/\ntest\(/)[0];
let setup,db,f,metadata;
const context=vm.createContext({__dirname,require:name=>name==='node:test'?{test(){},before:fn=>{setup=fn},after(){}}:require(name)});
vm.runInContext(fixtureSource+'\nglobalThis.fixture={get db(){return db},call,request,as,ids,owner,viewer};',context);
const q=extra=>f.request({startAt:'2026-10-05T00:00:00+05:30',endAt:'2026-10-06T00:00:00+05:30',currency:'INR',...extra});
const call=extra=>f.call(q(extra)),detail=extra=>call({operation:'memberOrders',memberId:'MEMBER',day:'2026-10-05',...extra});
const meta=async()=>(await db.query(`select oid::regprocedure::text signature,proacl::text,proconfig,proowner,prosecdef,provolatile
 from pg_proc where oid in ('private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure,'public.dashboard_admin_execute(text,jsonb)'::regprocedure) order by 1`)).rows;
async function seed(member='MEMBER',n=25,day='2026-10-05'){
 await db.query(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel,member_level,recharge_count)
 select 'AR','IN','AR-RAW','recharge',$1||'-'||$3||'-'||lpad(i::text,3,'0'),$1,case when i%3=0 then 0 when i%2=0 then 200 else 100 end,
 '待支付',$3::date+time '10:00'+i*interval '1 second',case when i%2=0 then 'route-a' else 'Other Pay' end,'L2',7
 from generate_series(1,$2::int)i`,[member,n,day]);
}
before(async()=>{
 await setup();f=context.fixture;db=f.db;
 await db.exec(`alter table ar_collected_orders add column if not exists channel_type text,add column if not exists money_format_version integer,
 add column if not exists amount_local numeric,add column if not exists currency_local text,add column if not exists money_issue_code text;
 create function private.dashboard_admin_ar_local_amount(text,text,text,integer,numeric,text,text,numeric) returns numeric language sql immutable as $$select coalesce($5,$8)$$;`);
 await db.exec(reader);await db.exec(gateway);await db.exec('revoke all on function public.dashboard_admin_execute(text,jsonb) from public;grant execute on function public.dashboard_admin_execute(text,jsonb) to authenticated;');metadata=await meta();
});
beforeEach(async()=>{await f.as(f.owner);await db.exec('truncate ar_collected_orders,newar_detail_records,lg_orders,game66_charge_orders');await db.exec(reader);await db.exec(gateway);await db.exec(migration);});
after(async()=>db?.close());
test('detail list and full-scope amount groups reconcile with parent counts, amount and local-day timestamps',async()=>{
 await seed();const parent=(await call({operation:'members'})).rows[0],r=await detail({limit:20});
 assert.equal(parent.member_level,'L2');assert.equal(parent.recharge_count,7);assert.equal(r.total,parent.invalid_count);assert.equal(r.rows.length,20);assert.equal(r.hasMore,true);assert.equal(r.offset,0);assert.equal(r.limit,20);assert.equal(r.memberId,'MEMBER');assert.equal(r.day,'2026-10-05');
 assert.equal(r.amountGroups.reduce((n,g)=>n+g.count,0),parent.invalid_count);assert.equal(r.amountGroups.reduce((n,g)=>n+Number(g.total_amount),0),Number(parent.invalid_amount));assert.deepEqual(r.amountGroups.map(g=>g.amount),['0','100','200']);assert.ok(r.rows.every(x=>x.currency==='INR'&&x.status==='待支付'));
 const next=await detail({limit:20,offset:20});assert.equal(next.rows.length,5);assert.equal(next.hasMore,false);assert.deepEqual(next.amountGroups,r.amountGroups);assert.equal(new Set([...r.rows,...next.rows].map(x=>x.order_id)).size,25);assert.equal(Date.parse(r.rows[0].created_at),Date.parse(parent.first_invalid_at));assert.equal(Date.parse(next.rows.at(-1).created_at),Date.parse(parent.last_invalid_at));
});
test('provider and exact half-open clock filters use whole-day eligibility without exposing other members or days',async()=>{
 await seed();await seed('OTHER');await seed('MEMBER',25,'2026-10-06');
 const range={providers:['CombinedPay'],startAt:'2026-10-05T10:00:02+05:30',endAt:'2026-10-05T10:00:08+05:30'};
 const p=(await call({operation:'members',...range})).rows.find(x=>x.member_id==='MEMBER'),r=await detail(range);assert.equal(r.total,3);assert.equal(r.total,p.invalid_count);assert.equal(r.rows.length,3);assert.ok(r.rows.every(x=>x.member_id==='MEMBER'&&x.day==='2026-10-05'&&x.provider==='CombinedPay'&&x.raw_provider==='route-a'));
 assert.equal(r.amountGroups.reduce((n,g)=>n+Number(g.total_amount),0),Number(p.invalid_amount));assert.equal((await detail({providers:['Absent']})).total,0);assert.equal((await detail({memberId:'ABSENT'})).total,0);assert.equal((await detail({level:'new'})).total,0);
});
test('cross-provider successes, unknown statuses, uncertain IDs and strict thresholds cannot be bypassed by memberId',async()=>{
 for(const m of ['PAID','LATER','UNKNOWN','UNPLACED','EXACT'])await seed(m,m==='EXACT'?15:20);
 await db.exec(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,completed_at,raw_channel)
 values('AR','IN','AR-RAW','recharge','paid-outside','PAID',100,'已支付','2026-10-04 23:00','2026-10-05 23:00','Another Pay');
 update ar_collected_orders set status='已支付',completed_at='2026-10-06 01:00' where order_no='LATER-2026-10-05-020';
 update ar_collected_orders set status='unknown' where order_no='UNKNOWN-2026-10-05-020';
 update ar_collected_orders set applied_at=null where order_no='UNPLACED-2026-10-05-020';`);
 for(const memberId of ['PAID','LATER','UNKNOWN','UNPLACED','EXACT']){const r=await detail({memberId,providers:['CombinedPay']});assert.equal(r.total,0,memberId);assert.deepEqual(r.rows,[]);assert.deepEqual(r.amountGroups,[]);}
});
test('missing amounts stay unknown, explicit zero and decimal native money stay exact',async()=>{
 await seed();await db.exec("update ar_collected_orders set amount=null where order_no='MEMBER-2026-10-05-001';update ar_collected_orders set amount_local=123.45678901 where order_no='MEMBER-2026-10-05-002'");
 const r=await detail();assert.equal(r.rows[0].amount,null);assert.equal(r.rows[1].amount,'123.45678901');assert.equal(r.amountGroups.at(-1).amount,null);assert.equal(r.amountGroups.at(-1).total_amount,null);assert.ok(r.amountGroups.some(g=>g.amount==='0'&&g.total_amount==='0'));
});
test('invalid selectors are rejected, hidden platforms stay denied, and no day selector is accepted by summary or members',async()=>{
 for(const patch of [{memberId:undefined},{memberId:null},{memberId:0},{memberId:' '},{memberId:' MEMBER'},{day:undefined},{day:'2026-02-30'},{day:'2026-10-04'},{day:'2026-10-06'},{day:5},{day:'2026-10-05T00:00Z'},{offset:-1},{limit:500},{extra:true}])await assert.rejects(()=>detail(patch),/invalid_/);
 await assert.rejects(()=>call({operation:'summary',day:'2026-10-05'}),/invalid_member_day/);await assert.rejects(()=>call({operation:'members',day:'2026-10-05'}),/invalid_member_day/);
 await f.as(f.viewer);await assert.rejects(()=>detail({platformId:f.ids.hidden}),/platform_denied/);
});
test('adding the drilldown preserves all existing summary/member results and function metadata',async()=>{
 await seed();await db.exec(reader);const strip=r=>{delete r.asOf;return r},summary=strip(await call()),members=strip(await call({operation:'members'}));await db.exec(migration);
 assert.deepEqual(strip(await call()),summary);assert.deepEqual(strip(await call({operation:'members'})),members);assert.deepEqual(await meta(),metadata);await db.exec(migration);assert.deepEqual(await meta(),metadata);
});
test('guarded migration refuses definition/settings/ACL drift',async()=>{
 await db.exec(reader.replace('perform private.dashboard_admin_live_scope();','perform private.dashboard_admin_live_scope(); -- drift'));
 await assert.rejects(()=>db.exec(migration),/definition_drift/);await db.exec('rollback');await db.exec(reader);
 await db.exec('grant execute on function private.dashboard_admin_live_submission_analysis(jsonb) to anon');await assert.rejects(()=>db.exec(migration),/acl_drift/);await db.exec('rollback');await db.exec('revoke execute on function private.dashboard_admin_live_submission_analysis(jsonb) from anon');
});
