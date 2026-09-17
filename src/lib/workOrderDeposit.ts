import type { ThirdPartyVolumeRow, WorkOrderDepositRow } from "./types";
import { canonicalThirdPartyName } from "./thirdPartyNameMap";
import { canonicalThirdPartyPlatform } from "./thirdPartyPlatform";
import { platformDisplayCountry } from "./platformDisplayCountry";

const DAY = 86400000;
const COUNTRY_CODES: Record<string, string> = {
  IN: "印度", PK: "巴基斯坦", ID: "印尼", MY: "马来", MM: "缅甸", VN: "越南", NG: "尼日利亚", BR: "巴西", CL: "智利", MX: "墨西哥",
};

export function workOrderDepositCountry(country: string, platform = ""): string {
  const value = String(country || "").trim();
  return platformDisplayCountry(COUNTRY_CODES[value.toUpperCase()] || value, platform);
}

export type WorkOrderDepositMetric = {
  submittedAmount: number;
  submittedCount: number;
  successAmount: number;
  successCount: number;
  withdrawNotReceivedAmount: number;
  withdrawNotReceivedCount: number;
  withdrawSuccessAmount: number;
  withdrawSuccessCount: number;
  expected: number;
  captured: number;
  state: "complete" | "partial" | "missing" | "zero" | "unavailable";
};

export type WorkOrderDepositView = {
  providers: Array<{ key: string; country: string; channel: string; submittedAmount: number; submittedCount: number; successAmount: number; successCount: number; withdrawNotReceivedAmount: number; withdrawNotReceivedCount: number; withdrawSuccessAmount: number; withdrawSuccessCount: number }>;
  compare: (providerKeys?: readonly string[]) => { current: WorkOrderDepositMetric; previous: WorkOrderDepositMetric };
  error?: string;
};

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function platformKey(country: string, platform: string): string {
  return canonicalThirdPartyPlatform(country, platform).trim().toUpperCase();
}

function isUnmarkedProvider(value: string): boolean {
  const key = String(value || "").trim().toLowerCase().replace(/[\s_\-]+/g, "");
  return !key || key === "未标记三方".toLowerCase() || key === "未分类三方".toLowerCase() || key === "unknown" || key === "unmarked";
}

function workOrderProviderPart(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, "");
}

/**
 * Some AR work-order backends put the payment rail in `third_party` and the
 * actual provider in `channel_type`. Resolve only source combinations already
 * confirmed by the business. An unconfirmed pair stays traceable and separate
 * instead of being merged into a guessed provider.
 */
export function workOrderDepositThirdPartyName(country: string, thirdParty: string, channelType = ""): string {
  const normalizedCountry = workOrderDepositCountry(country);
  const rawThirdParty = String(thirdParty || "").trim();
  // A traceable generic-rail label produced below must be idempotent when the
  // dashboard turns that display value back into a provider filter key.
  if (!String(channelType || "").trim() && rawThirdParty.includes(" / ")) return rawThirdParty;
  const rawKey = workOrderProviderPart(thirdParty);
  const channelKey = workOrderProviderPart(channelType);
  let confirmed = "";
  let genericRail = false;

  if (normalizedCountry === "印度") {
    const paytmProviders: Record<string, string> = {
      ic2payinr: "ICPay",
      ninepayinr: "NinePay",
      ox2payinr: "OXPay",
      rapayinr: "RAPay",
      umoneypayinr: "UmoneyPay",
      wepay2inr: "WePay",
      wpayinr: "WPay",
    };
    const qrProviders: Record<string, string> = {
      umoneypayinr: "UmoneyPay",
      wepay2inr: "WePay",
    };
    if (rawKey === "paytm") {
      genericRail = true;
      confirmed = paytmProviders[channelKey] || "";
    } else if (rawKey === "qr") {
      genericRail = true;
      confirmed = qrProviders[channelKey] || "";
    }
  } else if (normalizedCountry === "缅甸") {
    if (rawKey === "kbzpay" || rawKey === "wavepay") {
      genericRail = true;
      if (channelKey === "kingpaymmk") confirmed = "KingPay";
      else if (channelKey === "ytpaymmk") confirmed = "YTPay";
    }
  } else if (normalizedCountry === "马来") {
    if (rawKey === "duitnow") {
      genericRail = true;
      if (channelKey === "fpaymyr") confirmed = "FPay";
    } else if (rawKey === "touchngo") {
      genericRail = true;
      if (channelKey === "truepaymyr") confirmed = "TruePay";
    }
  }

  if (confirmed) return canonicalThirdPartyName(confirmed, normalizedCountry);
  if (genericRail && channelKey && channelKey !== rawKey) {
    return `${rawThirdParty} / ${String(channelType || "").trim()}`;
  }
  return canonicalThirdPartyName(thirdParty, normalizedCountry);
}

