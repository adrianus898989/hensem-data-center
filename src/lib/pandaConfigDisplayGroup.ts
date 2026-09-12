import type {ConfigTarget} from "./arAutoWithdrawConfigClient";
import {platformDisplayCountry} from "./platformDisplayCountry";

// The shared, verified platform registry controls display grouping only: never
// change country_code, platform, ingestion identity, or detail query filters.
export function configDisplayGroup(target:ConfigTarget,system:"AR"|"PANDA") {
  if(system==="PANDA"&&target.country_code==="BR"&&platformDisplayCountry(target.country_code,target.platform)==="胖虎巴西") {
    return {key:"BR_PANGHU",name:"胖虎巴西"};
  }
  return {key:target.country_code,name:target.country_name};
}
