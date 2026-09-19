import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createNewarBusinessHandler} from "../../../BACKEND_CURRENT/newar-business-ingest.ts";
Deno.serve(createNewarBusinessHandler({env: {
  SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
}}));
