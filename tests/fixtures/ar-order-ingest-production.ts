// Independent raw-order ingestion; no statistics are calculated or changed here.
const MAX_BODY = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = ['order_no','member_id','amount','amount_text','status','applied_at','completed_at','operator','raw_channel','channel_type','remark','manual_remark'];
const MONEY_FIELDS = ['amount_local','amount_usdt','currency_local'];
const SCOPES = new Set<string>(["[\"PK\",\"92PKR\"]", "[\"PK\",\"92R\"]", "[\"PK\",\"92DADU\"]", "[\"PK\",\"92GO\"]", "[\"PK\",\"92COCO\"]", "[\"PK\",\"92GLORY\"]", "[\"PK\",\"92STRIKE\"]", "[\"PK\",\"92STAR\"]", "[\"PK\",\"92.GAME\"]", "[\"PK\",\"YAYWIN\"]", "[\"BR\",\"POPBRA\"]", "[\"BR\",\"POPPG\"]", "[\"BR\",\"POP555\"]", "[\"BR\",\"POP678\"]", "[\"BR\",\"POP888\"]", "[\"BR\",\"POPLUA\"]", "[\"BR\",\"POPBEM\"]", "[\"BR\",\"POPCEU\"]", "[\"VN\",\"92LOTTERY\"]", "[\"VN\",\"VN168\"]", "[\"VN\",\"66CLUB\"]", "[\"VN\",\"82VN\"]", "[\"ID\",\"55FIVE\"]", "[\"MY\",\"MZPLAY\"]", "[\"MM\",\"6LOTTERY\"]", "[\"NG\",\"FB999\"]", "[\"IN\",\"91CLUB\"]", "[\"IN\",\"55CLUB\"]", "[\"IN\",\"IN999\"]", "[\"IN\",\"OKWIN\"]", "[\"IN\",\"JALWA\"]", "[\"IN\",\"BIGMUMBAI\"]", "[\"IN\",\"82LOTTERY\"]", "[\"IN\",\"LOTTERY7\"]", "[\"IN\",\"51GAME\"]", "[\"IN\",\"6CLUB\"]", "[\"IN\",\"TPPLAY\"]", "[\"IN\",\"RAJA\"]", "[\"IN\",\"JAICLUB\"]", "[\"IN\",\"Shree.Win\"]", "[\"IN\",\"Veer.Game\"]"]);
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): v is ObjectValue => !!v && typeof v === 'object' && !Array.isArray(v);
class Invalid extends Error {}
const invalid = (): never => { throw new Invalid('invalid_payload'); };
function exact(v: ObjectValue, keys: string[]) { if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v,k))) invalid(); }
function money(v: unknown, nullable=true): boolean {
  return v === null ? nullable : typeof v === 'string' && /^(?:0|[1-9]\d{0,13})\.\d{2}$/.test(v) && BigInt(v.replace('.','')) <= 9007199254740991n;
}
// Counts describe the validated batch, not rows changed by its idempotent replay.
export function dualMoneyAck(payload: ObjectValue): ObjectValue {
  if (payload.money_format_version !== 1) return {};
  const rows=payload.orders as ObjectValue[];
  const local=rows.filter(r=>r.amount_local!==null).length;
  return {money_format_version:1,money_local_count:local,money_usdt_count:rows.filter(r=>r.amount_usdt!==null).length,money_missing_local_count:rows.length-local};
}
function text(v: unknown, max: number, nullable=true, identifier=false): boolean {
  if (v === null) return nullable;
  return typeof v === 'string' && Array.from(v).length <= max && !v.includes('\0') &&
    (!identifier || (v.length > 0 && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v) && !/^(?:-+|n\/a|none|null|undefined)$/i.test(v)));
}
function localTime(v: unknown): boolean {
  if (v === null) return true;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) return false;
  if(v.slice(0,4)==='0000') return false;
  const n = Date.parse(v.replace(' ','T')+'Z');
  return Number.isFinite(n) && new Date(n).toISOString().slice(0,19) === v.replace(' ','T');
}
export function validateAROrderPayload(v: unknown, now = new Date()): ObjectValue {
  if (!object(v)) invalid();
  if (v.action === 'check') { exact(v,['action']); return v; }
  const dual=Object.hasOwn(v,'money_format_version');
  exact(v,['action','batch_id','source_system','country_code','platform','order_kind','observed_at','orders',...(dual?['money_format_version']:[])]);
  if(dual && (v.money_format_version!==1 || v.country_code!=='IN' || v.order_kind!=='withdraw')) invalid();
  if (v.action!=='ingest' || v.source_system!=='AR' || typeof v.batch_id!=='string' || !UUID.test(v.batch_id) ||
    typeof v.country_code!=='string' || typeof v.platform!=='string' || !SCOPES.has(JSON.stringify([v.country_code,v.platform])) ||
    !['recharge','withdraw'].includes(String(v.order_kind))) invalid();
  if (typeof v.observed_at!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(v.observed_at)) invalid();
  const when=Date.parse(v.observed_at);
  if (!Number.isFinite(when) || when<Date.parse('2020-01-01T00:00:00Z') || when>now.getTime()+300000 || new Date(when).toISOString().slice(0,19)!==v.observed_at.slice(0,19)) invalid();
  if (!Array.isArray(v.orders) || v.orders.length>500) invalid();
  const ids=new Set<string>();
  for(const row of v.orders) {
    if (!object(row)) invalid(); exact(row,dual?[...FIELDS,...MONEY_FIELDS]:FIELDS);
    if (!text(row.order_no,160,false,true) || !text(row.member_id,80,true,true) || !text(row.amount_text,100) || !text(row.status,160) ||
      !localTime(row.applied_at) || !localTime(row.completed_at) || !text(row.operator,240) || !text(row.raw_channel,240) ||
      !text(row.channel_type,240) || !text(row.remark,8000) || !text(row.manual_remark,8000)) invalid();
    if (!money(row.amount)) invalid();
    if(dual) {
      if(row.currency_local!=='INR' || !money(row.amount_local) || !money(row.amount_usdt) || (row.amount_local===null && row.amount_usdt===null)) invalid();
      // No exchange-rate calculation; a missing local amount remains unknown.
      if(typeof row.channel_type==='string' && row.channel_type.trim().toUpperCase()==='USDT' && row.amount_usdt===null) invalid();
      if(typeof row.channel_type==='string' && ['BANK CARD','ARPAY','UPI'].includes(row.channel_type.trim().toUpperCase()) && row.amount_local===null) invalid();
    }
    if (ids.has(row.order_no as string)) invalid(); ids.add(row.order_no as string);
  }
  if(new TextEncoder().encode(JSON.stringify(v)).byteLength>MAX_BODY) invalid();
  return v;
}
const response=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
async function body(req:Request):Promise<unknown> {
  const reader=req.body?.getReader(); if(!reader) throw new Invalid();
  let size=0; const chunks:Uint8Array[]=[];
  try { while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>MAX_BODY) {await reader.cancel(); throw new RangeError();} chunks.push(value); } }
  finally {reader.releaseLock();}
  const data=new Uint8Array(size); let offset=0; for(const part of chunks){data.set(part,offset);offset+=part.byteLength;}
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));} catch {throw new Invalid();}
}
export function createAROrderHandler(env:Record<string,string|undefined>,transport:typeof fetch=fetch,now:()=>Date=()=>new Date()) {
  return async(req:Request):Promise<Response>=>{
    if(req.method!=='POST') return response(405,{ok:false,error:'method_not_allowed'});
    const token=req.headers.get('X-AR-Key')||'';
    if(!/^[A-Za-z0-9_-]{32,256}$/.test(token)) return response(401,{ok:false,error:'invalid_key'});
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type')||'')) return response(415,{ok:false,error:'unsupported_media_type'});
    const base=(env.SUPABASE_URL||'').replace(/\/$/,''); const service=env.SUPABASE_SERVICE_ROLE_KEY;
    if(!base||!service) return response(503,{ok:false,error:'not_configured'});
    try {
      const payload=validateAROrderPayload(await body(req),now());
      const tokenHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join('');
      const res=await transport(`${base}/rest/v1/rpc/publish_ar_collected_orders`,{method:'POST',headers:{apikey:service,Authorization:`Bearer ${service}`,'content-type':'application/json'},body:JSON.stringify({p_token_hash:tokenHash,p_payload:payload}),signal:AbortSignal.timeout(25000),redirect:'error',cache:'no-store'});
      const ack:unknown=await res.json().catch(()=>null);
      if(!res.ok) {
        const message=object(ack)?ack.message:undefined;
        if(message==='ARO_AUTH_INVALID') return response(401,{ok:false,error:'invalid_key'});
        if(message==='ARO_SCOPE_DENIED') return response(403,{ok:false,error:'scope_denied'});
        if(message==='ARO_BATCH_CONFLICT') return response(409,{ok:false,error:'batch_conflict'});
        if(typeof message==='string'&&message.startsWith('ARO_INVALID')) return response(422,{ok:false,error:'invalid_payload'});
        return response(503,{ok:false,error:'storage_unavailable'});
      }
      const valid=object(ack)&&ack.ok===true&&(payload.action==='check' ? ack.source_system==='AR'&&ack.details_version===1&&typeof ack.scope_count==='number'&&Number.isInteger(ack.scope_count)&&Number(ack.scope_count)>0&&Number(ack.scope_count)<=41 :
        ack.batch_id===payload.batch_id&&ack.order_count===(payload.orders as unknown[]).length&&['accepted','unchanged'].includes(String(ack.status)));
      const expectedMoney=dualMoneyAck(payload);
      if(!valid || !object(ack) || Object.entries(expectedMoney).some(([key,value])=>ack[key]!==value)) return response(503,{ok:false,error:'invalid_ack'});
      // Return only the contract fields, even if the database responds with unrelated data.
      return response(200,payload.action==='check' ? {ok:true,source_system:'AR',details_version:1,scope_count:(ack as ObjectValue).scope_count} : {ok:true,batch_id:payload.batch_id,order_count:(payload.orders as unknown[]).length,status:(ack as ObjectValue).status,...expectedMoney});
    } catch(error) {
      if(error instanceof RangeError) return response(413,{ok:false,error:'payload_too_large'});
      if(error instanceof Invalid) return response(422,{ok:false,error:'invalid_payload'});
      return response(503,{ok:false,error:'temporarily_unavailable'});
    }
  };
}
if(import.meta.main && typeof Deno!=='undefined') Deno.serve(createAROrderHandler({SUPABASE_URL:Deno.env.get('SUPABASE_URL'),SUPABASE_SERVICE_ROLE_KEY:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}));

