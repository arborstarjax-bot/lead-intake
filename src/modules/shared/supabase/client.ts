// Browser Supabase client is not currently used — kept as a thin shim so we
// can add realtime subscriptions or auth later without restructuring imports.
"use client";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
