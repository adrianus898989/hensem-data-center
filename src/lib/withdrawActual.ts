import type { ThirdPartyVolumeRow, WithdrawActualRow } from "./types";
import { canonicalThirdPartyName } from "./thirdPartyNameMap";
import { canonicalThirdPartyPlatform } from "./thirdPartyPlatform";
import { platformDisplayCountry } from "./platformDisplayCountry";

const DAY = 86400000;
const COUNTRY_CODES: Record<string, string> = {
  IN: "印度", INDIA: "印度", "3": "印度", 印度线下: "印度", 印度盘口: "印度",
  PK: "巴基斯坦", BR: "巴西", ID: "印尼", VN: "越南", PH: "菲律宾", MY: "马来",
  MM: "缅甸", NG: "尼日利亚", CO: "哥伦比亚", MX: "墨西哥", CL: "智利",
};

export function withdrawActualCountry(country: string, platform = ""): string {
  const value = String(country || "").trim();
  return platformDisplayCountry(COUNTRY_CODES[value.toUpperCase()] || COUNTRY_CODES[value] || value, platform);
}

function providerKey(country: string, channel: string): string {
  const displayCountry = withdrawActualCountry(country);
  return `${displayCountry}\u001f${canonicalThirdPartyName(channel, displayCountry)}`;
}

function platformKey(country: string, platform: string): string {
  return canonicalThirdPartyPlatform(country, platform).trim().toUpperCase();
}

function validDate(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function period(start: string, end: string) {
  if (!validDate(start) || !validDate(end)) return null;
  const first = Date.parse(`${start}T00:00:00Z`), last = Date.parse(`${end}T00:00:00Z`);
  const days = Math.floor((last - first) / DAY) + 1;
  if (days < 1 || days > 366) return null;
  const iso = (value: number) => new Date(value).toISOString().slice(0, 10);
  return {
    start, end,
    previousStart: iso(first - days * DAY),
    previousEnd: iso(first - DAY),
    currentDates: Array.from({ length: days }, (_, index) => iso(first + index * DAY)),
    previousDates: Array.from({ length: days }, (_, index) => iso(first + (index - days) * DAY)),
  };
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export type WithdrawActualMetric = {
  requestedAmount: number;
  actualAmount: number;
  feeAmount: number;
  orderCount: number;
  expected: number;
  captured: number;
  state: "complete" | "partial" | "missing" | "zero" | "unavailable";
};

export type WithdrawActualView = {
  providers: Array<{ key: string; country: string; channel: string; requestedAmount: number; actualAmount: number; feeAmount: number; orderCount: number }>;
  compare: (providerKeys?: readonly string[]) => { current: WithdrawActualMetric; previous: WithdrawActualMetric };
  error?: string;
};

export function buildWithdrawActualView(input: {
  rows: readonly WithdrawActualRow[];
  volumeRows: readonly ThirdPartyVolumeRow[];
  start: string;
  end: string;
  country: string;
  platforms?: readonly string[];
  provider?: string;
  error?: string;
}): WithdrawActualView {
  const range = period(input.start, input.end);
  const requestedCountry = withdrawActualCountry(input.country);
  const selectedPlatforms = new Set((input.platforms || []).map(value => platformKey(requestedCountry, value)));
  const inScope = (country: string, platform: string) =>
    (!requestedCountry || country === requestedCountry) && (!selectedPlatforms.size || selectedPlatforms.has(platformKey(country, platform)));
  const targets = new Map<string, { country: string; platform: string }>();
  for (const row of input.volumeRows) {
    const country = withdrawActualCountry(row.country, row.platform);
    if (inScope(country, row.platform)) {
      targets.set(`${country}\u001f${platformKey(country, row.platform)}`, { country, platform: canonicalThirdPartyPlatform(country, row.platform) });
    }
  }
  for (const row of input.rows) {
    if (!row) continue;
    const country = withdrawActualCountry(row.country_code || row.country, row.platform);
    if (inScope(country, row.platform)) {
      targets.set(`${country}\u001f${platformKey(country, row.platform)}`, { country, platform: canonicalThirdPartyPlatform(country, row.platform) });
    }
  }
  for (const platform of input.platforms || []) {
    if (requestedCountry) targets.set(`${requestedCountry}\u001f${platformKey(requestedCountry, platform)}`, { country: requestedCountry, platform: canonicalThirdPartyPlatform(requestedCountry, platform) });
  }

  const rows = input.rows.filter(row => {
    if (!row || !range || row.stat_date < range.previousStart || row.stat_date > range.end) return false;
    const country = withdrawActualCountry(row.country_code || row.country, row.platform);
    return inScope(country, row.platform);
  });
  const metric = (dates: readonly string[], keys?: readonly string[]): WithdrawActualMetric => {
    let requestedAmount = 0, actualAmount = 0, feeAmount = 0, orderCount = 0;
    const allowed = keys?.length ? new Set(keys) : null;
    const capturedKeys = new Set<string>();
    for (const row of rows) {
      if (!dates.includes(row.stat_date)) continue;
      const country = withdrawActualCountry(row.country_code || row.country, row.platform);
      const target = `${country}\u001f${platformKey(country, row.platform)}`;
      const key = providerKey(country, row.third_party);
      if (allowed && !allowed.has(key)) continue;
      capturedKeys.add(`${target}\u001f${row.stat_date}`);
      requestedAmount += number(row.requested_amount);
      actualAmount += number(row.actual_amount);
      feeAmount += number(row.fee_amount);
      orderCount += number(row.order_count);
    }
    const expected = dates.length * targets.size;
    const captured = capturedKeys.size;
    const state: WithdrawActualMetric["state"] = input.error || !range
      ? "unavailable"
      : !expected || !captured
        ? "missing"
        : captured < expected
          ? "partial"
          : !orderCount
            ? "zero"
            : "complete";
    return { requestedAmount, actualAmount, feeAmount, orderCount, expected, captured, state };
  };

  const providers = new Map<string, { key: string; country: string; channel: string; requestedAmount: number; actualAmount: number; feeAmount: number; orderCount: number }>();
  if (range) for (const row of rows) {
    if (row.stat_date < range.start || row.stat_date > range.end) continue;
    const country = withdrawActualCountry(row.country_code || row.country, row.platform);
    const channel = canonicalThirdPartyName(row.third_party, country);
    const key = providerKey(country, channel);
    if (input.provider && key !== providerKey(requestedCountry, input.provider)) continue;
    const item = providers.get(key) || { key, country, channel, requestedAmount: 0, actualAmount: 0, feeAmount: 0, orderCount: 0 };
    item.requestedAmount += number(row.requested_amount);
    item.actualAmount += number(row.actual_amount);
    item.feeAmount += number(row.fee_amount);
    item.orderCount += number(row.order_count);
    providers.set(key, item);
  }
  return {
    providers: Array.from(providers.values()).sort((a, b) => b.actualAmount - a.actualAmount || b.feeAmount - a.feeAmount || b.orderCount - a.orderCount),
    compare: providerKeys => ({ current: metric(range?.currentDates || [], providerKeys), previous: metric(range?.previousDates || [], providerKeys) }),
    error: input.error,
  };
}
