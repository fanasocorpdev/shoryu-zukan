// JPX「東証上場銘柄一覧」(data_j.xls)を取得し、data/reference/jpx_listed.json に変換する。
// 使い方: node scripts/fetch-jpx.mjs [ローカルxlsパス]
// 引数を省略するとJPX公式サイトからダウンロードする(月次更新)。
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(root, "data", "reference");
const OUT = join(OUT_DIR, "jpx_listed.json");
const URL = "https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xls";

// 国内株式の市場区分のみ(ETF・REIT・外国株等は除く)
// JPXの実データは全角括弧「（内国株式）」表記。括弧の全半角どちらでも通す。
const isTarget = (m) => /^(プライム|スタンダード|グロース)[(（]内国株式[)）]$/.test(m);

let buf;
const localPath = process.argv[2];
if (localPath) {
  buf = readFileSync(localPath);
  console.log(`ローカルファイルを使用: ${localPath}`);
} else {
  console.log(`ダウンロード中: ${URL}`);
  const res = await fetch(URL);
  if (!res.ok) {
    console.error(`ダウンロード失敗: ${res.status}。ローカルのdata_j.xlsを引数で渡してください。`);
    process.exit(1);
  }
  buf = Buffer.from(await res.arrayBuffer());
}

const wb = XLSX.read(buf, { type: "buffer" });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

// 優先株式・社債型種類株式は同一発行体の別証券なので個社カウントから除外
const isDuplicateSecurity = (name) => /優先株式|種類株式/.test(String(name).normalize("NFKC"));

const companies = rows
  .filter((r) => isTarget(String(r["市場・商品区分"] ?? "").trim()) && !isDuplicateSecurity(r["銘柄名"]))
  .map((r) => ({
    code: String(r["コード"]).trim(),
    name: String(r["銘柄名"]).trim(),
    market: String(r["市場・商品区分"]).replace(/[(（]内国株式[)）]/, ""),
    sector33: String(r["33業種区分"] ?? "-").trim(),
    scale: String(r["規模区分"] ?? "-").trim(),
  }));

if (!companies.length) {
  console.error("0件でした。xlsの列名が変わった可能性があります。列一覧:", Object.keys(rows[0] ?? {}));
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const asOf = String(rows[0]?.["日付"] ?? "");
writeFileSync(OUT, JSON.stringify({ as_of: asOf, source: URL, count: companies.length, companies }, null, 2) + "\n");

const bySector = {};
for (const c of companies) bySector[c.sector33] = (bySector[c.sector33] ?? 0) + 1;
console.log(`✓ ${companies.length}社を ${OUT} に出力(基準日: ${asOf})`);
console.log("33業種別の社数(上位):");
for (const [s, n] of Object.entries(bySector).sort((a, b) => b[1] - a[1]).slice(0, 10))
  console.log(`  ${s}: ${n}`);
