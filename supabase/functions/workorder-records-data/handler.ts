import {readCollectedWorkorderQuery,type CollectedWorkorderQuery} from './query.ts';
export type PortalAccount={auth_user_id:string;role:string;active:boolean;team:string;platforms:string[]};
export type Gateway={identify(headers:Headers):Promise<unknown>;query(account:PortalAccount,query:CollectedWorkorderQuery):Promise<any>};
export class ApiError extends Error { constructor(public status: number, public code: string) { super(code); } }
const fail = (code = 'invalid_request'): never => { throw new ApiError(400, code); };
const object = (value: unknown): Record<string, any> => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(); return value as Record<string, any>; };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function text(value: unknown, max = 200, multiline = false): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) fail('invalid_field');
  return (value as string).trim();
}
function normalizeIp(value: string): string {
  const s = value.trim().replace(/^::ffff:/i, '');
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(s) && s.split('.').every(n => +n <= 255)) return s;
  if (s.includes(':') && s.length <= 64) { try { return new URL('https://[' + s + ']').hostname.slice(1, -1); } catch { /* deny */ } }
  return '';
}
async function forwarded(request: Request, hash: string): Promise<Headers> {
  const key = request.headers.get('x-portal-proxy-key') || '', ip = normalizeIp(request.headers.get('x-portal-client-ip') || '');
  if (!key || key.length > 256 || !ip || !/^[a-f0-9]{64}$/.test(hash)) throw new ApiError(403, 'proxy_denied');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))), expected = Uint8Array.from(hash.match(/../g)!, v => parseInt(v, 16));
  let mismatch = 0; for (let i = 0; i < 32; i++) mismatch |= digest[i] ^ expected[i];
  if (mismatch) throw new ApiError(403, 'proxy_denied');
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer [^\s,]{1,16384}$/i.test(authorization)) throw new ApiError(401, 'login_required');
  return new Headers({ authorization, 'x-portal-proxy-key': key, 'x-portal-client-ip': ip });
}
function identity(value: unknown): PortalAccount {
  const result = object(value), a = object(result.account), catalog = object(result.catalog), teams = object(catalog.platformTeams);
  if (result.ok !== true || result.identity_kind !== 'workorder' || !uuid(a.auth_user_id) || a.active !== true || !['agent', 'supervisor', 'auditor'].includes(a.role)) throw new ApiError(403, 'account_denied');
  const team = text(a.team, 100);
  if (!team || !Array.isArray(a.platforms) || !a.platforms.length || a.platforms.length > 200 || a.platforms.some((p: unknown) => typeof p !== 'string' || !p || p.length > 100 || teams[p] !== team)) throw new ApiError(403, 'scope_denied');
  return { auth_user_id: a.auth_user_id.toLowerCase(), role: a.role, active: true, team, platforms: [...new Set(a.platforms)] as string[] };
}
const strings=['workorderNo','orderNo','sourceOrderNo','utr','provider','workorderType','workorderName','channelType','submittedAt','operatedAt','operatorAccount','lastUpdatedBy','sourceUpdatedAt','collectedAt','submittedDate','queryDate','queryBasis'] as const;
const gaps=new Set(['payment_order_no_missing','work_order_no_missing','utr_missing','kyc_unknown','utr_match_unknown','operator_missing','operation_time_missing','attachment_type_unmapped','json_data_unmapped','remark_omitted','source_update_time_missing']);
function normalizeRow(value:unknown,account:PortalAccount){
 const r=object(value);if(typeof r.platform!=='string'||!account.platforms.includes(r.platform)||typeof r.workorderId!=='string'||!r.workorderId||r.workorderId.length>200||!['deposit','withdraw'].includes(r.issueKind))throw new ApiError(503,'invalid_scope_response');
 if(r.statusCode!==null&&(!Number.isInteger(r.statusCode)||r.statusCode<1||r.statusCode>5))throw new ApiError(503,'invalid_response');
 if(r.amount!==null&&(typeof r.amount!=='string'||r.amount.length>80||!/^\d+(?:\.\d+)?$/.test(r.amount)))throw new ApiError(503,'invalid_response');
 if(![null,true,false].includes(r.kycConnected)||![null,true,false].includes(r.utrMatched)||r.reminderCount!==null&&(!Number.isSafeInteger(r.reminderCount)||r.reminderCount<0))throw new ApiError(503,'invalid_response');
 const out:Record<string,unknown>={id:JSON.stringify(['AR','IN',r.platform,r.workorderId]),source:'AR',countryCode:'IN',country:'印度',platform:r.platform,workorderId:r.workorderId,issueKind:r.issueKind,statusCode:r.statusCode,amount:r.amount,kycConnected:r.kycConnected,utrMatched:r.utrMatched,reminderCount:r.reminderCount,readOnly:true,retained:true,attachmentAccess:'unavailable'};
 for(const k of strings){if(r[k]!=null&&(typeof r[k]!=='string'||r[k].length>200))throw new ApiError(503,'invalid_response');out[k]=r[k]??'';}
 out.fieldGaps=Array.isArray(r.fieldGaps)?r.fieldGaps.filter((v:unknown)=>typeof v==='string'&&gaps.has(v)):[];
 out.attachmentTypes=Array.isArray(r.attachmentTypes)?r.attachmentTypes.filter((v:unknown)=>['image','pdf','video'].includes(v as string)):[];
 return out;
}
export function createWorkorderRecordsHandler(gateway:Gateway,options:{proxyKeySha256:string}){
 return async(request:Request):Promise<Response>=>{
  const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  if(request.method!=='POST')return json({ok:false,code:'method_not_allowed'},405);
  if(request.headers.has('origin'))return json({ok:false,code:'origin_denied'},403);
  try{
   const auth=await forwarded(request,options.proxyKeySha256);
   if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return json({ok:false,code:'invalid_content_type'},415);
   if(Number(request.headers.get('content-length')||0)>8192)fail('request_too_large');
   const reader=request.body?.getReader();if(!reader)fail();let length=0,raw='';const decoder=new TextDecoder();
   while(true){const {done,value}=await reader!.read();if(done)break;length+=value.length;if(length>8192){await reader!.cancel();fail('request_too_large');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
   let query:CollectedWorkorderQuery;try{query=readCollectedWorkorderQuery(JSON.parse(raw));}catch{fail('invalid_query');}
   const account=identity(await gateway.identify(auth)),platform=query!.action==='detail'?query!.platform:query!.filters.platform;
   if(platform&&!account.platforms.includes(platform))throw new ApiError(403,'scope_denied');
   const result=await gateway.query(account,query!);const limit=query!.action==='list'?query!.limit:1;
   if(!result||!['ready','not_connected'].includes(result.sourceStatus)||!Array.isArray(result.rows)||result.rows.length>limit||!Number.isSafeInteger(result.total)||result.total<0||result.total<result.rows.length)throw new ApiError(503,'invalid_response');
   if(result.sourceStatus==='not_connected'&&(result.total!==0||result.rows.length))throw new ApiError(503,'invalid_response');
   const rows=result.rows.map((r:unknown)=>normalizeRow(r,account));
   if(query!.action==='detail'){
    if(result.sourceStatus==='not_connected')throw new ApiError(503,'source_not_connected');
    if(!rows.length)throw new ApiError(404,'record_not_found');
    if(result.total!==1||rows[0].platform!==query!.platform||rows[0].workorderId!==query!.workorderId)throw new ApiError(503,'invalid_scope_response');
    return json({ok:true,row:rows[0]});
   }
   return json({ok:true,sourceStatus:result.sourceStatus,rows,total:result.total,offset:query!.offset,limit:query!.limit,platforms:account.platforms});
  }catch(error){return error instanceof ApiError?json({ok:false,code:error.code},error.status):json({ok:false,code:'service_unavailable'},503);}
 };
}
