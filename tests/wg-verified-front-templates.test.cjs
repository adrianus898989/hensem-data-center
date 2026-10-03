// Portable synthetic PostgreSQL contract tests; no private collector paths or order data.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.resolve(__dirname,'..',p),'utf8');
const previous=read('supabase/migrations/20261003133851_wg_front_rejection_receiver_contract.sql');
const migration=read('supabase/migrations/20261003142039_wg_verified_front_templates.sql');
const phrases=[
 'Olá, como os dados do seu PIX estão errados, entre em contato com o atendimento online para verificar a alteração, obrigado',
 'Olá, a falha foi causada por uma falha do sistema, por favor, solicite a retirada novamente, obrigado',
];
const oldPhrase='Olá, solicite a retirada novamente, obrigado',notice='业务备注包含未识别或敏感自由文本，原文已隐藏，待核实';
const fields=(phrase,extra={})=>({schema_version:1,operator_name:'synthetic-agent',operator_class:'manual',note_state:'empty',remark_sanitized:null,rejection_reason:phrase,interception_reason:null,interception_codes:[],front_note_state:'template',front_note_sanitized:phrase,back_note_state:'empty',back_note_sanitized:null,...extra});
let db,beforeMetadata,beforeOthers;
const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].value;
const meta=()=>db.query("select p.oid::regprocedure::text signature,to_jsonb(p)-'prosrc' value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' order by signature").then(x=>x.rows);
const others=()=>db.query("select to_jsonb(p) value from pg_proc p where oid in ('private.wg_business_fields_validate(jsonb)'::regprocedure,'private.wg_detail_validate_record(jsonb,text,text)'::regprocedure) order by proname").then(x=>x.rows);
const hash=()=>scalar("select md5(prosrc) value from pg_proc where oid='private.wg_business_note_allowed(text)'::regprocedure");
const allowed=text=>scalar('select private.wg_business_note_allowed($1) value',[text]);
const record=(x,status=7,business='withdraw')=>db.query('select private.wg_detail_validate_record($1::jsonb,$2,$3)',[JSON.stringify({status_code:status,business_fields:x}),'SYNTHETIC-SITE',business]);
before(async()=>{
 db=new PGlite();await db.exec("create schema private;create role anon;create role authenticated;create role service_role;create function private.wg_detail_validate_record_v2(jsonb,text,text) returns void language plpgsql set search_path='' as $$begin return;end$$;");
 await db.exec(read('tests/fixtures/wg-front-rejection-receiver-baseline.sql'));
 await db.exec('revoke all on function private.wg_business_note_allowed(text),private.wg_business_fields_validate(jsonb),private.wg_detail_validate_record(jsonb,text,text) from public,anon,authenticated,service_role;');
 await db.exec(previous);assert.equal(await hash(),'8de0f6016c65daa067ca4cd7d2ffb187');
 for(const phrase of phrases){assert.equal(await allowed(phrase),false);await assert.rejects(record(fields(phrase)),/WG_INVALID_BUSINESS_FIELDS/)}
 beforeMetadata=await meta();beforeOthers=await others();await db.exec(migration);
});
after(async()=>db?.close());
test('the actual migrated allowlist admits both verified templates exactly and retains previous safe wording',async()=>{
 for(const phrase of [...phrases,oldPhrase,'Invalid bank details'])assert.equal(await allowed(phrase),true);
 assert.equal(await hash(),'64401bc636de92acf1b132c418d31e96');
});
test('both templates pass the actual receiver only as safe status-7 withdrawal notes with independent main states',async()=>{
 for(const phrase of phrases){
  for(const extra of [{},{note_state:'withheld'},{note_state:'withheld',remark_sanitized:notice},{note_state:'template',remark_sanitized:'Bank maintenance'}])await record(fields(phrase,extra));
  for(const status of [1,3,4,5,6,8])await assert.rejects(record(fields(phrase),status),/WG_INVALID_BUSINESS_FIELDS/);
  await assert.rejects(record(fields(phrase),7,'recharge'),/WG_INVALID_BUSINESS_FIELDS/);
  await assert.rejects(record(fields(phrase,{front_note_state:'withheld',front_note_sanitized:notice})),/WG_INVALID_BUSINESS_FIELDS/);
  await assert.rejects(record(fields(phrase,{front_note_sanitized:oldPhrase})),/WG_INVALID_BUSINESS_FIELDS/);
 }
});
test('unknown text, PII, control characters and automatic-withdraw prefixes remain rejected',async()=>{
 for(const phrase of phrases){
  for(const suffix of [' CUSTOMER-CANARY-42','; phone: +5511999988888','; token: CANARY','; PIX: 12345678901','\u001f']){
   const text=phrase+suffix;assert.equal(await allowed(text),false);await assert.rejects(record(fields(text)),/WG_INVALID_BUSINESS_FIELDS/);
  }
  for(const prefix of ['Reasons for not automatically withdrawing funds:','未自动出款原因:','未自动出款原因：'])await assert.rejects(record(fields(prefix+' '+phrase)),/WG_INVALID_BUSINESS_FIELDS/);
 }
 assert.equal(await allowed('New unverified business wording'),false);
});
test('only allowlist text changes; all OIDs, ACLs and metadata plus both receiver bodies remain exact',async()=>{
 assert.deepEqual(await meta(),beforeMetadata);assert.deepEqual(await others(),beforeOthers);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("select has_function_privilege($1,'private.wg_business_note_allowed(text)','execute') value",[role]),false);
 assert.doesNotMatch(migration.replace(/--[^\n]*/g,''),/\b(?:grant\s|insert\s+into|delete\s+from|update\s+(?:public|private)|truncate\s|drop\s+(?:table|view|function))\b/i);
});
test('CAS migration is idempotent and rejects body or ACL drift atomically',async()=>{
 await db.exec(migration);assert.equal(await hash(),'64401bc636de92acf1b132c418d31e96');assert.deepEqual(await meta(),beforeMetadata);
 await db.exec('begin');try{await db.exec('grant execute on function private.wg_business_note_allowed(text) to authenticated');await assert.rejects(db.exec(migration),/helper metadata changed/)}finally{await db.exec('rollback')}
 await db.exec('begin');try{
  const source=await scalar("select prosrc value from pg_proc where oid='private.wg_business_note_allowed(text)'::regprocedure");
  await db.exec("create or replace function private.wg_business_note_allowed(t text) returns boolean language plpgsql immutable set search_path='' as $function$"+source+'\n-- synthetic unexpected body\n$function$;');
  await assert.rejects(db.exec(migration),/helper body changed/);
 }finally{await db.exec('rollback')}
 assert.equal(await hash(),'64401bc636de92acf1b132c418d31e96');assert.deepEqual(await meta(),beforeMetadata);assert.deepEqual(await others(),beforeOthers);
});
