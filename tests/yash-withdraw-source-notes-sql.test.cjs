// Production ingest baseline and synthetic notes only; no live source requests.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(p,'utf8'),schema=read('supabase/migrations/20261011074133_yash_withdraw_source_notes.sql'),reader=read('supabase/migrations/20261011074139_yash_withdraw_source_notes_reader.sql');
let db;const token='c'.repeat(64),meta={id:'',source:'kb',scope_group:'IN',source_name:'YASH.BET',name:'YASH.BET',country:'印度'};
const row=(id,extra={})=>({source_site:'yash',order_type:'withdrawal',order_no:id,uid:'SYNTHETIC-MEMBER',operator:'SYNTHETIC-OPERATOR',status:'已提现',amount:'100.12345678',currency:'INR',currency_basis:'source_field',created_at:'2026-10-09T19:00:00Z',completed_at:'2026-10-09T19:01:00Z',source_timezone:'Asia/Kolkata',observed_at:'2026-10-11T00:00:00Z',raw_fields:{},...extra});
const ingest=async records=>(await db.query('select public.yash_order_ingest($1,$2) result',[token,{action:'ingest',schema_version:1,records}])).rows[0].result;
const notes=async(extra={},scope={mode:'all'},metadata=meta)=>(await db.query('select private.dashboard_admin_yash_withdraw_reasons($1,$2,$3) result',[{country:'印度',platform:'YASH.BET',date:'2026-10-10',kind:'blocking',...extra},scope,metadata])).rows[0].result;
before(async()=>{db=new PGlite();await db.exec("create role anon;create role authenticated;create role service_role bypassrls;set check_function_bodies=off;");await db.exec(read('supabase/migrations/20261009044014_yash_order_ingest.sql'));await db.exec("alter table private.yash_orders alter column discount_percent type numeric;alter table private.yash_orders drop constraint yash_orders_check;");await db.exec(read('tests/fixtures/yash-source-notes-production-ingest.sql'));await db.exec("revoke all on function public.yash_order_ingest(text,jsonb) from public,anon,authenticated;grant execute on function public.yash_order_ingest(text,jsonb) to service_role;");await db.exec('grant usage on schema private to service_role;');await db.exec(schema);await db.exec(`create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable as $$select coalesce(s->>'mode'='all' or s->'platforms' @> jsonb_build_array(jsonb_build_object('country',c,'platform',p)),false)$$;create function private.dashboard_admin_yash_day_evidence(text,text,text,date) returns jsonb language sql stable as $$select '{"complete":false,"sourceCount":null}'::jsonb$$;create function private.dashboard_admin_yash_status(k text,s text) returns text language sql immutable as $$select case s when '已提现' then 'success' when '已驳回' then 'rejected' else 'pending' end$$;`);await db.exec(`create function private.dashboard_admin_live_scope() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('test.notes_scope',true),''),'{\"mode\":\"all\"}')::jsonb$$;
create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select upper($1)$$;
create function private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb) returns jsonb language sql stable as $$select null::jsonb$$;
create function private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb) returns jsonb language sql stable as $$select null::jsonb$$;
create function private.dashboard_admin_live_platforms() returns table(id uuid,source text,scope_group text,source_name text,name text,country text) language sql stable as $$select md5('kb:IN:YASH.BET')::uuid,'kb','IN','YASH.BET','YASH.BET','印度'$$;
create function private.dashboard_admin_live_withdraw_platforms() returns table(id uuid,source text,scope_group text,source_name text,name text,country text) language sql stable as $$select * from private.dashboard_admin_live_platforms()$$;
create table public.dashboard_platform_team_map(country_code text,country_name text,active boolean);
create table public.auto_withdraw_daily(country text,data_date date,platform text,total bigint,updated_at timestamptz);
`);await db.exec(read('tests/fixtures/yash-source-notes-production-reasons.sql'));await db.exec(read('tests/fixtures/yash-source-notes-production-auto.sql'));await db.exec('revoke all on function private.dashboard_admin_live_withdraw_reasons(jsonb),private.dashboard_admin_live_auto_withdraw(jsonb) from public,anon,service_role;grant execute on function private.dashboard_admin_live_withdraw_reasons(jsonb),private.dashboard_admin_live_auto_withdraw(jsonb) to authenticated;grant usage on schema private to authenticated');await db.exec(reader);meta.id=(await db.query("select md5('kb:IN:YASH.BET')::uuid::text id")).rows[0].id;await db.query("insert into private.yash_ingest_credentials(token_hash,label,expires_at) values($1,'synthetic',now()+interval '1 day')",[token]);});
after(async()=>db?.close());
test('old rows, empty notes and two distinct source fields retain provenance without creating a processing class',async()=>{
 await ingest([row('SYNTHETIC-MISSING'),row('SYNTHETIC-EMPTY',{order_note:'',risk_note:''}),row('SYNTHETIC-TEXT',{order_note:'重复申请',risk_note:'余额不足；token=secret；手机号:9876543210',status:'已驳回'}),row('SYNTHETIC-REJECT-MISSING',{status:'已驳回'})]);
 const r=await notes();assert.equal(r.classificationAvailable,false);assert.equal(r.noteCount,4);assert.deepEqual(r.summary.sourceNoteStates,{present:1,empty:1,missing:2});assert.equal(r.summary.operatorCounts,undefined);assert.equal(r.sourceNoteFormat,'yash_withdraw_notes_v1');assert.equal(r.reasonTextSanitized,true);assert.equal(r.coverage.complete,false);assert.equal(r.rows.reduce((n,x)=>n+x.count,0),4);assert.doesNotMatch(JSON.stringify(r),/secret|9876543210|SYNTHETIC-MEMBER/);
 const rejects=await notes({kind:'categories'});assert.equal(rejects.noteCount,2);assert.deepEqual(rejects.summary.sourceNoteStates,{present:1,empty:0,missing:1});assert(rejects.rows.some(x=>x.sourceReason==='重复申请'));assert(!rejects.rows.some(x=>x.sourceReason?.includes('余额不足')));
});
test('native identifiers and exact amount survive sanitization while secrets never reach stored notes',async()=>{
 const id='12345678901234567890123456789';await ingest([row(id,{risk_note:'余额不足；订单 '+id+'；token=secret；https://private.example',discount_percent:'-1.12345678901234567890',completed_at:'2026-10-09T18:59:00Z'})]);
 const r=await notes(),group=r.rows.find(x=>x.sourceReason?.includes(id));assert(group);const detail=await notes({kind:'blockingOrders',reasonKey:group.reasonKey});assert.equal(detail.total,1);assert.equal(detail.rows[0].orderNumber,id);assert.equal(detail.rows[0].amount,'100.12345678');assert.equal(detail.rows[0].riskNoteState,'present');assert.doesNotMatch(detail.rows[0].riskNote,/secret|private\.example/);
 const value=(await db.query('select discount_percent::text amount from private.yash_orders where order_no=$1',[id])).rows[0];assert.equal(value.amount,'-1.12345678901234567890');
});
test('short identifiers cannot split contact patterns and null/empty source notes remain distinct',async()=>{
 for(const id of ['1','123','91','9912398765']){
  const result=(await db.query('select private.dashboard_admin_yash_note_text($1,$2) note',['订单 '+id+'；+91 9912398765；https://private.example/'+id+'；mail'+id+'@private.test；0x'+id.padEnd(40,'a')+'；Bearer abc'+id+'token',[id]])).rows[0].note;assert.doesNotMatch(result,/\+91 9912398765|private\.example|private\.test|0x[0-9a-f]{40}|abc.*token/);if(id.length<7)assert.match(result,new RegExp('订单 '+id));
 }
 const id='12345678901234567890123456789',result=(await db.query('select private.dashboard_admin_yash_note_text($1,$2) note',['[业务标识\uE100]；订单 '+id,[id]])).rows[0].note;assert.match(result,new RegExp(id));assert.match(result,/\[业务标识\uE100\]/);
});
test('short credential assignments are redacted before native identifier protection',async()=>{
 const value=(await db.query('select private.dashboard_admin_yash_note_text($1,$2) note',['订单 123；passwd=abcde；seed=seedvalue；totp=123456；otp_secret=abcdef；助记词=alpha beta gamma',['123']])).rows[0].note;
 assert.match(value,/订单 123/);assert.doesNotMatch(value,/abcde|seedvalue|123456|alpha beta gamma/);
});
test('legacy updates preserve captured notes, explicit empty/null and newer source snapshots remain authoritative',async()=>{
 await ingest([row('SYNTHETIC-TEXT',{observed_at:'2026-10-11T01:00:00Z'})]);let value=(await db.query("select order_note,risk_note from private.yash_orders where order_no='SYNTHETIC-TEXT'")).rows[0];assert.equal(value.order_note,'重复申请');assert.match(value.risk_note,/余额不足/);
 await ingest([row('SYNTHETIC-TEXT',{order_note:null,risk_note:'',observed_at:'2026-10-11T02:00:00Z'})]);await ingest([row('SYNTHETIC-TEXT',{order_note:'STALE',risk_note:'STALE',observed_at:'2026-10-11T00:00:00Z'})]);value=(await db.query("select order_note,risk_note from private.yash_orders where order_no='SYNTHETIC-TEXT'")).rows[0];assert.deepEqual(value,{order_note:null,risk_note:''});
});
test('oversize/structured/deposit notes reject atomically, and unauthorized sources cannot reach the helper',async()=>{
 for(const extra of [{risk_note:'x'.repeat(2001)},{risk_note:{}},{order_type:'deposit',status:'充值成功',risk_note:null}])await assert.rejects(()=>ingest([row('SYNTHETIC-ROLLBACK'),row('SYNTHETIC-BAD',extra)]),/YASH_INVALID_NOTE/);
 assert.equal((await db.query("select count(*) n from private.yash_orders where order_no='SYNTHETIC-ROLLBACK'")).rows[0].n,0);
 for(const [scope,m]of [[{mode:'selected',platforms:[]},meta],[{mode:'all'},{...meta,scope_group:'PK'}],[{mode:'all'},{...meta,id:'00000000-0000-0000-0000-000000000000'}]])await assert.rejects(()=>notes({},scope,m),/scope_denied/);
 assert.equal(await notes({}, {mode:'all'},{...meta,source:'ar'}),null);
 for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_function_privilege($1,'private.dashboard_admin_yash_withdraw_reasons(jsonb,jsonb,jsonb)','EXECUTE') value",[role])).rows[0].value,false);
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_table_privilege($1,'private.yash_orders','SELECT') value",[role])).rows[0].value,false);
});
test('real service-role ingestion can execute the private sanitizer while public clients cannot',async()=>{
 await db.exec('set role service_role');try{assert.equal((await ingest([row('SYNTHETIC-SERVICE',{risk_note:'余额不足',order_note:''})])).accepted,1);}finally{await db.exec('reset role');}
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await assert.rejects(()=>ingest([row('SYNTHETIC-DENIED')]),/permission denied/);await assert.rejects(()=>notes(),/permission denied/);}finally{await db.exec('reset role');}}
});
test('schema replay preserves metadata and state while sanitizer/body drift fail closed',async()=>{
 const before=(await db.query("select md5(prosrc) hash,proacl::text acl,proowner,prosecdef,provolatile,proconfig from pg_proc where oid='public.yash_order_ingest(text,jsonb)'::regprocedure")).rows[0];await db.exec(schema);const after=(await db.query("select md5(prosrc) hash,proacl::text acl,proowner,prosecdef,provolatile,proconfig from pg_proc where oid='public.yash_order_ingest(text,jsonb)'::regprocedure")).rows[0];assert.deepEqual(after,before);assert.equal(after.hash,'302257476efa96609f79686637ea7548');
 await db.exec('begin');await db.exec('revoke execute on function public.yash_order_ingest(text,jsonb) from service_role');await assert.rejects(()=>db.exec(schema),/contract_drift/);await db.exec('rollback');
});
test('replay refuses sanitizer body, ACL, config and named constraint drift before replacing ingest',async()=>{
 const original=(await db.query("select pg_get_functiondef('private.dashboard_admin_yash_note_text(text,text[])'::regprocedure) d")).rows[0].d;
 const attempts=[original.replace('return v;','return upper(v);'),'grant execute on function private.dashboard_admin_yash_note_text(text,text[]) to authenticated',"alter function private.dashboard_admin_yash_note_text(text,text[]) set search_path='public'",'alter table private.yash_orders drop constraint yash_risk_note_length;alter table private.yash_orders add constraint yash_risk_note_length check(risk_note is null or length(risk_note)<=3000) not valid'];
 for(const sql of attempts){await db.exec('begin');await db.exec(sql);await assert.rejects(()=>db.exec(schema),/contract_drift/);await db.exec('rollback');assert.equal((await db.query("select md5(prosrc) hash from pg_proc where oid='public.yash_order_ingest(text,jsonb)'::regprocedure")).rows[0].hash,'302257476efa96609f79686637ea7548');}
});
test('India day boundaries and completed-empty receipts distinguish zero from not received',async()=>{
 const unknown=await notes({date:'2026-10-08'});assert.equal(unknown.available,false);assert.equal(unknown.noteCount,null);assert.match(unknown.message,/不能推定/);
 await db.exec(`create or replace function private.dashboard_admin_yash_day_evidence(text,text,text,date) returns jsonb language sql stable as $$select '{"complete":true,"sourceCount":0}'::jsonb$$;`);const empty=await notes({date:'2026-10-08'});assert.equal(empty.available,true);assert.equal(empty.noteCount,0);assert.deepEqual(empty.rows,[]);
 await ingest([row('SYNTHETIC-BOUND-BEFORE',{created_at:'2026-10-09T18:29:59.999999Z',completed_at:null,risk_note:'before'}),row('SYNTHETIC-BOUND-START',{created_at:'2026-10-09T18:30:00Z',completed_at:null,risk_note:'start'}),row('SYNTHETIC-BOUND-END',{created_at:'2026-10-10T18:30:00Z',completed_at:null,risk_note:'end'})]);const groups=(await notes()).rows;assert(groups.some(x=>x.sourceReason==='start'));assert(!groups.some(x=>x.sourceReason==='before'||x.sourceReason==='end'));
});

