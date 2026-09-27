// Synthetic data only. Exercise real PostgreSQL scope, pagination and idempotent mirrors.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');let db;
const sql=n=>fs.readFileSync(path.join(__dirname,'../supabase',n),'utf8');
const actor='10000000-0000-0000-0000-000000000001',other='10000000-0000-0000-0000-000000000002';
const account={auth_user_id:actor,role:'agent',active:true,team:'M8',platforms:['A','82LOTTERY']};
const call=async(filters={},acc=account,offset=0,limit=50)=>(await db.query('select public.workorder_followup_list($1,$2,$3,$4) as data',[JSON.stringify(acc),JSON.stringify(filters),offset,limit])).rows[0].data;
const mirror=async(record)=>(await db.query('select public.workorder_followup_mirror($1) as ok',[JSON.stringify(record)])).rows[0].ok;
function record(id='20000000-0000-0000-0000-000000000001',extra={}){return {id:'PORTAL:'+id,source_kind:'portal',source_sheet:'PORTAL',source_tab:id,source_row:1,portal_case_id:id,portal_version:1,portal_owner_id:actor,portal_team:'M8',country:'印度',platform:'A',order_number:'NEW',work_order_number:'T1 / T2',utr:'0001',amount:12,provider:'Pay',followup_status:'Not Yet Received',first_actor:'First',last_actor:'First',followup_date:'2026-09-27',portal_payload:{entry:{outcome:'pending',kycCheck:'yes',utrMatch:'no'}},...extra};}
before(async()=>{db=new PGlite();await db.exec('create schema private;create role anon;create role authenticated;create role service_role bypassrls;');await db.exec(sql('admin-live-deposit-issues.sql').split('create or replace function private.dashboard_admin_live_deposit_platform_key')[0]+'commit;');await db.exec(sql('workorder-followup-unified.sql'));await db.exec(`insert into public.admin_deposit_followup_rows(id,source_sheet,source_tab,source_row,country,platform,order_number,amount,provider,followup_status,staff_code,followup_date,utr,kyc_correct,utr_match) values
 ('history-a','sheet','A',2,'印度','A','SAME',25,'Pay','Success To Other Platform','EMP-A','2026-09-25','0002','YES','NO'),
 ('history-alias','sheet','INDIA82',2,'印度','INDIA82','ALIAS',50,'AliasPay','Success','EMP-B',null,'0003','NO','YES'),
 ('history-hidden','sheet','B',2,'印度','B','HIDDEN',50,'SecretPay','Success','SECRET','2026-09-25','0004','YES','YES'),
 ('history-country','sheet','PH',2,'菲律宾','A','HIDDEN-PH',50,'SecretPay','Success','SECRET','2026-09-25','0004','YES','YES');`);});
after(async()=>{await db?.close();});
test('history is scoped to authorized India platforms with alias normalization and no invented people',async()=>{const r=await call();assert.equal(r.total,2);assert.deepEqual(r.facets.providers,['AliasPay','Pay']);assert.deepEqual(r.facets.creators,[]);assert(!JSON.stringify(r).includes('SECRET'));assert.equal(r.rows.find(x=>x.id==='history-alias').display_platform,'82LOTTERY');assert.equal(r.rows.find(x=>x.id==='history-a').normalized_outcome,'other_platform');});
test('columns combine with AND and null historical dates stay out of date searches',async()=>{assert.equal((await call({staffCode:'emp-a',utr:'0002',minAmount:20,maxAmount:30})).total,1);assert.equal((await call({staffCode:'emp-a',orderNo:'ALIAS'})).total,0);assert.equal((await call({from:'2026-09-01',to:'2026-09-30'})).total,1);assert.equal((await call({kyc:'no',utrMatch:'yes'})).total,1);assert.equal((await call({},account,1,1)).rows.length,1);assert.equal((await call({},account,1,1)).total,2);});
test('portal mirror retries never duplicate or overwrite newer state; history cannot be edited',async()=>{const r=record();assert.equal(await mirror(r),true);assert.equal(await mirror(r),true);await mirror({...r,portal_version:2,amount:99,last_actor:'Updated'});await mirror({...r,portal_version:1,amount:1});const list=await call({source:'portal'});assert.equal(list.total,1);assert.equal(list.rows[0].amount,99);assert.equal(list.rows[0].first_actor,'First');assert.equal(list.rows[0].last_actor,'Updated');await assert.rejects(()=>mirror({...r,id:'history-a',source_sheet:'sheet',source_kind:'sheet'}));assert.equal((await call({source:'sheet'})).total,2);});
test('agents cannot see other owners; supervisors stay in team/platform scope',async()=>{await mirror(record('20000000-0000-0000-0000-000000000002',{portal_owner_id:other}));await mirror(record('20000000-0000-0000-0000-000000000003',{portal_team:'Other'}));await mirror(record('20000000-0000-0000-0000-000000000004',{platform:'B'}));assert.equal((await call({source:'portal'})).total,1);assert.equal((await call({source:'portal'},{...account,role:'supervisor'})).total,2);});
test('database public callers cannot bypass the authenticated server or mutate histories',async()=>{for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>call());await assert.rejects(()=>mirror(record()));await assert.rejects(()=>db.exec("update public.admin_deposit_followup_rows set amount=0 where id='history-a'"));await db.exec('reset role');}await assert.rejects(()=>call({},{}));await assert.rejects(()=>call({},account,0,101));await db.exec('set role service_role');assert.equal((await call()).total,3);await db.exec('reset role');});

