import type {
  AutoWithdrawPayload,
  CollectionSuccessSnapshot,
  AutoWithdrawRow,
  DailyWithdrawRow,
  OperatorRow,
  ThirdPartyPlatformStatusRow,
  ThirdPartyRatePayload,
  ThirdPartyRateRow,
  ThirdPartyVolumePayload,
  ThirdPartyVolumeRow,
  WithdrawActualRow,
  WithdrawPendingSnapshot,
  WorkOrderDepositRow,
  WorkOrderPayload,
  WorkOrderRow
} from "./types";
import { formatDuration, parseDurationToSeconds } from "./format";
import { aggregateWithdrawRows } from "./parseAutoWithdraw";
import { platformDisplayCountry } from "./platformDisplayCountry";
import { dashboardScopeAllows } from "./dashboardDataScope";
import { collectionSuccessCountry, collectionSuccessPeriod } from "./collectionSuccess";
import { withdrawPendingCountry } from "./withdrawPending";
import { requireDashboardDataAccess, requireDashboardAllData, dashboardAllowedRows, DashboardDataAccessError } from "./dashboardDataAccessServer";

const PAGE_SIZE = 1000;

function requiredEnv(name: string): string {
  const deno = (globalThis as any).Deno?.env?.get?.(name);
  const value = String(deno || (typeof process !== "undefined" ? process.env[name] : "") || "").trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function config() {
  const edge = Boolean((globalThis as any).Deno?.env?.get);
  const url = requiredEnv(edge ? "SUPABASE_URL" : "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
  const anonKey = requiredEnv(edge ? "SUPABASE_ANON_KEY" : "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return { url, anonKey };
}

async function readJson(response: Response) {
  const text = await response.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!response.ok) {
    if (response.status === 401) throw new DashboardDataAccessError(401, "login_required", "登录已失效，请重新登录。");
    if (response.status === 403) throw new DashboardDataAccessError(403, "data_denied", "当前账号没有此数据查看权限。");
    throw new DashboardDataAccessError(503, "data_unavailable", "数据读取暂时不可用，请稍后重试。");
  }
  return json;
}

async function fetchPaged<T>(table: string, query: URLSearchParams, token: string, signal?: AbortSignal): Promise<T[]> {
  const { url, anonKey } = config();

  const fetchPage = async (offset: number, withCount = false): Promise<{ rows: T[]; total: number | null }> => {
    const params = new URLSearchParams(query);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    const response = await fetch(`${url}/rest/v1/${table}?${params.toString()}`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(withCount ? { Prefer: "count=exact" } : {})
      },
      cache: "no-store",
      signal
    });
    const rows = await readJson(response);
    const list = Array.isArray(rows) ? rows as T[] : [];
    const contentRange = String(response.headers.get("content-range") || "");
    const match = contentRange.match(/\/(\d+)$/);
    return { rows: list, total: match ? Number(match[1]) : null };
  };

  // V247：第一页顺便拿 exact count。Supabase 默认单页最多 1000 行，
  // 以前 4~5 页是串行读取；现在剩余页并行读取，数据库已有数据时页面明显更快。
  const first = await fetchPage(0, true);
  if (first.rows.length < PAGE_SIZE) return first.rows;

  if (Number.isFinite(first.total) && Number(first.total) >= first.rows.length) {
    const total = Math.min(Number(first.total), 500000);
    const offsets: number[] = [];
    for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) offsets.push(offset);
    const all: T[] = [...first.rows];
    const CONCURRENCY = 4;
    for (let i = 0; i < offsets.length; i += CONCURRENCY) {
      const pages = await Promise.all(offsets.slice(i, i + CONCURRENCY).map((offset) => fetchPage(offset, false)));
      for (const page of pages) all.push(...page.rows);
    }
    return all;
  }

  // count 取不到时保留旧的安全分页逻辑。
  const all: T[] = [...first.rows];
  let offset = PAGE_SIZE;
  while (true) {
    if (offset > 500000) throw new Error(`Supabase ${table} 分页超过安全上限`);
    const page = await fetchPage(offset, false);
    all.push(...page.rows);
    if (page.rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

async function fetchExactCount(table: string, token: string): Promise<number> {
  const { url, anonKey } = config();
  const response = await fetch(`${url}/rest/v1/${table}?select=id&limit=1`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      Prefer: "count=exact",
      Range: "0-0"
    },
    cache: "no-store"
  });
  if (!response.ok) await readJson(response);
  const contentRange = String(response.headers.get("content-range") || "");
  const match = contentRange.match(/\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function isoDate(value: string): string {
  return /^20\d{2}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function previousDate(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function volumeSummary(rows: ThirdPartyVolumeRow[]) {
  return {
    rows: rows.length,
    amount: rows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    count: rows.reduce((sum, row) => sum + Number(row.count || 0), 0),
    successCount: rows.reduce((sum, row) => sum + Number(row.successCount || 0), 0),
    failedCount: rows.reduce((sum, row) => sum + Number(row.failedCount || 0), 0),
    countries: new Set(rows.map((row) => row.country).filter(Boolean)).size,
    platforms: new Set(rows.map((row) => row.platform).filter(Boolean)).size,
    channels: new Set(rows.map((row) => row.channel).filter(Boolean)).size
  };
}

function buildAliasMap(rows: ThirdPartyVolumeRow[]): Record<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    const canonical = String(row.channel || "").trim();
    if (!canonical) continue;
    const set = map.get(canonical) || new Set<string>();
    const raw = String(row.rawChannel || "").trim();
    if (raw && raw !== canonical) set.add(raw);
    map.set(canonical, set);
  }
  return Object.fromEntries(
    Array.from(map.entries()).map(([key, values]) => [key, Array.from(values).sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }))])
  );
}

type DbVolumeRow = {
  id: string;
  sheet_name: string | null;
  source_row: number | null;
  data_date: string;
  country: string | null;
  platform: string | null;
  channel: string | null;
  raw_channel: string | null;
  channel_type: string | null;
  direction: string | null;
  amount: number | string | null;
  count: number | string | null;
  success_count: number | string | null;
  failed_count: number | string | null;
  success_rate: number | string | null;
  status: string | null;
  raw: Record<string, string> | null;
  updated_at: string | null;
};

