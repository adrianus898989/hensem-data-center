// @ts-ignore Deno source extension.
import { SecurityError } from '../_shared/application-security.ts';
// @ts-ignore Deno source extension.
import type { Tokens } from './handler.ts';

export type AuthTokenGrant = 'password' | 'refresh_token';
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseAuthTokenResponse(kind: AuthTokenGrant, status: number, value: unknown, now = Math.floor(Date.now() / 1000)): Tokens {
  const data = record(value);
  if (status < 200 || status >= 300) {
    // GoTrue may put the numeric HTTP status in code and its exact machine code
    // in error_code. A message, a policy denial, or a 5xx is never a password failure.
    if (kind === 'password' && [400, 401].includes(status)
        && (data?.error_code === 'invalid_credentials' || data?.code === 'invalid_credentials')) {
      throw new SecurityError(401, 'invalid_credentials', '账号或密码不正确');
    }
    if (status === 429) throw new SecurityError(429, 'auth_rate_limited', '登录请求过于频繁，请稍后再试');
    if (kind === 'refresh_token' && [400, 401, 403].includes(status)) throw new SecurityError(401, 'login_required', '登录已失效');
    throw new SecurityError(503, 'auth_unavailable', '登录服务暂时不可用');
  }
  const user = record(data?.user);
  if (!data || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string'
      || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in)
      || typeof user?.id !== 'string' || !user.id) throw new Error('Invalid Auth result');
  return {access_token:data.access_token,refresh_token:data.refresh_token,expires_in:data.expires_in,
    expires_at:now + data.expires_in,token_type:'bearer',user:{id:user.id,...(typeof user.email === 'string' ? {email:user.email} : {})}};
}
