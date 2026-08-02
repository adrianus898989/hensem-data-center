import { getThirdPartyVolumePayload } from "./googleSheets";
import { compactThirdPartyVolumePayloadForDashboard, normalizeThirdPartyVolumePayload } from "./parseThirdPartyVolume";
import {
  currentMonthKey,
  defaultHistoryStartMonth,
  effectiveMonthlyStatus,
  monthsBetweenKeys,
  normalizeMonthKey,
  previousMonthKey,
  readBestMonthlySnapshot,
  writableMonthlyKeys,
  writeMonthlyCheckStatus,
  writeMonthlySnapshot
} from "./monthlySnapshotStore";
import { readSnapshotCursor, writeSnapshotCursorStrict } from "./snapshotStore";
import type { ThirdPartyVolumePayload } from "./types";

export type ThirdPartyMonthlyMode = "bootstrap" | "history" | "current" | "rebuild";

export type ThirdPartyMonthlyJobStatus = {
  jobId: string;
  mode: ThirdPartyMonthlyMode;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  months: string[];
  monthIndex: number;
  sourceIndex: number;
  completedMonths: number;
  totalMonths: number;
  message: string;
  startedAt: string;
  updatedAt?: string;
  finishedAt?: string;
  error?: string;
};

type ThirdPartyMonthlyLock = {
  jobId?: string;
  expiresAt?: string;
  mode?: ThirdPartyMonthlyMode;
};

type ThirdPartyPartSnapshot = {
  ok: true;
  jobId: string;
  month: string;
  sourceIndex: number;
  updatedAt: string;
  payload: ThirdPartyVolumePayload;
};

export type ThirdPartyMonthlyStepInput = {
  jobId: string;
  mode: ThirdPartyMonthlyMode;
  months: string[];
  monthIndex?: number;
  sourceIndex?: number;
  origin: string;
  force?: boolean;
};

const LOCK_CURSOR = "third-party-monthly-v225-lock";
const STATUS_CURSOR_PREFIX = "third-party-monthly-v225-status";
const LATEST_STATUS_CURSOR = "third-party-monthly-v225-latest";
const INITIALIZED_CURSOR = "third-party-monthly-v225-initialized";
const DEFAULT_SOURCE_COUNT = 2;

async function getBlobStore() {
  const mod = await import("@netlify/blobs");
  return mod.getStore(process.env.DASHBOARD_SNAPSHOT_STORE || "hensem-dashboard-snapshots");
}

function nowIso(): string {
  return new Date().toISOString();
}

function sourceCount(): number {
  const explicit = Number(process.env.THIRD_PARTY_VOLUME_SOURCE_COUNT || 0);
  if (Number.isFinite(explicit) && explicit > 0) return Math.max(1, Math.min(8, Math.floor(explicit)));

  const configured = [
    process.env.THIRD_PARTY_VOLUME_SHEET_IDS,
    process.env.THIRD_PARTY_VOLUME_SHEET_ID,
    process.env.THIRD_PARTY_AMOUNT_SHEET_ID
  ]
    .filter(Boolean)
    .flatMap((value) => String(value || "").split(/[\n,;]+/))
    .map((value) => {
      const text = value.trim();
      const match = text.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      return match ? match[1] : text;
    })
    .filter(Boolean);
  const unique = new Set(configured);
  return Math.max(1, Math.min(8, unique.size || DEFAULT_SOURCE_COUNT));
}

function sanitizeJobId(value: string): string {
  return String(value || "").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 100) || `tpv-${Date.now()}`;
}

function statusCursor(jobId: string): string {
  return `${STATUS_CURSOR_PREFIX}-${sanitizeJobId(jobId)}`;
}

function partBlobKey(jobId: string, month: string, sourceIndex: number): string {
  return `third-party-volume.job.${sanitizeJobId(jobId)}.month.${normalizeMonthKey(month)}.source.${sourceIndex}.json`;
}

function completedMonthCursor(month: string): string {
  return `third-party-monthly-v225-complete-${normalizeMonthKey(month)}`;
}

