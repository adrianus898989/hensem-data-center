// Local/synthetic PostgreSQL only; no production data, auth or network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createRequire}=require('node:module'),{test}=require('node:test');
const repo=path.resolve(__dirname,'..'),file=path.join(__dirname,'auto-withdraw-unselected-history-sql.test.cjs');
const read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const migration=read('supabase/migrations/20261011134119_auto_withdraw_distinct_report_identities.sql');
const native=read('tests/fixtures/auto-withdraw-country-map-production.sql');
const signature='private.dashboard_admin_live_auto_withdraw(jsonb)';
const meta=async db=>(await db.query("select md5(prosrc)hash,pg_get_functiondef(oid)definition,to_jsonb(p)-'prosrc'metadata from pg_proc p where oid=$1::regprocedure",[signature])).rows[0];

// Reuse the existing complete source/alias/operator/previous/scope matrix with
// the actual production mapping definitions and guarded migration. No work-only
// fixture or unpublished migration is used by the registered test.
let source=fs.readFileSync(file,'utf8');
const replace=(old,next)=>{assert.equal(source.split(old).length,2);source=source.replace(old,next)};
replace("const candidate=read('supabase/migrations/20261011122104_auto_withdraw_skip_unselected_history.sql');","const candidate=read('supabase/migrations/20261011134119_auto_withdraw_distinct_report_identities.sql');let memoizedDefinition;");
replace(" baseline=(await db.query('select pg_get_functiondef($1::regprocedure) definition',[sig])).rows[0].definition;"," await db.exec(read('tests/fixtures/auto-withdraw-country-map-production.sql'));baseline=(await db.query('select pg_get_functiondef($1::regprocedure) definition',[sig])).rows[0].definition;");
replace("assert.equal(old.hash,'ff95fdfb022b8c4e6696697829372a19');","assert.equal(old.hash,'2938e5c2257e166c2c98f607de7b51e0');");
replace('await db.exec(candidate);const after=await ctx.f2.meta(db,sig);assert.deepEqual(after.metadata,old.metadata);',"await db.exec(candidate);memoizedDefinition=(await db.query('select pg_get_functiondef($1::regprocedure)definition',[sig])).rows[0].definition;const after=await ctx.f2.meta(db,sig);assert.deepEqual(after.metadata,old.metadata);");
replace(" await db.exec(candidate);for(let i=0;i<driftQueries.length;i++)",' await db.exec(memoizedDefinition);for(let i=0;i<driftQueries.length;i++)');
replace(" assert.equal(after.hash,'2938e5c2257e166c2c98f607de7b51e0');"," assert.equal(after.hash,'5969967b0e0e25511c43a5df5e25ec6f');await db.exec(read('tests/fixtures/auto-withdraw-country-map-production.sql'));await db.exec(memoizedDefinition);");
replace("test('skip unrelated history without changing full source, permission, operator or previous JSON in 83 cases'","test('native country memoization preserves full JSON across 80 scope/source/operator/prior cases and three runtime mapping changes'");
vm.runInNewContext(source,{__dirname,require:createRequire(file),structuredClone,console});

