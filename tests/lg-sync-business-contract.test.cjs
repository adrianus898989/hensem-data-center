const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {loadTs}=require('./load-typescript.cjs');
const {validateBusinessRaw}=loadTs(path.resolve('supabase/functions/lg-sync-ingest/business.ts'));
const vectors=require('./lg-business-notes/sanitizer_vectors.json').vectors;
let db;
const raw=remark=>({businessSchemaVersion:1,remark,remarkState:!remark?'empty':remark==='[已隐藏]'?'redacted':'present',appRemark:'',appRemarkState:'missing'});
test.before(async()=>{db=new PGlite();await db.exec('create schema private;create role anon;create role authenticated;create role service_role;');await db.exec(fs.readFileSync('supabase/lg-business-notes-receiver.sql','utf8'));});
test.after(async()=>{await db?.close()});
test('all 41 canonical client outputs pass Edge shape and authoritative SQL privacy checks unchanged',async()=>{
 assert.equal(vectors.length,41);
 for(const v of vectors){const r=raw(v.safe),before=JSON.stringify(r);validateBusinessRaw(r);await db.query('select private.lg_validate_business_raw($1::jsonb)',[before]);assert.equal(JSON.stringify(r),before,'no rewrite vector '+v.id);}
});
test('SQL still rejects sensitive note values after the structural Edge gate',async()=>{
 for(const v of ['phone: +55 11 99999-8888','name Alice Smith','98****1234','synthetic@example.invalid']){
  const r=raw(v);validateBusinessRaw(r);await assert.rejects(db.query('select private.lg_validate_business_raw($1::jsonb)',[JSON.stringify(r)]),/LG_INVALID_BUSINESS_NOTE/);
 }
});
test('Unicode code point limits and nullable legacy fields agree with SQL',async()=>{
 const r={...raw('文'.repeat(12000)),orderAmount:null,operatorName:'😀'.repeat(500),groupList:[{groupId:0,groupName:'正常业务',colorTag:'#abcdef12'}],groupListTruncated:true,transactionId:'98765432109876543210',currentProfitAmount:'-123.456'};
 validateBusinessRaw(r);await db.query('select private.lg_validate_business_raw($1::jsonb)',[JSON.stringify(r)]);
 for(const patch of [{remark:'文'.repeat(12001)},{operatorName:'😀'.repeat(501)},{businessSchemaVersion:'1'},{memberPhone:'synthetic'},{groupList:[{groupId:1,userId:2}]},{groupListTruncated:false},{firstFlag:true},{currentProfitAmount:12}]){
  const x={...r,...patch};assert.throws(()=>validateBusinessRaw(x),/LG_INVALID/);await assert.rejects(db.query('select private.lg_validate_business_raw($1::jsonb)',[JSON.stringify(x)]),/LG_INVALID/);
 }
});
