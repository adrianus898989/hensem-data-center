const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/components/OriginalRateGrid.tsx');
const source = fs.readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const api = {};
new Function('require', 'exports', compiled)(name => name.endsWith('.css') ? {} : require(name), api);
const fixture = (rows = 8, columns = 49, extra = {}) => ({
  sheet: { sheetId: 277747449, title: '印度线下', index: 0, rowCount: rows, columnCount: columns, frozenRowCount: 1, frozenColumnCount: 2 },
  cells: Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => ({ text: row ? '' : `原列 ${column + 1}` }))),
  rowHeights: Array.from({ length: rows }, (_, i) => i === 0 ? 45 : 21), columnWidths: Array.from({ length: columns }, (_, i) => i === 0 ? 123 : 100),
  merges: [], hiddenRows: [], hiddenColumns: [], rowCount: rows, columnCount: columns, fetchedAt: '2026-09-14T00:00:00Z', ...extra,
});
const render = (grid, extra = {}) => renderToStaticMarkup(React.createElement(api.default, { grid, ...extra }));

test('India: all 49 native columns, 16 platform headers and exact names remain in source order', () => {
  const grid = fixture();
  const headers = ['三方名称', '类型', '代收', '代付', '合计费率', '代收合计+单笔', '代付合计+单笔'];
  headers.forEach((text, column) => { grid.cells[0][column].text = text; });
  for (let column = 31; column < 47; column++) grid.cells[0][column].text = `原平台${column - 30}`;
  grid.cells[1][0].text = 'SUPER'; grid.cells[2][0].text = 'NewWinPay2'; grid.cells[1][2].text = '4.00%';
  grid.cells[1][31].text = '运行原文'; grid.cells[1][32].text = '';
  const before = JSON.stringify(grid), html = render(grid), layout = api.buildOriginalGridLayout(grid);
  assert.equal(layout.columns.length, 49); assert.equal(layout.cells[0].length, 49);
  assert.equal((html.match(/data-cell=/g) || []).length, 49 * 8);
  for (const header of headers) assert(html.includes(header.replaceAll('+', '+')));
  for (let i = 1; i <= 16; i++) assert(html.includes(`原平台${i}`));
  assert(html.indexOf('data-cell="AF1"') < html.indexOf('data-cell="AU1"'));
  assert.match(html, />AW<\/th>/); assert.match(html, />SUPER<\/div>/); assert.match(html, />NewWinPay2<\/div>/);
  assert.match(html, />4\.00%<\/div>/); assert.doesNotMatch(html, /Superpay|单笔 0|—|rate-sheet-detail|查看|role="dialog"/);
  assert.equal(JSON.stringify(grid), before);
});

test('Vietnam: two original headers are not collapsed into a standard country schema', () => {
  const grid = fixture(4, 6); grid.sheet = { ...grid.sheet, title: '越南盘口', frozenRowCount: 2 };
  grid.cells[0][0].text = '三方'; grid.cells[0][2].text = '98VV'; grid.cells[0][4].text = 'XX98';
  grid.cells[1][2].text = '代收'; grid.cells[1][3].text = '代付'; grid.cells[1][4].text = '代收'; grid.cells[1][5].text = '代付';
  grid.merges = [{ startRowIndex: 0, endRowIndex: 1, startColumnIndex: 2, endColumnIndex: 4 }, { startRowIndex: 0, endRowIndex: 1, startColumnIndex: 4, endColumnIndex: 6 }];
  const html = render(grid), layout = api.buildOriginalGridLayout(grid);
  assert.equal(layout.cells[0].length, 4); assert.equal(layout.cells[1].length, 6);
  assert.match(html, /colSpan="2" data-cell="C1"/i);
  assert.match(html, /data-cell="C2"[^>]*data-frozen-row="true"/);
  assert.match(html, /top:69px/); assert.match(html, /98VV/); assert.match(html, /XX98/);
});

