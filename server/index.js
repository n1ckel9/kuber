const express = require("express");
const repo = require("./db");
const { hashPassword, verifyPassword, createToken } = require("./auth");
const { geocodeAddress, suggestAddress, reverseGeocode } = require("./geocode");

const PORT = Number(process.env.PORT || 4000);
// Монетизация (по умолчанию выключена). Базовые значения из окружения,
// в dev-режиме переопределяются через настройки в БД (PATCH /api/config).
const ENV_BID_FEE = Math.max(0, Number(process.env.BID_FEE || 0));
const ENV_BID_PERCENT = Math.max(0, Number(process.env.BID_PERCENT || 0));
const SIGNUP_BONUS = Math.max(0, Number(process.env.SIGNUP_BONUS || 0));
// Админы по email (через запятую). Пример: ADMIN_EMAILS=admin@gmail.com
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const app = express();

app.use(express.json());
app.set("trust proxy", true);

// CORS. По умолчанию * (dev); в проде задать CORS_ORIGIN=https://your.app
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Лог запросов (включается переменной LOG=1) — для отладки.
if (process.env.LOG) {
  app.use((req, res, next) => {
    const t = Date.now();
    res.on("finish", () => console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - t}ms`));
    next();
  });
}

// Простой in-memory rate-limit по IP+маршруту (без внешних зависимостей).
const rateBuckets = new Map();
function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.reset) {
      bucket = { count: 0, reset: now + windowMs };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ error: "rate_limited", message: "Слишком много запросов, попробуйте позже" });
    }
    next();
  };
}
// Периодическая очистка истёкших корзин.
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of rateBuckets) {
    if (now > b.reset) {
      rateBuckets.delete(key);
    }
  }
}, 5 * 60 * 1000);

function makeId(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function normalizePhone(input) {
  let d = String(input || "").replace(/\D/g, "");
  if (d.startsWith("8")) {
    d = "7" + d.slice(1);
  }
  if (!d.startsWith("7")) {
    d = "7" + d;
  }
  return d.slice(0, 11);
}

// Отправка push через Expo Push API (fire-and-forget). На web/без токенов — no-op.
function sendPush(accountId, text) {
  try {
    const tokens = repo.getPushTokens(accountId).filter((t) => t.startsWith("ExponentPushToken"));
    if (tokens.length === 0) {
      return;
    }
    const messages = tokens.map((to) => ({ to, sound: "default", title: "Кубер", body: text }));
    void fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages)
    }).catch(() => {});
  } catch {
    // push не критичен
  }
}

function notify(accountId, type, text, orderId) {
  if (!accountId) {
    return;
  }
  repo.addNotification({ id: makeId("n_"), accountId, type, text, orderId, createdAt: Date.now() });
  sendPush(accountId, text);
}

function bearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

// Добавляет признак админа по списку ADMIN_EMAILS.
function withAdmin(account) {
  if (!account) {
    return account;
  }
  return { ...account, isAdmin: ADMIN_EMAILS.includes((account.email || "").toLowerCase()) };
}

// Требует валидный токен; кладёт аккаунт в req.account.
function requireAuth(req, res, next) {
  const account = repo.getAccountByToken(bearerToken(req));
  if (!account) {
    return res.status(401).json({ error: "unauthorized" });
  }
  req.account = withAdmin(account);
  next();
}

function requireAdmin(req, res, next) {
  if (!req.account?.isAdmin) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}

// Расстояние по большому кругу между двумя точками [lng, lat], км.
function haversineKm([lng1, lat1], [lng2, lat2]) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatDistance(km) {
  if (!Number.isFinite(km)) {
    return "—";
  }
  return km < 1 ? `${Math.round(km * 1000)} м` : `${km.toFixed(km < 10 ? 1 : 0)} км`;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "vodovoz-api" });
});

// Эффективная конфигурация монетизации: настройки из БД важнее env.
function effectiveConfig() {
  const fee = repo.getSetting("bidFee");
  const percent = repo.getSetting("bidPercent");
  return {
    bidFee: fee !== null ? Math.max(0, Number(fee)) : ENV_BID_FEE,
    bidPercent: percent !== null ? Math.max(0, Number(percent)) : ENV_BID_PERCENT
  };
}

// Стоимость отклика на конкретный заказ: фикс + процент от цены заказа.
function bidCost(orderPrice) {
  const cfg = effectiveConfig();
  return cfg.bidFee + Math.round((orderPrice * cfg.bidPercent) / 100);
}

// Возврат платы за отклик исполнителю (при отклонении/удалении/проигрыше).
function refundBidFee(driverId, orderPrice, orderId) {
  if (!driverId) {
    return;
  }
  const fee = bidCost(orderPrice);
  if (fee <= 0) {
    return;
  }
  repo.credit(driverId, {
    id: makeId("t_"),
    amount: fee,
    type: "refund",
    note: `Возврат за отклик #${orderId}`,
    createdAt: Date.now()
  });
  notify(driverId, "refund", `Возврат ${fee} ₽ за отклик`, orderId);
}

