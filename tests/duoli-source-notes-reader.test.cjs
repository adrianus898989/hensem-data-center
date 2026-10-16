// Real gateway + new SQL, synthetic rows only. No external calls or credentials.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8'),dir='tests/fixtures/duoli-source-notes-reader/';
const migration=read('supabase/migrations/20261016053345_duoli_source_notes_reader.sql');
const field=(state='present',text='SYNTHETIC NOTE',extra={})=>({state,text:state==='present'?text:null,redacted:state==='withheld',truncated:false,...extra});
const projection=(a=field(),b=field('empty'))=>({version:1,fields:{condition:a,remark:b}});
async function fixture(){const db=new PGlite();try{await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;
 create table private.duoli_order_details(platform text default 'UANG',business text default 'withdraw',source_order_id text,country text default 'ID',system_name text default 'DOLI',order_no text,
 created_at timestamptz default '2026-10-15T00:00Z',updated_at timestamptz default '2026-10-15T01:00Z',status_code text default '4',status_text text default 'REJECTED',operator text default 'TEST_OPERATOR',observed_at timestamptz default '2026-10-15T02:00Z',currency text default 'IDR',amount_source text default 'gold',amount_raw text default '123.456789012345678901',primary key(platform,business,source_order_id));
 create index duoli_order_details_day_idx on private.duoli_order_details(platform,business,created_at);
 create table private.duoli_order_business_notes_v1(platform text,business text,source_order_id text,created_at timestamptz,source_updated_at timestamptz,source_status_code text,source_status_text text,source_operator text,observed_at timestamptz,note_projection jsonb,primary key(platform,business,source_order_id));
 alter table private.duoli_order_details enable row level security;alter table private.duoli_order_business_notes_v1 enable row level security;
 revoke all on private.duoli_order_details,private.duoli_order_business_notes_v1 from public,anon,authenticated,service_role;
 create function private.dashboard_admin_live_scope()returns jsonb language sql stable set search_path=''as $$select jsonb_build_object('denied',coalesce(current_setting('test.denied',true),'no')='yes')$$;
 create function private.dashboard_scope_allows(jsonb,text,text)returns boolean language sql immutable set search_path=''as $$select not coalesce(($1->>'denied')::boolean,false)and $2 in('ID','印尼')and upper(replace($3,'.',''))in('UANG','FRIENDLYUANG','FB168','FB333','HOT985','IND666')$$;
 create function private.dashboard_admin_live_withdraw_key(text)returns text language sql immutable set search_path=''as $$select upper(replace(btrim($1),'.',''))$$;
 create function private.dashboard_admin_live_platforms()returns table(id uuid,name text,source_name text,country text,source text,scope_group text,timezone text)language sql stable set search_path=''as $$select '00000000-0000-4000-8000-000000000001'::uuid,'FriendlyUang','UANG','印尼',coalesce(nullif(current_setting('test.source',true),''),'duoli'),'ID',coalesce(nullif(current_setting('test.zone',true),''),'Asia/Jakarta') union all select '00000000-0000-4000-8000-000000000002'::uuid,'FB168','FB168','印尼','duoli','ID','Asia/Jakarta'$$;
 create function private.dashboard_admin_live_withdraw_platforms()returns table(id uuid,name text,source_name text,country text,source text,scope_group text,timezone text)language sql stable set search_path=''as $$select * from private.dashboard_admin_live_platforms()$$;
 create function private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb)returns jsonb language sql as $$select null::jsonb$$;
 create function private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)returns jsonb language sql as $$select null::jsonb$$;
 create table public.auto_withdraw_daily(country text,data_date date,platform text,total bigint,updated_at timestamptz);
 create table public.dashboard_platform_team_map(country_name text,country_code text,active boolean);
 set check_function_bodies=off;`);
 for(const file of fs.readdirSync(path.join(root,dir)).filter(f=>f.endsWith('.sql')))await db.exec(read(dir+file));
 for(const x of JSON.parse(read(dir+'metadata.json')))await db.exec('revoke all on function '+x.signature+' from public,anon,authenticated,service_role;');
 await db.exec('grant usage on schema private to authenticated;grant execute on function private.dashboard_admin_live_withdraw_reasons(jsonb)to authenticated;set check_function_bodies=on;');
 return db;}catch(e){await db.close();throw e;}}
const call=async(db,extra={})=>(await db.query('select private.dashboard_admin_live_withdraw_reasons($1)d',[{country:'印尼',platform:'UANG',date:'2026-10-15',kind:'blocking',...extra}])).rows[0].d;
async function order(db,id,notes=projection(),extra={}){const x={source_order_id:id,order_no:'SYNTHETIC-'+id,...extra},keys=Object.keys(x);await db.query('insert into private.duoli_order_details('+keys.join(',')+')values('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',Object.values(x));if(notes!==null)await db.query(`insert into private.duoli_order_business_notes_v1 select platform,business,source_order_id,created_at,updated_at,status_code,status_text,operator,observed_at,$2 from private.duoli_order_details where platform=$3 and source_order_id=$1`,[id,notes,x.platform||'UANG']);}
test('source states remain separate; ordinary condition/remark never becomes verified cause or complete upstream coverage',async()=>{const db=await fixture();try{
 await order(db,'text');await order(db,'empty',projection(field('empty'),field('empty')));await order(db,'missing',null);
 await order(db,'hidden',projection(field('withheld'),field('missing')));await order(db,'invalid',projection(field('invalid'),field('empty')));
 await order(db,'stale');await db.exec("update private.duoli_order_details set updated_at=updated_at+interval'1 minute'where source_order_id='stale'");
 await order(db,'success',projection(field('present','SUCCESS TEXT')),{status_code:'6'});
 await db.exec(migration);const all=await call(db),rejected=await call(db,{kind:'categories'}),orders=await call(db,{kind:'orders'});
 assert.equal(all.noteCount,7);assert.equal(rejected.noteCount,6);assert.deepEqual(rejected.summary.sourceNoteStates,{present:1,empty:1,missing:1,withheld:1,invalid:1,stale:1});
 assert.equal(all.sourceNoteFormat,'duoli_withdraw_source_notes_v1');assert.equal(all.reasonAvailable,false);assert.equal(all.rejectionReasonAvailable,false);assert.equal(all.autoInterceptionReasonAvailable,false);assert.equal(all.coverage.complete,false);
 assert(orders.rows.every(r=>r.rejectionReason===null&&r.automaticInterceptionReason===null));assert(orders.rows.every(r=>r.amount==='123.456789012345678901'));
 const stale=orders.rows.find(r=>r.orderNumber==='SYNTHETIC-stale');assert.equal(stale.sourceNoteStates.condition,'stale');assert.equal(stale.sourceNotes.condition,null);assert.equal(stale.sourceNoteVersion,null);
 assert(!JSON.stringify(orders).includes('SUCCESS TEXT'));assert(!('raw'in orders.rows[0]));
 }finally{await db.close();}});
test('every retained source version field must still match; invalid envelopes and private-looking text fail closed',async()=>{const db=await fixture();try{
 const fields=['created_at','updated_at','status_code','status_text','operator'];for(const k of fields){await order(db,k);await db.exec(`update private.duoli_order_details set ${k}=${k}||' changed' where source_order_id='${k}'`.replace(`${k}=${k}||' changed'`,k.endsWith('_at')?`${k}=${k}+interval'1 second'`:k==='status_code'?`${k}='7'`:`${k}=${k}||' changed'`));}
 await order(db,'bad',{version:2,fields:{condition:{state:'present',text:'DO NOT LEAK'}}});
 await order(db,'privacy',projection(field('present','contact person@example.com https://example.com/secret +628123456789'),field('present','A'.repeat(400),{truncated:true,redacted:true})));
 await db.exec(migration);const r=await call(db,{kind:'orders'});for(const k of fields)assert.equal(r.rows.find(x=>x.orderNumber==='SYNTHETIC-'+k).sourceNoteStates.condition,'stale');
 assert(!JSON.stringify(r).includes('DO NOT LEAK'));assert(!JSON.stringify(r).includes('person@example.com'));assert(!JSON.stringify(r).includes('628123456789'));assert(!JSON.stringify(r).includes('/secret'));
 const privacy=r.rows.find(x=>x.orderNumber==='SYNTHETIC-privacy');assert.equal(privacy.sourceNoteFlags.condition.redacted,true);assert.equal(privacy.sourceNoteFlags.remark.truncated,true);assert.equal(privacy.sourceNotes.remark.length,256);
 }finally{await db.close();}});
test('native identity, fresh permissions and Jakarta half-open day isolate notes; client roles cannot read helper/table',async()=>{const db=await fixture();try{
 await order(db,'before',projection(),{created_at:'2026-10-14T16:59:59.999Z'});await order(db,'start',projection(),{created_at:'2026-10-14T17:00:00Z'});await order(db,'end',projection(),{created_at:'2026-10-15T17:00:00Z'});
 await order(db,'other-platform',projection(),{platform:'FB168'});await order(db,'other-country',projection(),{country:'XX'});await order(db,'other-system',projection(),{system_name:'OTHER'});await order(db,'charge',projection(),{business:'recharge'});
 await db.exec(migration);assert.equal((await call(db)).noteCount,1);assert.deepEqual((await call(db,{platform:'Friendly.Uang'})).rows,(await call(db)).rows);
 await db.exec("set test.denied='yes'");await assert.rejects(call(db),/scope_denied/);await db.exec("set test.denied='no';set test.zone='UTC'");await assert.rejects(call(db),/scope_denied/);await db.exec("set test.zone=''");
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(db.query('select * from private.duoli_order_business_notes_v1'),e=>e.code==='42501');await assert.rejects(db.query("select private.duoli_withdraw_source_notes('{}','{}','{}')"),e=>e.code==='42501');await db.exec('reset role');}
 await db.exec('set role authenticated');assert.equal((await call(db)).noteCount,1);await db.exec('reset role');
 const empty=await call(db,{date:'2026-10-10'});assert.equal(empty.available,false);assert.equal(empty.coverage.complete,false);
 await db.exec('set enable_seqscan=off');const plan=JSON.stringify((await db.query("explain select * from private.duoli_order_details where platform='UANG'and business='withdraw'and created_at>='2026-10-14T17:00Z'and created_at<'2026-10-15T17:00Z'" )).rows);assert.match(plan,/duoli_order_details_day_idx/);
 }finally{await db.close();}});
test('exact note combination drill and stable pagination retain original cohort without duplicate orders',async()=>{const db=await fixture();try{
 for(let i=0;i<27;i++)await order(db,String(i),projection(field('present',i%2?'ALPHA':'BETA')),{operator:i%2?'OP A':'OP B',status_code:i===26?'6':'4'});
 await db.exec(migration);const groups=await call(db),group=groups.rows[0],a=await call(db,{kind:'orders'}),b=await call(db,{kind:'orders',offset:20});
 assert.equal(a.rows.length,20);assert.equal(b.rows.length,6);assert.equal(new Set([...a.rows,...b.rows].map(r=>r.orderNumber)).size,26);
 const drill=await call(db,{kind:'blockingOrders',reasonKey:group.reasonKey});assert.equal(drill.total,group.count);assert(drill.rows.every(r=>r.sourceNotes.condition===group.sourceNotes.condition));
 assert.equal((await call(db,{kind:'orders',query:'SYNTHETIC-25'})).total,1);const op=(await call(db,{kind:'operators'})).rows[0];assert.equal((await call(db,{kind:'orders',operatorKey:op.operatorKey})).total,op.count);
 for(const invalid of [{kind:'invented'},{limit:5000},{reasonKey:'invalid'},{kind:'blockingOrders'},{query:'forbidden'}])await assert.rejects(call(db,invalid),/invalid_/);
 }finally{await db.close();}});
test('migration is repeatable and only changes the exact post-auth source branch; ACL/config/body drift stops installation',async()=>{const db=await fixture();try{
 const before=(await db.query("select to_jsonb(p)-'prosrc' meta,prosrc from pg_proc p where oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure")).rows[0];
 await db.exec(migration);await db.exec(migration);const after=(await db.query("select to_jsonb(p)-'prosrc' meta,prosrc from pg_proc p where oid='private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure")).rows[0];const build=require('./duoli-source-notes-reader-build.cjs');
 assert.deepEqual(after.meta,before.meta);assert.equal(after.prosrc.replace(build.addition,build.old),before.prosrc);assert.equal(build.sql,migration);
 await db.exec('grant execute on function private.duoli_withdraw_source_notes(jsonb,jsonb,jsonb)to authenticated');await assert.rejects(db.exec(migration),/contract_drift/);await db.exec('rollback');
 }finally{await db.close();}
 for(const mutation of ['grant execute on function private.dashboard_admin_live_withdraw_reasons(jsonb)to anon','alter function private.dashboard_admin_duoli_status(text,text)set search_path=public','grant select on private.duoli_order_business_notes_v1 to authenticated']){const x=await fixture();try{await x.exec(mutation);await assert.rejects(x.exec(migration),/contract_drift/);await x.exec('rollback');}finally{await x.close();}}
});
