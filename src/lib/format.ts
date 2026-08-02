export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const raw = String(value)
    .replace(/,/g, "")
    .replace(/%/g, "")
    .replace(/笔/g, "")
    .trim();
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function toPercent(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;

  const raw = String(value).trim();
  const hasPercentSymbol = raw.includes("%");
  const n = toNumber(value);

  if (!Number.isFinite(n)) return fallback;

  // Google Sheet 里面的 0.82% 会被读取成字符串 "0.82%"。
  // 旧逻辑把 0.82 当成 82%，这里必须只要带 % 就除以 100。
  if (hasPercentSymbol) return n / 100;

  // 没有百分号时，兼容两种写法：
  // 99.18 代表 99.18%，0.9918 代表 99.18%。
  return n > 1 ? n / 100 : n;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value || 0));
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0.00%";
  return `${(value * 100).toFixed(2)}%`;
}

export function parseDurationToSeconds(value: unknown): number {
  const s = String(value || "").trim();
  if (!s) return 0;

  const hour = matchNum(s, /(\d+(?:\.\d+)?)\s*(?:时|小时|h)/i);
  const minute = matchNum(s, /(\d+(?:\.\d+)?)\s*(?:分|分钟|m)/i);
  const second = matchNum(s, /(\d+(?:\.\d+)?)\s*(?:秒|s)/i);

  if (hour || minute || second) {
    return Math.round(hour * 3600 + minute * 60 + second);
  }

  const n = toNumber(s);
  return Number.isFinite(n) ? n : 0;
}

function matchNum(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? Number(m[1]) || 0 : 0;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0秒";
  const sec = Math.round(seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}时${m}分${s}秒`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

export function normalizeCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferCountryFromSheet(sheetName: string): string {
  const name = sheetName.replace(/盘口/g, "").trim();
  if (name.includes("印度")) return "印度";
  if (name.includes("南美")) return "南美";
  if (name.includes("巴基斯坦")) return "巴基斯坦";
  if (name.includes("胖虎巴西")) return "胖虎巴西";
  if (name.includes("巴西")) return "巴西";
  if (name.includes("越南")) return "越南";
  if (name.includes("印尼")) return "印尼";
  if (name.includes("马来")) return "马来";
  if (name.includes("缅甸")) return "缅甸";
  if (name.includes("菲律宾")) return "菲律宾";
  return name || sheetName;
}
