const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {createRequire} = require('node:module');

const root = path.join(__dirname, '..');
const sourcePath = process.env.PROVIDER_HOUR_BASELINE || path.join(root, 'supabase/created-cohort/dashboard_admin_live_drilldown_raw.sql');
const productionHash = 'bf64643fc384bd0679c29e6b69601599';
const productionCandidate = '120a5932b5302ff9fab97d5440023672';
const repositoryHash = '7c1475c6487837c5e9d6d9df7fef2fef';
const repositoryCandidate = 'b61e66375f06ecc351c5e6b97cf0399c';
const read = name => fs.readFileSync(name,'utf8');
const migration = read(path.join(root,'supabase/migrations/20261112121500_provider_hour_drilldown.sql'));
const fullHour = {view:'drilldown',kind:'custom',hourRange:{minHour:0,maxHour:24},direction:'charge'};
const marker = {providerHourMatrix:true};
let fixture, db, ordinaryBefore, installed, originalAcl;
const liveOid = "'private.dashboard_admin_live_drilldown_raw(jsonb)'::regprocedure";
async function scalar(sql) {return Object.values((await db.query(sql)).rows[0])[0];}
const scope = extra => fixture.request('newar',{...fullHour,...extra});
const drill = extra => fixture.drill(scope(extra));
const stable = x => {const y=structuredClone(x); delete y.asOf; return y;};

before(async()=>{
  // Use the repository's existing native clock, role and source-table fixture.
  const filename = path.join(__dirname,'admin-duration-precision-ranges.test.cjs');
  let initialize;
  const context = vm.createContext({__dirname,process,console,structuredClone,require:n=>
    n==='node:test'?{test(){},before:fn=>initialize=fn,after(){}}:createRequire(filename)(n)});
  vm.runInContext(read(filename)+'\nglobalThis.hourFixture={get db(){return db},request,drill,as,add,acl};',context,{filename});
  await initialize(); fixture=context.hourFixture; db=fixture.db;
  const source = read(sourcePath).match(/create or replace function private\.dashboard_admin_live_drilldown_raw\(p_request jsonb\)[\s\S]*?AS \$function\$[\s\S]*?\$function\$;?/i);
  assert.ok(source); await db.exec(source[0]);
  await db.exec("create or replace function private.dashboard_admin_order_business_result(j jsonb,text,text,text,uuid) returns jsonb language sql immutable as $$select j$$");
  await db.exec('delete from newar_detail_records');
  const add = (id,amount,attrs) => fixture.add('newar','charge',id,amount,attrs);
  await add('first',10,{provider:'PrecisionAlias',created:'2026-09-19 01:00',success:'2026-09-19 02:00'});
  await add('second',20,{provider:'PrecisionPay',created:'2026-09-19 01:04',success:null,status:'pending'});
  await add('third',9,{provider:'Other',created:'2026-09-19 02:04',success:'2026-09-21 01:04'});
  await add('missing-amount',null,{provider:'Other',created:'2026-09-19 09:00',success:null});
  await add('prior-creation',5,{provider:'Other',created:'2026-09-18 23:59',success:'2026-09-19 04:00'});
  ordinaryBefore=stable(await drill({successBasis:'created'}));
  originalAcl=await fixture.acl();
  const hash=await scalar('select md5(prosrc) from pg_proc where oid='+liveOid);
  assert.ok([repositoryHash,productionHash].includes(hash));
  // The migration itself accepts only the exact production body. For the older
  // source tracked in this repo substitute its two independent fingerprints.
  installed=hash===productionHash?migration:migration.replace(productionHash,repositoryHash).replace(productionCandidate,repositoryCandidate);
  await db.exec(installed);
});
after(()=>db?.close());

