# Водовоз — маркетплейс спецтехники

Заказ водовозов и спецтехники по требованию. Expo (React Native) + REST API на
Express и SQLite. Архитектура «регион → город → услуги»: новые регионы, города и
услуги добавляются на сервере и сразу появляются в приложении без пересборки.

## Структура

| Путь | Назначение |
|------|-----------|
| `App.tsx` | UI: вкладки Заказы / Карта / Профиль, выбор региона → города → услуги |
| `src/api.ts` | HTTP-клиент с offline-fallback на встроенный справочник |
| `src/catalog.ts` | Запасные данные + реестр услуг для иконок/цветов |
| `src/MapView.tsx` | Карта OpenStreetMap (Leaflet): маркеры заказов + выбор точки |
| `src/mapHtml.ts` | Генерация HTML карты (общая для web и нативного WebView) |
| `server/geocode.js` | Геокодирование адреса (Nominatim/OSM) |
| `server/index.js` | Express API |
| `server/db.js` | Схема SQLite, миграции, сидинг, запросы |
| `server/seed.js` | Стартовые данные (регионы, города, услуги, заказы) |

## Запуск

```bash
npm install

# 1) оба процесса сразу (API + Expo)
npm run dev

# или по отдельности:
npm run server   # API на http://localhost:4000
npm start        # Expo (нажми w — web, или скан QR в Expo Go)
```

### Конфигурация

Скопируй `.env.example` в `.env`:

- `EXPO_PUBLIC_API_URL` — адрес API. Для теста на телефоне через Expo Go укажи
  IP компьютера в локальной сети, напр. `http://192.168.1.50:4000`
  (на эмуляторе/web достаточно `http://localhost:4000`).

Карта (OpenStreetMap) и геокодирование (Nominatim) — бесплатные, ключи не нужны.

## Как тестировать

**Быстрее всего — web:** `npm run dev`, затем `w` → приложение откроется в
браузере, перезагрузка по сохранению.

API можно дёргать напрямую:

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/catalog            # регионы → города → услуги
curl "http://localhost:4000/api/services?cityId=novosibirsk"
curl "http://localhost:4000/api/orders?cityId=yakutsk"
```

Сбросить локальную базу к исходному сиду:

```bash
npm run db:reset
```

## API

Защищённые маршруты требуют заголовок `Authorization: Bearer <token>`
(токен выдаётся при регистрации/входе).

| Метод | Путь | Авторизация | Описание |
|-------|------|:-----------:|----------|
| GET | `/api/health` | — | проверка живости |
| GET | `/api/catalog` | — | регионы с городами + услуги (старт приложения) |
| GET | `/api/cities?regionId=` | — | города (опц. фильтр по региону) |
| GET | `/api/services?cityId=` | — | услуги, доступные в городе |
| GET | `/api/orders/mine` | ✔ | заявки заказчика |
| GET | `/api/orders/bourse` | ✔ | биржа исполнителя (открытые по его услугам и городу) |
| GET | `/api/orders/jobs` | ✔ | заказы, которые исполнитель взял |
| GET | `/api/geocode?q=&cityId=` | — | адрес → координаты |
| GET | `/api/geocode/suggest?q=&cityId=` | — | подсказки адреса |
| GET | `/api/geocode/reverse?lat=&lng=` | — | координаты → адрес |
| POST | `/api/auth/register` | — | регистрация (`@gmail.com` + пароль от 6 симв.) |
| POST | `/api/auth/login` | — | вход, возвращает токен |
| GET | `/api/auth/me` | ✔ | текущий аккаунт |
| POST | `/api/auth/logout` | ✔ | завершить сессию |
| PATCH | `/api/account` | ✔ | профиль: имя/роль/город/контакт/специализации |
| POST | `/api/orders` | ✔ | создать заказ (геокод адреса, дистанция по Haversine) |
| POST | `/api/orders/:id/bids` | ✔ | оставить отклик |
| POST | `/api/orders/:id/accept` | ✔ | принять отклик (заказ → `matched`) |
| POST | `/api/orders/:id/complete` | ✔ | заказ выполнен (→ `done`) |
| POST | `/api/orders/:id/review` | ✔ | отзыв + рейтинг исполнителю |
| DELETE | `/api/orders/:id` | ✔ | удалить заявку (владелец) |

Пароли хешируются (`scrypt`), сессии хранятся в таблице `sessions`. Токен на
клиенте сохраняется в AsyncStorage (на web — `localStorage`), вход переживает
перезагрузку.

## Как расширять

- **Новый город/регион/услуга** — добавить в `server/seed.js` и `npm run db:reset`
  (или сделать INSERT в БД). Доступность услуг по городам задаётся в
  `cityServices`. Клиент подхватит изменения сам.
- **БД** — сейчас SQLite (`server/vodovoz.db`). Запросы изолированы в
  `server/db.js`, миграция на PostgreSQL не затронет маршруты.
