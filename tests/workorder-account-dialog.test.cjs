const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '..');
const ts = require(path.join(repo, 'node_modules/typescript'));
const compile = file => ts.transpileModule(fs.readFileSync(path.join(repo, file), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
}).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return node && typeof node === 'object' ? [node, ...nodes(node.props?.children)] : [];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return node == null || typeof node === 'boolean' ? '' : String(node);
}
const jsx = {jsx: (type, props) => ({type, props}), jsxs: (type, props) => ({type, props})};
const catalog = {teams: ['M8', '香港'], platforms: ['A', 'B', 'H'], platformTeams: {A: 'M8', B: 'M8', H: '香港'}};
const accounts = [
  {auth_user_id: 'a', username: 'alice', display_name: 'Alice 陈', role: 'agent', team: 'M8', platforms: ['A'], active: true, updated_at: 'version-a'},
  {auth_user_id: 'b', username: 'bravo', display_name: 'Bella 陈', role: 'supervisor', team: 'M8', platforms: ['B'], active: false, updated_at: 'version-b'},
  {auth_user_id: 'h', username: 'hkstaff', display_name: 'Alice Hong', role: 'auditor', team: '香港', platforms: ['H'], active: true, updated_at: 'version-h'},
];
const session = {user: {id: 'owner'}, access_token: 'synthetic-session'};
function ui(handler) {
  const states = [], refs = [], dependencies = [], effects = [], cleanups = [], calls = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0;
  const react = {
    useState(initial) {const n = stateIndex++; if (!(n in states)) states[n] = typeof initial === 'function' ? initial() : initial; return [states[n], value => {states[n] = typeof value === 'function' ? value(states[n]) : value;}];},
    useRef(initial) {const n = refIndex++; return refs[n] || (refs[n] = {current: initial});},
    useEffect(fn, values) {const n = effectIndex++; if (!dependencies[n] || values.some((v, i) => v !== dependencies[n][i])) {dependencies[n] = values; effects.push(() => {cleanups[n]?.(); cleanups[n] = fn();});}},
  };
  function AccountEditorDialog() {}
  const mod = {exports: {}};
  vm.runInNewContext(compile('src/components/WorkOrderAccountAdmin.tsx'), {
    module: mod, exports: mod.exports, AbortController, Error,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return jsx;
      if (name === './AccountEditorDialog') return {default: AccountEditorDialog};
      if (name.endsWith('.css')) return {};
      if (name.endsWith('/workOrderAccountClient')) return {workOrderAccountRequest: async (current, body, signal) => {
        calls.push({session: current, body: plain(body), signal});
        if (handler) return handler(body, signal);
        return {ok: true, accounts, catalog};
      }};
      throw Error('Unexpected import ' + name);
    },
  });
  const draw = () => {stateIndex = refIndex = effectIndex = 0; return mod.exports.default({session});};
  function dialog() {return nodes(draw()).find(node => node.type === AccountEditorDialog);}
  function form() {return nodes(dialog()).find(node => node.type === 'form');}
  function filterRoot() {return nodes(draw()).find(node => node.props?.className === 'wo-account-filters');}
  function field(root, label, type) {const parent = nodes(root).find(node => node.type === 'label' && text(node).startsWith(label)); assert(parent, 'label ' + label); const node = nodes(parent).find(node => node.type === type); assert(node, label + ' ' + type); return node;}
  function button(label, root = draw()) {const node = nodes(root).find(node => node.type === 'button' && text(node) === label); assert(node, 'button ' + label); return node;}
  function visibleUsers() {return nodes(draw()).filter(node => node.type === 'tr').slice(1).map(row => text(nodes(row).find(node => node.type === 'td')));}
  const api = {calls, states, draw, dialog, form, button, visibleUsers,
    effect() {effects.splice(0).forEach(fn => fn());},
    unmount() {cleanups.forEach(fn => fn?.());},
    change(label, value, type = 'input') {field(form(), label, type).props.onChange({target: {value}});},
    editorField(label, type = 'input') {return field(form(), label, type);},
    filter(label, value, type = 'input') {field(filterRoot(), label, type).props.onChange({target: {value}});},
    filterField(label, type = 'input') {return field(filterRoot(), label, type);},
  };
  draw(); api.effect(); return api;
}

