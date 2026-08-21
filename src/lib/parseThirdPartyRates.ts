// V98: 费率表按左右两列“三方”同时建立匹配，防止 Google 费率表改名/别名后页面费率空白。
import type { ThirdPartyPlatformStatusRow, ThirdPartyRatePayload, ThirdPartyRateRow } from "./types";
import { normalizeCell } from "./format";
import { canonicalThirdPartyName, inferThirdPartyChannelType } from "./thirdPartyNameMap";

type Values = string[][];

const BASE_HEADERS = [
  "类型",
  "三方名称",
  "三方",
  "费率合计",
  "合计费率",
  "代收手续费",
  "代付手续费",
  "代收",
  "代付",
  "代收费率",
  "代付费率",
  "代收限制",
  "代付限制",
  "代收限额",
  "代付限额",
  "状态",
  "通道情况",
  "是否有漏洞",
  "白名单",
  "白名单ip是否核对",
  "备注",
  "状态备注内容"
];

const RATE_COUNTRY_PRIORITY = ["印度", "巴基斯坦", "印尼", "越南", "菲律宾", "马来", "缅甸", "哥伦比亚", "墨西哥", "智利", "尼日利亚", "胖虎巴西", "巴西", "南美", "USDT通道", "USDT"];

function countryRankForSort(country: string): number {
  const text = String(country || "");
  const normalized = text.replace(/原生|盘口|线下|地区/g, "").trim();
  const index = RATE_COUNTRY_PRIORITY.findIndex((item) => normalized === item || text.includes(item));
  return index >= 0 ? index : RATE_COUNTRY_PRIORITY.length + 1;
}

function compareCountryForSort(a: string, b: string): number {
  return countryRankForSort(a) - countryRankForSort(b) || String(a || "").localeCompare(String(b || ""), "zh-CN", { numeric: true });
}

const STATUS_ORDER = ["开启", "正常", "暂停", "备用", "停用", "未接入", "维护", "不支持", "对接中", "未知"];

function get(row: string[] | undefined, index: number): string {
  if (!row || index < 0) return "";
  return normalizeCell(row[index]);
}

function compact(value: string): string {
  return normalizeCell(value).replace(/[\s：:]/g, "");
}

function inferCountry(sheetName: string): string {
  const name = normalizeCell(sheetName);
  if (name.includes("USDT")) return "USDT通道";
  // 用户确认：费率表里的“印度线下”就是印度费率；“印度原始”不参与三方量费率匹配。
  if (name.includes("印度线下")) return "印度";
  if (name.includes("印度原生") || name.includes("印度原始")) return "印度原始";
  if (name.includes("埃及")) return "埃及";
  if (name.includes("越南")) return "越南";
  if (name.includes("巴西")) return "巴西";
  if (name.includes("巴基斯坦")) return "巴基斯坦";
  if (name.includes("缅甸")) return "缅甸";
  if (name.includes("菲律宾")) return "菲律宾";
  if (name.includes("印尼")) return "印尼";
  if (name.includes("马来")) return "马来";
  if (name.includes("南美")) return "南美";
  if (name.includes("尼日利亚")) return "尼日利亚";
  if (name.includes("墨西哥") || /mexico|mex|npg[-_\s]*(me|mx)/i.test(name)) return "墨西哥";
  if (name.includes("哥伦比亚") || /colombia|columbia|col|npg[-_\s]*(co|col)/i.test(name)) return "哥伦比亚";
  if (name.includes("智利") || /chile|chl|npg[-_\s]*(cl|chl|chi)/i.test(name)) return "智利";
  return name.replace(/盘口|通道/g, "").trim() || name;
}

function southAmericaCountryFromText(text: string): "哥伦比亚" | "墨西哥" | "智利" | "" {
  const value = normalizeCell(text).toLowerCase();
  if (!value) return "";
  if (value.includes("哥伦比亚") || /\bcolombia\b|\bcolumbia\b|\bcolombian\b|\bcol\b|npg[-_\s]*(co|col)\b|\bco66\b/.test(value)) return "哥伦比亚";
  if (value.includes("墨西哥") || /\bmexico\b|\bmexican\b|\bmex\b|npg[-_\s]*(me|mex|mx)\b|\bmx\b/.test(value)) return "墨西哥";
  if (value.includes("智利") || /\bchile\b|\bchl\b|npg[-_\s]*(cl|chl|chi)\b|\bcl\b/.test(value)) return "智利";
  return "";
}

function resolveRateRowCountry(baseCountry: string, rowCountry: string, sheetName: string): string {
  const raw = normalizeCell(rowCountry);
  const detected = southAmericaCountryFromText(`${raw} ${sheetName}`);
  if (baseCountry === "南美" && detected) return detected;
  if (["哥伦比亚", "墨西哥", "智利"].includes(baseCountry)) return baseCountry;
  if (baseCountry === "南美" && raw) return inferCountry(raw);
  return baseCountry;
}


function normalizeSouthAmericaRateCategory(country: string, category: string, rowText = ""): string {
  const c = inferCountry(country);
  const raw = `${category} ${rowText}`
    .toLowerCase()
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[\s_：:]+/g, "-");

  if (c === "墨西哥") {
    if (/spei/.test(raw)) return "SPEI";
    if (/clabe/.test(raw)) return "CLABE";
    if (/oxxo/.test(raw)) return "OXXO";
    if (/codi/.test(raw)) return "CoDi";
    if (/cash|efectivo/.test(raw)) return "Cash";
    if (/bank-card|bankcard|bank|card|tarjeta/.test(raw)) return "Bank Card";
  }

  if (c === "哥伦比亚") {
    if (/bre[-_]?key|brekey/.test(raw)) return "BRE-KEY";
    if (/bre[-_]?b|breb/.test(raw)) return "BRE-B";
    if (/pse/.test(raw)) return "PSE";
    if (/nequi/.test(raw)) return "Nequi";
    if (/transfiya/.test(raw)) return "Transfiya";
    if (/bank|banco/.test(raw)) return "Bank";
    if (/cash|efectivo/.test(raw)) return "Cash";
  }

  if (c === "智利") {
    if (/webpay|card|tarjeta/.test(raw)) return "Card(Webpay)";
    if (/khipu|bank|banco/.test(raw)) return "Bank(Khipu)";
    if (/mach|e[-_ ]?wallet|ewallet|wallet/.test(raw)) return "E-Wallet(Mach)";
    if (/pago46|cash|efectivo/.test(raw)) return "Cash(Pago46)";
  }

  return "";
}

function normalizeStatus(value: string): string {
  const raw = normalizeCell(value);
  const text = raw
    .replace(/🟢|🟡|⚠️|⚠|🔴|⭕|❌|🛠️|🛠|🔄|🚫|⛔|✅|☑|✔|✖/g, "")
    .trim();

  // 只有图标的单元格也要识别，避免出现“✅ / ❌”这种假盘口或假三方。
  if (!text) {
    if (/🟢|✅|☑|✔/.test(raw)) return "开启";
    if (/🟡/.test(raw)) return "备用";
    if (/⚠️|⚠/.test(raw)) return "暂停";
    if (/🛠️|🛠/.test(raw)) return "维护";
    if (/🚫|⛔/.test(raw)) return "停用";
    if (/🔴|⭕|❌|✖/.test(raw)) return "未接入";
    return "";
  }

  if (text.includes("不支持")) return "不支持";
  if (text.includes("暂时停") || text.includes("暂停")) return "暂停";
  if (text.includes("备用")) return "备用";
  if (text.includes("停用") || text.includes("已停")) return "停用";
  if (text.includes("未接入") || text.includes("未接")) return "未接入";
  if (text.includes("维护")) return "维护";
  if (text.includes("对接")) return "对接中";
  if (text.includes("开启") || text.includes("打开") || text.includes("正常")) return text.includes("正常") ? "正常" : "开启";
  return text;
}

function statusScore(status: string): number {
  const i = STATUS_ORDER.indexOf(status || "未知");
  return i >= 0 ? i : STATUS_ORDER.length;
}

function isStatusText(value: string): boolean {
  return !!normalizeStatus(value) && /开启|正常|暂停|暂时停|备用|停用|未接入|未接|维护|不支持|对接/.test(value);
}

function isPureIconOrLegend(value: string): boolean {
  const text = normalizeCell(value);
  if (!text) return true;
  const stripped = text
    .replace(/🟢|🟡|⚠️|⚠|🔴|⭕|❌|🛠️|🛠|🔄|🚫|⛔|✅|☑|✔|✖|🔧|🟩|🟥|🟨/g, "")
    .replace(/[\s\-_/|:：]/g, "");
  return !stripped || ["状态", "说明", "备注", "类型", "平台", "盘口", "国家", "地区"].includes(stripped);
}

function isColumnOrLegendText(text: string): boolean {
  const clean = compact(text);
  if (!clean) return true;
  if (isBaseHeader(text)) return true;
  // 右侧“状态说明 / 状态备注内容 / 使用盘口”等辅助说明不能当作真实盘口或三方。
  return /^(代收|代付|代收区间|代付区间|代收扫码|代付扫码|代收属性|代付属性|代收原生|代付原生|代付账号|代付备注|通道情况|是否有漏洞|白名单|白名单ip是否核对|状态|状态备注|状态备注内容|备注|说明|费率|手续费|合计费率|费率合计|代收限制|代付限制|代收限额|代付限额|三方名称|三方名|盘口|平台|使用盘口|国家|地区|正常|运行中|维护|波动|缓慢|技术还在对接中|盘口不支持接入|三方都正常的情况下不开|已经不再使用)$/i.test(clean);
}

function isValidPlatformName(value: string): boolean {
  const text = normalizeCell(value);
  if (!text) return false;
  if (isPureIconOrLegend(text)) return false;
  if (isStatusText(text)) return false;
  if (/^(无|是|否|-|—)$/.test(text)) return false;
  if (isColumnOrLegendText(text)) return false;
  if (/使用盘口|状态备注|状态说明|备注内容|三方名称|代收|代付|手续费|合计费率|费率合计|限额|限制|白名单|漏洞|通道情况|扫码|属性|区间|波动|缓慢|运行中|技术还在对接|盘口不支持|正常情况下不开|已经不再使用/.test(text)) return false;
  return /[A-Za-z0-9一-龥]/.test(text);
}

function isValidThirdPartyName(value: string): boolean {
  const text = normalizeCell(value);
  if (!text) return false;
  if (isPureIconOrLegend(text)) return false;
  if (isStatusText(text)) return false;
  if (/^(无|是|否|-|—)$/.test(text)) return false;
  if (isColumnOrLegendText(text)) return false;
  if (/使用盘口|状态备注|状态说明|备注内容|代收|代付|手续费|限制|限额|是否有漏洞|白名单|通道情况|扫码|属性|区间|波动|缓慢|支持|开启|暂停|备用|停用|未接入|维护|正常|运行中|技术还在对接|盘口不支持|正常情况下不开|已经不再使用/.test(text)) return false;
  return /[A-Za-z0-9一-龥]/.test(text);
}

function isBaseHeader(header: string): boolean {
  const text = compact(header);
  if (!text) return true;
  return BASE_HEADERS.some((h) => text.includes(compact(h)) || compact(h).includes(text));
}

function looksLikeEntityName(value: string): boolean {
  const text = normalizeCell(value);
  const clean = text.replace(/🟢|🟡|⚠️|⚠|🔴|⭕|❌|🛠️|🛠|🔄|🚫|⛔|✅|☑|✔|✖/g, "").trim();
  if (!clean) return false;
  if (isBaseHeader(clean)) return false;
  if (isStatusText(text)) return false;
  if (/^[-–—]+$/.test(clean)) return false;
  if (/^(是|否|无|正常|开启|暂停|备用|停用|未接入|维护|不支持|状态|状态备注内容)$/i.test(clean)) return false;
  if (/^\d+(\.\d+)?%?$/.test(clean)) return false;
  return true;
}

function findRateHeader(values: Values): number {
  for (let r = 0; r < Math.min(values.length, 25); r++) {
    const cells = values[r].map(compact);
    // 必须是真正的表头行，不能把“越南三方 / 巴西三方”这种合并标题误判成三方名称。
    const hasNameHeader = cells.some((cell) => cell === "三方名称" || cell === "三方名" || cell === "三方");
    const hasFeeHeader = cells.some((cell) => /代收费率|代付费率|代收手续费|代付手续费|合计费率|费率合计|总手续费/.test(cell)) || cells.some((cell) => cell === "代收" || cell === "代付" || cell === "收款" || cell === "付款");
    const hasLimitHeader = cells.some((cell) => /代收限制|代付限制|代收限额|代付限额/.test(cell));
    const first = cells[0] || "";
    // 如果第一列是盘口/平台，通常是“盘口 × 三方状态矩阵”，交给 parsePlatformMatrixSheet 解析。
    if (first.includes("盘口") || first.includes("平台")) continue;
    if (hasNameHeader && (hasFeeHeader || hasLimitHeader)) return r;
  }
  return -1;
}

function headerMatches(header: string, keywords: string[]): boolean {
  const text = compact(header);
  return keywords.some((keyword) => {
    const key = compact(keyword);
    return text === key || text.includes(key);
  });
}

function findHeaderIndex(headers: string[], keywords: string[]): number {
  return headers.findIndex((header) => headerMatches(header, keywords));
}

function findHeaderIndexes(headers: string[], keywords: string[]): number[] {
  return headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => headerMatches(header, keywords))
    .map(({ index }) => index);
}

function findExactHeaderIndexes(headers: string[], keywords: string[]): number[] {
  const keys = keywords.map(compact);
  return headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => keys.includes(compact(header)))
    .map(({ index }) => index);
}

function findAllThirdPartyNameColumns(headers: string[]): number[] {
  const candidates = findExactHeaderIndexes(headers, ["三方名称", "三方名", "三方"]);
  return candidates.filter((index) => {
    const header = compact(headers[index] || "");
    if (!header) return false;
    const prev = compact(headers[index - 1] || "");
    const next = compact(headers[index + 1] || "");
    // 排除右侧说明/状态图例附近误判，保留左右两套真实三方列。
    if (/状态|备注|说明|白名单|漏洞|通道情况/.test(prev + next)) return false;
    return true;
  });
}

