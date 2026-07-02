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
      category TEXT NOT NULL DEFAULT 'transport',
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

    -- Портфолио исполнителя: примеры работ (заголовок, описание, ссылка на фото).
    CREATE TABLE IF NOT EXISTS portfolio_items (
      id          TEXT PRIMARY KEY,
      account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      photo_url   TEXT NOT NULL DEFAULT '',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    );

    -- Заявки на верификацию по услуге и типу документа (с фото документа).
    CREATE TABLE IF NOT EXISTS verification_requests (
      id          TEXT PRIMARY KEY,
      account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      service_key TEXT NOT NULL,
      doc_type    TEXT NOT NULL,
      photo       TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  INTEGER NOT NULL,
      decided_at  INTEGER NOT NULL DEFAULT 0
    );

    -- Плата за отклик по нише: (город × услуга) → стоимость в монетах.
    -- Строки нет / enabled=0 → отклик бесплатный.
    CREATE TABLE IF NOT EXISTS pricing (
      city_id     TEXT NOT NULL,
      service_key TEXT NOT NULL,
      coin_cost   INTEGER NOT NULL DEFAULT 0,
      enabled     INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (city_id, service_key)
    );

    -- Сохранённые адреса заказчика («Дом», «Дача» и т.п.).
    CREATE TABLE IF NOT EXISTS saved_places (
      id         TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      label      TEXT NOT NULL,
      from_text  TEXT NOT NULL,
      lng        REAL NOT NULL,
      lat        REAL NOT NULL,
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
    CREATE INDEX IF NOT EXISTS idx_portfolio_account  ON portfolio_items(account_id);
    CREATE INDEX IF NOT EXISTS idx_orders_service     ON orders(service);
    CREATE INDEX IF NOT EXISTS idx_verif_account      ON verification_requests(account_id);
    CREATE INDEX IF NOT EXISTS idx_verif_status       ON verification_requests(status);
    CREATE INDEX IF NOT EXISTS idx_places_account     ON saved_places(account_id);
    CREATE INDEX IF NOT EXISTS idx_orders_created     ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_accounts_created   ON accounts(created_at);
    CREATE INDEX IF NOT EXISTS idx_tx_created         ON transactions(created_at);
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
  add("accounts", "bio", "bio TEXT NOT NULL DEFAULT ''");
  add("accounts", "last_reminded_at", "last_reminded_at INTEGER NOT NULL DEFAULT 0");
  add("accounts", "banned", "banned INTEGER NOT NULL DEFAULT 0");
  add("services", "category", "category TEXT NOT NULL DEFAULT 'transport'");
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
    "INSERT INTO services (key, title, subtitle, icon, accent, category, sort) VALUES (?, ?, ?, ?, ?, ?, ?)"
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
        service.category ?? "transport",
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

// Приводим реестр услуг к тому, что задано в seed.js, даже если база уже создана
// (напр. постоянная БД на сервере). Добавляет новые услуги/категории и обновляет
// метаданные существующих, не трогая заказы и специализации исполнителей.
function syncServices() {
  const upsert = db.prepare(
    `INSERT INTO services (key, title, subtitle, icon, accent, category, sort)
     VALUES (@key, @title, @subtitle, @icon, @accent, @category, @sort)
     ON CONFLICT(key) DO UPDATE SET
       title = excluded.title, subtitle = excluded.subtitle, icon = excluded.icon,
       accent = excluded.accent, category = excluded.category, sort = excluded.sort`
  );
  const addCityService = db.prepare(
    "INSERT OR IGNORE INTO city_services (city_id, service_key) VALUES (?, ?)"
  );
  const tx = db.transaction(() => {
    for (const service of seed.services) {
      upsert.run({
        key: service.key,
        title: service.title,
        subtitle: service.subtitle,
        icon: service.icon,
        accent: service.accent,
        category: service.category ?? "transport",
        sort: service.sort ?? 0
      });
    }
    for (const [cityId, keys] of Object.entries(seed.cityServices)) {
      const cityExists = db.prepare("SELECT 1 FROM cities WHERE id = ?").get(cityId);
      if (!cityExists) continue;
      for (const key of keys) {
        addCityService.run(cityId, key);
      }
    }
  });
  tx();
}

migrate();
ensureColumns();
createIndexes();
seedIfEmpty();
syncServices();

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
      `SELECT b.*, a.rating_sum AS a_sum, a.rating_count AS a_count, a.verified AS a_verified,
         (SELECT COUNT(*) FROM orders o WHERE o.executor_id = b.driver_id AND o.status = 'done') AS a_jobs,
         (SELECT COUNT(*) FROM verification_requests vr
            WHERE vr.account_id = b.driver_id AND vr.service_key = @service AND vr.status = 'verified') AS a_verif_service
         FROM bids b LEFT JOIN accounts a ON a.id = b.driver_id
        WHERE b.order_id = @orderId ORDER BY b.created_at DESC`
    )
    .all({ orderId: row.id, service: row.service })
    .map((bid) => ({
      id: bid.id,
      driverId: bid.driver_id,
      driver: bid.driver,
      price: bid.price,
      eta: bid.eta,
      // рейтинг исполнителя: живой из аккаунта, иначе значение из ставки
      rating: bid.a_count > 0 ? bid.a_sum / bid.a_count : bid.rating,
      ratingCount: bid.a_count || 0,
      jobsCompleted: bid.a_jobs || 0,
      verified: bid.a_verified === 1,
      // профессия подтверждена документом именно для услуги этого заказа
      verifiedService: (bid.a_verif_service || 0) > 0
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
    .prepare("SELECT key, title, subtitle, icon, accent, category FROM services ORDER BY sort, title")
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

  // Категории (метаданные для группировки услуг в UI) — статичны, берём из seed,
  // но показываем только те, в которых реально есть услуги.
  const usedCategories = new Set(services.map((s) => s.category).filter(Boolean));
  const categories = (seed.categories || [])
    .filter((c) => usedCategories.has(c.key))
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((c) => ({ key: c.key, title: c.title }));

  return { regions: regionsWithCities, cities, services, categories };
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
    bio: row.bio || "",
    banned: row.banned === 1,
    services: getAccountServices(row.id),
    verificationBadges: getExecutorBadges(row.id)
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

// Пользователи с поиском (имя/почта/телефон) и постраничной подгрузкой.
function listUsers({ q, limit, offset } = {}) {
  const lim = Math.max(1, Math.min(50, Math.round(limit || 20)));
  const off = Math.max(0, Math.round(offset || 0));
  const like = q && q.trim() ? `%${q.trim()}%` : null;
  return db
    .prepare(
      `SELECT * FROM accounts
        WHERE (@like IS NULL OR name LIKE @like OR email LIKE @like OR phone LIKE @like)
        ORDER BY created_at DESC LIMIT @lim OFFSET @off`
    )
    .all({ like, lim, off })
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

// --- Портфолио исполнителя ---------------------------------------------------

function listPortfolio(accountId) {
  return db
    .prepare(
      "SELECT id, title, description, photo_url, created_at FROM portfolio_items WHERE account_id = ? ORDER BY sort_order, created_at DESC LIMIT 30"
    )
    .all(accountId)
    .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      photoUrl: row.photo_url,
      createdAt: row.created_at
    }));
}

function addPortfolioItem({ id, accountId, title, description, photoUrl, createdAt }) {
  const count = db
    .prepare("SELECT COUNT(*) AS n FROM portfolio_items WHERE account_id = ?")
    .get(accountId).n;
  if (count >= 30) {
    return { ok: false };
  }
  db.prepare(
    `INSERT INTO portfolio_items (id, account_id, title, description, photo_url, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, accountId, title, description, photoUrl, createdAt, createdAt);
  return { ok: true };
}

function deletePortfolioItem(accountId, itemId) {
  db.prepare("DELETE FROM portfolio_items WHERE id = ? AND account_id = ?").run(itemId, accountId);
}

function setBio(accountId, bio) {
  db.prepare("UPDATE accounts SET bio = ? WHERE id = ?").run(bio, accountId);
}

// Публичный профиль исполнителя: аккаунт + био + портфолио + последние отзывы + статистика.
function getExecutorProfile(executorId) {
  const account = toPublicAccount(
    db.prepare("SELECT * FROM accounts WHERE id = ?").get(executorId)
  );
  if (!account) {
    return null;
  }
  const reviews = db
    .prepare(
      `SELECT r.id, r.rating, r.text, r.created_at, a.name AS author
         FROM reviews r LEFT JOIN accounts a ON a.id = r.from_id
        WHERE r.to_id = ? ORDER BY r.created_at DESC LIMIT 10`
    )
    .all(executorId)
    .map((row) => ({
      id: row.id,
      rating: row.rating,
      text: row.text,
      createdAt: row.created_at,
      author: row.author || "Заказчик"
    }));
  const stats = getExecutorStats(executorId);
  return {
    ...account,
    portfolio: listPortfolio(executorId),
    reviews,
    jobsCompleted: stats.jobs
  };
}

// --- Аналитика спроса --------------------------------------------------------
// Агрегируем из таблицы orders — отдельная таблица событий не нужна для MVP.

// Богатая аналитика: деньги (GMV, доход платформы), люди (активность/логины),
// срезы по услугам/категориям/городам и клеткам (город × ниша). Опционально
// ограничивается городом cityId (null = все города).
function getDemandAnalytics(fromTime, toTime, cityId) {
  const scoped = { from: fromTime, to: toTime, cityId: cityId || null };
  const win = { from: fromTime, to: toTime };

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(price), 0) AS gmv,
              SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS doneOrders,
              COALESCE(SUM(CASE WHEN status = 'done' THEN price ELSE 0 END), 0) AS doneGmv,
              COUNT(DISTINCT customer_id) AS activeClients
         FROM orders
        WHERE created_at BETWEEN @from AND @to AND (@cityId IS NULL OR city_id = @cityId)`
    )
    .get(scoped);

  const activeDrivers = db
    .prepare(
      `SELECT COUNT(DISTINCT b.driver_id) AS n
         FROM bids b JOIN orders o ON o.id = b.order_id
        WHERE b.created_at BETWEEN @from AND @to AND (@cityId IS NULL OR o.city_id = @cityId)`
    )
    .get(scoped).n;

  const newClients = db
    .prepare(
      "SELECT COUNT(*) AS n FROM accounts WHERE role = 'client' AND created_at BETWEEN @from AND @to AND (@cityId IS NULL OR city_id = @cityId)"
    )
    .get(scoped).n;
  const newDrivers = db
    .prepare(
      "SELECT COUNT(*) AS n FROM accounts WHERE role = 'driver' AND created_at BETWEEN @from AND @to AND (@cityId IS NULL OR city_id = @cityId)"
    )
    .get(scoped).n;

  // Посещаемость (логины): сессии за период по роли.
  const loginRows = db
    .prepare(
      `SELECT a.role AS role, COUNT(*) AS n
         FROM sessions s JOIN accounts a ON a.id = s.account_id
        WHERE s.created_at BETWEEN @from AND @to AND (@cityId IS NULL OR a.city_id = @cityId)
        GROUP BY a.role`
    )
    .all(scoped);
  let clientLogins = 0;
  let driverLogins = 0;
  for (const r of loginRows) {
    if (r.role === "driver") driverLogins = r.n;
    else clientLogins += r.n;
  }

  // Доход платформы в монетах = списания за отклики (charge, amount отрицательный).
  const coinRevenue = db
    .prepare("SELECT COALESCE(-SUM(amount), 0) AS n FROM transactions WHERE type = 'charge' AND created_at BETWEEN @from AND @to")
    .get(win).n;

  const byService = db
    .prepare(
      `SELECT service, COUNT(*) AS count, COALESCE(SUM(price), 0) AS gmv, COALESCE(ROUND(AVG(price)), 0) AS avgPrice
         FROM orders WHERE created_at BETWEEN @from AND @to AND (@cityId IS NULL OR city_id = @cityId)
        GROUP BY service ORDER BY gmv DESC`
    )
    .all(scoped);

  // По городам — всегда без фильтра, чтобы видеть картину целиком.
  const byCity = db
    .prepare(
      `SELECT city_id, COUNT(*) AS count, COALESCE(SUM(price), 0) AS gmv
         FROM orders WHERE created_at BETWEEN @from AND @to
        GROUP BY city_id ORDER BY gmv DESC`
    )
    .all(win);

  // Клетки (город × ниша): оборот + fill-rate + глубина откликов + предложение.
  const matrix = db
    .prepare(
      `SELECT o.city_id, o.service,
              COUNT(*) AS count,
              COALESCE(SUM(o.price), 0) AS gmv,
              SUM(CASE WHEN o.status = 'done' THEN 1 ELSE 0 END) AS done,
              (SELECT COUNT(*) FROM bids b JOIN orders ob ON ob.id = b.order_id
                 WHERE ob.city_id = o.city_id AND ob.service = o.service
                   AND ob.created_at BETWEEN @from AND @to) AS bidsTotal,
              (SELECT COUNT(*) FROM accounts a
                 WHERE a.role = 'driver' AND a.available = 1 AND a.city_id = o.city_id
                   AND EXISTS (SELECT 1 FROM account_services s WHERE s.account_id = a.id AND s.service_key = o.service)) AS supply
         FROM orders o
        WHERE o.created_at BETWEEN @from AND @to AND (@cityId IS NULL OR o.city_id = @cityId)
        GROUP BY o.city_id, o.service ORDER BY gmv DESC LIMIT 40`
    )
    .all(scoped);

  // Удержание: доля заказчиков с ≥2 заказами за период.
  const retention = db
    .prepare(
      `SELECT ROUND(100.0 * COUNT(DISTINCT CASE WHEN c >= 2 THEN customer_id END) / NULLIF(COUNT(DISTINCT customer_id), 0)) AS repeatRate
         FROM (SELECT customer_id, COUNT(*) AS c FROM orders
                WHERE created_at BETWEEN @from AND @to AND (@cityId IS NULL OR city_id = @cityId)
                GROUP BY customer_id)`
    )
    .get(scoped);

  return {
    totals: {
      ...totals,
      activeDrivers,
      newClients,
      newDrivers,
      clientLogins,
      driverLogins,
      coinRevenue,
      repeatRate: retention.repeatRate || 0
    },
    byService,
    byCity,
    matrix
  };
}

// --- Верификация по документу -----------------------------------------------

// Подтверждённые квалификации исполнителя (по услугам) — для бейджей.
function getExecutorBadges(accountId) {
  return db
    .prepare(
      "SELECT DISTINCT service_key, doc_type FROM verification_requests WHERE account_id = ? AND status = 'verified'"
    )
    .all(accountId)
    .map((r) => ({ serviceKey: r.service_key, docType: r.doc_type }));
}

function verificationRowToObj(r) {
  return {
    id: r.id,
    accountId: r.account_id,
    serviceKey: r.service_key,
    docType: r.doc_type,
    photo: r.photo,
    status: r.status,
    createdAt: r.created_at,
    decidedAt: r.decided_at || 0
  };
}

// Заявки исполнителя (свои) — без тяжёлого фото в списке.
function listVerificationRequests(accountId) {
  return db
    .prepare(
      "SELECT id, account_id, service_key, doc_type, '' AS photo, status, created_at, decided_at FROM verification_requests WHERE account_id = ? ORDER BY created_at DESC"
    )
    .all(accountId)
    .map(verificationRowToObj);
}

// Есть ли уже активная (pending/verified) заявка по этой услуге.
function hasActiveVerification(accountId, serviceKey) {
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM verification_requests WHERE account_id = ? AND service_key = ? AND status IN ('pending','verified')"
      )
      .get(accountId, serviceKey)
  );
}

