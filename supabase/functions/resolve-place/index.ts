// Spots – resolve-place Edge Function.
// Turns a shared link (Instagram, TikTok, Google Maps, any web page) into a place draft:
//   1. read the link's title/caption, 2. Claude extracts the place, 3. Google Places fills address, hours, phone,
//   4. duplicate check against the saved places.
// Modes:  { url, text?, save?: false } → returns the draft (signed-in members, used by the app's "paste a link")
//         { url, save: true }          → saves it (owner session or the iPhone Shortcut personal key)
//           high confidence + found on Google + not a duplicate → new place; otherwise → inbox suggestion.
import { createClient } from "npm:@supabase/supabase-js@2";

const env = (...names: string[]) => names.map((n) => Deno.env.get(n)).find((v) => v && v.trim())?.trim() || "";
const ANTHROPIC_KEY = () => env("ANTHROPIC_API_KEY", "Claude", "CLAUDE", "CLAUDE_API_KEY");
const PLACES_KEY = () => env("GOOGLE_PLACES_KEY", "Google Places API", "GOOGLE_PLACES_API", "GOOGLE_PLACES_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MODELS = ["claude-haiku-5-5", "claude-haiku-4-5"];
const TYPES = ["מסעדה", "בית קפה", "בר", "מאפייה", "אוכל רחוב", "אחר"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-spots-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

const admin = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- who is calling ----------
async function caller(req: Request): Promise<{ email: string; role: string } | null> {
  const key = req.headers.get("x-spots-key");
  const db = admin();
  if (key) {
    const { data } = await db.from("shortcut_keys").select("id, owner_email").eq("key_hash", await sha256(key)).eq("revoked", false).maybeSingle();
    if (!data) return null;
    await db.from("shortcut_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
    return { email: data.owner_email, role: "owner" };
  }
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await userClient.auth.getUser();
  const email = u?.user?.email?.toLowerCase();
  if (!email) return null;
  const { data: m } = await db.from("members").select("role").eq("email", email).maybeSingle();
  return m ? { email, role: m.role } : null;
}

// ---------- 1. read the link ----------
const meta = (html: string, prop: string) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content="([^"]*)"`, "i"))
    || html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]*(?:property|name)=["']${prop}["']`, "i"));
  return m ? decodeEntities(m[1]) : "";
};
const decodeEntities = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function readLink(url: string) {
  const out: { platform: string; title: string; caption: string; publisher: string; finalUrl: string; via?: string; mapsName?: string; lat?: number; lng?: number } =
    { platform: "web", title: "", caption: "", publisher: "", finalUrl: url };
  try {
    if (/tiktok\.com/i.test(url)) {
      out.platform = "tiktok";
      const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
      if (r.ok) { const j = await r.json(); out.caption = j.title || ""; out.publisher = j.author_name || ""; }
      return out;
    }
    const isIg = /instagram\.com/i.test(url);
    if (isIg) {
      out.platform = "instagram";
      const code = url.match(/instagram\.com\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/([\w-]+)/i)?.[1];
      if (code) {
        try {
          const er = await fetch(`https://www.instagram.com/p/${code}/embed/captioned/`, {
            headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Accept-Language": "he,en;q=0.8" },
          });
          const eh = await er.text();
          const block = eh.match(/<div class="Caption"[^>]*>([\s\S]*?)<div class="CaptionComments/i)?.[1] || eh.match(/<div class="Caption"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
          const user = block.match(/class="CaptionUsername"[^>]*>([^<]+)</i)?.[1] || eh.match(/class="UsernameText"[^>]*>([^<]+)</i)?.[1] || "";
          const text = decodeEntities(block.replace(/<a[^>]*class="CaptionUsername"[^>]*>[^<]*<\/a>/i, "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();
          if (text) { out.caption = text; out.publisher = user.trim(); out.via = "embed"; }
          console.log("ig embed", er.status, "caption chars", text.length);
        } catch (e) { console.warn("ig embed failed", e); }
      }
      if (out.caption) return out;
    }
    const r = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": isIg ? "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" : "Mozilla/5.0 (compatible; SpotsBot/1.0)", "Accept-Language": "he,en;q=0.8" },
    });
    out.finalUrl = r.url || url;
    if (/google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(out.finalUrl)) {
      out.platform = "google_maps";
      const name = out.finalUrl.match(/\/place\/([^/@?]+)/);
      if (name) out.mapsName = decodeURIComponent(name[1].replace(/\+/g, " "));
      const at = out.finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || out.finalUrl.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
      if (at) { out.lat = +at[1]; out.lng = +at[2]; }
    }
    const html = (await r.text()).slice(0, 600_000);
    if (isIg) {
      out.platform = "instagram";
      out.title = meta(html, "og:title");
      out.caption = meta(html, "og:description") || meta(html, "description");
      out.via = out.caption ? "og" : "none";
      console.log("ig page", r.status, "caption chars", out.caption.length);
      const who = out.title.match(/^(.+?) on Instagram/i) || out.caption.match(/-\s*([\w.]+)\s+on\s/i);
      if (who) out.publisher = who[1];
    } else if (out.platform !== "google_maps") {
      out.title = meta(html, "og:title") || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "");
      out.caption = meta(html, "og:description") || meta(html, "description");
      out.publisher = meta(html, "og:site_name");
    } else {
      out.title = meta(html, "og:title");
    }
  } catch (e) { console.warn("readLink", e); }
  out.caption = out.caption.slice(0, 3000);
  return out;
}

