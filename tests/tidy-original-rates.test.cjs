const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const filename = path.join(__dirname, '../src/lib/tidyOriginalRates.ts');
const source = fs.readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const api = {};
new Function('exports', compiled)(api);
const { buildTidyModel, tidySourceCell, tidyBodySourceCell, tidyStatusTone } = api;
const fixture = (rows, columns = Math.max(...rows.map(row => row.length)), extra = {}) => ({
  sheet: { sheetId: 1, title: '原表', index: 0, rowCount: rows.length, columnCount: columns, frozenRowCount: 0, frozenColumnCount: 0 },
  cells: rows.map(row => Array.from({ length: columns }, (_, i) => ({ text: row[i] ?? '' }))),
  merges: [], rowHeights: [], columnWidths: [], hiddenRows: [], hiddenColumns: [],
  fetchedAt: '2026-09-14T00:00:00Z', rowCount: rows.length, columnCount: columns, ...extra,
});

// Read-only live snapshot header shapes (first three rows); an irrelevant email
// header is redacted. Source values are fixtures, never configuration/instructions.
const snapshots = [
  {
    "title": "USDT通道",
    "columns": 56,
    "rows": [
      [
        "三方名称",
        "代收",
        "代付",
        "三方名称",
        "合计费率",
        "代收合计%+单笔",
        "代付合计%+单笔",
        "代收最低限制",
        "代收最高限制",
        "代付最低限制",
        "代付最高限制",
        "代收费率",
        "代付费率",
        "代收单笔",
        "代付单笔 ",
        "状态",
        "是否有漏洞",
        "白名单ip是否核对",
        "91CLUB",
        "55CLUB",
        "OKWIN",
        "JALWA",
        "BIGMUMBAI",
        "IN999",
        "INDIA82",
        "LOTTERY7",
        "RAJA",
        "TPPLAY",
        "51GAME",
        "6CLUB",
        "JAICLUB",
        "DHANIWIN",
        "SHREEWIN",
        "VEERGAME",
        "92PKR",
        "92R",
        "92COCO",
        "92DADU",
        "92GO",
        "92GLORY",
        "3PATISUPER",
        "YAYWIN",
        "92STAR",
        "92STRIKE",
        "POPZAR",
        "FB999",
        "55FIVE",
        "MZPLAY",
        "66CLUB",
        "VN168",
        "6LOTTERY",
        "92LOTTERY",
        "82VN",
        "98VV",
        "XX98",
        "VNCORE"
      ],
      [
        "UNIPAY",
        "开启 🟢",
        "开启 🟢",
        "UniPayUSDTCU",
        "6.4TRX",
        "2.9TRX",
        "3.5TRX",
        "10 USDT",
        "100000 USDT",
        "10 USDT",
        "50000 USDT",
        "2.9TRX",
        "3.5TRX",
        "没有",
        "没有",
        "正常",
        "",
        "",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "未接入 ⭕",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "未接入 ⭕",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "未接入 ⭕",
        "未接入 ⭕",
        "开启 🟢"
      ],
      [
        "AYPayUSDTCU",
        "备用 🟡",
        "备用 🟡",
        "AYPayUSDTCU",
        "7TRX",
        "3TRX",
        "4TRX",
        "10 USDT",
        "100000 USDT",
        "10 USDT",
        "50000 USDT",
        "3TRX",
        "4TRX",
        "没有",
        "没有",
        "备用",
        "",
        "",
        "未接入 ⭕",
        "未接入 ⭕",
        "备用 🟡",
        "备用 🟡",
        "未接入 ⭕",
        "未接入 ⭕",
        "备用 🟡",
        "未接入 ⭕",
        "备用 🟡",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "暂时停 ⚠️",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "暂时停 ⚠️",
        "未接入 ⭕",
        "备用 🟡",
        "未接入 ⭕",
        "备用 🟡",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕"
      ]
    ],
    "merges": []
  },
  {
    "title": "印度原生线上",
    "columns": 40,
    "rows": [
      [
        "原表备注（非三方字段）",
        "代收",
        "代付",
        "可否转移资金",
        "三方",
        "原生代收总计 %",
        "代收合计%+单笔",
        "代付合计%+单笔",
        "唤醒代收最低限制",
        "唤醒代收最高限制",
        "唤醒代付最低限制",
        "唤醒代付最高限制",
        "原生代收最低限制",
        "原生代收最高限制",
        "原生代付最低限制",
        "原生代付最高限制",
        "原生代收费率",
        "唤醒代收费率",
        "单笔",
        "三方收款UPI账号",
        "是否有漏洞",
        "白名单ip是否核对",
        "代付费率",
        "单笔",
        "KPGAME",
        "VGGAME",
        "66GAME",
        "RA9",
        "EZ777",
        "EK7",
        "8GAME",
        "66GAME",
        "YYGAME",
        "XX6",
        "XX7",
        "XX5",
        "YY9",
        "",
        "状态",
        "状态备注内容"
      ],
      [
        "TodayPay 原生",
        "✅",
        "✅",
        "",
        "TodayPay 原生",
        "10.7%",
        "7.70% + 0",
        "3.00% + 6",
        "100-2000",
        "",
        "200-50000",
        "",
        "200-5000",
        "",
        "200-45000",
        "",
        "7.70%",
        "",
        "",
        "不能提供",
        "",
        "",
        "3%",
        "6",
        "开启 🟢",
        "开启 🟢",
        "未接入 ⭕",
        "未接入 ⭕",
        "开启 🟢",
        "备用 🟡",
        "开启 🟢",
        "停用 ⛔",
        "停用 ⛔",
        "停用 ⛔",
        "停用 ⛔",
        "未接入 ⭕",
        "未接入 ⭕",
        "",
        "开启 🟢",
        "运行中"
      ],
      [
        "KumarPay 原生 跑路",
        "",
        "",
        "",
        "KumarPay 原生 跑路",
        "11.5%",
        "8.50% + 0",
        "3.00% + 6",
        "100-3000",
        "",
        "",
        "",
        "100-3000",
        "",
        "100-9500\n100-20000\n500-30000\n100-30000",
        "",
        "8.50%",
        "",
        "",
        "",
        "",
        "",
        "3%",
        "6",
        "开启 🟢",
        "开启 🟢",
        "未接入 ⭕",
        "未接入 ⭕",
        "开启 🟢",
        "未接入 ⭕",
        "停用 ⛔",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "",
        "不支持 ❌",
        "盘口不支持接入"
      ]
    ],
    "merges": []
  },
  {
    "title": "印度线下",
    "columns": 49,
    "rows": [
      [
        "三方名称",
        "类型",
        "代收",
        "代付",
        "唤醒费率合计 %",
        "代收合计%+单笔",
        "代付合计%+单笔",
        "唤醒代收最低限制",
        "唤醒代收最高限制",
        "唤醒代付最低限制",
        "唤醒代付最高限制",
        "唤醒代收费率",
        "代付费率",
        "代收单笔",
        "代付单笔",
        "代收情况",
        "代付情况",
        "切换通道通知出款群组名称",
        "创建单子非整数",
        "授信",
        "公户打款",
        "限额最高",
        "打款时间",
        "三方收款UPI账号",
        "三方是否愿意升级",
        "是否有漏洞",
        "白名单ip是否核对",
        "请问我们商户是否支持IFSC AIRP0000001",
        "UTR接口查单补单",
        "代付出款成功支持UTR返回",
        "收款是使用公户还是 个人",
        "91CLUB",
        "55CLUB",
        "OKWIN",
        "JALWA",
        "BIGMUMBAI",
        "IN999",
        "INDIA82",
        "LOTTERY7",
        "RAJA",
        "TPPLAY",
        "51GAME",
        "6CLUB",
        "JAICLUB",
        "Dhawin",
        "Shreewin",
        "VEERGAME",
        "状态",
        "状态备注内容"
      ],
      [
        "PAILE",
        "",
        "✅",
        "✅",
        "7.50% + 6",
        "4.50% + 0",
        "3.00% + 6",
        "100",
        "50000",
        "100",
        "50000",
        "4.50%",
        "3%",
        "没有",
        "6",
        "支持",
        "50万",
        "北京时间下午14点到晚上23点左右",
        "会有小数点",
        "可以授信",
        "支持",
        "50万",
        "北京时间下午14点到晚上23点左右",
        "能提供 ( 手动查）",
        "能提供 ( 手动查）",
        "没有",
        "已核对",
        "支持 ✅",
        "支持\r",
        "凭证可以看utr",
        "公户.  19%成功率",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "未接入 ⭕",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "不支持 ❌",
        "盘口不支持接入"
      ],
      [
        "SUPER",
        "",
        "✅",
        "✅",
        "6.50% + 6",
        "4.00% + 0",
        "2.50% + 6",
        "100",
        "50000",
        "100",
        "100000",
        "4.00%",
        "2.50%",
        "没有",
        "6",
        "不支持",
        "50万",
        "",
        "会有小数点",
        "不支持",
        "不支持",
        "不支持",
        "不支持",
        "不能提供",
        "不愿意升级",
        "没有",
        "已核对",
        "支持 ✅",
        "支持\r",
        "一般都是自动回调的",
        "公户/个人",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "未接入 ⭕",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "未接入 ⭕",
        "未接入 ⭕",
        "暂停 ⚠️",
        "暂时停用"
      ]
    ],
    "merges": []
  },
  {
    "title": "IFSC支持三方",
    "columns": 8,
    "rows": [
      [
        "银行",
        "三方",
        "支持",
        "不支持",
        "原因",
        "",
        "状态",
        "状态备注内容"
      ],
      [
        "AIRTEL PAYMENTS BANK LIMITED",
        "7DAY-LAKSHMI",
        "🟢",
        "",
        "",
        "",
        "开启 🟢",
        "运行中"
      ],
      [
        "",
        "RUJIA-DHANA",
        "🟢",
        "",
        "",
        "",
        "不支持 ❌",
        "盘口不支持接入"
      ]
    ],
    "merges": []
  },
  {
    "title": "巴西盘口",
    "columns": 59,
    "rows": [
      [
        "三方名称",
        "代收",
        "代付",
        "三方名称",
        "合计费率",
        "代收合计%+单笔",
        "代付合计%+单笔",
        "代收最低限制",
        "代收最高限制",
        "代付最低限制",
        "代付最高限制",
        "代收费率",
        "代付费率",
        "代收单笔",
        "代付单笔 ",
        "状态",
        "是否有漏洞",
        "白名单ip是否核对",
        "POPBRA",
        "POP888",
        "SSSGAME",
        "TGJOGO",
        "26BET",
        "POPKKK新",
        "POP678",
        "POP555",
        "POPPG",
        "POPLUA",
        "POPBEM",
        "POPCEU",
        "POPMEL",
        "SSS55",
        "POPWB",
        "POPDEZ",
        "BOOMRIO",
        "POPBOA",
        "POPFLU",
        "POPBIS",
        "POPN1",
        "POPVAI",
        "POPLUZ",
        "POPZOE",
        "POPSUR",
        "PLAYERBR",
        "POPBEA",
        "POPTIG",
        "POPFOI",
        "POPNOV",
        "POPFEZ",
        "POPCRA",
        "POPSEN",
        "POPBUL",
        "POPTAM",
        "43r",
        "POPMIU",
        "",
        "",
        "状态",
        "状态备注内容"
      ],
      [
        "TransafePayBRL",
        "开启 🟢",
        "开启 🟢",
        "TransafePayBRL",
        "0.20%",
        "0.20% + 0",
        "0% + 0",
        "10",
        "15000",
        "10",
        "15000",
        "0.20%",
        "0.00%",
        "没有",
        "没有",
        "正常",
        "否",
        "是",
        "开启 🟢",
        "开启 🟢",
        "未接入 ⭕",
        "未接入 ⭕",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "",
        "",
        "",
        "开启 🟢",
        "运行中"
      ],
      [
        "PAY4Z",
        "开启 🟢",
        "开启 🟢",
        "PAY4Z",
        "0.20%",
        "0.20% + 0",
        "0% + 0",
        "10",
        "15000",
        "10",
        "15000",
        "0.20%",
        "0.00%",
        "没有",
        "没有",
        "正常",
        "否",
        "是",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "",
        "",
        "",
        "不支持 ❌",
        "盘口不支持接入"
      ]
    ],
    "merges": []
  },
  {
    "title": "越南盘口",
    "columns": 25,
    "rows": [
      [
        " ",
        "",
        "",
        "",
        "越南三方",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "使用盘口",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "状态",
        "状态备注内容"
      ],
      [
        "类型",
        "三方",
        "代收合计%+单笔",
        "代付合计%+单笔",
        "代收费率",
        "代付费率",
        "代收单笔",
        "代付单笔 ",
        "代收最低限制",
        "代收最高限制",
        "代付最低限制",
        "代付最高限制",
        "是否有漏洞",
        "白名单ip是否核对",
        "92LOTTERY",
        "66CLUB",
        "VN168",
        "82VN",
        "交易所-COINVID",
        "98VV",
        "VNCORE",
        "XX98",
        "",
        "开启 🟢",
        "运行中"
      ],
      [
        "BANKQR",
        "PANPAY",
        "0.60% + 0",
        "0.00% + 0",
        "0.60%",
        "没有",
        "没有",
        "没有",
        "100000  ( VND )",
        "300000000  ( VND )",
        "100000  ( VND )",
        "300000000  ( VND )",
        "",
        "",
        "维护 🛠️",
        "维护 🛠️",
        "维护 🛠️",
        "维护 🛠️",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "未接入 ⭕",
        "",
        "不支持 ❌",
        "盘口不支持接入"
      ]
    ],
    "merges": [
      {
        "endRowIndex": 1,
        "startRowIndex": 0,
        "endColumnIndex": 14,
        "startColumnIndex": 4
      },
      {
        "endRowIndex": 1,
        "startRowIndex": 0,
        "endColumnIndex": 22,
        "startColumnIndex": 14
      }
    ]
  },
  {
    "title": "印尼盘",
    "columns": 43,
    "rows": [
      [
        "类型",
        "三方",
        "费率合计%+单笔",
        "代收合计%+单笔",
        "代付合计%+单笔",
        "代收手续费",
        "代收单笔",
        "代付手续费",
        "代付单笔",
        "代收最低限制",
        "代收最高限制",
        "代付最低限制",
        "代付最低限高",
        "通道情况",
        "是否有漏洞",
        "白名单ip是否核对",
        "",
        "三方",
        "代收",
        "代付",
        "55FIVE",
        "",
        "UANG",
        "",
        "HOT985",
        "",
        "IND666",
        "",
        "FB168",
        "",
        "FB333",
        "",
        "LG111",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
      ],
      [
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "代收",
        "代付",
        "代收",
        "代付",
        "代收",
        "代付",
        "代收",
        "代付",
        "代收",
        "代付",
        "代收",
        "代付",
        "代收",
        "代付",
        "代收",
        "代付",
        "代收",
        "代付",
        "代收",
        "代付",
        "",
        "",
        ""
      ],
      [
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
      ]
    ],
    "merges": [
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 8,
        "startColumnIndex": 7
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 9,
        "startColumnIndex": 8
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 10,
        "startColumnIndex": 9
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 11,
        "startColumnIndex": 10
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 12,
        "startColumnIndex": 11
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 13,
        "startColumnIndex": 12
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 14,
        "startColumnIndex": 13
      },
      {
        "endRowIndex": 1,
        "startRowIndex": 0,
        "endColumnIndex": 26,
        "startColumnIndex": 24
      },
      {
        "endRowIndex": 1,
        "startRowIndex": 0,
        "endColumnIndex": 28,
        "startColumnIndex": 26
      },
      {
        "endRowIndex": 1,
        "startRowIndex": 0,
        "endColumnIndex": 30,
        "startColumnIndex": 28
      },
      {
        "endRowIndex": 1,
        "startRowIndex": 0,
        "endColumnIndex": 32,
        "startColumnIndex": 30
      },
      {
        "endRowIndex": 1,
        "startRowIndex": 0,
        "endColumnIndex": 34,
        "startColumnIndex": 32
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 1,
        "startColumnIndex": 0
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 2,
        "startColumnIndex": 1
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 3,
        "startColumnIndex": 2
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 4,
        "startColumnIndex": 3
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 5,
        "startColumnIndex": 4
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 6,
        "startColumnIndex": 5
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 7,
        "startColumnIndex": 6
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 15,
        "startColumnIndex": 14
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 16,
        "startColumnIndex": 15
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 18,
        "startColumnIndex": 17
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 19,
        "startColumnIndex": 18
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 20,
        "startColumnIndex": 19
      },
      {
        "endRowIndex": 1,
        "startRowIndex": 0,
        "endColumnIndex": 22,
        "startColumnIndex": 20
      },
      {
        "endRowIndex": 1,
        "startRowIndex": 0,
        "endColumnIndex": 24,
        "startColumnIndex": 22
      }
    ]
  },
  {
    "title": "菲律宾盘口",
    "columns": 31,
    "rows": [
      [
        "类型",
        "三方",
        "通道类型",
        "三方代收通道",
        "费率合计",
        "代收合计%+单笔",
        "代付合计%+单笔",
        "类型",
        "代收单笔",
        "代付手续费",
        "代收最低限制",
        "代收最高限制",
        "代付最低限制",
        "代付最高限制",
        "通道情况状态",
        "SUPERLG",
        "",
        "LGPARTY",
        "",
        "LGSABONG",
        "",
        "PH19",
        "",
        "",
        "",
        "",
        "",
        "",
        "三方",
        "银行卡代收",
        "银行卡代付"
      ],
      [
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "代收",
        "代付",
        "代收",
        "代付",
        "代收",
        "代付",
        "代收",
        "代付",
        "",
        "",
        "",
        "",
        "",
        "kilipay",
        "❌",
        "✅"
      ],
      [
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
      ]
    ],
    "merges": [
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 15,
        "startColumnIndex": 14
      },
      {
        "endRowIndex": 1,
        "startRowIndex": 0,
        "endColumnIndex": 17,
        "startColumnIndex": 15
      },
      {
        "endRowIndex": 1,
        "startRowIndex": 0,
        "endColumnIndex": 19,
        "startColumnIndex": 17
      },
      {
        "endRowIndex": 1,
        "startRowIndex": 0,
        "endColumnIndex": 21,
        "startColumnIndex": 19
      },
      {
        "endRowIndex": 1,
        "startRowIndex": 0,
        "endColumnIndex": 23,
        "startColumnIndex": 21
      },
      {
        "endRowIndex": 1,
        "startRowIndex": 0,
        "endColumnIndex": 25,
        "startColumnIndex": 23
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 8,
        "startColumnIndex": 7
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 9,
        "startColumnIndex": 8
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 10,
        "startColumnIndex": 9
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 11,
        "startColumnIndex": 10
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 12,
        "startColumnIndex": 11
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 13,
        "startColumnIndex": 12
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 14,
        "startColumnIndex": 13
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 2,
        "startColumnIndex": 1
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 1,
        "startColumnIndex": 0
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 3,
        "startColumnIndex": 2
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 4,
        "startColumnIndex": 3
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 5,
        "startColumnIndex": 4
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 6,
        "startColumnIndex": 5
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 7,
        "startColumnIndex": 6
      }
    ]
  },
  {
    "title": "马来盘",
    "columns": 18,
    "rows": [
      [
        "类型",
        "三方",
        "费率合计",
        "代收手续费",
        "代付手续费",
        "代收单笔",
        "代付单笔",
        "代收最低限制",
        "代收最高限制",
        "代付最低限制",
        "代付最高限制",
        "通道情况",
        "是否有漏洞",
        "白名单ip是否核对",
        "MZPLAY",
        "",
        "状态",
        "状态备注内容"
      ],
      [
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "开启 🟢",
        "运行中"
      ],
      [
        "银行卡\n BANK CARD",
        "FPX-Fpay",
        "1.80%",
        "1.00%",
        "0.80%",
        "没有",
        "没有",
        "10",
        "20000",
        "30",
        "30000",
        "23h45 维护到 00h15 完成",
        "",
        "",
        "开启 🟢",
        "",
        "不支持 ❌",
        "盘口不支持接入"
      ]
    ],
    "merges": [
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 8,
        "startColumnIndex": 7
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 9,
        "startColumnIndex": 8
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 10,
        "startColumnIndex": 9
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 11,
        "startColumnIndex": 10
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 12,
        "startColumnIndex": 11
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 13,
        "startColumnIndex": 12
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 14,
        "startColumnIndex": 13
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 15,
        "startColumnIndex": 14
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 1,
        "startColumnIndex": 0
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 3,
        "startColumnIndex": 2
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 4,
        "startColumnIndex": 3
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 5,
        "startColumnIndex": 4
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 6,
        "startColumnIndex": 5
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 7,
        "startColumnIndex": 6
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 2,
        "startColumnIndex": 1
      }
    ]
  },
  {
    "title": "巴基斯坦盘口",
    "columns": 45,
    "rows": [
      [
        "三方名称",
        "Easy代收",
        "Jazz代收",
        "Easy代付",
        "Jazz代付",
        "三方名称",
        "合计%+单笔 Easy",
        "代收合计%+单笔 Easy",
        "代付合计%+单笔 Easy",
        "合计%+单笔Jazz",
        "代收合计%+单笔 Jazz",
        "代付合计%+单笔Jazz",
        "easy 代收",
        "Jazz 代收",
        "easy 代付",
        "Jazz 代付",
        "Easy代收单笔",
        "Jazz代收单笔",
        " Easy 代付单笔",
        "Jazz 代付单笔",
        "easy 扫码 代收",
        "代收最低限制",
        "代收最高限制",
        "代付最低限制",
        "代付最高限制",
        "代收情况",
        "代付情况",
        "是否有漏洞",
        "白名单ip是否核对",
        "92PKR",
        "92R",
        "92COCO",
        "92DADU",
        "92GO",
        "92GLORY",
        "3PATISUPER",
        "YAYWIN",
        "92STAR",
        "92STRIKE",
        "POPZAR",
        "LG789",
        "92GAME",
        "",
        "状态",
        "状态备注内容"
      ],
      [
        "Okpay",
        "✅",
        "✅",
        "✅",
        "✅",
        "Okpay",
        "6.00%",
        "4.5%+0",
        "1.5%+0",
        "3.70%",
        "2.2%+0",
        "1.5%+0",
        "4.50%",
        "2.20%",
        "1.50%",
        "1.50%",
        "没有",
        "没有",
        "没有",
        "没有",
        "3.00%",
        "100",
        "50000",
        "100",
        "50000",
        "正常",
        "正常提交",
        "否",
        "是",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "",
        "开启 🟢",
        "运行中"
      ],
      [
        "OWEN PAY -Owpay",
        "❌",
        "✅",
        "✅",
        "✅",
        "OWEN PAY",
        "5.60%",
        "4.1%+0",
        "1.5%+0",
        "3.60%",
        "2.1%+0",
        "1.5%+0",
        "4.10%",
        "2.10%",
        "1.50%",
        "1.50%",
        "没有",
        "没有",
        "没有",
        "没有",
        "",
        "100",
        "50000",
        "100",
        "50000",
        "正常",
        "正常提交",
        "否",
        "是",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "开启 🟢",
        "",
        "不支持 ❌",
        "盘口不支持接入"
      ]
    ],
    "merges": []
  },
  {
    "title": "南美盘口",
    "columns": 23,
    "rows": [
      [
        "国家",
        "通道类型",
        "三方名称",
        "合计%+单笔",
        "代收合计%+单笔",
        "代付合计%+单笔",
        "结算周期",
        "代收最低限制",
        "代收最高限制",
        "代付最低限制",
        "代付最高限制",
        "代收费率",
        "代付费率",
        "代收单笔",
        "代付单笔",
        "通道情况",
        "状态",
        "",
        "墨西哥平台提款收手续费",
        "",
        "",
        "状态",
        "状态备注内容"
      ],
      [
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "开启 🟢",
        "运行中"
      ],
      [
        "NPG-MEXICO",
        "SPEI",
        "TOD",
        "0.0%+3.0笔",
        "0%+1.5",
        "0%+1.5",
        "D0",
        "40",
        "50001",
        "40",
        "50001",
        "没有",
        "没有",
        "1.5",
        "1.5",
        "开启 🟢",
        "开启 🟢",
        "",
        "vip0",
        "1.20%",
        "",
        "不支持 ❌",
        "盘口不支持接入"
      ]
    ],
    "merges": [
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 15,
        "startColumnIndex": 14
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 16,
        "startColumnIndex": 15
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 17,
        "startColumnIndex": 16
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 20,
        "startColumnIndex": 18
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 8,
        "startColumnIndex": 7
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 9,
        "startColumnIndex": 8
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 10,
        "startColumnIndex": 9
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 11,
        "startColumnIndex": 10
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 12,
        "startColumnIndex": 11
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 13,
        "startColumnIndex": 12
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 14,
        "startColumnIndex": 13
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 2,
        "startColumnIndex": 1
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 1,
        "startColumnIndex": 0
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 3,
        "startColumnIndex": 2
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 4,
        "startColumnIndex": 3
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 5,
        "startColumnIndex": 4
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 6,
        "startColumnIndex": 5
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 7,
        "startColumnIndex": 6
      }
    ]
  },
  {
    "title": "缅甸盘",
    "columns": 20,
    "rows": [
      [
        "类型",
        "三方名称",
        "合计%+单笔",
        "代收合计%+单笔",
        "代付合计%+单笔",
        "代收手续费",
        "代付手续费",
        "代收单笔",
        "代付单笔",
        "代收最低限制",
        "代收最高限制",
        "代付最低限制",
        "代付最高限制",
        "通道情况",
        "是否有漏洞",
        "白名单ip是否核对",
        "6LOTTERY",
        "",
        "状态",
        "状态备注内容"
      ],
      [
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "开启 🟢",
        "运行中"
      ],
      [
        "KBZ",
        "BcatPay",
        "1.4%+0",
        "1.4%+0",
        "0%+0",
        "1.40%",
        "0.00%",
        "没有",
        "没有",
        "2000",
        "1000000",
        "2000",
        "1000000",
        "",
        "",
        "",
        "暂时停 ⚠️",
        "",
        "不支持 ❌",
        "盘口不支持接入"
      ]
    ],
    "merges": [
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 15,
        "startColumnIndex": 14
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 16,
        "startColumnIndex": 15
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 17,
        "startColumnIndex": 16
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 8,
        "startColumnIndex": 7
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 9,
        "startColumnIndex": 8
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 10,
        "startColumnIndex": 9
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 11,
        "startColumnIndex": 10
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 12,
        "startColumnIndex": 11
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 13,
        "startColumnIndex": 12
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 14,
        "startColumnIndex": 13
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 1,
        "startColumnIndex": 0
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 2,
        "startColumnIndex": 1
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 3,
        "startColumnIndex": 2
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 4,
        "startColumnIndex": 3
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 5,
        "startColumnIndex": 4
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 6,
        "startColumnIndex": 5
      },
      {
        "endRowIndex": 2,
        "startRowIndex": 0,
        "endColumnIndex": 7,
        "startColumnIndex": 6
      }
    ]
  },
  {
    "title": "尼日利亚盘口",
    "columns": 19,
    "rows": [
      [
        "",
        "",
        "",
        "",
        "",
        "尼日利亚三方",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "使用盘口",
        "",
        "状态",
        "状态备注内容"
      ],
      [
        "类型",
        "三方名称",
        "合计%+单笔",
        "代收合计%+单笔",
        "代付合计%+单笔",
        "代收费率",
        "代付费率",
        "代收单笔",
        "代付单笔",
        "代付最低限额",
        "代付最高限额",
        "代收最低限额",
        "代收最高限额",
        "是否有漏洞",
        "白名单ip是否核对",
        "FB999",
        "",
        "开启 🟢",
        "运行中"
      ],
      [
        "BANK",
        "WPPay",
        "4.50%",
        "3%+0",
        "1.5%+50",
        "3.00%",
        "1.50%",
        "没有",
        "50",
        "100 (NGN)",
        "1000000",
        "100 (NGN)",
        "1000000",
        "否",
        "已核对",
        "开启 🟢",
        "",
        "不支持 ❌",
        "盘口不支持接入"
      ]
    ],
    "merges": [
      {
        "endRowIndex": 1,
        "startRowIndex": 0,
        "endColumnIndex": 15,
        "startColumnIndex": 5
      }
    ]
  },
  {
    "title": "埃及-已关盘",
    "columns": 6,
    "rows": [
      [
        "三方名称",
        "三方代收手续费/代收区间/通道情况",
        "",
        "",
        "三方代付手续费/代付区间/通道情况",
        ""
      ],
      [
        "Hipay",
        "代收手续费",
        "5%",
        "",
        "代付手续费",
        "3%"
      ],
      [
        "",
        "代收区间",
        "200-20000",
        "",
        "代付区间",
        "200-20000"
      ]
    ],
    "merges": [
      {
        "endRowIndex": 1,
        "startRowIndex": 0,
        "endColumnIndex": 3,
        "startColumnIndex": 1
      },
      {
        "endRowIndex": 1,
        "startRowIndex": 0,
        "endColumnIndex": 6,
        "startColumnIndex": 4
      }
    ]
  },
  {
    "title": "UTR支持/不支持返回",
    "columns": 4,
    "rows": [
      [
        "序号",
        "三方",
        "UTR接口查单补单",
        "代付出款成功支持UTR返回"
      ],
      [
        "1",
        "",
        "",
        ""
      ],
      [
        "2",
        "",
        "",
        ""
      ]
    ],
    "merges": []
  }
];