function isLegendStatusColumn(headers: string[], index: number): boolean {
  const header = compact(headers[index] || "");
  if (!header) return true;
  const next = compact(headers[index + 1] || "");
  const prev = compact(headers[index - 1] || "");
  // 右侧状态说明表通常是“状态 / 状态备注内容”，不能当成数据状态列。
  if (header === "状态" && /状态备注|备注内容|说明/.test(next)) return true;
  if (/状态备注|备注内容|说明/.test(header)) return true;
  if (/状态|状态备注/.test(prev) && /备注内容|说明/.test(header)) return true;
  return false;
}

function findUsableStatusColumn(headers: string[]): number {
  for (let index = 0; index < headers.length; index++) {
    const header = compact(headers[index] || "");
    if (!header) continue;
    if (isLegendStatusColumn(headers, index)) continue;
    if (header === "状态" || header === "当前状态" || header === "通道状态") return index;
  }
  return -1;
}

function uniqueIndexes(indexes: number[]): number[] {
  return Array.from(new Set(indexes.filter((index) => index >= 0)));
}

function findHeaderIndexesByRegex(headers: string[], regex: RegExp): number[] {
  return headers
    .map((header, index) => ({ clean: compact(header), index }))
    .filter(({ clean }) => regex.test(clean))
    .map(({ index }) => index);
}