const context=vm.createContext({__dirname,require:n=>n==='node:test'?{test(){}}:createRequire(file)(n),structuredClone});
vm.runInContext(fs.readFileSync(file,'utf8').split(/\ntest\(/)[0]+';globalThis.h={fixture:ctx.f2.fixture,legacy:ctx.f2.legacy,native:ctx.f2.native};',context);
async function fixture(){const db=await context.h.fixture();await db.exec(native);assert.equal((await meta(db)).hash,'2938e5c2257e166c2c98f607de7b51e0');return db;}
const call=(db,extra={})=>db.query('select private.dashboard_admin_live_auto_withdraw($1::jsonb)r',[{country:'印度',startAt:'2026-10-10T00:00:00Z',endAt:'2026-10-10T23:59:59Z',limit:20,...extra}]).then(x=>x.rows[0].r);

test('native country aliases, Panghu/NPG separation, whitespace and notes preserve exact scoped output',async()=>{
 const db=await fixture();try{
  for(const country of ['印度','IN','INDIA',' 巴西 ','BR','BRAZIL','胖虎巴西','BR_PANGHU','PANGHU BRAZIL','南美','SA','PK','UNKNOWN'])
   for(const platform of ['ORDINARY','25RR','559K','NPG-CHILE','NPG-COLOMBIA','NPG-MEXICO'])
    for(const day of ['2026-10-09','2026-10-10'])await context.h.legacy(db,platform,day,20,5,15,country);
  await db.exec("insert into auto_withdraw_notes values('2026-10-10','印度','ORDINARY','synthetic-note','2026-10-11T00:00:00Z')");
  const requests=[{country:'印度'},{country:'巴西'},{country:'胖虎巴西'},{country:'智利'},{country:'哥伦比亚'},{country:'墨西哥'},{country:'巴基斯坦'},{country:'UNKNOWN'}, {country:'巴西',scopeTargets:[{country:'胖虎巴西',platforms:['25RR','559K']}]}, {platforms:['ORDINARY']}, {platforms:[]}, {view:'operators'}];
  const old=[];for(const r of requests)old.push(await call(db,r));await db.exec(migration);
  for(let i=0;i<requests.length;i++)assert.deepEqual(await call(db,requests[i]),old[i],'native mapping scope '+i);
  await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({targets:[['印度','ORDINARY']]})]);const restricted=await call(db);assert.deepEqual(restricted.rows.map(x=>x.platform),['ORDINARY']);
  await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({targets:[]})]);assert.deepEqual((await call(db)).rows,[]);
 }finally{await db.close()}
});

test('guarded replay preserves function identity/metadata and ACL denies anon/service while authenticated can use it',async()=>{
 const db=await fixture();try{
  const before=await meta(db);await db.exec(migration);const after=await meta(db);assert.equal(after.hash,'5969967b0e0e25511c43a5df5e25ec6f');assert.deepEqual(after.metadata,before.metadata);
  await db.exec(migration);assert.deepEqual(await meta(db),after);
  const privileges=(await db.query("select has_function_privilege('anon',$1,'execute')anon,has_function_privilege('service_role',$1,'execute')service,has_function_privilege('authenticated',$1,'execute')auth",[signature])).rows[0];assert.deepEqual(privileges,{anon:false,service:false,auth:true});
  for(const role of ['anon','service_role']){await db.exec('set role '+role);await assert.rejects(()=>call(db),/permission denied/);await db.exec('reset role')}
  await db.exec('set role authenticated');assert.deepEqual((await call(db)).rows,[]);await db.exec('reset role');
 }finally{await db.close()}
});

test('baseline body, security, ACL and native mapping body/config/volatility drift fail closed before replacement or replay',async()=>{
 const db=await fixture(),block=migration.slice(migration.indexOf('do $patch$'),migration.lastIndexOf('commit;'));try{
  for(const installed of [false,true]){
   if(installed)await db.exec(migration);const expected=await meta(db);
   const body=expected.definition.replace('declare\n','declare\n -- synthetic unknown body\n');
   const changes=[body,'alter function '+signature+' security invoker','alter function '+signature+' set search_path=public','grant execute on function '+signature+' to anon',
    "alter function private.dashboard_admin_live_report_country(text,text) stable",
    "alter function private.dashboard_admin_live_report_country(text,text) parallel unsafe",
    "grant execute on function private.dashboard_admin_live_withdraw_key(text)to service_role",
    "alter function private.dashboard_admin_live_is_panghu_platform(text) set search_path=public",
    "create or replace function private.dashboard_admin_live_report_country(p_country text,p_platform text)returns text language sql immutable parallel safe set search_path=''as $$select p_country$$"];
   for(const change of changes){await db.exec('begin');await db.exec(change);await assert.rejects(()=>db.exec(block),/WITHDRAW_IDENTITY_(BODY|METADATA|HELPER)_MISMATCH/);await db.exec('rollback');assert.deepEqual(await meta(db),expected)}
  }
 }finally{await db.close()}
});
