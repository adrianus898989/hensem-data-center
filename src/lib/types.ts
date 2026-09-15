export type AutoWithdrawCounts = {
  total: number;
  success: number;
  rejected: number;
  autoCount: number;
  manualCount: number;
};

export type AutoWithdrawPreviousDay = AutoWithdrawCounts & { date: string };

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
  previousDay?: AutoWithdrawPreviousDay | null;
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
  source: "google-sheet" | "demo" | "supabase" | "history+supabase";
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
  /** 已处理工单中由系统自动处理的数量（来自 employee_rows 汇总）。 */
  auto?: number;
  /** 已处理工单中由人工处理的数量（来自 employee_rows 汇总）。 */
  manual?: number;
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
  /** Submission-day counts, independent of the legacy volume success fields. */
  collectionSuccessSnapshots?: CollectionSuccessSnapshot[];
  collectionSuccessError?: string;
  /** Daily exact-"已提交" payout snapshots; independent of payout success/volume fields. */
  withdrawPendingSnapshots?: WithdrawPendingSnapshot[];
  withdrawPendingError?: string;
  /** AR 工单“存款未到账”每日提交/成功聚合；由采集脚本直接写入 Supabase。 */
  workOrderDepositRows?: WorkOrderDepositRow[];
  workOrderDepositError?: string;
  /** 提现订单实际到账金额与手续费的安全聚合；原始订单字段不会下发到前端。 */
  withdrawActualRows?: WithdrawActualRow[];
  withdrawActualError?: string;
};

export type WorkOrderDepositRow = {
  system_name: string;
  source_system: string;
  stat_date: string;
  country_code: string;
  country: string;
  platform: string;
  third_party: string;
  channel_type: string;
  submitted_count: number;
  submitted_amount: number;
  success_count: number;
  success_amount: number;
  status_counts?: Record<string, number>;
  source_updated_at?: string;
};

export type WithdrawActualRow = {
  stat_date: string;
  country_code: string;
  country: string;
  platform: string;
  third_party: string;
  channel_type: string;
  order_count: number;
  requested_amount: number;
  actual_amount: number;
  fee_amount: number;
  source_updated_at?: string;
};

export type CollectionSuccessSnapshot = {
  schema_version: 1;
  source_system: string;
  country_code: string;
  platform: string;
  stat_date: string;
  timezone: string;
  snapshot_id: string;
  snapshot_at: string;
  coverage: { complete: boolean; expected_count: number; fetched_count: number; unique_count: number };
  totals: { submitted_count: number; success_count: number };
  groups: Array<{ raw_channel: string; channel_type: string; submitted_count: number; success_count: number }>;
};

export type WithdrawPendingSnapshot = {
  schema_version: 1;
  source_system: string;
  country_code: string;
  platform: string;
  stat_date: string;
  timezone: string;
  snapshot_id: string;
  snapshot_at: string;
  coverage: { complete: boolean; expected_count: number; fetched_count: number; unique_count: number };
  totals: { pending_count: number; pending_amount: number };
  groups: Array<{ raw_channel: string; channel_type: string; pending_count: number; pending_amount: number }>;
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
