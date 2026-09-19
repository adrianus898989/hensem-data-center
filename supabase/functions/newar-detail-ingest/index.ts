import {createNewarDetailHandler} from "../../../BACKEND_CURRENT/newar-detail-ingest.ts";

// Per-collector custom key is hashed and validated again inside the atomic RPC.
// The service-role credential is available only to this server runtime.
Deno.serve(createNewarDetailHandler({env:{
  SUPABASE_URL:Deno.env.get("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
}}));
