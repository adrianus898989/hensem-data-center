import type {
  AutoWithdrawPayload,
  CustomerServicePayload,
  DailyWithdrawRow,
  OperatorRow,
  ThirdPartyVolumePayload,
  WorkOrderPayload
} from "./types";
import {
  SNAPSHOT_SCHEMA_VERSION,
  countSnapshotPayloadRows,
  isSnapshotPayloadUsable,
  readBestSnapshot,
  readSnapshotCursor,
  writeSnapshotCursorStrict,
  type DashboardSnapshot,
  type SnapshotModuleKey,
  type SnapshotPayloadMap
} from "./snapshotStore";
import { normalizeThirdPartyVolumePayload } from "./parseThirdPartyVolume";

export type MonthlySnapshotModuleKey = Exclude<SnapshotModuleKey, "third-party-rates">;
export type MonthlySnapshotStatus = "current" | "settling" | "archived";

export type MonthlyDashboardSnapshot<K extends MonthlySnapshotModuleKey = MonthlySnapshotModuleKey> =
  DashboardSnapshot<SnapshotPayloadMap[K]> & {
    month: string;
    status: MonthlySnapshotStatus;
    checksum?: string;
    sealedAt?: string;
  };

const STORE_NAME = process.env.DASHBOARD_SNAPSHOT_STORE || "hensem-dashboard-snapshots";
export const MONTHLY_MODULE_KEYS: MonthlySnapshotModuleKey[] = [
  "auto-withdraw",
  "work-orders",
  "third-party-volume",
  "customer-service"
];

export type MonthlyCheckStatus = {
  key: MonthlySnapshotModuleKey;
  month: string;
  status: MonthlySnapshotStatus;
  checkedAt: string | null;
  changedAt: string | null;
  checksum: string;
  rows: number;
  ok: boolean;
  message?: string;
};

function monthlyStatusBlobKey(key: MonthlySnapshotModuleKey, month: string): string {
  return `status.monthly.${key}.${normalizeMonthKey(month)}.json`;
}

export async function writeMonthlyCheckStatus<K extends MonthlySnapshotModuleKey>(
  key: K,
  month: string,
  input: Partial<MonthlyCheckStatus> & { checkedAt?: string | null } = {}
): Promise<MonthlyCheckStatus> {
  const normalized = normalizeMonthKey(month);
  const needsSnapshotFallback = input.changedAt === undefined || input.checksum === undefined || input.rows === undefined;
  const existingSnapshot = needsSnapshotFallback
    ? await readBestMonthlySnapshot(key, normalized).catch(() => null)
    : null;
  const now = new Date().toISOString();
  const status: MonthlyCheckStatus = {
    key,
    month: normalized,
    status: effectiveMonthlyStatus(normalized),
    checkedAt: input.checkedAt || now,
    changedAt: input.changedAt ?? existingSnapshot?.updatedAt ?? null,
    checksum: String(input.checksum ?? existingSnapshot?.checksum ?? ""),
    rows: Number(input.rows ?? (existingSnapshot?.payload ? countSnapshotPayloadRows(key, existingSnapshot.payload as any) : 0)) || 0,
    ok: input.ok !== false,
    message: input.message
  };
  const store = await getBlobStore();
  await store.set(monthlyStatusBlobKey(key, normalized), JSON.stringify(status));
  return status;
}

export async function readMonthlyCheckStatus<K extends MonthlySnapshotModuleKey>(
  key: K,
  month: string
): Promise<MonthlyCheckStatus | null> {
  const normalized = normalizeMonthKey(month);
  if (!normalized) return null;
  try {
    const store = await getBlobStore();
    const value = await store.get(monthlyStatusBlobKey(key, normalized), { type: "json" });
    if (value && typeof value === "object") {
      const status = value as MonthlyCheckStatus;
      return { ...status, key, month: normalized, status: effectiveMonthlyStatus(normalized) };
    }
  } catch {
    // 旧版本还没有小状态文件时，下面从月快照补一个只读状态。
  }
  const snapshot = await readBestMonthlySnapshot(key, normalized).catch(() => null);
  if (!snapshot) return null;
  return {
    key,
    month: normalized,
    status: effectiveMonthlyStatus(normalized),
    checkedAt: snapshot.updatedAt || null,
    changedAt: snapshot.updatedAt || null,
    checksum: String(snapshot.checksum || ""),
    rows: snapshot.payload ? countSnapshotPayloadRows(key, snapshot.payload as any) : 0,
    ok: true
  };
}


async function getBlobStore() {
  const mod = await import("@netlify/blobs");
  return mod.getStore(STORE_NAME);
}

