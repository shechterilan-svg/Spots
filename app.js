// Spots – app shell: auth gate, hash router, list / place screens (phase 2) and placeholders for later phases.
import * as db from "./lib/db.js";
import { DAY_NAMES, nowInIsrael, openState, hasHours } from "./lib/hours.js";

const view = document.getElementById("view");
const cfg = window.SPOTS_CONFIG || {};
const state = { session: null, member: null, filters: { q: "", type: "", city: "", cuisine: "", kosher: "", price: "", status: "", openNow: false } };

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isOwner = () => state.member?.role === "owner";
const head = (title, sub) => `<div class="screen-head"><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>`;
const ph = (title, text, prio, ids) =>
  `<section class="card placeholder"><span class="tag ${prio === "Must" ? "must" : "should"}">${esc(prio)} · ${esc(ids)}</span>
   <h3>${esc(title)}</h3><p>${esc(text)}</p></section>`;
const priceTxt = (p) => (p ? "₪".repeat(p) : "");
const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, "he"));
const mapsUrl = (p) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.name, p.address, p.city].filter(Boolean).join(" "))}`;
const wazeUrl = (p) => (p.lat && p.lng ? `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent([p.address, p.city].filter(Boolean).join(" "))}&navigate=yes`);
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");

function openBadge(p) {
  const s = openState(p.hours);
  if (s.open === null) return `<span class="badge muted">אין שעות</span>`;
  if (s.open) return `<span class="badge open">פתוח · עד ${esc(s.closesAt)}</span>`;
  return `<span class="badge closed">סגור${s.opensAt ? ` · נפתח ב-${esc(s.opensAt)}` : ""}</span>`;
}

// ---------- screens ----------
const screens = {
  now: { title: "עכשיו", render: renderNow },
  list: { title: "רשימה", render: renderList },
  place: { title: "דף מקום", render: renderPlace },
  edit: { title: "עריכה", render: renderEdit, owner: true },
  map: {
    title: "מפה",
    render: () => head("מפה", "המקומות השמורים על מפה, ותכנון לפי אזור בטיול") +
      ph("תכנון לפי אזור", "בחירת עיר או נקודה במפה מציגה את המקומות ברדיוס שנבחר.", "Must", "F-10") +
      ph("תצוגת מפה", "כל המקומות על מפה עם אותם סינונים כמו ברשימה.", "Should", "F-14"),
  },
  add: {
    title: "הוספה", owner: true,
    render: () => head("הוספת מקום", "מדביקים קישור מאינסטגרם, טיקטוק או גוגל מפות, ומקבלים טיוטה ממולאת") +
      `<input class="field" type="url" placeholder="הדבק קישור כאן" aria-label="קישור" disabled>` +
      `<div style="height:16px"></div>` +
      ph("הדבקת קישור", "טיוטה ממולאת לאישור; מקום קיים מזוהה ככפול.", "Must", "F-04") +
      ph("שיתוף מהאייפון", "קיצור דרך בתפריט השיתוף שומר מקום בלי לפתוח את האפליקציה.", "Must", "F-03"),
  },
  inbox: {
    title: "תיבת אישור", owner: true,
    render: () => head("תיבת אישור", "המלצות מחברים והצעות גילוי, ממתינות לאישור שלך") +
      ph("המלצות מחברים", "המלצה נכנסת לרשימה רק אחרי אישור.", "Must", "F-11") +
      ph("גילוי ממשפיענים וכתבות", "פעם בשבוע: עומר זיצר, נדב בורנשטיין, Lin Levy, גיל הראל וכתבות אוכל.", "Should", "F-12") +
      ph("ייבוא קבוצת הוואטסאפ", "240 הקישורים הישנים כהצעות לאישור.", "Should", "F-15"),
  },
  outings: {
    title: "יציאות",
    render: () => head("יציאות", "בוחרים 2–5 מקומות, החברים מצביעים, ואז הזמנה ויומן") +
      ph("יציאה עם הצבעה", "הצבעה מקישור, תוצאות בזמן אמת.", "Must", "F-08") +
      ph("הזמנה ויומן", "הזמנה באונטופו, באתר או בחיוג, וקישור ״הוסף ל-Google Calendar״.", "Must", "F-09"),
  },
  vote: {
    title: "הצבעה",
    render: (id) => head("הצבעה ליציאה", id ? `יציאה: ${id}` : "") + ph("דף הצבעה לחברים", "חבר מוזמן בוחר מקום אחד מהרשימה הקצרה.", "Must", "F-08"),
  },
  settings: { title: "הגדרות", render: renderSettings },
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
    <button class="btn ghost" data-action="signout">התנתקות</button></div>`;
}

