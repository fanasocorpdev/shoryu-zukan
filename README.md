# 商流図鑑(仮)

業界別の商流(モノ・サービスとカネの流れ)をインタラクティブな地図型UIで可視化するWebサービス。
運営: 株式会社Fanaso。プロジェクト方針は [CLAUDE.md](CLAUDE.md) を参照。

**現況(2026-07-23):** 23業界マップ / 国内上場3,716社中1,911社を収容(カバー率51.4%)/
東証33業種すべてに対応マップあり。公開: https://fanasocorpdev.github.io/shoryu-zukan/

## 起動

依存パッケージなし。Node.jsだけで動く。

```bash
node scripts/serve.mjs
```

→ http://localhost:8137 を開く。

## 構成

| パス | 内容 |
|---|---|
| `index.html` + `css/` + `js/` | フロントエンド(バニラJS + SVG、ビルド不要) |
| `data/schema.json` | 業界共通のグラフスキーマ(JSON Schema) |
| `data/industries/*.json` | 業界ごとの商流データ(nodes + edges) |
| `data/industries/index.json` | 公開業界の一覧 |
| `data/README.md` | データ規約(エッジの向き・出典ポリシー・地図ヒント) |
| `scripts/validate.mjs` | データ整合性チェック |
| `scripts/serve.mjs` | 開発用静的サーバー |

## データを追加・修正したら

```bash
node scripts/validate.mjs
```

エッジ参照・flow_type・出典必須・孤立ノードなどを検査する。

## 運用スクリプト

| コマンド | 役割 |
|---|---|
| `node scripts/fetch-jpx.mjs` | JPX上場銘柄一覧をDL→`data/reference/jpx_listed.json`(月次更新推奨) |
| `node scripts/coverage.mjs --json` | 上場企業カバー率を計測(証券コードで突合)。トップページのバーはこの出力を表示 |
| `node scripts/check-urls.mjs` | データ内全URLの死活チェック。403/503/429はbot対策による誤検知が多い(実ブラウザで確認) |

カバレッジの結果は「未カバーの多い33業種」順に出るので、それが次に作る親マップの優先度になる。
33業種→マップの対応は [data/reference/sector-map.json](data/reference/sector-map.json)。

## 業界を増やすには

1. `data/industries/<industry_id>.json` を `schema.json` に従って作成
   (`layers` は業界ごとに自由に定義。中心ノードは `map: {ring: 0}`)
2. `data/industries/index.json` に industry_id を追加
3. `node scripts/validate.mjs` で検査

フロントエンドは無変更で新業界の地図が生成される。

## デプロイ

全ファイル静的なので、GitHub Pages / Cloudflare Pages 等にそのまま置けば動く
(ルーティングはハッシュベースなのでサーバー設定不要)。