export function normalizeMonthKey(value: string): string {
  const match = String(value || "").trim().match(/(20\d{2})[-_\/.年]?(\d{1,2})/);
  if (!match) return "";
  const month = Number(match[2]);
  if (month < 1 || month > 12) return "";
  return `${match[1]}_${String(month).padStart(2, "0")}`;
}

export function monthKeyFromDateValue(value: string): string {
  const text = String(value || "").trim();
  let match = text.match(/^(20\d{2})[-\/.](\d{1,2})/);
  if (match) return `${match[1]}_${String(Number(match[2])).padStart(2, "0")}`;
  match = text.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](20\d{2})/);
  if (match) return `${match[3]}_${String(Number(match[2])).padStart(2, "0")}`;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return currentMonthKey(parsed);
  return "";
}

export function currentMonthKey(now = new Date()): string {
  return `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function previousMonthKey(now = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return currentMonthKey(date);
}

export function settlementGraceDays(): number {
  const raw = Number(process.env.MONTH_SETTLEMENT_GRACE_DAYS || 7);
  if (!Number.isFinite(raw)) return 7;
  return Math.max(1, Math.min(14, Math.floor(raw)));
}

export function isSettlementMonth(month: string, now = new Date()): boolean {
  const normalized = normalizeMonthKey(month);
  return normalized === previousMonthKey(now) && now.getDate() <= settlementGraceDays();
}

/**
 * 当前月始终可写；每月前 7 天，上个月处于“结算中”，仍允许补齐月底迟到数据。
 * 例如 8/1-8/7：2026_07 + 2026_08；8/8 起：只写 2026_08。
 */
export function writableMonthlyKeys(now = new Date()): string[] {
  const current = currentMonthKey(now);
  return isSettlementMonth(previousMonthKey(now), now)
    ? [previousMonthKey(now), current]
    : [current];
}

/**
 * 定时同步与页面月份规则完全一致：
 * - 当前月：每小时更新。
 * - 每月 1-7 日：上个月仍在结算，也每小时更新。
 * - 每月 8 日起：上个月及更早月份全部历史封存，不再参与任何定时读取。
 */
export function scheduledWritableMonthlyKeys(now = new Date()): string[] {
  return writableMonthlyKeys(now);
}

export function compareMonthKeys(a: string, b: string): number {
  return normalizeMonthKey(a).localeCompare(normalizeMonthKey(b));
}

export function defaultHistoryStartMonth(): string {
  return normalizeMonthKey(process.env.DASHBOARD_HISTORY_START_MONTH || "2026_04") || "2026_04";
}

export function monthsBetweenKeys(startValue: string, endValue: string): string[] {
  const start = normalizeMonthKey(startValue);
  const end = normalizeMonthKey(endValue);
  if (!start || !end || start > end) return [];
  const [sy, sm] = start.split("_").map(Number);
  const [ey, em] = end.split("_").map(Number);
  const cursor = new Date(sy, sm - 1, 1);
  const last = new Date(ey, em - 1, 1);
  const result: string[] = [];
  while (cursor <= last && result.length < 120) {
    result.push(currentMonthKey(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return result;
}

export function defaultDashboardMonths(now = new Date()): string[] {
  return monthsBetweenKeys(defaultHistoryStartMonth(), currentMonthKey(now));
}

export function effectiveMonthlyStatus(month: string, now = new Date()): MonthlySnapshotStatus {
  const normalized = normalizeMonthKey(month);
  if (normalized === currentMonthKey(now)) return "current";
  if (isSettlementMonth(normalized, now)) return "settling";
  return "archived";
}

export function monthlySnapshotBlobKey(key: MonthlySnapshotModuleKey, month: string, suffix = ""): string {
  const normalized = normalizeMonthKey(month);
  return `${key}.month.${normalized}${suffix ? `.${suffix}` : ""}.json`;
}

function payloadChecksum(payload: unknown): string {
  const text = JSON.stringify(payload || null);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function payloadContentChecksum(payload: unknown): string {
  if (!payload || typeof payload !== "object") return payloadChecksum(payload);
  const data = payload as any;
  const meta = { ...(data.meta || {}) };
  delete meta.updatedAt;
  delete meta.snapshotUpdatedAt;
  delete meta.message;
  delete meta.liveError;
  delete meta.clientFallback;
  return payloadChecksum({ ...data, meta });
}

async function readMonthlyByBlobKey<K extends MonthlySnapshotModuleKey>(
  key: K,
  month: string,
  blobKey: string
): Promise<MonthlyDashboardSnapshot<K> | null> {
  try {
    const store = await getBlobStore();
    const value = await store.get(blobKey, { type: "json" });
    if (!value || typeof value !== "object") return null;
    const snapshot = value as MonthlyDashboardSnapshot<K>;
    if (!snapshot.payload || !snapshot.updatedAt) return null;
    return {
      ...snapshot,
      month: normalizeMonthKey(snapshot.month || month),
      status: effectiveMonthlyStatus(snapshot.month || month)
    };
  } catch {
    return null;
  }
}

export async function readMonthlySnapshot<K extends MonthlySnapshotModuleKey>(
  key: K,
  month: string
): Promise<MonthlyDashboardSnapshot<K> | null> {
  return readMonthlyByBlobKey(key, month, monthlySnapshotBlobKey(key, month));
}

export async function readMonthlyLastGoodSnapshot<K extends MonthlySnapshotModuleKey>(
  key: K,
  month: string
): Promise<MonthlyDashboardSnapshot<K> | null> {
  return readMonthlyByBlobKey(key, month, monthlySnapshotBlobKey(key, month, "last-good"));
}

export async function readBestMonthlySnapshot<K extends MonthlySnapshotModuleKey>(
  key: K,
  month: string
): Promise<MonthlyDashboardSnapshot<K> | null> {
  const current = await readMonthlySnapshot(key, month);
  if (current?.payload && isSnapshotPayloadUsable(key, current.payload as any)) return current;
  const lastGood = await readMonthlyLastGoodSnapshot(key, month);
  if (lastGood?.payload && isSnapshotPayloadUsable(key, lastGood.payload as any)) return lastGood;
  if (current?.payload && countSnapshotPayloadRows(key, current.payload as any) > 0) return current;
  if (lastGood?.payload && countSnapshotPayloadRows(key, lastGood.payload as any) > 0) return lastGood;
  return null;
}

export async function writeMonthlySnapshot<K extends MonthlySnapshotModuleKey>(
  key: K,
  month: string,
  payload: SnapshotPayloadMap[K],
  source: DashboardSnapshot<SnapshotPayloadMap[K]>["source"] = "hourly-sync",
  options: { status?: MonthlySnapshotStatus; forceRebuild?: boolean } = {}
): Promise<MonthlyDashboardSnapshot<K>> {
  const normalized = normalizeMonthKey(month);
  if (!normalized) throw new Error(`无效月份：${month}`);
  if (!isSnapshotPayloadUsable(key, payload)) throw new Error(`${key}/${normalized} 没有有效数据，本次不覆盖旧月快照`);

  const existing = await readBestMonthlySnapshot(key, normalized);
  const effectiveStatus = effectiveMonthlyStatus(normalized);
  // V236：当前月正常写；月初结算期（默认 7 天）允许继续补上个月。
  // 超过结算期后才真正永久锁定历史月。
  if (effectiveStatus === "archived") {
    if (existing) return existing;
    throw new Error(`${key}/${normalized} 已超过结算期并进入历史，历史快照永久锁定，拒绝新建或覆盖`);
  }

  const status = options.status || effectiveStatus;
  const checksum = payloadContentChecksum(payload);
  const checkedAt = new Date().toISOString();
  const rows = countSnapshotPayloadRows(key, payload as any);
  // V237：数据内容没变化时，只写几十/几百字节的“最后检查状态”，不再重写大月快照。
  // 页面每小时只检查这个小状态；checksum 没变就不重新下载大 JSON。
  if (existing?.checksum === checksum && existing.status === status) {
    await writeMonthlyCheckStatus(key, normalized, {
      checkedAt,
      changedAt: existing.updatedAt,
      checksum,
      rows,
      ok: true,
      message: "Google Sheet 已检查，数据内容无变化"
    }).catch(() => undefined);
    return existing;
  }

  const now = checkedAt;
  const snapshot: MonthlyDashboardSnapshot<K> = {
    ok: true,
    key,
    month: normalized,
    status,
    updatedAt: now,
    sealedAt: status === "archived" ? existing?.sealedAt || now : undefined,
    source,
    schemaVersion: "v236-monthly",
    checksum,
    payload
  };
  const store = await getBlobStore();
  const body = JSON.stringify(snapshot);
  const writes = await Promise.allSettled([
    store.set(monthlySnapshotBlobKey(key, normalized), body),
    store.set(monthlySnapshotBlobKey(key, normalized, "last-good"), body)
  ]);
  if (writes[0].status === "rejected") throw writes[0].reason;
  await writeMonthlyCheckStatus(key, normalized, {
    checkedAt: now,
    changedAt: now,
    checksum,
    rows,
    ok: true,
    message: "月快照内容已更新"
  }).catch(() => undefined);
  return snapshot;
}

/**
 * 只在历史月快照完全缺失时创建一次。
 *
 * 用途：从旧的大快照中拆出 4/5/6 月并落成独立月快照。
 * 已存在的历史月永远直接返回，任何代码都不能覆盖。
 */
export async function writeArchivedMonthlySnapshotIfMissing<K extends MonthlySnapshotModuleKey>(
  key: K,
  month: string,
  payload: SnapshotPayloadMap[K],
  source: DashboardSnapshot<SnapshotPayloadMap[K]>["source"] = "manual-sync"
): Promise<MonthlyDashboardSnapshot<K>> {
  const normalized = normalizeMonthKey(month);
  if (!normalized) throw new Error(`无效月份：${month}`);

  const statusNow = effectiveMonthlyStatus(normalized);
  if (statusNow !== "archived") {
    return writeMonthlySnapshot(key, normalized, payload, source, { status: statusNow });
  }

  const existing = await readBestMonthlySnapshot(key, normalized);
  if (existing) return existing;
  if (!isSnapshotPayloadUsable(key, payload)) {
    throw new Error(`${key}/${normalized} 没有有效数据，不能建立历史快照`);
  }

  const now = new Date().toISOString();
  const snapshot: MonthlyDashboardSnapshot<K> = {
    ok: true,
    key,
    month: normalized,
    status: "archived",
    updatedAt: now,
    sealedAt: now,
    source,
    schemaVersion: "v236-monthly-history-once",
    checksum: payloadContentChecksum(payload),
    payload
  };
  const store = await getBlobStore();
  const body = JSON.stringify(snapshot);
  const writes = await Promise.allSettled([
    store.set(monthlySnapshotBlobKey(key, normalized), body),
    store.set(monthlySnapshotBlobKey(key, normalized, "last-good"), body)
  ]);
  if (writes[0].status === "rejected") throw writes[0].reason;
  await writeMonthlyCheckStatus(key, normalized, {
    checkedAt: now,
    changedAt: now,
    checksum: snapshot.checksum || "",
    rows: countSnapshotPayloadRows(key, payload as any),
    ok: true,
    message: "历史月快照已建立并永久封存"
  }).catch(() => undefined);
  return snapshot;
}

export async function archiveMonthlySnapshot<K extends MonthlySnapshotModuleKey>(
  key: K,
  month: string
): Promise<MonthlyDashboardSnapshot<K> | null> {
  const normalized = normalizeMonthKey(month);
  const snapshot = await readBestMonthlySnapshot(key, normalized);
  if (!snapshot) return null;
  if (effectiveMonthlyStatus(normalized) !== "archived") return snapshot;
  if (snapshot.status === "archived" && snapshot.sealedAt) return snapshot;

  const now = new Date().toISOString();
  const archived: MonthlyDashboardSnapshot<K> = {
    ...snapshot,
    month: normalized,
    status: "archived",
    sealedAt: snapshot.sealedAt || now,
    schemaVersion: "v238-monthly-archived"
  };
  const store = await getBlobStore();
  const body = JSON.stringify(archived);
  const writes = await Promise.allSettled([
    store.set(monthlySnapshotBlobKey(key, normalized), body),
    store.set(monthlySnapshotBlobKey(key, normalized, "last-good"), body)
  ]);
  if (writes[0].status === "rejected") throw writes[0].reason;
  return archived;
}

function parseSeconds(value: string): number {
  const text = String(value || "");
  let seconds = 0;
  const h = text.match(/(\d+)\s*(?:小时|时|h)/i);
  const m = text.match(/(\d+)\s*(?:分钟|分|m)/i);
  const s = text.match(/(\d+)\s*(?:秒|s)/i);
  if (h) seconds += Number(h[1]) * 3600;
  if (m) seconds += Number(m[1]) * 60;
  if (s) seconds += Number(s[1]);
  return seconds;
}

function formatSeconds(seconds: number): string {
  const value = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  if (h) return `${h}时${m}分${s}秒`;
  if (m) return `${m}分${s}秒`;
  return `${s}秒`;
}

function rebuildAutoMonthlyRows(dailyRows: DailyWithdrawRow[]) {
  const map = new Map<string, any>();
  for (const row of dailyRows) {
    const key = `${row.country}|||${row.platform}`;
    const current = map.get(key) || {
      country: row.country,
      platform: row.platform,
      total: 0,
      success: 0,
      rejected: 0,
      autoCount: 0,
      manualCount: 0,
      weightedSeconds: 0,
      sourceSheet: row.sourceSheet || "raw"
    };
    const total = Number(row.total) || 0;
    current.total += total;
    current.success += Number(row.success) || 0;
    current.rejected += Number(row.rejected) || 0;
    current.autoCount += Number(row.autoCount) || 0;
    current.manualCount += Number(row.manualCount) || 0;
    current.weightedSeconds += parseSeconds(row.avgTime) * total;
    map.set(key, current);
  }
  return Array.from(map.values()).map((row) => ({
    country: row.country,
    platform: row.platform,
    total: row.total,
    success: row.success,
    rejected: row.rejected,
    successRate: row.total ? row.success / row.total : 0,
    rejectRate: row.total ? row.rejected / row.total : 0,
    autoCount: row.autoCount,
    manualCount: row.manualCount,
    autoRate: row.total ? row.autoCount / row.total : 0,
    manualRate: row.total ? row.manualCount / row.total : 0,
    avgTime: row.total ? formatSeconds(row.weightedSeconds / row.total) : "0秒",
    yesterdayAvgTime: "-",
    comparePercent: "-",
    sourceSheet: row.sourceSheet
  }));
}

function workOrderSummary(rows: WorkOrderPayload["rows"]): WorkOrderPayload["summary"] {
  return {
    total: rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0),
    success: rows.reduce((sum, row) => sum + (Number(row.success) || 0), 0),
    failed: rows.reduce((sum, row) => sum + (Number(row.failed) || 0), 0),
    pending: rows.reduce((sum, row) => sum + (Number(row.pending) || 0), 0),
    amount: rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    countries: new Set(rows.map((row) => row.country).filter(Boolean)).size,
    platforms: new Set(rows.map((row) => row.platform).filter(Boolean)).size,
    types: new Set(rows.map((row) => row.workType).filter(Boolean)).size,
    names: new Set(rows.map((row) => row.workName).filter(Boolean)).size,
    operators: new Set(rows.map((row) => row.operator).filter(Boolean)).size
  };
}

function customerServiceSummary(rows: CustomerServicePayload["rows"], sheets: string[]) {
  return {
    rows: rows.length,
    sheets: sheets.length,
    countries: new Set(rows.map((row) => row.country).filter(Boolean)).size,
    platforms: new Set(rows.map((row) => row.platform).filter(Boolean)).size,
    staff: new Set(rows.map((row) => row.staff).filter(Boolean)).size,
    teams: new Set(rows.map((row) => row.team).filter(Boolean)).size,
    metricTotal: rows.reduce((sum, row) => sum + (Number(row.metricValue) || 0), 0)
  };
}

export function splitPayloadByMonth<K extends MonthlySnapshotModuleKey>(
  key: K,
  payload: SnapshotPayloadMap[K]
): Map<string, SnapshotPayloadMap[K]> {
  const result = new Map<string, SnapshotPayloadMap[K]>();
  const data = payload as any;
  const months = new Set<string>();
  if (key === "auto-withdraw") {
    for (const row of [...(data.dailyRows || []), ...(data.operatorRows || [])]) {
      const month = monthKeyFromDateValue(row.date);
      if (month) months.add(month);
    }
    for (const month of months) {
      const dailyRows = (data.dailyRows || []).filter((row: DailyWithdrawRow) => monthKeyFromDateValue(row.date) === month);
      const operatorRows = (data.operatorRows || []).filter((row: OperatorRow) => monthKeyFromDateValue(row.date) === month);
      result.set(month, {
        ...data,
        monthlyRows: rebuildAutoMonthlyRows(dailyRows),
        dailyRows,
        operatorRows,
        meta: { ...data.meta, month: month.split("_")[1], year: month.split("_")[0] }
      });
    }
  } else if (key === "work-orders") {
    for (const row of data.rows || []) {
      const month = monthKeyFromDateValue(row.date);
      if (month) months.add(month);
    }
    for (const month of months) {
      const rows = (data.rows || []).filter((row: any) => monthKeyFromDateValue(row.date) === month);
      result.set(month, { ...data, rows, summary: workOrderSummary(rows), meta: { ...data.meta, month: month.split("_")[1], year: month.split("_")[0] } });
    }
  } else if (key === "third-party-volume") {
    for (const row of data.rows || []) {
      const month = monthKeyFromDateValue(row.date);
      if (month) months.add(month);
    }
    for (const month of months) {
      const rows = (data.rows || []).filter((row: any) => monthKeyFromDateValue(row.date) === month);
      result.set(month, normalizeThirdPartyVolumePayload({ ...data, rows, meta: { ...data.meta, month: month.split("_")[1], year: month.split("_")[0] } } as ThirdPartyVolumePayload) as SnapshotPayloadMap[K]);
    }
  } else if (key === "customer-service") {
    for (const row of data.rows || []) {
      const month = monthKeyFromDateValue(row.date);
      if (month) months.add(month);
    }
    for (const month of months) {
      const rows = (data.rows || []).filter((row: any) => monthKeyFromDateValue(row.date) === month);
      const sheets = Array.from(new Set(rows.map((row: any) => row.sheetName).filter(Boolean))) as string[];
      result.set(month, { ...data, rows, summary: customerServiceSummary(rows, sheets), meta: { ...data.meta, sheets, month: month.split("_")[1], year: month.split("_")[0] } });
    }
  }
  return result;
}

export function combineMonthlyPayloads<K extends MonthlySnapshotModuleKey>(
  key: K,
  snapshots: MonthlyDashboardSnapshot<K>[]
): SnapshotPayloadMap[K] | null {
  if (!snapshots.length) return null;
  const sorted = [...snapshots].sort((a, b) => compareMonthKeys(a.month, b.month));
  const latest = sorted[sorted.length - 1];
  const payloads = sorted.map((item) => item.payload as any);
  const monthlyInfo = sorted.map((item) => ({
    month: item.month,
    status: item.status,
    updatedAt: item.updatedAt,
    checksum: String(item.checksum || ""),
    rows: countSnapshotPayloadRows(key, item.payload as any)
  }));
  const snapshotVersion = monthlyInfo.map((item) => `${item.month}:${item.checksum || item.updatedAt || item.rows}`).join("|");
  const message = `V238 月度独立快照：${monthlyInfo.map((item) => `${item.month.replace("_", "-")} ${item.status === "archived" ? "已封存" : item.status === "settling" ? "结算中" : "当前月"}`).join("、")}；历史月份不会被每小时任务重复读取。`;

  if (key === "auto-withdraw") {
    const dailyRows = payloads.flatMap((payload) => payload.dailyRows || []);
    const operatorRows = payloads.flatMap((payload) => payload.operatorRows || []);
    return {
      ...latest.payload,
      dailyRows,
      operatorRows,
      monthlyRows: rebuildAutoMonthlyRows(dailyRows),
      meta: { ...(latest.payload as any).meta, updatedAt: latest.updatedAt, monthlySnapshots: monthlyInfo, snapshotVersion, message: [message, (latest.payload as any).meta?.message].filter(Boolean).join("；") }
    } as SnapshotPayloadMap[K];
  }
  if (key === "work-orders") {
    const rows = payloads.flatMap((payload) => payload.rows || []);
    const sheets = Array.from(new Set(payloads.flatMap((payload) => payload.meta?.sheets || [])));
    return {
      ...latest.payload,
      rows,
      summary: workOrderSummary(rows),
      anomalies: Array.from(new Set(payloads.flatMap((payload) => payload.anomalies || []))).slice(0, 300),
      meta: { ...(latest.payload as any).meta, sheets, updatedAt: latest.updatedAt, monthlySnapshots: monthlyInfo, snapshotVersion, message: [message, (latest.payload as any).meta?.message].filter(Boolean).join("；") }
    } as SnapshotPayloadMap[K];
  }
  if (key === "third-party-volume") {
    const rows = payloads.flatMap((payload) => payload.rows || []);
    const combined = normalizeThirdPartyVolumePayload({
      ...(latest.payload as any),
      rows,
      aliasMap: Object.assign({}, ...payloads.map((payload) => payload.aliasMap || {})),
      anomalies: Array.from(new Set(payloads.flatMap((payload) => payload.anomalies || []))).slice(0, 300),
      meta: {
        ...(latest.payload as any).meta,
        sheets: Array.from(new Set(payloads.flatMap((payload) => payload.meta?.sheets || []))),
        updatedAt: latest.updatedAt,
        monthlySnapshots: monthlyInfo,
        message: [message, (latest.payload as any).meta?.message].filter(Boolean).join("；")
      }
    } as ThirdPartyVolumePayload);
    return combined as SnapshotPayloadMap[K];
  }
  const rows = payloads.flatMap((payload) => payload.rows || []);
  const sheets = Array.from(new Set(payloads.flatMap((payload) => payload.meta?.sheets || [])));
  return {
    ...latest.payload,
    rows,
    summary: customerServiceSummary(rows, sheets),
    meta: { ...(latest.payload as any).meta, sheets, updatedAt: latest.updatedAt, monthlySnapshots: monthlyInfo, snapshotVersion, message: [message, (latest.payload as any).meta?.message].filter(Boolean).join("；") }
  } as SnapshotPayloadMap[K];
}

export async function migrateLegacyMonthSnapshot<K extends MonthlySnapshotModuleKey>(
  key: K,
  month: string
): Promise<boolean> {
  const normalized = normalizeMonthKey(month);
  if (!normalized) return false;
  const existing = await readBestMonthlySnapshot(key, normalized);
  if (existing) return false;
  const legacy = await readBestSnapshot(key).catch(() => null);
  if (!legacy?.payload) return false;
  const split = splitPayloadByMonth(key, legacy.payload as SnapshotPayloadMap[K]);
  const payload = split.get(normalized);
  if (!payload) return false;
  if (normalized === currentMonthKey()) {
    await writeMonthlySnapshot(key, normalized, payload, legacy.source, { status: "current" });
  } else {
    await writeArchivedMonthlySnapshotIfMissing(key, normalized, payload, legacy.source);
  }
  return true;
}

export async function migrateLegacySnapshotToMonthly<K extends MonthlySnapshotModuleKey>(
  key: K,
  maxCreates = Number.POSITIVE_INFINITY
): Promise<number> {
  const legacy = await readBestSnapshot(key).catch(() => null);
  if (!legacy?.payload) return 0;
  const split = splitPayloadByMonth(key, legacy.payload as SnapshotPayloadMap[K]);
  let created = 0;
  for (const [month, payload] of split.entries()) {
    if (created >= maxCreates) break;
    const existing = await readBestMonthlySnapshot(key, month);
    if (existing) continue;
    if (month === currentMonthKey()) {
      await writeMonthlySnapshot(key, month, payload, legacy.source, { status: "current" });
    } else {
      await writeArchivedMonthlySnapshotIfMissing(key, month, payload, legacy.source);
    }
    created += 1;
  }
  return created;
}

export async function migrateAllLegacySnapshotsToMonthly(maxCreatesPerModule = 1): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const key of MONTHLY_MODULE_KEYS) {
    result[key] = await migrateLegacySnapshotToMonthly(key, maxCreatesPerModule).catch(() => 0);
  }
  return result;
}

export async function ensureLegacyArchivedMonthlySnapshots<K extends MonthlySnapshotModuleKey>(
  key: K,
  now = new Date()
): Promise<{ created: number; complete: boolean }> {
  const cursorName = `monthly-legacy-migrated-v238-${key}`;
  const marker = await readSnapshotCursor<{ complete?: boolean; attemptedAt?: string }>(cursorName).catch(() => null);
  if (marker?.complete) return { created: 0, complete: true };
  const attemptedAt = new Date(String(marker?.attemptedAt || "")).getTime();
  // 未能从旧大快照补齐时，6 小时内不因用户反复 F5 再扫描大快照。
  if (Number.isFinite(attemptedAt) && Date.now() - attemptedAt < 6 * 60 * 60 * 1000) {
    return { created: 0, complete: false };
  }

  const archivedMonths = monthsBetweenKeys(defaultHistoryStartMonth(), previousMonthKey(now))
    .filter((month) => effectiveMonthlyStatus(month, now) === "archived");
  if (!archivedMonths.length) {
    await writeSnapshotCursorStrict(cursorName, { complete: true, checkedAt: new Date().toISOString() }).catch(() => undefined);
    return { created: 0, complete: true };
  }

  const snapshots = await Promise.all(archivedMonths.map((month) => readBestMonthlySnapshot(key, month)));
  const missing = archivedMonths.filter((_, index) => !snapshots[index]);
  if (!missing.length) {
    await writeSnapshotCursorStrict(cursorName, { complete: true, checkedAt: new Date().toISOString(), months: archivedMonths }).catch(() => undefined);
    return { created: 0, complete: true };
  }

  // 只从旧大快照拆分，不在用户打开页面时访问 Google Sheet。
  // 这一步最多执行一次；拆成功后 4/5/6 等月份永久使用小月快照。
  const legacy = await readBestSnapshot(key).catch(() => null);
  if (!legacy?.payload) {
    await writeSnapshotCursorStrict(cursorName, { complete: false, attemptedAt: new Date().toISOString() }).catch(() => undefined);
    return { created: 0, complete: false };
  }
  const split = splitPayloadByMonth(key, legacy.payload as SnapshotPayloadMap[K]);
  let created = 0;
  for (const month of missing) {
    const payload = split.get(month);
    if (!payload) continue;
    await writeArchivedMonthlySnapshotIfMissing(key, month, payload, legacy.source).catch(() => undefined);
    created += 1;
  }

  const after = await Promise.all(archivedMonths.map((month) => readBestMonthlySnapshot(key, month)));
  const complete = after.every(Boolean);
  if (complete) {
    await writeSnapshotCursorStrict(cursorName, { complete: true, checkedAt: new Date().toISOString(), attemptedAt: new Date().toISOString(), months: archivedMonths }).catch(() => undefined);
  } else {
    await writeSnapshotCursorStrict(cursorName, { complete: false, attemptedAt: new Date().toISOString() }).catch(() => undefined);
  }
  return { created, complete };
}

export async function readCombinedMonthlyPayload<K extends MonthlySnapshotModuleKey>(
  key: K,
  months: string[] = defaultDashboardMonths()
): Promise<SnapshotPayloadMap[K] | null> {
  const normalizedMonths = Array.from(new Set(months.map(normalizeMonthKey).filter(Boolean))).sort(compareMonthKeys);
  const monthly = await Promise.all(normalizedMonths.map((month) => readBestMonthlySnapshot(key, month)));
  const byMonth = new Map<string, MonthlyDashboardSnapshot<K>>();
  monthly.filter(Boolean).forEach((snapshot) => byMonth.set((snapshot as MonthlyDashboardSnapshot<K>).month, snapshot as MonthlyDashboardSnapshot<K>));

  // 月快照缺失时，优先从旧大快照拆分。
  // 历史月只允许“缺失时创建一次”，绝不覆盖；因此 4/5/6 月恢复后会永久保留。
  // 默认页面只请求当前月，不会因为打开网页一次处理全部历史，避免大流量和长函数。
  const missingArchivedMonths = normalizedMonths.filter((month) => !byMonth.has(month) && effectiveMonthlyStatus(month) === "archived");
  if (missingArchivedMonths.length) {
    // V237：旧大快照只用于“已经封存的历史月”一次性迁移。
    // 当前月/结算月如果暂时没快照，绝不因为用户 F5 去扫描旧大快照。
    const legacy = await readBestSnapshot(key).catch(() => null);
    if (legacy?.payload) {
      const split = splitPayloadByMonth(key, legacy.payload as SnapshotPayloadMap[K]);
      const persistTasks: Promise<unknown>[] = [];
      for (const month of missingArchivedMonths) {
        if (byMonth.has(month)) continue;
        const payload = split.get(month);
        if (!payload) continue;
        const temporary = {
          ok: true,
          key,
          month,
          status: effectiveMonthlyStatus(month),
          updatedAt: legacy.updatedAt,
          source: legacy.source,
          schemaVersion: legacy.schemaVersion || SNAPSHOT_SCHEMA_VERSION,
          payload
        } as MonthlyDashboardSnapshot<K>;
        byMonth.set(month, temporary);

        if (month !== currentMonthKey()) {
          persistTasks.push(writeArchivedMonthlySnapshotIfMissing(key, month, payload, legacy.source).catch(() => undefined));
        }
      }
      // 一次历史查询通常只有一个月；写入完成后下次直接读小月快照，不再反复拆旧大快照。
      if (persistTasks.length) await Promise.allSettled(persistTasks);
    }
  }

  return combineMonthlyPayloads(key, Array.from(byMonth.values()));
}


export async function missingMonthlySnapshotMonths<K extends MonthlySnapshotModuleKey>(
  key: K,
  months: string[]
): Promise<string[]> {
  const normalizedMonths = Array.from(new Set(months.map(normalizeMonthKey).filter(Boolean))).sort(compareMonthKeys);
  if (!normalizedMonths.length) return [];
  const snapshots = await Promise.all(normalizedMonths.map((month) => readBestMonthlySnapshot(key, month)));
  return normalizedMonths.filter((month, index) => !snapshots[index]);
}

export async function currentMonthlySnapshotInfo(key: MonthlySnapshotModuleKey) {
  const month = currentMonthKey();
  const snapshot = await readBestMonthlySnapshot(key, month);
  return {
    month,
    updatedAt: snapshot?.updatedAt || null,
    rows: snapshot?.payload ? countSnapshotPayloadRows(key, snapshot.payload as any) : 0,
    status: snapshot?.status || "current"
  };
}

export function requestedMonthsFromUrl(url: URL): string[] {
  const explicit = [
    ...url.searchParams.getAll("month"),
    ...String(url.searchParams.get("months") || "").split(/[\n,]+/)
  ].map(normalizeMonthKey).filter(Boolean);
  if (explicit.length) return Array.from(new Set(explicit)).sort(compareMonthKeys);

  const start = url.searchParams.get("start") || url.searchParams.get("startDate") || "";
  const end = url.searchParams.get("end") || url.searchParams.get("endDate") || start;
  const startMonth = monthKeyFromDateValue(start);
  const endMonth = monthKeyFromDateValue(end);
  if (startMonth && endMonth) return monthsBetweenKeys(startMonth, endMonth);
  // V237：普通打开页面只请求当前自然月。
  // 月初当前月暂时没有数据时，各 API 路由会单独回退到“上月结算快照”，但绝不把两个月一起下发。
  return [currentMonthKey()];
}

export const MONTHLY_SNAPSHOT_SCHEMA_VERSION = `${SNAPSHOT_SCHEMA_VERSION}-monthly-v238`;
