import type {OrderTimePayload} from "./orderTimeQuery";
import {timePlatformCountry,timePlatformName} from "./orderTimeVolume";
import {canonicalThirdPartyPlatform} from "./thirdPartyPlatform";

type TimePlatform=OrderTimePayload["platforms"][number];

/**
 * The catalog must come from the authenticated, permission-scoped RPC. An empty
 * selection means all catalog platforms in this display group, never every
 * platform in the database. RPC authorization still applies to each stable ID.
 */
export function selectOrderTimePlatforms(catalog:TimePlatform[],country:string,names:string[],availableNames?:string[]):TimePlatform[] {
  const byId=new Map<string,TimePlatform>(),conflictingIds=new Set<string>();
  for(const platform of catalog){
    const id=platform.id.trim().toLowerCase(),previous=byId.get(id);
    if(previous&&(timePlatformName(previous)!==timePlatformName(platform)||timePlatformCountry(previous)!==timePlatformCountry(platform)
      ||(previous.timezone||"Asia/Kolkata")!==(platform.timezone||"Asia/Kolkata")
      ||(previous.source||"game66")!==(platform.source||"game66")))conflictingIds.add(id);
    if(!previous)byId.set(id,{...platform,id});
  }
  const available=availableNames?new Set(availableNames.map(name=>canonicalThirdPartyPlatform(country,name))):null;
  const inGroup=[...byId.values()].filter(platform=>timePlatformCountry(platform)===country&&(!available||available.has(timePlatformName(platform))));
  const requested=new Set(names.map(name=>canonicalThirdPartyPlatform(country,name)));
  const selected=inGroup.filter(platform=>!requested.size||requested.has(timePlatformName(platform)));
  if([...requested].some(name=>!selected.some(platform=>timePlatformName(platform)===name)))
    throw new Error("所选平台中有未接入订单明细或当前无权限的平台，不能把日汇总混进时间段结果。");
  if(!selected.length)throw new Error("当前分组没有可查询的订单明细平台，请确认平台接入和权限。");
  if(selected.some(platform=>conflictingIds.has(platform.id)))
    throw new Error("平台标识配置冲突，请联系管理员确认后再查询。");
  if(new Set(selected.map(timePlatformName)).size!==selected.length)
    throw new Error("平台配置存在重名，请联系管理员确认后再查询。");
  return selected;
}
