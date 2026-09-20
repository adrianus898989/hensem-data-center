import type { TimeQueryResult, TimeQuerySelection } from "./orderTimeVolume";
import { timePlatformCoverage, timePlatformCountry, timePlatformName } from "./orderTimeVolume";
import { collectionSuccessCountry, validCollectionSuccessSnapshot } from "./collectionSuccess";
import { canonicalThirdPartyPlatform } from "./thirdPartyPlatform";
import type { CollectionSuccessSnapshot, ThirdPartyVolumeRow } from "./types";

export type TimeComparisonIssue = {
  period: "current" | "previous";
  platform: string;
  date: string;
  direction: string;
  reason: string;
  expected?: number;
  stored?: number;
};

export type TimeComparisonState = {
  status: "loading" | "ready" | "error" | "unavailable";
  previous?: TimeQueryResult;
  previousRows?: ThirdPartyVolumeRow[];
  basis?: "daily" | "details";
  issues?: TimeComparisonIssue[];
};

/** A daily creation snapshot cannot certify an hourly or success-time slice. */
export function comparisonScopeIssues(result: TimeQueryResult): TimeComparisonIssue[] {
  const s = result.selection;
  const unsupported = s.basis !== "created" || s.createdStart || s.createdEnd
    || s.memberId || s.orderNumber || s.crossDayOnly || (s.status && s.status !== "all")
    || !/^00:00(?::00)?$/.test(s.start.slice(11)) || s.end.slice(11) !== "23:59:59";
  return unsupported ? [{period: "current", platform: "当前筛选范围", date: `${s.start.slice(0,10)} 至 ${s.end.slice(0,10)}`,
    direction: "", reason: "历史日汇总仅用于完整创建日对比，不能代替小时、成功时间或订单条件筛选。"}] : [];
}

/** Owner-approved historical baseline. Old collectors only uploaded daily totals;
 * missing old raw orders must not invalidate those totals. Match the platforms
 * actually queried, not unrelated names in the directory. Check coverage before
 * provider/type filtering: a provider absent from a covered day is a valid zero.
 */
export function historicalDailyComparison(result: TimeQueryResult, input: ThirdPartyVolumeRow[]): TimeComparisonState {
  const unsupported = comparisonScopeIssues(result);
  if (unsupported.length) return {status:"unavailable",issues:unsupported};
  const s=previousTimeSelection(result.selection), start=s.start.slice(0,10), end=s.end.slice(0,10);
  const platforms=new Map(result.payloads.map(({payload:p})=>{
    const identity={name:p.platform||"",team:p.team||"",country:p.country};
    return [timePlatformName(identity),timePlatformCountry(identity)] as const;
  }));
  const directions=s.direction?[s.direction]:["代收","代付"];
  const rows=input.map(row=>{
    const country=collectionSuccessCountry(row.country,row.platform);
    return {...row,country,platform:canonicalThirdPartyPlatform(country,row.platform)};
  }).filter(row=>row.date>=start&&row.date<=end&&platforms.get(row.platform)===row.country&&directions.includes(row.direction));
  const issues:TimeComparisonIssue[]=[];
  if(!platforms.size)issues.push({period:"previous",platform:"当前筛选范围",date:start,direction:"",reason:"没有可对比的平台。"});
  for(const [platform] of platforms)for(let day=Date.parse(`${start}T00:00:00Z`);day<=Date.parse(`${end}T00:00:00Z`);day+=86400000){
    const date=new Date(day).toISOString().slice(0,10);
    for(const direction of directions){
      const slice=rows.filter(row=>row.platform===platform&&row.date===date&&row.direction===direction);
      if(!slice.length)issues.push({period:"previous",platform,date,direction,reason:"此日期尚无该方向的历史日汇总；不按零计算，也不要求补跑旧明细。"});
      else if(slice.some(row=>typeof row.amount!=="number"||!Number.isFinite(row.amount)||row.amount<0||!Number.isSafeInteger(row.count)||row.count<0))
        issues.push({period:"previous",platform,date,direction,reason:"历史日汇总金额或笔数无效，待核实。"});
    }
  }
  return issues.length?{status:"unavailable",issues}:{status:"ready",previousRows:rows,basis:"daily"};
}

/** Fail closed for every platform × date × direction, including zero-order days.
 * Matching counts are a consistency check, not a new source for money. We never
 * substitute a daily summary/snapshot into either period's detail totals.
 */
