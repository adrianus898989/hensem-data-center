import type {WithdrawPendingSnapshot} from "./types";
import type {TimeQueryResult} from "./orderTimeVolume";
import {timePlatformCoverage,timeVolumeData} from "./orderTimeVolume";
import {buildWithdrawPendingView,withdrawPendingCountry,validWithdrawPendingSnapshot} from "./withdrawPending";
import {canonicalThirdPartyPlatform} from "./thirdPartyPlatform";

export function usesMidnightPending(result:TimeQueryResult) {
  return !["香港","红膏蟹","所有国家USDT"].includes(withdrawPendingCountry(result.selection.country));
}

/** Pending is a closing balance, independent of the selected order cohort.
 * A date range uses its final day's snapshot, never a sum of overlapping windows.
 */
export function timePendingSnapshotView(result:TimeQueryResult,snapshots:readonly WithdrawPendingSnapshot[],error?:string) {
  const s=result.selection,date=s.end.slice(0,10);
  const targets=timePlatformCoverage(result).expected;
  const captured=new Set(snapshots.filter(snapshot=>snapshot.stat_date===date&&validWithdrawPendingSnapshot(snapshot)
    &&withdrawPendingCountry(snapshot.country_code,snapshot.platform)===withdrawPendingCountry(s.country))
    .map(snapshot=>canonicalThirdPartyPlatform(s.country,snapshot.platform)));
  const missing=targets.filter(platform=>!captured.has(platform));
  const view=buildWithdrawPendingView({snapshots,volumeRows:timeVolumeData(result).rows,
    start:date,end:date,country:s.country,platforms:timePlatformCoverage(result).expected,
    provider:s.channel,error});
  return {...view,basisHint:`代付中：${date} 日结快照（次日当地 00:00 采集），回溯近 7 个完整自然日的“已提交”。独立于创建／成功时间和小时筛选；多日查询取结束日快照。`,
    missingSnapshotPlatforms:error?[]:missing};
}