test('all fifteen native header shapes preserve every visible column, order and original text', () => {
  const expectedDepth = [1, 1, 1, 1, 1, 2, 2, 2, 2, 1, 2, 2, 2, 1, 1];
  const expectedProvider = [0, 4, 0, 1, 0, 1, 1, 1, 1, 0, 2, 1, 1, 0, 1];
  for (const [index, sample] of snapshots.entries()) {
    const grid = fixture(sample.rows, sample.columns, { merges: sample.merges });
    grid.sheet.title = sample.title;
    const before = JSON.stringify(grid), model = buildTidyModel(grid);
    assert.equal(model.headerRows, expectedDepth[index], sample.title);
    assert.equal(model.providerColumn, expectedProvider[index], sample.title);
    assert.deepEqual(model.columns.map(column => column.sourceColumn), Array.from({ length: sample.columns }, (_, i) => i), sample.title);
    assert.equal(JSON.stringify(grid), before, sample.title);
    assert.equal(new Set(model.rows).size, model.rows.length, sample.title);
  }
});

test('India compact retains exact combined fee and platform cells but full retains notes, bounds, zeros and duplicates', () => {
  const sample = snapshots.find(sample => sample.title === '印度线下');
  const grid = fixture(sample.rows, sample.columns, { merges: sample.merges });
  const model = buildTidyModel(grid), compact = model.columns.filter(column => column.compact);
  assert.equal(model.platformColumns.length, 16);
  assert.deepEqual(model.platformColumns, Array.from({ length: 16 }, (_, i) => i + 31));
  assert(compact.some(column => column.sourceColumn === 5));
  assert(compact.some(column => column.sourceColumn === 6));
  assert(!compact.some(column => column.sourceColumn === 7));
  assert(!compact.some(column => column.sourceColumn === 48));
  assert.equal(tidySourceCell(grid, 1, 5).text, '4.50% + 0');
  assert.equal(tidySourceCell(grid, 1, 13).text, '没有');
  assert.equal(tidySourceCell(grid, 2, 0).text, 'SUPER');
  assert.equal(model.columns[1].label, '类型');
  assert.equal(tidySourceCell(grid, 1, 1).text, '');
  const brazil = snapshots.find(sample => sample.title === '巴西盘口');
  const br = buildTidyModel(fixture(brazil.rows, brazil.columns));
  assert.deepEqual(br.columns.filter(column => column.label === '三方名称').map(column => column.sourceColumn), [0, 3]);
  assert.deepEqual(br.columns.filter(column => column.label === '状态').map(column => column.sourceColumn), [15, 57]);
  assert.equal(br.columns[55].label, '');
  assert.equal(br.columns[56].label, '');
  assert(br.platformColumns.includes(54), 'blank new POPMIU remains in platform band');
});

