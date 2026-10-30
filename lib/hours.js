// Opening-hours helpers. Hours are stored per weekday ("0" = Sunday … "6" = Saturday) as
// "HH:MM-HH:MM[, HH:MM-HH:MM]", "סגור" (closed) or "24 שעות" (open all day).
// A range whose end is at or before its start runs past midnight into the next day.

export const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const TZ = "Asia/Jerusalem";

export function nowInIsrael(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date).map((p) => [p.type, p.value])
  );
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { day, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const toMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };

// Returns [{start, end}] in minutes for a day; end may exceed 1440 when it runs past midnight.
export function rangesFor(hours, day) {
  const v = hours?.[String(day)];
  if (!v || typeof v !== "string") return null;          // unknown
  if (v.includes("סגור")) return [];
  if (v.includes("24 שעות")) return [{ start: 0, end: 1440 }];
  return v.split(",").map((r) => r.trim()).filter(Boolean).map((r) => {
    const [a, b] = r.split("-").map((x) => x.trim());
    let start = toMin(a), end = toMin(b);
    if (end <= start) end += 1440;
    return { start, end };
  });
}

export function hasHours(hours) { return hours && Object.keys(hours).length > 0; }

// { open: true|false|null, closesAt?: "HH:MM", minutesLeft?: number, opensAt?: "HH:MM" }
export function openState(hours, at = nowInIsrael()) {
  if (!hasHours(hours)) return { open: null };
  const { day, minutes } = at;
  const today = rangesFor(hours, day) || [];
  const yesterday = (rangesFor(hours, (day + 6) % 7) || []).map((r) => ({ start: r.start - 1440, end: r.end - 1440 }));
  for (const r of [...yesterday, ...today]) {
    if (minutes >= r.start && minutes < r.end) {
      const left = r.end - minutes;
      return { open: true, minutesLeft: left, closesAt: fmt(r.end) };
    }
  }
  const next = today.find((r) => r.start > minutes);
  return { open: false, opensAt: next ? fmt(next.start) : null };
}

const fmt = (m) => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
