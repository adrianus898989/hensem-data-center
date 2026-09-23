import { createOwnerAdminPreviewHandler } from "./handler.ts";
import { payloadBase64 } from "./payload.generated.ts";

// Deploy with verify_jwt=true. The handler additionally verifies Auth and a fresh
// RLS-scoped profile and grants for every view request. The service key is used
// only in the handler's fresh-Owner-authorized access-management branch.
Deno.serve(createOwnerAdminPreviewHandler({
  supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
  anonKey: Deno.env.get("SUPABASE_ANON_KEY") || "",
  serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  payloadBase64,
}));
