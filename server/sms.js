// Мультиканальная доставка кода подтверждения.
// Провайдеры включаются переменными окружения. Пробуем по приоритету
// (мессенджеры дешевле SMS), берём первый успешный. Если ничего не задано —
// dev-режим: код в лог + сервер вернёт его клиенту (devCode).
//
// ENV:
//   Telegram Gateway:  TELEGRAM_GATEWAY_TOKEN   (gatewayapi.telegram.org)
//   WhatsApp Cloud:    WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE (по умолч. verification_code), WHATSAPP_LANG (ru)
//   MAX (мессенджер):  MAX_BOT_TOKEN            (botapi.max.ru) — см. ограничение ниже
//   SMS.ru:            SMSRU_API_ID

const TELEGRAM_GATEWAY_TOKEN = process.env.TELEGRAM_GATEWAY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WHATSAPP_TEMPLATE = process.env.WHATSAPP_TEMPLATE || "verification_code";
const WHATSAPP_LANG = process.env.WHATSAPP_LANG || "ru";
const MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const SMSRU_API_ID = process.env.SMSRU_API_ID;

// phone у нас хранится как 11 цифр ("79991234567"). Для мессенджеров нужен E.164.
function e164(phone) {
  return phone.startsWith("+") ? phone : `+${phone}`;
}

// --- Telegram Gateway API (официальная отправка кодов в Telegram по номеру) ---
async function sendTelegram(phone, code) {
  try {
    const res = await fetch("https://gatewayapi.telegram.org/sendVerificationMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TELEGRAM_GATEWAY_TOKEN}`
      },
      body: JSON.stringify({ phone_number: e164(phone), code: String(code) })
    });
    const data = await res.json();
    if (data && data.ok) {
      return { ok: true };
    }
    console.error("Telegram Gateway error:", data && data.error);
    return { ok: false, error: (data && data.error) || "telegram_failed" };
  } catch (e) {
    console.error("Telegram Gateway request failed:", e.message);
    return { ok: false, error: e.message };
  }
}

// --- WhatsApp Cloud API (Meta). Нужен одобренный шаблон аутентификации. ---
// Шаблон WHATSAPP_TEMPLATE должен принимать код первым параметром body.
async function sendWhatsApp(phone, code) {
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WHATSAPP_TOKEN}`
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone,
        type: "template",
        template: {
          name: WHATSAPP_TEMPLATE,
          language: { code: WHATSAPP_LANG },
          components: [
            { type: "body", parameters: [{ type: "text", text: String(code) }] }
          ]
        }
      })
    });
    const data = await res.json();
    if (res.ok && data && Array.isArray(data.messages) && data.messages.length) {
      return { ok: true };
    }
    console.error("WhatsApp error:", data && data.error && data.error.message);
    return { ok: false, error: (data && data.error && data.error.message) || "whatsapp_failed" };
  } catch (e) {
    console.error("WhatsApp request failed:", e.message);
    return { ok: false, error: e.message };
  }
}

// --- MAX (мессенджер) ---
// Ограничение: MAX Bot API шлёт сообщение по chat_id, а не по номеру телефона.
// Холодная доставка кода по номеру невозможна — нужен сценарий «пользователь
// открыл нашего бота в MAX → бот через webhook получил chat_id». Пока такого
// chat_id по номеру у нас нет, поэтому канал в цепочке пропускается.
// Функция готова: когда появится resolveMaxChatId(phone), включаем канал.
async function sendMax(phone, code, chatId) {
  if (!chatId) {
    // Нет привязки номер→chat_id — доставить не можем (см. комментарий выше).
    return { ok: false, error: "max_no_chat_id", skipped: true };
  }
  try {
    const res = await fetch(`https://botapi.max.ru/messages?access_token=${MAX_BOT_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: `Кубер: код входа ${code}` })
    });
    const data = await res.json();
    if (res.ok && data && !data.error) {
      return { ok: true };
    }
    console.error("MAX error:", data && data.error);
    return { ok: false, error: (data && data.error) || "max_failed" };
  } catch (e) {
    console.error("MAX request failed:", e.message);
    return { ok: false, error: e.message };
  }
}

// --- SMS.ru (fallback) ---
async function sendSmsRu(phone, code) {
  try {
    const res = await fetch("https://sms.ru/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        api_id: SMSRU_API_ID,
        to: phone,
        msg: `Кубер: код входа ${code}`,
        json: "1"
      }).toString()
    });
    const data = await res.json();
    if (data && data.sms && data.sms[phone] && data.sms[phone].status === "OK") {
      return { ok: true };
    }
    const status = data && data.sms && data.sms[phone] ? data.sms[phone].status_text : "unknown";
    console.error("SMS.ru error:", status);
    return { ok: false, error: status };
  } catch (e) {
    console.error("SMS.ru request failed:", e.message);
    return { ok: false, error: e.message };
  }
}

// Приоритет каналов: мессенджеры (дешевле) → SMS → dev.
// label — что показать пользователю («Код отправлен в …»).
const channels = [
  { key: "telegram", label: "Telegram", enabled: Boolean(TELEGRAM_GATEWAY_TOKEN), send: sendTelegram },
  { key: "whatsapp", label: "WhatsApp", enabled: Boolean(WHATSAPP_TOKEN && WHATSAPP_PHONE_ID), send: sendWhatsApp },
  { key: "max", label: "MAX", enabled: Boolean(MAX_BOT_TOKEN), send: (p, c) => sendMax(p, c, null) },
  { key: "sms", label: "SMS", enabled: Boolean(SMSRU_API_ID), send: sendSmsRu }
];

const anyChannelEnabled = channels.some((c) => c.enabled);

// Отправить код первым доступным каналом. Возвращает { channel, dev }.
async function sendCode(phone, code) {
  for (const ch of channels) {
    if (!ch.enabled) {
      continue;
    }
    const result = await ch.send(phone, code);
    if (result.ok) {
      return { ok: true, channel: ch.key, channelLabel: ch.label, dev: false };
    }
    // Не вышло этим каналом — пробуем следующий.
  }
  // Ни один канал не сконфигурирован (или все не смогли) — dev-режим.
  console.log(`[OTP DEV] +${phone}: код ${code}`);
  return { ok: true, channel: "dev", channelLabel: "демо", dev: true };
}

module.exports = { sendCode, anyChannelEnabled };
