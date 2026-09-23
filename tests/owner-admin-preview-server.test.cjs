const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'supabase/functions/owner-admin-preview/handler.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(compiled, { module: mod, exports: mod.exports, Request, Response, Headers, URL, URLSearchParams,
  AbortSignal, Uint8Array, TextDecoder, atob, fetch }, { filename: file });
const { createOwnerAdminPreviewHandler, PREVIEW_ORIGIN } = mod.exports;
const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const marker = '<!doctype html><p>PRIVATE_PREVIEW_SENTINEL</p>';
const payloadBase64 = zlib.gzipSync(marker).toString('base64');
const goodProfile = { auth_user_id: userId, active: true, role: 'owner' };
const request = (query = '', headers = {}, method = 'GET', body) => new Request('https://unit.supabase.co/functions/v1/owner-admin-preview' + query, {
  method, body, headers: { origin: PREVIEW_ORIGIN, authorization: 'Bearer test-user-jwt', ...headers },
});
function fixture({ authStatus = 200, auth = { id: userId }, profileStatus = 200, profile = [goodProfile], payload = payloadBase64, failure = false,
  grants = [], grantStatus = 200, target = [{auth_user_id:otherId,role:'viewer',active:true}], accounts = [{...goodProfile,username:'Owner'},
    {auth_user_id:otherId,username:'Viewer',role:'viewer',active:true}], total = accounts.length, grantSaveStatus = 200 } = {}) {
  const calls = [];
  const handler = createOwnerAdminPreviewHandler({ supabaseUrl: 'https://unit.supabase.co', anonKey: 'test-publishable-key', serviceRoleKey:'test-private-service-key', payloadBase64: payload,
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      if (failure) throw Error('UPSTREAM_PRIVATE_BODY_TOKEN');
      const parsed = new URL(url), service = init.headers.apikey === 'test-private-service-key';
      let value = profile, status = profileStatus, extraHeaders = {};
      if (parsed.pathname === '/auth/v1/user') { value = auth; status = authStatus; }
      else if (parsed.pathname.endsWith('/dashboard_profiles') && service) {
        value = parsed.searchParams.has('order') ? accounts : target; status = 200;
        if (parsed.searchParams.has('order')) extraHeaders = {'content-range': '0-' + Math.max(0, accounts.length - 1) + '/' + total};
      } else if (parsed.pathname.endsWith('/dashboard_admin_preview_grants')) {
        value = grants; status = grantStatus;
        if (init.method === 'POST') { const mutation=JSON.parse(init.body); value=[{auth_user_id:mutation.auth_user_id,can_view:mutation.can_view}]; status=grantSaveStatus; }
      }
      return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...extraHeaders } });
    },
  });
  return { handler, calls };
}
async function denied(response, expected) {
  assert.equal(response.status, expected);
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.equal(response.headers.get('content-encoding'), null);
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
  const body = await response.text();
  assert(!body.includes(marker)); assert(!body.includes('PRIVATE_PREVIEW_SENTINEL'));
  assert(!body.includes(payloadBase64)); assert(!body.includes('test-user-jwt'));
  assert(!body.includes('test-private-service-key'));
  assert(!body.includes('UPSTREAM_PRIVATE_BODY_TOKEN'));
}

