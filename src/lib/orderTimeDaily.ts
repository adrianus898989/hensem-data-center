import type { TimeQueryResult } from "./orderTimeVolume";
import type { ThirdPartyVolumeRow } from "./types";
import { collectionSuccessCountry } from "./collectionSuccess";
import { canonicalThirdPartyPlatform, thirdPartyPlatformNotOpen } from "./thirdPartyPlatform";
import { canonicalThirdPartyName } from "./thirdPartyNameMap";

/** Legacy success totals can fill a daily platform, never a filtered order cohort. */
export function supportsDailyVolume(result:TimeQueryResult):boolean {
  const s=result.selection;
  return s.basis==="created"&&!s.createdStart&&!s.createdEnd&&!s.memberId&&!s.orderNumber&&!s.crossDayOnly
    &&(!s.status||s.status==="all")&&/^00:00(?::00)?$/.test(s.start.slice(11))&&s.end.slice(11)==="23:59:59";
}

export function dailyFallbackPlatforms(result:TimeQueryResult):string[] {
  if(!supportsDailyVolume(result))return [];
  const s=result.selection,country=collectionSuccessCountry(s.country);
  const detailed=new Set(result.payloads.map(({payload:p})=>canonicalThirdPartyPlatform(
    collectionSuccessCountry(p.country||p.team||"",p.platform),p.platform||"")));
  return [...new Set((s.platforms.length?s.platforms:s.availablePlatforms||[])
    .map(p=>canonicalThirdPartyPlatform(country,p)))].filter(p=>!detailed.has(p)&&!thirdPartyPlatformNotOpen(country,p,s.end));
}

export function dailyVolumeRows(result:TimeQueryResult,filterChannels=true):ThirdPartyVolumeRow[] {
  const targets=new Set(dailyFallbackPlatforms(result)),s=result.selection;
  if(!targets.size)return [];
  return (result.dailyRows||[]).map(row=>{
    const country=collectionSuccessCountry(row.country,row.platform);
    return {...row,country,platform:canonicalThirdPartyPlatform(country,row.platform),
      channel:canonicalThirdPartyName(row.channel||row.rawChannel,country),channelType:row.channelType||"其他类型",
      status:"日汇总 · 明细未接入"};
  }).filter(row=>row.country===collectionSuccessCountry(s.country)&&targets.has(row.platform)
    &&row.date>=s.start.slice(0,10)&&row.date<=s.end.slice(0,10)
    &&(!s.direction||row.direction===s.direction)
    &&(!filterChannels||((!s.channel||row.channel===s.channel)&&(!s.types.length||s.types.includes(row.channelType)))));
}
