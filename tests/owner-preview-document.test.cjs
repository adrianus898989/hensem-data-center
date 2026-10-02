// Offline isolation tests. Sessions, accounts, messages and drafts are synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const ts = require(path.join(repo, 'node_modules/typescript'));
const documentPath = path.join(repo, 'src/lib/ownerPreviewDocument.ts');
const componentPath = path.join(repo, 'src/components/OwnerAdminPreview.tsx');
const transpile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const documentModule = { exports: {} };
vm.runInNewContext(transpile(fs.readFileSync(documentPath, 'utf8')), {
  module: documentModule, exports: documentModule.exports,
}, { filename: documentPath });
const api = documentModule.exports;
const authErrors = require('./load-typescript.cjs').loadTs(path.join(repo,'src/lib/dashboardAuthClient.ts'));
const KEYS = Array.from(api.OWNER_PREVIEW_DRAFT_KEYS), KEY = KEYS[0];
const AUTH = 'hensem:dashboard:auth-session:v2';
const HTML = '<!doctype html><html><head><title>Hensem</title></head><body><script>window.sampleLoaded=localStorage.getItem(' + JSON.stringify(KEY) + ');</script></body></html>';
const scripts = html => [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(match => match[1]);
function frame(drafts = {}, channel = 'offline-channel', html = HTML) {
  const result = api.makeOwnerPreviewDocument(html, drafts, channel), messages = [];
  const context = vm.createContext({ parent: { postMessage: (data, target) => messages.push({ data, target }) } },
    { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext('window=globalThis', context);
  for (const script of scripts(result)) vm.runInContext(script, context, { timeout: 1000 });
  return { html: result, context, storage: context.localStorage, messages };
}

test('only explicit draft keys and bounded string values can cross the bridge', () => {
  assert.equal(new Set(KEYS).size, KEYS.length);
  assert(KEYS.length > 0);
  for (const key of KEYS) {
    assert.equal(api.ownerPreviewDraftAllowed(key, '{}'), true);
    assert.equal(api.ownerPreviewDraftAllowed(key, null), true, 'null means removal');
    for (const value of [undefined, 42, {}, [], true]) assert.equal(api.ownerPreviewDraftAllowed(key, value), false);
  }
  for (const key of [AUTH, 'access_token', 'refresh_token', 'sb-project-auth-token', '__proto__', KEY + ':auth', {}, null])
    assert.equal(api.ownerPreviewDraftAllowed(key, 'offline-secret'), false);
  assert.equal(api.ownerPreviewDraftAllowed(KEY, 'x'.repeat(api.OWNER_PREVIEW_MAX_DRAFT_BYTES + 1)), false);
});

test('draft and channel serialization cannot close the bootstrap script', () => {
  const value = '</script><script>window.injected=true</script>"\\\u2028\u2029<&';
  const f = frame({ [KEY]: value, [AUTH]: 'offline-token-must-not-enter-frame' }, value);
  assert.equal(scripts(f.html).length, 2, 'bootstrap plus the original sample script only');
  assert.equal(f.storage.getItem(KEY), value);
  assert.equal(f.context.sampleLoaded, value);
  assert.equal(f.context.injected, undefined);
  assert.equal(f.html.includes('offline-token-must-not-enter-frame'), false);
  f.storage.setItem(KEY, 'next');
  assert.equal(f.messages[0].data.channel, value);
});

test('sandbox storage implements its own allowlisted namespace and never exposes auth', () => {
  const f = frame({ [KEY]: 'initial', [AUTH]: 'offline-token' });
  assert.equal(f.storage.getItem(AUTH), null);
  assert.equal(f.storage.length, 1);
  assert.equal(f.storage.key(0), KEY);
  assert.equal(f.storage.key(99), null);
  assert.throws(() => f.storage.setItem(AUTH, 'changed'), /Unsupported local draft/);
  assert.equal(f.messages.length, 0);
  f.storage.removeItem(AUTH);
  assert.equal(f.messages.length, 0);
  f.storage.setItem(KEY, 42);
  assert.equal(f.storage.getItem(KEY), '42');
  assert.equal(f.messages.at(-1).data.value, '42');
  assert.equal(f.messages.at(-1).target, '*', 'opaque sandbox needs a wildcard target; the host authenticates source/channel');
  assert.throws(() => f.storage.setItem(KEY, 'x'.repeat(api.OWNER_PREVIEW_MAX_DRAFT_BYTES + 1)), /Unsupported local draft/);
  assert.equal(f.storage.getItem(KEY), '42', 'failed writes are atomic');
  f.storage.clear();
  assert.equal(f.storage.length, 0);
  assert(f.messages.every(message => KEYS.includes(message.data.key)));
  assert(f.messages.slice(1).every(message => message.data.value === null));
});

test('frame instances and caller draft objects remain independent', () => {
  const input = { [KEY]: 'account-a' }, before = JSON.stringify(input);
  const a = frame(input, 'channel-a'), b = frame({ [KEY]: 'account-b' }, 'channel-b');
  a.storage.setItem(KEY, 'a-change');
  assert.equal(b.storage.getItem(KEY), 'account-b');
  assert.equal(b.messages.length, 0);
  assert.equal(JSON.stringify(input), before);
});

test('bootstrap precedes original scripts and requires no eval or network CSP allowance', () => {
  const f = frame({ [KEY]: 'ready' });
  assert.equal(f.context.sampleLoaded, 'ready');
  assert(f.html.indexOf('Content-Security-Policy') < f.html.indexOf('<html>'));
  assert.match(f.html, /connect-src 'none'/);
  assert.match(f.html, /default-src 'none'/);
  assert.match(f.html, /base-uri 'none'/);
  assert.match(f.html, /form-action 'none'/);
  assert.equal(f.html.includes("'unsafe-eval'"), false);
  assert.throws(() => api.makeOwnerPreviewDocument('<html>Hensem</html>', {}, 'x'), /格式/);
  assert.throws(() => api.makeOwnerPreviewDocument('<!doctype html><html>unexpected</html>', {}, 'x'), /格式/);
  assert.equal(frame({ [KEY]: 'headless' }, 'x', '<!doctype html><body>Hensem<script>sampleLoaded=localStorage.getItem(' + JSON.stringify(KEY) + ')</script>').context.sampleLoaded, 'headless');
});

function componentHarness(userId = 'offline-user-a', options = {}) {
  const listeners = new Map(), effects = [], effectDeps = [], refs = [], states = [], cleanups = [], calls = [], roleCalls = [], phases = [], restoreCalls = [];
  const values = new Map([[AUTH, 'offline-host-auth-must-not-enter-frame']]);
  const prefix = `hensem:owner-preview:${userId}:`;
  values.set(prefix + KEY, 'this-account-draft');
  values.set('hensem:owner-preview:other-account:' + KEY, 'other-account-draft');
  let hookIndex = 0, refIndex = 0, callbackIndex = 0, effectIndex = 0, throwOnWrite = false, intervalCheck = null;
  const callbacks = [];
  const react = {
    useState(initial) { const index = hookIndex++; if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useRef(initial) { const index = refIndex++; return refs[index] || (refs[index] = { current: initial }); },
    useCallback(callback) { const index = callbackIndex++; return callbacks[index] || (callbacks[index] = callback); },
    useEffect(callback, deps) { effectDeps[effectIndex++]=deps; effects.push(callback); },
  };
  const jsx = (type, props) => ({ type, props });
  const currentSession = { user: { id: userId }, access_token: 'offline-host-access', refresh_token: 'offline-host-refresh' };
  const box = { exports: {} };
  const window = {
    location: { origin: 'https://app.offline.invalid', href: 'https://app.offline.invalid/#owner-admin-preview', search: '', ...options.location },
    history: {replaceState(_state,_title,url){window.location.href=String(url);window.location.search=new URL(url).search;}},
    addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name),
    setInterval: callback => { intervalCheck = callback; return 1; }, clearInterval: () => {},
  };
  const localStorage = { getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (throwOnWrite) throw Error('Synthetic quota failure'); values.set(key, value); },
    removeItem(key) { if (throwOnWrite) throw Error('Synthetic quota failure'); values.delete(key); } };
  let environment, client, liveClient, roleClient, presenceClient;
  const requireStub = name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.endsWith('/adminPreviewRestore')) return { restoreApprovedAdmin(html) { phases.push('restore'); restoreCalls.push(html); return options.restore ? options.restore(html) : html+'<!-- synthetic approved restoration -->'; } };
    if (name.endsWith('/ownerPreviewDocument')) return { ...api, makeOwnerPreviewDocument(...args) { phases.push('draft-document'); return api.makeOwnerPreviewDocument(...args); } };
    if (name.endsWith('/ownerPreviewShell')) { const helper={exports:{}};vm.runInNewContext(transpile(fs.readFileSync(path.join(repo,'src/lib/ownerPreviewShell.ts'),'utf8')),{module:helper,exports:helper.exports,document:environment.document});return {...helper.exports,makeOwnerPreviewShellDocument(...args){phases.push('shell-document');return helper.exports.makeOwnerPreviewShellDocument(...args)}}; }
    if (name.endsWith('/dashboardAuthClient')) return { dashboardResponseError: authErrors.dashboardResponseError, ensureDashboardSession: async candidate => candidate, normalizedManagementPermissions: profile=>({manage_viewers:profile.management_permissions?.manage_viewers!==false}) };
    if (['adminConfigurationRequest','adminWorkorderRecordsRequest','depositStatisticsRequest','portalOperationLogsRequest'].some(helper=>name.endsWith('/'+helper))) { const helper={exports:{}};vm.runInNewContext(transpile(fs.readFileSync(path.join(repo,'src/lib/'+name.split('/').pop()+'.ts'),'utf8')),{module:helper,exports:helper.exports});return helper.exports; }
    if (name.endsWith('/adminLiveBridge')) {
      if (!liveClient) { const module={exports:{}};const filename=path.join(repo,'src/lib/adminLiveBridge.ts');vm.runInNewContext(transpile(fs.readFileSync(filename,'utf8')),{...environment,module,exports:module.exports,setTimeout,clearTimeout},{filename});liveClient={...module.exports,makeAdminLiveDocument(...args){phases.push('live-document');return module.exports.makeAdminLiveDocument(...args)}}; }
      return liveClient;
    }
    if (name.endsWith('/dashboardPresenceBridge')) {
      if (!presenceClient) { const helper={exports:{}};const filename=path.join(repo,'src/lib/dashboardPresenceBridge.ts');vm.runInNewContext(transpile(fs.readFileSync(filename,'utf8')),{...environment,module:helper,exports:helper.exports,require:()=>({}),URL},{filename});presenceClient={...helper.exports,installDashboardPresenceBridge:()=>()=>{},makeDashboardPresenceDocument(...args){phases.push('presence-document');return helper.exports.makeDashboardPresenceDocument(...args)}}; }
      return presenceClient;
    }
    if (name.endsWith('/ownerPreviewVerification')||name==='./ownerPreviewVerification') {const helper={exports:{}};const filename=path.join(repo,'src/lib/ownerPreviewVerification.ts');vm.runInNewContext(transpile(fs.readFileSync(filename,'utf8')),{...environment,module:helper,exports:helper.exports},{filename});return helper.exports;}
    if (name.endsWith('/adminPreviewClient')) {
      if (!client) {
        const box = { exports: {} }, filename = path.join(repo, 'src/lib/adminPreviewClient.ts');
        vm.runInNewContext(transpile(fs.readFileSync(filename, 'utf8')), { ...environment, module: box, exports: box.exports }, { filename });
        client = box.exports;
      }
      return client;
    }
    if (name === './AdminPreviewGrants') return { default: () => null };
    if (name === './AdminControlCenter') return { default: function AdminControlCenter(){} };
    if (name === './WorkOrderAccountAdmin') return { default: function WorkOrderAccountAdmin(){} };
    if (name === './AccountIpAdmin') return { default: function AccountIpAdmin(){} };
    if (name === './DashboardRoleManager') return { default: function DashboardRoleManager(){} };
    if (name.endsWith('/dashboardRoleCatalog.json')) return {default:JSON.parse(fs.readFileSync(path.join(repo,'src/lib/dashboardRoleCatalog.json'),'utf8'))};
    if (name.endsWith('/dashboardRoleAccess')) {
      if(!roleClient){const helper={exports:{}};vm.runInNewContext(transpile(fs.readFileSync(path.join(repo,'src/lib/dashboardRoleAccess.ts'),'utf8')),{...environment,module:helper,exports:helper.exports});roleClient=helper.exports;}
      return roleClient;
    }
    if (name.endsWith('/dashboardDataScope') || name==='./platformDisplayCountry') {
      const helper={exports:{}},relative=name==='./platformDisplayCountry'?'platformDisplayCountry':'dashboardDataScope';
      vm.runInNewContext(transpile(fs.readFileSync(path.join(repo,'src/lib/'+relative+'.ts'),'utf8')),{...environment,module:helper,exports:helper.exports,require:requireStub});
      return helper.exports;
    }
    if (name.endsWith('/dashboardIdle')) return {recordDashboardActivity:()=>true};
    throw Error('Unexpected component test import: ' + name);
  };
  environment = {
    module: box, exports: box.exports, require: requireStub, window, localStorage, URL, AbortController, Error, setTimeout:options.setTimeout||setTimeout,clearTimeout:options.clearTimeout||clearTimeout,
    crypto: { randomUUID: () => 'offline-frame-channel' },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://offline.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'offline-public-key' } },
    fetch: async (url, init) => { if(url.endsWith('/rest/v1/rpc/dashboard_role_access')){roleCalls.push({url,init});if(options.roleFetch)return options.roleFetch(url,init);return {ok:true,status:200,json:async()=>({mode:(options.role||'owner')==='owner'?'owner':'legacy',roleId:null,roleName:null,version:0,permissions:[],canView:true})};} phases.push('fetch'); calls.push({ url, init }); const response=options.fetch ? await options.fetch(url, init) : url.endsWith('?check=1')?{ok:true,status:200,json:async()=>({ok:true,canView:true,canManage:(options.role||'owner')==='owner'})}:{ ok: true, status: 200, text: async () => HTML }; return typeof response.text==='function'?{...response,text:async()=>{phases.push('response:text');return response.text()}}:response; },
  };
  vm.runInNewContext(transpile(fs.readFileSync(componentPath, 'utf8')), environment, { filename: componentPath });
  const props = { canView: options.canView ?? true, session: currentSession,
    profile: { active: options.active ?? true, role: options.role || 'owner', permissions:options.permissions, management_permissions:options.management_permissions, auth_user_id: userId }, onLogout: options.onLogout || (()=>{}) };
  const draw = () => { hookIndex = refIndex = callbackIndex = effectIndex = 0; return box.exports.default(props); };
  draw(); const child = {}; refs[0].current = { contentWindow: child };
  for (const effect of effects.splice(0)) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
  return { values, prefix, child, calls, roleCalls, states, draw, effectDeps, phases, restoreCalls, rerenderSession:next=>{props.session=next;return draw()}, session:currentSession, channel: () => refs[1].current,
    send: event => listeners.get('message')?.(event), dispose: () => cleanups.forEach(cleanup => cleanup()),
    checkPermission: () => intervalCheck?.(),
    failStorage: () => { throwOnWrite = true; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const findElement = (node, type) => !node || typeof node !== 'object' ? null : node.type === type ? node
  : (Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]).map(child => findElement(child, type)).find(Boolean);

test('host sends session only to its protected fetch; iframe has no same-origin capability or tokens', async () => {
  const h = componentHarness();
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.roleCalls.length,1);assert.equal(h.roleCalls[0].init.headers.Authorization,'Bearer offline-host-access');assert.equal(h.roleCalls[0].init.cache,'no-store');
  assert.equal(h.calls[0].init.headers.Authorization, 'Bearer offline-host-access');
  assert.equal(h.calls[0].init.cache, 'no-store');
  assert.equal(h.calls[0].init.redirect, 'error');
  const iframe = findElement(h.draw(), 'iframe');
  assert(iframe, 'authorized preview loads a frame');
  assert.equal(iframe.props.sandbox, 'allow-scripts allow-downloads');
  assert.equal(iframe.props.referrerPolicy, 'no-referrer');
  assert.equal(typeof iframe.props.srcDoc, 'string');
  for (const secret of ['offline-host-access', 'offline-host-refresh', 'offline-host-auth-must-not-enter-frame', 'other-account-draft'])
    assert.equal(iframe.props.srcDoc.includes(secret), false);
  assert(iframe.props.srcDoc.includes('this-account-draft'));
  assert(iframe.props.srcDoc.includes('window.hensemPresenceSubscribe'));
  assert(iframe.props.srcDoc.includes('hensem-dashboard-presence-update'));
  h.dispose();
});

test('authorized HTML is restored before live, presence, shell and draft bootstraps; permission checks do not transform bodies', async () => {
  let resolveHTML;const pending=new Promise(resolve=>{resolveHTML=resolve});
  const h=componentHarness('offline-restoration-order',{fetch:async url=>url.endsWith('?check=1')?{ok:true,status:200,json:async()=>({ok:true,canView:true,canManage:true}),text:async()=>{throw Error('check HTML body must not be read')}}:{ok:true,status:200,text:()=>pending}});
  try {
    await flush();assert.deepEqual(h.phases,['fetch','response:text']);assert.equal(h.restoreCalls.length,0);assert.equal(findElement(h.draw(),'iframe'),undefined);
    resolveHTML(HTML);await flush();assert.deepEqual(h.phases,['fetch','response:text','restore','live-document','presence-document','shell-document','draft-document']);assert.deepEqual(h.restoreCalls,[HTML]);const before=findElement(h.draw(),'iframe').props.srcDoc;assert(before.includes('synthetic approved restoration'));
    h.checkPermission();await flush();assert.equal(h.calls.length,2);assert(h.calls[1].url.endsWith('?check=1'));assert.deepEqual(h.phases,['fetch','response:text','restore','live-document','presence-document','shell-document','draft-document','fetch']);assert.equal(h.restoreCalls.length,1);assert.equal(findElement(h.draw(),'iframe').props.srcDoc,before);
  } finally {resolveHTML(HTML);h.dispose()}
});

test('restoration failure aborts the request, clears stale document state and never publishes a partial iframe', async () => {
  let resolveHTML;const pending=new Promise(resolve=>{resolveHTML=resolve});
  const h=componentHarness('offline-restoration-failed',{fetch:async()=>({ok:true,status:200,text:()=>pending}),restore:()=>{throw Error('Synthetic approved revision mismatch')}});
  try {
    await flush();h.states[1]='<!doctype html><html>Hensem synthetic stale document</html>';assert(findElement(h.draw(),'iframe'));resolveHTML(HTML);await flush();assert.equal(h.restoreCalls.length,1);assert.equal(h.states[1],'');assert.match(h.states[2],/Synthetic approved revision mismatch/);assert.equal(h.calls[0].init.signal.aborted,true);assert.equal(findElement(h.draw(),'iframe'),undefined);assert.deepEqual(h.phases,['fetch','response:text','restore']);h.checkPermission();await flush();assert.equal(h.calls.length,1,'failed restoration cancels that load lifecycle');
  } finally {resolveHTML(HTML);h.dispose()}
});

test('403 permission check aborts an initial HTML load and late success cannot restore the frame', async () => {
  let resolveHTML;
  const lateHTML = new Promise(resolve => { resolveHTML = resolve; });
  const h = componentHarness('offline-revoked-user', { fetch: async url => url.endsWith('?check=1')
    ? { ok: false, status: 403 }
    : { ok: true, status: 200, text: () => lateHTML } });
  try {
    await flush();
    assert.equal(h.calls.length, 1, 'initial HTML request has started');
    const initialSignal = h.calls[0].init.signal;
    assert.equal(initialSignal.aborted, false);
    h.checkPermission(); await flush();
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].url.endsWith('?check=1'), true);
    assert.equal(initialSignal.aborted, true, 'revocation must abort the shared initial request');
    assert.equal(h.states[1], ''); assert(h.states[2], 'revocation remains visible as an error');
    // Deliberately resolve despite abort: a buffered or non-abortable body must still be ignored.
    resolveHTML(HTML); await flush();
    assert.equal(h.states[1], '', 'late initial HTML cannot restore documentHtml after revocation');
    assert.equal(h.restoreCalls.length,0,'revoked buffered HTML never reaches the transformation');
    assert.equal(findElement(h.draw(), 'iframe'), undefined);
    h.checkPermission(); await flush();
    assert.equal(h.calls.length, 2, 'cancelled effect cannot issue further permission requests');
  } finally { resolveHTML(HTML); h.dispose(); }
});

