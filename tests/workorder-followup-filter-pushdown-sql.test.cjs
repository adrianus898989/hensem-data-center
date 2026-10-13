const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{fixture}=require('./fixtures/workorder-followup-page-receipts-fixture.cjs');
const previousMigration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261013075945_workorder_followup_page_receipt_dates.sql'),'utf8');
const baseline=previousMigration.match(/\$definition\$([\s\S]*?)\$definition\$/)[1];
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261013124309_workorder_followup_filter_pushdown.sql'),'utf8');
const candidate=migration.match(/\$definition\$([\s\S]*?)\$definition\$/)[1];
const rollback=fs.readFileSync(path.join(__dirname,'fixtures/workorder-followup-filter-pushdown-rollback.sql'),'utf8');
test('bounded installer, replay and exact rollback preserve function metadata and service-only ACL',async()=>{const h=await fixture();try{
 await h.db.exec(baseline);const meta=async()=>(await h.db.query("select to_jsonb(p)-'prosrc' v from pg_proc p where oid='public.workorder_followup_list(jsonb,jsonb,integer,integer)'::regprocedure")).rows[0].v;
 const old=await meta();await h.db.exec(migration);assert.deepEqual(await meta(),old);await h.db.exec(migration);assert.deepEqual(await meta(),old);await h.db.exec(rollback);assert.deepEqual(await meta(),old);
 const hash=async()=>(await h.db.query("select md5(prosrc) h from pg_proc where oid='public.workorder_followup_list(jsonb,jsonb,integer,integer)'::regprocedure")).rows[0].h;assert.equal(await hash(),'ebdc0eb1043b7e68db0170ca97ee1c88');
 await h.db.exec('grant execute on function public.workorder_followup_list(jsonb,jsonb,integer,integer)to anon');await assert.rejects(()=>h.db.exec(migration),/definition_drift/);await h.db.exec('rollback');assert.equal(await hash(),'ebdc0eb1043b7e68db0170ca97ee1c88');
 }finally{await h.db.close();}});
test('search preserves full RPC rows, counts, all-history facets, permissions and paging',async()=>{const h=await fixture();try{
 const filters=[{}, {from:'2026-10-07',to:'2026-10-13'},{view:'pending'},{source:'sheet'},{source:'portal'},{platform:'82LOTTERY'},{platform:'UNAUTHORIZED'},{provider:'Pay-1'},{orderNo:'SYNTHETIC'},{orderNo:'synthetic38'},{orderNo:'not-found'},{orderNo:'%'},{orderNo:'_'},{orderNo:'\\'},{workorder:'WORK-2'},{utr:'0002'},{reply:'reply'},{upiId:'synthetic2'},{kycUpiId:'***'},{creator:'Creator-1'},{follower:'Follower-1'},{staffCode:'Staff-1'},{outcome:'success'},{kyc:'yes'},{utrMatch:'no'},{minAmount:'120',maxAmount:'140'},{orderNo:'synthetic',from:'2026-10-13',to:'2026-10-13',platform:'PLATFORM-A',provider:'Pay-2'}];
 let comparisons=0;for(const role of ['agent','supervisor','auditor'])for(const f of filters)for(const offset of [0,20]){const account={...h.acct,role};await h.db.exec(baseline);const a=await h.call(f,account,offset);await h.db.exec(candidate);const b=await h.call(f,account,offset);assert.deepEqual(b,a);comparisons++;}assert.equal(comparisons,162);
 for(const account of [{...h.acct,active:false},{...h.acct,role:'owner'},{...h.acct,team:''}]){await h.db.exec(baseline);await assert.rejects(()=>h.call({},account));await h.db.exec(candidate);await assert.rejects(()=>h.call({},account));}
 }finally{await h.db.close();}});
test('one-order filter reduces normalization work before rows are materialized; no wildcard behavior is introduced',async()=>{const h=await fixture();try{
 await h.db.exec('create sequence private.normalization_spy');
 for(const name of ['workorder_followup_outcome','workorder_followup_check'])await h.db.exec(`create or replace function private.${name}(p_value text)returns text language plpgsql stable set search_path=''as $$begin perform nextval('private.normalization_spy');return lower(p_value);end;$$;`);
 await h.db.exec(baseline);await h.db.exec('alter sequence private.normalization_spy restart with 1');const a=await h.call({workorder:'WORK-38'});const before=Number((await h.db.query('select last_value from private.normalization_spy')).rows[0].last_value);
 await h.db.exec(candidate);await h.db.exec('alter sequence private.normalization_spy restart with 1');const b=await h.call({workorder:'WORK-38'});const after=Number((await h.db.query('select last_value from private.normalization_spy')).rows[0].last_value);
 assert.deepEqual(b,a);assert.equal(b.total,1);assert(before>after);assert.equal(after,3);
 }finally{await h.db.close();}});