// ---------- 2. Claude extracts the place ----------
async function extract(link: Awaited<ReturnType<typeof readLink>>, extraText: string) {
  const key = ANTHROPIC_KEY();
  if (!key) return null;
  const prompt = `Identify the single restaurant, cafe, bar, bakery or food spot this social post or page is about (Israel unless stated).
Return ONLY JSON: {"is_place":bool,"name":"name as locals write it (Hebrew if Hebrew)","name_en":"latin name or null","city":"Hebrew city or null",
"address_hint":"street and number if mentioned, else null","type":"one of ${TYPES.join("/")}","cuisine":["up to 3 Hebrew cuisine words"],
"dishes":["up to 5 dishes mentioned, Hebrew"],"kosher":"כשר|לא כשר|לא ידוע","search_query":"best Google Maps query to find it","confidence":0-1}
If several places are listed, pick the main one and lower confidence. If no specific place is named, is_place=false.

URL: ${link.finalUrl}
Platform: ${link.platform}
Publisher: ${link.publisher}
Google Maps name: ${link.mapsName || ""}
Title: ${link.title}
Caption: ${link.caption}
User note: ${extraText}`;
  for (const model of MODELS) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 600, messages: [{ role: "user", content: prompt }] }),
    });
    if (r.status === 404 || r.status === 400) { console.warn("model", model, r.status, await r.text()); continue; }
    if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const text = (j.content || []).map((c: { text?: string }) => c.text || "").join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
  return null;
}

