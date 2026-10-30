// Spots – phase 1 skeleton: hash router + empty Hebrew screens.
const view = document.getElementById("view");
const cfg = window.SPOTS_CONFIG || {};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const head = (title, sub) => `<div class="screen-head"><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>`;
const ph = (title, text, prio, ids) =>
  `<section class="card placeholder"><span class="tag ${prio === "Must" ? "must" : "should"}">${esc(prio)} · ${esc(ids)}</span>
   <h3>${esc(title)}</h3><p>${esc(text)}</p></section>`;
const skel = (n = 3) =>
  Array.from({ length: n }, () => `<div class="card" aria-hidden="true"><div class="skeleton w60"></div><div class="skeleton w80"></div><div class="skeleton w40"></div></div>`).join("");

const screens = {
  now: {
    title: "עכשיו",
    render: () =>
      head("לאן הולכים עכשיו?", "שלוש הצעות שפתוחות עכשיו וקרובות אלייך") +
      `<input class="field" placeholder="למשל: משהו אסייתי לא יקר" aria-label="בקשה חופשית" disabled>` +
      `<div style="height:12px"></div>` +
      ph("הצעה חכמה", "3 מקומות שפתוחים לפחות עוד שעה, עם סיבה, מרחק ושעת סגירה.", "Must", "F-02") +
      ph("מיקום אוטומטי", "מרחק בק״מ לכל מקום. בלי הרשאה: בחירת אזור ידנית.", "Must", "F-01") +
      skel(2),
  },
  list: {
    title: "רשימה",
    render: () =>
      head("כל המקומות", "חיפוש וסינון לפי סוג, עיר, סגנון, כשרות, מחיר, סטטוס ופתוח עכשיו") +
      `<input class="field" type="search" placeholder="חיפוש מקום" aria-label="חיפוש" disabled>` +
      `<div style="height:12px"></div>` +
      ph("רשימה, חיפוש וסינון", "72 המקומות מהמסד הקיים ייובאו בשלב 2.", "Must", "F-06") +
      skel(3),
  },
  map: {
    title: "מפה",
    render: () =>
      head("מפה", "המקומות השמורים על מפה, ותכנון לפי אזור בטיול") +
      ph("תכנון לפי אזור", "בחירת עיר או נקודה במפה מציגה את המקומות ברדיוס שנבחר.", "Must", "F-10") +
      ph("תצוגת מפה", "כל המקומות על מפה עם אותם סינונים כמו ברשימה.", "Should", "F-14"),
  },
  place: {
    title: "דף מקום",
    render: (id) =>
      `<a class="back" href="#/list">→ חזרה לרשימה</a>` +
      head("דף מקום", id ? `מזהה: ${id}` : "") +
      ph("פרטים ועריכה", "שעות לפי ימים, מפה, Waze, טלפון, הזמנה ומקור ההמלצה. הבעלים יכול לערוך כל שדה.", "Must", "F-07") +
      ph("ביקורים ודירוג", "סימון ״ביקרתי״ עם תאריך, דירוג ומה הזמנתי.", "Should", "F-13"),
  },
  add: {
    title: "הוספה",
    render: () =>
      head("הוספת מקום", "מדביקים קישור מאינסטגרם, טיקטוק או גוגל מפות, ומקבלים טיוטה ממולאת") +
      `<input class="field" type="url" placeholder="הדבק קישור כאן" aria-label="קישור" disabled>` +
      `<div class="row" style="margin-top:12px"><button class="btn" disabled>זהה מקום</button></div>` +
      `<div style="height:16px"></div>` +
      ph("הדבקת קישור", "טיוטה ממולאת לאישור; מקום קיים מזוהה ככפול.", "Must", "F-04") +
      ph("שיתוף מהאייפון", "קיצור דרך בתפריט השיתוף שומר מקום בלי לפתוח את האפליקציה.", "Must", "F-03"),
  },
  inbox: {
    title: "תיבת אישור",
    render: () =>
      head("תיבת אישור", "המלצות מחברים והצעות גילוי, ממתינות לאישור שלך") +
      ph("המלצות מחברים", "המלצה נכנסת לרשימה רק אחרי אישור.", "Must", "F-11") +
      ph("גילוי ממשפיענים וכתבות", "פעם בשבוע: עומר זיצר, נדב בורנשטיין, Lin Levy, גיל הראל וכתבות אוכל.", "Should", "F-12") +
      ph("ייבוא קבוצת הוואטסאפ", "240 הקישורים הישנים כהצעות לאישור.", "Should", "F-15"),
  },
  outings: {
    title: "יציאות",
    render: () =>
      head("יציאות", "בוחרים 2–5 מקומות, החברים מצביעים, ואז הזמנה ויומן") +
      `<div class="row" style="margin-bottom:12px"><button class="btn" disabled>יציאה חדשה</button></div>` +
      ph("יציאה עם הצבעה", "הצבעה מקישור, תוצאות בזמן אמת.", "Must", "F-08") +
      ph("הזמנה ויומן", "הזמנה באונטופו, באתר או בחיוג, וקישור ״הוסף ל-Google Calendar״.", "Must", "F-09"),
  },
  vote: {
    title: "הצבעה",
    render: (id) =>
      head("הצבעה ליציאה", id ? `יציאה: ${id}` : "") +
      ph("דף הצבעה לחברים", "חבר מוזמן בוחר מקום אחד מהרשימה הקצרה.", "Must", "F-08"),
  },
  settings: {
    title: "הגדרות",
    render: () =>
      head("הגדרות", "חברים, משפיענים שנעקבים וייצוא") +
      `<section class="card"><h3 style="margin:0 0 4px">חיבור לשרת</h3><div id="conn" class="status">בודק…</div></section>` +
      ph("חברים", "הזמנת עד 10 חברים לפי כתובת Gmail.", "Must", "F-11") +
      ph("משפיענים", "ניהול רשימת המשפיענים שנסרקים.", "Should", "F-12") +
      ph("ייצוא", "ייצוא מלא ל-JSON בכל עת.", "Must", "NFR") +
      `<p class="status">גרסה ${esc(cfg.version || "")}</p>`,
    after: checkConnection,
  },
};

function parse() {
  const [name, ...rest] = (location.hash.replace(/^#\/?/, "") || "now").split("/");
  return { name: screens[name] ? name : "now", arg: rest.join("/") ? decodeURIComponent(rest.join("/")) : "" };
}

function render() {
  const { name, arg } = parse();
  const s = screens[name];
  view.innerHTML = s.render(arg);
  document.title = `${s.title} · Spots`;
  const navName = name === "place" ? "list" : name === "vote" ? "outings" : name;
  document.querySelectorAll("[data-route]").forEach((a) =>
    a.dataset.route === navName ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  window.scrollTo(0, 0);
  view.focus({ preventScroll: true });
  s.after?.();
}

async function checkConnection() {
  const el = document.getElementById("conn");
  if (!el) return;
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    el.innerHTML = "עוד לא מחובר ל-Supabase. ממלאים את <b>config.js</b> אחרי יצירת הפרויקט.";
    return;
  }
  try {
    const r = await fetch(`${cfg.supabaseUrl}/auth/v1/health`, { headers: { apikey: cfg.supabaseAnonKey } });
    el.innerHTML = r.ok ? `<span class="ok">מחובר ל-Supabase ✓</span>` : `שגיאת חיבור (${r.status})`;
  } catch {
    el.textContent = "אין חיבור לשרת כרגע.";
  }
}

if (!location.hash) history.replaceState(null, "", "#/now");
window.addEventListener("hashchange", render);
render();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
