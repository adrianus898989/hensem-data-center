export type ClientMonthlyModuleKey = "auto-withdraw" | "work-orders" | "third-party-volume" | "customer-service";

export type ClientMonthlyStatus = {
  ok: boolean;
  module: ClientMonthlyModuleKey;
  currentMonth: string;
  settlingMonth?: string | null;
  preferredMonth: string;
  version: string;
  checkedAt?: string | null;
  changedAt?: string | null;
  rows: number;
  status: "current" | "settling" | "archived";
};

export function payloadSnapshotVersion(payload: any): string {
  const direct = String(payload?.meta?.snapshotVersion || "");
  if (direct) return direct;
  const info = Array.isArray(payload?.meta?.monthlySnapshots) ? payload.meta.monthlySnapshots : [];
  if (info.length) {
    return info.map((item: any) => `${item?.month || ""}:${item?.checksum || item?.updatedAt || item?.rows || ""}`).join("|");
  }
  return String(payload?.meta?.snapshotUpdatedAt || payload?.meta?.updatedAt || "");
}

export function payloadSnapshotMonth(payload: any): string {
  const info = Array.isArray(payload?.meta?.monthlySnapshots) ? payload.meta.monthlySnapshots : [];
  if (info.length === 1) return String(info[0]?.month || "");
  const year = String(payload?.meta?.year || "");
  const month = String(payload?.meta?.month || "");
  if (/^20\d{2}$/.test(year) && /^\d{1,2}$/.test(month)) return `${year}_${month.padStart(2, "0")}`;
  return "";
}

export async function fetchPreferredMonthlyStatus(module: ClientMonthlyModuleKey): Promise<ClientMonthlyStatus | null> {
  try {
    const response = await fetch(`/api/monthly-status?module=${encodeURIComponent(module)}`, { cache: "default" });
    if (!response.ok) return null;
    const json = await response.json();
    return json?.ok ? json as ClientMonthlyStatus : null;
  } catch {
    return null;
  }
}

export function statusMatchesPayload(status: ClientMonthlyStatus | null, payload: any): boolean {
  if (!status || !payload) return false;
  const version = payloadSnapshotVersion(payload);
  const month = payloadSnapshotMonth(payload);
  if (status.preferredMonth && month && status.preferredMonth !== month) return false;
  return Boolean(status.version && version && status.version === version);
}
