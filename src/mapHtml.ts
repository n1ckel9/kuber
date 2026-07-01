import { City, Order } from "./types";
import { serviceByKey } from "./catalog";

// Генерация HTML с картой на OpenStreetMap + Leaflet — полностью бесплатно,
// без ключа и регистрации. Используется и в нативном WebView, и в web-iframe;
// target определяет способ отправки сообщения наружу (клик по маркеру / выбор точки).
export function buildMapHtml({
  city,
  orders,
  activeOrderId,
  target,
  pickable = false,
  pickPoint
}: {
  city: City;
  orders: Order[];
  activeOrderId?: string;
  target: "rn" | "web";
  pickable?: boolean;
  pickPoint?: [number, number];
}) {
  const mapOrders = orders.map((order) => ({
    id: order.id,
    coordinates: order.coordinates,
    label: serviceByKey(order.service).title,
    active: order.id === activeOrderId,
    color: serviceByKey(order.service).accent
  }));

  const sendBody =
    target === "rn"
      ? "window.ReactNativeWebView && window.ReactNativeWebView.postMessage(id);"
      : "window.parent && window.parent.postMessage(id, '*');";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #container { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background: #f7f4ee; font-family: -apple-system, Segoe UI, Roboto, sans-serif; }
    #fallback {
      display: none; position: absolute; inset: 0; padding: 24px; z-index: 5;
      align-items: center; justify-content: center; text-align: center; flex-direction: column; gap: 8px;
    }
    #fallback h3 { margin: 0; color: #1A1A1A; font-size: 17px; }
    #fallback p { margin: 0; color: #6B6B6B; font-size: 14px; line-height: 20px; max-width: 320px; }
    .vz-label { background: #fff; border: 1px solid #E9E3D8; border-radius: 8px; padding: 2px 6px;
      font-size: 12px; font-weight: 700; color: #1A1A1A; box-shadow: none; }
    .vz-label::before { display: none; }
  </style>
</head>
<body>
  <div id="container"></div>
  <div id="fallback">
    <h3>Карта недоступна</h3>
    <p>Не удалось загрузить OpenStreetMap. Проверьте интернет.</p>
  </div>
  <script>
    var orders = ${JSON.stringify(mapOrders)};
    var center = ${JSON.stringify(city.center)};
    var zoom = ${city.zoom};
    var pickable = ${pickable ? "true" : "false"};
    var pickPoint = ${pickPoint ? JSON.stringify(pickPoint) : "null"};

    function send(id) { ${sendBody} }
    function showFallback() {
      var el = document.getElementById('fallback');
      if (el) { el.style.display = 'flex'; }
    }

    function initMap() {
      if (typeof L === 'undefined') { showFallback(); return; }
      try {
        // Leaflet принимает [lat, lng]; у нас координаты [lng, lat] — меняем местами.
        var map = L.map('container', { zoomControl: false, attributionControl: true })
          .setView([center[1], center[0]], zoom);
        // Убираем префикс «Leaflet» с флагом, оставляем только атрибуцию данных.
        map.attributionControl.setPrefix('');
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '© OpenStreetMap'
        }).addTo(map);

        orders.forEach(function (order) {
          var m = L.circleMarker([order.coordinates[1], order.coordinates[0]], {
            radius: order.active ? 11 : 9, color: '#ffffff', weight: 2,
            fillColor: order.color, fillOpacity: 1
          }).addTo(map);
          m.bindTooltip(order.label, { permanent: true, direction: 'top', offset: [0, -8], className: 'vz-label' });
          m.on('click', function () { send(order.id); });
        });

        if (pickable) {
          var pinStyle = { radius: 10, color: '#ffffff', weight: 3, fillColor: '#1A1A1A', fillOpacity: 1 };
          var pin = pickPoint ? L.circleMarker([pickPoint[1], pickPoint[0]], pinStyle).addTo(map) : null;
          map.on('click', function (e) {
            var lng = e.latlng.lng, lat = e.latlng.lat;
            if (pin) { pin.setLatLng([lat, lng]); } else { pin = L.circleMarker([lat, lng], pinStyle).addTo(map); }
            send(JSON.stringify({ pick: [lng, lat] }));
          });
        }
      } catch (e) {
        showFallback();
      }
    }

    var script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = initMap;
    script.onerror = showFallback;
    document.head.appendChild(script);

    setTimeout(function () { if (typeof L === 'undefined') { showFallback(); } }, 8000);
  </script>
</body>
</html>`;
}
