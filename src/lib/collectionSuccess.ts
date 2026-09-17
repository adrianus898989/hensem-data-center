import type { CollectionSuccessSnapshot, ThirdPartyVolumeRow } from "./types";
import { canonicalThirdPartyName, confirmedIndiaThirdPartyAlias, inferThirdPartyChannelType } from "./thirdPartyNameMap";
import { canonicalThirdPartyPlatform } from "./thirdPartyPlatform";
import { platformDisplayCountry } from "./platformDisplayCountry";

const DAY = 86400000;
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

export function collectionSuccessProviderKey(country: string, channel: string): string {
  const c = collectionSuccessCountry(country);
  return `${c}\u001f${canonicalThirdPartyName(channel, c)}`;
}

function platformKey(country: string, platform: string): string {
  return canonicalThirdPartyPlatform(country, platform).trim().toUpperCase();
}

function collectionSuccessEffectiveChannel(country: string, rawChannel: string, explicit = ""): string {
  const unmarked = /^(未标记三方|未分类三方|unknown|unmarked)$/i.test(String(rawChannel || "").trim());
  if (collectionSuccessCountry(country) === "越南" && unmarked && canonicalThirdPartyName(explicit, country) === "LocalBank") return "LocalBank";
  return rawChannel;
}

/** Exact type buckets; in particular, PaytmQR and UPI must not share a denominator. */
export function collectionSuccessType(country: string, rawChannel: string, explicit = ""): string {
  // Confirmed ARB BANK/UPI aliases are the UPI-QR channel, not a second bank provider.
  const india = collectionSuccessCountry(country) === "印度";
  if (india && (confirmedIndiaThirdPartyAlias(rawChannel, country) === "UPI-QR" || /^ARB\s*[-‐‑‒–—﹘﹣－]\s*(BANK|UPI)$/i.test(rawChannel.trim()))) return "UPI";
  const value = (explicit || inferThirdPartyChannelType(rawChannel, country, rawChannel) || "其他类型").trim();
  const key = value.toUpperCase().replace(/[\s_-]/g, "");
  // The collector uses English wallet labels for these countries while the
  // existing volume table uses its established localized buckets. Keep the
  // mapping country-scoped so a Bank/E-Wallet label cannot merge unrelated
  // wallet types elsewhere.
  if (collectionSuccessCountry(country) === "印尼") {
    if (key === "BANK" || key === "BANKCARD") return "银行代付";
    if (key === "EWALLET" || key === "WALLET") return "钱包代付";
  }
  if (collectionSuccessCountry(country) === "越南" && canonicalThirdPartyName(explicit || rawChannel, country) === "LocalBank") return "银行";
  const known: Record<string, string> = {
    UPI: "UPI", PAYTMQR: "PaytmQR", APPPAY: "APPPay",
    LOCALBANK: "银行卡", BANK: "银行卡", BANKCARD: "银行卡",
    EASYPAISA: "EASYPAISA", JAZZCASH: "JAZZCASH",
    PIX: "PIX", USDT: "USDT",
  };
  return known[key] || value;
}

function businessDate(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : NaN;
}

export function collectionSuccessPeriod(start: string, end: string) {
  const first = businessDate(start);
  const last = businessDate(end);
  const days = Number.isFinite(first) && Number.isFinite(last) ? Math.floor((last - first) / DAY) + 1 : 0;
  if (days < 1 || days > 366) return null;
  const iso = (n: number) => new Date(n).toISOString().slice(0, 10);
  return {
    start, end, previousStart: iso(first - days * DAY), previousEnd: iso(first - DAY),
    currentDates: Array.from({ length: days }, (_, i) => iso(first + i * DAY)),
    previousDates: Array.from({ length: days }, (_, i) => iso(first + (i - days) * DAY)),
    comparisonLabel: days === 1 ? "较昨日" : "较上期",
  };
}

export type CollectionSuccessMetric = {
  submitted: number;
  success: number;
  rate: number | null;
  expected: number;
  captured: number;
  unknownType?: boolean;
  state: "complete" | "partial" | "missing" | "zero" | "unavailable";
};
export type CollectionSuccessComparison = {
  current: CollectionSuccessMetric;
  previous: CollectionSuccessMetric;
  deltaPoints: number | null;
  comparisonLabel: string;
  platforms: Array<{ country: string; platform: string; current: CollectionSuccessMetric; previous: CollectionSuccessMetric }>;
};
export type CollectionSuccessView = {
  providers: Array<{ key: string; country: string; channel: string; submitted: number }>;
  compare: (providerKeys?: readonly string[], types?: readonly string[]) => CollectionSuccessComparison;
  error?: string;
};

