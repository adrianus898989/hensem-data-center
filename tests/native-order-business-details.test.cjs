const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');let db;
const read=p=>fs.readFileSync(p,'utf8');
const uid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
test.before(async()=>{db=new PGlite();await db.exec(`
 create schema private;create role anon;create role authenticated;create role service_role;
 create table public.lg_orders(source_system text,country_code text,platform text,order_kind text,order_no text,operator_name text,operator_kind text,finished_at timestamptz,handle_seconds integer);
 create table private.duoli_order_details(country text,system_name text,platform text,business text,source_order_id text,created_at timestamptz,operator text,audit_completed_at timestamptz,audit_duration_seconds bigint,observed_at timestamptz);
 create table public.newar_detail_records(id uuid,platform text,dataset text,order_number text,captured_at timestamptz,raw jsonb);
 create table private.newar_withdraw_facts(record_id uuid,platform text,account text,method text,submitted_at timestamptz,handled_at timestamptz);
 create table public.ar_collected_orders(source_system text,country_code text,platform text,order_kind text,order_no text,operator text);
 create table private.yash_orders(source_site text,order_type text,order_no text,operator text);
 create table public.game66_withdraw_orders(platform_id uuid,id uuid,order_num text,audit_admin text,auto_commit text,lock_admin text,lock_user_admin text);
 insert into public.lg_orders values('LG','PH','LG-A','withdraw','N','agent-a','manual','2026-10-12T02:00Z',0),('LG','PH','LG-B','withdraw','N','FOREIGN','auto',null,99);
 insert into private.duoli_order_details values('ID','DOLI','DUO-A','withdraw','D1','2026-10-12T00:00Z','auditor','2026-10-12T00:02Z',120,'2026-10-12T01:00Z'),('ID','DOLI','DUO-B','withdraw','D1','2026-10-12T00:00Z','FOREIGN',null,999,'2026-10-12T01:00Z');
 insert into public.newar_detail_records values('${uid}','NEW-A','withdraw','NEW-N','2026-10-12T01:00Z','{"businessSchemaVersion":2,"automaticReasonSource":"remark","automaticReasonLabel":"source note","memberNoteSource":"userRemark","memberNoteLabel":"contact +5511999998888","private":"NEVER_RETURN"}');
 insert into private.newar_withdraw_facts values('${uid}','NEW-A','staff-c','manual','2026-10-12T00:00Z','2026-10-12T00:01Z');
 insert into public.ar_collected_orders values('AR','IN','AR-A','withdraw','A1','ar-agent'),('OTHER','IN','AR-A','withdraw','A1','FOREIGN');
 insert into private.yash_orders values('yash','withdrawal','Y1','yash-agent');
 insert into public.game66_withdraw_orders values('${uid}','${other}','G1','audit-staff','2',null,null);
 `);await db.exec(read('supabase/admin-live-order-business.sql'));});
