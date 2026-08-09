import { createClient } from "@supabase/supabase-js";

// Server-only Supabase client. Uses the SECRET (service) key, so it bypasses
// row-level security. This module must NEVER be imported into client code —
// keeping it in `*.server.js` ensures the bundler leaves it out of the browser.
// Accept either our own env names or the ones the Supabase↔Vercel integration
// injects automatically (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY), so the app
// works whether the vars were set by hand or synced by the integration.
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecret =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseSecret) {
  // Fail loud in dev so a missing env var doesn't silently return empty prices.
  console.warn(
    "[supabase] SUPABASE_URL or SUPABASE_SECRET_KEY is not set — pricing lookups will fail.",
  );
}

let _client = null;

export function getSupabase() {
  if (_client) return _client;
  _client = createClient(supabaseUrl ?? "", supabaseSecret ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "custom-ring-creator" } },
  });
  return _client;
}

export default getSupabase;
