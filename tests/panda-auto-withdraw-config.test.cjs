// Independent offline checks. No real credentials, live requests or source edits.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash, randomUUID, webcrypto} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const compile = source => ts.transpileModule(source, {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
const clone = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const box = {exports: {}};
vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'BACKEND_CURRENT/panda-config-contract.ts'), 'utf8')),
  {module: box, exports: box.exports, Intl, Date, TextEncoder});
const {PANDA_FIELDS, validatePandaConfiguration, validatePandaConfigSnapshot} = box.exports;
let checks = 0;
function eq(actual, expected, label) {assert.deepEqual(clone(actual), clone(expected), label); checks++;}
function no(fn, label) {assert.throws(fn, undefined, label); checks++;}
function yes(value, label) {assert.ok(value, label); checks++;}
const supplied = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/panda-supplied-response.json'), 'utf8'));
const raw = supplied.result.data.json;
const values = clone(raw);
for (const field of ['auditGameLimit', 'levelMultiples']) {
  if (typeof values[field] === 'string' && values[field] !== '') values[field] = JSON.parse(values[field]);
}
const configuration = {values, unavailable_fields: []};
function localDay(time, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(time);
  return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key).value).join('-');
}
function fixture(overrides = {}) {
  const now = new Date();
  return {schema_version: 1, source_system: 'PANDA', parser_version: 'panda-config-v1',
    snapshot_id: randomUUID(), country_code: 'BR', platform: 'OFFLINE_PANDA', timezone: 'America/Sao_Paulo',
    observed_at: now.toISOString(), observed_local_date: localDay(now, 'America/Sao_Paulo'),
    configuration: clone(configuration), ...overrides};
}

