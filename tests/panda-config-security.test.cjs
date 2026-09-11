// Executes the checked-in migration only in an isolated in-memory PGlite DB.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createHash,randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.PGLITE_PATH || '@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const ts=require(path.join(root,'node_modules/typescript'));
const box={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'BACKEND_CURRENT/panda-config-contract.ts'),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {module:box,exports:box.exports,Intl,Date,TextEncoder});
const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/panda-supplied-response.json'),'utf8')).result.data.json;
for(const key of ['auditGameLimit','levelMultiples'])if(typeof raw[key]==='string'&&raw[key]!=='')raw[key]=JSON.parse(raw[key]);
const configuration=box.exports.validatePandaConfiguration({values:raw,unavailable_fields:[]});
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
let checks=0;const findings=[];
const eq=(a,b,label)=>{assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),label);checks++;};
const db=new PGlite();
const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
const rejected=async(sql,params,label)=>{await assert.rejects(()=>db.query(sql,params),undefined,label);checks++;};
const fixture=(overrides={})=>({schema_version:1,source_system:'PANDA',parser_version:'panda-config-v1',snapshot_id:randomUUID(),
  country_code:'BR',platform:'OFFLINE_SQL',timezone:'Etc/GMT+3',observed_at:'2026-09-11T08:00:00.000Z',
  observed_local_date:'2026-09-11',configuration:JSON.parse(JSON.stringify(configuration)),...overrides});
const ingest=s=>scalar('select public.ingest_panda_config($1::jsonb,$2)',[JSON.stringify(s),hash(s.configuration)]);

