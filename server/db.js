const path = require("node:path");
const Database = require("better-sqlite3");
const seed = require("./seed");

const dbFile = process.env.DB_FILE || path.join(__dirname, "vodovoz.db");
const db = new Database(dbFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS regions (
      id   TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS cities (
      id         TEXT PRIMARY KEY,
      region_id  TEXT NOT NULL REFERENCES regions(id),
      name       TEXT NOT NULL,
      center_lng REAL NOT NULL,
      center_lat REAL NOT NULL,
      zoom       INTEGER NOT NULL DEFAULT 11,
      sort       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS services (
      key      TEXT PRIMARY KEY,
      title    TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      icon     TEXT NOT NULL,
      accent   TEXT NOT NULL,
      sort     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS city_services (
      city_id     TEXT NOT NULL REFERENCES cities(id),
      service_key TEXT NOT NULL REFERENCES services(key),
      PRIMARY KEY (city_id, service_key)
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL,
      city_id       TEXT NOT NULL,
      contact       TEXT NOT NULL DEFAULT '',
      phone         TEXT NOT NULL DEFAULT '',
      telegram      TEXT NOT NULL DEFAULT '',
      rating_sum    REAL NOT NULL DEFAULT 0,
      rating_count  INTEGER NOT NULL DEFAULT 0,
      balance       INTEGER NOT NULL DEFAULT 0,
      radius_km     INTEGER NOT NULL DEFAULT 0,
      available     INTEGER NOT NULL DEFAULT 1,
      verified      INTEGER NOT NULL DEFAULT 0,
      verify_status TEXT NOT NULL DEFAULT 'none',
      password_hash TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL DEFAULT 0
    );

    -- Регулярная доставка (подписка): из неё периодически создаются заказы.
    CREATE TABLE IF NOT EXISTS schedules (
      id            TEXT PRIMARY KEY,
      customer_id   TEXT NOT NULL,
      city_id       TEXT NOT NULL,
      service       TEXT NOT NULL,
      from_text     TEXT NOT NULL,
      details       TEXT NOT NULL,
      price         INTEGER NOT NULL,
      lng           REAL NOT NULL,
      lat           REAL NOT NULL,
      interval_days INTEGER NOT NULL,
      next_run      INTEGER NOT NULL,
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    INTEGER NOT NULL
    );

    -- Избранные исполнители заказчика.
    CREATE TABLE IF NOT EXISTS favorites (
      account_id  TEXT NOT NULL,
      executor_id TEXT NOT NULL,
      PRIMARY KEY (account_id, executor_id)
    );

    -- Движения по кошельку исполнителя (пополнения, списания, бонусы).
    CREATE TABLE IF NOT EXISTS transactions (
      id            TEXT PRIMARY KEY,
      account_id    TEXT NOT NULL,
      type          TEXT NOT NULL,
      amount        INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      note          TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL
    );

    -- Специализации исполнителя (какие услуги он выполняет).
    CREATE TABLE IF NOT EXISTS account_services (
      account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      service_key TEXT NOT NULL,
      PRIMARY KEY (account_id, service_key)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id            TEXT PRIMARY KEY,
      city_id       TEXT NOT NULL,
      customer_id   TEXT NOT NULL DEFAULT '',
      executor_id   TEXT NOT NULL DEFAULT '',
      service       TEXT NOT NULL,
      from_text     TEXT NOT NULL,
      details       TEXT NOT NULL,
      price         INTEGER NOT NULL,
      distance      TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'open',
      reviewed      INTEGER NOT NULL DEFAULT 0,
      lng           REAL NOT NULL,
      lat           REAL NOT NULL,
      customer_name TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bids (
      id         TEXT PRIMARY KEY,
      order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      driver_id  TEXT NOT NULL DEFAULT '',
      driver     TEXT NOT NULL,
      price      INTEGER NOT NULL,
      eta        TEXT NOT NULL,
      rating     REAL NOT NULL DEFAULT 4.9,
      created_at INTEGER NOT NULL
    );

    -- Одноразовые коды для входа по телефону.
    CREATE TABLE IF NOT EXISTS otp_codes (
      phone      TEXT PRIMARY KEY,
      code       TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts   INTEGER NOT NULL DEFAULT 0
    );

    -- Глобальные настройки (например, цена отклика, % от заказа).
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Push-токены устройств (Expo).
    CREATE TABLE IF NOT EXISTS push_tokens (
      token      TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- Уведомления (колокольчик): отклик, сообщение, статусы заказа.
    CREATE TABLE IF NOT EXISTS notifications (
      id         TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      type       TEXT NOT NULL,
      text       TEXT NOT NULL,
      order_id   TEXT NOT NULL DEFAULT '',
      read       INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    -- Чат по заказу между заказчиком и исполнителем.
    CREATE TABLE IF NOT EXISTS messages (
      id         TEXT PRIMARY KEY,
      order_id   TEXT NOT NULL,
      from_id    TEXT NOT NULL,
      text       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- Отзывы заказчиков об исполнителях.
    CREATE TABLE IF NOT EXISTS reviews (
      id         TEXT PRIMARY KEY,
      order_id   TEXT NOT NULL,
      from_id    TEXT NOT NULL,
      to_id      TEXT NOT NULL,
      rating     INTEGER NOT NULL,
      text       TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
  `);
}

// Индексы создаём после ensureColumns — они ссылаются на доращиваемые колонки.
function createIndexes() {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cities_region    ON cities(region_id);
    CREATE INDEX IF NOT EXISTS idx_orders_city      ON orders(city_id);
    CREATE INDEX IF NOT EXISTS idx_orders_executor  ON orders(executor_id);
    CREATE INDEX IF NOT EXISTS idx_bids_order        ON bids(order_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_account  ON sessions(account_id);
    CREATE INDEX IF NOT EXISTS idx_acc_services      ON account_services(account_id);
    CREATE INDEX IF NOT EXISTS idx_tx_account        ON transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_messages_order     ON messages(order_id);
    CREATE INDEX IF NOT EXISTS idx_notif_account      ON notifications(account_id);
  `);
}

// Доращиваем недостающие столбцы для баз, созданных до появления авторизации.
function ensureColumns() {
  const add = (table, column, ddl) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  };

  add("accounts", "password_hash", "password_hash TEXT NOT NULL DEFAULT ''");
  add("accounts", "created_at", "created_at INTEGER NOT NULL DEFAULT 0");
  add("accounts", "contact", "contact TEXT NOT NULL DEFAULT ''");
  add("accounts", "phone", "phone TEXT NOT NULL DEFAULT ''");
  add("accounts", "telegram", "telegram TEXT NOT NULL DEFAULT ''");
  add("accounts", "rating_sum", "rating_sum REAL NOT NULL DEFAULT 0");
  add("accounts", "rating_count", "rating_count INTEGER NOT NULL DEFAULT 0");
  add("accounts", "balance", "balance INTEGER NOT NULL DEFAULT 0");
  add("accounts", "radius_km", "radius_km INTEGER NOT NULL DEFAULT 0");
  add("accounts", "available", "available INTEGER NOT NULL DEFAULT 1");
  add("accounts", "verified", "verified INTEGER NOT NULL DEFAULT 0");
  add("accounts", "verify_status", "verify_status TEXT NOT NULL DEFAULT 'none'");
  add("orders", "customer_id", "customer_id TEXT NOT NULL DEFAULT ''");
  add("orders", "executor_id", "executor_id TEXT NOT NULL DEFAULT ''");
  add("orders", "reviewed", "reviewed INTEGER NOT NULL DEFAULT 0");
  add("bids", "driver_id", "driver_id TEXT NOT NULL DEFAULT ''");
}

function seedIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM regions").get().n;
  if (count > 0) {
    return;
  }

  const insertRegion = db.prepare("INSERT INTO regions (id, name, sort) VALUES (?, ?, ?)");
  const insertCity = db.prepare(
    "INSERT INTO cities (id, region_id, name, center_lng, center_lat, zoom, sort) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const insertService = db.prepare(
    "INSERT INTO services (key, title, subtitle, icon, accent, sort) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insertCityService = db.prepare(
    "INSERT INTO city_services (city_id, service_key) VALUES (?, ?)"
  );
  const insertOrder = db.prepare(
    `INSERT INTO orders
       (id, city_id, service, from_text, details, price, distance, status, lng, lat, customer_name, created_at)
     VALUES (@id, @cityId, @service, @from, @details, @price, @distance, @status, @lng, @lat, @customerName, @createdAt)`
  );
  const insertBid = db.prepare(
    `INSERT INTO bids (id, order_id, driver, price, eta, rating, created_at)
     VALUES (@id, @orderId, @driver, @price, @eta, @rating, @createdAt)`
  );

  const run = db.transaction(() => {
    for (const region of seed.regions) {
      insertRegion.run(region.id, region.name, region.sort ?? 0);
    }
    for (const city of seed.cities) {
      insertCity.run(
        city.id,
        city.regionId,
        city.name,
        city.center[0],
        city.center[1],
        city.zoom ?? 11,
        city.sort ?? 0
      );
    }
    for (const service of seed.services) {
      insertService.run(
        service.key,
        service.title,
        service.subtitle,
        service.icon,
        service.accent,
        service.sort ?? 0
      );
    }
    for (const [cityId, keys] of Object.entries(seed.cityServices)) {
      for (const key of keys) {
        insertCityService.run(cityId, key);
      }
    }

    let createdAt = 1700000000000;
    for (const order of seed.orders) {
      createdAt += 1000;
      insertOrder.run({
        id: order.id,
        cityId: order.cityId,
        service: order.service,
        from: order.from,
        details: order.details,
        price: order.price,
        distance: order.distance ?? "—",
        status: order.status ?? "open",
        lng: order.coordinates[0],
        lat: order.coordinates[1],
        customerName: order.customerName,
        createdAt
      });
      for (const bid of order.bids ?? []) {
        createdAt += 1;
        insertBid.run({
          id: bid.id,
          orderId: order.id,
          driver: bid.driver,
          price: bid.price,
          eta: bid.eta,
          rating: bid.rating ?? 4.9,
          createdAt
        });
      }
    }
  });

  run();
}

migrate();
ensureColumns();
createIndexes();
seedIfEmpty();

// --- Сборка объектов в форму, ожидаемую клиентом ---------------------------

function cityRowToCity(row, serviceKeys) {
  return {
    id: row.id,
    regionId: row.region_id,
    name: row.name,
    region: row.region_name,
    center: [row.center_lng, row.center_lat],
    zoom: row.zoom,
    services: serviceKeys
  };
}

function orderRowToOrder(row) {
  const bids = db
    .prepare(
      `SELECT b.*, a.rating_sum AS a_sum, a.rating_count AS a_count, a.verified AS a_verified
         FROM bids b LEFT JOIN accounts a ON a.id = b.driver_id
        WHERE b.order_id = ? ORDER BY b.created_at DESC`
    )
    .all(row.id)
    .map((bid) => ({
      id: bid.id,
      driverId: bid.driver_id,
      driver: bid.driver,
      price: bid.price,
      eta: bid.eta,
      // рейтинг исполнителя: живой из аккаунта, иначе значение из ставки
      rating: bid.a_count > 0 ? bid.a_sum / bid.a_count : bid.rating,
      verified: bid.a_verified === 1
    }));

  // Контакты выбранного исполнителя — для обмена после подтверждения.
  let executor = null;
  if (row.executor_id) {
    const ex = db
      .prepare("SELECT id, name, phone, telegram, verified FROM accounts WHERE id = ?")
      .get(row.executor_id);
    if (ex) {
      executor = {
        id: ex.id,
        name: ex.name,
        phone: ex.phone || "",
        telegram: ex.telegram || "",
        verified: ex.verified === 1
      };
    }
  }

  // Контакты заказчика — исполнитель видит их после подтверждения.
  let customer = null;
  if (row.customer_id) {
    const cu = db
      .prepare("SELECT id, name, phone, telegram FROM accounts WHERE id = ?")
      .get(row.customer_id);
    if (cu) {
      customer = { id: cu.id, name: cu.name, phone: cu.phone || "", telegram: cu.telegram || "" };
    }
  }

  return {
    id: row.id,
    cityId: row.city_id,
    customerId: row.customer_id,
    executorId: row.executor_id,
    service: row.service,
    from: row.from_text,
    details: row.details,
    price: row.price,
    distance: row.distance,
    status: row.status,
    reviewed: Boolean(row.reviewed),
    coordinates: [row.lng, row.lat],
    customerName: row.customer_name,
    customer,
    executor,
    bids
  };
}

// --- Публичный репозиторий --------------------------------------------------

function getCatalog() {
  const regions = db.prepare("SELECT * FROM regions ORDER BY sort, name").all();
  const cityRows = db
    .prepare(
      `SELECT c.*, r.name AS region_name
         FROM cities c JOIN regions r ON r.id = c.region_id
        ORDER BY c.sort, c.name`
    )
    .all();
  const services = db
    .prepare("SELECT key, title, subtitle, icon, accent FROM services ORDER BY sort, title")
    .all();

  const serviceKeysByCity = new Map();
  for (const row of db.prepare("SELECT city_id, service_key FROM city_services").all()) {
    const list = serviceKeysByCity.get(row.city_id) ?? [];
    list.push(row.service_key);
    serviceKeysByCity.set(row.city_id, list);
  }

  const serviceOrder = new Map(services.map((s, index) => [s.key, index]));
  const sortKeys = (keys) =>
    [...keys].sort((a, b) => (serviceOrder.get(a) ?? 99) - (serviceOrder.get(b) ?? 99));

  const cities = cityRows.map((row) =>
    cityRowToCity(row, sortKeys(serviceKeysByCity.get(row.id) ?? []))
  );

  const regionsWithCities = regions.map((region) => ({
    id: region.id,
    name: region.name,
    cities: cities.filter((city) => city.regionId === region.id)
  }));

  return { regions: regionsWithCities, cities, services };
}

function getCity(cityId) {
  return db.prepare("SELECT * FROM cities WHERE id = ?").get(cityId);
}

function listOrders(cityId) {
  return db
    .prepare("SELECT * FROM orders WHERE city_id = ? ORDER BY created_at DESC")
    .all(cityId)
    .map(orderRowToOrder);
}

// Открытые заказы города — лента исполнителя.
function listOpenOrders(cityId) {
  return db
    .prepare("SELECT * FROM orders WHERE city_id = ? AND status = 'open' ORDER BY created_at DESC")
    .all(cityId)
    .map(orderRowToOrder);
}

// Заказы конкретного заказчика (все города) — лента клиента.
function listOrdersByCustomer(customerId) {
  return db
    .prepare("SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC")
    .all(customerId)
    .map(orderRowToOrder);
}

function getOrder(orderId) {
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  return row ? orderRowToOrder(row) : null;
}

function getAccountServices(accountId) {
  return db
    .prepare("SELECT service_key FROM account_services WHERE account_id = ?")
    .all(accountId)
    .map((row) => row.service_key);
}

function setAccountServices(accountId, keys) {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM account_services WHERE account_id = ?").run(accountId);
    const insert = db.prepare(
      "INSERT OR IGNORE INTO account_services (account_id, service_key) VALUES (?, ?)"
    );
    for (const key of keys) {
      insert.run(accountId, key);
    }
  });
  tx();
}

// Публичная форма аккаунта — без password_hash.
function toPublicAccount(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    cityId: row.city_id,
    contact: row.contact || "",
    phone: row.phone || "",
    telegram: row.telegram || "",
    rating: row.rating_count > 0 ? row.rating_sum / row.rating_count : 0,
    ratingCount: row.rating_count || 0,
    balance: row.balance || 0,
    radiusKm: row.radius_km || 0,
    available: row.available !== 0,
    verified: row.verified === 1,
    verifyStatus: row.verify_status || "none",
    services: getAccountServices(row.id)
  };
}

function getAccountRowByEmail(email) {
  return db.prepare("SELECT * FROM accounts WHERE email = ?").get(email);
}

function getAccount(accountId) {
  return toPublicAccount(db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId));
}

// Вход по телефону находит ТОЛЬКО аккаунты, созданные через телефон
// (синтетический email phone_…@kuber.local). Иначе по OTP можно было бы войти
// в чужой email-аккаунт, где тот же номер указан как контакт.
function getAccountRowByPhone(phone) {
  return db
    .prepare("SELECT * FROM accounts WHERE phone = ? AND email LIKE 'phone%@kuber.local' LIMIT 1")
    .get(phone);
}

// Создать аккаунт для входа по телефону (без пароля, email синтетический).
function createPhoneAccount({ id, phone, name, role, cityId, createdAt }) {
  db.prepare(
    `INSERT INTO accounts (id, email, name, role, city_id, phone, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?)`
  ).run(id, `phone_${phone}@kuber.local`, name, role, cityId, phone, createdAt);
  return toPublicAccount(db.prepare("SELECT * FROM accounts WHERE id = ?").get(id));
}

// OTP
function setOtp(phone, code, expiresAt) {
  db.prepare(
    "INSERT INTO otp_codes (phone, code, expires_at, attempts) VALUES (?, ?, ?, 0) ON CONFLICT(phone) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, attempts = 0"
  ).run(phone, code, expiresAt);
}

function getOtp(phone) {
  return db.prepare("SELECT * FROM otp_codes WHERE phone = ?").get(phone);
}

// Увеличить счётчик неверных попыток; вернуть новое значение.
function bumpOtpAttempts(phone) {
  db.prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?").run(phone);
  const row = db.prepare("SELECT attempts FROM otp_codes WHERE phone = ?").get(phone);
  return row ? row.attempts : 99;
}

function deleteOtp(phone) {
  db.prepare("DELETE FROM otp_codes WHERE phone = ?").run(phone);
}

function createAccount(account) {
  db.prepare(
    `INSERT INTO accounts (id, email, name, role, city_id, password_hash, created_at)
     VALUES (@id, @email, @name, @role, @cityId, @passwordHash, @createdAt)`
  ).run(account);
  return toPublicAccount(getAccountRowByEmail(account.email));
}

function updateProfile(accountId, fields) {
  const current = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId);
  db.prepare(
    "UPDATE accounts SET name = ?, role = ?, city_id = ?, phone = ?, telegram = ?, radius_km = ?, available = ? WHERE id = ?"
  ).run(
    fields.name,
    fields.role,
    fields.cityId,
    fields.phone !== undefined ? fields.phone : current.phone,
    fields.telegram !== undefined ? fields.telegram : current.telegram,
    fields.radiusKm !== undefined ? Math.max(0, Math.round(fields.radiusKm)) : current.radius_km,
    fields.available !== undefined ? (fields.available ? 1 : 0) : current.available,
    accountId
  );
  if (Array.isArray(fields.services)) {
    setAccountServices(accountId, fields.services);
  }
  return toPublicAccount(db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId));
}

