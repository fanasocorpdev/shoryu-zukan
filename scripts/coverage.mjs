// 上場企業カバレッジ計測: JPX銘柄一覧と各業界マップの掲載企業を突合する。
// マッチングは証券コード(company.listing.code)優先、銘柄名の正規化一致をフォールバック。
// 使い方: node scripts/coverage.mjs [--json]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "data", "industries");
const jpx = JSON.parse(readFileSync(join(root, "data", "reference", "jpx_listed.json"), "utf8"));

const norm = (s) =>
  String(s)
    .replace(/[\s・‐\-]/g, "")
    .replace(/ホールディングス|グループ本社|グループ/g, "HD")
    .replace(/[((].*?[))]/g, "")
    .toUpperCase();

// マップ側の掲載企業を収集
const covered = new Map(); // code -> {name, industries[]}
const byName = new Map(); // normalized name -> code候補照合用
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json")) {
  const data = JSON.parse(readFileSync(join(dir, file), "utf8"));
  const iid = data.meta?.industry_id ?? file;
  for (const node of data.nodes ?? []) {
    for (const c of node.companies ?? []) {
      if (c.listing?.code) {
        const cur = covered.get(c.listing.code) ?? { name: c.name, industries: new Set() };
        cur.industries.add(iid);
        covered.set(c.listing.code, cur);
      }
      byName.set(norm(c.name), iid);
    }
  }
}

// 突合
let hitCode = 0, hitName = 0;
const uncoveredBySector = {};
const coveredList = [];
for (const co of jpx.companies) {
  if (covered.has(co.code)) {
    hitCode++;
    coveredList.push({ ...co, via: "code", industries: [...covered.get(co.code).industries] });
  } else if (byName.has(norm(co.name))) {
    hitName++;
    coveredList.push({ ...co, via: "name", industries: [byName.get(norm(co.name))] });
  } else {
    (uncoveredBySector[co.sector33] ??= []).push(co);
  }
}

const total = jpx.companies.length;
const hit = hitCode + hitName;
console.log(`基準日 ${jpx.as_of} / 国内上場 ${total}社`);
console.log(`カバー済み: ${hit}社 (${((hit / total) * 100).toFixed(1)}%)  [コード一致 ${hitCode} / 名前一致 ${hitName}]`);
console.log(`未カバー: ${total - hit}社\n`);

// 規模区分別カバー率(TOPIX Core30 / Large70 / Mid400 = TOPIX500)
const coveredCodes = new Set(coveredList.map((c) => c.code));
const scaleStats = {};
for (const co of jpx.companies) {
  const s = co.scale || "-";
  scaleStats[s] ??= { total: 0, hit: 0 };
  scaleStats[s].total++;
  if (coveredCodes.has(co.code)) scaleStats[s].hit++;
}
const SCALE_ORDER = ["TOPIX Core30", "TOPIX Large70", "TOPIX Mid400", "TOPIX Small 1", "TOPIX Small 2", "-"];
console.log("規模区分別カバー率:");
let t500 = { total: 0, hit: 0 };
for (const s of SCALE_ORDER) {
  const v = scaleStats[s];
  if (!v) continue;
  console.log(`  ${s}: ${v.hit}/${v.total} (${((v.hit / v.total) * 100).toFixed(1)}%)`);
  if (["TOPIX Core30", "TOPIX Large70", "TOPIX Mid400"].includes(s)) {
    t500.total += v.total; t500.hit += v.hit;
  }
}
if (t500.total) console.log(`  ▶ TOPIX500(大型・中型株): ${t500.hit}/${t500.total} (${((t500.hit / t500.total) * 100).toFixed(1)}%)\n`);
console.log("未カバーの多い33業種(=次に作るべき親マップの優先度):");
const ranked = Object.entries(uncoveredBySector).sort((a, b) => b[1].length - a[1].length);
for (const [sector, list] of ranked.slice(0, 12)) {
  console.log(`  ${sector}: ${list.length}社 (例: ${list.slice(0, 3).map((c) => c.name).join(", ")})`);
}

// トップページ表示用の軽量サマリは常に出力
writeFileSync(
  join(root, "data", "reference", "coverage-summary.json"),
  JSON.stringify(
    {
      as_of: jpx.as_of,
      total,
      covered: hit,
      percent: Number(((hit / total) * 100).toFixed(1)),
      topix500: t500.total ? { total: t500.total, covered: t500.hit, percent: Number(((t500.hit / t500.total) * 100).toFixed(1)) } : null,
      top_gaps: ranked.slice(0, 5).map(([s, l]) => ({ sector: s, count: l.length })),
    },
    null,
    2
  ) + "\n"
);

if (process.argv.includes("--json")) {
  const out = join(root, "data", "reference", "coverage.json");
  writeFileSync(
    out,
    JSON.stringify(
      {
        as_of: jpx.as_of,
        total,
        covered: hit,
        covered_list: coveredList,
        uncovered_by_sector: Object.fromEntries(ranked.map(([s, l]) => [s, l.map((c) => ({ code: c.code, name: c.name }))])),
      },
      null,
      2
    ) + "\n"
  );
  console.log(`\n✓ 詳細を ${out} に出力`);
}