test('host accepts only its current opaque frame, matching channel and allowed draft key', async () => {
  const h = componentHarness(); await flush();
  const valid = { source: h.child, origin: 'null', data: { type: 'hensem-owner-preview-draft', channel: h.channel(), key: KEY, value: 'saved' } };
  const invalid = [
    { ...valid, source: {} }, { ...valid, origin: 'https://offline.invalid' },
    { ...valid, data: { ...valid.data, channel: 'old-frame-channel' } },
    { ...valid, data: { ...valid.data, type: 'other-message' } },
    { ...valid, data: { ...valid.data, key: AUTH } },
    { ...valid, data: { ...valid.data, value: {} } },
    { ...valid, data: { ...valid.data, value: 'x'.repeat(api.OWNER_PREVIEW_MAX_DRAFT_BYTES + 1) } },
    { ...valid, data: null },
  ];
  for (const event of invalid) { h.send(event); assert.equal(h.values.get(h.prefix + KEY), 'this-account-draft'); }
  h.send(valid); assert.equal(h.values.get(h.prefix + KEY), 'saved');
  assert.equal(h.values.get(AUTH), 'offline-host-auth-must-not-enter-frame');
  assert.equal(h.values.get('hensem:owner-preview:other-account:' + KEY), 'other-account-draft');
  h.send({ ...valid, data: { ...valid.data, value: null } }); assert.equal(h.values.has(h.prefix + KEY), false);
  h.failStorage(); assert.doesNotThrow(() => h.send(valid)); assert(h.states.some(value => typeof value === 'string' && value.includes('保存草稿')));
  h.dispose();
});