async function isMonthV225Complete(month: string): Promise<boolean> {
  const marker = await readSnapshotCursor<{ completed?: boolean }>(completedMonthCursor(month)).catch(() => null);
  return marker?.completed === true;
}

async function markMonthV225Complete(month: string, rows: number): Promise<void> {
  await writeSnapshotCursorStrict(completedMonthCursor(month), {
    completed: true,
    month: normalizeMonthKey(month),
    rows,
    completedAt: nowIso()
  });
}

function lockFresh(lock: ThirdPartyMonthlyLock | null): boolean {
  const expiresAt = new Date(String(lock?.expiresAt || "")).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export function thirdPartyDashboardMonths(now = new Date()): string[] {
  return monthsBetweenKeys(defaultHistoryStartMonth(), currentMonthKey(now));
}

export function thirdPartyHistoryMonths(now = new Date()): string[] {
  return monthsBetweenKeys(defaultHistoryStartMonth(), previousMonthKey(now));
}

export async function missingThirdPartyMonthlyMonths(months: string[]): Promise<string[]> {
  const normalized = Array.from(new Set(months.map(normalizeMonthKey).filter(Boolean))).sort();
  const snapshots = await Promise.all(normalized.map((month) => readBestMonthlySnapshot("third-party-volume", month)));
  return normalized.filter((_, index) => !snapshots[index]);
}

export function monthsForThirdPartyMode(mode: ThirdPartyMonthlyMode, explicitMonths: string[] = [], now = new Date()): string[] {
  const explicit = Array.from(new Set(explicitMonths.map(normalizeMonthKey).filter(Boolean))).sort();
  if (explicit.length) return explicit;
  if (mode === "current") return writableMonthlyKeys(now);
  if (mode === "history") return thirdPartyHistoryMonths(now);
  return thirdPartyDashboardMonths(now);
}

export async function readThirdPartyMonthlyJobStatus(jobId: string): Promise<ThirdPartyMonthlyJobStatus | null> {
  return readSnapshotCursor<ThirdPartyMonthlyJobStatus>(statusCursor(jobId));
}

export async function readLatestThirdPartyMonthlyJobStatus(): Promise<ThirdPartyMonthlyJobStatus | null> {
  return readSnapshotCursor<ThirdPartyMonthlyJobStatus>(LATEST_STATUS_CURSOR);
}

export async function isThirdPartyV225Initialized(): Promise<boolean> {
  const marker = await readSnapshotCursor<{ completed?: boolean }>(INITIALIZED_CURSOR).catch(() => null);
  return marker?.completed === true;
}

async function markThirdPartyV225Initialized(months: string[]): Promise<void> {
  const required = thirdPartyDashboardMonths();
  const set = new Set(months.map(normalizeMonthKey));
  if (!required.every((month) => set.has(month))) return;
  await writeSnapshotCursorStrict(INITIALIZED_CURSOR, {
    completed: true,
    months: required,
    completedAt: nowIso()
  });
}

async function writeStatus(status: ThirdPartyMonthlyJobStatus): Promise<void> {
  await Promise.all([
    writeSnapshotCursorStrict(statusCursor(status.jobId), status),
    writeSnapshotCursorStrict(LATEST_STATUS_CURSOR, status)
  ]);
}

export async function acquireThirdPartyMonthlyLock(jobId: string, mode: ThirdPartyMonthlyMode): Promise<{ ok: boolean; existingJobId?: string }> {
  const current = await readSnapshotCursor<ThirdPartyMonthlyLock>(LOCK_CURSOR).catch(() => null);
  if (lockFresh(current) && current?.jobId && current.jobId !== jobId) {
    return { ok: false, existingJobId: current.jobId };
  }
  await writeSnapshotCursorStrict(LOCK_CURSOR, {
    jobId,
    mode,
    expiresAt: new Date(Date.now() + 16 * 60 * 1000).toISOString()
  } satisfies ThirdPartyMonthlyLock);
  return { ok: true };
}

export async function refreshThirdPartyMonthlyLock(jobId: string, mode: ThirdPartyMonthlyMode): Promise<void> {
  await writeSnapshotCursorStrict(LOCK_CURSOR, {
    jobId,
    mode,
    expiresAt: new Date(Date.now() + 16 * 60 * 1000).toISOString()
  } satisfies ThirdPartyMonthlyLock);
}

export async function releaseThirdPartyMonthlyLock(jobId: string, mode: ThirdPartyMonthlyMode): Promise<void> {
  await writeSnapshotCursorStrict(LOCK_CURSOR, {
    jobId,
    mode,
    expiresAt: new Date(0).toISOString()
  } satisfies ThirdPartyMonthlyLock).catch(() => undefined);
}

async function writePart(part: ThirdPartyPartSnapshot): Promise<void> {
  const store = await getBlobStore();
  await store.set(partBlobKey(part.jobId, part.month, part.sourceIndex), JSON.stringify(part));
}

async function readPart(jobId: string, month: string, sourceIndex: number): Promise<ThirdPartyPartSnapshot | null> {
  try {
    const store = await getBlobStore();
    const value = await store.get(partBlobKey(jobId, month, sourceIndex), { type: "json" });
    if (!value || typeof value !== "object") return null;
    const part = value as ThirdPartyPartSnapshot;
    if (!part.payload || normalizeMonthKey(part.month) !== normalizeMonthKey(month)) return null;
    return part;
  } catch {
    return null;
  }
}

function combineParts(month: string, parts: ThirdPartyPartSnapshot[]): ThirdPartyVolumePayload {
  const payloads = parts.map((part) => part.payload);
  const rows = payloads.flatMap((payload) => payload.rows || []);
  if (!rows.length) throw new Error(`${month.replace("_", "-")} 两个三方量来源表都没有解析到数据`);

  const aliases: Record<string, string[]> = {};
  for (const payload of payloads) {
    for (const [name, values] of Object.entries(payload.aliasMap || {})) {
      aliases[name] = Array.from(new Set([...(aliases[name] || []), ...(values || [])])).sort();
    }
  }

  return compactThirdPartyVolumePayloadForDashboard(normalizeThirdPartyVolumePayload({
    meta: {
      ...(payloads[payloads.length - 1]?.meta || {}),
      year: month.split("_")[0],
      month: String(Number(month.split("_")[1])),
      updatedAt: nowIso(),
      source: "google-sheet",
      sheets: Array.from(new Set(payloads.flatMap((payload) => payload.meta?.sheets || []))),
      message: `${month.replace("_", "-")} 已完整读取 ${parts.length} 个来源表后一次性写入月快照；旧快照只在完整成功后才替换`
    },
    rows,
    aliasMap: aliases,
    summary: payloads[0]?.summary || {
      rows: 0,
      amount: 0,
      count: 0,
      successCount: 0,
      failedCount: 0,
      countries: 0,
      platforms: 0,
      channels: 0
    },
    anomalies: Array.from(new Set(payloads.flatMap((payload) => payload.anomalies || []))).slice(0, 300)
  }));
}

async function readOneSource(jobId: string, month: string, sourceIndex: number): Promise<ThirdPartyPartSnapshot> {
  const payload = normalizeThirdPartyVolumePayload(await getThirdPartyVolumePayload({
    months: [month],
    sourceIndexes: [sourceIndex],
    sheetModulo: 1,
    sheetRemainder: 0,
    columnModulo: 1,
    columnRemainder: 0
  }));

  const failedSheets = Array.isArray((payload.meta as any)?.failedSheets) ? (payload.meta as any).failedSheets : [];
  if (failedSheets.length) {
    throw new Error(`${month.replace("_", "-")} 来源表${sourceIndex + 1} 有 ${failedSheets.length} 个读取失败页签，本次不写入不完整快照`);
  }

  const part: ThirdPartyPartSnapshot = {
    ok: true,
    jobId,
    month,
    sourceIndex,
    updatedAt: nowIso(),
    payload
  };
  await writePart(part);
  return part;
}

async function invokeNextStep(input: ThirdPartyMonthlyStepInput): Promise<void> {
  const token = String(process.env.SNAPSHOT_REFRESH_TOKEN || process.env.DASHBOARD_REFRESH_TOKEN || "");
  const response = await fetch(`${input.origin}/.netlify/functions/sync-third-party-monthly-background`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(token ? { "x-refresh-token": token } : {})
    },
    body: JSON.stringify(input)
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) throw new Error(`下一步排队失败（HTTP ${response.status}）：${text.slice(0, 500)}`);
}

