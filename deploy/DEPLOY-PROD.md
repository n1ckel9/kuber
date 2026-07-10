# Прод-деплой Кубер на VPS в России

Стек: Node 20 + Express + better-sqlite3 (файл БД на диске) + Caddy (HTTPS). Один сервер, без Docker — так проще всего для старта.

**Что понадобится:** VPS Ubuntu 22.04 (2 ГБ RAM) в Timeweb/Selectel/Yandex Cloud, домен, ~30 минут.

---

## 1. VPS и домен
1. Создай VPS **Ubuntu 22.04, 2 ГБ RAM** (Timeweb Cloud / Selectel — ~300–600 ₽/мес).
2. Купи домен (или поддомен) и добавь **A-запись** `api.твойдомен.ру → IP VPS`.
3. Зайди по SSH: `ssh root@IP`.

## 2. Базовая настройка
```bash
# Пользователь для приложения (без root)
adduser --system --group --home /opt/kuber kuber

# Node 20 LTS (prebuilt-бинарь better-sqlite3, без компиляции)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git
# на случай сборки native-модулей:
apt-get install -y build-essential python3

# Caddy (авто-HTTPS)
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
```

## 3. Код и конфиг
```bash
git clone <URL-твоего-репозитория> /opt/kuber
mkdir -p /opt/kuber/data /opt/kuber/backups
cp /opt/kuber/deploy/env.production.example /opt/kuber/server/.env
nano /opt/kuber/server/.env       # заполни ADMIN_EMAILS, SMSRU_API_ID и т.д.
cd /opt/kuber/server && npm install --omit=dev
chown -R kuber:kuber /opt/kuber
```

## 4. Автозапуск (systemd)
```bash
cp /opt/kuber/deploy/kuber.service /etc/systemd/system/kuber.service
systemctl daemon-reload
systemctl enable --now kuber
systemctl status kuber          # active (running)
curl http://localhost:4000/api/health   # {"ok":true}
```
Разреши пользователю kuber перезапускать сервис без пароля (для deploy.sh):
```bash
echo 'kuber ALL=(ALL) NOPASSWD: /bin/systemctl restart kuber' > /etc/sudoers.d/kuber
```

## 5. HTTPS (Caddy)
```bash
cp /opt/kuber/deploy/Caddyfile /etc/caddy/Caddyfile
nano /etc/caddy/Caddyfile        # впиши свой домен вместо api.example.ru
systemctl reload caddy
```
Проверка: `https://api.твойдомен.ру/api/health` → `{"ok":true}`. Сертификат Caddy получит сам.

## 6. Переключить приложение на прод-сервер
В репозитории (локально):
- `.env` → `EXPO_PUBLIC_API_URL=https://api.твойдомен.ру`
- `eas.json` (профиль `preview` и `production`) → тот же URL.
- Пересобрать APK/AAB: `npx eas-cli build --platform android --profile production`.

## 7. Обновление в будущем
```bash
bash /opt/kuber/deploy/deploy.sh     # бэкап БД → git pull → npm install → рестарт
```

## 8. Бэкапы БД
deploy.sh делает бэкап при каждом обновлении. Добавь ещё ежедневный cron:
```bash
crontab -e -u kuber
# каждый день в 4:00:
0 4 * * * cp /opt/kuber/data/kuber.db /opt/kuber/backups/kuber-daily-$(date +\%u).db
```
(хранит по дню недели, 7 копий; выгружай их периодически к себе).

## Диагностика
- Логи приложения: `journalctl -u kuber -n 100 -f`
- Логи Caddy: `journalctl -u caddy -n 100`
- Порт занят/сервис лежит: `systemctl restart kuber`

## Когда вырастете
- Фото сейчас в БД (base64). При росте — вынести в объектное хранилище (Yandex Object Storage / Selectel S3), в БД хранить ссылки.
- SQLite тянет тысячи пользователей на одном сервере. Дальше — миграция на PostgreSQL (без спешки).