function listFavorites(accountId) {
  return db
    .prepare("SELECT executor_id FROM favorites WHERE account_id = ?")
    .all(accountId)
    .map((r) => r.executor_id);
}

function toggleFavorite(accountId, executorId) {
  const exists = db
    .prepare("SELECT 1 FROM favorites WHERE account_id = ? AND executor_id = ?")
    .get(accountId, executorId);
  if (exists) {
    db.prepare("DELETE FROM favorites WHERE account_id = ? AND executor_id = ?").run(accountId, executorId);
    return false;
  }
  db.prepare("INSERT INTO favorites (account_id, executor_id) VALUES (?, ?)").run(accountId, executorId);
  return true;
}

// --- Чат по заказу -----------------------------------------------------------

function listMessages(orderId) {
  return db
    .prepare("SELECT * FROM messages WHERE order_id = ? ORDER BY created_at ASC")
    .all(orderId)
    .map((m) => ({ id: m.id, orderId: m.order_id, fromId: m.from_id, text: m.text, createdAt: m.created_at }));
}

function addMessage({ id, orderId, fromId, text, createdAt }) {
  db.prepare(
    "INSERT INTO messages (id, order_id, from_id, text, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, orderId, fromId, text, createdAt);
  return { id, orderId, fromId, text, createdAt };
}

// --- Уведомления -------------------------------------------------------------

function addNotification({ id, accountId, type, text, orderId, createdAt }) {
  if (!accountId) {
    return;
  }
  db.prepare(
    `INSERT INTO notifications (id, account_id, type, text, order_id, read, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(id, accountId, type, text, orderId || "", createdAt);
  // Храним не больше 100 последних уведомлений на аккаунт.
  db.prepare(
    `DELETE FROM notifications WHERE account_id = ? AND id NOT IN (
       SELECT id FROM notifications WHERE account_id = ? ORDER BY created_at DESC LIMIT 100
     )`
  ).run(accountId, accountId);
}

function listNotifications(accountId) {
  const items = db
    .prepare("SELECT * FROM notifications WHERE account_id = ? ORDER BY created_at DESC LIMIT 50")
    .all(accountId)
    .map((n) => ({
      id: n.id,
      type: n.type,
      text: n.text,
      orderId: n.order_id,
      read: Boolean(n.read),
      createdAt: n.created_at
    }));
  const unread = db
    .prepare("SELECT COUNT(*) AS n FROM notifications WHERE account_id = ? AND read = 0")
    .get(accountId).n;
  return { items, unread };
}

function markNotificationsRead(accountId) {
  db.prepare("UPDATE notifications SET read = 1 WHERE account_id = ?").run(accountId);
}

// --- Push-токены -------------------------------------------------------------

function savePushToken(accountId, token, createdAt) {
  db.prepare(
    "INSERT INTO push_tokens (token, account_id, created_at) VALUES (?, ?, ?) ON CONFLICT(token) DO UPDATE SET account_id = excluded.account_id"
  ).run(token, accountId, createdAt);
}

function getPushTokens(accountId) {
  return db
    .prepare("SELECT token FROM push_tokens WHERE account_id = ?")
    .all(accountId)
    .map((r) => r.token);
}

// Исполнитель запросил верификацию → на модерацию.
function requestVerification(accountId) {
  db.prepare("UPDATE accounts SET verify_status = 'pending' WHERE id = ? AND verified = 0").run(accountId);
  return toPublicAccount(db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId));
}

function listPendingVerifications() {
  return db
    .prepare("SELECT * FROM accounts WHERE verify_status = 'pending' ORDER BY created_at")
    .all()
    .map(toPublicAccount);
}

function decideVerification(accountId, approve) {
  if (approve) {
    db.prepare("UPDATE accounts SET verified = 1, verify_status = 'verified' WHERE id = ?").run(accountId);
  } else {
    db.prepare("UPDATE accounts SET verified = 0, verify_status = 'rejected' WHERE id = ?").run(accountId);
  }
  return toPublicAccount(db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId));
}

function listUsers() {
  return db
    .prepare("SELECT * FROM accounts ORDER BY created_at DESC LIMIT 200")
    .all()
    .map(toPublicAccount);
}

// --- Регулярная доставка (расписания) ---------------------------------------

function scheduleRowToObj(row) {
  return {
    id: row.id,
    cityId: row.city_id,
    service: row.service,
    from: row.from_text,
    details: row.details,
    price: row.price,
    coordinates: [row.lng, row.lat],
    intervalDays: row.interval_days,
    nextRun: row.next_run,
    active: row.active === 1
  };
}

function listSchedules(customerId) {
  return db
    .prepare("SELECT * FROM schedules WHERE customer_id = ? ORDER BY created_at DESC")
    .all(customerId)
    .map(scheduleRowToObj);
}

function createSchedule(s) {
  db.prepare(
    `INSERT INTO schedules
       (id, customer_id, city_id, service, from_text, details, price, lng, lat, interval_days, next_run, active, created_at)
     VALUES (@id, @customerId, @cityId, @service, @from, @details, @price, @lng, @lat, @intervalDays, @nextRun, 1, @createdAt)`
  ).run(s);
  return scheduleRowToObj(db.prepare("SELECT * FROM schedules WHERE id = ?").get(s.id));
}

function deleteSchedule(id, customerId) {
  db.prepare("DELETE FROM schedules WHERE id = ? AND customer_id = ?").run(id, customerId);
}

function dueSchedules(now) {
  return db.prepare("SELECT * FROM schedules WHERE active = 1 AND next_run <= ?").all(now);
}

function bumpSchedule(id, nextRun) {
  db.prepare("UPDATE schedules SET next_run = ? WHERE id = ?").run(nextRun, id);
}

// Статистика исполнителя: заработано и число выполненных заказов.
function getExecutorStats(executorId) {
  const row = db
    .prepare("SELECT COUNT(*) AS jobs, COALESCE(SUM(price), 0) AS earned FROM orders WHERE executor_id = ? AND status = 'done'")
    .get(executorId);
  return { jobs: row.jobs, earned: row.earned };
}

function createSession(token, accountId, createdAt) {
  db.prepare("INSERT INTO sessions (token, account_id, created_at) VALUES (?, ?, ?)").run(
    token,
    accountId,
    createdAt
  );
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 дней

function getAccountByToken(token) {
  if (!token) {
    return null;
  }
  const row = db
    .prepare(
      `SELECT a.*, s.created_at AS session_created FROM sessions s
         JOIN accounts a ON a.id = s.account_id WHERE s.token = ?`
    )
    .get(token);
  if (!row) {
    return null;
  }
  // Просроченные токены недействительны (защита от вечных сессий).
  if (Date.now() - row.session_created > SESSION_TTL_MS) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return toPublicAccount(row);
}

function deleteSession(token) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

function insertOrder(order) {
  db.prepare(
    `INSERT INTO orders
       (id, city_id, customer_id, service, from_text, details, price, distance, status, lng, lat, customer_name, created_at)
     VALUES (@id, @cityId, @customerId, @service, @from, @details, @price, @distance, @status, @lng, @lat, @customerName, @createdAt)`
  ).run(order);
  return getOrder(order.id);
}

// --- Настройки ---------------------------------------------------------------

function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}

// --- Отклики -----------------------------------------------------------------

function hasBid(orderId, driverId) {
  if (!driverId) {
    return false;
  }
  return Boolean(
    db.prepare("SELECT 1 FROM bids WHERE order_id = ? AND driver_id = ?").get(orderId, driverId)
  );
}

function deleteBid(orderId, bidId) {
  db.prepare("DELETE FROM bids WHERE id = ? AND order_id = ?").run(bidId, orderId);
  return getOrder(orderId);
}

// --- Кошелёк исполнителя -----------------------------------------------------

function getWallet(accountId) {
  const acc = db.prepare("SELECT balance FROM accounts WHERE id = ?").get(accountId);
  const transactions = db
    .prepare("SELECT * FROM transactions WHERE account_id = ? ORDER BY created_at DESC LIMIT 50")
    .all(accountId)
    .map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      balanceAfter: t.balance_after,
      note: t.note,
      createdAt: t.created_at
    }));
  return { balance: acc ? acc.balance : 0, transactions };
}

// Зачисление (пополнение/бонус). amount > 0.
function credit(accountId, { id, amount, type, note, createdAt }) {
  const tx = db.transaction(() => {
    const acc = db.prepare("SELECT balance FROM accounts WHERE id = ?").get(accountId);
    const next = (acc ? acc.balance : 0) + amount;
    db.prepare("UPDATE accounts SET balance = ? WHERE id = ?").run(next, accountId);
    db.prepare(
      `INSERT INTO transactions (id, account_id, type, amount, balance_after, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, accountId, type, amount, next, note, createdAt);
    return next;
  });
  return tx();
}

