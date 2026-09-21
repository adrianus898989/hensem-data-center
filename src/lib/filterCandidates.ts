import {canonicalThirdPartyPlatform} from './thirdPartyPlatform';
import {platformDisplayCountry} from './platformDisplayCountry';

export type FilterCandidate = {country:string;platform:string;channel:string;provider:string;channel_type:string;direction:'代收'|'代付';source:'history'|'dictionary'};
const text=(v:unknown,max:number,empty=false):v is string=>typeof v==='string'&&v.length<=max&&(empty||!!v.trim())&&!/[\u0000-\u001f\u007f]/.test(v);
/** Explicit projection: never forward arbitrary database JSON into the UI. */
export function parseFilterCandidates(value:unknown):FilterCandidate[] {
  if(!Array.isArray(value)||value.length>20000)throw new Error('筛选候选目录返回不完整，请重试。');
  const rows=new Map<string,FilterCandidate>();
  for(const row of value){
    if(!row||!text(row.country,120)||!text(row.platform,120)||!text(row.channel,200,true)||!text(row.provider,200,true)
      ||!text(row.channel_type,120,true)||!['代收','代付'].includes(row.direction)||!['history','dictionary'].includes(row.source))
      throw new Error('筛选候选目录返回不完整，请重试。');
    const platform=canonicalThirdPartyPlatform(row.country,row.platform),country=platformDisplayCountry(row.country,platform);
    const item:FilterCandidate={country,platform,channel:row.channel.trim(),provider:row.provider.trim(),channel_type:row.channel_type.trim(),direction:row.direction,source:row.source};
    rows.set(JSON.stringify(item),item);
  }
  return [...rows.values()];
}

export function orderProviderCandidates(rows:FilterCandidate[],country:string,platform:string,direction:string):string[] {
  const name=canonicalThirdPartyPlatform(country,platform);
  return [...new Set(rows.filter(r=>r.country===platformDisplayCountry(country,name)&&r.platform===name
    &&(direction==='all'||r.direction===(direction==='charge'?'代收':'代付'))).map(r=>r.provider).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}));
}
