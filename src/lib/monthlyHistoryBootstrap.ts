import {
  defaultHistoryStartMonth,
  effectiveMonthlyStatus,
  ensureLegacyArchivedMonthlySnapshots,
  migrateLegacyMonthSnapshot,
  monthsBetweenKeys,
  previousMonthKey,
  readBestMonthlySnapshot,
  writeArchivedMonthlySnapshotIfMissing,
  type MonthlySnapshotModuleKey
} from "./monthlySnapshotStore";
import {
  getAutoWithdrawPayload,
  getCustomerServicePayload,
  getThirdPartyVolumePayload,
  getWorkOrderPayload
} from "./googleSheets";
import { normalizeThirdPartyVolumePayload } from "./parseThirdPartyVolume";
import {
  countSnapshotPayloadRows,
  isSnapshotPayloadUsable,
  readSnapshotCursor,
  writeSnapshotCursorStrict
} from "./snapshotStore";

export type MonthlyBootstrapResult = {
  ok: boolean;
  skipped?: boolean;
  key?: MonthlySnapshotModuleKey;
  month?: string;
  rows?: number;
  message: string;
};

export type MonthlyBootstrapOptions = {
  preferredKey?: MonthlySnapshotModuleKey;
};

// 三方量历史最明显、数据最大，优先把 4/5/6 月建立好；工单随后处理。
const BASE_ORDER: MonthlySnapshotModuleKey[] = [
  "third-party-volume",
  "work-orders",
  "auto-withdraw",
  "customer-service"
];

const CURSOR_NAME = "monthly-history-v224";

type HistoryCursor = {
  nextIndex?: number;
  lastKey?: MonthlySnapshotModuleKey;
  lastMonth?: string;
  lastOk?: boolean;
  lastMessage?: string;
};

function orderedKeys(preferredKey?: MonthlySnapshotModuleKey): MonthlySnapshotModuleKey[] {
  // 页面发现某个模块缺历史月时，只处理该模块，避免游标刚好先跑到其它模块。
  // 无 preferredKey 的定时任务才按全模块顺序推进。
  if (preferredKey && BASE_ORDER.includes(preferredKey)) return [preferredKey];
  return [...BASE_ORDER];
}

function historicalPayloadComplete(key: MonthlySnapshotModuleKey, payload: any): boolean {
  const rows = countSnapshotPayloadRows(key, payload as any);
  if (rows <= 0 || !isSnapshotPayloadUsable(key, payload as any)) return false;
  const message = String(payload?.meta?.message || "");
  return !/Quota exceeded|Read requests|rateLimitExceeded|userRateLimitExceeded|读取失败|部分.*失败|失败数量|Missing environment|解析结果为 0 行/i.test(message);
}

async function loadMonth(key: MonthlySnapshotModuleKey, month: string): Promise<any> {
  if (key === "auto-withdraw") return getAutoWithdrawPayload({ months: [month] });
  if (key === "work-orders") return getWorkOrderPayload({ months: [month] });
  if (key === "customer-service") return getCustomerServicePayload({ months: [month] });

  // 历史三方量一次只读一个月，但必须同时读两个来源表和该月全部代收/代付页签。
  return normalizeThirdPartyVolumePayload(await getThirdPartyVolumePayload({
    months: [month],
    sourceIndexes: [0, 1],
    sheetModulo: 1,
    sheetRemainder: 0,
    columnModulo: 1,
    columnRemainder: 0
  }) as any);
}

function historyJobs(now: Date, preferredKey?: MonthlySnapshotModuleKey) {
  const previous = previousMonthKey(now);
  const months = monthsBetweenKeys(defaultHistoryStartMonth(), previous)
    .filter((month) => effectiveMonthlyStatus(month, now) === "archived");
  return orderedKeys(preferredKey).flatMap((key) => months.map((month) => ({ key, month })));
}

async function advanceCursor(nextIndex: number, job: { key: MonthlySnapshotModuleKey; month: string }, ok: boolean, message: string) {
  await writeSnapshotCursorStrict(CURSOR_NAME, {
    nextIndex,
    lastKey: job.key,
    lastMonth: job.month,
    lastOk: ok,
    lastMessage: message.slice(0, 1200)
  } satisfies HistoryCursor);
}

