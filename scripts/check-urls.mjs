// データ内の全URL(企業サイト・出典)の死活チェック。リンク切れ=信頼性の毀損なので定期実行する。
// 使い方: node scripts/check-urls.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "data", "industries");

// URL収集(重複排除、出現場所つき)
const urls = new Map(); // url -> [場所]
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json")) {
  const data = JSON.parse(readFileSync(join(dir, file), "utf8"));
  const add = (url, where) => {
    if (!url) return;
    if (!urls.has(url)) urls.set(url, []);
    urls.get(url).push(where);
  };
  for (const n of data.nodes ?? []) {
    for (const c of n.companies ?? []) add(c.url, `${file}:${n.id}:${c.name}`);
    for (const s of n.sources ?? []) add(s.url, `${file}:${n.id}:source`);
  }
  for (const e of data.edges ?? []) for (const s of e.sources ?? []) add(s.url, `${file}:${e.id}:source`);
}

console.log(`${urls.size}件のユニークURLを検査中...`);

const UA = "Mozilla/5.0 (compatible; ShoryuZukanLinkCheck/0.1)";
async function check(url) {
  for (const method of ["HEAD", "GET"]) {
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        headers: { "User-Agent": UA, "Accept-Language": "ja" },
        signal: AbortSignal.timeout(10000),
      });
      // HEAD拒否(405等)はGETで再試行
      if (res.status === 405 || res.status === 403 || res.status === 404) {
        if (method === "HEAD") continue;
      }
      return res.status;
    } catch (e) {
      if (method === "GET") return `ERR:${e.name}`;
    }
  }
  return "ERR";
}

const entries = [...urls.entries()];
const results = [];
const CONCURRENCY = 12;
let idx = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (idx < entries.length) {
      const [url, places] = entries[idx++];
      const status = await check(url);
      results.push({ url, status, places });
      if (!(typeof status === "number" && status < 400)) {
        console.log(`✗ ${status} ${url}  (${places[0]}${places.length > 1 ? ` ほか${places.length - 1}箇所` : ""})`);
      }
    }
  })
);

const ok = results.filter((r) => typeof r.status === "number" && r.status < 400).length;
const bad = results.length - ok;
console.log(`\n結果: OK ${ok} / NG ${bad} / 計 ${results.length}`);
process.exit(bad ? 1 : 0);
