import type { ThirdPartyVolumeRow, WithdrawPendingSnapshot } from "./types";
import { canonicalThirdPartyName } from "./thirdPartyNameMap";
import { canonicalThirdPartyPlatform } from "./thirdPartyPlatform";
import { platformDisplayCountry } from "./platformDisplayCountry";

const DAY = 86400000;
const COUNTRIES: Record<string, string> = {
  IN: "印度", INDIA: "印度", 印度线下: "印度", 印度盘口: "印度",
  BR: "巴西", PK: "巴基斯坦", ID: "印尼", VN: "越南", PH: "菲律宾", MY: "马来",
  MM: "缅甸", NG: "尼日利亚", CO: "哥伦比亚", MX: "墨西哥", CL: "智利",
  HK_TEAM: "香港", HONG_KONG: "香港", RED_CRAB: "红膏蟹", REDCRAB: "红膏蟹",
};

export function withdrawPendingCountry(country: string, platform = ""): string {
  const value = String(country || "").trim();
  return platformDisplayCountry(COUNTRIES[value.toUpperCase()] || COUNTRIES[value] || value, platform);
}

function providerKey(country: string, channel: string): string {
  return `${withdrawPendingCountry(country)}\u001f${canonicalThirdPartyName(channel, withdrawPendingCountry(country))}`;
}

function platformKey(country: string, platform: string): string {
  return canonicalThirdPartyPlatform(country, platform).trim().toUpperCase();
}

function validDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

const safeCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const safeAmount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;

export function validWithdrawPendingSnapshot(snapshot: WithdrawPendingSnapshot): boolean {
  if (!snapshot || snapshot.schema_version !== 1 || snapshot.source_system !== "WITHDRAW_REVIEW" || snapshot.coverage?.complete !== true || !Array.isArray(snapshot.groups)) return false;
  if (![snapshot.country_code, snapshot.platform, snapshot.stat_date, snapshot.timezone, snapshot.snapshot_id, snapshot.snapshot_at].every(value => typeof value === "string" && value.trim().length > 0)) return false;
  if (!/^(?:[A-Z]{2}|HK_TEAM|RED_CRAB)$/.test(snapshot.country_code) || !validDate(snapshot.stat_date) || !Number.isFinite(Date.parse(snapshot.snapshot_at))) return false;
  const { expected_count: expected, fetched_count: fetched, unique_count: unique } = snapshot.coverage;
  if (![expected, fetched, unique, snapshot.totals?.pending_count].every(safeCount) || !safeAmount(snapshot.totals?.pending_amount)) return false;
  if (expected !== fetched || expected !== unique || expected !== snapshot.totals.pending_count) return false;
  const identities = new Set<string>(); let count = 0; let amount = 0;
  for (const group of snapshot.groups) {
    if (!group || typeof group.raw_channel !== "string" || typeof group.channel_type !== "string" || !group.raw_channel.trim() || !group.channel_type.trim()
      || !safeCount(group.pending_count) || !safeAmount(group.pending_amount) || group.pending_count <= 0 || identities.has(`${group.raw_channel}\u001f${group.channel_type}`)) return false;
    identities.add(`${group.raw_channel}\u001f${group.channel_type}`); count += group.pending_count; amount += group.pending_amount;
  }
  return count === snapshot.totals.pending_count && Math.abs(amount - snapshot.totals.pending_amount) < 0.01;
}

type Metric = { amount: number; count: number; state: "complete" | "partial" | "missing" | "zero" | "unavailable"; captured: number; expected: number };
export type WithdrawPendingComparison = { current: Metric; previous: Metric };
export type WithdrawPendingView = {
  basisHint?: string;
  missingSnapshotPlatforms?: string[];
  providers: Array<{ key: string; country: string; channel: string; amount: number; count: number }>;
  compare: (providerKeys?: readonly string[]) => WithdrawPendingComparison;
  error?: string;
};

function period(start: string, end: string) {
  if (!validDate(start) || !validDate(end)) return null;
  const first = Date.parse(`${start}T00:00:00Z`), last = Date.parse(`${end}T00:00:00Z`);
  const days = Math.floor((last - first) / DAY) + 1;
  if (days < 1 || days > 366) return null;
  const iso = (n: number) => new Date(n).toISOString().slice(0, 10);
  return { start, end, previousStart: iso(first - days * DAY), previousEnd: iso(first - DAY), currentDates: Array.from({ length: days }, (_, i) => iso(first + i * DAY)), previousDates: Array.from({ length: days }, (_, i) => iso(first + (i - days) * DAY)) };
}