function inferVariantLabel(header: string, fallback: string): string {
  let text = normalizeCell(header)
    .replace(/最低|最高|最小|最大|下限|上限|限制|限额|区间|范围/gi, "")
    .replace(/代收|代付|收款|付款|出款|入款|手续费|费率|合计|总计|总手续费|总费率/gi, "")
    .replace(/[()（）:_：\-\/|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) text = fallback;
  if (/^easy$/i.test(text)) return "Easy";
  if (/^jazz$/i.test(text)) return "Jazz";
  if (/唤醒/i.test(text)) return "唤醒";
  if (/原生/i.test(text)) return "原生";
  return text;
}

function isUsdtCountry(country: string): boolean {
  return /USDT|U通道|USDT通道/i.test(country || "");
}

function looksLikeFeeOrLimitValue(value: string): boolean {
  const text = normalizeCell(value);
  if (!text || text === "-" || text === "—") return false;
  const status = normalizeStatus(text);
  if (/^(开启|正常|暂停|备用|停用|未接入|维护|不支持|对接中)$/i.test(status)) return false;
  if (/代收手续费|代付手续费|代收费率|代付费率|代收限制|代付限制|代收限额|代付限额|状态|备注|白名单|漏洞|通道情况/.test(text)) return false;
  return /\d|%|TRX|USDT|VND|BDT|INR|MMK|PHP|PKR|BRL|USD|w|W|万|千|单笔|无/i.test(text);
}


function findFeeColumnIndexes(headers: string[], kind: "collect" | "payout"): number[] {
  return headers
    .map((header, index) => ({ header, index, clean: compact(header) }))
    .filter(({ clean }) => {
      if (!clean) return false;
      if (/限制|限额|区间|范围|上限|下限/.test(clean)) return false;
      if (kind === "collect") return /代收|收款|collect|deposit/i.test(clean);
      return /代付|付款|出款|payout|withdraw/i.test(clean);
    })
    .map(({ index }) => index);
}

function findTotalFeeColumnIndexes(headers: string[]): number[] {
  return headers
    .map((header, index) => ({ header, index, clean: compact(header) }))
    .filter(({ clean }) => {
      if (!clean) return false;
      if (/限制|限额|区间|范围|上限|下限/.test(clean)) return false;
      return /合计|总费率|总手续费|费率合计|总计|total/i.test(clean);
    })
    .map(({ index }) => index);
}


function isLimitHeader(header: string): boolean {
  const clean = compact(header);
  return /限制|限额|区间|范围|最低|最高|最小|最大|下限|上限/.test(clean);
}

function isSingleFeeHeader(header: string): boolean {
  const clean = compact(header);
  // “代收合计%+单笔 / 代付合计%+单笔”这类列同时含百分比与单笔，仍然要先当费率列读取，单笔由前端从 + 后面拆出。
  if (/费率|合计|%/.test(clean)) return false;
  // 兼容尼日利亚表头：代收单 / 代付单 = 单笔费用。
  return /单笔|每笔|笔费|代收单$|代付单$|收款单$|付款单$|出款单$|提现单$/.test(clean);
}

function isCollectHeader(header: string): boolean {
  const clean = compact(header);
  return /代收|收款|入款|充值|collect|deposit|easy代收|jazz代收/i.test(clean);
}

function isPayoutHeader(header: string): boolean {
  const clean = compact(header);
  return /代付|付款|出款|提款|提现|payout|withdraw|easy代付|jazz代付/i.test(clean);
}

function isTotalFeeHeader(header: string): boolean {
  const clean = compact(header);
  if (!clean || isLimitHeader(header) || isSingleFeeHeader(header)) return false;
  return /合计|总费率|总手续费|费率合计|总计|total/i.test(clean);
}

function filterFeeColumns(headers: string[], indexes: number[], kind: "collect" | "payout" | "total"): number[] {
  return uniqueIndexes(indexes).filter((index) => {
    const header = headers[index] || "";
    const clean = compact(header);
    if (!header || isLimitHeader(header) || isSingleFeeHeader(header)) return false;
    if (/状态|通道情况|漏洞|白名单|备注|说明|限制|限额|区间|范围/.test(clean)) return false;
    if (kind === "total") return isTotalFeeHeader(header);
    // “代收 / 代付”在用户表里经常只是 ✅/❌ 状态列，不是费率列。
    // 真正费率列一般写：代收费率、代收手续费、代收合计%+单笔、代付率等。
    const looksExplicitFeeHeader = /费率|手续费|合计|%|单笔|每笔|笔费|代收率|代付率|收款率|付款率|rate|fee/i.test(clean);
    if (!looksExplicitFeeHeader && (clean === "代收" || clean === "收款" || clean === "代付" || clean === "付款" || clean === "出款")) return false;
    if (kind === "collect") return isCollectHeader(header) || /扫码.*代收|代收.*扫码/i.test(header);
    return isPayoutHeader(header);
  });
}

function findSingleFeeColumnIndexes(headers: string[], kind: "collect" | "payout"): number[] {
  return headers
    .map((header, index) => ({ header, index, clean: compact(header) }))
    .filter(({ header, clean }) => {
      if (!clean || !isSingleFeeHeader(header) || isLimitHeader(header)) return false;
      if (kind === "collect") return isCollectHeader(header) || !isPayoutHeader(header);
      return isPayoutHeader(header);
    })
    .map(({ index }) => index);
}

function isBlankFeeValue(value: string): boolean {
  const text = normalizeCell(value);
  return !text || text === "-" || text === "—";
}

function isBadFormulaValue(value: string): boolean {
  return /^#(?:VALUE|DIV\/0|N\/A|REF|NAME|NUM|NULL)!?$/i.test(normalizeCell(value));
}

function feeVariantLabel(header: string, fallback: string): string {
  let text = normalizeCell(header)
    .replace(/手续费|费率|合计费率|费率合计|总手续费|总费率|合计|总计|单笔|每笔|笔费/gi, "")
    .replace(/代收|代付|收款|付款|出款|入款|easy扫码|扫码|collect|payout|deposit|withdraw/gi, "")
    .replace(/[%＋+]/g, " ")
    .replace(/[()（）:_：\-\/|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) text = fallback;
  if (/^easy$/i.test(text)) return "Easy";
  if (/^jazz$/i.test(text)) return "Jazz";
  return text;
}

function normalizeFeeVariant(value: string): string {
  return normalizeCell(value)
    .replace(/✅|☑|✔|❌|✖|⭕|🟢|🟡|⚠️|⚠|🔴|🛠️|🛠|🚫|🔄/g, "")
    .trim();
}

function parsePercentFee(value: string): number | null {
  const text = normalizeCell(value);
  if (!text || text === "-" || /停用|未接入|暂停|备用|开启|正常/.test(text)) return null;
  if (text.includes("无")) return 0;
  if (!text.includes("%")) return null;
  const normalized = text.replace(/(\d),(\d)(?=\s*%|\s*$)/g, "$1.$2").replace(/,/g, "");
  // 必须取 % 前面的数字，不能把 2001以上 / 3000以下 这种金额门槛当作 2001%。
  const match = normalized.match(/-?\d+(?:\.\d+)?(?=\s*%)/);
  if (!match) return null;
  return Number(match[0]);
}

function extractFeeNumber(value: string): number {
  const text = normalizeCell(value).replace(/,/g, "");
  if (!text || text === "-" || text === "—" || text === "无") return 0;
  if (/停用|未接入|暂停|备用|开启|正常|限制|限额|区间|状态|备注|白名单|漏洞/.test(text)) return 0;
  const match = text.includes("%") ? text.match(/-?\d+(?:\.\d+)?(?=\s*%)/) : text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : 0;
}

function isHighFeeRow(row: Pick<ThirdPartyRateRow, "collectFee" | "payoutFee" | "totalFee" | "collectSingleFee" | "payoutSingleFee">): boolean {
  const values = [row.collectFee, row.payoutFee, row.totalFee, row.collectSingleFee, row.payoutSingleFee]
    .map(extractFeeNumber)
    .filter((value) => value > 0);
  return values.some((value) => value >= 2);
}

function formatPercentTotal(value: number): string {
  const fixed = value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return `${fixed}%`;
}

function inferTotalFee(collectFee: string, payoutFee: string, explicitTotal: string): string {
  if (explicitTotal) return explicitTotal;
  const collect = parsePercentFee(collectFee);
  const payout = parsePercentFee(payoutFee);
  if (collect === null && payout === null) return "";
  return formatPercentTotal((collect || 0) + (payout || 0));
}

function cleanFeeOrLimitValue(value: string): string {
  const text = normalizeCell(value);
  if (!text) return "";
  if (isBadFormulaValue(text)) return "";
  if (isColumnOrLegendText(text)) return "";
  const status = normalizeStatus(text);
  const hasAmountLikeText = /\d|%|TRX|USDT|VND|BDT|INR|MMK|PHP|PKR|BRL|USD|w|W|万|千/i.test(text);
  if (!hasAmountLikeText && /打款|到账|提交|更换|波动|时间|正常|白班|夜班|备注|状态|审核|人工|客服|投诉|说明/.test(text) && !/^(无|没有|暂无)$/.test(text)) return "";
  if (!hasAmountLikeText && (/🟢|🟡|⚠️|⚠|🔴|⭕|❌|🛠️|🛠|🔄|🚫|⛔|✅|☑|✔|✖/.test(text))) return "";
  if (!hasAmountLikeText && /^(开启|正常|暂停|备用|停用|未接入|维护|不支持|对接中)$/.test(status)) return "";
  return text;
}

function normalizeRateRowCategory(country: string, category: string, thirdParty: string, sheetName: string): string {
  const base = normalizeCell(category);
  const text = `${base} ${thirdParty} ${sheetName}`.toLowerCase();
  const southAmericaCategory = normalizeSouthAmericaRateCategory(country, base, `${thirdParty} ${sheetName}`);
  if (southAmericaCategory) return southAmericaCategory;
  if (country.includes("巴西")) return "PIX";
  if (country.includes("尼日利亚")) return /usdt|tron|trc20|unipay/.test(text) ? "USDT" : "银行";
  if (country.includes("菲律宾")) {
    // V110：菲律宾 PH19 费率表如果有钱包/银行分类，必须保留分类去匹配三方量。
    if (/gcash/.test(text)) return "GCASH";
    if (/pay\s*maya|paymaya|\bmaya\b/.test(text)) return "PAYMAYA";
    if (/go\s*tyme|gotyme/.test(text)) return "GOTYME";
    if (/grab\s*pay|grabpay/.test(text)) return "GRABPAY";
    if (/银行代付|bank|银行卡/.test(text)) return "银行代付";
    if (/代付/.test(base)) return "代付";
  }
  if (country.includes("印尼")) {
    // 印尼费率要按具体钱包匹配：OVO / DANA / LINKAJA / GOPAY 各自可能有自己的费率。
    // 没写具体钱包、只有 E~ / Wallet 的才归「钱包代付」。
    if (/qris/.test(text)) return "QRIS";
    if (/link\s*aja|link-aja|linkaja/.test(text)) return "LINKAJA";
    if (/\bdana\b|(^|[^a-z0-9])dana([^a-z0-9]|$)/.test(text)) return "DANA";
    if (/\bovo\b|(^|[^a-z0-9])ovo([^a-z0-9]|$)/.test(text)) return "OVO";
    if (/go\s*pay|go-pay|gopay|gojek/.test(text)) return "GOPAY";
    if (/(^|[^a-z0-9])b\s*[~_-]?\s*yerepay|(^|[^a-z0-9])b\s*[~_-]?\s*paying|(^|[^a-z0-9])b\s*[~_-]?\s*kilipay|(^|[^a-z0-9])b\s*[~_-]?\s*click2?pay|bnin|bmri|brin|cena|virtual|va|bank|bni|bri|mandiri|permata|cimb|bca/.test(text)) return "银行代付";
    if (/(^|[^a-z0-9])e\s*[~_-]?\s*yerepay|(^|[^a-z0-9])e\s*[~_-]?\s*paying|(^|[^a-z0-9])e\s*[~_-]?\s*kilipay|(^|[^a-z0-9])e\s*[~_-]?\s*click2?pay|ewallet|wallet/.test(text)) return "钱包代付";
  }
  if (country.includes("马来")) {
    if (/telcom|telco/.test(text)) return "Telcom";
    if (/shopee|grab|boost/.test(text)) return "Shopee/Grab/Boost";
    if (/tng|touch\s*n\s*go|touchngo|duitnow|duit-now|qr|maybankqr/.test(text)) return "DUITNOW/QR";
    if (/fpx|bank|银行卡|银行/.test(text)) return "FPX-BANK";
  }
  return base;
}

function looksLikeFeeValue(value: string): boolean {
  const text = cleanFeeOrLimitValue(value);
  if (!text || isColumnOrLegendText(text)) return false;
  const status = normalizeStatus(text);
  if (/^(开启|正常|暂停|备用|停用|未接入|维护|不支持|对接中)$/.test(status)) return false;
  if (/^[-–—]+$/.test(text)) return false;
  const percent = parsePercentFee(text);
  if (percent !== null && Math.abs(percent) > 50) return false;
  // 费率/手续费常见：0.30%、2.9TRX、3%+6 单笔、无、0.2%+10trx。
  if (/无|%|TRX|trx|单笔|笔/i.test(text)) return true;
  // 纯数字多数来自限额，只有 0.003 / 1.5 / 3 这类小数字才当费率兜底。
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) <= 10;
  return false;
}

function looksLikeLimitValue(value: string): boolean {
  const text = cleanFeeOrLimitValue(value);
  if (!text || isColumnOrLegendText(text)) return false;
  if (/^(开启|正常|暂停|备用|停用|未接入|维护|不支持|对接中)$/.test(normalizeStatus(text))) return false;
  if (/^\d+(?:\.\d+)?$/.test(text)) return true;
  return /\d+\s*[-–~至]\s*\d|\d+\s*[-–~至]\s*\d*\s*[wW万]|VND|BDT|INR|MMK|PHP|PKR|BRL|USD|USDT/i.test(text);
}

function cellLooksLikeSection(value: string): boolean {
  const text = normalizeCell(value);
  if (!text) return false;
  if (isStatusText(text)) return false;
  if (/^\d+(\.\d+)?%?$/.test(text)) return false;
  if (/^\d+\s*-\s*\d+/.test(text)) return false;
  return text.length <= 40;
}

function columnHasFeeValues(values: Values, headerIndex: number, col: number): boolean {
  let feeCount = 0;
  let statusCount = 0;
  for (let r = headerIndex + 1; r < Math.min(values.length, headerIndex + 160); r++) {
    const cell = get(values[r], col);
    if (!cell) continue;
    if (looksLikeFeeValue(cell)) feeCount += 1;
    if (/✅|☑|✔|❌|✖|⭕|开启|正常|暂停|备用|停用|未接入|维护|不支持|对接/.test(cell)) statusCount += 1;
  }
  return feeCount > 0 && feeCount >= Math.ceil(statusCount * 0.15);
}

function valueAtFirstFeeColumn(row: string[], headers: string[], cols: number[], fallbackWords: RegExp): string {
  for (const col of uniqueIndexes(cols)) {
    const value = cleanFeeOrLimitValue(get(row, col));
    if (looksLikeFeeValue(value)) return value;
  }
  for (let col = 0; col < row.length; col++) {
    const header = compact(headers[col] || "");
    if (!fallbackWords.test(header)) continue;
    if (/限制|限额|区间|范围|状态|备注|说明|白名单|漏洞/.test(header)) continue;
    const value = cleanFeeOrLimitValue(get(row, col));
    if (looksLikeFeeValue(value)) return value;
  }
  return "";
}


function parseCountryRateSheet(sheetName: string, values: Values): { rates: ThirdPartyRateRow[]; statuses: ThirdPartyPlatformStatusRow[] } {
  const headerIndex = findRateHeader(values);
  if (headerIndex < 0) return { rates: [], statuses: [] };

  const headers = values[headerIndex].map(normalizeCell);
  const baseCountry = inferCountry(sheetName);

  const countryCol = findHeaderIndex(headers, ["国家", "国家/地区", "地区"]);
  const categoryCol = findHeaderIndex(headers, ["类型", "分类", "通道类型"]);
  const nameCols = findAllThirdPartyNameColumns(headers);
  const nameCol = nameCols[0] ?? -1;
  let totalFeeCols = uniqueIndexes([
    ...findHeaderIndexes(headers, ["费率合计", "合计费率", "总费率", "总手续费", "总计"]),
    ...findTotalFeeColumnIndexes(headers)
  ]);
  let collectFeeCols = uniqueIndexes([
    ...findHeaderIndexes(headers, ["代收手续费", "代收费率", "代收率", "唤醒代收率", "收款手续费", "收款费率", "收款率", "代收", "收款"]),
    ...findFeeColumnIndexes(headers, "collect")
  ]);
  let payoutFeeCols = uniqueIndexes([
    ...findHeaderIndexes(headers, ["代付手续费", "代付费率", "代付率", "唤醒代付率", "付款手续费", "付款费率", "付款率", "代付", "付款", "出款"]),
    ...findFeeColumnIndexes(headers, "payout")
  ]);
  const collectSingleFeeCols = uniqueIndexes([
    ...findHeaderIndexes(headers, ["代收单笔", "代收单", "收款单笔", "收款单", "入款单笔", "充值单笔"]),
    ...findSingleFeeColumnIndexes(headers, "collect")
  ]);
  const payoutSingleFeeCols = uniqueIndexes([
    ...findHeaderIndexes(headers, ["代付单笔", "代付单", "付款单笔", "付款单", "出款单笔", "出款单", "提现单笔", "提现单", "提款单笔"]),
    ...findSingleFeeColumnIndexes(headers, "payout")
  ]);

  totalFeeCols = filterFeeColumns(headers, totalFeeCols, "total").filter((col) => /费率|手续费|合计|%|total/i.test(compact(headers[col] || "")) || columnHasFeeValues(values, headerIndex, col));
  collectFeeCols = filterFeeColumns(headers, collectFeeCols, "collect").filter((col) => /费率|手续费|合计|%|单笔|每笔|笔费|代收率|代付率|收款率|付款率|rate|fee/i.test(compact(headers[col] || "")) || columnHasFeeValues(values, headerIndex, col));
  payoutFeeCols = filterFeeColumns(headers, payoutFeeCols, "payout").filter((col) => /费率|手续费|合计|%|单笔|每笔|笔费|代收率|代付率|收款率|付款率|rate|fee/i.test(compact(headers[col] || "")) || columnHasFeeValues(values, headerIndex, col));
  const collectLimitCols = uniqueIndexes([
    ...findHeaderIndexes(headers, ["代收限制", "代收限额", "代收区间", "收款限制", "收款限额", "收款区间", "代收最低限制", "代收最高限制", "代收最低限额", "代收最高限额"]),
    ...findHeaderIndexesByRegex(headers, /(代收|收款).*(最低|最高|最小|最大|下限|上限).*(限制|限额|区间|范围)?|(最低|最高|最小|最大|下限|上限).*(代收|收款)/i)
  ]);
  const payoutLimitCols = uniqueIndexes([
    ...findHeaderIndexes(headers, ["代付限制", "代付限额", "代付区间", "出款限制", "出款限额", "出款区间", "代付最低限制", "代付最高限制", "代付最低限额", "代付最高限额"]),
    ...findHeaderIndexesByRegex(headers, /(代付|付款|出款).*(最低|最高|最小|最大|下限|上限).*(限制|限额|区间|范围)?|(最低|最高|最小|最大|下限|上限).*(代付|付款|出款)/i)
  ]);
  const collectMinCols = uniqueIndexes(findHeaderIndexesByRegex(headers, /(代收|收款).*(最低|最小|下限)|(最低|最小|下限).*(代收|收款)/i));
  const collectMaxCols = uniqueIndexes(findHeaderIndexesByRegex(headers, /(代收|收款).*(最高|最大|上限)|(最高|最大|上限).*(代收|收款)/i));
  const payoutMinCols = uniqueIndexes(findHeaderIndexesByRegex(headers, /(代付|付款|出款).*(最低|最小|下限)|(最低|最小|下限).*(代付|付款|出款)/i));
  const payoutMaxCols = uniqueIndexes(findHeaderIndexesByRegex(headers, /(代付|付款|出款).*(最高|最大|上限)|(最高|最大|上限).*(代付|付款|出款)/i));
  const totalFeeCol = totalFeeCols[0] ?? -1;
  const collectFeeCol = collectFeeCols[0] ?? -1;
  const payoutFeeCol = payoutFeeCols[0] ?? -1;
  const collectLimitCol = collectLimitCols[0] ?? -1;
  const payoutLimitCol = payoutLimitCols[0] ?? -1;
  const channelCol = findHeaderIndex(headers, ["通道情况"]);
  const leakCol = findHeaderIndex(headers, ["是否有漏洞"]);
  const whitelistCol = findHeaderIndex(headers, ["白名单"]);
  const statusCol = findUsableStatusColumn(headers);

  if (nameCol < 0) return { rates: [], statuses: [] };

  const nonPlatformCols = new Set<number>([
    countryCol,
    categoryCol,
    ...nameCols,
    totalFeeCol,
    collectFeeCol,
    payoutFeeCol,
    collectLimitCol,
    payoutLimitCol,
    channelCol,
    leakCol,
    whitelistCol,
    statusCol,
    ...totalFeeCols,
    ...collectFeeCols,
    ...payoutFeeCols,
    ...collectSingleFeeCols,
    ...payoutSingleFeeCols,
    ...collectLimitCols,
    ...payoutLimitCols,
    ...collectMinCols,
    ...collectMaxCols,
    ...payoutMinCols,
    ...payoutMaxCols
  ].filter((index) => index >= 0));

  const platformColumns = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header, index }) => {
      if (index <= nameCol) return false;
      if (nonPlatformCols.has(index)) return false;
      if (isLegendStatusColumn(headers, index)) return false;
      if (!isValidPlatformName(header)) return false;
      // 真正的盘口列下面必须出现至少 1 个状态值；避免把右侧图例/备注列、费率列误判成盘口。
      let statusCells = 0;
      for (let rowIndex = headerIndex + 1; rowIndex < values.length; rowIndex++) {
        const cell = get(values[rowIndex], index);
        if (!cell) continue;
        const status = normalizeStatus(cell);
        if (/^(开启|正常|暂停|备用|停用|未接入|维护|不支持|对接中)$/.test(status)) statusCells += 1;
      }
      return statusCells > 0;
    });

  const rates: ThirdPartyRateRow[] = [];
  const statuses: ThirdPartyPlatformStatusRow[] = [];
  let currentCategory = "";
  const fillColumns = uniqueIndexes([...collectFeeCols, ...payoutFeeCols, ...totalFeeCols, ...collectSingleFeeCols, ...payoutSingleFeeCols, ...collectLimitCols, ...payoutLimitCols, ...collectMinCols, ...collectMaxCols, ...payoutMinCols, ...payoutMaxCols]).filter((col) => col >= 0);
  const lastValues = new Map<number, string>();

  function getFilled(row: string[], col: number): string {
    if (col < 0) return "";
    const raw = get(row, col);
    if (raw) {
      lastValues.set(col, raw);
      return raw;
    }
    return fillColumns.includes(col) ? (lastValues.get(col) || "") : "";
  }

  function pickBestFilled(row: string[], cols: number[], fallbackCol: number): string {
    const candidates = [...cols, fallbackCol].filter((col, index, arr) => col >= 0 && arr.indexOf(col) === index);
    for (const col of candidates) {
      const value = cleanFeeOrLimitValue(getFilled(row, col));
      // 只接受真正像费率/限额的值，不能把“代收手续费/代付手续费”这种表头文字当成数据。
      if (looksLikeFeeOrLimitValue(value) && !isColumnOrLegendText(value)) return value;
    }
    return "";
  }

  function scanFeeCandidates(row: string[]): string[] {
    const excluded = new Set<number>([categoryCol, nameCol, statusCol, channelCol, leakCol, whitelistCol, ...collectSingleFeeCols, ...payoutSingleFeeCols, ...collectLimitCols, ...payoutLimitCols, ...collectMinCols, ...collectMaxCols, ...payoutMinCols, ...payoutMaxCols].filter((col) => col >= 0));
    const candidates: string[] = [];
    for (let col = 0; col < row.length; col++) {
      if (excluded.has(col)) continue;
      const header = headers[col] || "";
      if (/限制|限额|区间|状态|通道|漏洞|白名单|备注|说明/i.test(header)) continue;
      const value = cleanFeeOrLimitValue(getFilled(row, col));
      if (looksLikeFeeValue(value) && !isColumnOrLegendText(value)) candidates.push(value);
    }
    return Array.from(new Set(candidates));
  }

  function scanLimitCandidates(row: string[]): string[] {
    const excluded = new Set<number>([categoryCol, nameCol, statusCol, channelCol, leakCol, whitelistCol, ...collectFeeCols, ...payoutFeeCols, ...totalFeeCols, ...collectSingleFeeCols, ...payoutSingleFeeCols].filter((col) => col >= 0));
    const candidates: string[] = [];
    for (let col = 0; col < row.length; col++) {
      if (excluded.has(col)) continue;
      const value = cleanFeeOrLimitValue(getFilled(row, col));
      if (looksLikeLimitValue(value) && !isColumnOrLegendText(value)) candidates.push(value);
    }
    return Array.from(new Set(candidates));
  }


  function readLabeledFee(row: string[], cols: number[], fallback: string): string {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const col of uniqueIndexes(cols)) {
      if (col < 0) continue;
      const raw = normalizeFeeVariant(getFilled(row, col));
      const value = cleanFeeOrLimitValue(raw);
      if (!looksLikeFeeValue(value)) continue;
      const label = feeVariantLabel(headers[col] || "", fallback);
      const text = label && label !== fallback ? `${label} ${value}` : value;
      const key = `${label}|||${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(text);
    }
    return parts.join(" / ");
  }

  function readLabeledSingleFee(row: string[], cols: number[], fallback: string): string {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const col of uniqueIndexes(cols)) {
      if (col < 0) continue;
      const raw = normalizeFeeVariant(getFilled(row, col));
      const value = cleanFeeOrLimitValue(raw);
      if (!value || isBadFormulaValue(value) || isColumnOrLegendText(value)) continue;
      const header = headers[col] || "";
      const label = feeVariantLabel(header, fallback);
      const text = label && label !== fallback ? `${label} ${value}` : value;
      const key = `${label}|||${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(text);
    }
    return parts.join(" / ");
  }

  function readLabeledLimit(row: string[], cols: number[], fallback: string): string {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const col of uniqueIndexes(cols)) {
      if (col < 0) continue;
      const value = cleanFeeOrLimitValue(getFilled(row, col));
      if (!looksLikeLimitValue(value)) continue;
      const label = feeVariantLabel(headers[col] || "", fallback);
      const text = label && label !== fallback ? `${label} ${value}` : value;
      const key = `${label}|||${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(text);
    }
    return parts.join(" / ");
  }

  function readPairedLimit(row: string[], minCols: number[], maxCols: number[], fallback: string): string {
    const parts: string[] = [];
    const seen = new Set<string>();
    const maxByLabel = new Map<string, string>();

    for (const maxCol of uniqueIndexes(maxCols)) {
      const maxValue = cleanFeeOrLimitValue(getFilled(row, maxCol));
      if (!looksLikeLimitValue(maxValue)) continue;
      const label = inferVariantLabel(headers[maxCol] || "", fallback);
      maxByLabel.set(label, maxValue);
    }

    for (const minCol of uniqueIndexes(minCols)) {
      const minValue = cleanFeeOrLimitValue(getFilled(row, minCol));
      if (!looksLikeLimitValue(minValue)) continue;
      const label = inferVariantLabel(headers[minCol] || "", fallback);
      const maxValue = maxByLabel.get(label) || (maxCols.length === 1 ? cleanFeeOrLimitValue(getFilled(row, maxCols[0])) : "");
      const joined = maxValue && looksLikeLimitValue(maxValue) ? `${minValue}-${maxValue}` : minValue;
      const text = label && label !== fallback ? `${label} ${joined}` : joined;
      const key = `${label}|||${joined}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(text);
    }

    if (!parts.length && minCols.length && maxCols.length) {
      const minValue = cleanFeeOrLimitValue(getFilled(row, minCols[0]));
      const maxValue = cleanFeeOrLimitValue(getFilled(row, maxCols[0]));
      if (looksLikeLimitValue(minValue) || looksLikeLimitValue(maxValue)) parts.push([minValue, maxValue].filter(Boolean).join("-"));
    }

    return parts.join(" / ");
  }

  let currentThirdParty = "";
  let currentCountryText = "";

  for (let r = headerIndex + 1; r < values.length; r++) {
    const row = values[r] || [];
    const nonEmpty = row.map(normalizeCell).filter(Boolean).length;
    if (!nonEmpty) continue;

    const maybeCategory = categoryCol >= 0 ? get(row, categoryCol) : "";
    const rawCountry = countryCol >= 0 ? get(row, countryCol) : "";
    if (rawCountry && !isColumnOrLegendText(rawCountry)) currentCountryText = rawCountry;
    const rowCountry = resolveRateRowCountry(baseCountry, currentCountryText, sheetName);
    const rawThirdParty = get(row, nameCol);

    if (rawThirdParty && !looksLikeEntityName(rawThirdParty)) continue;
    if (rawThirdParty && isValidThirdPartyName(rawThirdParty)) currentThirdParty = rawThirdParty;

    const rawCanonicalThirdParty = rawThirdParty && isValidThirdPartyName(rawThirdParty) ? rawThirdParty : currentThirdParty;
    const thirdParty = canonicalThirdPartyName(rawCanonicalThirdParty, rowCountry);
    const dataCols = uniqueIndexes([...collectFeeCols, ...payoutFeeCols, ...totalFeeCols, ...collectSingleFeeCols, ...payoutSingleFeeCols, ...collectLimitCols, ...payoutLimitCols, ...collectMinCols, ...collectMaxCols, ...payoutMinCols, ...payoutMaxCols]);
    const hasUsefulCells = dataCols.some((col) => cleanFeeOrLimitValue(get(row, col)));

    if (!thirdParty || !isValidThirdPartyName(thirdParty)) {
      if (cellLooksLikeSection(maybeCategory || get(row, 0))) currentCategory = maybeCategory || get(row, 0);
      continue;
    }

    if (!rawThirdParty && !maybeCategory && !hasUsefulCells) continue;
    if (maybeCategory) currentCategory = maybeCategory;
    const inferredCategory = inferThirdPartyChannelType(rawCanonicalThirdParty || thirdParty, rowCountry, `${currentCategory} ${channelCol >= 0 ? get(row, channelCol) : ""} ${sheetName}`);
    const finalCategory = normalizeRateRowCategory(rowCountry, inferredCategory || currentCategory, thirdParty, sheetName);

    const status = normalizeStatus(statusCol >= 0 ? get(row, statusCol) : "");
    let collectFee = readLabeledFee(row, collectFeeCols, "代收") || pickBestFilled(row, collectFeeCols, collectFeeCol);
    let payoutFee = readLabeledFee(row, payoutFeeCols, "代付") || pickBestFilled(row, payoutFeeCols, payoutFeeCol);
    let explicitTotalFee = readLabeledFee(row, totalFeeCols, "合计") || pickBestFilled(row, totalFeeCols, totalFeeCol);
    const collectSingleFee = readLabeledSingleFee(row, collectSingleFeeCols, "代收单笔");
    const payoutSingleFee = readLabeledSingleFee(row, payoutSingleFeeCols, "代付单笔");
    let collectLimit = readPairedLimit(row, collectMinCols, collectMaxCols, "代收") || readLabeledLimit(row, collectLimitCols, "代收限制") || pickBestFilled(row, collectLimitCols, collectLimitCol);
    let payoutLimit = readPairedLimit(row, payoutMinCols, payoutMaxCols, "代付") || readLabeledLimit(row, payoutLimitCols, "代付限制") || pickBestFilled(row, payoutLimitCols, payoutLimitCol);

    // 兼容部分国家页签：表头只写“代收/代付”或多层合并标题，Google API 读取后列名会变空。
    // 如果指定列没有读到，就从当前行的费率/限额形态自动补齐，避免明明表里有费率但后台显示空白。
    if (!collectFee) collectFee = valueAtFirstFeeColumn(row, headers, collectFeeCols, /(代收|收款|入款|充值).*(费率|手续费|合计|%|单笔|每笔|笔费)|(费率|手续费|合计|%).*(代收|收款|入款|充值)/i);
    if (!payoutFee) payoutFee = valueAtFirstFeeColumn(row, headers, payoutFeeCols, /(代付|付款|出款|提款|提现).*(费率|手续费|合计|%|单笔|每笔|笔费)|(费率|手续费|合计|%).*(代付|付款|出款|提款|提现)/i);
    if (!explicitTotalFee) explicitTotalFee = valueAtFirstFeeColumn(row, headers, totalFeeCols, /(总|合计|费率合计|总手续费|total).*(费率|手续费|%|单笔|每笔|笔费)|(费率|手续费|%).*(总|合计|total)/i);
    if (!collectFee || !payoutFee || !explicitTotalFee) {
      const feeCandidates = scanFeeCandidates(row);
      // 最后兜底必须保守：只在当前方向没有任何表头可用时才补，防止把代收费率误塞到代付。
      if (!collectFee && collectFeeCols.length === 0 && feeCandidates.length === 1) collectFee = feeCandidates[0];
      if (!payoutFee && payoutFeeCols.length === 0 && /代付|付款|出款|提现|提款|payout|withdraw/i.test(`${currentCategory} ${sheetName}`) && feeCandidates.length === 1) payoutFee = feeCandidates[0];
      if (!explicitTotalFee && totalFeeCols.length === 0 && feeCandidates.length >= 2) explicitTotalFee = "";
    }
    if (!collectLimit || !payoutLimit) {
      const limitCandidates = scanLimitCandidates(row);
      if (!collectLimit && limitCandidates[0]) collectLimit = limitCandidates[0];
      if (!payoutLimit && limitCandidates[1]) payoutLimit = limitCandidates[1];
    }

    const rateRow: ThirdPartyRateRow = {
      id: `${sheetName}-${r}-${thirdParty}`,
      sheetName,
      country: rowCountry,
      category: finalCategory,
      thirdParty,
      collectFee,
      payoutFee,
      totalFee: inferTotalFee(collectFee, payoutFee, explicitTotalFee),
      collectSingleFee,
      payoutSingleFee,
      collectLimit,
      payoutLimit,
      channelInfo: channelCol >= 0 ? get(row, channelCol) : "",
      leak: leakCol >= 0 ? get(row, leakCol) : "",
      whitelist: whitelistCol >= 0 ? get(row, whitelistCol) : "",
      status,
      sourceRow: r + 1
    };
    rates.push(rateRow);

    // 费率表经常左右各有一列“三方”：左边是展示名/旧名，右边是统一名。
    // 同一行的费率要同时挂到两个名称上，避免页面三方量用其中一个名字时匹配不到费率。
    for (const aliasName of uniqueIndexes(nameCols).map((col) => get(row, col)).filter((name) => name && isValidThirdPartyName(name))) {
      const aliasThirdParty = canonicalThirdPartyName(aliasName, rowCountry);
      if (!aliasThirdParty || aliasThirdParty === thirdParty || !isValidThirdPartyName(aliasThirdParty)) continue;
      rates.push({
        ...rateRow,
        id: `${sheetName}-${r}-${aliasThirdParty}`,
        thirdParty: aliasThirdParty,
        channelInfo: [rateRow.channelInfo, thirdParty].filter(Boolean).join(" / ")
      });
    }

    for (const { header: platform, index } of platformColumns) {
      const raw = get(row, index);
      const platformStatus = normalizeStatus(raw);
      if (!raw && !platformStatus) continue;
      statuses.push({
        id: `${sheetName}-${r}-${index}`,
        sheetName,
        country: rowCountry,
        platform,
        thirdParty,
        status: platformStatus || raw,
        rawStatus: raw,
        collectFee: rateRow.collectFee,
        payoutFee: rateRow.payoutFee,
        totalFee: rateRow.totalFee,
        collectSingleFee: rateRow.collectSingleFee,
        payoutSingleFee: rateRow.payoutSingleFee,
        collectLimit: rateRow.collectLimit,
        payoutLimit: rateRow.payoutLimit,
        category: rateRow.category,
        sourceRow: r + 1,
        sourceColumn: index + 1
      });
    }
  }

  return { rates, statuses };
}

