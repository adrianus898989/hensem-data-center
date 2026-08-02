import type {
  AutoWithdrawPayload,
  CustomerServicePayload,
  ThirdPartyRatePayload,
  ThirdPartyVolumePayload,
  WorkOrderPayload
} from "./types";

function baseMeta(source: "snapshot-waiting" | "google-sheet" | "demo", message: string) {
  const now = new Date();
  return {
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1),
    updatedAt: now.toISOString(),
    source,
    message
  } as any;
}

export function emptyAutoWithdrawPayload(message: string): AutoWithdrawPayload {
  return {
    meta: baseMeta("snapshot-waiting", message),
    monthlyRows: [],
    dailyRows: [],
    operatorRows: []
  };
}

export function emptyWorkOrderPayload(message: string): WorkOrderPayload {
  return {
    meta: { ...baseMeta("snapshot-waiting", message), sheets: [] },
    summary: {
      total: 0,
      success: 0,
      failed: 0,
      pending: 0,
      amount: 0,
      countries: 0,
      platforms: 0,
      types: 0,
      names: 0,
      operators: 0
    },
    rows: [],
    anomalies: []
  };
}

export function emptyThirdPartyVolumePayload(message: string): ThirdPartyVolumePayload {
  return {
    meta: { ...baseMeta("snapshot-waiting", message), sheets: [] },
    rows: [],
    aliasMap: {},
    summary: {
      rows: 0,
      amount: 0,
      count: 0,
      successCount: 0,
      failedCount: 0,
      countries: 0,
      platforms: 0,
      channels: 0
    },
    anomalies: []
  };
}

export function emptyThirdPartyRatePayload(message: string): ThirdPartyRatePayload {
  return {
    meta: { ...baseMeta("snapshot-waiting", message), sheets: [] },
    summary: {
      totalStatusCells: 0,
      totalPlatforms: 0,
      totalThirdParties: 0,
      totalSheets: 0,
      statusCounts: {},
      openCount: 0,
      pauseCount: 0,
      backupCount: 0,
      disabledCount: 0,
      notConnectedCount: 0,
      maintenanceCount: 0,
      unsupportedCount: 0
    },
    rates: [],
    platformStatuses: [],
    anomalies: []
  };
}

export function emptyCustomerServicePayload(message: string): CustomerServicePayload {
  return {
    meta: { ...baseMeta("snapshot-waiting", message), sheets: [], headers: [] },
    rows: [],
    summary: {
      rows: 0,
      sheets: 0,
      countries: 0,
      platforms: 0,
      staff: 0,
      teams: 0,
      metricTotal: 0
    }
  };
}