test('different header heights preserve parallel-table data without repeating main header cells', () => {
  const sample = snapshots.find(sample => sample.title === '菲律宾盘口');
  const grid = fixture(sample.rows, sample.columns, { merges: sample.merges });
  const model = buildTidyModel(grid);
  assert.equal(model.headerRows, 2);
  assert(model.rows.includes(1), 'AC2 remains a body row');
  assert.equal(model.columns[28].label, '三方');
  assert.equal(tidyBodySourceCell(grid, 1, model.columns[28], model.headerRows).text, 'kilipay');
  assert.equal(tidyBodySourceCell(grid, 1, model.columns[1], model.headerRows).text, '');
  assert.equal(tidyBodySourceCell(grid, 1, model.columns[15], model.headerRows).text, '');
  assert.equal(model.columns[15].label, 'SUPERLG / 代收');
  assert.equal(model.columns[16].label, 'SUPERLG / 代付');
});

test('Nigeria detects second header row despite only one frozen row; third blank Indonesia row remains data space', () => {
  const ng = snapshots.find(sample => sample.title === '尼日利亚盘口');
  const grid = fixture(ng.rows, ng.columns, { merges: ng.merges }); grid.sheet.frozenRowCount = 1;
  const model = buildTidyModel(grid);
  assert.equal(model.headerRows, 2); assert.equal(model.typeColumn, 0);
  assert.equal(model.columns[15].label, '使用盘口 / FB999');
  const id = snapshots.find(sample => sample.title === '印尼盘');
  const indo = fixture(id.rows, id.columns, { merges: id.merges }); indo.sheet.frozenRowCount = 3;
  const im = buildTidyModel(indo);
  assert.equal(im.headerRows, 2); assert(im.rows.includes(2));
  assert.equal(im.columns[20].label, '55FIVE / 代收');
  assert.equal(im.columns[21].label, '55FIVE / 代付');
});

