// Akinaiマップ — 地図ビュー(SVG描画・パン/ズーム・セマンティックズーム・詳細パネル)
const NS = "http://www.w3.org/2000/svg";
const VB = { x: -760, y: -540, w: 1520, h: 1080 };
const RING_R = [0, 235, 400, 555];
const FLOW_LABEL = { goods: "モノ・サービス", capex: "カネ(設備投資などの一時金)", opex: "カネ(利用料・仕入れなどの継続払い)" };
const NEAR_ZOOM = 1.45;
const CMP_KEY = "akinai_compare";
const cmpList = () => JSON.parse(localStorage.getItem(CMP_KEY) ?? "[]");
const cmpHas = (name) => cmpList().some((x) => x.name === name);

// 商流キャリア地図: 企業ごとの「メモ+志望動機メモ」を蓄積する(スイッチングコストの芯)。
// 端末内はlocalStorage、ログイン時は将来Supabaseへ同期(store.js)。社名をキーにする。
const NOTES_KEY = "akinai_notes";
const NOTES_DEL_KEY = "akinai_notes_deleted"; // 削除の墓標(同期でリモートも消すため)
const notesAll = () => { try { return JSON.parse(localStorage.getItem(NOTES_KEY) ?? "{}"); } catch { return {}; } };
const notesDel = () => { try { return JSON.parse(localStorage.getItem(NOTES_DEL_KEY) ?? "{}"); } catch { return {}; } };
const noteFor = (name) => notesAll()[name] ?? null;
const hasNote = (name) => { const n = noteFor(name); return !!(n && (n.note || n.aspiration)); };
function saveNoteFor(name, rec) {
  const all = notesAll();
  const del = notesDel();
  if (!rec || (!rec.note && !rec.aspiration)) {
    delete all[name];
    del[name] = new Date().toISOString(); // 墓標を立てる
  } else {
    all[name] = { ...all[name], ...rec, updated: new Date().toISOString() };
    delete del[name]; // 再作成したら墓標を消す
  }
  localStorage.setItem(NOTES_KEY, JSON.stringify(all));
  localStorage.setItem(NOTES_DEL_KEY, JSON.stringify(del));
  window.dispatchEvent(new CustomEvent("akinai:notes-changed"));
}

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

  // 手置きの角度が近すぎてノードが重なる場合に、反復的に押し離して解消する。
  // 中央(ring0)は動かさない。ラベル分を含めた余白で判定する。
  {
    const movable = data.nodes.filter((n) => n.map?.ring !== 0);
    const all = data.nodes;
    for (let it = 0; it < 120; it++) {
      let moved = false;
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i], b = all[j];
          const pa = pos[a.id], pb = pos[b.id];
          const min = radius(a) + radius(b) + 54;
          let dx = pb.x - pa.x, dy = pb.y - pa.y;
          let d = Math.hypot(dx, dy);
          if (d < 0.5) { dx = Math.cos(i + j); dy = Math.sin(i + j); d = 1; }
          if (d >= min) continue;
          const push = (min - d) / 2;
          dx /= d; dy /= d;
          const aMov = a.map?.ring !== 0, bMov = b.map?.ring !== 0;
          if (aMov && bMov) {
            pa.x -= dx * push; pa.y -= dy * push;
            pb.x += dx * push; pb.y += dy * push;
          } else if (aMov) {
            pa.x -= dx * push * 2; pa.y -= dy * push * 2;
          } else if (bMov) {
            pb.x += dx * push * 2; pb.y += dy * push * 2;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  // ---------- SVG骨格 ----------
  const DENSE = (data.edges ?? []).length >= 18;
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
    icon.textContent = n.icon ?? layerById[n.layer]?.icon ?? "●";
    g.appendChild(icon);

    const portalTarget =
      n.related_industry ?? n.segments?.find((s) => s.related_industry)?.related_industry;
    if (portalTarget) {
      const portal = svgEl("g", { class: "portal-btn" });
      portal.appendChild(svgEl("circle", {
        class: "portal-hit", cx: -r * 0.78, cy: -r * 0.6, r: 15,
      }));
      const pIcon = svgEl("text", {
        class: "portal", x: -r * 0.78, y: -r * 0.55,
        "font-size": 17, "text-anchor": "middle",
      });
      pIcon.textContent = "🧭";
      portal.appendChild(pIcon);
      const tip = svgEl("title", {});
      tip.textContent = "クリックで関連マップへ潜る";
      portal.appendChild(tip);
      portal.addEventListener("click", (ev) => {
        ev.stopPropagation();
        location.hash = `#/i/${portalTarget}?from=${data.meta.industry_id}:${n.id}`;
      });
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

      // 寄ったときだけ代表1社(時価総額最大)を表示。一覧は右側パネルに集約
      const top = [...n.companies].sort(
        (a, b) => (b.financials?.market_cap_oku_jpy ?? -1) - (a.financials?.market_cap_oku_jpy ?? -1))[0];
      const rep = svgEl("text", {
        class: "top-company",
        y: r + 18 + roleLines.length * 17 + 2,
      });
      rep.textContent = n.companies.length > 1
        ? `${top.name} ほか${n.companies.length - 1}社`
        : top.name;
      g.appendChild(rep);
    }
    nodesG.appendChild(g);
    nodeEls.set(n.id, g);
  });

  if (DENSE) svg.classList.add("dense");
  container.appendChild(svg);

  // ---------- ツールチップ ----------
  const tooltip = document.createElement("div");
  tooltip.className = "tooltip";
  container.appendChild(tooltip);

  // ---------- 詳細パネル ----------
  const panelCompanies = new Map();
  const panel = document.createElement("aside");
  // お気に入りへの追加/削除(委譲)
  panel.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".cmp-add");
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    const c = panelCompanies.get(btn.dataset.name);
    if (!c) return;
    let list = cmpList();
    if (list.some((x) => x.name === c.name)) {
      list = list.filter((x) => x.name !== c.name);
      btn.classList.remove("on");
      btn.textContent = "☆お気に入り";
    } else {
      if (list.length >= 12) { btn.textContent = "上限12社"; setTimeout(() => (btn.textContent = "☆お気に入り"), 1200); return; }
      list.push({
        name: c.name,
        code: c.listing?.code ?? "",
        market: c.listing?.market ?? "",
        industry: data.meta.industry_id,
        industryName: data.meta.industry_name,
        rev: c.financials?.revenue_oku_jpy ?? null,
        mcap: c.financials?.market_cap_oku_jpy ?? null,
        emp: c.employees ?? null,
        salary: c.salary?.man_jpy ?? null,
      });
      btn.classList.add("on");
      btn.textContent = "★ お気に入り";
    }
    localStorage.setItem(CMP_KEY, JSON.stringify(list));
  });
  // メモ(志望動機)の開閉・保存・削除(委譲)
  panel.addEventListener("click", (ev) => {
    const openBtn = ev.target.closest(".note-add");
    if (openBtn) { ev.preventDefault(); ev.stopPropagation(); toggleNoteEditor(openBtn); return; }
    const saveBtn = ev.target.closest(".note-save");
    if (saveBtn) { ev.preventDefault(); ev.stopPropagation(); commitNote(saveBtn); return; }
    const delBtn = ev.target.closest(".note-del");
    if (delBtn) { ev.preventDefault(); ev.stopPropagation(); removeNote(delBtn); return; }
    const cancelBtn = ev.target.closest(".note-cancel");
    if (cancelBtn) { ev.preventDefault(); ev.stopPropagation(); cancelBtn.closest("li.company")?.querySelector(".note-editor")?.remove(); return; }
  });

  function toggleNoteEditor(btn) {
    const li = btn.closest("li.company");
    if (!li) return;
    const existing = li.querySelector(".note-editor");
    if (existing) { existing.remove(); return; }
    const name = btn.dataset.name;
    const cur = noteFor(name) ?? {};
    const ed = document.createElement("div");
    ed.className = "note-editor";
    ed.innerHTML = `
      <label class="note-field"><span>志望動機メモ</span>
        <textarea class="note-asp" rows="2" placeholder="なぜこの会社か。商流のどこに惹かれたか">${esc(cur.aspiration ?? "")}</textarea></label>
      <label class="note-field"><span>メモ</span>
        <textarea class="note-free" rows="2" placeholder="気になった点・調べたこと・選考メモなど">${esc(cur.note ?? "")}</textarea></label>
      <div class="note-actions">
        <button class="note-save" data-name="${esc(name)}">保存</button>
        <button class="note-cancel" type="button">キャンセル</button>
        ${(cur.note || cur.aspiration) ? `<button class="note-del" data-name="${esc(name)}" type="button">削除</button>` : ""}
        <span class="note-hint">非公開(自分だけ)。ログイン中は端末をまたいで自動保存されます</span>
      </div>`;
    li.appendChild(ed);
    ed.querySelector("textarea")?.focus();
  }

  function refreshNoteRow(li, name) {
    const btn = li.querySelector(".note-add");
    if (btn) { btn.classList.toggle("on", hasNote(name)); btn.textContent = hasNote(name) ? "メモ編集" : "＋メモ"; }
    const wrap = li.querySelector(".c-usernote-wrap");
    if (wrap) wrap.innerHTML = userNoteHTML(name);
  }

  function commitNote(btn) {
    const li = btn.closest("li.company");
    const name = btn.dataset.name;
    const ed = li.querySelector(".note-editor");
    const aspiration = ed.querySelector(".note-asp").value.trim();
    const note = ed.querySelector(".note-free").value.trim();
    const c = panelCompanies.get(name);
    saveNoteFor(name, {
      aspiration, note,
      industry: data.meta.industry_id,
      industryName: data.meta.industry_name,
      code: c?.listing?.code ?? "",
    });
    ed.remove();
    refreshNoteRow(li, name);
  }

  function removeNote(btn) {
    const li = btn.closest("li.company");
    const name = btn.dataset.name;
    saveNoteFor(name, null);
    li.querySelector(".note-editor")?.remove();
    refreshNoteRow(li, name);
  }
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
      : sortMode === "salary" ? c.salary?.man_jpy
      : c.employees;
    return [...comps].sort((a, b) => (metric(b) ?? -1) - (metric(a) ?? -1));
  }

  function companyLink(c) {
    if (c.url) return c.url;
    if (c.listing?.code) return `https://finance.yahoo.co.jp/quote/${c.listing.code}.T`;
    return null;
  }
  function companyLogoHTML(c) {
    if (c.url) {
      try {
        const host = new URL(c.url).hostname;
        return `<img class="c-logo" src="https://icons.duckduckgo.com/ip3/${host}.ico" alt=""
          onerror="this.outerHTML='<span class=&quot;c-logo fallback&quot;>${esc(c.name.slice(0, 1))}</span>'">`;
      } catch { /* URL不正はイニシャルへ */ }
    }
    return `<span class="c-logo fallback">${esc(c.name.slice(0, 1))}</span>`;
  }

  function companyRowHTML(c) {
    const fin = c.financials;
    const stat = (label, value, title) =>
      `<span class="stat"${title ? ` title="${esc(title)}"` : ""}><span class="sl">${label}</span>${value}</span>`;
    const stats = [];
    if (fin?.revenue_oku_jpy) stats.push(stat("売上", `約${fmtOku(fin.revenue_oku_jpy)}`, fin?.note));
    if (fin?.market_cap_oku_jpy)
      stats.push(stat("時価総額", `約${fmtOku(fin.market_cap_oku_jpy)}<span class="fin-asof">(${esc(fin?.as_of ?? "")}${/概算/.test(fin?.note ?? "") ? "・概算" : ""})</span>`, fin?.note));
    if (c.employees) stats.push(stat("従業員", `約${fmtEmp(c.employees)}`));
    if (c.salary?.man_jpy)
      stats.push(stat("平均年収",
        `${c.salary.man_jpy.toLocaleString("ja-JP")}万円${c.salary.avg_age ? `<span class="fin-asof">(平均${c.salary.avg_age}歳)</span>` : ""}`,
        `有価証券報告書記載の平均年間給与${c.salary.avg_age ? `・平均年齢${c.salary.avg_age}歳` : ""}(${c.salary.fy ?? ""})`));
    const statsLine = stats.length ? `<div class="c-stats">${stats.join("")}</div>` : "";
    const finNoteOnly = !stats.length && fin?.note ? `<div class="fin note-only">${esc(fin.note)}</div>` : "";

    const dealsLine = c.deals?.length
      ? `<details class="c-deals"><summary>提携・取引 ${c.deals.length}件</summary><ul>${c.deals.map((d) =>
          `<li>${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.label)}</a>` : esc(d.label)}${d.with ? `<span class="deal-with">(→${esc(d.with)})</span>` : ""}</li>`
        ).join("")}</ul></details>`
      : "";

    // 社名自体が公式サイトへのリンクになっているため、URL(ホスト名)は表示しない
    const footLine = c.hq ? `<div class="c-foot">${esc(c.hq)}</div>` : "";
    const planBadge =
      c.plan === "free" ? `<span class="badge plan-free">無料掲載</span>`
      : c.plan?.startsWith("paid") ? `<span class="badge plan-paid">掲載企業</span>` : "";
    const listing = c.listing?.market
      ? `<span class="c-listing">${esc(c.listing.market)}${c.listing.code ? ` <span class="ticker">${esc(c.listing.code)}</span>` : ""}</span>`
      : "";
    return `<li class="company">
      <div class="c-main">${companyLogoHTML(c)}${(() => {
        const href = companyLink(c);
        return href ? `<a href="${esc(href)}" target="_blank" rel="noopener"${c.url ? "" : ' title="Yahoo!ファイナンスの銘柄ページを開く"'}>${esc(c.name)}</a>` : esc(c.name);
      })()}<button class="cmp-add${cmpHas(c.name) ? " on" : ""}" data-name="${esc(c.name)}" title="お気に入りに追加/削除">${cmpHas(c.name) ? "★ お気に入り" : "☆お気に入り"}</button><button class="note-add${hasNote(c.name) ? " on" : ""}" data-name="${esc(c.name)}" title="この企業への非公開メモ・志望動機を残す">${hasNote(c.name) ? "メモ編集" : "＋メモ"}</button>${c.listing?.code ? `<a class="rv-link" href="#/reviews/${esc(c.listing.code)}" title="みんなのレビュー(選考体験・社員クチコミ)を見る・書く">レビュー</a>` : ""}${c.hiring ? '<span class="badge hiring">採用中</span>' : ""}${planBadge}${listing}</div>
      ${statsLine}
      ${finNoteOnly}
      ${dealsLine}
      ${footLine}
      ${c.note ? `<div class="c-meta c-note">${esc(c.note)}</div>` : ""}
      <div class="c-usernote-wrap">${userNoteHTML(c.name)}</div>
    </li>`;
  }

  // ユーザーが残したメモ/志望動機のプレビュー(あれば表示)
  function userNoteHTML(name) {
    const n = noteFor(name);
    if (!n || (!n.note && !n.aspiration)) return "";
    return `<div class="c-usernote">
      ${n.aspiration ? `<p><span class="un-label">志望メモ</span>${esc(n.aspiration)}</p>` : ""}
      ${n.note ? `<p><span class="un-label">メモ</span>${esc(n.note)}</p>` : ""}
    </div>`;
  }

  function companiesListHTML(n) {
    const comps = n.companies ?? [];
    comps.forEach((c) => panelCompanies.set(c.name, c));
    if (!comps.length) return "";
    const sortSel = `
      <div class="sort-row">
        <h3 style="border:none;margin:0;padding:0">プレイヤー企業(${comps.length})</h3>
        <select class="sort-select" title="並び順">
          <option value="default"${sortMode === "default" ? " selected" : ""}>掲載順</option>
          <option value="revenue"${sortMode === "revenue" ? " selected" : ""}>売上高順</option>
          <option value="mcap"${sortMode === "mcap" ? " selected" : ""}>時価総額順</option>
          <option value="emp"${sortMode === "emp" ? " selected" : ""}>従業員数順</option>
          <option value="salary"${sortMode === "salary" ? " selected" : ""}>平均年収順</option>
        </select>
      </div>
      <p class="sort-note">標準の掲載順は編集方針で固定(課金で変わりません)。財務値は決算短信等の実績値(各行に基準期を記載)。「概算」とある値のみ規模感の目安です。</p>
      ${comps.length > 20 ? `<input type="search" class="company-filter" placeholder="この中から絞り込む(社名・証券コード)" autocomplete="off">` : ""}`;
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
            ? `<a class="seg-portal" href="#/i/${esc(s.related_industry)}?from=${data.meta.industry_id}:${n.id}">地図へ潜る →</a>`
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
      ${e.amount_note ? `<span class="f-amount">金額感: ${esc(e.amount_note)}</span>` : ""}
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
      ${n.market_size ? `<p class="p-market">市場規模: <strong>約${n.market_size.oku_jpy >= 10000 ? (n.market_size.oku_jpy / 10000).toFixed(1) + "兆円" : Math.round(n.market_size.oku_jpy).toLocaleString("ja-JP") + "億円"}</strong><span class="ms-sub">(${esc(n.market_size.label)}・${esc(n.market_size.as_of)}) <a href="${esc(n.market_size.source.url)}" target="_blank" rel="noopener">出典: ${esc(n.market_size.source.publisher)}</a></span></p>` : ""}
      ${n.note ? `<p class="p-note">${esc(n.note)}</p>` : ""}
      ${n.related_industry ? `<a class="portal-link" href="#/i/${esc(n.related_industry)}?from=${data.meta.industry_id}:${n.id}">この業界の地図へ潜る →</a>` : ""}
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
      ${n.market_size ? `<p class="p-market">市場規模: <strong>約${n.market_size.oku_jpy >= 10000 ? (n.market_size.oku_jpy / 10000).toFixed(1) + "兆円" : Math.round(n.market_size.oku_jpy).toLocaleString("ja-JP") + "億円"}</strong><span class="ms-sub">(${esc(n.market_size.label)}・${esc(n.market_size.as_of)}) <a href="${esc(n.market_size.source.url)}" target="_blank" rel="noopener">出典: ${esc(n.market_size.source.publisher)}</a></span></p>` : ""}
      ${companiesListHTML(n) || (n.note ? `<p class="p-note">${esc(n.note)}</p>` : "")}
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
      ${e.amount_note ? `<p class="p-desc">金額感: ${esc(e.amount_note)}</p>` : ""}
      ${e.note ? `<p class="p-note">${esc(e.note)}</p>` : ""}
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
        ${edge.amount_note ? `<div class="t-amount">金額感: ${esc(edge.amount_note)}</div>` : ""}`;
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
    // ズームアウト時もフローラベルが読めるよう逆スケール(上限1.6倍)
    svg.style.setProperty("--lblk", Math.min(1.6, Math.max(1, 1 / view.k)).toFixed(3));
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

  // 絵文字テキスト等の上からのドラッグがネイティブD&D(コピーカーソル)や
  // テキスト選択に化けるのを防ぐ
  svg.addEventListener("dragstart", (ev) => ev.preventDefault());
  svg.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    ev.preventDefault();
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    // 注意: ここでsetPointerCaptureするとclickの行き先がsvgに付け替えられ、
    // ノード・ポータルのクリックが一切効かなくなる。捕捉はドラッグ開始後に行う。
    if (pointers.size === 1) {
      drag = { sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y, moved: false };
      svg.classList.add("dragging");
    } else if (pointers.size === 2) {
      drag = null;
      for (const id of pointers.keys()) {
        try { svg.setPointerCapture(id); } catch { /* 合成イベント等でIDが無効な場合 */ }
      }
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
      if (!drag.moved && Math.hypot(dx, dy) > 4) {
        drag.moved = true;
        // ドラッグと確定してから捕捉する(クリックのターゲットを壊さないため)
        try { svg.setPointerCapture(ev.pointerId); } catch { /* 合成イベント等 */ }
      }
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
    flyToPoint(p, targetK);
  }
  function flyToPoint(p, targetK) {
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
  // 色の凡例は上部のフィルタ帯(すべて/モノ・サービス/カネ…)に集約。ここは操作ヒントのみ。
  const legend = document.createElement("div");
  legend.className = "legend hint-only";
  legend.innerHTML = data.meta.map_style === "category"
    ? `<div class="hint">カオスマップ型(分類のみ・商流エッジなし) — ドラッグで移動 / ホイールでズーム</div>`
    : `<div class="hint">ドラッグで移動 / ホイールでズーム — ズームインで実名企業が現れる</div>`;
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

  // ---------- カネの旅(ガイドツアー) ----------
  let journeyBar = null;
  if (data.meta.journey?.steps?.length) {
    const J = data.meta.journey;
    const steps = J.steps.filter((s) => edgeEls.has(s.edge));
    const launch = document.createElement("button");
    launch.className = "journey-launch";
    launch.innerHTML = `${J.title} →`;
    launch.title = "カネの旅 — 1本ずつ金流を辿るガイドツアー";
    container.appendChild(launch);

    let idx = 0;
    const clearHighlight = () => {
      for (const { el } of edgeEls.values()) el.classList.remove("journey-hot");
      for (const el of nodeEls.values()) el.classList.remove("journey-node");
    };
    const endJourney = () => {
      clearHighlight();
      container.classList.remove("journeying");
      journeyBar?.remove();
      journeyBar = null;
      launch.style.display = "";
    };
    const FLOW_LABEL = { goods: "モノ・サービス", capex: "カネ(一時金)", opex: "カネ(継続払い)" };
    const showStep = (i) => {
      idx = i;
      clearHighlight();
      const st = steps[i];
      const { el, edge } = edgeEls.get(st.edge);
      el.classList.add("journey-hot");
      nodeEls.get(edge.from)?.classList.add("journey-node");
      nodeEls.get(edge.to)?.classList.add("journey-node");
      const A = pos[edge.from], B = pos[edge.to];
      flyToPoint({ x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }, 1.5);
      const fromRole = data.nodes.find((n) => n.id === edge.from)?.role ?? edge.from;
      const toRole = data.nodes.find((n) => n.id === edge.to)?.role ?? edge.to;
      journeyBar.innerHTML = `
        <div class="j-head"><span class="j-count">${i + 1} / ${steps.length}</span> ${J.title}</div>
        <div class="j-route"><span class="j-flow ${edge.flow_type}">${FLOW_LABEL[edge.flow_type]}</span> ${fromRole} → ${toRole}</div>
        <p class="j-say">${st.say}</p>
        <div class="j-nav">
          <button data-j="prev" ${i === 0 ? "disabled" : ""}>← 前へ</button>
          <button data-j="next">${i === steps.length - 1 ? "旅を終える" : "次へ →"}</button>
          <button data-j="end" class="j-close" title="終了">✕</button>
        </div>`;
    };
    launch.addEventListener("click", () => {
      launch.style.display = "none";
      container.classList.add("journeying");
      journeyBar = document.createElement("div");
      journeyBar.className = "journey-bar";
      journeyBar.addEventListener("click", (ev) => {
        const b = ev.target.closest("button[data-j]");
        if (!b) return;
        if (b.dataset.j === "prev") showStep(Math.max(0, idx - 1));
        else if (b.dataset.j === "next") idx === steps.length - 1 ? endJourney() : showStep(idx + 1);
        else endJourney();
      });
      container.appendChild(journeyBar);
      closePanel();
      showStep(0);
    });
  }

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

  function focusNode(nodeId, k = 1.35) {
    const el = nodeEls.get(nodeId);
    if (!el) return false;
    flyTo(nodeId, k);
    el.classList.add("from-linked");
    setTimeout(() => el.classList.remove("from-linked"), 6000);
    return true;
  }

  return {
    search,
    focusNode,
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
