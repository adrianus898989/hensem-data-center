// Aggregate-only contract. No order/member IDs or customer payment claims.
// Provider canonicalization deliberately uses the UI's existing shared alias map.
export type AnomalyCoverage = "complete" | "unknown";
export type DelayBucket = {minSeconds: number; maxSeconds: number | null; count: number};
export type MidnightMetric = {
  date: string; count: number | null; amount: number | null; maxAgeDays: null;
  ageBuckets: {minDays: number; maxDays: number | null; count: number; amount: number}[];
  coverage: AnomalyCoverage; latestAt: string | null; verified: boolean;
  scheduledAt: string | null; observationStartedAt: string | null; reason: string | null;
  basis: "observed_near_midnight"; toleranceSeconds: 300;
  ageBasis: "created_at_to_scheduled_at"; continuityVerified: false;
};
export type ProviderAnomalySource = {
  country: string; countryCode: string; platform: string; timezone: string;
  currency: string | null; provider: string; canonicalProvider: null; rawAliases: string[];
  createdSuccess: {
    basis: "created_to_success_proxy"; windowBasis: "success_time";
    sample: number | null; p95Seconds: null; delayBuckets: DelayBucket[];
    coverage: AnomalyCoverage; latestAt: string | null; invalidTimeCount: number | null;
    customerPaymentVerified: false; reason: string;
  };
  successDays: {date: string; total: number | null; success: number | null; coverage: AnomalyCoverage; latestAt: string | null}[];
  share: {basis: "successful_created_cohort_amount"; providerAmount: number | null;
    totalAmount: number | null; sample: number | null; coverage: AnomalyCoverage;
    latestAt: string | null; denominatorKey: string; reason: string};
  midnight: MidnightMetric;
  midnightDays: MidnightMetric[];
};
export type ProviderAnomalyResponse = {
  version: 1; generatedAt: string; startDate: string; endDate: string;
  sources: ProviderAnomalySource[]; limitations: string[];
  platforms: {country: string; platform: string; timezone: string}[];
};

const COUNTRY: Record<string, string> = {IN: "印度", HK_TEAM: "香港", RED_CRAB: "红膏蟹"};
const DELAY_BOUNDS = [0, 60, 300, 600, 1800, 3600, 21600, 86400, 172800];
const finite = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const count = (v: unknown): number | null => finite(v) !== null && Number.isSafeInteger(v) ? v as number : null;
const key = (...v: unknown[]) => JSON.stringify(v);
const missingMidnight = (date: string): MidnightMetric => ({date, count: null, amount: null, maxAgeDays: null,
  ageBuckets: [], coverage: "unknown", latestAt: null, verified: false, scheduledAt: null,
  observationStartedAt: null, reason: "NO_VERIFIED_LOCAL_MIDNIGHT_OBSERVATION",
  basis: "observed_near_midnight", toleranceSeconds: 300, ageBasis: "created_at_to_scheduled_at", continuityVerified: false});

export function anomalyDateRange(start: string, end: string): string[] {
  const parse = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(v + "T00:00:00Z") : NaN;
  const first = parse(start), last = parse(end);
  if (!Number.isFinite(first) || !Number.isFinite(last) || new Date(first).toISOString().slice(0, 10) !== start
    || new Date(last).toISOString().slice(0, 10) !== end || last < first || last - first > 30 * 86400000) {
    throw new Error("ANOMALY_INVALID_DATE_RANGE");
  }
  return Array.from({length: (last - first) / 86400000 + 1}, (_, i) => new Date(first + i * 86400000).toISOString().slice(0, 10));
}