test('account, name, role, team, platform and status filters intersect without sending new API requests', async () => {
  const h = ui(); await flush(); assert.deepEqual(h.visibleUsers(), ['alice', 'bravo', 'hkstaff']);
  h.filter('账号', '  BR  '); h.filter('姓名', ' 陈 '); h.filter('角色', 'supervisor', 'select');
  h.filter('团队', 'M8', 'select'); h.filter('平台', 'B', 'select'); h.filter('状态', 'disabled', 'select');
  assert.deepEqual(h.visibleUsers(), ['bravo']); assert.match(text(h.draw()), /共 3 个工单账号 · 当前显示 1 个/);
  h.filter('状态', 'active', 'select'); assert.deepEqual(h.visibleUsers(), []); assert.match(text(h.draw()), /没有符合搜索条件/);
  h.button('重置筛选').props.onClick(); assert.deepEqual(h.visibleUsers(), ['alice', 'bravo', 'hkstaff']);
  assert.equal(h.calls.length, 1, 'client filtering never rereads the directory');
});

test('changing the filter team clears the platform filter and limits its options to that team', async () => {
  const h = ui(); await flush(); h.filter('团队', 'M8', 'select'); h.filter('平台', 'A', 'select');
  assert.deepEqual(h.visibleUsers(), ['alice']); h.filter('团队', '香港', 'select');
  const select = h.filterField('平台', 'select'); assert.equal(select.props.value, '');
  assert.deepEqual(nodes(select).filter(n => n.type === 'option').map(text), ['全部平台', 'H']);
  assert.deepEqual(h.visibleUsers(), ['hkstaff']);
});

test('create is a dialog and cancel, close, refresh and reopening discard its password and draft', async () => {
  const h = ui(); await flush(); assert.equal(h.dialog(), undefined); assert.equal(h.form(), undefined);
  for (const close of ['cancel', 'close', 'refresh']) {
    h.button('新建工单账号').props.onClick(); assert.equal(h.dialog().props.title, '新建工单账号');
    h.change('账号', 'newstaff'); h.change('初始密码', 'synthetic-secret-' + close); h.change('显示名称', '未保存');
    if (close === 'cancel') h.button('取消', h.form()).props.onClick();
    else if (close === 'close') h.dialog().props.onClose();
    else {h.button('刷新列表').props.onClick(); h.draw(); h.effect(); await flush();}
    assert.equal(h.dialog(), undefined); assert(!JSON.stringify(h.states).includes('synthetic-secret-'));
    h.button('新建工单账号').props.onClick(); assert.equal(h.editorField('账号').props.value, ''); assert.equal(h.editorField('初始密码').props.value, '');
    h.dialog().props.onClose();
  }
  assert(h.calls.every(call => call.body.action === 'list-accounts'), 'closing does not save');
});

test('editor selection is separate from directory filters and cannot carry platforms across teams', async () => {
  const h = ui(async body => {if (body.action === 'list-accounts') return {ok: true, accounts, catalog}; const {password, ...safeFields} = body; return {ok: true, account: {...accounts[0], ...safeFields, updated_at: 'next'}};});
  await flush(); h.filter('团队', '香港', 'select'); h.filter('平台', 'H', 'select');
  h.button('新建工单账号').props.onClick(); h.change('账号', '  NewStaff  '); h.change('初始密码', 'fixture-password'); h.change('显示名称', ' New Staff ');
  h.change('团队', 'M8', 'select'); h.button('全选当前团队', h.form()).props.onClick(); assert.match(text(h.form()), /已选 2 个/);
  h.change('团队', '香港', 'select'); assert.match(text(h.form()), /已选 0 个/); assert.equal(h.button('保存账号', h.form()).props.disabled, true);
  await h.form().props.onSubmit({preventDefault() {}}); assert.equal(h.calls.length, 1); assert.match(text(h.form()), /请选择所属团队/);
  h.button('全选当前团队', h.form()).props.onClick(); await h.form().props.onSubmit({preventDefault() {}});
  assert.deepEqual(h.calls[1].body, {action: 'create-account', username: 'newstaff', password: 'fixture-password', display_name: 'New Staff', role: 'agent', team: '香港', platforms: ['H']});
  assert.equal(h.dialog(), undefined); assert.equal(h.filterField('平台', 'select').props.value, 'H');
  assert(!JSON.stringify(h.states).includes('fixture-password'));
});

