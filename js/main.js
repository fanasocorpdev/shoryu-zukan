// あきないマップ — エントリポイント(ハッシュルーティング + トップページ)
import { createMapView } from "./mapview.js";

const app = document.getElementById("app");
const cache = {};

async function fetchJSON(path) {
  if (cache[path]) return cache[path];
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  const json = await res.json();
  cache[path] = json;
  return json;
}

const loadIndex = () => fetchJSON("data/industries/index.json");
const loadIndustry = (id) => fetchJSON(`data/industries/${id}.json`);

async function coverageHTML() {
  try {
    const c = await fetchJSON("data/reference/coverage-summary.json");
    const asOf = String(c.as_of).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
    const t5 = c.topix500;
    return `<a class="coverage" href="#/all" title="全銘柄索引を見る">
      <div class="cov-label">🗾 国内上場企業カバー率
        <strong>${c.percent}%</strong>(${c.covered.toLocaleString()} / ${c.total.toLocaleString()}社・JPX ${asOf}基準)${
          c.unsorted ? `<br><span style="font-size:.72rem">うち分類確定 ${c.classified.toLocaleString()}社 / 分類精査中 ${c.unsorted.toLocaleString()}社</span>` : ""
        }</div>
      <div class="cov-bar"><div class="cov-fill" style="width:${Math.max(c.percent, 1.5)}%"></div></div>
      ${t5 ? `<div class="cov-label" style="margin-top:8px">📈 TOPIX500(大型・中型株)
        <strong>${t5.percent}%</strong>(${t5.covered} / ${t5.total}社)</div>
      <div class="cov-bar"><div class="cov-fill" style="width:${Math.max(t5.percent, 1.5)}%"></div></div>` : ""}
      <div class="cov-more">全銘柄索引 →</div>
    </a>`;
  } catch {
    return "";
  }
}

function centerIcon(data) {
  const center = data.nodes.find((n) => n.map?.ring === 0) ?? data.nodes[0];
  const layer = data.layers.find((l) => l.id === center.layer);
  return layer?.icon ?? "🗺️";
}

async function renderHome() {
  const { industries, planned = [] } = await loadIndex();
  const datas = await Promise.all(industries.map(loadIndustry));
  const parents = datas.filter((d) => !d.meta.parent_industry);
  const childrenOf = (pid) => datas.filter((d) => d.meta.parent_industry === pid);
  const card = (d) => {
    const children = childrenOf(d.meta.industry_id);
    return `
      <a class="card" href="#/i/${d.meta.industry_id}">
        <div class="c-icon">${centerIcon(d)}${d.meta.map_style === "category" ? '<span class="style-tag">カオスマップ</span>' : ""}</div>
        <h2>${d.meta.industry_name}</h2>
        <p class="tagline">${d.meta.tagline ?? ""}</p>
        <div class="stats">
          <span>プレイヤー ${d.nodes.length}</span>
          ${d.edges.length ? `<span>フロー ${d.edges.length}</span>` : ""}
          <span>更新 ${d.meta.updated}</span>
        </div>
        ${children.length
          ? `<div class="child-links">${children
              .map((c) => `<span class="child-chip" data-href="#/i/${c.meta.industry_id}">↳ ${c.meta.industry_name}</span>`)
              .join("")}</div>`
          : ""}
        <span class="go">→</span>
      </a>`;
  };
  app.innerHTML = `
    <div class="home"><div class="home-inner">
      <div class="hero">
        <div class="compass">🧭</div>
        <h1>あきないマップ</h1>
        <p class="sub">業界のカネとモノの流れを、冒険する地図に。<br>
        誰が誰に、何を届けて、いくら払うのか — ズームして確かめよう。</p>
        <div class="free-banner">商流マップは永久無料で公開します</div>
      </div>
      <div class="cards">
        ${parents.map(card).join("")}
      </div>
      ${await coverageHTML()}
      ${planned.length
        ? `<div class="planned">
            <h3>⚒ 準備中の業界(時価総額の大きい業種から順次追加 → 最終的に全上場企業をカバー)</h3>
            <div class="planned-chips">${planned
              .map((p) => `<span class="planned-chip" title="${p.note ?? ""}">${p.name}</span>`)
              .join("")}</div>
          </div>`
        : ""}
      <div class="home-foot">
        出典は官公庁統計・IR・プレスリリース等の一次情報のみを使用しています。<br>
        <a href="#/about">あきないマップについて(掲載・編集方針)</a><br>
        運営: 株式会社Fanaso
      </div>
    </div></div>`;
  // 子業界チップはカード全体のリンクより優先して遷移させる
  app.querySelectorAll(".child-chip").forEach((chip) =>
    chip.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      location.hash = chip.dataset.href;
    })
  );
}

