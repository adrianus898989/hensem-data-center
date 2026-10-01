/** Only call verifiedSessionId after Supabase Auth getUser has verified the JWT. */
export function verifiedSessionId(token: string): string | null {
  try { const value = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).session_id;
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
  } catch { return null; }
}
export class SecurityError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function normalizeIp(value: string): string | null {
  const ip = value.trim().replace(/^::ffff:/i, '');
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) && ip.split('.').every(n => Number(n) <= 255 && String(Number(n)) === n)) return ip;
  if (ip.includes(':') && ip.length <= 64) { try { return new URL('https://[' + ip + ']').hostname.slice(1, -1); } catch { /* invalid */ } }
  return null;
}
export async function trustedProxyIp(request: Request, hash: string): Promise<string> {
  const key = request.headers.get('x-portal-proxy-key') || '', ip = normalizeIp(request.headers.get('x-portal-client-ip') || '');
  if (!key || key.length > 256 || !/^[a-f0-9]{64}$/.test(hash) || !ip) throw new SecurityError(403, 'proxy_denied', '登录来源验证失败');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  let difference = 0; const expected = Uint8Array.from(hash.match(/../g)!, x => parseInt(x, 16));
  for (let i = 0; i < digest.length; i++) difference |= digest[i] ^ expected[i];
  if (difference) throw new SecurityError(403, 'proxy_denied', '登录来源验证失败');
  return ip;
}
export async function readSecurityBody(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) throw new SecurityError(415, 'invalid_content_type', '请求格式不正确');
  const reader = request.body?.getReader(); if (!reader) throw new SecurityError(400, 'invalid_request', '请求格式不正确');
  let size = 0; const chunks: Uint8Array[] = [];
  for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length;
    if (size > 16384) { await reader.cancel(); throw new SecurityError(413, 'request_too_large', '请求过大'); } chunks.push(part.value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body: unknown; try { body = JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(bytes)); } catch { throw new SecurityError(400, 'invalid_request', '请求格式不正确'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SecurityError(400, 'invalid_request', '请求格式不正确');
  return body as Record<string, unknown>;
}
export function securityResponse(body: unknown, status = 200) { return new Response(JSON.stringify(body), {status, headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}); }
export function securityFailure(error: unknown) {
  return error instanceof SecurityError ? securityResponse({ok:false,code:error.code,message:error.message},error.status)
    : securityResponse({ok:false,code:'service_unavailable',message:'登录服务暂时不可用，请稍后重试'},503);
}
export const PROXY_KEY_SHA256 = '0ab9c303e8845503a0bb32e9a4bb898228656ba4928c306e5bc4eff35fd7980f';
