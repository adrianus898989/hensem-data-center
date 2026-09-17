import { validateConfigSnapshot } from "./ar-config-contract.ts";

// This custom, scoped credential is never exposed to the dashboard browser.
const base = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const headers = {apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,"Content-Type":"application/json"};
function reply(body:unknown,status=200) {
  return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
}
async function sha(value:string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,"0")).join("");
}
async function db(path:string,init:RequestInit={}) {
  const r=await fetch(base+"/rest/v1/"+path,{...init,headers,signal:AbortSignal.timeout(15000)});
  if(!r.ok) throw new Error("database_request_failed");
  return r.json();
}
async function boundedJson(req:Request) {
  const reader=req.body?.getReader(); if(!reader) throw new Error("invalid_request");
  const chunks:Uint8Array[]=[]; let size=0;
  while(true) {const {done,value}=await reader.read(); if(done)break; size+=value.length;
    if(size>262144){await reader.cancel();throw new Error("request_too_large");} chunks.push(value);}
  const all=new Uint8Array(size);let pos=0;for(const c of chunks){all.set(c,pos);pos+=c.length;}
  return JSON.parse(new TextDecoder().decode(all));
}
Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return reply({ok:false,error:"method_not_allowed"},405);
  const key=req.headers.get("X-Config-Key")||"";
  if(!/^[a-f0-9]{64}$/.test(key))return reply({ok:false,error:"unauthorized"},401);
  try {
    const credentials=await db("ar_config_credentials?"+new URLSearchParams({select:"allowed_targets,expires_at",token_hash:"eq."+await sha(key),active:"eq.true",limit:"1"}));
    const credential=credentials[0];
    if(!credential || Date.parse(credential.expires_at)<=Date.now())return reply({ok:false,error:"unauthorized"},401);
    const body=await boundedJson(req);
    if(body.action==="report") {
      if(body.platforms!==undefined && (!Array.isArray(body.platforms) || body.platforms.length>100 || body.platforms.some((p:any)=>typeof p!=="string"))) return reply({ok:false,error:"invalid_report"},400);
      const rows=await db("ar_config_latest?select=country_code,platform,observed_at,observed_local_date,received_at,configuration_hash,snapshot_id&limit=1000");
      return reply({ok:true,snapshots:rows.filter((r:any)=>credential.allowed_targets.includes(r.country_code+":"+r.platform)
        && (!body.country_code || body.country_code===r.country_code) && (!body.platforms?.length || body.platforms.includes(r.platform)))});
    }
    if(body.action!=="ingest")return reply({ok:false,error:"invalid_action"},400);
    let s;
    try{s=validateConfigSnapshot(body.snapshot);}catch{return reply({ok:false,error:"invalid_configuration_snapshot"},400);}
    if(!credential.allowed_targets.includes(s.country_code+":"+s.platform))return reply({ok:false,error:"target_not_allowed"},403);
    const target=await db("ar_config_targets?"+new URLSearchParams({select:"timezone,source_system",country_code:"eq."+s.country_code,platform:"eq."+s.platform,limit:"1"}));
    if(target[0]?.timezone!==s.timezone || target[0]?.source_system!==s.source_system)return reply({ok:false,error:"target_timezone_mismatch"},400);
    const hash=await sha(JSON.stringify(s.configuration));
    const result=await db("rpc/ingest_ar_config",{method:"POST",body:JSON.stringify({p_snapshot:s,p_hash:hash})});
    return reply({ok:true,...result});
  }catch(e){
    // Do not log request bodies or keys, nor reflect database internals to callers.
    const known=e instanceof Error && ["request_too_large","invalid_request"].includes(e.message);
    return reply({ok:false,error:known?(e as Error).message:"config_sync_failed"},known?400:503);
  }
});