// Списание за отклик. Возвращает { ok, balance }. ok=false при нехватке средств.
function chargeForBid(accountId, { id, fee, note, createdAt }) {
  const tx = db.transaction(() => {
    const acc = db.prepare("SELECT balance FROM accounts WHERE id = ?").get(accountId);
    const balance = acc ? acc.balance : 0;
    if (balance < fee) {
      return { ok: false, balance };
    }
    const next = balance - fee;
    db.prepare("UPDATE accounts SET balance = ? WHERE id = ?").run(next, accountId);
    db.prepare(
      `INSERT INTO transactions (id, account_id, type, amount, balance_after, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, accountId, "charge", -fee, next, note, createdAt);
    return { ok: true, balance: next };
  });
  return tx();
}

// Вывод средств с баланса. Возвращает { ok, balance }.
function withdraw(accountId, { id, amount, note, createdAt }) {
  const tx = db.transaction(() => {
    const acc = db.prepare("SELECT balance FROM accounts WHERE id = ?").get(accountId);
    const balance = acc ? acc.balance : 0;
    if (balance < amount) {
      return { ok: false, balance };
    }
    const next = balance - amount;
    db.prepare("UPDATE accounts SET balance = ? WHERE id = ?").run(next, accountId);
    db.prepare(
      `INSERT INTO transactions (id, account_id, type, amount, balance_after, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, accountId, "withdraw", -amount, next, note, createdAt);
    return { ok: true, balance: next };
  });
  return tx();
}

function insertBid(bid) {
  db.prepare(
    `INSERT INTO bids (id, order_id, driver_id, driver, price, eta, rating, created_at)
     VALUES (@id, @orderId, @driverId, @driver, @price, @eta, @rating, @createdAt)`
  ).run(bid);
  return getOrder(bid.orderId)?.bids.find((b) => b.id === bid.id) ?? null;
}

function acceptBid(orderId, bidId) {
  const order = db.prepare("SELECT id FROM orders WHERE id = ?").get(orderId);
  if (!order) {
    return null;
  }
  const bid = db.prepare("SELECT driver_id FROM bids WHERE id = ? AND order_id = ?").get(bidId, orderId);
  if (!bid) {
    return null;
  }

  const tx = db.transaction(() => {
    db.prepare("UPDATE orders SET status = 'matched', executor_id = ? WHERE id = ?").run(
      bid.driver_id,
      orderId
    );
    db.prepare("DELETE FROM bids WHERE order_id = ? AND id != ?").run(orderId, bidId);
  });
  tx();

  return getOrder(orderId);
}

// Биржа исполнителя: открытые заказы города, отфильтрованные по его специализациям.
function listBourse(cityId, serviceKeys) {
  const rows = db
    .prepare("SELECT * FROM orders WHERE city_id = ? AND status = 'open' ORDER BY created_at DESC")
    .all(cityId)
    .map(orderRowToOrder);
  if (!serviceKeys || serviceKeys.length === 0) {
    return rows;
  }
  const set = new Set(serviceKeys);
  return rows.filter((order) => set.has(order.service));
}

// Заказы, которые исполнитель выиграл (в работе/выполненные).
function listOrdersByExecutor(executorId) {
  return db
    .prepare("SELECT * FROM orders WHERE executor_id = ? ORDER BY created_at DESC")
    .all(executorId)
    .map(orderRowToOrder);
}

function getOrderRow(orderId) {
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
}

// Исполнитель отметил заказ выполненным → ждём подтверждения заказчика.
function finishOrder(orderId) {
  db.prepare("UPDATE orders SET status = 'finished' WHERE id = ?").run(orderId);
  return getOrder(orderId);
}

// Заказчик подтвердил выполнение → заказ закрыт.
function confirmOrder(orderId) {
  db.prepare("UPDATE orders SET status = 'done' WHERE id = ?").run(orderId);
  return getOrder(orderId);
}

function deleteOrder(orderId) {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM bids WHERE order_id = ?").run(orderId);
    db.prepare("DELETE FROM orders WHERE id = ?").run(orderId);
  });
  tx();
}

