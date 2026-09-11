// Only the observed read-only withdrawal.getAuto configuration is accepted.
export const PANDA_FIELDS: Record<string,string> = {
  withdrawSwitch:"boolean",rechargeMultiple:"number",rewardMultiple:"number",autoWithdrawalSwitch:"boolean",
  autoWithdrawalAmountMix:"amount",autoWithdrawalAmountMax:"amount",autoWithdrawalChannel:"channels",
  auditAutoRelieve:"number",auditGameLimit:"games",autoRefuseSwitch:"string",autoWithdrawalLimitSwitch:"string",
  autoWithdrawalLimitType:"string",autoWithdrawalLimitAmount:"number",autoWithdrawalLimitLevel:"levels",
  autoWithdrawLimitRegTime:"string",autoWithdrawLimitOther:"strings",autoWithdrawDailyLimit:"number",
  autoWithdrawManualRechargeLimit:"number",autoWithdrawManualGiftLimit:"number",autoWithdrawalPollingSwitch:"string",
  successRateType:"string",orderVolume:"number",minSuccessRate:"number",auditAutoRelieveType:"string",
  auditLevelMode:"string",levelMultiples:"json",
};
const object=(v:any):v is Record<string,any>=>Boolean(v)&&typeof v==="object"&&!Array.isArray(v);
function fail():never{throw new Error("invalid_configuration_snapshot");}
function text(v:any,max=160):string {
  if(typeof v!=="string"||v.length>max||/[\u0000-\u001f\u007f]/.test(v)
    ||/<\/?[a-z][^>]*>|Bearer\s+\S+|ASP\.NET_SessionId|__RequestVerificationToken|caipiao\.NewAdmin|X-Config-Key/i.test(v))return fail();
  return v;
}
function number(v:any,integer=false){
  if(typeof v!=="number"||!Number.isFinite(v)||Math.abs(v)>1e15||(integer&&(!Number.isSafeInteger(v)||v<0)))return fail();
  return v;
}
function array(v:any,max=500):any[]{if(!Array.isArray(v)||v.length>max)return fail();return v;}
const id=(v:any)=>typeof v==="string"?text(v):number(v,true);
function keys(v:any,allowed:string[]){
  if(!object(v)||Object.keys(v).some(k=>!allowed.includes(k)))return fail();
}
function safeJson(v:any,depth=0):any {
  if(depth>6)return fail();
  if(v===null||typeof v==="boolean")return v;
  if(typeof v==="number")return number(v);
  if(typeof v==="string")return text(v);
  if(Array.isArray(v))return array(v).map(x=>safeJson(x,depth+1));
  if(!object(v)||Object.keys(v).length>64)return fail();
  const result:Record<string,any>={};
  for(const [k,x]of Object.entries(v)){
    if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(k)||/token|cookie|password|auth|session|fingerprint|email|account|secret|header|credential/i.test(k))return fail();
    result[k]=safeJson(x,depth+1);
  }
  return result;
}
function games(v:any){
  if(v==="")return v;
  // withdrawal.getAuto also returns "{}"; preserve the decoded empty object.
  if(object(v)&&Object.keys(v).length===0)return {};
  keys(v,["status","limitData"]);
  return {status:text(v.status),limitData:array(v.limitData).map(x=>{
    keys(x,["gameType","platformData"]);
    return {gameType:text(x.gameType),platformData:array(x.platformData).map(p=>{
      keys(p,["platformId","gameData"]);
      return {platformId:number(p.platformId,true),gameData:array(p.gameData).map(g=>{keys(g,["gameId"]);return {gameId:number(g.gameId,true)};})};
    })};
  })};
}
export function validatePandaConfiguration(cfg:any){
  keys(cfg,["values","unavailable_fields"]);
  if(!object(cfg.values))return fail();
  const missing=array(cfg.unavailable_fields,26);
  if(new Set(missing).size!==missing.length||missing.some(k=>typeof k!=="string"||!Object.hasOwn(PANDA_FIELDS,k)))return fail();
  if(Object.keys(cfg.values).some(k=>!Object.hasOwn(PANDA_FIELDS,k)||missing.includes(k)))return fail();
  const values:Record<string,any>={};
  for(const [key,kind]of Object.entries(PANDA_FIELDS)){
    const present=Object.hasOwn(cfg.values,key);
    const core=["withdrawSwitch","autoWithdrawalSwitch"].includes(key);
    if(!present){if(core||!missing.includes(key))return fail();continue;}
    const v=cfg.values[key];
    if(v===null){if(core)return fail();values[key]=null;continue;}
    if(kind==="boolean"){if(typeof v!=="boolean")return fail();values[key]=v;}
    else if(kind==="number"||kind==="amount")values[key]=number(v,kind==="amount");
    else if(kind==="string")values[key]=text(v);
    else if(kind==="levels")values[key]=array(v).map(id);
    else if(kind==="strings")values[key]=array(v,100).map(x=>text(x));
    else if(kind==="channels")values[key]=array(v,200).map(c=>{
      keys(c,["pullOffType","withdrawalChannelId","tenantWithdrawTypeId","tenantWithdrawTypeName","tenantWithdrawTypeCode"]);
      return {pullOffType:text(c.pullOffType),withdrawalChannelId:number(c.withdrawalChannelId,true),tenantWithdrawTypeId:number(c.tenantWithdrawTypeId,true),tenantWithdrawTypeName:text(c.tenantWithdrawTypeName),tenantWithdrawTypeCode:text(c.tenantWithdrawTypeCode)};
    });
    else if(kind==="games")values[key]=games(v);
    else values[key]=v===""?"":safeJson(v);
  }
  return {values,unavailable_fields:[...missing].sort()};
}
export function validatePandaConfigSnapshot(s:any,now=Date.now()){
  keys(s,["schema_version","snapshot_id","source_system","country_code","platform","timezone","observed_at","observed_local_date","configuration","parser_version"]);
  if(s.source_system!=="PANDA"||s.schema_version!==1||s.parser_version!=="panda-config-v1"
    ||typeof s.country_code!=="string"||!/^[A-Z]{2}$/.test(s.country_code)
    ||typeof s.snapshot_id!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.snapshot_id))return fail();
  const platform=text(s.platform,80),timezone=text(s.timezone,64);
  if(!platform||typeof s.observed_at!=="string"||!/^\d{4}-\d{2}-\d{2}T/.test(s.observed_at)||!/(Z|[+]00:00)$/.test(s.observed_at))return fail();
  const time=Date.parse(s.observed_at);if(!Number.isFinite(time)||time>now+600000||time<Date.UTC(2020,0,1))return fail();
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(time);
  if(s.observed_local_date!==["year","month","day"].map(k=>parts.find(p=>p.type===k)?.value).join("-"))return fail();
  const configuration=validatePandaConfiguration(s.configuration);
  const result={schema_version:1,source_system:"PANDA",snapshot_id:s.snapshot_id,country_code:s.country_code,platform,timezone,observed_at:new Date(time).toISOString(),observed_local_date:s.observed_local_date,parser_version:s.parser_version,configuration};
  if(new TextEncoder().encode(JSON.stringify({action:"ingest",snapshot:result})).length>262144)return fail();
  return result;
}

