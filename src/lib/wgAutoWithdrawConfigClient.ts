"use client";
import type {DashboardSession} from "./dashboardAuthClient";
import {readConfig} from "./arAutoWithdrawConfigClient";
import {validateWGConfigSnapshot,type WGConfigSnapshot} from "./wgConfigContract";

export type WGConfigTarget = {
  country_code:string; country_name:string; platform:string; timezone:string; site_code:string;
  members:Array<{site_code:string;name:string}>;
};
export type WGConfigSummary = {
  country_code:string; platform:string; timezone:string; observed_at:string; observed_local_date:string;
};
export type WGStoredConfigSnapshot = Omit<WGConfigSnapshot,"schema_version"|"source_system"> & {received_at:string};
const invalid = () => new Error("WG 配置响应不完整，请重新同步后重试。");
const text = (value:unknown):value is string => typeof value==="string" && value.trim().length>0;
function validSummary(value:WGConfigSummary) {
  return value && text(value.country_code) && text(value.platform) && text(value.timezone)
    && /^\d{4}-\d{2}-\d{2}$/.test(value.observed_local_date)
    && text(value.observed_at) && Number.isFinite(Date.parse(value.observed_at));
}
function validTarget(value:WGConfigTarget) {
  return value && text(value.country_code) && text(value.country_name) && text(value.platform) && text(value.timezone)
    && typeof value.site_code==="string" && /^[1-9]\d{0,14}$/.test(value.site_code) && Array.isArray(value.members) && value.members.length>0
    && value.members.every(member=>typeof member.site_code==="string"&&/^[1-9]\d{0,14}$/.test(member.site_code)&&text(member.name))
    && new Set(value.members.map(member=>member.site_code)).size===value.members.length;
}
export async function fetchWGConfigIndex(session:DashboardSession, signal:AbortSignal) {
  const [targets,summaries]=await Promise.all([
    readConfig<WGConfigTarget>("wg_config_targets",{select:"country_code,country_name,platform,timezone,site_code,members",order:"country_code,platform",limit:"1000"},session,signal),
    readConfig<WGConfigSummary>("wg_config_latest",{select:"country_code,platform,timezone,observed_at,observed_local_date",limit:"1000"},session,signal),
  ]);
  if(!targets.every(validTarget)||!summaries.every(validSummary)
    ||new Set(targets.map(target=>target.country_code+":"+target.platform)).size!==targets.length)throw invalid();
  return {targets,summaries};
}
export async function fetchWGConfigSnapshot(target:WGConfigTarget,session:DashboardSession,signal:AbortSignal):Promise<WGStoredConfigSnapshot|null> {
  const rows=await readConfig<WGStoredConfigSnapshot>("wg_config_latest",{
    select:"country_code,platform,site_code,timezone,observed_at,observed_local_date,snapshot_id,parser_version,received_at,configuration",
    country_code:"eq."+target.country_code,platform:"eq."+target.platform,limit:"1",
  },session,signal);
  const row=rows[0];if(!row)return null;
  if(!validSummary(row)||row.country_code!==target.country_code||row.platform!==target.platform||row.timezone!==target.timezone||row.site_code!==target.site_code)throw invalid();
  try{
    const checked=validateWGConfigSnapshot({schema_version:1,source_system:"WG",parser_version:row.parser_version,
      country_code:row.country_code,platform:row.platform,site_code:row.site_code,timezone:row.timezone,
      observed_at:row.observed_at.replace(/\+00:00$/,"Z"),observed_local_date:row.observed_local_date,
      snapshot_id:row.snapshot_id,configuration:row.configuration});
    const expected=["0",...target.members.map(member=>member.site_code)].sort();
    const supplied=Object.keys(checked.configuration.settings).sort();
    if(expected.length!==supplied.length||expected.some((key,index)=>key!==supplied[index]))throw invalid();
    return {...row,configuration:checked.configuration};
  }catch{throw invalid();}
}
