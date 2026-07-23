// 大型ノードにセグメント(サブくくり)を定義し、企業を割り当てる。
// 使い方: node scripts/apply-segments.mjs <spec.mjs>
// spec形式(default export):
// {
//   industry, node,
//   segments: [{ id, label, description? }, ...],   // 末尾に必ず default 用のセグメントを含める
//   rules: [{ seg: "segId", pattern: "正規表現" }],  // 社名+note に対して上から順にマッチ
//   names: { "segId": ["社名の部分一致", ...] },      // ルールより優先の個別指定
//   default: "segId",
// }
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const spec = (await import(pathToFileURL(resolve(process.argv[2])).href)).default;

const path = join(root, "data", "industries", `${spec.industry}.json`);
const data = JSON.parse(readFileSync(path, "utf8"));
const node = data.nodes.find((n) => n.id === spec.node);
if (!node) { console.error(`✗ node ${spec.node} なし`); process.exit(1); }

node.segments = spec.segments;
const rules = (spec.rules ?? []).map((r) => ({ seg: r.seg, re: new RegExp(r.pattern) }));
const nameMap = [];
for (const [seg, parts] of Object.entries(spec.names ?? {}))
  for (const p of parts) nameMap.push({ seg, p });

const dist = {};
for (const c of node.companies) {
  const hay = `${c.name} ${c.note ?? ""}`;
  let seg = nameMap.find((m) => c.name.includes(m.p))?.seg;
  if (!seg) seg = rules.find((r) => r.re.test(hay))?.seg;
  if (!seg) seg = spec.default;
  c.segment = seg;
  dist[seg] = (dist[seg] ?? 0) + 1;
}
node.updated = new Date().toISOString().slice(0, 10);
writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
console.log(`✓ ${spec.industry}/${spec.node}: ${node.companies.length}社を${spec.segments.length}セグメントに割当`);
for (const s of spec.segments) console.log(`  ${s.label}: ${dist[s.id] ?? 0}社`);