async function renderNow() {
  const places = await getPlaces();
  const open = places.map((p) => ({ p, s: openState(p.hours) })).filter((x) => x.s.open && x.s.minutesLeft >= 60 && x.p.status !== "נסגר")
    .sort((a, b) => b.s.minutesLeft - a.s.minutesLeft);
  return head("לאן הולכים עכשיו?", "שלוש הצעות שפתוחות עכשיו וקרובות אלייך") +
    ph("הצעה חכמה ומיקום", "3 הצעות עם סיבה ומרחק מגיעות בשלב הבא. בינתיים: מקומות שפתוחים לפחות עוד שעה.", "Must", "F-01, F-02") +
    `<h3 class="section-title">פתוחים עכשיו (${open.length})</h3>` +
    (open.length ? open.slice(0, 20).map((x) => card(x.p)).join("") : `<p class="status">אין כרגע מקומות שפתוחים לפחות עוד שעה.</p>`);
}

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
     <p class="status" id="count">${filtered.length} תוצאות</p>
     <div id="results">${filtered.map(card).join("") || `<p class="status">לא נמצאו מקומות.</p>`}</div>`;
}

function applyFilters(places) {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  return places.filter((p) => {
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
}

function card(p) {
  const meta = [p.type, (p.cuisine || []).join(", ")].filter(Boolean).join(" · ");
  const where = [p.neighborhood, p.city].filter(Boolean).join(", ");
  return `<a class="card place-card" href="#/place/${encodeURIComponent(p.id)}">
    <div class="pc-top"><h3 dir="auto">${esc(p.name)}</h3><span class="price">${priceTxt(p.price)}</span></div>
    <div class="pc-meta">${esc(meta)}</div>
    <div class="pc-bottom"><span class="pc-where">${esc(where || "מיקום לא ידוע")}</span>${openBadge(p)}</div>
    ${p.needs_review ? `<span class="badge warn">חסרים פרטים</span>` : ""}
  </a>`;
}

async function renderPlace(id) {
  const p = (await getPlaces()).find((x) => x.id === id);
  if (!p) return `<a class="back" href="#/list">→ חזרה לרשימה</a>${head("המקום לא נמצא")}`;
  const today = nowInIsrael().day;
  const hoursRows = hasHours(p.hours)
    ? DAY_NAMES.map((d, i) => `<tr class="${i === today ? "today" : ""}"><th>${d}</th><td>${esc(p.hours[String(i)] || "—")}</td></tr>`).join("")
    : "";
  const links = [
    p.address || p.city ? `<a class="btn ghost" href="${mapsUrl(p)}" target="_blank" rel="noopener">מפה</a>` : "",
    p.address ? `<a class="btn ghost" href="${wazeUrl(p)}" target="_blank" rel="noopener">Waze</a>` : "",
    p.phone ? `<a class="btn ghost" href="tel:${esc(p.phone.replace(/[^\d+]/g, ""))}">חיוג</a>` : "",
    safeUrl(p.booking_url) ? `<a class="btn" href="${esc(p.booking_url)}" target="_blank" rel="noopener">הזמנה</a>` : "",
    p.instagram ? `<a class="btn ghost" href="https://www.instagram.com/${encodeURIComponent(p.instagram)}/" target="_blank" rel="noopener">אינסטגרם</a>` : "",
    safeUrl(p.website) ? `<a class="btn ghost" href="${esc(p.website)}" target="_blank" rel="noopener">אתר</a>` : "",
  ].join("");
  const sources = (p.sources || []).filter((s) => safeUrl(s.url));
  return `<a class="back" href="#/list">→ חזרה לרשימה</a>
    <div class="screen-head place-head"><h2 dir="auto">${esc(p.name)}</h2>${p.name_en ? `<p class="en">${esc(p.name_en)}</p>` : ""}
      <p>${esc([p.type, (p.cuisine || []).join(", "), priceTxt(p.price)].filter(Boolean).join(" · "))}</p>
      <div class="row">${openBadge(p)}<span class="badge muted">${esc(p.status)}</span>${p.kosher ? `<span class="badge muted">${esc(p.kosher)}</span>` : ""}</div>
    </div>
    ${p.needs_review ? `<div class="card notice">חסרים פרטים למקום הזה (כתובת או שעות).</div>` : ""}
    <section class="card"><h3>איפה</h3><p>${esc([p.address, p.neighborhood, p.city].filter(Boolean).join(", ") || "לא ידוע")}</p>
      ${p.phone ? `<p class="status">טלפון: ${esc(p.phone)}</p>` : ""}<div class="row">${links}</div></section>
    ${hoursRows ? `<section class="card"><h3>שעות פתיחה</h3><table class="hours">${hoursRows}</table>
      <p class="status">${esc([p.hours_source, p.hours_checked_at ? `נבדק ${p.hours_checked_at}` : ""].filter(Boolean).join(" · "))}</p></section>` : ""}
    ${(p.dishes || []).length ? `<section class="card"><h3>מה להזמין</h3><ul class="dishes">${p.dishes.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></section>` : ""}
    ${p.notes ? `<section class="card"><h3>הערות</h3><p>${esc(p.notes)}</p></section>` : ""}
    ${sources.length ? `<section class="card"><h3>מקור ההמלצה</h3>${sources.map((s) => `<p><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.caption || s.publisher || s.url)}</a></p>`).join("")}</section>` : ""}
    ${isOwner() ? `<div class="row"><a class="btn" href="#/edit/${encodeURIComponent(p.id)}">עריכה</a></div>` : ""}`;
}

const TYPES = ["מסעדה", "בית קפה", "בר", "מאפייה", "אוכל רחוב", "אחר"];
const STATUSES = ["רוצה לנסות", "ביקרתי", "אהבתי", "לא אהבתי", "נסגר"];
const KOSHER = ["לא ידוע", "כשר", "לא כשר"];

async function renderEdit(id) {
  const p = (await getPlaces()).find((x) => x.id === id);
  if (!p) return head("המקום לא נמצא");
  const input = (name, label, val, type = "text") =>
    `<label class="lbl">${label}<input class="field" name="${name}" type="${type}" value="${esc(val ?? "")}"></label>`;
  const select = (name, label, list, val) =>
    `<label class="lbl">${label}<select class="field" name="${name}">${uniq([...list, val]).map((v) => `<option ${v === val ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`;
  return `<a class="back" href="#/place/${encodeURIComponent(p.id)}">→ ביטול</a>${head(`עריכת ${p.name}`)}
  <form id="edit-form" class="card form" data-id="${esc(p.id)}">
    ${input("name", "שם", p.name)}${input("name_en", "שם באנגלית", p.name_en)}
    ${select("type", "סוג", TYPES, p.type)}
    ${input("cuisine", "סגנון (מופרד בפסיקים)", (p.cuisine || []).join(", "))}
    ${input("address", "כתובת", p.address)}${input("neighborhood", "שכונה", p.neighborhood)}${input("city", "עיר", p.city)}
    ${input("phone", "טלפון", p.phone, "tel")}${input("instagram", "אינסטגרם", p.instagram)}
    ${input("website", "אתר", p.website, "url")}${input("booking_url", "קישור להזמנה", p.booking_url, "url")}
    ${select("kosher", "כשרות", KOSHER, p.kosher || "לא ידוע")}
    <label class="lbl">מחיר<select class="field" name="price">${[0, 1, 2, 3, 4].map((v) => `<option value="${v}" ${Number(p.price || 0) === v ? "selected" : ""}>${v ? priceTxt(v) : "לא ידוע"}</option>`).join("")}</select></label>
    ${select("status", "סטטוס", STATUSES, p.status)}
    <fieldset class="hours-edit"><legend>שעות פתיחה (למשל 12:00-23:00, או סגור)</legend>
      ${DAY_NAMES.map((d, i) => `<label class="lbl inline">${d}<input class="field" name="h${i}" value="${esc(p.hours?.[String(i)] || "")}" dir="ltr"></label>`).join("")}
    </fieldset>
    ${input("dishes", "מנות מומלצות (מופרד בפסיקים)", (p.dishes || []).join(", "))}
    <label class="lbl">הערות<textarea class="field" name="notes" rows="3">${esc(p.notes)}</textarea></label>
    <label class="lbl inline check"><input type="checkbox" name="needs_review" ${p.needs_review ? "checked" : ""}> חסרים פרטים</label>
    <div class="row"><button class="btn" type="submit">שמירה</button>
      <button class="btn ghost danger" type="button" data-action="delete" data-id="${esc(p.id)}">מחיקה</button></div>
    <p class="status" id="edit-status"></p>
  </form>`;
}

function renderSettings() {
  return head("הגדרות", "חברים, משפיענים שנעקבים וייצוא") +
    `<section class="card"><h3>חשבון</h3><p>${esc(state.session?.user?.email || "")} · ${isOwner() ? "בעלים" : "חבר"}</p>
       <div class="row"><button class="btn ghost" data-action="refresh">רענון נתונים</button><button class="btn ghost" data-action="signout">התנתקות</button></div></section>` +
    `<section class="card"><h3>חיבור לשרת</h3><div id="conn" class="status">בודק…</div></section>` +
    (isOwner()
      ? ph("חברים", "הזמנת עד 10 חברים לפי כתובת Gmail.", "Must", "F-11") +
        ph("משפיענים", "ניהול רשימת המשפיענים שנסרקים.", "Should", "F-12") +
        `<section class="card"><h3>ייצוא</h3><p class="status">כל המקומות כקובץ JSON.</p><button class="btn ghost" data-action="export">ייצוא JSON</button></section>`
      : "") +
    `<p class="status">גרסה ${esc(cfg.version || "")}</p>`;
}

// ---------- data ----------
async function getPlaces() {
  return db.cachedPlaces() || (await db.loadPlaces());
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
    html = head("משהו השתבש") + `<p class="status error">${esc(e.message || e)}</p>`;
  }
  if (seq !== renderSeq) return;
  view.innerHTML = html;
  document.title = `${s.title} · Spots`;
  const navName = { place: "list", edit: "list", vote: "outings" }[name] || name;
  document.querySelectorAll("[data-route]").forEach((a) =>
    a.dataset.route === navName ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  if (name === "settings" && state.member) checkConnection();
}

async function checkConnection() {
  const el = document.getElementById("conn");
  if (!el) return;
  try {
    const r = await fetch(`${cfg.supabaseUrl}/auth/v1/health`, { headers: { apikey: cfg.supabaseAnonKey } });
    el.innerHTML = r.ok ? `<span class="ok">מחובר ל-Supabase ✓</span>` : `שגיאת חיבור (${r.status})`;
  } catch { el.textContent = "אין חיבור לשרת כרגע. מוצגים נתונים שמורים."; }
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
  const a = t.dataset.action;
  if (a === "signout") { await db.signOut(); state.session = null; state.member = null; location.hash = "#/now"; render(); }
  if (a === "refresh") { await db.loadPlaces({ force: true }); render(); }
  if (a === "clear-filters") { Object.assign(state.filters, { type: "", city: "", cuisine: "", kosher: "", price: "", status: "", openNow: false }); render(); }
  if (a === "export") exportJson();
  if (a === "delete") {
    const p = (await getPlaces()).find((x) => x.id === t.dataset.id);
    if (p && confirm(`למחוק את ${p.name}? אי אפשר לבטל.`)) {
      try { await db.deletePlace(p.id); location.hash = "#/list"; } catch (err) { alert(err.message); }
    }
  }
});

