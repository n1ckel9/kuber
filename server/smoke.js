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
    await req("PATCH", "/api/account", { telegram: "cust_tg" }, tc);

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
    // S1b: контакт заказчика скрыт в открытой ленте (защита от сбора номеров)
    const openList = (await req("GET", "/api/orders?open=1&cityId=yakutsk", null, td)).body.find((o) => o.id === oid);
    check("контакт заказчика скрыт в открытой ленте", openList && (openList.customer?.telegram || "") === "");
    check("аноним не читает /api/orders (401)", (await req("GET", "/api/orders?cityId=yakutsk")).status === 401);

    const mine = await req("GET", "/api/orders/mine", null, tc);
    const bidId = mine.body?.[0]?.bids?.[0]?.id;
    check("заказчик видит отклик", !!bidId);
    check("отклик обогащён (jobsCompleted/verifiedService)",
      typeof mine.body?.[0]?.bids?.[0]?.jobsCompleted === "number" &&
      mine.body?.[0]?.bids?.[0]?.verifiedService === false);

    const acc = await req("POST", `/api/orders/${oid}/accept`, { bidId }, tc);
    check("принятие → matched + исполнитель", acc.body?.status === "matched" && !!acc.body?.executor);
    // S1b: после match контакт заказчика раскрыт исполнителю
    const jobView = (await req("GET", "/api/orders/jobs", null, td)).body.find((o) => o.id === oid);
    check("контакт заказчика раскрыт после match", jobView && jobView.customer?.telegram === "cust_tg");

    check("исполнитель завершает → finished", (await req("POST", `/api/orders/${oid}/finish`, {}, td)).body?.status === "finished");
    check("заказчик не может finish (403)", (await req("POST", `/api/orders/${oid}/finish`, {}, tc)).status === 403);
    check("заказчик подтверждает → done", (await req("POST", `/api/orders/${oid}/confirm`, {}, tc)).body?.status === "done");
    check("отзыв ставится", (await req("POST", `/api/orders/${oid}/review`, { rating: 5, text: "ок" }, tc)).body?.reviewed === true);
    // M1/M2: нельзя откликаться/принимать на закрытом (done) заказе
    check("отклик на закрытый заказ отклонён (409)", (await req("POST", `/api/orders/${oid}/bids`, { price: 1000, eta: "x" }, td)).status === 409);
    check("accept на закрытом заказе отклонён (404)", (await req("POST", `/api/orders/${oid}/accept`, { bidId: "nope" }, tc)).status === 404);
    // M3: возврат платы за отклик равен фактическому списанию
    const m3Order = await req("POST", "/api/orders", { cityId: "yakutsk", service: "water", from: "Мира 2", details: "вода", price: 3000, coordinates: [129.73, 62.03] }, tc);
    const m3Before = (await req("GET", "/api/wallet", null, td)).body.balance;
    await req("POST", `/api/orders/${m3Order.body.id}/bids`, { price: 2800, eta: "20м" }, td);
    const m3AfterBid = (await req("GET", "/api/wallet", null, td)).body.balance;
    await req("DELETE", `/api/orders/${m3Order.body.id}`, null, tc);
    const m3AfterRefund = (await req("GET", "/api/wallet", null, td)).body.balance;
    check("M3: возврат за отклик равен списанию", m3AfterBid === m3Before - 50 && m3AfterRefund === m3Before);
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

    // Техника исполнителя (ТТХ спецтехники по категории water)
    const eqAdd = await req("POST", "/api/equipment", { serviceKey: "water", title: "ГАЗ-53", specs: { volume: "4", waterType: "Питьевая", heated: true, junk: "x" } }, td);
    check("техника: добавлена", eqAdd.status === 201 && (eqAdd.body?.length || 0) === 1);
    check("техника: ТТХ очищены по схеме (число + мусор убран)", eqAdd.body?.[0]?.specs?.volume === 4 && eqAdd.body?.[0]?.specs?.junk === undefined && eqAdd.body?.[0]?.specs?.waterType === "Питьевая");
    const eqId = eqAdd.body[0].id;
    const eqBad = await req("POST", "/api/equipment", { serviceKey: "plumber_unknown", title: "x", specs: {} }, td);
    check("техника: неизвестная категория отклонена (400)", eqBad.status === 400);
    const eqUpd = await req("PATCH", `/api/equipment/${eqId}`, { title: "ГАЗ-53 (обновл.)", specs: { volume: 5, waterType: "Техническая", heated: false } }, td);
    check("техника: обновлена", eqUpd.body?.[0]?.title === "ГАЗ-53 (обновл.)" && eqUpd.body?.[0]?.specs?.volume === 5);
    const eqSelectBad = await req("POST", "/api/equipment", { serviceKey: "water", title: "y", specs: { waterType: "Газировка" } }, td);
    check("техника: недопустимое значение select отброшено", eqSelectBad.body?.[eqSelectBad.body.length - 1]?.specs?.waterType === undefined);

    // Витрина «Техника в наличии»: публикация → предложение видно заказчику
    check("витрина: до публикации пусто", ((await req("GET", "/api/offers?cityId=yakutsk", null, tc)).body?.length || 0) === 0);
    await req("PATCH", `/api/equipment/${eqId}`, { published: true, price: 3500, note: "по городу" }, td);
    const offers = await req("GET", "/api/offers?cityId=yakutsk", null, tc);
    check("витрина: предложение опубликовано", (offers.body?.length || 0) === 1 && offers.body[0].price === 3500 && offers.body[0].executor?.name === "Драйвер");
    check("витрина: ТТХ и категория в предложении", offers.body[0].serviceKey === "water" && offers.body[0].specs?.volume === 5);
    check("витрина: фильтр по услуге", ((await req("GET", "/api/offers?cityId=yakutsk&service=water", null, tc)).body?.length || 0) === 1);
    check("витрина: другой город не показывает", ((await req("GET", "/api/offers?cityId=ekaterinburg", null, tc)).body?.length || 0) === 0);
    await req("PATCH", `/api/equipment/${eqId}`, { published: false }, td);
    check("витрина: снятие с публикации", ((await req("GET", "/api/offers?cityId=yakutsk", null, tc)).body?.length || 0) === 0);

    // Заказчик видит публичный профиль исполнителя (портфолио + техника)
    const drvId = drv.body.account.id;
    const prof = await req("GET", `/api/executors/${drvId}`, null, tc);
    check("публичный профиль исполнителя", prof.body?.portfolio?.length === 1 && prof.body?.reviews?.length === 1);
    check("публичный профиль: без утечки контактов/баланса", prof.body?.email === undefined && prof.body?.phone === undefined && prof.body?.balance === undefined);
    check("публичный профиль: черновик (не опубликован) скрыт", (prof.body?.equipment?.length || 0) === 0);
    await req("PATCH", `/api/equipment/${eqId}`, { published: true }, td);
    const prof2 = await req("GET", `/api/executors/${drvId}`, null, tc);
    check("публичный профиль: опубликованная техника видна", (prof2.body?.equipment?.length || 0) >= 1 && prof2.body.equipment[0].specs.volume === 5);
    await req("PATCH", `/api/equipment/${eqId}`, { published: false }, td);

    // Аватар профиля + лимит фото ~2 МБ
    const smallPhoto = "data:image/png;base64," + "A".repeat(300);
    await req("PATCH", "/api/account", { avatar: smallPhoto }, td);
    check("аватар: сохранён и виден в профиле", ((await req("GET", `/api/executors/${drvId}`, null, tc)).body?.avatar || "").startsWith("data:"));
    check("аватар: имя не затёрлось при avatar-only save", (await req("GET", `/api/executors/${drvId}`, null, tc)).body?.name === "Драйвер");
    check("фото > 2 МБ отклонено (400)", (await req("PATCH", "/api/account", { avatar: "data:image/png;base64," + "A".repeat(3000000) }, td)).status === 400);
    await req("PATCH", "/api/account", { avatar: "" }, td);
    check("аватар: сброс пустой строкой", ((await req("GET", `/api/executors/${drvId}`, null, tc)).body?.avatar || "") === "");

    const eqDel = await req("DELETE", `/api/equipment/${eqId}`, null, td);
    check("техника: удалена", Array.isArray(eqDel.body) && !eqDel.body.some((e) => e.id === eqId));

    // Верификация по документу
    const photo = "data:image/png;base64," + "A".repeat(200);
    const vr = await req("POST", "/api/account/verification-request", { serviceKey: "welder", docType: "НАКС", photo }, td);
    check("заявка на верификацию создана", vr.status === 201 && vr.body?.status === "pending");
    check("исполнитель видит свою заявку", ((await req("GET", "/api/account/verification-requests", null, td)).body?.length || 0) === 1);
    check("повторная заявка по услуге запрещена (409)", (await req("POST", "/api/account/verification-request", { serviceKey: "welder", docType: "НАКС", photo }, td)).status === 409);

    // config отдаёт нишевые цены
    check("config: pricingRules присутствует", Array.isArray((await req("GET", "/api/config")).body?.pricingRules));

    // Монеты по нише (нужен админ)
    const adminReg = await req("POST", "/api/auth/register", { email: "admin_smoke@gmail.com", password: "pass123", name: "Админ", role: "client", cityId: "ekaterinburg" });
    const ta = adminReg.body.token;
    check("админ определён по ADMIN_EMAILS", adminReg.body?.account?.isAdmin === true);
    check("админ: грид цен непустой", ((await req("GET", "/api/admin/pricing", null, ta)).body?.grid?.length || 0) > 0);
    const an = await req("GET", "/api/admin/analytics?days=90", null, ta);
    check("аналитика: totals с оборотом", typeof an.body?.totals?.gmv === "number" && typeof an.body?.totals?.activeClients === "number");
    check("аналитика: услуги с GMV", Array.isArray(an.body?.byService) && an.body.byService.every((s) => typeof s.gmv === "number"));
    check("аналитика: категории и матрица", Array.isArray(an.body?.byCategory) && Array.isArray(an.body?.matrix));
    check("аналитика с фильтром города", (await req("GET", "/api/admin/analytics?days=90&cityId=yakutsk", null, ta)).body?.cityId === "yakutsk");
    check("админ: заявка на верификацию видна с фото", ((await req("GET", "/api/admin/verification-requests", null, ta)).body?.[0]?.photo || "").startsWith("data:"));
    await req("POST", "/api/admin/pricing", { cityId: "ekaterinburg", serviceKey: "water", coinCost: 25, enabled: true }, ta);

    // Фото техники + СТС-верификация (на свежей единице — прежнюю удалили выше)
    const eqAdd2 = await req("POST", "/api/equipment", { serviceKey: "crane", title: "Isuzu", specs: { boardCapacity: 5, craneCapacity: 3, boomLength: 12 }, photo }, td);
    const eq2 = eqAdd2.body.find((e) => e.title === "Isuzu").id;
    check("техника: фото сохранено при создании", ((await req("GET", "/api/equipment", null, td)).body.find((e) => e.id === eq2)?.photo || "").startsWith("data:"));
    const stsReq = await req("POST", `/api/equipment/${eq2}/verify-sts`, { photo }, td);
    check("СТС: заявка на проверку (pending)", stsReq.body.find((e) => e.id === eq2)?.verifyStatus === "pending");
    const eqQueue = await req("GET", "/api/admin/equipment-verifications", null, ta);
    check("СТС: админ видит технику в очереди с фото СТС", eqQueue.body.some((e) => e.id === eq2 && (e.stsPhoto || "").startsWith("data:")));
    check("СТС: не-админ в очередь не может (403)", (await req("GET", "/api/admin/equipment-verifications", null, td)).status === 403);
    await req("POST", `/api/admin/equipment-verifications/${eq2}`, { approve: true }, ta);
    check("СТС: после подтверждения verified", (await req("GET", "/api/equipment", null, td)).body.find((e) => e.id === eq2)?.verifyStatus === "verified");
    await req("PATCH", `/api/equipment/${eq2}`, { published: true }, td);
    const vOffers = (await req("GET", "/api/offers?cityId=yakutsk", null, tc)).body.find((o) => o.id === eq2);
    check("витрина: бейдж stsVerified + фото в offer", vOffers?.stsVerified === true && (vOffers?.photo || "").startsWith("data:"));
    check("витрина: фильтр verified=1 показывает", ((await req("GET", "/api/offers?cityId=yakutsk&verified=1", null, tc)).body || []).some((o) => o.id === eq2));

    // Витрина 2.0: обяз. ТТХ, скрытые контакты, контакт-по-тапу, запрос, жалоба, сброс СТС
    check("витрина: публикация без обяз. ТТХ отклонена (400)", (await req("POST", "/api/equipment", { serviceKey: "crane", title: "Пустой", specs: {}, published: true }, td)).status === 400);
    await req("PATCH", "/api/account", { telegram: "drv_tg" }, td);
    const off2 = (await req("GET", "/api/offers?cityId=yakutsk", null, tc)).body.find((o) => o.id === eq2);
    check("витрина: контакты скрыты, только флаги", off2 && off2.executor.phone === undefined && off2.executor.hasTelegram === true);
    check("витрина: занятость — свободен (available, не занят)", off2.executor.available === true && off2.executor.busy === false);
    await req("PATCH", "/api/account", { available: false }, td);
    check("витрина: занятость отражает «не на линии»", (await req("GET", "/api/offers?cityId=yakutsk", null, tc)).body.find((o) => o.id === eq2)?.executor.available === false);
    await req("PATCH", "/api/account", { available: true }, td);
    await req("PATCH", "/api/account", { busy: true }, td);
    check("витрина: ручной «занят» отражается", (await req("GET", "/api/offers?cityId=yakutsk", null, tc)).body.find((o) => o.id === eq2)?.executor.busy === true);
    await req("PATCH", "/api/account", { busy: false }, td);
    check("витрина: снятие «занят»", (await req("GET", "/api/offers?cityId=yakutsk", null, tc)).body.find((o) => o.id === eq2)?.executor.busy === false);
    const contactRes = await req("POST", `/api/offers/${eq2}/contact`, { channel: "telegram" }, tc);
    check("витрина: контакт раскрыт по тапу", contactRes.body?.telegram === "drv_tg");
    const reqRes = await req("POST", `/api/offers/${eq2}/request`, { cityId: "yakutsk", from: "Ленина 1", details: "нужен манипулятор", price: 5000 }, tc);
    check("витрина: запрос техники → заказ этому исполнителю (201)", reqRes.status === 201 && reqRes.body?.service === "crane");
    const cmp = await req("POST", `/api/offers/${eq2}/complaint`, { text: "фейк объявление" }, tc);
    check("витрина: жалоба на объявление (201, type=offer)", cmp.status === 201 && cmp.body?.type === "offer");
    check("админ: видит жалобу на объявление", (await req("GET", "/api/admin/complaints", null, ta)).body.some((c) => c.type === "offer"));
    // Подмена машины (правка ТТХ) сбрасывает СТС
    check("СТС: до правки verified", (await req("GET", "/api/equipment", null, td)).body.find((e) => e.id === eq2)?.verifyStatus === "verified");
    await req("PATCH", `/api/equipment/${eq2}`, { specs: { boardCapacity: 7, craneCapacity: 4, boomLength: 14 } }, td);
    check("СТС: сброшен после правки ТТХ", (await req("GET", "/api/equipment", null, td)).body.find((e) => e.id === eq2)?.verifyStatus === "none");

    await req("PATCH", `/api/equipment/${eq2}`, { published: false }, td);

    const drv2 = await req("POST", "/api/auth/register", { email: `e${stamp}@gmail.com`, password: "pass123", name: "Драйвер2", role: "driver", cityId: "ekaterinburg" }, null);
    const td2 = drv2.body.token;
    await req("PATCH", "/api/account", { services: ["water"], role: "driver", cityId: "ekaterinburg" }, td2);
    const korder = await req("POST", "/api/orders", { cityId: "ekaterinburg", service: "water", from: "Баумана 1", details: "вода", price: 3000, coordinates: [49.1, 55.8] }, ta);
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
      { cityId: "ekaterinburg", serviceKey: "dump", coinCost: 15, enabled: true }
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

    // Отмена заказа
    const o2 = (await req("POST", "/api/orders", { cityId: "yakutsk", service: "water", from: "Мира 5", details: "вода", price: 3000, coordinates: [129.73, 62.03] }, tc)).body.id;
    const cancelled = await req("POST", `/api/orders/${o2}/cancel`, { reason: "передумал" }, tc);
    check("отмена заказа → cancelled", cancelled.body?.status === "cancelled" && cancelled.body?.cancelReason === "передумал");

    // Выехал + позиция + finish из enroute + взаимный отзыв + жалоба
    const o3 = (await req("POST", "/api/orders", { cityId: "yakutsk", service: "water", from: "Лермонтова 1", details: "вода", price: 3500, coordinates: [129.74, 62.02] }, tc)).body.id;
    await req("POST", `/api/orders/${o3}/bids`, { price: 3400, eta: "30м" }, td);
    const bid3 = (await req("GET", "/api/orders/mine", null, tc)).body.find((o) => o.id === o3)?.bids?.[0]?.id;
    await req("POST", `/api/orders/${o3}/accept`, { bidId: bid3 }, tc);
    check("статус выехал (enroute)", (await req("POST", `/api/orders/${o3}/enroute`, {}, td)).body?.status === "enroute");
    check("координаты исполнителя приняты", (await req("POST", `/api/orders/${o3}/location`, { lng: 129.73, lat: 62.03 }, td)).body?.ok === true);
    check("заказ отдаёт execPos", ((await req("GET", "/api/orders/mine", null, tc)).body.find((o) => o.id === o3)?.execPos?.lat || 0) > 0);
    check("finish из enroute работает", (await req("POST", `/api/orders/${o3}/finish`, {}, td)).body?.status === "finished");
    await req("POST", `/api/orders/${o3}/confirm`, {}, tc);
    check("исполнитель оценил заказчика", (await req("POST", `/api/orders/${o3}/review-customer`, { rating: 5, text: "ок" }, td)).body?.reviewedCustomer === true);
    await req("POST", "/api/complaints", { orderId: o3, type: "other", text: "тест жалоба" }, td);
    check("админ видит жалобу", ((await req("GET", "/api/admin/complaints", null, ta)).body || []).some((c) => c.orderId === o3));

    // Реферальный код + быстрый вызов избранного + пополнение монет
    check("реферальный код выдаётся", (((await req("GET", "/api/referral-code", null, tc)).body?.code) || "").length > 0);
    await req("POST", `/api/favorites/${drvId2}`, {}, tc);
    check("быстрый вызов избранного создал заказ", (await req("POST", `/api/favorites/${drvId2}/quick-order`, { cityId: "yakutsk", service: "water", from: "Дом 1", details: "вода", price: 3000, coordinates: [129.73, 62.03] }, tc)).status === 201);
    const balB = (await req("GET", "/api/wallet", null, td)).body?.balance ?? 0;
    await req("POST", "/api/wallet/topup", { amount: 30 }, td);
    check("пополнение монет (dev, +30)", ((await req("GET", "/api/wallet", null, td)).body?.balance ?? 0) === balB + 30);

    // OTP: без сконфигурированных каналов — dev-режим (channel="dev" + devCode)
    const otp = await req("POST", "/api/auth/request-otp", { phone: "89007778899" });
    check("OTP: dev-канал + devCode", otp.body?.channel === "dev" && typeof otp.body?.devCode === "string");

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
