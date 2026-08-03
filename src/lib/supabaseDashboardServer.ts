import type {
  ThirdPartyPlatformStatusRow,
  ThirdPartyRatePayload,
  ThirdPartyRateRow,
  ThirdPartyVolumePayload,
  ThirdPartyVolumeRow
} from "@/lib/types";

const PAGE_SIZE = 1000;

function requiredEnv(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Netlify 缺少环境变量 ${name}`);
  return value;
}

function config() {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
  const anonKey = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return { url, anonKey };
}

function authTokenFromRequest(request: Request): string {
  const header = String(request.headers.get("authorization") || "");
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("未登录或登录状态已失效");
  return token;
}

async function readJson(response: Response) {
  const text = await response.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!response.ok) {
    const message = json?.message || json?.msg || json?.hint || text || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return json;
}

async function requireActiveProfile(token: string) {
  const { url, anonKey } = config();
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const user = await readJson(userRes);
  const userId = String(user?.id || "");
  if (!userId) throw new Error("登录状态无效");

  const params = new URLSearchParams();
  params.set("select", "auth_user_id,username,role,active,permissions,management_permissions");
  params.set("auth_user_id", `eq.${userId}`);
  params.set("limit", "1");
  const profileRes = await fetch(`${url}/rest/v1/dashboard_profiles?${params.toString()}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store"
  });
  const rows = await readJson(profileRes);
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile) throw new Error("这个账号还没有后台权限");
  if (!profile.active) throw new Error("这个账号已被停用");
  return profile as { auth_user_id: string; username: string; role: "owner" | "admin" | "viewer"; active: boolean; permissions?: Record<string, boolean> | null; management_permissions?: Record<string, boolean> | null };
}

async function fetchPaged<T>(table: string, query: URLSearchParams, token: string): Promise<T[]> {
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
      cache: "no-store"
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
    country: String(row.country || ""),
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

async function callRpc<T>(name: string, body: Record<string, unknown>, token: string): Promise<T> {
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
    cache: "no-store"
  });
  return await readJson(response) as T;
}

export async function readSupabaseThirdPartyVolume(request: Request, startInput = "", endInput = "", countryInput = ""): Promise<ThirdPartyVolumePayload> {
  const token = authTokenFromRequest(request);
  const profile = await requireActiveProfile(token);
  if (profile.role === "viewer" && profile.permissions?.third_party === false) throw new Error("这个账号没有三方量 / 费率查看权限");

  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const start = isoDate(startInput) || yesterday;
  const end = isoDate(endInput) || start;
  const country = String(countryInput || "").trim();
  const queryStart = previousDate(start);

  const result = await callRpc<any>("dashboard_third_party_volume_fast_v2", {
    p_start: start,
    p_end: end,
    p_country: country || null
  }, token);

  const dbRows: DbVolumeRow[] = Array.isArray(result?.rows) ? result.rows : [];
  const rows = dbRows.map(mapVolume);
  const updatedAt = String(result?.latestWriteAt || dbRows.map((row) => String(row.updated_at || "")).filter(Boolean).sort().pop() || new Date().toISOString());
  const sheets = Array.from(new Set(rows.map((row) => row.sheetName).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));

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
      rowCount: Number(result?.rowCount || rows.length),
      dataDays: Number(result?.dataDays || 0),
      countryCount: Number(result?.countryCount || 0),
      platformCount: Number(result?.platformCount || 0),
      channelCount: Number(result?.channelCount || 0),
      fastRpc: true
    } as any,
    rows,
    aliasMap: buildAliasMap(rows),
    summary: volumeSummary(rows),
    anomalies: []
  };
}

export async function readSupabaseThirdPartySyncStatus(request: Request, startInput = "", endInput = ""): Promise<ThirdPartySyncStatus> {
  const token = authTokenFromRequest(request);
  const profile = await requireActiveProfile(token);
  if (profile.role === "viewer" && profile.permissions?.third_party === false) throw new Error("这个账号没有三方量 / 费率查看权限");
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
    country: String(row.country || ""),
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
  const token = authTokenFromRequest(request);
  const profile = await requireActiveProfile(token);
  if (profile.role === "viewer" && profile.permissions?.third_party === false) throw new Error("这个账号没有三方量 / 费率查看权限");
  const rateQuery = new URLSearchParams();
  rateQuery.set("select", "id,sheet_name,country,category,third_party,collect_fee,payout_fee,total_fee,collect_single_fee,payout_single_fee,collect_limit,payout_limit,channel_info,leak,whitelist,status,source_row,updated_at");
  rateQuery.set("order", "country.asc,third_party.asc");
  const statusQuery = new URLSearchParams();
  statusQuery.set("select", "id,sheet_name,country,platform,third_party,status,raw_status,collect_fee,payout_fee,total_fee,collect_single_fee,payout_single_fee,collect_limit,payout_limit,category,source_row,source_column,updated_at");
  statusQuery.set("order", "country.asc,platform.asc,third_party.asc");

  const [dbRates, dbStatuses] = await Promise.all([
    fetchPaged<DbRateRow>("third_party_rates", rateQuery, token),
    fetchPaged<DbStatusRow>("third_party_platform_status", statusQuery, token)
  ]);
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
  const token = authTokenFromRequest(request);
  const profile = await requireActiveProfile(token);
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
