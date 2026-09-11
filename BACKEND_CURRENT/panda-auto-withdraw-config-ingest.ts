import { validatePandaConfigSnapshot, validatePandaDictionary } from "./panda-config-contract.ts";

// Source PANDA credentials never reach this function. The key here only permits
// config ingestion/reporting for pre-authorized targets in our own database.
const base=Deno.env.get("SUPABASE_URL")!;
const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const headers={apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,"Content-Type":"application/json"};
function reply(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
async function sha(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,"0")).join("");}
async function db(path:string,init:RequestInit={}){
  const response=await fetch(base+"/rest/v1/"+path,{...init,headers,signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error("database_request_failed");return response.json();
}
async function boundedJson(req:Request){
  const reader=req.body?.getReader();if(!reader)throw new Error("invalid_request");
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
    if(size>262144){await reader.cancel();throw new Error("request_too_large");}chunks.push(value);}
  const bytes=new Uint8Array(size);let position=0;for(const part of chunks){bytes.set(part,position);position+=part.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Error("invalid_request");}
}
Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return reply({ok:false,error:"method_not_allowed"},405);
  const key=req.headers.get("X-Config-Key")||"";
  if(!/^[a-f0-9]{64}$/.test(key))return reply({ok:false,error:"unauthorized"},401);
  try{
    const credentials=await db("panda_config_credentials?"+new URLSearchParams({select:"allowed_targets,expires_at",token_hash:"eq."+await sha(key),active:"eq.true",limit:"1"}));
    const credential=credentials[0];
    if(!credential||Date.parse(credential.expires_at)<=Date.now())return reply({ok:false,error:"unauthorized"},401);
    const body=await boundedJson(req);
    if(!body||typeof body!=="object"||Array.isArray(body))return reply({ok:false,error:"invalid_request"},400);
    if(body.action==="report"){
      if(body.platforms!==undefined&&(!Array.isArray(body.platforms)||body.platforms.length>100||body.platforms.some((p:any)=>typeof p!=="string")))return reply({ok:false,error:"invalid_report"},400);
      const rows=await db("panda_config_latest?select=country_code,platform,observed_at,observed_local_date,received_at,configuration_hash,snapshot_id&limit=1000");
      return reply({ok:true,snapshots:rows.filter((r:any)=>credential.allowed_targets.includes(r.country_code+":"+r.platform)
        &&(!body.country_code||body.country_code===r.country_code)&&(!body.platforms?.length||body.platforms.includes(r.platform)))});
    }
    if(body.action==="dictionary-ingest"){
      let dictionary;
      try{dictionary=validatePandaDictionary(body.dictionary);}catch{return reply({ok:false,error:"invalid_configuration_snapshot"},400);}
      if(!credential.allowed_targets.includes(dictionary.country_code+":"+dictionary.platform))return reply({ok:false,error:"target_not_allowed"},403);
      const target=await db("panda_config_targets?"+new URLSearchParams({select:"timezone,source_tenant_id,source_region_id",country_code:"eq."+dictionary.country_code,platform:"eq."+dictionary.platform,limit:"1"}));
      if(target[0]?.timezone!==dictionary.timezone)return reply({ok:false,error:"target_timezone_mismatch"},400);
      if(target[0]?.source_tenant_id!==dictionary.tenant_id||target[0]?.source_region_id!==dictionary.region_id)return reply({ok:false,error:"target_tenant_mismatch"},400);
      const hash=await sha(JSON.stringify(dictionary));
      const result=await db("rpc/ingest_panda_config_dictionary",{method:"POST",body:JSON.stringify({p_dictionary:dictionary,p_hash:hash})});
      return reply({ok:true,...result});
    }
    if(body.action!=="ingest")return reply({ok:false,error:"invalid_action"},400);
    let snapshot;
    try{snapshot=validatePandaConfigSnapshot(body.snapshot);}catch{return reply({ok:false,error:"invalid_configuration_snapshot"},400);}
    if(!credential.allowed_targets.includes(snapshot.country_code+":"+snapshot.platform))return reply({ok:false,error:"target_not_allowed"},403);
    const target=await db("panda_config_targets?"+new URLSearchParams({select:"timezone",country_code:"eq."+snapshot.country_code,platform:"eq."+snapshot.platform,limit:"1"}));
    if(target[0]?.timezone!==snapshot.timezone)return reply({ok:false,error:"target_timezone_mismatch"},400);
    const hash=await sha(JSON.stringify(snapshot.configuration));
    const result=await db("rpc/ingest_panda_config",{method:"POST",body:JSON.stringify({p_snapshot:snapshot,p_hash:hash})});
    return reply({ok:true,...result});
  }catch(error){
    const known=error instanceof Error&&["request_too_large","invalid_request"].includes(error.message);
    return reply({ok:false,error:known?(error as Error).message:"config_sync_failed"},known?400:503);
  }
});
