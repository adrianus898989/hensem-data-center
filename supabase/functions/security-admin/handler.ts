// @ts-ignore Deno source extension.
import { SecurityError, uuid, verifiedSessionId, trustedProxyIp, readSecurityBody, securityResponse, securityFailure } from '../_shared/application-security.ts';
export type SecurityAdminGateway={getUser(token:string):Promise<{id:string}|null>;admin(args:{actor:string;session:string;ip:string;surface:string;action:string;body:Record<string,unknown>}):Promise<Record<string,unknown>>};
export function createSecurityAdminHandler(gateway:SecurityAdminGateway,options:{proxyKeySha256:string}){
 return async(request:Request):Promise<Response>=>{
  if(request.method!=='POST')return securityResponse({ok:false,code:'method_not_allowed'},405);
  try{
   const ip=await trustedProxyIp(request,options.proxyKeySha256);
   const token=/^Bearer ([^\s,]{1,16384})$/i.exec(request.headers.get('authorization')||'')?.[1];
   if(!token)throw new SecurityError(401,'login_required','请先登录');
   const user=await gateway.getUser(token),session=verifiedSessionId(token);
   if(!user||!uuid(user.id)||!session)throw new SecurityError(401,'login_required','登录已失效');
   const body=await readSecurityBody(request),surface=body.surface,action=String(body.action||'');
   if((surface!=='dashboard'&&surface!=='workorder')||!['policy','list-rules','upsert-rule','set-rule-active','delete-rule','account-security','list-account-security','set-account-policy','unlock-account','account-ip-rules','set-account-ip-mode','upsert-account-ip-rule','set-account-ip-rule-active','delete-account-ip-rule','upsert-ip-rule','set-ip-rule-active','delete-ip-rule'].includes(action))throw new SecurityError(400,'invalid_request','操作不支持');
   // SQL rechecks live role permissions + approved session and performs the mutation in
   // one transaction; JSON actor/session/IP fields are never used as authority.
   return securityResponse(await gateway.admin({actor:user.id,session,ip,surface,action,body}));
  }catch(error){return securityFailure(error);}
 };
}
