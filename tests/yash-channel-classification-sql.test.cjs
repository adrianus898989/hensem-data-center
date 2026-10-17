// Native production definitions, synthetic rows, no network or credentials.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const migration=read('supabase/migrations/20261015140304_yash_channel_provider_classification.sql');
const production=JSON.parse(read('tests/fixtures/yash-channel-production-functions.json'));
const manifest=JSON.parse(migration.match(/\$manifest\$([\s\S]*?)\$manifest\$/)[1]);
let setup,db,f;
const context=vm.createContext({__dirname,require:n=>n==='node:test'?{test(){},before:cb=>{setup=cb},after(){}}:require(n)});
vm.runInContext(read('tests/yash-readers.test.cjs').split(/\ntest\(/)[0]+'\nglobalThis.fixture={get db(){return db},get id(){return id},add,call,orders,drill,wrapped,as,owner,viewer};',context);
const scalar=async(q,args=[])=>(await db.query(q,args)).rows[0].value;
const metadata=()=>db.query('select oid::regprocedure::text signature,to_jsonb(p)-\'prosrc\' metadata from pg_proc p where oid=any($1::regprocedure[]) order by 1',[production.map(x=>x.signature)]).then(r=>r.rows);
async function installProduction(d){
 await d.exec("set check_function_bodies=off;create table if not exists private.provider_snapshot_jobs(status text,lease_until timestamptz);create table if not exists private.dashboard_submission_streak_jobs(id text,platform_id uuid,expires_at timestamptz);");
 for(const item of production){
  await d.exec(item.definition);
  await d.exec('revoke all on function '+item.signature+' from public,anon,authenticated,service_role;'+(item.metadata.proacl.includes('authenticated=X/postgres')?'grant execute on function '+item.signature+' to authenticated;':''));
 }
}
before(async()=>{
 await setup();f=context.fixture;db=f.db;await installProduction(db);
 await db.exec(`create table private.yash_channels(order_type text,provider text,channel_name text,is_present boolean);insert into private.yash_channels values('deposit','ArbPay','Phonepe_QR',true),('withdrawal','ArbPay','Arb-BANK',true);
 create function private.dashboard_admin_panda_provider_names(text,text) returns table(provider text) language sql as $$select null::text where false$$;`);
 await db.exec(migration);
 await f.add('PHONEPE','充值成功',10,{supplier:'ArbPay',channel:'Phonepe_QR'});
 await f.add('ARB-BANK','已提现',20,{order_type:'withdrawal',supplier:'ArbPay',channel:'Arb-BANK'});
 await f.add('OTHER-ARB','充值成功',30,{supplier:'ArbPay',channel:'Other-UPI'});
 await f.add('WRONG-DIRECTION','充值成功',40,{supplier:'ArbPay',channel:'Arb-BANK'});
 await f.add('OTHER-SUPPLIER','充值成功',50,{supplier:'OtherPay',channel:'Phonepe_QR'});
});
after(async()=>db?.close());
test('only the confirmed supplier, channel and direction pairs become UPI-QR',async()=>{
 const cases=[['deposit','ArbPay','Phonepe_QR','UPI-QR'],['withdrawal','ArbPay','Arb-BANK','UPI-QR'],['deposit',' ArbPay ',' Phonepe_QR ','UPI-QR'],['withdrawal','ArbPay','Phonepe_QR','ArbPay'],['deposit','ArbPay','Arb-BANK','ArbPay'],['deposit','OtherPay','Phonepe_QR','OtherPay'],['deposit','ArbPay','Other-UPI','ArbPay'],['deposit',null,'Phonepe_QR','未识别通道'],['deposit','ArbPay',null,'ArbPay']];
 for(const [type,supplier,channel,expected]of cases)assert.equal(await scalar('select private.dashboard_admin_yash_order_provider($1,$2,$3) value',[type,supplier,channel]),expected);
});
test('orders, success matrix, detail and drilldown share the new bucket; raw supplier stays visible',async()=>{
 for(const [direction,order,amount]of [['charge','PHONEPE',10],['withdraw','ARB-BANK',20]]){
  const r=await f.wrapped({direction,providers:['UPI-QR']});assert.equal(r.summary[0].all_count,1);assert.equal(Number(r.summary[0].all_amount),amount);assert.equal(r.groups.provider[0].provider,'UPI-QR');
  const detail=await f.call({action:'details',direction,orderNumber:order});assert.equal(detail.rows[0].provider,'UPI-QR');assert.equal(detail.rows[0].raw_provider,'ArbPay');
  const analysis=await f.orders({direction,providers:['UPI-QR']});assert.equal(analysis.total,1);assert.equal(analysis.rows[0].order_number,order);
  const drill=await f.drill({direction,providers:['UPI-QR']});assert.equal(drill.summary[0].all_count,1);
 }
 assert.equal((await f.wrapped({providers:['ArbPay']})).summary[0].all_count,2);
});
test('provider options and expansion separate UPI-QR from ordinary ArbPay in both directions',async()=>{
 for(const direction of ['charge','withdraw','all']){
  const r=await scalar('select private.dashboard_admin_live_provider_options($1) value',[{platformIds:[f.id],direction}]);assert(r.providers.includes('UPI-QR'));
  const expanded=await scalar('select private.dashboard_admin_live_expand_provider_filter($1) value',[{platformId:f.id,providers:['UPI-QR'],direction}]);assert.deepEqual(expanded.providers,['UPI-QR']);
 }
 const arb=await scalar('select private.dashboard_admin_live_expand_provider_filter($1) value',[{platformId:f.id,providers:['ArbPay'],direction:'charge'}]);assert.deepEqual(arb.providers,['ArbPay']);
});
test('memberDaily uses the same classification without counting the other supplier or direction',async()=>{
 const r=await scalar('select private.dashboard_admin_live_member_daily($1) value',[{platformId:f.id,startAt:'2026-10-07T00:00:00+05:30',endAt:'2026-10-08T00:00:00+05:30',direction:'charge',providers:['UPI-QR']}]);
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].direction,'charge');assert.equal(r.rows[0].created_order_count,1);assert.equal(r.rows[0].success_order_count,1);assert.equal(r.rows[0].created_member_count,1);
});
test('replay preserves function metadata and does not expire new captures again',async()=>{
 const before=await metadata();await db.exec("insert into private.dashboard_submission_streak_jobs values('new',md5('kb:IN:YASH.BET')::uuid,statement_timestamp()+interval '1 hour')");
 await db.exec(migration);assert.deepEqual(await metadata(),before);assert.equal(await scalar("select expires_at>statement_timestamp() value from private.dashboard_submission_streak_jobs where id='new'"),true);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("select has_function_privilege($1,'private.dashboard_admin_yash_order_provider(text,text,text)','execute') value",[role]),false);
 const contract=await scalar("select prosrc value from pg_proc where oid='private.provider_snapshot_kernel_contract_current()'::regprocedure");
 const expected=JSON.parse(contract.match(/\$expected\$([\s\S]*?)\$expected\$/)[1]);
 for(const name of ['dashboard_admin_live_expand_provider_filter','dashboard_admin_live_submission_analysis','provider_snapshot_submission_kernel']){const c=manifest.find(x=>x.signature.includes('.'+name+'('));assert.equal(expected.find(x=>x.signature===c.signature).body_md5,c.after);}
});
test('scope denial and unsupported source identity remain enforced',async()=>{
 await f.as(f.viewer);try{const r=await f.wrapped({providers:['UPI-QR']});assert.equal(r.summary[0].all_count,1);await assert.rejects(f.wrapped({platformId:'00000000-0000-0000-0000-000000000001',providers:['UPI-QR']}),/platform_denied/);}finally{await f.as(f.owner);}
});

