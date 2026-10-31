// Smart suggestion (F-02), rule-based: open for at least another hour, close by, matching a free-text request.
// The Claude-powered ranking comes later; this is also the fallback when the AI is unavailable.
import { openState } from "./hours.js";
import { distanceKm, fmtKm } from "./geo.js";

const TYPE_WORDS = { "בית קפה": ["קפה", "בית קפה", "בוקר", "בראנץ"], "בר": ["בר", "קוקטייל", "שתייה", "לשתות"], "מאפייה": ["מאפ", "לחם", "בייקרי"], "אוכל רחוב": ["רחוב", "מהיר", "פלאפל"] };
const CUISINE_ALIASES = { "אסייתי": ["יפני", "תאילנדי", "וייטנאמי", "פיליפיני", "נפאלי", "הודי", "ראמן", "סושי", "איזאקיה", "אסייתי", "אומקאסה"], "בשר": ["בשרים", "המבורגר", "שיפודים"], "דגים": ["דגים", "פירות ים", "סושי"], "איטלקי": ["איטלקי", "טרטוריה"] };

export function parseRequest(text, places) {
  const t = (text || "").trim();
  const want = { cuisines: new Set(), types: new Set(), maxPrice: null, minPrice: null, kosher: false, words: [] };
  if (!t) return want;
  const allCuisines = new Set(places.flatMap((p) => p.cuisine || []));
  for (const c of allCuisines) if (t.includes(c)) want.cuisines.add(c);
  for (const [k, list] of Object.entries(CUISINE_ALIASES)) if (t.includes(k)) list.forEach((c) => want.cuisines.add(c));
  for (const [type, words] of Object.entries(TYPE_WORDS)) if (words.some((w) => t.includes(w))) want.types.add(type);
  if (/לא יקר|זול|בתקציב|עממי/.test(t)) want.maxPrice = 2;
  if (/יוקרתי|מיוחד|חגיגי|שף/.test(t)) want.minPrice = 3;
  if (/כשר/.test(t) && !/לא כשר/.test(t)) want.kosher = true;
  return want;
}

function matches(p, want) {
  if (want.kosher && p.kosher !== "כשר") return false;
  if (want.maxPrice && p.price && p.price > want.maxPrice) return false;
  if (want.minPrice && (!p.price || p.price < want.minPrice)) return false;
  const hasTopic = want.cuisines.size || want.types.size;
  if (!hasTopic) return true;
  return (p.cuisine || []).some((c) => want.cuisines.has(c)) || want.types.has(p.type);
}

// Returns [{ place, km, reason, state }] – best first, diverse cuisines.
export function suggest(places, { loc, text = "", count = 3, offset = 0, minMinutes = 60 } = {}) {
  const want = parseRequest(text, places);
  const scored = [];
  for (const p of places) {
    if (["נסגר", "לא אהבתי"].includes(p.status)) continue;
    const s = openState(p.hours);
    if (!s.open || s.minutesLeft < minMinutes) continue;
    if (!matches(p, want)) continue;
    const km = loc ? distanceKm(loc, p) : null;
    if (loc && km == null) continue;              // can't place it on the map – skip when ranking by distance
    let score = 0;
    score -= km == null ? 0 : Math.min(km, 40) * 3; // nearer is better
    if (p.status === "אהבתי") score += 12;
    if (p.status === "רוצה לנסות") score += 6;
    if ((p.sources || []).length) score += 2;
    if (s.minutesLeft > 180) score += 2;
    scored.push({ place: p, km, state: s, score });
  }
  scored.sort((a, b) => b.score - a.score);
  // Diversity: prefer not repeating the first cuisine/type among the picks.
  const picked = [], seen = new Set();
  const pool = scored.slice(offset);
  for (const x of pool) {
    const key = (x.place.cuisine || [])[0] || x.place.type;
    if (picked.length < count && !seen.has(key)) { picked.push(x); seen.add(key); }
  }
  for (const x of pool) if (picked.length < count && !picked.includes(x)) picked.push(x);
  return { picks: picked.map((x) => ({ ...x, reason: reasonFor(x, want) })), total: scored.length };
}

function reasonFor({ place: p, km, state }, want) {
  const bits = [];
  if (km != null) bits.push(`${fmtKm(km)} ממך`);
  bits.push(`פתוח עד ${state.closesAt}`);
  const match = (p.cuisine || []).find((c) => want.cuisines.has(c));
  if (match) bits.push(`בדיוק ${match}`);
  if (p.status === "אהבתי") bits.push("כבר אהבת");
  else if (p.status === "רוצה לנסות") bits.push("ברשימת ״רוצה לנסות״");
  const pub = (p.sources || []).map((s) => s.publisher).find(Boolean);
  if (pub) bits.push(`המלצה של ${pub}`);
  return bits.join(" · ");
}
