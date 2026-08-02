import { countSnapshotPayloadRows, readBestSnapshot, type SnapshotModuleKey } from "./snapshotStore";
import { currentMonthlySnapshotInfo } from "./monthlySnapshotStore";
import { refreshSnapshotModuleIfStale, type SnapshotRefreshResult } from "./snapshotSync";

type ScheduledResult = SnapshotRefreshResult & {
  skipped?: boolean;
  beforeUpdatedAt?: string | null;
  beforeRows?: number;
  afterUpdatedAt?: string | null;
  afterRows?: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function snapshotInfo(key: SnapshotModuleKey): Promise<{ updatedAt: string | null; rows: number }> {
  if (key !== "third-party-rates") {
    const info = await currentMonthlySnapshotInfo(key as any).catch(() => null);
    return { updatedAt: info?.updatedAt || null, rows: info?.rows || 0 };
  }
  const snapshot = await readBestSnapshot(key).catch(() => null);
  return {
    updatedAt: snapshot?.updatedAt || null,
    rows: snapshot?.payload ? countSnapshotPayloadRows(key, snapshot.payload as any) : 0
  };
}

export async function runScheduledSnapshotRefresh(
  key: SnapshotModuleKey,
  label: string,
  freshMinutes = 50
): Promise<ScheduledResult> {
  const startedAt = nowIso();
  const before = await snapshotInfo(key);
  console.log(`[${label}] sync start`, safeJson({ key, startedAt, freshMinutes, before }));

  const result = await refreshSnapshotModuleIfStale(key, "hourly-sync", freshMinutes);
  const after = await snapshotInfo(key);
  const out: ScheduledResult = {
    ...result,
    beforeUpdatedAt: before.updatedAt,
    beforeRows: before.rows,
    afterUpdatedAt: after.updatedAt,
    afterRows: after.rows
  };

  const sameSnapshot = before.updatedAt === after.updatedAt && before.rows === after.rows;
  const level = result.ok ? "log" : "error";
  console[level](`[${label}] sync result`, safeJson(out));

  if (!result.ok) {
    console.error(`[${label}] sync failed, old snapshot kept`, safeJson(out));
  } else if (result.skipped) {
    console.log(`[${label}] sync skipped/no-op; old snapshot kept`, safeJson(out));
  } else if (sameSnapshot) {
    console.error(`[${label}] sync returned ok but snapshot did not change`, safeJson(out));
  }

  return out;
}
