import type {OrderTimePayload} from "./orderTimeQuery";
import {timePlatformCountry} from "./orderTimeVolume";

type TimePlatform=OrderTimePayload["platforms"][number];

/**
 * The catalog must come from the authenticated, permission-scoped RPC. An empty
 * selection means all catalog platforms in this display group, never every
 * platform in the database. RPC authorization still applies to each stable ID.
 */
export function selectOrderTimePlatforms(catalog:TimePlatform[],country:string,names:string[]):TimePlatform[] {
  const byId=new Map<string,TimePlatform>(),conflictingIds=new Set<string>();
  for(const platform of catalog){
    const id=platform.id.trim().toLowerCase(),previous=byId.get(id);
    if(previous&&(previous.name!==platform.name||timePlatformCountry(previous)!==timePlatformCountry(platform)))conflictingIds.add(id);
    if(!previous)byId.set(id,{...platform,id});
  }
  const inGroup=[...byId.values()].filter(platform=>timePlatformCountry(platform)===country);
  const requested=new Set(names);
  const selected=inGroup.filter(platform=>!requested.size||requested.has(platform.name));
  if([...requested].some(name=>!selected.some(platform=>platform.name===name)))
    throw new Error("所选平台中有未接入订单明细或当前无权限的平台，不能把日汇总混进时间段结果。");
  if(!selected.length)throw new Error("当前分组没有可查询的订单明细平台，请确认平台接入和权限。");
  if(selected.some(platform=>conflictingIds.has(platform.id)))
    throw new Error("平台标识配置冲突，请联系管理员确认后再查询。");
  if(new Set(selected.map(platform=>platform.name)).size!==selected.length)
    throw new Error("平台配置存在重名，请联系管理员确认后再查询。");
  return selected;
}
