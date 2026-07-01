// Сброс локальной базы: удаляет файлы SQLite, чтобы при следующем запуске
// сервер пересоздал схему и залил сид заново. Запуск: npm run db:reset
const fs = require("node:fs");
const path = require("node:path");

const base = process.env.DB_FILE || path.join(__dirname, "vodovoz.db");
const targets = [base, `${base}-wal`, `${base}-shm`];

let removed = 0;
for (const file of targets) {
  if (fs.existsSync(file)) {
    fs.rmSync(file);
    removed += 1;
  }
}

console.log(removed ? `База сброшена (${removed} файлов удалено).` : "База не найдена — нечего сбрасывать.");
