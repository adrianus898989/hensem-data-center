const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const text = fs.readFileSync(path.join(__dirname, '../src/components/Dashboard.tsx'), 'utf8');
const source = ts.createSourceFile('Dashboard.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['normalizePaneToken', 'countryPaneLabelFor', 'autoCountryPaneLabelFor', 'countryMatchesAutoPane'];
const functions = source.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text));
assert.equal(functions.length, names.length);
const code = ts.transpileModule(functions.map(n => n.getText(source)).join('\n'), {
  compilerOptions: {target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS}
}).outputText;
const {pane, matches} = new Function('NPG_PANE_LABEL', 'PANGHU_BRAZIL_PANE_LABEL', 'AUTO_PANE_ALL',
  code + '\nreturn {pane: autoCountryPaneLabelFor, matches: countryMatchesAutoPane};'
)('NPG盘口', '胖虎巴西盘口', '所有盘口');

// Read-only cloud counts for 2026-09-10; no user/order data.
const rows = [
  {country: '南美', platform: 'NPG-CHILE', total: 251, auto: 200, manual: 51},
  {country: '南美', platform: 'NPG-COLOMBIA', total: 699, auto: 575, manual: 124},
  {country: '南美', platform: 'NPG-MEXICO', total: 1531, auto: 1374, manual: 157},
  {country: '南美', platform: 'CO66', total: 44, auto: 0, manual: 44}
];
const filtered = name => rows.filter(r => matches(r.country, name, r.platform));

test('NPG archive rows appear exactly once in the NPG pane, with unchanged counts', () => {
  const result = filtered('NPG盘口');
  assert.equal(result.length, 3);
  for (const [field, expected] of Object.entries({total: 2481, auto: 2149, manual: 332})) {
    assert.equal(result.reduce((sum, r) => sum + r[field], 0), expected);
  }
  assert.deepEqual(rows.map(r => r.country), ['南美', '南美', '南美', '南美']);
});

test('VG CO66 remains separate and all-platform totals stay unchanged', () => {
  assert.deepEqual(filtered('南美盘口').map(r => r.platform), ['CO66']);
  assert.equal(filtered('所有盘口').reduce((sum, r) => sum + r.total, 0), 2525);
  for (const r of rows) {
    assert.equal(Number(matches(r.country, '南美盘口', r.platform)) + Number(matches(r.country, 'NPG盘口', r.platform)), 1);
  }
});

test('existing country mappings and unknown platforms are preserved', () => {
  for (const [country, platform, expected] of [
    ['南美', 'npg-mexico', 'NPG盘口'], ['南美', 'NPG-MEXICO-extra', '南美盘口'],
    ['墨西哥', '', 'NPG盘口'], ['智利', '', 'NPG盘口'], ['Colombia', '', 'NPG盘口'],
    ['巴西', 'VIP345', '巴西盘口'], ['胖虎巴西', 'VIP345', '胖虎巴西盘口'],
    ['印度', '91CLUB', '印度盘口'], ['', 'UNKNOWN', '其他盘口']
  ]) assert.equal(pane(country, platform), expected);
});

test('daily, monthly fallback and platform selector all pass platform identity', () => {
  assert.equal((text.match(/countryMatchesAutoPane\(row\.country, autoCountryPane, row\.platform\)/g) || []).length, 2);
  assert.match(text, /countryMatchesAutoPane\(r\.country, autoCountryPane, r\.platform\)/);
  assert.match(text, /monthlyRows\.map\(\(r\) => autoCountryPaneLabelFor\(r\.country, r\.platform\)\)/);
  assert.match(text, /dailyRows\.map\(\(r\) => autoCountryPaneLabelFor\(r\.country, r\.platform\)\)/);
});
