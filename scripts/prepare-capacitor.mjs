import { copyFileSync, existsSync, mkdirSync, cpSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * TanStack Start (Nitro) кладёт статику в .output/public.
 * Capacitor ждёт webDir — копируем туда чистый клиентский билд.
 */
const publicDir = join(process.cwd(), ".output", "public");
const webDir = join(process.cwd(), "dist", "client");

function fail(msg) {
  console.error(`[prepare-capacitor] ${msg}`);
  process.exit(1);
}

if (!existsSync(publicDir)) {
  fail("Нет .output/public. Сначала выполни: npm run build");
}

const indexInPublic = join(publicDir, "index.html");
const shellInPublic = join(publicDir, "_shell.html");

if (!existsSync(indexInPublic) && existsSync(shellInPublic)) {
  copyFileSync(shellInPublic, indexInPublic);
  console.log("[prepare-capacitor] _shell.html → index.html");
}

if (!existsSync(indexInPublic)) {
  const htmls = readdirSync(publicDir).filter((f) => f.endsWith(".html"));
  fail(`Не найден index.html в .output/public. HTML-файлы: ${htmls.join(", ") || "(нет)"}`);
}

rmSync(webDir, { recursive: true, force: true });
mkdirSync(webDir, { recursive: true });

// Копируем только клиентские файлы (без server/, если вдруг лежит рядом)
for (const name of readdirSync(publicDir)) {
  if (name === "server") continue;
  cpSync(join(publicDir, name), join(webDir, name), { recursive: true });
}

if (!existsSync(join(webDir, "index.html"))) {
  fail("После копирования нет dist/client/index.html");
}

console.log("[prepare-capacitor] OK → dist/client");
console.log("[prepare-capacitor] Готово к: npx cap add android && npx cap sync");
