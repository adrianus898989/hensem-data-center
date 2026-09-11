"use client";
import type { DashboardSession } from "./dashboardAuthClient";
import {readConfig,type ConfigTarget,type ConfigSummary} from "./arAutoWithdrawConfigClient";
export type PandaValue=string|number|boolean|null|PandaValue[]|{[key:string]:PandaValue};
export type PandaConfiguration={values:Record<string,PandaValue>;unavailable_fields:string[]};
export type PandaConfigSnapshot=ConfigSummary&{received_at:string;configuration:PandaConfiguration};
export async function fetchPandaConfigIndex(session:DashboardSession,signal:AbortSignal){
  const [targets,summaries]=await Promise.all([
    readConfig<ConfigTarget>("panda_config_targets",{select:"country_code,country_name,platform,timezone,currency",order:"country_code,platform",limit:"1000"},session,signal),
    readConfig<ConfigSummary>("panda_config_latest",{select:"country_code,platform,timezone,observed_at,observed_local_date",limit:"1000"},session,signal),
  ]);return {targets,summaries};
}
export async function fetchPandaConfigSnapshot(target:ConfigTarget,session:DashboardSession,signal:AbortSignal){
  const rows=await readConfig<PandaConfigSnapshot>("panda_config_latest",{select:"*",country_code:"eq."+target.country_code,platform:"eq."+target.platform,limit:"1"},session,signal);
  const row=rows[0]||null;
  if(row&&(!row.configuration?.values||Array.isArray(row.configuration.values)||!Array.isArray(row.configuration?.unavailable_fields)))throw new Error("配置格式不完整，请重新采集。");
  return row;
}
