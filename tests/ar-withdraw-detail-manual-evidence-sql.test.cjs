// Synthetic local PostgreSQL only; no source login, production SQL, secrets or credential fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),{test}=require('node:test');
const {w,read,H,fixture,info,snapshots,generations,helper,record,add,installObjects,installReaders}=(()=>{
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const w=path.resolve(__dirname,'..'),repo=w;
const migrationName='20261012114957_ar_verified_detail_manual_submit_evidence.sql';
const migrationText=fs.readFileSync(path.join(repo,'supabase/migrations',migrationName),'utf8');
const productionCode=fs.readFileSync(path.join(__dirname,'fixtures/ar-withdraw-detail-operator-production.sql'),'utf8');
function definition(code,name){const re=new RegExp('CREATE(?: OR REPLACE)? FUNCTION (?:private|public)\\.'+name+'\\([\\s\\S]*?AS (\\$[A-Za-z_0-9]*\\$)([\\s\\S]*?)\\1[;\\s]*','i'),m=code.match(re);if(!m)throw new Error('missing code-only fixture '+name);return m[0];}
const read=f=>f==='candidate/objects.sql'?'SET check_function_bodies=off;'+migrationText.match(/\$objects\$([\s\S]*?)\$objects\$/)[1]+'SET check_function_bodies=on;':f.startsWith('candidate/supabase/migrations/')?migrationText:definition(f.startsWith('baseline/')?productionCode:migrationText,path.basename(f,'.sql'));

const file=path.join(repo,'tests/ar-rejected-unknown-operator-manual-sql.test.cjs');
const ctx=vm.createContext({__dirname:path.dirname(file),require:n=>n==='node:test'?{test(){}}:createRequire(file)(n),structuredClone});
vm.runInContext(fs.readFileSync(file,'utf8').split(/\ntest\(/)[0]+';globalThis.h={fixture,core,add,prove,reasonCall};',ctx);const H=ctx.h;
async function fixture(){const db=await H.fixture();try{
 await db.exec('alter role service_role bypassrls');
 const scopeCode=fs.readFileSync(path.join(repo,'tests/fixtures/auto-withdraw-report-scope-once-production.sql'),'utf8');
 await db.exec('drop function private.dashboard_scope_allows(jsonb,text,text)');
 const platformScope=fs.readFileSync(path.join(repo,'supabase/migrations/20261010142948_dashboard_platform_data_scope.sql'),'utf8');await db.exec(platformScope.match(/create function private\.dashboard_scope_platform_key\([\s\S]*?\$key\$;/i)[0]);
 for(const name of ['dashboard_data_group','dashboard_data_scope_valid','dashboard_scope_platform_identity','dashboard_scope_allows']){
  const re=new RegExp('CREATE(?: OR REPLACE)? FUNCTION private\\.'+name+'\\([\\s\\S]*?AS (\\$[A-Za-z_0-9]*\\$)([\\s\\S]*?)\\1[;\\s]*','i');
  await db.exec(scopeCode.match(re)[0]);
 }
 await db.exec(fs.readFileSync(path.join(repo,'supabase/migrations/20261012045328_ar_rejected_unknown_operator_manual.sql'),'utf8'));
 for(const n of ['dashboard_admin_ar_withdraw_days','dashboard_admin_live_withdraw_reasons','ar_withdraw_fact_generation','ar_historical_duration_generation'])await db.exec(read('baseline/'+n+'.sql'));
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({mode:'all',countries:[]})]);
 // Catalog identities are fixture-only and remain under the original source/scope contract.
 await db.exec("insert into synthetic_catalog values(md5('jai')::uuid,'JAICLUB','M8','印度','IN','ar','Asia/Kolkata','INR','JAICLUB')");
 return db;
 }catch(e){await db.close();throw e}}
const info=(db,sig)=>db.query("select md5(prosrc)hash,to_jsonb(p)-'prosrc'meta,pg_get_functiondef(oid)d from pg_proc p where oid=$1::regprocedure",[sig]).then(x=>x.rows[0]);
const snapshots=db=>db.query("select jsonb_build_object('source',(select jsonb_agg(to_jsonb(a)order by source_system,country_code,platform,order_kind,order_no)from ar_collected_orders a),'facts',(select jsonb_agg(to_jsonb(f)order by platform,order_no)from private.ar_withdraw_facts f),'ready',(select jsonb_agg(to_jsonb(r)order by platform,data_date)from private.ar_withdraw_fact_ready r),'future',(select jsonb_agg(to_jsonb(r)order by platform)from private.ar_withdraw_fact_future_ready r),'cache',(select jsonb_agg(to_jsonb(r)order by platform,data_date)from private.ar_historical_duration_cache r),'hours',(select jsonb_agg(to_jsonb(r)order by platform,data_date,native_hour)from private.ar_historical_duration_hour_parts r))r").then(x=>x.rows[0].r);
const generations=db=>db.query('select private.ar_withdraw_fact_generation()facts,private.ar_historical_duration_generation()duration').then(x=>x.rows[0]);
const helper=(db,q={},s={mode:'all',countries:[]},day='2026-10-11')=>db.query('select to_jsonb(a)r from private.dashboard_admin_ar_withdraw_days($1,$2,$3::date,$3::date)a order by country,platform_key',[{country:'印度',...q},s,day]).then(x=>x.rows.map(r=>r.r));
const record=(db,id,patch={})=>{const v={source:'AR',country:'IN',platform:'91CLUB',kind:'withdraw',applied:'2026-10-11 12:00:00',label:'提交三方中',actor:'Synthetic_manual',submitted:'2026-10-11 12:01:00',callback:'system',file:'work/ar-detail-operator-contract/evidence/Synthetic.png',sha:'a'.repeat(64),...patch};return db.query('select private.record_ar_withdraw_detail_manual_evidence($1,$2,$3,$4,$5,$6::timestamp,$7,$8,$9::timestamp,$10,$11,$12)r',[v.source,v.country,v.platform,v.kind,id,v.applied,v.label,v.actor,v.submitted,v.callback,v.file,v.sha]).then(x=>x.rows[0].r)};
const add=(db,id,op=null,patch={})=>H.add(db,id,'已通过',op,{applied_at:'2026-10-11 12:00:00',completed_at:'2026-10-11 12:03:00',...patch});
const installObjects=db=>db.exec(read('candidate/objects.sql'));
const installReaders=async db=>{for(const n of ['dashboard_admin_ar_withdraw_days','dashboard_admin_live_withdraw_reasons','ar_historical_duration_generation'])await db.exec(read('candidate/'+n+'.sql'));};
return {w,repo,read,H,fixture,info,snapshots,generations,helper,record,add,installObjects,installReaders};

})();
const reader='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)',reason='private.dashboard_admin_live_withdraw_reasons(jsonb)';
const ownGeneration=db=>db.query('select private.ar_withdraw_detail_evidence_generation()g').then(x=>x.rows[0].g);
const evidenceCount=db=>db.query('select count(*)::int n from private.ar_withdraw_detail_operator_evidence').then(x=>x.rows[0].n);
const reasonCall=(db,p='91CLUB',extra={})=>H.reasonCall(db,{date:'2026-10-11',platform:p,...extra});
async function installed(){const db=await fixture();try{await installObjects(db);assert.match(await ownGeneration(db),/^[0-9a-f]{32}$/);await installReaders(db);return db}catch(e){await db.close();throw e}}
async function prove(db,p='91CLUB'){await db.exec('begin isolation level repeatable read');await db.query('select private.approve_ar_withdraw_fact_day($1,date\'2026-10-11\')',[p]);await db.exec('commit')}
const unchangedCounts=(a,b)=>{for(const k of ['total','success','rejected','auto_count','avg_seconds','duration_sample_count','duration_total_seconds','source_updated_at','updated_at','complete','alias_keys'])assert.deepEqual(a[k],b[k],k)};

