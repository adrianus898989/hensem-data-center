// Real native PostgreSQL kernels, synthetic records; no production access.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20261015141000_exact_prepared_aggregates.sql');
const part=n=>migration.split('-- BEGIN '+n+'\n')[1].split('-- END '+n)[0];
function fn(source,name){const p=source.search(new RegExp('create(?: or replace)? function private\\.'+name+'\\(','i'));assert(p>=0,name);const tail=source.slice(p),m=tail.match(/as\s+(\$[a-z_]*\$)/i),end=tail.indexOf(m[1]+';',m.index+m[0].length);return tail.slice(0,end+m[1].length+1);}
async function fixture(file,exports){let setup;const filename=path.join(__dirname,file);const empty=()=>{};const stub={test:Object.assign(empty,{before:f=>setup=f,after:empty,beforeEach:empty}),before:f=>setup=f,after:empty};
 const context=vm.createContext({require:n=>n==='node:test'?stub:createRequire(filename)(n),__dirname,process,console,structuredClone,crypto:require('node:crypto')});
 vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.fixture={'+exports+'};',context,{filename});if(setup)await setup();return context.fixture;
}
async function install(db){await db.exec("do $$begin if not exists(select from pg_roles where rolname='service_role')then create role service_role;end if;end$$;");
 await db.exec(`create table if not exists private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[],directions text[]);create table if not exists private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text);`);
 for(const [file,name]of [['supabase/admin-live-provider-aliases.sql','dashboard_admin_live_provider_alias'],['supabase/admin-live-provider-aliases.sql','dashboard_admin_live_confirmed_usdt_provider'],['supabase/migrations/20261002115942_vietnam_confirmed_provider_business_class.sql','dashboard_admin_live_confirmed_provider'],['supabase/admin-live-configuration.sql','dashboard_admin_live_provider_alias_values']])if(!(await db.query('select to_regprocedure($1)f',[`private.${name}(${name==='dashboard_admin_live_confirmed_provider'?'text,text,text':name==='dashboard_admin_live_provider_alias_values'?'text,text[]':'text,text'})`])).rows[0].f)await db.exec(fn(read(file),name));
 await db.exec(fn(part('store'),'prepared_aggregate_canonical_request'));for(const p of ['projection','direction','master'])await db.exec(part(p));
}
function normalize(x){if(Array.isArray(x))return x.map(normalize).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,normalize(x[k])]));return x;}
async function compare(db,request,target,compute='private.prepared_aggregate_raw_kernel($1,jsonb_build_array($2::jsonb))'){
 const base={...request,action:'aggregate',view:'full',direction:'all',status:'all',durationVersion:2};
 const initial=(await db.query(`select ${compute} p`,[JSON.stringify(base),JSON.stringify(target)])).rows[0].p;
 const selected=initial.groups.provider[0]?.provider;
 for(const view of ['full','providers'])for(const direction of ['all','charge','withdraw'])for(const provider of (view==='providers'&&selected?[null,selected]:[null])){
  const q={...base,view,direction};delete q.durationVersion;if(view==='providers')delete q.amountBands;
  if(provider)q.providers=[provider,provider];
  const direct=compute.replaceAll('$1','$3');
  const r=(await db.query(`with master as materialized(select ${compute} p),expected as materialized(select ${direct} p)
   select private.prepared_aggregate_master_projection(master.p,private.prepared_aggregate_canonical_request($1,$2),private.prepared_aggregate_canonical_request($3,$2))actual,expected.p expected from master cross join expected`,[JSON.stringify(base),JSON.stringify(target),JSON.stringify(q)])).rows[0];
  assert.deepEqual(normalize(r.actual),normalize(r.expected),`${target.source}/${view}/${direction}/${request.successBasis||'legacy'}/${provider||'all'}`);
 }
}
test('AR NEWAR LG GAME66 full-v2 exactly derives both legacy views across independent clocks and directions',async()=>{
 const f=await fixture('exact-prepared-dual-clock-sql.test.cjs','get db(){return db},get native(){return native},target');try{await install(f.db);
  await f.db.exec('create table public.lg_success_daily(country_code text,platform text,third_party text,raw_channel text,scope_type text,order_kind text)');
  await f.db.exec(part('expand'));await f.db.exec(part('mask'));await f.db.exec(fn(read('supabase/migrations/20261015061212_provider_published_snapshot_shadow.sql'),'provider_snapshot_orders_result_kernel'));await f.db.exec(fn(part('worker'),'prepared_aggregate_compute'));
  for(const source of ['ar','newar','lg','game66']){const t=await f.target(source);for(const extra of [{},{successStartAt:'2026-09-21T00:00:00.000001+05:30',successEndAt:'2026-09-22T00:00:00.000001+05:30',successBasis:'success'},{successBasis:'source_updated'}])await compare(f.db,f.native.request(source,extra),t,'private.prepared_aggregate_compute($1,$2)');}
 }finally{await f.db.close()}
});
for(const [source,file]of [['duoli','duoli-updated-success.test.cjs'],['kb','yash-readers.test.cjs'],['wg','wg-existing-orders.test.cjs'],['panda','panda-native-readers.test.cjs']])test(`${source} real adapter: full-master projection preserves missing-clock NULLs and original fee/native evidence`,async()=>{
 const tools=await fixture('exact-prepared-native-adapters-sql.test.cjs','boot');const f=await tools.boot(file);try{await install(f.db);
  if(source==='kb')await f.db.exec(read('tests/fixtures/prepared-master-yash-order-provider.sql'));
  if(source==='wg')await f.db.exec(fn(read('supabase/migrations/20261002105434_wg_provider_options_index_walk.sql'),'dashboard_admin_wg_provider_names'));
  const q=f.req({status:'all',direction:'all'}),t=(await f.db.query('select to_jsonb(p)t from private.dashboard_admin_live_platforms()p where p.id=$1',[q.platformId])).rows[0].t;
  for(const basis of ['success','source_updated'])await compare(f.db,{...q,successStartAt:q.startAt,successEndAt:q.endAt,successBasis:basis},t,'private.prepared_aggregate_compute($1,$2)');
 }finally{await f.db.close()}
});
test('latency v2 boundary bins coarsen exactly; precision, unknown amounts and fee facts survive',async()=>{
 const f=await fixture('exact-prepared-dual-clock-sql.test.cjs','get db(){return db},get native(){return native},target');try{await install(f.db);await f.db.exec('delete from ar_collected_orders');
  for(const [i,ms]of [0,60000,60001,180000,180001,300000,300001,1800000,1800001,259200000,259200001].entries())await f.native.add('ar','charge','BOUNDARY_'+i,'123.123456789',{created:'2026-09-19 01:00',success:new Date(Date.parse('2026-09-19T01:00:00+05:30')+ms).toISOString()});
  await f.db.exec("update ar_collected_orders set amount=null where order_no='BOUNDARY_2'");
  const q=f.native.request('ar',{successStartAt:'2026-09-19T00:00:00+05:30',successEndAt:'2026-09-23T00:00:00+05:30',successBasis:'success'});await compare(f.db,q,await f.target('ar'));
 }finally{await f.db.close()}
});
