// Full audited dependency functions over synthetic empty fee/provider tables.
// These are real selectors, not constant dependency-token stubs.
const fs=require('node:fs'),path=require('node:path');
const R=path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(R,n),'utf8');
const names=['dashboard_withdraw_status_dependency_md5','withdraw_prepared_dependency','prepared_aggregate_dependency_common','provider_snapshot_dependency_token','provider_snapshot_dependency_batch'];
async function install(db){
 await db.exec(`set check_function_bodies=off;
 create table if not exists private.fee_rate_versions(id uuid,country text,rule_key text);
 create table if not exists private.fee_rate_current_evidence(version_id uuid,rule_key text,generation_id uuid,source_id uuid,state text,direction text);
 create table if not exists private.fee_rate_generations(id uuid,published_at timestamptz);
 create table if not exists public.third_party_rates(id uuid,country text,category text,third_party text,updated_at timestamptz);
 create table if not exists private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values jsonb);
 create table if not exists private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text,version int);
 create table if not exists private.dashboard_admin_order_provider_confirmations(source_system text,country_code text,platform text,order_kind text,order_no text,confirmed_provider text,active boolean);
 create table if not exists public.ar_config_targets(source_system text,country_code text,platform text,currency text);
 create table if not exists public.newar_business_snapshots(id uuid);
 `);
 for(const n of names)await db.exec(read('baseline/financial/'+n+'.sql'));
 await db.exec('revoke all on function private.dashboard_withdraw_status_dependency_md5(pg_proc),private.withdraw_prepared_dependency(),private.prepared_aggregate_dependency_common(text),private.provider_snapshot_dependency_token(jsonb),private.provider_snapshot_dependency_batch(jsonb)from public,anon,authenticated,service_role');
}
async function tokens(db){return(await db.query(`select jsonb_build_object('withdraw',private.withdraw_prepared_dependency(),'commonIN',private.prepared_aggregate_dependency_common('IN'),'commonBR',private.prepared_aggregate_dependency_common('BR'),'provider',private.provider_snapshot_dependency_token('{"id":"synthetic","name":"SYNTHETIC","source":"ar","source_name":"SYNTHETIC","scope_group":"IN"}'),'batch',private.provider_snapshot_dependency_batch('[{"id":"synthetic","name":"SYNTHETIC","source":"ar","source_name":"SYNTHETIC","scope_group":"IN"}]'))v`)).rows[0].v}
module.exports={install,tokens,names};