/**
 * The rate shown in the cell belongs to the current period.  When only the
 * comparison period is absent, say that explicitly instead of displaying the
 * ambiguous "昨日未采集" underneath a valid current rate.
 */
export function collectionSuccessComparisonNote(value: CollectionSuccessComparison): string {
  const { previous, deltaPoints, comparisonLabel } = value;
  if (deltaPoints !== null) return `${comparisonLabel} ${deltaPoints > 0 ? "+" : ""}${deltaPoints.toFixed(2)} 百分点`;

  const currentPeriod = comparisonLabel === "较昨日" ? "本日" : "本期";
  const previousPeriod = comparisonLabel === "较昨日" ? "昨日" : "上期";
  if (previous.state === "missing") return `${currentPeriod}已采集 · 无${previousPeriod}对比`;
  if (previous.state === "zero") return `${currentPeriod}已采集 · ${previousPeriod}无提交`;
  if (previous.state === "partial") return `${currentPeriod}已采集 · ${previousPeriod}${previous.unknownType ? "类型未确认" : "部分未采集"}`;
  if (previous.state === "unavailable") return `${currentPeriod}已采集 · ${previousPeriod}暂不可用`;
  return `${currentPeriod}已采集 · ${previousPeriod}不可比`;
}

type ProjectedSnapshot = {
  country: string; platform: string; platformId: string; date: string; at: string; valid: boolean;
  groups: Array<{ providerKey: string; channel: string; type: string; submitted: number; success: number }>;
  totals: { submitted: number; success: number };
  /** Safe one-provider fallback, proven by exact success-count equality. */
  fallbackProvider?: { key: string; channel: string };
};
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Fail closed even if a corrupt/old cache bypasses the server validator. */
export function validCollectionSuccessSnapshot(snapshot: CollectionSuccessSnapshot, sourceSystems: readonly string[] = ["RECHARGE_REVIEW"]): boolean {
  if (!snapshot || snapshot.schema_version !== 1 || !sourceSystems.includes(snapshot.source_system) || snapshot.coverage?.complete !== true || !Array.isArray(snapshot.groups)) return false;
  if (![snapshot.country_code, snapshot.platform, snapshot.stat_date, snapshot.timezone, snapshot.snapshot_id, snapshot.snapshot_at].every(value => typeof value === "string" && value.trim().length > 0)) return false;
  if (!Number.isFinite(businessDate(snapshot.stat_date)) || !Number.isFinite(Date.parse(snapshot.snapshot_at))) return false;
  const { expected_count: expected, fetched_count: fetched, unique_count: unique } = snapshot.coverage;
  if (![expected, fetched, unique, snapshot.totals?.submitted_count, snapshot.totals?.success_count].every(count)) return false;
  if (expected !== unique || unique !== snapshot.totals.submitted_count || fetched !== unique) return false;
  const identities = new Set<string>();
  let submitted = 0, success = 0;
  for (const group of snapshot.groups) {
    const identity = `${group?.raw_channel}\u001f${group?.channel_type}`;
    if (!group || typeof group.raw_channel !== "string" || !group.raw_channel.trim() || typeof group.channel_type !== "string" || !count(group.submitted_count) || !count(group.success_count) || group.success_count > group.submitted_count || identities.has(identity)) return false;
    identities.add(identity);
    submitted += group.submitted_count;
    success += group.success_count;
  }
  return submitted === snapshot.totals.submitted_count && success === snapshot.totals.success_count && Number.isSafeInteger(submitted) && Number.isSafeInteger(success);
}

