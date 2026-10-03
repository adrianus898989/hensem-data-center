// Synthetic source records only. Actual captured reader and ingest bodies run in local PostgreSQL.
// No production calls, source-site calls, personal values or secrets are used.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const overlayMigration=read('supabase/migrations/20261003134032_wg_verified_front_note_overlay.sql');
const noteMigration=read('supabase/migrations/20261003131534_wg_rejection_note_state.sql');
const receiverMigration=read('supabase/migrations/20261003133851_wg_front_rejection_receiver_contract.sql');
const notice='业务备注包含未识别或敏感自由文本，原文已隐藏，待核实',safe='Olá, solicite a retirada novamente, obrigado';
const owner='10000000-0000-4000-8000-000000000001',run='20000000-0000-4000-8000-000000000001',token='a'.repeat(64);
let db,beforeMeta,beforeSource,beforeReads,records,readerMd5;
const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].value;
const checksum=()=>scalar('select md5(jsonb_agg(to_jsonb(d) order by site_code,order_number)::text) value from public.wg_withdraw_details d');
const readerMeta=()=>scalar("select to_jsonb(p)-'prosrc' value from pg_proc p where oid='private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb)'::regprocedure");
const call=extra=>scalar('select private.dashboard_admin_wg_withdraw_reasons($1::jsonb,$2::jsonb) value',[JSON.stringify({country:'巴西',platform:'26BET',date:'2026-09-30',kind:'orders',limit:500,...extra}),'{}']);
const sync=request=>scalar('select public.wg_detail_sync($1,$2::jsonb) value',[token,JSON.stringify({schema_version:1,site_code:'278',business:'withdraw',basis:'operated',owner,run_id:run,...request})]);
const withoutProvenance=value=>Array.isArray(value)?value.map(withoutProvenance):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>k!=='verifiedRejectionNote').map(([k,v])=>[k,withoutProvenance(v)])):value;
const fields=reason=>({schema_version:1,operator_name:'synthetic_agent',operator_class:'manual',note_state:'template',remark_sanitized:'Reasons for not automatically withdrawing funds: The membership level is in the list of required membership levels',rejection_reason:reason,interception_reason:'Reasons for not automatically withdrawing funds: The membership level is in the list of required membership levels',interception_codes:['membership_level'],front_note_state:'withheld',front_note_sanitized:notice,back_note_state:'empty',back_note_sanitized:null});
async function record(id,reason=null){
 const keys=await scalar('select private.wg_detail_record_keys() value');
 return {...Object.fromEntries(keys.map(k=>[k,null])),system:'WG',country:'BR',platform:'26BET',site_code:'278',business:'withdraw',order_number:id,status_code:7,status_group:'rejected',created_at:'2026-09-30T03:00:00Z',operated_at:'2026-09-30T04:00:00Z',captured_at:'2026-09-30T05:00:00Z',member_currency:'BRL',member_unit_scale:1,member_amount_units:'100',member_amount:'100',settlement_currency:'BRL',source_fields:{},business_fields:fields(reason)};
}
async function addEvidence(order='SYNTHETIC-A',changes={}){
 const source=(await db.query('select content_hash,version_at from public.wg_withdraw_details where site_code=$1 and order_number=$2',['278',order])).rows[0];
 const e={site:'278',order,hash:source.content_hash,version:source.version_at,status:7,field:'frontRemark',note:safe,method:'manual_source_ui',verified:'2026-09-30T05:30:00Z',digest:'d'.repeat(64),...changes};
 return db.query('insert into private.wg_verified_front_rejection_notes(site_code,order_number,source_content_hash,source_version_at,source_status_code,source_field,note_text,verification_method,verified_at,evidence_digest) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',Object.values(e));
}
async function fixture(){
 const local=new PGlite();await local.exec(`create schema private;create role anon;create role authenticated;create role service_role;create role synthetic_uploader;
 grant usage on schema private to anon,authenticated,service_role,synthetic_uploader;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql stable as $$select coalesce(current_setting('test.allowed',true),'yes')='yes' and $2='BR' and $3='26BET'$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select upper($1)$$;
 create function private.dashboard_admin_wg_sites() returns table(country text,country_code text,platform text,site_code text,currency text,timezone text) language sql stable as $$values('巴西','BR','26BET','278','BRL','America/Sao_Paulo')$$;
 create function private.dashboard_admin_live_clean_note(text) returns text language sql immutable as $$select nullif(btrim($1),'')$$;
 create function private.dashboard_admin_live_rejection_exact_note(p_note text) returns text language sql immutable set search_path='' as $$select case when p_note ~ '[^[:space:]]' then p_note end$$;
 create function private.dashboard_admin_live_rejection_exact_key(p_note text) returns text language sql immutable set search_path='' as $$select md5(jsonb_build_array('source_rejection_note_v1',private.dashboard_admin_live_rejection_exact_note(p_note))::text)$$;
 create table private.wg_detail_credentials(key_hash text primary key,enabled boolean,allowed_sites text[]);
 create table private.wg_detail_progress(site_code text,business text,basis text,floor bigint,cursor bigint,owner uuid,run_id uuid,lease_until timestamptz,window_start bigint,window_end bigint,history_start bigint,history_end bigint,backfill boolean,received integer,pages integer,primary key(site_code,business,basis));
 create table private.wg_detail_page_receipts(site_code text,business text,basis text,run_id uuid,page integer,body_hash text,order_ids text[],received integer,written integer,stale integer,primary key(site_code,business,basis,page));
 create table private.wg_detail_history(site_code text,business text,basis text,range_start bigint,range_end bigint,cursor bigint,updated_at timestamptz);
 `);
 const ddl=read('tests/fixtures/wg-existing-collector-ddl.sql');for(const section of ['DETAILS','COVERAGE'])await local.exec(ddl.split('-- BEGIN '+section+'\n')[1].split('-- END '+section)[0]);
 await local.exec('alter table public.wg_recharge_details add column business_fields jsonb;alter table public.wg_withdraw_details add column business_fields jsonb;');
 await local.exec(read('tests/fixtures/wg-verified-front-ingest-baseline.sql'));
 await local.exec(read('tests/fixtures/wg-front-rejection-receiver-baseline.sql'));
 await local.exec(`revoke all on function private.wg_business_note_allowed(text),private.wg_business_fields_validate(jsonb),private.wg_detail_validate_record(jsonb,text,text) from public,anon,authenticated,service_role;
 revoke all on function public.wg_detail_sync(text,jsonb) from public,anon,authenticated;
 `);
 await local.exec(read('tests/fixtures/wg-rejection-note-state-baseline.sql'));
 await local.exec('revoke all on function private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb) from public,anon,authenticated,service_role;');
 await local.exec(noteMigration);await local.exec(receiverMigration);
 await local.exec('alter default privileges in schema private grant all on tables to synthetic_uploader;');
 return local;
}
before(async()=>{
 db=await fixture();
 assert.equal(await scalar("select md5(prosrc) value from pg_proc where oid='public.wg_detail_sync(text,jsonb)'::regprocedure"),'b0ab3f982a126f438466635209d4e49f');
 await db.query('insert into private.wg_detail_credentials values($1,true,array[\'278\'])',[token]);
 await db.query("insert into private.wg_detail_progress values('278','withdraw','operated',0,null,$1,$2,clock_timestamp()+interval '5 minutes',extract(epoch from '2026-09-30T03:00Z'::timestamptz),extract(epoch from '2026-09-30T06:00Z'::timestamptz),null,null,false,0,0)",[owner,run]);
 records=[await record('SYNTHETIC-A'),await record('SYNTHETIC-UNVERIFIED'),await record('SYNTHETIC-NATIVE','Invalid bank details')];
 const uploaded=await sync({action:'page',page:1,records});assert.equal(uploaded.received,3);assert.equal(uploaded.written,3);
 await db.exec("insert into public.wg_withdraw_details select (jsonb_populate_record(null::public.wg_withdraw_details,to_jsonb(d)||jsonb_build_object('order_number','SYNTHETIC-WHITESPACE','business_fields',business_fields||jsonb_build_object('rejection_reason','   ')))).* from public.wg_withdraw_details d where order_number='SYNTHETIC-A';");
 await db.exec("insert into private.wg_detail_history values('278','withdraw','created',extract(epoch from '2026-09-30T03:00Z'::timestamptz)::bigint,extract(epoch from '2026-10-01T03:00Z'::timestamptz)::bigint-1,extract(epoch from '2026-10-01T03:00Z'::timestamptz)::bigint-1,'2026-10-01T05:00Z');");
 beforeMeta=await readerMeta();beforeSource=await checksum();beforeReads={};for(const kind of ['orders','categories','rejection','operators','blocking','blockingOrders','blockingVariants'])beforeReads[kind]=await call({kind});
 await db.exec(overlayMigration);readerMd5=await scalar("select md5(prosrc) value from pg_proc where oid='private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb)'::regprocedure");
});
after(async()=>db?.close());
test('an empty overlay conserves every native DTO including raw whitespace and all blocking results',async()=>{
 for(const [kind,prior]of Object.entries(beforeReads))assert.deepEqual(withoutProvenance(await call({kind})),prior,kind);
 assert.equal((await call({query:'SYNTHETIC-WHITESPACE'})).rows[0].rawRejectionReason,'   ');
 assert.equal(await checksum(),beforeSource);assert.deepEqual(await readerMeta(),beforeMeta);
});
test('only exact verified front evidence resolves one source reason without copying it to unverified orders or changing raw states',async()=>{
 await addEvidence();const all=await call(),a=all.rows.find(r=>r.orderNumber==='SYNTHETIC-A'),u=all.rows.find(r=>r.orderNumber==='SYNTHETIC-UNVERIFIED');
 assert.equal(a.rejectionReason,safe);assert.equal(a.rawRejectionReason,safe);assert.equal(a.rejectionNoteState,'present');assert.equal(a.sourceNoteStates.front,'withheld');assert.deepEqual(a.hiddenNoteSources,['front']);
 assert.deepEqual({...a.verifiedRejectionNote,verifiedAt:new Date(a.verifiedRejectionNote.verifiedAt).toISOString()},{sourceField:'frontRemark',verificationMethod:'manual_source_ui',verifiedAt:'2026-09-30T05:30:00.000Z'});
 assert.equal(u.rejectionReason,null);assert.equal(u.rejectionNoteState,'withheld');assert.equal(u.verifiedRejectionNote,null);assert.equal(all.total,4);
 const group=(await call({kind:'categories'})).rows.find(r=>r.sourceReason===safe);assert.equal(group.count,1);assert.deepEqual((await call({category:group.categoryKey})).rows.map(r=>r.orderNumber),['SYNTHETIC-A']);
 assert.equal(await checksum(),beforeSource);assert.deepEqual(await call({kind:'blocking'}),beforeReads.blocking);assert.deepEqual(await call({kind:'blockingOrders'}),beforeReads.blockingOrders);
 assert(!Object.keys(a).some(k=>/evidence_digest|source_content_hash|source_version_at/.test(k)));
});
test('a native nonempty exact source reason wins over a matching verified front note',async()=>{
 await addEvidence('SYNTHETIC-NATIVE');const n=(await call({query:'SYNTHETIC-NATIVE'})).rows[0];assert.equal(n.rejectionReason,'Invalid bank details');assert.equal(n.rawRejectionReason,'Invalid bank details');assert.equal(n.verifiedRejectionNote,null);
});
test('actual receiver receipt replay and fresh-run same payload preserve the evidence and collector fingerprint',async()=>{
 const before=await checksum(),receipt=await sync({action:'page',page:1,records});assert.equal(receipt.written,3);assert.equal(await checksum(),before);
 await db.exec("delete from private.wg_detail_page_receipts;update private.wg_detail_progress set pages=0,received=0,lease_until=clock_timestamp()+interval '5 minutes';");
 const replay=await sync({action:'page',page:1,records});assert.equal(replay.written,0);assert.equal(replay.stale,3);assert.equal(await checksum(),before);assert.equal((await call({query:'SYNTHETIC-A'})).rows[0].rejectionReason,safe);
});
test('a new actual source payload expires the old overlay instead of transplanting an old verification',async()=>{
 await db.exec('begin');try{
  await db.exec("delete from private.wg_detail_page_receipts;update private.wg_detail_progress set pages=0,received=0,lease_until=clock_timestamp()+interval '5 minutes';");
  const changed={...records[0],provider:'Synthetic changed provider'};const result=await sync({action:'page',page:1,records:[changed]});assert.equal(result.written,1);
  const a=(await call({query:'SYNTHETIC-A'})).rows[0];assert.equal(a.rejectionReason,null);assert.equal(a.verifiedRejectionNote,null);assert.equal(a.rejectionNoteState,'withheld');
 }finally{await db.exec('rollback')}
});
test('version, status, site and local-day guards reject stale evidence without changing scopes or other orders',async()=>{
 for(const change of ["version_at=version_at+interval '1 second'","status_code=4,status_group='success'","site_code='8311'","created_at='2026-09-29T03:00Z'"]){await db.exec('begin');try{
  await db.exec("update public.wg_withdraw_details set "+change+" where site_code='278' and order_number='SYNTHETIC-A'");
  const a=(await call({query:'SYNTHETIC-A'})).rows[0];assert(!a||a.rejectionReason!==safe);assert(!a?.verifiedRejectionNote);
 }finally{await db.exec('rollback')}}
 await db.exec("select set_config('test.allowed','no',false)");try{assert.equal(await call(),null)}finally{await db.exec("select set_config('test.allowed','yes',false)")}
});
test('private evidence rejects arbitrary notes, hidden notices, interception prefixes and forged provenance',async()=>{
 const invalid=[{note:'Synthetic unapproved free text'},{note:'person@example.invalid'},{note:notice},{note:'Reasons for not automatically withdrawing funds: The membership level is in the list of required membership levels'},{note:'Invalid bank details\n'},{note:''},{note:' '.repeat(4)},{note:'x'.repeat(2001)},{field:'backRemark'},{method:'inferred_from_other_orders'},{status:4},{hash:'not-a-source-hash'},{digest:'bad-evidence-digest'}];
 for(const changes of invalid)await assert.rejects(addEvidence('SYNTHETIC-UNVERIFIED',changes),/check constraint|violates/i);
 assert.equal(await scalar('select count(*) value from private.wg_verified_front_rejection_notes'),2);
 for(const role of ['anon','authenticated','service_role','synthetic_uploader'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])assert.equal(await scalar('select has_table_privilege($1,$2,$3) value',[role,'private.wg_verified_front_rejection_notes',privilege]),false);
 const security=(await db.query("select relrowsecurity,pg_get_userbyid(relowner) owner from pg_class where oid='private.wg_verified_front_rejection_notes'::regclass")).rows[0];assert.deepEqual(security,{relrowsecurity:true,owner:'postgres'});assert.equal(await scalar("select count(*) value from pg_policy where polrelid='private.wg_verified_front_rejection_notes'::regclass"),0);
 for(const role of ['anon','authenticated','service_role','synthetic_uploader'])assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\') value',[role,'private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb)']),false);
});
test('body, ACL or safe-template dependency drift aborts atomically before a private table is created',async()=>{
 for(const change of ["grant execute on function private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb) to anon",'body',"create or replace function private.wg_business_note_allowed(t text) returns boolean language sql immutable as $$select true$$"]){
  const fresh=await fixture();try{
   if(change==='body'){const original=(await fresh.query("select pg_get_functiondef('private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb)'::regprocedure) value")).rows[0].value;await fresh.exec(original.replace(' return answer;',' return answer; -- body drift'));}else await fresh.exec(change);
   await assert.rejects(fresh.exec(overlayMigration),/drift|dependency/);await fresh.exec('rollback');assert.equal((await fresh.query("select to_regclass('private.wg_verified_front_rejection_notes') value")).rows[0].value,null);
  }finally{await fresh.close()}
 }
 assert(!/\b(?:update|delete from|insert into)\s+(?:public\.)?wg_(?:withdraw|recharge)_details\b/i.test(overlayMigration));assert.deepEqual(await readerMeta(),beforeMeta);
 assert.equal(await scalar("select md5(prosrc) value from pg_proc where oid='private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb)'::regprocedure"),readerMd5);
});