test('an active authorized non-Owner can view; inactive or ungranted accounts cannot fetch or persist', async () => {
  const viewer = componentHarness('offline-viewer', { role: 'viewer', canView: true });
  await flush(); assert(findElement(viewer.draw(), 'iframe')); assert.equal(viewer.calls.length, 1); viewer.dispose();
  for (const options of [{ canView: false }, { active: false, canView: true }]) {
    const h = componentHarness('offline-denied', options); await flush();
    assert.equal(h.calls.length, 0); assert.equal(h.restoreCalls.length,0); assert.equal(findElement(h.draw(), 'iframe'), undefined);
    h.send({ source: h.child, origin: 'null', data: { type: 'hensem-owner-preview-draft', channel: h.channel(), key: KEY, value: 'unauthorized' } });
    assert.equal(h.values.get(h.prefix + KEY), 'this-account-draft'); h.dispose();
  }
});



test('same-user session refresh keeps the iframe and uses the latest session for permission checks', async () => {
  const h=componentHarness();await flush();const before=findElement(h.draw(),'iframe').props.srcDoc,dependencies=h.effectDeps.map(deps=>deps&&[...deps]);
  const fresh={...h.session,user:{...h.session.user},access_token:'offline-new-access',refresh_token:'offline-new-refresh'};
  h.rerenderSession(fresh);
  assert.equal(findElement(h.draw(),'iframe').props.srcDoc,before);
  assert.equal(h.effectDeps.length,dependencies.length);
  h.effectDeps.forEach((deps,i)=>{assert.equal(deps.length,dependencies[i].length);deps.forEach((dep,j)=>assert(Object.is(dep,dependencies[i][j]),'token/object refresh does not invalidate the document-load effect'));});
  assert(h.effectDeps.every(deps=>!deps.includes(fresh)&&!deps.includes(h.session)));
  h.checkPermission();await flush();assert.equal(h.calls.length,2);assert(h.calls[1].url.endsWith('?check=1'));assert.equal(h.calls[1].init.headers.Authorization,'Bearer offline-new-access');assert.equal(h.roleCalls.length,2);assert.equal(h.roleCalls[1].init.headers.Authorization,'Bearer offline-new-access');
  assert.equal(findElement(h.draw(),'iframe').props.srcDoc,before);h.dispose();
});