test.after(async()=>{await db?.close()});
async function call(source,country,platform,rows,id=uid){return (await db.query('select private.dashboard_admin_order_business_result($1::jsonb,$2,$3,$4,$5::uuid) v',[JSON.stringify({total:17,summary:[{all_count:17}],rows}),source,country,platform,id])).rows[0].v;}
test('LG enriches bounded row with scope isolation, preserves summary, zero and original success timestamp',async()=>{
 const r={direction:'withdraw',order_number:'N',success_at:'2026-10-12T03:00Z'};
 const a=await call('lg','PH','LG-A',[r]);assert.equal(a.rows[0].operator_name,'agent-a');assert.equal(a.rows[0].operator_class,'manual');assert.equal(a.rows[0].processing_duration_seconds,0);assert.equal(a.rows[0].success_at,r.success_at);assert.equal(a.total,17);assert.deepEqual(a.summary,[{all_count:17}]);
 assert.deepEqual((await call('lg','IN','LG-A',[r])).rows,[r]);assert.deepEqual((await call('lg','PH','LG-A',[{...r,direction:'charge'}])).rows,[{...r,direction:'charge'}]);
});
test('DUOLI uses platform, business, indexed creation time and canonical identity, never calls audit a success time',async()=>{
 const id=(await db.query("select md5(jsonb_build_array('DOLI','DUO-A','withdraw','D1')::text)::uuid id")).rows[0].id;
 const r={id,direction:'withdraw',created_at:'2026-10-12T00:00Z',order_number:'D1',success_at:null};
 const a=(await call('duoli','ID','DUO-A',[r])).rows[0];assert.equal(a.audit_duration_seconds,120);assert.equal(a.operator_name,'auditor');assert.equal(a.processing_method_available,false);assert.equal(a.success_at,null);
 assert.deepEqual((await call('duoli','ID','DUO-B',[r])).rows,[r]);assert.deepEqual((await call('duoli','ID','DUO-A',[{...r,id:uid}])).rows,[{...r,id:uid}]);
});
test('NEWAR uses audited materialized facts, explicitly sourced safe labels and no raw object',async()=>{
 const r={id:uid,direction:'withdraw',order_number:'NEW-N'};
 const a=(await call('newar','IN','NEW-A',[r])).rows[0];assert.equal(a.operator_name,'staff-c');assert.equal(a.operator_class,'manual');assert.equal(a.processing_duration_seconds,60);assert.equal(a.automatic_business_note,'source note');assert.equal(a.member_business_note,'contact [已移除号码]');assert(!JSON.stringify(a).includes('NEVER_RETURN'));assert(!('raw' in a));
 assert.deepEqual((await call('newar','IN','NEW-B',[r])).rows,[r]);
});
test('AR, YASH, Game66 keep source and platform identity; unsupported/Panda has no fabricated fields',async()=>{
 assert.equal((await call('ar','IN','AR-A',[{direction:'withdraw',order_number:'A1'}])).rows[0].operator_name,'ar-agent');
 assert.equal((await call('kb','IN','YASH.BET',[{direction:'withdraw',order_number:'Y1'}])).rows[0].operator_name,'yash-agent');
 assert.equal((await call('game66','IN','GAME',[{id:other,direction:'withdraw',order_number:'G1'}])).rows[0].source_audit_mode,'2');
 const r={id:other,direction:'withdraw',order_number:'G1'};assert.deepEqual((await call('game66','IN','GAME',[r],other)).rows,[r]);assert.deepEqual((await call('panda','BR','PANDA',[r])).rows,[r]);
});
test('privacy sanitizer and private helpers deny every client role, invalid oversized pages fail closed',async()=>{
 const v=(await db.query("select private.dashboard_admin_order_business_text($1) v",['business https://example.com/private foo@example.com +5511999998888 0x'+'a'.repeat(40)])).rows[0].v;
 assert(!v.includes('example.com'));assert(!v.includes('551199'));assert(!v.includes('0x'));assert(v.includes('[已移除地址]'));
 for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_function_privilege($1,'private.dashboard_admin_order_business_result(jsonb,text,text,text,uuid)','execute') v",[role])).rows[0].v,false);
 await assert.rejects(()=>call('lg','PH','LG-A',Array(501).fill({})),/business_detail_page_invalid/);
});
test('all drawers share safe business rendering, escaping notes and retaining zero/unknown semantics',()=>{
 const window={};vm.runInNewContext(read('admin-preview/live-order-business.js'),{window});
 const E=v=>String(v??'—').replaceAll('<','&lt;').replaceAll('>','&gt;'),N=v=>String(v),formatTime=v=>v||'—',tools={E,N,formatTime};
 const out=window.HensemOrderBusiness.rows({direction:'withdraw',operator_name:'<staff>',operator_class:null,processing_duration_seconds:0,audit_duration_seconds:null,automatic_business_note:'<img src=x>',operated_at:'2026-10-12'}, {source:'wg',timezone:'UTC'},tools);
 const value=label=>out.find(x=>x[0]===label)?.[1];assert.equal(value('操作人'),'&lt;staff&gt;');assert.equal(value('处理方式'),'未提供');assert.equal(value('来源处理耗时'),'0 秒');assert.equal(value('来源审核耗时'),'—');assert(value('自动出款业务备注').includes('&lt;img'));
 assert.equal(window.HensemOrderBusiness.rows({direction:'withdraw',operator_name:'no'},{source:'panda'},tools).length,0);
 for(const file of ['live-data.js','live-provider-orders.js','live-analysis-drilldown.js'])assert.match(read('admin-preview/'+file),/HensemOrderBusiness\??\.rows/);
 assert.match(read('admin-preview/build-restoration.py'),/live-order-business\.js/);
});
test('migration adds the bounded hook once to both exact production readers, preserving ACL and full existing bodies',async()=>{
 const migration=read('supabase/migrations/20261012121350_native_order_business_details.sql');
 const before={};
 for(const name of ['dashboard_admin_live_query_raw','dashboard_admin_live_drilldown_raw','dashboard_admin_live_analysis_orders_raw']){
  await db.exec(read('tests/fixtures/order-business-'+name+'.sql'));
  await db.exec('revoke all on function private.'+name+'(jsonb) from public,anon,authenticated,service_role');
  before[name]=(await db.query("select to_jsonb(p)-'prosrc' meta,prosrc from pg_proc p where oid=$1::regprocedure",['private.'+name+'(jsonb)'])).rows[0];
 }
 await db.exec(migration);
 const addition='\n  v_result:=private.dashboard_admin_order_business_result(v_result,v_platform.source,v_platform.scope_group,v_platform.source_name,v_platform.id);';
 for(const name of Object.keys(before)){
  const after=(await db.query("select to_jsonb(p)-'prosrc' meta,prosrc from pg_proc p where oid=$1::regprocedure",['private.'+name+'(jsonb)'])).rows[0];
  assert.deepEqual(after.meta,before[name].meta);assert.equal(after.prosrc.split(addition).length,2);assert.equal(after.prosrc.replace(addition,'').replace("\n  if v_platform.source='wg' then v_result:=private.dashboard_admin_wg_order_result(v_result,v_platform.scope_group,v_platform.source_name);end if;",name==='dashboard_admin_live_analysis_orders_raw'?'':"\n  if v_platform.source='wg' then v_result:=private.dashboard_admin_wg_order_result(v_result,v_platform.scope_group,v_platform.source_name);end if;"),before[name].prosrc);
 }
 await assert.rejects(()=>db.exec(migration),/order_business_reader_baseline_drift/);await db.exec('rollback');
});