test('blank listing plus verified manual submission changes only effective manual classification in raw and ready projected paths, never callback system',async()=>{const db=await installed();try{
 await db.exec('delete from ar_collected_orders');for(const[id,op]of[['manual-null',null],['manual-space','\u200b\ufeff\u3000\t'],['no-evidence',null],['callback-only',null],['literal-placeholder','none'],['list-system','system'],['list-manual','Original_actor']])await add(db,id,op);
 const before=(await helper(db,{platform:'91CLUB',view:'operators'}))[0],oldState=await snapshots(db),g=await generations(db);
 await record(db,'manual-null',{actor:'Exact_actor'});await record(db,'manual-space',{actor:null});
 await assert.rejects(()=>record(db,'callback-only',{label:'三方回调',actor:'system'}),/invalid_ar_detail_manual_evidence/);
 await assert.rejects(()=>record(db,'literal-placeholder'),/listing_changed/);await assert.rejects(()=>record(db,'list-system'),/listing_changed/);
 const after=(await helper(db,{platform:'91CLUB',view:'operators'}))[0];unchangedCounts(after,before);assert.equal(after.manual_count,before.manual_count+2);assert.equal(after.auto_count,1);assert.equal(after.total-after.manual_count-after.auto_count,3);assert.equal(after.operator_rows.find(o=>o.account==='Exact_actor').processed,1);assert(after.operator_rows.some(o=>o.account===''));
 assert.deepEqual(await snapshots(db),oldState,'sidecar is separate from raw and projected evidence');assert.deepEqual(await generations(db),g,'existing proof and duration generation unaffected');
 await prove(db);const projected=(await helper(db,{platform:'91CLUB',view:'operators'}))[0];assert.deepEqual(projected,after,'same 17 output fields from proven and raw mirror');
 const note=await reasonCall(db);assert.equal(note.summary.operatorCounts.manual,3);assert.equal(note.summary.operatorCounts.system,1);assert.equal(note.summary.operatorCounts.unknown,3);
 const pages=[];for(const group of note.rows){const page=await reasonCall(db,'91CLUB',{kind:'blockingOrders',reasonKey:group.reasonKey});pages.push(...page.rows)}
 const actual=pages.find(r=>r.orderNumber==='manual-null');assert.equal(actual.operator,'Exact_actor');assert.equal(actual.listingOperator,null);assert.equal(actual.operatorClassificationBasis,'detail_manual_submit');assert.equal(pages.find(r=>r.orderNumber==='manual-space').operator,null,'unknown actor stays null, not invented');
 }finally{await db.close()}});

