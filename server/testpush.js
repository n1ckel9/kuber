// Отправка тестового push через Expo Push API.
// Запуск: node server/testpush.js "ExponentPushToken[xxxxxxxx]"
// Токен взять с телефона: он логируется/сохраняется при входе (registerPushToken).
const token = process.argv[2];

if (!token || !token.startsWith("ExponentPushToken")) {
  console.error('Укажи токен: node server/testpush.js "ExponentPushToken[...]"');
  process.exit(1);
}

fetch("https://exp.host/--/api/v2/push/send", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ to: token, sound: "default", title: "Кубер", body: "Тестовое уведомление ✓" })
})
  .then((r) => r.json())
  .then((res) => {
    console.log("Ответ Expo:", JSON.stringify(res, null, 2));
    const status = res?.data?.status;
    if (status === "ok") console.log("\n✓ Принято Expo. Должно прийти на телефон в течение нескольких секунд.");
    else console.log("\n✗ Не ok. Частая причина на Android: не настроены FCM-креды (см. инструкцию).");
  })
  .catch((e) => console.error("Ошибка запроса:", e.message));
