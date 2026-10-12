import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const generatedDir = join(process.cwd(), "dist");
const publicDir = join(process.cwd(), ".output", "public");
const serviceWorker = join(generatedDir, "sw.js");

if (!existsSync(publicDir)) {
  throw new Error("[prepare-pwa] Missing .output/public; run vite build first.");
}
if (!existsSync(serviceWorker)) {
  throw new Error("[prepare-pwa] Missing dist/sw.js; check the Vite PWA build output.");
}

const workerSource = readFileSync(serviceWorker, "utf8");
const runtimeName = workerSource.match(/\.\/(workbox-[\w-]+)(?:\.js)?/i)?.[1];
if (!runtimeName) {
  throw new Error("[prepare-pwa] Could not find the Workbox runtime referenced by sw.js.");
}
const runtime = join(generatedDir, `${runtimeName}.js`);
if (!existsSync(runtime)) {
  throw new Error(`[prepare-pwa] Missing ${runtimeName}.js referenced by sw.js.`);
}

copyFileSync(serviceWorker, join(publicDir, "sw.js"));
copyFileSync(runtime, join(publicDir, `${runtimeName}.js`));
console.log(`[prepare-pwa] Copied sw.js and ${runtimeName}.js to .output/public.`);
