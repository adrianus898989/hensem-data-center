export type AutoWithdrawRow = {
  country: string;
  platform: string;
  total: number;
  success: number;
  rejected: number;
  successRate: number;
  rejectRate: number;
  autoCount: number;
  manualCount: number;
  autoRate: number;
  manualRate: number;
  avgTime: string;
  yesterdayAvgTime: string;
  comparePercent: string;
  sourceSheet: string;
};

export type DailyWithdrawRow = AutoWithdrawRow & {
  date: string;
  blockTitle: string;
};

export type OperatorRow = {
  country: string;
  date: string;
  platform: string;
  account: string;
  processed: number;
  rejected: number;
  avgTime: string;
  yesterdayAvgTime: string;
  comparePercent: string;
};

export type SheetMeta = {
  year: string;
  month: string;
  updatedAt: string;
  source: "google-sheet" | "demo";
  message?: string;
  rawSourceId?: string;
  rawDailySheets?: string[];
  rawOperatorSheets?: string[];
  rawDailyRows?: number;
  rawOperatorRows?: number;
};

export type AutoWithdrawPayload = {
  meta: SheetMeta;
  monthlyRows: AutoWithdrawRow[];
  dailyRows: DailyWithdrawRow[];
  operatorRows: OperatorRow[];
};

export type ThirdPartyRateRow = {
  id: string;
  sheetName: string;
  country: string;
  category: string;
  thirdParty: string;
  collectFee: string;
  payoutFee: string;
  totalFee: string;
  collectSingleFee: string;
  payoutSingleFee: string;
  collectLimit: string;
  payoutLimit: string;
  channelInfo: string;
  leak: string;
  whitelist: string;
  status: string;
  sourceRow: number;
};

export type ThirdPartyPlatformStatusRow = {
  id: string;
  sheetName: string;
  country: string;
  platform: string;
  thirdParty: string;
  status: string;
  rawStatus: string;
  collectFee: string;
  payoutFee: string;
  totalFee: string;
  collectSingleFee: string;
  payoutSingleFee: string;
  collectLimit: string;
  payoutLimit: string;
  category: string;
  sourceRow: number;
  sourceColumn: number;
};

export type ThirdPartyRateSummary = {
  totalStatusCells: number;
  totalPlatforms: number;
  totalThirdParties: number;
  totalSheets: number;
  statusCounts: Record<string, number>;
  openCount: number;
  pauseCount: number;
  backupCount: number;
  disabledCount: number;
  notConnectedCount: number;
  maintenanceCount: number;
  unsupportedCount: number;
};

export type ThirdPartyRatePayload = {
  meta: SheetMeta & { sheets: string[] };
  summary: ThirdPartyRateSummary;
  rates: ThirdPartyRateRow[];
  platformStatuses: ThirdPartyPlatformStatusRow[];
  anomalies: string[];
};


export type WorkOrderRow = {
  id: string;
  date: string;
  country: string;
  platform: string;
  workType: string;
  workName: string;
  operator: string;
  accountType?: string;
  total: number;
  success: number;
  failed: number;
  pending: number;
  amount: number;
  status: string;
  sourceSheet: string;
  sourceRow: number;
  kind?: "daily" | "type" | "operator" | "generic";
};

export type WorkOrderSummary = {
  total: number;
  success: number;
  failed: number;
  pending: number;
  amount: number;
  countries: number;
  platforms: number;
  types: number;
  names: number;
  operators: number;
};

export type WorkOrderPayload = {
  meta: SheetMeta & { sheets: string[] };
  summary: WorkOrderSummary;
  rows: WorkOrderRow[];
  anomalies: string[];
};


export type ThirdPartyVolumeRow = {
  id: string;
  sheetName: string;
  sourceRow: number;
  date: string;
  country: string;
  platform: string;
  channel: string;
  rawChannel: string;
  channelType?: string;
  direction: "代收" | "代付";
  amount: number;
  count: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  status: string;
  raw?: Record<string, string>;
};

export type ThirdPartyVolumePayload = {
  meta: SheetMeta & { sheets: string[]; message?: string };
  rows: ThirdPartyVolumeRow[];
  aliasMap: Record<string, string[]>;
  summary: {
    rows: number;
    amount: number;
    count: number;
    successCount: number;
    failedCount: number;
    countries: number;
    platforms: number;
    channels: number;
  };
  anomalies: string[];
};

export type CustomerServiceRow = {
  id: string;
  sheetName: string;
  sourceRow: number;
  date: string;
  country: string;
  platform: string;
  staff: string;
  team: string;
  metricName: string;
  metricValue: number;
  rawText: string;
  fields: Record<string, string>;
};

export type CustomerServicePayload = {
  meta: SheetMeta & { sheets: string[]; headers: string[] };
  rows: CustomerServiceRow[];
  summary: {
    rows: number;
    sheets: number;
    countries: number;
    platforms: number;
    staff: number;
    teams: number;
    metricTotal: number;
  };
};
