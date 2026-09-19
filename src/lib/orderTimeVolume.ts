import type { ThirdPartyVolumeRow } from "./types";
import type { CollectionSuccessView, CollectionSuccessMetric } from "./collectionSuccess";
import { collectionSuccessProviderKey } from "./collectionSuccess";
import type { WithdrawActualView } from "./withdrawActual";
import type { WithdrawPendingView } from "./withdrawPending";
import { canonicalThirdPartyName } from "./thirdPartyNameMap";
import { platformDisplayCountry } from "./platformDisplayCountry";
import { timeTotals, sourceTime, type OrderTimeFilters, type OrderTimePayload, type OrderTimeRow } from "./orderTimeQuery";

export type TimeQuerySelection = {
  country: string; platforms: string[]; channel: string; types: string[]; direction: string;
  start: string; end: string; basis: "created" | "success"; createdStart: string; createdEnd: string;
  memberId?: string; orderNumber?: string;
  status?: "all" | "success" | "pending" | "failed" | "rejected" | "unknown";
  crossDayOnly?: boolean;
};
export type TimeQueryResult = { selection: TimeQuerySelection; payloads: Array<{id:string; payload:OrderTimePayload}> };
export type TimeSourceRow = OrderTimeRow & { platform:string; platformId:string; country:string; channel:string };

