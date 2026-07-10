const express = require("express");
const repo = require("./db");
const { hashPassword, verifyPassword, createToken } = require("./auth");
const { geocodeAddress, suggestAddress, reverseGeocode } = require("./geocode");
const { sendCode, anyChannelEnabled } = require("./sms");
const equipmentSpecs = require("./equipmentSpecs.json");

const PORT = Number(process.env.PORT || 4000);
// Бонус пригласившему за первый выполненный заказ приглашённого (монеты).
const REFERRAL_BONUS = Math.max(0, Number(process.env.REFERRAL_BONUS || 50));
// Платежи ЮKassa (пополнение монет). 1 монета = COIN_RATE ₽.
const COIN_RATE = 10;
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET = process.env.YOOKASSA_SECRET;
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

// Лимит поднят до 8mb: фото документов/работ приходят как base64 data-URL в JSON.
app.use(express.json({ limit: "8mb" }));
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

// Лимит фото ~2 МБ картинки. base64 раздувает на ~33%, поэтому по длине data-URL ~2.8 МБ.
const MAX_PHOTO_BYTES = Math.round(2.8 * 1024 * 1024);
// Проверка фото-строки: base64 data-URL картинки разумного размера.
function isValidPhoto(value) {
  return (
    typeof value === "string" &&
    value.startsWith("data:image/") &&
    value.length > 100 &&
    value.length < MAX_PHOTO_BYTES
  );
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
  if (account.banned) {
    return res.status(403).json({ error: "forbidden_banned", message: "Аккаунт заблокирован" });
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

// Стоимость отклика в монетах. Приоритет — нишевая цена (город × услуга);
// если для ниши плата не включена, используется глобальный dev-тариф (fallback).
// Принимает объект заказа {cityId, service, price} или число (обратная совместимость).
function bidCost(order) {
  if (typeof order === "number") {
    const cfg = effectiveConfig();
    return cfg.bidFee + Math.round((order * cfg.bidPercent) / 100);
  }
  const rule = repo.getPricingRule(order.cityId, order.service);
  if (rule && rule.enabled) {
    return Math.max(0, rule.coin_cost);
  }
  const cfg = effectiveConfig();
  return cfg.bidFee + Math.round(((order.price || 0) * cfg.bidPercent) / 100);
}

// Приводит строку заказа (snake_case) к объекту для bidCost.
function orderRowForCost(row) {
  return { cityId: row.city_id, service: row.service, price: row.price };
}

// Возврат платы за отклик исполнителю (при отклонении/удалении/проигрыше).
// fee — фактически списанная при отклике сумма (хранится на строке отклика),
// чтобы возврат не расходился со списанием при смене нишевого тарифа.
function refundBidFee(driverId, fee, orderId) {
  if (!driverId || !(fee > 0)) {
    return;
  }
  repo.credit(driverId, {
    id: makeId("t_"),
    amount: fee,
    type: "refund",
    note: `Возврат за отклик #${orderId}`,
    createdAt: Date.now()
  });
  notify(driverId, "refund", `Возврат ${fee} монет за отклик`, orderId);
}

// Публичный конфиг для клиента: глобальный тариф + включённые нишевые цены.
app.get("/api/config", (req, res) => {
  const rules = repo.listPricingRules().filter((r) => r.enabled);
  res.json({
    ...effectiveConfig(),
    // компактно: c=cityId, s=serviceKey, p=coinCost
    pricingRules: rules.map((r) => ({ c: r.cityId, s: r.serviceKey, p: r.coinCost }))
  });
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

// Подсказка цены по нише (город × услуга) — публично, для формы заявки.
app.get("/api/price-hint", (req, res) => {
  const cityId = String(req.query.cityId || "");
  const service = String(req.query.service || "");
  if (!cityId || !service) {
    return res.status(400).json({ error: "missing_params" });
  }
  const hint = repo.getPriceHint(cityId, service);
  res.json(hint || { count: 0 });
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

  // Реферальный код (если ввёл при регистрации) — привязываем пригласившего.
  const referralCode = String(body.referralCode || "").trim();
  if (referralCode) {
    repo.applyReferralCode(account.id, referralCode);
  }

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
// Код доставляется первым доступным каналом (Telegram/WhatsApp/MAX/SMS).
// Если ни один канал не сконфигурирован — dev-режим: код в логе + devCode в ответе.
app.post("/api/auth/request-otp", rateLimit({ windowMs: 60000, max: 5 }), async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (phone.length !== 11) {
    return res.status(400).json({ error: "invalid_phone", message: "Введите корректный номер" });
  }
  const code = String(Math.floor(1000 + Math.random() * 9000));
  repo.setOtp(phone, code, Date.now() + 5 * 60 * 1000);
  const result = await sendCode(phone, code);
  const dev = process.env.NODE_ENV !== "production";
  // devCode отдаём только когда реальные каналы выключены; channel — куда ушёл код.
  res.json({
    sent: true,
    channel: result.channel,
    channelLabel: result.channelLabel,
    ...(dev && !anyChannelEnabled ? { devCode: code } : {})
  });
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
    const referralCode = String(req.body?.referralCode || "").trim();
    if (referralCode) {
      repo.applyReferralCode(pub.id, referralCode);
    }
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
  // Аватар: base64 data-URL (валидируем размер) либо пустая строка (сбросить). undefined — не менять.
  let avatar;
  if (body.avatar !== undefined) {
    const raw = String(body.avatar || "").trim();
    if (raw && !(raw.startsWith("data:") && isValidPhoto(raw))) {
      return res.status(400).json({ error: "invalid_photo", message: "Фото профиля до 2 МБ" });
    }
    avatar = raw;
  }
  res.json(
    repo.updateProfile(req.account.id, {
      name,
      role,
      cityId,
      phone,
      telegram,
      services,
      radiusKm,
      available,
      avatar
    })
  );
});

// --- Портфолио исполнителя --------------------------------------------------

// Обновление своего портфолио: био и/или добавление/удаление примера работы.
app.patch("/api/account/portfolio", requireAuth, (req, res) => {
  const body = req.body ?? {};
  if (typeof body.bio === "string") {
    repo.setBio(req.account.id, body.bio.trim().slice(0, 600));
  }
  if (body.addItem) {
    const title = String(body.addItem.title || "").trim().slice(0, 120);
    if (!title) {
      return res.status(400).json({ error: "invalid_item", message: "Укажите название работы" });
    }
    // photoUrl может быть внешней ссылкой (короткой) или загруженным фото (base64 data-URL).
    const rawPhoto = String(body.addItem.photoUrl || "").trim();
    let photoUrl = "";
    if (rawPhoto.startsWith("data:")) {
      if (!isValidPhoto(rawPhoto)) {
        return res.status(400).json({ error: "invalid_photo", message: "Фото слишком большое (до 2 МБ)" });
      }
      photoUrl = rawPhoto;
    } else {
      photoUrl = rawPhoto.slice(0, 1000);
    }
    const result = repo.addPortfolioItem({
      id: makeId("pf_"),
      accountId: req.account.id,
      title,
      description: String(body.addItem.description || "").trim().slice(0, 600),
      photoUrl,
      createdAt: Date.now()
    });
    if (!result.ok) {
      return res.status(400).json({ error: "too_many_items", message: "Максимум 30 работ" });
    }
  }
  if (body.deleteItemId) {
    repo.deletePortfolioItem(req.account.id, String(body.deleteItemId));
  }
  res.json(repo.getExecutorProfile(req.account.id));
});

// Публичный профиль исполнителя (портфолио, отзывы, рейтинг) — для заказчика.
app.get("/api/executors/:id", requireAuth, (req, res) => {
  const profile = repo.getExecutorProfile(req.params.id);
  if (!profile) {
    return res.status(404).json({ error: "not_found" });
  }
  res.json(profile);
});

// --- Техника исполнителя (ТТХ спецтехники по категориям) --------------------

// Чистим ТТХ по схеме категории: только известные поля, приведение типов,
// отбрасываем мусор. null — если категория не поддерживает ТТХ.
function sanitizeSpecs(serviceKey, raw) {
  const schema = equipmentSpecs[serviceKey];
  if (!schema) {
    return null;
  }
  const out = {};
  const src = raw && typeof raw === "object" ? raw : {};
  for (const field of schema.fields) {
    const v = src[field.key];
    if (v === undefined || v === null || v === "") {
      continue;
    }
    if (field.type === "number") {
      const n = Number(v);
      // Отбрасываем мусор и абсурдные значения (санити-границы из схемы).
      if (Number.isFinite(n) && n >= 0 && (field.max === undefined || n <= field.max)) {
        out[field.key] = n;
      }
    } else if (field.type === "bool") {
      out[field.key] = Boolean(v);
    } else if (field.type === "select") {
      if (field.options.includes(String(v))) {
        out[field.key] = String(v);
      }
    } else {
      out[field.key] = String(v).trim().slice(0, 200);
    }
  }
  return out;
}

// Названия обязательных полей ТТХ, которых не хватает (для публикации в витрину).
function missingRequiredSpecs(serviceKey, specs) {
  const schema = equipmentSpecs[serviceKey];
  if (!schema) {
    return [];
  }
  return schema.fields
    .filter((f) => f.required && (specs[f.key] === undefined || specs[f.key] === "" || specs[f.key] === null))
    .map((f) => f.label);
}

app.get("/api/equipment", requireAuth, (req, res) => {
  res.json(repo.listEquipment(req.account.id));
});

// Цена предложения: неотрицательное целое в рублях, разумный потолок.
function sanitizePrice(v) {
  const n = Math.floor(Number(v) || 0);
  return n > 0 && n < 100000000 ? n : 0;
}

// Фото единицы техники: base64 data-URL (валидируем размер) либо пусто.
function sanitizeEquipmentPhoto(raw) {
  const v = String(raw || "").trim();
  if (!v) {
    return "";
  }
  return v.startsWith("data:") && isValidPhoto(v) ? v : "";
}

app.post("/api/equipment", requireAuth, (req, res) => {
  const body = req.body ?? {};
  const serviceKey = String(body.serviceKey || "");
  const specs = sanitizeSpecs(serviceKey, body.specs);
  if (specs === null) {
    return res.status(400).json({ error: "invalid_service", message: "Для этой категории ТТХ не заданы" });
  }
  const title = String(body.title || "").trim().slice(0, 80);
  const published = Boolean(body.published);
  // Для публикации в витрину обязательны ключевые ТТХ (иначе объявление-«пустышка»).
  if (published) {
    const missing = missingRequiredSpecs(serviceKey, specs);
    if (missing.length) {
      return res.status(400).json({ error: "missing_specs", message: `Заполните для витрины: ${missing.join(", ")}` });
    }
  }
  const result = repo.addEquipment({
    id: makeId("eq_"),
    accountId: req.account.id,
    serviceKey,
    title,
    specs,
    published,
    price: sanitizePrice(body.price),
    note: String(body.note || "").trim().slice(0, 300),
    photo: sanitizeEquipmentPhoto(body.photo),
    createdAt: Date.now()
  });
  if (!result.ok) {
    return res.status(400).json({ error: "too_many_items", message: "Максимум 40 единиц техники" });
  }
  res.status(201).json(repo.listEquipment(req.account.id));
});

app.patch("/api/equipment/:id", requireAuth, (req, res) => {
  const body = req.body ?? {};
  const existing = repo.listEquipment(req.account.id).find((e) => e.id === req.params.id);
  if (!existing) {
    return res.status(404).json({ error: "not_found" });
  }
  // Категорию единицы не меняем. Поля, которых нет в теле, сохраняем прежними.
  const specs = body.specs === undefined ? existing.specs : sanitizeSpecs(existing.serviceKey, body.specs) || {};
  const title = String(body.title ?? existing.title).trim().slice(0, 80);
  const published = body.published === undefined ? existing.published : Boolean(body.published);
  const price = body.price === undefined ? existing.price : sanitizePrice(body.price);
  const note = body.note === undefined ? existing.note : String(body.note || "").trim().slice(0, 300);
  const photo = body.photo === undefined ? existing.photo : sanitizeEquipmentPhoto(body.photo);
  // Обязательные ТТХ при публикации.
  if (published) {
    const missing = missingRequiredSpecs(existing.serviceKey, specs);
    if (missing.length) {
      return res.status(400).json({ error: "missing_specs", message: `Заполните для витрины: ${missing.join(", ")}` });
    }
  }
  repo.updateEquipment(req.account.id, req.params.id, { title, specs, published, price, note, photo });
  // Подмена машины (фото/ТТХ/название) обнуляет СТС-подтверждение — иначе байпас доверия.
  const identityChanged =
    (body.title !== undefined && title !== existing.title) ||
    (body.photo !== undefined && photo !== existing.photo) ||
    (body.specs !== undefined && JSON.stringify(specs) !== JSON.stringify(existing.specs));
  if (identityChanged) {
    repo.resetEquipmentVerify(req.account.id, req.params.id);
  }
  res.json(repo.listEquipment(req.account.id));
});

app.delete("/api/equipment/:id", requireAuth, (req, res) => {
  repo.deleteEquipment(req.account.id, req.params.id);
  res.json(repo.listEquipment(req.account.id));
});

// СТС-верификация единицы: исполнитель прикладывает фото СТС → на проверку админу.
app.post("/api/equipment/:id/verify-sts", requireAuth, (req, res) => {
  const photo = String(req.body?.photo || "").trim();
  if (!photo.startsWith("data:") || !isValidPhoto(photo)) {
    return res.status(400).json({ error: "invalid_photo", message: "Приложите фото СТС (до 2 МБ)" });
  }
  const result = repo.setEquipmentStsPhoto(req.account.id, req.params.id, photo);
  if (!result.ok) {
    return res.status(404).json({ error: "not_found" });
  }
  res.json(repo.listEquipment(req.account.id));
});

// Витрина «Техника в наличии»: опубликованные предложения исполнителей в городе.
app.get("/api/offers", requireAuth, (req, res) => {
  const cityId = String(req.query.cityId || req.account.cityId || "");
  const service = req.query.service ? String(req.query.service) : null;
  const verifiedOnly = req.query.verified === "1" || req.query.verified === "true";
  if (!cityId) {
    return res.status(400).json({ error: "no_city", message: "Не указан город" });
  }
  res.json(repo.listOffers({ cityId, service, verifiedOnly }));
});

// Раскрыть контакт по объявлению: логируем событие и шлём исполнителю «вами интересуются».
app.post("/api/offers/:id/contact", requireAuth, rateLimit({ windowMs: 60000, max: 30 }), (req, res) => {
  const offer = repo.getOfferPublic(req.params.id);
  if (!offer || !offer.published) {
    return res.status(404).json({ error: "not_found" });
  }
  const channel = String(req.body?.channel || "").slice(0, 20);
  // Не логируем контакт с самим собой.
  if (offer.executorId !== req.account.id) {
    repo.addOfferEvent({
      id: makeId("oe_"),
      equipmentId: offer.id,
      fromId: req.account.id,
      executorId: offer.executorId,
      channel,
      createdAt: Date.now()
    });
    notify(offer.executorId, "offer_interest", `${req.account.name} интересуется вашей техникой «${offer.title || "объявление"}» — свяжитесь`, "");
  }
  res.json({ phone: offer.phone, telegram: offer.telegram, executorName: offer.executorName });
});

// «Запросить эту технику»: создаём открытый заказ и зовём этого исполнителя (как quick-order).
app.post("/api/offers/:id/request", requireAuth, async (req, res) => {
  const offer = repo.getOfferPublic(req.params.id);
  if (!offer || !offer.published) {
    return res.status(404).json({ error: "not_found" });
  }
  if (offer.executorId === req.account.id) {
    return res.status(400).json({ error: "own_offer", message: "Нельзя заказать у самого себя" });
  }
  const body = req.body ?? {};
  const city = repo.getCity(body.cityId || offer.cityId);
  const price = Number(body.price) > 0 ? Number(body.price) : offer.price;
  const fromText = String(body.from || "").trim().slice(0, 300);
  const details = String(body.details || "").trim().slice(0, 2000);
  if (!city || !fromText || !details || !(price > 0)) {
    return res.status(400).json({ error: "invalid_order", message: "Укажите адрес, детали и цену" });
  }
  let coordinates = null;
  if (Array.isArray(body.coordinates) && body.coordinates.length === 2) {
    coordinates = [Number(body.coordinates[0]), Number(body.coordinates[1])];
  } else {
    const geo = await geocodeAddress(fromText, city.name);
    if (geo) coordinates = [geo.lng, geo.lat];
  }
  // Геокодер мог не ответить — не блокируем запрос, ставим центр города (адрес есть текстом).
  if (!coordinates) {
    coordinates = [city.center_lng, city.center_lat];
  }
  const created = repo.insertOrder({
    id: makeId("o_"),
    cityId: city.id,
    customerId: req.account.id,
    service: offer.serviceKey,
    from: fromText,
    details,
    price,
    distance: formatDistance(haversineKm([city.center_lng, city.center_lat], coordinates)),
    status: "open",
    lng: coordinates[0],
    lat: coordinates[1],
    customerName: req.account.name,
    createdAt: Date.now()
  });
  repo.addOfferEvent({ id: makeId("oe_"), equipmentId: offer.id, fromId: req.account.id, executorId: offer.executorId, channel: "request", createdAt: Date.now() });
  notify(offer.executorId, "quick", `${req.account.name} запросил вашу технику «${offer.title || ""}» — новый заказ`, created.id);
  res.status(201).json(created);
});

// Пожаловаться на объявление (вне заказа — контакт в витрине идёт напрямую).
app.post("/api/offers/:id/complaint", requireAuth, (req, res) => {
  const offer = repo.getOfferPublic(req.params.id);
  if (!offer) {
    return res.status(404).json({ error: "not_found" });
  }
  const text = String(req.body?.text || "").trim().slice(0, 1000);
  if (!text) {
    return res.status(400).json({ error: "empty", message: "Опишите проблему" });
  }
  const created = repo.createComplaint({
    id: makeId("cmp_"),
    orderId: "",
    fromId: req.account.id,
    toId: offer.executorId,
    type: "offer",
    text: `Объявление «${offer.title || "техника"}»: ${text}`,
    createdAt: Date.now()
  });
  res.status(201).json(created);
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

app.get("/api/orders", requireAuth, (req, res) => {
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

// Охват открытого заказа: сколько исполнителей поблизости его видят (для заказчика).
app.get("/api/orders/:orderId/reach", requireAuth, (req, res) => {
  const order = repo.getOrder(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: "not_found" });
  }
  if (order.customerId !== req.account.id) {
    return res.status(403).json({ error: "forbidden" });
  }
  res.json({ reach: repo.countReach(order.cityId, order.service) });
});

// Статистика исполнителя (заработок, число выполненных).
app.get("/api/stats", requireAuth, (req, res) => {
  res.json(repo.getExecutorStats(req.account.id));
});

// Исполнитель запрашивает верификацию → уходит на модерацию админу (легаси, общий значок).
app.post("/api/account/verify", requireAuth, (req, res) => {
  res.json(withAdmin(repo.requestVerification(req.account.id)));
});

// Заявка на верификацию по услуге с документом (напр. сварщик → НАКС).
app.post("/api/account/verification-request", requireAuth, (req, res) => {
  if (req.account.role !== "driver") {
    return res.status(403).json({ error: "drivers_only", message: "Только для исполнителей" });
  }
  const body = req.body ?? {};
  const serviceKey = String(body.serviceKey || "").trim();
  const docType = String(body.docType || "").trim().slice(0, 60);
  const photo = String(body.photo || "");
  if (!serviceKey || !docType) {
    return res.status(400).json({ error: "missing_fields", message: "Укажите услугу и тип документа" });
  }
  if (!isValidPhoto(photo)) {
    return res.status(400).json({ error: "invalid_photo", message: "Приложите фото документа (до 2 МБ)" });
  }
  if (repo.countPendingVerifications(req.account.id) >= 5) {
    return res.status(429).json({ error: "too_many_pending", message: "Слишком много заявок на проверке" });
  }
  if (repo.hasActiveVerification(req.account.id, serviceKey)) {
    return res.status(409).json({ error: "already_exists", message: "По этой услуге уже есть заявка или подтверждение" });
  }
  const created = repo.createVerificationRequest({
    id: makeId("vr_"),
    accountId: req.account.id,
    serviceKey,
    docType,
    photo,
    createdAt: Date.now()
  });
  res.status(201).json(created);
});

// Свои заявки на верификацию (без тяжёлого фото).
app.get("/api/account/verification-requests", requireAuth, (req, res) => {
  res.json(repo.listVerificationRequests(req.account.id));
});

// --- Админ: модерация ---
// Легаси: общий значок.
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

// Заявки на верификацию по документу — на модерации (с фото).
app.get("/api/admin/verification-requests", requireAuth, requireAdmin, (req, res) => {
  res.json(repo.listPendingVerificationRequests());
});

app.post("/api/admin/verification-requests/:id", requireAuth, requireAdmin, (req, res) => {
  const approve = Boolean(req.body?.approve);
  const vr = repo.decideVerificationRequest(req.params.id, approve);
  if (!vr) {
    return res.status(404).json({ error: "not_found" });
  }
  notify(
    vr.accountId,
    "verify",
    approve
      ? `Квалификация подтверждена: ${vr.docType} ✓`
      : `Заявка на верификацию (${vr.docType}) отклонена`,
    ""
  );
  res.json(vr);
});

// СТС-верификация техники: очередь на модерацию и решение админа.
app.get("/api/admin/equipment-verifications", requireAuth, requireAdmin, (req, res) => {
  res.json(repo.listEquipmentVerifications());
});

app.post("/api/admin/equipment-verifications/:id", requireAuth, requireAdmin, (req, res) => {
  const approve = Boolean(req.body?.approve);
  const item = repo.listEquipmentVerifications().find((e) => e.id === req.params.id);
  repo.decideEquipmentVerification(req.params.id, approve);
  if (item) {
    notify(
      item.executorId,
      "verify",
      approve ? `Техника подтверждена по СТС: ${item.title || "единица"} ✓` : `СТС для «${item.title || "единицы"}» отклонён`,
      ""
    );
  }
  res.json(repo.listEquipmentVerifications());
});

app.get("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  res.json(
    repo.listUsers({
      q: req.query.q ? String(req.query.q) : null,
      limit: Number(req.query.limit) || 20,
      offset: Number(req.query.offset) || 0
    })
  );
});

// Аналитика спроса: сколько заказов по каждой услуге и городу за период.
app.get("/api/admin/analytics", requireAuth, requireAdmin, (req, res) => {
  const days = Math.max(1, Math.min(365, Math.round(Number(req.query.days) || 30)));
  const cityId = req.query.cityId ? String(req.query.cityId) : null;
  const toTime = Date.now();
  const fromTime = toTime - days * 86400000;
  const data = repo.getDemandAnalytics(fromTime, toTime, cityId);
  const catalog = repo.getCatalog();
  const svc = new Map(catalog.services.map((s) => [s.key, s]));
  const cityNames = new Map(catalog.cities.map((c) => [c.id, c.name]));
  const catTitles = new Map((catalog.categories || []).map((c) => [c.key, c.title]));

  const byService = data.byService.map((r) => ({
    key: r.service,
    title: svc.get(r.service)?.title || r.service,
    category: svc.get(r.service)?.category || "other",
    count: r.count,
    gmv: r.gmv,
    avgPrice: r.avgPrice
  }));

  // Разбивка по категориям (агрегируем услуги).
  const catAgg = new Map();
  for (const r of byService) {
    const e = catAgg.get(r.category) || { key: r.category, title: catTitles.get(r.category) || "Прочее", count: 0, gmv: 0 };
    e.count += r.count;
    e.gmv += r.gmv;
    catAgg.set(r.category, e);
  }
  const byCategory = [...catAgg.values()].sort((a, b) => b.gmv - a.gmv);

  res.json({
    days,
    cityId,
    totals: data.totals,
    byCategory,
    byService,
    byCity: data.byCity.map((r) => ({
      key: r.city_id,
      title: cityNames.get(r.city_id) || r.city_id,
      count: r.count,
      gmv: r.gmv
    })),
    matrix: data.matrix.map((r) => ({
      cityId: r.city_id,
      cityName: cityNames.get(r.city_id) || r.city_id,
      serviceKey: r.service,
      serviceName: svc.get(r.service)?.title || r.service,
      count: r.count,
      gmv: r.gmv,
      fillRate: r.count > 0 ? Math.round((r.done / r.count) * 100) : 0,
      avgBids: r.count > 0 ? Math.round((r.bidsTotal / r.count) * 10) / 10 : 0,
      supply: r.supply || 0
    }))
  });
});

// Сетка цен по нишам (город × услуга): полный грид из каталога + текущие правила.
app.get("/api/admin/pricing", requireAuth, requireAdmin, (req, res) => {
  const catalog = repo.getCatalog();
  const rules = new Map(
    repo.listPricingRules().map((r) => [`${r.cityId}|${r.serviceKey}`, r])
  );
  const grid = [];
  for (const city of catalog.cities) {
    for (const key of city.services) {
      const svc = catalog.services.find((s) => s.key === key);
      if (!svc) continue;
      const rule = rules.get(`${city.id}|${key}`);
      grid.push({
        cityId: city.id,
        cityName: city.name,
        serviceKey: key,
        serviceName: svc.title,
        coinCost: rule ? rule.coinCost : 0,
        enabled: rule ? rule.enabled : false
      });
    }
  }
  res.json({ grid });
});

// Включить/выключить платную нишу в городе с ценой в монетах.
app.post("/api/admin/pricing", requireAuth, requireAdmin, (req, res) => {
  const body = req.body ?? {};
  const cityId = String(body.cityId || "");
  const serviceKey = String(body.serviceKey || "");
  const coinCost = Math.max(0, Math.round(Number(body.coinCost) || 0));
  const enabled = Boolean(body.enabled);
  if (!repo.getCity(cityId)) {
    return res.status(400).json({ error: "invalid_city" });
  }
  repo.setPricingRule(cityId, serviceKey, coinCost, enabled);
  res.json({ ok: true, cityId, serviceKey, coinCost, enabled });
});

// Массовое обновление цен (услуга во все города / копирование / выключить всё).
app.post("/api/admin/pricing/bulk", requireAuth, requireAdmin, (req, res) => {
  const rules = Array.isArray(req.body?.rules) ? req.body.rules : [];
  if (rules.length === 0) {
    return res.status(400).json({ error: "no_rules" });
  }
  const cities = new Set(repo.getCatalog().cities.map((c) => c.id));
  const clean = rules
    .filter((r) => r && cities.has(String(r.cityId)) && r.serviceKey)
    .map((r) => ({
      cityId: String(r.cityId),
      serviceKey: String(r.serviceKey),
      coinCost: Math.max(0, Math.round(Number(r.coinCost) || 0)),
      enabled: Boolean(r.enabled)
    }));
  repo.setPricingRules(clean);
  res.json({ ok: true, count: clean.length });
});

// Корректировка баланса пользователя админом.
app.post("/api/admin/users/:id/balance", requireAuth, requireAdmin, (req, res) => {
  const amount = Math.round(Number(req.body?.amount) || 0);
  const note = String(req.body?.note || "").trim().slice(0, 200);
  if (!amount) {
    return res.status(400).json({ error: "invalid_amount" });
  }
  if (!repo.getAccount(req.params.id)) {
    return res.status(404).json({ error: "not_found" });
  }
  repo.adminAdjustBalance(req.params.id, amount, note);
  notify(
    req.params.id,
    "balance",
    amount > 0 ? `Начислено ${amount} монет` : `Списано ${Math.abs(amount)} монет`,
    ""
  );
  res.json({ ok: true, balance: repo.getWallet(req.params.id).balance });
});

// Бан/разбан пользователя.
app.post("/api/admin/users/:id/ban", requireAuth, requireAdmin, (req, res) => {
  if (!repo.getAccount(req.params.id)) {
    return res.status(404).json({ error: "not_found" });
  }
  const banned = Boolean(req.body?.banned);
  repo.setBanned(req.params.id, banned);
  res.json({ ok: true, banned });
});

// Лента заказов (модерация): фильтр по городу и статусу.
app.get("/api/admin/orders", requireAuth, requireAdmin, (req, res) => {
  res.json(
    repo.listOrdersAdmin({
      cityId: req.query.cityId ? String(req.query.cityId) : null,
      status: req.query.status ? String(req.query.status) : null,
      limit: Number(req.query.limit) || 20,
      offset: Number(req.query.offset) || 0
    })
  );
});

// Лог последних транзакций платформы.
app.get("/api/admin/transactions", requireAuth, requireAdmin, (req, res) => {
  res.json({
    transactions: repo.listRecentTransactions(Number(req.query.limit) || 20, Number(req.query.offset) || 0)
  });
});

// Жалобы на модерации.
app.get("/api/admin/complaints", requireAuth, requireAdmin, (req, res) => {
  res.json(
    repo.listComplaintsAdmin({
      status: req.query.status ? String(req.query.status) : null,
      limit: Number(req.query.limit) || 20,
      offset: Number(req.query.offset) || 0
    })
  );
});

app.post("/api/admin/complaints/:id", requireAuth, requireAdmin, (req, res) => {
  const c = repo.decideComplaint(req.params.id, String(req.body?.resolution || ""));
  if (c && c.from_id) {
    notify(c.from_id, "complaint", "Ваша жалоба рассмотрена", "");
  }
  res.json({ ok: true });
});

// --- Админ: управление каталогом (города, услуги, доступность) ---
app.post("/api/admin/cities", requireAuth, requireAdmin, (req, res) => {
  const b = req.body ?? {};
  const id = String(b.id || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  const regionId = String(b.regionId || "").trim();
  const name = String(b.name || "").trim().slice(0, 100);
  const centerLng = Number(b.centerLng);
  const centerLat = Number(b.centerLat);
  if (!id || !regionId || !name || !Number.isFinite(centerLng) || !Number.isFinite(centerLat)) {
    return res.status(400).json({ error: "invalid_city", message: "Заполните id, регион, название и координаты" });
  }
  try {
    repo.upsertCity(id, regionId, name, centerLng, centerLat, Number(b.zoom) || 11, Number(b.sort) || 0);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ error: "city_error", message: e.message === "region_not_found" ? "Регион не найден" : e.message });
  }
});

app.post("/api/admin/services", requireAuth, requireAdmin, (req, res) => {
  const b = req.body ?? {};
  const key = String(b.key || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  const title = String(b.title || "").trim().slice(0, 60);
  const subtitle = String(b.subtitle || "").trim().slice(0, 120);
  const icon = String(b.icon || "").trim();
  const accent = String(b.accent || "").trim();
  const category = String(b.category || "transport").trim();
  if (!key || !title || !subtitle || !icon) {
    return res.status(400).json({ error: "invalid_service", message: "Заполните key, название, подзаголовок, иконку" });
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) {
    return res.status(400).json({ error: "invalid_accent", message: "Цвет в формате #RRGGBB" });
  }
  repo.upsertService(key, title, subtitle, icon, accent, category, Number(b.sort) || 0);
  res.json({ ok: true, key });
});

app.post("/api/admin/city-services", requireAuth, requireAdmin, (req, res) => {
  const cityId = String(req.body?.cityId || "").trim();
  const serviceKey = String(req.body?.serviceKey || "").trim();
  if (!cityId || !serviceKey) {
    return res.status(400).json({ error: "missing_params" });
  }
  try {
    repo.setCityService(cityId, serviceKey, Boolean(req.body?.enabled));
    res.json({ ok: true, cityId, serviceKey, enabled: Boolean(req.body?.enabled) });
  } catch (e) {
    res.status(400).json({ error: "city_service_error", message: e.message });
  }
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
    Array.isArray(body.coordinates) && body.coordinates.length === 2 && Number.isFinite(Number(body.coordinates[0]))
      ? [Number(body.coordinates[0]), Number(body.coordinates[1])]
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

// Сохранённые адреса заказчика («Дом», «Дача»…).
app.get("/api/places", requireAuth, (req, res) => {
  res.json(repo.listPlaces(req.account.id));
});

app.post("/api/places", requireAuth, (req, res) => {
  const body = req.body ?? {};
  const label = String(body.label || "").trim().slice(0, 60);
  const fromText = String(body.fromText || body.from_text || "").trim().slice(0, 300);
  const lng = Number(body.lng);
  const lat = Number(body.lat);
  if (!label || !fromText || !Number.isFinite(lng) || !Number.isFinite(lat)) {
    return res.status(400).json({ error: "invalid_place", message: "Укажите название и точку на карте" });
  }
  const created = repo.addPlace({
    id: makeId("pl_"),
    accountId: req.account.id,
    label,
    fromText,
    lng,
    lat,
    createdAt: Date.now()
  });
  res.status(201).json(created);
});

app.delete("/api/places/:id", requireAuth, (req, res) => {
  repo.deletePlace(req.params.id, req.account.id);
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
// amount — количество монет. Если ЮKassa настроена — создаём платёж и возвращаем
// confirmation_url (зачисление по вебхуку); иначе мгновенное зачисление (dev).
app.post("/api/wallet/topup", requireAuth, async (req, res) => {
  const coins = Math.round(Number(req.body?.amount) || 0);
  if (coins <= 0 || coins > 100000) {
    return res.status(400).json({ error: "invalid_amount" });
  }
  const amountRub = coins * COIN_RATE;

  if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET) {
    repo.credit(req.account.id, {
      id: makeId("t_"),
      amount: coins,
      type: "topup",
      note: `Пополнение ${coins} монет (тест)`,
      createdAt: Date.now()
    });
    return res.json(repo.getWallet(req.account.id));
  }

  try {
    const paymentId = makeId("pay_");
    repo.createPayment({ id: paymentId, accountId: req.account.id, amountRub, coins, createdAt: Date.now() });
    const auth = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET}`).toString("base64");
    const yk = await fetch("https://api.yookassa.ru/v3/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
        "Idempotency-Key": paymentId
      },
      body: JSON.stringify({
        amount: { value: amountRub.toFixed(2), currency: "RUB" },
        capture: true,
        confirmation: { type: "redirect", return_url: "https://kuber-api-nod2.onrender.com/payment-done" },
        description: `Кубер: ${coins} монет`
      })
    });
    if (!yk.ok) {
      return res.status(400).json({ error: "payment_failed", message: "Не удалось создать платёж" });
    }
    const payment = await yk.json();
    repo.setPaymentProvider(paymentId, payment.id);
    res.json({ confirmationUrl: payment.confirmation.confirmation_url });
  } catch (e) {
    res.status(500).json({ error: "server_error", message: e.message });
  }
});

// Вебхук ЮKassa: зачисляем монеты по успешной оплате (идемпотентно).
app.post("/api/payments/yookassa/webhook", (req, res) => {
  if (!YOOKASSA_SECRET) {
    return res.status(400).json({ error: "not_configured" });
  }
  const event = req.body?.event;
  const payment = req.body?.object;
  if (event === "payment.succeeded" && payment?.status === "succeeded" && payment?.id) {
    const dbPayment = repo.getPaymentByProviderId(payment.id);
    if (dbPayment && dbPayment.status !== "confirmed") {
      repo.confirmPayment(payment.id);
      notify(dbPayment.account_id, "topup", `Баланс пополнен на ${dbPayment.coins} монет`, "");
    }
  }
  res.status(200).json({ ok: true });
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

  // Координаты обязательны: либо точка, выбранная клиентом (карта/подсказка),
  // либо успешное геокодирование адреса. Если ни то, ни другое — просим уточнить
  // адрес, чтобы исполнитель не ехал в центр города по «мусорному» вводу.
  let coordinates = null;
  if (
    Array.isArray(body.coordinates) &&
    body.coordinates.length === 2 &&
    Number.isFinite(Number(body.coordinates[0])) &&
    Number.isFinite(Number(body.coordinates[1]))
  ) {
    coordinates = [Number(body.coordinates[0]), Number(body.coordinates[1])];
  } else {
    const geo = await geocodeAddress(fromText, city.name);
    if (geo) {
      coordinates = [geo.lng, geo.lat];
    }
  }
  if (!coordinates) {
    return res.status(400).json({
      error: "address_not_found",
      message: "Не удалось определить адрес. Выберите точку на карте или подсказку из списка."
    });
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

  // Откликаться можно только на открытый заказ (иначе списываем монеты впустую).
  if (order.status !== "open") {
    return res.status(409).json({ error: "not_open", message: "Заказ уже не открыт для откликов" });
  }

  // Нельзя откликнуться дважды на один заказ.
  if (repo.hasBid(order.id, req.account.id)) {
    return res.status(409).json({ error: "already_bid", message: "Вы уже откликнулись на этот заказ" });
  }

  // Плата за отклик в монетах: нишевая цена (город × услуга), иначе бесплатно.
  const fee = bidCost(order);
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
        message: `Недостаточно монет: отклик стоит ${fee}. Пополните баланс.`
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
    fee, // фактически списанная плата — по ней и вернём при отмене/проигрыше
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
      refundBidFee(bid.driverId, bid.fee, updated.id);
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
    refundBidFee(rejected.driverId, rejected.fee, req.params.orderId);
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
    refundBidFee(bid.driverId, bid.fee, req.params.orderId);
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
  if (order.status !== "matched" && order.status !== "enroute") {
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
  // Реферальный бонус пригласившему, если это первый выполненный заказ заказчика.
  const award = repo.awardReferralOnFirstDone(order.customer_id, REFERRAL_BONUS);
  if (award && award.bonus > 0) {
    notify(award.referrerId, "referral", `Бонус ${award.bonus} монет за приглашённого!`, "");
  }
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

// Исполнитель оценивает заказчика (после выполнения).
app.post("/api/orders/:orderId/review-customer", requireAuth, (req, res) => {
  const order = repo.getOrderRow(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: "not_found" });
  }
  if (order.executor_id !== req.account.id) {
    return res.status(403).json({ error: "forbidden" });
  }
  if (order.status !== "done") {
    return res.status(400).json({ error: "not_done" });
  }
  if (order.reviewed_customer) {
    return res.status(400).json({ error: "already_reviewed" });
  }
  const rating = Math.max(1, Math.min(5, Math.round(Number(req.body?.rating) || 0)));
  if (!rating) {
    return res.status(400).json({ error: "invalid_rating" });
  }
  const updated = repo.addCustomerReview({
    id: makeId("r_"),
    orderId: order.id,
    fromId: req.account.id,
    toId: order.customer_id,
    rating,
    text: String(req.body?.text || "").trim().slice(0, 500),
    createdAt: Date.now()
  });
  notify(order.customer_id, "review", `Исполнитель оценил вас на ${rating}★`, order.id);
  res.json(updated);
});

// Отмена заказа заказчиком (open/matched/enroute) или отказ исполнителя (matched/enroute).
app.post("/api/orders/:orderId/cancel", requireAuth, (req, res) => {
  const order = repo.getOrderRow(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: "not_found" });
  }
  const isCustomer = order.customer_id === req.account.id;
  const isExecutor = order.executor_id === req.account.id;
  if (!isCustomer && !isExecutor) {
    return res.status(403).json({ error: "forbidden" });
  }
  if (!["open", "matched", "enroute"].includes(order.status)) {
    return res.status(400).json({ error: "not_cancellable" });
  }
  const reason = String(req.body?.reason || "").trim().slice(0, 300);
  // Возврат платы откликнувшимся исполнителям.
  const full = repo.getOrder(req.params.orderId);
  for (const bid of full?.bids ?? []) {
    refundBidFee(bid.driverId, bid.fee, req.params.orderId);
  }
  const updated = repo.cancelOrder(req.params.orderId, reason);
  const other = isCustomer ? order.executor_id : order.customer_id;
  notify(other, "cancelled", isCustomer ? "Заказчик отменил заказ" : "Исполнитель отказался от заказа", order.id);
  res.json(updated);
});

// Исполнитель отметил «Выехал» (matched → enroute).
app.post("/api/orders/:orderId/enroute", requireAuth, (req, res) => {
  const order = repo.getOrderRow(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: "not_found" });
  }
  if (order.executor_id !== req.account.id) {
    return res.status(403).json({ error: "forbidden" });
  }
  if (order.status !== "matched") {
    return res.status(400).json({ error: "not_matched" });
  }
  const updated = repo.setEnroute(req.params.orderId);
  notify(order.customer_id, "enroute", "Исполнитель выехал к вам", order.id);
  res.json(updated);
});

// Исполнитель шлёт свою позицию (пока заказ в пути).
app.post("/api/orders/:orderId/location", requireAuth, (req, res) => {
  const order = repo.getOrderRow(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: "not_found" });
  }
  if (order.executor_id !== req.account.id || order.status !== "enroute") {
    return res.status(403).json({ error: "forbidden" });
  }
  const lng = Number(req.body?.lng);
  const lat = Number(req.body?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return res.status(400).json({ error: "invalid_coords" });
  }
  repo.setExecPos(req.params.orderId, lng, lat);
  res.json({ ok: true });
});

// Жалоба на заказ/вторую сторону.
app.post("/api/complaints", requireAuth, (req, res) => {
  const order = repo.getOrderRow(req.body?.orderId);
  if (!order) {
    return res.status(404).json({ error: "order_not_found" });
  }
  const isCustomer = order.customer_id === req.account.id;
  const isExecutor = order.executor_id === req.account.id;
  if (!isCustomer && !isExecutor) {
    return res.status(403).json({ error: "forbidden" });
  }
  const text = String(req.body?.text || "").trim().slice(0, 1000);
  const type = String(req.body?.type || "other").trim().slice(0, 40);
  if (!text) {
    return res.status(400).json({ error: "empty" });
  }
  const toId = isCustomer ? order.executor_id : order.customer_id;
  const created = repo.createComplaint({
    id: makeId("cmp_"),
    orderId: order.id,
    fromId: req.account.id,
    toId: toId || "",
    type,
    text,
    createdAt: Date.now()
  });
  res.status(201).json(created);
});

// Мой реферальный код + статистика.
app.get("/api/referral-code", requireAuth, (req, res) => {
  res.json(repo.getReferralInfo(req.account.id) || { code: "", count: 0 });
});

// Быстрый повторный вызов избранного исполнителя (создаёт заказ + прямое уведомление).
app.post("/api/favorites/:executorId/quick-order", requireAuth, async (req, res) => {
  const executorId = req.params.executorId;
  if (!repo.listFavorites(req.account.id).includes(executorId)) {
    return res.status(403).json({ error: "not_favorite" });
  }
  const body = req.body ?? {};
  const city = repo.getCity(body.cityId);
  const price = Number(body.price);
  const fromText = String(body.from || "").trim().slice(0, 300);
  const details = String(body.details || "").trim().slice(0, 2000);
  if (!city || !fromText || !details || !(price > 0)) {
    return res.status(400).json({ error: "invalid_order" });
  }
  let coordinates = null;
  if (Array.isArray(body.coordinates) && body.coordinates.length === 2) {
    coordinates = [Number(body.coordinates[0]), Number(body.coordinates[1])];
  } else {
    const geo = await geocodeAddress(fromText, city.name);
    if (geo) coordinates = [geo.lng, geo.lat];
  }
  if (!coordinates) {
    return res.status(400).json({ error: "address_not_found", message: "Уточните адрес" });
  }
  const created = repo.insertOrder({
    id: makeId("o_"),
    cityId: city.id,
    customerId: req.account.id,
    service: body.service || "water",
    from: fromText,
    details,
    price,
    distance: formatDistance(haversineKm([city.center_lng, city.center_lat], coordinates)),
    status: "open",
    lng: coordinates[0],
    lat: coordinates[1],
    customerName: req.account.name,
    createdAt: Date.now()
  });
  notify(executorId, "quick", `${req.account.name} зовёт вас снова — новый заказ`, created.id);
  res.status(201).json(created);
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

// Напоминания по циклу потребления. Заказчику, у которого последний выполненный
// заказ по нише старше REMIND_DAYS и нет активного расписания/открытого заказа,
// шлём один пуш «пора повторить». Дедуп через accounts.last_reminded_at.
const REMIND_DAYS = Math.max(1, Number(process.env.REMIND_DAYS || 10));
const REMINDERS_ENABLED = process.env.REMINDERS_ENABLED !== "0"; // по умолчанию включено
let remindersBusy = false;
function runReminders() {
  if (!REMINDERS_ENABLED || remindersBusy) {
    return;
  }
  remindersBusy = true;
  try {
    const cutoff = Date.now() - REMIND_DAYS * 86400000;
    const seen = new Set();
    for (const c of repo.getReminderCandidates(cutoff)) {
      if (seen.has(c.accountId)) {
        continue; // одному заказчику — не больше одного напоминания за проход
      }
      seen.add(c.accountId);
      notify(c.accountId, "reminder", "Пора повторить заказ? Откройте приложение и закажите снова.", "");
      repo.markReminded(c.accountId, Date.now());
    }
  } catch (e) {
    console.error("runReminders error:", e.message);
  } finally {
    remindersBusy = false;
  }
}

// Раз в час — срочность не критична.
setInterval(runReminders, 3600000);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Vodovoz API is running on http://0.0.0.0:${PORT}`);
  runSchedules();
  runReminders();
});
