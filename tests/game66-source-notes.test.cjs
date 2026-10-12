const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const repo=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const migration=read('supabase/migrations/20261012121047_game66_received_source_notes.sql');
const baseline=read('tests/fixtures/game66-source-notes-production-reasons.sql');
const sanitizer=read('supabase/migrations/20261011074133_yash_withdraw_source_notes.sql').split('create or replace function private.dashboard_admin_yash_note_text')[1].split('do $patch$')[0];
const id='00000000-0000-4000-8000-000000000001';
async function fixture(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;
 create table game66_platforms(id uuid primary key,team_code text,team_name text,platform_name text,platform_code text);
 create table game66_withdraw_orders(id uuid default gen_random_uuid(),platform_id uuid,order_num text,amount_display numeric,status_code text,status_text text,auto_commit text,create_time timestamptz,submit_time timestamptz,update_time timestamptz,last_seen_at timestamptz,audit_admin text,lock_admin text,lock_user_admin text,uid text,account text,account_name text,cpf text,auto_reason text,audit_remark text,reason text,withdraw_remark text);
 create index game66_notes_test_time on game66_withdraw_orders(platform_id,create_time);
 insert into game66_platforms values('${id}','hong_kong','香港','SYNTHETIC','SYNTHETIC');
 create function private.dashboard_admin_live_scope() returns jsonb language sql stable set search_path='' as $$select jsonb_build_object('denied',coalesce(current_setting('test.denied',true),'no')='yes')$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable set search_path='' as $$select not coalesce(($1->>'denied')::boolean,false) and $2 in('香港','HK_TEAM') and upper(replace($3,'.',''))='SYNTHETIC'$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable set search_path='' as $$select upper(replace(btrim($1),'.',''))$$;
 create function private.dashboard_admin_live_platforms() returns table(id uuid,name text,source_name text,country text,source text,scope_group text,timezone text) language sql stable set search_path='' as $$select g.id,g.platform_name,g.platform_name,g.team_name,'game66','HK_TEAM','Asia/Kolkata' from public.game66_platforms g$$;
 create function private.dashboard_admin_live_withdraw_platforms() returns table(id uuid,name text,source_name text,country text,source text,scope_group text,timezone text) language sql stable set search_path='' as $$select * from private.dashboard_admin_live_platforms()$$;
 create function private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb) returns jsonb language sql as $$select null::jsonb$$;
 create function private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb) returns jsonb language sql as $$select null::jsonb$$;
 create table auto_withdraw_daily(country text,data_date date,platform text,total bigint,updated_at timestamptz);
 create table dashboard_platform_team_map(country_name text,country_code text,active boolean);
 set check_function_bodies=off;`);
 await db.exec('create or replace function private.dashboard_admin_yash_note_text'+sanitizer);await db.exec(baseline);
 await db.exec('set check_function_bodies=on;revoke all on function private.dashboard_admin_live_withdraw_reasons(jsonb) from public,anon,authenticated,service_role;grant usage on schema private to authenticated;grant execute on function private.dashboard_admin_live_withdraw_reasons(jsonb) to authenticated;');
 return db;}
const sig='private.dashboard_admin_live_withdraw_reasons(jsonb)';
const call=async(db,extra={})=>(await db.query('select private.dashboard_admin_live_withdraw_reasons($1) d',[{country:'香港',platform:'SYNTHETIC',date:'2026-10-12',kind:'blocking',...extra}])).rows[0].d;
async function order(db,n,extra={}){const x={platform_id:id,order_num:'SYNTHETIC-'+n,amount_display:'123.4500',status_code:'-1',status_text:'已驳回',create_time:'2026-10-12T00:00:00Z',last_seen_at:'2026-10-13T00:00:00Z',auto_reason:'Auto business note',audit_remark:'Audit business note',reason:'Reason business note',withdraw_remark:'Withdraw business note',...extra},keys=Object.keys(x);await db.query(`insert into game66_withdraw_orders(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(x));}
test('received notes preserve fields and exact rejected cohort without fabricated causal labels or complete coverage',async()=>{const db=await fixture();try{
 await order(db,1);await order(db,2,{status_code:'3',status_text:'成功'});await order(db,3,{status_code:'2',status_text:'出款失败'});await order(db,4,{status_code:null,status_text:null});
 await db.exec(migration);const all=await call(db),reject=await call(db,{kind:'categories'}),rows=await call(db,{kind:'orders'});
 assert.equal(all.noteCount,4);assert.equal(reject.noteCount,1);assert.equal(rows.rows.length,1);assert.equal(all.classificationAvailable,false);assert.equal(all.rejectionReasonAvailable,false);assert.equal(all.coverage.complete,false);assert.equal(all.coverage.expected,null);
 assert.deepEqual(rows.rows[0].sourceNotes,{auto_reason:'Auto business note',audit_remark:'Audit business note',reason:'Reason business note',withdraw_remark:'Withdraw business note'});assert.equal(rows.rows[0].rejectionReason,null);assert.equal(rows.rows[0].completedAt,null);assert.equal(rows.rows[0].amount,'123.4500');
 assert.equal(all.rows[0].success,1);assert.equal(all.rows[0].rejected,1);assert.equal(all.rows[0].other,2);
 }finally{await db.close()}});
