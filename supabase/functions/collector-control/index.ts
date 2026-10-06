// @ts-ignore Edge Functions require explicit source extensions.
import { createCollectorControlHandler } from './handler.ts';
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };
Deno.serve(createCollectorControlHandler({
  url: Deno.env.get('SUPABASE_URL') || '',
  publicKey: Deno.env.get('SUPABASE_ANON_KEY') || '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  // The data-center Worker identity key, matching application-entry-gate.
  // Only its hash is public; the Worker keeps PORTAL_PROXY_KEY as a secret.
  proxyKeySha256: '5ca06495bb01d44b87a8cba0a12548f0eb438b42bdc05c82f0a028a1b5daecfa',
  allowedOrigins: ['https://adrianus898989.github.io', 'https://data-center.workdesk-hub.workers.dev'],
}));
