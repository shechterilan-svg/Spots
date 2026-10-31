// Spots – public client config.
// The Supabase "anon" (publishable) key is safe to ship in the browser:
// access is enforced by Row Level Security on the database.
// NEVER put service-role, Google or Claude API keys here – those live in Supabase Edge Function secrets.
window.SPOTS_CONFIG = {
  supabaseUrl: "https://jlidzxqakypfmbdidyhp.supabase.co",      // e.g. https://abcd1234.supabase.co
  supabaseAnonKey: "sb_publishable_tQz3BgHJmmYab0uUm07JYw_iD7wvftX",  // Project Settings → API → anon / publishable key
  version: "0.4.5"
};
