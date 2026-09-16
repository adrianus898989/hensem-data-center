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
export type DashboardDataScope = {mode:"all"|"selected";countries:DashboardDataGroup[]};
export type DataScopedProfile = {role?:string;active?:boolean;auth_user_id?:string;updated_at?:string;data_scope?:unknown};
const keys = new Set<string>(DASHBOARD_DATA_GROUPS.map(group=>group.key));
export const ALL_DASHBOARD_DATA: DashboardDataScope = {mode:"all",countries:[]};

// Missing legacy fields mean all. Explicit malformed data always fails closed.
export function normalizeDashboardDataScope(value: unknown): DashboardDataScope {
  if(value == null) return {mode:"all",countries:[]};
  if(typeof value!=="object" || Array.isArray(value)) return {mode:"selected",countries:[]};
  const raw=value as Record<string,unknown>;
  if(raw.mode==="all" && Array.isArray(raw.countries) && raw.countries.length===0) return {mode:"all",countries:[]};
  if(raw.mode!=="selected" || !Array.isArray(raw.countries) || !raw.countries.every(c=>typeof c==="string"&&keys.has(c))) return {mode:"selected",countries:[]};
  return {mode:"selected",countries:Array.from(new Set(raw.countries as DashboardDataGroup[])).sort()};
}
export function effectiveDashboardDataScope(profile:DataScopedProfile|null|undefined):DashboardDataScope {
  if(!profile || profile.active===false) return {mode:"selected",countries:[]};
  return profile.role==="owner" ? {mode:"all",countries:[]} : normalizeDashboardDataScope(profile.data_scope);
}
export function isDashboardDataScopeSubset(child:DashboardDataScope,parent:DashboardDataScope):boolean {
  return parent.mode==="all" || (child.mode==="selected" && child.countries.every(key=>parent.countries.includes(key)));
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
  if(scope.mode==="all")return true;
  const group=dashboardDataGroup(country,platform);
  return !!group&&scope.countries.includes(group);
}
export function dashboardScopeLabel(value:unknown):string {
  const scope=normalizeDashboardDataScope(value);
  return scope.mode==="all"?"全部数据":scope.countries.map(key=>DASHBOARD_DATA_GROUPS.find(g=>g.key===key)!.label).join("、")||"无可见数据";
}
export function dashboardScopeIdentity(profile:DataScopedProfile|null|undefined):string {
  const scope=effectiveDashboardDataScope(profile);
  return `${profile?.auth_user_id||"anonymous"}:${scope.mode}:${scope.countries.join(",")}:${profile?.updated_at||""}`;
}