test('recognized exact statuses are styled without substring guesses or treating blank as closed', () => {
  for (const value of ['开启 🟢', '支持 ✅', '运行中', '正常', '✅']) assert.equal(tidyStatusTone(value), 'good', value);
  for (const value of ['未接入 ⭕', '停用 ⛔', '暂停 ⚠️', '不支持 ❌', '❌']) assert.equal(tidyStatusTone(value), 'bad', value);
  for (const value of ['备用 🟡', '维护 🛠️', '暂时停 ⚠️']) assert.equal(tidyStatusTone(value), 'attention', value);
  for (const value of ['', '0', '没有', '不明确', '他说可以开启', '未接入后申请开启', '50万', '<script>开启</script>', 'UPI']) assert.equal(tidyStatusTone(value), 'plain', value);
});

test('source merge resolution preserves hidden origins, explicit blanks, original whitespace and zero strings', () => {
  const grid = fixture([['三方', '类型', '代收合计%+单笔'], ['原名\n保留', ' UPI ', '0.00% + 0'], ['', '', ''], ['尾行', '', '']], 3, {
    hiddenRows: [1], hiddenColumns: [0], merges: [{ startRowIndex: 1, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 2 }],
  });
  const model = buildTidyModel(grid);
  assert.deepEqual(model.rows, [2, 3]); assert.deepEqual(model.columns.map(column => column.sourceColumn), [1, 2]);
  assert.deepEqual(tidySourceCell(grid, 2, 1), { text: '原名\n保留', sourceRow: 1, sourceColumn: 0 });
  assert.equal(tidySourceCell(grid, 1, 2).text, '0.00% + 0');
  assert.equal(tidySourceCell(grid, 2, 2).text, '');
  assert.equal(tidySourceCell(grid, -1, 2).text, '');
  assert.equal(tidySourceCell(grid, 3, 99).text, '');
});