test('Indonesia: row and column merges preserve labels and separate collection/payment children', () => {
  const grid = fixture(5, 8); grid.sheet = { ...grid.sheet, title: '印尼盘', frozenRowCount: 2 };
  grid.cells[0][0].text = '三方'; grid.cells[0][2].text = '原平台 Z'; grid.cells[0][4].text = '原平台 A';
  grid.cells[1][2].text = '代收'; grid.cells[1][3].text = '代付'; grid.cells[1][4].text = '代收'; grid.cells[1][5].text = '代付';
  grid.merges = [{ startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 }, { startRowIndex: 0, endRowIndex: 1, startColumnIndex: 2, endColumnIndex: 4 }];
  const html = render(grid), layout = api.buildOriginalGridLayout(grid);
  assert.equal(layout.cells[0][0].height, 66); assert.equal(layout.byCoordinate.get('1:0').sourceRow, 0);
  assert.match(html, /rowSpan="2" data-cell="A1"/i); assert.doesNotMatch(html, /data-cell="A2"/);
  assert(html.indexOf('原平台 Z') < html.indexOf('原平台 A')); assert.match(html, /data-cell="C2"/); assert.match(html, /data-cell="D2"/);
});

test('hidden rows/columns keep original labels and correctly reduce merged spans, even if origin is hidden', () => {
  const grid = fixture(6, 6, { hiddenRows: [0, 3], hiddenColumns: [0, 3] });
  grid.cells[0][0].text = '合并原点'; grid.merges = [{ startRowIndex: 0, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 3 }];
  const layout = api.buildOriginalGridLayout(grid), html = render(grid);
  assert.deepEqual(layout.rows.map(row => row.index), [1, 2, 4, 5]); assert.deepEqual(layout.columns.map(column => column.index), [1, 2, 4, 5]);
  assert.equal(layout.width, 400); assert.equal(layout.height, 84);
  assert.equal(layout.cells[0][0].rowSpan, 2); assert.equal(layout.cells[0][0].columnSpan, 2);
  assert.equal(layout.cells[0][0].sourceRow, 0); assert.equal(layout.cells[0][0].sourceColumn, 0);
  assert.match(html, /rowSpan="2" colSpan="2" data-cell="A1"/i); assert.match(html, /合并原点/);
  assert.match(html, /data-source-column="1"/); assert.doesNotMatch(html, /data-source-column="0"|data-source-row="3"/);
  assert.match(html, /data-source-row="4"/); assert.match(html, />5<\/th>/);
});

