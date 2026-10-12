const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20261012133326_lg_business_notes_reader.sql');
const signatures=['private.dashboard_admin_live_withdraw_reasons(jsonb)','private.dashboard_admin_live_auto_withdraw(jsonb)','private.dashboard_admin_order_business_result(jsonb,text,text,text,uuid)'];
const good={businessSchemaVersion:1,remark:'BUSINESS NOTE',remarkState:'present',appRemark:'',appRemarkState:'empty'};
async function fixture(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;
 create table public.lg_orders(source_system text default 'LG',country_code text default 'PH',platform text default 'SUPERLG',order_kind text default 'withdraw',order_no text,
 metric_amount numeric default 123.4500,status_class text default 'rejected',status_text text default '驳回',created_at timestamptz default '2026-10-12T00:00Z',updated_at timestamptz default '2026-10-13T00:00Z',operator_name text default 'OP_A',operator_kind text default 'manual',finished_at timestamptz,handle_seconds integer,raw jsonb default '{}');
 create index lg_notes_day on public.lg_orders(country_code,platform,order_kind,created_at);
 create function public.lg_platform_country(text) returns text language sql immutable as $$select case $1 when 'SUPERLG' then 'PH' when 'LG111' then 'ID' when 'LG789' then 'PK' end$$;
 create function public.lg_country_timezone(text) returns text language sql immutable as $$select case $1 when 'PH' then 'Asia/Manila' when 'ID' then 'Asia/Jakarta' when 'PK' then 'Asia/Karachi' end$$;
 create function private.dashboard_admin_live_scope() returns jsonb language sql stable set search_path='' as $$select jsonb_build_object('denied',coalesce(current_setting('test.denied',true),'no')='yes')$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable set search_path='' as $$select not coalesce(($1->>'denied')::boolean,false) and $2 in('菲律宾','PH') and upper(replace($3,'.','')) in('SUPERLG','FRIENDLYLG')$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable set search_path='' as $$select upper(replace(btrim($1),'.',''))$$;
 create function private.dashboard_admin_live_platforms() returns table(id uuid,name text,source_name text,country text,source text,scope_group text,timezone text) language sql stable set search_path='' as $$select '00000000-0000-4000-8000-000000000001'::uuid,'FriendlyLG','SUPERLG','菲律宾','lg','PH','Asia/Manila'$$;
 create function private.dashboard_admin_live_withdraw_platforms() returns table(id uuid,name text,source_name text,country text,source text,scope_group text,timezone text) language sql stable set search_path='' as $$select * from private.dashboard_admin_live_platforms()$$;
 create function private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb) returns jsonb language sql as $$select null::jsonb$$;
 create function private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb) returns jsonb language sql as $$select null::jsonb$$;
 create table auto_withdraw_daily(country text,data_date date,platform text,total bigint,updated_at timestamptz);
 create table dashboard_platform_team_map(country_name text,country_code text,active boolean);
 create table ar_collected_orders(source_system text,country_code text,platform text,order_kind text,order_no text,operator text);
 set check_function_bodies=off;`);
 await db.exec(read('supabase/lg-business-notes-receiver.sql').split('create function private.lg_validate_business_raw')[0]);
 await db.exec(read('tests/lg-business-notes-fixtures/private.dashboard_admin_order_business_text.sql'));
 for(const sig of signatures){await db.exec(read('tests/lg-business-notes-fixtures/'+sig.split('(')[0]+'.sql'));await db.exec('revoke all on function '+sig+' from public,anon,authenticated,service_role;');}
 await db.exec('grant usage on schema private to authenticated;grant execute on function '+signatures[0]+' to authenticated;grant execute on function '+signatures[1]+' to authenticated;set check_function_bodies=on;');
 return db;
}
const call=async(db,extra={})=>(await db.query('select private.dashboard_admin_live_withdraw_reasons($1) d',[{country:'菲律宾',platform:'SUPERLG',date:'2026-10-12',kind:'categories',...extra}])).rows[0].d;
async function order(db,n,extra={}){const v={order_no:'ORDER-'+n,raw:good,...extra},keys=Object.keys(v);await db.query(`insert into lg_orders(${keys}) values(${keys.map((_,i)=>'$'+(i+1))})`,Object.values(v));}
const business=async(db,rows,source='lg',country='PH',platform='SUPERLG')=>(await db.query('select private.dashboard_admin_order_business_result($1,$2,$3,$4,null) d',[{rows,total:23},source,country,platform])).rows[0].d;
test('only rejected withdrawals enter notes; source field names, received-only coverage and old/missing/empty/redacted remain explicit',async()=>{const db=await fixture();try{
 await order(db,1);await order(db,2,{raw:{businessSchemaVersion:1,remark:'',remarkState:'empty',appRemark:'',appRemarkState:'empty'}});
 await order(db,3,{raw:{remark:'OLD-RAW-NEVER-DISPLAY',appRemark:'OLD-PRIVATE'}});await order(db,4,{raw:{...good,remark:'[已隐藏]',remarkState:'redacted'}});
 await order(db,5,{status_class:'success',raw:{...good,remark:'SUCCESS-MUST-NOT-COUNT'}});await order(db,6,{status_class:'failed'});await order(db,7,{order_kind:'recharge'});
 await db.exec(migration);const d=await call(db),orders=await call(db,{kind:'orders'});
 assert.equal(d.noteCount,4);assert.equal(d.summary.totalOrders,6);assert.deepEqual(d.summary.sourceNoteStates,{present:1,empty:1,redacted:1,missing:1});
 assert.deepEqual(d.coverage,{collected:6,expected:null,complete:false,basis:'created_at',state:'received_only'});assert.equal(d.rejectionReasonAvailable,false);assert.equal(d.classificationAvailable,false);
 assert.equal(orders.rows.length,4);assert.equal(orders.rows[0].amount,'123.4500');assert(orders.rows.every(r=>r.rejectionReason===null&&r.completedAt===null));
 assert(!JSON.stringify(orders).includes('OLD-'));assert(!JSON.stringify(d).includes('SUCCESS-MUST-NOT-COUNT'));
 const blocking=await call(db,{kind:'blocking'});assert.equal(blocking.available,false);assert.equal(blocking.noteCount,null);assert.match(blocking.message,/驳回订单业务备注/);
}finally{await db.close()}});
test('local created half-open day, native source/country/platform and fresh scope isolate every order; empty source day is unknown',async()=>{const db=await fixture();try{
 await order(db,'before',{created_at:'2026-10-11T15:59:59.999Z'});await order(db,'start',{created_at:'2026-10-11T16:00Z'});await order(db,'end',{created_at:'2026-10-12T16:00Z'});
 await order(db,'foreign',{platform:'LG111'});await order(db,'country',{country_code:'ID'});await order(db,'source',{source_system:'OTHER'});
 await db.exec(migration);assert.equal((await call(db)).noteCount,1);assert.deepEqual((await call(db,{platform:'FriendlyLG'})).rows,(await call(db,{platform:'SUPER.LG'})).rows);
 await db.exec("set test.denied='yes'");await assert.rejects(call(db),/scope_denied/);await db.exec("set test.denied='no'");await assert.rejects(call(db,{country:'印尼'}),/scope_denied/);
 const empty=await call(db,{date:'2026-10-10'});assert.equal(empty.available,false);assert.equal(empty.noteCount,null);
 await db.exec('set enable_seqscan=off');const plan=JSON.stringify((await db.query("explain select created_at from lg_orders where country_code='PH' and platform='SUPERLG' and order_kind='withdraw' and created_at>='2026-10-11T16:00Z' and created_at<'2026-10-12T16:00Z'" )).rows);assert.match(plan,/Index/);
}finally{await db.close()}});
test('stable source-note groups, operators, searches and two pages drill to the exact rejected cohort',async()=>{const db=await fixture();try{
 for(let i=0;i<23;i++)await order(db,i,{raw:{...good,remark:i%2?'NOTE_A':'NOTE_B'},operator_name:i%2?'OP_A':'OP_B'});
 await db.exec(migration);const groups=await call(db),a=await call(db,{kind:'orders'}),b=await call(db,{kind:'orders',offset:20}),g=groups.rows[0];
 assert.equal(a.rows.length,20);assert.equal(b.rows.length,3);assert.equal(new Set([...a.rows,...b.rows].map(r=>r.orderNumber)).size,23);
 const selected=await call(db,{kind:'orders',category:g.categoryKey});assert.equal(selected.total,g.count);assert(selected.rows.every(r=>r.sourceNotes.remark===g.sourceNotes.remark));
 assert.equal((await call(db,{kind:'orders',query:'ORDER-22'})).total,1);const operators=await call(db,{kind:'operators'});assert.equal(operators.total,2);
 assert.equal((await call(db,{kind:'orders',operatorKey:operators.rows[0].operatorKey})).total,operators.rows[0].count);
 for(const q of [{date:'bad'},{limit:5000},{reasonKey:'bad'},{kind:'invented'}])await assert.rejects(call(db,q),/invalid_/);
}finally{await db.close()}});
test('typed versioned notes and bounded business fields preserve long labels, decimal precision and transaction ID without raw private keys',async()=>{const db=await fixture();try{
 await db.exec(migration);
 const raw={...good,remark:'Business '.repeat(1000).trim(),appRemark:'phone: +1 555 555 5555',appRemarkState:'present',beforeRechargeWithdrawDiff:'-12345678901234567890.123456789012345678',feeAmount:'0.123456789012345678',totalOrderNum:7,
  appName:'Business App',transactionId:'12345678901234567890',groupList:[{groupId:0,groupName:'TEST GROUP',colorTag:'#ff00ff',phone:'PRIVATE-GROUP'}],phone:'PRIVATE-PHONE',memberName:'PRIVATE-NAME',token:'PRIVATE-TOKEN',nested:{private:'PRIVATE-NESTED'}};
 await order(db,'DETAIL',{raw,handle_seconds:0});await order(db,'CHARGE',{raw,order_kind:'recharge'});
 const a=(await business(db,[{direction:'withdraw',order_number:'ORDER-DETAIL',member_id:'12345678901234567890'}])).rows[0];
 assert.equal(a.lg_remark,raw.remark);assert.equal(a.lg_app_remark_state,'redacted');assert.equal(a.member_id,'12345678901234567890');assert.equal(a.processing_duration_seconds,0);
 assert.equal(a.source_business_fields.beforeRechargeWithdrawDiff,raw.beforeRechargeWithdrawDiff);assert.equal(a.source_business_fields.transactionId,raw.transactionId);assert.equal(a.source_business_fields.feeAmount,raw.feeAmount);
 assert.deepEqual(a.source_business_fields.groupList,[{groupId:'0',groupName:'TEST GROUP',colorTag:'#ff00ff'}]);assert(!JSON.stringify(a).includes('PRIVATE-'));assert(!('raw'in a));
 const charge=(await business(db,[{direction:'charge',order_number:'ORDER-CHARGE'}])).rows[0];assert.equal(charge.lg_remark,raw.remark);assert(!('processing_method_available'in charge));
 for(const raw of [{businessSchemaVersion:'1',remark:'TEXT',remarkState:'present'}, {...good,remark:{secret:'X'}},{...good,remark:'TEXT',remarkState:'empty'}]){const r=(await db.query('select private.dashboard_admin_lg_business_notes($1) d',[raw])).rows[0].d;assert.equal(r.sourceNoteStates.remark,'missing');assert.equal(r.sourceNotes.remark,null);}
}finally{await db.close()}});
test('only LG business branches change; existing summaries, AR projection, permissions and pg_proc metadata stay intact',async()=>{const db=await fixture();try{
 const before={};for(const sig of signatures)before[sig]=(await db.query("select to_jsonb(p)-'prosrc' meta,prosrc from pg_proc p where oid=$1::regprocedure",[sig])).rows[0];
 await db.exec(migration);await db.exec(migration);
 const {patches}=require('./lg-business-notes-build.cjs');for(const [name,old,added]of patches){const sig=signatures.find(s=>s.startsWith('private.'+name+'(')),after=(await db.query("select to_jsonb(p)-'prosrc' meta,prosrc from pg_proc p where oid=$1::regprocedure",[sig])).rows[0];assert.deepEqual(after.meta,before[sig].meta);assert.equal(after.prosrc.replace(added,old),before[sig].prosrc);}
 for(const helper of ['dashboard_admin_lg_business_notes(jsonb)','dashboard_admin_lg_business_fields(jsonb)','dashboard_admin_lg_withdraw_reasons(jsonb,jsonb,jsonb)'])for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_function_privilege($1,$2,'execute') v",[role,'private.'+helper])).rows[0].v,false);
 await db.exec("insert into ar_collected_orders values('AR','IN','AR-A','withdraw','AR1','agent')");const r={direction:'withdraw',order_number:'AR1'};assert.equal((await business(db,[r],'ar','IN','AR-A')).rows[0].operator_name,'agent');assert.deepEqual((await business(db,[r],'panda','BR','PANDA')).rows,[r]);
 await order(db,1);await db.exec('set role authenticated');assert.equal((await call(db)).noteCount,1);await db.exec('reset role');
}finally{await db.close()}});
test('metadata tagging is exact-native and preserves every other source and numerical value',async()=>{const db=await fixture();try{
 const {patches}=require('./lg-business-notes-build.cjs'),body=patches.find(p=>p[0]==='dashboard_admin_live_auto_withdraw')[2];
 await db.exec("create function private.test_lg_tag(v_result jsonb) returns jsonb language plpgsql as $t$ declare v_scope jsonb:=private.dashboard_admin_live_scope();begin "+body+' end $t$;');
 const rows=[{country:'菲律宾',platform:'SUPERLG',total:30},{country:'菲律宾',platform:'OTHER',source:'AR',total:5},{country:'LG',platform:'SUPERLG',total:11}];
 const d=(await db.query('select private.test_lg_tag($1) d',[{rows,totals:{total:46}}])).rows[0].d;assert.equal(d.rows[0].sourceNoteFormat,'lg_business_notes_v1');assert.deepEqual(d.rows.slice(1),rows.slice(1));assert.deepEqual(d.totals,{total:46});
 await db.exec("set test.denied='yes'");assert.deepEqual((await db.query('select private.test_lg_tag($1) d',[{rows}])).rows[0].d.rows,rows);
}finally{await db.close()}});
test('baseline/ACL/config drift aborts patch and helper replay drift is rejected',async()=>{for(const mutation of ['grant execute on function '+signatures[0]+' to anon','alter function '+signatures[1]+' cost 101','alter function '+signatures[2]+' set search_path=public']){const db=await fixture();try{await db.exec(mutation);await assert.rejects(db.exec(migration),/contract_drift/);await db.exec('rollback');}finally{await db.close()}}
 const db=await fixture();try{await db.exec(migration);await db.exec('grant execute on function private.dashboard_admin_lg_business_notes(jsonb) to service_role');await assert.rejects(db.exec(migration),/helper_drift/);await db.exec('rollback');}finally{await db.close()}}
);
