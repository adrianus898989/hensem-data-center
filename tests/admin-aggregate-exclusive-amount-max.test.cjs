// Exercise the real aggregate engines with synthetic records; no remote access.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.join(__dirname,'..');
const patch=fs.readFileSync(path.join(root,'supabase/migrations/20261001112505_admin_aggregate_exclusive_amount_max.sql'),'utf8');
let native,wg,legacy,aclBefore;
async function bootstrap(file,expose){
  const filename=path.join(__dirname,file),req=createRequire(filename);let setup;
  const context={require:n=>n==='node:test'?{test(){},before:f=>{setup=f},after(){}}:req(n),__dirname,process,console,structuredClone};
  vm.createContext(context);vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.fixture={'+expose+'};',context,{filename});
  await setup();return context.fixture;
}
const stable=value=>{const v=structuredClone(value);delete v.asOf;for(const row of v.pendingSummary||[])for(const key of ['mean_ms','max_ms','p50_ms','p95_ms'])delete row[key];return v;};
const body=async db=>(await db.query("select prosrc from pg_proc where oid='private.dashboard_admin_live_query_raw(jsonb)'::regprocedure")).rows[0].prosrc;
const meta=async db=>(await db.query("select proname,proowner,proacl::text,proconfig,prosecdef,provolatile from pg_proc where pronamespace='private'::regnamespace and proname in ('dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_drilldown_raw') order by proname")).rows;
before(async()=>{
  native=await bootstrap('admin-duration-precision-ranges.test.cjs','get db(){return db},request,call,drill,add,as,bands');
  wg=await bootstrap('wg-existing-orders.test.cjs','get db(){return db},req,call,add,as');
  legacy=await native.call(native.request('newar',{amountMin:200,amountMax:250}));
  aclBefore=await Promise.all([meta(native.db),meta(wg.db)]);
  for(const f of [native,wg])await f.db.exec(patch);
  for(const direction of ['recharge','withdraw'])for(const [i,amount] of ['199.9999','200','249.9999','250','250.0001'].entries())
    await wg.add('278',direction,'EXCLUSIVE-'+direction+i,direction==='recharge'?2:4,amount,'2026-09-29T01:00:00-03:00',direction==='recharge'?'2026-09-29T01:05:00-03:00':null,{provider:'RangePay'});
});
after(async()=>{await native?.db.close();await wg?.db.close();});