// Публичный конфиг для клиента (цена отклика и т.п.).
app.get("/api/config", (req, res) => {
  res.json(effectiveConfig());
});

// Изменение конфигурации монетизации (dev). Доступно любому авторизованному —
// на клиенте скрыто за dev-режимом; для прод нужна роль администратора.
app.patch("/api/config", requireAuth, requireAdmin, (req, res) => {
  const body = req.body ?? {};
  if (body.bidFee !== undefined) {
    repo.setSetting("bidFee", Math.max(0, Math.round(Number(body.bidFee) || 0)));
  }
  if (body.bidPercent !== undefined) {
    repo.setSetting("bidPercent", Math.max(0, Math.min(50, Number(body.bidPercent) || 0)));
  }
  res.json(effectiveConfig());
});

// --- Справочник -------------------------------------------------------------

app.get("/api/catalog", (req, res) => {
  res.json(repo.getCatalog());
});

app.get("/api/cities", (req, res) => {
  const { regionId } = req.query;
  const { cities } = repo.getCatalog();
  res.json(regionId ? cities.filter((city) => city.regionId === regionId) : cities);
});

app.get("/api/services", (req, res) => {
  const { cityId } = req.query;
  const { cities, services } = repo.getCatalog();
  if (!cityId) {
    return res.json(services);
  }
  const city = cities.find((item) => item.id === cityId);
  if (!city) {
    return res.status(404).json({ error: "city_not_found" });
  }
  res.json(services.filter((service) => city.services.includes(service.key)));
});

// --- Авторизация ------------------------------------------------------------

app.post("/api/auth/register", rateLimit({ windowMs: 60000, max: 10 }), (req, res) => {
  const body = req.body ?? {};
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim().slice(0, 80);
  const role = body.role === "driver" ? "driver" : "client";
  const cityId = body.cityId || "yakutsk";

  if (!email.endsWith("@gmail.com")) {
    return res.status(400).json({ error: "invalid_email", message: "Нужен адрес @gmail.com" });
  }
  if (!name) {
    return res.status(400).json({ error: "invalid_name", message: "Укажите имя" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "weak_password", message: "Пароль от 6 символов" });
  }
  if (repo.getAccountRowByEmail(email)) {
    return res.status(409).json({ error: "email_taken", message: "Аккаунт уже существует" });
  }

  const account = repo.createAccount({
    id: makeId("u_"),
    email,
    name,
    role,
    cityId,
    passwordHash: hashPassword(password),
    createdAt: Date.now()
  });

  // Приветственный бонус на кошелёк (если включён) — чтобы первые отклики были бесплатными.
  let finalAccount = account;
  if (SIGNUP_BONUS > 0) {
    repo.credit(account.id, {
      id: makeId("t_"),
      amount: SIGNUP_BONUS,
      type: "bonus",
      note: "Приветственный бонус",
      createdAt: Date.now()
    });
    finalAccount = repo.toPublicAccount(repo.getAccountRowByEmail(email));
  }

  const token = createToken();
  repo.createSession(token, account.id, Date.now());
  res.status(201).json({ token, account: withAdmin(finalAccount) });
});

app.post("/api/auth/login", rateLimit({ windowMs: 60000, max: 20 }), (req, res) => {
  const body = req.body ?? {};
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  const row = repo.getAccountRowByEmail(email);
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: "invalid_credentials", message: "Неверная почта или пароль" });
  }

  const token = createToken();
  repo.createSession(token, row.id, Date.now());
  res.json({ token, account: withAdmin(repo.toPublicAccount(row)) });
});

