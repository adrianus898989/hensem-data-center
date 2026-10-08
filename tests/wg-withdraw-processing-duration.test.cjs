// Synthetic source details and isolated authorization stubs; no production data or Auth impersonation.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const migration=read('supabase/migrations/20261008050706_wg_withdraw_processing_duration.sql');
const baseline=read('tests/fixtures/wg-withdraw-processing-duration-baseline.sql');
const signatures=['private.dashboard_admin_live_auto_withdraw(jsonb)','private.dashboard_admin_wg_withdraw_days(jsonb,jsonb,date,date)'];
const request=(extra={})=>({country:'巴西',platform:'POPMIU',startAt:'2026-10-06T00:00:00Z',endAt:'2026-10-06T23:59:59Z',limit:20,...extra});
const call=async(db,r=request())=>(await db.query('select private.dashboard_admin_live_auto_withdraw($1::jsonb) value',[JSON.stringify(r)])).rows[0].value;
const metadata=async(db)=>(await db.query("select oid::regprocedure::text signature,to_jsonb(p) value from pg_proc p where oid=any($1::regprocedure[]) order by 1",[signatures])).rows;
async function setup(){
 const db=new PGlite();
 await db.exec(`
  create schema private;create role anon;create role authenticated;create role service_role;
  create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable set search_path='' as $$begin if current_setting('test.denied',true)='yes' then raise exception 'preview_denied' using errcode='42501';end if;return coalesce(nullif(current_setting('test.scope',true),''),'{}')::jsonb;end$$;
  create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable set search_path='' as $$select coalesce(s->'targets' @> jsonb_build_array(jsonb_build_array(c,p)),true)$$;
  create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable set search_path='' as $$select upper(btrim($1))$$;
  create function private.dashboard_admin_live_report_country(text,text) returns text language sql immutable set search_path='' as $$select $1$$;
  create function private.dashboard_admin_live_can_note() returns boolean language sql stable set search_path='' as $$select false$$;
  create table public.game66_platforms(id uuid default gen_random_uuid(),team_code text,team_name text,platform_name text,enabled boolean default false);
  create table public.auto_withdraw_daily(data_date date,country text,platform text,total bigint,success bigint,rejected bigint,auto_count bigint,manual_count bigint,avg_seconds numeric,source_updated_at timestamptz,updated_at timestamptz);
  create table public.withdraw_operator_daily(data_date date,country text,platform text,account text,processed bigint,rejected bigint,avg_seconds numeric,source_updated_at timestamptz,updated_at timestamptz);
  create table public.newar_business_snapshots(kind text,direction text,country text,country_code text,platform text,stat_date date,payload jsonb,captured_at timestamptz,updated_at timestamptz);
  create table public.auto_withdraw_notes(data_date date,country text,platform text,reason text,updated_at timestamptz);
  create function private.dashboard_admin_live_game66_withdraw(date,date,text,text[]) returns jsonb language sql stable set search_path='' as $$select '{}'::jsonb$$;
  create function private.dashboard_admin_wg_sites() returns table(site_code text,country_code text,country text,platform text,timezone text,currency text) language sql immutable set search_path='' as $$select * from (values('pop','BR','巴西','POPMIU','America/Sao_Paulo','BRL'),('zero','BR','巴西','ZERO','America/Sao_Paulo','BRL'),('none','BR','巴西','NONE','America/Sao_Paulo','BRL'),('other','VN','越南','OTHER','Asia/Ho_Chi_Minh','VND'))s$$;
  create table public.wg_withdraw_details(site_code text,order_number text,status_code integer,created_at timestamptz,operated_at timestamptz,captured_at timestamptz,stored_at timestamptz,success_at timestamptz,business_fields jsonb);
  create table public.wg_detail_coverage(site_code text,business text,basis text,business_date date,complete boolean);
  grant usage on schema private to authenticated,anon,service_role;
 `);
 await db.exec(baseline);
 await db.exec(`
  revoke all on function private.dashboard_admin_live_auto_withdraw(jsonb) from public,anon,authenticated,service_role;
  grant execute on function private.dashboard_admin_live_auto_withdraw(jsonb) to authenticated;
  revoke all on function private.dashboard_admin_wg_withdraw_days(jsonb,jsonb,date,date) from public,anon,authenticated,service_role;
  insert into public.wg_withdraw_details(site_code,order_number,status_code,created_at,operated_at,captured_at,stored_at,business_fields)
   select site,ord,status,('2026-10-'||day||' 15:00:00+00')::timestamptz,case when seconds is not null then ('2026-10-'||day||' 15:00:00+00')::timestamptz+seconds*interval '1 second' end,
    ('2026-10-'||day||' 16:00:00+00')::timestamptz,('2026-10-'||day||' 16:00:00+00')::timestamptz,
    jsonb_build_object('operator_name',operator,'operator_class',class)
   from (values
    ('pop','p5a',4,'05',30,'Alice','auto'),('pop','p5b',4,'05',null,'Alice','manual'),('pop','p5c',7,'05',null,'Bob','manual'),
    ('pop','p6a',4,'06',60,'Alice','auto'),('pop','p6b',4,'06',180,'Bob','manual'),('pop','p6c',7,'06',null,'Alice','manual'),
    ('pop','p6d',3,'06',-5,'Bob','auto'),('pop','p6e',8,'06',4000,'Alice','manual'),
    ('zero','z6a',4,'06',0,'Alice','auto'),('zero','z6b',4,'06',null,'Bob','manual'),
    ('none','n6a',4,'06',null,'Alice','auto'),('other','v6a',4,'06',900,'Alice','auto')
   )f(site,ord,status,day,seconds,operator,class);
  insert into public.wg_detail_coverage values('pop','withdraw','created','2026-10-05',true),('pop','withdraw','created','2026-10-06',true);
 `);
 return db;
}
const num=v=>Number(v);
const stripped=v=>{
 if(Array.isArray(v))return v.map(stripped);
 if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!['avgSeconds','durationSampleCount','durationTotalSeconds','durationBasis'].includes(k)).map(([k,x])=>[k,stripped(x)]));
 return v;
};
test('WG current and previous means use only valid operation-time samples; order/state attribution is unchanged',async()=>{
 const db=await setup();try{
  const old=await call(db);assert.equal(old.rows[0].avgSeconds,null);
  const oldOperators=await call(db,request({view:'operators'}));
  await db.exec(migration);
  const value=await call(db),row=value.rows[0];
  assert.deepEqual(stripped(value),stripped(old));
  assert.equal(row.total,5);assert.equal(row.success,2);assert.equal(row.rejected,1);
  assert.equal(row.avgSeconds,120);assert.equal(row.durationSampleCount,2);assert.equal(row.durationTotalSeconds,240);assert.equal(row.durationBasis,'created_to_operated');
  assert.equal(row.previous.avgSeconds,30);assert.equal(row.previous.durationSampleCount,1);assert.equal(row.previous.durationTotalSeconds,30);
  assert.equal(value.totals.avgSeconds,120);assert.equal(value.previousTotals.avgSeconds,30);
  const operators=await call(db,request({view:'operators'}));assert.deepEqual(stripped(operators),stripped(oldOperators));
  assert.equal(operators.rows.find(r=>r.account==='Alice').avgSeconds,60);assert.equal(operators.rows.find(r=>r.account==='Bob').avgSeconds,180);
  assert.equal(operators.totals.avgSeconds,120);assert.equal(operators.totals.durationSampleCount,2);
  assert.equal((await db.query('select count(*)::int n from public.wg_withdraw_details where success_at is not null')).rows[0].n,0,'processing duration never manufactures payment success time');
 }finally{await db.close();}
});
test('zero is timed, missing/reversed/future/infinite timestamps are unknown; range and totals weight by samples',async()=>{
 const db=await setup();try{
  await db.exec(migration);
  const range=await call(db,request({startAt:'2026-10-05T00:00:00Z'}));
  assert.equal(range.rows[0].total,8);assert.equal(range.rows[0].avgSeconds,90);assert.equal(range.rows[0].durationSampleCount,3);assert.equal(range.rows[0].durationTotalSeconds,270);
  const zero=await call(db,request({platform:'ZERO'}));assert.equal(zero.rows[0].avgSeconds,0);assert.equal(zero.rows[0].durationSampleCount,1);assert.equal(zero.rows[0].durationTotalSeconds,0);
  const missing=await call(db,request({platform:'NONE'}));assert.equal(missing.rows[0].avgSeconds,null);assert.equal(missing.rows[0].durationSampleCount,0);assert.equal(missing.rows[0].durationTotalSeconds,null);assert.equal(missing.totals.avgSeconds,null);
  const all=await call(db,request({platform:''}));assert.equal(all.totals.avgSeconds,80);assert.equal(all.totals.durationSampleCount,3);assert.equal(all.totals.durationTotalSeconds,240);
  const helper=await db.query("select private.dashboard_admin_wg_processing_seconds('2026-10-06','infinity','2026-10-07') value union all select private.dashboard_admin_wg_processing_seconds('2026-10-06','2026-10-06',null)");
  assert(helper.rows.every(r=>r.value===null));
  const daily=await call(db,request({startAt:'2026-10-05T00:00:00Z',daily:true,sort:'avgSeconds',ascending:true}));
  assert.deepEqual(daily.rows.map(r=>r.avgSeconds),[30,120]);assert.equal(daily.rows[1].previous.avgSeconds,30);assert.equal(daily.totals.avgSeconds,90);
 }finally{await db.close();}
});
test('mixed and NEWAR sources aggregate by reported handle samples, and legacy known means preserve their source weight',async()=>{
 const db=await setup();try{
  await db.exec(`
   insert into public.auto_withdraw_daily values('2026-10-06','巴西','LEGACY',2,2,0,1,1,40,now(),now()),('2026-10-06','巴西','UNKNOWN',100,100,0,100,0,null,now(),now());
   insert into public.withdraw_operator_daily values('2026-10-06','巴西','LEGACY','Alice',2,0,40,now(),now());
   insert into public.newar_business_snapshots values('auto_withdraw_bundle','all','巴西','BR','NEWAR','2026-10-06','{"rows":[{"total_count":100,"success_count":90,"reject_count":5,"auto_count":50,"manual_count":50,"handle_count":1,"total_handle_seconds":20}],"operator_rows":[{"operator":"Alice","processed_count":100,"reject_count":5,"handle_count":1,"total_handle_seconds":20}]}',now(),now());
  `);
  await db.exec(migration);
  const r=await call(db,request({platform:'',platforms:['POPMIU','NEWAR']}));
  assert.equal(r.totals.total,105);assert.equal(r.totals.durationSampleCount,3);assert.equal(r.totals.durationTotalSeconds,260);assert(Math.abs(r.totals.avgSeconds-260/3)<1e-10);assert.equal(r.totals.durationBasis,'mixed_source_processing');
  const nr=r.rows.find(x=>x.platform==='NEWAR');assert.equal(nr.avgSeconds,20);assert.equal(nr.durationSampleCount,1);
  const op=await call(db,request({platform:'',platforms:['POPMIU','NEWAR'],view:'operators'}));assert.equal(op.totals.durationSampleCount,3);assert.equal(op.totals.durationTotalSeconds,260);
  const legacy=await call(db,request({platform:'LEGACY'}));assert.equal(legacy.rows[0].avgSeconds,40);assert.equal(legacy.rows[0].durationSampleCount,2);assert.equal(legacy.rows[0].durationTotalSeconds,80);assert.equal(legacy.rows[0].durationBasis,'source_reported_processing');
  const partial=await call(db,request({platform:'',platforms:['POPMIU','UNKNOWN']}));assert.equal(partial.totals.avgSeconds,120);assert.equal(partial.totals.durationSampleCount,2);
 }finally{await db.close();}
});
test('country-local dates, authorization, platform/account filtering, pagination and duration sorting stay aligned',async()=>{
 const db=await setup();try{
  await db.exec(migration);
  await db.exec("insert into public.wg_withdraw_details values('pop','local-prior',4,'2026-10-06 02:59:00+00','2026-10-06 03:00:00+00','2026-10-06 04:00:00+00',now(),null,'{\"operator_name\":\"Alice\",\"operator_class\":\"auto\"}')");
  let r=await call(db);assert.equal(r.rows[0].total,5);assert.equal(r.rows[0].previous.total,4);assert.equal(r.rows[0].previous.avgSeconds,45);
  r=await call(db,request({view:'operators',account:'Alice'}));assert.equal(r.rows.length,1);assert.equal(r.totals.avgSeconds,60);assert.equal(r.totals.durationSampleCount,1);
  r=await call(db,request({platform:'',sort:'avgSeconds',ascending:true}));assert.deepEqual(r.rows.map(x=>[x.platform,x.avgSeconds]),[['ZERO',0],['POPMIU',120],['NONE',null]]);
  const page=await call(db,request({platform:'',sort:'avgSeconds',ascending:true,offset:1}));assert.deepEqual(page.rows.map(x=>x.platform),['POPMIU','NONE']);assert.deepEqual(page.totals,r.totals);
  await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({targets:[['BR','POPMIU']]})]);
  r=await call(db,request({platform:''}));assert.deepEqual(r.rows.map(x=>x.platform),['POPMIU']);assert.equal((await call(db,request({platform:'ZERO'}))).rows.length,0);assert.equal((await call(db,request({country:'越南',platform:'OTHER'}))).rows.length,0);
  assert.equal((await call(db,request({platform:'',scopeTargets:[{country:'巴西',platforms:['ZERO']}]}))).rows.length,0);
  for(const extra of [{unexpected:true},{platforms:[false]},{scopeTargets:[{country:'越南',platforms:['OTHER']}]}])await assert.rejects(call(db,request(extra)),/invalid_/);
  await db.exec("select set_config('test.denied','yes',false)");await assert.rejects(call(db),/preview_denied/);
 }finally{await db.close();}
});
test('production body/ACL drift aborts atomically; function identity, metadata and helper permissions stay closed',async()=>{
 for(const drift of [null,'body','acl']){
  const db=await setup();try{
   if(drift==='body')await db.exec("create or replace function private.dashboard_admin_live_auto_withdraw(p_request jsonb default '{}'::jsonb) returns jsonb language sql stable security definer set search_path='' as $$select $1$$");
   if(drift==='acl')await db.exec('grant execute on function private.dashboard_admin_wg_withdraw_days(jsonb,jsonb,date,date) to authenticated');
   const before=await metadata(db);
   if(drift){await assert.rejects(db.exec(migration),/wg_processing_duration_.*_drift/);await db.exec('rollback');assert.deepEqual(await metadata(db),before);assert.equal((await db.query("select to_regprocedure('private.dashboard_admin_wg_processing_seconds(timestamptz,timestamptz,timestamptz)') value")).rows[0].value,null);}
   else{
    await db.exec(migration);const after=await metadata(db);
    for(let i=0;i<before.length;i++){delete before[i].value.prosrc;delete after[i].value.prosrc;}assert.deepEqual(after,before);
    for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_function_privilege($1,'private.dashboard_admin_wg_processing_seconds(timestamptz,timestamptz,timestamptz)','execute') allowed",[role])).rows[0].allowed,false);
    assert.equal((await db.query("select has_function_privilege('authenticated','private.dashboard_admin_live_auto_withdraw(jsonb)','execute') allowed")).rows[0].allowed,true);
   }
  }finally{await db.close();}
 }
});