test('four native sources enforce lower-inclusive upper-exclusive amounts in full and compact aggregates',async()=>{
  for(const source of ['game66','ar','newar','lg'])for(const direction of ['charge','withdraw'])for(const view of ['full','providers']){
    const q=native.request(source,{direction,view,providers:['SelectedPay'],amountMin:200,amountMax:250,amountMaxExclusive:true,amountBands:native.bands});
    const r=await native.call(q),s=r.summary[0];
    assert.equal(s.all_count,2,source+'/'+direction+'/'+view);assert.equal(Number(s.all_amount),400.01);
    assert.equal(s.success_count,2);assert.equal(Number(s.success_amount),400.01);
    assert.equal(r.groups.provider.reduce((n,x)=>n+x.all_count,0),2);
    if(view==='full')for(const kind of ['daily','hourly','matrix','matrix_range','amount','amount_range'])
      assert.equal(r.groups[kind].reduce((n,x)=>n+x.all_count,0),2,source+'/'+kind);
  }
});
test('WG shares the same strict bound in both directions without inventing withdrawal success time',async()=>{
  for(const direction of ['charge','withdraw'])for(const view of ['full','providers']){
    const r=await wg.call(wg.req({direction,view,providers:['RangePay'],amountMin:'200',amountMax:'250',amountMaxExclusive:true})),s=r.summary[0];
    assert.equal(s.all_count,2);assert.equal(Number(s.all_amount),449.9999);
    assert.equal(s.success_count,direction==='charge'?2:null);assert.equal(s.success_amount,direction==='charge'?'449.9999':null);
    if(view==='full')assert.equal(r.groups.hourly.reduce((n,x)=>n+x.all_count,0),2);
  }
});
test('omitted and explicit false retain inclusive upper bounds and exact-equality filters',async()=>{
  assert.deepEqual(stable(await native.call(native.request('newar',{amountMin:200,amountMax:250}))),stable(legacy));
  for(const source of ['game66','ar','newar','lg'])for(const flag of [{},{amountMaxExclusive:false}]){
    const r=await native.call(native.request(source,{direction:'charge',providers:['SelectedPay'],amountMin:200,amountMax:250,...flag}));
    assert.equal(r.summary[0].all_count,3);assert.equal(r.summary[0].success_count,2,'250 was created today but succeeded tomorrow');
    assert.equal((await native.call(native.request(source,{amountMin:200,amountMax:200,...flag}))).summary.every(x=>x.all_count===1),true);
  }
  const r=await wg.call(wg.req({providers:['RangePay'],amountMin:200,amountMax:250,amountMaxExclusive:false}));assert.equal(r.summary[0].all_count,3);
});
test('numeric precision is preserved rather than approximating an exclusive bound with an epsilon',async()=>{
  await native.db.exec('begin');try{
    for(const [i,value] of ['200','249.999999999999999999','250'].entries())await native.add('newar','charge','PRECISE-'+i,value,{provider:'PrecisePay'});
    const r=await native.call(native.request('newar',{direction:'charge',providers:['PrecisePay'],amountMin:'200',amountMax:'250',amountMaxExclusive:true}));
    assert.equal(r.summary[0].all_count,2);assert.equal(r.summary[0].all_amount,'449.999999999999999999');
    assert.equal(r.summary[0].success_amount,'449.999999999999999999');
  }finally{await native.db.exec('rollback');}
});
test('success-time cross-day and currency/status/provider filters still define the selected facts',async()=>{
  await native.db.exec('begin');try{
    await native.add('newar','charge','RANGE-CROSS-IN',220,{provider:'BoundaryPay',created:'2026-09-18 23:59',success:'2026-09-19 00:01'});
    await native.add('newar','charge','RANGE-CROSS-OUT',210,{provider:'BoundaryPay',created:'2026-09-19 23:59',success:'2026-09-20 00:01'});
    await native.add('newar','charge','RANGE-CROSS-MAX',250,{provider:'BoundaryPay',created:'2026-09-18 23:59',success:'2026-09-19 00:01'});
    const q=native.request('newar',{direction:'charge',currency:'INR',providers:['BoundaryPay'],amountMin:200,amountMax:250,amountMaxExclusive:true});
    const r=await native.call(q);assert.equal(r.summary[0].all_count,1);assert.equal(r.summary[0].all_amount,'210');assert.equal(r.summary[0].success_count,1);assert.equal(r.summary[0].success_amount,'220');
    const success=await native.call({...q,status:'success'});assert.equal(success.summary[0].success_count,1);assert.equal(success.summary[0].success_amount,'220');
    for(const filter of [{providers:['Absent']},{currency:'USD'},{channelTypes:['NotBANK']},{status:'pending'}])assert.equal((await native.call({...q,...filter})).summary.length,0);
  }finally{await native.db.exec('rollback');}
});
test('upper-only and lower-only queries remain valid without silently converting missing amounts to zero',async()=>{
  const upper=await native.call(native.request('newar',{direction:'charge',providers:['SelectedPay'],amountMax:200,amountMaxExclusive:true}));
  assert.equal(upper.summary[0].all_count,5);assert.equal(upper.summary[0].missing_amount_count,0);
  const lower=await native.call(native.request('newar',{direction:'charge',providers:['SelectedPay'],amountMin:50000}));
  assert.equal(lower.summary[0].all_count,2);
});
test('zero is a real inclusive lower bound and an excluded upper bound',async()=>{
  const q=native.request('newar',{direction:'charge',providers:['SelectedPay']});
  const low=await native.call({...q,amountMin:0,amountMax:100,amountMaxExclusive:true});
  assert.equal(low.summary[0].all_count,2);assert.equal(low.summary[0].all_amount,'99.99');
  const upper=await native.call({...q,amountMax:0,amountMaxExclusive:true});
  assert.equal(upper.summary[0].all_count,1);assert.equal(upper.summary[0].all_amount,'-1','retain the pre-existing negative correction fact, exclude zero');
  const exact=await native.call({...q,amountMin:0,amountMax:0,amountMaxExclusive:false});
  assert.equal(exact.summary[0].all_count,1);assert.equal(exact.summary[0].all_amount,'0');
  await assert.rejects(native.call({...q,amountMin:0,amountMax:0,amountMaxExclusive:true}),/invalid_range/);
});
test('malformed flags, missing bounds, empty half-open ranges and unsupported actions fail explicitly',async()=>{
  for(const f of [native,wg]){
    const q=f.request?f.request():f.req();
    for(const amountMaxExclusive of [null,'true','false',1,0,{},[]])await assert.rejects(f.call({...q,amountMax:250,amountMaxExclusive}),/invalid_amount_max_exclusive/);
    for(const amountMax of [undefined,null,''])for(const amountMaxExclusive of [false,true])await assert.rejects(f.call({...q,amountMax,amountMaxExclusive}),/invalid_amount_max_exclusive/);
    for(const amountMin of [250,251])await assert.rejects(f.call({...q,amountMin,amountMax:250,amountMaxExclusive:true}),/invalid_range/);
    for(const amountMax of ['NaN','Infinity','-Infinity'])await assert.rejects(f.call({...q,amountMax,amountMaxExclusive:true}),/invalid_range/);
    for(const amountMax of [true,{},[]])await assert.rejects(f.call({...q,amountMax,amountMaxExclusive:true}),/invalid_filter/);
    for(const action of ['query','details'])await assert.rejects(f.call({...q,action,amountMax:250,amountMaxExclusive:false}),/invalid_amount_max_exclusive/);
  }
  await assert.rejects(native.drill({...native.request(),kind:'hourly',hour:1,amountMax:250,amountMaxExclusive:true}),/invalid_request/);
});
test('source permissions remain enforced and metadata is unchanged',async()=>{
  assert.deepEqual(await Promise.all([meta(native.db),meta(wg.db)]),aclBefore);
  await native.as('10000000-0000-0000-0000-000000000002');
  try{await assert.rejects(native.call(native.request('newar',{amountMax:250,amountMaxExclusive:true})),/platform_denied/);}finally{await native.as('10000000-0000-0000-0000-000000000001');}
  await wg.as('');try{await assert.rejects(wg.call(wg.req({amountMax:250,amountMaxExclusive:true})),/login_required/);}finally{await wg.as('10000000-0000-0000-0000-000000000001');}
});
test('the patch is idempotent and refuses incomplete installed predicates',async()=>{
  const prior=await body(wg.db);await wg.db.exec(patch);assert.equal(await body(wg.db),prior);
  await wg.db.exec('begin');try{
    const def=(await wg.db.query("select pg_get_functiondef('private.dashboard_admin_live_query_raw(jsonb)'::regprocedure) d")).rows[0].d;
    await wg.db.exec(def.replace('case when $31 then amount<$16 else amount<=$16 end','amount<=$16'));
    await assert.rejects(wg.db.exec(patch),/exclusive_amount_installation_incomplete/);
  }finally{await wg.db.exec('rollback');}
});