test('retired return command cannot leave the formal backend or alter draft authorization', async () => {
  let closed=0;const h=componentHarness('shell-viewer',{role:'viewer',canView:true,onLogout:()=>closed++});await flush();
  const message={source:h.child,origin:'null',data:{type:'hensem-owner-preview-shell',channel:h.channel(),command:'back'}};
  for(const event of [{...message,source:{}},{...message,origin:'https://other.invalid'},{...message,data:{...message.data,channel:'stale'}},{...message,data:{...message.data,command:'grant'}},{...message,data:null}])h.send(event);
  assert.equal(closed,0);h.send(message);assert.equal(closed,0);assert.equal(h.values.get(h.prefix+KEY),'this-account-draft');
  assert.equal(findElement(h.draw(),'header'),undefined,'no outer preview header takes viewport space');
  h.dispose();
});

function requestHarness(options = {}) {
  const filename = path.join(repo, 'src/lib/adminPreviewClient.ts'), box = { exports: {} }, calls = [];
  const session = { user: { id: 'offline-request-user' }, access_token: 'offline-old-token', refresh_token: 'offline-refresh-token' };
  const fresh = { ...session, user: { id: options.freshUser || session.user.id }, access_token: 'offline-fresh-token' };
  vm.runInNewContext(transpile(fs.readFileSync(filename, 'utf8')), {
    module: box, exports: box.exports, URL,
    require: name => { if(name==='./ownerPreviewVerification')return require('./load-typescript.cjs').loadTs(path.join(repo,'src/lib/ownerPreviewVerification.ts'));assert.equal(name, './dashboardAuthClient'); return { dashboardResponseError: authErrors.dashboardResponseError, ensureDashboardSession: async () => fresh }; },
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: options.base || 'https://offline.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'offline-public-key' } },
    fetch: async (url, init) => { calls.push({ url, init }); return { ok: !(options.status >= 400), status: options.status || 200, json: async () => (options.body || { canView: true, canManage: false }) }; },
  }, { filename });
  return { api: box.exports, session, calls };
}

