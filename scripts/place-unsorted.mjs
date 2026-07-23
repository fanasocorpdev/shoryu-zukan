// 未カバーの上場企業を、33業種→マップ対応に基づき各マップの「その他(分類精査中)」ノードへ収容する。
// 分類の確定(適切なノードへの移動)は scripts/reassign.mjs で行う。
// 使い方: node scripts/place-unsorted.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(root, "data", "industries");
const TODAY = new Date().toISOString().slice(0, 10);

// 33業種 → 収容先マップ(sector-map.jsonの主マップに準拠)
const SECTOR_TO_MAP = {
  "水産・農林業": "food", "鉱業": "energy", "建設業": "construction", "食料品": "food",
  "繊維製品": "consumer_goods", "パルプ・紙": "materials", "化学": "chemicals",
  "医薬品": "pharma", "石油・石炭製品": "energy", "ゴム製品": "auto_parts",
  "ガラス・土石製品": "materials", "鉄鋼": "materials", "非鉄金属": "materials",
  "金属製品": "materials", "機械": "machinery", "電気機器": "electronics",
  "輸送用機器": "auto_parts", "精密機器": "electronics", "その他製品": "consumer_goods",
  "電気・ガス業": "energy", "陸運業": "transport", "海運業": "transport",
  "空運業": "transport", "倉庫・運輸関連業": "transport", "情報・通信業": "it_services",
  "卸売業": "trading_companies", "小売業": "retail", "銀行業": "banking",
  "証券、商品先物取引業": "banking", "保険業": "banking", "その他金融業": "banking",
  "不動産業": "real_estate", "サービス業": "services",
};
// unsortedノードに使うlayer(各マップの既存layer id)
const MAP_LAYER = {
  food: "maker", energy: "category", construction: "category", consumer_goods: "category",
  materials: "category", chemicals: "category", pharma: "maker", auto_parts: "parts",
  machinery: "category", electronics: "category", transport: "category",
  it_services: "category", trading_companies: "trade", retail: "store",
  banking: "regional", real_estate: "category", services: "category",
};

const jpx = JSON.parse(readFileSync(join(root, "data", "reference", "jpx_listed.json"), "utf8"));

// 既収容コードを収集
const covered = new Set();
const files = readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "index.json");
const dataById = {};
for (const f of files) {
  const d = JSON.parse(readFileSync(join(DIR, f), "utf8"));
  dataById[d.meta.industry_id] = { file: f, data: d };
  for (const n of d.nodes ?? []) for (const c of n.companies ?? []) if (c.listing?.code) covered.add(c.listing.code);
}

// 業種→未カバー企業
const placements = {};
let skipped = 0;
for (const co of jpx.companies) {
  if (covered.has(co.code)) continue;
  const mapId = SECTOR_TO_MAP[co.sector33];
  if (!mapId || !dataById[mapId]) { console.log(`⚠ 収容先なし: ${co.name} [${co.sector33}]`); skipped++; continue; }
  (placements[mapId] ??= []).push(co);
}

let placed = 0;
for (const [mapId, list] of Object.entries(placements)) {
  const { file, data } = dataById[mapId];
  let node = data.nodes.find((n) => n.unsorted);
  if (!node) {
    node = {
      id: "unsorted",
      role: "その他(分類精査中)",
      layer: MAP_LAYER[mapId],
      unsorted: true,
      description: "JPXの業種区分でこの業界に属することは確認済みだが、マップ内での位置づけ(事業分類)を精査中の企業。IR・公式サイトの確認が済み次第、適切なノードへ移動する。",
      map: { ring: 3, angle: 10 },
      companies: [],
      note: "分類の修正提案を歓迎します",
      updated: TODAY,
    };
    data.nodes.push(node);
  }
  const existing = new Set(node.companies.map((c) => c.listing?.code).filter(Boolean));
  for (const co of list) {
    if (existing.has(co.code)) continue;
    node.companies.push({
      name: co.name.normalize("NFKC"),
      listing: { market: `東証${co.market}`, code: co.code },
      note: `JPX業種: ${co.sector33}`,
    });
    placed++;
  }
  node.updated = TODAY;
  writeFileSync(join(DIR, file), JSON.stringify(data, null, 2) + "\n");
  console.log(`✓ ${mapId}: ${list.length}社を収容`);
}
console.log(`\n合計 ${placed}社を収容(スキップ ${skipped})`);