// --- Вход по телефону (одноразовый код) ---
// ЗАГЛУШКА отправки SMS: код пишется в лог и (в dev) возвращается клиенту.
// В бою заменить на SMS-провайдера (SMS.ru / Twilio).
app.post("/api/auth/request-otp", rateLimit({ windowMs: 60000, max: 5 }), (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (phone.length !== 11) {
    return res.status(400).json({ error: "invalid_phone", message: "Введите корректный номер" });
  }
  const code = String(Math.floor(1000 + Math.random() * 9000));
  repo.setOtp(phone, code, Date.now() + 5 * 60 * 1000);
  console.log(`OTP для +${phone}: ${code}`);
  const dev = process.env.NODE_ENV !== "production";
  res.json({ sent: true, ...(dev ? { devCode: code } : {}) });
});

app.post("/api/auth/verify-otp", rateLimit({ windowMs: 60000, max: 15 }), (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = String(req.body?.code || "").trim();
  const row = repo.getOtp(phone);
  if (!row || row.expires_at < Date.now()) {
    return res.status(401).json({ error: "invalid_code", message: "Код не найден или истёк" });
  }
  if (row.code !== code) {
    // Защита от перебора: 5 неверных попыток — код сгорает.
    const attempts = repo.bumpOtpAttempts(phone);
    if (attempts >= 5) {
      repo.deleteOtp(phone);
      return res.status(429).json({ error: "too_many_attempts", message: "Слишком много попыток. Запросите новый код." });
    }
    return res.status(401).json({ error: "invalid_code", message: "Неверный код" });
  }
  repo.deleteOtp(phone);

  let account = repo.getAccountRowByPhone(phone);
  let pub;
  if (account) {
    pub = repo.toPublicAccount(account);
  } else {
    pub = repo.createPhoneAccount({
      id: makeId("u_"),
      phone,
      name: `+${phone}`,
      role: "client",
      cityId: "yakutsk",
      createdAt: Date.now()
    });
    if (SIGNUP_BONUS > 0) {
      repo.credit(pub.id, {
        id: makeId("t_"),
        amount: SIGNUP_BONUS,
        type: "bonus",
        note: "Приветственный бонус",
        createdAt: Date.now()
      });
      pub = repo.getAccount(pub.id);
    }
  }
  const token = createToken();
  repo.createSession(token, pub.id, Date.now());
  res.json({ token, account: withAdmin(pub) });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json(req.account);
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  repo.deleteSession(bearerToken(req));
  res.json({ ok: true });
});

// Обновление профиля (имя, роль, город, контакт, специализации).
app.patch("/api/account", requireAuth, (req, res) => {
  const body = req.body ?? {};
  const name = String(body.name || req.account.name).trim().slice(0, 80);
  const role = body.role === "driver" ? "driver" : body.role === "client" ? "client" : req.account.role;
  const cityId = body.cityId || req.account.cityId;
  const phone = body.phone !== undefined ? normalizePhone(body.phone) : undefined;
  const telegram = body.telegram !== undefined ? String(body.telegram).trim() : undefined;
  const services = Array.isArray(body.services)
    ? body.services.map((s) => String(s)).slice(0, 20)
    : undefined;
  const radiusKm = body.radiusKm !== undefined ? Number(body.radiusKm) : undefined;
  const available = body.available !== undefined ? Boolean(body.available) : undefined;
  res.json(
    repo.updateProfile(req.account.id, {
      name,
      role,
      cityId,
      phone,
      telegram,
      services,
      radiusKm,
      available
    })
  );
});

// --- Заказы и ставки --------------------------------------------------------

// Геокодирование адреса в координаты (для предпросмотра точки на карте).
app.get("/api/geocode", rateLimit({ windowMs: 60000, max: 60 }), requireAuth, async (req, res) => {
  const query = String(req.query.q || "");
  const city = req.query.cityId ? repo.getCity(req.query.cityId) : null;
  const result = await geocodeAddress(query, city ? city.name : "");
  if (!result) {
    return res.status(404).json({ error: "not_found" });
  }
  res.json(result);
});

// Подсказки адреса по мере ввода.
app.get("/api/geocode/suggest", rateLimit({ windowMs: 60000, max: 90 }), requireAuth, async (req, res) => {
  const query = String(req.query.q || "");
  const city = req.query.cityId ? repo.getCity(req.query.cityId) : null;
  res.json(await suggestAddress(query, city ? city.name : ""));
});