async function installerDb(){
 const {PGlite}=require('@electric-sql/pglite'),d=new PGlite();await d.exec("create schema private;create role anon;create role authenticated;create role service_role;set check_function_bodies=off;");await installProduction(d);return d;
}
test('installer is atomic on body or ACL drift and active snapshot leases',async()=>{
 for(const sql of ["create or replace function private.dashboard_admin_live_expand_provider_filter(p_request jsonb) returns jsonb language sql stable security definer set search_path='' as $$select $1$$",'grant execute on function private.dashboard_admin_live_provider_options(jsonb) to anon',"insert into private.provider_snapshot_jobs values('running',clock_timestamp()+interval '1 minute')"]){
  const d=await installerDb();try{await d.exec(sql);const before=(await d.query("select jsonb_agg(to_jsonb(p) order by p.oid) value from pg_proc p where pronamespace='private'::regnamespace")).rows[0].value;
   await assert.rejects(d.exec(migration),/yash_channel_(body_drift|metadata_drift|active_lease)/);await d.exec('rollback');
   assert.deepEqual((await d.query("select jsonb_agg(to_jsonb(p) order by p.oid) value from pg_proc p where pronamespace='private'::regnamespace")).rows[0].value,before);
  }finally{await d.close();}
 }
});
test('first installation expires only active YASH temporary jobs and leaves published data untouched',async()=>{
 const d=await installerDb();try{
  await d.exec("insert into private.dashboard_submission_streak_jobs values('yash',md5('kb:IN:YASH.BET')::uuid,clock_timestamp()+interval '1 hour'),('other',md5('ar:IN:91CLUB')::uuid,clock_timestamp()+interval '1 hour');create table private.provider_snapshot_artifacts(payload jsonb);insert into private.provider_snapshot_artifacts values('{\"provider\":\"ArbPay\"}');");
  const original=(await d.query('select * from private.provider_snapshot_artifacts')).rows;
  await d.exec(migration);assert.deepEqual((await d.query('select * from private.provider_snapshot_artifacts')).rows,original);
  const rows=(await d.query('select id,expires_at>statement_timestamp() active from private.dashboard_submission_streak_jobs order by id')).rows;assert.deepEqual(rows,[{id:'other',active:true},{id:'yash',active:false}]);
 }finally{await d.close();}
});
test('real published contract accepts only the new frozen kernel and old dependency tokens become stale',async()=>{
 const d=await require('./fixtures/provider-snapshot-harness.cjs').setup({protocol:false});try{
  await installProduction(d);
  const value=async(q,args=[])=>(await d.query(q,args)).rows[0].value;
  assert.equal(await value('select private.provider_snapshot_kernel_contract_current() value'),true);
  const targets=[{source:'kb',scope_group:'IN',source_name:'YASH.BET',name:'YASH.BET'},{source:'ar',scope_group:'IN',source_name:'91CLUB',name:'91CLUB'}];
  const tokens=await Promise.all(targets.map(t=>value('select private.provider_snapshot_dependency_token($1) value',[t])));
  await d.exec(migration);
  assert.equal(await value('select private.provider_snapshot_kernel_contract_current() value'),true);
  for(let i=0;i<targets.length;i++)assert.notEqual(await value('select private.provider_snapshot_dependency_token($1) value',[targets[i]]),tokens[i],'old publications must not be called current after the semantic update');
  const definition=await value("select pg_get_functiondef('private.provider_snapshot_submission_kernel(jsonb,jsonb)'::regprocedure) value");
  await d.exec(definition.replace('private.dashboard_admin_yash_order_provider(y.order_type,y.supplier,y.channel)','private.dashboard_admin_yash_provider(y.supplier)'));
  assert.equal(await value('select private.provider_snapshot_kernel_contract_current() value'),false,'restoring the old frozen submission branch must fail the contract');
 }finally{await d.close();}
});
test('channel options are direction-scoped and reuse the small catalog without a second history scan',async()=>{
 const options=async direction=>scalar('select private.dashboard_admin_live_provider_options($1) value',[{platformIds:[f.id],direction}]);
 await db.exec('begin');try{
  await db.exec('truncate private.yash_channels');assert(!(await options('all')).providers.includes('UPI-QR'));
  await db.exec("insert into private.yash_channels values('deposit','OtherPay','Phonepe_QR',true),('deposit','ArbPay','Arb-BANK',true),('withdrawal','ArbPay','Arb-BANK',false)");
  assert(!(await options('charge')).providers.includes('UPI-QR'));assert((await options('withdraw')).providers.includes('UPI-QR'),'retained historical channel remains selectable');
  assert((await options('charge')).providers.includes('ArbPay'),'supplier options stay compatible even if a catalog entry is absent');
 }finally{await db.exec('rollback');}
 const body=await scalar("select prosrc value from pg_proc where oid='private.dashboard_admin_live_provider_options(jsonb)'::regprocedure");
 assert.equal((body.match(/from private\.yash_orders y/g)||[]).length,1);assert.match(body,/select distinct y\.supplier\s+from private\.yash_orders y/);assert(!body.includes('y.channel'));
 const sql=body.match(/  with platforms[\s\S]*? into v_result;/)[0].replace(' into v_result;',';').replace(/\bp_request\b/g,'$1::jsonb').replace(/\bv_ids\b/g,'$2::uuid[]').replace(/\bv_scope\b/g,"'{}'::jsonb");
 const plan=(await db.query('EXPLAIN (ANALYZE, TIMING OFF, FORMAT JSON) '+sql,[{platformIds:[],direction:'all'},[]])).rows[0]['QUERY PLAN'][0].Plan;
 const scans=[];function visit(n){if(['yash_orders','yash_channels'].includes(n['Relation Name']))scans.push(n);for(const p of n.Plans||[])visit(p);}visit(plan);
 assert(scans.length>=2);assert(scans.every(n=>n['Actual Loops']===0),'unselected YASH must scan neither orders nor channels');
});
test('exact rollback restores every replaced body and ACL without recreating stale capture jobs',async()=>{
 const d=await installerDb();try{
  const state=async()=>(await d.query("select jsonb_agg(to_jsonb(p) order by p.oid) value from pg_proc p where pronamespace='private'::regnamespace")).rows[0].value;
  const before=await state();await d.exec(migration);
  const rollback=read('tests/fixtures/yash-channel-classification-rollback.sql');await d.exec(rollback);await d.exec(rollback);assert.deepEqual(await state(),before);
 }finally{await d.close();}
});
test('canonical aliases of the new channel identity expand without adding a channel history scan',async()=>{
 await db.exec('begin');try{
  await db.exec("create or replace function private.dashboard_admin_live_provider_canonical(text,text,text) returns text language sql as $$select case when $3='UPI-QR' then 'Renamed-QR' else $3 end$$");
  const expanded=await scalar('select private.dashboard_admin_live_expand_provider_filter($1) value',[{platformId:f.id,providers:['Renamed-QR'],direction:'charge'}]);assert.deepEqual(expanded.providers,['Renamed-QR','UPI-QR']);
  const result=await f.wrapped({providers:['Renamed-QR']});assert.equal(result.summary[0].all_count,1);assert.equal(result.groups.provider[0].provider,'Renamed-QR');
 }finally{await db.exec('rollback');}
 const body=await scalar("select prosrc value from pg_proc where oid='private.dashboard_admin_live_expand_provider_filter(jsonb)'::regprocedure");
 assert.match(body,/select distinct private\.dashboard_admin_yash_provider\(y\.supplier\) provider/);assert(!body.includes('y.channel'));
});
test('staged future-token projection leaves live publications valid and exactly predicts the reviewed migration',async()=>{
 const d=await require('./fixtures/provider-snapshot-retention/baseline-harness.cjs').setup({protocol:false});try{
  await installProduction(d);const value=async(q,args=[])=>(await d.query(q,args)).rows[0].value;
  const targets=[{source:'kb',scope_group:'IN',source_name:'YASH.BET',name:'YASH.BET'},{source:'ar',scope_group:'IN',source_name:'91CLUB',name:'91CLUB'},{source:'newar',scope_group:'IN',source_name:'MAAN.WIN',name:'MAAN.WIN'},{source:'game66',scope_group:'IN',source_name:'TPPLAY',name:'TPPLAY'}];
  const before=await Promise.all(targets.map(t=>value('select private.provider_snapshot_dependency_token($1) value',[t])));
  await d.exec(read('tests/fixtures/yash-channel-shadow-token.sql'));
  assert.deepEqual(await Promise.all(targets.map(t=>value('select private.provider_snapshot_dependency_token($1) value',[t]))),before,'staging cannot expire an existing live token');
  const future=await Promise.all(targets.map(t=>value('select private.yash_channel_shadow_dependency_token($1) value',[t])));
  assert(future.every((token,i)=>token!==before[i]));await d.exec(migration);
  assert.deepEqual(await Promise.all(targets.map(t=>value('select private.provider_snapshot_dependency_token($1) value',[t]))),future,'promotion must recompute the real token and compare it with the prepared token');
  await assert.rejects(value('select private.yash_channel_shadow_dependency_token($1) value',[targets[0]]),/yash_shadow_baseline_changed/);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await value("select has_function_privilege($1,'private.yash_channel_shadow_dependency_token(jsonb)','execute') value",[role]),false);
 }finally{await d.close();}
});
