import { createHandler } from "./handler.ts";

// Deploy this function with verify_jwt=false: x-api-key is authorized by the isolated RPC.
// SUPABASE_SERVICE_ROLE_KEY stays in the Edge environment and is never sent to the caller.
Deno.serve(createHandler({ env: (name) => Deno.env.get(name) }));
