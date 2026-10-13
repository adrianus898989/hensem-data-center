// Real legacy JSON summary and collected wrapper, synthetic inputs only.
// Dependency paths are repository paths; this test does not depend on work/.
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=name=>fs.readFileSync(path.join(__dirname,'../supabase',name),'utf8');
const legacy=read('admin-deposit-reconciliation-v2.sql').match(/create function private\.dashboard_admin_deposit_kyc_summary_v2\(p_rows jsonb\)[\s\S]*?\$summary\$;/i)?.[0];
const original=read('migrations/20261004081041_deposit_collected_workorder_statistics.sql').match(/CREATE OR REPLACE FUNCTION private\.dashboard_admin_deposit_collected_summary\(p_rows jsonb\)[\s\S]*?\$collected_summary\$;/i)?.[0];
assert(legacy&&original,'shipped summary definitions are required');
const anchor='from (select private.dashboard_admin_deposit_kyc_summary_v2(p_rows) value) s;';
assert.equal(original.split(anchor).length-1,1,'unique original wrapper barrier anchor');
const candidate=original.replace(anchor,'from (select private.dashboard_admin_deposit_kyc_summary_v2(p_rows) value offset 0) s;');
let db,comparisons=0;
const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
const summary=rows=>scalar('select private.dashboard_admin_deposit_collected_summary($1::jsonb)::text',[rows===null?null:JSON.stringify(rows)]);
const row=(extra={})=>({wo_key:'synthetic-workorder-A',case_key:'synthetic-case-A',payment_id:'synthetic-payment-A',export_rows:1,
 kyc:'connected',processing:'processed',case_processing:'processed',amount:'12.3400',currency:'INR',match_status:'exact_unique',source_conflict:false,...extra});
async function pair(rows){
 await db.exec(original);const old=await summary(rows);
 await db.exec(candidate);const result=await summary(rows);
 assert.equal(result,old,'complete PostgreSQL JSON text unchanged, including decimal precision');comparisons++;
 const json=JSON.parse(result);assert(!Object.hasOwn(json,'exportRows'));assert(!Object.hasOwn(json,'duplicateExportRows'));
 assert(Object.hasOwn(json,'rawRecords')&&Object.hasOwn(json,'duplicateSourceRows'));
 return json;
}
before(async()=>{db=new PGlite();await db.exec('create schema private');await db.exec(legacy);await db.exec(original);});
beforeEach(async()=>{await db.exec(original);});
after(async()=>{assert(comparisons>=25);console.log(JSON.stringify({completeJsonTextComparisons:comparisons,additionalInstrumentedRealSummaryComparison:1,invalidInputPairs:5}));await db.close();});

