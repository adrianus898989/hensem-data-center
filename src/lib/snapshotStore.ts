import type {
  AutoWithdrawPayload,
  CustomerServicePayload,
  ThirdPartyRatePayload,
  ThirdPartyVolumePayload,
  WorkOrderPayload
} from "./types";

export type SnapshotModuleKey =
  | "auto-withdraw"
  | "work-orders"
  | "third-party-volume"
  | "third-party-rates"
  | "customer-service";

export type SnapshotPayloadMap = {
  "auto-withdraw": AutoWithdrawPayload;
  "work-orders": WorkOrderPayload;
  "third-party-volume": ThirdPartyVolumePayload;
  "third-party-rates": ThirdPartyRatePayload;
  "customer-service": CustomerServicePayload;
};

export const SNAPSHOT_SCHEMA_VERSION = "v224";

export type DashboardSnapshot<T> = {
  ok: true;
  key: SnapshotModuleKey;
  updatedAt: string;
  source: "hourly-sync" | "manual-sync" | "live-fallback";
  schemaVersion?: string;
  checksum?: string;
  payload: T;
};

const STORE_NAME = process.env.DASHBOARD_SNAPSHOT_STORE || "hensem-dashboard-snapshots";

export const SNAPSHOT_KEYS: SnapshotModuleKey[] = [
  "auto-withdraw",
  "work-orders",
  "third-party-volume",
  "third-party-rates",
  "customer-service"
];

export function countSnapshotPayloadRows<K extends SnapshotModuleKey>(
  key: K,
  payload: SnapshotPayloadMap[K] | null | undefined
): number {
  const data = payload as any;
  if (!data || typeof data !== "object") return 0;

  if (key === "auto-withdraw") {
    return (data.dailyRows?.length || 0) + (data.monthlyRows?.length || 0) + (data.operatorRows?.length || 0);
  }
  if (key === "work-orders") return data.rows?.length || 0;
  if (key === "third-party-volume") return data.rows?.length || 0;
  if (key === "third-party-rates") return (data.rates?.length || 0) + (data.platformStatuses?.length || 0);
  if (key === "customer-service") return data.rows?.length || 0;
  return 0;
}

function payloadHasHardError(payload: any): boolean {
  const message = String(payload?.meta?.message || "");
  return /Quota exceeded|Read requests|rateLimitExceeded|userRateLimitExceeded|Unexpected end of JSON|读取失败|同步.*失败|Missing environment/i.test(message);
}

export function isSnapshotPayloadUsable<K extends SnapshotModuleKey>(
  key: K,
  payload: SnapshotPayloadMap[K] | null | undefined
): boolean {
  if (!payload || typeof payload !== "object") return false;

  const data = payload as any;
  const rows = countSnapshotPayloadRows(key, payload);

  // V200：只要旧快照有实际行数，就先允许作为页面兜底。
  // 之前只放行三方量/费率，工单快照里只要 meta 含“部分读取失败”就会被判无效，
  // 页面又去现场读 Google，现场失败就直接红屏。
  // 这里改成：有行数 = 可以显示；0 行/缺关键数据才无效。
  if (payloadHasHardError(payload) && rows <= 0) return false;

  if (key === "auto-withdraw") {
    const withdrawRows = (data.dailyRows?.length || 0) + (data.monthlyRows?.length || 0);
    const operatorRows = data.operatorRows?.length || 0;
    // 这个项目“自动出款”和“提现操作人”共用同一个快照。
    // 只要操作人是 0，就不能算有效快照，否则会出现自动出款有数据、操作人永远 0 的情况。
    // 后续如果真有不需要操作人数据的项目，可把 REQUIRE_AUTO_OPERATOR_SNAPSHOT=false。
    const requireOperator = String(process.env.REQUIRE_AUTO_OPERATOR_SNAPSHOT || "true").toLowerCase() !== "false";
    return withdrawRows > 0 && (!requireOperator || operatorRows > 0);
  }

  // 这些模块只要快照是 0 行，就不能认为是有效数据。
  // 这样可以自动忽略之前被失败同步覆盖出来的空快照。
  if (["work-orders", "third-party-volume", "third-party-rates"].includes(key)) {
    return rows > 0;
  }

  // 客服模块有些项目可能暂时没有数据，允许 0 行。
  return true;
}

