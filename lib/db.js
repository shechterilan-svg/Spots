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

// ---------- places: create ----------
export function newPlaceId(name, nameEn) {
  const base = String(nameEn || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${base || "place"}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function createPlace(row, source) {
  const { data, error } = await supabase.from("places").insert(row).select("*").single();
  if (error) throw error;
  if (source?.url) {
    const { error: e2 } = await supabase.from("sources").insert({ ...source, place_id: data.id });
    if (e2) console.warn(e2);
  }
  placesMemo = null; // force reload with sources
  return data;
}

// ---------- members ----------
export async function listMembers() {
  const { data, error } = await supabase.from("members").select("*").order("role", { ascending: false }).order("invited_at");
  if (error) throw error;
  return data;
}
export async function addMember(email, name) {
  const { error } = await supabase.from("members").insert({ email: email.trim().toLowerCase(), name: name?.trim() || null, role: "friend" });
  if (error) throw error;
}
export async function removeMember(email) {
  const { error } = await supabase.from("members").delete().eq("email", email).eq("role", "friend");
  if (error) throw error;
}

// ---------- suggestions (friend recommendations, later also discovery) ----------
export async function addSuggestion({ name, city, url, note }) {
  const { error } = await supabase.from("suggestions").insert({ origin: "friend", url: url || null, payload: { name, city, note } });
  if (error) throw error;
}
export async function listSuggestions(status = "pending") {
  const { data, error } = await supabase.from("suggestions").select("*").eq("status", status).order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}
export async function mySuggestions(email) {
  const { data, error } = await supabase.from("suggestions").select("*").eq("suggested_by", email).order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return data;
}
export async function decideSuggestion(id, status, placeId = null) {
  const { error } = await supabase.from("suggestions").update({ status, place_id: placeId, decided_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

// ---------- outings & votes ----------
export async function listOutings() {
  const { data, error } = await supabase.from("outings").select("*").order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return data;
}
export async function getOuting(id) {
  const { data, error } = await supabase.from("outings").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}
export async function createOuting({ title, starts_at, place_ids }) {
  const { data, error } = await supabase.from("outings").insert({ title, starts_at, place_ids }).select("*").single();
  if (error) throw error;
  return data;
}
export async function updateOuting(id, patch) {
  const { data, error } = await supabase.from("outings").update(patch).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}
export async function deleteOuting(id) {
  const { error } = await supabase.from("outings").delete().eq("id", id);
  if (error) throw error;
}
export async function tally(outingId) {
  const { data, error } = await supabase.rpc("outing_tally", { p_outing: outingId });
  if (error) throw error;
  return data || [];
}
export async function myVote(outingId, email) {
  const { data } = await supabase.from("votes").select("place_id").eq("outing_id", outingId).eq("voter", email).maybeSingle();
  return data?.place_id || null;
}
export async function castVote(outingId, placeId) {
  const { error } = await supabase.from("votes").upsert({ outing_id: outingId, place_id: placeId }, { onConflict: "outing_id,voter" });
  if (error) throw error;
}
export function watchOuting(outingId, onChange) {
  const ch = supabase.channel(`outing-${outingId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "votes", filter: `outing_id=eq.${outingId}` }, onChange)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "outings", filter: `id=eq.${outingId}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(ch);
}
