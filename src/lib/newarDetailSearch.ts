export type NewarDataset = "charge" | "withdraw" | "workorder";
export type NewarBasis = "created" | "success" | "processed";
export type NewarPlatform = {platform:string; country:string; country_code:string; timezone:string; launch_at:string|null; datasets:NewarDataset[]};
export type NewarCursor = {at:string; id:string};
export type NewarDetailRow = {id:string;source_id:string;member_id:string|null;order_number:string|null;
  third_party_order_number:string|null;provider:string|null;channel_type:string|null;currency:string|null;
  amount:string;actual_amount:string|null;fee:string|null;status_code:string|null;status_group:string;
  created_at:string;success_at:string|null;processed_at:string|null;source_updated_at:string|null;captured_at:string;
  workorder_type:string|null;operator:string|null;followup_count:number|null;cross_day:boolean};
export type NewarPage = {rows:NewarDetailRow[];hasMore:boolean;nextCursor:NewarCursor|null;timezone:string};
export type NewarDraft = {platform:string;dataset:NewarDataset;basis:NewarBasis;start:string;end:string;member:string;order:string;status:string};
const offsets:Record<string,number>={"Asia/Karachi":300,"Asia/Kolkata":330};
export function newarLocalInstant(value:string,zone:string,end=false):string {
  if(!Object.hasOwn(offsets,zone))throw new Error("平台时区尚未确认。");
  return sourceInstant(value,zone,end);
}
export function newarLocalTime(value:string|null,zone:string):string {
  if(!value||!Object.hasOwn(offsets,zone)||!Number.isFinite(Date.parse(value)))return "—";
  return sourceTime(value,zone);
}
export function newarDay(zone:string,offset=-1,now=Date.now()):string {
  if(!Object.hasOwn(offsets,zone))throw new Error("平台时区尚未确认。");
  return sourceDay(zone,offset,now);
}
export function newarDetailRequest(draft:NewarDraft,platform:NewarPlatform,cursor:NewarCursor|null=null) {
  if(draft.platform!==platform.platform||!platform.datasets.includes(draft.dataset))throw new Error("请选择有权限的平台及业务。");
  if(!["created","success","processed"].includes(draft.basis)||(draft.basis==="processed"&&draft.dataset!=="workorder"))throw new Error("查询时间口径无效。");
  const start=newarLocalInstant(draft.start,platform.timezone),end=newarLocalInstant(draft.end,platform.timezone,true);
  if(start>=end||Date.parse(end)-Date.parse(start)>31*86400000)throw new Error("时间范围须正序，且不能超过31天。");
  if(!["all","success","pending","failed","rejected","unknown"].includes(draft.status))throw new Error("订单状态无效。");
  const filters:Record<string,string>={};
  for(const [key,value] of [["member_id",draft.member],["order_number",draft.order]]){
    if(value.trim().length>200)throw new Error("会员ID或订单号过长。");
    if(value.trim())filters[key]=value.trim();
  }
  if(draft.status!=="all")filters.status_group=draft.status;
  return {p_platform:platform.platform,p_dataset:draft.dataset,p_basis:draft.basis,p_start_at:start,p_end_at:end,p_filters:filters,p_cursor:cursor,p_limit:50};
}
export function validateNewarPlatforms(value:unknown):NewarPlatform[] {
  const list=(value as {platforms?:unknown})?.platforms;
  if(!Array.isArray(list))throw new Error("平台返回不完整。");
  const seen=new Set<string>();
  for(const p of list){
    if(!p||!["POPZAR","DhaniWin","92BLAZE"].includes(p.platform)||seen.has(p.platform)
      ||!Object.hasOwn(offsets,p.timezone)||typeof p.country!=="string"||typeof p.country_code!=="string"
      ||!Array.isArray(p.datasets)||!p.datasets.length||p.datasets.some((d:unknown)=>!["charge","withdraw","workorder"].includes(String(d)))
      ||(p.launch_at!==null&&!Number.isFinite(Date.parse(p.launch_at))))throw new Error("平台返回不完整。");
    seen.add(p.platform);
  }
  return list;
}
export function validateNewarPage(value:unknown,request:ReturnType<typeof newarDetailRequest>,platform:NewarPlatform):NewarPage {
  const p=value as NewarPage & {platform:string;dataset:NewarDataset;basis:NewarBasis};
  if(!p||p.platform!==platform.platform||p.timezone!==platform.timezone||p.dataset!==request.p_dataset||p.basis!==request.p_basis
    ||!Array.isArray(p.rows)||p.rows.length>50||typeof p.hasMore!=="boolean")throw new Error("订单返回不完整。");
  if(p.hasMore&&(!p.nextCursor||!Number.isFinite(Date.parse(p.nextCursor.at))||!/^[a-f0-9-]{36}$/i.test(p.nextCursor.id)))throw new Error("分页返回不完整。");
  const ids=new Set<string>();
  for(const row of p.rows){
    if(!row||typeof row.id!=="string"||ids.has(row.id)||typeof row.source_id!=="string"
      ||typeof row.created_at!=="string"||!Number.isFinite(Date.parse(row.created_at))
      ||typeof row.captured_at!=="string"||!Number.isFinite(Date.parse(row.captured_at))
      ||!["success","pending","failed","rejected","unknown"].includes(row.status_group)
      ||typeof row.cross_day!=="boolean")throw new Error("订单返回不完整。");
    for(const field of ["amount","actual_amount","fee"] as const){
      if((field==="amount"||row[field]!==null)&&(typeof row[field]!=="string"||!/^\d+(?:\.\d+)?$/.test(row[field]!)))throw new Error("金额返回不完整。");
    }
    ids.add(row.id);
  }
  return p;
}
import {sourceDay,sourceInstant,sourceTime} from "./orderTimeQuery";
