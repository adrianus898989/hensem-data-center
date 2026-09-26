"use client";
import { ensureDashboardSession, type DashboardSession } from "./dashboardAuthClient";
import { validateConfigurationRequest } from "./adminConfigurationRequest";
export const LIVE_REQUEST = "hensem-admin-live-request";
export const LIVE_RESPONSE = "hensem-admin-live-response";
export const LIVE_CANCEL = "hensem-admin-live-cancel";
export const LIVE_REQUEST_TIMEOUT_MS = 90000;
const actions = ["catalog","syncHealth","reportSummary","collectedData","query","aggregate","details","rates","ratesSheet","payoutConfig","autoWithdraw","depositIssues","workorders","providerConfig","platformAssignments","providerOptions","configurationAccess","configurationWrite","withdrawReasons","withdrawNote"];
const keys = new Set(["feeds","sourceKind","dataset","action","platformId","startAt","endAt","direction","status","orderNumber","thirdPartyOrderNumber","memberId","systemOrderId","utr","providers","channelTypes","currency","amountMin","amountMax","offset","limit","scopeType","country","platform","provider","rawProvider","canonicalProvider","query","sheetId","operation","system","team","view","platforms","platformIds","expectedVersion","mappingId","sourceSystem","countryCode","sourceCountry","sourcePlatform","platformName","userId","canManage","account","date","kind","hour","bucket","cumulative","sort","ascending","daily","reason","category","reasonKey","operatorKey","dateMode","match","followupStatus"]);
export function validateAdminLiveRequest(input:unknown):Record<string,unknown> {
  if(!input||typeof input!=="object"||Array.isArray(input))throw Error("查询参数无效");
  const p=input as Record<string,unknown>;
  if(Object.keys(p).some(k=>!keys.has(k))||!actions.includes(String(p.action)))throw Error("查询方法无效");
  if(p.action!=="reportSummary"&&p.feeds!==undefined)throw Error("日报来源仅用于日报汇总");
  if(p.action!=="collectedData"&&(p.dataset!==undefined||p.sourceKind!==undefined))throw Error("采集来源仅用于平台数据接入页面");
  if(p.action!=="depositIssues"&&["dateMode","match","followupStatus"].some(k=>p[k]!==undefined))throw Error("核对筛选仅用于存款未到账页面");
  if(p.action!=="withdrawReasons"&&["category","reasonKey","operatorKey"].some(k=>p[k]!==undefined))throw Error("原因筛选仅用于驳回分析");
  if(["providerOptions","configurationAccess","configurationWrite"].includes(String(p.action)))return validateConfigurationRequest(p);
  if(p.view!==undefined&&(!["aggregate","autoWithdraw","depositIssues"].includes(String(p.action))||(p.action==="aggregate"&&!["full","providers","drilldown"].includes(String(p.view)))))throw Error("统计页面类型无效");
  const drilldown=p.action==="aggregate"&&p.view==="drilldown";
  if(!drilldown&&["hour","bucket","cumulative"].some(key=>p[key]!==undefined))throw Error("分段条件仅用于每日对比");
  if(drilldown){
    const allowed=new Set(["action","view","platformId","startAt","endAt","direction","status","orderNumber","thirdPartyOrderNumber","memberId","systemOrderId","utr","providers","channelTypes","currency","amountMin","amountMax","offset","limit","kind","hour","bucket","cumulative"]);
    if(Object.keys(p).some(key=>!allowed.has(key))||typeof p.kind!=="string"||!["hourly","amount","amount_range","matrix","matrix_range","latency"].includes(p.kind))throw Error("每日对比分段无效");
    if(p.status!==undefined&&p.status!=="all")throw Error("每日对比需保留全部订单状态");
    if(p.offset!==undefined&&p.offset!==0)throw Error("每日对比返回完整范围，无需分页");
    if(["hourly","matrix","matrix_range"].includes(p.kind)){
      if(!Number.isInteger(p.hour)||Number(p.hour)<0||Number(p.hour)>23)throw Error("每日对比小时无效");
    }else if(p.hour!==undefined)throw Error("此分段不使用小时条件");
    if(p.kind==="latency"){
      if(!Number.isInteger(p.bucket)||Number(p.bucket)<0||Number(p.bucket)>9)throw Error("到账时效档位无效");
      if(p.cumulative!==undefined&&typeof p.cumulative!=="boolean")throw Error("到账时效累计条件无效");
      if(p.cumulative===true&&p.bucket===9)throw Error("到账时效累计阈值无效");
    }else{
      if(p.cumulative!==undefined)throw Error("此分段不使用累计条件");
      if(p.kind==="hourly"){if(p.bucket!==undefined)throw Error("小时分段不使用金额档位");}
      else{
        const buckets=["amount","matrix"].includes(p.kind)?["100","200","300","400","500","750","1000","1500","2000","5000","other","unknown"]:["100–200","201–300","301–400","401–500","501–750","751–1,000","1,001–2,000","2,001–5,000","≥5,001","other","unknown"];
        if(typeof p.bucket!=="string"||!buckets.includes(p.bucket))throw Error("每日对比金额档位无效");
      }
    }
  }
  if(p.action==="catalog")return {action:"catalog"};
  if(p.action==="syncHealth"){
    if(Object.keys(p).some(k=>!["action","offset","limit"].includes(k)))throw Error("同步检查参数无效");
    if(p.offset!==undefined&&(!Number.isSafeInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>50000))throw Error("同步检查页码无效");
    if(p.limit!==undefined&&(typeof p.limit!=="number"||![50,100,200,5000].includes(p.limit)))throw Error("同步检查分页无效");
    return {...p};
  }
  if(p.action==="reportSummary"){
    if(Object.keys(p).some(k=>!["action","startAt","endAt","feeds"].includes(k)))throw Error("日报汇总参数无效");
    for(const key of ["startAt","endAt"])if(typeof p[key]!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(String(p[key]))||!Number.isFinite(Date.parse(String(p[key])))||new Date(String(p[key])).toISOString().slice(0,10)!==p[key])throw Error("日报日期无效");
    const days=(Date.parse(String(p.endAt))-Date.parse(String(p.startAt)))/86400000;
    if(days<0||days>30)throw Error("查询范围最多31个当地日");
    if(!Array.isArray(p.feeds)||p.feeds.length<1||p.feeds.length>250)throw Error("请选择1至250个日报来源");
    for(const value of p.feeds){
      if(!value||typeof value!=="object"||Array.isArray(value))throw Error("日报来源无效");
      const f=value as Record<string,unknown>;
      if(Object.keys(f).some(k=>!["dataset","system","country","platform","direction","sourceKind"].includes(k)))throw Error("日报来源无效");
      if(!["volume","panda_success","lg_success","collection_success","newar_third_party_volume","auto"].includes(String(f.dataset)))throw Error("日报类型无效");
      for(const key of ["dataset","system","country","platform"])if(typeof f[key]!=="string"||(key!=="country"&&!f[key])||String(f[key]).length>200||/[\u0000-\u001f]/.test(String(f[key])))throw Error("日报来源无效");
      if(!["charge","withdraw"].includes(String(f.direction)))throw Error("日报方向无效");
      if(typeof f.sourceKind!=="string"||!["direct","google_sheets","unknown"].includes(f.sourceKind))throw Error("日报来源链路无效");
    }
    return {...p};
  }
  if(p.action==="collectedData"){
    const allowed=p.operation==='catalog'?["action","operation"]:["action","operation","dataset","country","platform","startAt","endAt","offset","limit","direction","sourceKind"];
    if(!['catalog','rows'].includes(String(p.operation))||Object.keys(p).some(k=>!allowed.includes(k)))throw Error("采集数据参数无效");
    if(p.operation==='rows'){
      for(const k of ['dataset','country','platform'])if(typeof p[k]!=="string"||String(p[k]).length>200||/[\u0000-\u001f]/.test(String(p[k])))throw Error("采集来源无效");
      if(!p.dataset||!p.platform)throw Error("请选择平台和数据来源");
      if(p.direction!==undefined&&!["charge","withdraw"].includes(String(p.direction)))throw Error("业务方向无效");
      if(p.sourceKind!==undefined&&(p.dataset!=="volume"||!["direct","google_sheets","unknown"].includes(String(p.sourceKind))))throw Error("数据来源无效");
      for(const k of ['startAt','endAt'])if(typeof p[k]!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(String(p[k]))||!Number.isFinite(Date.parse(String(p[k])))||new Date(String(p[k])).toISOString().slice(0,10)!==p[k])throw Error("日报日期无效");
      const days=(Date.parse(String(p.endAt))-Date.parse(String(p.startAt)))/86400000;
      if(days<0||days>30)throw Error("查询范围最多31个当地日");
      if(p.limit!==undefined&&![20,30,50,100,500].includes(Number(p.limit))||p.limit!==undefined&&typeof p.limit!=="number")throw Error("分页大小无效");
      if(p.offset!==undefined&&(!Number.isSafeInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>1000000))throw Error("页码无效");
    }
    return {...p};
  }
  if(p.action==="ratesSheet"){
    if(Object.keys(p).some(k=>!["action","sheetId"].includes(k)))throw Error("原表查询参数无效");
    if(p.sheetId!==undefined&&(!Number.isInteger(p.sheetId)||Number(p.sheetId)<0||Number(p.sheetId)>2147483647))throw Error("原表页签无效");
    return {...p};
  }
  if(p.action==="payoutConfig"){
    if(Object.keys(p).some(k=>!["action","operation","system","country","platform"].includes(k)))throw Error("配置查询参数无效");
    if(typeof p.operation!=="string"||!["index","snapshot"].includes(p.operation))throw Error("配置查询操作无效");
    if(typeof p.system!=="string"||!["AR","NEW_AR","PANDA","WG","GAME66_HK","GAME66_RED_CRAB"].includes(p.system))throw Error("配置系统无效");
    for(const key of ["country","platform"])if(p[key]!==undefined&&(typeof p[key]!=="string"||String(p[key]).length>200||/[\u0000-\u001f]/.test(String(p[key]))))throw Error("配置范围无效");
    if(p.operation==="snapshot"&&(!p.country||!p.platform))throw Error("请选择配置平台");
    return {...p};
  }
  if(p.action==="rates"){
    const allowed=new Set(["action","scopeType","country","platform","provider","query","offset","limit"]);
    if(Object.keys(p).some(k=>!allowed.has(k)))throw Error("费率查询参数无效");
    if(p.scopeType!==undefined&&!["all","country","platform"].includes(String(p.scopeType)))throw Error("费率范围无效");
    for(const key of ["country","platform","provider","query"])if(p[key]!==undefined&&(typeof p[key]!=="string"||String(p[key]).length>200))throw Error("费率检索值无效");
    if(p.limit!==undefined&&(typeof p.limit!=="number"||![20,30,50,100,500].includes(p.limit)))throw Error("分页大小无效");
    if(p.offset!==undefined&&(!Number.isSafeInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>100000000))throw Error("页码无效");
    return {...p};
  }
  if(p.action==="workorders"){
    const allowed=new Set(["action","startAt","endAt","country","platform","provider","direction","offset","limit","platforms","providers"]);
    if(Object.keys(p).some(k=>!allowed.has(k)))throw Error("工单查询参数无效");
    for(const key of ["startAt","endAt"])if(typeof p[key]!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/.test(String(p[key]))||!Number.isFinite(Date.parse(String(p[key]))))throw Error("请填写完整日期及秒");
    const span=Date.parse(String(p.endAt))-Date.parse(String(p.startAt));
    if(span<=0||span>32*86400000)throw Error("查询范围最多31个当地日");
    for(const key of ["country","platform","provider"])if(p[key]!==undefined&&(typeof p[key]!=="string"||String(p[key]).length>200||/[\u0000-\u001f]/.test(String(p[key]))))throw Error("工单检索值无效");
    for(const key of ["platforms","providers"])if(p[key]!==undefined&&(!Array.isArray(p[key])||(p[key] as unknown[]).length>200||(p[key] as unknown[]).some(v=>typeof v!=="string"||!v||v.length>200||/[\u0000-\u001f]/.test(v))))throw Error("工单范围无效");
    if(p.direction!==undefined&&!['all','charge','withdraw'].includes(String(p.direction)))throw Error("工单方向无效");
    if(p.limit!==undefined&&(typeof p.limit!=="number"||![20,30,50,100,500].includes(p.limit)))throw Error("分页大小无效");
    if(p.offset!==undefined&&(!Number.isSafeInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>1000000))throw Error("页码无效");
    return {...p};
  }
  if(p.action==="withdrawNote"){
    if(Object.keys(p).some(k=>!["action","date","country","platform","reason","expectedVersion"].includes(k)))throw Error("每日备注参数无效");
    if(typeof p.date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(Date.parse(p.date))||new Date(p.date).toISOString().slice(0,10)!==p.date)throw Error("请选择备注日期");
    for(const k of ["country","platform"])if(typeof p[k]!=="string"||!String(p[k]).trim()||String(p[k]).length>100||/[\u0000-\u001f\u007f]/.test(String(p[k])))throw Error("请选择备注平台");
    if(typeof p.reason!=="string"||p.reason.length>1000||p.reason.includes("\u0000")||typeof p.expectedVersion!=="string"||!/^([0-9a-f]{32})?$/.test(p.expectedVersion))throw Error("每日备注内容无效");
    return {...p};
  }
  if(p.action==="autoWithdraw"||p.action==="withdrawReasons"){
    const reasons=p.action==="withdrawReasons";
    const allowed=new Set(reasons?["action","date","country","platform","kind","category","reasonKey","operatorKey","query","offset","limit"]:["action","startAt","endAt","country","platform","platforms","account","view","sort","ascending","daily","offset","limit"]);
    if(Object.keys(p).some(k=>!allowed.has(k)))throw Error("出款查询参数无效");
    if(typeof p.country!=="string"||!p.country.trim()||p.country==='all')throw Error("请选择一个国家");
    const validDay=(value:unknown)=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
    if(reasons){
      if(!validDay(p.date)||typeof p.platform!=="string"||!p.platform.trim()||p.kind!==undefined&&!["blocking","categories","rejection","operators","orders"].includes(String(p.kind)))throw Error("原因查询范围无效");
      for(const key of ["category","reasonKey","operatorKey"])if(p[key]!==undefined&&(typeof p[key]!=="string"||!/^([a-f0-9]{32})?$/.test(String(p[key]))))throw Error("原因筛选无效");
      if(p.query!==undefined&&(typeof p.query!=="string"||p.query.length>200||/[\u0000-\u001f\u007f]/.test(p.query)))throw Error("订单号无效");
      if((p.kind===undefined||p.kind==='blocking')&&["category","reasonKey","operatorKey","query"].some(k=>p[k]))throw Error("原因筛选无效");
    }else{
      for(const key of ["startAt","endAt"])if(typeof p[key]!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(String(p[key]))||!validDay(String(p[key]).slice(0,10))||!Number.isFinite(Date.parse(String(p[key]))))throw Error("请填写完整日期");
      const days=(Date.parse(String(p.endAt).slice(0,10))-Date.parse(String(p.startAt).slice(0,10)))/86400000+1;
      if(days<1||days>31)throw Error("查询范围最多31个当地日");
      if(p.view!==undefined&&!["auto","operators"].includes(String(p.view)))throw Error("出款页面无效");
      if(p.sort!==undefined&&!["country","platform","account","total","processed","success","rejected","autoCount","manualCount","avgSeconds","successRate","rejectRate","autoRate","manualRate","previousAvgSeconds","durationChange"].includes(String(p.sort)))throw Error("排序无效");
      for(const key of ["ascending","daily"])if(p[key]!==undefined&&typeof p[key]!=="boolean")throw Error("出款查询值无效");
      if(p.platforms!==undefined&&(!Array.isArray(p.platforms)||p.platforms.length>200||p.platforms.some(v=>typeof v!=="string"||!v||v.length>200||/[\u0000-\u001f]/.test(v))))throw Error("平台范围无效");
    }
    for(const key of ["country","platform","account"])if(p[key]!==undefined&&(typeof p[key]!=="string"||String(p[key]).length>200||/[\u0000-\u001f]/.test(String(p[key]))))throw Error("出款检索值无效");
    if(p.limit!==undefined&&(typeof p.limit!=="number"||![20,30,50,100,500].includes(p.limit)))throw Error("分页大小无效");
    if(p.offset!==undefined&&(!Number.isSafeInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>1000000))throw Error("页码无效");
    return {...p};
  }
  if(p.action==="depositIssues"){
    const allowed=new Set(["action","startAt","endAt","country","platform","provider","status","query","offset","limit","view","dateMode","match","followupStatus"]);
    if(Object.keys(p).some(k=>!allowed.has(k)))throw Error("存款未到账查询参数无效");
    for(const key of ["startAt","endAt"])if(typeof p[key]!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/.test(String(p[key]))||!Number.isFinite(Date.parse(String(p[key]))))throw Error("请填写完整日期及秒");
    const span=Date.parse(String(p.endAt))-Date.parse(String(p.startAt));
    if(span<=0||(p.dateMode!=="all"&&span>32*86400000))throw Error("查询范围最多31个当地日");
    for(const key of ["country","platform","provider","status","query","followupStatus"])if(p[key]!==undefined&&(typeof p[key]!=="string"||String(p[key]).length>200||/[\u0000-\u001f]/.test(String(p[key]))))throw Error("存款未到账检索值无效");
    if(p.view!==undefined&&!['results','entries'].includes(String(p.view)))throw Error("存款核对来源无效");
    if(p.dateMode!==undefined&&!['all','range'].includes(String(p.dateMode)))throw Error("日期范围无效");
    if(p.match!==undefined&&!['all','matched','unmatched','unknown'].includes(String(p.match)))throw Error("对账筛选无效");
    if(p.status!==undefined&&!['all','未入款','已入款','待核对'].includes(String(p.status)))throw Error("存款未到账状态无效");
    if(p.limit!==undefined&&(typeof p.limit!=="number"||![20,30,50,100,500].includes(p.limit)))throw Error("分页大小无效");
    if(p.offset!==undefined&&(!Number.isSafeInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>1000000))throw Error("页码无效");
    return {...p};
  }
  if(p.action==="providerConfig"){
    const allowed=new Set(["action","rawProvider","canonicalProvider","country","platform","direction","status","offset","limit"]);
    if(Object.keys(p).some(k=>!allowed.has(k)))throw Error("三方归类查询参数无效");
    for(const key of ["rawProvider","canonicalProvider","country","platform"])if(p[key]!==undefined&&(typeof p[key]!=="string"||String(p[key]).length>200||/[\u0000-\u001f]/.test(String(p[key]))))throw Error("三方归类检索值无效");
    if(p.direction!==undefined&&!['all','charge','withdraw'].includes(String(p.direction)))throw Error("三方归类方向无效");
    if(p.status!==undefined&&!['all','assigned','unassigned','conflict'].includes(String(p.status)))throw Error("三方归类状态无效");
    if(p.limit!==undefined&&(typeof p.limit!=="number"||![20,30,50,100,500].includes(p.limit)))throw Error("分页大小无效");
    if(p.offset!==undefined&&(!Number.isSafeInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>1000000))throw Error("页码无效");
    return {...p};
  }
  if(p.action==="platformAssignments"){
    const allowed=new Set(["action","team","country","system","platform","status","offset","limit"]);
    if(Object.keys(p).some(k=>!allowed.has(k)))throw Error("团队平台查询参数无效");
    for(const key of ["team","country","system","platform"])if(p[key]!==undefined&&(typeof p[key]!=="string"||String(p[key]).length>200||/[\u0000-\u001f]/.test(String(p[key]))))throw Error("团队平台检索值无效");
    if(p.status!==undefined&&!['all','mapped','unmapped','no_data'].includes(String(p.status)))throw Error("团队平台状态无效");
    if(p.limit!==undefined&&(typeof p.limit!=="number"||![20,30,50,100,500].includes(p.limit)))throw Error("分页大小无效");
    if(p.offset!==undefined&&(!Number.isSafeInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>1000000))throw Error("页码无效");
    return {...p};
  }
  if(typeof p.platformId!=="string"||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(p.platformId))throw Error("请选择真实平台");
  for(const key of ["startAt","endAt"])if(typeof p[key]!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(String(p[key]))||!Number.isFinite(Date.parse(String(p[key]))))throw Error("请填写完整日期及秒");
  const span=Date.parse(String(p.endAt))-Date.parse(String(p.startAt));
  if(span<=0||span>32*86400000)throw Error("查询范围最多31个当地日");
  if(p.direction!==undefined&&!["all","charge","withdraw"].includes(String(p.direction)))throw Error("方向无效");
  if(p.status!==undefined&&!["all","success","pending","failed","rejected","unknown"].includes(String(p.status)))throw Error("状态无效");
  for(const key of ["orderNumber","thirdPartyOrderNumber","memberId","systemOrderId","utr","currency"])if(p[key]!==undefined&&(typeof p[key]!=="string"||String(p[key]).length>200))throw Error("精确检索值过长");
  for(const key of ["providers","channelTypes"])if(p[key]!==undefined&&(!Array.isArray(p[key])||(p[key] as unknown[]).length>200||(p[key] as unknown[]).some(v=>typeof v!=="string"||v.length>200)))throw Error("三方或通道参数无效");
  if(p.limit!==undefined&&(typeof p.limit!=="number"||![20,30,50,100,500].includes(p.limit)))throw Error("分页大小无效");
  if(p.offset!==undefined&&(!Number.isSafeInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>100000000))throw Error("页码无效");
  for(const key of ["amountMin","amountMax"])if(p[key]!==undefined&&(typeof p[key]!=="number"||!Number.isFinite(p[key])||Number(p[key])<0))throw Error("金额范围无效");
  if(p.amountMin!==undefined&&p.amountMax!==undefined&&Number(p.amountMin)>Number(p.amountMax))throw Error("金额范围无效");
  for(const key of ["startAt","endAt"]){const value=String(p[key]);if(new Date(value).toISOString().slice(0,19)!==value.slice(0,19))throw Error("日期或时间无效");}
  return {...p};
}
function isAdminLiveEnvelope(event:MessageEvent,source:Window|null|undefined,channel:string):boolean {
 const d=event.data;return !!source&&!!channel&&event.source===source&&event.origin==="null"&&d&&typeof d==="object"&&!Array.isArray(d)&&d.channel===channel&&typeof d.id==="string"&&/^[a-zA-Z0-9_-]{1,100}$/.test(d.id);
}
export function isAdminLiveMessage(event:MessageEvent,source:Window|null|undefined,channel:string):boolean {
 return isAdminLiveEnvelope(event,source,channel)&&event.data.type===LIVE_REQUEST;
}
function adminLiveTimeoutMessage(action:unknown):string {
 return action==='syncHealth'?'同步检查超时，请稍后重试；不能据此判断平台没有数据':action==='withdrawReasons'?'该平台当日原因读取超时，请点击重试':['aggregate','collectedData','reportSummary'].includes(String(action))?'读取超时，不代表没有数据；请重试':'读取超时，请缩短日期或选择单个平台后重试';
}
export async function adminLiveRequest(session:DashboardSession,input:unknown,signal?:AbortSignal):Promise<unknown>{
 signal?.throwIfAborted();
 const request=validateAdminLiveRequest(input),current=await ensureDashboardSession(session);
 signal?.throwIfAborted();
 if(current.user.id!==session.user.id)throw Error("当前登录账号已改变");
 const base=String(process.env.NEXT_PUBLIC_SUPABASE_URL||"").trim().replace(/\/$/,""),url=new URL(base);
 if(url.protocol!=="https:"||url.origin!==base)throw Error("后台地址配置无效");
 const specialRpc:Record<string,string>={reportSummary:"dashboard_admin_live_report_summary",syncHealth:"dashboard_admin_live_sync_health",collectedData:"dashboard_admin_live_collected_data",rates:"dashboard_admin_live_rates",ratesSheet:"dashboard_admin_live_rate_sheet",payoutConfig:"dashboard_admin_live_payout_config",autoWithdraw:"dashboard_admin_live_auto_withdraw",withdrawReasons:"dashboard_admin_live_withdraw_reasons",withdrawNote:"dashboard_admin_live_withdraw_note",depositIssues:"dashboard_admin_live_deposit_issues",workorders:"dashboard_admin_live_workorders",providerConfig:"dashboard_admin_live_provider_config",platformAssignments:"dashboard_admin_live_platform_assignments",providerOptions:"dashboard_admin_live_provider_options",configurationAccess:"dashboard_admin_live_configuration_access",configurationWrite:"dashboard_admin_live_configuration_write"};
 const rpc=request.action==="aggregate"&&request.view==="drilldown"?"dashboard_admin_live_drilldown":specialRpc[String(request.action)]||"dashboard_admin_live_query";
 const response=await fetch(base+"/rest/v1/rpc/"+rpc,{method:"POST",body:JSON.stringify({p_request:specialRpc[String(request.action)]?Object.fromEntries(Object.entries(request).filter(([key])=>key!=="action")):request}),headers:{Authorization:`Bearer ${current.access_token}`,apikey:String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||""),"Content-Type":"application/json"},signal,cache:"no-store",redirect:"error"});
 if(!response.ok){let code="";try{const body=await response.json();code=String(body.message||"")}catch{}
 if(/note_conflict/.test(code))throw Error("该日备注已被修改，请取消后重新打开核对；当前输入已保留");
 if(/note_denied/.test(code))throw Error("当前账号没有自动出款备注编辑权限");
 if(/note_date_unavailable/.test(code))throw Error("所选日期没有该平台的出款记录，请选择有数据的日期");
 if(/configuration_conflict/.test(code))throw Error("归类已被其他人修改，请刷新后再保存");
 if(/configuration_denied|scope_denied/.test(code))throw Error("当前账号没有此范围的归类权限");
 if(/mapping_not_found|invalid_classification/.test(code))throw Error("归类来源或国家配置已改变，请刷新后重试");
 if([401,403].includes(response.status))throw Error("正式数据读取未获授权，或会话已失效");
 if(/unsupported_filter/.test(code))throw Error("此来源未提供该检索字段，请清空该字段后查询");
 if(/timeout|57014/i.test(code)||response.status===504)throw Error(adminLiveTimeoutMessage(request.action));
 throw Error("正式数据查询未完成，请重试；不能据此判断没有数据");}
 return response.json();
}
export function installAdminLiveBridge(options:{source:()=>Window|null|undefined;channel:()=>string;session:DashboardSession|(()=>DashboardSession);target?:Window}):()=>void{
 type Pending={id:string;request:unknown;source:Window;channel:string;deadline:number;timer?:ReturnType<typeof setTimeout>;controller?:AbortController;settled:boolean};
 const target=options.target||window,active=new Map<string,Pending>(),queued=new Map<string,Pending>();let closed=false;
 const current=(item:Pending)=>!closed&&item.source===options.source()&&item.channel===options.channel();
 const post=(item:Pending,payload:Record<string,unknown>)=>{if(current(item))try{item.source.postMessage({type:LIVE_RESPONSE,id:item.id,channel:item.channel,...payload},"*")}catch{/* The frame may close while a request settles. */}};
 const finish=(item:Pending,payload:Record<string,unknown>)=>{if(item.settled)return;item.settled=true;clearTimeout(item.timer);post(item,payload)};
 const stop=(item:Pending,timeout=false)=>{
   if(item.settled)return;
   queued.delete(item.id);
   finish(item,{error:timeout?adminLiveTimeoutMessage((item.request as {action?:unknown})?.action):"查询已取消",code:timeout?"ADMIN_LIVE_TIMEOUT":"ADMIN_LIVE_CANCELLED"});
   item.controller?.abort();
   drain();
 };
 const run=async(item:Pending)=>{
   if(!current(item)||item.settled){clearTimeout(item.timer);return;}
   if(Date.now()>=item.deadline){stop(item,true);return;}
   const controller=new AbortController();item.controller=controller;active.set(item.id,item);
   try{const result=await adminLiveRequest(typeof options.session==="function"?options.session():options.session,item.request,controller.signal);if(Date.now()>=item.deadline)stop(item,true);else finish(item,{result})}
   catch(e){finish(item,{error:e instanceof Error?e.message:"读取失败"})}
   finally{clearTimeout(item.timer);if(active.get(item.id)===item)active.delete(item.id);drain()}
 };
 const drain=()=>{
   while(!closed&&active.size<4&&queued.size){const next=queued.values().next();if(next.done||!next.value)break;const item=next.value as Pending;queued.delete(item.id);if(!current(item)){clearTimeout(item.timer);item.settled=true;continue;}void run(item)}
 };
 const receive=(event:MessageEvent)=>{
   if(closed||!isAdminLiveEnvelope(event,options.source(),options.channel()))return;
   const {id,request,type}=event.data;
   if(type===LIVE_CANCEL){
     if(Object.keys(event.data).some(key=>!["type","id","channel","reason"].includes(key))||event.data.reason!==undefined&&!["cancelled","timeout"].includes(event.data.reason))return;
     const item=active.get(id)||queued.get(id);if(item)stop(item,event.data.reason==="timeout");return;
   }
   if(type!==LIVE_REQUEST||active.has(id)||queued.has(id))return;
   const now=Date.now(),supplied=event.data.deadline;
   const item:Pending={id,request,source:event.source as Window,channel:options.channel(),deadline:now+LIVE_REQUEST_TIMEOUT_MS,settled:false};
   if(supplied!==undefined&&(!Number.isSafeInteger(supplied)||supplied<=0)){finish(item,{error:"查询期限无效"});return;}
   if(supplied!==undefined)item.deadline=Math.min(item.deadline,supplied);
   if(item.deadline<=now){stop(item,true);return;}
   if(active.size>=4&&queued.size>=8){finish(item,{error:"同时查询过多，请等待当前查询完成"});return;}
   // One deadline covers queueing, auth refresh, transport and response parsing.
   item.timer=setTimeout(()=>stop(item,true),item.deadline-now);
   if(active.size>=4){queued.set(id,item);return;}
   void run(item);
 };
 target.addEventListener("message",receive);
 return ()=>{if(closed)return;closed=true;target.removeEventListener("message",receive);for(const item of [...active.values(),...queued.values()]){item.settled=true;clearTimeout(item.timer);item.controller?.abort()}active.clear();queued.clear()};
}
export function makeAdminLiveDocument(html:string,channel:string):string{
 const encode=(value:string)=>JSON.stringify(value).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
 const origin=typeof window!=="undefined"?window.location?.origin:"";
 if(!origin||!/^https?:$/.test(new URL(origin).protocol)||new URL(origin).origin!==origin)throw Error("后台页面来源无效");
 const script=`<script>(function(){
 const channel=${encode(channel)},hostOrigin=${encode(origin)},requests=new Map();let seq=0;
 const error=(message,code)=>{const value=Error(message);value.code=code;if(code==='ADMIN_LIVE_CANCELLED')value.name='AbortError';return value};
 const release=id=>{const q=requests.get(id);if(!q)return null;requests.delete(id);clearTimeout(q.timer);if(q.signal&&q.abort)q.signal.removeEventListener('abort',q.abort);return q};
 const cancel=(id,timeout=false)=>{const q=release(id);if(!q)return;try{parent.postMessage({type:'${LIVE_CANCEL}',channel,id,reason:timeout?'timeout':'cancelled'},hostOrigin)}catch{}q.reject(error(timeout?'正式数据读取超时，请重试':'查询已取消',timeout?'ADMIN_LIVE_TIMEOUT':'ADMIN_LIVE_CANCELLED'))};
 window.HENSEM_PRODUCTION=true;
 window.hensemLiveRequest=function(request,options={}){return new Promise((resolve,reject)=>{
   const signal=options.signal;if(signal&&signal.aborted){reject(error('查询已取消','ADMIN_LIVE_CANCELLED'));return;}
   const id='live_'+(++seq),deadline=Date.now()+${LIVE_REQUEST_TIMEOUT_MS};
   const q={resolve,reject,request,signal,deadline,abort:()=>cancel(id),timer:null};requests.set(id,q);
   q.timer=setTimeout(()=>cancel(id,true),${LIVE_REQUEST_TIMEOUT_MS});if(signal)signal.addEventListener('abort',q.abort,{once:true});
   try{parent.postMessage({type:'${LIVE_REQUEST}',channel,id,request,deadline},hostOrigin)}catch(e){release(id);reject(e)}
 })};
 // Navigation cancels read requests only; an in-flight edit must keep its outcome.
 window.hensemLiveCancelRequests=function(actions){let count=0;for(const [id,q]of [...requests]){if(['configurationWrite','withdrawNote'].includes(q.request&&q.request.action))continue;if(Array.isArray(actions)&&!actions.includes(q.request&&q.request.action))continue;cancel(id);count++;}return count};
 addEventListener('message',event=>{const data=event.data;if(event.source!==parent||event.origin!==hostOrigin||!data||data.type!=='${LIVE_RESPONSE}'||data.channel!==channel||typeof data.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(data.id))return;const pending=requests.get(data.id);if(!pending)return;if(Date.now()>=pending.deadline){cancel(data.id,true);return;}const q=release(data.id);data.error?q.reject(error(data.error,data.code)):q.resolve(data.result)});
})();</script>`;
 return html.replace(/(<!doctype html>)/i,"$1"+script);
}
