// デプロイ時にキャッシュバスター(?v=タイムスタンプ)を更新する。
// GitHub Pagesのmax-age=600でJS/CSSが古いまま残るのを防ぐ。
// 使い方: node scripts/bump-version.mjs (public反映前にmainで実行)
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const d = new Date();
const stamp = [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]
  .map((x) => String(x).padStart(2, "0")).join("");

const ih = join(root, "index.html");
let html = readFileSync(ih, "utf8");
html = html.replace(/href="css\/style\.css(\?v=\d+)?"/, `href="css/style.css?v=${stamp}"`);
html = html.replace(/src="js\/main\.js(\?v=\d+)?"/, `src="js/main.js?v=${stamp}"`);
writeFileSync(ih, html);

const mj = join(root, "js", "main.js");
let main = readFileSync(mj, "utf8");
main = main.replace(/\.\/mapview\.js(\?v=\d+)?/, `./mapview.js?v=${stamp}`);
writeFileSync(mj, main);
console.log(`✓ キャッシュバスター更新: v=${stamp}`);
