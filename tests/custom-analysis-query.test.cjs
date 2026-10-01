// Real PL/pgSQL patches against synthetic source fixtures; no network or secrets.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.join(__dirname,'..'),migration=fs.readFileSync(path.join(root,'supabase/migrations/20261001130412_admin_custom_analysis_range_performance.sql'),'utf8');
const exclusive=fs.readFileSync(path.join(root,'supabase/migrations/20261001112505_admin_aggregate_exclusive_amount_max.sql'),'utf8');
const runtimeGuard=fs.readFileSync(path.join(root,'supabase/migrations/20261001132235_admin_analysis_runtime_predicate_guard.sql'),'utf8');
let native,wg,baseline,aclBefore;
async function bootstrap(file,expose){
 const filename=path.join(__dirname,file),req=createRequire(filename);let setup;
 const context={require:n=>n==='node:test'?{test(){},before:f=>{setup=f},after(){}}:req(n),__dirname,process,console,structuredClone};
 vm.createContext(context);vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.fixture={'+expose+'};',context,{filename});await setup();return context.fixture;
}
const stable=value=>{const r=structuredClone(value);delete r.asOf;for(const s of r.pendingSummary||[])for(const k of ['mean_ms','max_ms','p50_ms','p95_ms'])delete s[k];return r;};
const meta=async db=>(await db.query("select proname,proowner,proacl::text,proconfig,prosecdef,provolatile from pg_proc where pronamespace='private'::regnamespace and proname in ('dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_drilldown_raw','dashboard_admin_live_drilldown') order by proname")).rows;
const custom=(source='ar',extra={})=>native.request(source,{view:'drilldown',kind:'custom',direction:'charge',...extra});
async function transaction(db,fn){await db.exec('begin');try{return await fn();}finally{await db.exec('rollback');}}
before(async()=>{
 native=await bootstrap('admin-duration-precision-ranges.test.cjs','get db(){return db},request,call,drill,add,as,bands');
 wg=await bootstrap('wg-existing-orders.test.cjs','get db(){return db},req,call,drill,add,as');
 for(const f of [native,wg])await f.db.exec(exclusive);
 baseline={native:[],wg:[]};
 for(const source of ['ar','newar','game66','lg'])for(const direction of ['all','charge','withdraw'])for(const view of ['full','providers']){
  const q=native.request(source,{direction,view,amountMin:101,amountMax:188,amountMaxExclusive:true});baseline.native.push([q,stable(await native.call(q))]);
 }
 baseline.latency=stable(await native.drill({...native.request('ar'),kind:'latency',bucket:0,durationVersion:2}));
 baseline.hourly=stable(await native.drill({...native.request('ar'),kind:'hourly',hour:1}));
 for(const direction of ['charge','withdraw'])baseline.wg.push([wg.req({direction}),stable(await wg.call(wg.req({direction})))]);
 aclBefore=await Promise.all([meta(native.db),meta(wg.db)]);
 for(const f of [native,wg]){await f.db.exec(migration);await f.db.exec(runtimeGuard);}
});
after(async()=>{await native?.db.close();await wg?.db.close();});
test('AR indexed clock union preserves all old full/compact aggregate results and other sources',async()=>{
 for(const [q,expected]of baseline.native)assert.deepEqual(stable(await native.call(q)),expected,JSON.stringify([q.platformId,q.direction,q.view]));
 for(const [q,expected]of baseline.wg)assert.deepEqual(stable(await wg.call(q)),expected);
 assert.deepEqual(stable(await native.drill({...native.request('ar'),kind:'latency',bucket:0,durationVersion:2})),baseline.latency,'latency engine remains exact');
 const hourly=stable(await native.drill({...native.request('ar'),kind:'hourly',hour:1}));assert.deepEqual(hourly.summary,baseline.hourly.summary);assert.deepEqual(hourly.groups.daily,baseline.hourly.groups.daily);
});
test('amount custom lower inclusive upper exclusive retains decimal precision on four sources and both directions',async()=>{
 for(const source of ['ar','newar','game66','lg'])for(const direction of ['charge','withdraw']){
  const q=custom(source,{direction,providers:['SelectedPay'],amountMin:200,amountMax:250,amountMaxExclusive:true});
  const r=await native.drill(q),full=await native.call({...q,view:'full',kind:undefined});
  assert.equal(r.summary[0].all_count,2);assert.equal(r.summary[0].all_amount,'400.01');assert.equal(r.summary[0].success_count,2);assert.equal(r.summary[0].success_amount,'400.01');
  for(const k of ['all_count','all_amount','success_count','success_amount'])assert.equal(r.summary[0][k],full.summary[0][k]);
  assert.equal(r.segment.kind,'custom');assert.equal(r.segment.amountMaxExclusive,true);assert.equal(r.groups.provider[0].all_count,2);
 }
 await transaction(native.db,async()=>{
  for(const [i,value]of ['200','249.999999999999999999','250'].entries())await native.add('ar','charge','CUSTOM-PRECISE-'+i,value,{provider:'PreciseCustom'});
  const r=await native.drill(custom('ar',{providers:['PreciseCustom'],amountMin:200,amountMax:250,amountMaxExclusive:true}));assert.equal(r.summary[0].all_amount,'449.999999999999999999');
 });
});
test('hour custom filters creation and completion independently, includes null creation in successful facts, and excludes upper hour',async()=>transaction(native.db,async()=>{
 for(const source of ['ar','newar','game66','lg'])for(const direction of ['charge','withdraw']){
  for(const [id,amount,created,success,status]of [
   ['CREATE-IN-SUCCESS-OUT',210,'2026-09-19 01:00','2026-09-19 03:00','success'],
   ['CREATE-OUT-SUCCESS-IN',220,'2026-09-19 00:00','2026-09-19 02:00','success'],
   ['BOTH-IN',230,'2026-09-19 02:00','2026-09-19 02:30','success'],
   ['BELOW',199.99,'2026-09-19 01:00','2026-09-19 02:00','success'],
   ['UPPER',250,'2026-09-19 01:00','2026-09-19 02:00','success'],
   ['HOUR-UPPER',240,'2026-09-19 03:00','2026-09-19 04:00','success'],
   ['PENDING',240,'2026-09-19 02:00',null,'pending'],
   ['PRIOR',240,'2026-09-18 23:00','2026-09-19 02:00','success']
  ])await native.add(source,direction,source+direction+'CUSTOM-'+id,amount,{created,success,status,provider:'HourPay'});
  const q=custom(source,{direction,providers:['HourPay'],amountMin:200,amountMax:250,amountMaxExclusive:true,hourRange:{minHour:1,maxHour:3}}),r=await native.drill(q),s=r.summary[0];
  assert.equal(s.all_count,3,source+'/'+direction);assert.equal(s.all_amount,'680');assert.equal(s.success_count,3);assert.equal(s.success_amount,'690');assert.equal(s.pending_count,1);assert.equal(s.pending_amount,'240');
  assert.deepEqual(r.segment.hourRange,{minHour:1,maxHour:3});assert.equal(r.groups.provider[0].all_count,3);assert.equal(r.groups.daily[0].success_count,3);
 }
 await native.db.query("insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,amount,status,applied_at,completed_at,raw_channel,channel_type) values('AR','IN','AR-BANDS','recharge','NULL-CREATED-CUSTOM',220,'已支付',null,'2026-09-19 02:00','NullTimePay','BANK')");
 const r=await native.drill(custom('ar',{providers:['NullTimePay'],hourRange:{minHour:1,maxHour:3}}));assert.equal(r.summary[0].all_count,0);assert.equal(r.summary[0].success_count,1);assert.equal(r.summary[0].success_amount,'220');
}));
test('amount-only, hour-only, full 0-24 hours and inclusive legacy amounts remain valid',async()=>{
 const q=custom('newar',{providers:['SelectedPay'],amountMin:200,amountMax:200,amountMaxExclusive:false});assert.equal((await native.drill(q)).summary[0].all_count,1);
 const customAll=await native.drill(custom('ar',{hourRange:{minHour:0,maxHour:24}})),full=await native.call(native.request('ar',{direction:'charge'}));
 assert.deepEqual(customAll.summary,full.summary.map(({provider,date,hour,bucket,...r})=>r));
 const upper=await native.drill(custom('ar',{amountMax:100,amountMaxExclusive:true}));assert(upper.summary[0].all_count>0);
 const empty=await native.drill(custom('ar',{amountMin:123456,amountMax:123457,amountMaxExclusive:true}));assert.deepEqual(empty.summary,[]);assert.deepEqual(empty.groups.provider,[]);assert.deepEqual(empty.groups.provider_daily,[]);
});
test('standard hourly, amount, amount-range and matrix segments add canonical provider/day facts with exact summary totals',async()=>{
 for(const source of ['ar','newar','game66','lg'])for(const direction of ['charge','withdraw'])for(const segment of [
  {kind:'hourly',hour:1},{kind:'amount',bucket:'100'},{kind:'amount_range',bucket:'100–200'},
  {kind:'matrix',hour:1,bucket:'100'},{kind:'matrix_range',hour:1,bucket:'100–200'}
 ]){
  const r=await native.drill({...native.request(source,{direction}),...segment});assert.deepEqual(Object.keys(r.groups),['daily','provider','provider_daily']);
  for(const key of ['all_count','success_count','pending_count','failed_count','rejected_count','unknown_count'])assert.equal(r.groups.provider.reduce((n,x)=>n+Number(x[key]),0),r.summary[0][key],source+'/'+direction+'/'+segment.kind+'/'+key);
  assert.equal(r.groups.provider_daily.reduce((n,x)=>n+x.all_count,0),r.summary[0].all_count);
 }
 await transaction(native.db,async()=>{
  await native.add('ar','charge','CANON-A',100,{provider:'PrecisionAlias'});await native.add('ar','charge','CANON-B',200,{provider:'PrecisionPay'});
  const r=await native.drill(custom('ar',{amountMin:100,amountMax:201,amountMaxExclusive:true}));const p=r.groups.provider.find(x=>x.provider==='PrecisionPay');assert.equal(p.all_count,2);assert.equal(p.all_amount,'300');assert(!JSON.stringify(r).includes('PrecisionAlias'));
 });
});
test('provider mapping runs once per distinct selected raw name rather than once per source row',async()=>transaction(native.db,async()=>{
 await native.db.exec("create sequence custom_mapping_calls;create or replace function private.dashboard_admin_live_provider_canonical(text,text,text) returns text language plpgsql volatile as $$begin perform nextval('public.custom_mapping_calls');return $3;end;$$;");
 for(let i=0;i<40;i++)await native.add('ar','charge','CUSTOM-MAP-'+i,100,{provider:i%2?'RepeatCustomA':'RepeatCustomB'});
 const r=await native.drill(custom('ar',{providers:['RepeatCustomA','RepeatCustomB'],hourRange:{minHour:1,maxHour:2}}));assert.equal(r.groups.provider.length,2);assert.equal(Number((await native.db.query('select last_value from custom_mapping_calls')).rows[0].last_value),2);
}));
test('WG custom retains unavailable withdrawal success and scopes both standard provider groups and custom facts',async()=>{
 const r=await wg.drill({kind:'custom',direction:'withdraw',hourRange:{minHour:1,maxHour:2}});assert.equal(r.summary[0].all_count,9);assert.equal(r.summary[0].success_count,null);assert.equal(r.summary[0].success_amount,null);assert.equal(r.groups.provider[0].success_count,null);assert.equal(r.groups.provider_daily[0].success_amount,null);
 const charge=await wg.drill({kind:'custom',direction:'charge',amountMin:200,amountMax:400,amountMaxExclusive:true});assert.equal(charge.summary[0].all_count,2);assert.equal(charge.groups.provider[0].provider,'CanonicalPay');
});
test('malformed ranges, incompatible kind fields and empty custom requests fail explicitly',async()=>{
 const q=custom();
 for(const hourRange of [null,{},[],{minHour:1},{maxHour:3},{minHour:'1',maxHour:3},{minHour:1.5,maxHour:3},{minHour:1,maxHour:1},{minHour:3,maxHour:2},{minHour:-1,maxHour:3},{minHour:1,maxHour:25},{minHour:24,maxHour:24},{minHour:1,maxHour:3,other:1}])await assert.rejects(native.drill({...q,hourRange}),/invalid_hour_range/);
 await assert.rejects(native.drill(q),/invalid_custom_segment/);
 for(const extra of [{hour:1},{bucket:'100'},{cumulative:false}])await assert.rejects(native.drill({...q,amountMin:100,...extra}),/unexpected_drilldown/);
 for(const amountMaxExclusive of [null,'true',1,{},[]])await assert.rejects(native.drill({...q,amountMax:250,amountMaxExclusive}),/invalid_amount_max_exclusive/);
 for(const extra of [{amountMin:250,amountMax:250,amountMaxExclusive:true},{amountMin:-1},{amountMax:-1},{amountMin:'NaN'},{amountMax:'Infinity'}])await assert.rejects(native.drill({...q,...extra}),/invalid_range|invalid_custom_segment/);
 await assert.rejects(native.drill({...q,kind:'hourly',hour:1,hourRange:{minHour:1,maxHour:2}}),/invalid_hour_range/);
 await assert.rejects(native.drill({...q,kind:'hourly',hour:1,amountMax:250,amountMaxExclusive:true}),/invalid_amount_max_exclusive/);
 await assert.rejects(native.drill({...q,amountMin:100,privateAuthority:true}),/invalid_request/);
});
test('fresh authorization, metadata ACLs, idempotency and transactional drift checks remain intact',async()=>{
 assert.deepEqual(await Promise.all([meta(native.db),meta(wg.db)]),aclBefore);
 await native.as('10000000-0000-0000-0000-000000000002');try{await assert.rejects(native.drill(custom('ar',{amountMin:100})),/platform_denied/);}finally{await native.as('10000000-0000-0000-0000-000000000001');}
 await wg.as('');try{await assert.rejects(wg.drill({kind:'custom',amountMin:100}),/login_required/);}finally{await wg.as('10000000-0000-0000-0000-000000000001');}
 for(const f of [native,wg]){await f.db.exec(migration);await f.db.exec(runtimeGuard);}
 assert.deepEqual(await Promise.all([meta(native.db),meta(wg.db)]),aclBefore);
 await transaction(native.db,async()=>{
  const d=(await native.db.query("select pg_get_functiondef('private.dashboard_admin_live_drilldown_raw(jsonb)'::regprocedure) d")).rows[0].d;
  await native.db.exec(d.replace('from output where gp=0 and gd=0','from output where gp=0 and gd=1'));
  await assert.rejects(native.db.exec(migration),/custom_analysis_installation_incomplete/);
 });
});
test('future AR predicate drift fails before assembling branches instead of silently duplicating facts',async()=>{
 for(const fn of ['dashboard_admin_live_query_raw','dashboard_admin_live_drilldown_raw'])await transaction(native.db,async()=>{
  const d=(await native.db.query(`select pg_get_functiondef('private.${fn}(jsonb)'::regprocedure) d`)).rows[0].d;
  const oldTime=d.split('v_source:=replace(v_source,$ar_old$')[1].split('$ar_old$')[0];
  // Change only the original source predicate; the replacement contract remains.
  const changed=d.replace(oldTime,'        and true');assert.notEqual(changed,d);await native.db.exec(changed);
  const call=fn==='dashboard_admin_live_query_raw'?()=>native.call(native.request('ar',{direction:'charge'})):()=>native.drill(custom('ar',{amountMin:100}));
  await assert.rejects(call(),/analytical_query_contract_drift/);
 });
});