export function timePlatformCountry(platform: {name:string;team:string}) {
  return platformDisplayCountry(platform.team.replace(/团队$/, ""),platform.name);
}
export function timeSourceRows(result:TimeQueryResult):TimeSourceRow[] {
  const selected=result.selection;
  return result.payloads.flatMap(({id,payload})=>{
    const country=timePlatformCountry({name:payload.platform||"",team:payload.team||""});
    return payload.rows.map(row=>({...row,platform:payload.platform||"",platformId:id,country,channel:canonicalThirdPartyName(row.provider,country)}));
  }).filter(row=>(!selected.channel||row.channel===selected.channel)
    && (!selected.types.length||selected.types.includes(row.channel_type))
    && (!selected.direction||(selected.direction==="代收"?row.direction==="charge":row.direction==="withdraw")));
}
export function timeOrderFilters(result:TimeQueryResult,platform:string):OrderTimeFilters {
  const s=result.selection;
  return {platform,basis:s.basis,start:s.start,end:s.end,createdStart:s.createdStart,createdEnd:s.createdEnd,
    direction:s.direction==="代收"?"charge":s.direction==="代付"?"withdraw":"all",
    memberId:s.memberId,orderNumber:s.orderNumber,status:s.status,crossDayOnly:s.crossDayOnly};
}
/** A successful-order subset is not the complete created-order denominator. */
export function timeSuccessRateHint(selection:TimeQuerySelection):string {
  if(selection.basis==="success") return "成功时间仅查询成功订单，不计算代收／代付成功率；请选择创建时间查看成功笔数 ÷ 创建总笔数。";
  if(selection.crossDayOnly) return "仅跨日成功筛选不含完整创建总笔数，暂不显示代收／代付成功率。";
  if(selection.status&&selection.status!=="all") return "已筛选订单状态，不含完整创建总笔数；选择全部状态后显示代收／代付成功率。";
  return "代收／代付成功率分别按当前创建时间及搜索范围内的成功笔数 ÷ 创建总笔数计算，仅基于已入库明细。";
}
export function timeVolumeData(result:TimeQueryResult) {
  const source=timeSourceRows(result),basis=result.selection.basis;
  const key=(row:TimeSourceRow)=>collectionSuccessProviderKey(row.country,row.channel);
  const select=(keys?:readonly string[],types?:readonly string[])=>source.filter(row=>(!keys?.length||keys.includes(key(row)))&&(!types?.length||types.includes(row.channel_type)));
  const providers=[...new Map(source.map(row=>[key(row),{key:key(row),country:row.country,channel:row.channel}])).values()];
  const rows:ThirdPartyVolumeRow[]=source.map((r,i)=>({
    id:`time:${r.platformId}:${i}`,sheetName:"订单明细库",sourceRow:i+1,
    date:(basis==="created"?r.created_date:r.success_date)||result.selection.start.slice(0,10),
    country:r.country,platform:r.platform,channel:r.channel,rawChannel:r.provider,channelType:r.channel_type,
    direction:r.direction==="charge"?"代收":"代付",amount:Number(r.success_amount),count:Number(r.success_count),
    successCount:Number(r.success_count),failedCount:0,successRate:0,status:"已入库订单聚合",
    raw:{"时间口径":basis==="created"?"创建时间":"成功时间","创建日期":r.created_date||"—","成功日期":r.success_date||"—",
      "最早创建":sourceTime(r.first_created_at),"最晚创建":sourceTime(r.last_created_at),
      "最早成功":sourceTime(r.first_success_at),"最晚成功":sourceTime(r.last_success_at),
      "创建笔数":String(r.submitted_count),"成功笔数":String(r.success_count),"最近同步":sourceTime(r.last_synced_at)}
  }));
  const metric=(items:TimeSourceRow[],direction:"charge"|"withdraw"):CollectionSuccessMetric=>{
    const s=timeTotals(items.filter(r=>r.direction===direction));
    const valid=Number.isSafeInteger(s.submitted_count)&&Number.isSafeInteger(s.success_count)
      &&s.submitted_count>=0&&s.success_count>=0&&s.success_count<=s.submitted_count;
    return {submitted:s.submitted_count,success:s.success_count,
      rate:valid&&s.submitted_count>0?s.success_count/s.submitted_count:null,
      expected:1,captured:valid?1:0,state:!valid?"unavailable":s.submitted_count?"complete":"zero"};
  };
  const previous:CollectionSuccessMetric={submitted:0,success:0,rate:null,expected:0,captured:0,state:"missing"};
  const canShowSuccessRate=basis==="created"&&!result.selection.crossDayOnly
    &&(!result.selection.status||result.selection.status==="all");
  const successView=(direction:"charge"|"withdraw"):CollectionSuccessView|undefined=>canShowSuccessRate?{
    providers:providers.map(p=>({...p,submitted:metric(select([p.key]),direction).submitted})),
    compare:(keys,types)=>({current:metric(select(keys,types),direction),previous,deltaPoints:null,comparisonLabel:"已入库订单",platforms:[]})
  }:undefined;
  const collectionSuccess=successView("charge");
  const withdrawSuccess=successView("withdraw");
  const actual=(items:TimeSourceRow[])=>{
    const s=timeTotals(items.filter(r=>r.direction==="withdraw"));
    return {requestedAmount:s.success_amount,actualAmount:s.actual_amount,feeAmount:s.withdraw_fee,orderCount:s.success_count,
      expected:1,captured:1,state:"complete" as const};
  };
  const withdrawActual:WithdrawActualView={
    providers:providers.map(p=>({...p,...actual(select([p.key]))})),
    compare:keys=>({current:actual(select(keys)),previous:{...actual([]),state:"unavailable"}})
  };
  const pending=(items:TimeSourceRow[])=>{
    const s=timeTotals(items.filter(r=>r.direction==="withdraw"));
    return {amount:s.pending_amount,count:s.pending_count,expected:1,captured:1,state:"complete" as const};
  };
  const withdrawPending:WithdrawPendingView|undefined=basis==="created"?{
    providers:providers.map(p=>({...p,...pending(select([p.key]))})),
    compare:keys=>({current:pending(select(keys)),previous:{...pending([]),state:"unavailable"}})
  }:undefined;
  return {rows,source,collectionSuccess,withdrawSuccess,successRateHint:timeSuccessRateHint(result.selection),
    withdrawActual,withdrawPending,totals:timeTotals(source)};
}
