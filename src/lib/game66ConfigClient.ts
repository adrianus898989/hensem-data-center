"use client";

import {dashboardAuthenticatedFetch,type DashboardSession} from "./dashboardAuthClient";

export type Game66ConfigTarget={
  platform_id:string;platform_code:string;platform_name:string;team_code:"hong_kong"|"red_crab";team_name:string;
  timezone:string;updated_at:string|null;rule_count:number;
};
export type Game66ReviewRule={
  platform_id:string;rule_id:string;template_id:string|null;title:string|null;operator:string|null;value:string|null;
  rule_type:string|null;description:string|null;enabled:boolean|null;remark:string|null;effective_type:string|null;
  effective_channel:string|null;effective_type_text:string|null;raw_payload:Record<string,unknown>;payload_hash:string|null;last_seen_at:string;
};
export type Game66ConfigPayload={ok:boolean;targets:Game66ConfigTarget[];rules:Game66ReviewRule[]};

const text=(value:unknown):value is string=>typeof value==="string"&&value.trim().length>0;
export async function fetchGame66Config(session:DashboardSession,signal:AbortSignal):Promise<Game66ConfigPayload>{
  const url=String(process.env.NEXT_PUBLIC_SUPABASE_URL||"").trim().replace(/\/$/,"");
  const key=String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||"").trim();
  if(!url||!key||!session.access_token)throw new Error("66GAME 配置读取尚未就绪，请重新登录后重试。");
  const response=await dashboardAuthenticatedFetch(`${url}/rest/v1/rpc/dashboard_game66_review_rules`,{
    method:"POST",headers:{apikey:key,Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},body:"{}",cache:"no-store",signal,
  },session);
  const payload:unknown=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(response.status===401||response.status===403?"登录已失效或没有自动出款配置查看权限。":"66GAME 配置读取失败，请重试。");
  const parsed=payload as Game66ConfigPayload|null;
  if(!parsed?.ok||!Array.isArray(parsed.targets)||!Array.isArray(parsed.rules)
    ||parsed.targets.some(target=>!text(target.platform_id)||!text(target.platform_name)||!text(target.team_name)||!text(target.timezone)||!Number.isSafeInteger(Number(target.rule_count)))
    ||parsed.rules.some(rule=>!text(rule.platform_id)||!text(rule.rule_id)||!rule.raw_payload||typeof rule.raw_payload!=="object"||Array.isArray(rule.raw_payload)))
    throw new Error("66GAME 配置响应不完整；未展示可能损坏的数据。");
  return {...parsed,targets:parsed.targets.map(target=>({...target,rule_count:Number(target.rule_count)}))};
}