test('request helper owns fresh auth headers, target origin, no-store and redirect policy', async () => {
  const h = requestHarness(), signal = new AbortController().signal;
  await h.api.adminPreviewRequest(h.session, '?action=access', { method: 'POST', body: '{}', signal,
    headers: { Authorization: 'caller-stale-token', apikey: 'caller-key', 'X-Extra': 'not-forwarded' }, cache: 'force-cache', redirect: 'follow' });
  const call = h.calls[0];
  assert.equal(call.url, 'https://offline.invalid/functions/v1/owner-admin-preview?action=access');
  for (const secret of ['offline-old-token', 'offline-fresh-token', 'offline-refresh-token']) assert.equal(call.url.includes(secret), false);
  assert.equal(call.init.headers.Authorization, 'Bearer offline-fresh-token');
  assert.equal(call.init.headers.apikey, 'offline-public-key');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.equal(call.init.headers['X-Extra'], undefined);
  assert.equal(call.init.cache, 'no-store'); assert.equal(call.init.redirect, 'error');
  assert.equal(call.init.signal, signal); assert.equal(call.init.method, 'POST');
});

test('changed user, invalid origin and unauthorized response fail without leaking credentials', async () => {
  const changed = requestHarness({ freshUser: 'other-user' });
  await assert.rejects(() => changed.api.adminPreviewRequest(changed.session), /账号已改变/); assert.equal(changed.calls.length, 0);
  for (const base of ['http://offline.invalid', 'https://offline.invalid/path', 'https://user:pass@offline.invalid', 'https://offline.invalid?query=x']) {
    const h = requestHarness({ base }); await assert.rejects(() => h.api.adminPreviewRequest(h.session), /配置无效/); assert.equal(h.calls.length, 0);
  }
  for (const status of [401, 403]) { const h = requestHarness({ status }); await assert.rejects(() => h.api.adminPreviewRequest(h.session), /查看权限/); assert.equal(h.calls.length, 1); }
});

test('real snapshot payload is absent from public/out and Git tracked files', () => {
  const hasPayload = text => /(?:const|let|var)\s+depositSheetV3\s*=\s*\{/.test(text)
    || /"readRanges"\s*:/.test(text) && /"sourceRows"\s*:/.test(text) && /"reportedAgeDays"\s*:/.test(text);
  const walk = directory => !fs.existsSync(directory) ? [] : fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name); return entry.isSymbolicLink() ? [] : entry.isDirectory() ? walk(filename) : [filename];
  });
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean);
  assert(!tracked.some(filename => filename.endsWith('/owner-admin-preview/payload.generated.ts')), 'generated payload must never be tracked');
  const candidates = new Set([...walk(path.join(repo, 'public')), ...walk(path.join(repo, 'out')),
    ...tracked.filter(filename => /\.(?:html|js|mjs|cjs|ts|tsx|json|txt|map)$/.test(filename)).map(filename => path.join(repo, filename))]);
  for (const filename of candidates) if (fs.existsSync(filename) && fs.statSync(filename).isFile())
    assert.equal(hasPayload(fs.readFileSync(filename, 'utf8')), false, 'snapshot payload must not enter static or tracked artifacts: ' + path.relative(repo, filename));
  const ignored = execFileSync('git', ['check-ignore', '--no-index', 'supabase/functions/owner-admin-preview/payload.generated.ts'], { cwd: repo, encoding: 'utf8' }).trim();
  assert(ignored.endsWith('payload.generated.ts'));
});