function providerKey(country: string, channel: string): string {
  return `${workOrderDepositCountry(country)}\u001f${workOrderDepositThirdPartyName(country, channel)}`;
}

function workOrderRowProviderKey(country: string, row: WorkOrderDepositRow): string {
  return `${workOrderDepositCountry(country)}\u001f${workOrderDepositThirdPartyName(country, row.third_party, row.channel_type)}`;
}

/** A work-order metric is joined only by its real, normalized provider name. */
export function workOrderDepositProviderKey(country: string, channel: string): string {
  return providerKey(country, channel);
}

function datePeriod(start: string, end: string) {
  if (!validDate(start) || !validDate(end)) return null;
  const first = Date.parse(`${start}T00:00:00Z`), last = Date.parse(`${end}T00:00:00Z`);
  const days = Math.floor((last - first) / DAY) + 1;
  if (days < 1 || days > 366) return null;
  const iso = (value: number) => new Date(value).toISOString().slice(0, 10);
  return {
    start, end,
    previousStart: iso(first - days * DAY), previousEnd: iso(first - DAY),
    currentDates: Array.from({ length: days }, (_, index) => iso(first + index * DAY)),
    previousDates: Array.from({ length: days }, (_, index) => iso(first + (index - days) * DAY)),
  };
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function buildWorkOrderDepositView(input: {
  rows: readonly WorkOrderDepositRow[];
  volumeRows: readonly ThirdPartyVolumeRow[];
  start: string;
  end: string;
  country: string;
  platforms?: readonly string[];
  provider?: string;
  error?: string;
}): WorkOrderDepositView {
  const range = datePeriod(input.start, input.end);
  const requestedCountry = workOrderDepositCountry(input.country);
  const selectedPlatforms = new Set((input.platforms || []).map(value => platformKey(requestedCountry, value)));
  const inScope = (country: string, platform: string) =>
    (!requestedCountry || country === requestedCountry) && (!selectedPlatforms.size || selectedPlatforms.has(platformKey(country, platform)));
  const rows = input.rows.filter(row => {
    if (!row || row.source_system !== "AR_WORKORDER") return false;
    // A platform-level aggregate cannot be attributed to an individual third
    // party. Keep it out of both rows and totals instead of repeating it for
    // every provider displayed under the same platform.
    if (isUnmarkedProvider(row.third_party)) return false;
    const country = workOrderDepositCountry(row.country_code || row.country, row.platform);
    return inScope(country, row.platform) && (!range || (row.stat_date >= range.previousStart && row.stat_date <= range.end));
  });
  const currentRows = rows.filter(row => !range || (row.stat_date >= range.start && row.stat_date <= range.end));
  const targets = new Map<string, { country: string; platform: string }>();
  for (const row of input.volumeRows) {
    const country = workOrderDepositCountry(row.country, row.platform);
    if (inScope(country, row.platform)) targets.set(`${country}\u001f${platformKey(country, row.platform)}`, { country, platform: row.platform });
  }
  for (const platform of input.platforms || []) if (requestedCountry) targets.set(`${requestedCountry}\u001f${platformKey(requestedCountry, platform)}`, { country: requestedCountry, platform });
  for (const row of rows) {
    const country = workOrderDepositCountry(row.country_code || row.country, row.platform);
    targets.set(`${country}\u001f${platformKey(country, row.platform)}`, { country, platform: row.platform });
  }

  const metric = (dates: readonly string[], keys?: readonly string[]): WorkOrderDepositMetric => {
    let submittedAmount = 0, submittedCount = 0, successAmount = 0, successCount = 0;
    let withdrawNotReceivedAmount = 0, withdrawNotReceivedCount = 0, withdrawSuccessAmount = 0, withdrawSuccessCount = 0, captured = 0;
    const allowed = keys?.length ? new Set(keys) : null;
    for (const row of rows) {
      if (!dates.includes(row.stat_date)) continue;
      const country = workOrderDepositCountry(row.country_code || row.country, row.platform);
      const provider = workOrderRowProviderKey(country, row);
      if (allowed && !allowed.has(provider)) continue;
      submittedAmount += number(row.submitted_amount); submittedCount += number(row.submitted_count);
      successAmount += number(row.success_amount); successCount += number(row.success_count);
      withdrawNotReceivedAmount += number(row.withdraw_not_received_amount);
      withdrawNotReceivedCount += number(row.withdraw_not_received_count);
      withdrawSuccessAmount += number(row.withdraw_success_amount);
      withdrawSuccessCount += number(row.withdraw_success_count);
      captured += 1;
    }
    const expected = dates.length * Math.max(1, targets.size);
    const state: WorkOrderDepositMetric["state"] = input.error || !range ? "unavailable" : !captured ? "missing" : captured < expected ? "partial" : !submittedCount ? "zero" : "complete";
    return { submittedAmount, submittedCount, successAmount, successCount, withdrawNotReceivedAmount, withdrawNotReceivedCount, withdrawSuccessAmount, withdrawSuccessCount, expected, captured, state };
  };

  const providers = new Map<string, { key: string; country: string; channel: string; submittedAmount: number; submittedCount: number; successAmount: number; successCount: number; withdrawNotReceivedAmount: number; withdrawNotReceivedCount: number; withdrawSuccessAmount: number; withdrawSuccessCount: number }>();
  for (const row of currentRows) {
    const country = workOrderDepositCountry(row.country_code || row.country, row.platform);
    const channel = workOrderDepositThirdPartyName(country, row.third_party, row.channel_type);
    const key = workOrderRowProviderKey(country, row);
    if (input.provider && key !== providerKey(requestedCountry, input.provider)) continue;
    const item = providers.get(key) || { key, country, channel, submittedAmount: 0, submittedCount: 0, successAmount: 0, successCount: 0, withdrawNotReceivedAmount: 0, withdrawNotReceivedCount: 0, withdrawSuccessAmount: 0, withdrawSuccessCount: 0 };
    item.submittedAmount += number(row.submitted_amount); item.submittedCount += number(row.submitted_count);
    item.successAmount += number(row.success_amount); item.successCount += number(row.success_count);
    item.withdrawNotReceivedAmount += number(row.withdraw_not_received_amount);
    item.withdrawNotReceivedCount += number(row.withdraw_not_received_count);
    item.withdrawSuccessAmount += number(row.withdraw_success_amount);
    item.withdrawSuccessCount += number(row.withdraw_success_count);
    providers.set(key, item);
  }
  return {
    providers: Array.from(providers.values()).sort((a, b) =>
      (b.submittedAmount + b.withdrawNotReceivedAmount) - (a.submittedAmount + a.withdrawNotReceivedAmount)
      || (b.submittedCount + b.withdrawNotReceivedCount) - (a.submittedCount + a.withdrawNotReceivedCount)),
    compare: (keys) => ({ current: metric(range?.currentDates || [], keys), previous: metric(range?.previousDates || [], keys) }),
    error: input.error,
  };
}