test('additive UPI and receipt patch preserves records, mirror versions and private authorization',async()=>{
 const before=(await call()).total;await db.exec(sql('workorder-followup-upi-receipt.sql'));await db.exec(sql('workorder-followup-upi-receipt.sql'));assert.equal((await call()).total,before);
 await db.exec("update public.admin_deposit_followup_rows set order_number='RC20260925SYNTHETIC',upi_id='synthetic@upi.invalid',kyc_upi_id='***@bank.invalid' where id='history-a'");
 const list=await call({upiId:'synthetic',kycUpiId:'***@bank.invalid'});assert.equal(list.total,1);assert.equal(list.rows[0].upi_id,'synthetic@upi.invalid');assert.equal(list.rows[0].kyc_upi_id,'***@bank.invalid');assert.equal((await call({upiId:'synthetic',platform:'82LOTTERY'})).total,0);
 const r=record('20000000-0000-0000-0000-000000000005',{upi_id:'new@upi.invalid',kyc_upi_id:'***@bank.invalid'});await mirror(r);await mirror({...r,portal_version:2,upi_id:'edited@upi.invalid'});await mirror({...r,portal_version:1,upi_id:'stale@upi.invalid'});assert.equal((await call({upiId:'edited'})).total,1);assert.equal((await call({upiId:'stale'})).total,0);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>call({upiId:'synthetic'}));await assert.rejects(()=>mirror(r));await db.exec('reset role');}
});
test('receipt date strictly uses RC prefix and age rolls at India midnight, independently of status',async()=>{
 const q=async(order,at)=>(await db.query("select private.workorder_receipt_date($1)::text d,private.workorder_receipt_days($1,$2) age",[order,at])).rows[0];
 assert.deepEqual(await q('RC20260925SYNTHETIC','2026-09-26T18:29:59Z'),{d:'2026-09-25',age:1});assert.deepEqual(await q('RC20260925SYNTHETIC','2026-09-26T18:30:00Z'),{d:'2026-09-25',age:2});
 for(const order of ['OTHER20260925','RC20260230X','RC00000925X','29'])assert.equal((await q(order,'2026-09-27T00:00Z')).d,null);
 assert.equal((await q('RC20990101X','2026-09-27T00:00Z')).age,null);
});

test('soft archive migration retains rows and ACLs, excludes archived history, and preserves portal mirrors',async()=>{
 const count=async()=>(await db.query('select count(*)::int n from public.admin_deposit_followup_rows')).rows[0].n;
 const before=await count();await db.exec(sql('workorder-followup-soft-archive.sql'));await db.exec(sql('workorder-followup-soft-archive.sql'));assert.equal(await count(),before);
 await db.exec('begin');try{
  const active=(await call()).total;await db.exec("update public.admin_deposit_followup_rows set stale_at=now() where id='history-alias'");
  const archived=await call();assert.equal(archived.total,active-1);assert(!archived.rows.some(r=>r.id==='history-alias'));assert(!archived.facets.providers.includes('AliasPay'));assert.equal(await count(),before);
  const r=record();await mirror({...r,portal_version:3,amount:123});await mirror({...r,portal_version:2,amount:1});const portal=(await call({source:'portal'})).rows.find(x=>x.id===r.id);assert.equal(portal.amount,123);assert.equal(portal.stale_at,null);
  await db.exec("update public.admin_deposit_followup_rows set stale_at=null where id='history-alias'");assert.equal((await call()).total,active);assert.equal(await count(),before);
  await db.exec('set role service_role');assert.equal((await call()).total,active);await db.exec('reset role');
 }finally{await db.exec('rollback');}
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>call());await db.exec('reset role');}
});
