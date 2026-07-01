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
    env: { ...process.env, PORT: String(PORT), DB_FILE: DB, BID_FEE: "50", SIGNUP_BONUS: "200" },
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

    const acc = await req("POST", `/api/orders/${oid}/accept`, { bidId }, tc);
    check("принятие → matched + исполнитель", acc.body?.status === "matched" && !!acc.body?.executor);

    check("исполнитель завершает → finished", (await req("POST", `/api/orders/${oid}/finish`, {}, td)).body?.status === "finished");
    check("заказчик не может finish (403)", (await req("POST", `/api/orders/${oid}/finish`, {}, tc)).status === 403);
    check("заказчик подтверждает → done", (await req("POST", `/api/orders/${oid}/confirm`, {}, tc)).body?.status === "done");
    check("отзыв ставится", (await req("POST", `/api/orders/${oid}/review`, { rating: 5, text: "ок" }, tc)).body?.reviewed === true);
    check("рейтинг исполнителя обновился", (await req("GET", "/api/auth/me", null, td)).body?.rating === 5);

    check("уведомления у исполнителя есть", ((await req("GET", "/api/notifications", null, td)).body?.items?.length || 0) > 0);

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