function findPlatformHeader(values: Values): number {
  for (let r = 0; r < Math.min(values.length, 20); r++) {
    const first = compact(get(values[r], 0));
    const joined = values[r].map(compact).join("|");
    if ((first.includes("盘口") || first.includes("平台")) && (joined.includes("代收手续费") || joined.includes("代付手续费") || joined.includes("状态"))) return r;
  }
  return -1;
}

function parsePlatformMatrixSheet(sheetName: string, values: Values): { rates: ThirdPartyRateRow[]; statuses: ThirdPartyPlatformStatusRow[] } {
  const headerIndex = findPlatformHeader(values);
  if (headerIndex < 0) return { rates: [], statuses: [] };

  const header = values[headerIndex].map(normalizeCell);
  const country = inferCountry(sheetName);
  const platformCol = 0;

  const groups: Array<{ thirdParty: string; statusCol: number; collectFeeCol?: number; payoutFeeCol?: number; collectSingleFeeCol?: number; payoutSingleFeeCol?: number; collectLimitCol?: number; payoutLimitCol?: number }> = [];
  for (let c = 1; c < header.length; c++) {
    const title = normalizeCell(header[c]);
    if (!isValidThirdPartyName(title)) continue;

    let collectFeeCol: number | undefined;
    let payoutFeeCol: number | undefined;
    let collectSingleFeeCol: number | undefined;
    let payoutSingleFeeCol: number | undefined;
    let collectLimitCol: number | undefined;
    let payoutLimitCol: number | undefined;

    for (let j = c + 1; j < Math.min(header.length, c + 8); j++) {
      const h = normalizeCell(header[j]);
      if (!h) continue;
      if (isValidThirdPartyName(h)) break;
      if (isSingleFeeHeader(h) && isCollectHeader(h) && collectSingleFeeCol === undefined) collectSingleFeeCol = j;
      else if (isSingleFeeHeader(h) && isPayoutHeader(h) && payoutSingleFeeCol === undefined) payoutSingleFeeCol = j;
      else if (!isSingleFeeHeader(h) && headerMatches(h, ["代收手续费", "代收费率"]) && collectFeeCol === undefined) collectFeeCol = j;
      else if (!isSingleFeeHeader(h) && headerMatches(h, ["代付手续费", "代付费率"]) && payoutFeeCol === undefined) payoutFeeCol = j;
      else if (headerMatches(h, ["代收限制", "代收限额", "收款限制"]) && collectLimitCol === undefined) collectLimitCol = j;
      else if (headerMatches(h, ["代付限制", "代付限额", "出款限制"]) && payoutLimitCol === undefined) payoutLimitCol = j;
    }

    groups.push({ thirdParty: canonicalThirdPartyName(title, country), statusCol: c, collectFeeCol, payoutFeeCol, collectSingleFeeCol, payoutSingleFeeCol, collectLimitCol, payoutLimitCol });
  }

  const ratesByThirdParty = new Map<string, ThirdPartyRateRow>();
  const statuses: ThirdPartyPlatformStatusRow[] = [];

  for (let r = headerIndex + 1; r < values.length; r++) {
    const row = values[r] || [];
    const platform = get(row, platformCol);
    if (!looksLikeEntityName(platform)) continue;
    // 避免右侧说明表、图例、状态说明也被读进来。
    if (["状态", "状态备注内容", "运行中", "技术还在对接中", "盘口不支持接入", "三方都正常的情况下不开", "已经不再使用"].includes(platform)) continue;
    if (isStatusText(platform) || isColumnOrLegendText(platform)) continue;

    for (const group of groups) {
      const raw = get(row, group.statusCol);
      const status = normalizeStatus(raw);
      const collectFee = cleanFeeOrLimitValue(group.collectFeeCol !== undefined ? get(row, group.collectFeeCol) : "");
      const payoutFee = cleanFeeOrLimitValue(group.payoutFeeCol !== undefined ? get(row, group.payoutFeeCol) : "");
      const collectSingleFee = cleanFeeOrLimitValue(group.collectSingleFeeCol !== undefined ? get(row, group.collectSingleFeeCol) : "");
      const payoutSingleFee = cleanFeeOrLimitValue(group.payoutSingleFeeCol !== undefined ? get(row, group.payoutSingleFeeCol) : "");
      const collectLimit = cleanFeeOrLimitValue(group.collectLimitCol !== undefined ? get(row, group.collectLimitCol) : "");
      const payoutLimit = cleanFeeOrLimitValue(group.payoutLimitCol !== undefined ? get(row, group.payoutLimitCol) : "");
      if (!raw && !collectFee && !payoutFee && !collectSingleFee && !payoutSingleFee && !collectLimit && !payoutLimit) continue;

      const existing = ratesByThirdParty.get(group.thirdParty);
      if (!existing && (collectFee || payoutFee || collectSingleFee || payoutSingleFee || collectLimit || payoutLimit || status)) {
        ratesByThirdParty.set(group.thirdParty, {
          id: `${sheetName}-${group.thirdParty}`,
          sheetName,
          country,
          category: "",
          thirdParty: group.thirdParty,
          collectFee,
          payoutFee,
          totalFee: inferTotalFee(collectFee, payoutFee, ""),
          collectSingleFee,
          payoutSingleFee,
          collectLimit,
          payoutLimit,
          channelInfo: "",
          leak: "",
          whitelist: "",
          status,
          sourceRow: headerIndex + 1
        });
      } else if (existing) {
        if (!existing.collectFee && collectFee) existing.collectFee = collectFee;
        if (!existing.payoutFee && payoutFee) existing.payoutFee = payoutFee;
        if (!existing.collectSingleFee && collectSingleFee) existing.collectSingleFee = collectSingleFee;
        if (!existing.payoutSingleFee && payoutSingleFee) existing.payoutSingleFee = payoutSingleFee;
        if (!existing.collectLimit && collectLimit) existing.collectLimit = collectLimit;
        if (!existing.payoutLimit && payoutLimit) existing.payoutLimit = payoutLimit;
        if (!existing.totalFee) existing.totalFee = inferTotalFee(existing.collectFee, existing.payoutFee, "");
        if (!existing.status && status) existing.status = status;
      }

      statuses.push({
        id: `${sheetName}-${r}-${group.statusCol}`,
        sheetName,
        country,
        platform,
        thirdParty: group.thirdParty,
        status: status || raw,
        rawStatus: raw,
        collectFee,
        payoutFee,
        totalFee: inferTotalFee(collectFee, payoutFee, ""),
        collectSingleFee,
        payoutSingleFee,
        collectLimit,
        payoutLimit,
        category: "",
        sourceRow: r + 1,
        sourceColumn: group.statusCol + 1
      });
    }
  }

  return { rates: Array.from(ratesByThirdParty.values()), statuses };
}


