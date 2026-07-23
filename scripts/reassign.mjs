// 分類精査中(unsorted)の企業を、精査結果に基づき適切なノードへ移動する。
// 使い方: node scripts/reassign.mjs <spec.mjs>
// spec形式(default export): [
//   { code: "1234", industry: "services", node: "hr", note?: "人材派遣" },
//   { code: "5678", industry: "food", node: "food_service", toIndustry?: "retail" }  // toIndustryで別マップへ移動も可
// ]
// 移動元はどのマップのunsortedノードでもよい(codeで検索)。noteは精査で判明した事業内容に置き換える。
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(root, "data", "industries");
const TODAY = new Date().toISOString().slice(0, 10);

const spec = (await import(pathToFileURL(resolve(process.argv[2])).href)).default;

const files = readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "index.json");
const dataById = {};
for (const f of files) {
  const d = JSON.parse(readFileSync(join(DIR, f), "utf8"));
  dataById[d.meta.industry_id] = { file: f, data: d, dirty: false };
}

let moved = 0, notFound = 0;
for (const m of spec) {
  // codeをどこかのunsortedノードから探す
  let src = null, srcNode = null, idx = -1;
  for (const { data } of Object.values(dataById)) {
    for (const n of data.nodes) {
      if (!n.unsorted) continue;
      const i = (n.companies ?? []).findIndex((c) => c.listing?.code === m.code);
      if (i >= 0) { src = data; srcNode = n; idx = i; break; }
    }
    if (src) break;
  }
  if (!src) { console.log(`⚠ 見つからない: ${m.code}`); notFound++; continue; }

  const targetIndustry = m.toIndustry ?? m.industry ?? src.meta.industry_id;
  const target = dataById[targetIndustry];
  if (!target) { console.log(`✗ 業界なし: ${targetIndustry}`); notFound++; continue; }
  const targetNode = target.data.nodes.find((n) => n.id === m.node);
  if (!targetNode) { console.log(`✗ ノードなし: ${targetIndustry}/${m.node} (${m.code})`); notFound++; continue; }

  const [company] = srcNode.companies.splice(idx, 1);
  if (m.note) company.note = m.note;
  else delete company.note; // 旧「JPX業種:」noteは分類確定で不要に
  targetNode.companies.push(company);
  targetNode.updated = TODAY;
  srcNode.updated = TODAY;
  dataById[src.meta.industry_id].dirty = true;
  dataById[targetIndustry].dirty = true;
  moved++;
}

for (const { file, data, dirty } of Object.values(dataById)) {
  if (dirty) writeFileSync(join(DIR, file), JSON.stringify(data, null, 2) + "\n");
}
console.log(`✓ ${moved}社を再配置(未発見 ${notFound})`);
