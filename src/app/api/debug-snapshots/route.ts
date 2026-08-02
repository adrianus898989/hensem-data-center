import { NextResponse } from "next/server";
import {
  SNAPSHOT_KEYS,
  countSnapshotPayloadRows,
  isSnapshotPayloadUsable,
  readBestSnapshot,
  readLastGoodSnapshot,
  readSnapshot
} from "@/lib/snapshotStore";
import {
  MONTHLY_MODULE_KEYS,
  defaultDashboardMonths,
  readBestMonthlySnapshot
} from "@/lib/monthlySnapshotStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function compact(key: any, snapshot: any) {
  if (!snapshot?.payload) return null;
  const rows = countSnapshotPayloadRows(key, snapshot.payload as any);
  return {
    updatedAt: snapshot.updatedAt,
    source: snapshot.source,
    schemaVersion: snapshot.schemaVersion,
    rows,
    usable: isSnapshotPayloadUsable(key, snapshot.payload as any),
    status: snapshot.status || null,
    month: snapshot.month || null,
    metaUpdatedAt: snapshot.payload?.meta?.updatedAt || null,
    message: snapshot.payload?.meta?.message || ""
  };
}

export async function GET() {
  const legacyModules = await Promise.all(SNAPSHOT_KEYS.map(async (key) => {
    const [current, lastGood, best] = await Promise.all([
      readSnapshot(key).catch(() => null),
      readLastGoodSnapshot(key).catch(() => null),
      readBestSnapshot(key).catch(() => null)
    ]);
    return {
      key,
      current: compact(key, current),
      lastGood: compact(key, lastGood),
      best: compact(key, best)
    };
  }));

  const months = defaultDashboardMonths();
  const monthlyModules = await Promise.all(MONTHLY_MODULE_KEYS.map(async (key) => ({
    key,
    months: await Promise.all(months.map(async (month) => compact(key, await readBestMonthlySnapshot(key, month).catch(() => null))))
  })));

  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    schema: "v223-monthly",
    months,
    monthlyModules,
    legacyModules
  }, {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}