test('exact native five keys/applied timestamp/day and scopes fence evidence; prior/no-order/other source identities stay unchanged',async()=>{const db=await installed();try{
 await db.exec('delete from ar_collected_orders');await add(db,'SAME-ID',null);await add(db,'SAME-ID',null,{platform:'JAICLUB'});await add(db,'SAME-ID',null,{country_code:'PK',platform:'92.GAME'});await add(db,'SAME-ID',null,{order_kind:'recharge'});await add(db,'SAME-ID',null,{source_system:'NEWAR'});await add(db,'BEFORE',null,{applied_at:'2026-10-09 12:00:00'});await add(db,'AFTER',null,{applied_at:'2026-10-12 00:00:00'});
 const foreign=await helper(db,{country:'巴基斯坦'}),jai=await helper(db,{platform:'JAICLUB'});await record(db,'SAME-ID');assert.equal((await helper(db,{platform:'91CLUB'}))[0].manual_count,1);assert.deepEqual(await helper(db,{country:'巴基斯坦'}),foreign);assert.deepEqual(await helper(db,{platform:'JAICLUB'}),jai);
 assert.deepEqual(await helper(db,{}, {mode:'selected',countries:[],platforms:[]}),[]);
 const denied={mode:'selected',countries:[],platforms:[{country:'IN',platform:'JAICLUB'}]};assert((await helper(db,{},denied)).every(x=>x.platform==='JAICLUB'));
 for(const patch of[{country:'PK'},{source:'NEWAR'},{kind:'recharge'},{applied:'2026-10-11 12:00:00.000001'},{label:'system'},{actor:'SYSTEM'},{actor:' system（三方回调） '},{actor:'system(三方回调)'},{actor:'sys\u200btem'},{submitted:'2026-10-11 11:59:59'},{file:'../../secret.png'},{sha:'broken'}])await assert.rejects(()=>record(db,'SAME-ID',patch),/invalid_ar_detail|identity_or_listing|conflict/);
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({mode:'selected',countries:[],platforms:[]})]);await assert.rejects(()=>reasonCall(db),/scope_denied/);
 }finally{await db.close()}});

