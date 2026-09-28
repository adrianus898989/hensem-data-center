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

test('pending migration filters explicit completion before count and pagination without dropping uncertain outcomes',async()=>{
 const migration=sql('migrations/20260928071952_workorder_followup_pending_saved_time.sql');await db.exec(migration);await db.exec(migration);
 await db.exec('begin');try{
  const complete=['Success','成功','成功到账','已到账','已入款','Received','REFUND','Refunded','已退款','Closed','已关闭'];
  const pending=['Success To Other ID','Success To Other Platform','Success To Other Order','more than 30days/refund','more than 15days refund','No refund','Not Yet Received','Need to provide PDF/VIDEO','成功到其他账号','SUCCESS pending confirmation','', 'awaiting refund'];
  for(let i=0;i<70+125;i++)await db.query(`insert into public.admin_deposit_followup_rows(id,source_sheet,source_tab,source_row,country,platform,order_number,amount,provider,followup_status,followup_date) values($1,'pending-test','A',$2,'印度','A',$1,10,'PendingQueue',$3,$4)`,['queue-'+i,i+1,i<70?complete[i%complete.length]:pending[(i-70)%pending.length],i<70?'2026-09-28':'2026-09-27']);
  await db.exec("update public.admin_deposit_followup_rows set stale_at=now() where id='queue-194'");
  const filters={view:'pending',provider:'PendingQueue',from:'2026-09-01',to:'2026-09-30'};
  const first=await call(filters,account,0,50),second=await call(filters,account,50,50),last=await call(filters,account,100,50);
  assert.equal(first.total,124);assert.equal(first.rows.length,50);assert.equal(second.total,124);assert.equal(last.rows.length,24);assert.equal(new Set([...first.rows,...second.rows,...last.rows].map(r=>r.id)).size,124);assert(first.rows.every(r=>r.followup_pending));
  assert.equal((await call({...filters,view:'all'})).total,194);assert.equal((await call({...filters,outcome:'success'})).total,0);assert((await call({...filters,outcome:'other_order'})).total>0);assert.equal((await call({...filters,platform:'B'})).total,0);
  await db.exec('set role service_role');assert.equal((await call(filters)).total,124);await db.exec('reset role');
 }finally{await db.exec('rollback');}
 await assert.rejects(()=>call({view:'due'}));await assert.rejects(()=>call({view:null}));
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>call({view:'pending'}));await db.exec('reset role');}
 assert.equal((await db.query("select prosecdef from pg_proc where oid='public.workorder_followup_list(jsonb,jsonb,integer,integer)'::regprocedure")).rows[0].prosecdef,false);
});

test('portal pending and month filters use actual saved follow or creation time, never due/manual/sync timestamps',async()=>{
 await db.exec('begin');try{
  const base=record('30000000-0000-0000-0000-000000000001',{provider:'SavedTime',followup_at:'2026-08-15 10:00',followup_date:'2026-08-15',last_actor:'Actual follower',portal_payload:{created_at:'2026-08-01T00:00:00Z',last_follow_at:'2026-09-30T18:29:59Z',updated_at:'2026-10-20T00:00:00Z',due_at:'2027-01-01T00:00:00Z',backend_processed:true,status:'waiting',entry:{outcome:'other_order'}}});
  await mirror(base);
  await mirror(record('30000000-0000-0000-0000-000000000002',{provider:'SavedTime',followup_date:'2026-08-15',portal_payload:{created_at:'2026-09-30T18:30:00Z',updated_at:'2026-10-20T00:00:00Z',entry:{outcome:'pending'}}}));
  await mirror(record('30000000-0000-0000-0000-000000000003',{provider:'SavedTime',portal_payload:{created_at:'2026-09-01T00:00:00Z',status:'closed',entry:{outcome:'pending'}}}));
  await mirror(record('30000000-0000-0000-0000-000000000004',{provider:'SavedTime',portal_owner_id:other,portal_payload:{created_at:'2026-09-01T00:00:00Z',entry:{outcome:'pending'}}}));
  await mirror(record('30000000-0000-0000-0000-000000000005',{provider:'SavedTime',portal_team:'Other',portal_payload:{created_at:'2026-09-01T00:00:00Z',entry:{outcome:'pending'}}}));
  const filters={view:'pending',source:'portal',provider:'SavedTime',from:'2026-09-01',to:'2026-09-30'},sept=await call(filters);
  assert.equal(sept.total,1);assert.equal(sept.rows[0].id,base.id);assert.equal(sept.rows[0].last_actor,'Actual follower');assert.equal(sept.rows[0].query_date,'2026-09-30');assert.equal(sept.rows[0].followup_at,'2026-08-15 10:00');assert.equal(sept.rows[0].portal_payload.last_follow_at,'2026-09-30T18:29:59Z');
  assert.equal((await call({...filters,view:'all'})).total,2);assert.equal((await call(filters,{...account,role:'supervisor'})).total,2);
  assert.equal((await call({...filters,from:'2026-10-01',to:'2026-10-31'})).total,1);assert.equal((await call({...filters,from:'2026-08-01',to:'2026-08-31'})).total,0);
  await mirror({...base,portal_version:2,last_actor:'Newest follower',portal_payload:{...base.portal_payload,last_follow_at:'2026-10-01T00:00:00Z'}});await mirror({...base,portal_version:1});
  assert.equal((await call(filters)).total,0);assert.equal((await call({...filters,from:'2026-10-01',to:'2026-10-31'})).rows.find(r=>r.id===base.id).last_actor,'Newest follower');
 }finally{await db.exec('rollback');}
});