function snapshotPayloadChecksum(payload: unknown): string {
  const data = payload && typeof payload === "object" ? payload as any : payload;
  const normalized = data && typeof data === "object"
    ? (() => {
        const meta = { ...(data.meta || {}) };
        delete meta.updatedAt;
        delete meta.snapshotUpdatedAt;
        delete meta.message;
        delete meta.liveError;
        delete meta.clientFallback;
        return { ...data, meta };
      })()
    : data;
  const text = JSON.stringify(normalized ?? null);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function getBlobStore() {
  const mod = await import("@netlify/blobs");
  return mod.getStore(STORE_NAME);
}

export function snapshotBlobKey(key: SnapshotModuleKey, suffix = ""): string {
  return suffix ? `${key}.${suffix}.json` : `${key}.json`;
}

export function lastGoodSnapshotBlobKey(key: SnapshotModuleKey): string {
  return snapshotBlobKey(key, "last-good");
}

function markPayloadFromSnapshot<T extends { meta?: Record<string, unknown> }>(
  payload: T,
  snapshot: DashboardSnapshot<T>
): T {
  if (!payload || typeof payload !== "object") return payload;
  const meta = {
    ...(payload.meta || {}),
    // 页面右上角/黄色提示必须显示“最后一次成功同步时间”，
    // 不再拿 Google 表里某一行的 updated_at 当成系统更新时间。
    updatedAt: snapshot.updatedAt,
    snapshot: true,
    snapshotUpdatedAt: snapshot.updatedAt,
    snapshotSource: snapshot.source,
    message: [
      payload.meta?.message,
      `当前显示自动同步快照，最后更新：${formatSnapshotTime(snapshot.updatedAt)}`
    ]
      .filter(Boolean)
      .join("；")
  };
  return { ...payload, meta };
}

async function readSnapshotByBlobKey<K extends SnapshotModuleKey>(
  key: K,
  blobKey: string
): Promise<DashboardSnapshot<SnapshotPayloadMap[K]> | null> {
  try {
    const store = await getBlobStore();
    const value = await store.get(blobKey, { type: "json" });
    if (!value || typeof value !== "object") return null;
    const snapshot = value as DashboardSnapshot<SnapshotPayloadMap[K]>;
    if (!snapshot.payload || !snapshot.updatedAt) return null;
    // 不再因为版本号不同就丢弃旧快照。
    // 否则每次上传新版本后，旧快照被判无效，页面会直接去 Google Sheet 现场读取，容易超时/空白。
    return snapshot;
  } catch {
    return null;
  }
}

export async function readSnapshot<K extends SnapshotModuleKey>(
  key: K
): Promise<DashboardSnapshot<SnapshotPayloadMap[K]> | null> {
  return readSnapshotByBlobKey(key, snapshotBlobKey(key));
}

export async function readLastGoodSnapshot<K extends SnapshotModuleKey>(
  key: K
): Promise<DashboardSnapshot<SnapshotPayloadMap[K]> | null> {
  return readSnapshotByBlobKey(key, lastGoodSnapshotBlobKey(key));
}

export async function readBestSnapshot<K extends SnapshotModuleKey>(
  key: K
): Promise<DashboardSnapshot<SnapshotPayloadMap[K]> | null> {
  const current = await readSnapshot(key);
  if (current?.payload && isSnapshotPayloadUsable(key, current.payload as SnapshotPayloadMap[K])) return current;

  const lastGood = await readLastGoodSnapshot(key);
  if (lastGood?.payload && isSnapshotPayloadUsable(key, lastGood.payload as SnapshotPayloadMap[K])) return lastGood;

  // 如果当前快照有行数但 meta 有异常字样，也先给页面兜底，不要红屏。
  if (current?.payload && countSnapshotPayloadRows(key, current.payload as SnapshotPayloadMap[K]) > 0) return current;
  if (lastGood?.payload && countSnapshotPayloadRows(key, lastGood.payload as SnapshotPayloadMap[K]) > 0) return lastGood;
  return null;
}

export async function readSnapshotPayload<K extends SnapshotModuleKey>(
  key: K
): Promise<SnapshotPayloadMap[K] | null> {
  const snapshot = await readBestSnapshot(key);
  if (!snapshot) return null;

  if (!isSnapshotPayloadUsable(key, snapshot.payload as SnapshotPayloadMap[K])) {
    return null;
  }

  return markPayloadFromSnapshot(snapshot.payload as SnapshotPayloadMap[K], snapshot) as SnapshotPayloadMap[K];
}

export async function writeSnapshot<K extends SnapshotModuleKey>(
  key: K,
  payload: SnapshotPayloadMap[K],
  source: DashboardSnapshot<SnapshotPayloadMap[K]>["source"] = "hourly-sync"
): Promise<DashboardSnapshot<SnapshotPayloadMap[K]>> {
  if (!isSnapshotPayloadUsable(key, payload)) {
    throw new Error(`${key} 快照无有效数据，本次不覆盖旧快照`);
  }

  const checksum = snapshotPayloadChecksum(payload);
  const existing = await readBestSnapshot(key).catch(() => null);
  if (existing?.checksum === checksum) return existing;

  const snapshot: DashboardSnapshot<SnapshotPayloadMap[K]> = {
    ok: true,
    key,
    updatedAt: new Date().toISOString(),
    source,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    checksum,
    payload
  };
  const store = await getBlobStore();
  const body = JSON.stringify(snapshot);
  // V221：current 与 last-good 并行写。三方量 5 万+ 行时，旧版顺序写两遍大 JSON，
  // 会把 Scheduled Function 的 30 秒/普通函数的 60 秒时间大量耗在重复上传上。
  const [currentWrite] = await Promise.allSettled([
    store.set(snapshotBlobKey(key), body),
    store.set(lastGoodSnapshotBlobKey(key), body)
  ]);
  if (currentWrite.status === "rejected") throw currentWrite.reason;
  return snapshot;
}

export async function readSnapshotCursor<T = any>(name: string): Promise<T | null> {
  try {
    const store = await getBlobStore();
    const value = await store.get(`cursor.${name}.json`, { type: "json" });
    if (!value || typeof value !== "object") return null;
    return value as T;
  } catch {
    return null;
  }
}

export async function writeSnapshotCursorStrict(name: string, value: any): Promise<void> {
  const store = await getBlobStore();
  await store.set(`cursor.${name}.json`, JSON.stringify({ ...value, updatedAt: new Date().toISOString() }));
}

export async function writeSnapshotCursor(name: string, value: any): Promise<void> {
  try {
    await writeSnapshotCursorStrict(name, value);
  } catch {
    // 普通数据读取游标失败时，下次重跑同一片即可；不能因此覆盖或清空已成功快照。
  }
}

export function formatSnapshotTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function jsonResponseHeaders(cacheSeconds = 60): HeadersInit {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 5}`
  };
}
