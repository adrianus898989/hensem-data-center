export type OrderTimeBasis = "created" | "success";
export type OrderTimeStatus = "all" | "success" | "pending" | "failed" | "rejected" | "unknown";
export type OrderTimeFilters = {
  platform: string; basis: OrderTimeBasis; start: string; end: string;
  direction: "all" | "charge" | "withdraw"; createdStart: string; createdEnd: string;
  memberId?: string; orderNumber?: string; status?: OrderTimeStatus; crossDayOnly?: boolean;
};
export type OrderTimeRow = {
  direction: "charge" | "withdraw"; provider: string; channel_type: string; created_date: string | null; success_date: string | null;
  submitted_count: number; submitted_amount: number; success_count: number; success_amount: number;
  actual_amount: number; withdraw_fee: number; cross_day_count: number; cross_day_amount: number;
  earlier_count: number; earlier_amount: number; missing_success_time_count: number;
  pending_count: number; pending_amount: number;
  first_created_at: string | null; last_created_at: string | null; first_success_at: string | null; last_success_at: string | null;
  last_synced_at: string;
};
export type OrderTimePayload = {
  platforms: {id: string; name: string; team: string}[]; rows: OrderTimeRow[];
  platform?: string; team?: string; basis?: OrderTimeBasis; timezone: string;
};

// Parse a source-local wall clock without involving the viewer's computer TZ.
export function indiaInstant(value: string, inclusiveEnd = false): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new Error("请填写完整日期和时间。");
  const full = value.length === 16 ? `${value}:00` : value;
  const local = new Date(`${full}Z`);
  if (!Number.isFinite(local.getTime()) || local.toISOString().slice(0, 19) !== full) throw new Error("日期或时间无效。");
  return new Date(local.getTime() - 330 * 60_000 + (inclusiveEnd ? 1000 : 0)).toISOString();
}

export function orderTimeRequest(filters: OrderTimeFilters) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(filters.platform)) throw new Error("请选择平台。");
  if (!["created", "success"].includes(filters.basis) || !["all", "charge", "withdraw"].includes(filters.direction)) throw new Error("查询口径无效。");
  const start = indiaInstant(filters.start), end = indiaInstant(filters.end, true);
  if (start >= end) throw new Error("开始时间不能晚于结束时间。");
  if (Date.parse(end) - Date.parse(start) > 31 * 86400_000) throw new Error("一次可查询最多31天，请缩短时间范围。");
  const createdStart = filters.basis === "success" && filters.createdStart ? indiaInstant(filters.createdStart) : null;
  const createdEnd = filters.basis === "success" && filters.createdEnd ? indiaInstant(filters.createdEnd, true) : null;
  if (createdStart && createdEnd && createdStart >= createdEnd) throw new Error("创建时间下限不能晚于上限。");
  const status=filters.status||"all";
  if (!["all","success","pending","failed","rejected","unknown"].includes(status)) throw new Error("订单状态无效。");
  const memberId=filters.memberId?.trim()||null,orderNumber=filters.orderNumber?.trim()||null;
  if ((memberId?.length||0)>200||(orderNumber?.length||0)>200) throw new Error("会员ID或订单号过长。");
  return {p_platform: filters.platform, p_basis: filters.basis, p_direction: filters.direction,
    p_start_at: start, p_end_at: end, p_created_start: createdStart, p_created_end: createdEnd,
    p_member_id:memberId,p_order_number:orderNumber,p_status:status,p_cross_day_only:!!filters.crossDayOnly};
}

export const timeMetricKeys = ["submitted_count", "submitted_amount", "success_count", "success_amount",
  "actual_amount", "withdraw_fee", "cross_day_count", "cross_day_amount", "earlier_count", "earlier_amount", "missing_success_time_count", "pending_count", "pending_amount"] as const;
export type TimeTotals = Record<typeof timeMetricKeys[number], number>;
export function timeTotals(rows: OrderTimeRow[]): TimeTotals {
  const totals = Object.fromEntries(timeMetricKeys.map(key => [key, 0])) as TimeTotals;
  for (const row of rows) for (const key of timeMetricKeys) totals[key] += Number(row[key] || 0);
  return totals;
}
export function orderTimeGroups(rows: OrderTimeRow[]) {
  const groups = new Map<string, {provider: string; direction: string; rows: OrderTimeRow[]}>();
  for (const row of rows) {
    const key = `${row.direction}\u001f${row.provider}`;
    const group = groups.get(key) || {provider: row.provider, direction: row.direction, rows: []};
    group.rows.push(row); groups.set(key, group);
  }
  return [...groups.values()].map(group => ({...group, ...timeTotals(group.rows)}))
    .sort((a,b) => b.success_amount - a.success_amount || a.provider.localeCompare(b.provider));
}
export function indiaDay(offset = 0): string {
  return new Date(Date.now() + 330 * 60_000 + offset * 86400_000).toISOString().slice(0,10);
}
export type IndiaDateShortcut = "today" | "yesterday" | "beforeYesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth";
/** Use India's calendar date, then UTC date arithmetic (never the browser TZ). */
export function indiaShortcutDateRange(mode:IndiaDateShortcut,selectedDateKey="",nowMs=Date.now()):{start:string;end:string} {
  const today=new Date(nowMs+330*60_000).toISOString().slice(0,10);
  const start=new Date(`${today}T00:00:00.000Z`),end=new Date(start);
  if(mode==="yesterday"||mode==="beforeYesterday") {
    start.setUTCDate(start.getUTCDate()-(mode==="yesterday"?1:2));end.setTime(start.getTime());
  } else if(mode==="thisWeek"||mode==="lastWeek") {
    start.setUTCDate(start.getUTCDate()-(start.getUTCDay()||7)+1-(mode==="lastWeek"?7:0));
    end.setTime(start.getTime());end.setUTCDate(end.getUTCDate()+6);
  } else if(mode==="thisMonth"||mode==="lastMonth") {
    // Keep the existing date-picker convention: "last month" can step back
    // from the selected month; other shortcuts always use India's current day.
    const selected=/^\d{4}-\d{2}-\d{2}$/.test(selectedDateKey)?new Date(`${selectedDateKey}T00:00:00.000Z`):null;
    if(mode==="lastMonth"&&selected&&Number.isFinite(selected.getTime())&&selected.toISOString().slice(0,10)===selectedDateKey)start.setTime(selected.getTime());
    start.setUTCDate(1);
    if(mode==="lastMonth")start.setUTCMonth(start.getUTCMonth()-1);
    end.setTime(start.getTime());end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
  }
  return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
}
export function sourceTime(value: string | null): string {
  if (!value) return "—";
  return new Date(Date.parse(value) + 330 * 60_000).toISOString().slice(0,19).replace("T"," ");
}
