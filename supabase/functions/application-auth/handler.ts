// @ts-ignore Deno source extension.
import { SecurityError, uuid, verifiedSessionId, trustedProxyIp, readSecurityBody, securityResponse, securityFailure } from '../_shared/application-security.ts';
export type Surface = 'dashboard'|'workorder';
export type Tokens = {access_token:string;refresh_token:string;expires_in:number;expires_at:number;token_type:string;user:{id:string;email?:string}};
export type AuthGateway = {
 begin(surface:Surface,username:string,ip:string,attempt:string):Promise<{allowed:boolean;code?:string;user_id?:string;email?:string}>;
 password(email:string,password:string):Promise<Tokens>;
 finish(attempt:string,result:'valid'|'invalid'|'unavailable',sessionId?:string):Promise<{allowed:boolean;code:string}>;
 refresh(token:string):Promise<Tokens>;
 getUser(token:string):Promise<{id:string;email?:string}|null>;
 check(user:string,session:string,surface:Surface):Promise<{allowed:boolean;code:string}>;
 ipCheck(surface:Surface,ip:string):Promise<boolean>;
 me(surface:Surface,token:string,user:string,request:Request):Promise<Record<string,unknown>>;
 revoke(user:string,session:string,surface:Surface):Promise<void>;
 signout(token:string,scope?:'local'|'global'):Promise<void>;
 revokeAll(user:string,surface:Surface):Promise<void>;
};
function denied(code:string):never {
 const message = code==='account_locked'?'账号因连续登录失败已自动停用，请联系管理员启用':code==='ip_denied'?'当前 IP 不在登录白名单':code==='login_busy'?'正在验证登录，请稍后再试':code==='invalid_credentials'?'账号或密码不正确':'登录已失效，请重新登录';
 throw new SecurityError(code==='invalid_credentials'?401:code==='login_busy'?429:403,code,message);
}
export function createApplicationAuthHandler(gateway:AuthGateway, options:{proxyKeySha256:string}) {
 return async (request:Request):Promise<Response>=>{
  if(request.method!=='POST')return securityResponse({ok:false,code:'method_not_allowed'},405);
  try {
   const ip=await trustedProxyIp(request,options.proxyKeySha256);
   const body=await readSecurityBody(request), surface=body.surface;
   if(surface!=='dashboard'&&surface!=='workorder')throw new SecurityError(400,'invalid_surface','登录入口不正确');
   const action=body.action;
   if(!['login','refresh','me','logout','logout-all'].includes(String(action)))throw new SecurityError(400,'invalid_action','操作不支持');
   let token=/^Bearer ([^\s,]{1,16384})$/i.exec(request.headers.get('authorization')||'')?.[1]||'', tokens:Tokens|undefined;
   if(action==='login') {
    if(typeof body.username!=='string'||!/^[a-z0-9._-]{3,32}$/.test(body.username.trim().toLowerCase())||typeof body.password!=='string'||!body.password||body.password.length>128)denied('invalid_credentials');
    const attempt=crypto.randomUUID();
    const started=await gateway.begin(surface,body.username.trim().toLowerCase(),ip,attempt);
    if(!started.allowed)denied(started.code||'invalid_credentials');
    if(!uuid(started.user_id)||!started.email)throw new Error('Invalid auth reservation');
    try {tokens=await gateway.password(started.email,body.password);} catch(error) {
     const invalid=error instanceof SecurityError&&error.code==='invalid_credentials';
     const ended=await gateway.finish(attempt,invalid?'invalid':'unavailable');
     if(invalid)denied(ended.code||'invalid_credentials');
     throw error;
    }
    token=tokens.access_token;
    const user=await gateway.getUser(token),sid=verifiedSessionId(token);
    if(!user||user.id!==started.user_id||!sid){await gateway.finish(attempt,'unavailable');try{await gateway.signout(token);}catch{};throw new SecurityError(503,'auth_unavailable','登录验证暂时不可用');}
    const ended=await gateway.finish(attempt,'valid',sid);
    if(!ended.allowed){try{await gateway.signout(token);}catch{};denied(ended.code);}
   } else if(action==='refresh') {
    if(typeof body.refresh_token!=='string'||!body.refresh_token||body.refresh_token.length>4096)throw new SecurityError(401,'login_required','请重新登录');
    // Refresh never registers sessions. Tokens from direct Auth remain unusable.
    tokens=await gateway.refresh(body.refresh_token);token=tokens.access_token;
   }
   if(!token)throw new SecurityError(401,'login_required','请先登录');
   const user=await gateway.getUser(token),sid=verifiedSessionId(token);
   if(!user||!uuid(user.id)||!sid)throw new SecurityError(401,'login_required','登录已失效');
   if(tokens)tokens={...tokens,user:{id:user.id,...(user.email?{email:user.email}:{})}};
   const approved=await gateway.check(user.id,sid,surface);
   if(!approved.allowed)denied(approved.code||'application_session_denied');
   if(action==='logout'||action==='logout-all') {
    if(action==='logout-all')await gateway.revokeAll(user.id,surface);else await gateway.revoke(user.id,sid,surface);
    // Registry invalidation succeeds even if upstream logout is unavailable.
    try{await gateway.signout(token,action==='logout-all'?'global':'local');}catch{}
    return securityResponse({ok:true});
   }
   if(!(await gateway.ipCheck(surface,ip)))denied('ip_denied');
   const identity=await gateway.me(surface,token,user.id,request);
   if(identity.ok!==true||identity.identity_kind!==surface)throw new SecurityError(403,'account_denied','账号未获此入口授权');
   return securityResponse({...identity,...(tokens?{tokens}: {})});
  }catch(error){return securityFailure(error);}
 };
}
