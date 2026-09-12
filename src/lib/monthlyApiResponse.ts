import { countSnapshotPayloadRows, type SnapshotModuleKey } from "./snapshotStore";
import { type MonthlySnapshotModuleKey } from "./monthlySnapshotStore";
import { dashboardPrivateHeaders } from "./dashboardDataAccessServer";

export function weakMonthlyEtag(
  key: MonthlySnapshotModuleKey,
  months: string[],
  payload: unknown
): string {
  const data = (payload || {}) as any;
  const parts = [
    key,
    months.join(","),
    data?.meta?.snapshotUpdatedAt,
    data?.meta?.updatedAt,
    data?.meta?.year,
    data?.meta?.month,
    countSnapshotPayloadRows(key as SnapshotModuleKey, data),
    data?.summary?.total,
    data?.summary?.amount,
    data?.summary?.metricTotal
  ];
  const text = parts.map((part) => String(part ?? "")).join("|");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `W/"${key}-${(hash >>> 0).toString(16)}"`;
}

export function monthlyResponseHeaders(months: string[], etag = "", immutableHistory = true): Record<string, string> {
  // Archived source snapshots remain immutable in storage, but a user's
  // authorized projection can change at any time. Never cache it publicly.
  void months; void etag; void immutableHistory;
  return dashboardPrivateHeaders();
}
