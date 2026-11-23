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