test('null, empty, unsafe and literal labels remain distinct; no customer contact/account values leave note reader',async()=>{const db=await fixture();try{
 await order(db,1,{auto_reason:null,audit_remark:null,reason:null,withdraw_remark:null});await order(db,2,{auto_reason:'',audit_remark:'',reason:'',withdraw_remark:''});
 await order(db,3,{auto_reason:'未采集自动出款备注'});await order(db,4,{auto_reason:'x'.repeat(2001)});
 await order(db,5,{uid:'CUSTOMER-SECRET',account:'ACCT-SECRET',account_name:'SENSITIVE-NAME',cpf:'12345678901',audit_admin:'person@example.invalid',auto_reason:'CUSTOMER-SECRET ACCT-SECRET SENSITIVE-NAME 12345678901 token=SECRET, https://bad.invalid/path email@example.invalid +911234567890',audit_remark:'银行卡:123456789012345'});
 await db.exec(migration);const d=await call(db);assert.deepEqual(d.summary.sourceNoteStates,{missing:2,empty:1,present:2});assert.equal(new Set(d.rows.map(r=>r.reasonKey)).size,4);
 const s=JSON.stringify(await call(db,{kind:'orders'}));for(const v of ['CUSTOMER-SECRET','ACCT-SECRET','SENSITIVE-NAME','12345678901','person@example.invalid','SECRET,','https://bad.invalid','email@example.invalid'])assert(!s.includes(v),v);
 }finally{await db.close()}});
test('local half-open day and platform scope restrict indexed facts; aliases retain identical data',async()=>{const db=await fixture();try{
 await order(db,1,{create_time:'2026-10-11T18:29:59.999Z'});await order(db,2,{create_time:'2026-10-11T18:30:00Z'});await order(db,3,{create_time:'2026-10-12T18:30:00Z'});await order(db,4,{platform_id:'00000000-0000-4000-8000-000000000002'});
 await db.exec(migration);assert.equal((await call(db)).noteCount,1);assert.deepEqual((await call(db,{platform:'SYN.THETIC'})).rows,(await call(db)).rows);
 await db.exec("set test.denied='yes'");await assert.rejects(call(db),/scope_denied/);await db.exec("set test.denied='no'");await assert.rejects(call(db,{country:'印度'}),/scope_denied/);
 const empty=await call(db,{date:'2026-10-10'});assert.equal(empty.available,false);assert.equal(empty.noteCount,null);assert.equal(empty.coverage.complete,false);
 }finally{await db.close()}});
test('stable grouping and order pagination drill back to the same exact cohort',async()=>{const db=await fixture();try{
 for(let i=0;i<23;i++)await order(db,i,{audit_admin:i%2?'OP_A':'OP_B',audit_remark:i%2?'NOTE_A':'NOTE_B'});
 await db.exec(migration);const groups=await call(db,{kind:'categories'}),g=groups.rows[0];const d=await call(db,{kind:'orders',category:g.categoryKey});assert.equal(d.total,g.count);assert(d.rows.every(r=>r.sourceNotes.audit_remark===g.sourceNotes.audit_remark));
 const a=await call(db,{kind:'orders'}),b=await call(db,{kind:'orders',offset:20});assert.equal(a.rows.length,20);assert.equal(b.rows.length,3);assert.equal(new Set([...a.rows,...b.rows].map(r=>r.orderNumber)).size,23);
 const operators=await call(db,{kind:'operators'});assert.equal(operators.rows.reduce((s,r)=>s+r.count,0),23);assert.equal((await call(db,{kind:'orders',query:'SYNTHETIC-22'})).total,1);
 }finally{await db.close()}});
