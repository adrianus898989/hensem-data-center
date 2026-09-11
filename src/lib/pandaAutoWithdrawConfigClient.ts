"use client";
import type { DashboardSession } from "./dashboardAuthClient";
import {readConfig,type ConfigTarget,type ConfigSummary} from "./arAutoWithdrawConfigClient";
export type PandaValue=string|number|boolean|null|PandaValue[]|{[key:string]:PandaValue};
export type PandaConfiguration={values:Record<string,PandaValue>;unavailable_fields:string[]};
export type PandaDictionary={schema_version:1;source_system:"PANDA";snapshot_id:string;country_code:string;platform:string;timezone:string;observed_at:string;observed_local_date:string;tenant_id:number;region_id:number;channels:{id:number;name:string;withdraw_type_id:number}[];levels:{id:number;name:string}[]};
export type PandaConfigSnapshot=ConfigSummary&{received_at:string;configuration:PandaConfiguration;dictionary?:PandaDictionary|null};
export async function fetchPandaConfigIndex(session:DashboardSession,signal:AbortSignal){
  const [targets,summaries]=await Promise.all([
    readConfig<ConfigTarget>("panda_config_targets",{select:"country_code,country_name,platform,timezone,currency",order:"country_code,platform",limit:"1000"},session,signal),
    readConfig<ConfigSummary>("panda_config_latest",{select:"country_code,platform,timezone,observed_at,observed_local_date",limit:"1000"},session,signal),
  ]);return {targets,summaries};
}
export async function fetchPandaConfigSnapshot(target:ConfigTarget,session:DashboardSession,signal:AbortSignal){
  const filter={select:"*",country_code:"eq."+target.country_code,platform:"eq."+target.platform,limit:"1"};
  // A missing/unavailable name dictionary must never hide a valid daily configuration.
  const [rows,dictionaries]=await Promise.all([
    readConfig<PandaConfigSnapshot>("panda_config_latest",filter,session,signal),
    readConfig<{dictionary:PandaDictionary}>("panda_config_dictionary_latest",filter,session,signal).catch(()=>[]),
  ]);
  const row=rows[0]||null;
  if(row&&(!row.configuration?.values||Array.isArray(row.configuration.values)||!Array.isArray(row.configuration?.unavailable_fields)))throw new Error("配置格式不完整，请重新采集。");
  const d=dictionaries[0]?.dictionary;
  const scoped=d?.schema_version===1&&d.source_system==="PANDA"&&d.country_code===target.country_code&&d.platform===target.platform&&d.timezone===target.timezone&&Array.isArray(d.channels)&&Array.isArray(d.levels);
  return row?{...row,dictionary:scoped?d:null}:null;
}
