# Neutral free entry

Public entry: `https://data-center.workdesk-hub.workers.dev/hensem-data-center/`.
The root redirects to this path to preserve the existing Next.js base path.

This Worker fetches only public static files from the existing GitHub Pages deployment. GitHub main remains the publishing source, so each Pages release appears here without copying a stale build. The proxy does not receive database bindings or secrets and never forwards cookies, authorization headers or query strings. Authenticated data requests still go directly to Supabase with the existing user permissions.

Run `node --test cloudflare/data-center/worker.test.mjs`. Publish the tested file with `wrangler deploy --config cloudflare/data-center/wrangler.jsonc`. The Cloudflare account subdomain must be `workdesk-hub`; existing portal code, bindings and secrets stay on its existing Worker. Add the exact new backend origin to the two Supabase function allowlists before directing users here.

Public static requests count against the account's free Workers request allowance, shared with its existing portal. No paid plan, custom domain, account rename or repository rename is required. Worker logs are disabled to avoid retaining client query strings. Aggregate Cloudflare request metrics remain available.
