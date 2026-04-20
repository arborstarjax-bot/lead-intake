import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/utils";

/**
 * Server-side Supabase client. This app has no end-user auth, so every call
 * uses the service-role key. All DB mutations happen through Next.js API
 * routes (server-only), which gives us a single choke point to attach server
 * authorization later if needed.
 */
export function createAdminClient() {
  return createSupabaseClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

// Alias kept for call sites that read as "the DB client for this request".
export const createClient = createAdminClient;
