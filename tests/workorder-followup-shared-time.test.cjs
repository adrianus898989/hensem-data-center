// Synthetic cases only. Real SQL readers must agree on the server-saved India day.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');let db,beforeRows,metadata,baseline,resultsBefore;
const sql=n=>fs.readFileSync(path.join(__dirname,'../supabase',n),'utf8'),migration=sql('migrations/20261002060036_workorder_followup_shared_saved_time.sql');
const actor='10000000-0000-0000-0000-000000000001',account={auth_user_id:actor,role:'agent',active:true,team:'M8',platforms:['A','Z','82LOTTERY']};
const admin=async q=>(await db.query('select public.dashboard_admin_live_deposit_issues($1) value',[JSON.stringify({view:'entries',dateMode:'all',startAt:'2026-10-01T00:00:00Z',endAt:'2026-10-02T23:59:59Z',limit:100,...q})])).rows[0].value;
const portal=async (f={},a=account,offset=0,limit=100)=>(await db.query('select public.workorder_followup_list($1,$2,$3,$4) value',[JSON.stringify(a),JSON.stringify(f),offset,limit])).rows[0].value;
const snapshot=async()=>(await db.query('select jsonb_agg(to_jsonb(r) order by id) value from public.admin_deposit_followup_rows r')).rows[0].value;
const meta=async()=>(await db.query("select oid,proowner,proacl,proconfig,prosecdef,provolatile from pg_proc where oid in ('private.dashboard_admin_live_deposit_issues(jsonb)'::regprocedure,'public.workorder_followup_list(jsonb,jsonb,integer,integer)'::regprocedure) order by oid")).rows;
async function addPortal(n,platform,created,follow,extra={}){
 const id='20000000-0000-0000-0000-'+String(n).padStart(12,'0');
 const payload={created_at:created,last_follow_at:follow,status:'open',entry:{outcome:'pending',followedAt:'2020-01-01T00:00:00Z'}};
 await db.query(`insert into public.admin_deposit_followup_rows(id,source_sheet,source_tab,source_row,source_kind,country,platform,order_number,work_order_number,utr,amount,provider,followup_status,followup_date,portal_case_id,portal_version,portal_owner_id,portal_team,portal_payload,stale_at) values($1,'PORTAL',$2,1,'portal','印度',$3,$4,$5,'SYNTHETIC-UTR',10,'SYNTHETIC-PAY','Not Yet Received','2000-01-01',$2,1,$6,$7,$8,$9)`,['PORTAL:'+id,id,platform,'RC20260927SYNTHETIC'+n,'WORK'+n,extra.owner||actor,extra.team||'M8',JSON.stringify(payload),extra.archived?'2026-10-02T00:00Z':null]);
}
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema private to authenticated,service_role;
 create function private.dashboard_admin_live_scope() returns jsonb language sql as $$select '{}'::jsonb$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql as $$select $2='印度' and $3<>'HIDDEN'$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select upper(btrim($1))$$;
 create function private.dashboard_admin_live_platforms() returns table(name text,country text) language sql as $$values ('A','印度'),('Z','印度'),('82LOTTERY','印度'),('HIDDEN','印度')$$;
 create function private.dashboard_admin_live_provider_canonical(text,text,text) returns text language sql as $$select $3$$;`);
 for(const n of ['admin-live-deposit-issues.sql','workorder-followup-unified.sql','workorder-followup-upi-receipt.sql','workorder-followup-soft-archive.sql','migrations/20260928071952_workorder_followup_pending_saved_time.sql'])await db.exec(sql(n));
 baseline=(await db.query("select pg_get_functiondef(oid) definition from pg_proc where oid in ('private.dashboard_admin_live_deposit_issues(jsonb)'::regprocedure,'public.workorder_followup_list(jsonb,jsonb,integer,integer)'::regprocedure)")).rows.map(x=>x.definition).join(';\n')+';';
 await db.exec(`insert into public.admin_deposit_followup_rows(id,source_sheet,source_tab,source_row,country,platform,order_number,utr,amount,provider,followup_status,followup_date) select 'sheet-'||n,'SHEET','follow',100+n,'印度','A','SHEET-ORDER-'||n,'SYNTHETIC',10,'SYNTHETIC-PAY','Not Yet Received','2026-10-02' from generate_series(1,24) n;
 insert into public.admin_deposit_issue_rows(id,source_sheet,source_tab,source_row,country,platform,order_number,utr,amount,provider,status,match_status,record_date) values('result','SHEET','UPI',1,'印度','Z','RC20260927SYNTHETIC2','SYNTHETIC-UTR',10,'SYNTHETIC-PAY','已入款','对得上','2026-10-02');`);
 await addPortal(1,'Z','2026-10-01T18:29:59Z',null);await addPortal(2,'Z','2026-10-01T18:30:00Z',null);
 await addPortal(3,'Z','2026-09-27T00:00:00Z','2026-10-02T00:30:00Z');await addPortal(4,'Z','2026-09-27T00:00:00Z','2026-10-02T00:30:00Z');
 await addPortal(5,'HIDDEN','2026-10-02T01:00:00Z',null);await addPortal(6,'Z','2026-10-02T01:00:00Z',null,{owner:'another-owner'});await addPortal(7,'Z','2026-10-02T01:00:00Z',null,{team:'OTHER'});await addPortal(8,'Z','2026-10-02T01:00:00Z',null,{archived:true});
 beforeRows=await snapshot();metadata=await meta();resultsBefore=await admin({view:'results'});await db.exec(migration);
});after(async()=>db?.close());
test('saved India day agrees across readers, independent of provider time and stale mirror date',async()=>{
 const a=await admin({sourceKind:'portal',dateMode:'range',startAt:'2026-10-01T00:00:00Z',endAt:'2026-10-01T23:59:59Z'}),p=await portal({source:'portal',from:'2026-10-01',to:'2026-10-01'});assert.equal(a.total,1);assert.equal(p.total,1);assert.equal(a.rows[0].portalCaseId,p.rows[0].portal_case_id);assert.equal(a.rows[0].recordDate,'2026-10-01');
 assert.equal((await portal({source:'portal',from:'2026-10-02',to:'2026-10-02'})).total,3);assert.equal((await admin({sourceKind:'portal',dateMode:'range',startAt:'2000-01-01T00:00:00Z',endAt:'2000-01-01T23:59:59Z'})).total,0);
});
test('same-day portal records precede Sheet pages and tied times paginate deterministically',async()=>{
 assert.equal((await admin({dateMode:'range',startAt:'2026-10-02T00:00:00Z',endAt:'2026-10-02T23:59:59Z',limit:20})).rows[0].sourceKind,'portal');
 const p=await portal({from:'2026-10-02',to:'2026-10-02'},account,0,2),n=await portal({from:'2026-10-02',to:'2026-10-02'},account,2,2);assert(p.rows.every(r=>r.source_kind==='portal'));assert.deepEqual(p.rows.map(r=>r.order_number),['RC20260927SYNTHETIC3','RC20260927SYNTHETIC4']);assert.equal(new Set([...p.rows,...n.rows].map(r=>r.id)).size,4);assert.equal(p.total,27);
});
test('source, archive, owner, team and platform scope apply before counts and pagination',async()=>{
 assert.equal((await portal({source:'sheet',from:'2026-10-02',to:'2026-10-02'})).total,24);assert.equal((await portal({source:'portal'})).total,4);assert.equal((await portal({source:'portal'},{...account,role:'supervisor'})).total,5);assert.equal((await admin({sourceKind:'portal'})).total,6);const body=JSON.stringify(await portal({source:'portal'}));for(const denied of ['another-owner','OTHER','HIDDEN'])assert(!body.includes(denied));
});
test('portal remains independent: matching RC UTR and amount do not imply association or actual receipt',async()=>{
 const r=(await admin({sourceKind:'portal',orderNumber:'RC20260927SYNTHETIC2'})).rows[0];assert.equal(r.linkStatus,'independent');assert.equal(r.status,'待核对');assert.equal(r.resultDate,null);assert.equal(r.followupStatus,'Not Yet Received');assert.deepEqual(await admin({view:'results'}),resultsBefore);
});
test('business rows, function OIDs, ACLs, security and planner settings are unchanged',async()=>{assert.deepEqual(await snapshot(),beforeRows);assert.deepEqual(await meta(),metadata);});
test('direct public employee-list reads remain denied; admin RPC retains permission scope',async()=>{for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>portal());await db.exec('reset role');}await db.exec('set role authenticated');assert.equal((await admin({sourceKind:'portal'})).total,6);await db.exec('reset role');});
test('unknown ACL prevents migration instead of widening access',async()=>{await db.exec(baseline);await db.exec('grant execute on function public.workorder_followup_list(jsonb,jsonb,integer,integer) to anon');await assert.rejects(()=>db.exec(migration),/ACL drift/);await db.exec('rollback');await db.exec('revoke execute on function public.workorder_followup_list(jsonb,jsonb,integer,integer) from anon');await db.exec(migration);});
test('unknown definition refuses migration and rolls back earlier replacement',async()=>{await db.exec(baseline);await db.exec("alter function public.workorder_followup_list(jsonb,jsonb,integer,integer) set statement_timeout='7s'");await assert.rejects(()=>db.exec(migration),/definition drift/);await db.exec('rollback');assert.equal((await db.query("select md5(pg_get_functiondef('private.dashboard_admin_live_deposit_issues(jsonb)'::regprocedure)) m")).rows[0].m,'2c2e15758db3aa749a8e5eff6ebdb424');await db.exec('alter function public.workorder_followup_list(jsonb,jsonb,integer,integer) reset statement_timeout');await db.exec(migration);});
