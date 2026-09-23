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
  const listeners = new Map(), effects = [], effectDeps = [], refs = [], states = [], cleanups = [], calls = [];
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
    addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name),
    setInterval: callback => { intervalCheck = callback; return 1; }, clearInterval: () => {},
  };
  const localStorage = { getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (throwOnWrite) throw Error('Synthetic quota failure'); values.set(key, value); },
    removeItem(key) { if (throwOnWrite) throw Error('Synthetic quota failure'); values.delete(key); } };
  let environment, client, liveClient;
  const requireStub = name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.endsWith('/ownerPreviewDocument')) return api;
    if (name.endsWith('/ownerPreviewShell')) { const helper={exports:{}};vm.runInNewContext(transpile(fs.readFileSync(path.join(repo,'src/lib/ownerPreviewShell.ts'),'utf8')),{module:helper,exports:helper.exports,document:environment.document});return helper.exports; }
    if (name.endsWith('/dashboardAuthClient')) return { ensureDashboardSession: async candidate => candidate };
    if (name.endsWith('/adminLiveBridge')) {
      if (!liveClient) { const module={exports:{}};const filename=path.join(repo,'src/lib/adminLiveBridge.ts');vm.runInNewContext(transpile(fs.readFileSync(filename,'utf8')),{...environment,module,exports:module.exports,setTimeout,clearTimeout},{filename});liveClient=module.exports; }
      return liveClient;
    }
    if (name.endsWith('/adminPreviewClient')) {
      if (!client) {
        const box = { exports: {} }, filename = path.join(repo, 'src/lib/adminPreviewClient.ts');
        vm.runInNewContext(transpile(fs.readFileSync(filename, 'utf8')), { ...environment, module: box, exports: box.exports }, { filename });
        client = box.exports;
      }
      return client;
    }
    if (name === './AdminPreviewGrants') return { default: () => null };
    throw Error('Unexpected component test import: ' + name);
  };
  environment = {
    module: box, exports: box.exports, require: requireStub, window, localStorage, URL, AbortController,
    crypto: { randomUUID: () => 'offline-frame-channel' },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://offline.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'offline-public-key' } },
    fetch: async (url, init) => { calls.push({ url, init }); return options.fetch ? options.fetch(url, init) : { ok: true, status: 200, text: async () => HTML }; },
  };
  vm.runInNewContext(transpile(fs.readFileSync(componentPath, 'utf8')), environment, { filename: componentPath });
  const props = { canView: options.canView ?? true, session: currentSession,
    profile: { active: options.active ?? true, role: options.role || 'owner', auth_user_id: userId }, onClose: options.onClose || (()=>{}) };
  const draw = () => { hookIndex = refIndex = callbackIndex = effectIndex = 0; return box.exports.default(props); };
  draw(); const child = {}; refs[0].current = { contentWindow: child };
  for (const effect of effects.splice(0)) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
  return { values, prefix, child, calls, states, draw, effectDeps, rerenderSession:next=>{props.session=next;return draw()}, session:currentSession, channel: () => refs[1].current,
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
  h.dispose();
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
    assert.equal(h.states[0], ''); assert(h.states[1], 'revocation remains visible as an error');
    // Deliberately resolve despite abort: a buffered or non-abortable body must still be ignored.
    resolveHTML(HTML); await flush();
    assert.equal(h.states[0], '', 'late initial HTML cannot restore documentHtml after revocation');
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
    assert.equal(h.calls.length, 0); assert.equal(findElement(h.draw(), 'iframe'), undefined);
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
  h.checkPermission();await flush();assert.equal(h.calls.length,2);assert(h.calls[1].url.endsWith('?check=1'));assert.equal(h.calls[1].init.headers.Authorization,'Bearer offline-new-access');
  assert.equal(findElement(h.draw(),'iframe').props.srcDoc,before);h.dispose();
});

test('shell return command only accepts the current opaque frame and never changes draft authorization', async () => {
  let closed=0;const h=componentHarness('shell-viewer',{role:'viewer',canView:true,onClose:()=>closed++});await flush();
  const message={source:h.child,origin:'null',data:{type:'hensem-owner-preview-shell',channel:h.channel(),command:'back'}};
  for(const event of [{...message,source:{}},{...message,origin:'https://other.invalid'},{...message,data:{...message.data,channel:'stale'}},{...message,data:{...message.data,command:'grant'}},{...message,data:null}])h.send(event);
  assert.equal(closed,0);h.send(message);assert.equal(closed,1);assert.equal(h.values.get(h.prefix+KEY),'this-account-draft');
  assert.equal(findElement(h.draw(),'header'),undefined,'no outer preview header takes viewport space');
  h.dispose();
});

function requestHarness(options = {}) {
  const filename = path.join(repo, 'src/lib/adminPreviewClient.ts'), box = { exports: {} }, calls = [];
  const session = { user: { id: 'offline-request-user' }, access_token: 'offline-old-token', refresh_token: 'offline-refresh-token' };
  const fresh = { ...session, user: { id: options.freshUser || session.user.id }, access_token: 'offline-fresh-token' };
  vm.runInNewContext(transpile(fs.readFileSync(filename, 'utf8')), {
    module: box, exports: box.exports, URL,
    require: name => { assert.equal(name, './dashboardAuthClient'); return { ensureDashboardSession: async () => fresh }; },
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: options.base || 'https://offline.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'offline-public-key' } },
    fetch: async (url, init) => { calls.push({ url, init }); return { ok: !(options.status >= 400), status: options.status || 200, json: async () => ({ canView: true, canManage: false }) }; },
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
