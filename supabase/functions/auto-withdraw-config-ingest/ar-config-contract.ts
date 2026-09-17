// Separate from withdrawal reasons. Persist only whitelisted configuration controls.
export const FIELD_KINDS: Record<string, string> = {"autoWithdraw":"boolean","withdrawAmount":"number","totalLoss":"number","withdrawTimes":"number","grandWithdrawTotal":"number","todayProfitAmount":"number","manualRechargeAmount":"number","bonusRechargeAmount":"number","accountBalance":"number","firstDepositAmount":"number","sameDeviceAccountCount":"number","dayWithdrawLimit":"number","lastRechargeDayLimit":"number","isOpenAgentRedLimit":"boolean","maxRedRechargeRate":"number","receiveRedSumAmount":"number","lastRechgRecvReadSumAmount":"number","allowvirtualwithdraw":"boolean","betTurnoverMultiple":"number","isOpenRevisitPoorProfit":"boolean","revisitPoorProfitAmount":"number","firstRecharge":"boolean","checkRemark":"boolean","limitGroup":"boolean","isAutoPayment":"boolean","isCurrencyLimit":"boolean","isBankCardToArPay":"boolean","isGameNegativeProfitLimit":"boolean"};
const object = (v: any) => v && typeof v === "object" && !Array.isArray(v);
function fail(): never { throw new Error("invalid_configuration_snapshot"); }
function text(v: any, max: number) {
  if (typeof v !== "string" || v.length > max || /[\u0000-\u0008]/.test(v)
    || /<\/?[a-z][^>]*>/i.test(v)
    || /Bearer\s+\S+|ASP\.NET_SessionId|__RequestVerificationToken|caipiao\.NewAdmin|X-Config-Key/i.test(v)) return fail();
  return v;
}
const NEWAR_FIELD_KINDS: Record<string, string> = {
  autoWithdraw:"boolean", ruleEnabled:"boolean", withdrawAmount:"number",
  todayProfitAmount:"number", manualRechargeAmount:"number", bonusRechargeAmount:"number",
  accountBalance:"number", firstDepositAmount:"number", sameDeviceAccountCount:"number",
  dayWithdrawLimit:"number", lastRechargeDayLimit:"number"
};
function validateNewARConfigSnapshot(s:any, now:number) {
  if (!object(s) || s.source_system!=="NEW_AR" || s.schema_version!==1 || s.parser_version!=="newar-config-v1"
    || !/^[A-Z]{2}$/.test(s.country_code) || typeof s.snapshot_id!=="string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.snapshot_id)) return fail();
  const platform=text(s.platform,80), timezone=text(s.timezone,64);
  if (!platform || !/^\d{4}-\d{2}-\d{2}T/.test(s.observed_at) || !/(Z|[+]00:00)$/.test(s.observed_at)) return fail();
  const t=Date.parse(s.observed_at);
  if (!Number.isFinite(t) || t>now+600000 || t<Date.UTC(2020,0,1)) return fail();
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(t);
  const part=(key:string)=>parts.find(p=>p.type===key)?.value;
  if (s.observed_local_date!==[part("year"),part("month"),part("day")].join("-")) return fail();
  const cfg=s.configuration;
  if (!object(cfg) || !Array.isArray(cfg.fields) || cfg.fields.length!==Object.keys(NEWAR_FIELD_KINDS).length
    || !Array.isArray(cfg.channels) || cfg.channels.length>1000
    || !Array.isArray(cfg.channelRules) || cfg.channelRules.length>500) return fail();
  const seen=new Set();
  const fields=cfg.fields.map((f:any)=>{
    if (!object(f) || !Object.hasOwn(NEWAR_FIELD_KINDS,f.key) || seen.has(f.key)
      || f.kind!==NEWAR_FIELD_KINDS[f.key] || typeof f.available!=="boolean") return fail();
    seen.add(f.key);
    if (!f.available ? f.value!==null : f.kind==="boolean" ? typeof f.value!=="boolean"
      : typeof f.value!=="string" || !/^-?\d{1,30}(\.\d{1,20})?$/.test(f.value)) return fail();
    return {key:f.key,label:text(f.label,160),kind:f.kind,value:f.value,available:f.available,description:text(f.description,2000)};
  });
  const channels=cfg.channels.map((row:any)=>{
    if (!object(row)) return fail();
    return {id:text(String(row.id??""),80),channelName:text(String(row.channelName??""),160),
      channelUrl:text(String(row.channelUrl??""),240),channelType:text(String(row.channelType??""),80)};
  });
  const safeRuleValue=(key:string,value:any)=>{
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || /(token|secret|password|cookie|authorization|auth)/i.test(key)) return fail();
    if (value===null || typeof value==="boolean" || (typeof value==="number" && Number.isFinite(value))) return value;
    return text(String(value),240);
  };
  const channelRules=cfg.channelRules.map((row:any)=>{
    if (!object(row) || Object.keys(row).length>40) return fail();
    return Object.fromEntries(Object.entries(row).map(([key,value])=>[key,safeRuleValue(key,value)]));
  });
  return {schema_version:1,source_system:"NEW_AR",snapshot_id:s.snapshot_id,country_code:s.country_code,platform,timezone,
    observed_at:new Date(t).toISOString(),observed_local_date:s.observed_local_date,parser_version:s.parser_version,
    configuration:{fields,channels,channelRules}};
}

