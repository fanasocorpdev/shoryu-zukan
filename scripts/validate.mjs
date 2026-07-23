// 業界データの整合性チェック(スキーマ本体の検証はajv導入後に追加)
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "data", "industries");
const FLOW_TYPES = new Set(["goods", "capex", "opex"]);
const PLANS = new Set(["none", "free", "paid_basic", "paid_premium"]);
const ID_RE = /^[a-z0-9_]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let errors = 0;
const err = (file, msg) => { errors++; console.error(`✗ ${file}: ${msg}`); };

const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
const knownIndustries = new Set(index.industries);

for (const file of readdirSync(dir).filter(f => f.endsWith(".json") && f !== "index.json")) {
  const data = JSON.parse(readFileSync(join(dir, file), "utf8"));
  const isCategory = data.meta?.map_style === "category";
  if (data.meta?.parent_industry && !knownIndustries.has(data.meta.parent_industry))
    err(file, `parent_industry "${data.meta.parent_industry}" がindex.jsonに無い`);

  const layerIds = new Set((data.layers ?? []).map(l => l.id));
  const nodeIds = new Set();

  for (const n of data.nodes ?? []) {
    if (!ID_RE.test(n.id)) err(file, `node id が不正: ${n.id}`);
    if (nodeIds.has(n.id)) err(file, `node id 重複: ${n.id}`);
    nodeIds.add(n.id);
    if (!layerIds.has(n.layer)) err(file, `node ${n.id}: 未宣言のlayer "${n.layer}"`);
    if (n.related_industry && !knownIndustries.has(n.related_industry))
      err(file, `node ${n.id}: related_industry "${n.related_industry}" がindex.jsonに無い`);
    if (!DATE_RE.test(n.updated ?? "")) err(file, `node ${n.id}: updated が日付でない`);
    const segIds = new Set();
    for (const s of n.segments ?? []) {
      if (segIds.has(s.id)) err(file, `node ${n.id}: segment id 重複 "${s.id}"`);
      segIds.add(s.id);
      if (s.related_industry && !knownIndustries.has(s.related_industry))
        err(file, `node ${n.id}: segment "${s.id}" のrelated_industry "${s.related_industry}" がindex.jsonに無い`);
    }
    for (const c of n.companies ?? []) {
      if (c.plan && !PLANS.has(c.plan)) err(file, `node ${n.id}: 不正なplan "${c.plan}" (${c.name})`);
      if (c.segment && !segIds.has(c.segment))
        err(file, `node ${n.id}: 企業 "${c.name}" のsegment "${c.segment}" が未宣言`);
      const fin = c.financials;
      if (fin) {
        for (const k of ["revenue_oku_jpy", "market_cap_oku_jpy"]) {
          if (fin[k] !== undefined && !(typeof fin[k] === "number" && fin[k] > 0))
            err(file, `node ${n.id}: "${c.name}" の${k}が正の数でない`);
        }
      }
    }
  }

  const edgeIds = new Set();
  for (const e of data.edges ?? []) {
    if (edgeIds.has(e.id)) err(file, `edge id 重複: ${e.id}`);
    edgeIds.add(e.id);
    if (!nodeIds.has(e.from)) err(file, `edge ${e.id}: from "${e.from}" が存在しない`);
    if (!nodeIds.has(e.to)) err(file, `edge ${e.id}: to "${e.to}" が存在しない`);
    if (e.from === e.to) err(file, `edge ${e.id}: 自己ループ`);
    if (!FLOW_TYPES.has(e.flow_type)) err(file, `edge ${e.id}: 不正なflow_type "${e.flow_type}"`);
    if (!e.label) err(file, `edge ${e.id}: label がない`);
    if (!e.sources?.length) err(file, `edge ${e.id}: sources が空(出典必須)`);
    if (!DATE_RE.test(e.updated ?? "")) err(file, `edge ${e.id}: updated が日付でない`);
  }

  if (!isCategory) {
    const unsortedIds = new Set((data.nodes ?? []).filter(n => n.unsorted).map(n => n.id));
    const isolated = [...nodeIds].filter(id =>
      !unsortedIds.has(id) &&
      !(data.edges ?? []).some(e => e.from === id || e.to === id));
    for (const id of isolated) err(file, `node ${id}: どのエッジにも接続されていない`);
    if (!(data.edges ?? []).length) err(file, "flow型なのにエッジが無い");
  }

  console.log(`${file}: ${nodeIds.size} nodes, ${edgeIds.size} edges`);
}

if (errors) { console.error(`\n${errors} 件のエラー`); process.exit(1); }
console.log("OK");
