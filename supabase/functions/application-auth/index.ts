// @ts-ignore Deno pinned dependency.
import { createClient } from 'jsr:@supabase/supabase-js@2.117.2';
// @ts-ignore Deno source extension.
import { createApplicationAuthHandler, type AuthGateway, type Tokens } from './handler.ts';
// @ts-ignore Deno source extension.
import { SecurityError, PROXY_KEY_SHA256 } from '../_shared/application-security.ts';
declare const Deno:{env:{get(name:string):string|undefined};serve(handler:(r:Request)=>Promise<Response>):void};
const url=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,''), service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'', anon=Deno.env.get('SUPABASE_ANON_KEY')||'';
const timedFetch:typeof fetch=(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(12000),redirect:'error'});
const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:timedFetch}});
function checked(result:any){if(result.error)throw new Error('Application authorization unavailable');return result.data;}
async function rpc(name:string,args:Record<string,unknown>){return checked(await admin.rpc(name,args));}
async function authTokens(kind:string,body:Record<string,string>):Promise<Tokens>{
 const res=await timedFetch(url+'/auth/v1/token?grant_type='+kind,{method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const value=await res.json().catch(()=>null);
 if(!res.ok){
  // Only GoTrue's invalid_credentials is a password failure. 429, unavailable,
  // and upstream policy failures must not accidentally disable an account.
  if(kind==='password'&&value?.code==='invalid_credentials')throw new SecurityError(401,'invalid_credentials','账号或密码不正确');
  if(kind==='refresh_token'&&[400,401,403].includes(res.status))throw new SecurityError(401,'login_required','登录已失效');
  throw new SecurityError(503,'auth_unavailable','登录服务暂时不可用');
 }
 if(!value||typeof value.access_token!=='string'||typeof value.refresh_token!=='string'||!Number.isFinite(value.expires_in)||!value.user?.id)throw new Error('Invalid Auth result');
 return {access_token:value.access_token,refresh_token:value.refresh_token,expires_in:value.expires_in,expires_at:Math.floor(Date.now()/1000)+value.expires_in,token_type:'bearer',user:{id:value.user.id,email:value.user.email}};
}
const gateway:AuthGateway={
 begin:(surface,username,ip,attempt)=>rpc('application_auth_begin',{p_surface:surface,p_username:username,p_ip:ip,p_attempt_id:attempt}),
 password:(email,password)=>authTokens('password',{email,password}),
 finish:(attempt,result,session)=>rpc('application_auth_finish',{p_attempt_id:attempt,p_result:result,p_session_id:session||null}),
 refresh:(refresh_token)=>authTokens('refresh_token',{refresh_token}),
 async getUser(token){const r=await admin.auth.getUser(token);if(r.error){if([401,403].includes(r.error.status))return null;throw new Error('Auth temporarily unavailable');}return r.data.user;},
 check:(user,session,surface)=>rpc('application_session_check',{p_user_id:user,p_session_id:session,p_surface:surface}),
 ipCheck:(surface,ip)=>rpc('application_auth_ip_check',{p_surface:surface,p_ip:ip}),
 async me(surface,token,user,request){
  if(surface==='workorder'){
   const response=await timedFetch(url+'/functions/v1/workorder-account-admin',{method:'POST',headers:{apikey:anon,Authorization:'Bearer '+token,'Content-Type':'application/json','x-portal-proxy-key':request.headers.get('x-portal-proxy-key')||'','x-portal-client-ip':request.headers.get('x-portal-client-ip')||''},body:JSON.stringify({action:'me'})});
   const value=await response.json().catch(()=>null);
   if(!response.ok)throw new SecurityError(response.status===401?401:response.status===403?403:503,value?.code||'account_denied',response.status===403?'工单账号未启用或未授权':'工单账号验证暂时不可用');
   return value;
  }
  const profile=checked(await admin.from('dashboard_profiles').select('auth_user_id,username,role,active,permissions,management_permissions,data_scope').eq('auth_user_id',user).maybeSingle());
  if(!profile||profile.active!==true||!['owner','admin','viewer'].includes(profile.role))throw new SecurityError(403,'account_denied','后台账号未启用或未授权');
  return {ok:true,identity_kind:'dashboard',account:profile};
 },
 async revoke(user,session,surface){await rpc('application_revoke_session',{p_user_id:user,p_session_id:session,p_surface:surface});},
 async revokeAll(user,surface){await rpc('application_revoke_user_sessions',{p_user_id:user,p_surface:surface});},
 async signout(token,scope='local'){const {error}=await admin.auth.admin.signOut(token,scope);if(error)throw error;},
};
Deno.serve(createApplicationAuthHandler(gateway,{proxyKeySha256:PROXY_KEY_SHA256}));
