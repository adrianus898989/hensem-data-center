import { countSnapshotPayloadRows, type SnapshotModuleKey } from "./snapshotStore";
import { effectiveMonthlyStatus, type MonthlySnapshotModuleKey } from "./monthlySnapshotStore";

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
  const normalized = Array.from(new Set(months.filter(Boolean)));
  // V236：只有真正超过结算期的月份才使用 immutable。
  // 月初前 7 天的上个月仍是 settling，必须走短缓存，避免把未补齐的月底数据缓存一年。
  const historicalOnly = normalized.length > 0 && normalized.every((month) => effectiveMonthlyStatus(month) === "archived");
  if (historicalOnly && immutableHistory) {
    return {
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Netlify-CDN-Cache-Control": "public, durable, max-age=31536000, immutable",
      "CDN-Cache-Control": "public, max-age=31536000, immutable",
      "Vary": "Accept-Encoding",
      ...(etag ? { ETag: etag } : {})
    };
  }
  return {
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    "Netlify-CDN-Cache-Control": "public, durable, max-age=120, stale-while-revalidate=300",
    "CDN-Cache-Control": "public, max-age=120, stale-while-revalidate=300",
    "Vary": "Accept-Encoding",
    ...(etag ? { ETag: etag } : {})
  };
}
