#!/usr/bin/env bash
# Обновление прод-сервера Кубер одной командой. Запуск на VPS: bash /opt/kuber/deploy/deploy.sh
set -euo pipefail

APP_DIR=/opt/kuber

echo "→ Бэкап БД перед обновлением..."
if [ -f "$APP_DIR/data/kuber.db" ]; then
  mkdir -p "$APP_DIR/backups"
  cp "$APP_DIR/data/kuber.db" "$APP_DIR/backups/kuber-$(date +%Y%m%d-%H%M%S).db"
  # Держим последние 14 бэкапов.
  ls -1t "$APP_DIR/backups"/kuber-*.db | tail -n +15 | xargs -r rm --
fi

echo "→ Обновляю код..."
cd "$APP_DIR"
git pull --ff-only

echo "→ Ставлю зависимости сервера..."
cd "$APP_DIR/server"
npm install --omit=dev

echo "→ Перезапуск сервиса..."
sudo systemctl restart kuber

sleep 2
echo "→ Статус:"
systemctl --no-pager --lines=0 status kuber | head -n 5 || true
curl -fsS http://localhost:4000/api/health && echo "  ← health OK" || echo "  ← health НЕ отвечает, смотри: journalctl -u kuber -n 50"
