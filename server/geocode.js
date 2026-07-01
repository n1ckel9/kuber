// Геокодирование адреса в координаты через Nominatim (OpenStreetMap).
// Бесплатно, без ключа. Политика использования требует User-Agent и щадящего
// темпа запросов — для прототипа этого достаточно.

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";

const headers = {
  "User-Agent": "vodovoz-services/0.1 (dev)",
  "Accept-Language": "ru"
};

// Короткий, читаемый адрес из длинного display_name Nominatim.
function shortLabel(displayName) {
  return String(displayName || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
}

async function geocodeAddress(query, cityName) {
  const text = String(query || "").trim();
  if (!text) {
    return null;
  }

  const url = new URL(NOMINATIM);
  url.searchParams.set("q", cityName ? `${text}, ${cityName}` : text);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "ru");

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      return null;
    }
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) {
      return null;
    }
    const hit = arr[0];
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    return { lat, lng, displayName: shortLabel(hit.display_name) || text };
  } catch {
    return null;
  }
}

// Подсказки адреса по мере ввода (до 5 вариантов).
async function suggestAddress(query, cityName) {
  const text = String(query || "").trim();
  if (text.length < 3) {
    return [];
  }

  const url = new URL(NOMINATIM);
  url.searchParams.set("q", cityName ? `${text}, ${cityName}` : text);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "ru");

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      return [];
    }
    const arr = await res.json();
    if (!Array.isArray(arr)) {
      return [];
    }
    return arr
      .map((hit) => ({
        lat: Number(hit.lat),
        lng: Number(hit.lon),
        displayName: shortLabel(hit.display_name)
      }))
      .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng) && item.displayName);
  } catch {
    return [];
  }
}

// Координаты → адрес (для подстановки адреса после выбора точки на карте).
async function reverseGeocode(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const url = new URL(NOMINATIM_REVERSE);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "json");

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    if (!data || !data.display_name) {
      return null;
    }
    return {
      displayName: shortLabel(data.display_name),
      lat: Number(data.lat),
      lng: Number(data.lon)
    };
  } catch {
    return null;
  }
}

module.exports = { geocodeAddress, suggestAddress, reverseGeocode };
