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
  const lifecycle=options.commitEffects===true,effectRecords=[],callbackRecords=[],documentListeners=new Map(),intervals=new Map(),bridgeRecords=[],presenceSubscriptions=new Set(),liveCalls=[],posted=[];
  let renderPending=false,disposed=false,intervalId=0,channelId=0,currentChild=null,currentFrameKey=null;
  const sameDeps=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
  function addListener(registry,name,callback){if(!registry.has(name))registry.set(name,new Set());registry.get(name).add(callback)}
  function removeListener(registry,name,callback){const set=registry.get(name);set?.delete(callback);if(!set?.size)registry.delete(name)}
  function trackedBridge(kind,install,settings){const stop=install(settings),record={kind,source:settings.source(),channel:settings.channel(),active:true};bridgeRecords.push(record);return()=>{stop();record.active=false}}
  const values = new Map([[AUTH, 'offline-host-auth-must-not-enter-frame']]);
  const prefix = `hensem:owner-preview:${userId}:`;
  values.set(prefix + KEY, 'this-account-draft');
  values.set('hensem:owner-preview:other-account:' + KEY, 'other-account-draft');
  let hookIndex = 0, refIndex = 0, callbackIndex = 0, effectIndex = 0, throwOnWrite = false, intervalCheck = null;
  const callbacks = [];
  const react = {
    useState(initial) { const index = hookIndex++; if (!(index in states)) states[index] = initial;
      return [states[index], value => { const next=typeof value === 'function' ? value(states[index]) : value;if(lifecycle&&!Object.is(next,states[index]))renderPending=true;states[index]=next; }]; },
    useRef(initial) { const index = refIndex++; return refs[index] || (refs[index] = { current: initial }); },
    useCallback(callback,deps) { const index = callbackIndex++;if(lifecycle){if(!sameDeps(callbackRecords[index]?.deps,deps))callbackRecords[index]={deps,callback};return callbackRecords[index].callback}return callbacks[index] || (callbacks[index] = callback); },
    useEffect(callback, deps) { const index=effectIndex++;effectDeps[index]=deps;if(lifecycle){effectRecords[index]={...effectRecords[index],callback,nextDeps:deps}}else effects.push(callback); },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const currentSession = { user: { id: userId }, access_token: 'offline-host-access', refresh_token: 'offline-host-refresh' };
  const box = { exports: {} };
  const window = {
    location: { origin: 'https://app.offline.invalid', href: 'https://app.offline.invalid/#owner-admin-preview', search: '', reload:options.onReload||(()=>{}), ...options.location },
    history: {replaceState(_state,_title,url){window.location.href=String(url);window.location.search=new URL(url).search;}},
    addEventListener: (name, callback) => lifecycle?addListener(listeners,name,callback):listeners.set(name, callback), removeEventListener: (name,callback) => lifecycle?removeListener(listeners,name,callback):listeners.delete(name),
    setInterval: (callback,ms) => { if(ms===60000)intervalCheck = callback;if(lifecycle){intervals.set(++intervalId,callback);return intervalId}return 1; }, clearInterval: id => {if(lifecycle){const callback=intervals.get(id);intervals.delete(id);if(intervalCheck===callback)intervalCheck=null}},
    setTimeout:options.setTimeout||setTimeout,clearTimeout:options.clearTimeout||clearTimeout,
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
    if (name.endsWith('/dashboardAuthClient')) return { DashboardHttpError:authErrors.DashboardHttpError, dashboardResponseError: authErrors.dashboardResponseError, ensureDashboardSession: async candidate => options.ensure?options.ensure(candidate):candidate, normalizedManagementPermissions: profile=>({manage_viewers:profile.management_permissions?.manage_viewers!==false}) };
    if (['adminConfigurationRequest','adminWorkorderRecordsRequest','depositStatisticsRequest','portalOperationLogsRequest'].some(helper=>name.endsWith('/'+helper))) { const helper={exports:{}};vm.runInNewContext(transpile(fs.readFileSync(path.join(repo,'src/lib/'+name.split('/').pop()+'.ts'),'utf8')),{module:helper,exports:helper.exports});return helper.exports; }
    if (name.endsWith('/adminLiveBridge')) {
      if (!liveClient) { const module={exports:{}};const filename=path.join(repo,'src/lib/adminLiveBridge.ts');vm.runInNewContext(transpile(fs.readFileSync(filename,'utf8')),{...environment,module,exports:module.exports,setTimeout,clearTimeout},{filename});liveClient={...module.exports,...(lifecycle?{installAdminLiveBridge:settings=>trackedBridge('live',module.exports.installAdminLiveBridge,settings)}:{}),makeAdminLiveDocument(...args){phases.push('live-document');return module.exports.makeAdminLiveDocument(...args)}}; }
      return liveClient;
    }
    if (name.endsWith('/dashboardPresenceBridge')) {
      if (!presenceClient) { const helper={exports:{}};const filename=path.join(repo,'src/lib/dashboardPresenceBridge.ts');vm.runInNewContext(transpile(fs.readFileSync(filename,'utf8')),{...environment,module:helper,exports:helper.exports,require:()=>({}),URL},{filename});presenceClient={...helper.exports,installDashboardPresenceBridge:lifecycle?settings=>trackedBridge('presence',helper.exports.installDashboardPresenceBridge,{...settings,subscribe:callback=>{presenceSubscriptions.add(callback);return()=>presenceSubscriptions.delete(callback)},viewer:()=>props.session.user.id,snapshot:()=>({onlineCount:0,observedAt:'2026-10-10T00:00:00Z',scope:'authorized',accounts:[],loading:false,reason:'initial'}),refresh:()=>{}}):()=>()=>{},makeDashboardPresenceDocument(...args){phases.push('presence-document');return helper.exports.makeDashboardPresenceDocument(...args)}}; }
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
    if (name.endsWith('/dashboardRelease')) {const helper={exports:{}};vm.runInNewContext(transpile(fs.readFileSync(path.join(repo,'src/lib/dashboardRelease.ts'),'utf8')),{...environment,module:helper,exports:helper.exports});return helper.exports;}
    throw Error('Unexpected component test import: ' + name);
  };
  environment = {
    module: box, exports: box.exports, require: requireStub, window, localStorage, URL, AbortController, Error, setTimeout:options.setTimeout||setTimeout,clearTimeout:options.clearTimeout||clearTimeout,
    ...(options.console?{console:options.console}:{}),
    crypto: { randomUUID: () => lifecycle?'offline-frame-channel-'+(++channelId):'offline-frame-channel' },
    document: { visibilityState: 'visible', addEventListener(name,callback) {if(lifecycle)addListener(documentListeners,name,callback)}, removeEventListener(name,callback) {if(lifecycle)removeListener(documentListeners,name,callback)} },
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://offline.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'offline-public-key',NEXT_PUBLIC_DASHBOARD_RELEASE:options.releaseRevision||'',NEXT_PUBLIC_DASHBOARD_BASE_PATH:'/hensem-data-center' } },
    fetch: async (url, init) => { if(url.endsWith('/rest/v1/rpc/dashboard_role_access')){roleCalls.push({url,init});if(options.roleFetch)return options.roleFetch(url,init);return {ok:true,status:200,json:async()=>({mode:(options.role||'owner')==='owner'?'owner':'legacy',roleId:null,roleName:null,version:0,permissions:[],canView:true})};}if(lifecycle&&url.includes('/rest/v1/rpc/')){liveCalls.push({url,init});return options.liveFetch?options.liveFetch(url,init):{ok:true,status:200,json:async()=>({platforms:[]})}} phases.push('fetch'); calls.push({ url, init }); const response=options.fetch ? await options.fetch(url, init) : url.endsWith('?check=1')?{ok:true,status:200,json:async()=>({ok:true,canView:true,canManage:(options.role||'owner')==='owner'})}:{ ok: true, status: 200, text: async () => HTML }; return typeof response.text==='function'?{...response,text:async()=>{phases.push('response:text');return response.text()}}:response; },
  };
  vm.runInNewContext(transpile(fs.readFileSync(componentPath, 'utf8')), environment, { filename: componentPath });
  const props = { canView: options.canView ?? true, session: currentSession,
    profile: { active: options.active ?? true, role: options.role || 'owner', permissions:options.permissions, management_permissions:options.management_permissions, auth_user_id: userId,...(options.profile||{}) }, onLogout: options.onLogout || (()=>{}) };
  const draw = () => { hookIndex = refIndex = callbackIndex = effectIndex = 0; return box.exports.default(props); };
  const commit=()=>{
    assert(lifecycle&&!disposed,'committed effects require a live lifecycle fixture');
    for(let attempt=0;attempt<20;attempt++){
      renderPending=false;const tree=draw(),frame=findElement(tree,'iframe'),mounted=!!frame;
      if(mounted){if(!currentChild||currentFrameKey!==frame.key)currentChild={postMessage(data,target){posted.push({source:this,data,target})}};currentFrameKey=frame.key;refs[0].current={contentWindow:currentChild}}
      else {currentChild=null;currentFrameKey=null;refs[0].current=null}
      const changed=effectRecords.filter(record=>!record.committed||!sameDeps(record.deps,record.nextDeps));
      // React commits refs, then cleans up changed passive effects before setup.
      for(const record of changed){record.cleanup?.();record.cleanup=null}
      for(const record of changed){record.deps=record.nextDeps;record.committed=true;record.cleanup=record.callback()||null}
      if(!renderPending)return tree;
    }
    throw Error('Synthetic effect commit did not settle');
  };
  const child = {};
  if(lifecycle)commit();else{draw();refs[0].current={contentWindow:child};for(const effect of effects.splice(0)){const cleanup=effect();if(cleanup)cleanups.push(cleanup)}}
  return { values, prefix, get child(){return lifecycle?currentChild:child}, calls, roleCalls, states, draw, commit,effectDeps, phases, restoreCalls,liveCalls,posted,bridgeRecords,
    rerenderSession:next=>{props.session=next;return lifecycle?commit():draw()},rerenderProps:next=>{Object.assign(props,next);return lifecycle?commit():draw()},profile:()=>props.profile,session:currentSession, channel: () => refs[1].current,
    activeBridges:kind=>bridgeRecords.filter(record=>record.kind===kind&&record.active).length,presenceSubscribers:()=>presenceSubscriptions.size,listenerCount:name=>lifecycle?listeners.get(name)?.size||0:Number(listeners.has(name)),documentListenerCount:name=>documentListeners.get(name)?.size||0,intervalCount:()=>intervals.size,
    send: event => lifecycle?[...(listeners.get('message')||[])].forEach(callback=>callback(event)):listeners.get('message')?.(event), dispose: () => {if(disposed)return;disposed=true;if(lifecycle){for(const record of effectRecords){record.cleanup?.();record.cleanup=null}refs[0].current=null;currentChild=null}else cleanups.forEach(cleanup=>cleanup())},
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

test('a definitive 403 after an initial timeout clears authorization and late HTML cannot restore it', async () => {
  let resolveHTML,reads=0;const lateHTML=new Promise(resolve=>{resolveHTML=resolve}),clock=retryClock();
  const h=componentHarness('offline-revoked-user',{...clock,fetch:async()=>++reads===1?{ok:true,status:200,text:()=>lateHTML}:{ok:false,status:403,json:async()=>({code:'preview_denied'})}});
  try {
    await flush();assert.equal(h.calls.length,1);const initialSignal=h.calls[0].init.signal;
    h.checkPermission();await flush();assert.equal(h.calls.length,1,'an existing initial verification is never duplicated');
    clock.next();await flush();assert.equal(initialSignal.aborted,true);clock.next();await flush();assert.equal(h.calls.length,2);
    assert.equal(h.states[1],'');assert(h.states[2]);resolveHTML(HTML);await flush();assert.equal(h.states[1],'');assert.equal(h.restoreCalls.length,0);assert.equal(findElement(h.draw(),'iframe'),undefined);
    h.checkPermission();await flush();assert.equal(h.calls.length,2,'explicit denial still permanently stops this verification lifecycle');assert.equal(clock.timers.size,0);
  } finally { resolveHTML(HTML);h.dispose(); }
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
    require: name => { if(name==='./ownerPreviewVerification')return require('./load-typescript.cjs').loadTs(path.join(repo,'src/lib/ownerPreviewVerification.ts'));assert.equal(name, './dashboardAuthClient'); return { DashboardHttpError:authErrors.DashboardHttpError, dashboardResponseError: authErrors.dashboardResponseError, ensureDashboardSession: async () => fresh }; },
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
  const tabs=all.filter(n=>n.props?.role==='tab');assert.deepEqual(tabs.map(n=>n.props.children),options.role==='owner'?['前端工单账号','后台账号','角色管理']:['前端工单账号','后台账号']);assert.equal(tabs[0].props.disabled,!options.workorder);assert.equal(tabs[1].props.disabled,!options.accounts);
  assert.equal(all.some(n=>n.type?.name==='WorkOrderAccountAdmin'),options.workorder);assert.equal(all.some(n=>n.type?.name==='AdminControlCenter'),!options.workorder&&options.accounts);
  assert(!all.some(n=>n.props?.role==='dialog'||n.props?.['aria-modal']),'page is inline, not another dialog');
  assert(!all.some(n=>n.type==='button'&&/^(关闭|管理后台账号|管理工单账号)$/.test(n.props.children)));
  const page=all.find(n=>n.props?.className?.includes('owner-preview-account-workspace'));assert.deepEqual(JSON.parse(JSON.stringify(page.props.style)),{top:143,left:242,width:1200});
  if(options.accounts){tabs[1].props.onClick();tree=h.draw();all=elements(tree);const component=all.find(n=>n.type?.name==='AdminControlCenter');assert(component);assert.equal(component.props.accountsOnlyLoading,true);assert.equal(component.props.section,'accounts');assert.equal(component.props.session,h.session)}else assert(all.some(n=>n.props?.role==='alert'));
  // Old allowlisted commands cannot override the host's current permission gate.
  send({command:'open-workorder-accounts'});assert.equal(elements(h.draw()).some(n=>n.type?.name==='WorkOrderAccountAdmin'),options.workorder);
  send({command:'open-accounts'});assert.equal(elements(h.draw()).some(n=>n.type?.name==='AdminControlCenter'),options.accounts);
  assert.equal(findElement(h.draw(),'iframe').props.srcDoc,before);assert.equal(h.calls.length,reads,'switching account tabs does not reload preview');
  send({command:'account-page',active:false});assert.equal(elements(h.draw()).find(n=>n.props?.className?.includes('owner-preview-account-workspace')).props.hidden,true);assert(elements(h.draw()).filter(n=>['AdminControlCenter','WorkOrderAccountAdmin'].includes(n.type?.name)).every(n=>n.props.active===false));assert.equal(findElement(h.draw(),'iframe').props.srcDoc,before);
  send({command:'account-page',active:true,bounds:{top:158,left:242,width:980}});assert.equal(elements(h.draw()).some(n=>n.type?.name==='AdminControlCenter'),options.accounts,'return keeps chosen backend tab');assert.equal(h.calls.length,reads);h.dispose();
 }
});
test('wrong-origin, stale-channel and malformed layout messages cannot open host account controls',async()=>{
 const h=componentHarness();await flush();const base={source:h.child,origin:'null',data:{type:'hensem-owner-preview-shell',channel:h.channel(),command:'account-page',active:true,bounds:{top:120,left:230,width:1100}}};
 for(const event of [{...base,source:{}},{...base,origin:'https://spoof.invalid'},{...base,data:{...base.data,channel:'old'}},{...base,data:{...base.data,bounds:{top:0,left:-1,width:900}}},{...base,data:{...base.data,bounds:{top:0,left:0,width:'100%'}}}]){h.send(event);assert(!elements(h.draw()).some(n=>n.props?.className?.includes('owner-preview-account-workspace')))}h.dispose();
});

test('visited account tabs retain separate panels, defer sibling invalidation and leave no account cache in browser storage',async()=>{
 const h=componentHarness('account-workspace',{commitEffects:true});
 const send=data=>{h.send({source:h.child,origin:'null',data:{type:'hensem-owner-preview-shell',channel:h.channel(),...data}});return h.commit()};
 const component=name=>elements(h.draw()).find(n=>n.type?.name===name);
 const tab=id=>elements(h.draw()).find(n=>n.props?.id===id);
 try{
  await flush();h.commit();const reads=h.calls.length,storage=[...h.values];
  send({command:'account-page',active:true,bounds:{top:143,left:242,width:1200}});
  assert(component('WorkOrderAccountAdmin'));assert(!component('AdminControlCenter'));assert(!component('DashboardRoleManager'),'unvisited tabs are not mounted');
  tab('owner-workorder-panel').props.onScroll({currentTarget:{scrollTop:420}});
  const workspace=elements(h.draw()).find(n=>n.props?.className?.includes('owner-preview-account-workspace')),key=workspace.key;
  tab('owner-backend-tab').props.onClick();h.commit();
  assert.equal(component('WorkOrderAccountAdmin').props.active,false);assert.equal(component('AdminControlCenter').props.active,true);
  assert.equal(tab('owner-workorder-panel').props.hidden,true);assert.equal(tab('owner-backend-panel').props.hidden,false);
  tab('owner-workorder-panel').props.onScroll({currentTarget:{scrollTop:0}});tab('owner-backend-panel').props.onScroll({currentTarget:{scrollTop:860}});
  tab('owner-roles-tab').props.onClick();h.commit();
  assert.equal(component('AdminControlCenter').props.active,false);assert.equal(component('DashboardRoleManager').props.active,true);
  assert.equal(elements(h.draw()).filter(n=>n.props?.role==='tabpanel').length,3,'one stable scroll panel per visited tab');
  component('DashboardRoleManager').props.onDirectoryChanged();h.commit();
  assert.equal(component('DashboardRoleManager').props.refreshVersion,0);assert.equal(component('AdminControlCenter').props.refreshVersion,1);assert.equal(component('WorkOrderAccountAdmin').props.refreshVersion,0,'backend roles do not invalidate workorder identities');
  component('WorkOrderAccountAdmin').props.onDirectoryChanged();h.commit();assert.equal(component('AdminControlCenter').props.refreshVersion,1);assert.equal(component('DashboardRoleManager').props.refreshVersion,0,'workorder saves do not invalidate backend directories');
  tab('owner-backend-tab').props.onClick();h.commit();assert.equal(component('AdminControlCenter').props.active,true);assert.equal(component('AdminControlCenter').props.refreshVersion,1);
  const backendScroll={scrollTop:0};tab('owner-backend-panel').props.ref(backendScroll);assert.equal(backendScroll.scrollTop,860);
  const stableRef=tab('owner-backend-panel').props.ref;backendScroll.scrollTop=905;h.commit();assert.equal(tab('owner-backend-panel').props.ref,stableRef,'ordinary authorization rerenders do not reattach the scroll ref');assert.equal(backendScroll.scrollTop,905,'ordinary rerenders do not interrupt scrolling');
  component('AdminControlCenter').props.onDirectoryChanged();h.commit();assert.equal(component('DashboardRoleManager').props.refreshVersion,1);assert.equal(component('WorkOrderAccountAdmin').props.refreshVersion,0);
  tab('owner-roles-tab').props.onClick();h.commit();tab('owner-backend-tab').props.onClick();h.commit();assert.equal(component('AdminControlCenter').props.refreshVersion,1,'unchanged navigation does not mark another read');
  send({command:'account-page',active:false});assert(['AdminControlCenter','WorkOrderAccountAdmin','DashboardRoleManager'].every(name=>component(name).props.active===false));
  send({command:'account-page',active:true,bounds:{top:158,left:242,width:980}});assert.equal(component('AdminControlCenter').props.active,true);assert.equal(elements(h.draw()).find(n=>n.props?.className?.includes('owner-preview-account-workspace')).key,key);
  tab('owner-workorder-tab').props.onClick();h.commit();const workorderScroll={scrollTop:0};tab('owner-workorder-panel').props.ref(workorderScroll);assert.equal(workorderScroll.scrollTop,420,'each tab keeps its own scroll position while hidden scroll events are ignored');
  assert.equal(h.calls.length,reads);assert.deepEqual([...h.values],storage);
 }finally{h.dispose()}
});

test('account directory cache is destroyed on actor, scope, management permission and view-access changes',async()=>{
 for(const change of ['actor','scope','management','view']){
  const h=componentHarness('account-isolation-'+change,{commitEffects:true,...(['scope','management'].includes(change)?{role:'admin',profile:{data_scope:{mode:'selected',countries:['IN']}}}:{})});
  try{
   await flush();h.commit();h.send({source:h.child,origin:'null',data:{type:'hensem-owner-preview-shell',channel:h.channel(),command:'account-page',active:true,bounds:{top:143,left:242,width:1200}}});h.commit();
   const tab=elements(h.draw()).find(n=>n.props?.id==='owner-backend-tab');tab.props.onClick();h.commit();assert(elements(h.draw()).some(n=>n.type?.name==='AdminControlCenter'));
   if(change==='actor')h.rerenderSession({...h.session,user:{id:'different-account'}});
   else if(change==='scope')h.rerenderProps({profile:{...h.profile(),data_scope:{mode:'selected',countries:['VN']}}});
   else if(change==='management')h.rerenderProps({profile:{...h.profile(),management_permissions:{manage_viewers:false}}});
   else h.rerenderProps({canView:false});
   assert(!elements(h.draw()).some(n=>n.type?.name==='AdminControlCenter'),change+' cannot retain the previous directory');
  }finally{h.dispose()}
 }
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
test('verification warnings preserve safe phase diagnostics as one browser-readable string',async()=>{
 const secret='synthetic-token user@example.invalid https://private.invalid/?token=secret';
 const cases=[
  {stage:'role',code:'http_503',options:{roleFetch:async()=>({ok:false,status:503,json:async()=>({code:secret,message:secret,access_token:secret})})}},
  {stage:'preview-request',code:'owner_preview_network_error',options:{fetch:async()=>{throw new TypeError(secret)}}},
  {stage:'preview-body',code:'owner_preview_timeout',deadline:true,options:{fetch:async()=>({ok:true,status:200,text:async()=>new Promise(()=>{})})}},
 ];
 for(const scenario of cases){
  const clock=retryClock(),warnings=[];
  const h=componentHarness('offline-safe-diagnostic',{...clock,...scenario.options,console:{warn:(...args)=>warnings.push(args)}});
  try{
   await flush();if(scenario.deadline){assert.equal(warnings.length,0);clock.next();await flush()}
   assert.equal(warnings.length,1);assert.equal(warnings[0].length,1,'object arguments are not readable in browser log captures');
   const message=warnings[0][0];assert.equal(typeof message,'string');assert(message.startsWith('后台验证读取失败 '));
   const diagnostic=JSON.parse(message.slice('后台验证读取失败 '.length));
   assert.deepEqual(Object.keys(diagnostic).sort(),['code','elapsedMs','stage']);assert.equal(diagnostic.stage,scenario.stage);assert.equal(diagnostic.code,scenario.code);
   assert(Number.isInteger(diagnostic.elapsedMs)&&diagnostic.elapsedMs>=0);
   for(const forbidden of ['synthetic-token','user@example.invalid','private.invalid','access_token','offline-host-access','offline-host-refresh','Object'])assert(!message.includes(forbidden),forbidden+' is not logged');
   assert.equal(clock.timers.size,1,'the existing bounded retry still waits for backoff');
  }finally{h.dispose()}
 }
});
test('temporary entry 503 automatically rereads role and fresh HTML after short backoff, without publishing stale permissions',async()=>{
 const clock=retryClock();let n=0;const h=componentHarness('offline-recovery',{...clock,fetch:async()=>++n===1?{ok:false,status:503,json:async()=>({code:'profile_unavailable'})}:{ok:true,status:200,text:async()=>HTML}});
 try{await flush();assert.equal(h.calls.length,1);assert.equal(h.states[0],null);assert(!findElement(h.draw(),'iframe'));assert.match(JSON.stringify(h.draw()),/重新验证查看权限.*2\/3/);assert.deepEqual(clock.delays,[15000,500]);assert.equal(clock.timers.size,1,'the completed attempt clears its deadline and leaves only backoff');h.checkPermission();await flush();assert.equal(h.calls.length,1,'focus/timer verification cannot restart the backoff budget');clock.next();await flush();assert.equal(h.calls.length,2);assert.equal(h.roleCalls.length,2);assert(findElement(h.draw(),'iframe'));assert.equal(h.states[2],'');assert.equal(clock.timers.size,0);assert(!findElement(h.draw(),'iframe').props.srcDoc.includes('offline-host-access'));}
 finally{h.dispose()}
});
test('three transient failures bound one automatic burst and expose reload and logout controls',async()=>{
 const clock=retryClock(),h=componentHarness('offline-permanent-outage',{...clock,fetch:async()=>({ok:false,status:503,json:async()=>({code:'role_access_unavailable'})})});
 try{await flush();clock.next();await flush();clock.next();await flush();assert.equal(h.calls.length,3);assert.equal(h.roleCalls.length,3);assert.deepEqual(clock.delays,[15000,500,15000,1500,15000]);assert.equal(clock.timers.size,0);assert(!findElement(h.draw(),'iframe'));assert(h.states[2]);const buttons=elements(h.draw()).filter(n=>n.type==='button');assert(buttons.some(n=>n.props.children==='重新加载'));assert(buttons.some(n=>n.props.children==='退出登录'));h.checkPermission();await flush();assert.equal(h.calls.length,4,'a later scheduled recovery starts a new bounded burst');}
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

test('the formal owner page keeps role management and does not expose the retired grant control',async()=>{
 const h=componentHarness('offline-loaded-owner');try{await flush();assert(findElement(h.draw(),'iframe'));let all=elements(h.draw());assert(!all.some(n=>n.props?.['aria-label']==='管理后台查看授权'));assert(!all.some(n=>n.type?.name==='AdminPreviewGrants'));h.send({source:h.child,origin:'null',data:{type:'hensem-owner-preview-shell',channel:h.channel(),command:'account-page',active:true,bounds:{top:120,left:240,width:1000}}});all=elements(h.draw());const roleTab=all.find(n=>n.props?.id==='owner-roles-tab');assert(roleTab,'owner still manages the new role permissions');roleTab.props.onClick();assert(elements(h.draw()).some(n=>n.type?.name==='DashboardRoleManager'));h.rerenderSession({...h.session,user:{id:'offline-another-account'}});all=elements(h.draw());assert(!all.some(n=>n.type==='iframe'));assert(!all.some(n=>n.type?.name==='DashboardRoleManager'));assert(!all.some(n=>n.props?.['aria-label']==='管理后台查看授权'));}finally{h.dispose()}
});


test('a temporary periodic failure hides and freezes the mounted document; identical fresh authorization resumes it',async()=>{
 const clock=retryClock();let reads=0;const h=componentHarness('offline-stable-reconnect',{...clock,fetch:async()=>++reads===2?{ok:false,status:503,json:async()=>({code:'profile_unavailable'})}:{ok:true,status:200,text:async()=>HTML}});
 try{
  await flush();const before=findElement(h.draw(),'iframe').props.srcDoc;h.checkPermission();await flush();
  const paused=findElement(h.draw(),'iframe');assert.equal(paused.props.srcDoc,before);assert.equal(paused.props.style.display,'none');assert.equal(paused.props['aria-hidden'],true);assert.equal(h.states[0],null);
  h.send({source:h.child,origin:'null',data:{type:'hensem-owner-preview-draft',channel:h.channel(),key:KEY,value:'not-authorized-while-paused'}});assert.equal(h.values.get(h.prefix+KEY),'this-account-draft');
  clock.next();await flush();const resumed=findElement(h.draw(),'iframe');assert.equal(resumed.props.srcDoc,before);assert.equal(resumed.props.style,undefined);assert.equal(h.restoreCalls.length,1);assert.equal(h.calls.length,3);assert(!h.calls[2].url.endsWith('?check=1'));assert(h.states[0]);
 }finally{h.dispose()}
});
test('an extended outage retains hidden state and reconnects with fresh HTML; denial still destroys it immediately',async()=>{
 for(const outcome of ['same','changed','denied']){
  const clock=retryClock();let mode='ok';const h=componentHarness('offline-extended-'+outcome,{...clock,fetch:async url=>mode==='outage'?{ok:false,status:503,json:async()=>({code:'profile_unavailable'})}:mode==='denied'?{ok:false,status:403,json:async()=>({code:'preview_denied'})}:{ok:true,status:200,text:async()=>HTML+(mode==='changed'?'<!-- new protected version -->':''),json:async()=>({ok:true,canView:true,canManage:true})}});
  try{
   await flush();const before=findElement(h.draw(),'iframe').props.srcDoc;mode='outage';h.checkPermission();await flush();clock.next();await flush();clock.next();await flush();
   assert.equal(h.calls.length,4);assert.equal(clock.timers.size,0);assert.equal(findElement(h.draw(),'iframe').props.style.display,'none');assert.equal(h.states[0],null);
   const reconnect=elements(h.draw()).find(n=>n.type==='button'&&n.props.children==='重新连接');assert(reconnect);
   mode=outcome;reconnect.props.onClick();await flush();assert.equal(h.calls.length,5);
   if(outcome==='denied'){assert(!findElement(h.draw(),'iframe'));assert.equal(h.states[1],'');assert.equal(h.states[0],null)}
   else{const resumed=findElement(h.draw(),'iframe');assert.equal(resumed.props.style,undefined);assert.equal(h.restoreCalls.length,outcome==='same'?1:2);assert.equal(resumed.props.srcDoc===before,outcome==='same')}
  }finally{h.dispose()}
 }
});

const deferredRead=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
const protectedResponse=html=>({ok:true,status:200,text:async()=>html,json:async()=>({ok:true,canView:true,canManage:true})});
test('suspended account workspace discards all directories and reopens only its current tab after unchanged-frame verification',async()=>{
 const clock=retryClock();let failNext=false;
 const h=componentHarness('account-reverification',{commitEffects:true,...clock,fetch:async()=>{if(failNext){failNext=false;return{ok:false,status:503,json:async()=>({code:'profile_unavailable'})}}return protectedResponse(HTML)}});
 const send=data=>{h.send({source:h.child,origin:'null',data:{type:'hensem-owner-preview-shell',channel:h.channel(),...data}});return h.commit()};
 try{
  await flush();h.commit();const source=h.child;
  send({command:'account-page',active:true,bounds:{top:143,left:242,width:1200}});
  elements(h.draw()).find(n=>n.props?.id==='owner-backend-tab').props.onClick();h.commit();
  elements(h.draw()).find(n=>n.props?.id==='owner-backend-panel').props.onScroll({currentTarget:{scrollTop:720}});
  assert.equal(elements(h.draw()).filter(n=>n.props?.role==='tabpanel').length,2);
  failNext=true;h.checkPermission();await flush();h.commit();
  assert(!elements(h.draw()).some(n=>n.props?.className?.includes('owner-preview-account-workspace')));
  clock.next();await flush();h.commit();
  assert.equal(h.child,source,'frame geometry did not change and need not be sent again');
  const panels=elements(h.draw()).filter(n=>n.props?.role==='tabpanel');assert.equal(panels.length,1);assert.equal(panels[0].props.id,'owner-backend-panel');
  const scroll={scrollTop:720};panels[0].props.ref(scroll);assert.equal(scroll.scrollTop,0,'reverification does not revive old directory scroll state');
  assert.equal(elements(h.draw()).find(n=>n.type?.name==='AdminControlCenter').props.active,true);
  assert(!elements(h.draw()).some(n=>n.type?.name==='WorkOrderAccountAdmin'),'the inactive pre-verification directory is not revived');
 }finally{h.dispose()}
});
const liveEnvelope=(h,id,source=h.child,channel=h.channel())=>({source,origin:'null',data:{type:'hensem-admin-live-request',id,channel,request:{action:'catalog'},page:'overview'}});
function assertBridgeCounts(h,count){
 assert.equal(h.activeBridges('live'),count);assert.equal(h.activeBridges('presence'),count);assert.equal(h.presenceSubscribers(),count);
 assert.equal(h.listenerCount('message'),1+count*2,'one host receiver and at most one receiver per bridge');
 assert.equal(h.documentListenerCount('visibilitychange'),1);assert.equal(h.intervalCount(),1);
}

test('committed recovery effects reinstall one live/presence bridge and cancel active and queued reads without accumulating listeners',async()=>{
 const clock=retryClock();let failNext=false,held=null;
 const h=componentHarness('offline-effect-cycle',{commitEffects:true,...clock,
  fetch:async()=>{if(failNext){failNext=false;return {ok:false,status:503,json:async()=>({code:'profile_unavailable'})}}return protectedResponse(HTML)},
  liveFetch:async()=>held?held.promise:{ok:true,status:200,json:async()=>({platforms:[],marker:'fresh-result'})}});
 try{
  await flush();const initial=h.commit(),html=findElement(initial,'iframe').props.srcDoc,child=h.child,channel=h.channel();assertBridgeCounts(h,1);
  for(let cycle=0;cycle<4;cycle++){
   const read=deferredRead();held=read;const before=h.liveCalls.length,ids=Array.from({length:5},(_,i)=>'held-'+cycle+'-'+i);
   for(const id of ids)h.send(liveEnvelope(h,id));await flush();assert.equal(h.liveCalls.length-before,4,'the fifth read remains queued');
   failNext=true;h.checkPermission();await flush();const paused=h.commit();assertBridgeCounts(h,0);assert.equal(findElement(paused,'iframe').props.style.display,'none');assert.equal(h.child,child);assert.equal(h.channel(),channel);
   const cancelled=h.posted.filter(x=>ids.includes(x.data.id));assert.equal(cancelled.length,5);assert(cancelled.every(x=>x.data.code==='ADMIN_LIVE_CANCELLED'&&!Object.hasOwn(x.data,'result')));
   assert(h.liveCalls.slice(before).every(x=>x.init.signal.aborted),'all old transport controllers abort on suspension');
   held=null;clock.next();await flush();const resumed=h.commit();assertBridgeCounts(h,1);assert.equal(h.child,child);assert.equal(h.channel(),channel);assert.equal(findElement(resumed,'iframe').props.srcDoc,html);
   read.resolve({ok:true,status:200,json:async()=>({marker:'late-obsolete-result'})});await flush();h.commit();assert.equal(h.liveCalls.length-before,4,'cancelled queue never launches after recovery');assert.equal(h.posted.filter(x=>ids.includes(x.data.id)).length,5,'late old responses emit no second reply');
   const fresh='fresh-'+cycle;h.send(liveEnvelope(h,fresh));await flush();const reply=h.posted.filter(x=>x.data.id===fresh);assert.equal(reply.length,1);assert.equal(reply[0].data.result.marker,'fresh-result');assertBridgeCounts(h,1);
  }
  assert.equal(h.bridgeRecords.filter(x=>x.kind==='live').length,5);assert.equal(h.bridgeRecords.filter(x=>x.kind==='presence').length,5);
 }finally{h.dispose();assert.equal(h.activeBridges('live'),0);assert.equal(h.activeBridges('presence'),0);assert.equal(h.presenceSubscribers(),0);assert.equal(h.listenerCount('message'),0);assert.equal(h.documentListenerCount('visibilitychange'),0);assert.equal(h.intervalCount(),0);assert.equal(clock.timers.size,0)}
});

test('committed scope replacement during recovery discards the old bridge and requires new protected HTML before reconnecting',async()=>{
 const clock=retryClock(),fresh=deferredRead();let mode='ok';const h=componentHarness('offline-effect-scope',{commitEffects:true,...clock,role:'viewer',profile:{data_scope:{mode:'selected',countries:['IN']},updated_at:'scope-v1'},fetch:async()=>{
  if(mode==='outage'){mode='ok';return {ok:false,status:503,json:async()=>({code:'profile_unavailable'})}}
  return mode==='new-scope'?{ok:true,status:200,text:()=>fresh.promise}:protectedResponse(HTML);
 }});
 try{
  await flush();h.commit();const oldChild=h.child,oldChannel=h.channel();assertBridgeCounts(h,1);mode='outage';h.checkPermission();await flush();h.commit();assertBridgeCounts(h,0);
  mode='new-scope';h.rerenderProps({profile:{...h.profile(),data_scope:{mode:'selected',countries:['PK']},updated_at:'scope-v2'}});await flush();const waiting=h.commit();assert(!findElement(waiting,'iframe'));assert.notEqual(h.channel(),oldChannel);assertBridgeCounts(h,0);assert(h.bridgeRecords.filter(x=>x.channel===oldChannel).every(x=>!x.active));
  fresh.resolve(HTML+'<!-- fresh narrowed scope -->');await flush();const ready=h.commit();assertBridgeCounts(h,1);assert.notEqual(h.child,oldChild);assert(findElement(ready,'iframe').props.srcDoc.includes('fresh narrowed scope'));
  const reads=h.liveCalls.length;h.send(liveEnvelope(h,'old-scope-source',oldChild,h.channel()));h.send(liveEnvelope(h,'old-scope-channel',h.child,oldChannel));await flush();assert.equal(h.liveCalls.length,reads);assert(h.bridgeRecords.filter(x=>x.active).every(x=>x.channel===h.channel()&&x.source===h.child));
 }finally{fresh.resolve(HTML);h.dispose();assert.equal(h.listenerCount('message'),0);assert.equal(clock.timers.size,0)}
});

test('committed account replacement aborts the old recovery body and never reinstalls its frame or bridge',async()=>{
 const clock=retryClock(),oldBody=deferredRead(),newBody=deferredRead();let mode='ok';const h=componentHarness('offline-effect-account-a',{commitEffects:true,...clock,fetch:async()=>{
  if(mode==='outage'){mode='old-recovery';return {ok:false,status:503,json:async()=>({code:'profile_unavailable'})}}
  if(mode==='old-recovery')return {ok:true,status:200,text:()=>oldBody.promise};if(mode==='new-account')return {ok:true,status:200,text:()=>newBody.promise};return protectedResponse(HTML);
 }});
 try{
  await flush();h.commit();const oldChild=h.child,oldChannel=h.channel();assertBridgeCounts(h,1);mode='outage';h.checkPermission();await flush();h.commit();assertBridgeCounts(h,0);clock.next();await flush();h.commit();const oldRequest=h.calls.at(-1);assert.equal(oldRequest.init.signal.aborted,false,'the old recovery body is still pending');
  mode='new-account';h.rerenderProps({session:{...h.session,user:{id:'offline-effect-account-b'}},profile:{...h.profile(),auth_user_id:'offline-effect-account-b'}});await flush();h.commit();assert.equal(oldRequest.init.signal.aborted,true);assertBridgeCounts(h,0);assert.notEqual(h.channel(),oldChannel);
  oldBody.resolve(HTML+'<!-- obsolete account A -->');await flush();assert(!findElement(h.commit(),'iframe'));assert(h.bridgeRecords.filter(x=>x.channel===oldChannel).every(x=>!x.active));
  newBody.resolve(HTML+'<!-- account B -->');await flush();const ready=h.commit();assertBridgeCounts(h,1);assert.notEqual(h.child,oldChild);const html=findElement(ready,'iframe').props.srcDoc;assert(html.includes('account B'));assert(!html.includes('obsolete account A'));assert(!html.includes('this-account-draft'));
  const reads=h.liveCalls.length;h.send(liveEnvelope(h,'old-account-source',oldChild,h.channel()));h.send(liveEnvelope(h,'old-account-channel',h.child,oldChannel));await flush();assert.equal(h.liveCalls.length,reads);assert(h.bridgeRecords.filter(x=>x.active).every(x=>x.source===h.child&&x.channel===h.channel()));
 }finally{oldBody.resolve(HTML);newBody.resolve(HTML);h.dispose();assert.equal(h.listenerCount('message'),0);assert.equal(h.presenceSubscribers(),0);assert.equal(clock.timers.size,0)}
});

test('module denial replaces whole frame tabs once with fresh authorization, without logout or retry storm',async()=>{
 const fresh=deferredRead(),late=deferredRead();let docs=0,logout=0;
 const h=componentHarness('offline-live-revocation',{commitEffects:true,onLogout:()=>logout++,fetch:async()=>++docs===1?protectedResponse(HTML):{ok:true,status:200,text:()=>fresh.promise},liveFetch:async(url)=>url.endsWith('/dashboard_admin_live_rates')?{ok:false,status:403,json:async()=>({message:'role_permission_denied'})}:late.promise});
 try{await flush();h.commit();const oldChild=h.child,oldChannel=h.channel();oldChild.syntheticTabCaches={overview:[{marker:'PRIVATE_OLD_SCOPE'}],providers:[{marker:'PRIVATE_OTHER_TAB'}]};h.send(liveEnvelope(h,'old_tab'));const denied=liveEnvelope(h,'denied_button');denied.data.request={action:'rates'};denied.data.page='providers';h.send(denied);await flush();const waiting=h.commit();assert(!findElement(waiting,'iframe'));assertBridgeCounts(h,0);assert.notEqual(h.channel(),oldChannel);assert(h.liveCalls.every(call=>call.init.signal.aborted));assert.equal(logout,0);assert.equal(h.roleCalls.length,2);assert.equal(h.calls.length,2);assert(!h.calls[1].url.endsWith('?check=1'));
 fresh.resolve(HTML);await flush();h.commit();assertBridgeCounts(h,1);assert.notEqual(h.child,oldChild);assert.equal(h.child.syntheticTabCaches,undefined);late.resolve({ok:true,json:async()=>({marker:'PRIVATE_LATE_SCOPE'})});await flush();assert(!h.posted.some(reply=>reply.data.result?.marker==='PRIVATE_LATE_SCOPE'));
 const second=liveEnvelope(h,'second_denial');second.data.request={action:'rates'};second.data.page='providers';h.send(second);await flush();h.commit();assert(!findElement(h.draw(),'iframe'));assertBridgeCounts(h,0);assert.equal(h.roleCalls.length,2);h.checkPermission();h.checkPermission();await flush();assert.equal(h.roleCalls.length,2);assert.equal(logout,0);assert.match(h.states[2],/核对角色权限/);
 }finally{fresh.resolve(HTML);late.resolve({ok:true,json:async()=>({})});h.dispose()}
});

test('session and IP denials destroy cached tabs without automatic logout or data retry',async()=>{
 for(const code of ['application_session_denied','ip_denied','account_disabled']){let logout=0;const h=componentHarness('offline-live-'+code,{commitEffects:true,onLogout:()=>logout++,liveFetch:async()=>({ok:false,status:403,json:async()=>({code,message:'PRIVATE_SERVER'})})});try{await flush();h.commit();h.send(liveEnvelope(h,'denied'));await flush();h.commit();assert(!findElement(h.draw(),'iframe'));assertBridgeCounts(h,0);assert.equal(h.roleCalls.length,1);assert.equal(h.calls.length,1);h.checkPermission();await flush();assert.equal(h.roleCalls.length,1);assert.equal(logout,0);assert.match(h.states[2],/访问授权已失效/);assert.doesNotMatch(h.states[2],/PRIVATE_SERVER/);}finally{h.dispose()}}
});

test('same-account token replacement ignores an older live denial without rebuilding the current frame',async()=>{
 const old=deferredRead(),h=componentHarness('offline-same-user-live',{commitEffects:true,liveFetch:async()=>h.liveCalls.length===1?old.promise:{ok:true,status:200,json:async()=>({marker:'fresh'})}});
 try{await flush();h.commit();const child=h.child,channel=h.channel();h.send(liveEnvelope(h,'old'));await flush();h.rerenderSession({...h.session,access_token:'new-access',refresh_token:'new-refresh'});h.send(liveEnvelope(h,'fresh'));await flush();old.resolve({ok:false,status:401,json:async()=>({code:'application_session_denied'})});await flush();h.commit();assert(findElement(h.draw(),'iframe'));assert.equal(h.child,child);assert.equal(h.channel(),channel);assertBridgeCounts(h,1);assert.equal(h.posted.find(reply=>reply.data.id==='old').data.code,'ADMIN_LIVE_CANCELLED');assert.equal(h.states[2],'');}finally{h.dispose()}
});

test('old role, preview-check and protected-HTML denials revalidate the new same-account token instead of clearing its frame',async()=>{
 for(const phase of ['role','check','html']){
  const old=deferredRead();let roleReads=0,docReads=0,checkReads=0;
  const role={mode:'owner',roleId:null,roleName:null,version:0,permissions:[],canView:true};
  const h=componentHarness('offline-old-'+phase,{commitEffects:true,roleFetch:async()=>++roleReads===2&&phase==='role'?old.promise:{ok:true,status:200,json:async()=>role},fetch:async url=>{if(url.endsWith('?check=1'))return ++checkReads===1&&phase==='check'?old.promise:{ok:true,status:200,json:async()=>({ok:true,canView:true,canManage:true})};return ++docReads===1&&phase==='html'?old.promise:protectedResponse(HTML)}});
  try{await flush();h.commit();if(phase!=='html')h.checkPermission();await flush();const oldChild=h.child;h.rerenderSession({...h.session,access_token:'fresh-access',refresh_token:'fresh-refresh'});if(oldChild){h.send(liveEnvelope(h,'fresh'));await flush();}
   old.resolve({ok:false,status:403,json:async()=>({code:'application_session_denied'})});await flush();h.commit();assert(findElement(h.draw(),'iframe'),phase);assert.equal(h.states[2],'');assertBridgeCounts(h,1);assert.equal(h.roleCalls.at(-1).init.headers.Authorization,'Bearer fresh-access');if(oldChild)assert.equal(h.child,oldChild,'healthy mounted same-account frame survives obsolete verification denial');
  }finally{old.resolve(protectedResponse(HTML));h.dispose()}
 }
});

test('a current authority denial after ensure refresh remains terminal even when the call began with the old token',async()=>{
 for(const phase of ['live','check']){const old=deferredRead();let renewed=false;const h=componentHarness('offline-actual-authority-'+phase,{commitEffects:true,ensure:input=>renewed?{...input,access_token:'actual-access'}:input,fetch:async url=>url.endsWith('?check=1')?old.promise:protectedResponse(HTML),liveFetch:async()=>old.promise});
  try{await flush();h.commit();renewed=true;if(phase==='live')h.send(liveEnvelope(h,'held'));else h.checkPermission();await flush();h.rerenderSession({...h.session,access_token:'actual-access',refresh_token:'actual-refresh'});old.resolve({ok:false,status:401,json:async()=>({code:'application_session_denied'})});await flush();h.commit();assert(!findElement(h.draw(),'iframe'));assertBridgeCounts(h,0);assert(h.states[2]);}finally{old.resolve(protectedResponse(HTML));h.dispose()}
 }
});

test('initial verification is single-flight across timer and visibility-triggered checks',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),h=componentHarness('offline-initial-single-flight',{fetch:async()=>pending});
 try{await flush();assert.equal(h.calls.length,1);h.checkPermission();h.checkPermission();await flush();assert.equal(h.roleCalls.length,1);assert.equal(h.calls.length,1);resolve({ok:true,status:200,text:async()=>HTML});await flush();assert(findElement(h.draw(),'iframe'));}
 finally{resolve({ok:true,status:200,text:async()=>HTML});h.dispose()}
});
test('exhausted initial transport retries stay fail-closed but a later periodic check can recover',async()=>{
 const clock=retryClock();let healthy=false;const h=componentHarness('offline-initial-outage-recovery',{...clock,fetch:async()=>healthy?{ok:true,status:200,text:async()=>HTML}:{ok:false,status:503,json:async()=>({code:'upstream_unavailable'})}});
 try{await flush();clock.next();await flush();clock.next();await flush();assert.equal(h.calls.length,3);assert(!findElement(h.draw(),'iframe'));assert.equal(h.states[0],null);healthy=true;h.checkPermission();await flush();assert.equal(h.calls.length,4);assert(findElement(h.draw(),'iframe'));assert(h.states[0]);assert.equal(h.states[2],'');}
 finally{h.dispose()}
});

test('release notification starts only after authorization and keeps the mounted frame until the user reloads',async()=>{
 let reloads=0,resolveRelease;
 const h=componentHarness('offline-release',{commitEffects:true,releaseRevision:'a'.repeat(64),onReload:()=>reloads++,
  fetch:async url=>url.endsWith('/dashboard-release.json')?new Promise(resolve=>resolveRelease=resolve):url.endsWith('?check=1')?{ok:true,status:200,json:async()=>({ok:true,canView:true,canManage:true})}:{ok:true,status:200,text:async()=>HTML}});
 try{
  assert(!h.calls.some(call=>call.url.endsWith('/dashboard-release.json')));
  await flush();h.commit();await flush();
  const frame=findElement(h.draw(),'iframe'),source=frame.props.srcDoc,child=h.child;
  const calls=h.calls.filter(call=>call.url.endsWith('/dashboard-release.json'));assert.equal(calls.length,1);
  assert.equal(calls[0].init.credentials,'omit');assert.equal(calls[0].init.headers,undefined);
  resolveRelease({ok:true,headers:{get:()=> 'application/json'},json:async()=>({version:1,revision:'b'.repeat(64)})});await flush();h.commit();
  assert.equal(h.child,child);assert.equal(findElement(h.draw(),'iframe').props.srcDoc,source);assert.equal(reloads,0);
  const buttons=elements(h.draw()).filter(node=>node.type==='button'&&node.props.children==='重新加载');assert.equal(buttons.length,1);buttons[0].props.onClick();assert.equal(reloads,1);
  h.checkPermission();await flush();h.commit();assert.equal(h.calls.filter(call=>call.url.endsWith('/dashboard-release.json')).length,1);
  assert.equal(h.child,child);assert.match(JSON.stringify(h.draw()),/页面已更新/);
 }finally{h.dispose()}
 for(const options of [{canView:false},{active:false}]){
  const denied=componentHarness('offline-release-denied',{...options,commitEffects:true,releaseRevision:'a'.repeat(64)});
  try{await flush();denied.commit();assert.equal(denied.calls.length,0);assert.doesNotMatch(JSON.stringify(denied.draw()),/页面已更新/)}finally{denied.dispose()}
 }
});
