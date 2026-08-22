import type { ThirdPartyVolumePayload, ThirdPartyVolumeRow } from "./types";
import { normalizeCell, toNumber } from "./format";
import { canonicalThirdPartyName, inferThirdPartyChannelType, isIgnoredThirdPartyText, isLikelyThirdPartyCodeOnly } from "./thirdPartyNameMap";

type Values = string[][];

type Block = {
  headerRow: number;
  startCol: number;
  endCol: number;
  title: string;
  dateCol: number;
  systemCol: number;
  countryCol: number;
  platformCol: number;
  typeCol: number;
  thirdPartyCol: number;
  mapCodeCol: number;
  amountCol: number;
  countCol: number;
  updatedAtCol: number;
  successCol: number;
  failedCol: number;
  statusCol: number;
};

function get(row: string[] | undefined, index: number): string {
  if (!row || index < 0) return "";
  return normalizeCell(row[index]);
}

function norm(value: string): string {
  return normalizeCell(value).replace(/[\s　:：_\-\/\\（）()【】\[\]#]/g, "").toLowerCase();
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseDate(value: string): string {
  const raw = normalizeCell(value);
  if (!raw) return "";
  const serial = Number(raw);
  if (Number.isFinite(serial) && serial > 30000 && serial < 80000) {
    const base = Date.UTC(1899, 11, 30);
    const d = new Date(base + serial * 86400000);
    return d.toISOString().slice(0, 10);
  }
  let m = raw.match(/(20\d{2})\s*[年\-\/.]\s*(\d{1,2})\s*[月\-\/.]\s*(\d{1,2})\s*(?:日)?/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = raw.match(/(20\d{2})[\-\/\.](\d{1,2})[\-\/\.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return "";
}

function countryFromText(text: string): string {
  const value = normalizeCell(text);
  if (value.includes("胖虎巴西")) return "胖虎巴西";
  if (value.includes("巴基斯坦")) return "巴基斯坦";
  if (value.includes("菲律宾")) return "菲律宾";
  if (value.includes("尼日利亚")) return "尼日利亚";
  if (value.includes("哥伦比亚") || /colombia/i.test(value)) return "哥伦比亚";
  if (value.includes("墨西哥") || /mexico/i.test(value)) return "墨西哥";
  if (value.includes("智利") || /chile/i.test(value)) return "智利";
  if (value.includes("印度")) return "印度";
  if (value.includes("南美")) return "南美";
  if (value.includes("巴西")) return "巴西";
  if (value.includes("越南")) return "越南";
  if (value.includes("印尼")) return "印尼";
  if (value.includes("缅甸")) return "缅甸";
  if (value.includes("马来")) return "马来";
  if (value.includes("埃及")) return "埃及";
  return value || "";
}


function southAmericaCountryFromText(text: string): "哥伦比亚" | "墨西哥" | "智利" | "" {
  const value = normalizeCell(text).toLowerCase();
  if (!value) return "";
  // 南美盘口常见缩写：NPG-ME/MEX/MX=墨西哥，NPG-CO/COL/CO66=哥伦比亚，NPG-CL/CHL/CHILE=智利。
  if (value.includes("哥伦比亚") || /\bcolombia\b|\bcolombian\b|\bcol\b|\bnpg[-_\s]*(co|col)\b|\bco66\b/.test(value)) return "哥伦比亚";
  if (value.includes("墨西哥") || /\bmexico\b|\bmexican\b|\bmex\b|\bnpg[-_\s]*(me|mex|mx)\b|\bmx\b/.test(value)) return "墨西哥";
  if (value.includes("智利") || /\bchile\b|\bchl\b|\bnpg[-_\s]*(cl|chl|chi)\b|\bcl\b/.test(value)) return "智利";
  return "";
}
function normalizeSouthAmericaRow(country: string, platform: string, system: string, sheetName: string, title: string, typeText: string): { country: string; platform: string } {
  const combined = `${country} ${platform} ${system} ${sheetName} ${title} ${typeText}`;
  const detected = southAmericaCountryFromText(combined);
  if (!detected) return { country, platform };

  const isSouthAmericaBucket = country === "南美" || /南美|south\s*america|latam|拉美/i.test(combined) || ["哥伦比亚", "墨西哥", "智利"].includes(country);
  if (!isSouthAmericaBucket) return { country, platform };

  const platformByCountry: Record<string, string> = {
    哥伦比亚: "NPG哥伦比亚盘口",
    墨西哥: "NPG墨西哥盘口",
    智利: "NPG智利盘口"
  };
  return { country: detected, platform: platformByCountry[detected] || platform };
}


function normalizeSpecialPlatformCountry(country: string, platform: string, sheetName: string, title: string, system: string): string {
  const text = `${platform} ${sheetName} ${title} ${system}`.toLowerCase();
  // 234T 是胖虎巴西盘口，不能混到普通巴西盘口。
  if (/\b234\s*t\b|234t|胖虎巴西/.test(text)) return "胖虎巴西";
  return country;
}

function normalizeSouthAmericaChannelType(country: string, mapCode: string, typeText: string, rawChannel: string, channel: string): string {
  const c = countryFromText(country);
  const primary = normalizeCell(mapCode || typeText);
  const text = `${primary} ${mapCode} ${typeText} ${rawChannel} ${channel}`
    .toLowerCase()
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[\s_：:]+/g, "-");

  if (c === "墨西哥") {
    if (/spei/.test(text)) return "SPEI";
    if (/clabe/.test(text)) return "CLABE";
    if (/oxxo/.test(text)) return "OXXO";
    if (/codi/.test(text)) return "CoDi";
    if (/cash|efectivo/.test(text)) return "Cash";
    if (/bank-card|bankcard|bank|card|tarjeta/.test(text)) return "Bank Card";
  }

  if (c === "哥伦比亚") {
    if (/bre[-_]?key|brekey/.test(text)) return "BRE-KEY";
    if (/bre[-_]?b|breb/.test(text)) return "BRE-B";
    if (/nequi/.test(text)) return "Nequi";
    if (/pse/.test(text)) return "PSE";
    if (/transfiya/.test(text)) return "Transfiya";
    if (/bank|banco/.test(text)) return "Bank";
    if (/cash|efectivo/.test(text)) return "Cash";
  }

  if (c === "智利") {
    if (/webpay|card|tarjeta/.test(text)) return "Card(Webpay)";
    if (/khipu|bank|banco/.test(text)) return "Bank(Khipu)";
    if (/mach|e[-_ ]?wallet|ewallet|wallet/.test(text)) return "E-Wallet(Mach)";
    if (/pago46|cash|efectivo/.test(text)) return "Cash(Pago46)";
  }

  return "";
}

function findRelativeIndex(headers: string[], startCol: number, endCol: number, names: string[]): number {
  const wanted = names.map(norm);
  for (let c = startCol; c <= endCol; c++) {
    const x = norm(headers[c] || "");
    if (!x) continue;
    if (wanted.some((w) => x === w || x.includes(w) || w.includes(x))) return c;
  }
  return -1;
}

function findBlockTitle(values: Values, headerRow: number, startCol: number, endCol: number): string {
  for (let r = headerRow - 1; r >= Math.max(0, headerRow - 4); r--) {
    const row = values[r] || [];
    const pieces: string[] = [];
    for (let c = startCol; c <= endCol; c++) {
      const v = get(row, c);
      if (v) pieces.push(v);
    }
    const text = pieces.join(" ");
    if (/\d{4}[-年]?\d{1,2}|代收|代付|菲律宾|南美|哥伦比亚|墨西哥|智利|COLOMBIA|MEXICO|CHILE|印度|巴西|巴基斯坦|尼日利亚|马来|缅甸|越南|印尼/i.test(text)) return text;
  }
  return "";
}

function inferDirection(sheetName: string, title: string, typeText: string): "代收" | "代付" {
  const all = `${sheetName} ${title} ${typeText}`;
  if (/提现|出款|代付|withdraw|payout/i.test(all)) return "代付";
  return "代收";
}

function normalizeChannel(value: string, country?: string): string {
  return canonicalThirdPartyName(value, country);
}

function isCoinvidUsdtVolume(country: string, platform: string, rawChannel: string, sheetName: string, title: string, system: string): boolean {
  const text = `${country} ${platform} ${rawChannel} ${sheetName} ${title} ${system}`.toLowerCase();
  const channelKey = normalizeCell(rawChannel).replace(/[^a-z0-9]+/gi, "").toLowerCase();
  return country.includes("越南") && /coinvid/.test(text) && (channelKey === "usdt" || /(^|[^a-z0-9])usdt([^a-z0-9]|$)/i.test(rawChannel));
}

function isPH19Text(value: string): boolean {
  const text = normalizeCell(value).toLowerCase();
  return /(^|[^a-z0-9])ph\s*[-_]?\s*19([^a-z0-9]|$)|菲律宾\s*19|菲\s*19/.test(text);
}

function normalizePhilippinesPH19Type(text: string, direction: "代收" | "代付"): string {
  const raw = normalizeCell(text).toLowerCase().replace(/（/g, "(").replace(/）/g, ")");
  const compact = raw.replace(/[^a-z0-9一-龥]+/g, "");
  if (/gcash/.test(raw) || compact.includes("gcash")) return "GCASH";
  if (/pay\s*maya|paymaya|\bmaya\b/.test(raw) || compact.includes("paymaya")) return "PAYMAYA";
  if (/go\s*tyme|gotyme/.test(raw) || compact.includes("gotyme")) return "GOTYME";
  if (/grab\s*pay|grabpay/.test(raw) || compact.includes("grabpay")) return "GRABPAY";
  if (/bank|银行|银行卡|bankcard/.test(raw)) return direction === "代付" ? "银行代付" : "BANK";
  return "";
}

function normalizeVolumeChannelType(country: string, platform: string, rawChannel: string, channel: string, typeText: string, mapCode: string, system: string, title: string, sheetName: string, direction: "代收" | "代付"): string {
  const text = `${platform} ${rawChannel} ${channel} ${typeText} ${mapCode} ${system} ${title} ${sheetName}`.toLowerCase();
  const southAmericaType = normalizeSouthAmericaChannelType(country, mapCode, typeText, rawChannel, channel);
  if (southAmericaType) return southAmericaType;
  // V7O：Arb-UPI / Arb-BANK 是 UPI-QR 的代付别名；类型也必须按 UPI 匹配费率，不能因为名字里有 BANK 就误归“银行卡”。
  const indiaRawKey = normalizeCell(rawChannel).toLowerCase().replace(/[^a-z0-9一-龥]+/g, "");
  if (country.includes("印度") && direction === "代付" && ["arbupi", "arbbank", "upiqr"].includes(indiaRawKey)) return "UPI";

  // 用户确认：越南 MegiPay/EPay 以及普通 FASTPAY/FASTPAY-QR/FastPay(VND) 都是 BANKQR。
  const vietnamRawKey = normalizeCell(rawChannel).toLowerCase().replace(/[^a-z0-9一-龥]+/g, "");
  if (
    country.includes("越南") &&
    /^(fast|fastpay|fastqr|fastpayqr|fastpayvnd|fastpayvndqr|epay|megipay|epaymegi|epaymegipay)$/.test(vietnamRawKey) &&
    !/momo|zalo|viettel|thẻ|thecao|thẻcào/.test(text)
  ) return "BANKQR";

  const inferred = inferThirdPartyChannelType(rawChannel, country, `${platform} ${channel} ${typeText} ${mapCode} ${system} ${title} ${sheetName}`);

  if (country.includes("巴西")) return "PIX";

  if (country.includes("马来")) {
    if (/telcom|telco|telkom/.test(text)) return "Telcom";
    // 用户确认：马来代收 Touch n Go-TP 归 DuitNow/QR；代付 Tng-DuitNow-TP / 其他代付统一归银行。
    if (direction === "代付") return "银行";
    if (/tng|touch\s*n\s*go|touchngo|touch go|duitnow|duit-now|fpxduitnow|qr|maybankqr/.test(text)) return "DUITNOW/QR";
    if (/shopee|grab|boost/.test(text)) return "Shopee/Grab/Boost";
    if (/fpx|bank|maybank|cimb|rhb|publicbank|ambank|hongleong/.test(text)) return "FPX-BANK";
  }

  if (country.includes("印尼")) {
    // 印尼必须先识别具体钱包，不能把 OVO / DANA / LINKAJA / GOPAY 扔到“其他类型”或统一“钱包代付”。
    // 例：OVO-safe2pay、DANA-safe2pay 要分别显示 OVO、DANA，并各自匹配自己的费率。
    const rawTypeText = `${rawChannel} ${mapCode} ${typeText} ${channel}`.toLowerCase()
      .replace(/（/g, "(")
      .replace(/）/g, ")")
      .replace(/[\s_：:]+/g, "-");
    if (/qris|qr-is/.test(rawTypeText)) return "QRIS";
    if (/link\s*aja|link-aja|linkaja/.test(rawTypeText)) return "LINKAJA";
    if (/\bdana\b|(^|[-~_\s])dana([-~_\s]|$)/.test(rawTypeText)) return "DANA";
    if (/\bovo\b|(^|[-~_\s])ovo([-~_\s]|$)/.test(rawTypeText)) return "OVO";
    if (/go\s*pay|go-pay|gopay|gojek/.test(rawTypeText)) return "GOPAY";
    // B-Click2Pay / B~YerePay 这类是银行代付；E-Click2Pay / E~YerePay 这类是泛钱包代付。
    if (direction === "代付" && /(^|[^a-z0-9])b\s*[~_\-\s]/i.test(`${rawChannel} ${mapCode}`)) return "银行代付";
    if (direction === "代付" && /(^|[^a-z0-9])e\s*[~_\-\s]/i.test(`${rawChannel} ${mapCode}`)) return "钱包代付";
    if (/virtual|\bva\b|-va|bni|bri|mandiri|permata|bca|cimb|bank|brin|cena|bmri/.test(rawTypeText)) return direction === "代付" ? "银行代付" : "Virtual Account";
    if (direction === "代付" && (!inferred || inferred === "其他类型")) return "银行代付";
  }

  if (country.includes("菲律宾")) {
    // V110：PH19 已经在原始表里写入 payTypeSubName / PAYTYPE（例如 GCash、Maya、Bank）。
    // 只有 PH19 按钱包/银行分类；其他菲律宾盘口仍保持旧逻辑：代付统一显示「代付」，避免影响旧数据。
    if (isPH19Text(`${platform} ${system} ${title} ${sheetName}`)) {
      const ph19Type = normalizePhilippinesPH19Type(text, direction);
      if (ph19Type) return ph19Type;
      if (inferred && !["其他类型", "其他钱包", "代付"].includes(inferred)) return inferred;
    }
    if (direction === "代付") return "代付";
  }

  if (country.includes("尼日利亚")) {
    if (/usdt|tron|trc20/.test(text)) return "USDT";
    return "银行";
  }

  if (country.includes("越南")) {
    if (/momo|mo-mo|ví\s*momo|vi\s*momo/.test(text)) return "MOMO";
    if (/the\s*cao|thẻ|cào|cao|card|napthe/.test(text)) return "THẺ CÀO";
    if (/bank|vnbank|ngan|ngân/.test(text)) return "银行";
  }

  return inferred;
}

function findBlocks(sheetName: string, values: Values): Block[] {
  const blocks: Block[] = [];
  const seen = new Set<string>();

  for (let r = 0; r < Math.min(values.length, 200); r++) {
    const headers = values[r] || [];
    const dateCols: number[] = [];

    for (let c = 0; c < headers.length; c++) {
      const h = norm(get(headers, c));
      if (h === "日期" || h === "date" || h === "statdate" || h === "统计日期") dateCols.push(c);
    }

    if (!dateCols.length) continue;

    for (let i = 0; i < dateCols.length; i++) {
      const startCol = dateCols[i];
      const endCol = i + 1 < dateCols.length ? dateCols[i + 1] - 1 : Math.min(headers.length - 1, startCol + 18);
      const platformCol = findRelativeIndex(headers, startCol, endCol, ["平台", "盘口", "platform"]);
      const amountCol = findRelativeIndex(headers, startCol, endCol, ["金额", "amount", "total_amount", "success_amount", "订单金额", "到账金额", "总金额"]);
      const countCol = findRelativeIndex(headers, startCol, endCol, ["笔数", "count", "total_count", "订单数", "数量"]);
      if (platformCol < 0 || (amountCol < 0 && countCol < 0)) continue;

      const title = findBlockTitle(values, r, startCol, endCol);
      const key = `${r}-${startCol}-${endCol}`;
      if (seen.has(key)) continue;
      seen.add(key);

      blocks.push({
        headerRow: r,
        startCol,
        endCol,
        title,
        dateCol: startCol,
        systemCol: findRelativeIndex(headers, startCol, endCol, ["system", "系统"]),
        countryCol: findRelativeIndex(headers, startCol, endCol, ["国家", "country", "地区"]),
        platformCol,
        typeCol: findRelativeIndex(headers, startCol, endCol, ["类型", "direction", "业务类型"]),
        thirdPartyCol: findRelativeIndex(headers, startCol, endCol, ["三方", "三方名称", "通道", "支付名称", "third_party", "channel", "pay_channel"]),
        mapCodeCol: findRelativeIndex(headers, startCol, endCol, ["映射码", "映射", "mapping", "map_code", "代码"]),
        amountCol,
        countCol,
        updatedAtCol: findRelativeIndex(headers, startCol, endCol, ["更新时间", "updated_at", "update_time"]),
        successCol: findRelativeIndex(headers, startCol, endCol, ["成功笔数", "success_count", "成功"]),
        failedCol: findRelativeIndex(headers, startCol, endCol, ["失败笔数", "failed_count", "reject_count", "失败", "驳回"]),
        statusCol: findRelativeIndex(headers, startCol, endCol, ["状态", "status"])
      });
    }
  }

  return blocks;
}

function isManualHandlingChannel(value: string): boolean {
  const key = normalizeCell(value).replace(/[\s　_-]+/g, "");
  return key === "人工确认" || key === "人工充值";
}

function manualThirdPartyOverride(country: string, platform: string, rawChannel: string, direction: "代收" | "代付"): string {
  const c = countryFromText(country);
  const p = normalizeCell(platform).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const k = normalizeCell(rawChannel).toLowerCase().replace(/[^a-z0-9一-龥]+/g, "");
  if (c.includes("印度")) {
    // V7O：用户再次确认 DHANIWIN 的 Arb-UPI / Arb-BANK 都是 UPI-QR 代付，绝不能算进“人工确认”。
    // 只有原始名称真的就是 UPI（没有三方名）时，DHANIWIN 才继续按人工确认；LOCAL BANK / BankCard 规则不变。
    if (direction === "代付" && (k === "arbupi" || k === "arbbank" || k === "upiqr")) return "UPI-QR";
    if (k === "upiqr2") return "ATPay";
    if (p === "DHANIWIN" && direction === "代付" && k === "upi") return "人工确认";
    if (k === "manualrecharge" || k === "人工充值") return "人工充值";
    if (direction === "代付" && (k === "localbank" || k === "bankcard")) return "人工确认";
  }
  if (c.includes("越南")) {
    if (k === "yespay" || k === "yespayqr") return "YesPay";
  }
  return "";
}

function parseSheet(sheetName: string, values: Values): ThirdPartyVolumeRow[] {
  const rows: ThirdPartyVolumeRow[] = [];
  const blocks = findBlocks(sheetName, values);

  for (const block of blocks) {
    const headers = values[block.headerRow] || [];
    let blankStreak = 0;

    for (let rr = block.headerRow + 1; rr < values.length; rr++) {
      const row = values[rr] || [];
      const date = parseDate(get(row, block.dateCol));
      let platform = get(row, block.platformCol);
      const amount = block.amountCol >= 0 ? toNumber(get(row, block.amountCol)) : 0;
      const count = block.countCol >= 0 ? toNumber(get(row, block.countCol)) : 0;

      const rowHasAny = row.slice(block.startCol, Math.min(block.endCol + 1, row.length)).some((cell) => !!normalizeCell(cell));
      if (!rowHasAny) {
        blankStreak += 1;
        // V190：不同国家的横向区块数据起始行不完全一样，80 行太容易提前断开，导致后面的国家漏读。
        // 这里放大到 1500 行；仍然会在连续空白很长时停止，避免整列扫到 60000 行。
        if (blankStreak >= 1500) break;
        continue;
      }
      blankStreak = 0;

      if (!date || !platform) continue;
      if (count <= 0 && amount <= 0) continue;

      let country = block.countryCol >= 0 ? countryFromText(get(row, block.countryCol)) : countryFromText(block.title || sheetName);
      const typeText = block.typeCol >= 0 ? get(row, block.typeCol) : "";
      const mapCode = block.mapCodeCol >= 0 ? get(row, block.mapCodeCol) : "";
      const thirdParty = block.thirdPartyCol >= 0 ? get(row, block.thirdPartyCol) : "";
      const system = block.systemCol >= 0 ? get(row, block.systemCol) : "";
      const southAmericaNormalized = normalizeSouthAmericaRow(country, platform, system, sheetName, block.title, typeText);
      country = southAmericaNormalized.country;
      platform = southAmericaNormalized.platform;
      country = normalizeSpecialPlatformCountry(country, platform, sheetName, block.title, system);
      const statusText = block.statusCol >= 0 ? get(row, block.statusCol) : "";
      if (/商户余额不足|余额不足/.test(statusText)) continue;
      // 三方量必须优先使用“三方/通道名称”，不要优先用“映射码”。很多映射码是 hash/数字，会把别名识别搞乱。
      // “人工确认/人工充值”是业务处理通道，不是第三方支付商，但用户要求在三方量里正常保留显示。
      // 其它错误文本仍继续过滤，避免把状态、报错文字误当成三方。
      const validThirdParty = thirdParty && (isManualHandlingChannel(thirdParty) || (!isIgnoredThirdPartyText(thirdParty) && !isLikelyThirdPartyCodeOnly(thirdParty))) ? thirdParty : "";
      const validMapCode = mapCode && (isManualHandlingChannel(mapCode) || (!isIgnoredThirdPartyText(mapCode) && !isLikelyThirdPartyCodeOnly(mapCode))) ? mapCode : "";
      const rawChannel = validThirdParty || validMapCode;
      if (!rawChannel) continue;
      const direction = inferDirection(sheetName, block.title, typeText);
      let channel = isManualHandlingChannel(rawChannel)
        ? normalizeCell(rawChannel).replace(/[\s　_-]+/g, "")
        : manualThirdPartyOverride(country, platform, rawChannel, direction) || normalizeChannel(rawChannel, country);
      if (isCoinvidUsdtVolume(country, platform, rawChannel, sheetName, block.title, system)) channel = "Coinvid USDT";
      if (!channel || channel === "未知三方" || (!isManualHandlingChannel(channel) && isIgnoredThirdPartyText(channel))) continue;
      let channelType = normalizeVolumeChannelType(country, platform, rawChannel, channel, typeText, mapCode, system, block.title, sheetName, direction);
      if (channel === "人工确认" || channel === "人工充值") channelType = channel;
      const successCount = block.successCol >= 0 ? toNumber(get(row, block.successCol)) : count;
      const failedCount = block.failedCol >= 0 ? toNumber(get(row, block.failedCol)) : Math.max(0, count - successCount);

      // 不把整行 raw 对象塞进快照，避免三方量跨多个月时 JSON 过大导致 Netlify 接口空白/超时。
      rows.push({
        id: `${sheetName}-${block.headerRow}-${rr}-${block.startCol}-${date}-${country}-${platform}-${rawChannel}`,
        sheetName,
        sourceRow: rr + 1,
        date,
        country: country || "未知国家",
        platform,
        channel,
        rawChannel,
        channelType,
        direction,
        amount,
        count,
        successCount,
        failedCount,
        successRate: count ? successCount / count : 0,
        status: block.statusCol >= 0 ? get(row, block.statusCol) : ""
      });
    }
  }

  return rows;
}

function summarize(rows: ThirdPartyVolumeRow[]) {
  return {
    rows: rows.length,
    amount: rows.reduce((s, r) => s + r.amount, 0),
    count: rows.reduce((s, r) => s + r.count, 0),
    successCount: rows.reduce((s, r) => s + r.successCount, 0),
    failedCount: rows.reduce((s, r) => s + r.failedCount, 0),
    countries: uniq(rows.map((r) => r.country)).length,
    platforms: uniq(rows.map((r) => r.platform)).length,
    channels: uniq(rows.map((r) => r.channel)).length
  };
}

function buildAliasMap(rows: ThirdPartyVolumeRow[]): Record<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = map.get(row.channel) || new Set<string>();
    if (row.rawChannel && row.rawChannel !== row.channel && !isIgnoredThirdPartyText(row.rawChannel) && !isLikelyThirdPartyCodeOnly(row.rawChannel)) set.add(row.rawChannel);
    map.set(row.channel, set);
  }
  return Object.fromEntries(Array.from(map.entries()).map(([key, set]) => [key, Array.from(set).sort()]));
}

function buildAnomalies(rows: ThirdPartyVolumeRow[]): string[] {
  const messages: string[] = [];
  const map = new Map<string, { count: number; success: number; amount: number }>();
  for (const row of rows) {
    const key = `${row.country} ${row.platform} ${row.channel} ${row.direction}`;
    const item = map.get(key) || { count: 0, success: 0, amount: 0 };
    item.count += row.count;
    item.success += row.successCount;
    item.amount += row.amount;
    map.set(key, item);
  }
  for (const [key, v] of Array.from(map.entries())) {
    if (v.count >= 20 && v.success / v.count < 0.9) messages.push(`${key}：成功率 ${((v.success / v.count) * 100).toFixed(2)}%，笔数 ${v.count}，金额 ${v.amount.toLocaleString("zh-CN")}`);
  }
  const aliasMap = buildAliasMap(rows);
  for (const [channel, aliases] of Object.entries(aliasMap)) {
    if (aliases.length >= 3) messages.push(`${channel}：识别到 ${aliases.length} 个别名（${aliases.slice(0, 5).join(" / ")}），建议统一命名。`);
  }
  return Array.from(new Set(messages)).slice(0, 100);
}



function compactVolumeRowId(key: string): string {
  // 两组 32-bit 稳定哈希拼接，避免数千条聚合行只用单个 32-bit key 时发生 React key 碰撞。
  let hash1 = 2166136261;
  let hash2 = 2246822519;
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    hash1 ^= code;
    hash1 = Math.imul(hash1, 16777619);
    hash2 ^= code + i;
    hash2 = Math.imul(hash2, 3266489917);
  }
  return `tpv-${(hash1 >>> 0).toString(36)}-${(hash2 >>> 0).toString(36)}`;
}

function compactThirdPartyVolumeRows(rows: ThirdPartyVolumeRow[]): ThirdPartyVolumeRow[] {
  // 三方 RAW 表可能有 5 万+ 行，但页面实际只按 日期/国家/平台/三方/类型/方向 汇总。
  // 同一读取分片内先聚合，可把快照从数万行压到几千行，显著减少 Netlify Blobs 写入和 API 返回时间。
  // sheetName 保留精确分片范围，保证增量刷新时仍只替换本次成功读取的那一片。
  const map = new Map<string, ThirdPartyVolumeRow & { _statuses?: Set<string>; _rawChannels?: Set<string> }>();
  for (const row of rows) {
    const key = [
      row.sheetName,
      row.date,
      row.country,
      row.platform,
      row.channel,
      row.channelType || "",
      row.direction
    ].join("|||");
    const current = map.get(key);
    if (!current) {
      const statuses = new Set<string>();
      const rawChannels = new Set<string>();
      if (row.status) statuses.add(row.status);
      if (row.rawChannel) rawChannels.add(row.rawChannel);
      map.set(key, {
        ...row,
        id: compactVolumeRowId(key),
        _statuses: statuses,
        _rawChannels: rawChannels
      });
      continue;
    }
    current.amount += Number(row.amount) || 0;
    current.count += Number(row.count) || 0;
    current.successCount += Number(row.successCount) || 0;
    current.failedCount += Number(row.failedCount) || 0;
    current.sourceRow = Math.min(current.sourceRow || row.sourceRow, row.sourceRow || current.sourceRow);
    if (row.status) current._statuses?.add(row.status);
    if (row.rawChannel) current._rawChannels?.add(row.rawChannel);
  }

  return Array.from(map.values()).map((row) => {
    const statuses = Array.from(row._statuses || []).filter(Boolean);
    const { _statuses: _internalStatuses, _rawChannels: _internalRawChannels, ...clean } = row;
    return {
      ...clean,
      // 聚合后统一保存 canonical 名称；原始别名继续保存在 payload.aliasMap，避免 OX2PAY/OXPay 被拆成两行。
      rawChannel: clean.channel,
      status: statuses.slice(0, 4).join(" / "),
      successRate: clean.count ? clean.successCount / clean.count : 0
    };
  });
}


/**
 * V230 低流量客户端快照：跨来源页签再次按页面真正需要的维度聚合。
 *
 * 月快照内部可能保留不同 sheetName 的同一组数据，方便旧版做分片替换；
 * 但浏览器只需要 日期/国家/平台/主三方/类型/方向。去掉 sheetName 维度后，
 * API 返回体会小很多，同时金额、笔数、成功/失败笔数保持不变。
 */
export function compactThirdPartyVolumePayloadForDashboard(payload: ThirdPartyVolumePayload): ThirdPartyVolumePayload {
  const normalized = normalizeThirdPartyVolumePayload(payload);
  const map = new Map<string, ThirdPartyVolumeRow & { _sheets?: Set<string>; _statuses?: Set<string> }>();

  for (const row of normalized.rows || []) {
    const key = [
      row.date,
      row.country,
      row.platform,
      row.channel,
      row.channelType || "",
      row.direction
    ].join("|||");
    const amount = Number(row.amount) || 0;
    const count = Number(row.count) || 0;
    const successCount = Number(row.successCount) || 0;
    const failedCount = Number(row.failedCount) || 0;
    const current = map.get(key);
    if (!current) {
      const sheets = new Set<string>();
      const statuses = new Set<string>();
      if (row.sheetName) sheets.add(row.sheetName);
      if (row.status) statuses.add(row.status);
      map.set(key, {
        ...row,
        id: compactVolumeRowId(`dashboard|||${key}`),
        amount,
        count,
        successCount,
        failedCount,
        rawChannel: row.channel,
        raw: undefined,
        _sheets: sheets,
        _statuses: statuses
      });
      continue;
    }
    current.amount += amount;
    current.count += count;
    current.successCount += successCount;
    current.failedCount += failedCount;
    current.sourceRow = Math.min(current.sourceRow || row.sourceRow, row.sourceRow || current.sourceRow);
    if (row.sheetName) current._sheets?.add(row.sheetName);
    if (row.status) current._statuses?.add(row.status);
  }

  const rows = Array.from(map.values()).map((row) => {
    const sheets = Array.from(row._sheets || []).filter(Boolean);
    const statuses = Array.from(row._statuses || []).filter(Boolean);
    const { _sheets: _internalSheets, _statuses: _internalStatuses, ...clean } = row;
    return {
      ...clean,
      sheetName: sheets.length <= 2 ? sheets.join(" + ") : `月度聚合(${sheets.length}页签)`,
      status: statuses.slice(0, 4).join(" / "),
      rawChannel: clean.channel,
      successRate: clean.count ? clean.successCount / clean.count : 0,
      raw: undefined
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.country.localeCompare(b.country, "zh-CN") || a.platform.localeCompare(b.platform, "zh-CN"));

  const visibleChannels = new Set(rows.map((row) => row.channel).filter(Boolean));
  const aliasMap = Object.fromEntries(Object.entries(normalized.aliasMap || {})
    .filter(([channel]) => visibleChannels.has(channel))
    .map(([channel, aliases]) => [channel, Array.from(new Set(aliases || [])).slice(0, 30)]));

  return {
    ...normalized,
    meta: {
      ...normalized.meta,
      message: [
        normalized.meta?.message,
        `V230 客户端轻量快照：${normalized.rows.length} 行压缩为 ${rows.length} 行，金额与笔数口径不变`
      ].filter(Boolean).join("；")
    },
    rows,
    aliasMap,
    summary: summarize(rows),
    anomalies: buildAnomalies(rows)
  };
}


function dashboardDateAdd(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * V230 按页面选择的日期裁剪 API 返回体。
 * 日表额外保留开始日期的前一天，供“昨日代收/代付、环比”计算；
 * 没传日期时只返回最新日期和前一天，避免首次打开就下载整个月。
 */
export function sliceThirdPartyVolumePayloadForDashboard(
  payload: ThirdPartyVolumePayload,
  startDate = "",
  endDate = ""
): ThirdPartyVolumePayload {
  const compact = compactThirdPartyVolumePayloadForDashboard(payload);
  const allRows = compact.rows || [];
  if (!allRows.length) return compact;

  const dates = Array.from(new Set(allRows.map((row) => row.date).filter(Boolean))).sort();
  const latest = dates[dates.length - 1] || "";
  const visibleStart = startDate || latest;
  const visibleEnd = endDate || visibleStart || latest;
  const lookupStart = visibleStart ? dashboardDateAdd(visibleStart, -1) : visibleStart;
  const rows = allRows.filter((row) => {
    if (lookupStart && row.date < lookupStart) return false;
    if (visibleEnd && row.date > visibleEnd) return false;
    return true;
  });

  const visibleChannels = new Set(rows.map((row) => row.channel).filter(Boolean));
  const aliasMap = Object.fromEntries(Object.entries(compact.aliasMap || {})
    .filter(([channel]) => visibleChannels.has(channel))
    .map(([channel, aliases]) => [channel, Array.from(new Set(aliases || [])).slice(0, 30)]));

  return {
    ...compact,
    meta: {
      ...compact.meta,
      message: [
        compact.meta?.message,
        `V230 按日期下发：${lookupStart || "最早"} 至 ${visibleEnd || "最新"}，共 ${rows.length} 行`
      ].filter(Boolean).join("；")
    },
    rows,
    aliasMap,
    summary: summarize(rows),
    anomalies: buildAnomalies(rows)
  };
}


export function normalizeThirdPartyVolumePayload(payload: ThirdPartyVolumePayload): ThirdPartyVolumePayload {
  const sourceRows = payload?.rows || [];
  if (!sourceRows.length) return payload;

  const normalizedRows: ThirdPartyVolumeRow[] = sourceRows.map((row) => {
    const rawChannel = normalizeCell(row.rawChannel || row.channel || "");
    const keepManual = ["人工确认", "人工充值", "Coinvid USDT"].includes(row.channel || "");
    let channel = keepManual ? row.channel : manualThirdPartyOverride(row.country, row.platform, rawChannel || row.channel, row.direction) || canonicalThirdPartyName(rawChannel || row.channel, row.country);
    if (!channel || channel === "未知三方" || isIgnoredThirdPartyText(channel)) {
      channel = row.channel || rawChannel || "未知三方";
    }
    let channelType = row.channelType || inferThirdPartyChannelType(rawChannel || channel, row.country, `${channel} ${rawChannel}`) || "其他类型";
    if (channel === "人工确认" || channel === "人工充值") channelType = channel;
    return {
      ...row,
      channel,
      channelType
    };
  });

  const compactRows = compactThirdPartyVolumeRows(normalizedRows)
    .sort((a, b) => b.date.localeCompare(a.date) || a.country.localeCompare(b.country, "zh-CN") || a.platform.localeCompare(b.platform, "zh-CN"));

  const discoveredAliases = buildAliasMap(normalizedRows);
  const aliasMap: Record<string, string[]> = { ...(payload.aliasMap || {}) };
  for (const [channel, aliases] of Object.entries(discoveredAliases)) {
    aliasMap[channel] = Array.from(new Set([...(aliasMap[channel] || []), ...aliases])).sort();
  }

  return {
    ...payload,
    rows: compactRows,
    aliasMap,
    summary: summarize(compactRows),
    anomalies: buildAnomalies(compactRows)
  };
}

export function buildThirdPartyVolumePayload(sheetValues: Record<string, Values>): ThirdPartyVolumePayload {
  const allRows = Object.entries(sheetValues).flatMap(([sheetName, values]) => parseSheet(sheetName, values || [])).filter((row) => row.country !== "埃及" && !row.platform.includes("埃及") && !row.sheetName.includes("埃及"));
  const rowMap = new Map<string, ThirdPartyVolumeRow>();
  for (const row of allRows) if (!rowMap.has(row.id)) rowMap.set(row.id, row);
  const rows = Array.from(rowMap.values()).sort((a, b) => b.date.localeCompare(a.date) || a.country.localeCompare(b.country, "zh-CN") || a.platform.localeCompare(b.platform, "zh-CN"));
  return normalizeThirdPartyVolumePayload({
    meta: {
      year: rows[0]?.date?.slice(0, 4) || String(new Date().getFullYear()),
      month: rows[0]?.date ? String(Number(rows[0].date.slice(5, 7))) : String(new Date().getMonth() + 1),
      updatedAt: new Date().toISOString(),
      source: "google-sheet",
      sheets: Object.keys(sheetValues)
    },
    rows,
    aliasMap: buildAliasMap(rows),
    summary: summarize(rows),
    anomalies: buildAnomalies(rows)
  });
}