// Обратное геокодирование: координаты → адрес.
app.get("/api/geocode/reverse", rateLimit({ windowMs: 60000, max: 60 }), requireAuth, async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const result = await reverseGeocode(lat, lng);
  if (!result) {
    return res.status(404).json({ error: "not_found" });
  }
  res.json(result);
});

app.get("/api/orders", (req, res) => {
  const cityId = req.query.cityId || "yakutsk";
  // open=1 — только открытые (лента исполнителя).
  res.json(req.query.open === "1" ? repo.listOpenOrders(cityId) : repo.listOrders(cityId));
});

// Заказы текущего пользователя (лента заказчика).
app.get("/api/orders/mine", requireAuth, (req, res) => {
  res.json(repo.listOrdersByCustomer(req.account.id));
});

// Биржа исполнителя: открытые заказы его города по его специализациям.
// Если исполнитель «не на линии» (available=false) — лента пустая.
app.get("/api/orders/bourse", requireAuth, (req, res) => {
  if (req.account.available === false) {
    return res.json([]);
  }
  res.json(repo.listBourse(req.account.cityId, req.account.services || []));
});

// Статистика исполнителя (заработок, число выполненных).
app.get("/api/stats", requireAuth, (req, res) => {
  res.json(repo.getExecutorStats(req.account.id));
});

// Исполнитель запрашивает верификацию → уходит на модерацию админу.
app.post("/api/account/verify", requireAuth, (req, res) => {
  res.json(withAdmin(repo.requestVerification(req.account.id)));
});

// --- Админ: модерация ---
app.get("/api/admin/verifications", requireAuth, requireAdmin, (req, res) => {
  res.json(repo.listPendingVerifications());
});

app.post("/api/admin/verifications/:id", requireAuth, requireAdmin, (req, res) => {
  const account = repo.decideVerification(req.params.id, Boolean(req.body?.approve));
  if (account) {
    notify(
      req.params.id,
      "verify",
      req.body?.approve ? "Ваш аккаунт верифицирован ✓" : "Заявка на верификацию отклонена",
      ""
    );
  }
  res.json(account);
});

app.get("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  res.json(repo.listUsers());
});

// --- Регулярная доставка (расписания) ---
app.get("/api/schedules", requireAuth, (req, res) => {
  res.json(repo.listSchedules(req.account.id));
});

app.post("/api/schedules", requireAuth, (req, res) => {
  const body = req.body ?? {};
  const city = repo.getCity(body.cityId);
  const price = Number(body.price);
  const intervalDays = Math.max(1, Math.round(Number(body.intervalDays) || 7));
  const from = String(body.from || "").trim().slice(0, 300);
  const details = String(body.details || "").trim().slice(0, 2000);
  if (!city || !from || !details || !(price > 0)) {
    return res.status(400).json({ error: "invalid_schedule" });
  }
  const coords =
    Array.isArray(body.coordinates) && body.coordinates.length === 2
      ? body.coordinates
      : [city.center_lng, city.center_lat];
  const created = repo.createSchedule({
    id: makeId("s_"),
    customerId: req.account.id,
    cityId: city.id,
    service: body.service || "water",
    from,
    details,
    price,
    lng: coords[0],
    lat: coords[1],
    intervalDays,
    nextRun: Date.now() + intervalDays * 86400000,
    createdAt: Date.now()
  });
  res.status(201).json(created);
});

app.delete("/api/schedules/:id", requireAuth, (req, res) => {
  repo.deleteSchedule(req.params.id, req.account.id);
  res.json({ ok: true });
});

// Избранные исполнители заказчика.
app.get("/api/favorites", requireAuth, (req, res) => {
  res.json(repo.listFavorites(req.account.id));
});

app.post("/api/favorites/:executorId", requireAuth, (req, res) => {
  const favorite = repo.toggleFavorite(req.account.id, req.params.executorId);
  res.json({ favorite });
});

// Заказы, которые исполнитель выиграл (в работе/выполненные).
app.get("/api/orders/jobs", requireAuth, (req, res) => {
  res.json(repo.listOrdersByExecutor(req.account.id));
});

// Уведомления (колокольчик).
app.get("/api/notifications", requireAuth, (req, res) => {
  res.json(repo.listNotifications(req.account.id));
});

