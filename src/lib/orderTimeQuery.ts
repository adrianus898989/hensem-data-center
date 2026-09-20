export type OrderTimeBasis = "created" | "success";
export type OrderTimeStatus = "all" | "success" | "pending" | "failed" | "rejected" | "unknown";
export type OrderTimeFilters = {
  platform: string; basis: OrderTimeBasis; start: string; end: string;
  timezone?: string;
  direction: "all" | "charge" | "withdraw"; createdStart: string; createdEnd: string;
  memberId?: string; orderNumber?: string; status?: OrderTimeStatus; crossDayOnly?: boolean;
};
export type OrderTimeRow = {
  direction: "charge" | "withdraw"; provider: string; channel_type: string; created_date: string | null; success_date: string | null;
  currency?: string | null;
  submitted_count: number; submitted_amount: number | null; success_count: number; success_amount: number | null;
  actual_amount: number | null; withdraw_fee: number | null; cross_day_count: number; cross_day_amount: number | null;
  earlier_count: number; earlier_amount: number | null; missing_success_time_count: number; missing_amount_count?: number;
  pending_count: number; pending_amount: number | null;
  first_created_at: string | null; last_created_at: string | null; first_success_at: string | null; last_success_at: string | null;
  last_synced_at: string;
};
export type OrderTimePlatform = {id: string; name: string; team: string; country?: string; timezone?: string; source?: string};
export type OrderTimePayload = {
  platforms: OrderTimePlatform[]; rows: OrderTimeRow[];
  platform?: string; team?: string; country?: string; source?: string; basis?: OrderTimeBasis; timezone: string;
};

const SOURCE_DEFAULT_ZONE = "Asia/Kolkata";
const sourceFormatters = new Map<string, Intl.DateTimeFormat>();
function sourceFormatter(zone = SOURCE_DEFAULT_ZONE): Intl.DateTimeFormat {
  const saved = sourceFormatters.get(zone);
  if (saved) return saved;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    sourceFormatters.set(zone, formatter);return formatter;
  } catch { throw new Error("平台时区尚未确认，请重新读取平台。"); }
}
export function sourceWallClock(epoch: number, zone = SOURCE_DEFAULT_ZONE): string {
  const parts = Object.fromEntries(sourceFormatter(zone).formatToParts(epoch).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
/** Parse a source-local clock, never the viewer's TZ. DST gaps/folds are explicit errors. */
export function sourceInstant(value: string, zone = SOURCE_DEFAULT_ZONE, inclusiveEnd = false): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new Error("请填写完整日期和时间。");
  const full = value.length === 16 ? `${value}:00` : value;
  const local = new Date(`${full}Z`);
  if (!Number.isFinite(local.getTime()) || local.toISOString().slice(0, 19) !== full) throw new Error("日期或时间无效。");
  const wall = local.getTime(), offsets = new Set<number>();
  for (const hours of [-48, -24, -12, 0, 12, 24, 48]) {
    const probe = wall + hours * 3600000;
    offsets.add(Date.parse(sourceWallClock(probe, zone) + "Z") - probe);
  }
  const candidates = [...offsets].map(offset => wall - offset).filter(epoch => sourceWallClock(epoch, zone) === full);
  if (!candidates.length) throw new Error("该平台时区不存在此时间（夏令时跳时），请调整时间。");
  if (candidates.length !== 1) throw new Error("该平台时间在夏令时切换中出现两次，请选择无歧义的时间边界。");
  return new Date(candidates[0] + (inclusiveEnd ? 1000 : 0)).toISOString();
}
export function indiaInstant(value: string, inclusiveEnd = false): string {
  return sourceInstant(value, SOURCE_DEFAULT_ZONE, inclusiveEnd);
}
/** Earliest next local date, including zones whose DST transition skips midnight. */
export function nextSourceMidnight(epoch: number, zone = SOURCE_DEFAULT_ZONE): number {
  const day = sourceWallClock(epoch, zone).slice(0, 10);
  let low = Math.floor(epoch / 1000) + 1, high = low + 48 * 3600;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (sourceWallClock(mid * 1000, zone).slice(0, 10) > day) high = mid;
    else low = mid + 1;
  }
  return low * 1000;
}