// V105: 直接按 Google 费率表表头读取费率。这个解析器只负责费率本身，避免旧矩阵/状态解析把费率列误判成盘口状态。
function directHeaderIndex(values: Values): number {
  for (let r = 0; r < Math.min(values.length, 8); r++) {
    const cells = (values[r] || []).map(compact);
    const hasName = cells.some((cell) => cell === "三方" || cell === "三方名称" || cell === "三方名");
    const hasFee = cells.some((cell) => /代收合计|代付合计|代收费率|代付费率|代收手续费|代付手续费|费率合计|合计费率|easy代收|jazz代收/i.test(cell));
    if (hasName && hasFee) return r;
  }
  return -1;
}

function directHeaderLooksLikeName(header: string): boolean {
  const clean = compact(header);
  return clean === "三方" || clean === "三方名称" || clean === "三方名";
}

function directClean(value: string): string {
  const text = cleanFeeOrLimitValue(value);
  if (!text || isBadFormulaValue(text) || isColumnOrLegendText(text)) return "";
  return text;
}

function directHeaderFind(headers: string[], pattern: RegExp, reject?: RegExp): number[] {
  return headers
    .map((header, index) => ({ header, clean: compact(header), index }))
    .filter(({ clean }) => clean && pattern.test(clean) && !(reject && reject.test(clean)))
    .map(({ index }) => index);
}

function directPick(row: string[], headers: string[], patterns: RegExp[], reject?: RegExp): string {
  const seen = new Set<number>();
  for (const pattern of patterns) {
    for (const col of directHeaderFind(headers, pattern, reject)) {
      if (seen.has(col)) continue;
      seen.add(col);
      const value = directClean(get(row, col));
      if (value) return value;
    }
  }
  return "";
}

function directPickLimit(row: string[], headers: string[], minPattern: RegExp, maxPattern: RegExp, singlePattern: RegExp): string {
  const single = directPick(row, headers, [singlePattern]);
  const min = directPick(row, headers, [minPattern]);
  const max = directPick(row, headers, [maxPattern]);
  if (min || max) return [min, max].filter(Boolean).join("-");
  return single;
}

function directPickByHeader(row: string[], headers: string[], matcher: (clean: string) => boolean): string {
  for (let index = 0; index < headers.length; index++) {
    const clean = compact(headers[index] || "").toLowerCase();
    if (!clean || !matcher(clean)) continue;
    const value = directClean(get(row, index));
    if (value) return value;
  }
  return "";
}

function directPickByHeaderContains(row: string[], headers: string[], includes: string[], rejects: string[] = []): string {
  const wants = includes.map((item) => compact(item).toLowerCase()).filter(Boolean);
  const bads = rejects.map((item) => compact(item).toLowerCase()).filter(Boolean);
  return directPickByHeader(row, headers, (clean) => wants.every((item) => clean.includes(item)) && !bads.some((item) => clean.includes(item)));
}

function normalizePakistanWalletLabel(value: string): string {
  const text = normalizeCell(value).toLowerCase();
  if (/jazz/.test(text)) return "JAZZCASH";
  if (/easy|easypaisa|wallet2|\bep\b/.test(text)) return "EASYPAISA";
  return value;
}

function collectPakistanVariant(row: string[], headers: string[], variant: "easy" | "jazz") {
  const label = variant === "easy" ? "EASYPAISA" : "JAZZCASH";
  const token = variant;
  const totalFee = directPickByHeader(row, headers, (clean) => clean.includes(token) && /合计|总/.test(clean) && !/限制|限额|最低|最高|状态|备注|白名单|漏洞/.test(clean));
  let collectFee = directPickByHeader(row, headers, (clean) => clean.includes(token) && /代收|收款|入款|充值/.test(clean) && !/限制|限额|最低|最高|状态|备注|白名单|漏洞/.test(clean));
  let payoutFee = directPickByHeader(row, headers, (clean) => clean.includes(token) && /代付|付款|出款|提现|提款/.test(clean) && !/限制|限额|最低|最高|状态|备注|白名单|漏洞/.test(clean));
  // 有些巴基斯坦表只在 Easy/Jazz 合计列填值，代收/代付分列留空；列表总览先显示合计，展开再看钱包类型。
  if (!collectFee) collectFee = directPickByHeaderContains(row, headers, [token, "代收"]);
  if (!payoutFee) payoutFee = directPickByHeaderContains(row, headers, [token, "代付"]);
  const collectSingleFee = directPickByHeader(row, headers, (clean) => clean.includes(token) && /代收.*单|收款.*单|入款.*单|充值.*单/.test(clean));
  const payoutSingleFee = directPickByHeader(row, headers, (clean) => clean.includes(token) && /代付.*单|付款.*单|出款.*单|提现.*单|提款.*单/.test(clean));
  const collectLimit = directPickByHeader(row, headers, (clean) => clean.includes(token) && /代收|收款|入款|充值/.test(clean) && /限制|限额|最低|最高|最小|最大|下限|上限/.test(clean));
  const payoutLimit = directPickByHeader(row, headers, (clean) => clean.includes(token) && /代付|付款|出款|提现|提款/.test(clean) && /限制|限额|最低|最高|最小|最大|下限|上限/.test(clean));
  return { label, collectFee, payoutFee, totalFee, collectSingleFee, payoutSingleFee, collectLimit, payoutLimit };
}

function directNormalizeCategory(country: string, rawCategory: string, thirdParty: string, rowText: string, sheetName: string): string {
  const base = normalizeCell(rawCategory);
  const southAmericaCategory = normalizeSouthAmericaRateCategory(country, base, rowText);
  if (southAmericaCategory) return southAmericaCategory;
  if (country.includes("巴基斯坦")) {
    const pakistanText = `${base} ${rowText}`;
    if (/jazz|jazzcash/i.test(pakistanText)) return "JAZZCASH";
    if (/easy|easypaisa|wallet2|\bep\b/i.test(pakistanText)) return "EASYPAISA";
  }
  const inferred = inferThirdPartyChannelType(`${thirdParty} ${base}`, country, `${rowText} ${sheetName}`);
  return normalizeRateRowCategory(country, inferred || base, thirdParty, sheetName);
}

function directRateRow(
  sheetName: string,
  country: string,
  sourceRow: number,
  rawCategory: string,
  rawThirdParty: string,
  collectFee: string,
  payoutFee: string,
  totalFee: string,
  collectSingleFee: string,
  payoutSingleFee: string,
  collectLimit: string,
  payoutLimit: string,
  rowText: string,
  status: string
): ThirdPartyRateRow | null {
  if (!rawThirdParty || !isValidThirdPartyName(rawThirdParty)) return null;
  const thirdParty = canonicalThirdPartyName(rawThirdParty, country);
  if (!thirdParty || !isValidThirdPartyName(thirdParty)) return null;
  const category = directNormalizeCategory(country, rawCategory, thirdParty, rowText, sheetName);
  return {
    id: `${sheetName}-direct-${sourceRow}-${thirdParty}-${category || "all"}-${collectFee}-${payoutFee}`,
    sheetName,
    country,
    category,
    thirdParty,
    collectFee,
    payoutFee,
    totalFee: inferTotalFee(collectFee, payoutFee, totalFee),
    collectSingleFee,
    payoutSingleFee,
    collectLimit,
    payoutLimit,
    channelInfo: "Google费率表直读",
    leak: "",
    whitelist: "",
    status,
    sourceRow
  };
}

function parseDirectGoogleRateSheet(sheetName: string, values: Values): { rates: ThirdPartyRateRow[]; statuses: ThirdPartyPlatformStatusRow[] } {
  const headerIndex = directHeaderIndex(values);
  if (headerIndex < 0) return { rates: [], statuses: [] };
  const headers = (values[headerIndex] || []).map(normalizeCell);
  const baseCountry = inferCountry(sheetName);
  const countryCol = findHeaderIndex(headers, ["国家", "国家/地区", "地区"]);
  const nameCols = headers.map((header, index) => directHeaderLooksLikeName(header) ? index : -1).filter((index) => index >= 0);
  if (!nameCols.length) return { rates: [], statuses: [] };

  const categoryCol = findHeaderIndex(headers, ["类型", "钱包", "通道类型", "分类"]);
  const statusCol = findUsableStatusColumn(headers);
  const rates: ThirdPartyRateRow[] = [];
  let currentCategory = "";
  let currentCountryText = "";

  const addRateWithAliases = (row: string[], sourceRow: number, rowCountry: string, category: string, rawName: string, collectFee: string, payoutFee: string, totalFee: string, collectSingleFee: string, payoutSingleFee: string, collectLimit: string, payoutLimit: string, status: string) => {
    const rowText = row.map(normalizeCell).filter(Boolean).join(" ");
    const base = directRateRow(sheetName, rowCountry, sourceRow, category, rawName, collectFee, payoutFee, totalFee, collectSingleFee, payoutSingleFee, collectLimit, payoutLimit, rowText, status);
    if (!base) return;
    rates.push(base);
    for (const col of nameCols) {
      const alias = get(row, col);
      if (!alias || alias === rawName || !isValidThirdPartyName(alias)) continue;
      const aliasName = canonicalThirdPartyName(alias, rowCountry);
      if (!aliasName || aliasName === base.thirdParty || !isValidThirdPartyName(aliasName)) continue;
      rates.push({ ...base, id: `${sheetName}-direct-${sourceRow}-${aliasName}-${base.category || "all"}`, thirdParty: aliasName, channelInfo: `Google费率表直读 / ${base.thirdParty}` });
    }
  };

  for (let r = headerIndex + 1; r < values.length; r++) {
    const row = values[r] || [];
    if (!row.some((cell) => normalizeCell(cell))) continue;
    const rowText = row.map(normalizeCell).filter(Boolean).join(" ");
    const rawCountry = countryCol >= 0 ? get(row, countryCol) : "";
    if (rawCountry && !isColumnOrLegendText(rawCountry)) currentCountryText = rawCountry;
    const rowCountry = resolveRateRowCountry(baseCountry, currentCountryText, sheetName);
    const rawCategory = categoryCol >= 0 ? get(row, categoryCol) : "";
    if (rawCategory && !isColumnOrLegendText(rawCategory) && !isStatusText(rawCategory)) currentCategory = rawCategory;

    const names = nameCols.map((col) => get(row, col)).filter((name) => name && isValidThirdPartyName(name));
    if (!names.length) continue;
    const rawName = names[names.length - 1] || names[0];
    const status = normalizeStatus(statusCol >= 0 ? get(row, statusCol) : "");

    if (rowCountry.includes("巴基斯坦")) {
      const easy = collectPakistanVariant(row, headers, "easy");
      const jazz = collectPakistanVariant(row, headers, "jazz");
      const variants = [easy, jazz].filter((item) => item.collectFee || item.payoutFee || item.totalFee || item.collectSingleFee || item.payoutSingleFee || item.collectLimit || item.payoutLimit);

      if (variants.length) {
        for (const item of variants) {
          addRateWithAliases(
            row,
            r + 1,
            rowCountry,
            normalizePakistanWalletLabel(item.label),
            rawName,
            item.collectFee,
            item.payoutFee,
            item.totalFee,
            item.collectSingleFee,
            item.payoutSingleFee,
            item.collectLimit,
            item.payoutLimit,
            status
          );
        }
        continue;
      }
    }

    const collectFee = directPick(row, headers, [
      /代收合计.*单笔/i,
      /代收手续费|代收费率|收款手续费|收款费率|入款手续费|充值手续费/i
    ], /限制|限额|最低|最高/i);
    const payoutFee = directPick(row, headers, [
      /代付合计.*单笔/i,
      /代付手续费|代付费率|付款手续费|付款费率|出款手续费|提现手续费/i
    ], /限制|限额|最低|最高/i);
    const totalFee = directPick(row, headers, [/费率合计|合计费率|总费率|总手续费|合计.*单笔/i], /限制|限额|最低|最高/i);
    const collectSingleFee = directPick(row, headers, [/代收单笔|代收单$|收款单笔|收款单$|入款单笔|充值单笔/i]);
    const payoutSingleFee = directPick(row, headers, [/代付单笔|代付单$|付款单笔|付款单$|出款单笔|出款单$|提现单笔|提现单$/i]);
    const collectLimit = directPickLimit(row, headers, /代收.*(最低|最小|下限)|收款.*(最低|最小|下限)/i, /代收.*(最高|最大|上限)|收款.*(最高|最大|上限)/i, /代收.*(限制|限额|区间)|收款.*(限制|限额|区间)/i);
    const payoutLimit = directPickLimit(row, headers, /代付.*(最低|最小|下限)|付款.*(最低|最小|下限)|出款.*(最低|最小|下限)/i, /代付.*(最高|最大|上限)|付款.*(最高|最大|上限)|出款.*(最高|最大|上限)/i, /代付.*(限制|限额|区间)|付款.*(限制|限额|区间)|出款.*(限制|限额|区间)/i);

    if (!collectFee && !payoutFee && !totalFee && !collectSingleFee && !payoutSingleFee) continue;
    addRateWithAliases(row, r + 1, rowCountry, currentCategory, rawName, collectFee, payoutFee, totalFee, collectSingleFee, payoutSingleFee, collectLimit, payoutLimit, status);
  }

  return { rates, statuses: [] };
}