async function main(){
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges grant all on tables to service_role;
    create function public.dashboard_has_permission(text) returns boolean language sql stable as $$
      select coalesce(current_setting('offline.auto_withdraw',true),'false')='true' $$;
    create table public.ar_config_sentinel(value text);insert into public.ar_config_sentinel values('untouched');`);
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260911100825_panda_auto_withdraw_config.sql'),'utf8'));
  eq(await scalar('select value from public.ar_config_sentinel'),'untouched','Existing AR data remains untouched');
  const safe=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/panda-config-targets.json'),'utf8')).targets;
  const stored=(await db.query('select country_code,platform,timezone from public.panda_config_targets order by country_code,platform')).rows;
  const expected=safe.map(t=>({country_code:t.country_code,platform:t.platform,timezone:t.timezone})).sort((a,b)=>
    a.country_code.localeCompare(b.country_code)||a.platform.localeCompare(b.platform));
  eq(stored,expected,'Migration uses exact safe target identities and timezones');
  await db.exec(`insert into public.panda_config_targets values('BR','OFFLINE_SQL','Synthetic','Etc/GMT+3',null);
    insert into public.panda_config_credentials(token_hash,allowed_targets,expires_at) values(repeat('a',64),array['BR:OFFLINE_SQL'],now()+interval '1 day');`);
  for(const table of ['panda_config_targets','panda_config_credentials','panda_config_daily','panda_config_receipts'])
    eq(await scalar('select relrowsecurity from pg_class where oid=$1::regclass',['public.'+table]),true,table+' has RLS');
  eq(await scalar("select reloptions @> array['security_invoker=true'] from pg_class where oid='public.panda_config_latest'::regclass"),true,'Latest view respects caller RLS');
  eq(await scalar("select prosecdef from pg_proc where oid='public.ingest_panda_config(jsonb,text)'::regprocedure"),false,'RPC is not SECURITY DEFINER');
  for(const role of ['anon','authenticated']){
    eq(await scalar('select has_function_privilege($1,$2,$3)',[role,'public.ingest_panda_config(jsonb,text)','EXECUTE']),false,role+' cannot execute ingestion');
    for(const table of ['panda_config_targets','panda_config_credentials','panda_config_daily','panda_config_receipts']){
      for(const operation of ['INSERT','UPDATE','DELETE','TRUNCATE'])
        eq(await scalar('select has_table_privilege($1,$2,$3)',[role,'public.'+table,operation]),false,role+' cannot '+operation+' '+table);
    }
    for(const table of ['panda_config_credentials','panda_config_receipts'])
      eq(await scalar('select has_table_privilege($1,$2,$3)',[role,'public.'+table,'SELECT']),false,role+' cannot read private '+table);
  }
  for(const table of ['panda_config_targets','panda_config_credentials']){
    eq(await scalar('select has_table_privilege($1,$2,$3)',['service_role','public.'+table,'SELECT']),true,'Service reads '+table);
    for(const operation of ['INSERT','UPDATE','DELETE','TRUNCATE'])
      eq(await scalar('select has_table_privilege($1,$2,$3)',['service_role','public.'+table,operation]),false,'Service cannot '+operation+' '+table);
  }
  for(const table of ['panda_config_daily','panda_config_receipts']){
    for(const operation of ['SELECT','INSERT'])
      eq(await scalar('select has_table_privilege($1,$2,$3)',['service_role','public.'+table,operation]),true,'Service can '+operation+' '+table);
    for(const operation of ['UPDATE','DELETE','TRUNCATE'])
      eq(await scalar('select has_table_privilege($1,$2,$3)',['service_role','public.'+table,operation]),false,'Service cannot '+operation+' '+table);
  }
  for(const operation of ['INSERT','UPDATE','DELETE','TRUNCATE']){
    if(await scalar('select has_table_privilege($1,$2,$3)',['service_role','public.panda_config_latest',operation]))
      findings.push('latest_view_excess_service_privilege:'+operation);
    checks++;
  }
  await db.exec('set role service_role');
  const first=fixture();const accepted=await ingest(first);
  eq(accepted.status,'accepted','First capture accepted');
  eq((await ingest(first)).status,'unchanged','Exact retry acknowledged without insertion');
  eq(await scalar('select count(*)::int from public.panda_config_daily'),1,'Only one first-day row');
  const later=fixture({observed_at:'2026-09-11T10:00:00.000Z'});later.configuration.values.autoWithdrawalAmountMax=333300;
  const laterResult=await ingest(later);
  eq(laterResult.status,'daily_exists','Later same-day capture cannot replace first');
  eq(laterResult.snapshot_id,later.snapshot_id,'daily_exists receipt binds submitted ID');
  eq(laterResult.current_snapshot_id,first.snapshot_id,'daily_exists identifies first stored capture');
  const earlier=fixture({observed_at:'2026-09-11T07:00:00.000Z'});
  eq((await ingest(earlier)).status,'daily_exists','Even earlier observed time does not replace first successful capture');
  eq(await scalar("select (configuration->'values'->>'autoWithdrawalAmountMax')::int from public.panda_config_daily"),199900,'Money/content of first daily capture preserved');
  eq(await scalar('select snapshot_id::text from public.panda_config_daily'),first.snapshot_id,'First daily ID preserved');
  eq((await ingest(later)).status,'unchanged','Previously acknowledged daily_exists ID replays safely');
  const changed=JSON.parse(JSON.stringify(later));changed.configuration.values.orderVolume=123;
  await assert.rejects(()=>ingest(changed),/config_snapshot_id_conflict/);checks++;
  eq(await scalar('select count(*)::int from public.panda_config_receipts'),3,'All first/rejected-replacement receipts remain immutable');
  const tomorrow=fixture({observed_at:'2026-09-12T08:00:00.000Z',observed_local_date:'2026-09-12'});
  eq((await ingest(tomorrow)).status,'accepted','Next local day is independently accepted');
  eq(await scalar('select snapshot_id::text from public.panda_config_latest'),tomorrow.snapshot_id,'Latest returns newest day, not late upload arrival');
  for(const overrides of [{source_system:'AR'},{parser_version:'bad'},{schema_version:2},
    {timezone:'UTC'},{platform:'OTHER'},{observed_local_date:'2026-09-13'}])
    await assert.rejects(()=>ingest({...fixture(),...overrides}));
  checks+=6;
  for(const [field,kind] of ['source_system','parser_version','schema_version'].flatMap(field=>[[field,'missing'],[field,'null']])){
    const missing=fixture({observed_at:'2026-09-15T08:00:00.000Z',observed_local_date:'2026-09-15'});
    if(kind==='missing')delete missing[field];else missing[field]=null;
    await db.exec('begin');
    try{await ingest(missing);findings.push('rpc_invalid_contract_field_accepted:'+field+':'+kind);}catch{}
    finally{await db.exec('rollback');}checks++;
  }
  for(const invalidHash of [null,'invalid','a'.repeat(63)])
    await rejected('select public.ingest_panda_config($1::jsonb,$2)',[JSON.stringify(fixture()),invalidHash],'Missing or invalid hash is fail-closed');
  await rejected('update public.panda_config_daily set configuration_hash=repeat($1,64)',['b'],'Service cannot overwrite daily row directly');
  await rejected('delete from public.panda_config_daily',[],'Service cannot delete daily row');
  await rejected('delete from public.panda_config_receipts',[],'Service cannot remove receipt identity guard');
  await db.exec('set role authenticated;set offline.auto_withdraw=false');
  eq(await scalar('select count(*)::int from public.panda_config_targets'),0,'Authenticated without permission sees no targets');
  eq(await scalar('select count(*)::int from public.panda_config_daily'),0,'Authenticated without permission sees no captures');
  eq(await scalar('select count(*)::int from public.panda_config_latest'),0,'View cannot bypass lack of permission');
  await db.exec('set offline.auto_withdraw=true');
  eq(await scalar('select count(*)::int from public.panda_config_daily'),2,'Authorized user sees captures');
  eq(await scalar('select count(*)::int from public.panda_config_latest'),1,'Authorized user sees latest capture');
  await rejected('select * from public.panda_config_credentials',[],'Browser cannot obtain dedicated credential hashes');
  await rejected('select public.ingest_panda_config($1::jsonb,$2)',[JSON.stringify(fixture()),hash(configuration)],'Browser cannot call ingest RPC');
  await db.exec('set role anon');
  for(const table of ['panda_config_targets','panda_config_daily','panda_config_latest'])
    await rejected('select * from public.'+table,[],'Anonymous cannot read '+table);
  await db.exec('reset role');
  eq(await scalar('select value from public.ar_config_sentinel'),'untouched','AR unaffected by all Panda operations');
  console.log(JSON.stringify({checks,findings,realNetwork:false,realDatabaseWrites:false}));
  if(findings.length)process.exitCode=1;
  await db.close();
}
main().catch(async(error)=>{console.error(error.message);process.exitCode=1;await db.close();});
