// 商流図鑑 — 地図ビュー(SVG描画・パン/ズーム・セマンティックズーム・詳細パネル)
const NS = "http://www.w3.org/2000/svg";
const VB = { x: -760, y: -540, w: 1520, h: 1080 };
const RING_R = [0, 235, 400, 555];
const FLOW_LABEL = { goods: "モノ・サービス", capex: "カネ CAPEX(一時)", opex: "カネ OPEX(継続)" };
const NEAR_ZOOM = 1.45;

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// 役割名を最大3行に折り返す
function wrapText(str, maxLen = 9) {
  const lines = [];
  let rest = str;
  while (rest.length > 0 && lines.length < 3) {
    lines.push(rest.slice(0, maxLen));
    rest = rest.slice(maxLen);
  }
  if (rest.length) lines[lines.length - 1] += "…";
  return lines;
}

function nodePos(node) {
  const ring = node.map?.ring ?? 2;
  const angle = ((node.map?.angle ?? 0) - 90) * (Math.PI / 180); // 北=0 を上向きに
  const r = RING_R[Math.min(ring, RING_R.length - 1)];
  return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
}

export function createMapView(container, data) {
  const layerById = Object.fromEntries(data.layers.map((l) => [l.id, l]));
  const pos = Object.fromEntries(data.nodes.map((n) => [n.id, nodePos(n)]));
  const radius = (n) => (n.map?.ring === 0 ? 58 : 34);

  // ---------- SVG骨格 ----------
  const svg = svgEl("svg", { class: "mapsvg", viewBox: `${VB.x} ${VB.y} ${VB.w} ${VB.h}` });
  const defs = svgEl("defs");
  for (const [ft, color] of [["goods", "#2e7d6e"], ["capex", "#b97a12"], ["opex", "#a84a5f"]]) {
    const m = svgEl("marker", {
      id: `arrow-${ft}`, viewBox: "0 0 10 10", refX: "8", refY: "5",
      markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse",
    });
    m.appendChild(svgEl("path", { d: "M0,0 L10,5 L0,10 z", fill: color }));
    defs.appendChild(m);
  }
  svg.appendChild(defs);
  const world = svgEl("g", { class: "world" });
  svg.appendChild(world);

  // ---------- 地形(リング・方位・コンパス) ----------
  const terrain = svgEl("g", { class: "terrain" });
  for (const r of RING_R.slice(1)) terrain.appendChild(svgEl("circle", { class: "ring", cx: 0, cy: 0, r }));
  for (let a = 0; a < 360; a += 30) {
    const rad = ((a - 90) * Math.PI) / 180;
    terrain.appendChild(
      svgEl("line", {
        class: "sector-line",
        x1: 90 * Math.cos(rad), y1: 90 * Math.sin(rad),
        x2: 620 * Math.cos(rad), y2: 620 * Math.sin(rad),
      })
    );
  }
  const compass = svgEl("g", { class: "compass", transform: `translate(${VB.x + 84}, ${VB.y + 96})` });
  compass.appendChild(svgEl("circle", { cx: 0, cy: 0, r: 34, fill: "none", stroke: "#8a6d2f", "stroke-width": 1.5, opacity: 0.5 }));
  compass.appendChild(svgEl("path", { d: "M0,-30 L7,8 L0,2 L-7,8 Z", fill: "#8a6d2f", opacity: 0.75 }));
  const compassN = svgEl("text", { x: 0, y: -42, "text-anchor": "middle", "font-size": 17 });
  compassN.textContent = "N";
  compass.appendChild(compassN);
  terrain.appendChild(compass);
  world.appendChild(terrain);

  // ---------- エッジ ----------
  const edgesG = svgEl("g", { class: "edges" });
  world.appendChild(edgesG);

  // 同一ペア間の複数エッジは曲率をずらして重なりを避ける
  const pairGroups = new Map();
  for (const e of data.edges) {
    const key = [e.from, e.to].sort().join("|");
    if (!pairGroups.has(key)) pairGroups.set(key, []);
    pairGroups.get(key).push(e);
  }

  const edgeEls = new Map();
  for (const [key, group] of pairGroups) {
    group.forEach((e, i) => {
      const A = pos[e.from], B = pos[e.to];
      const nA = data.nodes.find((n) => n.id === e.from);
      const nB = data.nodes.find((n) => n.id === e.to);
      const canonical = e.from === key.split("|")[0];
      let off = (i - (group.length - 1) / 2) * 52;
      if (!canonical) off = -off;
      const dx = B.x - A.x, dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      const px = -dy / len, py = dx / len;
      const C = { x: (A.x + B.x) / 2 + px * off, y: (A.y + B.y) / 2 + py * off };
      const trim = (P, Q, d) => {
        const l = Math.hypot(Q.x - P.x, Q.y - P.y) || 1;
        return { x: P.x + ((Q.x - P.x) / l) * d, y: P.y + ((Q.y - P.y) / l) * d };
      };
      const S = trim(A, C, radius(nA) + 8);
      const E = trim(B, C, radius(nB) + 16);
      const d = `M ${S.x.toFixed(1)} ${S.y.toFixed(1)} Q ${C.x.toFixed(1)} ${C.y.toFixed(1)} ${E.x.toFixed(1)} ${E.y.toFixed(1)}`;
      const g = svgEl("g", { class: `edge flow-${e.flow_type}`, "data-id": e.id });
      g.appendChild(svgEl("path", { class: "line", d, "marker-end": `url(#arrow-${e.flow_type})` }));
      g.appendChild(svgEl("path", { class: "hit", d }));
      // ズームイン時のみ見えるフローラベル(曲線の中点に配置)
      const mid = {
        x: 0.25 * S.x + 0.5 * C.x + 0.25 * E.x,
        y: 0.25 * S.y + 0.5 * C.y + 0.25 * E.y,
      };
      const lbl = svgEl("text", { class: "elabel", x: mid.x, y: mid.y - 4 });
      lbl.textContent = e.label.length > 14 ? e.label.slice(0, 13) + "…" : e.label;
      g.appendChild(lbl);
      edgesG.appendChild(g);
      edgeEls.set(e.id, { el: g, edge: e });
    });
  }

  // ---------- ノード ----------
  const nodesG = svgEl("g", { class: "nodes" });
  world.appendChild(nodesG);
  const nodeEls = new Map();

  data.nodes.forEach((n, idx) => {
    const p = pos[n.id];
    const r = radius(n);
    const g = svgEl("g", { class: `node${n.map?.ring === 0 ? " center" : ""}`, "data-id": n.id });
    g.style.setProperty("--tx", `${p.x}px`);
    g.style.setProperty("--ty", `${p.y}px`);
    g.style.transform = "translate(var(--tx), var(--ty))";
    g.style.animationDelay = `${idx * 45}ms`;

    g.appendChild(svgEl("circle", { class: "halo", r: r + 10 }));
    g.appendChild(svgEl("circle", { class: "body", r }));

    const icon = svgEl("text", { class: "icon", y: r * 0.28, "font-size": r * 0.92 });
    icon.textContent = layerById[n.layer]?.icon ?? "●";
    g.appendChild(icon);

    if (n.related_industry || n.segments?.some((s) => s.related_industry)) {
      const portal = svgEl("text", {
        class: "portal", x: -r * 0.78, y: -r * 0.55,
        "font-size": 16, "text-anchor": "middle",
      });
      portal.textContent = "🧭";
      g.appendChild(portal);
    }

    const roleLines = wrapText(n.role, n.map?.ring === 0 ? 10 : 9);
    roleLines.forEach((line, li) => {
      const t = svgEl("text", { class: "role", y: r + 18 + li * 17 });
      t.textContent = line;
      g.appendChild(t);
    });

    if (n.companies?.length) {
      const badge = svgEl("g", { class: "count-badge", transform: `translate(${r * 0.72}, ${-r * 0.72})` });
      badge.appendChild(svgEl("circle", { r: 11 }));
      const bt = svgEl("text", { y: 4 });
      bt.textContent = n.companies.length;
      badge.appendChild(bt);
      g.appendChild(badge);

      const comp = svgEl("g", { class: "companies" });
      const baseY = r + 18 + roleLines.length * 17;
      const shown = n.companies.slice(0, 4);
      shown.forEach((c, ci) => {
        const t = svgEl("text", { y: baseY + ci * 13 });
        t.textContent = c.name + (c.hiring ? " 🔥" : "");
        comp.appendChild(t);
      });
      if (n.companies.length > 4) {
        const t = svgEl("text", { class: "more", y: baseY + shown.length * 13 });
        t.textContent = `ほか${n.companies.length - 4}社`;
        comp.appendChild(t);
      }
      g.appendChild(comp);
    }
    nodesG.appendChild(g);
    nodeEls.set(n.id, g);
  });

  container.appendChild(svg);

  // ---------- ツールチップ ----------
  const tooltip = document.createElement("div");
  tooltip.className = "tooltip";
  container.appendChild(tooltip);

  // ---------- 詳細パネル ----------
  const panel = document.createElement("aside");
  panel.className = "panel";
  container.appendChild(panel);
  let pinned = false; // クリックで固定表示中か(ホバープレビューと区別)
  let dwellTimer = null; // ノード上に一定時間とどまったらプレビューを切り替える
  const closePanel = () => {
    pinned = false;
    clearTimeout(dwellTimer);
    panel.classList.remove("open", "preview");
  };

  // ---------- 企業リスト(ソート・セグメント・財務概算) ----------
  let sortMode = "default";

  function fmtOku(v) {
    return v >= 10000 ? `${(v / 10000).toFixed(1)}兆円` : `${Math.round(v).toLocaleString("ja-JP")}億円`;
  }

  function fmtEmp(v) {
    return v >= 10000 ? `${(v / 10000).toFixed(1)}万人` : `${Math.round(v).toLocaleString("ja-JP")}人`;
  }

  function sortCompanies(comps) {
    if (sortMode === "default") return comps;
    const metric = (c) =>
      sortMode === "revenue" ? c.financials?.revenue_oku_jpy
      : sortMode === "mcap" ? c.financials?.market_cap_oku_jpy
      : c.employees;
    return [...comps].sort((a, b) => (metric(b) ?? -1) - (metric(a) ?? -1));
  }

  function companyRowHTML(c) {
    const fin = c.financials;
    const finParts = [];
    if (fin?.revenue_oku_jpy) finParts.push(`💰 売上 約${fmtOku(fin.revenue_oku_jpy)}`);
    if (fin?.market_cap_oku_jpy) finParts.push(`📈 時価総額 約${fmtOku(fin.market_cap_oku_jpy)}`);
    const finLine = finParts.length
      ? `<div class="fin" title="${esc(fin?.note ?? "")}">${finParts.join("　")}<span class="fin-asof">(${esc(fin?.as_of ?? "")}・概算)</span></div>`
      : fin?.note
        ? `<div class="fin note-only">${esc(fin.note)}</div>`
        : "";
    const bizParts = [];
    if (c.listing?.market) bizParts.push(`🏛 ${esc(c.listing.market)}${c.listing.code ? ` <span class="ticker">${esc(c.listing.code)}</span>` : ""}`);
    if (c.employees) bizParts.push(`👥 約${fmtEmp(c.employees)}`);
    const bizLine = bizParts.length ? `<div class="c-meta c-biz">${bizParts.join("　")}</div>` : "";
    const metaParts = [];
    if (c.hq) metaParts.push(`📍 ${esc(c.hq)}`);
    if (c.url) {
      try { metaParts.push(`🔗 ${new URL(c.url).hostname.replace(/^www\./, "")}`); } catch { /* URL不正は無視 */ }
    }
    const metaLine = metaParts.length ? `<div class="c-meta">${metaParts.join("　")}</div>` : "";
    const planBadge =
      c.plan === "free" ? `<span class="badge plan-free">無料掲載</span>`
      : c.plan?.startsWith("paid") ? `<span class="badge plan-paid">掲載企業</span>` : "";
    return `<li class="company">
      <div class="c-main">${
        c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)
      }${c.hiring ? '<span class="badge hiring">採用中</span>' : ""}${planBadge}</div>
      ${finLine}
      ${bizLine}
      ${metaLine}
      ${c.note ? `<div class="c-meta c-note">${esc(c.note)}</div>` : ""}
    </li>`;
  }

  function companiesListHTML(n) {
    const comps = n.companies ?? [];
    if (!comps.length) return "";
    const sortSel = `
      <div class="sort-row">
        <h3 style="border:none;margin:0;padding:0">プレイヤー企業(${comps.length})</h3>
        <select class="sort-select" title="並び順">
          <option value="default"${sortMode === "default" ? " selected" : ""}>掲載順</option>
          <option value="revenue"${sortMode === "revenue" ? " selected" : ""}>売上高順</option>
          <option value="mcap"${sortMode === "mcap" ? " selected" : ""}>時価総額順</option>
          <option value="emp"${sortMode === "emp" ? " selected" : ""}>従業員数順</option>
        </select>
      </div>
      <p class="sort-note">標準の掲載順は編集方針で固定(課金で変わりません)。財務値は公開情報ベースの概算です。</p>
      ${comps.length > 20 ? `<input type="search" class="company-filter" placeholder="🔍 この中から絞り込む(社名・証券コード)" autocomplete="off">` : ""}`;
    let body;
    if (n.segments?.length) {
      const bySeg = new Map(n.segments.map((s) => [s.id, []]));
      const others = [];
      for (const c of sortCompanies(comps)) {
        if (c.segment && bySeg.has(c.segment)) bySeg.get(c.segment).push(c);
        else others.push(c);
      }
      body = n.segments
        .map((s) => {
          const rows = bySeg.get(s.id).map(companyRowHTML).join("");
          const portal = s.related_industry
            ? `<a class="seg-portal" href="#/i/${esc(s.related_industry)}">🧭 地図へ潜る</a>`
            : "";
          return `<div class="seg">
            <div class="seg-h"><span class="seg-label">${esc(s.label)}</span>${portal}</div>
            ${s.description ? `<p class="seg-desc">${esc(s.description)}</p>` : ""}
            <ul>${rows || '<li class="company none">(掲載準備中)</li>'}</ul>
          </div>`;
        })
        .join("") +
        (others.length ? `<div class="seg"><div class="seg-h"><span class="seg-label">その他</span></div><ul>${others.map(companyRowHTML).join("")}</ul></div>` : "");
    } else {
      body = `<ul>${sortCompanies(comps).map(companyRowHTML).join("")}</ul>`;
    }
    return sortSel + body;
  }

  function bindSortSelect(rerender) {
    panel.querySelector(".sort-select")?.addEventListener("change", (ev) => {
      sortMode = ev.target.value;
      rerender();
    });
    // ノード内の企業絞り込み(表示のみをフィルタ)
    const filter = panel.querySelector(".company-filter");
    filter?.addEventListener("input", () => {
      const q = filter.value.trim().toLowerCase();
      for (const li of panel.querySelectorAll(".company:not(.none)")) {
        li.style.display = !q || li.textContent.toLowerCase().includes(q) ? "" : "none";
      }
    });
  }

  function sourcesHTML(sources) {
    if (!sources?.length) return "";
    return `<h3>出典</h3><div class="sources">${sources
      .map((s) => `・<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title ?? s.publisher ?? s.url)}</a>${s.note ? `<br>　<span>${esc(s.note)}</span>` : ""}`)
      .join("<br>")}</div>`;
  }

  function flowItemHTML(e, dir) {
    const peer = data.nodes.find((n) => n.id === (dir === "out" ? e.to : e.from));
    const arrow = dir === "out" ? "→" : "←";
    return `<li class="flow-item">
      <span class="f-chip ${e.flow_type}">${e.flow_type.toUpperCase()}</span>
      ${arrow} <span class="f-peer">${esc(peer?.role ?? "?")}</span><br>${esc(e.label)}
      ${e.amount_note ? `<span class="f-amount">💰 ${esc(e.amount_note)}</span>` : ""}
    </li>`;
  }

  function nodeHeaderHTML(n) {
    const layer = layerById[n.layer];
    return `
      <button class="close" title="閉じる">✕</button>
      <div class="p-icon">${layer?.icon ?? ""}</div>
      <h2>${esc(n.role)}</h2>
      <span class="p-layer">${esc(layer?.label ?? n.layer)}</span>`;
  }

  function openNodePanel(n) {
    pinned = true;
    const outs = data.edges.filter((e) => e.from === n.id);
    const ins = data.edges.filter((e) => e.to === n.id);
    panel.innerHTML = `
      ${nodeHeaderHTML(n)}
      ${n.description ? `<p class="p-desc">${esc(n.description)}</p>` : ""}
      ${n.note ? `<p class="p-note">📝 ${esc(n.note)}</p>` : ""}
      ${n.related_industry ? `<a class="portal-link" href="#/i/${esc(n.related_industry)}">🧭 この業界の地図へ潜る →</a>` : ""}
      ${companiesListHTML(n)}
      ${outs.length ? `<h3>出ていくフロー(${outs.length})</h3><ul>${outs.map((e) => flowItemHTML(e, "out")).join("")}</ul>` : ""}
      ${ins.length ? `<h3>入ってくるフロー(${ins.length})</h3><ul>${ins.map((e) => flowItemHTML(e, "in")).join("")}</ul>` : ""}
      ${sourcesHTML(n.sources)}
      <div class="p-meta">最終更新: ${esc(n.updated)}</div>`;
    panel.querySelector(".close").addEventListener("click", closePanel);
    bindSortSelect(() => openNodePanel(n));
    panel.classList.remove("preview");
    panel.classList.add("open");
  }

  // ホバー時の企業リストプレビュー(クリックで固定)
  function openNodePreview(n) {
    if (pinned) return;
    panel.innerHTML = `
      ${nodeHeaderHTML(n)}
      ${companiesListHTML(n) || (n.note ? `<p class="p-note">📝 ${esc(n.note)}</p>` : "")}
      <p class="preview-hint">クリックで詳細(フロー・出典)を固定表示</p>`;
    panel.querySelector(".close").addEventListener("click", closePanel);
    bindSortSelect(() => openNodePreview(n));
    panel.classList.add("open", "preview");
  }

  function openEdgePanel(e) {
    pinned = true;
    const from = data.nodes.find((n) => n.id === e.from);
    const to = data.nodes.find((n) => n.id === e.to);
    panel.classList.remove("preview");
    panel.innerHTML = `
      <button class="close" title="閉じる">✕</button>
      <span class="f-chip ${e.flow_type}" style="font-size:.75rem">${FLOW_LABEL[e.flow_type]}</span>
      <h2 style="margin-top:10px">${esc(e.label)}</h2>
      <p class="p-desc"><span class="f-peer" style="color:var(--gold);font-weight:700">${esc(from?.role)}</span>
       → <span style="color:var(--gold);font-weight:700">${esc(to?.role)}</span></p>
      ${e.amount_note ? `<p class="p-desc">💰 ${esc(e.amount_note)}</p>` : ""}
      ${e.note ? `<p class="p-note">📝 ${esc(e.note)}</p>` : ""}
      ${sourcesHTML(e.sources)}
      <div class="p-meta">最終更新: ${esc(e.updated)}</div>`;
    panel.querySelector(".close").addEventListener("click", closePanel);
    panel.classList.add("open");
  }

  // ---------- インタラクション: ノード ----------
  for (const [id, g] of nodeEls) {
    const n = data.nodes.find((x) => x.id === id);
    g.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openNodePanel(n);
      flyTo(n.id);
    });
    g.addEventListener("mouseenter", () => {
      svg.classList.add("focus");
      g.classList.add("lit");
      for (const { el, edge } of edgeEls.values()) {
        if (edge.from === id || edge.to === id) {
          el.classList.add("lit");
          nodeEls.get(edge.from)?.classList.add("lit");
          nodeEls.get(edge.to)?.classList.add("lit");
        }
      }
      // 220ms滞在で切り替え: パネルへ移動する途中で別ノードをかすめても変わらない
      clearTimeout(dwellTimer);
      dwellTimer = setTimeout(() => openNodePreview(n), 220);
    });
    g.addEventListener("mouseleave", () => {
      svg.classList.remove("focus");
      svg.querySelectorAll(".lit").forEach((el) => el.classList.remove("lit"));
      // パネルは閉じない(✕・Esc・地図の空白クリックでのみ閉じる)
      clearTimeout(dwellTimer);
    });
  }

  // ---------- インタラクション: エッジ ----------
  for (const { el, edge } of edgeEls.values()) {
    el.addEventListener("click", (ev) => { ev.stopPropagation(); openEdgePanel(edge); });
    el.addEventListener("mousemove", (ev) => {
      const rect = container.getBoundingClientRect();
      tooltip.style.left = `${ev.clientX - rect.left + 16}px`;
      tooltip.style.top = `${ev.clientY - rect.top + 12}px`;
    });
    el.addEventListener("mouseenter", () => {
      const from = data.nodes.find((n) => n.id === edge.from);
      const to = data.nodes.find((n) => n.id === edge.to);
      tooltip.innerHTML = `<span class="t-flow ${edge.flow_type}">${FLOW_LABEL[edge.flow_type]}</span><br>
        ${esc(from?.role)} → ${esc(to?.role)}<br><strong>${esc(edge.label)}</strong>
        ${edge.amount_note ? `<div class="t-amount">💰 ${esc(edge.amount_note)}</div>` : ""}`;
      tooltip.classList.add("show");
    });
    el.addEventListener("mouseleave", () => tooltip.classList.remove("show"));
  }

  let suppressClick = false;
  svg.addEventListener("click", () => {
    if (suppressClick) { suppressClick = false; return; }
    closePanel();
  });

  // ---------- パン・ズーム ----------
  let view = { x: 0, y: 0, k: 1 };
  function applyView() {
    world.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`);
    svg.classList.toggle("near", view.k >= NEAR_ZOOM);
  }
  function clientToViewBox(cx, cy) {
    const pt = new DOMPoint(cx, cy).matrixTransform(svg.getScreenCTM().inverse());
    return { x: pt.x, y: pt.y };
  }
  function zoomAt(cx, cy, factor) {
    const k2 = Math.min(4.2, Math.max(0.4, view.k * factor));
    const f = k2 / view.k;
    view.x = cx - (cx - view.x) * f;
    view.y = cy - (cy - view.y) * f;
    view.k = k2;
    applyView();
  }
  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const p = clientToViewBox(ev.clientX, ev.clientY);
    zoomAt(p.x, p.y, Math.exp(-ev.deltaY * 0.0016));
  }, { passive: false });

  // ドラッグ(1本指)とピンチズーム(2本指)
  const pointers = new Map();
  let drag = null;
  let pinch = null;

  svg.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try { svg.setPointerCapture(ev.pointerId); } catch { /* 合成イベント等でIDが無効な場合 */ }
    if (pointers.size === 1) {
      drag = { sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y, moved: false };
      svg.classList.add("dragging");
    } else if (pointers.size === 2) {
      drag = null;
      const [a, b] = [...pointers.values()];
      pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: view.k };
    }
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = clientToViewBox((a.x + b.x) / 2, (a.y + b.y) / 2);
      zoomAt(mid.x, mid.y, (pinch.k0 * (d / pinch.d0)) / view.k);
      suppressClick = true;
    } else if (drag) {
      const scale = VB.w / svg.getBoundingClientRect().width;
      const dx = (ev.clientX - drag.sx) * scale;
      const dy = (ev.clientY - drag.sy) * scale;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      view.x = drag.vx + dx;
      view.y = drag.vy + dy;
      applyView();
    }
  });
  const endDrag = (ev) => {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag?.moved) suppressClick = true;
    if (pointers.size === 0) {
      drag = null;
      svg.classList.remove("dragging");
    }
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  // 指定ノードへスムーズにズーム移動
  let flyAnim = null;
  function flyTo(nodeId, targetK) {
    const p = pos[nodeId];
    if (!p) return;
    const k = targetK ?? Math.max(view.k, 1.8);
    const to = { x: -p.x * k, y: -p.y * k, k };
    cancelAnimationFrame(flyAnim);
    // 非表示タブ等でrAFが止まる環境では即座に移動
    if (document.hidden) { view = to; applyView(); return; }
    const from = { ...view };
    const t0 = performance.now();
    const DUR = 420;
    const step = (t) => {
      const u = Math.min(1, (t - t0) / DUR);
      const ease = 1 - Math.pow(1 - u, 3);
      view = {
        x: from.x + (to.x - from.x) * ease,
        y: from.y + (to.y - from.y) * ease,
        k: from.k + (to.k - from.k) * ease,
      };
      applyView();
      if (u < 1) flyAnim = requestAnimationFrame(step);
    };
    flyAnim = requestAnimationFrame(step);
  }

  // Escでパネルを閉じる
  const onKey = (ev) => { if (ev.key === "Escape") closePanel(); };
  document.addEventListener("keydown", onKey);

  applyView();

  // ---------- 凡例・ズームボタン ----------
  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML = data.meta.map_style === "category"
    ? `<div class="row">🗂 カオスマップ型(分類のみ・商流エッジなし)</div>
       <div class="hint">🖱 ドラッグで移動 / ホイールでズーム<br>🔍 ズームインで実名企業が現れる</div>`
    : `<div class="row"><span class="swatch goods"></span>モノ・サービスの流れ</div>
       <div class="row"><span class="swatch capex"></span>カネ CAPEX(一時投資)</div>
       <div class="row"><span class="swatch opex"></span>カネ OPEX(継続支払い)</div>
       <div class="hint">🖱 ドラッグで移動 / ホイールでズーム<br>🔍 ズームインで実名企業が現れる</div>`;
  container.appendChild(legend);

  const zoomctl = document.createElement("div");
  zoomctl.className = "zoomctl";
  zoomctl.innerHTML = `
    <button data-z="in" title="ズームイン">+</button>
    <button data-z="out" title="ズームアウト">−</button>
    <button data-z="reset" title="全体表示">⌂</button>`;
  zoomctl.addEventListener("click", (ev) => {
    const z = ev.target.closest("button")?.dataset.z;
    if (z === "in") zoomAt(0, 0, 1.45);
    else if (z === "out") zoomAt(0, 0, 1 / 1.45);
    else if (z === "reset") { view = { x: 0, y: 0, k: 1 }; applyView(); }
  });
  container.appendChild(zoomctl);

  // ---------- 検索(役割名・企業名) ----------
  function search(query) {
    const q = query.trim().toLowerCase();
    if (!q) return false;
    const hit = data.nodes.find(
      (n) =>
        n.role.toLowerCase().includes(q) ||
        n.companies?.some((c) => c.name.toLowerCase().includes(q))
    );
    if (!hit) return false;
    openNodePanel(hit);
    flyTo(hit.id, 1.9);
    return true;
  }

  return {
    search,
    suggestions: () => [
      ...data.nodes.map((n) => n.role),
      ...data.nodes.flatMap((n) => (n.companies ?? []).map((c) => c.name)),
    ],
    destroy: () => {
      document.removeEventListener("keydown", onKey);
      cancelAnimationFrame(flyAnim);
      container.replaceChildren();
    },
  };
}
