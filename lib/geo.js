// Location: the phone's position stays on the device (never sent to the server).
const KEY = "spots.loc.v1";

export function distanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function fmtKm(km) {
  if (km == null) return "";
  return km < 1 ? `${Math.round(km * 1000 / 50) * 50} מ׳` : `${km < 10 ? km.toFixed(1) : Math.round(km)} ק״מ`;
}

// { lat, lng, label, source: 'gps'|'area', at }
export function savedLocation() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
export function saveLocation(loc) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...loc, at: Date.now() })); } catch {}
  return loc;
}
export function clearLocation() { try { localStorage.removeItem(KEY); } catch {} }

export function locate({ timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("המכשיר לא תומך במיקום"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(saveLocation({ lat: p.coords.latitude, lng: p.coords.longitude, label: "המיקום שלך", source: "gps" })),
      (e) => reject(new Error(e.code === 1 ? "אין הרשאת מיקום. אפשר לבחור אזור ידנית." : "לא הצלחתי לקבל מיקום. אפשר לבחור אזור ידנית.")),
      { enableHighAccuracy: false, timeout, maximumAge: 5 * 60 * 1000 }
    );
  });
}

// Centre of a city = average of the saved places in it that have coordinates.
export function cityCenter(places, city) {
  const pts = places.filter((p) => p.city === city && p.lat != null);
  if (!pts.length) return null;
  return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length };
}

// Free geocoding of a typed address (OpenStreetMap). Used only for area planning.
export async function geocode(text) {
  const p = new URLSearchParams({ format: "jsonv2", countrycodes: "il", limit: "1", "accept-language": "he", q: text });
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${p}`);
  const j = await r.json();
  if (!j.length) throw new Error("לא מצאתי את הכתובת");
  return { lat: +j[0].lat, lng: +j[0].lon, label: text };
}
