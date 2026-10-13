// Code-only production function and synthetic records; no live DB or Google requests.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const baseline=read('tests/fixtures/workorder-followup-source-sheet-production.sql');
const migration=read('supabase/migrations/20261013073937_workorder_followup_source_sheet_identity.sql');
const target='private.dashboard_admin_live_deposit_issues(jsonb)';
async function fixture(){const db=new PGlite();try{
 await db.exec(`create schema private;create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema private to authenticated,service_role;
 create function private.dashboard_admin_live_scope() returns jsonb language sql stable as $$select '{}'::jsonb$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql stable as $$select $2='印度' and $3<>'HIDDEN'$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select upper(btrim($1))$$;
 create function private.dashboard_admin_live_platforms() returns table(name text,country text) language sql stable as $$values ('A','印度'),('HIDDEN','印度')$$;
 create function private.dashboard_admin_live_provider_canonical(text,text,text) returns text language sql stable as $$select $3$$;`);
 for(const f of ['admin-live-deposit-issues.sql','workorder-followup-unified.sql','workorder-followup-upi-receipt.sql'])await db.exec(read('supabase/'+f));
 await db.exec(baseline);
 await db.exec(`insert into admin_deposit_followup_rows(id,source_sheet,source_tab,source_gid,source_row,source_kind,country,platform,order_number,utr,amount,provider,followup_status,followup_date) values
 ('old','synthetic-historical-workbook-00001','A',42,2,'sheet','印度','A','RC20261001SYNTHETIC','0000123',10,'Pay','Not Yet Received','2026-10-01'),
 ('current','synthetic-october-workbook-000002','A',42,2,'sheet','印度','A','RC20261001SYNTHETIC','0000123',10,'Pay','Success','2026-10-02'),
 ('hidden','DENIED-WORKBOOK','A',42,3,'sheet','印度','HIDDEN','HIDDEN','000',10,'HiddenPay','Success','2026-10-02'),
 ('foreign','DENIED-FOREIGN','A',42,4,'sheet','巴西','A','FOREIGN','000',10,'HiddenPay','Success','2026-10-02');
 insert into admin_deposit_issue_rows(id,source_sheet,source_tab,source_row,country,platform,order_number,utr,amount,provider,status,match_status,record_date) values
 ('result','synthetic-reconciliation-book-003','UPI核对',2,'印度','A','RC20261001SYNTHETIC','0000123',10,'Pay','已入款','对得上','2026-10-01');`);
 return db;
}catch(e){await db.close();throw e}}
const call=async(db,q={})=>(await db.query('select private.dashboard_admin_live_deposit_issues($1) d',[JSON.stringify({view:'entries',dateMode:'all',startAt:'2026-10-01T00:00:00Z',endAt:'2026-10-02T23:59:59Z',limit:20,...q})])).rows[0].d;
const meta=async db=>(await db.query('select to_jsonb(p)-\'prosrc\' m,md5(prosrc) hash from pg_proc p where oid=$1::regprocedure',[target])).rows[0];
function stripSourceSheet(value){return {...value,rows:value.rows.map(({sourceSheet,...row})=>row)}}
test('full old/current/result responses differ only by actual per-row sourceSheet, including pagination and scope',async()=>{const db=await fixture();try{
 const qs=[{}, {view:'results'}, {offset:1}, {orderNumber:'RC20261001SYNTHETIC'}, {sourceKind:'sheet'}, {dateMode:'range'}, {platform:'HIDDEN'}];
 const before=[];for(const q of qs)before.push(await call(db,q));const native=(await db.query('select jsonb_agg(to_jsonb(t) order by id) j from admin_deposit_followup_rows t')).rows[0].j;const m=await meta(db);assert.equal(m.hash,'d590c4cfd8da1829416174bcd8dc4fa1');
 await db.exec(migration);for(let i=0;i<qs.length;i++){const after=await call(db,qs[i]);assert.deepEqual(stripSourceSheet(after),before[i]);assert(!JSON.stringify(after).includes('DENIED-'));}
 const rows=(await call(db)).rows;assert.equal(rows.length,2);assert.equal(new Set(rows.map(r=>r.sourceSheet)).size,2);assert.deepEqual(rows.map(r=>r.sourceSheet).sort(),['synthetic-historical-workbook-00001','synthetic-october-workbook-000002']);assert(rows.every(r=>r.sourceGid===42&&r.linkStatus==='review'),'same tab/GID cannot pick a workbook or erase duplicate-source review');
 assert.equal((await call(db,{view:'results'})).rows[0].sourceSheet,'synthetic-reconciliation-book-003');assert.deepEqual((await meta(db)).m,m.m);assert.deepEqual((await db.query('select jsonb_agg(to_jsonb(t) order by id) j from admin_deposit_followup_rows t')).rows[0].j,native);
 await db.exec('set role authenticated');assert.equal((await call(db)).total,2);await db.exec('reset role');await db.exec('set role anon');await assert.rejects(call(db),/permission denied/);await db.exec('reset role');
}finally{await db.close()}});
test('known replay is idempotent and unknown body or ACL/metadata drift refuses atomically',async()=>{const db=await fixture();try{
 await db.exec(migration);const expected=await call(db),m=await meta(db);await db.exec(migration);assert.deepEqual(await call(db),expected);assert.deepEqual(await meta(db),m);
 for(const change of [`alter function ${target} cost 17`,`alter function ${target} strict`,`grant execute on function ${target} to anon`]){
  await db.exec(change);await assert.rejects(db.exec(migration),/metadata drift/);await db.exec('rollback');
  if(change.includes('cost'))await db.exec(`alter function ${target} cost 100`);if(change.includes('strict'))await db.exec(`alter function ${target} called on null input`);if(change.includes('grant'))await db.exec(`revoke execute on function ${target} from anon`);
 }
 await db.exec(baseline.replace('Called only','Changed only').replace('v_scope jsonb:=','-- unreviewed body\n v_scope jsonb:='));await assert.rejects(db.exec(migration),/definition drift/);await db.exec('rollback');
}finally{await db.close()}});
