// JPX「時価総額順位表」(月末・一次情報)から公式時価総額を取り込む。
// https://www.jpx.co.jp/markets/statistics-equities/misc/08.html の最新PDFを自動検出し、
// IR確定値(日付付き時価総額)を持たない企業にのみ適用する。
// 使い方: node scripts/fetch-mcap.mjs [--dry]
// 注: 順位表は市場別の上位銘柄のみ。全銘柄カバーはJ-Quants API(要無料登録)対応時に拡張する。
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dry = process.argv.includes("--dry");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0";

const page = await (await fetch("https://www.jpx.co.jp/markets/statistics-equities/misc/08.html", { headers: { "User-Agent": UA } })).text();
const links = [...page.matchAll(/href="([^"]*-att\/(\d{6})_r\.pdf)"/g)].map((m) => ({ path: m[1], ym: m[2] }));
if (!links.length) { console.error("✗ 順位表PDFのリンクが見つからない(ページ構造変更?)"); process.exit(1); }
const latest = links.sort((a, b) => b.ym.localeCompare(a.ym))[0];
const asOfYm = `${latest.ym.slice(0, 4)}-${latest.ym.slice(4)}`;
console.log(`最新: ${latest.ym} (${latest.path})`);

const buf = Buffer.from(await (await fetch(`https://www.jpx.co.jp${latest.path}`, { headers: { "User-Agent": UA } })).arrayBuffer());
const { text } = await pdfParse(buf);

// PDF記載の基準日(例: 2026年6月30日現在)を採用。取れなければ月末表記にフォールバック
const dm = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日現在/);
const asOfDate = dm ? `${dm[1]}-${String(dm[2]).padStart(2, "0")}-${String(dm[3]).padStart(2, "0")}` : null;

// JPX上場銘柄のコード集合(順位+コード連結の曖昧さ解消に使う)
const jpx = JSON.parse(readFileSync(join(root, "data", "reference", "jpx_listed.json"), "utf8"));
const codeSet = new Set(jpx.companies.map((c) => c.code));

// 行形式: "<順位><コード>   <和名><英名><時価総額(カンマ区切り・億円)>"
const found = new Map();
for (const line of text.split("\n")) {
  const m = line.trim().match(/^(\d{1,3}[0-9A-Z]{3,4})\s+\S.*?([\d,]{3,})$/);
  if (!m) continue;
  const head = m[1];
  const mcap = Number(m[2].replaceAll(",", ""));
  if (!(mcap > 0)) continue;
  // 末尾4文字をコード候補とし、JPX銘柄一覧に存在するものを採用
  const cand = head.slice(-4);
  if (codeSet.has(cand) && !found.has(cand)) found.set(cand, mcap);
}
console.log(`順位表から${found.size}銘柄の時価総額を抽出(単位: 億円、${asOfYm}月末時点)`);

const dir = join(root, "data", "industries");
let applied = 0, skipped = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json")) {
  const path = join(dir, file);
  const data = JSON.parse(readFileSync(path, "utf8"));
  let changed = false;
  for (const n of data.nodes ?? []) {
    for (const c of n.companies ?? []) {
      const mcap = found.get(c.listing?.code);
      if (!mcap) continue;
      const note = c.financials?.note ?? "";
      // IR差し替え済み(日付付き時価総額)は上書きしない
      if (/時価総額=\d{4}/.test(note) || /時価総額=\$|時価総額=€/.test(note)) { skipped++; continue; }
      c.financials ??= {};
      c.financials.market_cap_oku_jpy = mcap;
      c.financials.as_of = asOfDate ?? `${asOfYm}-末`;
      const revPart = note.match(/^[^、]*実績[^、]*/)?.[0];
      c.financials.note = (revPart ? revPart + "、" : note ? note.replace(/。?$/, "。") : "") +
        `時価総額=JPX時価総額順位表(${asOfDate ?? asOfYm + "月末"}時点)`;
      applied++;
      changed = true;
    }
  }
  if (changed && !dry) writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}
console.log(`${dry ? "[dry] " : ""}適用 ${applied}箇所、IR確定値のためスキップ ${skipped}箇所`);
