// Direct NEWAR snapshots replace an exact platform/day/component scope.
// They are never added on top of the Google-derived copy of that scope.
export type NewarBusinessKind = "third_party_volume" | "auto_withdraw_bundle" | "workorder_daily_bundle";
export type NewarBusinessSnapshot = {kind:NewarBusinessKind;platform:string;country_code:string;country:string;stat_date:string;direction:string;captured_at:string;payload:Record<string,unknown>};
type Row = Record<string,any>;
const PLATFORMS:Record<string,{platform:string;country:string;country_code:string}>={POPZAR:{platform:"POPZAR",country:"巴基斯坦",country_code:"PK"},DHANIWIN:{platform:"DhaniWin",country:"印度",country_code:"IN"},"92BLAZE":{platform:"92BLAZE",country:"巴基斯坦",country_code:"PK"}};
const object=(v:unknown):v is Row=>!!v&&typeof v==="object"&&!Array.isArray(v);
const canonicalCountry=(v:unknown)=>["PK","巴基斯坦","巴基斯坦盘口"].includes(String(v||""))?"PK":["IN","印度","印度盘口","印度线下盘口"].includes(String(v||""))?"IN":"";
const platform=(value:unknown)=>PLATFORMS[String(value||"").trim().toUpperCase()];
const date=(value:unknown)=>/^\d{4}-\d{2}-\d{2}$/.test(String(value))?String(value):"";
const key=(...v:unknown[])=>JSON.stringify(v);
const own=(v:Row,field:string)=>Object.prototype.hasOwnProperty.call(v,field);
function rows(snapshot:NewarBusinessSnapshot,field:string):Row[] {
  const value=snapshot.payload[field];if(!Array.isArray(value)||value.some(v=>!object(v)))throw new Error("NEWAR 业务组件格式不完整");return value as Row[];
}
export function validateNewarBusinessSnapshots(value:unknown,kind:NewarBusinessKind,start:string,end:string):NewarBusinessSnapshot[] {
  if(!object(value)||value.source!=="newar_direct"||!Array.isArray(value.snapshots))throw new Error("NEWAR 直传统计返回不完整");
  const scopes=new Map<string,NewarBusinessSnapshot>();
  for(const item of value.snapshots){
    if(!object(item)||!object(item.payload)||item.kind!==kind)throw new Error("NEWAR 直传统计类型不匹配");
    const p=platform(item.platform),day=date(item.stat_date),direction=String(item.direction);
    if(!p||canonicalCountry(item.country_code)!==p.country_code||canonicalCountry(item.country)!==p.country_code||!day||day<start||day>end||!Number.isFinite(Date.parse(String(item.captured_at))))throw new Error("NEWAR 直传统计范围不匹配");
    if(kind==="third_party_volume"?!["charge","withdraw"].includes(direction):direction!=="all")throw new Error("NEWAR 直传统计业务方向不匹配");
    const snapshot:NewarBusinessSnapshot={kind,...p,stat_date:day,direction,captured_at:String(item.captured_at),payload:item.payload};
    const fields=kind==="third_party_volume"?["rows"]:kind==="auto_withdraw_bundle"?["rows","operator_rows"]:["rows","employee_rows","type_rows"];
    for(const field of fields){
      if(!own(snapshot.payload,field)){if(kind==="third_party_volume")throw new Error("NEWAR 直传统计组件缺失");continue;}
      for(const row of rows(snapshot,field)){
        const rowPlatform=platform(row.platform),rowCountry=canonicalCountry(row.country_code||row.country);
        if(!rowPlatform||rowPlatform.platform!==p.platform||rowCountry!==p.country_code||row.stat_date!==day)throw new Error("NEWAR 直传统计包含跨平台或跨日记录");
        if(kind==="third_party_volume"&&(row.biz_type==="recharge"?"charge":row.biz_type==="withdraw"?"withdraw":"")!==direction)throw new Error("NEWAR 直传统计包含跨方向记录");
      }
    }
    if(!fields.some(field=>own(snapshot.payload,field)))throw new Error("NEWAR 直传统计没有有效组件");
    const identity=key(kind,p.platform,day,direction),previous=scopes.get(identity);
    if(previous)throw new Error("NEWAR 同一业务范围重复，拒绝重复累计");
    scopes.set(identity,snapshot);
  }
  return [...scopes.values()];
}
function matches(row:Row,snapshot:NewarBusinessSnapshot,direction=false):boolean {
  return platform(row.platform)?.platform===snapshot.platform&&canonicalCountry(row.country_code||row.country)===snapshot.country_code&&String(row.data_date||row.stat_date||row.date)===snapshot.stat_date&&(!direction||(row.direction==="代付"?"withdraw":row.direction==="代收"?"charge":row.direction)===snapshot.direction);
}
function canonicalLegacy<T extends Row>(row:T):T {
  const p=platform(row.platform);
  return p&&canonicalCountry(row.country_code||row.country)===p.country_code?{...row,country:p.country,platform:p.platform}:row;
}
function numeric(value:unknown):number {const n=Number(value);if(value==null||value===""||typeof value==="boolean"||!Number.isFinite(n)||n<0)throw new Error("NEWAR 业务统计数值无效");return n;}
function base(snapshot:NewarBusinessSnapshot,index:number):Row{return {id:`newar-direct:${snapshot.kind}:${snapshot.platform}:${snapshot.stat_date}:${snapshot.direction}:${index}`,country:snapshot.country,platform:snapshot.platform,data_date:snapshot.stat_date,stat_date:snapshot.stat_date,source_sheet:"supabase:newar_direct",source_updated_at:snapshot.captured_at,updated_at:snapshot.captured_at};}
function average(row:Row):number {const count=numeric(row.handle_count);return count?numeric(row.total_handle_seconds)/count:0;}
function replace<T extends Row>(legacy:T[],snapshots:NewarBusinessSnapshot[],component:string,mapper:(row:Row,s:NewarBusinessSnapshot,index:number)=>Row,direction=false):T[]{
  const active=snapshots.filter(s=>own(s.payload,component));
  const direct=active.flatMap(s=>rows(s,component).map((row,i)=>mapper(row,s,i)));
  return [...legacy.filter(row=>!active.some(s=>matches(row,s,direction))).map(canonicalLegacy),...direct] as T[];
}
export function mergeNewarVolumeRows<T extends Row>(legacy:T[],snapshots:NewarBusinessSnapshot[]):T[]{
  return replace(legacy,snapshots,"rows",(row,s,i)=>({...base(s,i),sheet_name:"supabase:newar_direct",source_row:i,
    channel:String(row.third_party||"未知"),raw_channel:String(row.third_party||"未知"),channel_type:String(row.mapping_code||row.pay_method||row.channel_type||""),direction:s.direction==="charge"?"代收":"代付",
    amount:numeric(row.success_amount??row.amount),count:numeric(row.success_count??row.count),success_count:numeric(row.success_count),failed_count:numeric(row.failed_count),success_rate:numeric(row.success_rate),status:"NEWAR 直传汇总",raw:{...row}}),true);
}
export function mergeNewarDailyRows<T extends Row>(legacy:T[],snapshots:NewarBusinessSnapshot[]):T[]{
  return replace(legacy,snapshots,"rows",(row,s,i)=>({...base(s,i),total:numeric(row.total_count),success:numeric(row.success_count),rejected:numeric(row.reject_count),auto_count:numeric(row.auto_count),manual_count:row.manual_count==null?null:numeric(row.manual_count),avg_seconds:average(row),avg_time_text:null,raw:{...row}}));
}
export function mergeNewarOperatorRows<T extends Row>(legacy:T[],snapshots:NewarBusinessSnapshot[]):T[]{
  return replace(legacy,snapshots,"operator_rows",(row,s,i)=>({...base(s,i),account:String(row.operator||""),processed:numeric(row.processed_count),rejected:numeric(row.reject_count),avg_seconds:average(row),avg_time_text:null,raw:{...row}}));
}
export function mergeNewarWorkOrderBundles<T extends Row>(legacy:T[],snapshots:NewarBusinessSnapshot[]):T[]{
  const direct=snapshots.map(s=>{
    // Operator/type repair may precede a daily snapshot. Missing components
    // inherit the latest existing bundle; explicit [] is an authoritative zero.
    const prior=legacy.filter(row=>matches(row,s)).sort((a,b)=>String(a.source_updated_at||"").localeCompare(String(b.source_updated_at||""))).pop();
    return {system_name:"新AR",stat_date:s.stat_date,country_code:s.country_code,country:s.country,platform:s.platform,
      daily_rows:own(s.payload,"rows")?rows(s,"rows"):prior?.daily_rows||[],
      type_rows:own(s.payload,"type_rows")?rows(s,"type_rows"):prior?.type_rows||[],
      employee_rows:own(s.payload,"employee_rows")?rows(s,"employee_rows"):prior?.employee_rows||[],source_updated_at:s.captured_at};
  });
  return [...legacy.filter(row=>!snapshots.some(s=>matches(row,s))).map(canonicalLegacy),...direct] as T[];
}
