// Exact raw-order cohorts against real PL/pgSQL and synthetic native sources.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.join(__dirname,'..'),migration=fs.readFileSync(path.join(root,'supabase/migrations/20261001144547_admin_analysis_segment_orders.sql'),'utf8');
let native,wg;
async function bootstrap(){const file=path.join(__dirname,'custom-analysis-query.test.cjs'),req=createRequire(file);let setup;const ctx={require:n=>n==='node:test'?{test(){},before:f=>{setup=f},after(){}}:req(n),__dirname,process,console,structuredClone};vm.createContext(ctx);vm.runInContext(fs.readFileSync(file,'utf8')+'\nglobalThis.fixture={get native(){return native},get wg(){return wg}};',ctx,{filename:file});await setup();return ctx.fixture;}
const orders=async(f,q)=>(await f.db.query('select public.dashboard_admin_live_analysis_orders($1::jsonb) data',[JSON.stringify({...q,action:undefined,view:undefined})])).rows[0].data;
const request=(source,extra={})=>native.request(source,{kind:'custom',direction:'charge',amountMin:200,amountMax:250,amountMaxExclusive:true,basis:'created',limit:20,offset:0,...extra});
async function transaction(f,fn){await f.db.exec('begin');try{return await fn();}finally{await f.db.exec('rollback');}}
before(async()=>{({native,wg}=await bootstrap());for(const f of [native,wg]){await f.db.exec("do $$begin if not exists(select from pg_roles where rolname='service_role') then create role service_role;end if;end$$");await f.db.exec(migration);}});
after(async()=>{await native?.db.close();await wg?.db.close();});
test('custom raw orders retain exact bounds, clock, direction, source and safe stable keys',async()=>transaction(native,async()=>{
 for(const source of ['ar','newar','game66','lg'])for(const direction of ['charge','withdraw']){
  const prefix=source+direction+'DETAIL-';
  for(const [id,amount,created,success,status]of [['CREATE',210,'2026-09-19 01:00','2026-09-19 03:00','success'],['SUCCESS',220,'2026-09-18 23:00','2026-09-19 02:00','success'],['BOTH',230,'2026-09-19 02:00','2026-09-19 02:30','success'],['UPPER',250,'2026-09-19 02:00','2026-09-19 02:30','success'],['PENDING',240,'2026-09-19 02:00',null,'pending']])await native.add(source,direction,prefix+id,amount,{created,success,status,provider:'DetailPay'});
  const q=request(source,{direction,providers:['DetailPay'],hourRange:{minHour:1,maxHour:3}}),created=await orders(native,q),success=await orders(native,{...q,basis:'success'});
  assert.equal(created.total,3);assert.deepEqual(new Set(created.rows.map(r=>r.order_number)),new Set([prefix+'CREATE',prefix+'BOTH',prefix+'PENDING']));
  assert.equal(success.total,2);assert.deepEqual(new Set(success.rows.map(r=>r.order_number)),new Set([prefix+'SUCCESS',prefix+'BOTH']));
  for(const r of [...created.rows,...success.rows]){assert.equal(r.direction,direction);assert.equal(r.provider,'DetailPay');assert(r.id);assert.equal(typeof r.amount,'string');assert(!['raw','contact','account','bank','password','comment'].some(k=>Object.hasOwn(r,k)));}
  assert.equal(created.basis,'created');assert.equal(success.basis,'success');assert.equal(created.hasMore,false);assert.equal(created.complete,true);assert.equal(created.segment.amountMaxExclusive,true);
 }
}));
test('fixed hourly, exact amounts, amount bands and matrix raw totals agree with corresponding event aggregates',async()=>{
 for(const source of ['ar','newar','game66','lg'])for(const direction of ['charge','withdraw'])for(const segment of [{kind:'hourly',hour:1},{kind:'amount',bucket:'200'},{kind:'amount_range',bucket:'100–200'},{kind:'matrix',hour:1,bucket:'200'},{kind:'matrix_range',hour:1,bucket:'100–200'},{kind:'matrix_range',hour:1,bucket:'band:1',amountBands:native.bands}]){
  const q=native.request(source,{direction,...segment}),aggregate=await native.drill(q);
  for(const basis of ['created','success']){const r=await orders(native,{...q,basis,limit:20});assert.equal(r.total,aggregate.summary[0]?.[basis==='created'?'all_count':'success_count']||0,source+'/'+direction+'/'+segment.kind+'/'+basis);}
 }
});
test('decimal exclusive maximum is not rounded and precise money remains text',async()=>transaction(native,async()=>{
 for(const [i,amount]of ['200','249.999999999999999999','250'].entries())await native.add('ar','charge','RAW-PRECISION-'+i,amount,{provider:'PreciseDetail'});
 const r=await orders(native,request('ar',{providers:['PreciseDetail']}));assert.equal(r.total,2);assert(r.rows.some(x=>x.amount==='249.999999999999999999'));
}));
test('canonical provider aliases select real raw orders without broadening to another provider',async()=>transaction(native,async()=>{
 await native.db.exec(`create or replace function private.dashboard_admin_live_expand_provider_filter(p_request jsonb) returns jsonb language sql immutable as $$select case when p_request->'providers' ? 'PrecisionPay' then jsonb_set(p_request,'{providers}',(p_request->'providers')||'"PrecisionAlias"'::jsonb) else p_request end$$;`);
 await native.add('ar','charge','RAW-ALIAS',210,{provider:'PrecisionAlias'});await native.add('ar','charge','RAW-CANONICAL',220,{provider:'PrecisionPay'});await native.add('ar','charge','RAW-OTHER',230,{provider:'OtherDetail'});
 const r=await orders(native,request('ar',{providers:['PrecisionPay']}));assert.equal(r.total,2);assert.deepEqual(new Set(r.rows.map(x=>x.order_number)),new Set(['RAW-ALIAS','RAW-CANONICAL']));assert(r.rows.every(x=>x.provider==='PrecisionPay'));assert(r.rows.some(x=>x.raw_provider==='PrecisionAlias'));
}));
test('pagination returns exact count, disjoint pages, bounded size and reliable hasMore',async()=>transaction(native,async()=>{
 for(let i=0;i<25;i++)await native.add('ar','charge','PAGE-'+i,210,{provider:'DetailPages'});
 const q=request('ar',{providers:['DetailPages']}),a=await orders(native,q),b=await orders(native,{...q,offset:20}),empty=await orders(native,{...q,offset:40});
 assert.equal(a.total,25);assert.equal(a.rows.length,20);assert.equal(a.hasMore,true);assert.equal(b.total,25);assert.equal(b.rows.length,5);assert.equal(b.hasMore,false);assert.equal(empty.total,25);assert.deepEqual(empty.rows,[]);assert.equal(new Set([...a.rows,...b.rows].map(r=>r.id)).size,25);
}));
test('latency raw orders use the same exact duration boundary and success clock as aggregates',async()=>{
 for(const source of ['ar','newar','game66','lg'])for(const segment of [{kind:'latency',bucket:0,durationVersion:2},{kind:'latency',bucket:2,durationVersion:2,cumulative:true},{kind:'latency',durationVersion:2,durationRange:{minSeconds:120,maxSeconds:180}}]){
  const q=native.request(source,{direction:'charge',...segment}),aggregate=await native.drill(q),r=await orders(native,{...q,basis:'success'});assert.equal(r.total,aggregate.summary[0]?.count||0);assert(r.rows.every(x=>x.status_group==='success'));
 }
});
test('WG unavailable withdrawal success is explicit; native charge raw rows retain clock and original keys',async()=>{
 const q={...wg.req({direction:'charge'}),kind:'custom',amountMin:200,amountMax:400,amountMaxExclusive:true,basis:'created'},r=await orders(wg,q);assert.equal(r.total,2);assert(r.rows.every(x=>x.order_number&&x.id));
 await assert.rejects(orders(wg,{...q,direction:'withdraw',basis:'success'}),/unsupported_success_time_filter_for_wg_withdraw/);
 const withdrawal=await orders(wg,{...wg.req({direction:'withdraw'}),kind:'hourly',hour:1,basis:'created'});assert.equal(withdrawal.total,9);
});
test('fresh authorization, validation, explicit ACL and source contract drift fail closed',async()=>{
 const q=request('ar');for(const extra of [{basis:'mixed'},{basis:null},{basis:'created',kind:'latency',bucket:0},{limit:500},{offset:-1},{status:'success'},{other:true}])await assert.rejects(orders(native,{...q,...extra}));
 await assert.rejects(native.db.query('select public.dashboard_admin_live_analysis_orders($1::jsonb)',[JSON.stringify({...q,view:'drilldown'})]),/invalid_request/);
 await native.as('10000000-0000-0000-0000-000000000002');try{await assert.rejects(orders(native,q),/platform_denied/);}finally{await native.as('10000000-0000-0000-0000-000000000001');}
 const acl=(await native.db.query("select has_function_privilege('anon','public.dashboard_admin_live_analysis_orders(jsonb)','execute') anon,has_function_privilege('authenticated','public.dashboard_admin_live_analysis_orders(jsonb)','execute') authenticated,has_function_privilege('authenticated','private.dashboard_admin_live_analysis_orders_raw(jsonb)','execute') raw")).rows[0];assert.deepEqual(acl,{anon:false,authenticated:true,raw:false});
 await native.db.exec(migration);
 await transaction(native,async()=>{const d=(await native.db.query("select pg_get_functiondef('private.dashboard_admin_live_drilldown_raw(jsonb)'::regprocedure) d")).rows[0].d;await native.db.exec(d.replace('v_max_exclusive,v_hour_min,v_hour_max;','v_max_exclusive,v_hour_min,v_hour_min;'));await assert.rejects(native.db.exec(migration),/analysis_orders_binding_contract_drift/);});
});
