import { platformDisplayCountry } from "./platformDisplayCountry";

export const DASHBOARD_DATA_GROUPS = [
  {key:"BR_PANGHU",label:"胖虎巴西"}, {key:"BR",label:"巴西"},
  {key:"IN",label:"印度"}, {key:"PK",label:"巴基斯坦"}, {key:"ID",label:"印尼"},
  {key:"VN",label:"越南"}, {key:"PH",label:"菲律宾"}, {key:"MY",label:"马来"},
  {key:"MM",label:"缅甸"}, {key:"NG",label:"尼日利亚"},
  {key:"CO",label:"NPG 哥伦比亚"}, {key:"MX",label:"NPG 墨西哥"}, {key:"CL",label:"NPG 智利"},
  {key:"SA",label:"其他南美"}, {key:"BR_NATIVE",label:"巴西原生"}, {key:"USDT",label:"USDT 通道"},
  {key:"HK_TEAM",label:"香港团队"}, {key:"RED_CRAB",label:"红膏蟹团队"},
] as const;
export type DashboardDataGroup = typeof DASHBOARD_DATA_GROUPS[number]["key"];
export type DashboardPlatformScope = {country:DashboardDataGroup;platform:string};
export type DashboardDataScope = {mode:"all"|"selected";countries:DashboardDataGroup[];platforms?:DashboardPlatformScope[]};
export type DataScopedProfile = {role?:string;active?:boolean;auth_user_id?:string;updated_at?:string;data_scope?:unknown};
const keys = new Set<string>(DASHBOARD_DATA_GROUPS.map(group=>group.key));
export const ALL_DASHBOARD_DATA: DashboardDataScope = {mode:"all",countries:[]};

const own=(value:object,key:string)=>Object.prototype.hasOwnProperty.call(value,key);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const platformText=(value:unknown):string|null=>{
  if(typeof value!=="string")return null;
  const name=value.trim().toUpperCase();
  return !name||Array.from(name).length>200||/[\u0000-\u001f\u007f-\u009f]/.test(name)?null:name;
};
// Unicode codepoint ordering also matches a PostgreSQL COLLATE "C" comparison.
function compareText(a:string,b:string):number {
  const left=Array.from(a),right=Array.from(b);
  for(let i=0;i<Math.min(left.length,right.length);i++){
    const difference=left[i].codePointAt(0)!-right[i].codePointAt(0)!;
    if(difference)return difference;
  }
  return left.length-right.length;
}
function parsedScope(value:unknown):DashboardDataScope|null {
  if(!record(value)||Object.keys(value).some(key=>!["mode","countries","platforms"].includes(key))
    ||!Array.isArray(value.countries)||!value.countries.every(country=>typeof country==="string"&&keys.has(country)))return null;
  const countries=Array.from(new Set(value.countries as DashboardDataGroup[])).sort();
  if(value.mode==="all")return countries.length===0&&!own(value,"platforms")?{mode:"all",countries:[]}:null;
  if(value.mode!=="selected")return null;
  if(!own(value,"platforms"))return countries.length?{mode:"selected",countries}:null;
  if(!Array.isArray(value.platforms)||value.platforms.length>500)return null;
  const unique=new Map<string,DashboardPlatformScope>();
  for(const entry of value.platforms){
    if(!record(entry)||Object.keys(entry).sort().join(",")!=="country,platform"||typeof entry.country!=="string"||!keys.has(entry.country))return null;
    const platform=platformText(entry.platform),country=entry.country as DashboardDataGroup;
    if(platform===null||countries.length&&!countries.includes(country))return null;
    unique.set(JSON.stringify([country,platform]),{country,platform});
  }
  return {mode:"selected",countries,platforms:[...unique.values()].sort((a,b)=>compareText(a.country,b.country)||compareText(a.platform,b.platform))};
}
export function isDashboardDataScopeValid(value:unknown):value is DashboardDataScope {
  return parsedScope(value)!==null;
}
// Missing legacy fields mean all. Explicit malformed data always fails closed.
export function normalizeDashboardDataScope(value: unknown): DashboardDataScope {
  if(value == null) return {mode:"all",countries:[]};
  return parsedScope(value)||{mode:"selected",countries:[]};
}
export function effectiveDashboardDataScope(profile:DataScopedProfile|null|undefined):DashboardDataScope {
  if(!profile || profile.active===false) return {mode:"selected",countries:[]};
  return profile.role==="owner" ? {mode:"all",countries:[]} : normalizeDashboardDataScope(profile.data_scope);
}
export function isDashboardDataScopeSubset(child:DashboardDataScope,parent:DashboardDataScope):boolean {
  const subset=normalizeDashboardDataScope(child),allowed=normalizeDashboardDataScope(parent);
  if(allowed.mode==="all")return true;
  if(subset.mode==="all")return false;
  if(subset.platforms!==undefined)return subset.platforms.every(pair=>scopeAllows(allowed,pair.country,pair.platform));
  if(!subset.countries.length)return true;
  return allowed.platforms===undefined&&subset.countries.every(country=>allowed.countries.includes(country));
}