export function timeComparisonIssues(result: TimeQueryResult, snapshots: CollectionSuccessSnapshot[],
  period: TimeComparisonIssue["period"], checkRows = true): TimeComparisonIssue[] {
  const issues: TimeComparisonIssue[] = [], s = result.selection;
  const first = Date.parse(`${s.start.slice(0,10)}T00:00:00Z`), last = Date.parse(`${s.end.slice(0,10)}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first || last-first >= 31*86400000)
    return [{period,platform:"当前筛选范围",date:"",direction:"",reason:"对比日期范围无效。"}];
  for (const platform of timePlatformCoverage(result).unavailable)
    issues.push({period,platform,date:`${s.start.slice(0,10)} 至 ${s.end.slice(0,10)}`,direction:"",reason:"所选平台没有可核验的订单来源。"});
  if (!result.payloads.length) return [...issues,{period,platform:"当前筛选范围",date:"",direction:"",reason:"没有可核验的订单来源。"}];
  const directions = s.direction === "代收" ? ["charge"] : s.direction === "代付" ? ["withdraw"] : ["charge","withdraw"];
  const seen = new Set<string>();
  for (const {payload} of result.payloads) {
    const identity = {name:payload.platform||"",team:payload.team||"",country:payload.country};
    const country = timePlatformCountry(identity), platform = timePlatformName(identity);
    if (seen.has(`${country}:${platform}`)) {
      issues.push({period,platform,date:"",direction:"",reason:"同一平台存在多个订单来源，尚不能确认无重复。"}); continue;
    }
    seen.add(`${country}:${platform}`);
    for (let day=first;day<=last;day+=86400000) for (const direction of directions) {
      const date = new Date(day).toISOString().slice(0,10), label = direction === "charge" ? "代收" : "代付";
      const source = direction === "charge" ? "RECHARGE_REVIEW" : "WITHDRAW_REVIEW";
      const matches = snapshots.filter(snapshot => snapshot && snapshot.source_system === source && snapshot.stat_date === date
        && collectionSuccessCountry(snapshot.country_code,snapshot.platform) === country
        && canonicalThirdPartyPlatform(country,snapshot.platform) === platform);
      const item = {period,platform,date,direction:label};
      if (matches.length !== 1 || !validCollectionSuccessSnapshot(matches[0],[source])
        || matches[0].timezone !== payload.timezone) {
        issues.push({...item,reason:matches.length>1?"采集记录来源重复，待核实。":"缺少同口径的完整采集记录；不代表确认漏采。"}); continue;
      }
      if (!checkRows) continue;
      const snapshot = matches[0], rows = payload.rows.filter(row=>row.direction===direction && row.created_date===date);
      const counts = rows.map(row=>Number(row.submitted_count)), successes = rows.map(row=>Number(row.success_count));
      const stored = counts.reduce((a,b)=>a+b,0), expected = snapshot.totals.submitted_count;
      if (counts.some(n=>!Number.isSafeInteger(n)||n<0) || successes.some(n=>!Number.isSafeInteger(n)||n<0)
        || stored!==expected || successes.reduce((a,b)=>a+b,0)!==snapshot.totals.success_count) {
        issues.push({...item,expected,stored:Number.isSafeInteger(stored)?stored:undefined,
          reason:stored<expected?"已入库明细少于完整采集记录。":"明细笔数或成功状态与采集记录不一致，待核实。"});
      } else if (rows.some(row=>row.success_amount==null || !Number.isFinite(Number(row.success_amount)))) {
        issues.push({...item,expected,stored,reason:"成功订单金额存在未确认值，暂不比较。"});
      }
    }
  }
  return issues;
}

/** Shift calendar dates, not the browser timezone or the selected clock hours. */
export function previousTimeSelection(selection: TimeQuerySelection): TimeQuerySelection {
  const startDay = Date.parse(`${selection.start.slice(0, 10)}T00:00:00Z`);
  const endDay = Date.parse(`${selection.end.slice(0, 10)}T00:00:00Z`);
  const days = Math.round((endDay - startDay) / 86400000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > 31) throw new Error("对比时间范围无效。");
  const shift = (value: string) => value
    ? new Date(Date.parse(`${value.slice(0, 10)}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10) + value.slice(10)
    : "";
  return { ...selection, start: shift(selection.start), end: shift(selection.end),
    createdStart: shift(selection.createdStart), createdEnd: shift(selection.createdEnd) };
}

export function timeComparisonLabel(selection: TimeQuerySelection): string {
  return selection.start.slice(0, 10) === selection.end.slice(0, 10) ? "较昨日" : "较前期";
}
