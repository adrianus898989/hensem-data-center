import {
  getAutoWithdrawPayload,
  getCustomerServicePayload,
  getThirdPartyRatePayload,
  getThirdPartyVolumePayload,
  getWorkOrderPayload
} from "./googleSheets";
import { countSnapshotPayloadRows, isSnapshotPayloadUsable, readBestSnapshot, readSnapshotCursor, writeSnapshot, writeSnapshotCursor, type SnapshotModuleKey } from "./snapshotStore";
import {
  currentMonthKey as monthlyCurrentMonthKey,
  effectiveMonthlyStatus,
  readBestMonthlySnapshot,
  scheduledWritableMonthlyKeys,
  splitPayloadByMonth,
  writeMonthlySnapshot,
  type MonthlySnapshotModuleKey
} from "./monthlySnapshotStore";
import type { AutoWithdrawPayload, DailyWithdrawRow, OperatorRow } from "./types";
import { normalizeThirdPartyVolumePayload } from "./parseThirdPartyVolume";

export type SnapshotRefreshResult = {
  key: SnapshotModuleKey;
  ok: boolean;
  skipped?: boolean;
  updatedAt?: string;
  rows?: number;
  message?: string;
  attempts?: number;
};

type ModuleConfig = {
  key: SnapshotModuleKey;
  label: string;
  load: () => Promise<any>;
  countRows: (payload: any) => number;
};


function currentMonthKey(now = new Date()): string {
  return monthlyCurrentMonthKey(now);
}