async function renderDirectory() {
  const [jpx, coverage, { industries }] = await Promise.all([
    fetchJSON("data/reference/jpx_listed.json"),
    fetchJSON("data/reference/coverage.json").catch(() => null),
    loadIndex(),
  ]);
  const nameById = {};
  for (const iid of industries) nameById[iid] = (await loadIndustry(iid)).meta.industry_name;

  const coveredMap = new Map();
  for (const c of coverage?.covered_list ?? []) coveredMap.set(c.code, c.industries);

  const bySector = new Map();
  for (const co of jpx.companies) {
    if (!bySector.has(co.sector33)) bySector.set(co.sector33, []);
    bySector.get(co.sector33).push(co);
  }
  const sectors = [...bySector.entries()].sort((a, b) => b[1].length - a[1].length);

  const chip = (co) => {
    const inds = coveredMap.get(co.code);
    if (inds?.length) {
      return `<a class="dir-chip covered" href="#/i/${inds[0]}" title="${nameById[inds[0]] ?? inds[0]}のマップに掲載">${co.name} <span class="dir-code">${co.code}</span></a>`;
    }
    return `<span class="dir-chip" title="${co.sector33} / ${co.market}">${co.name} <span class="dir-code">${co.code}</span></span>`;
  };

  app.innerHTML = `
    <div class="home"><div class="home-inner directory">
      <div class="hero">
        <div class="compass">🗾</div>
        <h1>全銘柄索引</h1>
        <p class="sub">国内上場 ${jpx.companies.length.toLocaleString()}社(JPX ${String(jpx.as_of).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")}基準)。
        <span class="dir-legend"><span class="dir-chip covered demo">金色=マップ掲載済み(クリックで地図へ)</span></span></p>
        <input id="dir-search" type="search" placeholder="🔍 社名・証券コードで検索" autocomplete="off">
      </div>
      <div id="dir-sections">
        ${sectors
          .map(([sector, list]) => {
            const covered = list.filter((c) => coveredMap.has(c.code)).length;
            return `<details class="dir-sec" ${covered ? "" : ""}>
              <summary>${sector} <span class="dir-count">${covered}/${list.length}社</span></summary>
              <div class="dir-chips">${list.map(chip).join("")}</div>
            </details>`;
          })
          .join("")}
      </div>
      <div class="home-foot"><a href="#/">← マップトップへ戻る</a></div>
    </div></div>`;

  const search = document.getElementById("dir-search");
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    for (const sec of document.querySelectorAll(".dir-sec")) {
      let visible = 0;
      for (const c of sec.querySelectorAll(".dir-chip:not(.demo)")) {
        const hit = !q || c.textContent.toLowerCase().includes(q);
        c.style.display = hit ? "" : "none";
        if (hit) visible++;
      }
      sec.style.display = visible ? "" : "none";
      if (q) sec.open = true;
    }
  });
}