export async function runOneMonthlyHistoryBootstrap(
  now = new Date(),
  options: MonthlyBootstrapOptions = {}
): Promise<MonthlyBootstrapResult> {
  // V238：先只从旧大快照一次性拆出所有 4/5/6 等历史月。
  // 这一步只访问 Netlify Blobs，不访问 Google Sheet；能迁移的月份会立即建立独立快照。
  // 只有旧快照里真的没有的月份，下面才进入“每次最多一个月”的 Google 历史补建。
  for (const key of orderedKeys(options.preferredKey)) {
    await ensureLegacyArchivedMonthlySnapshots(key, now).catch(() => ({ created: 0, complete: false }));
  }

  const jobs = historyJobs(now, options.preferredKey);
  if (!jobs.length) {
    return { ok: true, skipped: true, message: "当前没有需要封存的历史月份" };
  }

  const cursor = await readSnapshotCursor<HistoryCursor>(CURSOR_NAME).catch(() => null);
  const startIndex = Math.max(0, Number(cursor?.nextIndex || 0)) % jobs.length;

  // 一次后台函数只建立一个月快照，避免大表在同一函数里连续读取导致 15 分钟超时。
  // 已存在的月份快速跳过，并从游标继续找下一个缺失项。
  for (let offset = 0; offset < jobs.length; offset += 1) {
    const index = (startIndex + offset) % jobs.length;
    const job = jobs[index];
    const nextIndex = (index + 1) % jobs.length;
    const existing = await readBestMonthlySnapshot(job.key, job.month).catch(() => null);
    // V228：历史月只在完全没有快照时建立一次；已有快照绝不重新读取或覆盖。
    if (existing) {
      continue;
    }

    // 先从旧大快照拆分，成功时完全不访问 Google Sheet。
    // 结算中/待最终封存的上个月必须重新读取，不能再从旧快照迁移。
    try {
      const migrated = existing ? false : await migrateLegacyMonthSnapshot(job.key, job.month);
      if (migrated) {
        const snapshot = await readBestMonthlySnapshot(job.key, job.month);
        const rows = snapshot?.payload ? countSnapshotPayloadRows(job.key, snapshot.payload as any) : 0;
        const message = `${job.key}/${job.month} 已从旧快照拆分并封存，后续不会再被每小时任务覆盖`;
        await advanceCursor(nextIndex, job, true, message).catch(() => undefined);
        return { ok: true, key: job.key, month: job.month, rows, message };
      }
    } catch {
      // 旧快照迁移失败时继续走 Google Sheet 建立，不让迁移问题卡住整个历史队列。
    }

    try {
      const payload = await loadMonth(job.key, job.month);
      const rows = countSnapshotPayloadRows(job.key, payload as any);
      if (!historicalPayloadComplete(job.key, payload)) {
        throw new Error(`${job.key}/${job.month} 返回 0 行或包含读取错误`);
      }
      const snapshot = await writeArchivedMonthlySnapshotIfMissing(job.key, job.month, payload as any, "manual-sync");
      const message = `${job.key}/${job.month} 月快照已封存，共 ${rows} 行，后续不会自动修改；建立时间 ${snapshot.updatedAt}`;
      await advanceCursor(nextIndex, job, true, message).catch(() => undefined);
      return { ok: true, key: job.key, month: job.month, rows, message };
    } catch (error) {
      const message = `${job.key}/${job.month} 建立失败：${error instanceof Error ? error.message : String(error)}`;
      // 失败也推进游标，避免一个坏月份永久挡住其他月份；下轮转回来时会再次重试。
      await advanceCursor(nextIndex, job, false, message).catch(() => undefined);
      return { ok: false, key: job.key, month: job.month, message };
    }
  }

  return {
    ok: true,
    skipped: true,
    message: "4月起所有历史月份都已有独立月快照，本次没有读取 Google Sheet"
  };
}
