import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { requireEnv } from "@/lib/utils";

/**
 * Admin (service-role) Supabase client. Bypasses RLS — use ONLY on the
 * server, and only for operations that are already explicitly authorized
 * (e.g. writing a row after we've verified workspace membership, or
 * refreshing a user's Google OAuth token).
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

/**
 * SSR Supabase client bound to the caller's session cookies. Queries run
 * as the authenticated user, so RLS filters out rows they don't own.
 * Use this whenever you want user-scoped reads; use createAdminClient()
 * for writes after you've verified authorization explicitly.
 */
export async function createSSRClient() {
  const cookieStore = await cookies();
  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(list: { name: string; value: string; options: CookieOptions }[]) {
          try {
            for (const { name, value, options } of list) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // `cookies()` in a Server Component is read-only; middleware
            // handles refresh-token rotation, so we can safely no-op here.
          }
        },
      },
    }
  );
}
