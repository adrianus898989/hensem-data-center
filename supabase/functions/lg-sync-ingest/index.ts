// LOCAL CANDIDATE. Legacy R6 routes preserved; separate fail-closed window RPC.
import {validate as validateLegacy, handler as legacyHandler} from './legacy.ts';
const plain=(v:unknown):v is Record<string,any>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const count=(v:unknown)=>Number.isSafeInteger(v)&&(v as number)>=0&&(v as number)<=999999999;
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const day=(v:unknown)=>typeof v==='string'&&/^20\d\d-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(`${v}T00:00:00Z`))&&new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)===v;
const utc=(v:unknown,whole=true)=>typeof v==='string'&&/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(v)&&Number.isFinite(Date.parse(v))&&(!whole||!/[.]0*[1-9]/.test(v));
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const countries:Record<string,string>={SUPERLG:'PH',LGPARTY:'PH',LGSABONG:'PH',LGBIGWIN:'PH',LG111:'ID',LG789:'PK'};
const actions=['window_check','window_state','window_start','window_renew','window_release','window_begin','window_chunk','window_finish'];
export function validate(body:unknown):Record<string,any>{
 if(!plain(body))throw Error('LG_INVALID_PAYLOAD');
 if(!String(body.action).startsWith('window_'))return validateLegacy(body);
 if(body.source_system!=='LG')throw Error('LG_INVALID_PAYLOAD');
 if(!actions.includes(body.action))throw Error('LG_INVALID_ACTION');
 if(body.action==='window_check')return body;
 if(['stat_date','capture_date','callback_date','sync_mode','base_snapshot_id'].some(k=>Object.hasOwn(body,k)))throw Error('LG_INVALID_WINDOW');
 if(!Object.hasOwn(countries,body.platform)||countries[body.platform]!==body.country_code||!['recharge','withdraw'].includes(body.order_kind)||!['created','callback'].includes(body.stream))throw Error('LG_INVALID_SCOPE');
 if(body.action==='window_state')return body;
 if(body.action==='window_start'){
  if(!uuid(body.owner_id)||!utc(body.origin_at))throw Error('LG_INVALID_ORIGIN');
  return body;
 }
 if(!uuid(body.lease_token))throw Error('LG_INVALID_LEASE');
 if(body.action==='window_renew'||body.action==='window_release')return body;
 if(!uuid(body.snapshot_id))throw Error('LG_INVALID_SNAPSHOT');
 if(body.action==='window_begin'||body.action==='window_finish')if(!utc(body.expected_cursor))throw Error('LG_INVALID_DATE');
 if(body.action==='window_begin'){
  const purpose=body.purpose??'advance';
  if(!['advance','recheck'].includes(purpose)||![body.start_at,body.end_at].every(v=>utc(v))||!utc(body.observed_at,false))throw Error('LG_INVALID_WINDOW');
  const start=Date.parse(body.start_at),end=Date.parse(body.end_at),cursor=Date.parse(body.expected_cursor);
  if(end<=start||end-start>86400000||end>Date.parse(body.observed_at))throw Error('LG_INVALID_WINDOW');
  if(purpose==='advance'&&(start>cursor||start<cursor-1200000||end<=cursor))throw Error('LG_WINDOW_GAP');
  if(purpose==='recheck'&&(body.stream!=='created'||end>cursor))throw Error('LG_INVALID_RECHECK');
  if(![body.expected_count,body.expected_chunks,body.source_total,body.fetched_count].every(count)||body.expected_chunks>100000)throw Error('LG_INVALID_COUNTS');
  if(body.expected_count!==body.source_total||body.expected_count!==body.fetched_count||(body.expected_count===0?body.expected_chunks!==0:body.expected_chunks<1||body.expected_chunks>body.expected_count))throw Error('LG_INCOMPLETE_SOURCE');
 }
 if(body.action==='window_chunk'){
  if(!count(body.chunk_index)||body.chunk_index>=100000)throw Error('LG_INVALID_CHUNK');
  // Reuse R6 strict normalized-row/PII/type whitelist, without its day protocol.
  validateLegacy({...body,action:'callback_chunk',callback_date:'2000-01-01',observed_at:'2000-01-02T00:00:00Z'});
  for(const row of body.orders)if(Object.values(row.raw).some(v=>typeof v==='number'&&!Number.isFinite(v)))throw Error('LG_INVALID_ORDER');
 }
 return body;
}
export function validWindowAck(p:Record<string,any>,a:any):boolean{
 if(!plain(a)||a.ok!==true||a.source_system!=='LG')return false;
 if(p.action==='window_check')return a.window_protocol_version===1&&count(a.scope_count)&&a.scope_count>0&&a.lease_seconds===120&&a.max_window_seconds===86400&&a.overlap_seconds===1200&&a.cursor_semantics==='exclusive_end'&&a.recheck_supported===true&&a.report_refresh==='transactional';
 if(['platform','country_code','order_kind','stream'].some(k=>a[k]!==p[k]))return false;
 const cursor=()=>utc(a.cursor)&&utc(a.origin_at)&&Date.parse(a.cursor)>=Date.parse(a.origin_at);
 if(p.action==='window_state')return typeof a.initialized==='boolean'&&!Object.hasOwn(a,'lease_token')&&(a.initialized?cursor()&&(a.lease_expires_at===null||utc(a.lease_expires_at,false)):a.cursor===null&&a.origin_at===null);
 if(p.action==='window_start')return a.status==='ready'&&uuid(a.lease_token)&&cursor()&&utc(a.lease_expires_at,false)&&a.cursor_semantics==='exclusive_end';
 if(a.lease_token!==p.lease_token)return false;
 if(p.action==='window_release')return a.status==='released'&&cursor()&&a.lease_expires_at===null;
 if(!utc(a.lease_expires_at,false))return false;
 if(p.action==='window_renew')return a.status==='renewed'&&cursor();
 if(a.snapshot_id!==p.snapshot_id)return false;
 if(p.action==='window_begin')return ['collecting','committed'].includes(a.status)&&a.expected_count===p.expected_count&&a.expected_chunks===p.expected_chunks&&a.purpose===(p.purpose??'advance')&&Date.parse(a.start_at)===Date.parse(p.start_at)&&Date.parse(a.end_at)===Date.parse(p.end_at)&&Date.parse(a.observed_at)===Date.parse(p.observed_at)&&utc(a.cursor);
 if(p.action==='window_chunk')return ['accepted','unchanged'].includes(a.status)&&a.chunk_index===p.chunk_index&&a.order_count===p.orders.length;
 if(p.action==='window_finish')return a.status==='committed'&&['advance','recheck'].includes(a.purpose)&&a.creation_day_complete===false&&a.coverage==='window'&&a.report_refresh==='refreshed'&&Array.isArray(a.refreshed_dates)&&a.refreshed_dates.every(day)&&count(a.order_count)&&a.expected_count===a.order_count&&a.fetched_count===a.order_count&&a.source_total===a.order_count&&count(a.changed_count)&&count(a.stale_count)&&a.changed_count+a.stale_count<=a.order_count&&utc(a.start_at)&&utc(a.end_at)&&utc(a.observed_at,false)&&utc(a.cursor_before)&&utc(a.cursor_after)&&Date.parse(a.cursor_before)===Date.parse(p.expected_cursor)&&Date.parse(a.cursor)===Date.parse(a.cursor_after)&&(a.purpose==='advance'?Date.parse(a.cursor_after)===Date.parse(a.end_at)&&Date.parse(a.start_at)<=Date.parse(a.cursor_before)&&Date.parse(a.cursor_after)>Date.parse(a.cursor_before):p.stream==='created'&&Date.parse(a.cursor_after)===Date.parse(a.cursor_before)&&Date.parse(a.end_at)<=Date.parse(a.cursor_before));
 return false;
}
export function handler(env:Record<string,string|undefined>,transport:typeof fetch=fetch){
 const legacy=legacyHandler(env,transport);
 return async(req:Request)=>{
  if(req.method!=='POST')return reply(405,{ok:false,error:'method_not_allowed'});
  const token=req.headers.get('x-lg-sync-token')??'';
  if(!/^[A-Za-z0-9_-]{32,256}$/.test(token))return reply(401,{ok:false,error:'LG_AUTH_INVALID'});
  try{
   if(Number(req.headers.get('content-length'))>8*1024*1024)return reply(413,{ok:false,error:'payload_too_large'});
   const reader=req.body?.getReader();if(!reader)return reply(400,{ok:false,error:'missing_body'});
   const parts:Uint8Array[]=[];let size=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024){await reader.cancel();return reply(413,{ok:false,error:'payload_too_large'});}parts.push(value);}}finally{reader.releaseLock();}
   const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}
   let payload:Record<string,any>;
   try{payload=validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}catch(e){const m=e instanceof Error?e.message:'';return reply(422,{ok:false,error:/^LG_[A-Z_]+$/.test(m)?m:'LG_INVALID_PAYLOAD'});}
   if(!String(payload.action).startsWith('window_'))return legacy(new Request(req.url,{method:'POST',headers:req.headers,body:bytes}));
   const url=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)return reply(503,{ok:false,error:'not_configured'});
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(v=>v.toString(16).padStart(2,'0')).join('');
   const res=await transport(`${url.replace(/\/$/,'')}/rest/v1/rpc/lg_window_ingest`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({p_token_hash:hash,p_payload:payload}),signal:AbortSignal.timeout(55000),redirect:'error'});
   const ack=await res.json();
   if(!res.ok){const m=String(ack?.message??'');return reply(m==='LG_AUTH_INVALID'?401:m==='LG_SCOPE_DENIED'?403:/CONFLICT|INCOMPLETE|EXPIRED|CLOSED|NOT_FOUND|NOT_INITIALIZED|GAP|DUPLICATE|TOO_MANY/.test(m)?409:m.startsWith('LG_INVALID')||m==='LG_ORDER_OUTSIDE_WINDOW'||m==='LG_ORDER_SCOPE_CONFLICT'?422:503,{ok:false,error:/^LG_[A-Z_]+$/.test(m)?m:'storage_unavailable'});}
   return validWindowAck(payload,ack)?reply(200,ack):reply(503,{ok:false,error:'invalid_ack'});
  }catch{return reply(503,{ok:false,error:'temporarily_unavailable'});}
 };
}
if(import.meta.main&&typeof Deno!=='undefined')Deno.serve(handler({SUPABASE_URL:Deno.env.get('SUPABASE_URL'),SUPABASE_SERVICE_ROLE_KEY:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}));

