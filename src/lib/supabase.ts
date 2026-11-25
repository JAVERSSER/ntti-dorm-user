import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient | null = null;

/**
 * Server-only Supabase client (service-role key). The key never reaches the
 * browser: this module imports "server-only". Only used to read the form's
 * dropdown options and to store a resident's payment submission.
 */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-application-name": "dormpay-user" } },
    });
  }
  return client;
}
