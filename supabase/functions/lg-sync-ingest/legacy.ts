import { validateBusinessOrder } from './business.ts';
// Deploy as lg-sync-ingest with verify_jwt=false; this endpoint authenticates X-LG-Sync-Token.
// Service-role credentials stay inside the Edge Function environment.
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const plain = (x: unknown): x is Record<string, any> => x !== null && typeof x === 'object' && !Array.isArray(x);
const count = (x: unknown) => Number.isSafeInteger(x) && (x as number) >= 0;
const countries: Record<string,string> = { SUPERLG:'PH', LGPARTY:'PH', LGSABONG:'PH', LGBIGWIN:'PH', LG111:'ID', LG789:'PK' };
const utc = (x: unknown) => typeof x === 'string' && /^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(x) && Number.isFinite(Date.parse(x));
const day = (x: unknown) => typeof x === 'string' && /^20\d\d-\d\d-\d\d$/.test(x) && new Date(`${x}T00:00:00Z`).toISOString().slice(0,10) === x;
const uuid = (x: unknown) => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const amount = (x: unknown) => x === null || (typeof x === 'string' && /^-?\d{1,30}(?:\.\d{1,18})?$/.test(x));
export function validate(body: unknown): Record<string, any> {
  if (!plain(body) || body.source_system !== 'LG') throw new Error('LG_INVALID_PAYLOAD');
  if (body.action === 'check') return body;
  if (body.sync_mode !== undefined && !['full','live'].includes(body.sync_mode)) throw new Error('LG_INVALID_MODE');
  if (body.base_snapshot_id != null && !uuid(body.base_snapshot_id)) throw new Error('LG_INVALID_BASE');
  if (!['head','pending_dates','begin','chunk','finish','pending_begin','pending_chunk','pending_finish','callback_begin','callback_chunk','callback_finish'].includes(body.action)) throw new Error('LG_INVALID_ACTION');
  if (countries[body.platform] !== body.country_code || !Object.hasOwn(countries,body.platform)) throw new Error('LG_INVALID_SCOPE');
  const pending=['pending_begin','pending_chunk','pending_finish'].includes(body.action);
  const callback=['callback_begin','callback_chunk','callback_finish'].includes(body.action);
  if(callback && ['stat_date','capture_date','sync_mode','base_snapshot_id'].some(k=>Object.hasOwn(body,k))) throw new Error('LG_INVALID_CALLBACK');
  if(body.pending_window_days!==undefined && (!pending || body.pending_window_days!==7)) throw new Error('LG_INVALID_PENDING_WINDOW');
  if (!pending && !(body.action==='pending_dates' && body.order_kind===undefined) && !['recharge','withdraw'].includes(body.order_kind)) throw new Error('LG_INVALID_SCOPE');
  if (body.action === 'pending_dates') return body;
  if (!(pending?day(body.capture_date):callback?day(body.callback_date):day(body.stat_date)) || !uuid(body.snapshot_id) || !utc(body.observed_at)) throw new Error('LG_INVALID_DATE');
  if(pending && (!utc(body.scheduled_at) || !utc(body.captured_at))) throw new Error('LG_INVALID_PENDING_TIME');
  if (body.action === 'begin' || body.action === 'pending_begin' || body.action === 'callback_begin') {
    if (![body.expected_count,body.expected_chunks,body.fetched_count].every(count) || body.expected_count>999999999 || body.fetched_count>999999999 || body.expected_chunks>100000 || (body.source_total !== null && !count(body.source_total))) throw new Error('LG_INVALID_COUNTS');
    if (body.fetched_count<body.expected_count || (body.source_total !== null && body.fetched_count!==body.source_total) || (body.expected_count===0 ? body.expected_chunks!==0 : body.expected_chunks<1 || body.expected_chunks>body.expected_count)) throw new Error('LG_INCOMPLETE_SOURCE');
  }
  if(callback && body.action==='callback_begin' && (body.source_total!==body.expected_count || body.fetched_count!==body.expected_count)) throw new Error('LG_INCOMPLETE_SOURCE');
  if (body.action === 'chunk' || body.action === 'pending_chunk' || body.action === 'callback_chunk') {
    if (!count(body.chunk_index) || body.chunk_index>=100000 || !Array.isArray(body.orders) || body.orders.length<1 || body.orders.length>2000) throw new Error('LG_INVALID_CHUNK');
    if(pending && body.orders.length>500) throw new Error('LG_INVALID_CHUNK');
    for (const o of body.orders) {
      if (!plain(o)) throw new Error('LG_INVALID_ORDER');
      // SQL remains the authoritative canonical text sanitizer; never rewrite hashed orders.
      if(callback || (plain(o.raw) && Object.hasOwn(o.raw,'businessSchemaVersion'))) validateBusinessOrder(o);
      if(pending && (o.status_code!==1 || o.status_class!=='pending' || o.status_text!=='支付中' || o.order_amount===null || !amount(o.order_amount) || o.order_amount.startsWith('-'))) throw new Error('LG_INVALID_PENDING_ORDER');
      for (const f of ['order_no','status_text','operator_name','third_party','raw_channel','mapping_code','payment_method','merchant_name']) {
        if (typeof o[f]!=='string' || o[f].length>500 || /[\x00-\x1f\x7f]/.test(o[f])) throw new Error('LG_INVALID_ORDER');
      }
      if (!o.order_no || o.order_no.length>200 || ['-','--','---','----','null','None'].includes(o.order_no) || !(o.member_id===null || (typeof o.member_id==='string' && o.member_id.length<=200))) throw new Error('LG_INVALID_ORDER');
      if (!(o.status_code===null || (Number.isInteger(o.status_code) && Math.abs(o.status_code)<=999999999)) || !['success','pending','rejected','unknown'].includes(o.status_class) || !['auto','manual','unknown'].includes(o.operator_kind)) throw new Error('LG_INVALID_ORDER');
      if (![o.order_amount,o.actual_amount,o.metric_amount].every(amount)) throw new Error('LG_INVALID_AMOUNT');
      if (!utc(o.created_at) || !(o.finished_at===null || utc(o.finished_at)) || !(o.paid_at===null || (o.status_class==='success' && utc(o.paid_at)))) throw new Error('LG_INVALID_ORDER_DATE');
      if (!(o.handle_seconds===null || (count(o.handle_seconds) && o.handle_seconds<=999999999)) || !plain(o.raw)) throw new Error('LG_INVALID_ORDER');
    }
  }
  return body;
}
export function handler(env: Record<string,string|undefined>, transport: typeof fetch = fetch) {
  return async (req: Request) => {
    if (req.method!=='POST') return reply(405,{ok:false,error:'method_not_allowed'});
    const token=req.headers.get('x-lg-sync-token') || '';
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) return reply(401,{ok:false,error:'LG_AUTH_INVALID'});
    try {
      const declared=Number(req.headers.get('content-length'));
      if (declared>8*1024*1024) return reply(413,{ok:false,error:'payload_too_large'});
      const reader=req.body?.getReader(); if(!reader) return reply(400,{ok:false,error:'missing_body'});
      const chunks:Uint8Array[]=[]; let size=0;
      try {
        while(true) {
          const {done,value}=await reader.read(); if(done) break;
          size+=value.length; if(size>8*1024*1024){await reader.cancel();return reply(413,{ok:false,error:'payload_too_large'});}
          chunks.push(value);
        }
      } finally {reader.releaseLock();}
      const data=new Uint8Array(size); let at=0; for(const chunk of chunks){data.set(chunk,at);at+=chunk.length;}
      let payload: Record<string,any>;
      try {payload=validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)));}
      catch(e) {const m=e instanceof Error ? e.message : '';return reply(422,{ok:false,error:/^LG_[A-Z_]+$/.test(m)?m:'LG_INVALID_PAYLOAD'});}
      const url=env.SUPABASE_URL; const key=env.SUPABASE_SERVICE_ROLE_KEY;
      if(!url||!key) return reply(503,{ok:false,error:'not_configured'});
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join('');
      const pending=['pending_begin','pending_chunk','pending_finish'].includes(payload.action);
      const callback=['callback_begin','callback_chunk','callback_finish'].includes(payload.action);
      const rpc=pending?'lg_pending_ingest':callback?'lg_callback_ingest':'lg_sync_ingest';
      const res=await transport(`${url.replace(/\/$/,'')}/rest/v1/rpc/${rpc}`,{
        method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'content-type':'application/json'},
        body:JSON.stringify({p_token_hash:hash,p_payload:payload}),signal:AbortSignal.timeout(55000),redirect:'error',
      });
      const ack=await res.json();
      if(!res.ok) {
        const m=String(ack?.message||''); const safe=/^LG_[A-Z_]+$/.test(m)?m:'storage_unavailable';
        return reply(m==='LG_AUTH_INVALID'?401:m==='LG_SCOPE_DENIED'?403:/CONFLICT|INCOMPLETE|CLOSED|NOT_FOUND|TOO_MANY/.test(m)?409:m.startsWith('LG_INVALID')||m==='LG_ORDER_DATE_MISMATCH'?422:503,{ok:false,error:safe});
      }
      let valid=ack?.ok===true && (pending || ack.source_system==='LG');
      if(payload.action==='check') valid=valid && ack.protocol_version===1 && count(ack.scope_count) && ack.scope_count>0;
      else if(callback) {
        valid=valid && ack.platform===payload.platform && ack.country_code===payload.country_code &&
          ack.order_kind===payload.order_kind && ack.callback_date===payload.callback_date &&
          ack.snapshot_id===payload.snapshot_id && Date.parse(ack.observed_at)===Date.parse(payload.observed_at);
        if(payload.action==='callback_begin') valid=valid && ['collecting','published'].includes(ack.status) && ack.expected_count===payload.expected_count && ack.expected_chunks===payload.expected_chunks;
        if(payload.action==='callback_chunk') valid=valid && ['accepted','unchanged'].includes(ack.status) && ack.chunk_index===payload.chunk_index && ack.order_count===payload.orders.length;
        if(payload.action==='callback_finish') valid=valid && ['published','unchanged'].includes(ack.status) && count(ack.order_count) && count(ack.changed_count);
      }
      else if(payload.action==='head') valid=valid && ack.platform===payload.platform && ack.country_code===payload.country_code && ack.stat_date===payload.stat_date && ack.order_kind===payload.order_kind && (ack.snapshot_id===null || uuid(ack.snapshot_id));
      else if(payload.action==='pending_dates') valid=valid && ack.platform===payload.platform && ack.country_code===payload.country_code && (ack.order_kind ?? undefined)===payload.order_kind && Array.isArray(ack.dates) && ack.dates.every(day);
      else {
        valid=valid && ack.snapshot_id===payload.snapshot_id;
        if(payload.action==='pending_begin') valid=valid && ['collecting','published','live','superseded'].includes(ack.status) && ack.order_count===payload.expected_count;
        if(payload.action==='pending_chunk') valid=valid && ['accepted','unchanged'].includes(ack.status) && ack.chunk_index===payload.chunk_index && ack.order_count===payload.orders.length;
        if(payload.action==='pending_finish') valid=valid && ['published','live','unchanged','superseded'].includes(ack.status) && count(ack.order_count);
        if(payload.action==='begin') valid=valid && ['collecting','published','live','superseded'].includes(ack.status) && ack.expected_count===payload.expected_count && ack.expected_chunks===payload.expected_chunks;
        if(payload.action==='chunk') valid=valid && ['accepted','unchanged'].includes(ack.status) && ack.chunk_index===payload.chunk_index && ack.order_count===payload.orders.length;
        if(payload.action==='finish') valid=valid && ['published','live','unchanged','superseded'].includes(ack.status) && count(ack.order_count) && Date.parse(ack.observed_at)===Date.parse(payload.observed_at);
      }
      if(!valid) return reply(503,{ok:false,error:'invalid_ack'});
      return reply(200,ack);
    } catch {return reply(503,{ok:false,error:'temporarily_unavailable'});}
  };
}
if(import.meta.main && typeof Deno!=='undefined') Deno.serve(handler({SUPABASE_URL:Deno.env.get('SUPABASE_URL'),SUPABASE_SERVICE_ROLE_KEY:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}));

