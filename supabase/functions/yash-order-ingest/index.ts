import { createYashIngestHandler } from "./handler.ts";
Deno.serve(createYashIngestHandler({env: {SUPABASE_URL: Deno.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}}));
