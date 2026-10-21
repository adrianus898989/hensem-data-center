// Production entrypoint bodies with synthetic native facts; no live sessions or orders.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const file=path.join(__dirname,'withdraw-prepared-sql.test.cjs'),noop=()=>{};noop.afterEach=()=>{};
const ctx=vm.createContext({__dirname,console,structuredClone,require:n=>n==='node:test'?noop:createRequire(file)(n)});
vm.runInContext(fs.readFileSync(file,'utf8').split(/\ntest\.afterEach/)[0]+';globalThis.fx={installed,val,getDb:()=>db,add:h.add};',ctx);
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8'),sql=read('supabase/maintenance/withdraw-country-serving.sql');let db;
const value=(sql,args=[])=>ctx.fx.val(sql,args),q=(extra={})=>({country:'巴基斯坦',view:'auto',startAt:'2026-10-13T00:00:00.000Z',endAt:'2026-10-13T23:59:59.000Z',limit:500,...extra});
const call=request=>value('select private.withdraw_prepared_read($1)v',[request||q()]);
async function install(){await ctx.fx.installed();db=ctx.fx.getDb();await db.exec(`
 alter table private.withdraw_prepared_jobs add column interactive_requested_at timestamptz;
 create table private.withdraw_prepared_builds(id uuid primary key,job_id uuid,revision bigint,dependency text,request jsonb,scope jsonb,catalog jsonb,updated_at timestamptz);
 create table private.withdraw_prepared_parts(build_id uuid,status text);
 create function private.auto_team_previous_projection(q jsonb,b jsonb,v jsonb,r jsonb)returns jsonb language sql as $$select v$$;
 create function private.dashboard_admin_live_deposit_platform_key(text,text)returns text language sql immutable as $$select private.dashboard_admin_live_withdraw_key($2)$$;
 set check_function_bodies=off;`);
 await db.exec(read('tests/fixtures/withdraw-country-readers.oct21.sql'));await db.exec(read('tests/fixtures/npg-report-reader.oct21.sql'));
 await db.exec(`revoke all on function private.withdraw_prepared_admit_default_template(uuid,jsonb,jsonb,jsonb),private.npg_withdraw_report_snapshots(date,date,jsonb,jsonb,jsonb)from public,anon,authenticated,service_role;set check_function_bodies=on;`);
 await db.exec("insert into public.synthetic_catalog values('00000000-0000-4000-8000-000000000111','FOREIGN','M8','印尼','ID','ar','Asia/Jakarta','IDR','FOREIGN')");
}
async function publishLegacy(request=q()){
 const r=await value('select private.withdraw_prepared_canonical($1)v',[request]),c=await value("select jsonb_agg(to_jsonb(p)order by p.id)v from private.dashboard_admin_live_platforms()p"),s={mode:'all',countries:[]};
 const id=await value('select private.withdraw_prepared_enqueue($1,$2,$3,private.withdraw_prepared_dependency())v',[r,s,c]);
 const payload=await value('select private.withdraw_prepared_compute($1,$2,$3)v',[r,s,c]);
 const artifact=await value("insert into private.withdraw_prepared_artifacts(job_id,revision,fence,run_id,dependency,payload,computed_at,expires_at,bytes)select id,revision,1,gen_random_uuid(),dependency,$2,clock_timestamp(),clock_timestamp()+interval'10minutes',octet_length($2::jsonb::text)from private.withdraw_prepared_jobs where id=$1 returning id v",[id,payload]);
 await db.query('insert into private.withdraw_prepared_heads values($1,$2)',[id,artifact]);await db.query("update private.withdraw_prepared_jobs set status='ready'where id=$1",[id]);return{id,artifact,payload,r,c};
}
test.afterEach(async()=>{await db?.close();db=null;});
test('existing publication remains immediately readable while exact country key is admitted once',async()=>{
 await install();await ctx.fx.add(db);const legacy=await publishLegacy(),before=await call();const dep=await value('select private.withdraw_prepared_dependency()v');await db.exec(sql);assert.equal(await value('select private.withdraw_prepared_dependency()v'),dep);
 const after=await call();assert.equal(after.prepared.status,'ready');assert.equal(after.prepared.generation,legacy.artifact);assert.deepEqual({...after,prepared:null},{...before,prepared:null});assert.equal(after.prepared.computedAt,before.prepared.computedAt);assert.equal(after.prepared.expiresAt,before.prepared.expiresAt);assert.equal(after.prepared.refreshState,'queued');
 assert.equal(await value('select count(*)v from private.withdraw_prepared_jobs'),2);await call();assert.equal(await value('select count(*)v from private.withdraw_prepared_jobs'),2);
 const catalogs=(await db.query('select catalog,request,scope from private.withdraw_prepared_jobs where id<>$1',[legacy.id])).rows;assert(catalogs[0].catalog.every(p=>p.country==='巴基斯坦'));assert.deepEqual(catalogs[0].request,legacy.r);assert.deepEqual(catalogs[0].scope,legacy.payload.scope);
});
test('country projection keeps native duplicates, whole country and explicit target countries without rewriting platform filters',async()=>{
 await install();await db.exec(sql);const catalog=[{id:'1',country:'印度',name:'RAJA'},{id:'2',country:'印度',name:'RAJA'},{id:'3',country:'香港',name:'HK'},{id:'4',country:'印尼',name:'ID'}];
 assert.deepEqual(await value('select private.dashboard_withdraw_country_catalog($1,$2)v',[{country:'印度',platforms:['RAJA']},catalog]),catalog.slice(0,3));
 assert.deepEqual(await value('select private.dashboard_withdraw_country_catalog($1,$2)v',[{country:'印度',scopeTargets:[{country:'印度',platforms:['RAJA']},{country:'香港',platforms:['HK']}]},catalog]),catalog.slice(0,3));
});
test('original native computation is identical after pruning unrelated country records',async()=>{
 await install();await ctx.fx.add(db);const legacy=await publishLegacy();await db.exec(sql);const projected=await value('select private.dashboard_withdraw_country_catalog($1,$2)v',[legacy.r,legacy.c]);const actual=await value('select private.withdraw_prepared_compute($1,$2,$3)v',[legacy.r,legacy.payload.scope,projected]);const strip=x=>{const{catalog,computedAt,...facts}=x;return facts;};assert.deepEqual(strip(actual),strip(legacy.payload));
});
for(const change of ['new-native','native-metadata','scope','query','dependency','artifact-revision'])test('incompatible '+change+' never borrows an old publication',async()=>{
 await install();const legacy=await publishLegacy();await db.exec(sql);
 if(change==='new-native')await db.exec("insert into public.synthetic_catalog values('00000000-0000-4000-8000-000000000112','NEW','M8','巴基斯坦','PK','ar','Asia/Karachi','PKR','NEW')");
 if(change==='native-metadata')await db.exec("update public.synthetic_catalog set team='CHANGED'where country='巴基斯坦'");
 if(change==='scope')await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({mode:'selected',countries:[],platforms:[{country:'PK',platform:'92BLAZE'}]})]);
 if(change==='dependency')await db.query("update private.withdraw_prepared_jobs set dependency='obsolete'where id=$1",[legacy.id]);
 if(change==='artifact-revision')await db.query('update private.withdraw_prepared_jobs set revision=revision+1 where id=$1',[legacy.id]);
 const result=await call(change==='query'?q({platforms:['POPZAR']}):q());assert.notEqual(result.prepared.status,'ready');assert.equal(result.rows,null);
});
test('failed staged global key and immutable head remain untouched while new scoped job gets normal budget',async()=>{
 await install();const legacy=await publishLegacy();await db.query("update private.withdraw_prepared_jobs set status='failed',attempts=3,last_error='staged_source_expired'where id=$1",[legacy.id]);await db.exec(sql);const result=await call();assert.equal(result.prepared.status,'ready');assert.equal(result.prepared.generation,legacy.artifact);
 assert.deepEqual((await db.query('select status,attempts,last_error from private.withdraw_prepared_jobs where id=$1',[legacy.id])).rows[0],{status:'failed',attempts:3,last_error:'staged_source_expired'});assert.equal(await value('select attempts v from private.withdraw_prepared_jobs where id<>$1',[legacy.id]),0);
});
test('permission denial precedes catalog reuse or new job admission',async()=>{await install();await publishLegacy();await db.exec(sql);await db.exec("set test.denied='yes'");await assert.rejects(call(),/denied/);assert.equal(await value('select count(*)v from private.withdraw_prepared_jobs'),1);});
test('unrelated country metadata changes leave scoped job identity stable',async()=>{await install();await db.exec(sql);await call();const id=await value('select id v from private.withdraw_prepared_jobs');await db.exec("update public.synthetic_catalog set team='CHANGED'where country='印尼'");await call();assert.equal(await value('select count(*)v from private.withdraw_prepared_jobs'),1);assert.equal(await value('select id v from private.withdraw_prepared_jobs'),id);});
test('prewarm uses the same country identity and coalesces global/country template duplicates',async()=>{
 await install();const legacy=await publishLegacy();await value("select private.withdraw_prepared_register_template($1,'Asia/Karachi')v",[legacy.id]);await db.exec(sql);const projected=await value('select private.dashboard_withdraw_country_catalog($1,$2)v',[legacy.r,legacy.c]);const id=await value('select private.withdraw_prepared_enqueue($1,$2,$3,private.withdraw_prepared_dependency())v',[legacy.r,legacy.payload.scope,projected]);await value("select private.withdraw_prepared_register_template($1,'Asia/Karachi')v",[id]);await db.exec("update public.synthetic_catalog set team='CHANGED'where country='印尼';set statement_timeout='3s'");assert.equal((await value('select private.withdraw_prepared_prewarm()v')).expected,2);
 const jobs=(await db.query("select catalog from private.withdraw_prepared_jobs where left(request->>'startAt',10)<> '2026-10-13'")).rows;assert.equal(jobs.length,2);assert(jobs.every(j=>j.catalog.every(p=>p.country==='巴基斯坦')));
});
test('NPG exact existing report mappings register whole-day defaults without source reads or wider grants',async()=>{
 await install();await db.exec(sql);for(const[country,platform,zone]of[['哥伦比亚','NPG-COLOMBIA','America/Bogota'],['墨西哥','NPG-MEXICO','America/Mexico_City'],['智利','NPG-CHILE','America/Santiago']]){const day=await value('select(clock_timestamp()at time zone $1)::date::text v',[zone]);const request=q({country,platforms:[platform],startAt:day+'T00:00:00.000Z',endAt:day+'T23:59:59.000Z'});await call(request);const template=await value("select timezone v from private.withdraw_prepared_templates where request->>'country'=$1",[country]);assert.equal(template,zone);}
 assert.equal(await value('select count(*)v from private.withdraw_prepared_templates'),3);
});
test('NPG special template rejects unknown labels, assigned scope and reader code drift',async()=>{
 await install();await db.exec(sql);const s={mode:'all',countries:[]};assert.equal(await value('select private.dashboard_withdraw_npg_template_zone($1,$2,$3)v',[{country:'哥伦比亚',platforms:['OTHER']},s,[]]),null);assert.equal(await value('select private.dashboard_withdraw_npg_template_zone($1,$2,$3)v',[{country:'哥伦比亚',platforms:['NPG-COLOMBIA']},{mode:'selected',countries:['哥伦比亚']},[]]),null);
 await db.exec('alter function private.npg_withdraw_report_snapshots(date,date,jsonb,jsonb,jsonb)security definer');assert.equal(await value('select private.dashboard_withdraw_npg_template_zone($1,$2,$3)v',[{country:'哥伦比亚'},s,[]]),null);
});
test('helpers are private and no existing job/head is deleted by installation',async()=>{await install();const legacy=await publishLegacy();await db.exec(sql);assert.equal(await value('select artifact_id v from private.withdraw_prepared_heads where job_id=$1',[legacy.id]),legacy.artifact);for(const role of['anon','authenticated','service_role'])for(const fn of['private.dashboard_withdraw_country_catalog(jsonb,jsonb)','private.dashboard_withdraw_country_last_complete(jsonb,jsonb,jsonb,jsonb,text,text)','private.dashboard_withdraw_npg_template_zone(jsonb,jsonb,jsonb)'])assert.equal(await value('select has_function_privilege($1,$2,\'EXECUTE\')v',[role,fn]),false);});