test('replayed list NULL/source observed updates preserve sidecar; explicit list wins; native identity/day changes/delete/TRUNCATE revoke only evidence',async()=>{const db=await installed();try{
 await db.exec('delete from ar_collected_orders');await add(db,'UPSERT',null);await record(db,'UPSERT',{actor:'Manual_actor'});const evidence=(await db.query('select to_jsonb(e)r from private.ar_withdraw_detail_operator_evidence e')).rows[0].r;
 await db.exec("set role service_role;insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,status,operator,applied_at,completed_at,observed_at,updated_at) values('AR','IN','91CLUB','withdraw','UPSERT','已通过',null,'2026-10-11 12:00:00','2026-10-11 12:03:00',now(),now())on conflict(source_system,country_code,platform,order_kind,order_no)do update set operator=excluded.operator,observed_at=excluded.observed_at,updated_at=excluded.updated_at;reset role;");
 assert.deepEqual((await db.query('select to_jsonb(e)r from private.ar_withdraw_detail_operator_evidence e')).rows[0].r,evidence);assert.equal((await helper(db,{platform:'91CLUB'}))[0].manual_count,1);
 await db.exec("update ar_collected_orders set operator='system' where order_no='UPSERT'");assert.equal((await helper(db,{platform:'91CLUB'}))[0].auto_count,1,'explicit list operator retains precedence');assert.equal(await evidenceCount(db),1);
 await db.exec("update ar_collected_orders set operator=null,status='处理中',completed_at=null where order_no='UPSERT'");assert.equal((await helper(db,{platform:'91CLUB'}))[0].manual_count,1,'manual submission evidence is independent from final order status');
 await db.exec("set role service_role;update ar_collected_orders set applied_at='2026-10-11 12:00:01'where order_no='UPSERT';reset role;");assert.equal(await evidenceCount(db),0);assert.equal((await helper(db,{platform:'91CLUB'}))[0].manual_count,0);
 await record(db,'UPSERT',{applied:'2026-10-11 12:00:01'});await db.exec("begin;set role service_role;update ar_collected_orders set order_no='RENAMED' where order_no='UPSERT';reset role;commit;");assert.equal(await evidenceCount(db),0);
 await record(db,'RENAMED',{applied:'2026-10-11 12:00:01'});await db.exec("set role service_role;delete from ar_collected_orders where order_no='RENAMED';reset role;");assert.equal(await evidenceCount(db),0,'source FK cascade works for real service writer without new privileges');
 await add(db,'TRUNCATE',null);await record(db,'TRUNCATE');await db.exec('set role service_role');await assert.rejects(()=>db.exec('truncate ar_collected_orders cascade'),/permission denied/);await db.exec('reset role');assert.equal(await evidenceCount(db),1,'existing service source TRUNCATE denial is preserved');await db.exec('truncate ar_collected_orders cascade');assert.equal(await evidenceCount(db),0);
 }finally{await db.close()}});

test('direct evidence privileges/drift fail closed; disable-and-restore invalidator cannot resurrect old evidence and ANALYZE is stable',async()=>{const db=await installed();try{
 await db.exec('delete from ar_collected_orders');await add(db,'META',null);await record(db,'META');const g=await ownGeneration(db);await db.exec('analyze private.ar_withdraw_detail_operator_evidence');assert.equal(await ownGeneration(db),g);
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(()=>record(db,'META'),/permission denied/);await assert.rejects(()=>db.query('select *from private.ar_withdraw_detail_operator_evidence'),/permission denied/);await db.exec('reset role')}
 await db.exec('grant all on private.ar_withdraw_detail_operator_evidence to service_role;set role service_role');await assert.rejects(()=>db.exec("update private.ar_withdraw_detail_operator_evidence set manual_submit_actor='Forged'"),/owner_only/);await assert.rejects(()=>db.exec('delete from private.ar_withdraw_detail_operator_evidence'),/owner_only/);await db.exec('reset role');assert.equal(await ownGeneration(db),null);assert.equal((await helper(db,{platform:'91CLUB'}))[0].manual_count,0);
 await db.exec('revoke all on private.ar_withdraw_detail_operator_evidence from service_role');assert.equal(await ownGeneration(db),g);
 await db.exec('alter table ar_collected_orders disable trigger ar_detail_evidence_identity_change');assert.equal(await ownGeneration(db),null);await db.exec("update ar_collected_orders set applied_at='2026-10-11 12:00:02'where order_no='META';update ar_collected_orders set applied_at='2026-10-11 12:00:00'where order_no='META';alter table ar_collected_orders enable trigger ar_detail_evidence_identity_change");assert.notEqual(await ownGeneration(db),g);assert.equal((await helper(db,{platform:'91CLUB'}))[0].manual_count,0,'missed invalidation cannot be revived by same timestamp restoration');
 }finally{await db.close()}});