test('merged outer borders come from far source edges without copying covered values', () => {
  const grid = fixture(3, 3); grid.merges = [{ startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 2 }];
  grid.cells[0][0] = { text: '合并值', format: { backgroundColor: { red: 1 }, borders: { top: { style: 'SOLID' } } } };
  grid.cells[0][1] = { text: '覆盖文字不显示', format: { borders: { right: { style: 'SOLID_THICK' } } } };
  grid.cells[1][0] = { text: '', format: { borders: { bottom: { style: 'DOUBLE' } } } };
  const item = api.buildOriginalGridLayout(grid).cells[0][0], format = api.originalGridMergedFormat(grid, item), html = render(grid);
  assert.equal(format.borders.right.style, 'SOLID_THICK'); assert.equal(format.borders.bottom.style, 'DOUBLE'); assert.equal(format.borders.top.style, 'SOLID');
  assert.match(html, /border-right:3px solid #000/); assert.match(html, /border-bottom:3px double #000/);
  assert.doesNotMatch(html, /覆盖文字不显示/);
});

test('source colors, border styles, point font sizes, wraps and exact row/column dimensions are retained', () => {
  const grid = fixture(3, 3);
  grid.cells[1][1] = { text: '自定义原文\n第二行', format: { backgroundColor: { red: .2, green: .4, blue: .8 }, textFormat: { fontFamily: 'Arial', fontSize: 12, bold: true, italic: true, underline: true, foregroundColor: { red: 1 } },
    borders: { bottom: { style: 'DOUBLE', color: { blue: 1 } }, right: { style: 'SOLID_MEDIUM', color: { red: 1 } } }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', padding: { left: 6, top: 4 } } };
  const html = render(grid, { zoom: .85 });
  assert.match(html, /width:104\.55px/); assert.match(html, /height:17\.849999999999998px|height:17\.85px/);
  assert.match(html, /background-color:rgba\(51, 102, 204, 1\)/); assert.match(html, /font-size:10\.2pt/);
  assert.match(html, /font-weight:700/); assert.match(html, /font-style:italic/); assert.match(html, /text-decoration:underline/);
  assert.match(html, /border-bottom:2\.55px double rgba\(0, 0, 255, 1\)/); assert.match(html, /text-align:center/); assert.match(html, /white-space:pre-wrap/);
});

test('blank stays truly blank, explicit zeros and formatted decimal strings are not replaced or calculated', () => {
  const grid = fixture(3, 4); grid.cells[1] = [{ text: '' }, { text: '0' }, { text: '0.00%' }, { text: 'R$ 10,50 + 2' }];
  const html = render(grid);
  assert.match(html, /data-cell="A2"[^]*?original-rate-grid-cell-text"[^>]*><\/div>/);
  assert.match(html, />0<\/div>/); assert.match(html, />0\.00%<\/div>/); assert.match(html, />R\$ 10,50 \+ 2<\/div>/);
  assert.doesNotMatch(html, /—|未接入|未跑|无数据|单笔 0/);
});

test('untrusted cell text and fonts never execute scripts, formulas, HTML or hyperlinks', () => {
  const grid = fixture(2, 3);
  grid.cells[1] = [{ text: '<img src=x onerror=alert(1)><script>alert(2)</script>' }, { text: '=HYPERLINK("javascript:alert(1)","link")' }, { text: 'https://untrusted.invalid' }];
  const html = render(grid);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/); assert.match(html, /&lt;script&gt;/); assert.match(html, /=HYPERLINK/);
  assert.doesNotMatch(html, /<script|<img|<a\b|href=/);
});

test('rich text run characters and per-run formats are retained without mutating input', () => {
  const grid = fixture(2, 2); grid.cells[1][0] = { text: '原文RED蓝色', runs: [{ startIndex: 2, format: { foregroundColor: { red: 1 }, bold: true } }, { startIndex: 5, format: { foregroundColor: { blue: 1 } } }] };
  const before = JSON.stringify(grid), html = render(grid);
  assert.match(html, /原文<span[^>]*color:rgba\(255, 0, 0, 1\)[^>]*>RED<\/span><span[^>]*>蓝色<\/span>/);
  assert.equal(JSON.stringify(grid), before);
});

test('invalid dimensions and styles are bounded, invalid/overlapping merges cannot hide data', () => {
  const grid = fixture(3, 3, { rowHeights: [Infinity, -1, 21], columnWidths: [NaN, -2, 100], merges: [
    { startRowIndex: -1, endRowIndex: 9, startColumnIndex: 0, endColumnIndex: 2 },
    { startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 2 },
    { startRowIndex: 0, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 3 },
  ] });
  const layout = api.buildOriginalGridLayout(grid);
  assert.deepEqual(layout.rows.map(row => row.size), [21, 21, 21]); assert.equal(layout.width, 300);
  assert.equal(layout.cells[0].length, 2); assert.equal(layout.cells[1].length, 3);
  assert.match(render({ ...grid, rowCount: 1000000 }), /无法完整展示/);
  assert.match(render(grid, { zoom: NaN }), /data-zoom="1"/);
});

test('column coordinates support A–AW and beyond Z without changing source order', () => {
  for (const [index, label] of [[0, 'A'], [25, 'Z'], [26, 'AA'], [48, 'AW'], [701, 'ZZ'], [702, 'AAA']]) assert.equal(api.originalGridColumnLabel(index), label);
  assert.equal(api.originalGridColumnLabel(-1), '');
});

test('full grid has one scroll viewport, no pagination, network, aliases, formula interpretation or popup controls', () => {
  const html = render(fixture(80, 49));
  assert.equal((html.match(/original-rate-grid-viewport/g) || []).length, 1);
  assert.equal((html.match(/data-cell=/g) || []).length, 80 * 49);
  assert.doesNotMatch(source, /\bfetch\s*\(|localStorage|sessionStorage|dangerouslySetInnerHTML|buildRateMap|findMatchedRate|parseThirdPartyRates/);
  assert.doesNotMatch(html, /下一页|查看|role="dialog"/);
  const css = fs.readFileSync(path.join(root, 'src/components/OriginalRateGrid.css'), 'utf8');
  assert.match(css, /position: sticky/); assert.match(css, /calc\(100dvh - 180px\)/);
  assert.doesNotMatch(css, /(?:^|\n)(?:body|html|table|button)\s*\{/);
});
