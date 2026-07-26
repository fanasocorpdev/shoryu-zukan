// 業界ごとのSEO用静的ページ(share/<id>.html)+ ハブ(share/index.html)+ robots.txt + sitemap.xml を生成。
// クローラーはJSを実行せずhashルートも読めないため、検索エンジンにはこの静的ページが
// 「実テキストの中身(業界名・歩き方・企業一覧)」を提供し、人間は地図(SPA)へ誘導する。
// 使い方: node scripts/gen-share.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://akinaimap.com";
const esc = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const index = JSON.parse(readFileSync(join(root, "data", "industries", "index.json"), "utf8"));
mkdirSync(join(root, "share"), { recursive: true });

// 共通のページ枠(読みやすい最小CSS + 共通ヘッダー/フッター)
function page({ title, desc, ogImage, canonical, bodyHTML, jsonld }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
${ogImage ? `<meta property="og:image" content="${ogImage}">` : ""}
<meta property="og:site_name" content="あきないマップ">
<meta name="twitter:card" content="summary_large_image">
${ogImage ? `<meta name="twitter:image" content="${ogImage}">` : ""}
<link rel="icon" href="${BASE}/assets/emblem.svg" type="image/svg+xml">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ""}
<style>
:root{--ink:#1f2a33;--soft:#64748b;--gold:#0f766e;--edge:#dbe2e8}
*{box-sizing:border-box}body{font-family:"Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo",sans-serif;color:var(--ink);max-width:760px;margin:0 auto;padding:24px 18px 60px;line-height:1.8}
a{color:var(--gold)}header a{text-decoration:none}
h1{font-size:1.7rem;margin:.2em 0}.tag{color:var(--soft)}
.cta{display:inline-block;margin:16px 0;padding:11px 22px;background:var(--gold);color:#fff;border-radius:6px;text-decoration:none;font-weight:700}
.guide{border:1.5px solid var(--edge);border-radius:8px;padding:14px 16px;margin:16px 0;background:#f8fafb}
.guide b{color:var(--gold);display:block;font-size:.8rem}
.node{border-top:1px solid var(--edge);padding:10px 0}.node h3{font-size:1rem;margin:.2em 0}
.co{color:var(--soft);font-size:.9rem}
nav.foot{margin-top:32px;border-top:1px solid var(--edge);padding-top:14px;font-size:.85rem}
nav.foot a{display:inline-block;margin:2px 8px 2px 0}
</style>
</head>
<body>
<header><a href="${BASE}/"><strong>あきないマップ</strong></a></header>
${bodyHTML}
</body>
</html>
`;
}

const industriesMeta = [];
let count = 0;
for (const id of index.industries) {
  const data = JSON.parse(readFileSync(join(root, "data", "industries", `${id}.json`), "utf8"));
  const name = data.meta.industry_name;
  const tagline = data.meta.tagline ?? data.meta.description?.slice(0, 80) ?? "";
  const g = data.meta.guide;
  const nodes = (data.nodes ?? []).filter((n) => !n.unsorted && (n.role || (n.companies?.length)));
  const companies = nodes.reduce((a, n) => a + (n.companies?.length ?? 0), 0);
  industriesMeta.push({ id, name });

  const title = `${name}の商流マップ｜企業一覧・業界研究 — あきないマップ`;
  const desc = `${tagline} ${companies}社を収容。${name}のモノ・カネの流れ(商流)と主要企業・平均年収を地図で。就活・転職の業界研究に。閲覧無料。`;

  // クロール可能な本文: 見出し・歩き方・ノード(役割)ごとの企業名一覧
  const guideHTML = g ? `<div class="guide">
    ${g.earn ? `<p><b>稼ぎ方</b>${esc(g.earn)}</p>` : ""}
    ${g.watch ? `<p><b>見どころ</b>${esc(g.watch)}</p>` : ""}
    ${g.talk ? `<p><b>面接でこう使う</b>${esc(g.talk)}</p>` : ""}</div>` : "";
  const nodesHTML = nodes.map((n) => {
    const cos = (n.companies ?? []).map((c) => esc(c.name)).filter(Boolean);
    return `<div class="node"><h3>${esc(n.role ?? "")}</h3>
      ${n.description ? `<p class="tag">${esc(n.description)}</p>` : ""}
      ${cos.length ? `<p class="co">${cos.join(" ・ ")}</p>` : ""}</div>`;
  }).join("");

  const jsonld = {
    "@context": "https://schema.org", "@type": "CollectionPage",
    name: title, description: desc, url: `${BASE}/share/${id}.html`,
    isPartOf: { "@type": "WebSite", name: "あきないマップ", url: BASE },
  };
  const body = `
    <h1>${esc(name)}の商流マップ</h1>
    <p class="tag">${esc(tagline)}</p>
    <a class="cta" href="${BASE}/#/i/${id}">インタラクティブな商流マップを開く →</a>
    ${guideHTML}
    <h2>登場する役割と主要企業(${companies}社)</h2>
    ${nodesHTML}
    <a class="cta" href="${BASE}/#/i/${id}">${esc(name)}の商流を地図で見る →</a>
    <nav class="foot"><strong>他の業界:</strong><br>
      ${index.industries.map((x) => `<a href="${BASE}/share/${x}.html">${esc(JSON.parse(readFileSync(join(root, "data", "industries", `${x}.json`), "utf8")).meta.industry_name)}</a>`).join("")}
    </nav>`;
  writeFileSync(join(root, "share", `${id}.html`), page({
    title, desc, ogImage: `${BASE}/assets/og/${id}.png`, canonical: `${BASE}/share/${id}.html`, bodyHTML: body, jsonld,
  }));
  count++;
}

// ハブページ(全業界の入口 = クロールの起点)
const hubBody = `
  <h1>業界別の商流マップ一覧</h1>
  <p class="tag">日本の各業界の「モノ・カネの流れ(商流)」と主要企業・平均年収を、地図で見える化。就活・転職の業界研究に。</p>
  <a class="cta" href="${BASE}/">あきないマップ トップへ →</a>
  <nav class="foot"><strong>業界一覧:</strong><br>
    ${industriesMeta.map((m) => `<a href="${BASE}/share/${m.id}.html">${esc(m.name)}の商流</a>`).join("")}
  </nav>`;
writeFileSync(join(root, "share", "index.html"), page({
  title: "業界別 商流マップ一覧｜あきないマップ", desc: "日本の各業界の商流(モノ・カネの流れ)と主要企業を地図で。就活・転職の業界研究に。",
  ogImage: `${BASE}/assets/emblem.svg`, canonical: `${BASE}/share/`, bodyHTML: hubBody,
}));

// robots.txt
writeFileSync(join(root, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${BASE}/sitemap.xml\n`);

// sitemap.xml
const urls = [`${BASE}/`, `${BASE}/share/`, ...index.industries.map((id) => `${BASE}/share/${id}.html`)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}
</urlset>
`;
writeFileSync(join(root, "sitemap.xml"), sitemap);

console.log(`✓ SEOページ ${count}件 + ハブ + robots.txt + sitemap.xml(${urls.length} URL)を生成`);
