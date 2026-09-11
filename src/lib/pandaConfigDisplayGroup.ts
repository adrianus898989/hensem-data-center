import type {ConfigTarget} from "./arAutoWithdrawConfigClient";

// Union of the established explicit mappings in parseAutoWithdraw.ts and
// BACKEND_CURRENT/sync-auto-withdraw-raw.ts. Display grouping only: never
// change country_code, platform, ingestion identity, or detail query filters.
const PANGHU_BRAZIL = new Set([
  "VIP345","KKVIP","KK345","FF555","TPTP","AA45","F75","25RR",
  "8599BET","9596BET","8566BET","5V555","58EE","27FF","222O",
  "32QQ","67VIP","222VIP","345F","234T","888HH","BET5697",
  "96F","45FF","76PP","56L","559K","2V222","5C555",
  "POPCRA","POPNOV","POPFEZ"
]);

export function configDisplayGroup(target:ConfigTarget,system:"AR"|"PANDA") {
  const key=target.platform.trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
  if(system==="PANDA"&&target.country_code==="BR"&&PANGHU_BRAZIL.has(key)) {
    return {key:"BR_PANGHU",name:"胖虎巴西"};
  }
  return {key:target.country_code,name:target.country_name};
}
