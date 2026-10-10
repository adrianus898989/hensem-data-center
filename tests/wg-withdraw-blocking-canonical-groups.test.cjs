// Synthetic WG source facts/provenance only; no production notes, orders or credentials.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const repo=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const migration=read('supabase/migrations/20261010115354_wg_blocking_shared_taxonomy_readers.sql');
const baseline=read('tests/fixtures/wg-blocking-canonical-production.sql');
const sharedBaseline=read('tests/fixtures/withdraw-blocking-taxonomy-baseline.sql');
const taxonomy=read('supabase/migrations/20261010114700_withdraw_blocking_shared_taxonomy.sql');
const sig='private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb)';
const notice='未识别拦截原因，原文已隐藏，待核实',hidden='业务备注包含未识别或敏感自由文本，原文已隐藏，待核实';
let db,beforeMeta,beforeOther,beforeSource,rejectionReads,beforeDetails;
const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].value;
const call=extra=>scalar('select private.dashboard_admin_wg_withdraw_reasons($1::jsonb,$2::jsonb) value',[JSON.stringify({country:'印度',platform:'WG-SYNTHETIC',date:'2026-09-30',kind:'blocking',limit:500,...extra}),'{}']);
const meta=()=>scalar("select to_jsonb(p)-'prosrc' value from pg_proc p where oid='"+sig+"'::regprocedure");
const otherMeta=()=>db.query("select to_jsonb(p) value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname<>'dashboard_admin_wg_withdraw_reasons' order by p.oid").then(x=>x.rows);
const checksum=()=>scalar("select md5(jsonb_build_array((select jsonb_agg(to_jsonb(d) order by site_code,order_number) from public.wg_withdraw_details d),(select jsonb_agg(to_jsonb(d) order by site_code,order_number) from private.wg_verified_front_rejection_notes d))::text) value");
const manual=(note,fields={})=>({operator_name:'synthetic-agent',operator_class:'manual',note_state:'template',interception_reason:note,front_note_state:'empty',back_note_state:'empty',...fields});
async function seed(order,fields,status=4,site='SYNTHETIC-SITE',created='2026-09-30T05:00:00Z'){
 await db.query('insert into public.wg_withdraw_details values($1,$2,100,$3,$4,$5,$6,$7,$8,$9)',[site,order,status,status===4?'success':status===7?'rejected':'pending',created,'2026-10-01T05:00:00Z',fields,'synthetic-content-hash','2026-09-30T04:00:00Z']);
}
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql stable as $$select coalesce(current_setting('test.allowed',true),'yes')='yes' and $2='IN' and $3='WG-SYNTHETIC'$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select upper($1)$$;
 create function private.dashboard_admin_wg_sites() returns table(country text,country_code text,platform text,site_code text,currency text,timezone text) language sql stable as $$values('印度','IN','WG-SYNTHETIC','SYNTHETIC-SITE','INR','Asia/Kolkata')$$;
 create function private.dashboard_admin_live_clean_note(text) returns text language sql immutable set search_path='' as $$select nullif(btrim(regexp_replace(coalesce($1,''),'[[:space:]]+',' ','g')),'')$$;
 create function private.dashboard_admin_live_rejection_exact_note(p_note text) returns text language sql immutable set search_path='' as $$select case when p_note ~ '[^[:space:]]' then p_note end$$;
 create function private.dashboard_admin_live_rejection_exact_key(p_note text) returns text language sql immutable set search_path='' as $$select md5(jsonb_build_array('source_rejection_note_v1',private.dashboard_admin_live_rejection_exact_note(p_note))::text)$$;
 create function private.wg_business_note_allowed(text) returns boolean language sql immutable set search_path='' as $$select $1='VERIFIED SAFE'$$;
 create table public.wg_detail_coverage(site_code text,business text,basis text,business_date date,complete boolean);
 create table public.wg_withdraw_details(site_code text,order_number text,member_amount numeric,status_code integer,status_group text,created_at timestamptz,captured_at timestamptz,business_fields jsonb,content_hash text,version_at timestamptz);
 create table private.wg_verified_front_rejection_notes(site_code text,order_number text,source_content_hash text,source_version_at timestamptz,source_status_code integer,source_field text,note_text text,verification_method text,verified_at timestamptz);
 insert into public.wg_detail_coverage values('SYNTHETIC-SITE','withdraw','created','2026-09-30',true);
 grant usage on schema private to anon,authenticated,service_role;
 set check_function_bodies=off;`);
 const helperSQL=read('supabase/admin-live-withdraw-note-normalization.sql'),decodeStart=helperSQL.indexOf('create or replace function private.dashboard_admin_live_decode_note('),decodeEnd=helperSQL.indexOf('revoke all on function private.dashboard_admin_live_decode_note(',decodeStart);assert(decodeStart>=0&&decodeEnd>decodeStart);await db.exec(helperSQL.slice(decodeStart,decodeEnd));
 const parts=sharedBaseline.split(/(?=CREATE OR REPLACE FUNCTION private\.)/).filter(x=>x.includes('CREATE OR REPLACE FUNCTION'));
 for(const part of parts)await db.exec(part.trim().replace(/;$/,'')+';');
 await db.exec(`set check_function_bodies=on;
 revoke all on function private.dashboard_admin_live_blocking_category(text),private.dashboard_admin_live_blocking_details(text),private.dashboard_admin_live_blocking_details_cleaned(text) from public,anon,authenticated,service_role;
 revoke all on function private.dashboard_admin_live_withdraw_reasons(jsonb) from public,anon,authenticated,service_role;grant execute on function private.dashboard_admin_live_withdraw_reasons(jsonb) to authenticated;`);
 await db.exec(taxonomy);await db.exec(baseline);
 assert.equal(await scalar("select md5(prosrc) value from pg_proc where oid='"+sig+"'::regprocedure"),'77a2a379170e614b2d38b84bdb706055');
 await seed('DYNAMIC-A',manual('用户充提差额不满足自动提现要求:-123.40;渠道:ABC;【代付成功】'),4);
 await seed('DYNAMIC-B',manual('用户充提差额不满足自动提现要求:-901;渠道:XYZ;【代付成功】'),7);
 await seed('LIMIT-A',manual('首存金额小于100，首存金额:50'),4);
 await seed('LIMIT-B',manual('首存金额小于100，首存金额:75'),7);
 await seed('LIMIT-C',manual('首存金额小于200，首存金额:100'),4);
 await seed('UNKNOWN-A',manual('SYNTHETIC RISK 123'),4);await seed('UNKNOWN-B',manual('SYNTHETIC RISK 124'),7);
 await seed('EMPTY',manual(null,{note_state:'empty'}),7);
 await seed('MISSING',manual(undefined,{note_state:undefined,front_note_state:undefined,back_note_state:undefined}),7);
 await seed('PARTIAL-EMPTY',manual(null,{note_state:'empty',back_note_state:undefined}),7);
 await seed('WITHHELD',manual(notice,{note_state:'withheld',remark_sanitized:notice}),7);
 await seed('MAIN-HIDDEN-TEMPLATE',manual('用户充提差额不满足自动提现要求:-9',{note_state:'withheld',remark_sanitized:hidden,front_note_state:'withheld',front_note_sanitized:hidden}),2);
 await seed('FRONT-HIDDEN-TEMPLATE',manual('首存金额小于100，首存金额:30',{front_note_state:'withheld',front_note_sanitized:hidden}),2);
 await seed('LITERAL-HIDDEN-LABEL',manual('拦截说明已隐藏'),4);
 await seed('AUTO-EXCLUDED',manual('用户充提差额不满足自动提现要求:-123.40',{operator_name:'system',operator_class:'auto'}),4);
 await seed('UNKNOWN-OP-EXCLUDED',manual('用户充提差额不满足自动提现要求:-123.40',{operator_name:null,operator_class:'unknown'}),7);
 await seed('FOREIGN-SITE',manual('USER-SOURCE-EXCLUDED'),7,'FOREIGN-SITE');
 await seed('BEFORE-DAY',manual('USER-SOURCE-EXCLUDED'),7,'SYNTHETIC-SITE','2026-09-29T18:29:59Z');
 await seed('AFTER-DAY',manual('USER-SOURCE-EXCLUDED'),7,'SYNTHETIC-SITE','2026-09-30T18:30:00Z');
 await seed('VERIFIED-REJECTION',manual('SYNTHETIC VERIFICATION RULE',{front_note_state:'withheld',front_note_sanitized:hidden}),7);
 await seed('WHITESPACE-REJECTION',manual('SYNTHETIC WHITESPACE RULE',{rejection_reason:'  SOURCE EXACT  '}),7);
 await db.exec("insert into private.wg_verified_front_rejection_notes values('SYNTHETIC-SITE','VERIFIED-REJECTION','synthetic-content-hash','2026-09-30T04:00:00Z',7,'frontRemark','VERIFIED SAFE','manual_source_ui','2026-09-30T05:30:00Z')");
 rejectionReads=[];for(const extra of [{kind:'categories'},{kind:'rejection'},{kind:'operators'},{kind:'orders'},{kind:'orders',query:'VERIFIED'},{kind:'orders',offset:20}])rejectionReads.push(await call(extra));
 beforeDetails=await call({kind:'blockingOrders'});beforeMeta=await meta();beforeOther=await otherMeta();beforeSource=await checksum();await db.exec(migration);
});
after(async()=>db?.close());
test('dynamic amounts/provider/success suffix merge with the shared canonical rule; real thresholds and unknown clauses remain separate',async()=>{
 const d=await call(),dynamic=d.rows.find(r=>r.reason==='充提差额未达免审要求');assert(dynamic);assert.equal(dynamic.count,3);assert.equal(dynamic.sourceVariantCount,3);assert.equal(dynamic.success,1);assert.equal(dynamic.rejected,1);assert.equal(dynamic.other,1);assert.equal(dynamic.blockingNoteState,'present');assert.deepEqual(dynamic.blockingNoteStates,{empty:0,missing:0,withheld:0,present:3});
 assert.equal(d.rows.find(r=>r.reason==='首存金额小于100').count,3);assert.equal(d.rows.find(r=>r.reason==='首存金额小于200').count,1);assert(d.rows.some(r=>r.reason==='SYNTHETIC RISK 123'));assert(d.rows.some(r=>r.reason==='SYNTHETIC RISK 124'));
 const forbidden=JSON.stringify(d);assert(!forbidden.includes('AUTO-EXCLUDED'));assert(!forbidden.includes('USER-SOURCE-EXCLUDED'));
});
test('classification keys drill to the same manual orders and source variants with conserved day/page denominators',async()=>{
 const d=await call();for(const rule of d.rows){
  const variants=await call({kind:'blockingVariants',reasonKey:rule.reasonKey}),orders=await call({kind:'blockingOrders',reasonKey:rule.reasonKey});
  assert.equal(variants.rows.reduce((n,x)=>n+x.count,0),rule.count);assert.equal(orders.total,rule.count);assert.equal(orders.rows.length,rule.count);assert.equal(orders.noteCount,d.noteCount);assert.equal(variants.noteCount,d.noteCount);
  assert(variants.rows.every(x=>x.reasonKey===rule.reasonKey&&x.canonicalReason===rule.reason));assert(orders.rows.every(x=>x.reasonKey===rule.reasonKey&&x.blockingReason===rule.reason));
  assert(variants.rows.every(x=>x.blockingNoteState&&x.blockingNoteStates));assert(orders.rows.every(x=>['present','empty','missing','withheld'].includes(x.blockingNoteState)));
 }
 const rule=d.rows.find(x=>x.reason==='充提差额未达免审要求'),orders=await call({kind:'blockingOrders',reasonKey:rule.reasonKey,query:'DYNAMIC-'});assert.deepEqual(orders.rows.map(x=>x.orderNumber).sort(),['DYNAMIC-A','DYNAMIC-B']);assert.equal(orders.noteCount,d.noteCount);
 const a=await call({kind:'blockingOrders',limit:2}),b=await call({kind:'blockingOrders',limit:2,offset:2});assert.equal(a.total,b.total);assert.equal(a.noteCount,b.noteCount);assert.equal(new Set([...a.rows,...b.rows].map(x=>x.orderNumber)).size,4);
});
test('per-order actual values use the same shared classifier and original source text remains readable',async()=>{
 const d=await call({kind:'blockingOrders'}),a=d.rows.find(x=>x.orderNumber==='DYNAMIC-A'),b=d.rows.find(x=>x.orderNumber==='DYNAMIC-B');assert.equal(a.blockingActualValue,'-123.40');assert.equal(b.blockingActualValue,'-901');assert.equal(a.blockingActualField,'充提差额');assert.equal(a.blockingThreshold,null);assert.match(a.manualRemark,/渠道:ABC;【代付成功】/);
 const limit=d.rows.find(x=>x.orderNumber==='LIMIT-A');assert.equal(limit.blockingThreshold,'100');assert.equal(limit.blockingActualValue,'50');assert.equal(limit.blockingActualField,'首存金额');
 const variants=await call({kind:'blockingVariants',reasonKey:a.reasonKey});assert.equal(variants.rows.length,3);assert(variants.rows.some(x=>x.sourceReason===a.manualRemark));assert(variants.rows.some(x=>x.sourceReason===b.manualRemark));
});
test('hidden and unrecorded explanations are provenance buckets, never fabricated risk rules or borrowed rejection notes',async()=>{
 const d=await call(),blank=d.rows.find(x=>x.reason==='检测没备注'),hiddenRows=d.rows.filter(x=>x.reason==='拦截说明已隐藏');
 assert.equal(blank.count,3);assert.equal(blank.blockingNoteState,'mixed');assert.deepEqual(blank.blockingNoteStates,{empty:1,missing:2,withheld:0,present:0});assert.equal(blank.sourceReason,null);
 assert.equal(hiddenRows.length,2,'literal supplied text cannot collide with the reserved withheld state');const withheld=hiddenRows.find(x=>x.blockingNoteState==='withheld');assert.equal(withheld.count,1);assert.equal(withheld.sourceReason,null);assert.equal(withheld.sourceVariantCount,null);assert.deepEqual(withheld.blockingNoteStates,{empty:0,missing:0,withheld:1,present:0});
 const variants=await call({kind:'blockingVariants',reasonKey:withheld.reasonKey});assert.equal(variants.rows[0].sourceReason,null);assert.equal(variants.rows[0].reason,null);assert.equal(variants.rows[0].canonicalReason,'拦截说明已隐藏');assert.equal(variants.rows[0].blockingNoteState,'withheld');
 const all=await call({kind:'blockingOrders'});assert.equal(all.rows.find(x=>x.orderNumber==='EMPTY').blockingNoteState,'empty');assert.equal(all.rows.find(x=>x.orderNumber==='MISSING').blockingNoteState,'missing');assert.equal(all.rows.find(x=>x.orderNumber==='PARTIAL-EMPTY').blockingNoteState,'missing');assert.equal(all.rows.find(x=>x.orderNumber==='WITHHELD').blockingActualValue,null);
 assert.equal(all.rows.find(x=>x.orderNumber==='MAIN-HIDDEN-TEMPLATE').blockingNoteState,'present');assert.equal(all.rows.find(x=>x.orderNumber==='FRONT-HIDDEN-TEMPLATE').blockingNoteState,'present');
 const oc=d.summary.operatorCounts;assert.equal(oc.manual,d.noteCount);assert.equal(oc.manualWithReason,12);assert.equal(oc.manualWithoutReason,3);assert.equal(oc.manualWithheldReason,1);assert.equal(oc.manualWithReason+oc.manualWithoutReason+oc.manualWithheldReason,oc.manual);
});
test('exact rejection text/state, verified overlays, source rows and unrelated function metadata are unchanged',async()=>{
 const extras=[{kind:'categories'},{kind:'rejection'},{kind:'operators'},{kind:'orders'},{kind:'orders',query:'VERIFIED'},{kind:'orders',offset:20}];for(let i=0;i<extras.length;i++)assert.deepEqual(await call(extras[i]),rejectionReads[i]);
 const verified=(await call({kind:'orders',query:'VERIFIED'})).rows[0];assert.equal(verified.rawRejectionReason,'VERIFIED SAFE');assert.equal(verified.verifiedRejectionNote.sourceField,'frontRemark');assert.equal(verified.rejectionNoteState,'present');
 assert.equal((await call({kind:'orders',query:'WHITESPACE'})).rows[0].rawRejectionReason,'  SOURCE EXACT  ');assert.deepEqual(await meta(),beforeMeta);assert.deepEqual(await otherMeta(),beforeOther);assert.equal(await checksum(),beforeSource);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\') value',[role,sig]),false);
});
test('fresh scope and exact country/site/day boundaries stay closed and do not trigger a source fallback',async()=>{
 await db.exec("set test.allowed='no'");try{assert.equal(await call(),null)}finally{await db.exec("set test.allowed='yes'")}
 assert.equal(await call({country:'巴西'}),null);assert.equal(await call({platform:'FOREIGN'}),null);assert.equal(await call({date:'2026-10-05'}),null);
 const orders=await call({kind:'blockingOrders'});assert(!orders.rows.some(x=>/BEFORE-DAY|AFTER-DAY|FOREIGN|AUTO-EXCLUDED|UNKNOWN-OP/.test(x.orderNumber)));assert.equal(orders.rows.length,beforeDetails.rows.length);
});
test('migration preserves every metadata attribute, is reentrant and rejects reader/helper/ACL drift without data writes',async()=>{
 const d=await call();await db.exec(migration);assert.deepEqual(await call(),d);assert.deepEqual(await meta(),beforeMeta);assert.equal(await scalar("select md5(prosrc) value from pg_proc where oid='"+sig+"'::regprocedure"),'bcd4383775c2d02894bcfa64d3a31a3b');
 for(const alteration of ['grant execute on function '+sig+' to anon','alter function '+sig+' set search_path=public','reader-body','helper-body']){
  await db.exec('begin');try{
   if(alteration==='reader-body'){const definition=await scalar('select pg_get_functiondef($1::regprocedure) value',[sig]);await db.exec(definition.replace(' return answer;',' return answer; -- drift')+';')}
   else if(alteration==='helper-body'){const definition=await scalar("select pg_get_functiondef('private.dashboard_admin_live_blocking_details_cleaned(text)'::regprocedure) value");await db.exec(definition.replace('begin\n','begin\n -- drift\n')+';')}
   else await db.exec(alteration);
   await assert.rejects(db.exec(migration),/wg_blocking_canonical_(reader|helper)_drift/);
  }finally{await db.exec('rollback')}
 }
 assert.equal(await checksum(),beforeSource);assert.doesNotMatch(migration.replace(/--[^\n]*/g,''),/\b(?:grant\s|insert\s+into|delete\s+from|update\s+public|truncate\s|drop\s+(?:table|view|function))\b/i);
});