test('parent authorization and metadata/ACL remain intact; private helper direct access denied and replay stable',async()=>{const db=await fixture();try{
 const meta=async()=>(await db.query('select to_jsonb(p)-\'prosrc\' m from pg_proc p where oid=$1::regprocedure',[sig])).rows[0].m;const before=await meta();await db.exec(migration);assert.deepEqual(await meta(),before);await db.exec(migration);
 for(const helper of ['private.dashboard_admin_game66_note(text,text[])','private.dashboard_admin_game66_withdraw_reasons(jsonb,jsonb,jsonb)'])for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') v',[role,helper])).rows[0].v,false);
 await order(db,1);await db.exec('set role authenticated');assert.equal((await call(db)).noteCount,1);await db.exec('reset role');
 }finally{await db.close()}});
test('body/ACL/config drift aborts before replacement and other source helper returns null',async()=>{for(const mutation of ['grant execute on function '+sig+' to anon',"alter function "+sig+" set search_path=public",'alter function '+sig+' cost 101']){const db=await fixture();try{await db.exec(mutation);await assert.rejects(db.exec(migration),/contract_drift/);await db.exec('rollback');}finally{await db.close()}}
 const db=await fixture();try{await db.exec(migration);assert.equal((await db.query(`select private.dashboard_admin_game66_withdraw_reasons('{}','{}','{"source":"ar"}') v`)).rows[0].v,null);}finally{await db.close()}
});
test('the production function changes only scoped GAME66 dispatch, with original validation and every existing branch intact',async()=>{
 const db=await fixture();try{
 const before=(await db.query('select prosrc s from pg_proc where oid=$1::regprocedure',[sig])).rows[0].s;await db.exec(migration);
 const after=(await db.query('select prosrc s from pg_proc where oid=$1::regprocedure',[sig])).rows[0].s;
 const patch=" -- game66_received_source_notes_v1: request, scope and native identity were checked above.\n if v_meta.source='game66' then\n  v_rows:=private.dashboard_admin_game66_withdraw_reasons(p_request,v_scope,to_jsonb(v_meta));\n  if v_rows is not null then return v_rows;end if;\n end if;\n";
 assert.equal(after.replace(patch,''),before);assert(after.indexOf('scope_denied')<after.indexOf(patch));assert(after.indexOf('select * into v_meta')<after.indexOf(patch));
 for(const q of [{date:'not-a-date'},{limit:5000},{reasonKey:'not-a-hash'},{kind:'invented'}])await assert.rejects(call(db,q),/invalid_/);
 await db.exec('grant execute on function private.dashboard_admin_game66_note(text,text[]) to service_role');await assert.rejects(db.exec(migration),/helper_drift/);await db.exec('rollback');
 }finally{await db.close()}
});
test('only documented automatic-note empty encodings are empty; ordinary notes and unknown provenance remain separate',async()=>{
 const db=await fixture();try{
 for(const [i,note]of ['[]','{}','null',' [] ','["business rule"]','NULL',null].entries())await order(db,'encoded-'+i,{auto_reason:note,audit_remark:'[]',reason:'null',withdraw_remark:'{}'});
 await db.exec(migration);const d=await call(db);assert.deepEqual(d.summary.sourceNoteStates,{present:2,empty:4,missing:1});assert.equal(d.rows.find(r=>r.noteState==='empty').count,4);assert.equal(d.rows.find(r=>r.sourceNotes.auto_reason==='NULL').count,1);
 const orders=await call(db,{kind:'orders'});assert(orders.rows.every(r=>r.sourceNotes.audit_remark==='[]'&&r.sourceNotes.reason==='null'&&r.sourceNotes.withdraw_remark==='{}'),'do not infer encoding semantics for unrelated note columns');
 }finally{await db.close()}
});