test('unknown new columns and text stay full, no normalized name mapping, aggregation, I/O or mutation', () => {
  const grid = fixture([['三方', '类型', '代收合计%+单笔', '使用情况', '全新字段', '原平台A', '原平台A'], ['NewWinPay2', 'PaytmQR', '4.00% + 0', '启用', '原样\n保留', '', ''], ['NewWinPay2', 'BANK', '5.00% + 1', '暂停', '0', '', '']]);
  const model = buildTidyModel(grid);
  assert.deepEqual(model.rows, [1, 2]);
  assert.equal(model.columns.length, 7);
  assert.equal(model.columns[4].label, '全新字段');
  assert(model.columns[3].compact);
  assert.equal(tidySourceCell(grid, 1, 0).text, 'NewWinPay2');
  assert.doesNotMatch(source, /\bfetch\s*\(|localStorage|sessionStorage|buildRateMap|findMatchedRate|parseThirdPartyRates|supabase\.from|eval\s*\(/);
});

test('two-level fee headers and duplicate platform children remain separate source columns', () => {
  const grid = fixture([['三方名称', '类型 / 钱包', '代收', '', '代付', '', '平台A', ''], ['', '', '费率', '单笔', '费率', '单笔', '代收', '代付'], ['原名', 'UPI', '4%', '0', '3%', '6', '开启 🟢', '停用 ⛔']], 8, { merges: [
    { startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 },
    { startRowIndex: 0, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 2 },
    { startRowIndex: 0, endRowIndex: 1, startColumnIndex: 2, endColumnIndex: 4 },
    { startRowIndex: 0, endRowIndex: 1, startColumnIndex: 4, endColumnIndex: 6 },
    { startRowIndex: 0, endRowIndex: 1, startColumnIndex: 6, endColumnIndex: 8 },
  ] });
  const model = buildTidyModel(grid);
  assert.equal(model.headerRows, 2); assert.equal(model.providerColumn, 0); assert.equal(model.typeColumn, 1);
  assert.equal(model.columns[2].label, '代收 / 费率'); assert.equal(model.columns[2].group, 'collect');
  assert.equal(model.columns[4].label, '代付 / 费率'); assert.equal(model.columns[4].group, 'payout');
  assert.deepEqual(model.platformColumns, [6, 7]); assert.deepEqual(model.rows, [2]);
});

test('invalid dimensions and overlapping merges cannot allocate unbounded output or conceal neighboring cells', () => {
  const grid = fixture([['三方', '类型', '备注'], ['A', 'B', 'C'], ['D', 'E', 'F']], 3, { merges: [
    { startRowIndex: -1, endRowIndex: 200, startColumnIndex: 0, endColumnIndex: 3 },
    { startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 2 },
    { startRowIndex: 1, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 3 },
  ] });
  assert.equal(tidySourceCell(grid, 1, 1).text, 'A'); assert.equal(tidySourceCell(grid, 2, 1).text, 'E');
  assert.equal(tidySourceCell(grid, 1, 2).text, 'C');
  assert.equal(buildTidyModel({ ...grid, rowCount: 1e9 }).columns.length, 0);
  assert.equal(buildTidyModel({ ...grid, columnCount: 1e9 }).rows.length, 0);
});

test('a new unrecognized platform status stays visible and plain instead of dropping the platform', () => {
  const grid = fixture([['三方', '代收合计%+单笔', 'PLATFORM_A(AR)', '平台乙(WG)', 'NEW_PLATFORM', '状态备注内容'], ['A', '4% + 0', '开启 🟢', '停用 ⛔', '', '开启后待处理'], ['B', '5% + 0', '维护待确认', '全新状态', '', '']]);
  const model = buildTidyModel(grid);
  assert.deepEqual(model.platformColumns, [2, 3, 4]);
  assert.equal(tidySourceCell(grid, 2, 2).text, '维护待确认');
  assert.equal(tidyStatusTone(tidySourceCell(grid, 2, 2).text), 'plain');
  assert.equal(model.columns[5].group, 'other');
});

test('source merge resolution keeps valid anchors after the former two-thousand-merge cutoff', () => {
  const count = 2_101;
  const rows = [['三方', '类型', '其他'], ...Array.from({ length: count }, (_, i) => [`原点${i}`, '覆盖值不应显示', ''])];
  const merges = Array.from({ length: count }, (_, i) => ({ startRowIndex: i + 1, endRowIndex: i + 2, startColumnIndex: 0, endColumnIndex: 2 }));
  const grid = fixture(rows, 3, { merges });
  assert.deepEqual(tidySourceCell(grid, 2_101, 1), { text: '原点2100', sourceRow: 2_101, sourceColumn: 0 });
  assert.equal(tidySourceCell(grid, 2_001, 1).text, '原点2000');
});

test('projection type-checks under the repository actual ES5 compiler configuration', () => {
  const configPath = ts.findConfigFile(path.resolve(__dirname, '..'), ts.sys.fileExists, 'tsconfig.json');
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(loaded.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(configPath));
  assert.equal(parsed.options.target, ts.ScriptTarget.ES5);
  const program = ts.createProgram([filename], { ...parsed.options, incremental: false });
  const diagnostics = ts.getPreEmitDiagnostics(program).filter(diagnostic => !diagnostic.file || diagnostic.file.fileName === filename);
  assert.deepEqual(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), []);
});
