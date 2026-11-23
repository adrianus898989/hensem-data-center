// Run the actual private reader, public role wrapper and native selectors in an isolated PostgreSQL.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const existing = path.join(__dirname, 'prepared-ready-shared-pages.test.cjs');
const source = fs.readFileSync(existing, 'utf8');
let boot, reset, close, db;
const realRequire = createRequire(existing);
const sandbox = {
  require(name) {
    if (name === 'node:test') return {
      test: () => {}, before: fn => { boot = fn; }, beforeEach: fn => { reset = fn; }, after: fn => { close = fn; }
    };
    return realRequire(name);
  },
  __dirname, process, console, structuredClone, AbortController, DOMException, setTimeout, clearTimeout, queueMicrotask
};
vm.runInNewContext(source.slice(0, source.indexOf("for(const page of ['teamops'")) +
  ';globalThis.fixture = {e, full, scalar, createdMaster, getDB: () => db};', sandbox);
const { e, full, scalar, createdMaster, getDB } = sandbox.fixture;
const maintenance = path.resolve(__dirname, '../supabase/maintenance');
const install = fs.readFileSync(path.join(maintenance, 'prepared-amount-ready.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(maintenance, 'prepared-amount-ready.rollback.sql'), 'utf8');
const baseline = fs.readFileSync(path.join(__dirname, 'fixtures/prepared-amount-ready/ready-reader.before.sql'), 'utf8');
const bands = {
  charge: [100, 200, 300, 400, 500, 1000, 2000, 5000, 10000, 20000, 50000],
  withdraw: [50, 150, 250, 350, 550, 1500, 2500, 5500, 15000, 25000, 55000]
};
const provider = 'CedarPayINR';
const current = (i = 1, extra = {}) => ({...full(i), currency: 'INR', providers: [provider], amountBands: bands, ...extra});
const prior = (i = 1) => {
  const q = current(i, { view: 'providers' });
  delete q.amountBands;
  delete q.durationVersion;
  return q;
};
function read(requests, {page = 'amount', ready = true, profile = 'amount-v1', extra = {}} = {}) {
  const body = {requests, publicationVersion: 2, ...extra};
  if (ready) body.readMode = 'ready-only-v1';
  if (profile !== null) body.responseProfile = profile;
  return scalar('select public.dashboard_admin_aggregate_prepared($1,$2)', [page, JSON.stringify(body)]);
}
async function seed(i, {allProviders = false, empty = false} = {}) {
  await createdMaster(i);
  const t = e.f.target(i);
  const filters = {currency: 'INR', amountBands: bands};
  if (!allProviders) filters.providers = [provider];
  const fact = e.f.row(provider, 'withdraw', {bucket: 2, all_count: 526, created_success_count: 3, success_count: 3});
  const data = empty ? [] : [fact];
  await db.query("update private.prepared_aggregate_jobs set request=request||$1::jsonb where target->>'id'=$2", [JSON.stringify(filters), t.id]);
  await db.exec('update private.prepared_aggregate_jobs set request_key=private.prepared_aggregate_key(request,target);update private.prepared_aggregate_jobs set request_fingerprint=md5(request_key::text)');
  const groups = {amount: data, amount_range: data, provider: data};
  const metadata = {amountBands: bands, amountBandsVersion: 1, summary: data, total: empty ? 0 : 526, hasMore: !empty};
  await db.query("update private.prepared_aggregate_artifacts a set payload=jsonb_set(payload||$1::jsonb,'{groups}',(payload->'groups')||$2::jsonb) from private.prepared_aggregate_jobs j where j.id=a.job_id and j.target->>'id'=$3",
    [JSON.stringify(metadata), JSON.stringify(groups), t.id]);
}
before(async () => {
  await boot();
  db = getDB();
  await db.exec(baseline);
  await db.exec(install);
});
beforeEach(async () => { await reset(); });
after(async () => { if (db) await close(); });

test('exact provider and custom amount bands have identical compact financial and publication facts', async () => {
  await seed(1);
  const q = current();
  const ordinary = await read([q], {ready:false});
  const before = await e.snapshot();
  const actual = await read([q]);
  assert.equal(actual.items[0].status, 'ready');
  assert.deepEqual(actual.items, ordinary.items);
  const {result, resultGroups, publication} = actual.items[0];
  assert.deepEqual(resultGroups.groups, ['amount', 'amount_range', 'provider']);
  assert.deepEqual(result.amountBands, bands);
  assert.equal(result.groups.amount_range[0].created_success_count, 3);
  assert.equal(result.groups.provider[0].all_amount, '9007199254740993.123456789012345678');
  assert.equal(result.hasMore, true);
  assert.equal(publication.calculationComplete, true);
  assert.equal(publication.sourceComplete, false);
  assert.equal(publication.generation, '1:7');
  assert.deepEqual(await e.snapshot(), before);
});

test('mixed exact, known empty and missing keep input order without writing; only ordinary miss admits work', async () => {
  await seed(1); await seed(2, {empty:true});
  const before = await e.snapshot();
  const actual = await read([current(2), current(3), current(1)]);
  assert.deepEqual(actual.items.map(i => i.status), ['ready','miss','ready']);
  assert.deepEqual(actual.items.map(i => i.request), [current(2),current(3),current(1)]);
  assert.deepEqual(actual.items[0].result.groups.amount_range, []);
  assert.equal(actual.items[0].result.total, 0);
  assert.equal(actual.items[1].result, null);
  assert.deepEqual(await e.snapshot(), before);
  await read([current(3)], {ready:false});
  assert.equal(await scalar('select count(*)::int from private.fixture_calls'), 1);
  assert.equal(await scalar("select request ?| array['responseProfile','readMode'] from private.fixture_calls"), false);
});

test('provider comparison uses ordinary native provider projection; no full result marker', async () => {
  await seed(1, {allProviders:true});
  const q = prior();
  const ordinary = await read([q], {ready:false, profile:null});
  const before = await e.snapshot();
  const actual = await read([q], {profile:null});
  assert.equal(actual.items[0].status,'ready');
  assert.equal(Object.hasOwn(actual.items[0],'resultGroups'), false);
  assert.deepEqual(actual.items, ordinary.items);
  assert.deepEqual(await e.snapshot(), before);
});

test('a different provider, currency, boundary or status cannot borrow a full publication', async () => {
  await seed(1);
  const before = await e.snapshot();
  const changed = {...bands, withdraw: bands.withdraw.map(n => n+1)};
  for (const patch of [{providers:['CedarPay']}, {providers:[provider,'CedarPay']}, {currency:'USD'}, {status:'pending'}, {amountBands:changed}, {amountMin:'5'}, {successBasis:'success'}, {endAt:'2020-01-03T18:30:00Z'}, {startAt:'2099-01-02T18:30:00Z',endAt:'2099-01-03T18:30:00Z'}]) {
    assert.equal((await read([current(1, patch)])).items[0].status,'miss',JSON.stringify(patch));
  }
  const nonLocal = current(1, {startAt:'2020-01-02T00:00:00Z', endAt:'2020-01-03T00:00:00Z'});
  assert.equal((await read([nonLocal])).items[0].status,'miss');
  assert.deepEqual(await e.snapshot(), before);
});

test('native team country limits even matching INR target; mixed access denied as a whole', async () => {
  await seed(1);
  await db.exec("update private.fixture_targets set country='香港'");
  assert.equal((await read([current()])).items[0].reason,'ready_query_not_supported');
  await db.exec("update private.fixture_targets set country='印度'");
  const before = await e.snapshot();
  await assert.rejects(read([current(),current(99)]), {code:'42501'});
  await e.f.auth('assigned',{permissions:['amount.view']});
  await assert.rejects(read([current()]), {code:'42501'});
  await e.f.auth('assigned',{permissions:['amount.view','amount.query']});
  assert.equal((await read([current()])).items[0].status,'ready');
  await db.exec("select set_config('test.context_valid','false',false)");
  await assert.rejects(read([current()]), {code:'42501'});
  assert.deepEqual(await e.snapshot(),before);
});

test('profile routes, 20-target limit and unsupported clocks reject invalid requests without admission', async () => {
  const before = await e.snapshot();
  const invalid = [
    read.bind(null,[current()], {page:'time'}),
    read.bind(null,[current()], {profile:'time-v1'}),
    read.bind(null,[prior()], {profile:'amount-v1'}),
    read.bind(null,[current()], {profile:null}),
    read.bind(null,[current()], {extra:{forceRefresh:true}}),
    read.bind(null,[current(1,{successStartAt:current().startAt,successEndAt:current().endAt})]),
    read.bind(null,Array.from({length:21},(_,i) => current(i+1)))
  ];
  for(const call of invalid) await assert.rejects(call(), {code:'22023'});
  assert.deepEqual(await e.snapshot(),before);
});

test('missing required custom band group fails explicitly, never invents zeroes', async () => {
  await seed(1);
  await db.exec("update private.prepared_aggregate_artifacts set payload=jsonb_set(payload,'{groups}',(payload->'groups')-'amount_range')");
  await assert.rejects(read([current()]), {code:'22023'});
});

test('a request without custom edges has the ordinary two-group shape', async () => {
  await seed(1);
  const q = current(); delete q.amountBands;
  const expected = await read([q], {ready:false});
  const actual = await read([q]);
  assert.equal(actual.items[0].status,'ready');
  assert.deepEqual(actual.items,expected.items);
  assert.deepEqual(actual.items[0].resultGroups.groups,['amount','provider']);
  assert.equal(Object.hasOwn(actual.items[0].result,'amountBands'),false);
});

test('omitted view and durationVersion reuse the v2 master with default-version ordinary semantics', async () => {
  await seed(1);
  const q = current(); delete q.view; delete q.durationVersion;
  const ordinary = await read([q], {ready:false});
  const before = await e.snapshot();
  const actual = await read([q]);
  assert.equal(actual.items[0].status,'ready');
  assert.deepEqual(actual.items,ordinary.items);
  assert.equal(Object.hasOwn(actual.items[0].result,'durationVersion'),false);
  assert.deepEqual(await e.snapshot(),before);
});

test('a legacy full head with no v2 key cannot satisfy the same amount request', async () => {
  await seed(1);
  await db.exec("update private.prepared_aggregate_jobs set request=request-'durationVersion';update private.prepared_aggregate_jobs set request_key=private.prepared_aggregate_key(request,target);update private.prepared_aggregate_jobs set request_fingerprint=md5(request_key::text)");
  const q = current(); delete q.durationVersion;
  const before = await e.snapshot();
  assert.equal((await read([q])).items[0].status,'miss');
  assert.deepEqual(await e.snapshot(),before);
});

test('20 targets match the ordinary reader individually with four nonempty publications and sixteen published zeroes', async () => {
  const requests = [];
  for (let i=1; i<=20; i++) {
    if (i>3) await db.query('insert into private.fixture_targets select *from jsonb_populate_record(null::private.fixture_targets,$1)',[JSON.stringify(e.f.target(i))]);
    await seed(i,{empty:i>4});
    const q = current(i); delete q.durationVersion;
    requests.push(q);
  }
  const expected = [];
  for (const q of requests) expected.push((await read([q],{ready:false})).items[0]);
  const before = await e.snapshot();
  const actual = await read(requests);
  assert.deepEqual(actual.items,expected);
  assert.equal(actual.items.filter(i => i.status==='ready' && i.result.total===0).length,16);
  assert.equal(actual.items.filter(i => i.status==='ready' && i.result.hasMore).length,4);
  assert.deepEqual(await e.snapshot(),before);
});

test('guarded rollback restores the exact previous definition and private ACL; existing pages match',async () => {
  await createdMaster();
  const oldPage = () => read([full()], {page:'time', profile:'time-v1'});
  const afterInstall = await oldPage();
  await db.exec(rollback);
  const oldHash = await scalar("select md5(pg_get_functiondef('private.dashboard_serving_ready_read(text,jsonb)'::regprocedure))");
  assert.equal(oldHash, '58805b3f199b0226850abc73efe162f2');
  assert.deepEqual((await oldPage()).items,afterInstall.items);
  await assert.rejects(read([current()]), {code:'22023'});
  await db.exec(install);
  for (const role of ['anon','authenticated','service_role']) {
    assert.equal(await scalar("select has_function_privilege($1,'private.dashboard_serving_ready_read(text,jsonb)','execute')",[role]),false);
  }
});

require('node:test').describe('single-provider comparison uses native-platform alias selection', () => {
  const installSubset = fs.readFileSync(path.join(maintenance, 'prepared-amount-provider-subset.sql'),'utf8');
  const undoSubset = fs.readFileSync(path.join(maintenance, 'prepared-amount-provider-subset.rollback.sql'),'utf8');
  let exactResolver;
  before(async () => {
    const original = await scalar("select pg_get_functiondef('private.dashboard_serving_ready_read(text,jsonb)'::regprocedure)");
    await db.exec(original.replace('private.dashboard_serving_ready_read(', 'private.fixture_before_amount_subset('));
    await db.exec('drop function private.dashboard_admin_live_provider_canonical(text,text,text)');
    // A table with the same unique native key permits inserting synthetic mappings.
    const native = fs.readFileSync(path.join(__dirname,'fixtures/deposit-recovery-provider-batch-dependencies.sql'),'utf8')
      .replace('create materialized view private.dashboard_admin_provider_registry','create table private.dashboard_admin_provider_registry');
    await db.exec(native);
    const projection = fs.readFileSync(path.join(__dirname,'fixtures/prepared-interactive-refresh/fixtures/dashboard_prepared_provider_projection.sql'),'utf8');
    await db.exec(projection);
    await db.exec('revoke all on function private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role');
    exactResolver = await scalar("select pg_get_functiondef('private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure)");
    await db.exec(installSubset);
  });
  beforeEach(async () => {
    await db.exec('truncate private.dashboard_admin_provider_registry,private.dashboard_admin_provider_overrides');
  });
  const baselineRead = qs => scalar('select private.fixture_before_amount_subset($1,$2)',['amount',JSON.stringify({readMode:'ready-only-v1',publicationVersion:2,requests:qs})]);
  const currentRead = qs => read(qs,{profile:null});
  const query = (i,label,direction='all') => ({...prior(i), providers:[label],direction});
  async function fixture(i, leaves, rename) {
    await seed(i,{allProviders:true});
    const normal = e.f.target(i);
    const target = rename ? {...normal,name:rename,source_name:rename} : normal;
    if (rename) {
      await db.query('update private.fixture_targets set name=$1,source_name=$1 where id=$2',[rename,normal.id]);
      await db.query("update private.prepared_aggregate_jobs set target=$1 where target->>'id'=$2",[JSON.stringify(target),normal.id]);
      await db.exec('update private.prepared_aggregate_jobs set request_key=private.prepared_aggregate_key(request,target);update private.prepared_aggregate_jobs set request_fingerprint=md5(request_key::text)');
    }
    await db.query("update private.prepared_aggregate_artifacts a set payload=jsonb_set(jsonb_set(payload,'{platform}',(payload->'platform')||jsonb_build_object('name',$1::text,'sourceName',$1::text)),'{groups,provider}',$2::jsonb) from private.prepared_aggregate_jobs j where j.id=a.job_id and j.target->>'id'=$3",
      [target.source_name,JSON.stringify(leaves),normal.id]);
  }
  const leaf = (name, dir='withdraw', extra={}) => e.f.row(name,dir,extra);
  const registry = (platform,raw,values) => db.query('insert into private.dashboard_admin_provider_registry(country,platform,raw_provider,canonical_values)values($1,$2,$3,$4)',['印度',platform,raw,values]);
  const override = (platform,raw,name) => db.query('insert into private.dashboard_admin_provider_overrides values($1,$2,$3,$4,1,now(),gen_random_uuid())',['印度',platform,raw,name]);
  async function equal(qs) {
    const expected = await baselineRead(qs);
    const state = await e.snapshot();
    const result = await currentRead(qs);
    assert.deepEqual(result,expected);
    assert.deepEqual(await e.snapshot(),state);
    return result.items;
  }
  test('native aliases are not shared across platforms and every matched leaf, duplicate, clock and amount is preserved',async () => {
    const names = [leaf('CedarPay'),leaf('CedarPayINR'),leaf('raw-one'),leaf('raw-one','charge'),leaf('raw-one'),leaf('raw-many'),leaf('force'),leaf('unrelated')];
    await fixture(1,names); await fixture(2,names);
    await registry('PLATFORM-1','raw-one',['CedarPayINR']); await registry('PLATFORM-2','raw-one',['Different']);
    await registry('PLATFORM-1','raw-many',['A','B']); await registry('PLATFORM-1','force',['Different']);
    await override('PLATFORM-1','force','CedarPayINR');
    const items = await equal([query(1,'CedarPayINR'),query(2,'CedarPayINR')]);
    const names1 = items[0].result.groups.provider.map(x=>x.provider);
    assert.equal(names1.filter(n=>n==='raw-one').length,3);
    assert.ok(names1.includes('force'));
    assert.ok(!names1.includes('raw-many'));
    assert.ok(!items[1].result.groups.provider.some(x=>x.provider==='raw-one'));
    await equal([query(1,'CedarPayINR','withdraw'),query(2,'raw-many','charge')]);
    await equal([query(1,'No such provider')]);
  });
  test('YASH WinPay native exception and its owner override both match the previous projector',async () => {
    const names = [leaf('WinPay'),leaf('NewWinPay'),leaf('CedarPayINR'),leaf('other')];
    await fixture(1,names,'YASH.BET');
    let items = await equal([query(1,'NewWinPay')]);
    assert.ok(items[0].result.groups.provider.some(r=>r.provider==='WinPay'));
    await override('YASH.BET','WinPay','TestOverride');
    items = await equal([query(1,'TestOverride')]);
    assert.ok(items[0].result.groups.provider.some(r=>r.provider==='WinPay'));
  });
  test('empty, tiny and multi-provider inputs retain the previous semantics, including malformed unrelated leaves',async () => {
    await fixture(1,[]); await fixture(2,[leaf('CedarPayINR')]);
    await equal([query(1,'CedarPayINR'),query(2,'CedarPayINR')]);
    await fixture(3,[leaf('CedarPayINR'),leaf('CedarPay'),leaf('unrelated'),leaf('other')]);
    await equal([{...query(3,'CedarPayINR'),providers:['CedarPayINR','CedarPay']}]);
    await db.exec("update private.prepared_aggregate_artifacts set payload=jsonb_set(payload,'{groups,provider,3,direction}','null') where jsonb_array_length(payload#>'{groups,provider}')=4");
    await assert.rejects(baselineRead([query(3,'CedarPayINR')]), {code:'22023'});
    await assert.rejects(currentRead([query(3,'CedarPayINR')]), {code:'22023'});
  });
  test('provider-only heads preserve zero totals, null monetary evidence and unrelated native payload members',async () => {
    const leaves=[leaf('CedarPayINR','withdraw',{all_count:0,all_amount:null,success_amount:null,fee_unpriced_count:0,created_success_count:0}),leaf('CedarPayINR','charge',{all_count:0,all_amount:'0'}),leaf('CedarPay'),leaf('other')];
    await fixture(1,leaves);
    await db.exec(`update private.prepared_aggregate_jobs set request=(request-array['amountBands','durationVersion'])||'{"view":"providers"}'::jsonb;
      update private.prepared_aggregate_jobs set request_key=private.prepared_aggregate_key(request,target);
      update private.prepared_aggregate_jobs set request_fingerprint=md5(request_key::text);
      update private.prepared_aggregate_artifacts set payload=(payload-array['amountBands','amountBandsVersion','durationVersion'])
       ||jsonb_build_object('groups',jsonb_build_object('provider',payload#>'{groups,provider}'),'customNativeEvidence','{"status":"pending","cutoff":null}'::jsonb)`);
    const [item]=await equal([query(1,'CedarPayINR','withdraw')]);
    assert.equal(item.status,'ready');
    assert.deepEqual(item.result.customNativeEvidence,{status:'pending',cutoff:null});
    assert.equal(item.result.groups.provider[0].all_amount,null);
    assert.equal(item.result.total,0);
    assert.equal(item.publication.sourceComplete,false);
  });
  test('a changed native classifier automatically falls back, preserving newly classified labels',async () => {
    await fixture(1,[leaf('new-label'),leaf('CedarPayINR'),leaf('old-label'),leaf('other')]);
    try {
      await db.exec("create or replace function private.dashboard_admin_live_provider_canonical(p_country text,p_platform text,p_raw text) returns text language sql stable security definer set search_path='' as $$select case when p_raw='new-label' then 'CedarPayINR' else p_raw end$$");
      const items = await equal([query(1,'CedarPayINR')]);
      assert.ok(items[0].result.groups.provider.some(x=>x.provider==='new-label'));
    } finally { await db.exec(exactResolver); }
  });
  test('the independent rollback restores the deployed batch reader and ACL exactly',async () => {
    await db.exec(undoSubset);
    assert.equal(await scalar("select md5(pg_get_functiondef('private.dashboard_serving_ready_read(text,jsonb)'::regprocedure))"),'a556549c122d06bc0c4a92a9a795aafc');
    await db.exec(installSubset);
    for (const role of ['anon','authenticated','service_role']) assert.equal(await scalar("select has_function_privilege($1,'private.dashboard_serving_ready_read(text,jsonb)','execute')",[role]),false);
  });
});
