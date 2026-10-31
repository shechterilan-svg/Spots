// Spots – app shell: auth gate, hash router and screens.
import * as db from "./lib/db.js";
import { DAY_NAMES, nowInIsrael, openState, hasHours } from "./lib/hours.js";
import * as geo from "./lib/geo.js";
import { suggest } from "./lib/suggest.js";

const view = document.getElementById("view");
const cfg = window.SPOTS_CONFIG || {};
const state = {
  session: null, member: null, authError: null,
  filters: { q: "", type: "", city: "", cuisine: "", kosher: "", price: "", status: "", openNow: false },
  loc: geo.savedLocation(), locError: null, request: "", offset: 0,
  area: { center: null, radius: 5 },
  draftOuting: { title: "", starts_at: "", place_ids: [] },
  unwatch: null, poll: null,
};

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isOwner = () => state.member?.role === "owner";
const myEmail = () => (state.session?.user?.email || "").toLowerCase();
const head = (title, sub) => `<div class="screen-head"><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>`;
const ph = (title, text, prio, ids) =>
  `<section class="card placeholder"><span class="tag ${prio === "Must" ? "must" : "should"}">${esc(prio)} · ${esc(ids)}</span>
   <h3>${esc(title)}</h3><p>${esc(text)}</p></section>`;