function countPendingVerifications(accountId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM verification_requests WHERE account_id = ? AND status = 'pending'")
    .get(accountId).n;
}

function createVerificationRequest({ id, accountId, serviceKey, docType, photo, createdAt }) {
  db.prepare(
    `INSERT INTO verification_requests (id, account_id, service_key, doc_type, photo, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`
  ).run(id, accountId, serviceKey, docType, photo, createdAt);
  return verificationRowToObj(
    db.prepare("SELECT * FROM verification_requests WHERE id = ?").get(id)
  );
}

// Для админа: заявки на модерации, с фото и данными исполнителя.
function listPendingVerificationRequests() {
  return db
    .prepare(
      `SELECT v.*, a.name AS account_name, a.email AS account_email, a.phone AS account_phone
         FROM verification_requests v JOIN accounts a ON a.id = v.account_id
        WHERE v.status = 'pending' ORDER BY v.created_at ASC`
    )
    .all()
    .map((r) => ({
      id: r.id,
      accountId: r.account_id,
      accountName: r.account_name,
      accountEmail: r.account_email,
      accountPhone: r.account_phone || "",
      serviceKey: r.service_key,
      docType: r.doc_type,
      photo: r.photo,
      status: r.status,
      createdAt: r.created_at
    }));
}

function decideVerificationRequest(requestId, approve) {
  const row = db.prepare("SELECT * FROM verification_requests WHERE id = ?").get(requestId);
  if (!row) {
    return null;
  }
  db.prepare("UPDATE verification_requests SET status = ?, decided_at = ? WHERE id = ?").run(
    approve ? "verified" : "rejected",
    Date.now(),
    requestId
  );
  return verificationRowToObj(
    db.prepare("SELECT * FROM verification_requests WHERE id = ?").get(requestId)
  );
}

