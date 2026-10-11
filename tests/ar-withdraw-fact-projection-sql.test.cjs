const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,install}=require('./fixtures/ar-withdraw-fact-projection-harness.cjs');
const cases=[
 ['weakened-check',`alter table private.ar_withdraw_facts drop constraint ar_withdraw_facts_method_check;alter table private.ar_withdraw_facts add constraint ar_withdraw_facts_method_check check(method is not null)`,/checks_drift/],
 ['disabled-rls',`alter table private.ar_withdraw_facts disable row level security`,/existing_table_security_drift/],
 ['external-grant',`grant select on private.ar_withdraw_facts to authenticated`,/table_acl_drift/],
 ['public-projector-execute',`grant execute on function private.ar_withdraw_fact(text,text,text,text,text,text,text,timestamp,timestamp,timestamptz,timestamptz) to public`,/existing_function_drift/],
 ['changed-trigger-when',`drop trigger ar_withdraw_fact_sync_insert on public.ar_collected_orders;create trigger ar_withdraw_fact_sync_insert after insert on public.ar_collected_orders for each row when(false) execute function private.sync_ar_withdraw_fact()`,/trigger_drift/],
 ['disabled-trigger',`alter table public.ar_collected_orders disable trigger ar_withdraw_fact_sync_update`,/trigger_drift/],
 ['changed-reader',`alter function private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date) security definer`,/reader_baseline_drift/]
];
async function guards(){for(const [name,mutation,expected] of cases){const db=await fixture();try{await db.exec(install);await db.exec(mutation);await assert.rejects(()=>db.exec(install),expected,name);await db.exec('rollback');}finally{await db.close();}}
 return {guard_cases:cases.length,all_passed:true};
}
const test=require('node:test'),{main}=require('./fixtures/ar-withdraw-fact-projection-harness.cjs');
test('AR withdrawal facts maintain native source atomically; safe bounded backfill, updates, moves, deletes and private ACL',main);
test('AR fact installer rejects CHECK, security, trigger and original reader drift',guards);
