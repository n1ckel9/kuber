// Генерация ассетов приложения (иконка, adaptive, splash, favicon) из SVG.
// Разовый скрипт: node scripts/gen-assets.mjs (нужен sharp, ставится --no-save).
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const DARK = "#1A1A1A";
const GOLD = "#E7B54B";
const WHITE = "#F7F4EE";
const GREY = "#C9C3B8";

// Изометрический куб «Кубер». scale — доля от 1024 (для safe-zone adaptive).
function cube(scale = 1) {
  const cx = 512;
  const cy = 512;
  const w = 230 * scale; // половина ширины
  const h = 130 * scale; // половина высоты верхней грани
  const s = 260 * scale; // высота боковой грани
  const top = `${cx},${cy - h - s / 2} ${cx + w},${cy - s / 2} ${cx},${cy + h - s / 2} ${cx - w},${cy - s / 2}`;
  const left = `${cx - w},${cy - s / 2} ${cx},${cy + h - s / 2} ${cx},${cy + h + s / 2} ${cx - w},${cy + s / 2}`;
  const right = `${cx + w},${cy - s / 2} ${cx},${cy + h - s / 2} ${cx},${cy + h + s / 2} ${cx + w},${cy + s / 2}`;
  return `
    <polygon points="${left}" fill="${WHITE}"/>
    <polygon points="${right}" fill="${GREY}"/>
    <polygon points="${top}" fill="${GOLD}"/>`;
}

function svg({ bg = "none", scale = 1, rounded = false } = {}) {
  const bgRect = bg === "none" ? "" : rounded
    ? `<rect width="1024" height="1024" rx="224" fill="${bg}"/>`
    : `<rect width="1024" height="1024" fill="${bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${bgRect}${cube(scale)}</svg>`;
}

async function png(svgStr, out, size = 1024) {
  await sharp(Buffer.from(svgStr)).resize(size, size).png().toFile(out);
  console.log("→", out);
}

await mkdir("assets", { recursive: true });
await png(svg({ bg: DARK }), "assets/icon.png"); // iOS/основная (система сама скруглит)
await png(svg({ bg: "none", scale: 0.72 }), "assets/adaptive-icon.png"); // Android foreground, safe-zone
await png(svg({ bg: "none", scale: 0.9 }), "assets/splash-icon.png"); // сплэш на тёмном фоне
await png(svg({ bg: DARK, rounded: true }), "assets/favicon.png", 96); // web
console.log("done");
