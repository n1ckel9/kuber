// Смоук-тест API: поднимает сервер на временной БД и прогоняет ключевые сценарии.
// Запуск: npm test
const { spawn } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const PORT = 4199;
const DB = path.join(os.tmpdir(), `kuber_smoke_${Date.now()}.db`);
const B = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed += 1;
    console.log("  ✓", name);
  } else {
    failed += 1;
    console.log("  ✗", name);
  }
}

async function req(method, pathname, data, token) {
  const res = await fetch(B + pathname, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: method === "GET" ? undefined : JSON.stringify(data || {})
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`${B}/api/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, "index.js")], {
    env: { ...process.env, PORT: String(PORT), DB_FILE: DB, BID_FEE: "50", SIGNUP_BONUS: "200", ADMIN_EMAILS: "admin_smoke@gmail.com" },
    stdio: "ignore"
  });

  try {
    if (!(await waitForServer())) throw new Error("сервер не стартовал");

    check("health ok", (await req("GET", "/api/health")).body?.ok === true);
    check("catalog: есть города", ((await req("GET", "/api/catalog")).body?.cities?.length || 0) > 0);
    check("geocode требует токен (401)", (await req("GET", "/api/geocode/suggest?q=x&cityId=yakutsk")).status === 401);

    const stamp = Date.now();
    const reg = await req("POST", "/api/auth/register", { email: `c${stamp}@gmail.com`, password: "pass123", name: "Клиент", role: "client", cityId: "yakutsk" });
    check("регистрация выдаёт токен", !!reg.body?.token);
    check("приветственный бонус 200", reg.body?.account?.balance === 200);
    const tc = reg.body.token;

    const drv = await req("POST", "/api/auth/register", { email: `d${stamp}@gmail.com`, password: "pass123", name: "Драйвер", role: "driver", cityId: "yakutsk" });
    const td = drv.body.token;
    await req("PATCH", "/api/account", { services: ["water"], role: "driver" }, td);

    const order = await req("POST", "/api/orders", { cityId: "yakutsk", service: "water", from: "Ленина 1", details: "вода", price: 4000, coordinates: [129.73, 62.03] }, tc);
    check("создание заказа", order.status === 201 && !!order.body?.id);
    const oid = order.body.id;

    const bid = await req("POST", `/api/orders/${oid}/bids`, { price: 3800, eta: "30м" }, td);
    check("отклик создан", bid.status === 201);
    check("плата за отклик списана (200→150)", (await req("GET", "/api/wallet", null, td)).body?.balance === 150);
    check("повторный отклик запрещён (409)", (await req("POST", `/api/orders/${oid}/bids`, { price: 3700, eta: "20м" }, td)).status === 409);

    const mine = await req("GET", "/api/orders/mine", null, tc);
    const bidId = mine.body?.[0]?.bids?.[0]?.id;
    check("заказчик видит отклик", !!bidId);
    check("отклик обогащён (jobsCompleted/verifiedService)",
      typeof mine.body?.[0]?.bids?.[0]?.jobsCompleted === "number" &&
      mine.body?.[0]?.bids?.[0]?.verifiedService === false);

    const acc = await req("POST", `/api/orders/${oid}/accept`, { bidId }, tc);
    check("принятие → matched + исполнитель", acc.body?.status === "matched" && !!acc.body?.executor);

    check("исполнитель завершает → finished", (await req("POST", `/api/orders/${oid}/finish`, {}, td)).body?.status === "finished");
    check("заказчик не может finish (403)", (await req("POST", `/api/orders/${oid}/finish`, {}, tc)).status === 403);
    check("заказчик подтверждает → done", (await req("POST", `/api/orders/${oid}/confirm`, {}, tc)).body?.status === "done");
    check("отзыв ставится", (await req("POST", `/api/orders/${oid}/review`, { rating: 5, text: "ок" }, tc)).body?.reviewed === true);
    check("рейтинг исполнителя обновился", (await req("GET", "/api/auth/me", null, td)).body?.rating === 5);

    check("уведомления у исполнителя есть", ((await req("GET", "/api/notifications", null, td)).body?.items?.length || 0) > 0);

    // Категории и новые услуги в каталоге
    const cat = (await req("GET", "/api/catalog")).body;
    check("каталог: есть категории", (cat?.categories?.length || 0) >= 3);
    check("каталог: есть услуга 'электрик'", (cat?.services || []).some((s) => s.key === "electrician"));
    check("каталог: у услуги есть category", (cat?.services || []).every((s) => !!s.category));

    // Портфолио исполнителя
    const pf = await req("PATCH", "/api/account/portfolio", { bio: "Опыт 10 лет", addItem: { title: "Монтаж насоса", description: "Скважина 40м" } }, td);
    check("портфолио: bio сохранён", pf.body?.bio === "Опыт 10 лет");
    check("портфолио: работа добавлена", (pf.body?.portfolio?.length || 0) === 1);

    // Заказчик видит публичный профиль исполнителя
    const drvId = drv.body.account.id;
    const prof = await req("GET", `/api/executors/${drvId}`, null, tc);
    check("публичный профиль исполнителя", prof.body?.portfolio?.length === 1 && prof.body?.reviews?.length === 1);

    // Верификация по документу
    const photo = "data:image/png;base64," + "A".repeat(200);
    const vr = await req("POST", "/api/account/verification-request", { serviceKey: "welder", docType: "НАКС", photo }, td);
    check("заявка на верификацию создана", vr.status === 201 && vr.body?.status === "pending");
    check("исполнитель видит свою заявку", ((await req("GET", "/api/account/verification-requests", null, td)).body?.length || 0) === 1);
    check("повторная заявка по услуге запрещена (409)", (await req("POST", "/api/account/verification-request", { serviceKey: "welder", docType: "НАКС", photo }, td)).status === 409);

    // config отдаёт нишевые цены
    check("config: pricingRules присутствует", Array.isArray((await req("GET", "/api/config")).body?.pricingRules));

    // Монеты по нише (нужен админ)
    const adminReg = await req("POST", "/api/auth/register", { email: "admin_smoke@gmail.com", password: "pass123", name: "Админ", role: "client", cityId: "kazan" });
    const ta = adminReg.body.token;
    check("админ определён по ADMIN_EMAILS", adminReg.body?.account?.isAdmin === true);
    check("админ: грид цен непустой", ((await req("GET", "/api/admin/pricing", null, ta)).body?.grid?.length || 0) > 0);
    const an = await req("GET", "/api/admin/analytics?days=90", null, ta);
    check("аналитика: totals с оборотом", typeof an.body?.totals?.gmv === "number" && typeof an.body?.totals?.activeClients === "number");
    check("аналитика: услуги с GMV", Array.isArray(an.body?.byService) && an.body.byService.every((s) => typeof s.gmv === "number"));
    check("аналитика: категории и матрица", Array.isArray(an.body?.byCategory) && Array.isArray(an.body?.matrix));
    check("аналитика с фильтром города", (await req("GET", "/api/admin/analytics?days=90&cityId=yakutsk", null, ta)).body?.cityId === "yakutsk");
    check("админ: заявка на верификацию видна с фото", ((await req("GET", "/api/admin/verification-requests", null, ta)).body?.[0]?.photo || "").startsWith("data:"));
    await req("POST", "/api/admin/pricing", { cityId: "kazan", serviceKey: "water", coinCost: 25, enabled: true }, ta);

    const drv2 = await req("POST", "/api/auth/register", { email: `e${stamp}@gmail.com`, password: "pass123", name: "Драйвер2", role: "driver", cityId: "kazan" }, null);
    const td2 = drv2.body.token;
    await req("PATCH", "/api/account", { services: ["water"], role: "driver", cityId: "kazan" }, td2);
    const korder = await req("POST", "/api/orders", { cityId: "kazan", service: "water", from: "Баумана 1", details: "вода", price: 3000, coordinates: [49.1, 55.8] }, ta);
    const kbid = await req("POST", `/api/orders/${korder.body.id}/bids`, { price: 2900, eta: "30м" }, td2);
    check("отклик по платной нише прошёл (201)", kbid.status === 201);
    check("списано по нишевой цене 25 (200→175)", (await req("GET", "/api/wallet", null, td2)).body?.balance === 175);

    // Сохранённые адреса
    const pl = await req("POST", "/api/places", { label: "Дом", fromText: "Ленина 1", lng: 129.73, lat: 62.03 }, tc);
    check("место сохранено", pl.status === 201 && pl.body?.label === "Дом");
    check("список мест = 1", ((await req("GET", "/api/places", null, tc)).body?.length || 0) === 1);
    check("место удалено", (await req("DELETE", `/api/places/${pl.body.id}`, null, tc)).body?.ok === true);

    // Подсказка цены — эндпоинт публичный, формат корректный
    const ph = await req("GET", "/api/price-hint?cityId=yakutsk&service=water");
    check("price-hint отвечает", ph.status === 200 && typeof ph.body?.count === "number");

    // Охват заказа (reach)
    const rch = await req("GET", `/api/orders/${oid}/reach`, null, tc);
    check("reach доступен владельцу (>=1)", rch.status === 200 && rch.body?.reach >= 1);
    check("reach чужому запрещён (403)", (await req("GET", `/api/orders/${oid}/reach`, null, td)).status === 403);

    // Массовые цены
    const bulk = await req("POST", "/api/admin/pricing/bulk", { rules: [
      { cityId: "yakutsk", serviceKey: "dump", coinCost: 15, enabled: true },
      { cityId: "kazan", serviceKey: "dump", coinCost: 15, enabled: true }
    ] }, ta);
    check("массовые цены применены (2)", bulk.body?.ok === true && bulk.body?.count === 2);

    // Баланс вручную + бан
    const drvId2 = drv.body.account.id;
    const balBefore = (await req("GET", "/api/wallet", null, td)).body?.balance ?? 0;
    await req("POST", `/api/admin/users/${drvId2}/balance`, { amount: 100, note: "тест" }, ta);
    check("баланс начислен админом (+100)", ((await req("GET", "/api/wallet", null, td)).body?.balance ?? 0) === balBefore + 100);
    await req("POST", `/api/admin/users/${drvId2}/ban`, { banned: true }, ta);
    check("забаненный не проходит (403)", (await req("GET", "/api/wallet", null, td)).status === 403);
    await req("POST", `/api/admin/users/${drvId2}/ban`, { banned: false }, ta);
    check("разбан вернул доступ (200)", (await req("GET", "/api/wallet", null, td)).status === 200);

    // Ленты
    check("админ: лента заказов", Array.isArray((await req("GET", "/api/admin/orders?limit=10", null, ta)).body));
    check("админ: лог транзакций", Array.isArray((await req("GET", "/api/admin/transactions?limit=10", null, ta)).body?.transactions));
    check("пользователи: поиск по имени", ((await req("GET", "/api/admin/users?q=%D0%94%D1%80%D0%B0%D0%B9%D0%B2%D0%B5%D1%80", null, ta)).body || []).some((u) => (u.name || "").includes("Драйвер")));
    check("пользователи: пагинация (limit=1)", ((await req("GET", "/api/admin/users?limit=1&offset=0", null, ta)).body || []).length === 1);
    check("транзакции: пагинация (offset)", Array.isArray((await req("GET", "/api/admin/transactions?limit=5&offset=5", null, ta)).body?.transactions));

    // Аналитика: fill-rate/удержание в ответе
    const an2 = await req("GET", "/api/admin/analytics?days=90", null, ta);
    check("аналитика: repeatRate + матрица с fillRate", typeof an2.body?.totals?.repeatRate === "number" && an2.body?.matrix?.every((m) => typeof m.fillRate === "number" && typeof m.supply === "number"));

    // Каталог
    check("админ: добавить город", (await req("POST", "/api/admin/cities", { id: "testcity", regionId: "sakha", name: "Тестоград", centerLng: 130, centerLat: 62 }, ta)).body?.ok === true);
    check("админ: добавить услугу", (await req("POST", "/api/admin/services", { key: "testsvc", title: "Тест", subtitle: "проверка", icon: "wrench", accent: "#123456", category: "transport" }, ta)).body?.ok === true);
    check("админ: доступность услуги", (await req("POST", "/api/admin/city-services", { cityId: "testcity", serviceKey: "testsvc", enabled: true }, ta)).body?.ok === true);
    check("каталог отражает новый город", ((await req("GET", "/api/catalog")).body?.cities || []).some((c) => c.id === "testcity"));

    // rate-limit OTP
    let last = 200;
    for (let i = 0; i < 6; i += 1) {
      last = (await req("POST", "/api/auth/request-otp", { phone: "89001112233" })).status;
    }
    check("rate-limit OTP срабатывает (429)", last === 429);
  } catch (e) {
    failed += 1;
    console.log("  ✗ исключение:", e.message);
  } finally {
    srv.kill();
    // Windows может держать файл занятым сразу после kill — подождём и не падаем.
    await new Promise((r) => setTimeout(r, 600));
    for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
      try {
        fs.rmSync(f, { force: true });
      } catch {
        /* временный файл подчистит ОС */
      }
    }
  }

  console.log(`\nИтог: ${passed} ok, ${failed} fail`);
  process.exit(failed ? 1 : 0);
})();