// Independent, per-tenant name dictionaries; never alter a day's configuration.
export function validatePandaDictionary(s:any,now=Date.now()){
  keys(s,["schema_version","snapshot_id","source_system","country_code","platform","timezone","observed_at","observed_local_date","tenant_id","region_id","channels","levels"]);
  if(s.schema_version!==1||s.source_system!=="PANDA"||!["BR","PH"].includes(s.country_code)
    ||typeof s.snapshot_id!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.snapshot_id))return fail();
  const platform=text(s.platform,80),timezone=text(s.timezone,64);
  if(!platform||typeof s.observed_at!=="string"||!/^\d{4}-\d{2}-\d{2}T/.test(s.observed_at)||!/(Z|[+]00:00)$/.test(s.observed_at))return fail();
  const time=Date.parse(s.observed_at);
  if(!Number.isFinite(time)||time>now+600000||time<Date.UTC(2020,0,1))return fail();
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(time);
  if(s.observed_local_date!==["year","month","day"].map(k=>parts.find(p=>p.type===k)?.value).join("-"))return fail();
  const tenant_id=number(s.tenant_id,true),region_id=number(s.region_id,true);
  if(tenant_id<1||region_id!==(s.country_code==="BR"?1:2))return fail();
  const name=(value:any)=>{const result=text(value);if(!result.trim())return fail();return result;};
  const safeId=(value:any)=>{const result=number(value,true);if(!Number.isSafeInteger(result))return fail();return result;};
  const channels=array(s.channels,1000).map(c=>{keys(c,["id","name","withdraw_type_id"]);return {id:safeId(c.id),name:name(c.name),withdraw_type_id:safeId(c.withdraw_type_id)};});
  const levels=array(s.levels,2000).map(l=>{keys(l,["id","name"]);return {id:safeId(l.id),name:name(l.name)};});
  if(new Set(channels.map(c=>c.id)).size!==channels.length||new Set(levels.map(l=>l.id)).size!==levels.length)return fail();
  const result={schema_version:1,snapshot_id:s.snapshot_id,source_system:"PANDA",country_code:s.country_code,platform,timezone,observed_at:new Date(time).toISOString(),observed_local_date:s.observed_local_date,tenant_id,region_id,channels,levels};
  if(new TextEncoder().encode(JSON.stringify({action:"dictionary-ingest",dictionary:result})).length>262144)return fail();
  return result;
}