app.post("/api/notifications/read", requireAuth, (req, res) => {
  repo.markNotificationsRead(req.account.id);
  res.json(repo.listNotifications(req.account.id));
});

// Регистрация push-токена устройства (Expo).
app.post("/api/push/token", requireAuth, (req, res) => {
  const token = String(req.body?.token || "").trim();
  if (!token) {
    return res.status(400).json({ error: "no_token" });
  }
  repo.savePushToken(req.account.id, token, Date.now());
  res.json({ ok: true });
});

// Кошелёк: баланс и история.
app.get("/api/wallet", requireAuth, (req, res) => {
  res.json(repo.getWallet(req.account.id));
});

// Пополнение баланса. ЗАГЛУШКА: зачисляет мгновенно. Перед боевым запуском —
// заменить на вебхук платёжного провайдера (ЮKassa/CloudPayments) + чек 54-ФЗ.
app.post("/api/wallet/topup", requireAuth, (req, res) => {
  const amount = Math.round(Number(req.body?.amount) || 0);
  if (amount <= 0 || amount > 100000) {
    return res.status(400).json({ error: "invalid_amount" });
  }
  repo.credit(req.account.id, {
    id: makeId("t_"),
    amount,
    type: "topup",
    note: "Пополнение (тест)",
    createdAt: Date.now()
  });
  res.json(repo.getWallet(req.account.id));
});

// Вывод средств. ЗАГЛУШКА. В бою — выплата на карту/счёт через провайдера.
app.post("/api/wallet/withdraw", requireAuth, (req, res) => {
  const amount = Math.round(Number(req.body?.amount) || 0);
  if (amount <= 0) {
    return res.status(400).json({ error: "invalid_amount" });
  }
  const result = repo.withdraw(req.account.id, {
    id: makeId("t_"),
    amount,
    note: "Вывод средств (тест)",
    createdAt: Date.now()
  });
  if (!result.ok) {
    return res.status(402).json({ error: "insufficient_funds", message: "Недостаточно средств для вывода" });
  }
  res.json(repo.getWallet(req.account.id));
});

app.post("/api/orders", requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const price = Number(body.price);
  const city = repo.getCity(body.cityId);

  if (!city) {
    return res.status(400).json({ error: "invalid_city" });
  }

  const fromText = String(body.from || "").trim().slice(0, 300);
  const details = String(body.details || "").trim().slice(0, 2000);

  if (!fromText || !details || !(price > 0)) {
    return res.status(400).json({ error: "invalid_order" });
  }

  // Координаты: либо точка, выбранная клиентом на карте, либо геокодирование
  // адреса, либо (если ничего не вышло) центр города.
  let coordinates = null;
  if (Array.isArray(body.coordinates) && body.coordinates.length === 2) {
    coordinates = body.coordinates;
  } else {
    const geo = await geocodeAddress(fromText, city.name);
    if (geo) {
      coordinates = [geo.lng, geo.lat];
    }
  }
  if (!coordinates) {
    coordinates = [city.center_lng, city.center_lat];
  }

  const distanceKm = haversineKm([city.center_lng, city.center_lat], coordinates);
  const order = {
    id: makeId("o_"),
    cityId: city.id,
    customerId: req.account.id,
    service: body.service || "water",
    from: fromText,
    details,
    price,
    distance: formatDistance(distanceKm),
    status: "open",
    lng: coordinates[0],
    lat: coordinates[1],
    customerName: req.account.name,
    createdAt: Date.now()
  };

  try {
    res.status(201).json(repo.insertOrder(order));
  } catch (error) {
    res.status(500).json({ error: "server_error", message: error.message });
  }
});