export async function runThirdPartyMonthlyStep(input: ThirdPartyMonthlyStepInput): Promise<{ ok: boolean; completed?: boolean; message: string }> {
  const jobId = sanitizeJobId(input.jobId);
  const mode = input.mode;
  const months = monthsForThirdPartyMode(mode, input.months);
  if (!months.length) {
    await releaseThirdPartyMonthlyLock(jobId, mode);
    return { ok: true, completed: true, message: "没有需要读取的月份" };
  }

  const totalSources = sourceCount();
  let monthIndex = Math.max(0, Math.floor(Number(input.monthIndex || 0)));
  let sourceIndex = Math.max(0, Math.floor(Number(input.sourceIndex || 0)));
  const force = Boolean(input.force || mode === "rebuild");
  const startedAt = (await readThirdPartyMonthlyJobStatus(jobId))?.startedAt || nowIso();

  while (monthIndex < months.length) {
    const month = months[monthIndex];
    const monthStatus = effectiveMonthlyStatus(month);
    const alreadyBuiltByV225 = mode === "bootstrap" ? await isMonthV225Complete(month) : false;

    // V236：真正封存的历史月完全只读；月初前 7 天的上个月是 settling，
    // 仍允许补齐月底迟到数据。
    if (monthStatus === "archived" || alreadyBuiltByV225) {
      monthIndex += 1;
      sourceIndex = 0;
      continue;
    }

    await refreshThirdPartyMonthlyLock(jobId, mode);
    await writeStatus({
      jobId,
      mode,
      status: "running",
      months,
      monthIndex,
      sourceIndex,
      completedMonths: monthIndex,
      totalMonths: months.length,
      startedAt,
      message: `正在读取 ${month.replace("_", "-")} 来源表 ${sourceIndex + 1}/${totalSources}`
    });

    await readOneSource(jobId, month, sourceIndex);

    if (sourceIndex + 1 < totalSources) {
      await invokeNextStep({ ...input, jobId, months, monthIndex, sourceIndex: sourceIndex + 1, origin: input.origin, force });
      return { ok: true, message: `${month.replace("_", "-")} 来源表 ${sourceIndex + 1}/${totalSources} 已完成，下一来源表已排队` };
    }

    const parts: ThirdPartyPartSnapshot[] = [];
    for (let index = 0; index < totalSources; index += 1) {
      const part = await readPart(jobId, month, index);
      if (!part) throw new Error(`${month.replace("_", "-")} 缺少来源表${index + 1}的同批次结果，拒绝覆盖旧快照`);
      parts.push(part);
    }

    const partRowCount = parts.reduce((sum, part) => sum + (part.payload?.rows?.length || 0), 0);
    if (partRowCount <= 0) {
      await writeMonthlyCheckStatus("third-party-volume", month, {
        checkedAt: nowIso(),
        ok: true,
        rows: 0,
        message: "本小时已检查 Google Sheet，当前月份暂时没有三方量数据，保留旧快照"
      }).catch(() => undefined);
      monthIndex += 1;
      sourceIndex = 0;
      await writeStatus({
        jobId,
        mode,
        status: monthIndex < months.length ? "running" : "completed",
        months,
        monthIndex,
        sourceIndex,
        completedMonths: monthIndex,
        totalMonths: months.length,
        startedAt,
        finishedAt: monthIndex < months.length ? undefined : nowIso(),
        message: `${month.replace("_", "-")} 当前没有数据，本次保留旧快照并继续`
      });
      if (monthIndex < months.length) {
        await invokeNextStep({ ...input, jobId, months, monthIndex, sourceIndex: 0, origin: input.origin, force });
        return { ok: true, message: `${month.replace("_", "-")} 暂无数据，下一月份已排队` };
      }
      continue;
    }

    const combined = combineParts(month, parts);
    const status = effectiveMonthlyStatus(month);
    const snapshot = await writeMonthlySnapshot("third-party-volume", month, combined, mode === "rebuild" ? "manual-sync" : "hourly-sync", {
      status,
      forceRebuild: status === "current" && force
    });
    await markMonthV225Complete(month, combined.rows.length).catch(() => undefined);

    monthIndex += 1;
    sourceIndex = 0;
    await writeStatus({
      jobId,
      mode,
      status: monthIndex < months.length ? "running" : "completed",
      months,
      monthIndex,
      sourceIndex,
      completedMonths: monthIndex,
      totalMonths: months.length,
      startedAt,
      updatedAt: snapshot.updatedAt,
      finishedAt: monthIndex < months.length ? undefined : nowIso(),
      message: `${month.replace("_", "-")} 已完整写入 ${combined.rows.length} 行${status === "archived" ? "并封存" : ""}`
    });

    if (monthIndex < months.length) {
      await invokeNextStep({ ...input, jobId, months, monthIndex, sourceIndex: 0, origin: input.origin, force });
      return { ok: true, message: `${month.replace("_", "-")} 已完成，下一月份已排队` };
    }
  }

  await writeStatus({
    jobId,
    mode,
    status: "completed",
    months,
    monthIndex: months.length,
    sourceIndex: 0,
    completedMonths: months.length,
    totalMonths: months.length,
    startedAt,
    finishedAt: nowIso(),
    message: `${months.map((month) => month.replace("_", "-")).join("、")} 已全部完成`
  });
  await markThirdPartyV225Initialized(months).catch(() => undefined);
  await releaseThirdPartyMonthlyLock(jobId, mode);
  return { ok: true, completed: true, message: "三方量月份任务全部完成" };
}