export function validateConfigSnapshot(s: any, now = Date.now()) {
  if (s?.source_system==="NEW_AR") return validateNewARConfigSnapshot(s,now);
  if (!object(s) || s.source_system !== "AR" || s.schema_version !== 1
    || s.parser_version !== "ar-config-v1" || !/^[A-Z]{2}$/.test(s.country_code)
    || typeof s.snapshot_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.snapshot_id)) return fail();
  const platform = text(s.platform, 80), timezone = text(s.timezone, 64);
  if (!platform || !/^\d{4}-\d{2}-\d{2}T/.test(s.observed_at)
    || !/(Z|[+]00:00)$/.test(s.observed_at)) return fail();
  const t = Date.parse(s.observed_at);
  if (!Number.isFinite(t) || t > now + 600000 || t < Date.UTC(2020,0,1)) return fail();
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(t);
  const part = (key:string) => parts.find(p=>p.type===key)?.value;
  if (s.observed_local_date !== [part("year"),part("month"),part("day")].join("-")) return fail();
  const cfg = s.configuration;
  if (!object(cfg) || !Array.isArray(cfg.fields) || cfg.fields.length !== Object.keys(FIELD_KINDS).length
    || !Array.isArray(cfg.groups) || cfg.groups.length !== 2) return fail();
  const seen = new Set();
  const fields = cfg.fields.map((f:any) => {
    if (!object(f) || !Object.hasOwn(FIELD_KINDS,f.key) || seen.has(f.key)
      || f.kind!==FIELD_KINDS[f.key] || typeof f.available!=="boolean" || typeof f.read_only!=="boolean") return fail();
    seen.add(f.key);
    // Older AR screens may omit optional controls. Never turn missing into false.
    // These core controls establish that this really is the configuration form.
    if (!f.available && ["autoWithdraw","withdrawAmount","isAutoPayment"].includes(f.key)) return fail();
    if (!f.available ? f.value !== null : f.kind==="boolean" ? typeof f.value !== "boolean"
      : typeof f.value!=="string" || !/^-?\d{1,30}(\.\d{1,20})?$/.test(f.value)) return fail();
    return {key:f.key,kind:f.kind,value:f.value,label:text(f.label,160),description:text(f.description,2000),available:f.available,read_only:f.read_only};
  }).sort((a:any,b:any)=>a.key.localeCompare(b.key));
  const groupKeys = new Set();
  const groups = cfg.groups.map((g:any) => {
    if (!object(g) || !["userGroups","gameTypes"].includes(g.key) || groupKeys.has(g.key)
      || !Array.isArray(g.options) || g.options.length<1 || g.options.length>100) return fail();
    groupKeys.add(g.key); const keys = new Set();
    const options = g.options.map((o:any)=>{
      if (!object(o) || typeof o.selected!=="boolean" || keys.has(o.value)) return fail();
      keys.add(o.value);
      return {value:text(o.value,80),label:text(o.label,160),selected:o.selected};
    });
    return {key:g.key,options};
  }).sort((a:any,b:any)=>a.key.localeCompare(b.key));
  return {schema_version:1,source_system:"AR",snapshot_id:s.snapshot_id,country_code:s.country_code,platform,timezone,
    observed_at:new Date(t).toISOString(),observed_local_date:s.observed_local_date,parser_version:s.parser_version,configuration:{fields,groups}};
}