test('edit uses the existing versioned API and closing preserves the original row', async () => {
  const h = ui(async body => body.action === 'list-accounts' ? {ok: true, accounts, catalog} : {ok: true, account: {...accounts[0], ...body.patch, updated_at: 'next'}});
  await flush(); h.button('编辑范围 / 角色').props.onClick(); assert.equal(h.dialog().props.title, '编辑工单账号 · alice');
  assert(!nodes(h.form()).some(n => n.type === 'input' && n.props.type === 'password'));
  h.change('显示名称', '未保存名称'); h.dialog().props.onClose(); assert.match(text(h.draw()), /Alice 陈/); assert.doesNotMatch(text(h.draw()), /未保存名称/);
  h.button('编辑范围 / 角色').props.onClick(); h.change('角色', 'auditor', 'select'); h.change('团队', '香港', 'select');
  h.button('全选当前团队', h.form()).props.onClick(); await h.form().props.onSubmit({preventDefault() {}});
  assert.deepEqual(h.calls[1].body, {action: 'update-account', auth_user_id: 'a', expected_updated_at: 'version-a', patch: {display_name: 'Alice 陈', role: 'auditor', team: '香港', platforms: ['H'], active: true}});
  assert.equal(h.dialog(), undefined);
});

test('reset password clears on cancel/close, displays failures in the dialog and does not retry a write', async () => {
  const h = ui(async body => {if (body.action === 'list-accounts') return {ok: true, accounts, catalog}; throw Error('重设结果尚未确认');});
  await flush();
  for (const mode of ['cancel', 'close']) {
    h.button('重设密码').props.onClick(); assert.equal(h.dialog().props.title, '重设工单密码 · alice');
    h.change('新密码', 'reset-fixture-' + mode);
    if (mode === 'cancel') h.button('取消', h.form()).props.onClick(); else h.dialog().props.onClose();
    assert.equal(h.dialog(), undefined); assert(!JSON.stringify(h.states).includes('reset-fixture-'));
  }
  h.button('重设密码').props.onClick(); assert.equal(h.editorField('新密码').props.value, ''); h.change('新密码', 'reset-fixture-failure');
  await h.form().props.onSubmit({preventDefault() {}}); assert.match(text(h.form()), /重设结果尚未确认/); assert.equal(h.calls.length, 2);
  h.dialog().props.onClose(); assert(!JSON.stringify(h.states).includes('reset-fixture-failure')); assert.doesNotMatch(text(h.draw()), /重设结果尚未确认/);
});

test('pending save makes the dialog busy, disables its fieldset and does not permit a duplicate submission', async () => {
  let resolve; const h = ui(body => body.action === 'list-accounts' ? Promise.resolve({ok: true, accounts, catalog}) : new Promise(r => {resolve = r;}));
  await flush(); h.button('编辑范围 / 角色').props.onClick(); const pending = h.form().props.onSubmit({preventDefault() {}});
  assert.equal(h.dialog().props.busy, true); assert.equal(nodes(h.form()).find(n => n.type === 'fieldset').props.disabled, true);
  await h.form().props.onSubmit({preventDefault() {}}); assert.equal(h.calls.length, 2);
  resolve({ok: true, account: {...accounts[0], updated_at: 'next'}}); await pending; assert.equal(h.dialog(), undefined);
});

test('a rejected edit stays in its dialog; a stale cross-team platform cannot be submitted', async () => {
  const h = ui(async body => {if (body.action === 'list-accounts') return {ok: true, accounts, catalog}; throw Error('账号已被其他管理员修改');});
  await flush(); h.button('编辑范围 / 角色').props.onClick(); h.change('显示名称', '待重试'); await h.form().props.onSubmit({preventDefault() {}});
  assert.equal(h.editorField('显示名称').props.value, '待重试'); assert.match(text(h.form()), /其他管理员/); assert.equal(h.calls.length, 2);
  const stale = ui(async () => ({ok: true, accounts: [{...accounts[0], platforms: ['H']}], catalog})); await flush();
  stale.button('编辑范围 / 角色').props.onClick(); await stale.form().props.onSubmit({preventDefault() {}});
  assert.equal(stale.calls.length, 1); assert.match(text(stale.form()), /该团队的平台/);
});