test('without evidence complete main JSON stays equal across source/type/view/sort/scope boundaries and original proof state remains unchanged',async()=>{const db=await fixture();try{
 const cases=[];for(const view of ['auto','operators'])for(const sort of ['platform','total','autoCount','manualCount','avgSeconds','durationChange'])for(const platform of [undefined,'91CLUB','RAJALOTTERY','MAAN.WIN','YASH.BET'])cases.push({view,sort,...platform?{platform}:{}});
 const expected=[];for(const q of cases)expected.push(await H.core.call(db,q));const helperExpected=await helper(db,{view:'operators'}),oldState=await snapshots(db),g=await generations(db);const meta=await info(db,reader);
 await installObjects(db);await installReaders(db);for(let i=0;i<cases.length;i++)assert.deepEqual(await H.core.call(db,cases[i]),expected[i],'full main '+JSON.stringify(cases[i]));assert.deepEqual(await helper(db,{view:'operators'}),helperExpected);assert.deepEqual(await snapshots(db),oldState);assert.deepEqual(await generations(db),g);assert.deepEqual((await info(db,reader)).meta,meta.meta);
 }finally{await db.close()}});

test('audited exact three native records are idempotent, preserve source/facts/proofs and change each visible platform manual count by one',async()=>{const db=await installed();try{
 await db.exec('delete from ar_collected_orders');const native=['RAJA','JAICLUB','91CLUB'].map(platform=>({platform,order_no:'SYNTHETIC-'+platform,operator:null,applied_at:'2026-10-11 12:00:00',completed_at:'2026-10-11 12:03:00',status:'已通过'})),evidence=native.map(x=>({platform:x.platform,evidence_path:'work/ar-detail-operator-contract/evidence/Synthetic-'+x.platform+'.png',sha256:'a'.repeat(64)}));const actors={RAJA:'Synthetic_raja',JAICLUB:'Synthetic_jai','91CLUB':'Synthetic_91'},times={RAJA:'12:01:00',JAICLUB:'12:01:00','91CLUB':'12:01:00'};
 for(const a of native)await add(db,a.order_no,a.operator,{platform:a.platform,applied_at:a.applied_at,completed_at:a.completed_at,status:a.status});
 const before=await snapshots(db),counts=await helper(db,{view:'operators'});for(const a of native){const e=evidence.find(x=>x.platform===a.platform);assert.match(e.sha256,/^[a-f0-9]{64}$/);assert.equal((await record(db,a.order_no,{platform:a.platform,applied:a.applied_at,actor:actors[a.platform],submitted:'2026-10-11 '+times[a.platform],file:e.evidence_path,sha:e.sha256})).inserted,true);assert.equal((await record(db,a.order_no,{platform:a.platform,applied:a.applied_at,actor:actors[a.platform],submitted:'2026-10-11 '+times[a.platform],file:e.evidence_path,sha:e.sha256})).inserted,false)}
 assert.deepEqual(await snapshots(db),before);const after=await helper(db,{view:'operators'});for(const a of native){const old=counts.find(x=>x.platform_key===a.platform),now=after.find(x=>x.platform_key===a.platform);assert.equal(now.manual_count,old.manual_count+1);unchangedCounts(now,old);assert.equal(now.operator_rows[0].account,actors[a.platform]);}
 await assert.rejects(()=>record(db,native[0].order_no,{platform:native[0].platform,applied:native[0].applied_at,actor:'Conflicting_actor',submitted:'2026-10-11 '+times[native[0].platform],file:evidence.find(x=>x.platform===native[0].platform).evidence_path,sha:evidence.find(x=>x.platform===native[0].platform).sha256}),/conflict_requires_review/);
 }finally{await db.close()}});

test('formal guarded install and replay execute successfully, preserve metadata/native proof generations and reject metadata/output/schema drift',async()=>{const db=await fixture();try{
 await db.exec('set check_function_bodies=off');await db.exec(read('baseline/publish_ar_collected_orders.sql'));await db.exec('set check_function_bodies=on;revoke all on function public.publish_ar_collected_orders(text,jsonb)from public,anon,authenticated;grant execute on function public.publish_ar_collected_orders(text,jsonb)to service_role');
 const migration=read('candidate/supabase/migrations/20261012114957_ar_verified_detail_manual_submit_evidence.sql'),expectedState=await snapshots(db),g=await generations(db),oldMeta=await info(db,reader),beforePublish=await info(db,'public.publish_ar_collected_orders(text,jsonb)');
 await db.exec(migration);assert.match(await ownGeneration(db),/^[a-f0-9]{32}$/);assert.deepEqual(await snapshots(db),expectedState);assert.deepEqual(await generations(db),g);assert.deepEqual((await info(db,reader)).meta,oldMeta.meta);assert.deepEqual(await info(db,'public.publish_ar_collected_orders(text,jsonb)'),beforePublish);
 await add(db,'REPLAY',null);await record(db,'REPLAY');const stableG=await ownGeneration(db),stableRow=(await db.query('select to_jsonb(e)r from private.ar_withdraw_detail_operator_evidence e')).rows;
 await db.exec(migration);assert.equal(await ownGeneration(db),stableG);assert.deepEqual((await db.query('select to_jsonb(e)r from private.ar_withdraw_detail_operator_evidence e')).rows,stableRow,'replay does not recreate triggers/revoke evidence epochs');
 const block=migration.slice(migration.indexOf('DO $install_detail$'),migration.lastIndexOf('COMMIT;'));
 for(const drift of ['grant execute on function '+reader+' to anon','alter function '+reader+' security definer','alter table private.ar_withdraw_detail_operator_evidence disable row level security','alter table private.ar_withdraw_detail_operator_evidence drop constraint ar_detail_action','grant all on private.ar_withdraw_detail_operator_evidence to service_role']){await db.exec('begin');await db.exec(drift);await assert.rejects(()=>db.exec(block),/AR_DETAIL_(BASELINE|OBJECT|TABLE_TRIGGER)/);await db.exec('rollback')}
 const original=await info(db,reader);await db.exec('begin;drop function '+reader);await db.exec(original.d.replace('manual_count bigint','renamed_manual bigint'));await assert.rejects(()=>db.exec(block),/AR_DETAIL_BASELINE_DRIFT/);await db.exec('rollback');
 }finally{await db.close()}});

