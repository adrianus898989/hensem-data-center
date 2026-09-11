// Read-only source review with an in-memory database. No real credentials or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash, randomUUID, webcrypto} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const {PGlite} = require(process.env.PGLITE_PATH || '@electric-sql/pglite');
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const compile = source => ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleBox = {exports:{}};
vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'BACKEND_CURRENT/ar-config-contract.ts'), 'utf8')),
  {module:moduleBox,exports:moduleBox.exports,Intl,Date});
const {FIELD_KINDS, validateConfigSnapshot} = moduleBox.exports;
const key = '1'.repeat(64), forbiddenKey = '2'.repeat(64);
const issueFindings = [];
let checks = 0, handler, db;
function eq(actual, expected, label) {assert.deepEqual(clone(actual), clone(expected), label); checks++;}
function rejectsSync(fn, label) {assert.throws(fn, undefined, label); checks++;}
async function rejectsSQL(sql, params, label) {await assert.rejects(() => db.query(sql, params), undefined, label); checks++;}
const scalar = async (sql, params=[]) => Object.values((await db.query(sql, params)).rows[0])[0];
function fixture(overrides={}) {
  return {schema_version:1,source_system:'AR',snapshot_id:randomUUID(),country_code:'IN',platform:'OFFLINE_CONFIG',timezone:'Asia/Kolkata',
    observed_at:'2026-09-11T02:00:00.000Z',observed_local_date:'2026-09-11',parser_version:'ar-config-v1',
    configuration:{fields:Object.entries(FIELD_KINDS).map(([key,kind])=>({key,kind,value:kind==='boolean'?true:'1',label:key,description:'合成测试说明',available:true,read_only:false})),
      groups:['userGroups','gameTypes'].map(key=>({key,options:[{value:'1',label:'合成选项',selected:true}]}))},...overrides};
}
const valid = input => clone(validateConfigSnapshot(input));
const ingest = snapshot => scalar('select public.ingest_ar_config($1::jsonb,$2)', [JSON.stringify(snapshot),hash(JSON.stringify(snapshot.configuration))]);
async function endpoint(body, configKey=key, method='POST') {
  const req=new Request('https://offline.invalid/config', {method,headers:{'X-Config-Key':configKey,'Content-Type':'application/json'},
    ...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
  const response=await handler(req); return {status:response.status,body:await response.json()};
}

(async()=>{
  const base=fixture(); const canonical=valid(base);
  eq(canonical.configuration.fields.length,28,'All expected controls present');
  eq(canonical.observed_local_date,'2026-09-11','Timezone local day validated');
  for(const mutate of [
    s=>s.source_system='NEWAR', s=>s.country_code='IND', s=>s.schema_version=2,
    s=>s.snapshot_id='not-a-uuid', s=>s.timezone='not/a-zone', s=>s.observed_local_date='2026-09-10',
    s=>s.observed_at='2099-01-01T00:00:00Z', s=>s.observed_at='2010-01-01T00:00:00Z',
    s=>s.configuration.fields.pop(), s=>s.configuration.fields[1]=s.configuration.fields[0],
    s=>s.configuration.fields[0].value='true', s=>s.configuration.fields.find(f=>f.kind==='number').value='NaN',
    s=>s.configuration.fields[0].available=false, s=>s.configuration.fields[0].label='x'.repeat(161),
    s=>s.configuration.groups[1]=s.configuration.groups[0], s=>s.configuration.groups[0].options=[],
    s=>s.configuration.groups[0].options.push(s.configuration.groups[0].options[0]),
  ]) {const s=clone(base);mutate(s);rejectsSync(()=>validateConfigSnapshot(s),'Reject malformed fixture');}
  const noisy=clone(base); noisy.raw_html='<html>PRIVATE_RAW_SENTINEL</html>';noisy.token='PRIVATE_TOPLEVEL_TOKEN';
  noisy.configuration.fields[0].raw_html='<input value="PRIVATE_FIELD_SENTINEL">';
  noisy.configuration.fields[0].token='PRIVATE_FIELD_TOKEN';
  noisy.configuration.groups[0].options[0].cookie='PRIVATE_OPTION_COOKIE';
  eq(JSON.stringify(valid(noisy)).includes('PRIVATE_'),false,'Unknown raw HTML/credential fields never survive canonicalization');
  for(const [field,content] of [['description','<input type="hidden" value="PRIVATE_HTML_SENTINEL">'],['label','Bearer PRIVATE_AUTH_SENTINEL'],
    ['description','ASP.NET_SessionId=PRIVATE_COOKIE_SENTINEL'],['description','__RequestVerificationToken=PRIVATE_FORM_SENTINEL'],
    ['label','X-Config-Key: PRIVATE_KEY_SENTINEL']]) {
    const s=clone(base);s.configuration.fields[0][field]=content;
    rejectsSync(()=>valid(s),'Reject raw HTML or authentication-like content in whitelisted text');
  }
  const comparisons=clone(base);comparisons.configuration.fields[0].label='提现金额 <= 3000 且次数 < 3';
  eq(valid(comparisons).configuration.fields.find(f=>f.key===base.configuration.fields[0].key).label,
    comparisons.configuration.fields[0].label,'Legitimate less-than comparison text remains supported');

  db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges grant all on tables to service_role;
    create function public.dashboard_has_permission(text) returns boolean language sql stable as $$
      select coalesce(current_setting('test.auto_withdraw',true),'false')='true' $$;`);
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260911083505_ar_auto_withdraw_config.sql'),'utf8'));
  await db.exec('set role service_role');
  await db.query(`insert into public.ar_config_targets(country_code,platform,country_name,timezone,currency) values
    ('IN','OFFLINE_CONFIG','Synthetic India','Asia/Kolkata','INR'),
    ('BR','OFFLINE_OTHER','Synthetic Brazil','America/Sao_Paulo','BRL')`);
  await db.query(`insert into public.ar_config_credentials(token_hash,allowed_targets,expires_at) values($1,array['IN:OFFLINE_CONFIG'],now()+interval '1 day')`,[hash(key)]);
  const accepted=await ingest(canonical);
  eq(accepted.status,'accepted','First write accepted');
  eq((await ingest(canonical)).status,'unchanged','Identical retry unchanged');
  const stale=valid({...base,snapshot_id:randomUUID(),observed_at:'2026-09-11T01:59:00.000Z'});
  eq((await ingest(stale)).status,'stale','Older observations cannot overwrite');
  const conflict=clone(canonical);conflict.snapshot_id=randomUUID();conflict.configuration.fields.find(f=>f.kind==='number').value='2';
  await assert.rejects(()=>ingest(conflict));checks++;
  eq(await scalar('select snapshot_id::text from public.ar_config_daily'),canonical.snapshot_id,'Conflicting equal timestamp leaves stored row unchanged');
  for(const overrides of [{country_code:'BR'},{timezone:'UTC'},{observed_local_date:'2026-09-10'}])
    await assert.rejects(()=>ingest({...canonical,...overrides}));
  checks+=3;
  const reused=clone(canonical);reused.observed_at='2026-09-11T02:01:00.000Z';reused.configuration.fields.find(f=>f.kind==='number').value='9';
  await assert.rejects(()=>ingest(reused), /config_snapshot_id_conflict/);checks++;
  eq(await scalar('select snapshot_id::text from public.ar_config_daily'),canonical.snapshot_id,'Rejected ID reuse leaves current daily row intact');

  // Standalone deployment handler, with every database HTTP request routed into
  // the same private in-memory database. Any other fetch fails immediately.
  const ingestCode=compile(fs.readFileSync(path.join(root,'BACKEND_CURRENT/auto-withdraw-config-ingest.ts'),'utf8')
    .replace(/^import[^\n]*\n/,''));
  const fakeFetch=async(url,init)=>{
    const u=new URL(url),name=u.pathname.replace('/rest/v1/','');
    assert.equal(u.hostname,'offline-db.invalid');
    let data;
    if(name==='ar_config_credentials') {
      const digest=u.searchParams.get('token_hash').slice(3);
      eq(digest===key,false,'Only key hash enters database request');
      data=(await db.query('select allowed_targets,expires_at from public.ar_config_credentials where token_hash=$1 and active=true',[digest])).rows;
    } else if(name==='ar_config_targets') {
      data=(await db.query('select timezone from public.ar_config_targets where country_code=$1 and platform=$2',
        [u.searchParams.get('country_code').slice(3),u.searchParams.get('platform').slice(3)])).rows;
    } else if(name==='ar_config_latest') {
      data=(await db.query('select country_code,platform,observed_at,observed_local_date,received_at,configuration_hash,snapshot_id from public.ar_config_latest')).rows;
    } else if(name==='rpc/ingest_ar_config') {
      const body=JSON.parse(init.body);
      try {data=await scalar('select public.ingest_ar_config($1::jsonb,$2)',[JSON.stringify(body.p_snapshot),body.p_hash]);}
      catch {return new Response(JSON.stringify({error:'offline-db-error'}),{status:400});}
    } else throw Error('Unexpected offline fetch route');
    return new Response(JSON.stringify(data),{status:200});
  };
  vm.runInNewContext(ingestCode,{Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://offline-db.invalid':'offline-service-key'},serve:fn=>handler=fn},
    validateConfigSnapshot,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,URLSearchParams,AbortSignal,Date,Request,Response,fetch:fakeFetch});
  eq((await endpoint({},'', 'GET')).status,405,'Non-POST rejected');
  eq((await endpoint({action:'report'},'')).status,401,'Missing dedicated key rejected');
  eq((await endpoint({action:'report'},forbiddenKey)).status,401,'Unknown hash rejected');
  const endToEnd=valid({...base,snapshot_id:randomUUID(),observed_at:'2026-09-11T02:02:00.000Z'});
  const response=await endpoint({action:'ingest',snapshot:endToEnd});
  eq(response.status,200,'Edge validates and publishes through RPC');eq(response.body.ok,true,'Edge reports success');
  eq(await scalar('select snapshot_id::text from public.ar_config_daily'),endToEnd.snapshot_id,'New ID replaces latest day row');
  eq(await scalar('select count(*)::int from public.ar_config_receipts where snapshot_id=$1',[canonical.snapshot_id]),1,
    'Receipt survives replacement of original daily row');
  const oldIdChanged=clone(canonical);oldIdChanged.observed_at='2026-09-11T02:03:00.000Z';
  oldIdChanged.configuration.fields.find(f=>f.kind==='number').value='99';
  await assert.rejects(()=>ingest(oldIdChanged), /config_snapshot_id_conflict/);checks++;
  const exactOldReplay=await ingest(canonical);
  eq(exactOldReplay.status,'unchanged','Exact replay of replaced ID remains idempotent');
  eq(exactOldReplay.current_snapshot_id,endToEnd.snapshot_id,'Replay identifies newer current snapshot');
  eq(await scalar('select snapshot_id::text from public.ar_config_daily'),endToEnd.snapshot_id,'Old exact replay cannot replace newer data');
  const other=valid({...base,snapshot_id:randomUUID(),country_code:'BR',platform:'OFFLINE_OTHER',timezone:'America/Sao_Paulo',observed_at:'2026-09-11T08:00:00.000Z'});
  eq((await endpoint({action:'ingest',snapshot:other})).status,403,'Credential cannot write another target');
  eq((await endpoint({action:'ingest',snapshot:{...endToEnd,timezone:'UTC'}})).status,400,'Target timezone validated at Edge');
  eq((await endpoint({action:'ingest',snapshot:{...endToEnd,observed_local_date:'2026-09-10'}})).status,400,'Wrong local date rejected at Edge');
  eq((await endpoint('x'.repeat(262145))).status,400,'Bounded request stream rejects oversized body');
  await ingest(other);
  const report=await endpoint({action:'report'});
  eq(report.status,200,'Report succeeds');eq(report.body.snapshots.length,1,'Report excludes unauthorized target');
  eq(report.body.snapshots[0].platform,'OFFLINE_CONFIG','Report scope is exact');
  await db.query('update public.ar_config_credentials set active=false where token_hash=$1',[hash(key)]);
  eq((await endpoint({action:'report'})).status,401,'Revoked key rejected');
  await db.query("update public.ar_config_credentials set active=true,expires_at=now()-interval '1 second' where token_hash=$1",[hash(key)]);
  eq((await endpoint({action:'report'})).status,401,'Expired key rejected');

  await db.exec('reset role');
  for(const table of ['ar_config_targets','ar_config_credentials','ar_config_daily','ar_config_receipts'])
    eq(await scalar('select relrowsecurity from pg_class where oid=$1::regclass',['public.'+table]),true,`${table} RLS enabled`);
  eq(await scalar("select has_table_privilege('service_role','public.ar_config_receipts','update,delete,truncate')"),false,
    'Receipt mutation forbidden even with permissive managed-project default grants');
  eq(await scalar("select has_table_privilege('service_role','public.ar_config_receipts','select')"),true,'Service can read receipts');
  eq(await scalar("select has_table_privilege('service_role','public.ar_config_receipts','insert')"),true,'Service can append receipts');
  for(const role of ['anon','authenticated']) {
    for(const table of ['ar_config_targets','ar_config_credentials','ar_config_daily','ar_config_latest','ar_config_receipts'])
      eq(await scalar('select has_table_privilege($1,$2,$3)',[role,'public.'+table,'insert,update,delete']),false,`${role} cannot write ${table}`);
    eq(await scalar('select has_function_privilege($1,$2,$3)',[role,'public.ingest_ar_config(jsonb,text)','execute']),false,`${role} cannot call ingest RPC`);
  }
  await db.exec('set role anon');
  for(const table of ['ar_config_targets','ar_config_credentials','ar_config_daily','ar_config_latest','ar_config_receipts'])
    await rejectsSQL('select * from public.'+table,[],`Anonymous cannot read ${table}`);
  await db.exec("reset role;set role authenticated;set test.auto_withdraw='false'");
  eq(await scalar('select count(*)::int from public.ar_config_daily'),0,'Authenticated without capability sees no rows');
  eq(await scalar('select count(*)::int from public.ar_config_latest'),0,'Invoker view preserves RLS');
  await rejectsSQL('select * from public.ar_config_credentials',[],'Authenticated cannot read credential hashes');
  await rejectsSQL('select * from public.ar_config_receipts',[],'Authenticated cannot read private receipt identities');
  await db.exec("set test.auto_withdraw='true'");
  eq(await scalar('select count(*)::int from public.ar_config_latest'),2,'Authorized dashboard reads platform configuration');
  await rejectsSQL('delete from public.ar_config_daily',[],'Authorized browser still cannot mutate');
  console.log(JSON.stringify({checks,findings:issueFindings,productionAccess:false,networkAccess:false}));
  await db.close();db=null;
})().catch(async error=>{console.error(error);if(db)await db.close();process.exitCode=1;});