export function buildCollectionSuccessView(input: {
  snapshots: readonly CollectionSuccessSnapshot[];
  /** Country/platform scoped rows BEFORE provider/type/date filters, for coverage. */
  volumeRows: readonly ThirdPartyVolumeRow[];
  start: string; end: string; country: string;
  platforms?: readonly string[]; countries?: readonly string[]; provider?: string; types?: readonly string[];
  sourceSystems?: readonly string[];
  enabled?: boolean; error?: string;
}): CollectionSuccessView {
  const period = collectionSuccessPeriod(input.start, input.end);
  const requestedCountry = collectionSuccessCountry(input.country);
  const sourceSystems = input.sourceSystems || ["RECHARGE_REVIEW"];
  const selectedPlatforms = new Set((input.platforms || []).map(p => platformKey(requestedCountry, p)));
  const selectedCountries = (input.countries || []).map(c => collectionSuccessCountry(c));
  const inScope = (country: string, platform: string) => (!requestedCountry || country === requestedCountry) && (!selectedCountries.length || selectedCountries.includes(country)) && (!selectedPlatforms.size || selectedPlatforms.has(platformKey(country, platform)));
  const projections = new Map<string, ProjectedSnapshot>();
  const platforms = new Map<string, { country: string; platform: string; id: string }>();
  const providerMap = new Map<string, { key: string; country: string; channel: string; submitted: number }>();
  const volumeProviders = new Map<string, Map<string, { key: string; country: string; channel: string; successCount: number }>>();
  const keyFor = (country: string, platform: string) => `${country}\u001f${platformKey(country, platform)}`;
  const inRange = (date: string) => !!period && date >= period.previousStart && date <= period.end;
  const addPlatform = (country: string, platform: string) => {
    const id = keyFor(country, platform);
    if (!platforms.has(id)) platforms.set(id, { country, platform: canonicalThirdPartyPlatform(country, platform), id });
    return id;
  };
  for (const row of input.volumeRows) {
    const country = collectionSuccessCountry(row.country, row.platform);
    if (!inScope(country, row.platform) || !inRange(row.date)) continue;
    const platformId = addPlatform(country, row.platform);
    const expectedDirection = sourceSystems.includes("WITHDRAW_REVIEW") && !sourceSystems.includes("RECHARGE_REVIEW") ? "代付" : "代收";
    if (row.direction !== expectedDirection || !count(row.count) || row.count <= 0) continue;
    const dayKey = `${platformId}\u001f${row.date}`;
    const providers = volumeProviders.get(dayKey) || new Map();
    const providerKey = collectionSuccessProviderKey(country, row.channel);
    const current = providers.get(providerKey) || { key: providerKey, country, channel: canonicalThirdPartyName(row.channel, country), successCount: 0 };
    current.successCount += row.count;
    providers.set(providerKey, current);
    volumeProviders.set(dayKey, providers);
  }
  for (const platform of input.platforms || []) if (requestedCountry) addPlatform(requestedCountry, platform);
  for (const snapshot of input.snapshots) {
    if (!snapshot || !sourceSystems.includes(snapshot.source_system) || typeof snapshot.country_code !== "string" || typeof snapshot.platform !== "string" || typeof snapshot.stat_date !== "string" || !inRange(snapshot.stat_date)) continue;
    const country = collectionSuccessCountry(snapshot.country_code, snapshot.platform);
    if (!inScope(country, snapshot.platform)) continue;
    const platformId = addPlatform(country, snapshot.platform);
    const key = `${platformId}\u001f${snapshot.stat_date}`;
    const at = String(snapshot.snapshot_at || "");
    if (projections.has(key) && projections.get(key)!.at >= at) continue;
    const valid = validCollectionSuccessSnapshot(snapshot, sourceSystems);
    const groups = valid ? snapshot.groups.map(group => {
      const rawChannel = collectionSuccessEffectiveChannel(country, group.raw_channel, group.channel_type);
      return {
        providerKey: collectionSuccessProviderKey(country, rawChannel),
        channel: canonicalThirdPartyName(rawChannel, country),
        type: collectionSuccessType(country, rawChannel, group.channel_type),
        submitted: group.submitted_count, success: group.success_count,
      };
    }) : [];
    const candidates = volumeProviders.get(key);
    const onlyProvider = candidates?.size === 1 ? Array.from(candidates.values())[0] : undefined;
    const fallbackProvider = valid && onlyProvider
      && onlyProvider.successCount === snapshot.totals.success_count
      && !groups.some(group => group.providerKey === onlyProvider.key)
      ? { key: onlyProvider.key, channel: onlyProvider.channel }
      : undefined;
    projections.set(key, {
      country, platform: snapshot.platform, platformId, date: snapshot.stat_date, at, valid,
      groups,
      totals: valid ? { submitted: snapshot.totals.submitted_count, success: snapshot.totals.success_count } : { submitted: 0, success: 0 },
      fallbackProvider,
    });
  }
  const selectedTypes = (input.types || []).map(t => collectionSuccessType(requestedCountry, "", t));
  const matchesSelected = (group: ProjectedSnapshot["groups"][number], country: string) =>
    (!input.provider || group.providerKey === collectionSuccessProviderKey(country, input.provider)) && (!selectedTypes.length || selectedTypes.includes(group.type));
  for (const snapshot of Array.from(projections.values())) {
    if (!period || snapshot.date < period.start) continue;
    if (snapshot.fallbackProvider && snapshot.totals.submitted > 0) {
      const fallback = snapshot.fallbackProvider;
      const item = providerMap.get(fallback.key) || { key: fallback.key, country: snapshot.country, channel: fallback.channel, submitted: 0 };
      item.submitted += snapshot.totals.submitted;
      providerMap.set(fallback.key, item);
    }
    for (const group of snapshot.groups) {
      if (!matchesSelected(group, snapshot.country) || !group.submitted) continue;
      const item = providerMap.get(group.providerKey) || { key: group.providerKey, country: snapshot.country, channel: group.channel, submitted: 0 };
      item.submitted += group.submitted;
      providerMap.set(group.providerKey, item);
    }
  }
  const metric = (dates: string[], targets: typeof platforms, keys?: readonly string[], types?: readonly string[]): CollectionSuccessMetric => {
    let submitted = 0, success = 0, captured = 0, unknownType = false;
    const expected = dates.length * targets.size;
    const typeFilter = (types || []).map(t => collectionSuccessType(requestedCountry, "", t));
    const unknown = (type: string) => /^(UNKNOWN|其他类型|未知)$/i.test(type);
    const unknownExcluded = (typeFilter.length > 0 && !typeFilter.some(unknown)) || (selectedTypes.length > 0 && !selectedTypes.some(unknown));
    for (const platform of Array.from(targets.values())) for (const date of dates) {
      const snapshot = projections.get(`${platform.id}\u001f${date}`);
      if (!snapshot?.valid) continue;
      captured += 1;
      const scopedProviderKeys = keys || (input.provider ? [collectionSuccessProviderKey(snapshot.country, input.provider)] : undefined);
      const directGroups = snapshot.groups.filter(group => matchesSelected(group, snapshot.country)
        && (!keys || keys.includes(group.providerKey))
        && (!typeFilter.length || typeFilter.includes(group.type)));
      const canUsePlatformTotal = !!scopedProviderKeys?.length
        && !typeFilter.length && !selectedTypes.length
        && !!snapshot.fallbackProvider
        && scopedProviderKeys.includes(snapshot.fallbackProvider.key)
        && directGroups.length === 0;
      if (canUsePlatformTotal) {
        submitted += snapshot.totals.submitted;
        success += snapshot.totals.success;
        continue;
      }
      for (const group of snapshot.groups) {
        // Unknown wallet types remain in the all-types denominator. Never
        // silently discard them and call a type-filtered rate complete.
        if (unknownExcluded && unknown(group.type) && group.submitted > 0
          && (!input.provider || group.providerKey === collectionSuccessProviderKey(snapshot.country, input.provider))
          && (!keys || keys.includes(group.providerKey))) unknownType = true;
        if (!matchesSelected(group, snapshot.country) || (keys && !keys.includes(group.providerKey)) || (typeFilter.length && !typeFilter.includes(group.type))) continue;
        submitted += group.submitted;
        success += group.success;
      }
    }
    const state: CollectionSuccessMetric["state"] = input.enabled === false || input.error || !period || !Number.isSafeInteger(submitted) || !Number.isSafeInteger(success) ? "unavailable" : !expected || !captured ? "missing" : captured < expected || unknownType ? "partial" : !submitted ? "zero" : "complete";
    return { submitted, success, expected, captured, state, unknownType, rate: state === "complete" ? success / submitted : null };
  };
  return {
    providers: Array.from(providerMap.values()), error: input.error,
    compare(keys, types) {
      // Country scoping on a mixed-country summary must not require other countries' snapshots.
      const countries = keys && new Set(keys.map(key => key.split("\u001f")[0]));
      const targets = new Map(Array.from(platforms).filter(([, p]) => !countries || countries.has(p.country)));
      const current = metric(period?.currentDates || [], targets, keys, types);
      const previous = metric(period?.previousDates || [], targets, keys, types);
      return {
        current, previous, deltaPoints: current.rate !== null && previous.rate !== null ? (current.rate - previous.rate) * 100 : null,
        comparisonLabel: period?.comparisonLabel || "较昨日",
        platforms: Array.from(targets.values()).map(platform => ({
          country: platform.country, platform: platform.platform,
          current: metric(period?.currentDates || [], new Map([[platform.id, platform]]), keys, types),
          previous: metric(period?.previousDates || [], new Map([[platform.id, platform]]), keys, types),
        })).sort((a, b) => a.platform.localeCompare(b.platform, "zh-CN", { numeric: true })),
      };
    },
  };
}