app.post("/api/orders/:orderId/bids", requireAuth, (req, res) => {
  const body = req.body ?? {};
  const order = repo.getOrder(req.params.orderId);
  const price = Number(body.price);

  if (!order || !(price > 0)) {
    return res.status(400).json({ error: "invalid_bid" });
  }

  // Нельзя откликнуться дважды на один заказ.
  if (repo.hasBid(order.id, req.account.id)) {
    return res.status(409).json({ error: "already_bid", message: "Вы уже откликнулись на этот заказ" });
  }

  // Плата за отклик (если включена монетизация): фикс + % от суммы заказа.
  const fee = bidCost(order.price);
  if (fee > 0) {
    const charge = repo.chargeForBid(req.account.id, {
      id: makeId("t_"),
      fee,
      note: `Отклик на заказ #${order.id}`,
      createdAt: Date.now()
    });
    if (!charge.ok) {
      return res.status(402).json({
        error: "insufficient_funds",
        message: `Недостаточно средств: отклик стоит ${fee} ₽. Пополните баланс.`
      });
    }
  }

  const bid = {
    id: makeId("b_"),
    orderId: order.id,
    driverId: req.account.id,
    driver: req.account.name,
    price,
    eta: String(body.eta || "40 мин").trim(),
    rating: req.account.rating || 4.9,
    createdAt: Date.now()
  };

  const created = repo.insertBid(bid);
  notify(order.customerId, "bid", `Новый отклик от «${req.account.name}» на заявку`, order.id);
  res.status(201).json(created);
});

app.post("/api/orders/:orderId/accept", requireAuth, (req, res) => {
  const body = req.body ?? {};
  const order = repo.getOrderRow(req.params.orderId);
  if (!order || order.customer_id !== req.account.id) {
    return res.status(403).json({ error: "forbidden" });
  }
  // Кого выбрали — до изменения заказа.
  const before = repo.getOrder(req.params.orderId);
  const acceptedDriverId = before?.bids.find((b) => b.id === body.bidId)?.driverId;

  const updated = repo.acceptBid(req.params.orderId, body.bidId);
  if (!updated) {
    return res.status(404).json({ error: "not_found" });
  }
  // Возврат платы тем, кого не выбрали.
  for (const bid of before?.bids ?? []) {
    if (bid.driverId && bid.driverId !== acceptedDriverId) {
      refundBidFee(bid.driverId, order.price, updated.id);
    }
  }
  notify(updated.executor?.id, "accepted", "Ваш отклик принят — приступайте к заказу", updated.id);
  res.json(updated);
});

// Отклонить отклик (владелец, заказ открыт).
app.delete("/api/orders/:orderId/bids/:bidId", requireAuth, (req, res) => {
  const order = repo.getOrderRow(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: "not_found" });
  }
  if (order.customer_id !== req.account.id) {
    return res.status(403).json({ error: "forbidden" });
  }
  const full = repo.getOrder(req.params.orderId);
  const rejected = full?.bids.find((b) => b.id === req.params.bidId);
  const updated = repo.deleteBid(req.params.orderId, req.params.bidId);
  if (rejected?.driverId) {
    notify(rejected.driverId, "rejected", "Ваш отклик отклонён заказчиком", req.params.orderId);
    refundBidFee(rejected.driverId, order.price, req.params.orderId);
  }
  res.json(updated);
});

// --- Чат по заказу (доступен заказчику и выбранному исполнителю) ---
function isParticipant(order, accountId) {
  return order.customer_id === accountId || order.executor_id === accountId;
}

app.get("/api/orders/:orderId/messages", requireAuth, (req, res) => {
  const order = repo.getOrderRow(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: "not_found" });
  }
  if (!isParticipant(order, req.account.id)) {
    return res.status(403).json({ error: "forbidden" });
  }
  res.json(repo.listMessages(order.id));
});

app.post("/api/orders/:orderId/messages", requireAuth, (req, res) => {
  const order = repo.getOrderRow(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: "not_found" });
  }
  if (!isParticipant(order, req.account.id)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const text = String(req.body?.text || "").trim().slice(0, 1000);
  if (!text) {
    return res.status(400).json({ error: "empty" });
  }
  const message = repo.addMessage({
    id: makeId("m_"),
    orderId: order.id,
    fromId: req.account.id,
    text,
    createdAt: Date.now()
  });
  // Уведомляем вторую сторону.
  const other = order.customer_id === req.account.id ? order.executor_id : order.customer_id;
  notify(other, "message", `Новое сообщение: ${text.slice(0, 40)}`, order.id);
  res.status(201).json(message);
});

// Удаление заявки (только владелец).
app.delete("/api/orders/:orderId", requireAuth, (req, res) => {
  const order = repo.getOrderRow(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: "not_found" });
  }
  if (order.customer_id !== req.account.id) {
    return res.status(403).json({ error: "forbidden" });
  }
  // Возврат платы откликнувшимся исполнителям перед удалением.
  const full = repo.getOrder(req.params.orderId);
  for (const bid of full?.bids ?? []) {
    refundBidFee(bid.driverId, order.price, req.params.orderId);
  }
  repo.deleteOrder(req.params.orderId);
  res.json({ ok: true });
});