test('available local sample inline scripts parse and use no eval/new Function', t => {
  const candidate = process.env.OWNER_PREVIEW_HTML || path.resolve(repo, '../../outputs/v3/hensem-admin.html');
  if (!fs.existsSync(candidate)) return t.skip('Optional local prototype is absent; the bootstrap fixture still runs with string code generation disabled');
  const html = fs.readFileSync(candidate, 'utf8'), inline = scripts(html);
  assert(inline.length > 0);
  assert.equal(/<script\b[^>]*\bsrc\s*=/i.test(html), false, 'sample must not require CDN scripts');
  for (let index = 0; index < inline.length; index++) {
    new vm.Script(inline[index], { filename: 'preview-inline-' + index });
    const source = ts.createSourceFile('inline.js', inline[index], ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function visit(node) {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const expression = node.expression;
        const name = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : '';
        assert(!['eval', 'Function'].includes(name), 'inline sample must run under CSP without dynamic string compilation');
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});

test('bookmarked page reaches the authorized iframe while denied accounts never load it', async () => {
  const location={pathname:'/hensem-data-center/',hash:'#owner-admin-preview/provider_payout',search:'?secret=synthetic-query-secret'};
  const h=componentHarness('offline-bookmark',{location});await flush();
  const iframe=findElement(h.draw(),'iframe');assert(iframe);assert.equal(iframe.props.sandbox,'allow-scripts allow-downloads');
  const script=scripts(iframe.props.srcDoc).find(text=>text.includes('window.HENSEM_PRODUCTION=true'));assert(script);
  const context=vm.createContext({parent:{postMessage(){throw Error('URL helper must not request data')}},addEventListener(){},setTimeout,clearTimeout});
  vm.runInContext('window=globalThis',context);vm.runInContext(script,context);
  assert.equal(context.hensemAdminInitialPage,'provider_payout');assert.equal(context.hensemAdminPageUrl('providers'),'https://app.offline.invalid/hensem-data-center/#admin/providers');
  assert.doesNotMatch(iframe.props.srcDoc,/synthetic-query-secret|offline-host-access|offline-host-refresh/);h.dispose();
  const denied=componentHarness('offline-denied-bookmark',{location,canView:false,role:'viewer'});await flush();
  assert.equal(denied.calls.length,0);assert(!findElement(denied.draw(),'iframe'));denied.dispose();
});


function elements(node){if(!node||typeof node!=='object')return[];return[node,...(Array.isArray(node.props?.children)?node.props.children:[node.props?.children]).flatMap(elements)]}
test('account page opens a real list with permitted account and role tabs, keeps the iframe and enforces each permission',async()=>{
 for(const options of [{role:'owner',accounts:true,workorder:true},{role:'admin',accounts:true,workorder:false},{role:'admin',management_permissions:{manage_viewers:false},accounts:false,workorder:false},{role:'viewer',accounts:false,workorder:false}]){
  const h=componentHarness('account-fixture',options);await flush();const before=findElement(h.draw(),'iframe').props.srcDoc,reads=h.calls.length;
  const send=data=>h.send({source:h.child,origin:'null',data:{type:'hensem-owner-preview-shell',channel:h.channel(),...data}});
  send({command:'account-page',active:true,bounds:{top:143,left:242,width:1200}});let tree=h.draw(),all=elements(tree);
  const tabs=all.filter(n=>n.props?.role==='tab');assert.deepEqual(tabs.map(n=>n.props.children),options.role==='owner'?['前端工单账号','后台账号','角色与目录权限']:['前端工单账号','后台账号']);assert.equal(tabs[0].props.disabled,!options.workorder);assert.equal(tabs[1].props.disabled,!options.accounts);
  assert.equal(all.some(n=>n.type?.name==='WorkOrderAccountAdmin'),options.workorder);assert.equal(all.some(n=>n.type?.name==='AdminControlCenter'),!options.workorder&&options.accounts);
  assert(!all.some(n=>n.props?.role==='dialog'||n.props?.['aria-modal']),'page is inline, not another dialog');
  assert(!all.some(n=>n.type==='button'&&/^(关闭|管理后台账号|管理工单账号)$/.test(n.props.children)));
  const page=all.find(n=>n.props?.className==='owner-preview-account-page');assert.deepEqual(JSON.parse(JSON.stringify(page.props.style)),{top:143,left:242,width:1200});
  if(options.accounts){tabs[1].props.onClick();tree=h.draw();all=elements(tree);const component=all.find(n=>n.type?.name==='AdminControlCenter');assert(component);assert.equal(component.props.accountsOnlyLoading,true);assert.equal(component.props.section,'accounts');assert.equal(component.props.session,h.session)}else assert(all.some(n=>n.props?.role==='alert'));
  // Old allowlisted commands cannot override the host's current permission gate.
  send({command:'open-workorder-accounts'});assert.equal(elements(h.draw()).some(n=>n.type?.name==='WorkOrderAccountAdmin'),options.workorder);
  send({command:'open-accounts'});assert.equal(elements(h.draw()).some(n=>n.type?.name==='AdminControlCenter'),options.accounts);
  assert.equal(findElement(h.draw(),'iframe').props.srcDoc,before);assert.equal(h.calls.length,reads,'switching account tabs does not reload preview');
  send({command:'account-page',active:false});assert(!elements(h.draw()).some(n=>n.props?.className==='owner-preview-account-page'));assert.equal(findElement(h.draw(),'iframe').props.srcDoc,before);
  send({command:'account-page',active:true,bounds:{top:158,left:242,width:980}});assert.equal(elements(h.draw()).some(n=>n.type?.name==='AdminControlCenter'),options.accounts,'return keeps chosen backend tab');assert.equal(h.calls.length,reads);h.dispose();
 }
});
test('wrong-origin, stale-channel and malformed layout messages cannot open host account controls',async()=>{
 const h=componentHarness();await flush();const base={source:h.child,origin:'null',data:{type:'hensem-owner-preview-shell',channel:h.channel(),command:'account-page',active:true,bounds:{top:120,left:230,width:1100}}};
 for(const event of [{...base,source:{}},{...base,origin:'https://spoof.invalid'},{...base,data:{...base.data,channel:'old'}},{...base,data:{...base.data,bounds:{top:0,left:-1,width:900}}},{...base,data:{...base.data,bounds:{top:0,left:0,width:'100%'}}}]){h.send(event);assert(!elements(h.draw()).some(n=>n.props?.className==='owner-preview-account-page'))}h.dispose();
});
test('WG data stays in the existing formal iframe with no separate workspace or entry',async()=>{
 for(const options of [{role:'owner'},{role:'viewer',permissions:{auto_withdraw:true}},{role:'admin'}]){
  const h=componentHarness('wg-fixture',options);await flush();let tree=h.draw(),all=elements(tree);
  assert(findElement(tree,'iframe').props.srcDoc.includes('owner-preview-frame-shell-style'));
  assert(!all.some(n=>n.type==='button'&&n.props?.children==='WG 实时数据'));
  assert(!all.some(n=>n.type?.name==='WGRealtimeDashboard'||n.props?.className==='owner-preview-wg-page'));
  assert(!all.some(n=>n.type==='button'&&n.props?.children==='返回运营中心'));
  h.dispose();
 }
});

test('preview request retains the structured session denial and distinguishes missing profile authorization',async()=>{
 for(const code of ['application_session_denied','profile_denied']){
  const h=requestHarness({status:403,body:{code,message:'private server detail'}});
  const error=await h.api.adminPreviewRequest(h.session).catch(error=>error);
  assert.equal(error.code,code);assert.equal(error.status,403);assert.equal(authErrors.isDashboardAuthTerminalError(error),true);
  assert.doesNotMatch(error.message,/private server detail|停用/);assert.match(error.message,code==='application_session_denied'?/会话已失效/:/后台权限/);assert.equal(h.calls.length,1);
 }
});

function retryClock(){let id=0;const timers=new Map(),delays=[];return{setTimeout(fn,ms){delays.push(ms);timers.set(++id,fn);return id},clearTimeout(id){timers.delete(id)},delays,timers,next(){const item=timers.entries().next().value;assert(item,'a short retry is scheduled');timers.delete(item[0]);item[1]();}}}
test('temporary entry 503 automatically rereads role and fresh HTML after short backoff, without publishing stale permissions',async()=>{
 const clock=retryClock();let n=0;const h=componentHarness('offline-recovery',{...clock,fetch:async()=>++n===1?{ok:false,status:503,json:async()=>({code:'profile_unavailable'})}:{ok:true,status:200,text:async()=>HTML}});
 try{await flush();assert.equal(h.calls.length,1);assert.equal(h.states[0],null);assert(!findElement(h.draw(),'iframe'));assert.match(JSON.stringify(h.draw()),/重新验证查看权限.*2\/3/);assert.deepEqual(clock.delays,[500]);h.checkPermission();await flush();assert.equal(h.calls.length,1,'focus/timer verification cannot restart the backoff budget');clock.next();await flush();assert.equal(h.calls.length,2);assert.equal(h.roleCalls.length,2);assert(findElement(h.draw(),'iframe'));assert.equal(h.states[2],'');assert.equal(clock.timers.size,0);assert(!findElement(h.draw(),'iframe').props.srcDoc.includes('offline-host-access'));}
 finally{h.dispose()}
});
test('three transient failures stop automatic attempts and expose reload and logout controls',async()=>{
 const clock=retryClock(),h=componentHarness('offline-permanent-outage',{...clock,fetch:async()=>({ok:false,status:503,json:async()=>({code:'role_access_unavailable'})})});
 try{await flush();clock.next();await flush();clock.next();await flush();assert.equal(h.calls.length,3);assert.equal(h.roleCalls.length,3);assert.deepEqual(clock.delays,[500,1500]);assert.equal(clock.timers.size,0);assert(!findElement(h.draw(),'iframe'));assert(h.states[2]);const buttons=elements(h.draw()).filter(n=>n.type==='button');assert(buttons.some(n=>n.props.children==='重新加载'));assert(buttons.some(n=>n.props.children==='退出登录'));h.checkPermission();await flush();assert.equal(h.calls.length,3);}
 finally{h.dispose()}
});
test('periodic temporary failure clears old authorization and rebuilds the frame only with a fresh narrower role',async()=>{
 const clock=retryClock();let roleReads=0,reads=0;const narrow={mode:'assigned',roleId:'33333333-3333-4333-8333-333333333333',roleName:'Synthetic narrowed',version:2,permissions:['providers.view'],canView:true};
 const h=componentHarness('offline-recheck',{...clock,role:'viewer',roleFetch:async()=>({ok:true,status:200,json:async()=>++roleReads===1?{mode:'legacy',roleId:null,roleName:null,version:0,permissions:[],canView:true}:narrow}),fetch:async url=>++reads===2?{ok:false,status:503,json:async()=>({code:'profile_unavailable'})}:{ok:true,status:200,text:async()=>HTML,json:async()=>({ok:true,canView:true,canManage:false})}});
 try{await flush();const before=findElement(h.draw(),'iframe').props.srcDoc;assert(before.includes('"mode":"legacy"'));h.checkPermission();await flush();assert.equal(h.states[0],null);assert.equal(h.states[1],'');assert(!findElement(h.draw(),'iframe'));clock.next();await flush();assert.equal(h.calls.length,3);assert.equal(h.roleCalls.length,3);assert(!h.calls[2].url.endsWith('?check=1'),'recovery fetches protected HTML, not a check-only body');const after=findElement(h.draw(),'iframe').props.srcDoc;assert(after.includes('Synthetic narrowed'));assert(after.includes('"permissions":["providers.view"]'));assert(!after.includes('"mode":"legacy"'));}
 finally{h.dispose()}
});
test('network read errors retry, while malformed role/check responses and denial never do',async()=>{
 for(const status of [401,403]){const clock=retryClock(),h=componentHarness('offline-terminal-'+status,{...clock,fetch:async()=>({ok:false,status,json:async()=>({code:'account_disabled'})})});try{await flush();assert.equal(h.calls.length,1);assert.equal(clock.timers.size,0);assert(!findElement(h.draw(),'iframe'));assert(h.states[2]);}finally{h.dispose()}}
 const malformed=componentHarness('offline-malformed-role',{roleFetch:async()=>({ok:true,status:200,json:async()=>({canView:true})})});try{await flush();assert.equal(malformed.roleCalls.length,1);assert.equal(malformed.calls.length,0);assert.match(malformed.states[2],/不完整/);}finally{malformed.dispose()}
 const badCheck=componentHarness('offline-malformed-check',{fetch:async url=>url.endsWith('?check=1')?{ok:true,status:200,json:async()=>({ok:true})}:{ok:true,status:200,text:async()=>HTML}});try{await flush();badCheck.checkPermission();await flush();assert.equal(badCheck.calls.length,2);assert.equal(badCheck.states[0],null);assert.equal(badCheck.states[1],'');assert.match(badCheck.states[2],/不完整/);}finally{badCheck.dispose()}
 const clock=retryClock();let first=true;const network=componentHarness('offline-network-read',{...clock,fetch:async()=>{if(first){first=false;throw new TypeError('synthetic failed fetch')}return{ok:true,status:200,text:async()=>HTML}}});try{await flush();assert.equal(network.calls.length,1);clock.next();await flush();assert.equal(network.calls.length,2);assert(findElement(network.draw(),'iframe'));}finally{network.dispose()}
});
test('unmount cancels backoff and a late retry response cannot publish into the next account lifecycle',async()=>{
 const waiting=retryClock(),a=componentHarness('offline-cancel-wait',{...waiting,fetch:async()=>({ok:false,status:503,json:async()=>({code:'profile_unavailable'})})});await flush();assert.equal(waiting.timers.size,1);a.dispose();await flush();assert.equal(waiting.timers.size,0);assert.equal(a.calls.length,1);
 let resolve;const pending=new Promise(r=>{resolve=r}),clock=retryClock();let n=0;const old=componentHarness('offline-account-old',{...clock,fetch:async()=>++n===1?{ok:false,status:503,json:async()=>({code:'profile_unavailable'})}:{ok:true,status:200,text:()=>pending}});
 try{await flush();clock.next();await flush();old.dispose();const next=componentHarness('offline-account-new');try{await flush();assert(findElement(next.draw(),'iframe'));resolve(HTML+'<!-- late old account -->');await flush();assert.equal(old.states[1],'');assert.equal(old.states[0],null);assert.equal(old.restoreCalls.length,0);assert(!findElement(next.draw(),'iframe').props.srcDoc.includes('late old account'));}finally{next.dispose()}}finally{resolve(HTML);old.dispose()}
});

test('changed role is closed before fresh HTML arrives and a malformed HTML document is never automatically replayed',async()=>{
 let read=0,resolve;const pending=new Promise(r=>{resolve=r}),narrow={mode:'assigned',roleId:'33333333-3333-4333-8333-333333333333',roleName:'Synthetic changed',version:2,permissions:['providers.view'],canView:true};
 const h=componentHarness('offline-role-changed',{role:'viewer',roleFetch:async()=>({ok:true,status:200,json:async()=>++read===1?{mode:'legacy',roleId:null,roleName:null,version:0,permissions:[],canView:true}:narrow}),fetch:async url=>url.endsWith('?check=1')?{ok:true,status:200,json:async()=>({ok:true,canView:true,canManage:false})}:{ok:true,status:200,text:()=>read>1?pending:HTML}});
 try{await flush();assert(findElement(h.draw(),'iframe'));h.checkPermission();await flush();assert.equal(h.states[0],null);assert.equal(h.states[1],'');assert(!findElement(h.draw(),'iframe'));resolve(HTML);await flush();assert(findElement(h.draw(),'iframe').props.srcDoc.includes('Synthetic changed'));}finally{resolve(HTML);h.dispose()}
 const clock=retryClock(),bad=componentHarness('offline-invalid-html',{...clock,restore:()=>{throw new TypeError('Synthetic invalid protected HTML')},fetch:async()=>({ok:true,status:200,text:async()=>HTML})});try{await flush();assert.equal(bad.calls.length,1);assert.equal(clock.timers.size,0);assert.match(bad.states[2],/invalid protected HTML/);assert(!findElement(bad.draw(),'iframe'));}finally{bad.dispose()}
});
test('retry classification rejects policy, permission and ordinary validation errors even with misleading status or names',async()=>{
 const helper=require('./load-typescript.cjs').loadTs(path.join(repo,'src/lib/ownerPreviewVerification.ts'));
 for(const code of ['account_disabled','application_session_denied','preview_denied','invalid_role_response','session_changed','42501'])assert.equal(helper.ownerPreviewRetryable({status:503,code}),false);
 for(const cause of [new TypeError('not an endpoint transport error'),new SyntaxError('malformed JSON'),new Error('incomplete permissions'),{status:429},{status:400},{status:0,code:'http_error'},{name:'AbortError',status:503}])assert.equal(helper.ownerPreviewRetryable(cause),false);
 for(const status of [500,503,520,525])assert.equal(helper.ownerPreviewRetryable({status,code:'upstream_unavailable'}),true);
 const controller=new AbortController();controller.abort();await assert.rejects(helper.retryOwnerPreviewVerification(async()=>true,controller.signal,()=>assert.fail('cancelled operation must not retry')),{name:'AbortError'});
});

test('temporary role transport failures recover before any protected document request; malformed role JSON remains terminal',async()=>{
 for(const mode of ['network','upstream']){const clock=retryClock();let read=0;const h=componentHarness('offline-role-'+mode,{...clock,roleFetch:async()=>{if(++read===1){if(mode==='network')throw new TypeError('synthetic role network failure');return{ok:false,status:525,json:async()=>({code:'upstream_unavailable'})}}return{ok:true,status:200,json:async()=>({mode:'owner',roleId:null,roleName:null,version:0,permissions:[],canView:true})}}});
 try{await flush();assert.equal(h.roleCalls.length,1);assert.equal(h.calls.length,0);assert.equal(h.states[0],null);clock.next();await flush();assert.equal(h.roleCalls.length,2);assert.equal(h.calls.length,1);assert(findElement(h.draw(),'iframe'));}finally{h.dispose()}}
 const clock=retryClock(),invalid=componentHarness('offline-invalid-role-json',{...clock,roleFetch:async()=>({ok:true,status:200,json:async()=>{throw new SyntaxError('malformed role JSON')}})});try{await flush();assert.equal(invalid.roleCalls.length,1);assert.equal(invalid.calls.length,0);assert.equal(clock.timers.size,0);assert(!findElement(invalid.draw(),'iframe'));}finally{invalid.dispose()}
});
test('a session/profile account mismatch immediately hides the frame and ignores the older buffered document',async()=>{
 let resolve;const pending=new Promise(r=>{resolve=r}),h=componentHarness('offline-account-a',{fetch:async()=>({ok:true,status:200,text:()=>pending})});
 try{await flush();h.rerenderSession({...h.session,user:{id:'offline-account-b'}});resolve(HTML);await flush();assert(!findElement(h.draw(),'iframe'));assert.equal(h.restoreCalls.length,0);assert.equal(h.states[1],'');}
 finally{resolve(HTML);h.dispose()}
});

test('a mismatched account cannot use grant controls from an already loaded owner frame',async()=>{
 const h=componentHarness('offline-loaded-owner');try{await flush();assert(findElement(h.draw(),'iframe'));h.states[4]=true;h.rerenderSession({...h.session,user:{id:'offline-another-account'}});const all=elements(h.draw());assert(!all.some(n=>n.type==='iframe'));assert(all.find(n=>n.props?.['aria-label']==='管理后台查看授权').props.disabled);assert(!all.some(n=>n.type?.name==='AdminPreviewGrants'));}finally{h.dispose()}
});
