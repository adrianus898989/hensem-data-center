// Synthetic read-only source facts. No production members/orders or Auth impersonation.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const repo=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const migration=read('supabase/migrations/20261010111216_auto_withdraw_canonical_partial_classification.sql');
const baseline=read('tests/fixtures/auto-withdraw-canonical-classification-baseline.sql');
const keySig='private.dashboard_admin_live_withdraw_key(text)',readerSig='private.dashboard_admin_live_auto_withdraw(jsonb)';
const req=extra=>({country:'印度',startAt:'2026-10-09T00:00:00Z',endAt:'2026-10-09T23:59:59Z',limit:20,...extra});
const call=async(db,extra={})=>(await db.query('select private.dashboard_admin_live_auto_withdraw($1::jsonb) value',[JSON.stringify(req(extra))])).rows[0].value;
const meta=async(db,sig)=>(await db.query("select to_jsonb(p)-'prosrc' metadata,md5(prosrc) hash from pg_proc p where oid=$1::regprocedure",[sig])).rows[0];
const typed={
 newar:'total bigint,success bigint,rejected bigint,auto_count bigint,manual_count bigint,pending_count bigint,unknown_count bigint,unclassified_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb,currencies jsonb,currency_unknown_count bigint',
 yash:'total bigint,success bigint,rejected bigint,pending_count bigint,failed_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb',
 wg:'total bigint,success bigint,rejected bigint,auto_count bigint,manual_count bigint,avg_seconds numeric,source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb,paying_count bigint,forced_count bigint,unknown_count bigint'
};
async function fixture(){
 const db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable set search_path='' as $$begin
 if current_setting('test.denied',true)='yes' then raise exception 'synthetic_session_denied' using errcode='42501';end if;
 return coalesce(nullif(current_setting('test.scope',true),''),'{}')::jsonb;end$$;
 create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable set search_path='' as $$select coalesce(s->'targets' @> jsonb_build_array(jsonb_build_array(c,p)),true)$$;
 create function private.dashboard_admin_live_report_country(text,text) returns text language sql immutable set search_path='' as $$select case $1 when 'IN' then '印度' when 'BR' then '巴西' else $1 end$$;
 create function private.dashboard_admin_live_can_note() returns boolean language sql stable set search_path='' as $$select false$$;
 create table public.game66_platforms(id uuid default gen_random_uuid(),team_code text,team_name text,platform_name text);
 create function private.dashboard_admin_live_game66_withdraw(date,date,text,text[]) returns jsonb language sql stable set search_path='' as $$select '{"rows":[],"operatorRows":[]}'::jsonb$$;
 create table public.auto_withdraw_daily(data_date date,country text,platform text,total bigint,success bigint,rejected bigint,auto_count bigint,manual_count bigint,avg_seconds numeric,source_updated_at timestamptz,updated_at timestamptz);
 create table public.withdraw_operator_daily(data_date date,country text,platform text,account text,processed bigint,rejected bigint,avg_seconds numeric,source_updated_at timestamptz,updated_at timestamptz);
 create table public.newar_business_snapshots(kind text,direction text,country text,platform text,stat_date date,payload jsonb,captured_at timestamptz,updated_at timestamptz);
 create table public.auto_withdraw_notes(data_date date,country text,platform text,reason text,updated_at timestamptz);
 create table private.synthetic_native_days(source text,country text,platform text,source_platform text,data_date date,payload jsonb);
 ${baseline.slice(0,baseline.indexOf('CREATE OR REPLACE FUNCTION private.dashboard_admin_live_auto_withdraw'))}
 create function private.synthetic_selected(r jsonb,s jsonb,c text,p text,raw_p text) returns boolean language sql stable set search_path='' as $$
 select private.dashboard_scope_allows(s,c,raw_p)
  and (case when r ? 'scopeTargets' then exists(select 1 from jsonb_array_elements(r->'scopeTargets')t where t->>'country'=c and exists(select 1 from jsonb_array_elements_text(t->'platforms')v where private.dashboard_admin_live_withdraw_key(v)=private.dashboard_admin_live_withdraw_key(p))) else r->>'country'=c end)
  and (nullif(r->>'platform','') is null or private.dashboard_admin_live_withdraw_key(r->>'platform')=private.dashboard_admin_live_withdraw_key(p))
  and (not r ? 'platforms' or jsonb_array_length(r->'platforms')=0 or nullif(r->>'platform','') is not null or exists(select 1 from jsonb_array_elements_text(r->'platforms')v where private.dashboard_admin_live_withdraw_key(v)=private.dashboard_admin_live_withdraw_key(p)))$$;
 grant usage on schema private to anon,authenticated,service_role;`);
 await db.exec(baseline);
 await db.exec(`revoke all on function ${keySig} from public,anon,authenticated,service_role;
 revoke all on function ${readerSig} from public,anon,authenticated,service_role;grant execute on function ${readerSig} to authenticated;`);
 for(const source of ['newar','yash','wg']){
 const fields=typed[source],name='private.dashboard_admin_'+source+'_withdraw_days';
 await db.exec(`create function ${name}(r jsonb,s jsonb,a date,b date) returns table(data_date date,country text,platform text,platform_key text,${fields}) language sql stable set search_path='' as $$
 select n.data_date,n.country,n.platform,private.dashboard_admin_live_withdraw_key(n.platform),f.* from private.synthetic_native_days n cross join lateral jsonb_to_record(n.payload) f(${fields})
 where n.source='${source}' and n.data_date between a and b and private.synthetic_selected(r,s,n.country,n.platform,n.source_platform)$$;`);
 }
 assert.equal((await meta(db,readerSig)).hash,'b9d0f3c8a83881b530505afc94a46a53');
 assert.equal((await meta(db,keySig)).hash,'40951d8743777deafdd64153820fd473');
 return db;
}
async function native(db,source,platform,date,payload,sourcePlatform=platform,country='印度'){
 const defaults={total:10,success:8,rejected:1,auto_count:0,manual_count:10,pending_count:1,unknown_count:0,unclassified_count:0,failed_count:0,avg_seconds:null,duration_sample_count:0,duration_total_seconds:null,source_updated_at:null,updated_at:'2026-10-10T00:00:00Z',complete:true,operator_rows:[],currencies:['INR'],currency_unknown_count:0,paying_count:0,forced_count:0};
 await db.query('insert into private.synthetic_native_days values($1,$2,$3,$4,$5,$6::jsonb)',[source,country,platform,sourcePlatform,date,JSON.stringify({...defaults,...payload})]);
}
async function legacy(db,platform,date,total=20,auto=5,manual=15,country='印度'){
 await db.query('insert into public.auto_withdraw_daily values($1,$2,$3,$4,$4,0,$5,$6,12,$7,$7)',[date,country,platform,total,auto,manual,'2026-10-10T00:00:00Z']);
}
async function maan(db){
 for(const date of ['2026-10-08','2026-10-09']){
  await native(db,'newar','MAAN.WIN',date,{operator_rows:[{account:'SYNTHETIC',processed:10,rejected:1,success:8,avg_seconds:null,duration_sample_count:0,duration_total_seconds:null,source_updated_at:null,updated_at:'2026-10-10T00:00:00Z'}]},'MAANWIN');
  await db.query('insert into public.newar_business_snapshots values($1,$2,$3,$4,$5,$6::jsonb,$7,$7)',[
   'auto_withdraw_bundle','all','印度','MAANWIN',date,JSON.stringify({rows:[{total_count:10,success_count:8,reject_count:1,auto_count:3,manual_count:7,total_handle_seconds:210,handle_count:7}],operator_rows:[{operator:'SYNTHETIC',processed_count:7,reject_count:1,total_handle_seconds:210,handle_count:7}]}),'2026-10-10T00:00:00Z']);
  await legacy(db,'MAAN.WIN',date,999,400,599);
 }
}
test('MAAN display alias suppresses old daily/snapshot facts without borrowing their conflicting classification or duration',async()=>{
 const db=await fixture();try{
  await maan(db);const before=await call(db);assert.equal(before.total,2);assert.equal(before.totals.total,20);
  await db.exec(migration);
  for(const extra of [{},{platform:'MAAN.WIN'},{platform:'MAANWIN'},{platforms:['MAAN.WIN','MAANWIN']},{scopeTargets:[{country:'印度',platforms:['MAAN.WIN']}]}]){
   const r=await call(db,extra);assert.equal(r.total,1);assert.equal(r.totals.total,10);assert.equal(r.totals.autoCount,0);assert.equal(r.totals.manualCount,10);assert.equal(r.totals.avgSeconds,null);assert.equal(r.totals.durationSampleCount,0);assert.equal(r.previousTotals.total,10);assert.equal(r.rows[0].platform,'MAAN.WIN');assert.equal(r.rows[0].source,'NEWAR');assert.equal(r.rows[0].classificationComplete,true);
  }
  const operators=await call(db,{view:'operators'});assert.equal(operators.total,1);assert.equal(operators.totals.processed,10);assert.equal(operators.rows[0].account,'SYNTHETIC');assert.equal(operators.totals.avgSeconds,null);
 }finally{await db.close()}
});
test('registered NewAR missing observations remain unknown and never fall back to a classified snapshot',async()=>{
 const db=await fixture();try{
  await maan(db);await db.exec("update private.synthetic_native_days set payload=payload||'{\"total\":null,\"success\":null,\"rejected\":null,\"auto_count\":null,\"manual_count\":null,\"unclassified_count\":null,\"complete\":false,\"operator_rows\":[]}'::jsonb");
  await db.exec(migration);const r=await call(db);assert.equal(r.total,1);assert.equal(r.rows[0].source,'NEWAR');assert.equal(r.rows[0].total,null);assert.equal(r.rows[0].autoCount,null);assert.equal(r.rows[0].manualCount,null);assert.equal(r.rows[0].previous,null);assert.equal(r.rows[0].classificationComplete,false);assert.equal(r.totals.total,null);assert.equal(r.totals.unclassifiedCount,null);assert.equal(r.comparison.complete,false);
 }finally{await db.close()}
});
test('mixed YASH and known classifications keep exact subtotals, unknown counts and incomparable periods',async()=>{
 const db=await fixture();try{
  for(const date of ['2026-10-08','2026-10-09']){await legacy(db,'KNOWN',date,20,5,12);await native(db,'yash','YASH.BET',date,{total:100,success:80,rejected:5});}
  const before=await call(db);assert.equal(before.totals.autoCount,null);assert.equal(before.totals.manualCount,null);
  await db.exec(migration);const r=await call(db);
  for(const period of ['totals','previousTotals']){assert.equal(r[period].total,120);assert.equal(r[period].autoCount,5);assert.equal(r[period].manualCount,12);assert.equal(r[period].unclassifiedCount,103);assert.equal(r[period].classificationAvailable,false);assert.equal(r[period].classificationPartial,true);assert.equal(r[period].classificationComparable,false);}
  assert.equal(r.rows.find(x=>x.platform==='YASH.BET').autoCount,null);assert.equal(r.rows.find(x=>x.platform==='YASH.BET').manualCount,null);assert.equal(r.rows.find(x=>x.platform==='YASH.BET').classificationAvailable,false);
 }finally{await db.close()}
});
test('all unknown classification stays NULL; a genuinely known zero remains a verified partial zero',async()=>{
 const db=await fixture();try{
  await native(db,'yash','YASH.BET','2026-10-09',{total:100});await db.exec(migration);
  let r=await call(db);assert.equal(r.totals.autoCount,null);assert.equal(r.totals.manualCount,null);assert.equal(r.totals.classificationPartial,false);assert.equal(r.totals.unclassifiedCount,100);
  await legacy(db,'KNOWN-ZERO','2026-10-09',0,0,0);r=await call(db);assert.equal(r.totals.autoCount,0);assert.equal(r.totals.manualCount,0);assert.equal(r.totals.classificationPartial,true);assert.equal(r.totals.total,100);assert.equal(r.totals.unclassifiedCount,100);
 }finally{await db.close()}
});
test('global classification totals do not depend on the page, source selection or account/day presentation',async()=>{
 const db=await fixture();try{
  for(let i=0;i<25;i++)await legacy(db,'KNOWN-'+i,'2026-10-09',20,5,12);
  await native(db,'yash','YASH.BET','2026-10-09',{total:100});await db.exec(migration);
  const a=await call(db),b=await call(db,{offset:20});assert.equal(a.rows.length,20);assert.equal(b.rows.length,6);assert.deepEqual(a.totals,b.totals);assert.equal(a.totals.autoCount,125);assert.equal(a.totals.manualCount,300);assert.equal(a.totals.unclassifiedCount,175);
  const known=await call(db,{platforms:['KNOWN-0']});assert.equal(known.totals.autoCount,5);assert.equal(known.totals.classificationAvailable,undefined);assert.equal(known.totals.classificationPartial,undefined);
  const unknown=await call(db,{platform:'YASH.BET'});assert.equal(unknown.totals.autoCount,null);assert.equal(unknown.totals.classificationPartial,false);
  const daily=await call(db,{daily:true});assert.deepEqual(daily.totals,a.totals);
 }finally{await db.close()}
});
test('unaffected non-MAAN and fully classified source responses retain their complete JSON',async()=>{
 const db=await fixture();try{
  for(const date of ['2026-10-08','2026-10-09'])await legacy(db,'SHREE.WIN',date);
  const before=[];for(const extra of [{},{daily:true},{platform:'SHREEWIN'},{view:'operators'},{offset:20}])before.push(await call(db,extra));
  await db.exec(migration);for(const [i,extra]of [{},{daily:true},{platform:'SHREEWIN'},{view:'operators'},{offset:20}].entries())assert.deepEqual(await call(db,extra),before[i]);
  const values=(await db.query("select private.dashboard_admin_live_withdraw_key(name) value from unnest(array['DHANI.WIN','SHREE.WIN','VEER.GAME','MAAN.WIN','MAANWIN','maan.win','MAAN-WIN','MAAN WIN',null,''])name")).rows.map(x=>x.value);
  assert.deepEqual(values,['DHANIWIN','SHREEWIN','VEERGAME','MAANWIN','MAANWIN','MAANWIN','MAAN-WIN','MAAN WIN',null,'']);
 }finally{await db.close()}
});
test('fresh scope and denial checks remain enforced with alias/partial metadata; no extra source escapes selection',async()=>{
 const db=await fixture();try{
  await maan(db);await native(db,'yash','YASH.BET','2026-10-09',{total:100});await legacy(db,'OTHER','2026-10-09');await db.exec(migration);
  await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({targets:[['印度','MAANWIN']]})]);const r=await call(db);assert.equal(r.total,1);assert.equal(r.rows[0].platform,'MAAN.WIN');assert.equal(r.totals.total,10);assert.equal(r.totals.autoCount,0);assert.equal(r.totals.classificationPartial,undefined);
  await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({targets:[]})]);assert.deepEqual((await call(db)).rows,[]);
  await db.exec("set test.denied='yes'");await assert.rejects(call(db),/synthetic_session_denied/);
 }finally{await db.close()}
});
test('both function OIDs, full metadata/ACL and transaction idempotency survive without data writes',async()=>{
 const db=await fixture();try{
  const before=[await meta(db,keySig),await meta(db,readerSig)];await db.exec(migration);const after=[await meta(db,keySig),await meta(db,readerSig)];for(let i=0;i<2;i++)assert.deepEqual(after[i].metadata,before[i].metadata);
  assert.equal(after[0].hash,'440671f01a670ad05695e9b8692888a3');assert.equal(after[1].hash,'61e38bb57247818d83fa694efffab91d');
  await db.exec(migration);assert.deepEqual([await meta(db,keySig),await meta(db,readerSig)],after);
  for(const sig of [keySig,readerSig]){const privileges=(await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('service_role',$1,'execute') service_role",[sig])).rows[0];assert.deepEqual(privileges,{anon:false,service_role:false})}
  assert.doesNotMatch(migration,/\b(?:create table|alter table|insert into|delete from|update public\.|grant execute)\b/i);
 }finally{await db.close()}
});
test('body/ACL/config drift fails closed and rolls back the earlier canonical key patch',async()=>{
 for(const drift of ['body','acl','config','owner']){const db=await fixture();try{
  if(drift==='body')await db.exec(baseline.slice(baseline.indexOf('CREATE OR REPLACE FUNCTION private.dashboard_admin_live_auto_withdraw')).replace('declare\n','-- unknown reader\ndeclare\n'));
  if(drift==='acl')await db.exec('grant execute on function '+readerSig+' to anon');
  if(drift==='owner')await db.exec('create role unexpected_owner;alter function '+readerSig+' owner to unexpected_owner');
  if(drift==='config')await db.exec('alter function '+readerSig+' set search_path=public');
  await assert.rejects(db.exec(migration),/auto_withdraw_identity_(definition|acl)_drift/);await db.exec('rollback');assert.equal((await meta(db,keySig)).hash,'40951d8743777deafdd64153820fd473');
 }finally{await db.close()}}
});