test('guarded rollback restores entry bodies and keeps immutable state and dependency',async()=>{
 await install();const legacy=await publishLegacy();const before=(await db.query("select proname,md5(prosrc)hash from pg_proc where pronamespace='private'::regnamespace and proname in('withdraw_prepared_read','withdraw_prepared_prewarm','withdraw_prepared_admit_default_template') order by proname")).rows;const dep=await value('select private.withdraw_prepared_dependency()v');await db.exec(sql);await call();await db.exec(read('supabase/maintenance/withdraw-country-serving.rollback.sql'));
 assert.deepEqual((await db.query("select proname,md5(prosrc)hash from pg_proc where pronamespace='private'::regnamespace and proname in('withdraw_prepared_read','withdraw_prepared_prewarm','withdraw_prepared_admit_default_template') order by proname")).rows,before);assert.equal(await value('select private.withdraw_prepared_dependency()v'),dep);assert.equal(await value('select artifact_id v from private.withdraw_prepared_heads where job_id=$1',[legacy.id]),legacy.artifact);assert.equal(await value("select count(*)v from pg_proc where pronamespace='private'::regnamespace and proname like'dashboard_withdraw_%'"),0);
});
test('rollback rejects later function edits and install rejects security drift',async()=>{
 await install();await db.exec('alter function private.withdraw_prepared_prewarm()security definer');await assert.rejects(db.exec(sql),/withdraw_country_security_drift/);await db.exec('alter function private.withdraw_prepared_prewarm()security invoker');await db.exec(sql);await db.exec('alter function private.dashboard_withdraw_npg_template_zone(jsonb,jsonb,jsonb)security definer');await assert.rejects(db.exec(read('supabase/maintenance/withdraw-country-serving.rollback.sql')),/withdraw_country_rollback_drift/);assert.notEqual(await value("select to_regprocedure('private.dashboard_withdraw_country_catalog(jsonb,jsonb)')::text v"),null);
});