function currentAndPreviousMonthKeys(now = new Date()): string[] {
  const current = currentMonthKey(now);
  const prevDate = new Date(now.getTime());
  prevDate.setMonth(prevDate.getMonth() - 1);
  const previous = `${prevDate.getFullYear()}_${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  return Array.from(new Set([current, previous]));
}


function scheduleAutoWithdrawMonths(): string[] {
  // V236：当前月每小时更新；月初结算期继续补上月月底数据。
  return scheduledWritableMonthlyKeys();
}

function sameDailyKey(row: DailyWithdrawRow): string {
  return `${row.date}|||${row.country}|||${row.platform}|||${row.sourceSheet || ""}`;
}

function sameOperatorKey(row: OperatorRow): string {
  return `${row.date}|||${row.country}|||${row.platform}|||${row.account}`;
}

function mergeByKey<T>(freshRows: T[], oldRows: T[], keyFn: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of [...freshRows, ...oldRows]) {
    const key = keyFn(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function parseSecondsFromDuration(value: string): number {
  const text = String(value || "");
  if (!text || text === "-") return 0;
  let seconds = 0;
  const h = text.match(/(\d+)\s*(?:小时|时|h)/i);
  const m = text.match(/(\d+)\s*(?:分钟|分|m)/i);
  const s = text.match(/(\d+)\s*(?:秒|s)/i);
  if (h) seconds += Number(h[1]) * 3600;
  if (m) seconds += Number(m[1]) * 60;
  if (s) seconds += Number(s[1]);
  if (!seconds && /^\d+$/.test(text.trim())) seconds = Number(text.trim());
  return seconds;
}

function formatSecondsForAuto(seconds: number): string {
  const n = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
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
      avgSecondsWeighted: 0,
      sourceSheet: row.sourceSheet || "raw"
    };
    current.total += Number(row.total) || 0;
    current.success += Number(row.success) || 0;
    current.rejected += Number(row.rejected) || 0;
    current.autoCount += Number(row.autoCount) || 0;
    current.manualCount += Number(row.manualCount) || 0;
    current.avgSecondsWeighted += parseSecondsFromDuration(row.avgTime) * (Number(row.total) || 0);
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
    avgTime: row.total ? formatSecondsForAuto(row.avgSecondsWeighted / row.total) : "0秒",
    yesterdayAvgTime: "-",
    comparePercent: "-",
    sourceSheet: row.sourceSheet
  })).sort((a, b) => String(a.country).localeCompare(String(b.country), "zh-CN") || Number(b.total) - Number(a.total));
}

function mergeAutoWithdrawSnapshot(fresh: AutoWithdrawPayload, existing: AutoWithdrawPayload | undefined | null, replacedMonths: string[]): AutoWithdrawPayload {
  if (!existing || !replacedMonths.length) return fresh;
  const hasFreshDaily = (fresh.dailyRows || []).length > 0;
  const hasFreshOperator = (fresh.operatorRows || []).length > 0;
  if (!hasFreshDaily && !hasFreshOperator) return fresh;

  const monthSet = new Set(replacedMonths);
  const keepDaily = hasFreshDaily
    ? (existing.dailyRows || []).filter((row) => !monthSet.has(monthKeyFromIsoDate(row.date)))
    : (existing.dailyRows || []);
  const keepOperator = hasFreshOperator
    ? (existing.operatorRows || []).filter((row) => !monthSet.has(monthKeyFromIsoDate(row.date)))
    : (existing.operatorRows || []);
  const dailyRows = mergeByKey(hasFreshDaily ? [...(fresh.dailyRows || [])] : [], keepDaily, sameDailyKey)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.country || "").localeCompare(String(b.country || ""), "zh-CN") || String(a.platform || "").localeCompare(String(b.platform || ""), "zh-CN", { numeric: true }));
  const operatorRows = mergeByKey(hasFreshOperator ? [...(fresh.operatorRows || [])] : [], keepOperator, sameOperatorKey)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.country || "").localeCompare(String(b.country || ""), "zh-CN") || String(a.platform || "").localeCompare(String(b.platform || ""), "zh-CN", { numeric: true }) || String(a.account || "").localeCompare(String(b.account || ""), "zh-CN", { numeric: true }));
  return {
    ...fresh,
    dailyRows,
    operatorRows,
    monthlyRows: rebuildAutoMonthlyRows(dailyRows) as any,
    meta: {
      ...fresh.meta,
      message: [
        fresh.meta?.message,
        `V216 自动出款按月份增量刷新：日表${hasFreshDaily ? "已刷新" : "沿用旧快照"}，操作人${hasFreshOperator ? "已刷新" : "沿用旧快照"}；其它历史月份保留，失败不会覆盖旧数据`
      ].filter(Boolean).join("；")
    }
  };
}

function historyMonthsFromApril2026ToNow(): string[] {
  const now = new Date();
  const cur = new Date(2026, 3, 1); // 2026-04
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  const out: string[] = [];
  while (cur <= end && out.length < 36) {
    out.push(`${cur.getFullYear()}_${String(cur.getMonth() + 1).padStart(2, "0")}`);
    cur.setMonth(cur.getMonth() + 1);
  }
  return out.length ? out : [currentMonthKey()];
}

function thirdPartySyncMode(): "latest" | "history" {
  const mode = String(process.env.THIRD_PARTY_VOLUME_SYNC_MODE || "latest").toLowerCase();
  return mode === "history" ? "history" : "latest";
}

function historyMonthsBeforeCurrentFromApril2026(): string[] {
  const current = currentMonthKey();
  return historyMonthsFromApril2026ToNow().filter((month) => month !== current);
}

function splitScheduleMonths(value: string): string[] {
  return String(value || "")
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function scheduleThirdPartyVolumeMonths(): string[] {
  const mode = thirdPartySyncMode();

  // V219：历史补月不能被 THIRD_PARTY_VOLUME_SCHEDULE_MONTHS=2026_07 这种当前月配置卡住。
  // latest 用当前月配置；history 只看 THIRD_PARTY_VOLUME_HISTORY_MONTHS，没填就自动补 2026-04 到上个月。
  if (mode === "history") {
    const historyEnv = String(process.env.THIRD_PARTY_VOLUME_HISTORY_MONTHS || "").trim();
    if (historyEnv) return splitScheduleMonths(historyEnv);
    const history = historyMonthsBeforeCurrentFromApril2026();
    return history.length ? history : [currentMonthKey()];
  }

  // V223：当前月定时任务不再受旧 THIRD_PARTY_VOLUME_SCHEDULE_MONTHS 限制。
  // 每到新月份自动切换，不需要去 Netlify 手工把 2026_07 改成 2026_08。
  return [currentMonthKey()];
}

type ThirdPartyVolumeReadPlan = {
  months: string[];
  sourceIndexes: number[];
  sheetModulo: number;
  sheetRemainder: number;
  columnModulo: number;
  columnRemainder: number;
  cursorName: string;
  nextPhase: number;
  mode: "latest" | "history";
};

async function nextThirdPartyVolumeReadPlan(months: string[]): Promise<ThirdPartyVolumeReadPlan> {
  const mode = thirdPartySyncMode();
  const configured = String(process.env.THIRD_PARTY_VOLUME_SCHEDULE_SOURCE_INDEXES || "").trim();
  const configuredSourceIndexes = configured
    ? configured.split(/[\n,]+/).map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x >= 0)
    : [];

  const safeMonths = months.length ? months : [currentMonthKey()];
  // V216：当前月默认只读第1个三方量表（raw_2026_thirdparty），历史月才轮询两个来源。
  // 之前 current 也轮询第2个历史表，很多时候第2个表没有当前月，导致 15 分钟任务被空跑，看起来不像每小时更新。
  const sourceCount = Math.max(1, configuredSourceIndexes.length || (mode === "latest" ? 1 : 2));

  // V216 默认：当前月按页签分2批；历史月不再按页签切半，避免4/5/6补得太慢。
  // 横向国家块不按列切，避免国家漏块。
  const defaultSheetModulo = mode === "latest" ? 2 : 1;
  // V222：Background Function 已可运行 15 分钟，当前月不再按列切成空片；只按代收/代付页签轮换。
  const defaultColumnModulo = 1;
  const sheetModulo = Math.max(1, Number(process.env.THIRD_PARTY_VOLUME_SCHEDULE_SHEET_MODULO || String(defaultSheetModulo)) || defaultSheetModulo);
  const columnModulo = Math.max(1, Number(process.env.THIRD_PARTY_VOLUME_SCHEDULE_COLUMN_MODULO || String(defaultColumnModulo)) || defaultColumnModulo);
  const cursorName = `third-party-volume-plan-v223-${mode}`;
  const cursor = await readSnapshotCursor<{ phase?: number }>(cursorName).catch(() => null);
  const phase = Number.isInteger(cursor?.phase) ? Number(cursor?.phase) : 0;

  const perMonth = sourceCount * sheetModulo * columnModulo;
  const monthIndex = Math.floor(phase / perMonth) % safeMonths.length;
  const withinMonth = phase % perMonth;
  const sourceIndexRaw = Math.floor(withinMonth / (sheetModulo * columnModulo)) % sourceCount;
  const sourceIndex = configuredSourceIndexes.length ? configuredSourceIndexes[sourceIndexRaw % configuredSourceIndexes.length] : sourceIndexRaw;
  const sheetRemainder = Math.floor(withinMonth / columnModulo) % sheetModulo;
  const columnRemainder = withinMonth % columnModulo;
  const nextPhase = (phase + 1) % Math.max(1, safeMonths.length * perMonth);

  // V220：这里只“查看”本次要读的分片，不提前推进游标。
  // 旧版在 Google Sheet 读取前就推进游标；一旦本次超时/失败，这个分片会被直接跳过，
  // 于是页面一直缺一块，看起来像“自动永远不会完整更新”。
  return {
    months: [safeMonths[monthIndex]],
    sourceIndexes: [sourceIndex],
    sheetModulo,
    sheetRemainder,
    columnModulo,
    columnRemainder,
    cursorName,
    nextPhase,
    mode
  };
}
function monthKeyFromIsoDate(value: string): string {
  const m = String(value || "").match(/^(20\d{2})-(\d{2})/);
  return m ? `${m[1]}_${m[2]}` : "";
}

function summarizeThirdPartyRows(rows: any[]) {
  return {
    rows: rows.length,
    amount: rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    count: rows.reduce((sum, row) => sum + (Number(row.count) || 0), 0),
    successCount: rows.reduce((sum, row) => sum + (Number(row.successCount) || 0), 0),
    failedCount: rows.reduce((sum, row) => sum + (Number(row.failedCount) || 0), 0),
    countries: new Set(rows.map((row) => row.country).filter(Boolean)).size,
    platforms: new Set(rows.map((row) => row.platform).filter(Boolean)).size,
    channels: new Set(rows.map((row) => row.channel).filter(Boolean)).size
  };
}

function thirdPartySourceIndex(row: any): number | null {
  const m = String(row?.sheetName || "").match(/三方量表(\d+)/);
  return m ? Number(m[1]) - 1 : null;
}

function thirdPartySheetPart(row: any): string {
  // V219：同一个来源表 + 页签 + range 算一个刷新单元。
  // 三方量会按横向列分片读取，如果去掉 range，会把同页签其他国家区块误删，导致国家漏数据。
  return String(row?.sheetName || "").trim();
}

function thirdPartyLogicalKey(row: any): string {
  return [row?.date, row?.country, row?.platform, row?.direction, row?.rawChannel || row?.channel, row?.amount, row?.count, row?.sourceRow].join("|||");
}

function mergeThirdPartyVolumeSnapshot(fresh: any, existing: any, replacedMonths: string[], replacedSourceIndexes: number[] = []): any {
  if (!existing?.rows?.length || !fresh?.rows?.length || !replacedMonths.length) return fresh;
  const monthSet = new Set(replacedMonths);
  const sourceSet = new Set(replacedSourceIndexes);
  const freshSheetParts = new Set((fresh.rows || []).map(thirdPartySheetPart).filter(Boolean));
  const keepOld = (existing.rows || []).filter((row: any) => {
    if (!monthSet.has(monthKeyFromIsoDate(row.date))) return true;
    if (!sourceSet.size) return false;
    const idx = thirdPartySourceIndex(row);
    if (idx === null || !sourceSet.has(idx)) return true;
    // V216：三方量现在按来源表+页签分片刷新。
    // 只替换本次成功读到的页签，不能把同来源同月份但还没刷新到的另一个页签清掉。
    if (freshSheetParts.size) return !freshSheetParts.has(thirdPartySheetPart(row));
    return false;
  });
  const rows = [...(fresh.rows || []), ...keepOld]
    .filter((row, index, array) => array.findIndex((x) => thirdPartyLogicalKey(x) === thirdPartyLogicalKey(row)) === index)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.country || "").localeCompare(String(b.country || ""), "zh-CN") || String(a.platform || "").localeCompare(String(b.platform || ""), "zh-CN"));
  return normalizeThirdPartyVolumePayload({
    ...fresh,
    rows,
    aliasMap: { ...(existing.aliasMap || {}), ...(fresh.aliasMap || {}) },
    summary: summarizeThirdPartyRows(rows),
    anomalies: Array.from(new Set([...(fresh.anomalies || []), ...(existing.anomalies || [])])).slice(0, 200),
    meta: {
      ...(fresh.meta || {}),
      sheets: Array.from(new Set([...(existing.meta?.sheets || []), ...(fresh.meta?.sheets || [])])),
      message: [
        fresh.meta?.message,
        `V223 当前月三方量分片合并并压缩同维度行；本次 ${replacedMonths.join(",")}${replacedSourceIndexes.length ? ` 来源表${replacedSourceIndexes.map((x) => x + 1).join("/")}` : ""}，其它月份/来源分片沿用上一次成功快照`
      ].filter(Boolean).join("；")
    }
  });
}

function thirdPartyCursorCommit(payload: any): { cursorName: string; value: any } | null {
  const commit = payload?.meta?.snapshotCursorCommit;
  if (!commit?.cursorName || !commit?.value) return null;
  return commit;
}

function withoutThirdPartyCursorCommit(payload: any): any {
  if (!payload?.meta) return payload;
  const { snapshotCursorCommit: _internalCommit, snapshotTargetMonth: _internalMonth, ...meta } = payload.meta;
  return { ...payload, meta };
}

async function commitThirdPartyCursor(payload: any): Promise<void> {
  const commit = thirdPartyCursorCommit(payload);
  if (!commit) return;
  // 游标写失败只会让同一片下次再跑一次，不会漏数据。
  await writeSnapshotCursor(commit.cursorName, commit.value);
}

const MODULES: ModuleConfig[] = [
  {
    key: "auto-withdraw",
    label: "提现/自动出款",
    load: async () => {
      const months = scheduleAutoWithdrawMonths();
      // V223：每小时只读取当前月，历史月份来自已封存月快照，不再参与合并/重写。
      return getAutoWithdrawPayload(months.length ? { months } : { months: [currentMonthKey()] });
    },
    countRows: (payload) => (payload.dailyRows?.length || 0) + (payload.monthlyRows?.length || 0) + (payload.operatorRows?.length || 0)
  },
  {
    key: "work-orders",
    label: "工单/客服",
    load: () => getWorkOrderPayload({ months: scheduledWritableMonthlyKeys() }),
    countRows: (payload) => payload.rows?.length || 0
  },
  {
    key: "third-party-volume",
    label: "三方量",
    // V206：定时同步默认只读当前/昨日所在月，避免 4-12 月全量把 Netlify 函数跑超时。
    // 如需一次性重建历史月快照，可在 Netlify 设置 THIRD_PARTY_VOLUME_SCHEDULE_MONTHS=2026_04,2026_05,2026_06,2026_07。
    // 如确实要全量，设置 THIRD_PARTY_VOLUME_SYNC_ALL=true。
    load: async () => {
      const months = scheduleThirdPartyVolumeMonths();
      const plan = months.length
        ? await nextThirdPartyVolumeReadPlan(months)
        : null;
      const fresh = await getThirdPartyVolumePayload(plan
        ? {
            months: plan.months,
            sourceIndexes: plan.sourceIndexes,
            sheetModulo: plan.sheetModulo,
            sheetRemainder: plan.sheetRemainder,
            columnModulo: plan.columnModulo,
            columnRemainder: plan.columnRemainder
          }
        : { forceAll: true });

      // V221：这里不再提前写游标。
      // 只有“Google 读取成功 + 大快照写入 Netlify Blobs 成功”以后，refreshSnapshotModule 才提交游标。
      // 旧版虽然把游标移到了读取之后，但仍在大快照写入之前推进；一旦 Blob 写入/函数超时，仍会跳过分片。
      if (plan) {
        const cursorCommit = {
          cursorName: plan.cursorName,
          value: {
            phase: plan.nextPhase,
            mode: plan.mode,
            lastSuccessfulMonths: plan.months,
            lastSuccessfulSourceIndexes: plan.sourceIndexes,
            lastSuccessfulSheetRemainder: plan.sheetRemainder,
            lastSuccessfulColumnRemainder: plan.columnRemainder
          }
        };

        // 某个来源表本来就没有该月份时，属于“正常空片”。
        // 空片不需要写大快照，但必须在返回成功后推进游标。
        if (!(fresh.rows || []).length) {
          (fresh.meta as any) = {
            ...(fresh.meta || {}),
            snapshotNoop: true,
            snapshotNoopMessage: `本分片没有可合并数据：${plan.months.join(",")} 来源表${plan.sourceIndexes.map((x) => x + 1).join("/")}，已继续下一片`,
            snapshotCursorCommit: cursorCommit
          };
          return fresh;
        }

        const existing = await readBestMonthlySnapshot("third-party-volume", plan.months[0]).catch(() => null);
        const merged = mergeThirdPartyVolumeSnapshot(fresh, existing?.payload, plan.months, plan.sourceIndexes);
        merged.meta = { ...(merged.meta || {}), snapshotCursorCommit: cursorCommit, snapshotTargetMonth: plan.months[0] };
        return merged;
      }
      return fresh;
    },
    countRows: (payload) => payload.rows?.length || 0
  },
  {
    key: "third-party-rates",
    label: "三方费率",
    load: getThirdPartyRatePayload,
    countRows: (payload) => (payload.rates?.length || 0) + (payload.platformStatuses?.length || 0)
  },
  {
    key: "customer-service",
    label: "客服统计",
    load: () => getCustomerServicePayload({ months: scheduledWritableMonthlyKeys() }),
    countRows: (payload) => payload.rows?.length || 0
  }
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "未知错误");
}

function detailedMessageOf(error: unknown): string {
  if (error instanceof Error) {
    const stack = error.stack ? ` | stack: ${error.stack.split("\n").slice(0, 3).join(" <- ")}` : "";
    return `${error.message}${stack}`;
  }
  return String(error || "未知错误");
}

function shouldRetry(error: unknown): boolean {
  return /Quota exceeded|rateLimitExceeded|userRateLimitExceeded|Read requests|timeout|ETIMEDOUT|ECONNRESET|503|500/i.test(messageOf(error));
}

async function loadWithRetry<T>(load: () => Promise<T>, label: string): Promise<{ payload: T; attempts: number }> {
  let lastError: unknown;
  const delays = [0, 2000, 5000];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await sleep(delays[i]);
    try {
      const payload = await load();
      return { payload, attempts: i + 1 };
    } catch (error) {
      lastError = error;
      // 临时错误马上重试；永久错误直接返回失败，避免把函数时间浪费到 60 秒。
      if (!shouldRetry(error) || i === delays.length - 1) break;
      console.error(`[${label}] 第 ${i + 1} 次读取失败，马上重试`, messageOf(error));
    }
  }
  throw new Error(`${label} 同步失败：${messageOf(lastError)}`);
}

function payloadMessage(payload: any): string {
  return String(payload?.meta?.message || "");
}

function shouldRejectSnapshot(key: SnapshotModuleKey, payload: any, rows: number): string | null {
  const msg = payloadMessage(payload);
  if (/Quota exceeded|Read requests|rateLimitExceeded|userRateLimitExceeded/i.test(msg)) {
    return `Google Sheet 读取额度超限，本次不覆盖旧快照；${msg.slice(0, 800)}`;
  }
  if (/读取失败|同步.*失败|失败数量|Missing environment|Unexpected end of JSON/i.test(msg)) {
    // V200：有行数就允许覆盖快照。
    // 工单/三方经常是“部分页签失败但主体数据已经读取成功”，不能因为提示文字就整包丢弃。
    if (rows <= 0) {
      return `本次同步返回错误信息，本次不覆盖旧快照；rows=${rows}；meta=${msg.slice(0, 1200)}`;
    }
  }
  if (!isSnapshotPayloadUsable(key, payload)) {
    return rows <= 0 ? `本次同步返回 0 行，本次不覆盖旧快照；meta=${msg.slice(0, 1200)}` : `本次同步数据无效，本次不覆盖旧快照；rows=${rows}；meta=${msg.slice(0, 1200)}`;
  }
  return null;
}

export function getSnapshotModuleKeys(): SnapshotModuleKey[] {
  return MODULES.map((item) => item.key);
}

export async function refreshSnapshotModule(
  key: SnapshotModuleKey,
  source: "hourly-sync" | "manual-sync" | "live-fallback" = "hourly-sync"
): Promise<SnapshotRefreshResult> {
  const config = MODULES.find((item) => item.key === key);
  if (!config) {
    return { key, ok: false, message: `未知模块：${key}` };
  }

  try {
    const loaded = await loadWithRetry(config.load, config.label);
    const payload = loaded.payload;
    const rows = countSnapshotPayloadRows(key, payload as any) || config.countRows(payload);

    if ((payload as any)?.meta?.snapshotNoop) {
      await commitThirdPartyCursor(payload as any);
      return {
        key,
        ok: true,
        skipped: true,
        rows,
        attempts: loaded.attempts,
        message: String((payload as any)?.meta?.snapshotNoopMessage || `${config.label} 本分片无数据，已继续下一片`)
      };
    }

    const rejectReason = shouldRejectSnapshot(key, payload, rows);
    if (rejectReason) {
      return { key, ok: false, rows, message: rejectReason };
    }

    const cleanPayload = withoutThirdPartyCursorCommit(payload as any);
    let updatedAt = "";

    if (key === "third-party-rates") {
      const snapshot = await writeSnapshot(key as any, cleanPayload, source);
      updatedAt = snapshot.updatedAt;
    } else if ((payload as any)?.meta?.snapshotTargetMonth) {
      // 三方量旧分片兼容路径：本次明确只写目标月份。
      const targetMonth = String((payload as any).meta.snapshotTargetMonth);
      const snapshot = await writeMonthlySnapshot(
        key as MonthlySnapshotModuleKey,
        targetMonth,
        cleanPayload,
        source,
        { status: effectiveMonthlyStatus(targetMonth) }
      );
      updatedAt = snapshot.updatedAt;
    } else {
      // V236：自动出款/工单/客服可能在月初一次读取“上月结算 + 当前月”。
      // 必须按月份拆开分别写，绝不能把两个月混进当前月快照。
      const monthlyParts = splitPayloadByMonth(key as MonthlySnapshotModuleKey, cleanPayload as any);
      const allowed = new Set(scheduledWritableMonthlyKeys());
      const writes: Array<{ updatedAt: string }> = [];
      for (const [month, monthPayload] of monthlyParts.entries()) {
        if (!allowed.has(month)) continue;
        const snapshot = await writeMonthlySnapshot(
          key as MonthlySnapshotModuleKey,
          month,
          monthPayload as any,
          source,
          { status: effectiveMonthlyStatus(month) }
        );
        writes.push(snapshot);
      }
      if (!writes.length) {
        throw new Error(`${config.label} 没有可写入的当前月/结算月数据`);
      }
      updatedAt = writes.map((item) => item.updatedAt).sort().slice(-1)[0] || "";
    }

    // 当前月/结算月快照真正写入成功后，才推进三方量分片游标。
    await commitThirdPartyCursor(payload as any);
    return {
      key,
      ok: true,
      updatedAt,
      rows,
      attempts: loaded.attempts,
      message: `${config.label} 快照已更新`
    };
  } catch (error) {
    return {
      key,
      ok: false,
      attempts: 3,
      message: detailedMessageOf(error)
    };
  }
}

function minutesSince(value: string): number {
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return Number.POSITIVE_INFINITY;
  return (Date.now() - ts) / 60000;
}

export async function refreshSnapshotModuleIfStale(
  key: SnapshotModuleKey,
  source: "hourly-sync" | "manual-sync" | "live-fallback" = "hourly-sync",
  freshMinutes = 55
): Promise<SnapshotRefreshResult & { skipped?: boolean }> {
  if (key === "third-party-rates") {
    const existing = await readBestSnapshot(key).catch(() => null);
    const existingRows = existing?.payload ? countSnapshotPayloadRows(key, existing.payload as any) : 0;
    if (existing?.updatedAt && existingRows > 0 && minutesSince(existing.updatedAt) < freshMinutes) {
      return {
        key,
        ok: true,
        skipped: true,
        updatedAt: existing.updatedAt,
        rows: existingRows,
        message: `${key} 快照仍在 ${freshMinutes} 分钟内，本次不重复读取 Google Sheet`
      };
    }
    return refreshSnapshotModule(key, source);
  }

  // V239：不能只看当前月是否新鲜。每月 1-7 日，上个月仍在结算，
  // 当前月和结算月必须都在 freshMinutes 内才允许跳过。这样不会出现
  // “8 月刚更新过，于是 7 月结算快照整小时都被跳过”的情况。
  const activeMonths = scheduledWritableMonthlyKeys();
  const snapshots = await Promise.all(
    activeMonths.map((month) => readBestMonthlySnapshot(key as MonthlySnapshotModuleKey, month).catch(() => null))
  );
  const monthInfos = snapshots.map((snapshot, index) => ({
    month: activeMonths[index],
    snapshot,
    rows: snapshot?.payload ? countSnapshotPayloadRows(key, snapshot.payload as any) : 0
  }));
  const allFresh = monthInfos.length > 0 && monthInfos.every(({ snapshot, rows }) =>
    Boolean(snapshot?.updatedAt && rows > 0 && minutesSince(snapshot.updatedAt) < freshMinutes)
  );

  if (allFresh) {
    const latest = monthInfos
      .map(({ snapshot }) => snapshot?.updatedAt || "")
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || undefined;
    return {
      key,
      ok: true,
      skipped: true,
      updatedAt: latest,
      rows: monthInfos.reduce((sum, item) => sum + item.rows, 0),
      message: `${key} 当前月/结算月快照都仍在 ${freshMinutes} 分钟内，本次不重复读取 Google Sheet`
    };
  }

  return refreshSnapshotModule(key, source);
}

export async function refreshAllSnapshots(
  source: "hourly-sync" | "manual-sync" | "live-fallback" = "hourly-sync"
): Promise<SnapshotRefreshResult[]> {
  const results: SnapshotRefreshResult[] = [];
  for (const item of MODULES) {
    results.push(await refreshSnapshotModule(item.key, source));
    await sleep(1500);
  }
  return results;
}