function dedupeRows<T extends { id: string }>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const row of rows) map.set(row.id, row);
  return Array.from(map.values());
}

function feeKey(country: string, thirdParty: string, category = ""): string {
  return `${country}|||${thirdParty}|||${category || ""}`;
}

function fillMissingFeeData(rates: ThirdPartyRateRow[], statuses: ThirdPartyPlatformStatusRow[]) {
  const map = new Map<string, { collectFee: string; payoutFee: string; totalFee: string; collectSingleFee: string; payoutSingleFee: string; collectLimit: string; payoutLimit: string; category: string; status: string }>();

  function remember(row: { country: string; thirdParty: string; collectFee: string; payoutFee: string; totalFee: string; collectSingleFee?: string; payoutSingleFee?: string; collectLimit: string; payoutLimit: string; category?: string; status?: string }) {
    const key = feeKey(row.country, row.thirdParty, row.category || "");
    const current = map.get(key) || { collectFee: "", payoutFee: "", totalFee: "", collectSingleFee: "", payoutSingleFee: "", collectLimit: "", payoutLimit: "", category: "", status: "" };
    if (!current.collectFee && row.collectFee) current.collectFee = row.collectFee;
    if (!current.payoutFee && row.payoutFee) current.payoutFee = row.payoutFee;
    if (!current.totalFee && row.totalFee) current.totalFee = row.totalFee;
    if (!current.collectSingleFee && row.collectSingleFee) current.collectSingleFee = row.collectSingleFee;
    if (!current.payoutSingleFee && row.payoutSingleFee) current.payoutSingleFee = row.payoutSingleFee;
    if (!current.collectLimit && row.collectLimit) current.collectLimit = row.collectLimit;
    if (!current.payoutLimit && row.payoutLimit) current.payoutLimit = row.payoutLimit;
    if (!current.category && row.category) current.category = row.category;
    if (!current.status && row.status) current.status = row.status;
    map.set(key, current);
  }

  rates.forEach(remember);
  statuses.forEach(remember);

  const filledRates = rates.map((row) => {
    const fee = map.get(feeKey(row.country, row.thirdParty, row.category || "")) || map.get(feeKey(row.country, row.thirdParty, ""));
    if (!fee) return row;
    const collectFee = row.collectFee || fee.collectFee;
    const payoutFee = row.payoutFee || fee.payoutFee;
    return {
      ...row,
      collectFee,
      payoutFee,
      totalFee: row.totalFee || fee.totalFee || inferTotalFee(collectFee, payoutFee, ""),
      collectSingleFee: row.collectSingleFee || fee.collectSingleFee,
      payoutSingleFee: row.payoutSingleFee || fee.payoutSingleFee,
      collectLimit: row.collectLimit || fee.collectLimit,
      payoutLimit: row.payoutLimit || fee.payoutLimit,
      category: row.category || fee.category,
      status: row.status || fee.status
    };
  });

  const filledStatuses = statuses.map((row) => {
    const fee = map.get(feeKey(row.country, row.thirdParty, row.category || "")) || map.get(feeKey(row.country, row.thirdParty, ""));
    if (!fee) return row;
    const collectFee = row.collectFee || fee.collectFee;
    const payoutFee = row.payoutFee || fee.payoutFee;
    return {
      ...row,
      collectFee,
      payoutFee,
      totalFee: row.totalFee || fee.totalFee || inferTotalFee(collectFee, payoutFee, ""),
      collectSingleFee: row.collectSingleFee || fee.collectSingleFee,
      payoutSingleFee: row.payoutSingleFee || fee.payoutSingleFee,
      collectLimit: row.collectLimit || fee.collectLimit,
      payoutLimit: row.payoutLimit || fee.payoutLimit,
      category: row.category || fee.category
    };
  });

  return { rates: filledRates, statuses: filledStatuses };
}

function summarizeStatuses(rows: ThirdPartyPlatformStatusRow[]) {
  const statusCounts: Record<string, number> = {};
  const platformSet = new Set<string>();
  const thirdPartySet = new Set<string>();
  const sheetSet = new Set<string>();

  for (const row of rows) {
    const status = row.status || "未知";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (row.platform) platformSet.add(`${row.country}|||${row.platform}`);
    if (row.thirdParty) thirdPartySet.add(row.thirdParty);
    if (row.sheetName) sheetSet.add(row.sheetName);
  }

  return {
    totalStatusCells: rows.length,
    totalPlatforms: platformSet.size,
    totalThirdParties: thirdPartySet.size,
    totalSheets: sheetSet.size,
    statusCounts,
    openCount: (statusCounts["开启"] || 0) + (statusCounts["正常"] || 0),
    pauseCount: statusCounts["暂停"] || 0,
    backupCount: statusCounts["备用"] || 0,
    disabledCount: statusCounts["停用"] || 0,
    notConnectedCount: statusCounts["未接入"] || 0,
    maintenanceCount: statusCounts["维护"] || 0,
    unsupportedCount: statusCounts["不支持"] || 0
  };
}

function buildAnomalies(rates: ThirdPartyRateRow[], statuses: ThirdPartyPlatformStatusRow[]): string[] {
  const anomalies: string[] = [];
  const statusSummary = new Map<string, { total: number; open: number; paused: number; stopped: number; notConnected: number }>();

  for (const row of statuses) {
    const key = `${row.country} ${row.platform}`;
    const item = statusSummary.get(key) || { total: 0, open: 0, paused: 0, stopped: 0, notConnected: 0 };
    item.total += 1;
    if (row.status === "开启" || row.status === "正常") item.open += 1;
    if (row.status === "暂停") item.paused += 1;
    if (row.status === "停用" || row.status === "维护" || row.status === "不支持") item.stopped += 1;
    if (row.status === "未接入") item.notConnected += 1;
    statusSummary.set(key, item);
  }

  for (const [key, item] of Array.from(statusSummary.entries())) {
    const country = key.split(" ")[0] || "";
    if (isUsdtCountry(country)) {
      // USDT 通道本来就只有 2-3 个渠道，不要因为“可用少”误报；只有一个可用渠道都没有才提醒。
      if (item.total > 0 && item.open <= 0) anomalies.push(`[USDT可用为0] ${key}：USDT 可用渠道为 0/${item.total}，需要马上检查。`);
      continue;
    }
    if (item.total >= 3 && item.open <= 2) anomalies.push(`[少接入] ${key}：可用三方仅 ${item.open}/${item.total} 个，建议补充备用通道。`);
    if (item.paused >= 3) anomalies.push(`[暂停较多] ${key}：暂停三方 ${item.paused} 个，需确认是否影响出入款。`);
    if (item.notConnected >= Math.max(3, Math.ceil(item.total * 0.5))) anomalies.push(`[未接入较多] ${key}：未接入较多 ${item.notConnected}/${item.total}。`);
  }

  for (const row of rates) {
    if (isUsdtCountry(row.country)) continue;
    if (isHighFeeRow(row)) {
      const feeSummary = [
        row.collectFee ? `代收 ${row.collectFee}` : "",
        row.payoutFee ? `代付 ${row.payoutFee}` : "",
        row.totalFee ? `合计 ${row.totalFee}` : "",
        row.collectSingleFee ? `代收单笔 ${row.collectSingleFee}` : "",
        row.payoutSingleFee ? `代付单笔 ${row.payoutSingleFee}` : ""
      ].filter(Boolean).join(" / ");
      anomalies.push(`[费率偏高] ${row.country} ${row.thirdParty}：费率偏高（${feeSummary}）。`);
    }
    if (row.status === "暂停" || row.status === "停用" || row.status === "维护") anomalies.push(`[状态异常] ${row.country} ${row.thirdParty}：当前状态为 ${row.status}。`);
  }

  return Array.from(new Set(anomalies)).slice(0, 200);
}


// V166: 全局费率表直读解析器。按 Google 费率表字段读取，不按国家猜列；支持 USDT/印度线下/巴西/越南/菲律宾/印尼/马来/巴基斯坦/南美/缅甸/尼日利亚。
function v166FindHeaderIndex(values: Values): number {
  for (let r = 0; r < Math.min(values.length, 12); r++) {
    const cells = (values[r] || []).map(compact);
    const hasName = cells.some((cell) => cell === "三方" || cell === "三方名称" || cell === "三方名");
    const hasRate = cells.some((cell) => /合计%?\+?单笔|费率合计|合计费率|代收合计|代付合计|代收手续费|代付手续费|代收费率|代付费率|单笔|最低限制|最高限制|最低限额|最高限额/.test(cell));
    if (hasName && hasRate) return r;
  }
  return -1;
}

function v166HeaderKey(header: string): string {
  return compact(header).toLowerCase();
}

function v166HeaderExact(headers: string[], names: string[], maxIndex = Number.MAX_SAFE_INTEGER): number {
  const keys = names.map((name) => v166HeaderKey(name));
  for (let i = 0; i < headers.length && i <= maxIndex; i++) {
    const h = v166HeaderKey(headers[i] || "");
    if (keys.includes(h)) return i;
  }
  return -1;
}

function v166HeaderFind(headers: string[], matcher: (key: string, raw: string, index: number) => boolean, maxIndex = Number.MAX_SAFE_INTEGER): number {
  for (let i = 0; i < headers.length && i <= maxIndex; i++) {
    const raw = headers[i] || "";
    const key = v166HeaderKey(raw);
    if (key && matcher(key, raw, i)) return i;
  }
  return -1;
}

function v166HeaderFindAll(headers: string[], matcher: (key: string, raw: string, index: number) => boolean, maxIndex = Number.MAX_SAFE_INTEGER): number[] {
  const out: number[] = [];
  for (let i = 0; i < headers.length && i <= maxIndex; i++) {
    const raw = headers[i] || "";
    const key = v166HeaderKey(raw);
    if (key && matcher(key, raw, i)) out.push(i);
  }
  return out;
}

function v166IsSupportSwitchHeader(header: string): boolean {
  const key = v166HeaderKey(header);
  return /^(代收|代付|收款|付款|easy代收|jazz代收|easy代付|jazz代付|银行卡代收|银行卡代付)$/.test(key);
}

function v166IsDataHeader(header: string): boolean {
  const key = v166HeaderKey(header);
  if (!key) return false;
  if (v166IsSupportSwitchHeader(header)) return true;
  return /三方|类型|通道|费率|手续费|合计|单笔|最低|最高|限制|限额|结算|状态|备注|漏洞|白名单|授信|公户|打款|金额|通知|账号|utr|ifsc|小数点|转移资金|是否/.test(key);
}

function v166DataBoundary(headers: string[], headerIndex: number, values: Values): number {
  let maxData = 0;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i] || "";
    if (v166IsDataHeader(h)) maxData = Math.max(maxData, i);
  }
  // 第一批真正盘口列之前通常就是费率资料区结束；若右侧还有“状态/备注”图例，不算主资料区。
  for (let i = 0; i < headers.length; i++) {
    if (!isValidPlatformName(headers[i] || "")) continue;
    if (v166IsDataHeader(headers[i] || "")) continue;
    let hits = 0;
    for (let r = headerIndex + 1; r < Math.min(values.length, headerIndex + 80); r++) {
      const status = normalizeStatus(get(values[r], i));
      if (/^(开启|正常|暂停|备用|停用|未接入|维护|不支持|对接中)$/.test(status)) hits += 1;
    }
    if (hits > 0) return Math.max(0, i - 1);
  }
  return maxData || Math.min(headers.length - 1, 18);
}

function v166Pick(row: string[], col: number): string {
  if (col < 0) return "";
  const value = directClean(get(row, col));
  return value;
}

function v166PickFirst(row: string[], cols: number[]): string {
  for (const col of uniqueIndexes(cols)) {
    const value = v166Pick(row, col);
    if (value) return value;
  }
  return "";
}

function v166LimitPair(row: string[], minCol: number, maxCol: number, singleCol = -1): string {
  const single = v166Pick(row, singleCol);
  if (single) return single;
  const min = v166Pick(row, minCol);
  const max = v166Pick(row, maxCol);
  if (min || max) {
    if (min && max && min === max && /^(没有|无|-|—)$/.test(min)) return min;
    return [min, max].filter(Boolean).join("-");
  }
  return "";
}

