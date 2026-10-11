// Offline PostgreSQL only: synthetic accounts, scopes and directory metadata.
const {test,before,beforeEach,after,afterEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const repo=path.join(__dirname,'..'),testDir=__dirname,filename=path.join(testDir,'dashboard-confirmed-platform-scope-aliases-sql.test.cjs'),req=createRequire(filename);
const dataGroup=fs.readFileSync(path.join(testDir,'fixtures/dashboard-scope-catalog-data-group-production.sql'),'utf8');
const migration=fs.readFileSync(path.join(repo,'supabase/migrations/20261011133250_dashboard_scope_catalog_normalize_distinct_identities.sql'),'utf8'),patch=migration.match(/do \$scope_catalog_identity_once\$[\s\S]*?end \$scope_catalog_identity_once\$;/)[0],meta={before_md5:'a756992f2f1b6aa5a5b9c608c006ffc4',after_md5:'6b83f864953cbfd7f3cf1c45a9a15693'};
let original;
let setup,seed,f,db;
const c=vm.createContext({__dirname:testDir,require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,beforeEach:fn=>seed=fn,after(){},afterEach(){}}:req(n)});
vm.runInContext(fs.readFileSync(filename,'utf8').split(/\ntest\(/)[0]+'\nglobalThis.fixture=()=>({db,f});',c,{filename});
const scalar=(sql,args=[])=>f.scalar(sql,args),catalog=()=>scalar('select public.dashboard_account_data_scope_catalog()');
const signature='public.dashboard_account_data_scope_catalog()';
const metadata=()=>scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid=$1::regprocedure",[signature]);
const scope=(...pairs)=>({mode:'selected',countries:[],platforms:pairs.map(([country,platform])=>({country,platform}))});
const setScope=scope=>db.query('update dashboard_profiles set data_scope=$1::jsonb where auth_user_id=$2',[JSON.stringify(scope),f.ACTOR]);
before(async()=>{await setup();({db,f}=c.fixture());await db.exec(dataGroup);original=await scalar('select pg_get_functiondef($1::regprocedure)',[signature]);assert.equal(await scalar('select md5(prosrc) from pg_proc where oid=$1::regprocedure',[signature]),meta.before_md5)});
beforeEach(async()=>seed());afterEach(async()=>{await db.exec('reset role');await db.exec('rollback')});after(()=>db?.close());
async function differential(){await db.exec(original);const before=await catalog(),m=await metadata();await db.exec(patch);assert.deepEqual(await metadata(),m);const next=await catalog();assert.deepEqual(next,before);return next}
async function registered(){
 await db.exec(`insert into dashboard_platform_team_map values
 ('IN','RAJA','RAJA','AR',true,'M8'),('IN','RAJALOTTERY','RAJA','AR',true,'M8'),
 ('PK','92.GAME','92GAME','AR',true,'M8'),('PK','RAJA','Foreign same name','AR',true,'M8'),
 ('IN','CONFLICT','Label A','AR',true,'M8'),('IN','CONFLICT','Label B','WG',true,'Other Team'),
 ('IN','INACTIVE','inactive','AR',false,'M8'),('IN','INVALID','invalid','AR',true,E'M8\\001unsafe');
 insert into ar_config_targets values('IN','RAJALOTTERY','AR'),('IN','INACTIVE','AR');
 insert into panda_config_targets values('IN','REPORTONLY');insert into wg_config_targets values('PK','92GAME');
 insert into newar_detail_platforms values('IN','DHANIWIN',true,null),('IN','FUTURE',true,now()+interval '1 day'),('IN','DISABLED',false,null);
 insert into game66_platforms values('hong_kong','SYNTHETIC-G66',true,'香港团队'),('red_crab','SYNTHETIC-RED',true,'红蟹团队');
 insert into auto_withdraw_daily select 'IN','RAJALOTTERY' from generate_series(1,200);
 insert into auto_withdraw_daily select 'IN','REPORTONLY' from generate_series(1,100);
 insert into third_party_platform_status select 'PK','92.GAME' from generate_series(1,150);`);
}
test('all-scope full JSON, report-only entries, native aliases and conflicting teams remain identical',async()=>{
 await registered();await db.query("select set_config('test.actor',$1,false)",[f.OWNER]);const result=await differential();
 assert(result.platforms.some(r=>r.country==='IN'&&r.platform==='REPORTONLY'));
 assert.equal(result.platforms.filter(r=>r.country==='IN'&&r.platform==='RAJA').length,1);
 assert.equal(result.platforms.find(r=>r.platform==='CONFLICT').team,null);
 assert.equal(result.platforms.find(r=>r.platform==='INVALID').team,null);
 assert.equal(result.platforms.find(r=>r.country==='IN'&&r.platform==='RAJA').team,'M8');
 assert(!result.platforms.some(r=>['FUTURE','DISABLED'].includes(r.platform)));
});
test('country-only and cross-country platform-only scopes preserve exact grants, never foreign/global spill',async()=>{
 await registered();
 for(const s of [{mode:'selected',countries:['IN']},scope(['IN','RAJALOTTERY'],['PK','92GAME']),scope(['PK','RAJA']),scope()]){
  await setScope(s);const result=await differential();
  if(s.platforms?.length===0)assert.deepEqual(result.platforms,[]);
  if(s.platforms?.length===1)assert.deepEqual(result.platforms.map(r=>[r.country,r.platform]),[['PK','RAJA']]);
  if(s.platforms?.length===2)assert.deepEqual(result.platforms.map(r=>[r.country,r.platform]),[['IN','RAJA'],['PK','92GAME']]);
 }
});
test('whole five-field native identity is retained; names and team/source conflicts cannot be lost by pair-only dedup',async()=>{
 await db.query("select set_config('test.actor',$1,false)",[f.OWNER]);
 await db.exec(`insert into dashboard_platform_team_map values
 ('IN','SAME','Z display','AR',true,'M8'),('IN','SAME','A display','AR',true,'M8'),
 ('IN','SAME','A display','WG',true,'Another Team'),('IN','SAME','A display','WG',true,'Another Team');
 insert into auto_withdraw_daily values('IN','SAME'),('IN','SAME');`);
 const result=await differential(),row=result.platforms.find(r=>r.platform==='SAME');assert.equal(row.label,'A display');assert.equal(row.team,null);assert.equal(row.source,undefined);
});
test('real Unicode trim, invalid identity and data-group-specific aliases keep exact JSON and order',async()=>{
 await db.query("select set_config('test.actor',$1,false)",[f.OWNER]);
 await db.exec(`insert into dashboard_platform_team_map values
 ('India',U&'\\00A0rajalottery\\FEFF','RAJA','AR',true,U&'\\00A0M8\\FEFF'),
 ('PK','92.GAME','92GAME','AR',true,'M8'),('IN','92.GAME','India distinct identity','AR',true,'M8'),
 ('SA','NPG-CHILE','Chile','AR',true,'Team'),('巴西','559K','559K','PANDA',true,'胖虎'),
 ('unknown','IGNORED','Ignored','AR',true,'M8'),('IN',null,'Null','AR',true,'M8'),
 ('IN','','Empty','AR',true,'M8'),('IN',E'CONTROL\\001','Bad','AR',true,'M8'),
 ('IN','VALID','Valid','AR',true,repeat('X',201));`);
 const result=await differential();assert(result.platforms.some(r=>r.country==='BR_PANGHU'&&r.platform==='559K'));assert(result.platforms.some(r=>r.country==='CL'&&r.platform==='NPG-CHILE'));assert(result.platforms.some(r=>r.country==='IN'&&r.platform==='92.GAME'));assert(!result.platforms.some(r=>r.platform==='IGNORED'));
});
test('fresh permission/session failures and direct role ACLs are unchanged',async()=>{
 await registered();await setScope(scope(['IN','RAJALOTTERY']));await db.exec(patch);await db.exec('set role authenticated');assert.deepEqual((await catalog()).platforms.map(r=>[r.country,r.platform]),[['IN','RAJA']]);await db.exec('reset role');
 for(const role of ['anon','service_role']){await db.exec('savepoint denied_role;set role '+role);await assert.rejects(catalog(),/permission denied/);await db.exec('rollback to denied_role')}
 await db.exec("select set_config('test.session','no',false)");await f.denied(catalog,/application_session_denied/);await db.exec("select set_config('test.session','yes',false)");
 await db.query("update private.dashboard_roles set permissions=array['access.view'] where id=$1",[f.MANAGER]);await f.denied(catalog,/account_scope_catalog_denied/);
});
test('repeatable guard preserves all metadata and rejects body, replay metadata and dependency drift',async()=>{
 const before=await metadata();await db.exec(patch);assert.deepEqual(await metadata(),before);await db.exec(patch);assert.deepEqual(await metadata(),before);
 assert.equal(await scalar('select md5(prosrc) from pg_proc where oid=$1::regprocedure',[signature]),meta.after_md5);
 for(const change of [`grant execute on function ${signature} to anon`,`alter function ${signature} volatile`,`alter function ${signature} security invoker`,`alter function ${signature} set work_mem='9MB'`]){await db.exec('savepoint drift');await db.exec(change);await f.denied(()=>db.exec(patch),/scope_catalog_identity_metadata_drift/);await db.exec('rollback to drift')}
 await db.exec('savepoint dependency');await db.exec(dataGroup.replace('declare\n','declare\n -- drift\n'));await f.denied(()=>db.exec(patch),/scope_catalog_identity_dependency_drift/);await db.exec('rollback to dependency');
 await db.exec(original.replace('declare actor','-- drift\ndeclare actor'));await f.denied(()=>db.exec(patch),/scope_catalog_identity_baseline_drift/);
});
test('production-shaped historical duplicates yield exactly the same directory before and after, with offline timing',async()=>{
 await registered();await db.query("select set_config('test.actor',$1,false)",[f.OWNER]);
 await db.exec(`insert into auto_withdraw_daily select case when i%2=0 then 'IN' else 'PK' end,case when i%2=0 then 'Synthetic-'||(i%30) else 'Foreign-'||(i%30) end from generate_series(1,11871) i;
 insert into third_party_platform_status select 'IN','Synthetic-'||(i%30) from generate_series(1,5431) i;`);
 const results={baseline:[],candidate:[]};let expected;
 for(let round=0;round<2;round++)for(const name of round?['candidate','baseline']:['baseline','candidate']){
  await db.exec(original);if(name==='candidate')await db.exec(patch);
  const start=performance.now(),out=await catalog();results[name].push(performance.now()-start);
  if(expected)assert.deepEqual(out,expected);else expected=out;
 }
 const evidence={scope:'Offline synthetic PostgreSQL timing only; no actual production catalog invocation',function_before:meta.before_md5,function_after:meta.after_md5,platforms:expected.platforms.length,full_json_equal:true,ms:results};
 if(process.env.SCOPE_CATALOG_TIMING_OUTPUT)fs.writeFileSync(process.env.SCOPE_CATALOG_TIMING_OUTPUT,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
});