// Исполнитель отметил заказ выполненным (заказ в работе) → ждём подтверждения.
app.post("/api/orders/:orderId/finish", requireAuth, (req, res) => {
  const order = repo.getOrderRow(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: "not_found" });
  }
  if (order.executor_id !== req.account.id) {
    return res.status(403).json({ error: "forbidden" });
  }
  if (order.status !== "matched") {
    return res.status(400).json({ error: "not_in_progress" });
  }
  const updated = repo.finishOrder(req.params.orderId);
  notify(order.customer_id, "finished", "Исполнитель завершил заказ — подтвердите выполнение", order.id);
  res.json(updated);
});

// Заказчик подтвердил выполнение → заказ закрыт, можно оставить отзыв.
app.post("/api/orders/:orderId/confirm", requireAuth, (req, res) => {
  const order = repo.getOrderRow(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: "not_found" });
  }
  if (order.customer_id !== req.account.id) {
    return res.status(403).json({ error: "forbidden" });
  }
  if (order.status !== "finished") {
    return res.status(400).json({ error: "not_finished" });
  }
  const updated = repo.confirmOrder(req.params.orderId);
  notify(order.executor_id, "confirmed", "Заказчик подтвердил выполнение заказа", order.id);
  res.json(updated);
});

// Отзыв об исполнителе (владелец, заказ выполнен и ещё не оценён).
app.post("/api/orders/:orderId/review", requireAuth, (req, res) => {
  const order = repo.getOrderRow(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: "not_found" });
  }
  if (order.customer_id !== req.account.id) {
    return res.status(403).json({ error: "forbidden" });
  }
  if (order.status !== "done") {
    return res.status(400).json({ error: "not_done" });
  }
  if (order.reviewed) {
    return res.status(400).json({ error: "already_reviewed" });
  }
  if (!order.executor_id) {
    return res.status(400).json({ error: "no_executor" });
  }
  const rating = Math.max(1, Math.min(5, Math.round(Number(req.body?.rating) || 0)));
  if (!rating) {
    return res.status(400).json({ error: "invalid_rating" });
  }
  const reviewed = repo.addReview({
    id: makeId("r_"),
    orderId: order.id,
    fromId: req.account.id,
    toId: order.executor_id,
    rating,
    text: String(req.body?.text || "").trim().slice(0, 500),
    createdAt: Date.now()
  });
  notify(order.executor_id, "review", `Вам поставили оценку ${rating}★`, order.id);
  res.json(reviewed);
});

app.use((req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.use((err, req, res, next) => {
  console.error(`API error [${req.method} ${req.path}]:`, err);
  res.status(500).json({ error: "server_error", message: err.message });
});

// Генератор регулярной доставки: создаёт заказы по наступившим расписаниям.
let schedulesBusy = false;
function runSchedules() {
  if (schedulesBusy) {
    return; // защита от наложения тиков
  }
  schedulesBusy = true;
  try {
    const due = repo.dueSchedules(Date.now());
    for (const s of due) {
      const city = repo.getCity(s.city_id);
      const center = city ? [city.center_lng, city.center_lat] : [s.lng, s.lat];
      const customer = repo.getAccount(s.customer_id);
      repo.insertOrder({
        id: makeId("o_"),
        cityId: s.city_id,
        customerId: s.customer_id,
        service: s.service,
        from: s.from_text,
        details: s.details,
        price: s.price,
        distance: formatDistance(haversineKm(center, [s.lng, s.lat])),
        status: "open",
        lng: s.lng,
        lat: s.lat,
        customerName: customer?.name || "Гость",
        createdAt: Date.now()
      });
      // Следующий запуск считаем от текущего момента, чтобы просроченное
      // расписание не плодило заказы каждую минуту.
      repo.bumpSchedule(s.id, Date.now() + s.interval_days * 86400000);
      notify(s.customer_id, "schedule", "Создан плановый заказ по расписанию", "");
    }
  } catch (e) {
    console.error("runSchedules error:", e.message);
  } finally {
    schedulesBusy = false;
  }
}

setInterval(runSchedules, 60000);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Vodovoz API is running on http://0.0.0.0:${PORT}`);
  runSchedules();
});
