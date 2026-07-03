// Абстракция отправки SMS. Если задан SMSRU_API_ID — шлём реально через SMS.ru,
// иначе dev-режим: пишем код в лог (и сервер вернёт devCode клиенту).
const SMSRU_API_ID = process.env.SMSRU_API_ID;

async function sendSms(phone, text) {
  if (!SMSRU_API_ID) {
    console.log(`[SMS DEV] +${phone}: ${text}`);
    return { ok: true, dev: true };
  }
  try {
    const res = await fetch("https://sms.ru/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ api_id: SMSRU_API_ID, to: phone, msg: text, json: "1" }).toString()
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

const smsEnabled = Boolean(SMSRU_API_ID);

module.exports = { sendSms, smsEnabled };
