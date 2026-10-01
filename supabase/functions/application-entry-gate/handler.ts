// @ts-ignore Deno source extension.
import { readSecurityBody, securityFailure, securityResponse, trustedProxyIp } from '../_shared/application-security.ts';

export type EntryGateway = { allowed(ip: string): Promise<boolean> };

/** Server-only opening check. Account login still has its own stricter gate. */
export function createEntryGateHandler(gateway: EntryGateway, options: { proxyKeySha256: string }) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return securityResponse({ ok: false }, 405);
    try {
      const ip = await trustedProxyIp(request, options.proxyKeySha256);
      const body = await readSecurityBody(request);
      // No arbitrary surface, username, user ID or client-selected IP lookup.
      if (Object.keys(body).length) return securityResponse({ ok: false }, 400);
      return securityResponse({ ok: true, allowed: await gateway.allowed(ip) === true });
    } catch (error) { return securityFailure(error); }
  };
}