function mapVolume(row: DbVolumeRow): ThirdPartyVolumeRow {
  return {
    id: String(row.id || ""),
    sheetName: String(row.sheet_name || ""),
    sourceRow: Number(row.source_row || 0),
    date: String(row.data_date || ""),
    country: platformDisplayCountry(String(row.country || ""), String(row.platform || "")),
    platform: String(row.platform || ""),
    channel: String(row.channel || ""),
    rawChannel: String(row.raw_channel || ""),
    channelType: String(row.channel_type || ""),
    direction: row.direction === "代付" ? "代付" : "代收",
    amount: Number(row.amount || 0),
    count: Number(row.count || 0),
    successCount: Number(row.success_count || 0),
    failedCount: Number(row.failed_count || 0),
    successRate: Number(row.success_rate || 0),
    status: String(row.status || ""),
    raw: row.raw || undefined
  };
}

export type ThirdPartySyncStatus = {
  ok: boolean;
  start: string;
  end: string;
  historyTasks: number;
  historySuccess: number;
  historyRemaining: number;
  historyFailed: number;
  historyRowsWritten: number;
  historyLatestSyncAt?: string | null;
  historyComplete: boolean;
  dataDays: number;
  collectDays: number;
  payoutDays: number;
  latestWriteAt?: string | null;
  ratesLatestWriteAt?: string | null;
};

async function callRpc<T>(name: string, body: Record<string, unknown>, token: string, signal?: AbortSignal): Promise<T> {
  const { url, anonKey } = config();
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal
  });
  return await readJson(response) as T;
}

type Game66VolumeRpcRow = {
  id?: string; sheet_name?: string; source_row?: number; data_date?: string; country?: string;
  platform?: string; channel?: string; raw_channel?: string; channel_type?: string; direction?: string;
  amount?: number | string; count?: number | string; success_count?: number | string;
  failed_count?: number | string; success_rate?: number | string; status?: string;
  raw?: Record<string, string>; updated_at?: string;
};

type Game66VolumeRpcResult = {
  rows?: Game66VolumeRpcRow[];
  collectionSuccessSnapshots?: CollectionSuccessSnapshot[];
  withdrawPendingSnapshots?: WithdrawPendingSnapshot[];
  withdrawActualRows?: WithdrawActualRow[];
  latestWriteAt?: string | null;
};

type Game66AutoWithdrawRpcRow = DbAutoWithdrawRow & { country_code?: string | null };

type Game66AutoWithdrawRpcResult = {
  rows?: Game66AutoWithdrawRpcRow[];
  operatorRows?: DbOperatorRow[];
  latestWriteAt?: string | null;
};


type DbAutoWithdrawRow = {
  id: string;
  data_date: string;
  country: string | null;
  platform: string | null;
  total: number | string | null;
  success: number | string | null;
  rejected: number | string | null;
  auto_count: number | string | null;
  manual_count: number | string | null;
  avg_seconds: number | string | null;
  avg_time_text: string | null;
  source_sheet: string | null;
  raw: Record<string, unknown> | null;
  source_updated_at: string | null;
  updated_at: string | null;
};

type DbOperatorRow = {
  id: string;
  data_date: string;
  country: string | null;
  platform: string | null;
  account: string | null;
  processed: number | string | null;
  rejected: number | string | null;
  avg_seconds: number | string | null;
  avg_time_text: string | null;
  source_sheet: string | null;
  raw: Record<string, unknown> | null;
  source_updated_at: string | null;
  updated_at: string | null;
};