const priceTxt = (p) => (p ? "₪".repeat(p) : "");
const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, "he"));
const mapsUrl = (p) => p.lat != null ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.name, p.address, p.city].filter(Boolean).join(" "))}`;
const wazeUrl = (p) => (p.lat != null ? `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent([p.address, p.city].filter(Boolean).join(" "))}&navigate=yes`);
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
const appUrl = (hash) => `${location.origin}${location.pathname}${hash}`;
const fmtDate = (iso) => iso ? new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";
const distTo = (p) => (state.loc ? geo.distanceKm(state.loc, p) : null);

function openBadge(p) {
  const s = openState(p.hours);
  if (s.open === null) return `<span class="badge muted">אין שעות</span>`;
  if (s.open) return `<span class="badge open">פתוח · עד ${esc(s.closesAt)}</span>`;
  return `<span class="badge closed">סגור${s.opensAt ? ` · נפתח ב-${esc(s.opensAt)}` : ""}</span>`;
}

function card(p, extra = "") {
  const meta = [p.type, (p.cuisine || []).join(", ")].filter(Boolean).join(" · ");
  const where = [p.neighborhood, p.city].filter(Boolean).join(", ");
  const km = distTo(p);
  return `<a class="card place-card" href="#/place/${encodeURIComponent(p.id)}">
    <div class="pc-top"><h3 dir="auto">${esc(p.name)}</h3><span class="price">${priceTxt(p.price)}</span></div>
    <div class="pc-meta">${esc(meta)}</div>
    ${extra}
    <div class="pc-bottom"><span class="pc-where">${esc(where || "מיקום לא ידוע")}${km != null ? ` · <b>${geo.fmtKm(km)}</b>` : ""}</span>${openBadge(p)}</div>
    ${p.needs_review ? `<span class="badge warn">חסרים פרטים</span>` : ""}
  </a>`;
}

async function getPlaces() { return db.cachedPlaces() || (await db.loadPlaces()); }
const byId = async (id) => (await getPlaces()).find((x) => x.id === id);

// ---------- location bar (F-01) ----------
function locationBar(places) {
  const cities = uniq(places.filter((p) => p.lat != null).map((p) => p.city));
  const label = state.loc ? (state.loc.source === "gps" ? "לפי המיקום שלך" : `באזור ${state.loc.label}`) : "בלי מיקום";
  return `<div class="locbar">
    <span class="loc-label">📍 ${esc(label)}</span>
    <button class="chip" data-action="locate">${state.loc?.source === "gps" ? "רענון מיקום" : "השתמש במיקום שלי"}</button>
    <label class="select"><span class="sr">בחירת אזור</span><select data-action-change="area-city">
      <option value="">בחירת אזור</option>${cities.map((c) => `<option ${state.loc?.source === "area" && state.loc.label === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
    </select></label>
  </div>${state.locError ? `<p class="status error">${esc(state.locError)}</p>` : ""}`;
}

// ---------- screens ----------
const screens = {
  now: { title: "עכשיו", render: renderNow },
  list: { title: "רשימה", render: renderList },
  place: { title: "דף מקום", render: renderPlace },
  edit: { title: "עריכה", render: (id) => renderPlaceForm(id), owner: true },
  add: { title: "הוספה", render: renderAdd },
  inbox: { title: "תיבת אישור", render: renderInbox, owner: true },
  outings: { title: "יציאות", render: renderOutings },
  "new-outing": { title: "יציאה חדשה", render: renderNewOuting, owner: true },
  outing: { title: "יציאה", render: renderOuting },
  vote: { title: "הצבעה", render: renderOuting },
  map: { title: "אזור", render: renderArea },
  settings: { title: "הגדרות", render: renderSettings },
  shortcut: { title: "קיצור דרך", render: renderShortcutHelp, owner: true },
};

function renderSignIn(msg) {
  return `<div class="signin">
    <div class="signin-mark" aria-hidden="true"></div>
    <h2>Spots</h2>
    <p>המקומות שלך: מסעדות, בתי קפה ועוד.</p>
    ${db.configured ? `<button class="btn google" id="google-btn">
      <svg viewBox="0 0 24 24" aria-hidden="true" class="g"><path fill="#4285F4" stroke="none" d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6a5.1 5.1 0 0 1-2.2 3.4v2.8h3.6c2.1-2 3.2-4.9 3.2-8.3z"/><path fill="#34A853" stroke="none" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.9A11 11 0 0 0 12 23z"/><path fill="#FBBC05" stroke="none" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 10z"/><path fill="#EA4335" stroke="none" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4z"/></svg>
      כניסה עם Google</button>` : `<p class="status">עוד לא מחובר ל-Supabase.</p>`}
    ${msg ? `<p class="status error">${esc(msg)}</p>` : ""}
  </div>`;
}

function renderNoAccess() {
  return `<div class="signin"><h2>אין לך גישה עדיין</h2>
    <p>החשבון ${esc(state.session?.user?.email)} לא הוזמן ל-Spots. בקש מאילן להוסיף אותך.</p>
    <div class="row" style="justify-content:center"><button class="btn" data-action="switch">החלפת חשבון</button>
    <button class="btn ghost" data-action="signout">התנתקות</button></div></div>`;
}

// ----- Now (F-01, F-02) -----
async function renderNow() {
  const places = await getPlaces();
  const { picks, total } = suggest(places, { loc: state.loc, text: state.request, offset: state.offset });
  const nearOpen = places
    .map((p) => ({ p, s: openState(p.hours), km: distTo(p) }))
    .filter((x) => x.s.open && !picks.some((k) => k.place.id === x.p.id))
    .sort((a, b) => (a.km ?? 999) - (b.km ?? 999) || b.s.minutesLeft - a.s.minutesLeft)
    .slice(0, 15);
  return head("לאן הולכים עכשיו?", state.loc ? "שלוש הצעות שפתוחות לפחות עוד שעה וקרובות אלייך" : "שלוש הצעות שפתוחות לפחות עוד שעה") +
    locationBar(places) +
    `<form id="request-form" class="request"><input class="field" id="request" placeholder="למשל: משהו אסייתי לא יקר" aria-label="בקשה חופשית" value="${esc(state.request)}">
      <button class="btn" type="submit">הצע</button></form>` +
    (picks.length
      ? `<div class="picks">${picks.map((x, i) => card(x.place, `<p class="reason"><span class="rank">${i + 1}</span>${esc(x.reason)}</p>`)).join("")}</div>
         ${total > 3 ? `<div class="row"><button class="btn ghost" data-action="more">הצעות אחרות</button><span class="status">${total} מקומות מתאימים</span></div>` : ""}`
      : `<div class="card notice">אין כרגע מקום שמתאים ופתוח לפחות עוד שעה${state.request ? " לבקשה הזו" : ""}.</div>`) +
    (nearOpen.length ? `<h3 class="section-title">פתוחים עכשיו${state.loc ? " קרוב" : ""}</h3>${nearOpen.map((x) => card(x.p)).join("")}` : "");
}

// ----- List (F-06) -----
async function renderList() {
  const places = await getPlaces();
  const f = state.filters;
  const opts = (label, key, values, fmt = (v) => v) =>
    `<label class="select"><span class="sr">${label}</span><select data-filter="${key}">
      <option value="">${label}</option>${values.map((v) => `<option value="${esc(v)}" ${String(f[key]) === String(v) ? "selected" : ""}>${esc(fmt(v))}</option>`).join("")}
    </select></label>`;
  const filtered = applyFilters(places);
  return head("כל המקומות", `${places.length} מקומות`) +
    `<input class="field" type="search" id="q" placeholder="חיפוש לפי שם, סגנון, מנה או שכונה" aria-label="חיפוש" value="${esc(f.q)}">
     <div class="filters">
       ${Object.entries(f).some(([k, v]) => v && k !== "q") ? `<button class="chip clear" data-action="clear-filters">ניקוי</button>` : ""}
       <button class="chip ${f.openNow ? "on" : ""}" data-toggle="openNow" aria-pressed="${f.openNow}">פתוח עכשיו</button>
       ${opts("סוג", "type", uniq(places.map((p) => p.type)))}
       ${opts("עיר", "city", uniq(places.map((p) => p.city)))}
       ${opts("סגנון", "cuisine", uniq(places.flatMap((p) => p.cuisine || [])))}
       ${opts("כשרות", "kosher", uniq(places.map((p) => p.kosher)))}
       ${opts("מחיר", "price", [1, 2, 3, 4], priceTxt)}
       ${opts("סטטוס", "status", uniq(places.map((p) => p.status)))}
     </div>
     <p class="status" id="count">${filtered.length} תוצאות${state.loc ? " · ממוין לפי מרחק" : ""}</p>
     <div id="results">${filtered.map((p) => card(p)).join("") || `<p class="status">לא נמצאו מקומות.</p>`}</div>`;
}

function applyFilters(places) {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  const out = places.filter((p) => {
    if (f.type && p.type !== f.type) return false;
    if (f.city && p.city !== f.city) return false;
    if (f.cuisine && !(p.cuisine || []).includes(f.cuisine)) return false;
    if (f.kosher && p.kosher !== f.kosher) return false;
    if (f.price && String(p.price) !== String(f.price)) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.openNow && !openState(p.hours).open) return false;
    if (q) {
      const hay = [p.name, p.name_en, p.city, p.neighborhood, p.address, p.type, ...(p.cuisine || []), ...(p.dishes || []), p.notes].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (state.loc) out.sort((a, b) => (distTo(a) ?? 9999) - (distTo(b) ?? 9999));
  return out;
}

// ----- Place page (F-07, F-09) -----
async function renderPlace(id) {
  const p = await byId(id);
  if (!p) return `<a class="back" href="#/list">→ חזרה לרשימה</a>${head("המקום לא נמצא")}`;
  const today = nowInIsrael().day;
  const hoursRows = hasHours(p.hours)
    ? DAY_NAMES.map((d, i) => `<tr class="${i === today ? "today" : ""}"><th>${d}</th><td>${esc(p.hours[String(i)] || "—")}</td></tr>`).join("")
    : "";
  const km = distTo(p);
  const links = [
    bookingButton(p),
    p.address || p.city ? `<a class="btn ghost" href="${mapsUrl(p)}" target="_blank" rel="noopener">מפה</a>` : "",
    p.address ? `<a class="btn ghost" href="${wazeUrl(p)}" target="_blank" rel="noopener">Waze</a>` : "",
    p.phone ? `<a class="btn ghost" href="tel:${esc(p.phone.replace(/[^\d+]/g, ""))}">חיוג</a>` : "",
    p.instagram ? `<a class="btn ghost" href="https://www.instagram.com/${encodeURIComponent(p.instagram)}/" target="_blank" rel="noopener">אינסטגרם</a>` : "",
    safeUrl(p.website) && p.website !== p.booking_url ? `<a class="btn ghost" href="${esc(p.website)}" target="_blank" rel="noopener">אתר</a>` : "",
  ].join("");
  const sources = (p.sources || []).filter((s) => safeUrl(s.url));
  return `<a class="back" href="#/list">→ חזרה לרשימה</a>
    <div class="screen-head place-head"><h2 dir="auto">${esc(p.name)}</h2>${p.name_en ? `<p class="en">${esc(p.name_en)}</p>` : ""}
      <p>${esc([p.type, (p.cuisine || []).join(", "), priceTxt(p.price)].filter(Boolean).join(" · "))}</p>
      <div class="row">${openBadge(p)}${km != null ? `<span class="badge muted">${geo.fmtKm(km)}</span>` : ""}<span class="badge muted">${esc(p.status)}</span>${p.kosher ? `<span class="badge muted">${esc(p.kosher)}</span>` : ""}</div>
    </div>
    ${p.needs_review ? `<div class="card notice">חסרים פרטים למקום הזה (כתובת או שעות).</div>` : ""}
    <section class="card"><h3>איפה</h3><p>${esc([p.address, p.neighborhood, p.city].filter(Boolean).join(", ") || "לא ידוע")}</p>
      ${p.phone ? `<p class="status">טלפון: ${esc(p.phone)}</p>` : ""}<div class="row">${links}</div></section>
    ${hoursRows ? `<section class="card"><h3>שעות פתיחה</h3><table class="hours">${hoursRows}</table>
      <p class="status">${esc([p.hours_source, p.hours_checked_at ? `נבדק ${p.hours_checked_at}` : ""].filter(Boolean).join(" · "))}</p></section>` : ""}
    ${(p.dishes || []).length ? `<section class="card"><h3>מה להזמין</h3><ul class="dishes">${p.dishes.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></section>` : ""}
    ${p.notes ? `<section class="card"><h3>הערות</h3><p>${esc(p.notes)}</p></section>` : ""}
    ${sources.length ? `<section class="card"><h3>מקור ההמלצה</h3>${sources.map((s) => `<p><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.caption || s.publisher || s.url)}</a></p>`).join("")}</section>` : ""}
    ${isOwner() ? `<div class="row"><a class="btn" href="#/edit/${encodeURIComponent(p.id)}">עריכה</a>
      <button class="btn ghost" data-action="add-to-outing" data-id="${esc(p.id)}">הוסף ליציאה</button></div>` : ""}`;
}

function bookingButton(p) {
  if (safeUrl(p.booking_url)) return `<a class="btn" href="${esc(p.booking_url)}" target="_blank" rel="noopener">הזמנת מקום</a>`;
  if (p.phone) return `<a class="btn" href="tel:${esc(p.phone.replace(/[^\d+]/g, ""))}">הזמנה בטלפון</a>`;
  if (safeUrl(p.website)) return `<a class="btn" href="${esc(p.website)}" target="_blank" rel="noopener">הזמנה באתר</a>`;
  return "";
}

// ----- Add / edit place -----
const TYPES = ["מסעדה", "בית קפה", "בר", "מאפייה", "אוכל רחוב", "אחר"];
const STATUSES = ["רוצה לנסות", "ביקרתי", "אהבתי", "לא אהבתי", "נסגר"];
const KOSHER = ["לא ידוע", "כשר", "לא כשר"];

async function renderAdd() {
  if (!isOwner()) return renderRecommend();
  const r = state.addResult;
  let banner = "";
  if (r) {
    const pct = Math.round((r.confidence || 0) * 100);
    banner = r.duplicate
      ? `<div class="card notice"><h3>המקום כבר ברשימה</h3><p><a href="#/place/${encodeURIComponent(r.duplicate.id)}">${esc(r.duplicate.name)}</a></p></div>`
      : `<div class="card ${pct >= 70 && r.found_on_google ? "ok-box" : "notice"}"><p><b>${r.draft?.name ? `זוהה: ${esc(r.draft.name)}` : "לא זיהיתי את המקום"}</b></p>
          <p class="status">${esc([`ביטחון ${pct}%`, r.found_on_google ? "נמצא ב-Google עם כתובת ושעות" : "לא נמצא ב-Google", r.source?.publisher ? `מקור: ${r.source.publisher}` : ""].filter(Boolean).join(" · "))}</p>
          ${r.maps_url ? `<p><a href="${esc(r.maps_url)}" target="_blank" rel="noopener">בדיקה בגוגל מפות</a></p>` : ""}
          <p class="status">בדוק את הפרטים למטה ולחץ ״הוספה לרשימה״.</p></div>`;
  }
  return head("הוספת מקום", "מדביקים קישור מאינסטגרם, טיקטוק, גוגל מפות או אתר, ומקבלים טיוטה ממולאת") +
    `<button class="btn paste-btn" type="button" data-action="paste-link">📋 הדבקה וזיהוי</button>
     <form id="link-form" class="request"><input class="field" name="url" type="url" inputmode="url" placeholder="או הדבק כאן קישור" aria-label="קישור" value="${esc(state.addUrl || "")}" required>
      <button class="btn ghost" type="submit">זיהוי</button></form><p class="status" id="link-status"></p>` +
    banner + (await renderPlaceForm(null, r ? { ...r.draft, source_url: r.source?.url || state.addUrl, extra: { source: r.source } } : null)) +
    `<p class="status"><a href="#/shortcut">שמירה ישר מתפריט השיתוף באייפון →</a></p>`;
}

async function renderPlaceForm(id, prefill = null) {
  const isNew = !id;
  const p = isNew ? { name: "", type: "מסעדה", cuisine: [], status: "רוצה לנסות", kosher: "לא ידוע", hours: {}, dishes: [], ...(prefill || {}) } : await byId(id);
  if (!p) return head("המקום לא נמצא");
  const input = (name, label, val, type = "text", extra = "") =>
    `<label class="lbl">${label}<input class="field" name="${name}" type="${type}" value="${esc(val ?? "")}" ${extra}></label>`;
  const select = (name, label, list, val) =>
    `<label class="lbl">${label}<select class="field" name="${name}">${uniq([...list, val]).map((v) => `<option ${v === val ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`;
  return `${isNew ? "" : `<a class="back" href="#/place/${encodeURIComponent(p.id)}">→ ביטול</a>${head(`עריכת ${p.name}`)}`}
  <form id="place-form" class="card form" data-id="${esc(p.id || "")}" data-suggestion="${esc(prefill?.suggestionId || "")}"
    data-extra="${esc(isNew ? JSON.stringify({ lat: p.lat ?? null, lng: p.lng ?? null, google_place_id: p.google_place_id || null, hours_source: p.hours_source || null, hours_checked_at: p.hours_checked_at || null, source: p.extra?.source || null }) : "")}">
    ${input("name", "שם *", p.name, "text", "required")}${input("name_en", "שם באנגלית", p.name_en)}
    ${select("type", "סוג", TYPES, p.type)}
    ${input("cuisine", "סגנון (מופרד בפסיקים)", (p.cuisine || []).join(", "))}
    ${input("address", "כתובת", p.address)}${input("neighborhood", "שכונה", p.neighborhood)}${input("city", "עיר", p.city)}
    ${input("phone", "טלפון", p.phone, "tel")}${input("instagram", "אינסטגרם", p.instagram)}
    ${input("website", "אתר", p.website, "url")}${input("booking_url", "קישור להזמנה (אונטופו, טאביט…)", p.booking_url, "url")}
    ${isNew ? input("source_url", "קישור למקור ההמלצה", p.source_url, "url") : ""}
    ${select("kosher", "כשרות", KOSHER, p.kosher || "לא ידוע")}
    <label class="lbl">מחיר<select class="field" name="price">${[0, 1, 2, 3, 4].map((v) => `<option value="${v}" ${Number(p.price || 0) === v ? "selected" : ""}>${v ? priceTxt(v) : "לא ידוע"}</option>`).join("")}</select></label>
    ${select("status", "סטטוס", STATUSES, p.status)}
    <fieldset class="hours-edit"><legend>שעות פתיחה (למשל 12:00-23:00, או סגור)</legend>
      ${DAY_NAMES.map((d, i) => `<label class="lbl inline">${d}<input class="field" name="h${i}" value="${esc(p.hours?.[String(i)] || "")}" dir="ltr"></label>`).join("")}
    </fieldset>
    ${input("dishes", "מנות מומלצות (מופרד בפסיקים)", (p.dishes || []).join(", "))}
    <label class="lbl">הערות<textarea class="field" name="notes" rows="3">${esc(p.notes)}</textarea></label>
    ${isNew ? "" : `<label class="lbl inline check"><input type="checkbox" name="needs_review" ${p.needs_review ? "checked" : ""}> חסרים פרטים</label>`}
    <div class="row"><button class="btn" type="submit">${isNew ? "הוספה לרשימה" : "שמירה"}</button>
      ${isNew ? "" : `<button class="btn ghost danger" type="button" data-action="delete" data-id="${esc(p.id)}">מחיקה</button>`}</div>
    <p class="status" id="form-status"></p>
  </form>`;
}

// ----- Friend: recommend (F-11) -----
async function renderRecommend() {
  const mine = await db.mySuggestions(myEmail()).catch(() => []);
  const label = { pending: "ממתין לאישור", approved: "נוסף לרשימה", rejected: "לא נוסף" };
  return head("המלצה על מקום", "שלח לאילן מקום שאהבת. הוא יאשר ויוסיף לרשימה.") +
    `<form id="recommend-form" class="card form">
      <label class="lbl">שם המקום *<input class="field" name="name" required></label>
      <label class="lbl">עיר<input class="field" name="city"></label>
      <label class="lbl">קישור (אינסטגרם, טיקטוק, גוגל מפות, אתר)<input class="field" name="url" type="url" inputmode="url"></label>
      <button class="btn ghost" type="button" data-action="recommend-fill">מילוי אוטומטי מהקישור</button>
      <label class="lbl">למה כדאי?<textarea class="field" name="note" rows="3"></textarea></label>
      <div class="row"><button class="btn" type="submit">שליחה</button></div><p class="status" id="form-status"></p>
    </form>` +
    (mine.length ? `<h3 class="section-title">ההמלצות שלי</h3>${mine.map((s) => `<div class="card"><b>${esc(s.payload?.name)}</b> <span class="badge muted">${label[s.status]}</span></div>`).join("")}` : "");
}

// ----- Inbox (F-11) -----
async function renderInbox() {
  const [items, members] = await Promise.all([db.listSuggestions("pending"), db.listMembers()]);
  const nameOf = (email) => members.find((m) => m.email === email)?.name || email.split("@")[0];
  return head("תיבת אישור", items.length ? `${items.length} ממתינות` : "אין המלצות שממתינות") +
    items.map((s) => `<section class="card">
      <h3 dir="auto">${esc(s.payload?.name || "ללא שם")}</h3>
      <p class="status">${esc([s.payload?.city, s.origin === "share" ? "" : `מאת ${nameOf(s.suggested_by)}`, new Date(s.created_at).toLocaleDateString("he-IL")].filter(Boolean).join(" · "))}</p>
      ${s.origin === "share" ? `<p class="status">נשמר מהאייפון · ביטחון ${Math.round((s.confidence || 0) * 100)}%${s.payload?.address ? ` · ${esc(s.payload.address)}` : ""}</p>` : ""}
      ${s.payload?.source?.caption ? `<p class="caption">${esc(s.payload.source.caption.slice(0, 200))}</p>` : ""}
      ${s.payload?.note ? `<p>${esc(s.payload.note)}</p>` : ""}
      ${safeUrl(s.url) ? `<p><a href="${esc(s.url)}" target="_blank" rel="noopener">קישור</a></p>` : ""}
      <div class="row"><button class="btn" data-action="approve" data-id="${esc(s.id)}">אישור והוספה</button>
        <button class="btn ghost" data-action="reject" data-id="${esc(s.id)}">דחייה</button></div>
    </section>`).join("") +
    ph("גילוי ממשפיענים וכתבות", "פעם בשבוע: עומר זיצר, נדב בורנשטיין, Lin Levy, גיל הראל וכתבות אוכל.", "Should", "F-12");
}

// ----- Outings (F-08, F-09) -----
async function renderOutings() {
  const [outings, places] = await Promise.all([db.listOutings(), getPlaces()]);
  const name = (id) => places.find((p) => p.id === id)?.name || "מקום שנמחק";
  const item = (o) => `<a class="card place-card" href="#/outing/${o.id}">
      <div class="pc-top"><h3 dir="auto">${esc(o.title)}</h3><span class="badge ${o.status === "open" ? "open" : "muted"}">${o.status === "open" ? "הצבעה פתוחה" : "נסגרה"}</span></div>
      <div class="pc-meta">${esc(fmtDate(o.starts_at))}</div>
      <p class="status">${o.chosen_place_id ? `נבחר: <b>${esc(name(o.chosen_place_id))}</b>` : esc(o.place_ids.map(name).join(" · "))}</p></a>`;
  const open = outings.filter((o) => o.status === "open"), closed = outings.filter((o) => o.status !== "open");
  return head("יציאות", "בוחרים 2–5 מקומות, החברים מצביעים, ואז הזמנה ויומן") +
    (isOwner() ? `<div class="row" style="margin-bottom:12px"><a class="btn" href="#/new-outing">יציאה חדשה</a></div>` : "") +
    (open.length ? open.map(item).join("") : `<p class="status">אין יציאות פתוחות.</p>`) +
    (closed.length ? `<h3 class="section-title">קודמות</h3>${closed.map(item).join("")}` : "");
}

async function renderNewOuting() {
  const places = await getPlaces();
  const d = state.draftOuting;
  const chosen = d.place_ids.map((id) => places.find((p) => p.id === id)).filter(Boolean);
  const q = (state.outingQ || "").trim().toLowerCase();
  const pool = places.filter((p) => !d.place_ids.includes(p.id) && p.status !== "נסגר" && (!q || [p.name, p.name_en, p.city, ...(p.cuisine || [])].join(" ").toLowerCase().includes(q)))
    .sort((a, b) => (distTo(a) ?? 9999) - (distTo(b) ?? 9999)).slice(0, 25);
  return `<a class="back" href="#/outings">→ ביטול</a>` + head("יציאה חדשה", "בוחרים 2–5 מקומות ושולחים לחברים להצבעה") +
    `<form id="outing-form" class="card form">
      <label class="lbl">כותרת *<input class="field" name="title" required value="${esc(d.title)}" placeholder="ארוחת ערב עם החבר׳ה"></label>
      <label class="lbl">מתי<input class="field" name="starts_at" type="datetime-local" value="${esc(d.starts_at)}"></label>
      <h3>המקומות (${chosen.length}/5)</h3>
      ${chosen.length ? `<ul class="chosen">${chosen.map((p) => `<li><span dir="auto">${esc(p.name)}</span><button type="button" class="chip" data-action="outing-remove" data-id="${esc(p.id)}">הסרה</button></li>`).join("")}</ul>` : `<p class="status">עוד לא נבחרו מקומות.</p>`}
      <div class="row"><button class="btn" type="submit" ${chosen.length < 2 ? "disabled" : ""}>יצירה ושיתוף</button></div>
      <p class="status" id="form-status">${chosen.length < 2 ? "צריך לפחות 2 מקומות." : ""}</p>
    </form>
    ${chosen.length < 5 ? `<h3 class="section-title">הוספת מקום</h3>
    <input class="field" id="outing-q" type="search" placeholder="חיפוש מקום" value="${esc(state.outingQ || "")}">
    <div class="pick-list">${pool.map((p) => `<button class="pick" data-action="outing-add" data-id="${esc(p.id)}">
      <span><b dir="auto">${esc(p.name)}</b><small>${esc([p.type, p.city].filter(Boolean).join(" · "))}${distTo(p) != null ? ` · ${geo.fmtKm(distTo(p))}` : ""}</small></span><span class="plus">+</span></button>`).join("")}</div>` : ""}`;
}

async function renderOuting(id) {
  const [o, places] = await Promise.all([db.getOuting(id), getPlaces()]);
  if (!o) return head("היציאה לא נמצאה", "ייתכן שנמחקה, או שאין לך גישה אליה.");
  const [t, mine] = await Promise.all([db.tally(id), db.myVote(id, myEmail())]);
  const votes = (pid) => t.find((x) => x.place_id === pid) || { votes: 0, voters: [] };
  const total = t.reduce((s, x) => s + x.votes, 0);
  const lead = [...o.place_ids].sort((a, b) => votes(b).votes - votes(a).votes)[0];
  const chosen = o.chosen_place_id ? places.find((p) => p.id === o.chosen_place_id) : null;
  const rows = o.place_ids.map((pid) => {
    const p = places.find((x) => x.id === pid); if (!p) return "";
    const v = votes(pid), pct = total ? Math.round((v.votes / total) * 100) : 0;
    return `<section class="card vote-card ${mine === pid ? "mine" : ""} ${o.chosen_place_id === pid ? "winner" : ""}">
      <div class="pc-top"><h3 dir="auto"><a href="#/place/${encodeURIComponent(p.id)}">${esc(p.name)}</a></h3><span class="votes">${v.votes} קולות</span></div>
      <div class="pc-meta">${esc([p.type, (p.cuisine || []).join(", "), p.city, priceTxt(p.price)].filter(Boolean).join(" · "))}</div>
      <div class="bar"><span style="width:${pct}%"></span></div>
      ${v.voters.length ? `<p class="status">${esc(v.voters.join(", "))}</p>` : ""}
      ${o.status === "open" ? `<button class="btn ${mine === pid ? "" : "ghost"}" data-action="vote" data-outing="${esc(o.id)}" data-id="${esc(pid)}">${mine === pid ? "ההצבעה שלך ✓" : "הצבעה"}</button>` : ""}
      ${isOwner() && o.status === "open" ? `<button class="btn ghost" data-action="choose" data-outing="${esc(o.id)}" data-id="${esc(pid)}">לבחור את זה</button>` : ""}
    </section>`;
  }).join("");
  return `<a class="back" href="#/outings">→ יציאות</a>` + head(o.title, [fmtDate(o.starts_at), o.status === "open" ? "ההצבעה פתוחה" : "ההצבעה נסגרה"].filter(Boolean).join(" · ")) +
    (chosen ? `<section class="card notice"><h3>נבחר: <span dir="auto">${esc(chosen.name)}</span></h3>
        <div class="row">${bookingButton(chosen)}${o.starts_at ? `<a class="btn ghost" href="${calendarUrl(o, chosen)}" target="_blank" rel="noopener">הוספה ליומן</a>` : ""}
        <a class="btn ghost" href="${wazeUrl(chosen)}" target="_blank" rel="noopener">Waze</a></div></section>` : "") +
    (isOwner() ? `<div class="row" style="margin-bottom:12px">
        <button class="btn" data-action="share-outing" data-id="${esc(o.id)}">שיתוף לחברים</button>
        ${o.status === "open" ? `<button class="btn ghost" data-action="close-outing" data-id="${esc(o.id)}" data-lead="${esc(lead || "")}" ${total ? "" : "disabled"}>סגירה ובחירת המוביל</button>`
          : `<button class="btn ghost" data-action="reopen-outing" data-id="${esc(o.id)}">פתיחה מחדש</button>`}
        <button class="btn ghost danger" data-action="delete-outing" data-id="${esc(o.id)}">מחיקה</button></div>` : "") +
    `<p class="status">${total} הצביעו${o.status === "open" ? " · מתעדכן בזמן אמת" : ""}</p>` + rows;
}

function calendarUrl(o, p) {
  const start = new Date(o.starts_at), end = new Date(start.getTime() + 2 * 3600 * 1000);
  const f = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE", text: `${o.title} – ${p.name}`, dates: `${f(start)}/${f(end)}`,
    location: [p.name, p.address, p.city].filter(Boolean).join(", "),
    details: [p.phone ? `טלפון: ${p.phone}` : "", appUrl(`#/outing/${o.id}`)].filter(Boolean).join("\n"),
    ctz: "Asia/Jerusalem",
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

// ----- Area planning (F-10) -----
async function renderArea() {
  const places = await getPlaces();
  const a = state.area;
  const cities = uniq(places.filter((p) => p.lat != null).map((p) => p.city));
  const center = a.center;
  const inRange = center ? places.map((p) => ({ p, km: geo.distanceKm(center, p) })).filter((x) => x.km != null && x.km <= a.radius).sort((x, y) => x.km - y.km) : [];
  const noCoords = places.filter((p) => p.lat == null).length;
  return head("תכנון לפי אזור", "בוחרים עיר או כתובת ורדיוס, ורואים את המקומות השמורים בסביבה") +
    `<form id="area-form" class="card form area">
      <label class="lbl">עיר<select class="field" name="city"><option value="">—</option>${cities.map((c) => `<option ${center?.label === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
      <label class="lbl">או כתובת / מקום<input class="field" name="address" placeholder="למשל: נמל יפו" value="${esc(center && !cities.includes(center.label) ? center.label : "")}"></label>
      <label class="lbl">רדיוס<select class="field" name="radius">${[1, 2, 5, 10, 25].map((r) => `<option value="${r}" ${a.radius === r ? "selected" : ""}>${r} ק״מ</option>`).join("")}</select></label>
      <div class="row"><button class="btn" type="submit">הצג</button><button class="btn ghost" type="button" data-action="area-here">סביבי</button></div>
      <p class="status" id="form-status"></p>
    </form>` +
    (center ? `<h3 class="section-title">${inRange.length} מקומות ברדיוס ${a.radius} ק״מ מ${esc(center.label)}</h3>` +
      inRange.map((x) => card(x.p, `<p class="reason">${geo.fmtKm(x.km)} מהנקודה</p>`)).join("") : "") +
    (noCoords ? `<p class="status">${noCoords} מקומות בלי מיקום מדויק לא מופיעים כאן.</p>` : "") +
    ph("תצוגת מפה", "כל המקומות על מפה עם אותם סינונים כמו ברשימה.", "Should", "F-14");
}

// ----- Settings (F-11 friends) -----
async function renderSettings() {
  const members = isOwner() ? await db.listMembers().catch(() => []) : [];
  const friends = members.filter((m) => m.role === "friend");
  return head("הגדרות", isOwner() ? "חברים, מיקום וייצוא" : "חשבון ומיקום") +
    `<section class="card"><h3>חשבון</h3><p>${esc(state.session?.user?.email || "")} · ${isOwner() ? "בעלים" : "חבר"}</p>
       <div class="row"><button class="btn ghost" data-action="switch">החלפת חשבון</button><button class="btn ghost" data-action="refresh">רענון נתונים</button><button class="btn ghost" data-action="signout">התנתקות</button></div></section>` +
    (isOwner() ? `<section class="card"><h3>חברים (${friends.length}/10)</h3>
       <p class="status">חבר מוזמן נכנס עם חשבון ה-Google שלו, רואה את הרשימה, ממליץ ומצביע ביציאות. הוא לא יכול לערוך.</p>
       ${friends.map((m) => `<div class="member"><span><b>${esc(m.name || m.email.split("@")[0])}</b><small dir="ltr">${esc(m.email)}</small></span>
          <button class="chip" data-action="remove-member" data-email="${esc(m.email)}">הסרה</button></div>`).join("")}
       ${friends.length < 10 ? `<form id="member-form" class="form inline-form">
          <input class="field" name="name" placeholder="שם">
          <input class="field" name="email" type="email" placeholder="כתובת Gmail" required dir="ltr">
          <button class="btn" type="submit">הזמנה</button></form><p class="status" id="member-status"></p>` : ""}
       ${friends.length ? `<button class="btn ghost" data-action="share-app">שליחת קישור לאפליקציה</button>` : ""}
     </section>` : "") +
    (isOwner() ? `<section class="card"><h3>קיצור דרך לאייפון</h3>
      <p class="status">מפתח אישי שמאפשר לשמור מקום ישר מתפריט השיתוף. מוצג פעם אחת בלבד.</p>
      ${state.newKey ? `<div class="keybox"><code dir="ltr" id="new-key">${esc(state.newKey)}</code>
        <button class="btn" data-action="copy-key">העתקה</button></div><p class="status">העתק עכשיו והדבק בקיצור הדרך. אחרי שתצא מהמסך לא אפשר יהיה לראות אותו שוב.</p>` : ""}
      ${(await db.listShortcutKeys().catch(() => [])).filter((k) => !k.revoked).map((k) => `<div class="member"><span><b>${esc(k.label || "מפתח")}</b>
        <small>נוצר ${new Date(k.created_at).toLocaleDateString("he-IL")}${k.last_used_at ? ` · שימוש אחרון ${new Date(k.last_used_at).toLocaleDateString("he-IL")}` : " · עוד לא בשימוש"}</small></span>
        <button class="chip" data-action="revoke-key" data-id="${esc(k.id)}">ביטול</button></div>`).join("")}
      <div class="row"><button class="btn ghost" data-action="new-key">יצירת מפתח חדש</button><a class="btn ghost" href="#/shortcut">איך מגדירים</a></div>
    </section>` : "") +
    `<section class="card"><h3>מיקום</h3><p class="status">המיקום נשמר רק בטלפון ולא נשלח לשרת.</p>
      <p>${state.loc ? esc(state.loc.source === "gps" ? "המיקום שלך" : `אזור: ${state.loc.label}`) : "לא נקבע"}</p>
      ${state.loc ? `<button class="btn ghost" data-action="clear-loc">איפוס מיקום</button>` : ""}</section>` +
    `<section class="card"><h3>חיבור לשרת</h3><div id="conn" class="status">בודק…</div></section>` +
    (isOwner() ? `<section class="card"><h3>ייצוא</h3><p class="status">כל המקומות כקובץ JSON.</p><button class="btn ghost" data-action="export">ייצוא JSON</button></section>` : "") +
    `<p class="status">גרסה ${esc(cfg.version || "")}</p>`;
}

// ----- iPhone Shortcut setup (F-03) -----
function renderShortcutHelp() {
  const endpoint = `${cfg.supabaseUrl}/functions/v1/resolve-place`;
  const step = (n, t, body) => `<li class="card"><span class="rank">${n}</span><div><h3>${t}</h3>${body}</div></li>`;
  const code = (v) => `<div class="keybox"><code dir="ltr">${esc(v)}</code><button class="btn ghost" data-action="copy" data-value="${esc(v)}">העתקה</button></div>`;
  return `<a class="back" href="#/settings">→ הגדרות</a>` + head("שמירה מתפריט השיתוף", "קיצור דרך פעם אחת, ואחר כך כל ריל או פוסט נשמר בשתי לחיצות") +
    `<ol class="steps">
      ${step(1, "מפתח אישי", `<p>בהגדרות → ״קיצור דרך לאייפון״ → ״יצירת מפתח חדש״, והעתק אותו.</p>`)}
      ${step(2, "קיצור חדש", `<p>באפליקציית <b>קיצורים</b> לוחצים +. בהגדרות הקיצור (סמל ⓘ) מסמנים <b>הצג בגיליון השיתוף</b>, ובסוגי הקלט משאירים רק <b>כתובות URL</b> ו<b>טקסט</b>. שם: <b>שמור ל-Spots</b>.</p>`)}
      ${step(3, "פעולה: קבלת תוכן מכתובת URL", `<p>מוסיפים את הפעולה <b>קבל תוכן של כתובת URL</b> (Get Contents of URL) עם הכתובת:</p>${code(endpoint)}
        <p>שיטה: <b>POST</b>. כותרות (Headers):</p>
        <p><code dir="ltr">x-spots-key</code> = המפתח האישי</p><p><code dir="ltr">apikey</code> =</p>${code(cfg.supabaseAnonKey)}
        <p>גוף הבקשה: <b>JSON</b>, עם שני שדות: <code dir="ltr">url</code> (טקסט) = <b>קלט קיצור הדרך</b>, ו-<code dir="ltr">save</code> (בוליאני) = <b>אמת</b>.</p>`)}
      ${step(4, "הודעה", `<p>מוסיפים <b>קבל ערך מילון</b> (Get Dictionary Value) עבור המפתח <code dir="ltr">message</code>, ואחריו <b>הצג התראה</b> עם הערך.</p>`)}
      ${step(5, "שימוש", `<p>באינסטגרם, טיקטוק או גוגל מפות: <b>שיתוף → שמור ל-Spots</b>. אחרי כמה שניות תופיע הודעה: ״נשמר״, ״כבר ברשימה״ או ״נשמר בתיבת האישור״ כשהזיהוי לא בטוח.</p>`)}
    </ol>`;
}

// ---------- router ----------
function parse() {
  const [name, ...rest] = (location.hash.replace(/^#\/?/, "") || "now").split("/");
  return { name: screens[name] ? name : "now", arg: rest.length ? decodeURIComponent(rest.join("/")) : "" };
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const { name, arg } = parse();
  const s = screens[name];
  stopWatching();
  document.body.classList.toggle("signed-out", !state.member);
  document.body.classList.toggle("is-owner", isOwner());
  let html;
  try {
    if (!db.configured || !state.session) html = renderSignIn(state.authError);
    else if (!state.member) html = renderNoAccess();
    else if (s.owner && !isOwner()) html = head("אין הרשאה", "המסך הזה זמין רק לבעלים.");
    else html = await s.render(arg);
  } catch (e) {
    console.error(e);
    html = head("משהו השתבש") + `<p class="status error">${esc(e.message || e)}</p><button class="btn ghost" data-action="refresh">ניסיון נוסף</button>`;
  }
  if (seq !== renderSeq) return;
  view.innerHTML = html;
  document.title = `${s.title} · Spots`;
  const navName = { place: "list", edit: "list", vote: "outings", outing: "outings", "new-outing": "outings" }[name] || name;
  document.querySelectorAll("[data-route]").forEach((a) =>
    a.dataset.route === navName ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  if (name === "settings" && state.member) checkConnection();
  if ((name === "outing" || name === "vote") && state.member && arg) startWatching(arg);
}

function startWatching(id) {
  const refresh = async () => {
    if (parse().arg !== id) return;
    const y = window.scrollY; await render(); window.scrollTo(0, y);
  };
  try { state.unwatch = db.watchOuting(id, refresh); } catch {}
  state.poll = setInterval(refresh, 10000); // friends only receive their own vote events (RLS), so poll the tally too
}
function stopWatching() {
  if (state.unwatch) { state.unwatch(); state.unwatch = null; }
  if (state.poll) { clearInterval(state.poll); state.poll = null; }
}

async function checkConnection() {
  const el = document.getElementById("conn");
  if (!el) return;
  try {
    const r = await fetch(`${cfg.supabaseUrl}/auth/v1/health`, { headers: { apikey: cfg.supabaseAnonKey } });
    el.innerHTML = r.ok ? `<span class="ok">מחובר ל-Supabase ✓</span>` : `שגיאת חיבור (${r.status})`;
  } catch { el.textContent = "אין חיבור לשרת כרגע. מוצגים נתונים שמורים."; }
}

// Paste-and-recognise: one tap. Also used when a link is pasted or typed into the field.
let recognizing = false;
async function recognize(raw) {
  const url = String(raw || "").match(/https?:\/\/\S+/)?.[0];
  const st = document.getElementById("link-status");
  if (!url) { if (st) st.textContent = "לא מצאתי קישור. העתק קישור (שיתוף → העתקת קישור) ונסה שוב."; return; }
  if (recognizing) return;
  recognizing = true;
  state.addUrl = url;
  const f = document.getElementById("link-form"); if (f) f.elements.url.value = url;
  document.querySelectorAll('[data-action="paste-link"], #link-form button').forEach((b) => (b.disabled = true));
  if (st) st.textContent = "מזהה את המקום… (עד 15 שניות)";
  try { state.addResult = await db.resolveLink(url); recognizing = false; render(); }
  catch (err) {
    recognizing = false;
    if (st) st.textContent = `הזיהוי נכשל: ${err.message}`;
    document.querySelectorAll('[data-action="paste-link"], #link-form button').forEach((b) => (b.disabled = false));
  }
}

async function copyText(v) {
  try { await navigator.clipboard.writeText(v); } catch { prompt("העתק:", v); }
}

async function shareLink(url, text) {
  if (navigator.share) { try { await navigator.share({ title: "Spots", text, url }); return "shared"; } catch { return "cancelled"; } }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); return "copied"; } catch { prompt("העתק את הקישור:", url); return "prompted"; }
}

// ---------- events ----------
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-action],[data-toggle],#google-btn");
  if (!t) return;
  if (t.id === "google-btn") {
    try { await db.signInWithGoogle(); } catch (err) { state.authError = err.message; render(); }
    return;
  }
  if (t.dataset.toggle) { state.filters[t.dataset.toggle] = !state.filters[t.dataset.toggle]; render(); return; }
  const a = t.dataset.action, id = t.dataset.id;
  try {
    switch (a) {
      case "signout": await db.signOut(); state.session = null; state.member = null; location.hash = "#/now"; render(); break;
      case "switch": await db.switchAccount(); break;
      case "refresh": await db.loadPlaces({ force: true }); render(); break;
      case "clear-filters": Object.assign(state.filters, { type: "", city: "", cuisine: "", kosher: "", price: "", status: "", openNow: false }); render(); break;
      case "export": exportJson(); break;
      case "locate":
        t.disabled = true; t.textContent = "מאתר…";
        try { state.loc = await geo.locate(); state.locError = null; } catch (err) { state.locError = err.message; }
        state.offset = 0; render(); break;
      case "clear-loc": geo.clearLocation(); state.loc = null; render(); break;
      case "more": state.offset += 3; render(); break;
      case "delete": {
        const p = await byId(id);
        if (p && confirm(`למחוק את ${p.name}? אי אפשר לבטל.`)) { await db.deletePlace(p.id); location.hash = "#/list"; }
        break;
      }
      case "add-to-outing":
        if (!state.draftOuting.place_ids.includes(id) && state.draftOuting.place_ids.length < 5) state.draftOuting.place_ids.push(id);
        location.hash = "#/new-outing"; break;
      case "outing-add":
        if (state.draftOuting.place_ids.length < 5) state.draftOuting.place_ids.push(id);
        keepOutingForm(); render(); break;
      case "outing-remove":
        state.draftOuting.place_ids = state.draftOuting.place_ids.filter((x) => x !== id); keepOutingForm(); render(); break;
      case "vote": await db.castVote(t.dataset.outing, id); render(); break;
      case "choose": await db.updateOuting(t.dataset.outing, { chosen_place_id: id, status: "closed" }); render(); break;
      case "close-outing": await db.updateOuting(id, { chosen_place_id: t.dataset.lead || null, status: "closed" }); render(); break;
      case "reopen-outing": await db.updateOuting(id, { status: "open", chosen_place_id: null }); render(); break;
      case "delete-outing": if (confirm("למחוק את היציאה?")) { await db.deleteOuting(id); location.hash = "#/outings"; } break;
      case "share-outing": {
        const o = await db.getOuting(id);
        const r = await shareLink(appUrl(`#/outing/${id}`), `הצבעה: ${o.title}${o.starts_at ? ` (${fmtDate(o.starts_at)})` : ""} – איפה יוצאים?`);
        if (r === "copied") alert("הקישור הועתק. אפשר להדביק בוואטסאפ.");
        break;
      }
      case "share-app": {
        const r = await shareLink(appUrl("#/list"), "הזמנתי אותך ל-Spots, רשימת המסעדות ובתי הקפה שלי. נכנסים עם Google.");
        if (r === "copied") alert("הקישור הועתק.");
        break;
      }
      case "remove-member": if (confirm(`להסיר את ${t.dataset.email}?`)) { await db.removeMember(t.dataset.email); render(); } break;
      case "reject": await db.decideSuggestion(id, "rejected"); render(); break;
      case "paste-link": {
        let text = "";
        try { text = await navigator.clipboard.readText(); }
        catch { const i = document.querySelector("#link-form [name=url]"); i?.focus(); document.getElementById("link-status").textContent = "אין גישה ללוח. הדבק בשדה למטה, והזיהוי יתחיל לבד."; break; }
        await recognize(text); break;
      }
      case "new-key": state.newKey = await db.createShortcutKey("iPhone"); render(); break;
      case "revoke-key": if (confirm("לבטל את המפתח? קיצור הדרך שמשתמש בו יפסיק לעבוד.")) { await db.revokeShortcutKey(id); render(); } break;
      case "copy-key": await copyText(state.newKey); t.textContent = "הועתק ✓"; break;
      case "copy": await copyText(t.dataset.value); t.textContent = "הועתק ✓"; break;
      case "recommend-fill": {
        const f = document.getElementById("recommend-form"), st = document.getElementById("form-status");
        const url = f.elements.url.value.trim(); if (!url) { st.textContent = "הדבק קישור קודם."; break; }
        st.textContent = "מזהה…"; t.disabled = true;
        try { const r = await db.resolveLink(url); if (r.draft?.name) f.elements.name.value = r.draft.name; if (r.draft?.city) f.elements.city.value = r.draft.city;
          st.textContent = r.duplicate ? `המקום כבר ברשימה: ${r.duplicate.name}` : r.draft?.name ? "מולא אוטומטית. בדוק ושלח." : "לא זיהיתי, אפשר למלא ידנית."; }
        catch (err) { st.textContent = `הזיהוי נכשל: ${err.message}`; }
        t.disabled = false; break;
      }
      case "approve": {
        const s = (await db.listSuggestions("pending")).find((x) => x.id === id);
        if (!s) break;
        view.innerHTML = `<a class="back" href="#/inbox">→ ביטול</a>${head("אישור המלצה", "משלימים פרטים ומוסיפים לרשימה")}` +
          (await renderPlaceForm(null, { ...(s.origin === "share" ? s.payload : {}), name: s.payload?.name || "", city: s.payload?.city || "", notes: s.payload?.note || s.payload?.notes || "", source_url: s.url || "", suggestionId: s.id, extra: { source: s.payload?.source || null } }));
        window.scrollTo(0, 0);
        break;
      }
      case "area-here":
        try { const loc = await geo.locate(); state.loc = loc; state.area.center = { lat: loc.lat, lng: loc.lng, label: "המיקום שלך" }; }
        catch (err) { document.getElementById("form-status").textContent = err.message; return; }
        render(); break;
    }
  } catch (err) {
    console.error(err);
    alert(`הפעולה נכשלה: ${err.message || err}`);
  }
});

function keepOutingForm() {
  const f = document.getElementById("outing-form");
  if (f) { state.draftOuting.title = f.elements.title.value; state.draftOuting.starts_at = f.elements.starts_at.value; }
  const q = document.getElementById("outing-q"); if (q) state.outingQ = q.value;
}

document.addEventListener("change", async (e) => {
  const sel = e.target.closest("[data-filter]");
  if (sel) { state.filters[sel.dataset.filter] = sel.value; render(); return; }
  if (e.target.dataset.actionChange === "area-city" && e.target.value) {
    const c = geo.cityCenter(await getPlaces(), e.target.value);
    if (c) { state.loc = geo.saveLocation({ ...c, label: e.target.value, source: "area" }); state.locError = null; state.offset = 0; render(); }
  }
});

document.addEventListener("input", (e) => {
  if (e.target.closest("#link-form") && e.target.name === "url" && /^https?:\/\/\S+\.\S+/.test(e.target.value.trim())) {
    clearTimeout(state.linkTimer); state.linkTimer = setTimeout(() => recognize(e.target.value), 400);
  }
  if (e.target.id === "q") {
    state.filters.q = e.target.value;
    const results = applyFilters(db.cachedPlaces() || []);
    document.getElementById("results").innerHTML = results.map((p) => card(p)).join("") || `<p class="status">לא נמצאו מקומות.</p>`;
    document.getElementById("count").textContent = `${results.length} תוצאות`;
  }
  if (e.target.id === "outing-q") {
    clearTimeout(state.qTimer);
    state.qTimer = setTimeout(async () => { keepOutingForm(); await render(); const q = document.getElementById("outing-q"); q?.focus(); q?.setSelectionRange(q.value.length, q.value.length); }, 300);
  }
});

document.addEventListener("submit", async (e) => {
  const form = e.target;
  e.preventDefault();
  const status = form.querySelector("#form-status, #member-status");
  const say = (m) => { if (status) status.textContent = m; };
  try {
    if (form.id === "request-form") { state.request = form.elements.request.value; state.offset = 0; render(); return; }
    if (form.id === "place-form") return await submitPlace(form, say);
    if (form.id === "link-form") return recognize(form.elements.url.value);
    if (form.id === "recommend-form") {
      const f = new FormData(form);
      say("שולח…");
      await db.addSuggestion({ name: String(f.get("name")).trim(), city: String(f.get("city") || "").trim(), url: String(f.get("url") || "").trim(), note: String(f.get("note") || "").trim() });
      form.reset(); render(); return;
    }
    if (form.id === "member-form") {
      const f = new FormData(form);
      say("מוסיף…");
      await db.addMember(String(f.get("email")), String(f.get("name") || ""));
      render(); return;
    }
    if (form.id === "outing-form") {
      keepOutingForm();
      const d = state.draftOuting;
      if (d.place_ids.length < 2) return say("צריך לפחות 2 מקומות.");
      say("יוצר…");
      const o = await db.createOuting({ title: d.title.trim(), starts_at: d.starts_at ? new Date(d.starts_at).toISOString() : null, place_ids: d.place_ids });
      state.draftOuting = { title: "", starts_at: "", place_ids: [] }; state.outingQ = "";
      location.hash = `#/outing/${o.id}`; return;
    }
    if (form.id === "area-form") {
      const f = new FormData(form);
      state.area.radius = Number(f.get("radius")) || 5;
      const city = String(f.get("city") || ""), addr = String(f.get("address") || "").trim();
      say("מחפש…");
      if (addr) state.area.center = await geo.geocode(addr);
      else if (city) state.area.center = { ...geo.cityCenter(await getPlaces(), city), label: city };
      else return say("בחר עיר או כתוב כתובת.");
      render(); return;
    }
  } catch (err) { say(`נכשל: ${err.message || err}`); }
});

async function submitPlace(form, say) {
  const f = new FormData(form);
  const list = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
  const hours = {};
  DAY_NAMES.forEach((_, i) => { const v = String(f.get(`h${i}`) || "").trim(); if (v) hours[String(i)] = v; });
  const nz = (v) => (String(v || "").trim() || null);
  const row = {
    name: String(f.get("name")).trim(), name_en: nz(f.get("name_en")), type: f.get("type"), cuisine: list(f.get("cuisine")),
    address: nz(f.get("address")), neighborhood: nz(f.get("neighborhood")), city: nz(f.get("city")),
    phone: nz(f.get("phone")), instagram: nz(f.get("instagram"))?.replace(/^@/, "") || null, website: nz(f.get("website")), booking_url: nz(f.get("booking_url")),
    kosher: f.get("kosher"), price: Number(f.get("price")) || null, status: f.get("status"), hours,
    dishes: list(f.get("dishes")), notes: nz(f.get("notes")),
  };
  if (!row.name) return say("חסר שם.");
  say("שומר…");
  if (form.dataset.id) {
    row.needs_review = f.get("needs_review") === "on";
    await db.savePlace(form.dataset.id, row);
    location.hash = `#/place/${encodeURIComponent(form.dataset.id)}`;
    return;
  }
  // new place (manual add, recognised link or approved recommendation)
  let extra = {}; try { extra = JSON.parse(form.dataset.extra || "{}"); } catch {}
  row.id = db.newPlaceId(row.name, row.name_en);
  row.needs_review = !row.address || !Object.keys(hours).length;
  if (extra.google_place_id) row.google_place_id = extra.google_place_id;
  if (extra.hours_source && Object.keys(hours).length) { row.hours_source = extra.hours_source; row.hours_checked_at = extra.hours_checked_at; }
  if (extra.lat != null) { row.lat = extra.lat; row.lng = extra.lng; }
  else if (row.address) { try { const g = await geo.geocode([row.address, row.city].filter(Boolean).join(", ")); row.lat = g.lat; row.lng = g.lng; } catch {} }
  const srcUrl = nz(f.get("source_url"));
  const src = srcUrl ? { url: srcUrl, platform: extra.source?.platform || (/instagram/.test(srcUrl) ? "instagram" : /tiktok/.test(srcUrl) ? "tiktok" : "web"), publisher: extra.source?.publisher || null, caption: extra.source?.caption || null } : null;
  const created = await db.createPlace(row, src);
  state.addResult = null; state.addUrl = "";
  if (form.dataset.suggestion) await db.decideSuggestion(form.dataset.suggestion, "approved", created.id);
  await db.loadPlaces({ force: true });
  location.hash = `#/place/${encodeURIComponent(created.id)}`;
}

async function exportJson() {
  const rows = await db.loadPlaces({ force: true });
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `spots-${new Date().toISOString().slice(0, 10)}.json` });
  a.click(); URL.revokeObjectURL(a.href);
}

// ---------- boot ----------
const RETURN_KEY = "spots.return";
async function boot() {
  // Keep the screen a shared link pointed to (e.g. #/outing/…) across the Google sign-in round trip.
  if (location.search.includes("code=")) {
    const back = sessionStorage.getItem(RETURN_KEY);
    if (back) history.replaceState(null, "", location.pathname + location.search + back);
  }
  if (!location.hash) history.replaceState(null, "", location.pathname + location.search + "#/now");
  if (db.configured) {
    try {
      state.session = await db.getSession();
      if (state.session) state.member = await db.getMembership(state.session.user.email);
    } catch (e) { state.authError = e.message; }
    db.supabase.auth.onAuthStateChange(async (evt, session) => {
      if (evt === "SIGNED_IN" && session?.user?.email !== state.session?.user?.email) {
        state.session = session;
        state.member = await db.getMembership(session.user.email).catch(() => null);
        render();
      }
      if (evt === "SIGNED_OUT") { state.session = null; state.member = null; render(); }
    });
    if (location.search.includes("code=")) { sessionStorage.removeItem(RETURN_KEY); history.replaceState(null, "", location.pathname + location.hash); }
    if (!state.session) sessionStorage.setItem(RETURN_KEY, location.hash);
  }
  window.addEventListener("hashchange", () => {
    if (!state.session) sessionStorage.setItem(RETURN_KEY, location.hash);
    if (!location.hash.startsWith("#/settings")) state.newKey = null;
    if (!location.hash.startsWith("#/add")) { state.addResult = null; state.addUrl = ""; }
    render(); window.scrollTo(0, 0);
  });
  render();
}
boot();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