// Отзыв заказчика об исполнителе: пишем отзыв, обновляем агрегат рейтинга, помечаем заказ.
function addReview({ id, orderId, fromId, toId, rating, text, createdAt }) {
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO reviews (id, order_id, from_id, to_id, rating, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, orderId, fromId, toId, rating, text, createdAt);
    db.prepare(
      "UPDATE accounts SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE id = ?"
    ).run(rating, toId);
    db.prepare("UPDATE orders SET reviewed = 1 WHERE id = ?").run(orderId);
  });
  tx();
  return getOrder(orderId);
}

module.exports = {
  db,
  getCatalog,
  getCity,
  listOrders,
  listOpenOrders,
  listBourse,
  listOrdersByCustomer,
  listOrdersByExecutor,
  getOrder,
  getOrderRow,
  toPublicAccount,
  getAccountRowByEmail,
  getAccountRowByPhone,
  getAccount,
  createAccount,
  createPhoneAccount,
  setOtp,
  getOtp,
  bumpOtpAttempts,
  deleteOtp,
  updateProfile,
  createSession,
  getAccountByToken,
  deleteSession,
  insertOrder,
  insertBid,
  acceptBid,
  finishOrder,
  confirmOrder,
  deleteOrder,
  addReview,
  addNotification,
  listNotifications,
  markNotificationsRead,
  savePushToken,
  getPushTokens,
  getWallet,
  credit,
  chargeForBid,
  withdraw,
  getSetting,
  setSetting,
  hasBid,
  deleteBid,
  listFavorites,
  toggleFavorite,
  getExecutorStats,
  listMessages,
  addMessage,
  requestVerification,
  listPendingVerifications,
  decideVerification,
  listUsers,
  listSchedules,
  createSchedule,
  deleteSchedule,
  dueSchedules,
  bumpSchedule
};