test('each actual native hour agrees with its existing single-hour drill, for both clocks',async()=>{
  for(const basis of [{successBasis:'created'},{}]){
    const got=await drill({...basis,...marker});
    assert.equal(got.providerHourMatrix,true); assert.equal(got.complete,true); assert.equal(got.hasMore,false);
    assert.equal(got.platform.id,scope().platformId); assert.equal(got.successBasis,basis.successBasis);
    assert.equal(Date.parse(got.startAt),Date.parse(scope().startAt));assert.equal(Date.parse(got.endAt),Date.parse(scope().endAt));
    const normalize=rows=>rows.map(r=>[r.provider||'',r.all_count,r.created_success_count,r.success_count]).sort();
    for(let hour=0;hour<24;hour++){
      const req=scope({...basis,kind:'hourly',hour}); delete req.hourRange;
      const old=await fixture.drill(req);
      assert.deepEqual(normalize(got.groups.provider_hour.filter(r=>r.hour===hour)),normalize(old.groups.provider),'provider hour '+hour);
      assert.deepEqual(normalize(got.groups.hourly.filter(r=>r.hour===hour)),normalize(old.summary),'platform hour '+hour);
    }
    assert.deepEqual(normalize(got.groups.provider),normalize((await drill(basis)).groups.provider));
    assert.deepEqual(normalize(got.summary),normalize((await drill(basis)).summary));
    assert.equal(got.groups.provider_hour.some(r=>r.provider==='PrecisionAlias'),false);
    const unknown=got.groups.provider_hour.find(r=>r.provider==='Other'&&r.hour===9);
    assert.deepEqual(Object.keys(unknown).sort(),["all_count","created_success_count","currency","direction","hour","provider","success_count"].sort());
    assert.equal(unknown.created_success_count,1);
    const paidHour=got.groups.provider_hour.find(r=>r.provider==='PrecisionPay'&&r.hour===(basis.successBasis?1:2));
    assert.equal(paidHour.success_count,1);
    assert.deepEqual(got.rows,[]);
  }
});

test('an ordinary custom drill, authorization, empty groups and installation are independent of the matrix',async()=>{
  assert.deepEqual(stable(await drill({successBasis:'created'})),ordinaryBefore);
  for(const q of [{providerHourMatrix:false},{providerHourMatrix:'true'},{...marker,hourRange:{minHour:1,maxHour:24}},
    {...marker,kind:'hourly',hour:1,hourRange:undefined}])await assert.rejects(drill(q),/invalid_provider_hour_matrix/);
  await db.query("select set_config('hensem.dashboard_role_context',$1,false)",[JSON.stringify({payload:{page:'overview'}})]);
  try{await assert.rejects(drill(marker),/page_action_denied/);}
  finally{await db.exec("reset hensem.dashboard_role_context");}
  await assert.rejects(drill({...marker,platformId:'90000000-0000-0000-0000-000000000022'}),/platform_denied/);
  await fixture.as('');try{await assert.rejects(drill(marker),/login_required/);}finally{await fixture.as('10000000-0000-0000-0000-000000000001');}
  const empty=await drill({...marker,providers:['nonexistent']});
  assert.deepEqual(empty.summary,[]);assert.deepEqual(empty.groups.hourly,[]);assert.deepEqual(empty.groups.provider_hour,[]);
  await db.exec(installed);assert.deepEqual(await fixture.acl(),originalAcl);
});

test('one platform matrix reads the native table once and a rollback restores the exact earlier function',async()=>{
  await db.exec('begin');
  try{
    const definition=await scalar('select pg_get_functiondef('+liveOid+')');
    const planDefinition=definition
      // Only the instrumented function in this rolled-back local test executes EXPLAIN.
      .replace('STABLE SECURITY DEFINER','VOLATILE SECURITY DEFINER')
      .replace('execute v_sql into v_result using',"execute 'explain (analyze,format json) '||v_sql into v_result using")
      .replace("if p_request->>'successBasis'='created'then v_result:=", "return v_result; if p_request->>'successBasis'='created'then v_result:=");
    assert.notEqual(planDefinition,definition); await db.exec(planDefinition);
    const plan=await drill({successBasis:'created',...marker});
    function scanCount(node){
      return (node['Relation Name']==='newar_detail_records'?node['Actual Loops']:0)
        +(node.Plans||[]).reduce((n,child)=>n+scanCount(child),0);
    }
    assert.equal(scanCount(plan[0].Plan),1);
  }finally{await db.exec('rollback');}
  const hash=await scalar('select md5(prosrc) from pg_proc where oid='+liveOid);
  let rollback=read(path.join(root,'supabase/maintenance/provider-hour-drilldown.rollback.sql'));
  if(hash===repositoryCandidate)rollback=rollback.replace(productionHash,repositoryHash).replace(productionCandidate,repositoryCandidate);
  await db.exec(rollback);await db.exec(rollback);
  assert.deepEqual(stable(await drill({successBasis:'created'})),ordinaryBefore);
  await assert.rejects(drill(marker),/invalid_request/);
  assert.deepEqual(await fixture.acl(),originalAcl);
  await db.exec(installed);
});

