// Supabase client, session and places data with an offline cache.
// supabase-js is vendored (vendor/supabase-*.js, loaded by index.html) so the app works offline and has no CDN dependency.
const { createClient } = window.supabase;

const cfg = window.SPOTS_CONFIG || {};
export const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);

export const supabase = configured
  ? createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
    })
  : null;

const CACHE_KEY = "spots.places.v1";

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch { return null; }
}
function writeCache(rows) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows })); } catch {}
}
export function clearCache() { try { localStorage.removeItem(CACHE_KEY); } catch {} }

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signInWithGoogle() {
  const redirectTo = location.origin + location.pathname;
  // prompt=select_account makes Google always show the account picker, so a phone with several
  // Google accounts can choose which one to use instead of silently reusing the last one.
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, queryParams: { prompt: "select_account" } },
  });
  if (error) throw error;
}

export async function signOut() {
  clearCache();
  await supabase.auth.signOut({ scope: "local" });
}

// Sign out locally, then go straight to Google's account picker.
export async function switchAccount() {
  await signOut();
  await signInWithGoogle();
}

// Returns { role: 'owner'|'friend' } or null when the signed-in email was not invited.
export async function getMembership(email) {
  const { data, error } = await supabase.from("members").select("role,name").eq("email", (email || "").toLowerCase()).maybeSingle();
  if (error) throw error;
  return data;
}

let placesMemo = null;

export function cachedPlaces() {
  return placesMemo || readCache()?.rows || null;
}

export async function loadPlaces({ force = false } = {}) {
  if (placesMemo && !force) return placesMemo;
  const { data, error } = await supabase
    .from("places")
    .select("*, sources(url,platform,publisher,caption)")
    .order("name");
  if (error) {
    const cached = readCache()?.rows;
    if (cached) return (placesMemo = cached);
    throw error;
  }
  placesMemo = data;
  writeCache(data);
  return data;
}

export async function savePlace(id, patch) {
  const { data, error } = await supabase.from("places").update(patch).eq("id", id).select("*, sources(url,platform,publisher,caption)").single();
  if (error) throw error;
  placesMemo = (placesMemo || []).map((p) => (p.id === id ? data : p));
  writeCache(placesMemo);
  return data;
}

export async function deletePlace(id) {
  const { error } = await supabase.from("places").delete().eq("id", id);
  if (error) throw error;
  placesMemo = (placesMemo || []).filter((p) => p.id !== id);
  writeCache(placesMemo);
}
