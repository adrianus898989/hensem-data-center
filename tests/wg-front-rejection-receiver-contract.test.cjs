// Code-only local PostgreSQL fixtures. No production records, credentials or source API access.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const baseline=read('tests/fixtures/wg-front-rejection-receiver-baseline.sql'),migration=read('supabase/migrations/20261003133851_wg_front_rejection_receiver_contract.sql');
const phrase='Olá, solicite a retirada novamente, obrigado',notice='业务备注包含未识别或敏感自由文本，原文已隐藏，待核实',prefixes=['Reasons for not automatically withdrawing funds:','未自动出款原因:','未自动出款原因：'];
const legacyTemplate=prefixes[0]+" Members' first 2 withdrawals must be reviewed";
const fields=extra=>({schema_version:1,operator_name:'synthetic-agent',operator_class:'manual',note_state:'empty',remark_sanitized:null,rejection_reason:null,interception_reason:null,interception_codes:[],front_note_state:'template',front_note_sanitized:phrase,back_note_state:'empty',back_note_sanitized:null,...extra});
let db,beforeMetadata,wrapperBefore;
const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].value;
const validate=x=>db.query('select private.wg_business_fields_validate($1::jsonb)',[JSON.stringify(x)]);
const record=(x,status=7,business='withdraw')=>db.query('select private.wg_detail_validate_record($1::jsonb,$2,$3)',[JSON.stringify({status_code:status,business_fields:x}),'SYNTHETIC-SITE',business]);
const metadata=()=>db.query("select p.oid::regprocedure::text signature,to_jsonb(p)-'prosrc' value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' order by signature").then(x=>x.rows);
const hashes=()=>db.query("select proname,md5(prosrc) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' order by proname").then(x=>Object.fromEntries(x.rows.map(r=>[r.proname,r.hash])));
const bodies=baseline.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$function\$\s*;/g);
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
 create function private.wg_detail_validate_record_v2(jsonb,text,text) returns void language plpgsql set search_path='' as $$begin return;end$$;`);
 await db.exec(baseline);await db.exec(`revoke all on function private.wg_business_note_allowed(text),private.wg_business_fields_validate(jsonb),private.wg_detail_validate_record(jsonb,text,text) from public,anon,authenticated,service_role;`);
 const old=await hashes();assert.equal(old.wg_business_note_allowed,'5d6c53850c8fd3ecbf2df990bf06ec58');assert.equal(old.wg_business_fields_validate,'8ab4c6027421cb33e3881e7a83f35933');assert.equal(old.wg_detail_validate_record,'29338f9cd2d5f54b91b4d712c95a09f4');
 await assert.rejects(validate(fields({rejection_reason:phrase})),/WG_INVALID_BUSINESS_FIELDS/);
 beforeMetadata=await metadata();wrapperBefore=await scalar("select to_jsonb(p) value from pg_proc p where oid='private.wg_detail_validate_record(jsonb,text,text)'::regprocedure");await db.exec(migration);
});
after(async()=>db?.close());
test('the confirmed Portuguese phrase is allowed as exact business text, while arbitrary additions and PII remain denied',async()=>{
 assert.equal(await scalar('select private.wg_business_note_allowed($1) value',[phrase]),true);
 for(const text of [phrase+' CUSTOMER-CANARY-42',phrase+'; phone: +5511999988888',phrase+'; token: CANARY',phrase+'\u001f','João Synthetic Customer','CPF: 123.456.789-01','New unverified business wording'])assert.equal(await scalar('select private.wg_business_note_allowed($1) value',[text]),false,text);
 for(const key of ['remark_sanitized','rejection_reason','interception_reason','front_note_sanitized','back_note_sanitized'])await assert.rejects(validate(fields({[key]:'PRIVATE-CANARY'})),/WG_INVALID_BUSINESS_FIELDS/);
});
test('safe equal frontRemark supplies rejected notes with empty, absent/withheld or independent interception main remarks',async()=>{
 for(const extra of [
  {note_state:'empty'},
  {note_state:'withheld'},
  {note_state:'withheld',remark_sanitized:notice},
  {note_state:'template',remark_sanitized:legacyTemplate,interception_reason:legacyTemplate,interception_codes:['first_member_withdrawals']}
 ]){const x=fields({...extra,rejection_reason:phrase});await validate(x);await record(x);assert.equal(x.rejection_reason,phrase);assert.equal(x.note_state,extra.note_state)}
});
test('front provenance exception is narrow: template, equal safe text, and no automatic-withdraw prefix',async()=>{
 for(const bad of [
  fields({rejection_reason:'Invalid bank details'}),
  fields({front_note_state:'empty',front_note_sanitized:null,rejection_reason:phrase}),
  fields({front_note_state:'withheld',front_note_sanitized:notice,rejection_reason:phrase}),
  fields({front_note_state:'redacted',front_note_sanitized:phrase+'; '+notice,rejection_reason:phrase+'; '+notice}),
  fields({note_state:'empty',remark_sanitized:'Invalid bank details',rejection_reason:phrase}),
  fields({note_state:'withheld',remark_sanitized:'Invalid bank details',rejection_reason:phrase}),
  fields({raw_frontRemark:'PRIVATE-CANARY',rejection_reason:phrase})
 ])await assert.rejects(validate(bad),/WG_INVALID_BUSINESS_FIELDS/);
 for(const prefix of prefixes)for(const state of ['empty','template','withheld'])await assert.rejects(validate(fields({note_state:state,front_note_sanitized:prefix+' Invalid bank details',rejection_reason:prefix+' Invalid bank details'})),/WG_INVALID_BUSINESS_FIELDS/);
});
test('unknown/private/partial/empty/missing front states can preserve source evidence without fabricating a final reason',async()=>{
 for(const extra of [
  {front_note_state:'withheld',front_note_sanitized:notice},
  {front_note_state:'redacted',front_note_sanitized:phrase+'; '+notice},
  {front_note_state:'empty',front_note_sanitized:null},
  {front_note_state:'withheld',front_note_sanitized:null}
 ])await record(fields({...extra,rejection_reason:null}));
});
test('the unchanged record wrapper still accepts rejection only for withdrawal status 7',async()=>{
 for(const status of [1,3,4,5,6,8])await assert.rejects(record(fields({rejection_reason:phrase}),status),/WG_INVALID_BUSINESS_FIELDS/);
 await assert.rejects(record(fields({rejection_reason:phrase}),7,'recharge'),/WG_INVALID_BUSINESS_FIELDS/);
 for(const status of [1,3,4,5,6,8])await record(fields({rejection_reason:null}),status);
});
test('legacy R12 valid contracts keep working and all metadata/OIDs/ACLs and wrapper body are preserved',async()=>{
 await record(fields({note_state:'template',remark_sanitized:'Invalid bank details',rejection_reason:'Invalid bank details',front_note_state:'empty',front_note_sanitized:null}));
 await record(fields({note_state:'withheld',remark_sanitized:notice,rejection_reason:notice,front_note_state:'withheld',front_note_sanitized:notice}));
 assert.deepEqual(await metadata(),beforeMetadata);assert.deepEqual(await scalar("select to_jsonb(p) value from pg_proc p where oid='private.wg_detail_validate_record(jsonb,text,text)'::regprocedure"),wrapperBefore);
 const after=await hashes();assert.equal(after.wg_business_note_allowed,'8de0f6016c65daa067ca4cd7d2ffb187');assert.equal(after.wg_business_fields_validate,'d273cf8201f2e2f682f873ada59bf444');
 for(const role of ['anon','authenticated','service_role'])for(const fn of ['private.wg_business_note_allowed(text)','private.wg_business_fields_validate(jsonb)','private.wg_detail_validate_record(jsonb,text,text)'])assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\') value',[role,fn]),false);
});
test('migration is idempotent and metadata/body drift fails atomically, with no source DML, wrapper edits or grant expansion',async()=>{
 const before=await hashes();await db.exec(migration);assert.deepEqual(await hashes(),before);
 await db.exec('begin');try{await db.exec('grant execute on function private.wg_business_fields_validate(jsonb) to authenticated');await assert.rejects(db.exec(migration),/metadata changed/)}finally{await db.exec('rollback')}
 await db.exec('begin');try{await db.exec(bodies.find(x=>x.includes('FUNCTION private.wg_business_note_allowed(')));await db.exec(bodies.find(x=>x.includes('FUNCTION private.wg_business_fields_validate(')).replace('end $function$','end -- unexpected deployed body\n$function$'));await assert.rejects(db.exec(migration),/helper body changed/)}finally{await db.exec('rollback')}
 assert.deepEqual(await hashes(),before);assert.deepEqual(await metadata(),beforeMetadata);
 assert.doesNotMatch(migration.replace(/--[^\n]*/g,''),/\b(?:grant\s|insert\s+into|delete\s+from|update\s+public|truncate\s|drop\s+(?:table|view|function))\b/i);
});