export async function queueThirdPartyMonthlyJob(options: {
  origin: string;
  mode?: ThirdPartyMonthlyMode;
  months?: string[];
  force?: boolean;
  jobId?: string;
}): Promise<{ ok: boolean; jobId: string; months: string[]; message: string; existingJobId?: string }> {
  const mode = options.mode || "bootstrap";
  const months = monthsForThirdPartyMode(mode, options.months || []);
  const jobId = sanitizeJobId(options.jobId || `tpv-${mode}-${Date.now()}`);
  const acquired = await acquireThirdPartyMonthlyLock(jobId, mode);
  if (!acquired.ok) {
    return {
      ok: true,
      jobId: acquired.existingJobId || jobId,
      existingJobId: acquired.existingJobId,
      months,
      message: `已有三方量月份任务 ${acquired.existingJobId || ""} 正在运行，本次不重复启动`
    };
  }

  await writeStatus({
    jobId,
    mode,
    status: "queued",
    months,
    monthIndex: 0,
    sourceIndex: 0,
    completedMonths: 0,
    totalMonths: months.length,
    startedAt: nowIso(),
    message: `已排队读取 ${months.map((month) => month.replace("_", "-")).join("、")}`
  });

  try {
    await invokeNextStep({
      jobId,
      mode,
      months,
      monthIndex: 0,
      sourceIndex: 0,
      origin: options.origin,
      force: Boolean(options.force)
    });
  } catch (error) {
    await releaseThirdPartyMonthlyLock(jobId, mode);
    const message = error instanceof Error ? error.message : String(error || "后台排队失败");
    await writeStatus({
      jobId,
      mode,
      status: "failed",
      months,
      monthIndex: 0,
      sourceIndex: 0,
      completedMonths: 0,
      totalMonths: months.length,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      error: message,
      message
    }).catch(() => undefined);
    throw error;
  }

  return { ok: true, jobId, months, message: `三方量月份任务已启动：${months.map((month) => month.replace("_", "-")).join("、")}` };
}
