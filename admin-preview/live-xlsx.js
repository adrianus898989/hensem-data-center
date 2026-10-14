(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.HensemXlsx = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';
  // Dependency-free OOXML / ZIP32 STORE. Strings are always literal text;
  // callers must supply identifiers and exact decimal amounts as strings.
  const encoder = new TextEncoder();
  const MAX_ROWS = 1048576, MAX_COLUMNS = 16384, MAX_TEXT = 32767, ZIP32_MAX = 0xffffffff;
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  function xml(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function cellText(value) {
    if (value.length > MAX_TEXT) throw new RangeError('XLSX cell text exceeds 32767 characters');
    // Protect literal ST_Xstring-looking input before escaping invalid XML code
    // units. CR entities prevent XML normalization from changing CR/CRLF.
    const literal = value.replace(/_x[0-9a-fA-F]{4}_/g, match => '_x005F_' + match.slice(1));
    let result = '';
    for (let i = 0; i < literal.length; i++) {
      const code = literal.charCodeAt(i), next = literal.charCodeAt(i + 1);
      if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) result += literal[i] + literal[++i];
      else if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 0xfffe || code === 0xffff || (code >= 0xd800 && code <= 0xdfff)) result += '_x' + code.toString(16).toUpperCase().padStart(4, '0') + '_';
      else if (code === 13) result += '&#13;';
      else result += xml(literal[i]);
    }
    return result;
  }
  function column(index) {
    let result = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
    return result;
  }
  function textCell(ref, value, style) {
    return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' + cellText(value) + '</t></is></c>';
  }
  const CRC_TABLE = Uint32Array.from({length: 256}, (_, value) => {
    let crc = value;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    return crc >>> 0;
  });
  function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function zip(parts) {
    const entries = parts.map(part => ({name: encoder.encode(part.name), data: encoder.encode(part.text), crc: 0, offset: 0}));
    let localSize = 0, centralSize = 0;
    for (const entry of entries) {
      if (entry.name.length > 65535 || entry.data.length > ZIP32_MAX) throw new RangeError('XLSX exceeds ZIP32 limits');
      entry.crc = crc32(entry.data); entry.offset = localSize;
      localSize += 30 + entry.name.length + entry.data.length;
      centralSize += 46 + entry.name.length;
    }
    if (entries.length > 65535 || localSize + centralSize + 22 > ZIP32_MAX) throw new RangeError('XLSX exceeds ZIP32 limits');
    const output = new Uint8Array(localSize + centralSize + 22), view = new DataView(output.buffer);
    let at = 0;
    const u16 = value => {view.setUint16(at, value, true); at += 2;};
    const u32 = value => {view.setUint32(at, value, true); at += 4;};
    const bytes = value => {output.set(value, at); at += value.length;};
    for (const entry of entries) {
      u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(0); u16(0x0021);
      u32(entry.crc); u32(entry.data.length); u32(entry.data.length); u16(entry.name.length); u16(0);
      bytes(entry.name); bytes(entry.data);
    }
    for (const entry of entries) {
      u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(0); u16(0x0021);
      u32(entry.crc); u32(entry.data.length); u32(entry.data.length); u16(entry.name.length); u16(0); u16(0);
      u16(0); u16(0); u32(0); u32(entry.offset); bytes(entry.name);
    }
    u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length); u32(centralSize); u32(localSize); u16(0);
    return output;
  }
  function validName(name) {
    return typeof name === 'string' && name.trim() && name.length <= 31 && !/[\\/?*\[\]:\u0000-\u001f\u007f\ufffe\uffff]/.test(name) && !name.startsWith("'") && !name.endsWith("'") && !/[\ud800-\udfff]/.test(name.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''));
  }
  function displayWidth(value) {
    // Width is presentation only; cell contents are never shortened.
    return Array.from(String(value)).reduce((sum, char) => sum + (char.codePointAt(0) > 255 ? 2 : 1), 0);
  }
  function sheetXml(sheet) {
    const headers = sheet.headers, rows = sheet.rows, total = sheet.totalRow;
    if (!Array.isArray(headers) || !headers.length || headers.length > MAX_COLUMNS || Array.from(headers).some(value => typeof value !== 'string')) throw new TypeError('XLSX requires 1 to 16384 string headers');
    if (!Array.isArray(rows) || rows.length + 1 + (total !== undefined ? 1 : 0) > MAX_ROWS) throw new RangeError('XLSX exceeds the worksheet row limit');
    if (sheet.freezeHeader !== undefined && typeof sheet.freezeHeader !== 'boolean') throw new TypeError('XLSX freezeHeader must be boolean');
    if (sheet.autoFilter !== undefined && typeof sheet.autoFilter !== 'boolean') throw new TypeError('XLSX autoFilter must be boolean');
    const amount = sheet.amountColumns === undefined ? [] : sheet.amountColumns;
    if (!Array.isArray(amount) || Array.from(amount).some(index => !Number.isSafeInteger(index) || index < 0 || index >= headers.length) || new Set(amount).size !== amount.length) throw new TypeError('XLSX amountColumns must contain unique zero-based column indices');
    const amountSet = new Set(amount);
    let widths;
    if (sheet.widths !== undefined) {
      if (!Array.isArray(sheet.widths) || sheet.widths.length !== headers.length || Array.from(sheet.widths).some(width => typeof width !== 'number' || !Number.isFinite(width) || width < 1 || width > 255)) throw new TypeError('XLSX widths must match headers and be between 1 and 255');
      widths = sheet.widths;
    } else {
      widths = headers.map((header, col) => {
        let width = displayWidth(header);
        for (let i = 0; i < Math.min(rows.length, 100); i++) {
          const value = Array.isArray(rows[i]) ? rows[i][col] : null;
          if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) width = Math.max(width, displayWidth(value));
        }
        return Math.max(10, Math.min(42, width + 2));
      });
    }
    const sheetRows = ['<row r="1" ht="26" customHeight="1">' + headers.map((value, index) => textCell(column(index) + '1', value, 1)).join('') + '</row>'];
    function appendRow(row, rowNumber, isTotal) {
      if (!Array.isArray(row) || row.length !== headers.length) throw new TypeError('XLSX rows must match the header width');
      const cells = Array.from(row).map((value, col) => {
        const ref = column(col) + rowNumber, right = amountSet.has(col);
        const style = isTotal ? (typeof value === 'string' ? (right ? 7 : 6) : 5) : (typeof value === 'string' ? (right ? 4 : 2) : (right ? 3 : 0));
        if (value === null) return '<c r="' + ref + '" s="' + style + '"/>';
        if (typeof value === 'string') return textCell(ref, value, style);
        if (typeof value === 'number' && Number.isFinite(value)) return '<c r="' + ref + '" s="' + style + '"><v>' + (Object.is(value, -0) ? '-0' : value) + '</v></c>';
        throw new TypeError('XLSX cells must be strings, finite numbers, or null');
      });
      sheetRows.push('<row r="' + rowNumber + '">' + cells.join('') + '</row>');
    }
    for (let i = 0; i < rows.length; i++) appendRow(rows[i], i + 2, false);
    if (total !== undefined) appendRow(total, rows.length + 2, true);
    const lastColumn = column(headers.length - 1), range = 'A1:' + lastColumn + (rows.length + 1 + (total !== undefined ? 1 : 0));
    const pane = sheet.freezeHeader === false ? '' : '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>';
    const cols = widths.map((width, index) => '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' + width + '" customWidth="1"/>').join('');
    const filter = sheet.autoFilter === false ? '' : '<autoFilter ref="A1:' + lastColumn + (rows.length + 1) + '"/>';
    return XML + '<worksheet xmlns="' + MAIN + '"><dimension ref="' + range + '"/><sheetViews><sheetView workbookViewId="0">' + pane + '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>' + cols + '</cols><sheetData>' + sheetRows.join('') + '</sheetData>' + filter + '</worksheet>';
  }
  const STYLES = XML + '<styleSheet xmlns="' + MAIN + '">' +
    '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF1E3A5F"/><name val="Calibri"/></font></fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F61D5"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF1FF"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FFB8C9E8"/></top><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf>' +
    '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>' +
    '<xf numFmtId="49" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>' +
    '<xf numFmtId="49" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  /**
   * Each sheet: {name, headers:string[], rows:(string|number|null)[][],
   * widths?:number[], amountColumns?:number[], totalRow?:cell[],
   * freezeHeader?:boolean, autoFilter?:boolean}. Column indices are zero-based.
   * Totals are supplied values, never formulas or inferred sums. The filter
   * excludes that optional final row. No input objects are modified.
   */
  function encodeWorkbook(sheets) {
    if (!Array.isArray(sheets) || !sheets.length || sheets.length + 5 > 65535) throw new TypeError('XLSX requires at least one sheet within ZIP32 limits');
    const names = new Set(), prepared = Array.from(sheets).map(sheet => {
      if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet) || !validName(sheet.name)) throw new TypeError('Invalid XLSX sheet name');
      const key = sheet.name.toLowerCase();
      if (names.has(key)) throw new TypeError('Duplicate XLSX sheet name');
      names.add(key);
      return {name: sheet.name, text: sheetXml(sheet)};
    });
    const types = prepared.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('');
    const sheetNames = prepared.map((sheet, i) => '<sheet name="' + xml(sheet.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('');
    const relationships = prepared.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + REL + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('');
    return zip([
      {name: '[Content_Types].xml', text: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + types + '</Types>'},
      {name: '_rels/.rels', text: XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
      {name: 'xl/workbook.xml', text: XML + '<workbook xmlns="' + MAIN + '" xmlns:r="' + REL + '"><bookViews><workbookView/></bookViews><sheets>' + sheetNames + '</sheets></workbook>'},
      {name: 'xl/_rels/workbook.xml.rels', text: XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + relationships + '<Relationship Id="rId' + (prepared.length + 1) + '" Type="' + REL + '/styles" Target="styles.xml"/></Relationships>'},
      {name: 'xl/styles.xml', text: STYLES},
    ].concat(prepared.map((sheet, i) => ({name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: sheet.text}))));
  }
  function encodeXlsx(headers, rows, sheetName = 'Records', options) {
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options))) throw new TypeError('XLSX options must be an object');
    return encodeWorkbook([Object.assign({}, options, {name: sheetName, headers, rows})]);
  }
  return Object.freeze({encodeWorkbook, encodeXlsx});
});