test('NULL, empty, missing identity and absent currency retain unknown values and true zeroes',async()=>{
 for(const rows of [null,[],[{}],[row({payment_id:null,amount:null,currency:null})],[row({amount:null})],[row({currency:null})]])await pair(rows);
 const empty=await pair([]);assert.equal(empty.rawRecords,0);assert.equal(empty.uniqueWorkorders,0);assert.equal(empty.uniquePaymentOrders,0);assert.equal(empty.uniquePaymentAmount,null);assert.equal(empty.currency,null);
 const missing=await pair([row({amount:null})]);assert.equal(missing.unknownAmountOrders,1);assert.equal(missing.knownPaymentAmount,null);assert.equal(missing.uniquePaymentAmount,null);
});
test('native numeric scale, large exact values, zero, negatives and accepted exceptional numeric inputs are unchanged',async()=>{
 for(const amount of ['0.00','-0.01','12.3400','1234567890123456.12','NaN','Infinity','-Infinity'])await pair([row({amount})]);
 const zero=await pair([row({amount:'0.00'})]);assert.equal(zero.uniquePaymentAmount,0);assert.equal(zero.processed.amount,0);
 await db.exec(candidate);const text=await summary([row({amount:'1234567890123456.12'})]);assert.match(text,/1234567890123456\.12/);
});
test('mixed currency and missing amounts never become a single-currency total',async()=>{
 const distinct=(extra)=>row({wo_key:'synthetic-workorder-B',case_key:'synthetic-case-B',payment_id:'synthetic-payment-B',...extra});
 for(const currency of ['USD','USDT','',null]){
  const r=await pair([row(),distinct({currency})]);assert.equal(r.currency,null);assert.equal(r.uniquePaymentAmount,null);
 }
 const r=await pair([row(),distinct({amount:null})]);assert.equal(r.uniquePaymentAmount,null);assert.equal(r.knownPaymentAmount,12.34);assert.equal(r.unknownAmountOrders,1);
});
test('duplicate snapshots, multiple workorders, KYC and processing disagreements preserve distinct counting units',async()=>{
 const rows=[row({export_rows:3,kyc:'connected'}),row({wo_key:'synthetic-workorder-B',export_rows:2,kyc:'disconnected',processing:'rejected'}),
  row({wo_key:'synthetic-workorder-C',case_key:'synthetic-case-C',payment_id:null,amount:null,currency:null,kyc:'unknown',processing:'unknown',case_processing:'unknown',match_status:'missing_rc'})];
 const r=await pair(rows);assert.equal(r.rawRecords,6);assert.equal(r.uniqueWorkorders,3);assert.equal(r.duplicateSourceRows,3);assert.equal(r.uniquePaymentOrders,1);assert.equal(r.multipleWorkorderPayments,1);
 assert.equal(r.processed.count,1);assert.equal(r.rejected.count,1);assert.equal(r.unknownProcessing.count,1);assert.equal(r.uniquePaymentAmount,12.34);
 await pair([row(),row({amount:'12.3500',source_conflict:true,processing:'unknown',case_processing:'unknown',match_status:'source_conflict'})]);
});
test('all matching and processing categories retain full JSON for individual and combined groups',async()=>{
 const matches=['exact_unique','exact_duplicate','amount_conflict','ambiguous_online','online_amount_missing','unmatched','platform_not_in_online_snapshot','missing_rc','source_conflict'];
 const rows=matches.map((match_status,i)=>row({wo_key:'synthetic-workorder-'+i,case_key:'synthetic-case-'+i,payment_id:'synthetic-payment-'+i,match_status,
  kyc:['connected','disconnected','unknown'][i%3],processing:['processed','rejected','unprocessed','unknown'][i%4],case_processing:['processed','rejected','unprocessed','unknown'][i%4]}));
 for(const r of rows)await pair([r]);const all=await pair(rows);
 for(const match of matches)assert.equal(all.matchCounts[match],1);
 assert.equal(all.uniqueWorkorders,9);assert.equal(all.uniquePaymentOrders,9);
 for(const key of ['kyc','processing','match_status'])for(const value of [...new Set(rows.map(r=>r[key]))])await pair(rows.filter(r=>r[key]===value));
});
test('invalid legacy input fails identically instead of being coerced or silently emptied',async()=>{
 for(const value of [false,{},[1],[row({export_rows:'not-an-integer'})],[row({amount:'not-a-numeric'})]]){
  let old,curr;await db.exec(original);try{await summary(value)}catch(e){old=e}
  await db.exec(candidate);try{await summary(value)}catch(e){curr=e}
  assert(old&&curr);assert.equal(curr.code,old.code);assert.equal(curr.message,old.message);
 }
});
test('wrapper-only barrier preserves target and legacy metadata and reduces real legacy evaluations from three to one',async()=>{
 const meta=name=>scalar('select to_jsonb(p)-\'prosrc\' from pg_proc p where oid=$1::regprocedure',[name]);
 const target='private.dashboard_admin_deposit_collected_summary(jsonb)',legacyName='private.dashboard_admin_deposit_kyc_summary_v2(jsonb)';
 const beforeTarget=await meta(target),beforeLegacy=await meta(legacyName),legacyHash=await scalar('select md5(prosrc) from pg_proc where oid=$1::regprocedure',[legacyName]);
 await db.exec(candidate);assert.deepEqual(await meta(target),beforeTarget);assert.deepEqual(await meta(legacyName),beforeLegacy);
 assert.equal(await scalar('select md5(prosrc) from pg_proc where oid=$1::regprocedure',[legacyName]),legacyHash);
 await db.exec('begin');try{
  await db.exec(`create sequence public.synthetic_summary_calls;
   alter function private.dashboard_admin_deposit_kyc_summary_v2(jsonb) rename to synthetic_real_summary;
   create function private.dashboard_admin_deposit_kyc_summary_v2(p_rows jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
   begin perform nextval('public.synthetic_summary_calls'::regclass);return private.synthetic_real_summary(p_rows);end;$$;`);
  const run=async(fn)=>{await db.exec(fn);await db.exec('alter sequence public.synthetic_summary_calls restart with 1');const value=await summary([row(),row({wo_key:'synthetic-workorder-B'})]);return {value,calls:Number(await scalar('select last_value from public.synthetic_summary_calls'))};};
  const old=await run(original),once=await run(candidate);assert.equal(once.value,old.value);assert.equal(old.calls,3);assert.equal(once.calls,1);
 }finally{await db.exec('rollback');}
});