export function orderTimeRequest(filters: OrderTimeFilters) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(filters.platform)) throw new Error("请选择平台。");
  if (!["created", "success"].includes(filters.basis) || !["all", "charge", "withdraw"].includes(filters.direction)) throw new Error("查询口径无效。");
  const start = sourceInstant(filters.start, filters.timezone), end = sourceInstant(filters.end, filters.timezone, true);
  if (start >= end) throw new Error("开始时间不能晚于结束时间。");
  // Bound source-local calendar time, not elapsed UTC hours: a 31-day range
  // crossing the autumn DST change is legitimately 31 days plus one hour.
  const wallStart=filters.start.length===16?`${filters.start}:00`:filters.start;
  const wallEnd=filters.end.length===16?`${filters.end}:00`:filters.end;
  if (Date.parse(`${wallEnd}Z`) + 1000 - Date.parse(`${wallStart}Z`) > 31 * 86400_000) throw new Error("一次可查询最多31天，请缩短时间范围。");
  const createdStart = filters.basis === "success" && filters.createdStart ? sourceInstant(filters.createdStart, filters.timezone) : null;
  const createdEnd = filters.basis === "success" && filters.createdEnd ? sourceInstant(filters.createdEnd, filters.timezone, true) : null;
  if (createdStart && createdEnd && createdStart >= createdEnd) throw new Error("创建时间下限不能晚于上限。");
  const status=filters.status||"all";
  if (!["all","success","pending","failed","rejected","unknown"].includes(status)) throw new Error("订单状态无效。");
  const memberId=filters.memberId?.trim()||null,orderNumber=filters.orderNumber?.trim()||null;
  if ((memberId?.length||0)>200||(orderNumber?.length||0)>200) throw new Error("会员ID或订单号过长。");
  return {p_platform: filters.platform, p_basis: filters.basis, p_direction: filters.direction,
    p_start_at: start, p_end_at: end, p_created_start: createdStart, p_created_end: createdEnd,
    p_member_id:memberId,p_order_number:orderNumber,p_status:status,p_cross_day_only:!!filters.crossDayOnly};
}

export const timeAmountKeys = ["submitted_amount", "success_amount", "actual_amount", "withdraw_fee", "cross_day_amount", "earlier_amount", "pending_amount"] as const;
export const timeCountKeys = ["submitted_count", "success_count", "cross_day_count", "earlier_count", "missing_success_time_count", "missing_amount_count", "pending_count"] as const;
export const timeMetricKeys = [...timeCountKeys, ...timeAmountKeys] as const;
export type TimeTotals = Record<typeof timeCountKeys[number], number> & Record<typeof timeAmountKeys[number], number | null>;
export function timeTotals(rows: OrderTimeRow[]): TimeTotals {
  const totals = Object.fromEntries(timeMetricKeys.map(key => [key, 0])) as TimeTotals;
  const mixedCurrency = new Set(rows.map(row => row.currency || "")).size > 1;
  for (const row of rows) {
    for (const key of timeCountKeys) totals[key] += Number(row[key] || 0);
    for (const key of timeAmountKeys) {
      const value = row[key];
      // A partial sum is not a total. Explicit NULL means unavailable, not zero.
      totals[key] = mixedCurrency || totals[key] === null || value === null || (value !== undefined && !Number.isFinite(Number(value)))
        ? null : totals[key]! + Number(value ?? 0);
    }
  }
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
    .sort((a,b) => (b.success_amount ?? -Infinity) - (a.success_amount ?? -Infinity) || a.provider.localeCompare(b.provider));
}
export function indiaDay(offset = 0): string {
  return sourceDay(SOURCE_DEFAULT_ZONE, offset);
}
export function sourceDay(zone = SOURCE_DEFAULT_ZONE, offset = 0, nowMs = Date.now()): string {
  const day = sourceWallClock(nowMs, zone).slice(0, 10);
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
}
export type IndiaDateShortcut = "today" | "yesterday" | "beforeYesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth";
/** Use India's calendar date, then UTC date arithmetic (never the browser TZ). */
export function indiaShortcutDateRange(mode:IndiaDateShortcut,selectedDateKey="",nowMs=Date.now()):{start:string;end:string} {
  return sourceShortcutDateRange(mode,selectedDateKey,SOURCE_DEFAULT_ZONE,nowMs);
}
export function sourceShortcutDateRange(mode:IndiaDateShortcut,selectedDateKey="",zone=SOURCE_DEFAULT_ZONE,nowMs=Date.now()):{start:string;end:string} {
  const today=sourceDay(zone,0,nowMs);
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
export function sourceTime(value: string | null, zone = SOURCE_DEFAULT_ZONE): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return sourceWallClock(Date.parse(value),zone).replace("T"," ");
}
