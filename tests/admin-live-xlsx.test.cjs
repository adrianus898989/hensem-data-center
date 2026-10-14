const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const modulePath = path.join(__dirname, '../admin-preview/live-xlsx.js');
const source = fs.readFileSync(modulePath, 'utf8');
const {encodeWorkbook, encodeXlsx} = require(modulePath);
const decode = new TextDecoder('utf-8', {fatal: true});

// Independent ZIP reader and bit-at-a-time CRC. No writer helper is reused.
function zipEntries(input) {
  const b = Buffer.from(input), end = b.length - 22;
  assert.equal(b.readUInt32LE(end), 0x06054b50);
  assert.equal(b.readUInt16LE(end + 4), 0); assert.equal(b.readUInt16LE(end + 6), 0);
  assert.equal(b.readUInt16LE(end + 20), 0);
  const count = b.readUInt16LE(end + 10), central = b.readUInt32LE(end + 16), centralSize = b.readUInt32LE(end + 12);
  assert.equal(b.readUInt16LE(end + 8), count); assert.equal(central + centralSize, end);
  const crc = data => {
    let value = 0xffffffff;
    for (const byte of data) {value ^= byte; for (let i = 0; i < 8; i++) value = (value & 1) ? (value >>> 1) ^ 0xedb88320 : value >>> 1;}
    return (value ^ 0xffffffff) >>> 0;
  };
  const files = new Map(); let cursor = central, lastLocalEnd = 0;
  for (let i = 0; i < count; i++) {
    assert.equal(b.readUInt32LE(cursor), 0x02014b50);
    assert.equal(b.readUInt16LE(cursor + 6), 20); assert.equal(b.readUInt16LE(cursor + 8), 0x800);
    assert.equal(b.readUInt16LE(cursor + 10), 0);
    const expectedCrc = b.readUInt32LE(cursor + 16), size = b.readUInt32LE(cursor + 20), nameLength = b.readUInt16LE(cursor + 28);
    const extra = b.readUInt16LE(cursor + 30), comment = b.readUInt16LE(cursor + 32), local = b.readUInt32LE(cursor + 42);
    assert.equal(size, b.readUInt32LE(cursor + 24)); assert.equal(local, lastLocalEnd);
    assert.equal(extra, 0); assert.equal(comment, 0); assert.equal(b.readUInt16LE(cursor + 34), 0);
    const nameBytes = b.subarray(cursor + 46, cursor + 46 + nameLength), name = decode.decode(nameBytes);
    assert(!files.has(name)); assert(!name.startsWith('/') && !name.includes('..') && !name.includes('\\'));
    assert.equal(b.readUInt32LE(local), 0x04034b50); assert.equal(b.readUInt16LE(local + 4), 20);
    assert.equal(b.readUInt16LE(local + 6), 0x800); assert.equal(b.readUInt16LE(local + 8), 0);
    assert.equal(b.readUInt16LE(local + 10), 0); assert.equal(b.readUInt16LE(local + 12), 0x21);
    assert.equal(b.readUInt32LE(local + 14), expectedCrc); assert.equal(b.readUInt32LE(local + 18), size);
    assert.equal(b.readUInt32LE(local + 22), size); assert.equal(b.readUInt16LE(local + 26), nameLength);
    assert.equal(b.readUInt16LE(local + 28), 0);
    assert.deepEqual(b.subarray(local + 30, local + 30 + nameLength), nameBytes);
    const data = b.subarray(local + 30 + nameLength, local + 30 + nameLength + size);
    assert.equal(data.length, size); assert.equal(crc(data), expectedCrc);
    files.set(name, decode.decode(data)); lastLocalEnd = local + 30 + nameLength + size; cursor += 46 + nameLength;
  }
  assert.equal(lastLocalEnd, central); assert.equal(cursor, end); return files;
}
const sheet = bytes => zipEntries(bytes).get('xl/worksheets/sheet1.xml');
const entities = value => value.replace(/&(?:amp|lt|gt|quot|apos|#13);/g, entity => ({'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#13;': '\r'}[entity]));
const xstring = value => entities(value).replace(/_x([0-9a-fA-F]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
function cells(xml) {
  const out = new Map();
  for (const match of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, ref, attrs, body = ''] = match;
    out.set(ref, {attrs, value: attrs.includes('inlineStr') ? xstring(body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? '') : body.includes('<v>') ? Number(body.match(/<v>(.*?)<\/v>/)[1]) : null});
  }
  return out;
}

test('browser IIFE and CommonJS expose the same frozen, DOM-free API', () => {
  const window = {}, context = {window, TextEncoder, Uint8Array, Uint32Array, DataView};
  vm.runInNewContext(source, context);
  assert.equal(typeof window.HensemXlsx.encodeWorkbook, 'function');
  assert.equal(typeof window.HensemXlsx.encodeXlsx, 'function'); assert(Object.isFrozen(window.HensemXlsx));
  assert.deepEqual(Buffer.from(window.HensemXlsx.encodeXlsx(['列'], [['值']])), Buffer.from(encodeXlsx(['列'], [['值']])));
  assert.equal(Object.keys(window).length, 1);
});
test('multi-sheet ZIP records, CRCs, content types and relationships identify every sheet exactly once', () => {
  const sheets = ['按日期', '按三方', '明细', '口径说明'].map((name, i) => ({name, headers: ['字段'], rows: [[i]]}));
  const bytes = encodeWorkbook(sheets); assert(bytes instanceof Uint8Array);
  const files = zipEntries(bytes); assert.equal(files.size, 9);
  assert.deepEqual([...files.keys()].slice(0, 5), ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml']);
  assert.match(files.get('_rels/.rels'), /Target="xl\/workbook.xml"/);
  for (let i = 1; i <= 4; i++) {
    assert(files.has(`xl/worksheets/sheet${i}.xml`));
    assert.match(files.get('[Content_Types].xml'), new RegExp(`PartName="/xl/worksheets/sheet${i}\\.xml"`));
    assert.match(files.get('xl/_rels/workbook.xml.rels'), new RegExp(`Id="rId${i}"[^>]+Target="worksheets/sheet${i}\\.xml"`));
    assert.match(files.get('xl/workbook.xml'), new RegExp(`name="${sheets[i - 1].name}" sheetId="${i}" r:id="rId${i}"`));
    assert.equal(cells(files.get(`xl/worksheets/sheet${i}.xml`)).get('A2').value, i - 1);
  }
  assert.match(files.get('xl/_rels/workbook.xml.rels'), /Id="rId5"[^>]+Target="styles.xml"/);
});
test('identifiers, decimal strings and formula-shaped input stay literal text with no external links or formulas', () => {
  const values = ['0000123456789012345678901234567890', '=SUM(A1:A5)', '+123456789', '-00001', '@SUM(A1)', '1e25', '1.00000000', '2026-10-14', '=HYPERLINK("https://example.invalid","x")', "'raw"];
  const files = zipEntries(encodeXlsx(['原始文本'], values.map(value => [value]))), xml = files.get('xl/worksheets/sheet1.xml'), parsed = cells(xml);
  assert.doesNotMatch(xml, /<f(?:\s|>)/); assert.doesNotMatch(xml, /<hyperlink/);
  assert(![...files.keys()].some(name => /external|vba|macro|calcChain/i.test(name)));
  values.forEach((value, i) => {assert.match(parsed.get('A' + (i + 2)).attrs, /inlineStr/); assert.equal(parsed.get('A' + (i + 2)).value, value);});
});
test('only finite number values use numeric cells; null is blank and empty text remains present', () => {
  const values = [0, -0, 12.345, -19.25, 1e-9, 2e20];
  const parsed = cells(sheet(encodeXlsx(['文本', '数字', '缺失'], values.map(value => ['000123', value, null]).concat([['', 1, null]]))));
  values.forEach((value, i) => {const c = parsed.get('B' + (i + 2)); assert(!c.attrs.includes('inlineStr')); assert(Object.is(c.value, value)); assert.equal(parsed.get('C' + (i + 2)).value, null);});
  assert.equal(parsed.get('A8').value, ''); assert.match(parsed.get('A8').attrs, /inlineStr/);
});
test('Unicode, XML characters, whitespace and CR/LF round-trip without markup injection', () => {
  const values = ['中文 印度 😀', ' <xml a="x"> & \' </xml> ', 'line 1\nline 2', 'CR\rLF\r\nend', '\tleading\ttrailing\t', '&lt; &amp; &#13;'];
  const xml = sheet(encodeXlsx(['文字 & <>'], values.map(value => [value]))), parsed = cells(xml);
  values.forEach((value, i) => assert.equal(parsed.get('A' + (i + 2)).value, value));
  assert.match(xml, /xml:space="preserve"/); assert.match(xml, /&#13;/); assert.doesNotMatch(xml, /<xml a=/);
});
test('ST_Xstring escapes preserve literal escape syntax and XML-invalid UTF-16 units', () => {
  const values = ['_x000A_', '_x005F_', 'literal _x0000_ then \u0000', '\u0001\u000b\ufffe\uffff', 'isolated\ud800x\udc00', 'emoji 😀'];
  const xml = sheet(encodeXlsx(['控制码'], values.map(value => [value]))), parsed = cells(xml);
  values.forEach((value, i) => assert.equal(parsed.get('A' + (i + 2)).value, value));
  assert.match(xml, /_x005F_x000A_/); assert.match(xml, /_xD800_/); assert(!xml.includes('\u0000')); assert(!xml.includes('\ufffe'));
});
test('default blue headers, width, freeze and filter describe all data without changing text', () => {
  const long = '原'.repeat(100);
  const files = zipEntries(encodeXlsx(['编号', '金额'], [['000123', 2], [long, 3]], '汇总 & 口径')), xml = files.get('xl/worksheets/sheet1.xml');
  assert.match(files.get('xl/workbook.xml'), /name="汇总 &amp; 口径"/);
  assert.match(xml, /<dimension ref="A1:B3"\/>/); assert.match(xml, /<autoFilter ref="A1:B3"\/>/);
  assert.match(xml, /ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/);
  assert.match(xml, /width="42" customWidth="1"/); assert.equal(cells(xml).get('A3').value, long);
  assert.match(cells(xml).get('A1').attrs, /s="1"/); assert.match(files.get('xl/styles.xml'), /fgColor rgb="FF2F61D5"/);
});
test('per-sheet options isolate widths, freeze, filter and amount alignment; exact decimal text stays text', () => {
  const files = zipEntries(encodeWorkbook([
    {name: '金额', headers: ['编号', '金额'], rows: [['0001', '2514188.00000000'], ['0002', 123.45]], widths: [24, 19.5], amountColumns: [1]},
    {name: '口径', headers: ['解释'], rows: [['这里只是口径']], freezeHeader: false, autoFilter: false},
  ]));
  const xml = files.get('xl/worksheets/sheet1.xml'), parsed = cells(xml), other = files.get('xl/worksheets/sheet2.xml');
  assert.match(xml, /min="1" max="1" width="24"/); assert.match(xml, /min="2" max="2" width="19.5"/);
  assert.equal(parsed.get('B2').value, '2514188.00000000'); assert.match(parsed.get('B2').attrs, /s="4" t="inlineStr"/);
  assert.match(parsed.get('B3').attrs, /s="3"/); assert.equal(parsed.get('B3').value, 123.45);
  assert.doesNotMatch(other, /<pane/); assert.doesNotMatch(other, /<autoFilter/);
});
test('caller-supplied total row is styled, preserves values and is excluded from data filtering', () => {
  const files = zipEntries(encodeXlsx(['三方', '笔数', '金额'], [['WPay', 1, '0001.23000000']], '汇总', {amountColumns: [2], totalRow: ['合计', 1, '0001.23000000']}));
  const xml = files.get('xl/worksheets/sheet1.xml'), parsed = cells(xml);
  assert.match(xml, /<dimension ref="A1:C3"\/>/); assert.match(xml, /<autoFilter ref="A1:C2"\/>/);
  assert.equal(parsed.get('A3').value, '合计'); assert.match(parsed.get('A3').attrs, /s="6"/);
  assert.equal(parsed.get('B3').value, 1); assert.match(parsed.get('B3').attrs, /s="5"/);
  assert.equal(parsed.get('C3').value, '0001.23000000'); assert.match(parsed.get('C3').attrs, /s="7" t="inlineStr"/);
  assert.doesNotMatch(xml, /<f(?:\s|>)/); assert.match(files.get('xl/styles.xml'), /fgColor rgb="FFEAF1FF"/);
});
test('empty data retains one header row and optional supplied totals without inventing values', () => {
  const xml = sheet(encodeXlsx(['订单', 'UPI'], [])); assert.match(xml, /A1:B1/);
  assert.equal((xml.match(/<row /g) || []).length, 1); assert(!cells(xml).has('A2'));
  const totalOnly = sheet(encodeXlsx(['项', '值'], [], '空数据', {totalRow: ['合计', null]}));
  assert.match(totalOnly, /<dimension ref="A1:B2"/); assert.match(totalOnly, /<autoFilter ref="A1:B1"/);
  assert.equal(cells(totalOnly).get('B2').value, null);
});
test('column addresses cross Z correctly and reach the Excel XFD boundary', () => {
  const headers = Array.from({length: 16384}, (_, i) => 'H' + i), xml = sheet(encodeXlsx(headers, [])), parsed = cells(xml);
  for (const ref of ['Z1', 'AA1', 'AZ1', 'BA1', 'ZZ1', 'AAA1', 'XFD1']) assert(parsed.has(ref), ref);
  assert.match(xml, /A1:XFD1/);
});
test('names and multi-sheet boundaries reject invalid or case-insensitive duplicate sheets', () => {
  for (const name of ['', '  ', 'a'.repeat(32), 'A/B', 'A\\B', 'A?B', 'A*B', '[A]', 'A:B', "'A", "A'", 'A\u0000', 'A\ud800', 'A\uffff']) assert.throws(() => encodeXlsx(['a'], [], name), /sheet name/);
  assert.throws(() => encodeWorkbook([]), /at least one sheet/); assert.throws(() => encodeWorkbook(new Array(65531)), /ZIP32/);
  assert.throws(() => encodeWorkbook([{name: 'Data', headers: ['a'], rows: []}, {name: 'data', headers: ['b'], rows: []}]), /Duplicate/);
  assert.throws(() => encodeWorkbook(new Array(1)), /sheet name/);
});
test('unsupported types, sparse/ragged inputs and malformed options fail before any partial file is returned', () => {
  for (const value of [NaN, Infinity, -Infinity, undefined, true, {}, 1n]) assert.throws(() => encodeXlsx(['a'], [[value]]), /cells/);
  const noCoercion = {toString() {throw new Error('coercion must not run');}};
  assert.throws(() => encodeXlsx(['a'], [[noCoercion]]), /cells/);
  assert.throws(() => encodeXlsx(['a', 'b'], [['a']]), /header width/);
  assert.throws(() => encodeXlsx(new Array(1), []), /headers/); assert.throws(() => encodeXlsx(['a'], [new Array(1)]), /cells/);
  for (const widths of [[0], [256], [NaN], ['20'], [], new Array(1)]) assert.throws(() => encodeXlsx(['a'], [], 'Data', {widths}), /widths/);
  for (const amountColumns of [[-1], [1], [0, 0], [0.5], ['0'], new Array(1)]) assert.throws(() => encodeXlsx(['a'], [], 'Data', {amountColumns}), /amountColumns/);
  assert.throws(() => encodeXlsx(['a'], [], 'Data', {freezeHeader: 1}), /freezeHeader/);
  assert.throws(() => encodeXlsx(['a'], [], 'Data', {autoFilter: 'yes'}), /autoFilter/);
  assert.throws(() => encodeXlsx(['a'], [], 'Data', {totalRow: []}), /header width/);
  assert.throws(() => encodeXlsx(['a'], [], 'Data', null), /options/);
});
test('Excel row, column and UTF-16 text limits reject without truncation', () => {
  assert.throws(() => encodeXlsx([], []), /headers/);
  assert.throws(() => encodeXlsx(Array.from({length: 16385}, () => ''), []), /headers/);
  assert.throws(() => encodeXlsx(['a'], new Array(1048576)), /row limit/);
  assert.throws(() => encodeXlsx(['a'], new Array(1048575), 'Data', {totalRow: [0]}), /row limit/);
  assert.throws(() => encodeXlsx(['a'], [['x'.repeat(32768)]]), /32767/);
  assert.equal(cells(sheet(encodeXlsx(['a'], [['x'.repeat(32767)]]))).get('A2').value.length, 32767);
});
test('encoding is deterministic and leaves frozen input, options and all sheets unchanged', () => {
  const row = Object.freeze(['000123', 12.3]), sheet = Object.freeze({name: 'Data', headers: Object.freeze(['编号', '金额']), rows: Object.freeze([row]), widths: Object.freeze([20, 18]), amountColumns: Object.freeze([1]), totalRow: Object.freeze(['合计', 12.3])}), input = Object.freeze([sheet]);
  assert.deepEqual(encodeWorkbook(input), encodeWorkbook(input)); assert.equal(sheet.rows[0][0], '000123');
  assert.deepEqual(encodeXlsx(['x'], [['y']]), encodeWorkbook([{name: 'Records', headers: ['x'], rows: [['y']]}]));
});
test('independent Python zipfile/XML/openpyxl reads multiple sheets, literal types and formatting', t => {
  const python = process.env.HENSEM_TEST_PYTHON || 'python3';
  const probe = spawnSync(python, ['-c', 'import openpyxl'], {encoding: 'utf8'});
  if (probe.error || probe.status !== 0) {t.skip('openpyxl unavailable; independent JS ZIP/CRC checks always run'); return;}
  const bytes = encodeWorkbook([
    {name: '按日', headers: ['日期', '订单号', '金额'], rows: [['2026-10-14', '000012345678901234567890', '2514188.00000000'], ['中文 😀', '=SUM(A1:A2)', 123.45]], widths: [16, 30, 24], amountColumns: [2], totalRow: ['合计', null, '2514311.45000000']},
    {name: '口径 & 明细', headers: ['说明'], rows: [[' <&> " \'\nline\r\nend']], freezeHeader: false, autoFilter: false},
  ]);
  const code = `import sys,io,json,zipfile,xml.etree.ElementTree as ET,openpyxl
b=sys.stdin.buffer.read(); z=zipfile.ZipFile(io.BytesIO(b)); assert z.testzip() is None
for name in z.namelist(): ET.fromstring(z.read(name))
w=openpyxl.load_workbook(io.BytesIO(b),data_only=False); a=w.worksheets[0]; s=w.worksheets[1]
print(json.dumps({'names':w.sheetnames,'rows':list(a.values),'types':[[c.data_type for c in row] for row in a.iter_rows()],'freeze':a.freeze_panes,'filter':a.auto_filter.ref,'widths':[a.column_dimensions[x].width for x in ['A','B','C']],'headerBold':a['A1'].font.bold,'headerFill':a['A1'].fill.fgColor.rgb,'textFormat':a['C2'].number_format,'amountAlignment':a['C2'].alignment.horizontal,'numberAlignment':a['C3'].alignment.horizontal,'totalBold':a['C4'].font.bold,'totalFill':a['C4'].fill.fgColor.rgb,'secondRows':list(s.values),'secondFreeze':s.freeze_panes,'secondFilter':s.auto_filter.ref},ensure_ascii=False))`;
  const result = spawnSync(python, ['-c', code], {input: Buffer.from(bytes), encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr); const value = JSON.parse(result.stdout);
  assert.deepEqual(value.names, ['按日', '口径 & 明细']);
  assert.deepEqual(value.rows, [['日期', '订单号', '金额'], ['2026-10-14', '000012345678901234567890', '2514188.00000000'], ['中文 😀', '=SUM(A1:A2)', 123.45], ['合计', null, '2514311.45000000']]);
  assert.deepEqual(value.types.slice(1), [['s', 's', 's'], ['s', 's', 'n'], ['s', 'n', 's']]);
  assert.deepEqual(value.widths, [16, 30, 24]); assert.equal(value.freeze, 'A2'); assert.equal(value.filter, 'A1:C3');
  assert.equal(value.headerBold, true); assert.equal(value.headerFill, 'FF2F61D5'); assert.equal(value.textFormat, '@');
  assert.equal(value.amountAlignment, 'right'); assert.equal(value.numberAlignment, 'right');
  assert.equal(value.totalBold, true); assert.equal(value.totalFill, 'FFEAF1FF');
  assert.deepEqual(value.secondRows, [['说明'], [' <&> " \'\nline\r\nend']]);
  assert.equal(value.secondFreeze, null); assert.equal(value.secondFilter, null);
});
