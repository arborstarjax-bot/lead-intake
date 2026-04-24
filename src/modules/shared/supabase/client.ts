// Browser Supabase client. Uses `@supabase/ssr`'s `createBrowserClient`
// so the session (and PKCE verifier used by OAuth flows like Sign in
// with Apple) is stored in cookies readable from both the browser AND
// the server-side /auth/callback route. Mixing `@supabase/supabase-js`
// createClient here would put state in localStorage only, which breaks
// `exchangeCodeForSession` on the server because the PKCE code verifier
// would be unreachable.
"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