// --- Плата за отклик по нише (город × услуга) -------------------------------

function getPricingRule(cityId, serviceKey) {
  return db
    .prepare("SELECT coin_cost, enabled FROM pricing WHERE city_id = ? AND service_key = ?")
    .get(cityId, serviceKey);
}

function setPricingRule(cityId, serviceKey, coinCost, enabled) {
  db.prepare(
    `INSERT INTO pricing (city_id, service_key, coin_cost, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(city_id, service_key) DO UPDATE SET
       coin_cost = excluded.coin_cost, enabled = excluded.enabled, updated_at = excluded.updated_at`
  ).run(cityId, serviceKey, Math.max(0, Math.round(coinCost)), enabled ? 1 : 0, Date.now());
}

// Все установленные правила (для админ-грида и клиентского кэша).
function listPricingRules() {
  return db
    .prepare("SELECT city_id, service_key, coin_cost, enabled FROM pricing")
    .all()
    .map((r) => ({
      cityId: r.city_id,
      serviceKey: r.service_key,
      coinCost: r.coin_cost,
      enabled: r.enabled === 1
    }));
}

// --- Подсказка цены (город × услуга) ----------------------------------------
// Берём цены всех заказов по нише (это ожидания заказчиков). Мало данных → null.
function getPriceHint(cityId, serviceKey) {
  const prices = db
    .prepare("SELECT price FROM orders WHERE city_id = ? AND service = ? ORDER BY price ASC")
    .all(cityId, serviceKey)
    .map((r) => r.price);
  if (prices.length < 3) {
    return null;
  }
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2);
  return { count: prices.length, min: prices[0], max: prices[prices.length - 1], median };
}