function renderAbout() {
  app.innerHTML = `
    <div class="home"><div class="home-inner about">
      <div class="hero">
        <div class="compass">🧭</div>
        <h1>あきないマップについて</h1>
      </div>
      <section class="about-sec">
        <h2>📖 商流マップは永久無料</h2>
        <p>すべての商流マップは、これからもずっと無料で公開します。
        あとから閲覧を有料化することはありません。最初にここで宣言しておきます。</p>
      </section>
      <section class="about-sec">
        <h2>⚖️ 地図の中立性</h2>
        <p>マップ上のプレイヤーの位置・掲載順は編集方針にもとづいて決めており、
        広告や掲載プランによって変わることはありません。
        有料プランで変わるのは「情報量と機能」だけです(詳細プロフィール・問い合わせ受信・採用バッジなど)。</p>
      </section>
      <section class="about-sec">
        <h2>🔍 出典ポリシー</h2>
        <p>データの主原料は一次情報のみです: 官公庁統計、有価証券報告書・IR資料、
        業界団体の公開名簿、プレスリリース、企業公式サイト、そして企業自身による登録データ。
        出典はノード・フロー単位で記録し、詳細パネルからいつでも確認できます。
        金額感はすべて公表情報にもとづく規模表現で、個社の非公開情報は掲載しません。</p>
        <p>財務値の見方: 売上高は各社決算短信の直近通期<strong>実績</strong>、時価総額は取得日付きの掲載値です
        (基準日は各社の注記に記載)。「概算」と明記された値のみ、換算レートやセグメント値にもとづく規模感です。
        非上場企業は公表値または親会社連結の値であることを注記しています。</p>
      </section>
      <section class="about-sec">
        <h2>✏️ 修正の提案</h2>
        <p>「この会社が抜けている」「このフローは今は違う」といった事実の修正提案を歓迎します。
        提案は出典(公開情報)を添えて、<a href="https://github.com/fanasocorpdev/shoryu-zukan/issues" target="_blank" rel="noopener">GitHubのIssue</a>
        または下記メールでお送りください。内容を確認のうえ反映します。
        ※ 第三者の取引条件・マージン率など、公開情報で確認できない情報は掲載できません。</p>
      </section>
      <section class="about-sec">
        <h2>🏢 企業の方へ・お問い合わせ</h2>
        <p>自社の掲載(無料)や、詳細プロフィール・採用バッジの掲出をご希望の企業向けの
        登録フォームを準備中です。それまでの間、掲載のご希望・修正のご連絡は
        <a href="mailto:yuhei.n@fansojp.com?subject=%E5%95%86%E6%B5%81%E5%9B%B3%E9%91%91">yuhei.n@fansojp.com</a>
        までお寄せください。</p>
      </section>
      <section class="about-sec">
        <h2>⚠️ 免責</h2>
        <p>本サイトの情報は公開情報にもとづき正確性に努めていますが、内容を保証するものではありません。
        投資判断・取引判断の根拠としての利用は想定していません。誤りを見つけた場合はお知らせください —
        迅速に確認・訂正します。</p>
      </section>
      <div class="home-foot">
        <a href="#/">← マップトップへ戻る</a><br>
        運営: 株式会社Fanaso
      </div>
    </div></div>`;
}

let destroyMap = null;