test('report-team country aliases retain full real-country native metadata without changing request or permissions',async()=>{
 await install();await db.exec(sql);const catalog=[{id:'1',country:'巴西',scope_group:'BR_PANGHU',name:'PANGHU'},{id:'2',country:'巴西',scope_group:'BR',name:'BR'},{id:'3',country:'印度',scope_group:'IN',name:'IN'},{id:'4',country:'香港',scope_group:'HK_TEAM',name:'HK'},{id:'5',country:'红膏蟹',scope_group:'RED_CRAB',name:'CRAB'},{id:'6',country:'菲律宾',scope_group:'PH',name:'PH'},{id:'7',country:'LG',scope_group:'LG',name:'LG'},{id:'8',country:'印尼',scope_group:'ID',name:'ID'}];
 for(const[target,expected]of[['胖虎巴西',catalog.slice(0,2)],['香港',catalog.slice(2,5)],['红膏蟹',catalog.slice(2,5)],['LG',catalog.slice(5,7)]]){const request={country:target,scopeTargets:[{country:target,platforms:[expected[0].name]}]};assert.deepEqual(await value('select private.dashboard_withdraw_country_catalog($1,$2)v',[request,catalog]),expected);assert.equal(request.scopeTargets[0].country,target);}
 const combined={country:'印度',scopeTargets:['印度','香港','红膏蟹'].map(country=>({country,platforms:['ANY']}))};assert.deepEqual(await value('select private.dashboard_withdraw_country_catalog($1,$2)v',[combined,catalog]),catalog.slice(2,5));
});
