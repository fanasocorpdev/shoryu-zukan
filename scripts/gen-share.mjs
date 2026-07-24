// 業界ごとのシェア用静的ページ(OGPメタ付き)を share/<id>.html に生成する。
// SNSクローラーはJSを実行せずhashルートも読めないため、OGPはこの静的ページが担い、
// 人間のアクセスはJSで #/i/<id> へリダイレクトする。
// 使い方: node scripts/gen-share.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://fanasocorpdev.github.io/shoryu-zukan";

const esc = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

const index = JSON.parse(readFileSync(join(root, "data", "industries", "index.json"), "utf8"));
mkdirSync(join(root, "share"), { recursive: true });

let count = 0;
for (const id of index.industries) {
  const data = JSON.parse(readFileSync(join(root, "data", "industries", `${id}.json`), "utf8"));
  const name = data.meta.industry_name;
  const tagline = data.meta.tagline ?? data.meta.description?.slice(0, 80) ?? "";
  const companies = data.nodes.reduce((a, n) => a + (n.companies?.length ?? 0), 0);
  const title = `${name}の商流地図 — 商流図鑑`;
  const desc = `${tagline} ${companies}社を収容。誰が誰に何を届けて、いくら払うのかを地図でズーム。永久無料。`;
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${BASE}/share/${id}.html">
<meta property="og:image" content="${BASE}/assets/og/${id}.png">
<meta property="og:site_name" content="商流図鑑">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${BASE}/assets/og/${id}.png">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧭</text></svg>">
</head>
<body>
<p><a href="../#/i/${id}">${esc(name)}の商流地図を開く →</a></p>
<script>location.replace("../#/i/${id}");</script>
</body>
</html>
`;
  writeFileSync(join(root, "share", `${id}.html`), html);
  count++;
}
console.log(`✓ share/*.html を${count}件生成`);
