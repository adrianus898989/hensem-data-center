import {canonicalThirdPartyName} from "./thirdPartyNameMap";
import {dashboardBusinessFetch} from "./dashboardDataClient";
import type {MetricEvidence,RiskSource,DelayBucket,MidnightEvidence} from "./providerAnomaly";

export type AnomalyReport = {version:1; generatedAt:string; sources:RiskSource[]; notices:string[]};
export type AnomalyDates = {startDate:string;endDate:string};
const LIMITATIONS:Record<string,string>={
  DETAIL_COLLECTION_COVERAGE_NOT_RECORDED:"订单明细尚无完整采集凭证，已读取样本不代表已经采齐。",
  CUSTOMER_PAYMENT_TIME_UNAVAILABLE:"支付时间尚未接入，耗时仅为订单创建至成功。",
  MIDNIGHT_HISTORY_NOT_RECONSTRUCTED:"历史零点状态不能事后倒推，缺少档案的日期保持未知。",
  OTHER_SUCCESS_PRODUCERS_EXCLUDED:"仅使用已核验的充值审单成功率来源，其他未确认口径未混入。",
};
export function anomalyQueryUrl(range:AnomalyDates):string {
  for(const value of [range.startDate,range.endDate])if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(`${value}T00:00:00Z`))||new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value)throw new Error("请选择有效的开始和结束日期。");
  const days=(Date.parse(range.endDate)-Date.parse(range.startDate))/86400000+1;
  if(days<1||days>31)throw new Error("日期区间须为 1—31 天。");
  return `/api/provider-anomalies?${new URLSearchParams(range)}`;
}
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const number=(v:unknown):number|null=>typeof v==="number"&&Number.isFinite(v)&&v>=0?v:null;
const text=(v:unknown):string=>typeof v==="string"?v:"";
function evidence(v:Record<string,unknown>):MetricEvidence {
  return {coverage:v.coverage==="complete"?1:typeof v.coverage==="number"&&v.coverage>=0&&v.coverage<=1?v.coverage:null,latestAt:text(v.latestAt)||null};
}
function midnightEvidence(value:unknown):MidnightEvidence|null {
  const m=object(value);if(!Object.keys(m).length)return null;
  return {...evidence(m),date:text(m.date),count:number(m.count),amount:number(m.amount),maxAgeDays:number(m.maxAgeDays),verified:m.verified===true,continuityVerified:m.continuityVerified===true,
    ageBuckets:Array.isArray(m.ageBuckets)?m.ageBuckets.map((value:unknown)=>{const b=object(value);return {minDays:number(b.minDays)??NaN,maxDays:b.maxDays===null?null:number(b.maxDays)??NaN,count:number(b.count)??NaN,amount:number(b.amount)??NaN};}):[]};
}
export function validateAnomalyReport(value:unknown,range?:AnomalyDates):AnomalyReport {
  const raw=object(value);
  if(raw.version!==1||!Array.isArray(raw.sources)||raw.sources.length>10000||!Number.isFinite(Date.parse(text(raw.generatedAt))))throw new Error("异常分析服务返回不完整，未进行评分。");
  if(range&&(raw.startDate!==range.startDate||raw.endDate!==range.endDate))throw new Error("异常分析返回的日期范围与查询不符。");
  const keys=new Set<string>();
  const sources=raw.sources.map((entry:unknown):RiskSource=>{
    const r=object(entry),country=text(r.country),platform=text(r.platform),provider=text(r.provider);
    if(!country||!platform||!provider||!Array.isArray(r.successDays))throw new Error("异常分析来源缺少平台或三方信息。");
    const currency=text(r.currency).trim().toUpperCase()||"未提供币种";
    const canonical=canonicalThirdPartyName(provider,/^(香港|红膏蟹)(盘口)?$/.test(country)?"印度":country)||provider;
    const key=JSON.stringify([country,platform,provider,currency]);
    if(keys.has(key))throw new Error("异常分析来源重复，未进行评分。");keys.add(key);
    const delay=object(r.createdSuccess),share=object(r.share);
    const buckets:DelayBucket[]|undefined=Array.isArray(delay.delayBuckets)?delay.delayBuckets.map((item:unknown)=>{
      const b=object(item);return {minSeconds:number(b.minSeconds)??NaN,maxSeconds:b.maxSeconds===null?null:number(b.maxSeconds)??NaN,count:number(b.count)??NaN};
    }):undefined;
    const dayKeys=new Set<string>();
    const successDays=r.successDays.map((entry:unknown)=>{
      const d=object(entry),date=text(d.date);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||dayKeys.has(date)||range&&(date<range.startDate||date>range.endDate))throw new Error("成功率日期缺失、重复或超出查询范围。");dayKeys.add(date);
      return {...evidence(d),date,total:number(d.total),success:number(d.success)};
    });
    if(range)for(let at=Date.parse(range.startDate);at<=Date.parse(range.endDate);at+=86400000){const day=new Date(at).toISOString().slice(0,10);if(!dayKeys.has(day))successDays.push({date:day,total:null,success:null,coverage:null,latestAt:null});}
    return {key,country,platform,provider,currency,canonicalProvider:canonical,timezone:text(r.timezone)||"源平台当地时间",
      delay:Object.keys(delay).length&&delay.basis==="created_to_success_proxy"?{...evidence(delay),sample:number(delay.sample),p95Seconds:number(delay.p95Seconds),buckets}:null,
      successDays:successDays.sort((a,b)=>a.date.localeCompare(b.date)),
      share:Object.keys(share).length?{...evidence(share),sample:number(share.sample),providerAmount:number(share.providerAmount),totalAmount:number(share.totalAmount),denominatorKey:text(share.denominatorKey)}:null,
      midnight:midnightEvidence(r.midnight),midnightDays:Array.isArray(r.midnightDays)?r.midnightDays.map(midnightEvidence).filter((v):v is MidnightEvidence=>v!==null):[],
    };
  });
  return {version:1,generatedAt:text(raw.generatedAt),sources,notices:Array.isArray(raw.limitations)?raw.limitations.filter((v):v is string=>typeof v==="string").map(v=>LIMITATIONS[v]||(/^[A-Z_]+$/.test(v)?"部分来源尚未完成核验，请以每项数据覆盖说明为准。":v)):[]};
}
export async function fetchAnomalyReport(range:AnomalyDates,signal:AbortSignal):Promise<AnomalyReport> {
  const response=await dashboardBusinessFetch(anomalyQueryUrl(range),{signal});
  if(!response.ok)throw Object.assign(new Error([404,501,503].includes(response.status)?"异常分析服务尚未就绪，暂不能判断三方状态。":"异常分析读取失败，请稍后重试。"),{status:response.status});
  return validateAnomalyReport(await response.json(),range);
}
