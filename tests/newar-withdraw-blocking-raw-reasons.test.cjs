// Synthetic business labels only. No production orders, source notes or credentials.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const repo=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const migration=read('supabase/migrations/20261011073315_newar_withdraw_blocking_raw_reasons.sql');
const baseline=read('tests/fixtures/newar-withdraw-reasons-production.sql');
const reader='private.dashboard_admin_live_withdraw_reasons(jsonb)',helper='private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)';
const prefix=p=>read(p).split('\ntest(')[0];
const projection=new Function('require','__dirname',prefix('tests/newar-withdraw-fact-projection.test.cjs')+'\nreturn{fixture,install,raw,order,coverage};')(require,__dirname);
const taxonomy=new Function('require','__dirname',prefix('tests/withdraw-blocking-shared-taxonomy.test.cjs')+'\nreturn{fixture,migration};')(require,__dirname);
let noteDefinitions;
async function notes(){if(!noteDefinitions)noteDefinitions=(async()=>{const db=await taxonomy.fixture();try{await db.exec(taxonomy.migration);
 return(await db.query("select pg_get_functiondef(oid) d,proname from pg_proc where pronamespace='private'::regnamespace and (proname like 'dashboard_admin_live_%note' or proname like 'dashboard_admin_live_%note_%' or proname like 'dashboard_admin_live_blocking_%' or proname like 'dashboard_admin_live_rejection_%') and proname<>'dashboard_admin_live_withdraw_reasons' order by proname")).rows.map(r=>r.d+';').join('\n');
 }finally{await db.close()}})();return noteDefinitions;}
async function fixture(){const db=await projection.fixture();try{
 await db.exec('set check_function_bodies=off');await db.exec(await notes());await db.exec('set check_function_bodies=on');
 await db.exec(`create function private.dashboard_admin_live_scope() returns jsonb language sql stable set search_path='' as $$
 select coalesce(nullif(current_setting('test.scope',true),'')::jsonb,'{}'::jsonb)$$;
 create or replace function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable set search_path='' as $$
 select not coalesce((s->>'denied')::boolean,false) and case when s ? 'targets' then exists(select 1 from jsonb_array_elements(s->'targets')t
 where t->>0=case c when 'IN' then '印度' when 'BR' then '巴西' else c end
 and private.dashboard_admin_live_withdraw_key(t->>1)=private.dashboard_admin_live_withdraw_key(p)) else true end$$;
 create function private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb) returns jsonb language sql stable as $$select null::jsonb$$;
 drop function private.dashboard_admin_live_platforms();
 create function private.dashboard_admin_live_platforms() returns table(name text,country text,source_name text,timezone text,source text,scope_group text) language sql stable set search_path='' as $$
 select case platform when 'DhaniWin' then 'DHANIWIN' when 'MAANWIN' then 'MAAN.WIN' else platform end,country,platform,timezone,'newar',country_code from public.newar_detail_platforms where enabled
 union all values('SYNTHETIC-AR','印度','SYNTHETIC-AR','Asia/Kolkata','ar','IN'),('JAICLUB','印度','JAICLUB','Asia/Kolkata','ar','IN'),('SYNTHETIC-PANDA','巴西','SYNTHETIC-PANDA','America/Sao_Paulo','withdraw','BR')$$;
 create function private.dashboard_admin_live_withdraw_platforms() returns table(id uuid,name text,country text,source_name text,timezone text,source text,scope_group text) language sql stable set search_path='' as $$select '00000000-0000-4000-8000-000000000001'::uuid,p.* from private.dashboard_admin_live_platforms()p$$;
 create function private.dashboard_admin_ar_local_amount(text,text,text,integer,numeric,text,text,numeric) returns numeric language sql immutable as $$select $8$$;
 create table public.ar_collected_orders(source_system text,country_code text,platform text,order_kind text,order_no text,amount numeric,status text,operator text,applied_at timestamp,completed_at timestamp,manual_remark text,remark text,raw_channel text,updated_at timestamptz,channel_type text,money_format_version integer,amount_local numeric,currency_local text,money_issue_code text);
 create table public.auto_withdraw_daily(country text,platform text,data_date date,total bigint,updated_at timestamptz);
 create table public.dashboard_platform_team_map(country_name text,country_code text,active boolean);
 create table public.withdraw_reasons_daily(country_code text,platform text,stat_date date,source_system text,snapshot jsonb,updated_at timestamptz);
 create view public.withdraw_reasons_daily_grouped as select * from public.withdraw_reasons_daily;`);
 await db.exec('set check_function_bodies=off');await db.exec(baseline);await db.exec('set check_function_bodies=on');
 const funcs=(await db.query("select oid::regprocedure::text sig from pg_proc where pronamespace='private'::regnamespace and (proname like 'dashboard_admin_live_%note' or proname like 'dashboard_admin_live_%note_%' or proname like 'dashboard_admin_live_blocking_%' or proname like 'dashboard_admin_live_rejection_%')")).rows;
 for(const f of funcs)await db.exec(`revoke all on function ${f.sig} from public,anon,authenticated,service_role`);
 await db.exec(`revoke all on function ${reader} from public,anon,authenticated,service_role;grant execute on function ${reader} to authenticated;`);
 await db.exec(projection.install);assert.equal((await meta(db,reader)).hash,'602ca2fec8c9460eb4f9efb3f639ea35');return db;
 }catch(e){await db.close();throw e}}