async function main() {
  eq(Object.keys(raw).length, 26, 'Supplied source has exactly 26 fields');
  eq(Object.keys(PANDA_FIELDS).sort(), Object.keys(raw).sort(), 'Complete source field coverage');
  const checked = clone(validatePandaConfiguration(configuration));
  eq(checked.values, values, 'Decoded values are preserved, without source-data scaling');
  eq(checked.values.autoWithdrawalAmountMix, 1000, 'Raw minimum money unchanged');
  eq(checked.values.autoWithdrawalAmountMax, 199900, 'Raw maximum money unchanged');
  eq(checked.values.orderVolume, raw.orderVolume, 'Nonmoney numeric field is not divided by 100');
  eq(checked.values.autoWithdrawalChannel.length, 4, 'All configured channels retained');
  eq(checked.values.auditGameLimit, JSON.parse(raw.auditGameLimit), 'Nested game rules parsed without loss');
  eq(checked.values.levelMultiples, JSON.parse(raw.levelMultiples), 'Nested empty JSON array stays array');
  const base = fixture();
  eq(validatePandaConfigSnapshot(base).snapshot_id, base.snapshot_id, 'Snapshot ID survives normalization');
  eq(validatePandaConfigSnapshot({...base, observed_at: base.observed_at.replace(/\.\d{3}Z$/, '.123456Z')}).observed_at,
    base.observed_at.replace(/\.\d{3}Z$/, '.123Z'), 'Python UTC microseconds normalize consistently');
  for (const mutate of [
    s => s.source_system = 'AR', s => s.schema_version = 2, s => s.parser_version = 'other',
    s => s.snapshot_id = 'invalid', s => s.country_code = 'BRA', s => s.platform = '',
    s => s.timezone = 'not/a-timezone', s => s.observed_at = '2026-09-11 10:00:00',
    s => s.observed_at = '2010-01-01T00:00:00Z', s => s.observed_at = new Date(Date.now() + 86400000).toISOString(),
    s => s.observed_local_date = '1999-01-01', s => s.raw_response = 'PRIVATE_SOURCE_SENTINEL',
    s => s.token = 'PRIVATE_SOURCE_SENTINEL', s => s.configuration.authorization = 'PRIVATE_SOURCE_SENTINEL',
    s => s.configuration.values.cookie = 'PRIVATE_SOURCE_SENTINEL',
    s => s.configuration.values.withdrawSwitch = 'true', s => s.configuration.values.autoWithdrawalSwitch = null,
    s => s.configuration.values.autoWithdrawalAmountMix = 1.5, s => s.configuration.values.autoWithdrawalAmountMax = -1,
    s => s.configuration.values.orderVolume = Infinity,
    s => s.configuration.values.autoWithdrawalChannel[0].accessToken = 'PRIVATE_SOURCE_SENTINEL',
    s => s.configuration.values.auditGameLimit.limitData[0].platformData[0].session = 'PRIVATE_SOURCE_SENTINEL',
    s => s.configuration.values.auditGameLimit = '{truncated',
    s => s.configuration.values.autoWithdrawalChannel[0].withdrawalChannelId = -1,
    s => s.configuration.values.autoWithdrawalChannel[0].tenantWithdrawTypeName = '<script>PRIVATE</script>',
    s => s.configuration.values.autoRefuseSwitch = 'Bearer PRIVATE_SOURCE_SENTINEL',
    s => s.configuration.values.autoRefuseSwitch = 'X-Config-Key: PRIVATE_SOURCE_SENTINEL',
    s => s.configuration.values.autoRefuseSwitch = 'bad\nheader',
    s => s.configuration.unavailable_fields = ['notAField'],
    s => s.configuration.unavailable_fields = ['orderVolume', 'orderVolume'],
    s => {delete s.configuration.values.orderVolume;},
    s => {delete s.configuration.values.withdrawSwitch; s.configuration.unavailable_fields = ['withdrawSwitch'];},
  ]) {const altered = clone(base); mutate(altered); no(() => validatePandaConfigSnapshot(altered), 'Invalid or credential-bearing payload rejected');}
  for (const key of ['token', 'accessToken', 'refresh_token', 'cookie', 'Password', 'authorization', 'sessionId',
    'fingerprint', 'email', 'account', 'secret', 'header', 'credential']) {
    const altered = clone(base);
    altered.configuration.values.levelMultiples = [{level: 1, nested: {[key]: 'PRIVATE_SOURCE_SENTINEL'}}];
    no(() => validatePandaConfigSnapshot(altered), 'Nested credentials rejected: ' + key);
  }
  const nullable = clone(base);
  nullable.configuration.values.orderVolume = null;
  nullable.configuration.values.autoRefuseSwitch = 'OFF';
  nullable.configuration.values.levelMultiples = '';
  nullable.configuration.values.autoWithdrawalLimitLevel = [];
  eq(validatePandaConfigSnapshot(nullable).configuration.values.orderVolume, null, 'Null stays null');
  eq(validatePandaConfigSnapshot(nullable).configuration.values.levelMultiples, '', 'Empty source string stays empty string');
  const absent = clone(base); delete absent.configuration.values.orderVolume; absent.configuration.unavailable_fields = ['orderVolume'];
  const absentResult = validatePandaConfigSnapshot(absent);
  yes(!Object.hasOwn(absentResult.configuration.values, 'orderVolume'), 'Absent field is not fabricated as 0');
  eq(absentResult.configuration.unavailable_fields, ['orderVolume'], 'Absent field explicitly marked');
  const large = clone(base);
  large.configuration.values.levelMultiples = Array.from({length: 10}, () => Array.from({length: 500}, () => 'x'.repeat(100)));
  no(() => validatePandaConfigSnapshot(large), 'Nested payload exceeding full HTTP body limit rejected');
  const deep = clone(base); deep.configuration.values.levelMultiples = {a:{a:{a:{a:{a:{a:{a:{a:1}}}}}}}};
  no(() => validatePandaConfigSnapshot(deep), 'Excessive nested depth rejected');

  const targets = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/panda-config-targets.json'), 'utf8')).targets;
  eq(targets.length, 54, 'Safe target catalog covers all registered platforms');
  yes(!/token|cookie|password|authorization|login_key|tenant_id|headers/i.test(JSON.stringify(targets)),
    'Safe target catalog contains no source authentication or tenant request identifiers');

  // Run the actual Edge handler against a fetch stub. Every non-DB host fails.
  const key = 'ab'.repeat(32), otherKey = 'cd'.repeat(32), service = 'OFFLINE_SERVICE_KEY';
  const credential = {allowed_targets: ['BR:OFFLINE_PANDA'], expires_at: new Date(Date.now() + 3600000).toISOString()};
  let active = true, expired = false, dbFails = false, handler, posts = [], fetches = [];
  const otherRow = {country_code: 'BR', platform: 'OFFLINE_OTHER', snapshot_id: randomUUID()};
  const allowedRow = {country_code: 'BR', platform: 'OFFLINE_PANDA', snapshot_id: randomUUID()};
  const fakeFetch = async (url, init) => {
    const u = new URL(url); eq(u.hostname, 'offline-db.invalid', 'All handler outbound calls stay on its Supabase DB');
    yes(!url.includes(key), 'Plaintext config key is never in database URL');
    eq(init.headers.Authorization, 'Bearer ' + service, 'Server-only service key used for DB authorization');
    fetches.push(u.pathname);
    if (dbFails) return new Response('{}', {status: 500});
    let result;
    const route = u.pathname.replace('/rest/v1/', '');
    if (route === 'panda_config_credentials') {
      eq(u.searchParams.get('active'), 'eq.true', 'Credential lookup requires active');
      const match = u.searchParams.get('token_hash') === 'eq.' + sha(key);
      result = active && match ? [{...credential, expires_at: expired ? '2000-01-01T00:00:00Z' : credential.expires_at}] : [];
    } else if (route === 'panda_config_targets') {
      result = u.searchParams.get('country_code') === 'eq.BR' && u.searchParams.get('platform') === 'eq.OFFLINE_PANDA'
        ? [{timezone: 'America/Sao_Paulo'}] : [];
    } else if (route === 'panda_config_latest') result = [otherRow, allowedRow];
    else if (route === 'rpc/ingest_panda_config') {
      eq(init.method, 'POST', 'Only own database ingestion is a mutation');
      const payload = JSON.parse(init.body);
      posts.push(payload);
      eq(payload.p_hash, sha(JSON.stringify(payload.p_snapshot.configuration)), 'Canonical configuration hash verified');
      yes(!JSON.stringify(payload).includes('PRIVATE_SOURCE_SENTINEL'), 'Source credentials never reach RPC');
      result = {status: 'accepted', snapshot_id: payload.p_snapshot.snapshot_id, current_snapshot_id: payload.p_snapshot.snapshot_id};
    } else throw new Error('Unexpected outbound route');
    return new Response(JSON.stringify(result), {status: 200});
  };
  const edge = fs.readFileSync(path.join(root, 'BACKEND_CURRENT/panda-auto-withdraw-config-ingest.ts'), 'utf8').replace(/^import[^\n]*\n/, '');
  vm.runInNewContext(compile(edge), {Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://offline-db.invalid':service},serve:fn=>handler=fn},
    validatePandaConfigSnapshot, crypto:webcrypto, TextEncoder, TextDecoder, Uint8Array, URLSearchParams, AbortSignal,
    Date, Request, Response, Error, fetch:fakeFetch});
  async function endpoint(body, token=key, method='POST') {
    const response = await handler(new Request('https://offline-ingest.invalid', {method,
      headers: {'X-Config-Key':token, 'Content-Type':'application/json'},
      ...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}));
    return {status:response.status, cache:response.headers.get('cache-control'), body:await response.json()};
  }
  eq((await endpoint({}, key, 'GET')).status, 405, 'Only POST accepted by own ingestion endpoint');
  for (const token of ['', 'Bearer private', 'AB'.repeat(32), otherKey])
    eq((await endpoint({action:'report'}, token)).status, 401, 'Invalid dedicated key rejected');
  active = false; eq((await endpoint({action:'report'})).status, 401, 'Revoked key rejected'); active = true;
  expired = true; eq((await endpoint({action:'report'})).status, 401, 'Expired key rejected'); expired = false;
  const success = await endpoint({action:'ingest', snapshot:base});
  eq(success.status, 200, 'Real supplied configuration reaches fake database successfully');
  eq(success.body.snapshot_id, base.snapshot_id, 'Receipt corresponds to exact submitted snapshot');
  eq(success.cache, 'no-store', 'Receipts are not browser-cacheable');
  eq(posts.length, 1, 'Exactly one database ingest for valid request');
  eq(posts[0].p_snapshot.configuration.values.autoWithdrawalAmountMax, 199900, 'Raw money reaches database unchanged');
  eq((await endpoint({action:'ingest', snapshot:fixture({platform:'OFFLINE_OTHER'})})).status, 403, 'Cross-platform scope rejected');
  eq((await endpoint({action:'ingest', snapshot:fixture({country_code:'IN'})})).status, 403, 'Cross-country scope rejected');
  const wrongZone = fixture({timezone:'UTC'}); wrongZone.observed_local_date = localDay(Date.parse(wrongZone.observed_at), 'UTC');
  eq((await endpoint({action:'ingest', snapshot:wrongZone})).status, 400, 'Registered target timezone enforced');
  const leaked = clone(base); leaked.configuration.values.levelMultiples = [{cookie:'PRIVATE_SOURCE_SENTINEL'}];
  eq((await endpoint({action:'ingest', snapshot:leaked})).status, 400, 'Nested credentials rejected before RPC');
  eq(posts.length, 1, 'Rejected requests never touch ingest RPC');
  const report = await endpoint({action:'report'});
  eq(report.body.snapshots, [allowedRow], 'Report excludes targets outside credential scope');
  eq((await endpoint({action:'report', platforms:['OFFLINE_OTHER']})).body.snapshots, [], 'Explicit report filter cannot widen scope');
  eq((await endpoint({action:'report', platforms:[4]})).status, 400, 'Malformed platform filter rejected');
  for (const body of [[], null, '{truncated', {action:'delete'}, {action:'ingest'}, 'x'.repeat(262145)])
    eq((await endpoint(body)).status, 400, 'Malformed, unsupported or oversized request rejected');
  dbFails = true;
  const dbError = await endpoint({action:'report'});
  eq(dbError.status, 503, 'Database failure returns retryable non-success');
  eq(dbError.body.error, 'config_sync_failed', 'Database/private details not exposed');
  yes(fetches.every(p=>p.startsWith('/rest/v1/panda_config_')||p==='/rest/v1/rpc/ingest_panda_config'),
    'Existing AR storage and endpoints are never touched');

  // Optional Python-exported cross-language snapshot; must be a safe fixture.
  if (process.env.PANDA_CROSS_FIXTURE) {
    const pythonSnapshot = JSON.parse(fs.readFileSync(process.env.PANDA_CROSS_FIXTURE === '-' ? 0 : process.env.PANDA_CROSS_FIXTURE, 'utf8'));
    const normalized = clone(validatePandaConfigSnapshot(pythonSnapshot));
    eq(normalized.configuration.values, values, 'Python generated snapshot matches all 26 supplied source values');
    yes(!JSON.stringify(normalized).includes('PRIVATE_SOURCE_SENTINEL'), 'Python snapshot excludes source credential sentinel');
  }
  console.log(JSON.stringify({status:'PASS', checks, suppliedFields:Object.keys(raw).length, realNetwork:false, realDatabaseWrites:false}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
