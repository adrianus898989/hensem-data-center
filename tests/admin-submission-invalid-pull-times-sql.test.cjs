// Synthetic PostgreSQL only: the reviewed production body is reconstructed from
// the existing cohort migration plus its separately deployed AR money expression.
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
const wholeDay=read('20261001040000_submission_whole_member_day.sql');
const migration=read('20261010063435_submission_member_invalid_pull_times.sql');
const fixtureSource=fs.readFileSync(path.join(__dirname,'admin-submission-analysis-sql.test.cjs'),'utf8').split(/\ntest\(/)[0];
let setup,db,f,reviewedDefinition,baselineMetadata;
const context=vm.createContext({__dirname,require:name=>name==='node:test'?{test(){},before:fn=>{setup=fn},after(){}}:name==='@electric-sql/pglite'&&process.env.PGLITE_PATH?require(process.env.PGLITE_PATH):require(name)});
vm.runInContext(fixtureSource+'\nglobalThis.fixture={get db(){return db},call,request,as,ids,owner,viewer};',context);
const query=extra=>f.request({startAt:'2026-10-25T00:00:00+05:30',endAt:'2026-10-26T00:00:00+05:30',...extra});
const call=extra=>f.call(query(extra));
const members=extra=>call({operation:'members',...extra});
const metadata=async()=>(await db.query(`select oid::regprocedure::text signature,proacl::text acl,proconfig,proowner,prosecdef,provolatile
 from pg_proc where oid in ('private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure,'public.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure) order by 1`)).rows;
const functionInfo=async()=>(await db.query("select md5(prosrc) body_hash,md5(pg_get_functiondef(oid)) definition_hash,pg_get_functiondef(oid) definition from pg_proc where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure")).rows[0];
const withoutAsOf=value=>{const copy=JSON.parse(JSON.stringify(value));delete copy.asOf;return copy;};
const instant=value=>new Date(value).toISOString();
async function seed(member,n,{day='2026-10-25',split=n,zero=false}={}){
 await db.query(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel)
 select 'AR','IN','AR-RAW','recharge',$1||'-'||$3||'-'||i,$1,case when $5 then 0 else i*10 end,'待支付',
 $3::date+time '10:00'+i*interval '1 second',case when i<=$4 then 'Selected Pay' else 'Other Pay' end
 from generate_series(1,$2::int)i`,[member,n,day,split,zero]);
}
before(async()=>{
 await setup();f=context.fixture;db=f.db;await db.exec(wholeDay);
 await db.exec(`alter table ar_collected_orders add column if not exists channel_type text,
 add column if not exists money_format_version integer,add column if not exists amount_local numeric,
 add column if not exists currency_local text,add column if not exists money_issue_code text;
 -- Synthetic helper returns fixture local money; the production helper is never replaced.
 create function private.dashboard_admin_ar_local_amount(text,text,text,integer,numeric,text,text,numeric)
 returns numeric language sql immutable as $$select coalesce($5,$8)$$;`);
 const current=await functionInfo(),old="a.applied_at at time zone $4 created_at,a.amount,$17::text currency";
 const normalized="a.applied_at at time zone $4 created_at,private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,a.amount) as amount,$17::text currency";
 assert.equal(current.definition.split(old).length,2);await db.exec(current.definition.replace(old,normalized));
 const reviewed=await functionInfo();assert.equal(reviewed.body_hash,'34fa83e4f1b8c0ea369c51f65cd648c8');assert.equal(reviewed.definition_hash,'f90fd91d1e596489aa5488defeeab727');
 reviewedDefinition=reviewed.definition;baselineMetadata=await metadata();
});
beforeEach(async()=>{await f.as(f.owner);await db.exec('truncate ar_collected_orders,newar_detail_records,lg_orders,game66_charge_orders');await db.exec(reviewedDefinition);await db.exec(migration);});
after(async()=>db?.close());

test('first/last invalid times use the selected provider and exact clock window while legacy bounds stay full-day',async()=>{
 await seed('WINDOW',20,{split:14});
 const all=(await members()).rows[0];assert.equal(all.invalid_count,20);assert.equal(instant(all.first_invalid_at),'2026-10-25T04:30:01.000Z');assert.equal(instant(all.last_invalid_at),'2026-10-25T04:30:20.000Z');
 const selected=(await members({providers:['Other Pay']})).rows[0];assert.equal(selected.invalid_count,6);assert.equal(selected.invalid_amount,'1050');assert.equal(instant(selected.first_invalid_at),'2026-10-25T04:30:15.000Z');assert.equal(instant(selected.last_invalid_at),'2026-10-25T04:30:20.000Z');
 const narrow=(await members({providers:['Selected Pay'],startAt:'2026-10-25T10:00:02+05:30',endAt:'2026-10-25T10:00:05+05:30'})).rows[0];
 assert.equal(narrow.invalid_count,3);assert.equal(narrow.invalid_amount,'90');assert.equal(instant(narrow.first_invalid_at),'2026-10-25T04:30:02.000Z');assert.equal(instant(narrow.last_invalid_at),'2026-10-25T04:30:04.000Z');
 assert.equal(instant(narrow.first_at),'2026-10-25T04:30:01.000Z');assert.equal(instant(narrow.last_at),'2026-10-25T04:30:20.000Z');assert.equal(narrow.submitted_count,20);
});
test('a single selected zero-amount order has equal first/last times, preserves zero and ignores completion time',async()=>{
 await seed('ZERO',16,{split:15,zero:true});await db.exec("update ar_collected_orders set completed_at='2026-10-28 23:59:59' where member_id='ZERO'");
 const r=(await members({providers:['Other Pay']})).rows[0];assert.equal(r.invalid_count,1);assert.equal(r.invalid_amount,'0');assert.equal(r.first_invalid_at,r.last_invalid_at);assert.equal(instant(r.first_invalid_at),'2026-10-25T04:30:16.000Z');
});
test('source-created timestamps retain sub-minute precision and group by each platform local day',async()=>{
 await db.query(`insert into newar_detail_records(platform,dataset,source_id,member_id,order_number,provider,currency,status_group,amount,created_at)
 select 'NEW-RAW','charge','TZ-'||i,'ZONE','TZ-'||i,'Selected Pay','NPR','pending',0,'2026-10-25T00:00:00.123+05:45'::timestamptz+i*interval '1 second' from generate_series(1,16)i`);
 const extra={platformId:f.ids.newar,startAt:'2026-10-25T00:00:00+05:45',endAt:'2026-10-26T00:00:00+05:45'},r=await members(extra),d=r.rows[0];assert.equal(r.platform.timezone,'Asia/Kathmandu');assert.equal(d.day,'2026-10-25');assert.equal(d.invalid_amount,'0');assert.equal(instant(d.first_invalid_at),'2026-10-24T18:15:01.123Z');assert.equal(instant(d.last_invalid_at),'2026-10-24T18:15:16.123Z');
 await seed('MULTIDAY',16);await seed('MULTIDAY',16,{day:'2026-10-26'});const days=(await members({endAt:'2026-10-27T00:00:00+05:30'})).rows;assert.equal(days.length,2);assert.deepEqual(days.map(d=>d.day),['2026-10-26','2026-10-25']);for(const d of days){assert.equal(instant(d.first_invalid_at),d.day+'T04:30:01.000Z');assert.equal(instant(d.last_invalid_at),d.day+'T04:30:16.000Z');}
});
test('additive member times leave summary, monetary normalization, qualification and coverage exactly unchanged',async()=>{
 for(const [member,n] of [['THRESHOLD',15],['VALID',20],['SUCCESS',20],['UNKNOWN',20],['UNDATED',20]])await seed(member,n,{split:14});
 await db.exec(`update ar_collected_orders set status='已支付',completed_at='2026-10-27 12:00' where order_no='SUCCESS-2026-10-25-20';
 update ar_collected_orders set status='unrecognized' where order_no='UNKNOWN-2026-10-25-20';
 update ar_collected_orders set applied_at=null where order_no='UNDATED-2026-10-25-20';
 update ar_collected_orders set amount_local=0 where member_id='VALID';`);
 await db.exec(reviewedDefinition);const beforeSummary=withoutAsOf(await call({providers:['Selected Pay']})),beforeMembers=withoutAsOf(await members({providers:['Selected Pay']}));await db.exec(migration);
 assert.deepEqual(withoutAsOf(await call({providers:['Selected Pay']})),beforeSummary);const afterMembers=withoutAsOf(await members({providers:['Selected Pay']}));assert.deepEqual(afterMembers.rows.map(r=>r.member_id),['VALID']);assert.equal(afterMembers.rows[0].invalid_amount,'0');
 const stripped=JSON.parse(JSON.stringify(afterMembers));for(const row of stripped.rows){delete row.first_invalid_at;delete row.last_invalid_at;}assert.deepEqual(stripped,beforeMembers);
});
test('hidden platforms and invalid directions/ranges remain denied',async()=>{
 await f.as(f.viewer);await assert.rejects(()=>members({platformId:f.ids.hidden}),/platform_denied/);await assert.rejects(()=>members({direction:'withdraw'}),/invalid_direction/);await assert.rejects(()=>members({endAt:'2026-12-01T00:00:00+05:30'}),/invalid_range/);
});
test('migration inserts only the reviewed details fields, preserves wrapper/ACL/settings, replays safely and rejects drift',async()=>{
 const updated=await functionInfo();assert.equal(updated.body_hash,'1ddde0a5c1f7e9c79c9eb212c10e8667');assert.equal(updated.definition_hash,'cad00de0b29f33bc620e510ece3e76a6');assert.deepEqual(await metadata(),baselineMetadata);
 assert.equal(updated.definition.replace('   min(q.first_at) first_at,max(q.last_at) last_at,\n   min(q.created_at) first_invalid_at,max(q.created_at) last_invalid_at\n','   min(q.first_at) first_at,max(q.last_at) last_at\n'),reviewedDefinition);await db.exec(migration);assert.deepEqual(await metadata(),baselineMetadata);
 await db.exec(updated.definition.replace('perform private.dashboard_admin_live_scope();','perform private.dashboard_admin_live_scope(); -- drift'));await assert.rejects(()=>db.exec(migration),/definition_drift/);await db.exec('rollback');await db.exec(updated.definition);
 await db.exec('alter function private.dashboard_admin_live_submission_analysis(jsonb) set statement_timeout=1000');await assert.rejects(()=>db.exec(migration),/definition_drift/);await db.exec('rollback');await db.exec(updated.definition);
 await db.exec('grant execute on function private.dashboard_admin_live_submission_analysis(jsonb) to anon');await assert.rejects(()=>db.exec(migration),/acl_drift/);await db.exec('rollback');await db.exec('revoke execute on function private.dashboard_admin_live_submission_analysis(jsonb) from anon');assert.deepEqual(await metadata(),baselineMetadata);
});
