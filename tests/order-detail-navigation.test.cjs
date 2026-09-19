// Exercise production navigation fragments, without browser sessions or requests.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const {root} = require('./load-typescript.cjs');

const text = fs.readFileSync(path.join(root, 'src/components/Dashboard.tsx'), 'utf8');
const source = ts.createSourceFile('Dashboard.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const dashboard = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Dashboard');
assert.ok(dashboard);
const switchNode = dashboard.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'switchModule');
const orderBranch = dashboard.body.statements.find(node => ts.isIfStatement(node) && node.expression.getText(source) === 'activeModule === "orders"');
let navigationButton;
function visit(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'button') {
    const attributes = node.openingElement.attributes.getText(source);
    if (attributes.includes('nav-item') && attributes.includes('switchModule("orders")')) navigationButton = node;
  }
  ts.forEachChild(node, visit);
}
visit(dashboard);
assert.ok(switchNode);
assert.ok(orderBranch, 'orders must have a dedicated top-level render branch');
assert.ok(navigationButton, 'orders must have an independent sidebar entry');

function evaluate(code, values = {}) {
  const javascript = ts.transpileModule(code, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  return new Function('require', 'exports', ...Object.keys(values), javascript + '\nreturn output;')(require, {}, ...Object.values(values));
}

test('actual order detail sidebar entry is disabled without third-party permission', () => {
  for (const allowed of [false, true]) {
    const opened = [];
    const button = evaluate(`const output = ${navigationButton.getText(source)};`, {
      activeModule: 'orders', canThirdParty: allowed,
      switchModule: value => opened.push(value), DashboardGlyph: () => null,
    });
    assert.equal(button.props.disabled, !allowed);
    assert.equal(button.props.className, 'nav-item active');
    const html = renderToStaticMarkup(button);
    assert.match(html, /订单明细/);
    if (allowed) {
      assert.doesNotMatch(html, /disabled=""/);
      button.props.onClick();
      assert.deepEqual(opened, ['orders']);
    } else {
      assert.match(html, /disabled=""/);
      assert.match(html, /无权限/);
    }
  }
});

test('actual module switch independently rejects unauthorized order navigation', () => {
  for (const allowed of [false, true]) {
    const opened = [], pages = [];
    const go = evaluate(`${switchNode.getText(source)}\nconst output = switchModule;`, {
      canThirdParty: allowed, canAutoWithdraw: false, canWorkSupport: false,
      setActiveModule: value => opened.push(value), setPage: value => pages.push(value),
      loadData: () => assert.fail('opening order detail must not trigger aggregate data loading'),
    });
    go('orders');
    assert.deepEqual(opened, allowed ? ['orders'] : []);
    assert.deepEqual(pages, allowed ? [1] : []);
  }
});

test('order route renders only the independent detail component and guards revoked access', () => {
  const branchIndex = dashboard.body.statements.indexOf(orderBranch);
  const finalReturnIndex = dashboard.body.statements.findIndex(node => ts.isReturnStatement(node));
  assert.ok(branchIndex < finalReturnIndex, 'independent orders branch precedes generic data-dependent rendering');
  let detailMounts = 0;
  const render = allowed => evaluate(`function renderRoute() { ${orderBranch.getText(source)} return null; }\nconst output = renderRoute();`, {
    activeModule: 'orders', canThirdParty: allowed,
    sidebarContent: React.createElement('aside', null, 'navigation'),
    OrderDetailSearch: () => { detailMounts += 1; return React.createElement('section', {'data-order-detail': true}, '订单明细搜索'); },
    ThirdPartyVolumeDashboard: () => assert.fail('order page must not mount volume summary'),
  });
  const permitted = renderToStaticMarkup(render(true));
  assert.equal(detailMounts, 1);
  assert.match(permitted, /data-order-detail="true"/);
  assert.match(permitted, /<aside>navigation<\/aside>/);
  const denied = renderToStaticMarkup(render(false));
  assert.equal(detailMounts, 1, 'revoked access must not instantiate detail component');
  assert.match(denied, /role="alert"/);
  assert.match(denied, /管理员未开放此模块/);
  assert.doesNotMatch(denied, /data-order-detail/);
});
