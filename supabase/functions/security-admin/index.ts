// @ts-ignore Deno pinned dependency.
import { createClient } from 'jsr:@supabase/supabase-js@2.117.2';
// @ts-ignore Deno source extension.
import { createSecurityAdminHandler } from './handler.ts';
// @ts-ignore Deno source extension.
import { SecurityError, PROXY_KEY_SHA256 } from '../_shared/application-security.ts';
declare const Deno:{env:{get(name:string):string|undefined};serve(handler:(r:Request)=>Promise<Response>):void};
const admin=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input:any,init:any)=>fetch(input,{...init,signal:AbortSignal.timeout(12000),redirect:'error'})}});
const messages:Record<string,string>={owner_required:'只有总管理员可以管理登录安全',ip_denied:'当前 IP 不在后台白名单',version_conflict:'设置已被其他操作修改，请刷新后重试',current_ip_would_be_blocked:'请先保留并启用包含当前 IP 的白名单规则',invalid_network:'请输入有效的单个 IP 或网段，不支持全网段',rule_not_found:'白名单记录不存在',account_not_found:'账号不存在',invalid_failure_limit:'失败次数阈值须为 1–20 或继承默认',invalid_policy:'安全设置格式不正确',invalid_ip_mode:'请选择继承全局或账号独立白名单',backend_whitelist_required:'后台 IP 白名单必须启用',account_whitelist_required:'请先添加并启用至少一条账号 IP 规则',rule_limit_exceeded:'每个账号最多配置 100 条 IP 规则',invalid_ip:'当前访问 IP 无效',account_rule_not_found:'该账号的 IP 规则不存在',invalid_active:'启用状态不正确',invalid_action:'操作不支持',account_limit_exceeded:'账号目录超出读取上限，请联系管理员'};
Deno.serve(createSecurityAdminHandler({
 async getUser(token){const r=await admin.auth.getUser(token);if(r.error){if([401,403].includes(r.error.status))return null;throw new Error('Auth temporarily unavailable');}return r.data.user;},
 async admin(args){
  const {data,error}=await admin.rpc('application_security_admin',{p_actor:args.actor,p_session_id:args.session,p_ip:args.ip,p_surface:args.surface,p_action:args.action,p_body:args.body});
  if(error){const code=messages[error.message]?error.message:error.code==='23505'?'rule_exists':error.code==='22P02'?'invalid_request':'service_unavailable';
   throw new SecurityError(error.code==='42501'?403:error.code==='40001'||error.code==='23505'?409:error.code==='P0002'?404:error.code?.startsWith('22')?400:503,code,messages[code]|| (code==='rule_exists'?'该白名单规则已存在':code==='invalid_request'?'请求格式不正确':'安全设置服务暂时不可用'));}
  if(data?.ok!==true)throw new Error('Invalid security response');return data;
 }
},{proxyKeySha256:PROXY_KEY_SHA256}));