document.addEventListener("change", (e) => {
  const sel = e.target.closest("[data-filter]");
  if (sel) { state.filters[sel.dataset.filter] = sel.value; render(); }
});

document.addEventListener("input", (e) => {
  if (e.target.id !== "q") return;
  state.filters.q = e.target.value;
  const results = applyFilters(db.cachedPlaces() || []);
  document.getElementById("results").innerHTML = results.map(card).join("") || `<p class="status">לא נמצאו מקומות.</p>`;
  document.getElementById("count").textContent = `${results.length} תוצאות`;
});

document.addEventListener("submit", async (e) => {
  if (e.target.id !== "edit-form") return;
  e.preventDefault();
  const f = new FormData(e.target);
  const list = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
  const hours = {};
  DAY_NAMES.forEach((_, i) => { const v = String(f.get(`h${i}`) || "").trim(); if (v) hours[String(i)] = v; });
  const nz = (v) => (String(v || "").trim() || null);
  const patch = {
    name: String(f.get("name")).trim(), name_en: nz(f.get("name_en")), type: f.get("type"), cuisine: list(f.get("cuisine")),
    address: nz(f.get("address")), neighborhood: nz(f.get("neighborhood")), city: nz(f.get("city")),
    phone: nz(f.get("phone")), instagram: nz(f.get("instagram")), website: nz(f.get("website")), booking_url: nz(f.get("booking_url")),
    kosher: f.get("kosher"), price: Number(f.get("price")) || null, status: f.get("status"), hours,
    dishes: list(f.get("dishes")), notes: nz(f.get("notes")), needs_review: f.get("needs_review") === "on",
  };
  const status = document.getElementById("edit-status");
  if (!patch.name) { status.textContent = "חסר שם."; return; }
  status.textContent = "שומר…";
  try { await db.savePlace(e.target.dataset.id, patch); location.hash = `#/place/${encodeURIComponent(e.target.dataset.id)}`; }
  catch (err) { status.textContent = `השמירה נכשלה: ${err.message}`; }
});

async function exportJson() {
  const rows = await db.loadPlaces({ force: true });
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `spots-${new Date().toISOString().slice(0, 10)}.json` });
  a.click(); URL.revokeObjectURL(a.href);
}

// ---------- boot ----------
async function boot() {
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
    // Strip the OAuth ?code= from the address bar after the session is established.
    if (location.search.includes("code=")) history.replaceState(null, "", location.pathname + location.hash);
  }
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
  render();
}
boot();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