export function buildWithdrawPendingView(input: {
  snapshots: readonly WithdrawPendingSnapshot[];
  volumeRows: readonly ThirdPartyVolumeRow[];
  start: string; end: string; country: string; platforms?: readonly string[]; provider?: string; error?: string;
}): WithdrawPendingView {
  const range = period(input.start, input.end);
  const requestedCountry = withdrawPendingCountry(input.country);
  const selectedPlatforms = new Set((input.platforms || []).map(value => platformKey(requestedCountry, value)));
  const inScope = (country: string, platform: string) => (!requestedCountry || country === requestedCountry) && (!selectedPlatforms.size || selectedPlatforms.has(platformKey(country, platform)));
  const targets = new Map<string, { country: string; platform: string }>();
  for (const row of input.volumeRows) {
    const country = withdrawPendingCountry(row.country, row.platform);
    if (inScope(country, row.platform) && range && row.date >= range.previousStart && row.date <= range.end) targets.set(`${country}\u001f${platformKey(country, row.platform)}`, { country, platform: canonicalThirdPartyPlatform(country, row.platform) });
  }
  for (const platform of input.platforms || []) if (requestedCountry) targets.set(`${requestedCountry}\u001f${platformKey(requestedCountry, platform)}`, { country: requestedCountry, platform: canonicalThirdPartyPlatform(requestedCountry, platform) });
  const projections = new Map<string, { valid: boolean; groups: Array<{ key: string; channel: string; amount: number; count: number }> }>();
  for (const snapshot of input.snapshots) {
    if (!validWithdrawPendingSnapshot(snapshot) || !range || snapshot.stat_date < range.previousStart || snapshot.stat_date > range.end) continue;
    const country = withdrawPendingCountry(snapshot.country_code, snapshot.platform);
    if (!inScope(country, snapshot.platform)) continue;
    const targetKey = `${country}\u001f${platformKey(country, snapshot.platform)}`;
    if (!targets.has(targetKey)) targets.set(targetKey, { country, platform: canonicalThirdPartyPlatform(country, snapshot.platform) });
    const key = `${targetKey}\u001f${snapshot.stat_date}`;
    const groups = snapshot.groups.map(group => ({ key: providerKey(country, group.raw_channel), channel: canonicalThirdPartyName(group.raw_channel, country), amount: group.pending_amount, count: group.pending_count }));
    const previous = projections.get(key);
    if (!previous || previous.groups.length === 0) projections.set(key, { valid: true, groups });
  }
  const metric = (dates: string[], keys?: readonly string[]): Metric => {
    let amount = 0, count = 0, captured = 0;
    const expected = dates.length * targets.size;
    for (const target of targets) for (const date of dates) {
      const snapshot = projections.get(`${target[0]}\u001f${date}`);
      if (!snapshot?.valid) continue;
      captured += 1;
      for (const group of snapshot.groups) if (!keys || keys.includes(group.key)) { amount += group.amount; count += group.count; }
    }
    const state: Metric["state"] = input.error || !range ? "unavailable" : !expected || !captured ? "missing" : captured < expected ? "partial" : !count ? "zero" : "complete";
    return { amount, count, expected, captured, state };
  };
  const providers = new Map<string, { key: string; country: string; channel: string; amount: number; count: number }>();
  if (range) for (const snapshot of input.snapshots) {
    if (!validWithdrawPendingSnapshot(snapshot) || snapshot.stat_date < range.start || snapshot.stat_date > range.end) continue;
    const country = withdrawPendingCountry(snapshot.country_code, snapshot.platform);
    if (!inScope(country, snapshot.platform)) continue;
    for (const group of snapshot.groups) {
      const key = providerKey(country, group.raw_channel);
      if (input.provider && key !== providerKey(requestedCountry, input.provider)) continue;
      const item = providers.get(key) || { key, country, channel: canonicalThirdPartyName(group.raw_channel, country), amount: 0, count: 0 };
      item.amount += group.pending_amount; item.count += group.pending_count; providers.set(key, item);
    }
  }
  return { providers: Array.from(providers.values()).sort((a, b) => b.amount - a.amount || b.count - a.count), compare: keys => ({ current: metric(range?.currentDates || [], keys), previous: metric(range?.previousDates || [], keys) }), error: input.error };
}
