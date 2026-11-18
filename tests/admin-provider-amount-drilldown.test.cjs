const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const marker = { providerAmountMatrix: true, kind: 'custom', hourRange: { minHour: 0, maxHour: 24 } };
const bands = {
  charge: [10,20,30,40,50,60,70,80,90,100,110],
  withdraw: [1,2,3,4,5,6,7,8,9,10,11]
};
const buckets = ['below', ...Array.from({length:10}, (_,i) => 'band:'+i), 'above', 'unknown'];
const counts = r => [r.all_count, r.created_success_count, r.success_count];
const rows = items => items.map(r => [r.direction, r.currency, r.provider, ...counts(r)]).sort();
let db, fixture, change, undo, originalAcl, scalar, liveOid;
const drill = q => fixture.drill(q);
const request = (extra={}, source='newar') => fixture.request(source, {currency:'INR', amountBands:bands, ...extra});

before(async () => {
  // Reuse the real schema, synthetic orders and exact previous migration fixture of the hour RPC.
  const filename = path.join(__dirname, 'admin-provider-hour-drilldown.test.cjs');
  let initialize;
  const context = vm.createContext({__dirname, process, console, structuredClone, require: name =>
    name==='node:test' ? {test(){}, before:fn=>initialize=fn, after(){}} : createRequire(filename)(name)});
  vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.setupAmount=()=>({db,fixture,scalar,liveOid});',context,{filename});
  await initialize();
  ({ db, fixture, scalar, liveOid } = context.setupAmount());
  originalAcl = await fixture.acl();
  const production = await scalar('select md5(prosrc) from pg_proc where oid='+liveOid) === '120a5932b5302ff9fab97d5440023672';
  const optimize = read('supabase/migrations/20261113065354_provider_hour_created_counts.sql');
  await db.exec(production ? optimize : optimize.replaceAll('120a5932b5302ff9fab97d5440023672','b61e66375f06ecc351c5e6b97cf0399c').replaceAll('eccdf823c61341254a60396ab87735b3','9682dfc5844a625fb45bd70625889538'));
  if (production) await db.exec(read('supabase/migrations/20261113070929_provider_hour_91club_verified_charge.sql'));
  const adapt = sql => production ? sql : sql.replaceAll('92c9cdc9cc04dd7ca9ba2d7fc2f6c156','9682dfc5844a625fb45bd70625889538').replaceAll('d5c6f989646068bc8ae44e8f9cf7e204','f3c7c3935ae76997403564b09a2de461');
  change = adapt(read('supabase/migrations/20261113134025_provider_amount_matrix_drilldown.sql'));
  undo = adapt(read('supabase/maintenance/provider-amount-matrix.rollback.sql'));
  await db.exec(change);
  await db.exec("alter table ar_collected_orders add column money_format_version smallint, add column amount_local numeric, add column currency_local text, add column money_issue_code text;create function private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric) returns numeric language sql immutable as $$select coalesce($5,$8)$$");
  for (const [i,value] of [null,5,10,20,30,40,50,60,70,80,90,100,110,111,'NaN'].entries()){
    const direction = i%2 ? 'charge' : 'withdraw';
    await fixture.add('newar', direction,'bands-'+i,value,{provider:i%3?'PrecisionAlias':'PrecisionPay',status:i%2?'pending':'success'});
  }
});
after(async () => { await db?.close(); });

test('canonical native provider and merchant bands agree with every ordinary drill on both clocks', async () => {
  for (const source of ['newar','ar','game66','lg']) for (const basis of [{}, {successBasis:'created'}]) {
    const currency = source==='lg'?'PHP':'INR';
    const q = request({ ...basis, currency },source);
    const matrix = await drill({...q,...marker});
    assert.equal(matrix.providerAmountMatrix,true);
    assert.equal(matrix.providerHourMatrix,undefined);
    assert.equal(matrix.complete,true); assert.equal(matrix.hasMore,false);
    assert.deepEqual(matrix.amountBands,bands);
    assert.equal(matrix.platform.id,q.platformId); assert.deepEqual(matrix.rows,[]);
    for(const bucket of buckets){
      const single = await drill({...q,kind:'amount_range',bucket});
      assert.deepEqual(rows(matrix.groups.provider_amount_range.filter(r=>r.bucket===bucket)),rows(single.groups.provider),source+'/'+bucket);
      assert.deepEqual(rows(matrix.groups.amount_range.filter(r=>r.bucket===bucket)),rows(single.summary),source+'/'+bucket);
    }
    const all = await drill({...q,kind:'custom',hourRange:{minHour:0,maxHour:24}});
    assert.deepEqual(rows(matrix.groups.provider),rows(all.groups.provider));
    assert.deepEqual(rows(matrix.summary),rows(all.summary));
    assert.equal(matrix.groups.provider_amount_range.some(r=>r.provider==='PrecisionAlias'),false);
  }
});

test('matrix rejects conflicting dimensions, missing boundaries, denied scopes and non-all denominators', async () => {
  for(const bad of [{providerAmountMatrix:'true'}, {providerHourMatrix:true}, {status:'success'},
    {kind:'amount_range',bucket:'band:0',hourRange:undefined},{amountBands:undefined},{hourRange:{minHour:0,maxHour:23}}]){
    await assert.rejects(drill(request({...marker,...bad})));
  }
  await db.query("select set_config('hensem.dashboard_role_context',$1,false)",[JSON.stringify({payload:{page:'time'}})]);
  try { await assert.rejects(drill(request(marker)),/page_action_denied/); }
  finally { await db.exec("reset hensem.dashboard_role_context"); }
  await assert.rejects(drill(request({...marker,platformId:'90000000-0000-0000-0000-000000000022'})),/platform_denied/);
  await fixture.as('');
  try { await assert.rejects(drill(request(marker)),/login_required/); }
  finally { await fixture.as('10000000-0000-0000-0000-000000000001'); }
  const empty = await drill(request({...marker,providers:['no-match']}));
  assert.deepEqual(empty.summary,[]); assert.deepEqual(empty.groups.provider_amount_range,[]);
});

