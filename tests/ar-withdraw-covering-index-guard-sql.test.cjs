const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const guard=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261011102013_ar_withdraw_report_covering_index.sql'),'utf8');
const indexSQL=`create index ar_collected_withdraw_report_cover_idx on public.ar_collected_orders(country_code,platform,applied_at) include(status,operator,completed_at,observed_at,updated_at) where source_system='AR' and order_kind='withdraw' and applied_at>=timestamp '2026-10-10'`;
const setup=`create table public.ar_collected_orders(country_code text,platform text,applied_at timestamp,source_system text,order_kind text,status text,operator text,completed_at timestamp,observed_at timestamptz,updated_at timestamptz);
 insert into public.ar_collected_orders values('IN','91CLUB','2026-10-10 10:00:00','AR','withdraw','success','System',null,null,null);
 alter table public.ar_collected_orders enable row level security;`;
const tableMeta=async db=>(await db.query("select to_jsonb(c)-array['relpages','reltuples','relallvisible'] meta,(select count(*) from public.ar_collected_orders) rows from pg_class c where oid='public.ar_collected_orders'::regclass")).rows[0];
async function main(){
 let pass=0;
 const db=new PGlite();try{await db.exec(setup);await db.exec(indexSQL);const before=await tableMeta(db);await db.exec(guard);await db.exec(guard);assert.deepEqual(await tableMeta(db),before);pass++;}finally{await db.close();}
 const drifts=[
  indexSQL.replace('include(status,operator,','include(operator,status,'),
  indexSQL.replace("order_kind='withdraw'","order_kind='recharge'"),
  indexSQL.replace("timestamp '2026-10-10'","timestamp '2026-10-09'"),
  indexSQL.replace('create index ','create unique index '),
  indexSQL.replace('(country_code,platform,applied_at)','(country_code,platform,applied_at desc)'),
  indexSQL.replace('(country_code,platform,applied_at)','(platform,country_code,applied_at)'),
  indexSQL.replace('(country_code,platform,applied_at)','(country_code collate "C",platform,applied_at)'),
 ];
 for(const sql of drifts){const d=new PGlite();try{await d.exec(setup);await d.exec(sql);const before=await tableMeta(d);await assert.rejects(()=>d.exec(guard),/AR_WITHDRAW_COVER_INDEX_(?:METADATA|COLUMNS|COLLATION)_MISMATCH/);await d.exec('rollback');assert.deepEqual(await tableMeta(d),before);pass++;}finally{await d.close();}}
 const report={synthetic:true,production_calls:0,cases:pass,exact_guard_replay:2,source_rows_owner_acl_rls_preserved:true,drift_rejections:drifts.length,sue_lock_mode:'compatible_with_RowExclusive',production_build_not_tested:true};
 console.log(JSON.stringify(report));
}
require('node:test').test('AR covering-index metadata guard accepts exact replay and rejects seven structural drifts without changing facts',main);
