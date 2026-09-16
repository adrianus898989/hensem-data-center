import { platformDisplayCountry } from "./platformDisplayCountry.ts";

const COUNTRIES: Record<string, string> = {
  IN: "印度", INDIA: "印度", 印度线下: "印度", 印度盘口: "印度", 印度线下盘口: "印度",
  BR: "巴西", PK: "巴基斯坦", ID: "印尼", VN: "越南", PH: "菲律宾", MY: "马来",
  MM: "缅甸", NG: "尼日利亚", CO: "哥伦比亚", MX: "墨西哥", CL: "智利",
  HK_TEAM: "香港", HONG_KONG: "香港", RED_CRAB: "红膏蟹", REDCRAB: "红膏蟹",
};

export function collectionSuccessCountry(country: string, platform = ""): string {
  const value = String(country || "").trim();
  return platformDisplayCountry(COUNTRIES[value.toUpperCase()] || COUNTRIES[value] || value, platform);
}

export function collectionSuccessPeriod(start: string, end: string) {
  const first = /^\d{4}-\d{2}-\d{2}$/.test(start) ? Date.parse(`${start}T00:00:00Z`) : NaN;
  const last = /^\d{4}-\d{2}-\d{2}$/.test(end) ? Date.parse(`${end}T00:00:00Z`) : NaN;
  const days = Number.isFinite(first) && Number.isFinite(last) ? Math.floor((last - first) / 86400000) + 1 : 0;
  if (days < 1 || days > 366) return null;
  const iso = (value: number) => new Date(value).toISOString().slice(0, 10);
  return {start, end, previousStart: iso(first - days * 86400000), previousEnd: iso(first - 86400000),
    currentDates: Array.from({length: days}, (_, i) => iso(first + i * 86400000)),
    previousDates: Array.from({length: days}, (_, i) => iso(first + (i - days) * 86400000)),
    comparisonLabel: days === 1 ? "较昨日" : "较上期"};
}