function dialogHarness() {
  const refs = [], effects = [], listeners = new Map(), timers = new Map(), mod = {exports: {}};
  const document = {body: {style: {overflow: 'scroll'}}, activeElement: null,
    addEventListener(name, fn, capture) {assert.equal(capture, true); listeners.set(name, fn);},
    removeEventListener(name, fn, capture) {assert.equal(capture, true); if (listeners.get(name) === fn) listeners.delete(name);},
  };
  let refIndex = 0, mounted = false, timerId = 0;
  function element(kind, options = {}) {return {kind, disabled: false, hidden: false, isConnected: true, ...options,
    closest() {return this.hidden ? {} : null;}, focus() {document.activeElement = this;},
  };}
  const opener = element('button'), close = element('button'), input = element('input'), last = element('button'); document.activeElement = opener;
  let items = [close, input, last];
  const container = element('dialog');
  container.contains = node => node === container || items.includes(node);
  container.querySelectorAll = () => items.filter(node => !node.disabled);
  container.querySelector = () => items.find(node => !node.disabled && (node.kind === 'input' || node.kind === 'select')) || null;
  vm.runInNewContext(compile('src/components/AccountEditorDialog.tsx'), {
    module: mod, exports: mod.exports, document,
    setTimeout(fn) {const id = ++timerId; timers.set(id, fn); return id;}, clearTimeout(id) {timers.delete(id);},
    require(name) {
      if (name === 'react') return {useId: () => 'dialog-title', useRef(initial) {const n = refIndex++; return refs[n] || (refs[n] = {current: initial});}, useEffect(fn) {if (!mounted) effects.push(fn);}};
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'react-dom') return {createPortal: (child, target) => {assert.equal(target, document.body); return child;}};
      if (name.endsWith('.css')) return {};
      throw Error('Unexpected import ' + name);
    },
  });
  const draw = props => {refIndex = 0; const tree = mod.exports.default({title: '测试账号', onClose() {}, children: 'body', ...props}); refs[0].current = container; return tree;};
  let cleanup;
  return {document, opener, close, input, last, container, listeners, timers, element, draw,
    mount(props) {const tree = draw(props); cleanup = effects.pop()(); mounted = true; return tree;},
    runTimers() {const jobs = [...timers.values()]; timers.clear(); jobs.forEach(fn => fn());},
    unmount() {cleanup();}, setItems(value) {items = value;},
    key(key, shiftKey = false) {const event = {key, shiftKey, prevented: false, stopped: false, preventDefault() {this.prevented = true;}, stopPropagation() {this.stopped = true;}}; listeners.get('keydown')?.(event); return event;},
  };
}

test('shared dialog portals to body, labels the dialog, locks background scroll and restores focus on cleanup', () => {
  const h = dialogHarness(), tree = h.mount({bodyClassName: 'workorder-account-admin'}); const dialog = nodes(tree).find(n => n.props?.role === 'dialog');
  assert.equal(dialog.props['aria-modal'], 'true'); assert.equal(dialog.props['aria-labelledby'], 'dialog-title'); assert.equal(nodes(tree).find(n => n.type === 'h2').props.id, 'dialog-title');
  assert.equal(h.document.body.style.overflow, 'hidden'); h.runTimers(); assert.equal(h.document.activeElement, h.input);
  h.unmount(); assert.equal(h.document.body.style.overflow, 'scroll'); assert.equal(h.document.activeElement, h.opener); assert.equal(h.listeners.size, 0);
});

test('shared dialog traps forward/backward Tab and redirects focus from outside, with an empty-state fallback', () => {
  const h = dialogHarness(); h.mount(); h.runTimers(); h.last.focus(); assert.equal(h.key('Tab').prevented, true); assert.equal(h.document.activeElement, h.close);
  assert.equal(h.key('Tab', true).prevented, true); assert.equal(h.document.activeElement, h.last);
  h.opener.focus(); h.key('Tab'); assert.equal(h.document.activeElement, h.close); h.opener.focus(); h.key('Tab', true); assert.equal(h.document.activeElement, h.last);
  h.setItems([]); assert.equal(h.key('Tab').prevented, true); assert.equal(h.document.activeElement, h.container); h.unmount();
});

test('Escape and backdrop close obey the latest busy state; clicks inside do not close', () => {
  const h = dialogHarness(); let oldClose = 0, newClose = 0; let tree = h.mount({onClose() {oldClose++;}}); h.runTimers();
  let event = h.key('Escape'); assert(event.prevented && event.stopped); assert.equal(oldClose, 1);
  tree.props.onMouseDown({target: {}, currentTarget: {}}); assert.equal(oldClose, 1);
  const overlay = {}; tree.props.onMouseDown({target: overlay, currentTarget: overlay}); assert.equal(oldClose, 2);
  tree = h.draw({busy: true, onClose() {newClose++;}}); assert.equal(nodes(tree).find(n => n.type === 'button').props.disabled, true);
  h.key('Escape'); tree.props.onMouseDown({target: overlay, currentTarget: overlay}); assert.equal(newClose, 0);
  tree = h.draw({busy: false, onClose() {newClose++;}}); h.key('Escape'); assert.equal(newClose, 1, 'the effect uses the current callback without stale state'); h.unmount();
});

test('dialog cleanup cancels delayed autofocus and does not refocus a removed opener', () => {
  const h = dialogHarness(); h.mount(); assert.equal(h.timers.size, 1); h.opener.isConnected = false; h.document.activeElement = null;
  h.unmount(); h.runTimers(); assert.equal(h.document.activeElement, null); assert.equal(h.timers.size, 0); assert.equal(h.document.body.style.overflow, 'scroll');
});