// --- Сохранённые адреса заказчика -------------------------------------------
function listPlaces(accountId) {
  return db
    .prepare("SELECT * FROM saved_places WHERE account_id = ? ORDER BY created_at DESC")
    .all(accountId)
    .map((r) => ({ id: r.id, label: r.label, fromText: r.from_text, lng: r.lng, lat: r.lat, createdAt: r.created_at }));
}

function addPlace({ id, accountId, label, fromText, lng, lat, createdAt }) {
  db.prepare(
    "INSERT INTO saved_places (id, account_id, label, from_text, lng, lat, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, accountId, label, fromText, lng, lat, createdAt);
  return { id, label, fromText, lng, lat, createdAt };
}

function deletePlace(id, accountId) {
  db.prepare("DELETE FROM saved_places WHERE id = ? AND account_id = ?").run(id, accountId);
}

// --- Охват заказа: сколько исполнителей потенциально видят открытый заказ ----
function countReach(cityId, serviceKey) {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT a.id) AS reach FROM accounts a
        WHERE a.role = 'driver' AND a.available = 1 AND a.city_id = ?
          AND EXISTS (SELECT 1 FROM account_services s WHERE s.account_id = a.id AND s.service_key = ?)`
    )
    .get(cityId, serviceKey);
  return row ? row.reach : 0;
}

// --- Напоминания по циклу потребления ---------------------------------------
// Кандидаты: последний выполненный заказ по нише старше cutoff, нет активного
// расписания и открытого заказа по этой услуге, давно не напоминали.
function getReminderCandidates(cutoff) {
  return db
    .prepare(
      `SELECT o.customer_id AS accountId, o.service AS service, MAX(o.created_at) AS lastOrder,
              a.last_reminded_at AS lastReminded
         FROM orders o JOIN accounts a ON a.id = o.customer_id
        WHERE o.status = 'done'
        GROUP BY o.customer_id, o.service
       HAVING MAX(o.created_at) <= @cutoff
          AND a.last_reminded_at <= @cutoff
          AND NOT EXISTS (SELECT 1 FROM schedules s
                            WHERE s.customer_id = o.customer_id AND s.service = o.service AND s.active = 1)
          AND NOT EXISTS (SELECT 1 FROM orders o3
                            WHERE o3.customer_id = o.customer_id AND o3.service = o.service
                              AND o3.status IN ('open','matched','finished'))`
    )
    .all({ cutoff });
}

function markReminded(accountId, when) {
  db.prepare("UPDATE accounts SET last_reminded_at = ? WHERE id = ?").run(when, accountId);
}

// --- Массовые цены ----------------------------------------------------------
function setPricingRules(rules) {
  const stmt = db.prepare(
    `INSERT INTO pricing (city_id, service_key, coin_cost, enabled, updated_at)
     VALUES (@cityId, @serviceKey, @coinCost, @enabled, @now)
     ON CONFLICT(city_id, service_key) DO UPDATE SET
       coin_cost = excluded.coin_cost, enabled = excluded.enabled, updated_at = excluded.updated_at`
  );
  const tx = db.transaction((list) => {
    for (const r of list) {
      stmt.run({
        cityId: r.cityId,
        serviceKey: r.serviceKey,
        coinCost: Math.max(0, Math.round(r.coinCost || 0)),
        enabled: r.enabled ? 1 : 0,
        now: Date.now()
      });
    }
  });
  tx(rules);
}

// --- Модерация пользователей ------------------------------------------------
function setBanned(accountId, banned) {
  db.prepare("UPDATE accounts SET banned = ? WHERE id = ?").run(banned ? 1 : 0, accountId);
}

// Ручная корректировка баланса админом (amount>0 — начисление, <0 — списание).
function adminAdjustBalance(accountId, amount, note) {
  return credit(accountId, {
    id: `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    amount,
    type: amount >= 0 ? "bonus" : "charge",
    note: note || (amount >= 0 ? "Начисление админом" : "Списание админом"),
    createdAt: Date.now()
  });
}