test('same-version backfill adds missing real follow metadata only when all business fields match',async()=>{
 // Apply the finished migration again, including the metadata-only mirror patch.
 await db.exec(sql('migrations/20260928071952_workorder_followup_pending_saved_time.sql'));
 await db.exec('begin');try{
  const payload={id:'40000000-0000-0000-0000-000000000001',created_at:'2026-08-01T00:00:00Z',updated_at:'2026-09-28T00:00:00Z',status:'waiting',entry:{outcome:'pending',followedAt:'2026-08-15T00:00:00Z'},last_follow_actor_name:'Old creator',last_follow_actor_id:actor};
  const base=record(payload.id,{provider:'MetadataOnly',last_actor:'Old creator',portal_payload:payload,followup_date:'2026-08-15',portal_version:3});await mirror(base);
  const enriched={...base,last_actor:'Real follower',followup_date:'2026-09-27',portal_payload:{...payload,last_follow_at:'2026-09-27T00:00:00Z',last_follow_actor_name:'Real follower',last_follow_actor_id:other}};
  await mirror({...enriched,portal_version:2});assert.equal((await call({provider:'MetadataOnly'})).rows[0].portal_payload.last_follow_at,undefined);
  await mirror({...enriched,amount:999});assert.equal((await call({provider:'MetadataOnly'})).rows[0].portal_payload.last_follow_at,undefined);
  await mirror({...enriched,portal_payload:{...enriched.portal_payload,status:'closed'}});assert.equal((await call({provider:'MetadataOnly'})).rows[0].portal_payload.last_follow_at,undefined);
  const original=(await call({provider:'MetadataOnly'})).rows[0];await mirror(enriched);await mirror(enriched);
  const row=(await call({provider:'MetadataOnly'})).rows[0];assert.equal(row.portal_version,3);assert.equal(row.amount,base.amount);assert.equal(row.last_actor,'Real follower');assert.equal(row.portal_payload.last_follow_at,'2026-09-27T00:00:00Z');assert.equal(row.portal_payload.last_follow_actor_id,other);assert.equal(row.followup_date,'2026-09-27');assert.equal(row.updated_at,original.updated_at);assert.deepEqual(row.portal_payload.entry,payload.entry);assert.equal(row.followup_status,original.followup_status);
  await mirror({...enriched,last_actor:'Stale follower',portal_payload:{...enriched.portal_payload,last_follow_at:'2026-09-28T00:00:00Z',last_follow_actor_name:'Stale follower'}});assert.equal((await call({provider:'MetadataOnly'})).rows[0].last_actor,'Real follower');
  await mirror({...enriched,portal_version:4,amount:123,last_actor:'Next follower',portal_payload:{...enriched.portal_payload,last_follow_at:'2026-09-28T00:00:00Z',entry:{outcome:'success'}}});await mirror(enriched);const next=(await call({provider:'MetadataOnly'})).rows[0];assert.equal(next.portal_version,4);assert.equal(next.amount,123);assert.equal(next.last_actor,'Next follower');assert.equal((await call({provider:'MetadataOnly',view:'pending'})).total,0);
 }finally{await db.exec('rollback');}
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>mirror(record()));await db.exec('reset role');}
});