// ---------- 3. Google Places ----------
const PRICE: Record<string, number> = { PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };
const hhmm = (h = 0, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

function hoursFrom(roh: { periods?: { open: { day: number; hour?: number; minute?: number }; close?: { day: number; hour?: number; minute?: number } }[] } | undefined) {
  if (!roh?.periods?.length) return {};
  const days: Record<string, string[]> = {};
  for (const p of roh.periods) {
    if (!p.close) { for (let d = 0; d < 7; d++) days[d] = ["24 שעות"]; return Object.fromEntries(Object.entries(days).map(([k, v]) => [k, v.join(", ")])); }
    (days[p.open.day] ||= []).push(`${hhmm(p.open.hour, p.open.minute)}-${hhmm(p.close.hour, p.close.minute)}`);
  }
  const out: Record<string, string> = {};
  for (let d = 0; d < 7; d++) out[String(d)] = days[d]?.join(", ") || "סגור";
  return out;
}

async function placesSearch(query: string, near?: { lat: number; lng: number }) {
  const key = PLACES_KEY();
  if (!key || !query) return null;
  const body: Record<string, unknown> = { textQuery: query, languageCode: "he", regionCode: "IL", maxResultCount: 1 };
  if (near) body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 500 } };
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json", "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.regularOpeningHours,places.nationalPhoneNumber,places.websiteUri,places.priceLevel,places.addressComponents,places.businessStatus,places.googleMapsUri",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) { console.warn("places", r.status, await r.text()); return null; }
  const j = await r.json();
  const p = j.places?.[0];
  if (!p) return null;
  const comp = (t: string) => p.addressComponents?.find((c: { types: string[] }) => c.types.includes(t))?.longText || "";
  const street = [comp("route"), comp("street_number")].filter(Boolean).join(" ");
  return {
    google_place_id: p.id, google_name: p.displayName?.text || "",
    address: street || (p.formattedAddress || "").split(",")[0] || null,
    neighborhood: comp("neighborhood") || comp("sublocality") || null,
    city: (comp("locality") || "").replace(/-יפו$/, "") || null,
    lat: p.location?.latitude ?? null, lng: p.location?.longitude ?? null,
    phone: p.nationalPhoneNumber || null, website: p.websiteUri || null,
    price: PRICE[p.priceLevel] || null,
    hours: hoursFrom(p.regularOpeningHours),
    closed: p.businessStatus === "CLOSED_PERMANENTLY",
    maps_url: p.googleMapsUri || null,
  };
}