function v166NormalizeCountry(baseCountry: string, rawCountry: string, sheetName: string): string {
  const country = resolveRateRowCountry(baseCountry, rawCountry, sheetName);
  if (country === "印度线下") return "印度";
  return country;
}

function v166NormalizeCategory(country: string, rawCategory: string, thirdParty: string, rowText: string, sheetName: string): string {
  const category = directNormalizeCategory(country, rawCategory, thirdParty, rowText, sheetName);
  if (country.includes("印度") && (!category || category.includes("线下") || category.includes("其他"))) return "UPI";
  return category;
}

function isShortNormalizedStatus(value: string): boolean {
  return /^(开启|正常|暂停|备用|停用|未接入|维护|不支持|对接中)$/.test(normalizeCell(value));
}

function v166StatusFromRow(row: string[], headers: string[], preferredStatusCol: number, fallbackText = ""): string {
  const preferred = normalizeStatus(preferredStatusCol >= 0 ? get(row, preferredStatusCol) : "");
  if (isShortNormalizedStatus(preferred)) return preferred;
  const statusLike = v166HeaderFind(headers, (key) => key === "状态" || key === "当前状态" || key === "通道状态");
  const fallbackStatus = normalizeStatus(statusLike >= 0 ? get(row, statusLike) : "");
  if (isShortNormalizedStatus(fallbackStatus)) return fallbackStatus;
  const normalizedFallback = normalizeStatus(fallbackText);
  return isShortNormalizedStatus(normalizedFallback) ? normalizedFallback : "";
}

function v166ConcatInfo(parts: Array<[string, string]>): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [label, value] of parts) {
    const v = normalizeCell(value);
    if (!v) continue;
    const text = label ? `${label}: ${v}` : v;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out.join(" / ");
}

function v166MainNameCols(headers: string[], dataBoundary: number): number[] {
  const max = Math.min(dataBoundary, 12);
  const cols = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header, index }) => index <= max && directHeaderLooksLikeName(header))
    .map(({ index }) => index);
  return cols.length ? cols : headers.map((header, index) => directHeaderLooksLikeName(header) ? index : -1).filter((index) => index >= 0 && index <= dataBoundary);
}

function v166PlatformColumns(headers: string[], subHeaders: string[], dataBoundary: number, headerIndex: number, values: Values): Array<{ platform: string; col: number }> {
  const cols: Array<{ platform: string; col: number }> = [];
  let carryPlatform = "";
  for (let col = dataBoundary + 1; col < headers.length; col++) {
    const top = normalizeCell(headers[col] || "");
    const sub = normalizeCell(subHeaders[col] || "");
    if (top && isValidPlatformName(top) && !v166IsDataHeader(top)) carryPlatform = top;

    let platform = "";
    if (top && isValidPlatformName(top) && !v166IsDataHeader(top)) platform = top;
    else if (!top && carryPlatform && /^(代收|代付|收款|付款)$/i.test(sub)) platform = `${carryPlatform} ${sub}`;
    else if (top && carryPlatform && /^(代收|代付|收款|付款)$/i.test(sub)) platform = `${top} ${sub}`;

    if (!platform || !isValidPlatformName(platform)) continue;
    let statusHits = 0;
    for (let r = headerIndex + 1; r < Math.min(values.length, headerIndex + 180); r++) {
      const status = normalizeStatus(get(values[r], col));
      if (/^(开启|正常|暂停|备用|停用|未接入|维护|不支持|对接中)$/.test(status)) statusHits += 1;
    }
    if (statusHits > 0) cols.push({ platform, col });
  }
  return cols;
}

function v166AddAliases(rates: ThirdPartyRateRow[], base: ThirdPartyRateRow, row: string[], nameCols: number[], country: string) {
  for (const col of uniqueIndexes(nameCols)) {
    const aliasRaw = get(row, col);
    if (!aliasRaw || !isValidThirdPartyName(aliasRaw)) continue;
    const alias = canonicalThirdPartyName(aliasRaw, country);
    if (!alias || alias === base.thirdParty || !isValidThirdPartyName(alias)) continue;
    rates.push({
      ...base,
      id: `${base.id}-alias-${col}-${alias}`,
      thirdParty: alias,
      channelInfo: [base.channelInfo, `别名: ${base.thirdParty}`].filter(Boolean).join(" / ")
    });
  }
}

function v166ParsePakistanSheet(sheetName: string, values: Values, headerIndex: number): { rates: ThirdPartyRateRow[]; statuses: ThirdPartyPlatformStatusRow[] } {
  const headers = (values[headerIndex] || []).map(normalizeCell);
  const subHeaders = (values[headerIndex + 1] || []).map(normalizeCell);
  const country = "巴基斯坦";
  const dataBoundary = v166DataBoundary(headers, headerIndex, values);
  const nameCols = v166MainNameCols(headers, dataBoundary);
  const nameCol = nameCols[nameCols.length - 1] ?? nameCols[0] ?? -1;
  if (nameCol < 0) return { rates: [], statuses: [] };

  const supportEasyCollectCol = v166HeaderExact(headers, ["Easy代收"], dataBoundary);
  const supportJazzCollectCol = v166HeaderExact(headers, ["Jazz代收"], dataBoundary);
  const supportEasyPayoutCol = v166HeaderExact(headers, ["Easy代付"], dataBoundary);
  const supportJazzPayoutCol = v166HeaderExact(headers, ["Jazz代付"], dataBoundary);

  const collectMinCol = v166HeaderFind(headers, (key) => /代收.*(最低|最小|下限)/.test(key), dataBoundary);
  const collectMaxCol = v166HeaderFind(headers, (key) => /代收.*(最高|最大|上限)/.test(key), dataBoundary);
  const payoutMinCol = v166HeaderFind(headers, (key) => /代付.*(最低|最小|下限)/.test(key), dataBoundary);
  const payoutMaxCol = v166HeaderFind(headers, (key) => /代付.*(最高|最大|上限)/.test(key), dataBoundary);
  const collectStatusCol = v166HeaderExact(headers, ["代收情况"], dataBoundary);
  const payoutStatusCol = v166HeaderExact(headers, ["代付情况"], dataBoundary);
  const leakCol = v166HeaderFind(headers, (key) => /漏洞/.test(key), dataBoundary);
  const whitelistCol = v166HeaderFind(headers, (key) => /白名单/.test(key), dataBoundary);
  const scanCollectCol = v166HeaderFind(headers, (key) => /easy.*扫码.*代收|扫码.*easy.*代收/.test(key), dataBoundary);
  const totalStatusCol = findUsableStatusColumn(headers);
  const noteCol = v166HeaderFind(headers, (key) => /状态备注/.test(key));
  const platformCols = v166PlatformColumns(headers, subHeaders, dataBoundary, headerIndex, values);

  const variants = [
    {
      label: "EASYPAISA",
      supportCollectCol: supportEasyCollectCol,
      supportPayoutCol: supportEasyPayoutCol,
      totalCol: v166HeaderFind(headers, (key) => /合计.*easy|easy.*合计/.test(key) && !/限制|限额|最低|最高/.test(key), dataBoundary),
      collectFeeCol: v166HeaderFind(headers, (key) => /代收合计.*easy|easy.*代收合计/.test(key) && !/限制|限额|最低|最高/.test(key), dataBoundary),
      payoutFeeCol: v166HeaderFind(headers, (key) => /代付合计.*easy|easy.*代付合计/.test(key) && !/限制|限额|最低|最高/.test(key), dataBoundary),
      collectRawFeeCol: v166HeaderFind(headers, (key, raw, index) => index > 5 && /easy.*代收/.test(key) && !/合计|单笔|扫码|限制|限额|最低|最高/.test(key), dataBoundary),
      payoutRawFeeCol: v166HeaderFind(headers, (key, raw, index) => index > 5 && /easy.*代付/.test(key) && !/合计|单笔|限制|限额|最低|最高/.test(key), dataBoundary),
      collectSingleCol: v166HeaderFind(headers, (key) => /easy.*代收.*单笔|easy代收单笔/.test(key), dataBoundary),
      payoutSingleCol: v166HeaderFind(headers, (key) => /easy.*代付.*单笔|easy代付单笔/.test(key), dataBoundary)
    },
    {
      label: "JAZZCASH",
      supportCollectCol: supportJazzCollectCol,
      supportPayoutCol: supportJazzPayoutCol,
      totalCol: v166HeaderFind(headers, (key) => /合计.*jazz|jazz.*合计/.test(key) && !/限制|限额|最低|最高/.test(key), dataBoundary),
      collectFeeCol: v166HeaderFind(headers, (key) => /代收合计.*jazz|jazz.*代收合计/.test(key) && !/限制|限额|最低|最高/.test(key), dataBoundary),
      payoutFeeCol: v166HeaderFind(headers, (key) => /代付合计.*jazz|jazz.*代付合计/.test(key) && !/限制|限额|最低|最高/.test(key), dataBoundary),
      collectRawFeeCol: v166HeaderFind(headers, (key, raw, index) => index > 5 && /jazz.*代收/.test(key) && !/合计|单笔|扫码|限制|限额|最低|最高/.test(key), dataBoundary),
      payoutRawFeeCol: v166HeaderFind(headers, (key, raw, index) => index > 5 && /jazz.*代付/.test(key) && !/合计|单笔|限制|限额|最低|最高/.test(key), dataBoundary),
      collectSingleCol: v166HeaderFind(headers, (key) => /jazz.*代收.*单笔|jazz代收单笔/.test(key), dataBoundary),
      payoutSingleCol: v166HeaderFind(headers, (key) => /jazz.*代付.*单笔|jazz代付单笔/.test(key), dataBoundary)
    }
  ];

  const rates: ThirdPartyRateRow[] = [];
  const statuses: ThirdPartyPlatformStatusRow[] = [];
  let currentThirdParty = "";

  for (let r = headerIndex + 1; r < values.length; r++) {
    const row = values[r] || [];
    if (!row.some((cell) => normalizeCell(cell))) continue;
    const rawName = get(row, nameCol) || get(row, nameCols[0] ?? -1) || currentThirdParty;
    if (rawName && isValidThirdPartyName(rawName)) currentThirdParty = rawName;
    if (!currentThirdParty || !isValidThirdPartyName(currentThirdParty)) continue;
    const thirdParty = canonicalThirdPartyName(currentThirdParty, country);
    const collectLimit = v166LimitPair(row, collectMinCol, collectMaxCol);
    const payoutLimit = v166LimitPair(row, payoutMinCol, payoutMaxCol);
    const baseStatus = v166StatusFromRow(row, headers, totalStatusCol, `${get(row, collectStatusCol)} ${get(row, payoutStatusCol)}`);
    const note = noteCol >= 0 ? get(row, noteCol) : "";
    const leak = v166Pick(row, leakCol);
    const whitelist = v166Pick(row, whitelistCol);
    const baseInfo = [
      ["代收情况", get(row, collectStatusCol)],
      ["代付情况", get(row, payoutStatusCol)],
      ["easy扫码代收", get(row, scanCollectCol)],
      ["状态备注", note]
    ] as Array<[string, string]>;

    for (const variant of variants) {
      const collectFee = v166PickFirst(row, [variant.collectFeeCol, variant.collectRawFeeCol]);
      const payoutFee = v166PickFirst(row, [variant.payoutFeeCol, variant.payoutRawFeeCol]);
      const totalFee = v166Pick(row, variant.totalCol);
      const collectSingleFee = v166Pick(row, variant.collectSingleCol);
      const payoutSingleFee = v166Pick(row, variant.payoutSingleCol);
      const supportInfo = [
        [variant.label === "EASYPAISA" ? "Easy代收" : "Jazz代收", get(row, variant.supportCollectCol)],
        [variant.label === "EASYPAISA" ? "Easy代付" : "Jazz代付", get(row, variant.supportPayoutCol)]
      ] as Array<[string, string]>;
      if (!collectFee && !payoutFee && !totalFee && !collectSingleFee && !payoutSingleFee && !collectLimit && !payoutLimit) continue;
      const rateRow: ThirdPartyRateRow = {
        id: `${sheetName}-v166-${r}-${thirdParty}-${variant.label}`,
        sheetName,
        country,
        category: variant.label,
        thirdParty,
        collectFee,
        payoutFee,
        totalFee: inferTotalFee(collectFee, payoutFee, totalFee),
        collectSingleFee,
        payoutSingleFee,
        collectLimit,
        payoutLimit,
        channelInfo: v166ConcatInfo([...supportInfo, ...baseInfo]),
        leak,
        whitelist,
        status: baseStatus,
        sourceRow: r + 1
      };
      rates.push(rateRow);
      v166AddAliases(rates, rateRow, row, nameCols, country);

      for (const pc of platformCols) {
        const rawStatus = get(row, pc.col);
        const platformStatus = normalizeStatus(rawStatus);
        if (!platformStatus) continue;
        statuses.push({
          id: `${sheetName}-v166-status-${r}-${pc.col}-${variant.label}`,
          sheetName,
          country,
          platform: pc.platform,
          thirdParty,
          status: platformStatus,
          rawStatus,
          collectFee: rateRow.collectFee,
          payoutFee: rateRow.payoutFee,
          totalFee: rateRow.totalFee,
          collectSingleFee: rateRow.collectSingleFee,
          payoutSingleFee: rateRow.payoutSingleFee,
          collectLimit: rateRow.collectLimit,
          payoutLimit: rateRow.payoutLimit,
          category: rateRow.category,
          sourceRow: r + 1,
          sourceColumn: pc.col + 1
        });
      }
    }
  }
  return { rates, statuses };
}