const meta=async(db,sig)=>(await db.query("select md5(prosrc) hash,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid=$1::regprocedure",[sig])).rows[0];
const request=extra=>({country:'印度',platform:'DHANIWIN',date:'2026-10-10',kind:'blocking',...extra});
const call=async(db,extra={})=>(await db.query('select private.dashboard_admin_live_withdraw_reasons($1::jsonb) d',[JSON.stringify(request(extra))])).rows[0].d;
async function order(db,id,label,extra={}){
 const raw=projection.raw(extra.method??'manual',extra.operator||'Synthetic handler',{
 sourceSubmittedAt:'2026-10-10T00:00:00Z',sourceHandledAt:extra.handled===undefined?'2026-10-10T00:01:00Z':extra.handled,
 automaticReasonLabel:label,automaticReasonSource:'remark',memberNoteLabel:'MEMBER NOTE MUST NOT ENTER BLOCKING',memberNoteSource:'userRemark',withdrawDisplayState:'Native status',...(extra.raw||{})});
 const uuid=await projection.order(db,id,extra.platform||'DhaniWin',raw,{created_at:extra.created||'2026-10-10T00:00:00Z',captured_at:extra.captured||'2026-10-11T00:00:00Z',received_at:'2026-10-11T00:01:00Z',status_group:extra.status||'success',dataset:extra.dataset||'withdraw'});
 await db.query('update public.newar_detail_records set order_number=$1,amount=$2 where id=$3',['SYNTHETIC-'+id,extra.amount??'12.34567890',uuid]);return uuid;
}
const primary='免审未通过：用户充提差额不满足自动提现要求:';
test('current verified methods and manual labels conserve totals without borrowing legacy snapshot or member notes',async()=>{
 const db=await fixture();try{
 for(let i=0;i<3;i++)await order(db,'manual-known-'+i,primary+'-'+(100+i));
 await order(db,'manual-empty',null);await order(db,'auto-label','AUTOMATIC LABEL NOT A MANUAL REASON',{method:'auto'});await order(db,'unknown-label','UNVERIFIED',{method:'robot'});
 await db.query("insert into withdraw_reasons_daily values('IN','DHANI.WIN','2026-10-10','NEWAR',$1,now())",[{note_field:'remark',groups:[{reason_label:'LEGACY WRONG',operator_class:'manual',count:100}],totals:{manual:100}}]);
 await db.exec(migration);const d=await call(db);assert.equal(d.available,true);assert.equal(d.noteCount,4);assert.equal(d.coverage.collected,6);assert.equal(d.coverage.complete,false);assert.equal(d.snapshotFallback,false);
 assert.deepEqual(d.summary.operatorCounts,{total:6,manual:4,system:1,unknown:1,manualWithReason:3,manualWithoutReason:1});assert.equal(d.rows.reduce((s,r)=>s+r.count,0),4);
 assert.equal(d.rows.find(r=>r.reason==='充提差额未达免审要求').count,3);assert.equal(d.rows.find(r=>r.reason==='检测没备注').count,1);
 assert(!JSON.stringify(d).includes('MEMBER NOTE'));assert(!JSON.stringify(d).includes('LEGACY WRONG'));assert(!JSON.stringify(d).includes('AUTOMATIC LABEL'));
 assert.equal(d.reasonTextFormat,'sanitized_label_v1');assert.equal(d.reasonTextSanitized,true);
 }finally{await db.close()}
});
test('shared taxonomy retains unknown code/threshold distinctions and namespaces unavailable versus literal labels',async()=>{
 const db=await fixture();try{
 for(const[id,label]of [['501','Unknown bank condition 501'],['503','Unknown bank condition 503'],['A','首存金额大于19999.00,首存金额:20000'],['B','首存金额大于29999.00,首存金额:30000'],['null',null],['literal','检测没备注']])await order(db,id,label);
 await db.exec(migration);const d=await call(db);assert.equal(d.rows.length,6);assert.equal(new Set(d.rows.map(r=>r.reasonKey)).size,6);
 const same=d.rows.filter(r=>r.reason==='检测没备注');assert.equal(same.length,2);assert.deepEqual(new Set(same.map(r=>r.noteState)),new Set(['present','unknown']));assert.equal(d.summary.operatorCounts.manualWithReason,5);
 assert(d.rows.some(r=>r.reason.includes('19999')&&r.sourceReason.includes('19999.00')));assert(d.rows.some(r=>r.reason.includes('29999')&&r.sourceReason.includes('29999.00')));
 assert(d.rows.some(r=>r.reason==='Unknown bank condition 501'));assert(d.rows.some(r=>r.reason==='Unknown bank condition 503'));
 }finally{await db.close()}
});
test('variants and order pages use stable keys, exact counts, deterministic pagination and only sanitized text',async()=>{
 const db=await fixture();try{
 for(let i=0;i<23;i++)await order(db,String(i).padStart(2,'0'),primary+(i%2?'-100':'-200'),{status:['success','failed','pending'][i%3],handled:i===0?null:undefined});
 await db.exec(migration);const summary=await call(db),g=summary.rows[0];assert.equal(g.count,23);assert.equal(g.success+g.rejected+g.other,23);assert.equal(g.sourceVariantCount,2);
 const variants=await call(db,{kind:'blockingVariants',reasonKey:g.reasonKey});assert.equal(variants.total,2);assert.equal(variants.rows.reduce((s,r)=>s+r.count,0),23);assert(variants.rows.every(r=>r.canonicalReason===g.reason));
 const a=await call(db,{kind:'blockingOrders',reasonKey:g.reasonKey,limit:20}),b=await call(db,{kind:'blockingOrders',reasonKey:g.reasonKey,offset:20,limit:20});
 assert.equal(a.total,23);assert.equal(a.rows.length,20);assert.equal(b.rows.length,3);assert.equal(new Set([...a.rows,...b.rows].map(r=>r.orderNumber)).size,23);
 assert(a.rows.every(r=>!Object.hasOwn(r,'rawManualRemark')&&!Object.hasOwn(r,'memberNoteLabel')&&r.reasonTextSanitized===true));
 assert(a.rows.every(r=>r.manualRemark.startsWith(primary)&&r.status==='Native status'));
 const one=await call(db,{kind:'blockingOrders',reasonKey:g.reasonKey,query:'SYNTHETIC-00'});assert.equal(one.total,1);assert.equal(one.rows[0].completedAt,null);assert.equal(Number(one.rows[0].amount),12.3456789);
 const missing=await call(db,{kind:'blockingOrders',reasonKey:'a'.repeat(32)});assert.equal(missing.total,0);assert.deepEqual(missing.rows,[]);
 }finally{await db.close()}
});
test('only schema-2 remark provenance is eligible; malformed/missing labels remain unknown rather than member substitutes',async()=>{
 const db=await fixture();try{
 const values=[null,'',{},'x'.repeat(257),'Bad\ncontrol','Ignored wrong provenance','Unverified version'];
 for(let i=0;i<values.length;i++)await order(db,'bad'+i,values[i],{raw:i===5?{automaticReasonSource:'userRemark'}:i===6?{businessSchemaVersion:1}: {}});
 await db.exec(migration);const d=await call(db);assert.equal(d.noteCount,6);assert.equal(d.summary.operatorCounts.unknown,1);assert.equal(d.summary.operatorCounts.manualWithReason,0);assert.equal(d.summary.operatorCounts.manualWithoutReason,6);
 assert.equal(d.rows.length,1);assert.equal(d.rows[0].noteState,'unknown');assert.equal(d.rows[0].sourceReason,null);assert.equal(d.rows[0].sourceVariantCount,0);
 assert(!JSON.stringify(d).includes('MEMBER NOTE'));assert(!JSON.stringify(d).includes('Ignored wrong provenance'));
 }finally{await db.close()}
});
test('local midnight is half open and launch, future capture and coverage gaps cannot prove completeness',async()=>{
 const db=await fixture();try{
 await order(db,'before','Outside',{created:'2026-10-09T18:29:59.999Z'});await order(db,'start','Inside',{created:'2026-10-09T18:30:00Z'});await order(db,'end','Outside',{created:'2026-10-10T18:30:00Z'});
 await db.exec(migration);assert.equal((await call(db)).coverage.collected,1);
 await projection.coverage(db,'DhaniWin','2026-10-09T18:30:00Z','2026-10-10T06:00:00Z');await projection.coverage(db,'DhaniWin','2026-10-10T06:00:01Z','2026-10-10T18:30:00Z');
 assert.equal((await call(db)).coverage.complete,false);await projection.coverage(db,'DhaniWin','2026-10-10T06:00:00Z','2026-10-10T06:00:01Z');assert.equal((await call(db)).coverage.complete,true);
 const id=await order(db,'future','Future',{captured:'2099-01-01T00:00:00Z'});assert.equal((await call(db)).coverage.complete,false);await db.query('delete from newar_detail_records where id=$1',[id]);
 await db.exec("update newar_detail_platforms set launch_at='2026-10-10T01:00:00Z' where platform='DhaniWin'");const d=await call(db);assert.equal(d.coverage.collected,0);assert.equal(d.available,false);assert.equal(d.coverage.complete,false);
 }finally{await db.close()}
});
test('complete zero requires full uninvalidated coverage, not old snapshot dates or no observed rows',async()=>{
 const db=await fixture();try{await db.exec(migration);let d=await call(db);assert.equal(d.available,false);assert.equal(d.noteCount,null);assert.deepEqual(d.summary,{});
 await projection.coverage(db,'DhaniWin','2026-10-09T18:30:00Z','2026-10-10T18:30:00Z',{observed_at:'2099-01-01T00:00:00Z'});assert.equal((await call(db)).available,false);
 await projection.coverage(db,'DhaniWin','2026-10-09T18:30:00Z','2026-10-10T18:30:00Z',{invalidated_at:'2026-10-11T00:00:00Z'});assert.equal((await call(db)).available,false);
 await projection.coverage(db,'DhaniWin','2026-10-09T18:30:00Z','2026-10-10T18:30:00Z');d=await call(db);assert.equal(d.available,true);assert.equal(d.coverage.complete,true);assert.equal(d.noteCount,0);assert.equal(d.summary.operatorCounts.total,0);assert.deepEqual(d.rows,[]);
 }finally{await db.close()}
});
test('canonical aliases share one native platform/day while fresh scope and cross-country checks deny access',async()=>{
 const db=await fixture();try{await order(db,'one','Synthetic reason');await db.exec(migration);
 const before=await call(db);for(const platform of ['DHANI.WIN','DhaniWin']){const d=await call(db,{platform});assert.deepEqual(d.rows,before.rows);assert.equal(d.coverage.collected,1)}
 await db.exec(`set test.scope='{"targets":[["印度","DHANI.WIN"]]}'`);assert.equal((await call(db)).noteCount,1);await assert.rejects(call(db,{platform:'MAANWIN'}),/scope_denied/);await assert.rejects(call(db,{country:'巴西'}),/scope_denied/);
 await db.exec(`set test.scope='{"targets":[["巴西","DHANIWIN"]]}'`);await assert.rejects(call(db),/scope_denied/);
 await db.exec(`set test.scope='{"denied":true}'`);await assert.rejects(call(db),/scope_denied/);
 await db.exec("set test.scope='{}'");await assert.rejects(call(db,{country:'巴西'}),/platform_denied/);
 }finally{await db.close()}
});
test('AR raw-only/rejection/PANDA and invalid-request behavior remain identical; OID/metadata/ACL/replay are preserved',async()=>{
 const db=await fixture();try{
 await db.exec(`insert into ar_collected_orders values('AR','IN','SYNTHETIC-AR','withdraw','SYNTHETIC AR',100,'未通过','Synthetic handler','2026-10-10 12:00','2026-10-10 12:01','Synthetic manual','Exact rejection 501','',now(),null,null,null,null,null)`);
 await db.query("insert into withdraw_reasons_daily values('BR','SYNTHETIC-PANDA','2026-10-10','PANDA',$1,now())",[{note_field:'remark',groups:[{reason_label:'Synthetic exact 501',operator_class:'manual',classification:'template',count:2,success:1,reject:1,other:0}]}]);
 const reqs=[{platform:'SYNTHETIC-AR'},{platform:'SYNTHETIC-AR',kind:'rejection'},{platform:'SYNTHETIC-AR',kind:'orders'},{platform:'JAICLUB'},{country:'巴西',platform:'SYNTHETIC-PANDA'},{kind:'rejection'}];
 const before=[];for(const r of reqs)before.push(await call(db,r));const m=await meta(db,reader);
 assert.equal(before[3].available,false);assert.equal(before[3].coverage.state,'no_received_facts');assert.equal(before[3].snapshotFallback,false);
 await db.exec(migration);assert.deepEqual((await meta(db,reader)).metadata,m.metadata);assert.equal((await meta(db,reader)).hash,'f24047cc2ac6669a2cc251e6ecb6851c');
 for(const[i,r]of reqs.entries())assert.deepEqual(await call(db,r),before[i]);const h=await meta(db,helper);await db.exec(migration);assert.deepEqual(await meta(db,helper),h);
 for(const role of ['anon','service_role'])assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') ok',[role,reader])).rows[0].ok,false);
 for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') ok',[role,helper])).rows[0].ok,false);
 assert.equal((await db.query("select has_function_privilege('authenticated',$1,'execute') ok",[reader])).rows[0].ok,true);
 await db.exec('set role authenticated');assert.deepEqual(await call(db,{platform:'SYNTHETIC-AR'}),before[0]);
 await assert.rejects(db.query('select private.dashboard_admin_newar_withdraw_reasons($1::jsonb,$2::jsonb,$3::jsonb)',[JSON.stringify(request()),'{}','{}']),/permission denied/);
 await db.exec('reset role');
 for(const r of [{kind:'blockingVariants'},{kind:'blocking',query:'a'},{kind:'blockingOrders',reasonKey:'invalid'},{offset:-1},{limit:25},{unknown:true}])await assert.rejects(call(db,r),/invalid_/);
 }finally{await db.close()}
});
test('definition, taxonomy, private facts, trigger and helper drift reject atomically before touching latest AR reader',async()=>{
 for(const drift of ['reader','reader-acl','taxonomy','facts-acl','trigger','helper']){const db=await fixture();try{
 if(drift==='reader')await db.exec(baseline.replace('v_ar_raw_only boolean','v_ar_raw_only boolean /* unreviewed */'));
 if(drift==='reader-acl')await db.exec(`grant execute on function ${reader} to anon`);
 if(drift==='taxonomy')await db.exec('alter function private.dashboard_admin_live_clean_note(text) volatile');
 if(drift==='facts-acl')await db.exec('grant select on private.newar_withdraw_facts to authenticated');
 if(drift==='trigger')await db.exec('alter table public.newar_detail_records disable trigger newar_detail_withdraw_fact_sync');
 if(drift==='helper'){await db.exec(migration);await db.exec(`alter function ${helper} security definer`)}
 const before=await meta(db,reader);await assert.rejects(db.exec(migration),/drift/);await db.exec('rollback');assert.deepEqual(await meta(db,reader),before);
 }finally{await db.close()}}
});