// ---------- 4. duplicates ----------
const norm = (s: string) => (s || "").toLowerCase().replace(/[׳'"`’״\-–.,()]/g, "").replace(/\s+/g, " ").trim();
async function findDuplicate(draft: { google_place_id?: string | null; name?: string | null; name_en?: string | null; city?: string | null; instagram?: string | null }, url: string) {
  const db = admin();
  if (draft.google_place_id) {
    const { data } = await db.from("places").select("id,name").eq("google_place_id", draft.google_place_id).maybeSingle();
    if (data) return data;
  }
  const { data: src } = await db.from("sources").select("place_id").eq("url", url).not("place_id", "is", null).limit(1);
  if (src?.length) { const { data } = await db.from("places").select("id,name").eq("id", src[0].place_id).maybeSingle(); if (data) return data; }
  const { data: all } = await db.from("places").select("id,name,name_en,city,instagram");
  const n = norm(draft.name || ""), ne = norm(draft.name_en || "");
  return (all || []).find((p) =>
    (draft.instagram && p.instagram && p.instagram.toLowerCase() === draft.instagram.toLowerCase()) ||
    ((n && (norm(p.name) === n || norm(p.name_en || "") === n)) || (ne && (norm(p.name_en || "") === ne || norm(p.name) === ne))) &&
      (!draft.city || !p.city || norm(p.city) === norm(draft.city))
  ) || null;
}

function slugId(nameEn: string | null, name: string) {
  const base = String(nameEn || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${base || "place"}-${crypto.randomUUID().slice(0, 5)}`;
}

// ---------- main ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  const who = await caller(req);
  if (!who) return reply({ error: "unauthorized", message: "אין הרשאה. בדוק את המפתח האישי או התחבר מחדש." }, 401);

  let body: { url?: string; text?: string; save?: boolean };
  try { body = await req.json(); } catch { return reply({ error: "bad json" }, 400); }
  const url = (body.url || "").trim().match(/https?:\/\/\S+/)?.[0] || "";
  const extraText = (body.text || "").slice(0, 1000);
  if (!url && !extraText) return reply({ error: "missing url" }, 400);

  const link = url ? await readLink(url) : { platform: "text", title: "", caption: extraText, publisher: "", finalUrl: "" };
  let ai = null, aiError = "";
  try { ai = await extract(link, extraText); } catch (e) { aiError = String(e).slice(0, 200); }

  const query = ai?.search_query || [ai?.name || link.mapsName, ai?.address_hint, ai?.city].filter(Boolean).join(" ");
  const g = ai?.is_place !== false ? await placesSearch(query || link.mapsName || "", link.lat ? { lat: link.lat, lng: link.lng! } : undefined) : null;

  const draft = {
    name: ai?.name || g?.google_name || link.mapsName || "",
    name_en: ai?.name_en || null,
    type: TYPES.includes(ai?.type) ? ai.type : "מסעדה",
    cuisine: Array.isArray(ai?.cuisine) ? ai.cuisine.slice(0, 3) : [],
    dishes: Array.isArray(ai?.dishes) ? ai.dishes.slice(0, 5) : [],
    kosher: ["כשר", "לא כשר"].includes(ai?.kosher) ? ai.kosher : "לא ידוע",
    address: g?.address || ai?.address_hint || null,
    neighborhood: g?.neighborhood || null,
    city: g?.city || ai?.city || null,
    lat: g?.lat ?? link.lat ?? null, lng: g?.lng ?? link.lng ?? null,
    google_place_id: g?.google_place_id || null,
    phone: g?.phone || null, website: g?.website || null, price: g?.price || null,
    hours: g?.hours || {}, hours_source: g && Object.keys(g.hours).length ? "Google" : null,
    hours_checked_at: g && Object.keys(g.hours).length ? new Date().toISOString().slice(0, 10) : null,
    status: g?.closed ? "נסגר" : "רוצה לנסות",
    instagram: null as string | null,
    notes: null as string | null,
    needs_review: false,
  };
  draft.needs_review = !draft.address || !Object.keys(draft.hours).length;
  const confidence = Math.max(0, Math.min(1, Number(ai?.confidence) || 0)) * (g ? 1 : 0.6);
  const source = url ? { url, platform: link.platform, publisher: link.publisher || null, caption: (link.caption || link.title || "").slice(0, 500) || null } : null;
  const duplicate = draft.name ? await findDuplicate(draft, url) : null;

  const read = { platform: link.platform, chars: (link.caption || "").length + (link.title || "").length, via: (link as { via?: string }).via || null };
  console.log("resolve", JSON.stringify({ read, ai: !!ai, is_place: ai?.is_place, name: ai?.name, google: !!g, aiError }));
  const result = { draft, source, duplicate, confidence: Math.round(confidence * 100) / 100, found_on_google: !!g, ai: !!ai, ai_error: aiError || undefined, maps_url: g?.maps_url, read };
  if (!body.save) return reply(result);

  // ---------- save (owner only) ----------
  if (who.role !== "owner") return reply({ error: "forbidden" }, 403);
  const db = admin();
  if (duplicate) return reply({ ...result, status: "duplicate", message: `כבר ברשימה: ${duplicate.name}` });
  if (draft.name && g && confidence >= 0.7) {
    const row = { ...draft, id: slugId(draft.name_en, draft.name) } as Record<string, unknown>;
    const { data, error } = await db.from("places").insert(row).select("id,name,address,city").single();
    if (error) return reply({ ...result, status: "error", message: error.message }, 500);
    if (source) await db.from("sources").insert({ ...source, place_id: data.id });
    return reply({ ...result, status: "saved", place: data, message: `נשמר: ${data.name}${data.address ? `, ${data.address}` : ""}${data.city ? `, ${data.city}` : ""}` });
  }
  const { error } = await db.from("suggestions").insert({ origin: "share", suggested_by: who.email, url: url || null, payload: { ...draft, note: extraText || null, source }, confidence });
  if (error) return reply({ ...result, status: "error", message: error.message }, 500);
  return reply({ ...result, status: "inbox", message: draft.name ? `לא בטוח שזה ${draft.name} – נשמר בתיבת האישור` : "לא זיהיתי את המקום – נשמר בתיבת האישור" });
});