async function renderIndustry(id) {
  const [{ industries }, data] = await Promise.all([loadIndex(), loadIndustry(id)]);
  const parent = data.meta.parent_industry ? await loadIndustry(data.meta.parent_industry) : null;
  app.innerHTML = `
    <div class="mapapp">
      <header class="topbar">
        <a class="home-link" href="#/">🧭 マップトップ</a>
        <a class="home-link" href="#/all" title="全銘柄索引">🗾 索引</a>
        ${parent ? `<a class="home-link parent-link" href="#/i/${parent.meta.industry_id}">⬆ ${parent.meta.industry_name}</a>` : ""}
        <div class="title-wrap"><h1>${data.meta.industry_name}の商流</h1><span class="tag">${data.meta.tagline ?? ""}</span></div>
        <button id="share-btn" class="home-link share-btn" title="この業界のリンクをコピー / シェア">🔗 シェア</button>
        <span class="spacer"></span>
        <input id="map-search" type="search" list="search-list" placeholder="🔍 企業名・役割で探す" autocomplete="off">
        <datalist id="search-list"></datalist>
        <select id="industry-select" title="業界を切り替え"></select>
        <nav class="filters" id="filters">
          <button data-f="all" class="active">すべて</button>
          <button data-f="goods"><span class="dot goods"></span>モノ・サービス</button>
          <button data-f="capex"><span class="dot capex"></span>カネ CAPEX</button>
          <button data-f="opex"><span class="dot opex"></span>カネ OPEX</button>
        </nav>
      </header>
      <div class="map-wrap" id="map-wrap" data-filter="all"></div>
    </div>`;

  if (data.meta.map_style === "category") {
    document.getElementById("filters").style.display = "none";
  }

  const select = document.getElementById("industry-select");
  for (const iid of industries) {
    const d = await loadIndustry(iid);
    const opt = document.createElement("option");
    opt.value = iid;
    opt.textContent = (d.meta.parent_industry ? "　↳ " : "") + d.meta.industry_name;
    opt.selected = iid === id;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => (location.hash = `#/i/${select.value}`));

  const wrap = document.getElementById("map-wrap");
  const filters = document.getElementById("filters");
  filters.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-f]");
    if (!btn) return;
    filters.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    wrap.dataset.filter = btn.dataset.f;
  });

  const map = createMapView(wrap, data);
  destroyMap = map.destroy;

  if (data.meta.guide) {
    const g = data.meta.guide;
    const card = document.createElement("details");
    card.className = "guide-card";
    card.open = localStorage.getItem("guideCollapsed") !== "1";
    card.innerHTML = `
      <summary>🗺 この業界の歩き方</summary>
      <p><strong>💴 稼ぎ方:</strong> ${g.earn}</p>
      <p><strong>🔭 見どころ:</strong> ${g.watch}</p>`;
    card.addEventListener("toggle", () =>
      localStorage.setItem("guideCollapsed", card.open ? "0" : "1"));
    wrap.appendChild(card);
  }

  const searchInput = document.getElementById("map-search");
  const datalist = document.getElementById("search-list");
  for (const s of new Set(map.suggestions())) {
    const opt = document.createElement("option");
    opt.value = s;
    datalist.appendChild(opt);
  }
  const runSearch = () => {
    if (map.search(searchInput.value)) searchInput.classList.remove("miss");
    else if (searchInput.value.trim()) searchInput.classList.add("miss");
  };
  searchInput.addEventListener("change", runSearch);
  searchInput.addEventListener("keydown", (ev) => { if (ev.key === "Enter") runSearch(); });

  // シェア: OGP付き静的ページ(share/<id>.html)のURLを共有する
  const shareBtn = document.getElementById("share-btn");
  shareBtn.addEventListener("click", async () => {
    const url = new URL(`share/${id}.html`, location.href.replace(/#.*$/, "").replace(/index\.html$/, "")).href;
    const title = `${data.meta.industry_name}の商流地図 — あきないマップ`;
    if (navigator.share) {
      try { await navigator.share({ title, url }); return; } catch { /* キャンセル時はコピーに落とす */ }
    }
    await navigator.clipboard.writeText(url);
    const prev = shareBtn.textContent;
    shareBtn.textContent = "✓ コピーしました";
    setTimeout(() => (shareBtn.textContent = prev), 1600);
  });
}

async function route() {
  if (destroyMap) { destroyMap(); destroyMap = null; }
  const hash = location.hash || "#/";
  try {
    const m = hash.match(/^#\/i\/([a-z0-9_]+)/);
    if (m) await renderIndustry(m[1]);
    else if (hash.startsWith("#/about")) renderAbout();
    else if (hash.startsWith("#/all")) await renderDirectory();
    else await renderHome();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="error-box">読み込みに失敗しました: ${err.message}<br>
      ローカルサーバー経由で開いてください(例: <code>node scripts/serve.mjs</code>)</div>`;
  }
  // クッキーレス解析(index.htmlでGoatCounterを有効化した場合のみ動く)
  window.goatcounter?.count?.({ path: location.pathname + (location.hash || "#/") });
}

window.addEventListener("hashchange", route);
route();