function addIsoDays(value: string, days: number): string {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function compareDurationPercent(currentSeconds: number, previousSeconds: number): string {
  if (!currentSeconds || !previousSeconds) return "-";
  if ((previousSeconds < 10 && currentSeconds > 600) || (currentSeconds < 10 && previousSeconds > 600)) return "-";
  const pct = ((currentSeconds - previousSeconds) / previousSeconds) * 100;
  if (!Number.isFinite(pct) || Math.abs(pct) > 9999) return "-";
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function dedupeDbDaily(rows: DbAutoWithdrawRow[]): DbAutoWithdrawRow[] {
  const sorted = [...rows].sort((a, b) => String(a.updated_at || a.source_updated_at || "").localeCompare(String(b.updated_at || b.source_updated_at || "")));
  const map = new Map<string, DbAutoWithdrawRow>();
  for (const row of sorted) {
    const key = `${row.data_date}|||${row.country || ""}|||${row.platform || ""}`;
    map.set(key, row);
  }
  return [...map.values()];
}

function dedupeDbOperators(rows: DbOperatorRow[]): DbOperatorRow[] {
  const sorted = [...rows].sort((a, b) => String(a.updated_at || a.source_updated_at || "").localeCompare(String(b.updated_at || b.source_updated_at || "")));
  const map = new Map<string, DbOperatorRow>();
  for (const row of sorted) {
    const key = `${row.data_date}|||${row.country || ""}|||${row.platform || ""}|||${row.account || ""}`;
    map.set(key, row);
  }
  return [...map.values()];
}

function mapDbDaily(row: DbAutoWithdrawRow): DailyWithdrawRow {
  const total = Number(row.total || 0);
  const success = Number(row.success || 0);
  const rejected = Number(row.rejected || 0);
  const autoCount = Number(row.auto_count || 0);
  const manualCount = row.manual_count == null ? Math.max(total - autoCount, 0) : Number(row.manual_count);
  const avgSeconds = Number(row.avg_seconds || 0) || parseDurationToSeconds(String(row.avg_time_text || ""));
  return {
    country: platformDisplayCountry(String(row.country || ""), String(row.platform || "")),
    platform: String(row.platform || ""),
    total,
    success,
    rejected,
    successRate: total ? success / total : 0,
    rejectRate: total ? rejected / total : 0,
    autoCount,
    manualCount,
    autoRate: total ? autoCount / total : 0,
    manualRate: total ? manualCount / total : 0,
    avgTime: String(row.avg_time_text || "") || formatDuration(avgSeconds),
    yesterdayAvgTime: "-",
    comparePercent: "-",
    sourceSheet: String(row.source_sheet || "Supabase"),
    date: String(row.data_date || ""),
    blockTitle: String(row.source_sheet || "Supabase"),
  };
}

function mapDbOperator(row: DbOperatorRow): OperatorRow {
  const avgSeconds = Number(row.avg_seconds || 0) || parseDurationToSeconds(String(row.avg_time_text || ""));
  return {
    country: platformDisplayCountry(String(row.country || ""), String(row.platform || "")),
    date: String(row.data_date || ""),
    platform: String(row.platform || ""),
    account: String(row.account || ""),
    processed: Number(row.processed || 0),
    rejected: Number(row.rejected || 0),
    avgTime: String(row.avg_time_text || "") || formatDuration(avgSeconds),
    yesterdayAvgTime: "-",
    comparePercent: "-",
  };
}

function enrichDbDaily(rows: DailyWithdrawRow[]): DailyWithdrawRow[] {
  const byDate = new Map<string, DailyWithdrawRow>();
  for (const row of rows) byDate.set(`${row.country}|||${row.platform}|||${row.date}`, row);
  return rows.map((row) => {
    const current = parseDurationToSeconds(row.avgTime);
    const previousRow = byDate.get(`${row.country}|||${row.platform}|||${addIsoDays(row.date, -1)}`);
    const previous = previousRow ? parseDurationToSeconds(previousRow.avgTime) : 0;
    return {
      ...row,
      yesterdayAvgTime: previous ? formatDuration(previous) : "-",
      comparePercent: compareDurationPercent(current, previous),
      previousDay: previousRow ? {
        date: previousRow.date,
        total: previousRow.total,
        success: previousRow.success,
        rejected: previousRow.rejected,
        autoCount: previousRow.autoCount,
        manualCount: previousRow.manualCount,
      } : null,
    };
  });
}

function enrichDbOperators(rows: OperatorRow[]): OperatorRow[] {
  const seconds = new Map<string, number>();
  for (const row of rows) seconds.set(`${row.country}|||${row.platform}|||${row.account}|||${row.date}`, parseDurationToSeconds(row.avgTime));
  return rows.map((row) => {
    const current = parseDurationToSeconds(row.avgTime);
    const previous = seconds.get(`${row.country}|||${row.platform}|||${row.account}|||${addIsoDays(row.date, -1)}`) || 0;
    return {
      ...row,
      yesterdayAvgTime: previous ? formatDuration(previous) : "-",
      comparePercent: compareDurationPercent(current, previous),
    };
  });
}

export async function readSupabaseAutoWithdraw(request: Request, startInput: string, endInput: string): Promise<AutoWithdrawPayload> {
  const access = await requireDashboardDataAccess(request, "auto_withdraw");
  const {token} = access;

  const start = isoDate(startInput);
  const end = isoDate(endInput || startInput);
  if (!start || !end || start > end) throw new Error("自动出款查询日期无效");
  // The preceding calendar day is fetched even across month/year boundaries,
  // then removed after comparison enrichment so it cannot inflate totals.
  const queryStart = addIsoDays(start, -1);

  const dailyQuery = new URLSearchParams();
  dailyQuery.set("select", "id,data_date,country,platform,total,success,rejected,auto_count,manual_count,avg_seconds,avg_time_text,source_sheet,raw,source_updated_at,updated_at");
  dailyQuery.set("data_date", `gte.${queryStart}`);
  dailyQuery.append("data_date", `lte.${end}`);
  dailyQuery.set("order", "data_date.asc,country.asc,platform.asc,updated_at.asc");

  const operatorQuery = new URLSearchParams();
  operatorQuery.set("select", "id,data_date,country,platform,account,processed,rejected,avg_seconds,avg_time_text,source_sheet,raw,source_updated_at,updated_at");
  operatorQuery.set("data_date", `gte.${queryStart}`);
  operatorQuery.append("data_date", `lte.${end}`);
  operatorQuery.set("order", "data_date.asc,country.asc,platform.asc,account.asc,updated_at.asc");

  const [dailyFetched, operatorFetched, game66Result] = await Promise.all([
    fetchPaged<DbAutoWithdrawRow>("auto_withdraw_daily", dailyQuery, token),
    fetchPaged<DbOperatorRow>("withdraw_operator_daily", operatorQuery, token),
    callRpc<Game66AutoWithdrawRpcResult>("dashboard_game66_withdraw_daily", {
      p_start: queryStart, p_end: end,
    }, token, AbortSignal.timeout(6000)).catch(() => ({rows: [], operatorRows: [], latestWriteAt: null})),
  ]);
  const dailyRaw = dashboardAllowedRows(access, [...dailyFetched, ...(game66Result.rows || [])]);
  const operatorRaw = dashboardAllowedRows(access, [...operatorFetched, ...(game66Result.operatorRows || [])]);

  const dailyAll = enrichDbDaily(dedupeDbDaily(dailyRaw).map(mapDbDaily));
  const operatorAll = enrichDbOperators(dedupeDbOperators(operatorRaw).map(mapDbOperator));
  const dailyRows = dailyAll.filter((row) => row.date >= start && row.date <= end);
  const operatorRows = operatorAll.filter((row) => row.date >= start && row.date <= end);
  const monthlyRows: AutoWithdrawRow[] = aggregateWithdrawRows(dailyRows)
    .map((row) => ({ ...row, previousDay: start === end ? row.previousDay ?? null : null }));

  const updatedAt = [
    ...dailyRaw.map((row) => String(row.updated_at || row.source_updated_at || "")),
    ...operatorRaw.map((row) => String(row.updated_at || row.source_updated_at || "")),
    String(game66Result.latestWriteAt || ""),
  ].filter(Boolean).sort().pop() || new Date().toISOString();

  return {
    meta: {
      year: start.slice(0, 4),
      month: String(Number(start.slice(5, 7))),
      updatedAt,
      source: "supabase",
      message: `2026-08 起直读 Supabase · 自动出款 ${dailyRows.length} 行（含 66GAME 安全汇总） · 操作人 ${operatorRows.length} 行`,
      rawDailyRows: dailyRows.length,
      rawOperatorRows: operatorRows.length,
    },
    monthlyRows,
    dailyRows,
    operatorRows,
  };
}

export async function readSupabaseThirdPartyVolume(request: Request, startInput = "", endInput = "", countryInput = ""): Promise<ThirdPartyVolumePayload> {
  const access = await requireDashboardDataAccess(request, "third_party");
  const {token} = access;

  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const start = isoDate(startInput) || yesterday;
  const end = isoDate(endInput) || start;
  const country = String(countryInput || "").trim();
  if (country && !dashboardScopeAllows(access.scope, country)) throw new DashboardDataAccessError(403, "scope_denied", "当前账号没有此国家或盘口组的数据权限。");
  const queryStart = previousDate(start);
  const normalizedCountry = country.toLowerCase().replace(/[\s_-]+/g, "");
  const redCrabTeamCountry = ["红膏蟹", "红膏蟹盘口", "redcrab"].includes(normalizedCountry);
  const hongKongTeamCountry = ["香港", "香港盘口", "hkteam", "hongkong"].includes(normalizedCountry);
  const game66TeamCountry = redCrabTeamCountry || hongKongTeamCountry;
  const game66RpcCountry = redCrabTeamCountry ? "RED_CRAB"
    : hongKongTeamCountry ? "HK_TEAM"
    : country || null;
  // 香港/红膏蟹只来自 GAME66 安全汇总。不要再等待旧三方量和四条
  // 辅助统计链路；这既避免错误混入其他盘口，也让无数据日期立即返回。
  const shouldReadLegacy = !game66TeamCountry;

  // Legacy snapshots can hold the right platform in the wrong Brazil group.
  // Read only the three exact source labels with the same user's RLS token,
  // then project and filter. Filtering one stored country first would omit it.
  const brazilPage = ["BR", "巴西", "胖虎巴西"].includes(country);
  const sourceCountries = brazilPage ? ["巴西", "胖虎巴西", "BR"] : [country || null];
  // Additive read, with the same end-user JWT/RLS as volumes. A missing rollout
  // migration or slow success endpoint must not prevent existing volume data.
  const successPeriod = collectionSuccessPeriod(start, end);
  const successCountry = country === "所有国家USDT" ? null : country || null;
  const successRead = shouldReadLegacy && successPeriod
    ? callRpc<{ snapshots: CollectionSuccessSnapshot[] }>("dashboard_collection_success", {
      p_start: successPeriod.previousStart, p_end: end, p_country: successCountry,
    }, token, AbortSignal.timeout(6000)).then(result => {
      if (!Array.isArray(result?.snapshots)) throw new Error("invalid_success_payload");
      return { snapshots: result.snapshots.filter(snapshot => snapshot && typeof snapshot.country_code === "string" && typeof snapshot.platform === "string"
        && dashboardScopeAllows(access.scope, collectionSuccessCountry(snapshot.country_code, snapshot.platform), snapshot.platform)), error: "" };
    }).catch(() => ({ snapshots: [] as CollectionSuccessSnapshot[], error: "代收成功率暂未读取，原有三方量不受影响。" }))
    : Promise.resolve({ snapshots: [] as CollectionSuccessSnapshot[], error: game66TeamCountry ? "" : "代收成功率支持最多 366 天的查询。" });
  // Exact-"已提交" payout snapshots are read through a separate RPC/table so
  // legacy payout totals and the collection-success denominator cannot mix.
  const pendingRead = shouldReadLegacy && successPeriod
    ? callRpc<{ snapshots: WithdrawPendingSnapshot[] }>("dashboard_withdraw_pending", {
      p_start: successPeriod.previousStart, p_end: end, p_country: successCountry,
    }, token, AbortSignal.timeout(6000)).then(result => {
      if (!Array.isArray(result?.snapshots)) throw new Error("invalid_pending_payload");
      return { snapshots: result.snapshots.filter(snapshot => snapshot && typeof snapshot.country_code === "string" && typeof snapshot.platform === "string"
        && dashboardScopeAllows(access.scope, withdrawPendingCountry(snapshot.country_code, snapshot.platform), snapshot.platform)), error: "" };
    }).catch(() => ({ snapshots: [] as WithdrawPendingSnapshot[], error: "代付中数据暂未读取，原有三方量不受影响。" }))
    : Promise.resolve({ snapshots: [] as WithdrawPendingSnapshot[], error: game66TeamCountry ? "" : "代付中数据支持最多 366 天的查询。" });
  const depositQuery = successPeriod ? new URLSearchParams({
    select: "system_name,source_system,stat_date,country_code,country,platform,third_party,channel_type,submitted_count,submitted_amount,success_count,success_amount,status_counts,source_updated_at",
    order: "stat_date.asc,platform.asc,third_party.asc"
  }) : null;
  if (depositQuery && successPeriod) {
    depositQuery.append("stat_date", `gte.${successPeriod.previousStart}`);
    depositQuery.append("stat_date", `lte.${end}`);
  }
  const depositRead = shouldReadLegacy && successPeriod && depositQuery
    ? fetchPaged<WorkOrderDepositRow>("workorder_deposit_daily", depositQuery, token, AbortSignal.timeout(6000)).then(rows => ({
      rows: rows.filter(row => row && row.source_system === "AR_WORKORDER" && dashboardScopeAllows(access.scope, row.country_code || row.country, row.platform)),
      error: ""
    })).catch(() => ({ rows: [] as WorkOrderDepositRow[], error: "存款未到账数据暂未读取，原有三方量不受影响。" }))
    : Promise.resolve({ rows: [] as WorkOrderDepositRow[], error: game66TeamCountry ? "" : "存款未到账数据支持最多 366 天的查询。" });
  const actualRead = shouldReadLegacy && successPeriod
    ? callRpc<{ rows: WithdrawActualRow[] }>("dashboard_withdraw_actual", {
      p_start: successPeriod.previousStart, p_end: end, p_country: successCountry,
    }, token, AbortSignal.timeout(6000)).then(result => {
      if (!Array.isArray(result?.rows)) throw new Error("invalid_withdraw_actual_payload");
      return {
        rows: result.rows.filter(row => row && typeof row.stat_date === "string" && typeof row.platform === "string"
          && typeof row.third_party === "string" && dashboardScopeAllows(access.scope, row.country_code || row.country, row.platform)),
        error: ""
      };
    }).catch(() => ({ rows: [] as WithdrawActualRow[], error: "实际到账/提现手续费暂未读取，原有三方量不受影响。" }))
    : Promise.resolve({ rows: [] as WithdrawActualRow[], error: game66TeamCountry ? "" : "实际到账/提现手续费支持最多 366 天的查询。" });
  const legacyVolumeRead = shouldReadLegacy
    ? Promise.all(sourceCountries.map((sourceCountry) => callRpc<any>("dashboard_third_party_volume_fast_v2", {
      p_start: start,
      p_end: end,
      p_country: sourceCountry
    }, token, AbortSignal.timeout(12000))))
    : Promise.resolve([] as any[]);
  const game66TeamPlatforms = redCrabTeamCountry
    ? ["66GAME", "YYGAME", "XX7", "XX6", "XX5", "YY9", "PE7", "W5W"]
    : hongKongTeamCountry
      ? ["EZ777", "KA9", "8GAME", "WR777", "JW777", "HU777", "GG9", "MM9", "WW9", "777IN", "365IN", "INDIA2026", "FT7"]
      : [];
  const mergeGame66 = (parts: Game66VolumeRpcResult[]): Game66VolumeRpcResult => ({
    rows: parts.flatMap(part => part.rows || []),
    collectionSuccessSnapshots: parts.flatMap(part => part.collectionSuccessSnapshots || []),
    withdrawPendingSnapshots: parts.flatMap(part => part.withdrawPendingSnapshots || []),
    withdrawActualRows: parts.flatMap(part => part.withdrawActualRows || []),
    latestWriteAt: parts.map(part => part.latestWriteAt).filter(Boolean).sort().pop() || null,
  });
  const readGame66Window = (windowStart: string, windowEnd: string, targetCountry = game66RpcCountry) =>
    callRpc<Game66VolumeRpcResult>("dashboard_game66_charge_volume", {
      p_start: windowStart, p_end: windowEnd, p_country: targetCountry
    }, token, AbortSignal.timeout(18000));
  const game66CurrentRead = game66TeamPlatforms.length
    ? Promise.all(game66TeamPlatforms.map(platform => readGame66Window(start, end, platform))).then(mergeGame66)
    : readGame66Window(start, end);
  const game66PreviousRead = !game66TeamPlatforms.length && successPeriod && successPeriod.previousStart < start
    ? readGame66Window(successPeriod.previousStart, successPeriod.previousStart)
    : Promise.resolve({} as Game66VolumeRpcResult);
  const game66Read = Promise.all([game66CurrentRead, game66PreviousRead]).then(([current, previous]) => ({
    rows: current.rows || [],
    collectionSuccessSnapshots: [...(previous.collectionSuccessSnapshots || []), ...(current.collectionSuccessSnapshots || [])],
    withdrawPendingSnapshots: [...(previous.withdrawPendingSnapshots || []), ...(current.withdrawPendingSnapshots || [])],
    withdrawActualRows: current.withdrawActualRows || [],
    latestWriteAt: [previous.latestWriteAt, current.latestWriteAt].filter(Boolean).sort().pop() || null,
  })).catch((error) => {
    if (game66TeamCountry) throw error;
    return {
      rows: [] as Game66VolumeRpcRow[],
      collectionSuccessSnapshots: [] as CollectionSuccessSnapshot[],
      withdrawPendingSnapshots: [] as WithdrawPendingSnapshot[],
      withdrawActualRows: [] as WithdrawActualRow[],
      latestWriteAt: null
    };
  });
  const [results, game66Result] = await Promise.all([legacyVolumeRead, game66Read]);
  const dbRows: DbVolumeRow[] = dashboardAllowedRows(access, results.flatMap((result) => Array.isArray(result?.rows) ? result.rows : []));
  // 已接入的团队平台以安全聚合行并入代收列表；原始会员和订单字段不出库。
  const game66Rows = dashboardAllowedRows(access, game66Result.rows || []).map((row) => mapVolume({
    id: String(row.id || ""), sheet_name: String(row.sheet_name || "game66_charge_orders"), source_row: Number(row.source_row || 0),
    data_date: String(row.data_date || ""), country: String(row.country || ""), platform: String(row.platform || "66GAME"),
    channel: String(row.channel || "66GAME"), raw_channel: String(row.raw_channel || row.channel || "66GAME"), channel_type: String(row.channel_type || "66GAME"),
    direction: String(row.direction || "代收"), amount: row.amount ?? 0, count: row.count ?? 0, success_count: row.success_count ?? 0,
    failed_count: row.failed_count ?? 0, success_rate: row.success_rate ?? 0, status: String(row.status || "66GAME 原始订单"),
    raw: row.raw || {}, updated_at: row.updated_at || null
  })).filter((row) => row.date >= start && row.date <= end);
  const displayCountry = country === "BR" ? "巴西" : country;
  const rows = [...dbRows.map(mapVolume), ...game66Rows]
    .map(row => access.scope.mode === "all" ? row : {...row, raw: undefined})
    .filter((row) => !brazilPage || row.country === displayCountry || (displayCountry === "巴西" && row.country === "BR"));
  const globalLatest = access.scope.mode === "all" ? [...results.map((result) => result?.latestWriteAt), game66Result.latestWriteAt].filter(Boolean).sort().pop() : null;
  const updatedAt = String(globalLatest || dbRows.map((row) => String(row.updated_at || "")).filter(Boolean).sort().pop() || new Date().toISOString());
  const sheets = Array.from(new Set(rows.map((row) => row.sheetName).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  const [collectionSuccess, withdrawPending, workOrderDeposit, withdrawActual] = await Promise.all([successRead, pendingRead, depositRead, actualRead]);
  const game66SuccessSnapshots = (Array.isArray(game66Result.collectionSuccessSnapshots) ? game66Result.collectionSuccessSnapshots : [])
    .filter(snapshot => snapshot && typeof snapshot.country_code === "string" && typeof snapshot.platform === "string"
      && dashboardScopeAllows(access.scope, collectionSuccessCountry(snapshot.country_code, snapshot.platform), snapshot.platform));
  const game66PendingSnapshots = (Array.isArray(game66Result.withdrawPendingSnapshots) ? game66Result.withdrawPendingSnapshots : [])
    .filter(snapshot => snapshot && typeof snapshot.country_code === "string" && typeof snapshot.platform === "string"
      && dashboardScopeAllows(access.scope, withdrawPendingCountry(snapshot.country_code, snapshot.platform), snapshot.platform));
  const game66ActualRows = (Array.isArray(game66Result.withdrawActualRows) ? game66Result.withdrawActualRows : [])
    .filter(row => row && typeof row.stat_date === "string" && typeof row.platform === "string" && typeof row.third_party === "string"
      && dashboardScopeAllows(access.scope, row.country_code || row.country, row.platform));

  return {
    meta: {
      year: start.slice(0, 4),
      month: String(Number(start.slice(5, 7))),
      updatedAt,
      source: "supabase" as any,
      sheets,
      message: `Supabase 高速查询：${queryStart} 至 ${end}${country ? ` · ${country}` : ""}；开始日前 1 天仅用于 v239 昨日比较。`,
      dataSource: "supabase" as any,
      queryCountry: country,
      rowCount: rows.length,
      dataDays: new Set(rows.map((row) => row.date)).size,
      countryCount: new Set(rows.map((row) => row.country)).size,
      platformCount: new Set(rows.map((row) => row.platform)).size,
      channelCount: new Set(rows.map((row) => row.channel)).size,
      fastRpc: true
    } as any,
    rows,
    collectionSuccessSnapshots: [...collectionSuccess.snapshots, ...game66SuccessSnapshots],
    ...(collectionSuccess.error ? { collectionSuccessError: collectionSuccess.error } : {}),
    withdrawPendingSnapshots: [...withdrawPending.snapshots, ...game66PendingSnapshots],
    ...(withdrawPending.error ? { withdrawPendingError: withdrawPending.error } : {}),
    workOrderDepositRows: workOrderDeposit.rows,
    ...(workOrderDeposit.error ? { workOrderDepositError: workOrderDeposit.error } : {}),
    withdrawActualRows: [...withdrawActual.rows, ...game66ActualRows],
    ...(withdrawActual.error ? { withdrawActualError: withdrawActual.error } : {}),
    aliasMap: buildAliasMap(rows),
    summary: volumeSummary(rows),
    anomalies: []
  };
}

type DbWorkOrderBundle = {
  system_name: string;
  stat_date: string;
  country_code: string;
  country: string;
  platform: string;
  daily_rows: Record<string, unknown>[];
  type_rows: Record<string, unknown>[];
  employee_rows: Record<string, unknown>[];
  source_updated_at: string | null;
};

function monthBounds(monthKey: string): { start: string; end: string } | null {
  const match = String(monthKey || "").match(/^(20\d{2})_(0?[1-9]|1[0-2])$/);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]);
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start: `${year}-${String(month).padStart(2, "0")}-01`, end: last };
}

function numberField(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapWorkOrderBundle(bundle: DbWorkOrderBundle): WorkOrderRow[] {
  const base = `${bundle.stat_date}:${bundle.country_code}:${bundle.platform}`;
  const rows: WorkOrderRow[] = [];
  // The collector stores the operator breakdown in employee_rows.  Older
  // daily_rows did not carry the derived auto/manual fields, so calculate the
  // split at read time as well. This backfills already-written dates without
  // requiring the source scraper to be rerun.
  let autoProcessed = 0;
  let manualProcessed = 0;
  for (const employee of bundle.employee_rows || []) {
    const handled = numberField(employee.completed_count) + numberField(employee.rejected_count);
    if (!handled) continue;
    const employeeName = String(employee.employee_name || employee.employee_id || "").trim();
    const accountType = String(employee.account_type || "").trim().toLowerCase();
    const operator = employeeName.toLowerCase();
    const isAutomatic = ["admin", "system", "auto", "automatic", "robot", "机器人", "自动"].some((value) =>
      operator === value || operator.includes(value) || accountType === value || accountType.includes(value)
    );
    if (isAutomatic) autoProcessed += handled;
    else if (employeeName || accountType) manualProcessed += handled;
  }
  const add = (source: Record<string, unknown>, kind: WorkOrderRow["kind"], index: number, defaults: { workType: string; workName: string; operator: string }) => {
    const total = numberField(source.total_count);
    const success = numberField(source.completed_count);
    const failed = numberField(source.rejected_count);
    const pending = numberField(source.in_progress_count || source.pending_count);
    const sourceAuto = source.auto_processed_count ?? source.auto;
    const sourceManual = source.manual_processed_count ?? source.manual;
    const hasSourceSplit = sourceAuto !== undefined || sourceManual !== undefined;
    const rowAuto = hasSourceSplit ? numberField(sourceAuto) : autoProcessed;
    const rowManual = hasSourceSplit ? numberField(sourceManual) : manualProcessed;
    rows.push({
      id: `${base}:${kind}:${index}`,
      date: bundle.stat_date,
      country: bundle.country,
      platform: bundle.platform,
      workType: String(source.order_type || defaults.workType || "工单"),
      workName: String(source.order_name || defaults.workName || "日汇总"),
      operator: String(source.employee_name || defaults.operator || ""),
      accountType: String(source.account_type || ""),
      total, success, failed, pending,
      amount: numberField(source.total_amount || source.amount),
      ...(kind === "daily" ? { auto: rowAuto, manual: rowManual } : {}),
      status: success > 0 || failed > 0 ? "已处理" : "待处理",
      sourceSheet: "supabase:workorder_daily_bundle",
      sourceRow: index,
      kind,
    });
  };
  (bundle.daily_rows || []).forEach((row, index) => add(row, "daily", index, { workType: "日汇总", workName: "全部工单", operator: "" }));
  (bundle.type_rows || []).forEach((row, index) => add(row, "type", index, { workType: "未命名类型", workName: "-", operator: "" }));
  (bundle.employee_rows || []).forEach((row, index) => add(row, "operator", index, { workType: "工单", workName: "操作人汇总", operator: "" }));
  return rows;
}

function workOrderPayloadFromRows(rows: WorkOrderRow[], monthKeys: string[]): WorkOrderPayload {
  const sheets = rows.length ? ["supabase:workorder_daily_bundle"] : [];
  return {
    meta: {
      year: monthKeys[0]?.slice(0, 4) || String(new Date().getFullYear()),
      month: monthKeys[0] ? String(Number(monthKeys[0].slice(5, 7))) : String(new Date().getMonth() + 1),
      updatedAt: new Date().toISOString(), source: "supabase", sheets,
      message: rows.length ? "工单最新日汇总直接读取 Supabase；历史缺失时可回退 Google 快照。" : "Supabase 暂无工单日汇总。",
    },
    summary: {
      total: rows.reduce((sum, row) => sum + row.total, 0), success: rows.reduce((sum, row) => sum + row.success, 0),
      failed: rows.reduce((sum, row) => sum + row.failed, 0), pending: rows.reduce((sum, row) => sum + row.pending, 0),
      amount: rows.reduce((sum, row) => sum + row.amount, 0),
      countries: new Set(rows.map(row => row.country)).size, platforms: new Set(rows.map(row => row.platform)).size,
      types: new Set(rows.map(row => row.workType)).size, names: new Set(rows.map(row => row.workName)).size,
      operators: new Set(rows.map(row => row.operator).filter(Boolean)).size,
    },
    rows, anomalies: [],
  };
}

export async function readSupabaseWorkOrderMonths(request: Request, monthKeys: string[]): Promise<WorkOrderPayload> {
  const access = await requireDashboardDataAccess(request, "work_orders");
  const bounds = monthKeys.map(monthBounds).filter(Boolean) as Array<{ start: string; end: string }>;
  if (!bounds.length) return workOrderPayloadFromRows([], monthKeys);
  const start = bounds.map(item => item.start).sort()[0];
  const end = bounds.map(item => item.end).sort().pop() || start;
  const query = new URLSearchParams({
    select: "system_name,stat_date,country_code,country,platform,daily_rows,type_rows,employee_rows,source_updated_at",
    stat_date: `gte.${start}`,
    order: "stat_date.asc,platform.asc",
  });
  query.append("stat_date", `lte.${end}`);
  const bundles = await fetchPaged<DbWorkOrderBundle>("workorder_daily_bundle", query, access.token);
  const allowed = dashboardAllowedRows(access, bundles);
  return workOrderPayloadFromRows(allowed.flatMap(mapWorkOrderBundle), monthKeys);
}

export async function readSupabaseThirdPartySyncStatus(request: Request, startInput = "", endInput = ""): Promise<ThirdPartySyncStatus> {
  const access = await requireDashboardDataAccess(request, "third_party");
  requireDashboardAllData(access);
  const {token} = access;
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const start = isoDate(startInput) || yesterday;
  const end = isoDate(endInput) || start;
  const result = await callRpc<any>("dashboard_third_party_sync_status", { p_start: start, p_end: end }, token);
  return {
    ok: Boolean(result?.ok ?? true),
    start,
    end,
    historyTasks: Number(result?.historyTasks || 0),
    historySuccess: Number(result?.historySuccess || 0),
    historyRemaining: Number(result?.historyRemaining || 0),
    historyFailed: Number(result?.historyFailed || 0),
    historyRowsWritten: Number(result?.historyRowsWritten || 0),
    historyLatestSyncAt: result?.historyLatestSyncAt || null,
    historyComplete: Boolean(result?.historyComplete),
    dataDays: Number(result?.dataDays || 0),
    collectDays: Number(result?.collectDays || 0),
    payoutDays: Number(result?.payoutDays || 0),
    latestWriteAt: result?.latestWriteAt || null,
    ratesLatestWriteAt: result?.ratesLatestWriteAt || null,
  };
}

type DbRateRow = {
  id: string;
  sheet_name: string | null;
  country: string | null;
  category: string | null;
  third_party: string | null;
  collect_fee: string | null;
  payout_fee: string | null;
  total_fee: string | null;
  collect_single_fee: string | null;
  payout_single_fee: string | null;
  collect_limit: string | null;
  payout_limit: string | null;
  channel_info: string | null;
  leak: string | null;
  whitelist: string | null;
  status: string | null;
  source_row: number | null;
  updated_at: string | null;
};

type DbStatusRow = {
  id: string;
  sheet_name: string | null;
  country: string | null;
  platform: string | null;
  third_party: string | null;
  status: string | null;
  raw_status: string | null;
  collect_fee: string | null;
  payout_fee: string | null;
  total_fee: string | null;
  collect_single_fee: string | null;
  payout_single_fee: string | null;
  collect_limit: string | null;
  payout_limit: string | null;
  category: string | null;
  source_row: number | null;
  source_column: number | null;
  updated_at: string | null;
};

function mapRate(row: DbRateRow): ThirdPartyRateRow {
  return {
    id: String(row.id || ""),
    sheetName: String(row.sheet_name || ""),
    country: String(row.country || ""),
    category: String(row.category || ""),
    thirdParty: String(row.third_party || ""),
    collectFee: String(row.collect_fee || ""),
    payoutFee: String(row.payout_fee || ""),
    totalFee: String(row.total_fee || ""),
    collectSingleFee: String(row.collect_single_fee || ""),
    payoutSingleFee: String(row.payout_single_fee || ""),
    collectLimit: String(row.collect_limit || ""),
    payoutLimit: String(row.payout_limit || ""),
    channelInfo: String(row.channel_info || ""),
    leak: String(row.leak || ""),
    whitelist: String(row.whitelist || ""),
    status: String(row.status || ""),
    sourceRow: Number(row.source_row || 0)
  };
}

function mapStatus(row: DbStatusRow): ThirdPartyPlatformStatusRow {
  return {
    id: String(row.id || ""),
    sheetName: String(row.sheet_name || ""),
    country: platformDisplayCountry(String(row.country || ""), String(row.platform || "")),
    platform: String(row.platform || ""),
    thirdParty: String(row.third_party || ""),
    status: String(row.status || ""),
    rawStatus: String(row.raw_status || ""),
    collectFee: String(row.collect_fee || ""),
    payoutFee: String(row.payout_fee || ""),
    totalFee: String(row.total_fee || ""),
    collectSingleFee: String(row.collect_single_fee || ""),
    payoutSingleFee: String(row.payout_single_fee || ""),
    collectLimit: String(row.collect_limit || ""),
    payoutLimit: String(row.payout_limit || ""),
    category: String(row.category || ""),
    sourceRow: Number(row.source_row || 0),
    sourceColumn: Number(row.source_column || 0)
  };
}

function buildRateSummary(rates: ThirdPartyRateRow[], statuses: ThirdPartyPlatformStatusRow[]) {
  const statusCounts: Record<string, number> = {};
  for (const row of statuses) {
    const key = row.status || "未知";
    statusCounts[key] = (statusCounts[key] || 0) + 1;
  }
  return {
    totalStatusCells: statuses.length,
    totalPlatforms: new Set(statuses.map((row) => row.platform).filter(Boolean)).size,
    totalThirdParties: new Set([...rates.map((row) => row.thirdParty), ...statuses.map((row) => row.thirdParty)].filter(Boolean)).size,
    totalSheets: new Set([...rates.map((row) => row.sheetName), ...statuses.map((row) => row.sheetName)].filter(Boolean)).size,
    statusCounts,
    openCount: statusCounts["开启"] || 0,
    pauseCount: statusCounts["暂停"] || 0,
    backupCount: statusCounts["备用"] || 0,
    disabledCount: statusCounts["停用"] || 0,
    notConnectedCount: statusCounts["未接入"] || 0,
    maintenanceCount: statusCounts["维护"] || 0,
    unsupportedCount: statusCounts["不支持"] || 0
  };
}

export async function readSupabaseThirdPartyRates(request: Request): Promise<ThirdPartyRatePayload> {
  const access = await requireDashboardDataAccess(request, "third_party");
  const {token} = access;
  const rateQuery = new URLSearchParams();
  rateQuery.set("select", "id,sheet_name,country,category,third_party,collect_fee,payout_fee,total_fee,collect_single_fee,payout_single_fee,collect_limit,payout_limit,channel_info,leak,whitelist,status,source_row,updated_at");
  rateQuery.set("order", "country.asc,third_party.asc");
  const statusQuery = new URLSearchParams();
  statusQuery.set("select", "id,sheet_name,country,platform,third_party,status,raw_status,collect_fee,payout_fee,total_fee,collect_single_fee,payout_single_fee,collect_limit,payout_limit,category,source_row,source_column,updated_at");
  statusQuery.set("order", "country.asc,platform.asc,third_party.asc");

  const [fetchedRates, fetchedStatuses] = await Promise.all([
    fetchPaged<DbRateRow>("third_party_rates", rateQuery, token),
    fetchPaged<DbStatusRow>("third_party_platform_status", statusQuery, token)
  ]);
  const dbRates = dashboardAllowedRows(access, fetchedRates);
  const dbStatuses = dashboardAllowedRows(access, fetchedStatuses);
  const rates = dbRates.map(mapRate);
  const platformStatuses = dbStatuses.map(mapStatus);
  const updatedAt = [...dbRates.map((row) => String(row.updated_at || "")), ...dbStatuses.map((row) => String(row.updated_at || ""))]
    .filter(Boolean).sort().pop() || new Date().toISOString();
  const sheets = Array.from(new Set([...rates.map((row) => row.sheetName), ...platformStatuses.map((row) => row.sheetName)].filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  const now = new Date();
  return {
    meta: {
      year: String(now.getFullYear()),
      month: String(now.getMonth() + 1),
      updatedAt,
      source: "supabase" as any,
      sheets,
      message: "Supabase：费率及盘口状态直接来自数据库。",
      dataSource: "supabase" as any
    } as any,
    summary: buildRateSummary(rates, platformStatuses),
    rates,
    platformStatuses,
    anomalies: []
  };
}

export async function readSupabaseHomeStatus(request: Request) {
  const access = await requireDashboardDataAccess(request, "third_party");
  requireDashboardAllData(access);
  const {token, profile} = access;
  const { url, anonKey } = config();
  const statusParams = new URLSearchParams();
  statusParams.set("select", "module,last_sync_at,last_data_date,status,message,updated_at");
  statusParams.set("module", "in.(third_party_volume,third_party_rates)");
  const statusRes = await fetch(`${url}/rest/v1/sync_status?${statusParams.toString()}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store"
  });
  const statuses = await readJson(statusRes);
  const [volumeRows, rates, platformStatuses] = await Promise.all([
    fetchExactCount("third_party_volume", token),
    fetchExactCount("third_party_rates", token),
    fetchExactCount("third_party_platform_status", token)
  ]);
  const list = Array.isArray(statuses) ? statuses : [];
  const volume = list.find((x: any) => x.module === "third_party_volume") || null;
  const rate = list.find((x: any) => x.module === "third_party_rates") || null;
  return {
    ok: true,
    profile: { username: profile.username, role: profile.role },
    database: "connected",
    counts: { volumeRows, rates, platformStatuses },
    volume,
    ratesStatus: rate,
    checkedAt: new Date().toISOString()
  };
}