test('closed creation dates accept a self-consistent native reread after status and provider updates', async () => {
  const runtime = {};
  vm.runInNewContext(read('admin-preview/live-hourly-rate-windows.js'), runtime);
  const verify = runtime.HensemHourlyRateWindows.verifyAmount;
  const q = request({...marker,successBasis:'created'});
  await db.exec('begin');
  try {
    const main = await drill(q);
    assert(Date.parse(main.endAt) < Date.now());
    await db.exec("update newar_detail_records set status_group='success',status_code='success',success_at='2026-09-20T06:00Z',provider='LaterPay' where source_id='second'");
    const latest = await drill(q);
    assert.equal(latest.total,main.total);
    const count = (data,key) => data.summary.reduce((n,row)=>n+Number(row[key]),0);
    assert.equal(count(latest,'all_count'),count(main,'all_count'));
    assert.equal(count(latest,'success_count'),count(main,'success_count')+1);
    assert(latest.groups.provider.some(row=>row.provider==='LaterPay'));
    const confirmed = verify(q,main,latest,{platform:latest.platform,readAt:Date.now()});
    assert.equal(confirmed._matrixReadAt,Date.parse(latest.asOf));
    assert.deepEqual(confirmed.summary,latest.summary);
    assert.notDeepEqual(confirmed.groups.provider,main.groups.provider);
    const broken = structuredClone(latest);
    broken.groups.provider_amount_range[0].all_count++;
    assert.throws(()=>verify(q,main,broken,{platform:latest.platform,readAt:Date.now()}),/未对齐/);
  } finally { await db.exec('rollback'); }
});

test('closed-day four-slice recovery keeps native current-status controls after a stored order changes',async()=>{
  const runtime={};vm.runInNewContext(read('admin-preview/live-hourly-rate-windows.js'),runtime);
  const windows=runtime.HensemHourlyRateWindows,q=request({...marker,successBasis:'created'});
  await db.exec('begin');
  try{
    const main=await drill(q),frozen=structuredClone(main);
    await db.exec("update newar_detail_records set status_group='success',status_code='success',success_at='2026-09-20T06:00Z',provider='LaterPay' where source_id='second'");
    const ranges=windows.closedIndiaDay(q,main,main.platform);assert.equal(ranges.length,4);
    const parts=[];for(const range of ranges)parts.push(await drill(range));
    const combined=windows.combineCreatedDay(q,main,parts,{platform:main.platform,readAt:Date.now()});
    const checked=windows.verifyAmount(q,main,combined,{platform:main.platform,readAt:Date.now()});
    const current=await drill(q),sorted=items=>Array.from(items,r=>JSON.stringify(
      [r.direction,r.currency,r.bucket??null,r.provider??null,...counts(r)])).sort();
    assert.equal(checked.total,current.total);assert.equal(checked.total,main.total);
    assert.deepEqual(sorted(checked.summary),sorted(current.summary));
    for(const key of ['provider','amount_range','provider_amount_range'])
      assert.deepEqual(sorted(checked.groups[key]),sorted(current.groups[key]));
    assert.equal(checked.summary.reduce((n,r)=>n+r.success_count,0),main.summary.reduce((n,r)=>n+r.success_count,0)+1);
    assert.equal(checked._matrixReadWindows.length,4);
    assert.deepEqual(main,frozen);
    const broken=structuredClone(parts);broken[0].groups.provider[0].all_count++;
    assert.throws(()=>windows.combineCreatedDay(q,main,broken),/未对齐/);
  }finally{await db.exec('rollback');}
});

test('amount reader scans once for the created cohort, preserves the hourly result and rolls back exactly', async () => {
  const q = request({...marker,successBasis:'created'});
  await db.exec('begin');
  try {
    const def = await scalar('select pg_get_functiondef('+liveOid+')');
    await db.exec(def.replace('STABLE SECURITY DEFINER','VOLATILE SECURITY DEFINER')
      .replace('execute v_sql into v_result using',"execute 'explain (analyze,format json) '||v_sql into v_result using")
      .replace("if p_request->>'successBasis'='created'then v_result:=","return v_result; if p_request->>'successBasis'='created'then v_result:="));
    const plan = (await drill(q))[0].Plan;
    const scans = n => (n['Relation Name']==='newar_detail_records'?n['Actual Loops']:0)+(n.Plans||[]).reduce((sum,p)=>sum+scans(p),0);
    assert.equal(scans(plan),1);
  } finally { await db.exec('rollback'); }
  const hourQuery = {...q,providerAmountMatrix:undefined,amountBands:undefined,providerHourMatrix:true};
  const before = (await drill(hourQuery)).groups;
  await db.exec(undo); await db.exec(undo);
  assert.deepEqual((await drill(hourQuery)).groups,before);
  await assert.rejects(drill(q),/invalid_request/);
  await db.exec(change); await db.exec(change);
  assert.deepEqual(await fixture.acl(),originalAcl);
});