function v166ParseUnifiedRateSheet(sheetName: string, values: Values): { rates: ThirdPartyRateRow[]; statuses: ThirdPartyPlatformStatusRow[] } {
  const headerIndex = v166FindHeaderIndex(values);
  if (headerIndex < 0) return { rates: [], statuses: [] };
  const headers = (values[headerIndex] || []).map(normalizeCell);
  const subHeaders = (values[headerIndex + 1] || []).map(normalizeCell);
  const baseCountry = inferCountry(sheetName);
  if (baseCountry.includes("巴基斯坦")) return v166ParsePakistanSheet(sheetName, values, headerIndex);

  const dataBoundary = v166DataBoundary(headers, headerIndex, values);
  const nameCols = v166MainNameCols(headers, dataBoundary);
  const nameCol = nameCols[nameCols.length - 1] ?? nameCols[0] ?? -1;
  if (nameCol < 0) return { rates: [], statuses: [] };

  const countryCol = v166HeaderFind(headers, (key) => key === "国家" || key === "国家地区" || key === "地区", dataBoundary);
  const categoryCols = v166HeaderFindAll(headers, (key, raw, index) => index <= dataBoundary && (/^(类型|通道类型|分类|钱包)$/.test(key) || /三方代收通道|通道类型/.test(key)), dataBoundary);
  const statusCol = findUsableStatusColumn(headers);
  const leakCol = v166HeaderFind(headers, (key) => /漏洞/.test(key), dataBoundary);
  const whitelistCol = v166HeaderFind(headers, (key) => /白名单/.test(key), dataBoundary);
  const channelInfoCols = v166HeaderFindAll(headers, (key) => /通道情况|通道情况状态|代收情况|代付情况|结算周期|打款时间|授信|公户|小数点|通知|账号|愿意升级|utr|ifsc|收款是/.test(key), dataBoundary);

  const totalFeeCol = v166HeaderFind(headers, (key) => /^(合计费率|费率合计|合计%\+单笔|费率合计%\+单笔|唤醒费率合计%?|原生代收总计%?)$/.test(key) || /合计.*单笔|总费率|总手续费/.test(key), dataBoundary);
  const collectFeeCol = v166HeaderFind(headers, (key) => /代收合计|收款合计|代收手续费|代收费率|收款手续费|收款费率|唤醒代收费率|原生代收费率|银行卡代收/.test(key) && !/最低|最高|限制|限额/.test(key), dataBoundary);
  const payoutFeeCol = v166HeaderFind(headers, (key) => /代付合计|付款合计|代付手续费|代付费率|付款手续费|付款费率|银行卡代付/.test(key) && !/最低|最高|限制|限额/.test(key), dataBoundary);
  const collectSingleFeeCol = v166HeaderFind(headers, (key) => /代收单笔|收款单笔|入款单笔|充值单笔|代收单$|收款单$/.test(key), dataBoundary);
  const payoutSingleFeeCol = v166HeaderFind(headers, (key) => /代付单笔|付款单笔|出款单笔|提现单笔|提款单笔|代付单$|付款单$|出款单$/.test(key), dataBoundary);
  const collectMinCol = v166HeaderFind(headers, (key) => /(代收|收款|入款|充值|原生代收|唤醒代收).*(最低|最小|下限)/.test(key), dataBoundary);
  const collectMaxCol = v166HeaderFind(headers, (key) => /(代收|收款|入款|充值|原生代收|唤醒代收).*(最高|最大|上限)/.test(key), dataBoundary);
  const payoutMinCol = v166HeaderFind(headers, (key) => /(代付|付款|出款|提款|提现|原生代付|唤醒代付).*(最低|最小|下限)/.test(key), dataBoundary);
  const payoutMaxCol = v166HeaderFind(headers, (key) => /(代付|付款|出款|提款|提现|原生代付|唤醒代付).*(最高|最大|上限)/.test(key), dataBoundary);
  const collectLimitCol = v166HeaderFind(headers, (key) => /(代收|收款|入款|充值).*(限制|限额|区间|范围)/.test(key) && !/最低|最高|最小|最大|下限|上限/.test(key), dataBoundary);
  const payoutLimitCol = v166HeaderFind(headers, (key) => /(代付|付款|出款|提款|提现).*(限制|限额|区间|范围)/.test(key) && !/最低|最高|最小|最大|下限|上限/.test(key), dataBoundary);
  const platformCols = v166PlatformColumns(headers, subHeaders, dataBoundary, headerIndex, values);

  const rates: ThirdPartyRateRow[] = [];
  const statuses: ThirdPartyPlatformStatusRow[] = [];
  let currentCountryText = "";
  let currentCategoryText = "";
  let currentThirdParty = "";

  for (let r = headerIndex + 1; r < values.length; r++) {
    const row = values[r] || [];
    if (!row.some((cell) => normalizeCell(cell))) continue;

    const countryCell = get(row, countryCol);
    if (countryCell && !isColumnOrLegendText(countryCell)) currentCountryText = countryCell;
    const rowCountry = v166NormalizeCountry(baseCountry, currentCountryText, sheetName);

    const categoryValues = categoryCols.map((col) => get(row, col)).filter((value) => value && !isColumnOrLegendText(value) && !isStatusText(value));
    if (categoryValues[0]) currentCategoryText = categoryValues[0];
    const rawName = get(row, nameCol) || get(row, nameCols[0] ?? -1) || currentThirdParty;
    if (rawName && isValidThirdPartyName(rawName)) currentThirdParty = rawName;
    if (!currentThirdParty || !isValidThirdPartyName(currentThirdParty)) continue;

    const thirdParty = canonicalThirdPartyName(currentThirdParty, rowCountry);
    if (!thirdParty || !isValidThirdPartyName(thirdParty)) continue;
    const rowText = row.map(normalizeCell).filter(Boolean).join(" ");
    const categoryRaw = [currentCategoryText, ...categoryValues.slice(1)].filter(Boolean).join(" / ");
    const category = v166NormalizeCategory(rowCountry, categoryRaw, thirdParty, rowText, sheetName);
    const collectFee = v166Pick(row, collectFeeCol);
    const payoutFee = v166Pick(row, payoutFeeCol);
    const explicitTotalFee = v166Pick(row, totalFeeCol);
    const collectSingleFee = v166Pick(row, collectSingleFeeCol);
    const payoutSingleFee = v166Pick(row, payoutSingleFeeCol);
    const collectLimit = v166LimitPair(row, collectMinCol, collectMaxCol, collectLimitCol);
    const payoutLimit = v166LimitPair(row, payoutMinCol, payoutMaxCol, payoutLimitCol);
    const channelInfo = v166ConcatInfo(channelInfoCols.map((col) => [headers[col] || "", get(row, col)] as [string, string]));
    const status = v166StatusFromRow(row, headers, statusCol, channelInfo);
    const leak = v166Pick(row, leakCol);
    const whitelist = v166Pick(row, whitelistCol);

    if (!collectFee && !payoutFee && !explicitTotalFee && !collectSingleFee && !payoutSingleFee && !collectLimit && !payoutLimit && !status && !platformCols.length) continue;

    const rateRow: ThirdPartyRateRow = {
      id: `${sheetName}-v166-${r}-${thirdParty}-${category || "all"}`,
      sheetName,
      country: rowCountry,
      category,
      thirdParty,
      collectFee,
      payoutFee,
      totalFee: inferTotalFee(collectFee, payoutFee, explicitTotalFee),
      collectSingleFee,
      payoutSingleFee,
      collectLimit,
      payoutLimit,
      channelInfo: channelInfo || "Google费率表直读",
      leak,
      whitelist,
      status,
      sourceRow: r + 1
    };
    rates.push(rateRow);
    v166AddAliases(rates, rateRow, row, nameCols, rowCountry);

    for (const pc of platformCols) {
      const rawStatus = get(row, pc.col);
      const platformStatus = normalizeStatus(rawStatus);
      if (!platformStatus) continue;
      statuses.push({
        id: `${sheetName}-v166-status-${r}-${pc.col}`,
        sheetName,
        country: rowCountry,
        platform: pc.platform,
        thirdParty,
        status: platformStatus,
        rawStatus,
        collectFee: rateRow.collectFee,
        payoutFee: rateRow.payoutFee,
        totalFee: rateRow.totalFee,
        collectSingleFee: rateRow.collectSingleFee,
        payoutSingleFee: rateRow.payoutSingleFee,
        collectLimit: rateRow.collectLimit,
        payoutLimit: rateRow.payoutLimit,
        category: rateRow.category,
        sourceRow: r + 1,
        sourceColumn: pc.col + 1
      });
    }
  }

  return { rates, statuses };
}

function clearStatusFeeFields(row: ThirdPartyPlatformStatusRow): ThirdPartyPlatformStatusRow {
  // 费率表同一页通常既有“费率行”，又有右侧盘口接入状态矩阵。
  // 有 direct Google 表头可读时，费率必须以 direct 读取为准；状态行只保留接入状态，手续费后面由 direct 费率回填。
  return {
    ...row,
    collectFee: "",
    payoutFee: "",
    totalFee: "",
    collectSingleFee: "",
    payoutSingleFee: "",
    collectLimit: "",
    payoutLimit: ""
  };
}

export function applyConfirmedRateRules(
  rateRows: ThirdPartyRateRow[],
  statusRows: ThirdPartyPlatformStatusRow[]
): { rates: ThirdPartyRateRow[]; statuses: ThirdPartyPlatformStatusRow[] } {
  // Google 费率表仍是唯一费率来源；这里只处理用户已确认的类型别名，不写死任何费率数值。
  const rates = [...rateRows];
  const hasMexicoStarpagoClabe = rates.some((row) =>
    normalizeCell(row.country) === "墨西哥" &&
    canonicalThirdPartyName(row.thirdParty, row.country) === "STARPAGO" &&
    normalizeCell(row.category).toUpperCase() === "CLABE"
  );

  // 用户确认：墨西哥业务量中的 STARPAGO/CLABE 对应费率表的 STARPAGO/SPEI。
  // 复制源行的实时费率作为 CLABE 类型别名，Google 表变更后会随下一次同步自动更新。
  if (!hasMexicoStarpagoClabe) {
    const source = rates.find((row) =>
      normalizeCell(row.country) === "墨西哥" &&
      canonicalThirdPartyName(row.thirdParty, row.country) === "STARPAGO" &&
      normalizeCell(row.category).toUpperCase() === "SPEI"
    );
    if (source) {
      rates.push({
        ...source,
        id: `${source.id}-confirmed-clabe`,
        category: "CLABE",
        channelInfo: `${source.channelInfo || "Google费率表直读"} / 已确认 STARPAGO SPEI=CLABE`
      });
    }
  }

  return { rates, statuses: statusRows };
}

export function buildThirdPartyRatePayload(sheetValues: Record<string, Values>): ThirdPartyRatePayload {
  const allRates: ThirdPartyRateRow[] = [];
  const allStatuses: ThirdPartyPlatformStatusRow[] = [];
  const sheets = Object.keys(sheetValues).filter(Boolean);

  for (const sheetName of sheets) {
    const values = sheetValues[sheetName] || [];

    // 用户确认：印度原始这个不要参与展示和匹配；印度线下表才是印度费率来源。
    if (normalizeCell(sheetName).includes("印度原始") || normalizeCell(sheetName).includes("印度原生")) continue;

    // V166：优先使用全局统一直读解析器，直接按 Google 费率表字段输出。
    // 这样不是只修某一个国家，而是所有费率页签都用同一套字段规则；如果没有命中，才回退旧解析。
    const unifiedParsed = v166ParseUnifiedRateSheet(sheetName, values);
    if (unifiedParsed.rates.length || unifiedParsed.statuses.length) {
      allRates.push(...unifiedParsed.rates);
      allStatuses.push(...unifiedParsed.statuses);
      continue;
    }

    const directParsed = parseDirectGoogleRateSheet(sheetName, values);
    const hasDirectRates = directParsed.rates.length > 0;
    const countryParsed = parseCountryRateSheet(sheetName, values);
    const platformParsed = parsePlatformMatrixSheet(sheetName, values);

    if (hasDirectRates) {
      allRates.push(...directParsed.rates);
      allStatuses.push(...countryParsed.statuses.map(clearStatusFeeFields));
      allStatuses.push(...platformParsed.statuses.map(clearStatusFeeFields));
      allStatuses.push(...directParsed.statuses.map(clearStatusFeeFields));
      continue;
    }

    if (countryParsed.rates.length || countryParsed.statuses.length) {
      allRates.push(...countryParsed.rates);
      allStatuses.push(...countryParsed.statuses);
    }

    if (platformParsed.rates.length || platformParsed.statuses.length) {
      allRates.push(...platformParsed.rates);
      allStatuses.push(...platformParsed.statuses);
    }

    if (directParsed.rates.length || directParsed.statuses.length) {
      allRates.push(...directParsed.rates);
      allStatuses.push(...directParsed.statuses);
    }
  }

  const visibleRates = allRates.filter((row) => !row.country.includes("埃及") && !row.sheetName.includes("埃及"));
  const visibleStatuses = allStatuses.filter((row) => !row.country.includes("埃及") && !row.sheetName.includes("埃及"));

  const dedupedRates = dedupeRows(visibleRates);
  const dedupedStatuses = dedupeRows(visibleStatuses);
  const filled = fillMissingFeeData(dedupedRates, dedupedStatuses);
  const confirmed = applyConfirmedRateRules(filled.rates, filled.statuses);

  const rates = confirmed.rates.sort((a, b) => compareCountryForSort(a.country, b.country) || a.thirdParty.localeCompare(b.thirdParty, "zh-CN"));
  const platformStatuses = confirmed.statuses.sort((a, b) => {
    return compareCountryForSort(a.country, b.country) || a.platform.localeCompare(b.platform, "zh-CN") || statusScore(a.status) - statusScore(b.status) || a.thirdParty.localeCompare(b.thirdParty, "zh-CN");
  });

  return {
    meta: {
      year: String(new Date().getFullYear()),
      month: String(new Date().getMonth() + 1),
      updatedAt: new Date().toISOString(),
      source: "google-sheet",
      sheets,
      parserVersion: "v234-fee-match"
    } as any,
    summary: summarizeStatuses(platformStatuses),
    rates,
    platformStatuses,
    anomalies: buildAnomalies(rates, platformStatuses)
  };
}