test('requires bearer even when Origin is absent; rejects malformed credentials without upstream calls', async () => {
  const { handler, calls } = fixture();
  for (const authorization of ['', 'Bearer', 'Bearer a,b', 'Basic xyz', 'Bearer a b']) await denied(await handler(request('', { authorization })), 401);
  await denied(await handler(new Request('https://unit.supabase.co/functions/v1/owner-admin-preview')), 401);
  assert.equal(calls.length, 0);
});
test('Auth failures cannot reach profile or private payload', async () => {
  for (const authStatus of [401, 403]) {
    const { handler, calls } = fixture({ authStatus });
    await denied(await handler(request()), 401); assert.equal(calls.length, 1);
  }
  const { handler } = fixture({ auth: { user_metadata: { role: 'owner' } } });
  await denied(await handler(request()), 401);
});
test('fresh profile requires exactly the verified user and active boolean true', async () => {
  const deniedProfiles = [[], [goodProfile, goodProfile], [{ ...goodProfile, role: 'invented-role' }],
    [{ ...goodProfile, active: false }], [{ ...goodProfile, active: 'true' }], [{ ...goodProfile, auth_user_id: otherId }], [{ active: true, role: 'owner' }]];
  for (const profile of deniedProfiles) {
    const { handler, calls } = fixture({ profile });
    await denied(await handler(request()), 403); assert.equal(calls.length, 2);
  }
  await denied(await fixture({ profileStatus: 403 }).handler(request()), 403);
  await denied(await fixture({ profileStatus: 401 }).handler(request()), 401);
});
test('current owner receives the exact gzip payload through user-scoped auth calls', async () => {
  const { handler, calls } = fixture();
  const response = await handler(request());
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-encoding'), 'gzip');
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.equal(zlib.gunzipSync(Buffer.from(await response.arrayBuffer())).toString(), marker);
  assert.equal(response.headers.get('access-control-allow-origin'), PREVIEW_ORIGIN);
  assert.match(response.headers.get('vary'), /Authorization/); assert.match(response.headers.get('cdn-cache-control'), /no-store/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://unit.supabase.co/auth/v1/user');
  const profileUrl = new URL(calls[1].url);
  assert.equal(profileUrl.pathname, '/rest/v1/dashboard_profiles');
  assert.equal(profileUrl.searchParams.get('auth_user_id'), 'eq.' + userId);
  assert.equal(profileUrl.searchParams.get('select'), 'auth_user_id,role,active');
  assert.equal(profileUrl.searchParams.get('limit'), '2');
  for (const call of calls) {
    assert.equal(call.init.headers.Authorization, 'Bearer test-user-jwt');
    assert.equal(call.init.headers.apikey, 'test-publishable-key');
    assert.equal(call.init.cache, 'no-store'); assert.equal(call.init.redirect, 'error');
  }
});
test('check authenticates identically without touching invalid or private payload', async () => {
  const { handler, calls } = fixture({ payload: 'not valid base64' });
  const result = await handler(request('?check=1'));
  assert.equal(result.status, 200); assert.deepEqual(await result.json(), { ok: true, canView: true, canManage: true });
  assert.equal(result.headers.get('content-encoding'), null); assert.equal(calls.length, 2);
  await denied(await fixture({ profile: [] }).handler(request('?check=1')), 403);
});
test('no authorization cache: disabling owner after a successful HTML read denies the next read', async () => {
  const profile = [{ ...goodProfile }]; const { handler, calls } = fixture({ profile });
  assert.equal((await handler(request())).status, 200);
  profile[0].active = false;
  await denied(await handler(request()), 403); assert.equal(calls.length, 4);
});
test('missing Origin still needs and accepts a fresh authenticated owner', async () => {
  const { handler, calls } = fixture();
  const response = await handler(new Request('https://unit.supabase.co/functions/v1/owner-admin-preview?check=1', { headers: { authorization: 'Bearer test-user-jwt' } }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('access-control-allow-origin'), null); assert.equal(calls.length, 2);
});
test('CORS accepts only the exact Pages origin and GET allowlisted preflights', async () => {
  const { handler, calls } = fixture();
  for (const origin of ['null', 'https://evil.example', PREVIEW_ORIGIN + '.evil.example']) await denied(await handler(request('', { origin })), 403);
  const options = (origin, method = 'GET', headers = 'authorization, apikey, Content-Type') => new Request('https://unit.supabase.co/functions/v1/owner-admin-preview', {
    method: 'OPTIONS', headers: { origin, 'access-control-request-method': method, 'access-control-request-headers': headers },
  });
  const response = await handler(options(PREVIEW_ORIGIN));
  assert.equal(response.status, 204); assert.equal(await response.text(), '');
  assert.equal(response.headers.get('access-control-allow-origin'), PREVIEW_ORIGIN);
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  assert.equal((await handler(options(PREVIEW_ORIGIN, 'POST'))).status, 204);
  await denied(await handler(options(PREVIEW_ORIGIN, 'PATCH')), 403);
  await denied(await handler(options(PREVIEW_ORIGIN, 'GET', 'x-unapproved')), 403);
  await denied(await handler(options('null')), 403); assert.equal(calls.length, 0);
});
test('unsupported methods, upstream failures and malformed payloads fail closed', async () => {
  const { handler, calls } = fixture();
  await denied(await handler(request('', {}, 'POST')), 405); assert.equal(calls.length, 0);
  await denied(await fixture({ failure: true }).handler(request()), 503);
  await denied(await fixture({ authStatus: 500 }).handler(request()), 503);
  await denied(await fixture({ profileStatus: 500 }).handler(request()), 503);
  await denied(await fixture({ payload: 'invalid base64 %%%' }).handler(request()), 503);
  await denied(await fixture({ payload: Buffer.from(marker).toString('base64') }).handler(request()), 503);
});

test('access exposes no-view status but HTML and periodic check both deny an ungranted active viewer', async () => {
  const {handler,calls}=fixture({profile:[{...goodProfile,role:'viewer'}]});
  const access=await handler(request('?action=access'));
  assert.equal(access.status,200);assert.deepEqual(await access.json(),{ok:true,canView:false,canManage:false});
  await denied(await handler(request('?check=1')),403);
  await denied(await handler(request()),403);
  assert(calls.every(call=>call.init.headers.apikey==='test-publishable-key'));
});
test('enabled admin/viewer with own explicit grant can view but cannot manage access', async () => {
  for(const role of ['admin','viewer']){
    const {handler,calls}=fixture({profile:[{...goodProfile,role}],grants:[{auth_user_id:userId,can_view:true}]});
    const response=await handler(request());assert.equal(response.status,200);
    assert.equal(zlib.gunzipSync(Buffer.from(await response.arrayBuffer())).toString(),marker);
    const checked=await handler(request('?check=1'));assert.deepEqual(await checked.json(),{ok:true,canView:true,canManage:false});
    await denied(await handler(request('?action=grants')),403);
    await denied(await handler(request('?action=grants',{'content-type':'application/json'},'POST',JSON.stringify({auth_user_id:otherId,can_view:true}))),403);
    assert(calls.every(call=>call.init.headers.apikey==='test-publishable-key'),'unauthorized management never constructs a service-role request');
  }
});
test('grant must match verified user and boolean true; revocation is effective on next check', async () => {
  const profile=[{...goodProfile,role:'viewer'}];
  for(const grants of [[{auth_user_id:otherId,can_view:true}],[{auth_user_id:userId,can_view:'true'}],[{auth_user_id:userId,can_view:false}],
    [{auth_user_id:userId,can_view:true},{auth_user_id:userId,can_view:true}]]) await denied(await fixture({profile,grants}).handler(request()),403);
  const grants=[{auth_user_id:userId,can_view:true}],{handler,calls}=fixture({profile,grants});
  assert.equal((await handler(request())).status,200);grants[0].can_view=false;
  await denied(await handler(request('?check=1')),403);assert.equal(calls.length,6);
});
test('Owner account directory is paginated, username-only searchable and restricted to current page grants', async () => {
  const {handler,calls}=fixture({grants:[{auth_user_id:otherId,can_view:true}],total:82});
  const response=await handler(request('?action=grants&offset=20&limit=30&search=M8_owner'));
  assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.offset,20);assert.equal(body.limit,30);assert.equal(body.total,82);assert.equal(body.hasMore,true);
  assert.deepEqual(Object.keys(body.accounts[0]).sort(),['active','auth_user_id','can_view','role','username']);
  assert.equal(body.accounts[0].can_view,true);assert.equal(body.accounts[1].can_view,true);
  const accountCall=calls.find(call=>call.init.headers.apikey==='test-private-service-key'&&new URL(call.url).pathname.endsWith('dashboard_profiles'));
  const url=new URL(accountCall.url);assert.equal(url.searchParams.get('select'),'auth_user_id,username,role,active');
  assert.equal(url.searchParams.get('limit'),'30');assert.equal(url.searchParams.get('offset'),'20');
  assert.equal(url.searchParams.get('username'),'ilike.*M8\\_owner*');assert.equal(accountCall.init.headers.Prefer,'count=exact');
  const grantsCall=calls.find(call=>new URL(call.url).pathname.endsWith('dashboard_admin_preview_grants'));
  assert.equal(new URL(grantsCall.url).searchParams.get('auth_user_id'),'in.('+userId+','+otherId+')');
  for(const suffix of ['limit=25','offset=-1','offset=1.5','search=x%2Ay','search=x%25y']) await denied(await handler(request('?action=grants&'+suffix)),400);
  for(const limit of [20,30,50,100,500])assert.equal((await handler(request('?action=grants&limit='+limit))).status,200);
});
test('Owner grant writes only the independent table and records verified actor, never supplied attribution', async () => {
  const {handler,calls}=fixture();
  const response=await handler(request('?action=grants',{'content-type':'application/json'},'POST',JSON.stringify({auth_user_id:otherId,can_view:true})));
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,auth_user_id:otherId,can_view:true});
  const writes=calls.filter(call=>call.init.method==='POST');assert.equal(writes.length,1);
  assert.equal(new URL(writes[0].url).pathname,'/rest/v1/dashboard_admin_preview_grants');
  const mutation=JSON.parse(writes[0].init.body);assert.equal(mutation.granted_by,userId);assert.equal(mutation.auth_user_id,otherId);assert.equal(mutation.can_view,true);
  assert(Number.isFinite(Date.parse(mutation.updated_at)));assert.equal(writes[0].init.headers.apikey,'test-private-service-key');
  assert(!calls.some(call=>call.init.method==='POST'&&new URL(call.url).pathname.endsWith('dashboard_profiles')));
});
test('grant changes reject unsafe fields, oversized bodies, inactive targets and inherent owner access', async () => {
  const send=(handler,body,headers={'content-type':'application/json'})=>handler(request('?action=grants',headers,'POST',typeof body==='string'?body:JSON.stringify(body)));
  for(const body of [{auth_user_id:otherId,can_view:'true'},{auth_user_id:'invalid',can_view:true},{auth_user_id:otherId,can_view:true,granted_by:otherId},[],null,'{'])await denied(await send(fixture().handler,body),400);
  await denied(await send(fixture().handler,' '.repeat(4097)),413);
  await denied(await send(fixture().handler,{auth_user_id:otherId,can_view:true},{}),415);
  await denied(await send(fixture({target:[]}).handler,{auth_user_id:otherId,can_view:true}),404);
  await denied(await send(fixture({target:[{auth_user_id:otherId,role:'owner',active:true}]}).handler,{auth_user_id:otherId,can_view:false}),400);
  await denied(await send(fixture({target:[{auth_user_id:otherId,role:'viewer',active:false}]}).handler,{auth_user_id:otherId,can_view:true}),400);
  const revoke=await send(fixture({target:[{auth_user_id:otherId,role:'viewer',active:false}]}).handler,{auth_user_id:otherId,can_view:false});assert.equal(revoke.status,200);
  await denied(await send(fixture({grantSaveStatus:500}).handler,{auth_user_id:otherId,can_view:true}),503);
});
