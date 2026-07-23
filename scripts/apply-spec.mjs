// 業界マップの生成・拡張ツール。企業名はJPX銘柄一覧と突合し、
// 一致した企業のみ listing(市場・証券コード)付きで追加する(手打ちミス防止)。
// 使い方: node scripts/apply-spec.mjs <spec.mjs>
//
// spec形式(default export):
// {
//   industry: "banking",              // 既存拡張の場合
//   create: { meta, layers },         // 新規作成の場合(industryはmeta.industry_idから)
//   appendCompanies: [{ node: "node_id", names: [...] }],
//   addNodes: [{ ...nodeフィールド, companies: [names...] }],
//   addEdges: [ ...edgeオブジェクト ],
// }
// names の要素: "社名" または { name, hq?, note?, nonListed?: true, listingNote?: "非上場(○○傘下)" }
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(root, "data", "industries");
const TODAY = "2026-07-23";

const jpx = JSON.parse(readFileSync(join(root, "data", "reference", "jpx_listed.json"), "utf8"));
const norm = (s) => String(s).normalize("NFKC").replace(/[\s・]/g, "").toUpperCase();
const jpxByName = new Map();
for (const c of jpx.companies) jpxByName.set(norm(c.name), c);

const specPath = resolve(process.argv[2]);
const spec = (await import(pathToFileURL(specPath).href)).default;

const industryId = spec.industry ?? spec.create?.meta?.industry_id;
const filePath = join(DIR, `${industryId}.json`);

let data;
if (spec.create) {
  if (existsSync(filePath)) {
    console.error(`✗ ${industryId}.json は既に存在します(拡張は industry: を使う)`);
    process.exit(1);
  }
  data = { $schema: "../schema.json", meta: spec.create.meta, layers: spec.create.layers, nodes: [], edges: [] };
} else {
  data = JSON.parse(readFileSync(filePath, "utf8"));
}

const unmatched = [];
let added = 0, skippedDup = 0;

function resolveCompany(entry) {
  const e = typeof entry === "string" ? { name: entry } : entry;
  if (e.nonListed) {
    const c = { name: e.name };
    if (e.hq) c.hq = e.hq;
    c.listing = { market: e.listingNote ?? "非上場" };
    if (e.note) c.note = e.note;
    return c;
  }
  const hit = jpxByName.get(norm(e.name));
  if (!hit) { unmatched.push(e.name); return null; }
  const c = { name: hit.name.normalize("NFKC") };
  if (e.hq) c.hq = e.hq;
  c.listing = { market: `東証${hit.market}`, code: hit.code };
  if (e.note) c.note = e.note;
  return c;
}

function appendTo(node, names) {
  const existing = new Set((node.companies ?? []).map((c) => c.listing?.code).filter(Boolean));
  const existingNames = new Set((node.companies ?? []).map((c) => norm(c.name)));
  node.companies ??= [];
  for (const entry of names) {
    const c = resolveCompany(entry);
    if (!c) continue;
    if ((c.listing?.code && existing.has(c.listing.code)) || existingNames.has(norm(c.name))) { skippedDup++; continue; }
    node.companies.push(c);
    if (c.listing?.code) existing.add(c.listing.code);
    existingNames.add(norm(c.name));
    added++;
  }
  node.updated = TODAY;
}

for (const { node: nodeId, names } of spec.appendCompanies ?? []) {
  const node = data.nodes.find((n) => n.id === nodeId);
  if (!node) { console.error(`✗ node "${nodeId}" が見つからない`); process.exit(1); }
  appendTo(node, names);
}

for (const n of spec.addNodes ?? []) {
  if (data.nodes.some((x) => x.id === n.id)) { console.error(`✗ node "${n.id}" は既に存在`); process.exit(1); }
  const { companies, ...rest } = n;
  const node = { ...rest, companies: [], updated: TODAY };
  appendTo(node, companies ?? []);
  data.nodes.push(node);
}

for (const e of spec.addEdges ?? []) {
  if (data.edges.some((x) => x.id === e.id)) { console.error(`✗ edge "${e.id}" は既に存在`); process.exit(1); }
  data.edges.push({ updated: TODAY, ...e });
}

writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
console.log(`✓ ${industryId}: 企業${added}社追加(重複スキップ${skippedDup})、ノード${spec.addNodes?.length ?? 0}、エッジ${spec.addEdges?.length ?? 0}`);
if (unmatched.length) console.log(`⚠ JPX不一致(未追加): ${unmatched.join(", ")}`);
