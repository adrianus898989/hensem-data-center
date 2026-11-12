const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function renderer() {
  const context = {window: {}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../admin-preview/live-band-success-matrices-ui.js'), 'utf8'), context);
  return context.window.HensemBandSuccessMatricesUI;
}

const pair = (successCount, totalCount) => ({successCount, totalCount});
const columns = [{key: '00', label: '00:00–01:00'}, {key: '01', label: '01:00–02:00'}];
const rows = [
  {name: 'None', cells: {'00': null, '01': pair(0, 0)}, total: null},
  {name: 'Mid', cells: {'00': pair(2, 4), '01': pair(0, 0)}, total: pair(2, 4)},
  {name: 'Weighted', type: '混合', cells: {'00': pair(1, 1), '01': pair(0, 9)}, total: pair(1, 10)},
  {name: 'Equal', cells: {'00': pair(1, 2)}, total: pair(1, 2)}
];
const matrix = {columns, rows, partial: true};
const model = {direction: 'charge', provider: matrix, merchant: {...matrix, partial: false}};
const rowOrder = html => Array.from(html.matchAll(/<th scope="row" title="([^"]+)"/g), m => m[1]);
const section = (html, key) => html.split('data-band-matrix="' + key + '"')[1].split('</section>')[0];

test('renders provider and merchant hourly rates, distinct missing and zero values, weighted totals and partial evidence', () => {
  const html = renderer().render(model, 'time');
  const provider = section(html, 'time/charge/provider');
  const merchant = section(html, 'time/charge/merchant');
  assert.deepEqual(rowOrder(provider), ['Mid', 'Equal', 'Weighted', 'None']);
  assert.match(provider, /scope="col" class="success-provider-type">类型/);
  assert.doesNotMatch(merchant, /class="success-provider-type"/);
  assert.match(provider, /00:00–01:00/);
  assert.match(provider, /class="success-total-rate" aria-sort="descending"/);
  assert.match(provider, /100\.00%/);
  assert.match(provider, /class="success-rate-low">0\.00%/);
  assert.match(provider, /title="成功 0 笔 \/ 创建 0 笔"><span>—/);
  assert.match(provider, /title="尚无可核验的笔数"><span>—/);
  assert.match(provider, /10\.00%<sup aria-label="部分来源"/);
  assert.doesNotMatch(provider, /100\.00%<sup/);
  assert.doesNotMatch(merchant, /已读小计|部分来源/);
});

test('clicking total changes only this table, keeps unknown rates last, and preserves source order for ties', () => {
  const ui = renderer();
  const order = [], attrs = {'aria-sort': 'descending'}, arrow = {};
  const entries = ['0.5', '0.5', '0.1', ''].map((rate, i) => ({dataset: {rate, order: [1, 3, 2, 0][i]}}));
  const body = {querySelectorAll: () => entries, appendChild: tr => order.push(tr.dataset.order)};
  const heading = {getAttribute: k => attrs[k], setAttribute: (k, v) => { attrs[k] = v; }};
  const table = {tBodies: [body], closest: () => ({dataset: {bandMatrix: 'time/charge/provider'}})};
  const button = {closest: selector => selector === 'table' ? table : heading, setAttribute: (k, v) => { attrs[k] = v; }, querySelector: () => arrow};
  ui.toggleSort(button);
  assert.deepEqual(order, [2, 1, 3, 0]);
  assert.equal(attrs['aria-sort'], 'ascending');
  assert.equal(arrow.textContent, '↑');
  const html = ui.render(model, 'time');
  assert.deepEqual(rowOrder(section(html, 'time/charge/provider')), ['Weighted', 'Mid', 'Equal', 'None']);
  assert.deepEqual(rowOrder(section(html, 'time/charge/merchant')), ['Mid', 'Equal', 'Weighted', 'None']);
  assert.match(section(ui.render(model, 'amount'), 'amount/charge/provider'), /aria-sort="descending"/);
  assert.match(section(ui.render({...model, direction: 'withdraw'}, 'time'), 'time\/withdraw/provider'), /aria-sort="descending"/);
  ui.toggleSort(button);
  assert.equal(attrs['aria-sort'], 'descending');
  assert.deepEqual(order.slice(-4), [1, 3, 2, 0]);
});

test('uses text for source labels and preserves a missing source as incomplete', () => {
  const record = {name: '<img>', type: '<type>', cells: {}, total: null};
  const html = renderer().render({...model, provider: {...matrix, rows: [record]}, merchant: {...matrix, rows: []}}, 'amount');
  assert.match(html, /&lt;img&gt;/);
  assert.match(html, /&lt;type&gt;/);
  assert.doesNotMatch(html, /<img>|<type>/);
  assert.match(html, /暂无可核验的分时数据/);
});

test('provider scope disclosure identifies extra merchant groups and safely displays their names', () => {
  const ui = renderer();
  const html = ui.render({...model,provider:{...matrix,excluded:{manual:['人工充值'],unidentified:['<未知>']}}},'time');
  const provider = section(html,'time/charge/provider');
  assert.match(provider,/商户汇总另含 2 个分组/);
  assert.match(provider,/非三方业务（1）：人工充值/);
  assert.match(provider,/三方归属待确认（1）：&lt;未知&gt;/);
  assert.doesNotMatch(section(html,'time/charge/merchant'),/商户汇总另含/);
});