// --- Админ: ленты заказов и транзакций --------------------------------------
function listOrdersAdmin({ cityId, status, limit, offset }) {
  const lim = Math.max(1, Math.min(50, Math.round(limit || 20)));
  const off = Math.max(0, Math.round(offset || 0));
  const rows = db
    .prepare(
      `SELECT o.id, o.city_id, o.service, o.price, o.status, o.customer_name, o.created_at,
              (SELECT COUNT(*) FROM bids b WHERE b.order_id = o.id) AS bids
         FROM orders o
        WHERE (@cityId IS NULL OR o.city_id = @cityId)
          AND (@status IS NULL OR o.status = @status)
        ORDER BY o.created_at DESC LIMIT @lim OFFSET @off`
    )
    .all({ cityId: cityId || null, status: status || null, lim, off });
  return rows.map((r) => ({
    id: r.id,
    cityId: r.city_id,
    service: r.service,
    price: r.price,
    status: r.status,
    customerName: r.customer_name,
    bids: r.bids,
    createdAt: r.created_at
  }));
}

function listRecentTransactions(limit, offset) {
  const lim = Math.max(1, Math.min(50, Math.round(limit || 20)));
  const off = Math.max(0, Math.round(offset || 0));
  return db
    .prepare(
      `SELECT t.id, t.account_id, t.type, t.amount, t.balance_after, t.note, t.created_at, a.name AS account_name
         FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
        ORDER BY t.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(lim, off)
    .map((t) => ({
      id: t.id,
      accountId: t.account_id,
      accountName: t.account_name || "—",
      type: t.type,
      amount: t.amount,
      balanceAfter: t.balance_after,
      note: t.note,
      createdAt: t.created_at
    }));
}

// --- Админ: управление каталогом --------------------------------------------
function upsertRegion(id, name, sort) {
  db.prepare(
    `INSERT INTO regions (id, name, sort) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort = excluded.sort`
  ).run(id, name, Math.max(0, Math.round(sort || 0)));
}

function upsertCity(id, regionId, name, centerLng, centerLat, zoom, sort) {
  if (!db.prepare("SELECT 1 FROM regions WHERE id = ?").get(regionId)) {
    throw new Error("region_not_found");
  }
  db.prepare(
    `INSERT INTO cities (id, region_id, name, center_lng, center_lat, zoom, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       region_id = excluded.region_id, name = excluded.name,
       center_lng = excluded.center_lng, center_lat = excluded.center_lat,
       zoom = excluded.zoom, sort = excluded.sort`
  ).run(id, regionId, name, Number(centerLng), Number(centerLat), Math.max(1, Math.round(zoom || 11)), Math.max(0, Math.round(sort || 0)));
}

function upsertService(key, title, subtitle, icon, accent, category, sort) {
  db.prepare(
    `INSERT INTO services (key, title, subtitle, icon, accent, category, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       title = excluded.title, subtitle = excluded.subtitle, icon = excluded.icon,
       accent = excluded.accent, category = excluded.category, sort = excluded.sort`
  ).run(key, title, subtitle, icon, accent, category || "transport", Math.max(0, Math.round(sort || 0)));
}

function setCityService(cityId, serviceKey, enabled) {
  if (!db.prepare("SELECT 1 FROM cities WHERE id = ?").get(cityId)) {
    throw new Error("city_not_found");
  }
  if (!db.prepare("SELECT 1 FROM services WHERE key = ?").get(serviceKey)) {
    throw new Error("service_not_found");
  }
  if (enabled) {
    db.prepare("INSERT OR IGNORE INTO city_services (city_id, service_key) VALUES (?, ?)").run(cityId, serviceKey);
  } else {
    db.prepare("DELETE FROM city_services WHERE city_id = ? AND service_key = ?").run(cityId, serviceKey);
  }
}

module.exports = {
  db,
  getCatalog,
  getPriceHint,
  setPricingRules,
  setBanned,
  adminAdjustBalance,
  listOrdersAdmin,
  listRecentTransactions,
  upsertRegion,
  upsertCity,
  upsertService,
  setCityService,
  listPlaces,
  addPlace,
  deletePlace,
  countReach,
  getReminderCandidates,
  markReminded,
  listPortfolio,
  addPortfolioItem,
  deletePortfolioItem,
  setBio,
  getExecutorProfile,
  getDemandAnalytics,
  getExecutorBadges,
  listVerificationRequests,
  hasActiveVerification,
  countPendingVerifications,
  createVerificationRequest,
  listPendingVerificationRequests,
  decideVerificationRequest,
  getPricingRule,
  setPricingRule,
  listPricingRules,
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