const COUNTRY_ALIASES:Record<string,DashboardDataGroup>={
  "巴西":"BR","BRAZIL":"BR","胖虎巴西":"BR_PANGHU","PANGHU BRAZIL":"BR_PANGHU",
  "印度":"IN","印度线下":"IN","INDIA":"IN","巴基斯坦":"PK","PAKISTAN":"PK",
  "印尼":"ID","印度尼西亚":"ID","INDONESIA":"ID","越南":"VN","VIETNAM":"VN",
  "菲律宾":"PH","PHILIPPINES":"PH","马来":"MY","马来西亚":"MY","MALAYSIA":"MY",
  "缅甸":"MM","MYANMAR":"MM","尼日利亚":"NG","NIGERIA":"NG",
  "哥伦比亚":"CO","COLOMBIA":"CO","墨西哥":"MX","MEXICO":"MX","智利":"CL","CHILE":"CL",
  "南美":"SA","SOUTH AMERICA":"SA","巴西原生":"BR_NATIVE","USDT通道":"USDT","USDT 通道":"USDT",
  "香港":"HK_TEAM","HONG KONG":"HK_TEAM","HONG_KONG":"HK_TEAM",
  "红膏蟹":"RED_CRAB","紅膏蟹":"RED_CRAB","RED CRAB":"RED_CRAB",
};
export function dashboardDataGroup(country:unknown,platform:unknown=""):DashboardDataGroup|"" {
  const name=String(country??"").trim().replace(/盘口$/,"").trim().toUpperCase();
  const platformName=String(platform??"").trim().toUpperCase();
  let group=keys.has(name)?name as DashboardDataGroup:COUNTRY_ALIASES[name];
  if(group==="SA" && /^NPG-(CHILE|COLOMBIA|MEXICO)$/.test(platformName)) group=({"NPG-CHILE":"CL","NPG-COLOMBIA":"CO","NPG-MEXICO":"MX"} as const)[platformName as "NPG-CHILE"];
  if(group==="BR" || group==="BR_PANGHU") {
    const display=platformDisplayCountry(group==="BR"?"巴西":"胖虎巴西",platformName);
    return display==="胖虎巴西"?"BR_PANGHU":"BR";
  }
  return group || "";
}
export function dashboardScopeAllows(scope:DashboardDataScope,country:unknown,platform:unknown=""):boolean {
  return scopeAllows(normalizeDashboardDataScope(scope),country,platform);
}
function scopeAllows(scope:DashboardDataScope,country:unknown,platform:unknown):boolean {
  if(scope.mode==="all")return true;
  const group=dashboardDataGroup(country,platform);
  if(!group)return false;
  if(scope.platforms!==undefined){
    const name=platformText(platform);
    return name!==null&&(!scope.countries.length||scope.countries.includes(group))&&scope.platforms.some(pair=>pair.country===group&&pair.platform===name);
  }
  return scope.countries.includes(group);
}
// Routing/navigation only: a visible country does not authorize its aggregate
// or any row. Business records must still pass dashboardScopeAllows with a
// concrete platform, and global endpoints keep their all-data gate.
export function dashboardScopeMayReadCountry(value:DashboardDataScope,country:unknown):boolean {
  const scope=normalizeDashboardDataScope(value);
  if(scope.mode==="all")return true;
  const group=dashboardDataGroup(country);
  if(!group)return false;
  return scope.platforms===undefined?scope.countries.includes(group):scope.platforms.some(pair=>pair.country===group&&(!scope.countries.length||scope.countries.includes(group)));
}
export function dashboardScopeLabel(value:unknown):string {
  const scope=normalizeDashboardDataScope(value);
  if(scope.mode==="all")return "全部数据";
  const label=(key:DashboardDataGroup)=>DASHBOARD_DATA_GROUPS.find(group=>group.key===key)!.label;
  if(scope.platforms!==undefined)return scope.platforms.length?"指定平台："+scope.platforms.map(pair=>label(pair.country)+" · "+pair.platform).join("、"):"无可见数据";
  return scope.countries.map(label).join("、")||"无可见数据";
}
export function dashboardScopeIdentity(profile:DataScopedProfile|null|undefined):string {
  const scope=effectiveDashboardDataScope(profile);
  return `${profile?.auth_user_id||"anonymous"}:${scope.mode}:${scope.countries.join(",")}:${profile?.updated_at||""}${scope.platforms===undefined?"":":platforms="+JSON.stringify(scope.platforms)}`;
}