test('fresh authenticated parent dispatches YASH notes and preserves all source branches and metadata',async()=>{
 const q={country:'印度',platform:'YASH.BET',date:'2026-10-10',kind:'blocking'};
 await db.exec('set role authenticated');try{const value=(await db.query('select private.dashboard_admin_live_withdraw_reasons($1) result',[q])).rows[0].result;assert.equal(value.sourceNoteFormat,'yash_withdraw_notes_v1');assert.equal(value.classificationAvailable,false);assert.equal(value.reasonAvailable,true);}finally{await db.exec('reset role');}
 await db.exec(`set test.notes_scope='{"mode":"selected","platforms":[]}'`);await db.exec('set role authenticated');try{await assert.rejects(()=>db.query('select private.dashboard_admin_live_withdraw_reasons($1)',[q]),/scope_denied/);}finally{await db.exec('reset role');await db.exec("set test.notes_scope=''");}
 for(const [name,hash] of [['reasons','b1b3aa50ae5c05ab9c98acf446c601ab'],['auto','f9ac67304f2b5fae66a8b35f080ab981']]){
  const sig=name==='reasons'?'private.dashboard_admin_live_withdraw_reasons(jsonb)':'private.dashboard_admin_live_auto_withdraw(jsonb)',value=(await db.query('select md5(prosrc) hash,prosecdef,proacl::text acl,proconfig from pg_proc where oid=$1::regprocedure',[sig])).rows[0];assert.equal(value.hash,hash);assert.equal(value.prosecdef,true);assert.equal(value.acl,'{postgres=X/postgres,authenticated=X/postgres}');assert.deepEqual(value.proconfig,['search_path=""']);
 }
 const before=(await db.query("select prosrc from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure")).rows[0].prosrc;
 assert.equal((before.match(/'source','KB','classificationAvailable',false,'reasonAvailable',true,'sourceNotesAvailable',true/g)||[]).length,2);
 assert.match(before,/'autoCount',null,'manualCount',null/);assert.match(before,/unverified_source_continuity/);
 await db.exec(reader);assert.equal((await db.query("select prosrc from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure")).rows[0].prosrc,before);
});

test('blank optional category filters preserve parent semantics and stage prerequisites fail closed',async()=>{
 assert.deepEqual(await notes({kind:'categories',category:''}),await notes({kind:'categories'}));assert.deepEqual(await notes({kind:'categories',country:' 印度 ',platform:' YASH.BET '}),await notes({kind:'categories'}));
 await db.exec('begin');await db.exec('revoke execute on function private.dashboard_admin_yash_note_text(text,text[]) from service_role');await assert.rejects(()=>db.exec(reader),/prerequisite_drift/);await db.exec('rollback');
 await db.exec('begin');await db.exec('grant execute on function private.dashboard_admin_live_withdraw_reasons(jsonb) to anon');await assert.rejects(()=>db.exec(reader),/reasons_contract_drift/);await db.exec('rollback');
});