export function buildProviderAnomalyResponse(input: any, startDate: string, endDate: string): ProviderAnomalyResponse {
  const dates = anomalyDateRange(startDate, endDate);
  if (input?.version !== 1 || !Array.isArray(input.detailRows) || !Array.isArray(input.successSnapshots)
    || !Array.isArray(input.midnightSnapshots)) throw new Error("ANOMALY_INVALID_RPC_RESPONSE");
  const sources = new Map<string, ProviderAnomalySource>();
  const ensure = (country: string, platform: string, provider: string, currency: string | null = null, timezone = "Asia/Kolkata") => {
    if (!COUNTRY[country] || !platform || !provider) throw new Error("ANOMALY_INVALID_SOURCE");
    const id = key(country, platform, provider, currency);
    if (!sources.has(id)) sources.set(id, {
      country: COUNTRY[country], countryCode: country, platform, timezone, currency, provider, canonicalProvider: null, rawAliases: [provider],
      createdSuccess: {basis: "created_to_success_proxy", windowBasis: "success_time", sample: null, p95Seconds: null,
        delayBuckets: [], coverage: "unknown", latestAt: null, invalidTimeCount: null,
        customerPaymentVerified: false, reason: "NO_DETAIL_COMPLETENESS_RECEIPT;NOT_CUSTOMER_PAYMENT_TIME"},
      successDays: [],
      share: {basis: "successful_created_cohort_amount", providerAmount: null, totalAmount: null, sample: null,
        coverage: "unknown", latestAt: null, denominatorKey: key(country, platform, currency, startDate, endDate),
        reason: "NO_DETAIL_COMPLETENESS_RECEIPT;CURRENCY_NOT_VERIFIED"},
      midnight: missingMidnight(endDate), midnightDays: dates.map(missingMidnight),
    });
    return sources.get(id)!;
  };
  for (const row of input.detailRows) {
    const source = ensure(row.country, row.platform, row.provider);
    const buckets = Array.isArray(row.delay_buckets) && row.delay_buckets.length === DELAY_BOUNDS.length
      && row.delay_buckets.every((n: unknown) => count(n) !== null) ? row.delay_buckets as number[] : null;
    const sample = count(row.delay_sample);
    if (buckets && sample !== null && buckets.reduce((s, n) => s + n, 0) === sample) {
      source.createdSuccess.sample = sample;
      source.createdSuccess.delayBuckets = buckets.map((n, i) => ({minSeconds: DELAY_BOUNDS[i], maxSeconds: DELAY_BOUNDS[i + 1] ?? null, count: n}));
    }
    source.createdSuccess.invalidTimeCount = count(row.invalid_delay_count);
    source.createdSuccess.latestAt = row.latest_at || null;
    source.share.providerAmount = finite(row.amount);
    source.share.totalAmount = finite(row.observed_total_amount);
    source.share.sample = count(row.created_sample);
    source.share.latestAt = row.latest_at || null;
  }
  const daily = new Map<string, any>();
  for (const snapshot of input.successSnapshots) {
    if (!dates.includes(snapshot.date)) continue;
    const id = key(snapshot.country, snapshot.platform, snapshot.date);
    if (daily.has(id)) throw new Error("ANOMALY_DUPLICATE_DAILY_COHORT");
    const coverage = snapshot.coverage;
    const groups = Array.isArray(snapshot.groups) ? snapshot.groups : [];
    const expected = count(coverage?.expected_count), submitted = count(snapshot.totals?.submitted_count), successful = count(snapshot.totals?.success_count);
    let groupTotal = 0, groupSuccess = 0, valid = true;
    for (const group of groups) {
      const total = count(group.submitted_count), success = count(group.success_count);
      if (total === null || success === null || success > total || typeof group.raw_channel !== "string" || !group.raw_channel) {valid = false; continue;}
      groupTotal += total; groupSuccess += success;
      ensure(snapshot.country, snapshot.platform, group.raw_channel, null, snapshot.timezone || "Asia/Kolkata");
    }
    const complete = valid && coverage?.complete === true && expected !== null
      && expected === count(coverage?.unique_count) && expected === count(coverage?.fetched_count)
      && expected === submitted && submitted === groupTotal && successful === groupSuccess;
    daily.set(id, {...snapshot, groups, complete});
  }
  // Prefer a genuine timely complete observation, then the earliest observation.
  // Multiple receiver attempts are archived, never summed as multiple queues.
  const midnight = new Map<string, any>();
  for (const snapshot of [...input.midnightSnapshots].sort((a, b) => Number(b.verified === true) - Number(a.verified === true)
    || Date.parse(a.captured_at) - Date.parse(b.captured_at))) {
    if (!dates.includes(snapshot.date)) continue;
    const id = key(snapshot.country, snapshot.platform, snapshot.currency, snapshot.date);
    if (midnight.has(id)) continue;
    midnight.set(id, snapshot);
    for (const group of snapshot.snapshot?.groups || []) ensure(snapshot.country, snapshot.platform, group.raw_channel, snapshot.currency, snapshot.timezone);
  }
  for (const source of sources.values()) {
    source.successDays = dates.map(date => {
      const snapshot = daily.get(key(source.countryCode, source.platform, date));
      // Daily count cohorts do not expose per-currency splits: attach only to
      // the currency-neutral source, not to every midnight currency variant.
      if (source.currency !== null || !snapshot?.complete) return {date, total: null, success: null, coverage: "unknown", latestAt: snapshot?.snapshot_at || null};
      const groups = snapshot.groups.filter((g: any) => g.raw_channel === source.provider);
      return {date, total: groups.reduce((s: number, g: any) => s + g.submitted_count, 0),
        success: groups.reduce((s: number, g: any) => s + g.success_count, 0), coverage: "complete", latestAt: snapshot.snapshot_at};
    });
    source.midnightDays = dates.map(date => {
      const s = midnight.get(key(source.countryCode, source.platform, source.currency, date));
      if (!s) return missingMidnight(date);
      const groups = (s.snapshot?.groups || []).filter((g: any) => g.raw_channel === source.provider);
      const verified = s.verified === true && s.snapshot?.coverage?.complete === true;
      const buckets = new Map<number, {minDays: number; maxDays: number | null; count: number; amount: number}>();
      for (const group of groups) for (const b of group.age_buckets || []) {
        const prior = buckets.get(b.min_days) || {minDays: b.min_days, maxDays: b.max_days, count: 0, amount: 0};
        prior.count += b.count; prior.amount += b.amount; buckets.set(b.min_days, prior);
      }
      return {date, count: verified ? groups.reduce((n: number, g: any) => n + g.pending_count, 0) : null,
        amount: verified ? groups.reduce((n: number, g: any) => n + g.pending_amount, 0) : null,
        maxAgeDays: null, ageBuckets: verified ? Array.from(buckets.values()).sort((a, b) => a.minDays - b.minDays) : [],
        coverage: verified ? "complete" : "unknown", latestAt: s.captured_at, verified,
        scheduledAt: s.scheduled_at, observationStartedAt: s.observation_started_at,
        reason: verified ? null : "LATE_OR_INCOMPLETE_MIDNIGHT_OBSERVATION",
        basis: "observed_near_midnight", toleranceSeconds: 300, ageBasis: "created_at_to_scheduled_at", continuityVerified: false};
    });
    source.midnight = source.midnightDays[source.midnightDays.length - 1];
  }
  return {version: 1, generatedAt: input.generatedAt, startDate, endDate,
    sources: Array.from(sources.values()).sort((a, b) => key(a.country, a.platform, a.provider, a.currency).localeCompare(key(b.country, b.platform, b.provider, b.currency))),
    platforms: Array.isArray(input.platforms) ? input.platforms : [],
    limitations: Array.isArray(input.limitations) ? input.limitations : []};
}