test('created hourly matrices preserve every AR/NEW_AR output, including optional filters, with a single native grouping',async()=>{
  await db.exec(`alter table ar_collected_orders add column money_format_version smallint, add column amount_local numeric,
    add column currency_local text, add column money_issue_code text;
    create function private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)
      returns numeric language sql immutable as $$ select coalesce($5,$8) $$`);
  const all = {...fullHour, ...marker,direction:'all',currency:'INR',successBasis:'created'};
  const samples=[];
  for(const source of ['ar','newar']){
    for(const criteria of [{}, {direction:'withdraw'}, {providers:['Other']}, {providers:['unobserved']},
        {amountMin:10,amountMax:20,amountMaxExclusive:true}, {amountMax:20},
        {channelTypes:['BANK']}, {orderNumber:'first'}, {providerHourMatrix:undefined},
        {successBasis:undefined}]){
      const query=fixture.request(source,{...all,...criteria});
      samples.push({query,baseline:stable(await fixture.drill(query))});
    }
  }
  const hash=await scalar('select md5(prosrc) from pg_proc where oid='+liveOid);
  const future='eccdf823c61341254a60396ab87735b3';
  const adapt=sql=>hash===repositoryCandidate ? sql.replace(productionCandidate,repositoryCandidate).replace(future,'9682dfc5844a625fb45bd70625889538') : sql;
  const change=adapt(read(path.join(root,'supabase/migrations/20261113065354_provider_hour_created_counts.sql')));
  const undo=adapt(read(path.join(root,'supabase/maintenance/provider-hour-created-counts.rollback.sql')));
  await db.exec(change);await db.exec(change);
  for(const {query,baseline} of samples)assert.deepEqual(stable(await fixture.drill(query)),baseline);
  await db.exec('begin');
  try{
    const definition=await scalar('select pg_get_functiondef('+liveOid+')');
    await db.exec(definition.replace('STABLE SECURITY DEFINER','VOLATILE SECURITY DEFINER')
      .replace('execute v_sql into v_result using',"execute 'explain (analyze,verbose,format json) '||v_sql into v_result using")
      .replace("if p_request->>'successBasis'='created'then v_result:=", "return v_result; if p_request->>'successBasis'='created'then v_result:="));
    for(const source of ['ar','newar']){
      const explain=await fixture.drill(fixture.request(source,all));
      const flatten=node=>[node,...(node.Plans||[]).flatMap(flatten)];
      const plan=flatten(explain[0].Plan);
      const native=plan.filter(p=>p['Relation Name']===(source==='ar'?'ar_collected_orders':'newar_detail_records'));
      // Older AR fixtures contain a second, noncontributing success-window scan.
      const scans=hash===repositoryCandidate&&source==='ar'?2:1;
      assert.equal(native.reduce((n,scan)=>n+scan['Actual Loops'],0),scans);
      assert.equal(plan.some(p=>p['CTE Name']==='orders'),false);
      assert.doesNotMatch(JSON.stringify(plan),/dashboard_admin_ar_local_amount/);
    }
  }finally{await db.exec('rollback');}
  await db.exec(undo);await db.exec(undo);
  assert.equal(await scalar('select md5(prosrc) from pg_proc where oid='+liveOid),hash);
  assert.deepEqual(await fixture.acl(),originalAcl);
});