test('every reason kind actually executes after joined-field qualification; ordinary rejection JSON and all source remarks remain unchanged',async()=>{const db=await fixture();try{
 await db.exec('delete from ar_collected_orders');await add(db,'REASON',null,{manual_remark:'Synthetic manual block',remark:'Synthetic rejection',status:'未通过'});
 const ordinary={};for(const kind of ['categories','rejection','orders','operators'])ordinary[kind]=await reasonCall(db,'91CLUB',{kind});
 await installObjects(db);await installReaders(db);for(const kind of ['categories','rejection','orders','operators'])assert.deepEqual(await reasonCall(db,'91CLUB',{kind}),ordinary[kind]);
 await add(db,'DETAIL-REASON',null,{manual_remark:'Synthetic confirmed manual'});await record(db,'DETAIL-REASON');
 const summary=await reasonCall(db),group=summary.rows.find(r=>r.success===1);assert(group);for(const kind of ['blockingOrders','blockingVariants']){const r=await reasonCall(db,'91CLUB',{kind,reasonKey:group.reasonKey});assert.equal(r.total,1)}
 for(const kind of ['blocking','rejection','categories','orders','operators'])assert.ok(await reasonCall(db,'91CLUB',{kind}));
 assert.equal((await db.query("select operator,manual_remark from ar_collected_orders where order_no='DETAIL-REASON'")).rows[0].operator,null);
 }finally{await db.close()}});

test('fresh GAME66 source-notes delegation remains identical for every reason kind and retains scope denial',async()=>{const db=await fixture();try{
 await db.exec(`create function private.dashboard_admin_game66_withdraw_reasons(p_request jsonb,p_scope jsonb,p_meta jsonb)returns jsonb language sql stable set search_path='' as $$select jsonb_build_object('available',true,'source','synthetic_game66_received_notes','request',p_request,'scope',p_scope,'nativeMeta',p_meta)$$;
 insert into synthetic_catalog values(md5('synthetic-game66-detail')::uuid,'GAME66-SYNTH','M8','印度','IN','game66','Asia/Kolkata','INR','GAME66-SYNTH');`);
 const kinds=['blocking','blockingOrders','blockingVariants','categories','rejection','operators','orders'],before={};
 for(const kind of kinds)before[kind]=await reasonCall(db,'GAME66-SYNTH',{kind,...['blockingOrders','blockingVariants'].includes(kind)?{reasonKey:'a'.repeat(32)}:{}});
 const state=await snapshots(db),g=await generations(db);await installObjects(db);await installReaders(db);
 for(const kind of kinds){const got=await reasonCall(db,'GAME66-SYNTH',{kind,...['blockingOrders','blockingVariants'].includes(kind)?{reasonKey:'a'.repeat(32)}:{}});assert.deepEqual(got,before[kind]);assert.equal(got.source,'synthetic_game66_received_notes');assert.equal(got.nativeMeta.source,'game66');}
 assert.deepEqual(await snapshots(db),state);assert.deepEqual(await generations(db),g);
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({mode:'selected',countries:[],platforms:[]})]);await assert.rejects(()=>reasonCall(db,'GAME66-SYNTH'),/scope_denied/);
 }finally{await db.close()}});
