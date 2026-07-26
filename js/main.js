// あきないマップ — エントリポイント(ハッシュルーティング + トップページ)
import { createMapView } from "./mapview.js?v=202607263100";
import { initAuth, isLoggedIn, authUser, signUp, signIn, signOut, resetPassword, syncNotes, sb } from "./auth.js?v=202607263100";

// メモが変わったら(ログイン中は)Supabaseへ同期。連打をまとめる。
let _syncTimer = null;
window.addEventListener("akinai:notes-changed", () => {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => { if (isLoggedIn()) syncNotes(); }, 1500);
});

// ---- 選考体験(公開UGC)API。テーブル未作成でもエラーを握りつぶす ----
async function listReviews(code) {
  try {
    const { data, error } = await sb.from("reviews")
      .select("*").eq("code", code).order("created_at", { ascending: false });
    if (error) return [];
    return data ?? [];
  } catch { return []; }
}
async function submitReview(payload) {
  const u = authUser();
  if (!u) return { ok: false, error: "ログインが必要です" };
  const { error } = await sb.from("reviews").insert({ ...payload, author_id: u.id, status: "pending" });
  return error ? { ok: false, error: error.message } : { ok: true };
}
async function reportReview(reviewId, reason) {
  const u = authUser();
  if (!u) return { ok: false, error: "ログインが必要です" };
  const { error } = await sb.from("review_reports").insert({ review_id: reviewId, reason, reporter_id: u.id });
  return error ? { ok: false, error: error.message } : { ok: true };
}
async function deleteReview(id) {
  const { error } = await sb.from("reviews").delete().eq("id", id);
  return { ok: !error, error: error?.message };
}

// ---- 運営管理(承認/却下/通報)。権限はRLSで強制。ここのチェックは表示用 ----
const ADMIN_EMAIL = "yuhei.n@fansojp.com";
const isAdmin = () => authUser()?.email === ADMIN_EMAIL;
async function adminListReviews(status, limit = 200) {
  const { data, error } = await sb.from("reviews").select("*")
    .eq("status", status).order("created_at", { ascending: false }).limit(limit);
  if (error) return { rows: [], error: error.message };
  return { rows: data ?? [] };
}
async function adminSetStatus(id, status) {
  const { error } = await sb.from("reviews").update({ status }).eq("id", id);
  return { ok: !error, error: error?.message };
}
async function adminDeleteReview(id) {
  const { error } = await sb.from("reviews").delete().eq("id", id);
  return { ok: !error, error: error?.message };
}
async function adminListReports() {
  const { data, error } = await sb.from("review_reports")
    .select("*, review:reviews(*)").order("created_at", { ascending: false }).limit(200);
  if (error) return { rows: [], error: error.message };
  return { rows: data ?? [] };
}
async function adminDeleteReport(id) {
  const { error } = await sb.from("review_reports").delete().eq("id", id);
  return { ok: !error, error: error?.message };
}

const app = document.getElementById("app");

// ---- テーマ(ライト/ダーク)。既定はOS設定に追従 ----
const THEME_KEY = "akinai_theme";
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const btn = document.querySelector(".theme-toggle");
  if (btn) btn.textContent = t === "dark" ? "☀️" : "🌙";
}
{
  const saved = localStorage.getItem(THEME_KEY);
  const initial = saved ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const btn = document.createElement("button");
  btn.className = "theme-toggle";
  btn.title = "ライト/ダーク切替";
  btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
  document.body.appendChild(btn);
  applyTheme(initial);
}

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
    return `<div class="coverage">
      <div class="cov-label">国内上場企業カバー率
        <strong>${c.percent}%</strong>(${c.covered.toLocaleString()} / ${c.total.toLocaleString()}社・JPX ${asOf}基準)</div>
      <div class="cov-bar"><div class="cov-fill" style="width:${Math.max(c.percent, 1.5)}%"></div></div>
      ${t5 ? `<div class="cov-label" style="margin-top:8px">TOPIX500(大型・中型株)
        <strong>${t5.percent}%</strong>(${t5.covered} / ${t5.total}社)</div>
      <div class="cov-bar"><div class="cov-fill" style="width:${Math.max(t5.percent, 1.5)}%"></div></div>` : ""}
    </div>`;
  } catch {
    return "";
  }
}


// ---- 無料メンバー登録(就活生向け)。ログイン状態はSupabaseセッションで判定 ----
// MEMBER_KEY はプロフィール(氏名・学歴等)の表示用キャッシュとして継続利用する。
const MEMBER_KEY = "akinai_member";
const isMember = () => isLoggedIn();

async function renderGate(id) {
  // 既にログイン済みなら登録画面は出さず、目的地(業界 or マイマップ)へ
  if (isMember()) { location.hash = id ? `#/i/${id}` : "#/my"; return; }
  const [idx, data] = await Promise.all([loadIndex(), id ? loadIndustry(id) : Promise.resolve(null)]);
  const opens = await Promise.all((idx.open_industries ?? []).map(loadIndustry));
  const allParents = (await Promise.all(idx.industries.map(loadIndustry)))
    .filter((d) => !d.meta.parent_industry);
  const indChip = (d) => `<label class="ind-chip"><input type="checkbox" name="industries" value="${d.meta.industry_id}"
    ${d.meta.industry_id === id ? "checked" : ""}><span>${d.meta.industry_name}</span></label>`;
  app.innerHTML = `
    ${globalNavHTML(true)}
    <div class="home"><div class="home-inner gate">
      <div class="hero">
        <img class="compass logo-emblem" src="assets/emblem.svg" alt="" width="72" height="72">
        <h1>${data ? `${data.meta.industry_name}の商流マップ` : "マイマップ"}</h1>
        <p class="sub">${data?.meta.tagline ?? "興味業界の保存とお気に入り企業リストが使えます"}</p>
      </div>
      <div class="gate-card">
        <h2>無料メンバー登録で、全業界のマップが見られます</h2>
        <p>お試し業界に加えて、お好きな1業界までは登録なしで見られます。ここから先は無料登録(1分)で — 全${idx.industries.length}業界の商流マップ、
        企業データ(売上・時価総額・平均年収)、「カネの旅」、そして<strong>マイマップ(興味業界の保存・☆お気に入り企業)</strong>がすべて使えます。</p>
        <form id="gate-form">
          <fieldset class="profile-sec">
            <legend>基本情報</legend>
            <label>お名前
              <input type="text" name="name" required placeholder="山田 太郎" autocomplete="name"></label>
            <label>メールアドレス
              <input type="email" name="email" required placeholder="you@example.com" autocomplete="email"></label>
            <label>パスワード <span class="opt">(8文字以上・ログインに使います)</span>
              <input type="password" name="password" required minlength="8" placeholder="8文字以上" autocomplete="new-password"></label>
          </fieldset>

          <fieldset class="profile-sec">
            <legend>学歴</legend>
            <label>学校名(在学中は現在の学校)
              <input type="text" name="school_name" required placeholder="○○大学" autocomplete="organization"></label>
            <label>学校区分
              <select name="school" required>
                <option value="">選択してください</option>
                <option>大学(学部)</option>
                <option>大学院(修士・博士)</option>
                <option>高等専門学校・短大・専門学校</option>
                <option>高等学校</option>
                <option>その他</option>
              </select></label>
            <label>学部・専攻 <span class="opt">(任意)</span>
              <select name="bunri">
                <option value="">選択しない</option>
                <optgroup label="文系">
                  <option>経済学部</option><option>経営・商学部</option><option>法学部</option>
                  <option>文学部</option><option>社会学部</option><option>教育学部</option>
                  <option>国際・外国語系</option><option>その他文系</option>
                </optgroup>
                <optgroup label="理系">
                  <option>理学部</option><option>工学部(機械・電気・情報等)</option>
                  <option>情報・データサイエンス系</option><option>農学部</option>
                  <option>薬学部</option><option>医・歯・看護系</option><option>その他理系</option>
                </optgroup>
                <option>その他</option>
              </select></label>
            <label>卒業(予定)年
              <select name="grad_year" required>
                <option value="">選択してください</option>
                <option>2026年</option><option>2027年</option><option>2028年</option>
                <option>2029年</option><option>2030年以降</option>
                <option>2025年以前(卒業済み)</option>
              </select></label>
          </fieldset>

          <fieldset class="profile-sec">
            <legend>職歴 <span class="opt">(就業経験がある方のみ・任意)</span></legend>
            <label>就業状況
              <select name="segment">
                <option value="student">学生(就業経験なし)</option>
                <option value="employed">社会人(在職中)</option>
                <option value="former">離職中・休職中</option>
              </select></label>
            <label>経験のある業界 <span class="opt">(任意)</span>
              <select name="exp_industry">
                <option value="">選択しない</option>
                ${allParents.map((d) => `<option>${d.meta.industry_name}</option>`).join("")}
                <option>その他</option>
              </select></label>
            <label>職種 <span class="opt">(任意)</span>
              <select name="job">
                <option value="">選択しない</option>
                <option>営業</option><option>企画・マーケティング</option>
                <option>ITエンジニア</option><option>エンジニア(機械・電気・化学等)</option>
                <option>研究開発</option><option>製造・技能・品質</option>
                <option>管理部門(経理・人事・法務等)</option><option>コンサルタント</option>
                <option>金融専門職</option><option>医療・福祉</option>
                <option>公務員</option><option>経営・役員</option><option>その他</option>
              </select></label>
            <label>経験年数 <span class="opt">(任意)</span>
              <select name="exp_years">
                <option value="">選択しない</option>
                <option>1年未満</option><option>1〜3年</option>
                <option>3〜5年</option><option>5〜10年</option><option>10年以上</option>
              </select></label>
          </fieldset>

          <fieldset class="ind-select">
            <legend>興味のある業界 <span class="opt">(最大3つ)</span></legend>
            <div class="ind-chips">${allParents.map(indChip).join("")}</div>
          </fieldset>

          <label class="scout-optin">
            <input type="checkbox" name="scout_ok" value="1">
            <span>将来、企業からのスカウトを受け取る <span class="opt">(任意)</span><br>
            <span class="scout-note">オンにすると、今後あなたのプロフィールが採用企業に公開されることがあります。オフのままでも登録・利用できます。設定はいつでも変更・退会できます。</span></span>
          </label>

          <button type="submit" id="gate-submit">無料で登録して全業界を見る</button>
          <p id="gate-msg" class="gate-msg" hidden></p>
          <p class="gate-switch">すでにアカウントをお持ちですか? <a href="#" id="to-login">ログイン</a></p>
          <p class="gate-note">登録情報はサービスの提供・改善、お知らせ、およびスカウトを希望した方の企業への紹介に使用します。
          <a href="#/privacy">プライバシーポリシー</a></p>
        </form>
        <div class="gate-open">
          <p>登録なしで見られる業界:</p>
          <div class="gate-chips">${opens
            .map((d) => `<a class="gate-chip" href="#/i/${d.meta.industry_id}">${d.meta.industry_name}</a>`)
            .join("")}</div>
        </div>
      </div>
      <div class="home-foot"><a href="#/">← マップトップへ戻る</a></div>
    </div></div>`;

  // 興味業界は最大3つまで
  const boxes = [...document.querySelectorAll('input[name="industries"]')];
  const limit = () => {
    const on = boxes.filter((b) => b.checked);
    boxes.forEach((b) => (b.disabled = !b.checked && on.length >= 3));
  };
  boxes.forEach((b) => b.addEventListener("change", limit));
  limit();

  const msg = document.getElementById("gate-msg");
  const showMsg = (text, kind = "err") => {
    msg.textContent = text; msg.hidden = false;
    msg.className = `gate-msg ${kind}`;
  };

  // 新規登録: Supabaseでアカウント作成 → プロフィールをlocalStorage+D1へ保存
  document.getElementById("gate-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const email = fd.get("email"), password = fd.get("password");
    const btn = document.getElementById("gate-submit");
    btn.disabled = true; showMsg("登録中…", "info");

    const res = await signUp(email, password);
    if (!res.ok) {
      btn.disabled = false;
      const m = /already registered|already been/i.test(res.error)
        ? "このメールアドレスは登録済みです。下の「ログイン」からお進みください。"
        : `登録できませんでした: ${res.error}`;
      showMsg(m); return;
    }
    // プロフィール(リード情報)を保存・送信
    const rec = {
      name: fd.get("name"), email,
      school_name: fd.get("school_name"), school: fd.get("school"),
      grad_year: fd.get("grad_year"), segment: fd.get("segment"),
      scout_ok: fd.get("scout_ok") ? 1 : 0,
      industries: fd.getAll("industries"), ts: new Date().toISOString(),
    };
    for (const k of ["bunri", "exp_industry", "job", "exp_years"]) {
      const v = fd.get(k); if (v) rec[k] = v;
    }
    localStorage.setItem(MEMBER_KEY, JSON.stringify(rec));
    const ep = window.AKINAI_CONFIG?.registrationEndpoint;
    if (ep) fetch(ep, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec) }).catch(() => {});

    if (res.needsConfirm) {
      showMsg(`確認メールを ${email} に送りました。メール内のリンクを開くと登録が完了し、全業界が見られます。`, "info");
    } else {
      // 確認不要設定なら即ログイン → 登録画面に留まらず目的地へ
      location.hash = id ? `#/i/${id}` : "#/my";
      route();
    }
  });

  // ログインへ切替
  document.getElementById("to-login").addEventListener("click", (ev) => {
    ev.preventDefault();
    renderLoginCard(id);
  });
  wireGlobalNav();
}

// ログイン画面(既存会員)。ゲートカードを差し替える。
function renderLoginCard(id) {
  const card = document.querySelector(".gate-card");
  card.innerHTML = `
    <h2>ログイン</h2>
    <p>登録済みのメールアドレスとパスワードでログインしてください。</p>
    <form id="login-form">
      <fieldset class="profile-sec">
        <label>メールアドレス
          <input type="email" name="email" required placeholder="you@example.com" autocomplete="email"></label>
        <label>パスワード
          <input type="password" name="password" required placeholder="パスワード" autocomplete="current-password"></label>
      </fieldset>
      <button type="submit" id="login-submit">ログイン</button>
      <p id="login-msg" class="gate-msg" hidden></p>
      <p class="gate-switch"><a href="#" id="to-signup">← 新規登録にもどる</a>
        ・ <a href="#" id="reset-pw">パスワードを忘れた</a></p>
    </form>`;
  const msg = document.getElementById("login-msg");
  const showMsg = (t, k = "err") => { msg.textContent = t; msg.hidden = false; msg.className = `gate-msg ${k}`; };

  document.getElementById("login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const btn = document.getElementById("login-submit");
    btn.disabled = true; showMsg("ログイン中…", "info");
    const res = await signIn(fd.get("email"), fd.get("password"));
    if (!res.ok) {
      btn.disabled = false;
      const m = /Invalid login|invalid/i.test(res.error) ? "メールアドレスまたはパスワードが違います。"
        : /not confirmed|confirm/i.test(res.error) ? "メール確認が未完了です。確認メールのリンクを開いてください。"
        : `ログインできませんでした: ${res.error}`;
      showMsg(m); return;
    }
    location.hash = id ? `#/i/${id}` : "#/my";
    route();
  });
  document.getElementById("to-signup").addEventListener("click", (ev) => { ev.preventDefault(); renderGate(id); });
  document.getElementById("reset-pw").addEventListener("click", async (ev) => {
    ev.preventDefault();
    const email = document.querySelector('#login-form input[name="email"]').value.trim();
    if (!email) { showMsg("先にメールアドレスを入力してください。"); return; }
    const { error } = await resetPassword(email);
    showMsg(error ? `送信できませんでした: ${error}` : `パスワード再設定メールを ${email} に送りました。`, error ? "err" : "info");
  });
}


async function renderMy() {
  // マイマップ(お気に入り・商流キャリア地図)はログイン前でも見られる=single-player価値。
  // 未ログイン時は端末内保存のみで、ログインを促すバナーを出す。
  const loggedIn = isMember();
  const member = JSON.parse(localStorage.getItem(MEMBER_KEY) ?? "null")
    ?? { email: authUser()?.email ?? "", industries: [] };
  const idx = await loadIndex();
  const mine = await Promise.all((member.industries ?? []).map((i) => loadIndustry(i).catch(() => null)));
  const cmp = JSON.parse(localStorage.getItem("akinai_compare") ?? "[]");
  const oku = (v) => (v == null ? "—" : v >= 10000 ? `${(v / 10000).toFixed(1)}兆円` : `${Math.round(v).toLocaleString("ja-JP")}億円`);

  // 商流キャリア地図: 企業ごとの志望メモ/メモを業界別に集約
  const notes = JSON.parse(localStorage.getItem("akinai_notes") ?? "{}");
  const noteEntries = Object.entries(notes)
    .filter(([, n]) => n && (n.note || n.aspiration))
    .map(([name, n]) => ({ name, ...n }));
  const byIndustry = {};
  for (const e of noteEntries) (byIndustry[e.industry || "other"] ??= []).push(e);
  const careerMapHTML = `
    <section class="about-sec careermap">
      <h2>自分の商流キャリア地図（${noteEntries.length}社）</h2>
      ${noteEntries.length ? `
      <p class="careermap-lead"><strong>これは非公開のメモです（自分だけが見られます）。</strong>商流のどこに惹かれたか、なぜその会社か——あなたの言葉で残した志望メモは、ES・面接であなただけの武器になります。</p>
      ${Object.entries(byIndustry).map(([iid, arr]) => `
        <div class="cm-group">
          <h3 class="cm-ind">${esc(arr[0].industryName || iid)}<a class="cm-open" href="#/i/${esc(iid)}">マップを開く →</a></h3>
          ${arr.map((e) => `
            <div class="cm-card">
              <div class="cm-card-h"><strong>${esc(e.name)}</strong>${e.code ? `<span class="cmp-sub"> ${esc(e.code)}</span>` : ""}
                <button class="cm-del" data-name="${esc(e.name)}">削除</button></div>
              ${e.aspiration ? `<p class="cm-line"><span class="un-label">志望メモ</span>${esc(e.aspiration)}</p>` : ""}
              ${e.note ? `<p class="cm-line"><span class="un-label">メモ</span>${esc(e.note)}</p>` : ""}
            </div>`).join("")}
        </div>`).join("")}
      <button id="cm-copy" class="cmp-copy">志望メモをまとめてコピー（ES下書き用）</button>
      ` : `<p>まだありません。各業界マップの企業一覧にある「＋メモ」から、気になる企業に志望動機やメモを残せます。「なぜこの会社か」を商流の言葉で書き溜めると、そのままES・面接の材料になります。</p>`}
    </section>`;
  const row = (c) => `<tr>
    <td><strong>${c.name}</strong><br><span class="cmp-sub">${c.code || ""} ${c.market || ""}</span></td>
    <td><a href="#/i/${c.industry}">${c.industryName}</a></td>
    <td>${oku(c.rev)}</td><td>${oku(c.mcap)}</td>
    <td>${c.emp == null ? "—" : c.emp >= 10000 ? (c.emp / 10000).toFixed(1) + "万人" : c.emp.toLocaleString("ja-JP") + "人"}</td>
    <td>${c.salary == null ? "—" : c.salary.toLocaleString("ja-JP") + "万円"}</td>
    <td><button class="cmp-del" data-name="${c.name}">削除</button></td></tr>`;
  app.innerHTML = `
    ${globalNavHTML(true)}
    <div class="home"><div class="home-inner mypage">
      <div class="hero">
        <img class="compass logo-emblem" src="assets/emblem.svg" alt="" width="72" height="72">
        <h1>マイマップ</h1>
        <p class="sub">${member.email ? `${esc(member.email)} さんの業界研究ノート` : "あなたの業界研究ノート"}</p>
      </div>
      ${loggedIn ? "" : `<div class="my-login-cta">
        <span>いまはこの端末だけに保存されています。<strong>ログインすると、メモ・お気に入りが端末をまたいで残り</strong>、企業からのスカウトも受け取れます。</span>
        <a href="#/register" class="my-login-btn">ログイン / 無料登録</a>
      </div>`}
      ${careerMapHTML}
      <section class="about-sec">
        <h2>興味のある業界</h2>
        <div class="gate-chips">${mine.filter(Boolean)
          .map((d) => `<a class="gate-chip" href="#/i/${d.meta.industry_id}">${d.meta.industry_name}</a>`)
          .join("") || "<p>未設定です。</p>"}</div>
      </section>
      <section class="about-sec">
        <h2>☆お気に入り企業(${cmp.length}/12)</h2>
        ${cmp.length ? `
        <div class="cmp-wrap"><table class="cmp-table">
          <thead><tr><th>企業</th><th>業界</th><th>売上</th><th>時価総額</th><th>従業員</th><th>平均年収</th><th></th></tr></thead>
          <tbody>${cmp.map(row).join("")}</tbody>
        </table></div>
        <button id="cmp-copy" class="cmp-copy">表をコピー(ES・メモ用)</button>`
        : `<p>まだ空です。各業界マップの企業一覧にある「☆お気に入り」ボタンで、気になる企業を追加できます(最大12社)。
           同業他社を並べて売上・年収を見比べたり、コピーしてESや面接メモに使えます。</p>`}
      </section>
      <div class="home-foot"><a href="#/">← マップトップへ戻る</a></div>
    </div></div>`;
  app.querySelectorAll(".cmp-del").forEach((b) =>
    b.addEventListener("click", () => {
      const list = JSON.parse(localStorage.getItem("akinai_compare") ?? "[]").filter((x) => x.name !== b.dataset.name);
      localStorage.setItem("akinai_compare", JSON.stringify(list));
      renderMy();
    }));
  // 商流キャリア地図: メモ削除・まとめコピー
  app.querySelectorAll(".cm-del").forEach((b) =>
    b.addEventListener("click", () => {
      const name = b.dataset.name;
      const all = JSON.parse(localStorage.getItem("akinai_notes") ?? "{}");
      delete all[name];
      localStorage.setItem("akinai_notes", JSON.stringify(all));
      const del = JSON.parse(localStorage.getItem("akinai_notes_deleted") ?? "{}");
      del[name] = new Date().toISOString();
      localStorage.setItem("akinai_notes_deleted", JSON.stringify(del));
      window.dispatchEvent(new CustomEvent("akinai:notes-changed")); // ログイン中はリモートも削除
      renderMy();
    }));
  document.getElementById("cm-copy")?.addEventListener("click", () => {
    const text = noteEntries.map((e) => {
      const parts = [`■ ${e.name}（${e.industryName || ""}）`];
      if (e.aspiration) parts.push(`【志望動機】${e.aspiration}`);
      if (e.note) parts.push(`【メモ】${e.note}`);
      return parts.join("\n");
    }).join("\n\n");
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById("cm-copy");
      btn.textContent = "✓ コピーしました";
      setTimeout(() => (btn.textContent = "志望メモをまとめてコピー（ES下書き用）"), 1500);
    });
  });
  document.getElementById("cmp-copy")?.addEventListener("click", () => {
    const head = ["企業", "業界", "売上", "時価総額", "従業員", "平均年収"].join("\t");
    const lines = cmp.map((c) => [c.name, c.industryName, oku(c.rev), oku(c.mcap), c.emp ?? "", c.salary ? c.salary + "万円" : ""].join("\t"));
    navigator.clipboard.writeText([head, ...lines].join("\n")).then(() => {
      const btn = document.getElementById("cmp-copy");
      btn.textContent = "✓ コピーしました";
      setTimeout(() => (btn.textContent = "表をコピー(ES・メモ用)"), 1500);
    });
  });
  wireGlobalNav();
}


// ---- 全業界横断の企業ランキング(求職者向け) ----
let rankCache = null;
async function loadAllCompanies() {
  if (rankCache) return rankCache;
  const { industries } = await loadIndex();
  const datas = await Promise.all(industries.map(loadIndustry));
  // JPXの33業種→ホームマップ対応を「正」として代表業界を決める
  const [jpx, sectorMap] = await Promise.all([
    fetchJSON("data/reference/jpx_listed.json").catch(() => null),
    fetchJSON("data/reference/sector-map.json").catch(() => null),
  ]);
  const codeSector = new Map((jpx?.companies ?? []).map((x) => [x.code, x.sector33]));
  const homeMaps = (code) => sectorMap?.sectors?.[codeSector.get(code)]?.maps ?? [];
  const byKey = new Map();
  for (const d of datas) {
    for (const n of d.nodes ?? []) {
      if (n.unsorted) continue;
      for (const c of n.companies ?? []) {
        const key = c.listing?.code || "n:" + c.name;
        const rec = {
          name: c.name, code: c.listing?.code ?? "", market: c.listing?.market ?? "",
          industry: d.meta.industry_id, industryName: d.meta.industry_name,
          url: c.url ?? null,
          rev: c.financials?.revenue_oku_jpy ?? null, mcap: c.financials?.market_cap_oku_jpy ?? null,
          emp: c.employees ?? null, salary: c.salary?.man_jpy ?? null, avg_age: c.salary?.avg_age ?? null, hiring: !!c.hiring,
          foreign: /NASDAQ|NYSE|ユーロネクスト|台湾|海外/.test(c.listing?.market ?? ""),
        };
        const prev = byKey.get(key);
        // 代表レコードの選定: JPX業種のホームマップを最優先し、素の社名・情報の濃さで補強
        const score = (r) => {
          const idx = r.code ? homeMaps(r.code).indexOf(r.industry) : -1;
          return (idx >= 0 ? 100 - idx * 10 : 0)
            + (/[((]/.test(r.name) ? 0 : 5)
            + (r.salary ? 2 : 0) + (r.rev ? 1 : 0)
            + (/非上場/.test(r.market) ? -3 : 0);
        };
        if (!prev || score(rec) > score(prev)) byKey.set(key, rec);
      }
    }
  }
  rankCache = [...byKey.values()];
  return rankCache;
}

async function renderRanking() {
  const all = await loadAllCompanies();
  const { industries } = await loadIndex();
  const indNames = {};
  for (const iid of industries) indNames[iid] = (await loadIndustry(iid)).meta.industry_name;
  const member = isMember();

  const state = { metric: "salary", industry: "", q: "", scope: "domestic" };
  const oku = (v) => (v == null ? "—" : v >= 10000 ? `${(v / 10000).toFixed(1)}兆円` : `${Math.round(v).toLocaleString("ja-JP")}億円`);
  const logo = (c) => {
    if (c.url) {
      try {
        const host = new URL(c.url).hostname;
        return `<img class="c-logo" src="https://icons.duckduckgo.com/ip3/${host}.ico" alt=""
          onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'c-logo fallback',textContent:'${(c.name ?? "?").slice(0, 1)}'}))">`;
      } catch { /* イニシャルへ */ }
    }
    return `<span class="c-logo fallback">${(c.name ?? "?").slice(0, 1)}</span>`;
  };
  const METRIC_LABEL = { salary: "平均年収", rev: "売上高", mcap: "時価総額", emp: "従業員数" };

  const render = () => {
    let list = all.filter((c) => c[state.metric] != null);
    if (state.scope === "domestic") list = list.filter((c) => !c.foreign);
    if (state.industry) list = list.filter((c) => c.industry === state.industry);
    if (state.q) {
      const q = state.q.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.code.includes(q));
    }
    list.sort((a, b) => (b[state.metric] ?? -1) - (a[state.metric] ?? -1));
    const total = list.length;
    const limit = member ? 200 : 10;
    list = list.slice(0, limit);
    const cmp = JSON.parse(localStorage.getItem("akinai_compare") ?? "[]");
    const rows = list.map((c, i) => `<tr>
      <td class="rank-no">${i + 1}</td>
      <td>${logo(c)}<strong>${c.name}</strong>${c.code ? `<span class="cmp-sub"> ${c.code}</span>` : ""}
        <button class="cmp-add${cmp.some((x) => x.name === c.name) ? " on" : ""}" data-name="${c.name}" title="お気に入りに追加/削除">${cmp.some((x) => x.name === c.name) ? "★" : "☆"}</button></td>
      <td><a href="#/i/${c.industry}">${c.industryName}</a></td>
      <td class="rank-val">${state.metric === "salary" ? (c.salary?.toLocaleString("ja-JP") ?? "—") + "万円" + (c.avg_age ? `<span class="rank-age">平均${c.avg_age}歳</span>` : "")
        : state.metric === "emp" ? (c.emp >= 10000 ? (c.emp / 10000).toFixed(1) + "万人" : c.emp?.toLocaleString("ja-JP") + "人")
        : oku(c[state.metric])}</td>
      <td class="rank-sub">${state.metric !== "salary" && c.salary ? c.salary.toLocaleString("ja-JP") + "万円" : state.metric !== "rev" ? oku(c.rev) : oku(c.mcap)}</td>
    </tr>`).join("");
    document.getElementById("rank-body").innerHTML = `
      <div class="cmp-wrap"><table class="cmp-table rank-table">
        <thead><tr><th>#</th><th>企業</th><th>業界</th><th>${METRIC_LABEL[state.metric]}</th><th>${state.metric === "salary" ? "売上" : state.metric === "rev" ? "時価総額" : "平均年収"}</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5">該当する企業がありません</td></tr>'}</tbody>
      </table></div>
      <p class="rank-note">${METRIC_LABEL[state.metric]}のデータがある ${total.toLocaleString("ja-JP")}社中 ${Math.min(limit, total)}社を表示。
      平均年収は有価証券報告書記載の平均年間給与。</p>
      ${!member && total > 10 ? `<div class="rank-cta"><a href="#/register">無料登録して全${total.toLocaleString("ja-JP")}社のランキングを見る →</a></div>` : ""}`;
    document.querySelectorAll("#rank-body .cmp-add").forEach((btn) =>
      btn.addEventListener("click", () => {
        const c = all.find((x) => x.name === btn.dataset.name);
        let lst = JSON.parse(localStorage.getItem("akinai_compare") ?? "[]");
        if (lst.some((x) => x.name === c.name)) lst = lst.filter((x) => x.name !== c.name);
        else if (lst.length < 12) lst.push({ name: c.name, code: c.code, market: c.market, industry: c.industry, industryName: c.industryName, rev: c.rev, mcap: c.mcap, emp: c.emp, salary: c.salary });
        localStorage.setItem("akinai_compare", JSON.stringify(lst));
        render();
      }));
  };

  app.innerHTML = `
    ${globalNavHTML(true)}
    <div class="home"><div class="home-inner ranking">
      <div class="hero">
        <img class="compass logo-emblem" src="assets/emblem.svg" alt="" width="72" height="72">
        <h1>企業ランキング</h1>
        <p class="sub">全${industries.length}業界・上場3,700社超を横断して並び替え。就職・転職先の比較に。</p>
      </div>
      <div class="rank-controls">
        <select id="rank-metric">
          <option value="salary">平均年収が高い順</option>
          <option value="rev">売上高が大きい順</option>
          <option value="mcap">時価総額が大きい順</option>
          <option value="emp">従業員数が多い順</option>
        </select>
        <select id="rank-scope">
          <option value="domestic">国内企業のみ</option>
          <option value="all">海外企業を含む</option>
        </select>
        <select id="rank-industry">
          <option value="">すべての業界</option>
          ${industries.map((i) => `<option value="${i}">${indNames[i]}</option>`).join("")}
        </select>
        <input id="rank-q" type="search" placeholder="社名・証券コードで絞り込む" autocomplete="off">
      </div>
      <div id="rank-body"></div>
      <div class="home-foot"><a href="#/my">マイマップ(☆お気に入り)</a> ・ <a href="#/">トップへ戻る</a></div>
    </div></div>`;
  document.getElementById("rank-metric").addEventListener("change", (e) => { state.metric = e.target.value; render(); });
  document.getElementById("rank-scope").addEventListener("change", (e) => { state.scope = e.target.value; render(); });
  document.getElementById("rank-industry").addEventListener("change", (e) => { state.industry = e.target.value; render(); });
  document.getElementById("rank-q").addEventListener("input", (e) => { state.q = e.target.value.trim(); render(); });
  render();
  wireGlobalNav();
}

function renderPrivacy() {
  app.innerHTML = `
    ${globalNavHTML(true)}
    <div class="home"><div class="home-inner about">
      <div class="hero">
        <img class="compass logo-emblem" src="assets/emblem.svg" alt="" width="72" height="72">
        <h1>プライバシーポリシー</h1>
      </div>
      <section class="about-sec">
        <h2>取得する情報</h2>
        <p>無料メンバー登録では次の情報を取得します: 氏名、メールアドレス、学歴(学校名・学校区分・専攻系統・卒業予定年)、
        職歴(就業状況・経験業界・職種・経験年数。就業経験がある方のみ・任意)、興味のある業界、スカウト受信の希望有無。
        住所・電話番号・年収は取得しません。</p>
      </section>
      <section class="about-sec">
        <h2>利用目的</h2>
        <p>(1) サービスの提供・改善、(2) 新しい業界マップや機能のお知らせ、
        (3) 業界別の閲覧動向・登録者属性の統計的な集計、
        (4) <strong>スカウトを希望された方について、プロフィール(氏名・学校・興味業界等)を採用企業に開示し、
        企業からのオファーを仲介すること</strong>。</p>
      </section>
      <section class="about-sec">
        <h2>スカウトと企業への開示</h2>
        <p>スカウト受信を希望(チェック)された方のプロフィールは、あきないマップの掲載企業がスカウト目的で閲覧できます。
        希望されない方の情報が企業に個別開示されることはありません。スカウトの希望は
        <a href="mailto:yuhei.n@fansojp.com?subject=%E3%82%B9%E3%82%AB%E3%82%A6%E3%83%88%E8%A8%AD%E5%AE%9A%E5%A4%89%E6%9B%B4">メール</a>でいつでも変更・停止できます。</p>
      </section>
      <section class="about-sec">
        <h2>保管と削除</h2>
        <p>登録情報の削除をご希望の場合は
        <a href="mailto:yuhei.n@fansojp.com?subject=%E7%99%BB%E9%8C%B2%E5%89%8A%E9%99%A4">yuhei.n@fansojp.com</a>
        までご連絡ください。すみやかに削除します。</p>
      </section>
      <section class="about-sec">
        <h2>お問い合わせ・運営者</h2>
        <p>本ポリシーに関するお問い合わせ: 株式会社Fanaso(<a href="mailto:yuhei.n@fansojp.com">yuhei.n@fansojp.com</a>)<br>
        <a href="#/operator">運営者情報</a> ・ <a href="#/terms">利用規約</a><br>
        制定日: 2026年7月24日</p>
      </section>
      <div class="home-foot"><a href="#/">← マップトップへ戻る</a></div>
    </div></div>`;
  wireGlobalNav();
}

function renderOperator() {
  app.innerHTML = `
    ${globalNavHTML(true)}
    <div class="home"><div class="home-inner about">
      <div class="hero">
        <img class="compass logo-emblem" src="assets/emblem.svg" alt="" width="72" height="72">
        <h1>運営者情報</h1>
      </div>
      <section class="about-sec">
        <table class="operator-table">
          <tr><th>サービス名</th><td>あきないマップ</td></tr>
          <tr><th>運営者</th><td>株式会社Fanaso</td></tr>
          <tr><th>代表者</th><td>中西 悠平</td></tr>
          <tr><th>連絡先</th><td><a href="mailto:yuhei.n@fansojp.com">yuhei.n@fansojp.com</a><br>
            ※ 所在地・電話番号は、取引を検討される企業のご請求に応じて遅滞なく開示します。</td></tr>
          <tr><th>サービス内容</th><td>業界別の商流(モノ・カネの流れ)の可視化、企業情報の提供、
            採用企業向けの求人掲載・スカウト仲介</td></tr>
          <tr><th>料金</th><td>閲覧者(学生・求職者等)は無料。企業の採用枠掲載は月額5万円〜(企業規模により変動)。
            詳細はお問い合わせください。</td></tr>
        </table>
      </section>
      <div class="home-foot"><a href="#/about">あきないマップについて</a> ・ <a href="#/">トップへ戻る</a></div>
    </div></div>`;
  wireGlobalNav();
}

function renderTerms() {
  const sec = (h, b) => `<section class="about-sec"><h2>${h}</h2>${b}</section>`;
  app.innerHTML = `
    ${globalNavHTML(true)}
    <div class="home"><div class="home-inner about">
      <div class="hero">
        <img class="compass logo-emblem" src="assets/emblem.svg" alt="" width="72" height="72">
        <h1>利用規約</h1>
      </div>
      <p class="terms-lead">この利用規約(以下「本規約」)は、株式会社Fanaso(以下「当社」)が提供するサービス「あきないマップ」(以下「本サービス」)の利用条件を定めるものです。利用者は本規約に同意のうえ本サービスを利用するものとします。</p>
      ${sec("第1条(適用)", "<p>本規約は、本サービスの提供および利用に関する当社と利用者との一切の関係に適用されます。</p>")}
      ${sec("第2条(会員登録)", "<p>利用者は、当社の定める方法により正確な情報を登録して会員登録を行うものとします。登録情報に虚偽があった場合、当社は登録の取消しまたは利用停止を行うことができます。</p>")}
      ${sec("第3条(掲載情報)", "<p>本サービスが掲載する企業情報・市場規模・商流図等は、官公庁統計・企業のIR・プレスリリース等の公開情報にもとづき作成した参考情報であり、正確性・完全性・最新性を保証するものではありません。投資判断・就職や取引の判断は利用者ご自身の責任で行ってください。</p>")}
      ${sec("第4条(スカウト・企業への情報開示)", "<p>スカウトの受信を希望(オプトイン)した会員のプロフィール情報は、本サービスに登録した採用企業が採用目的で閲覧できます。会員はいつでもスカウト希望の停止・退会を申し出ることができます。企業は取得した情報を採用選考以外の目的に利用してはなりません。</p>")}
      ${sec("第5条(禁止事項)", "<p>利用者は、法令違反、虚偽情報の登録、本サービスの運営妨害、他者の権利侵害、データの無断転載・スクレイピング等を行ってはなりません。</p>")}
      ${sec("第6条(知的財産権)", "<p>本サービスに関する著作権・その他の知的財産権は当社または正当な権利者に帰属します。掲載データの無断複製・再配布を禁じます。</p>")}
      ${sec("第7条(免責)", "<p>当社は、本サービスの中断・停止・情報の誤り等により利用者に生じた損害について、当社の故意または重過失による場合を除き、責任を負いません。</p>")}
      ${sec("第8条(規約の変更)", "<p>当社は、必要と判断した場合、利用者への事前告知のうえ本規約を変更できます。変更後の規約は本サービス上に掲示した時点から効力を生じます。</p>")}
      ${sec("第9条(準拠法・裁判管轄)", "<p>本規約は日本法に準拠し、本サービスに関して紛争が生じた場合は、当社の本店所在地を管轄する裁判所を第一審の専属的合意管轄裁判所とします。</p>")}
      ${sec("お問い合わせ", "<p>株式会社Fanaso(<a href='mailto:yuhei.n@fansojp.com'>yuhei.n@fansojp.com</a>)<br>制定日: 2026年7月25日</p>")}
      <div class="home-foot"><a href="#/operator">運営者情報</a> ・ <a href="#/privacy">プライバシーポリシー</a> ・ <a href="#/">トップへ戻る</a></div>
    </div></div>`;
  wireGlobalNav();
}

function centerIcon(data) {
  const center = data.nodes.find((n) => n.map?.ring === 0) ?? data.nodes[0];
  const layer = data.layers.find((l) => l.id === center.layer);
  return center.icon ?? layer?.icon ?? "🗺️";
}

// 全画面共通のグローバルナビ(トップ・索引・ランキング・マイマップ+企業検索+シェア)
function globalNavHTML(withBrand = false) {
  return `
    <header class="gnav">
      ${withBrand ? `<a class="gnav-brand" href="#/"><img src="assets/emblem.svg" alt="" width="26" height="26"><span>あきないマップ</span></a>` : `<a class="gnav-brand" href="#/">← トップ</a>`}
      <nav class="gnav-links">
        <a href="#/review">レビューを書く</a>
        <a href="#/rank">ランキング</a>
        <a href="#/my">マイマップ</a>
        ${isAdmin() ? `<a href="#/admin">運営</a>` : ""}
      </nav>
      <input id="gnav-search" type="search" list="gnav-list" placeholder="企業名・証券コードで検索" autocomplete="off">
      <datalist id="gnav-list"></datalist>
      <button id="gnav-share" class="gnav-share" title="このサイトを共有">シェア</button>
      ${isLoggedIn()
        ? `<button id="gnav-logout" class="gnav-share" title="ログアウト">ログアウト</button>`
        : `<a href="#/register" class="gnav-share gnav-login">ログイン</a>`}
    </header>`;
}

// グローバルナビの企業検索・シェアを有効化(描画後に呼ぶ)
async function wireGlobalNav() {
  const logout = document.getElementById("gnav-logout");
  if (logout) logout.addEventListener("click", async () => {
    logout.disabled = true; logout.textContent = "…";
    await signOut();
    location.hash = "#/";
    route();
  });
  const share = document.getElementById("gnav-share");
  if (share) share.addEventListener("click", async () => {
    const url = "https://akinaimap.com/";
    const data = { title: "あきないマップ — 日本の商流が見える地図", url };
    if (navigator.share) { try { await navigator.share(data); } catch { /* キャンセル */ } }
    else { await navigator.clipboard.writeText(url); share.textContent = "✓ コピー"; setTimeout(() => (share.textContent = "シェア"), 1500); }
  });
  const input = document.getElementById("gnav-search");
  if (!input) return;
  // 全企業(コード→業界)索引を用意
  const cov = await fetchJSON("data/reference/coverage.json").catch(() => null);
  const jpx = await fetchJSON("data/reference/jpx_listed.json").catch(() => null);
  const coveredMap = new Map((cov?.covered_list ?? []).map((c) => [c.code, c.industries?.[0]]));
  const dl = document.getElementById("gnav-list");
  const nameByCode = new Map();
  for (const co of jpx?.companies ?? []) {
    if (!coveredMap.has(co.code)) continue;
    nameByCode.set(co.name, co.code);
    const opt = document.createElement("option");
    opt.value = co.name;
    dl.appendChild(opt);
  }
  const go = () => {
    const q = input.value.trim();
    if (!q) return;
    let code = nameByCode.get(q) ?? (/^\d{4}[A-Z0-9]?$/.test(q) ? q : null);
    if (!code) { const hit = [...nameByCode].find(([n]) => n.includes(q)); code = hit?.[1]; }
    const ind = code ? coveredMap.get(code) : null;
    if (ind) location.hash = `#/i/${ind}`;
    else location.hash = "#/rank";
  };
  input.addEventListener("change", go);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
}

async function renderHome() {
  const { industries, planned = [], open_industries = [] } = await loadIndex();
  const openSet = new Set(open_industries);
  const memberNow = isMember();
  const datas = await Promise.all(industries.map(loadIndustry));
  const parents = datas.filter((d) => !d.meta.parent_industry);
  const childrenOf = (pid) => datas.filter((d) => d.meta.parent_industry === pid);
  const card = (d) => {
    const children = childrenOf(d.meta.industry_id);
    return `
      <a class="card" href="#/i/${d.meta.industry_id}">
        <div class="card-photo" style="background-image:url('assets/photo/${d.meta.industry_id}.jpg')"></div>
        <div class="c-icon">${d.meta.map_style === "category" ? '<span class="style-tag">カオスマップ</span>' : ""}</div>
        <h2>${d.meta.industry_name}</h2>
        <p class="tagline">${d.meta.tagline ?? ""}</p>
        ${d.meta.journey ? `<div class="journey-tag">カネの旅: ${d.meta.journey.title}</div>` : ""}
        ${openSet.has(d.meta.industry_id) ? '<div class="access-tag open">登録なしで閲覧OK</div>' : (memberNow ? "" : '<div class="access-tag">無料登録で閲覧</div>')}
        ${children.length
          ? `<div class="child-links">${children
              .map((c) => `<span class="child-chip" data-href="#/i/${c.meta.industry_id}">↳ ${c.meta.industry_name}</span>`)
              .join("")}</div>`
          : ""}
        <span class="go">→</span>
      </a>`;
  };
  app.innerHTML = `
    ${globalNavHTML(true)}
    <div class="home"><div class="home-inner">
      <div class="hero">
        <img class="compass logo-emblem" src="assets/emblem.svg" alt="" width="84" height="84">
        <h1>あきないマップ</h1>
        <p class="sub">業界のカネとモノの流れを、冒険する地図に。<br>
        誰が誰に、何を届けて、いくら払うのか — ズームして確かめよう。<br>
        <span class="hero-uses">就活・転職の業界研究に。個人投資家の銘柄探しに。</span></p>
      </div>
      <div class="cards">
        ${parents.map(card).join("")}
      </div>
      ${await coverageHTML()}
      ${planned.length
        ? `<div class="planned">
            <h3>準備中の業界(時価総額の大きい業種から順次追加 → 最終的に全上場企業をカバー)</h3>
            <div class="planned-chips">${planned
              .map((p) => `<span class="planned-chip" title="${p.note ?? ""}">${p.name}</span>`)
              .join("")}</div>
          </div>`
        : ""}
      <div class="home-foot">
        出典は官公庁統計・IR・プレスリリース等の一次情報のみを使用しています。<br>
        <a href="#/rank">企業ランキング</a> ・ <a href="#/my">マイマップ</a> ・ <a href="#/about">あきないマップについて</a><br>
        <a href="#/privacy">プライバシーポリシー</a> ・ <a href="#/terms">利用規約</a> ・ <a href="#/operator">運営者情報</a><br>
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
  wireGlobalNav();
}


function renderAbout() {
  app.innerHTML = `
    ${globalNavHTML(true)}
    <div class="home"><div class="home-inner about">
      <div class="hero">
        <img class="compass logo-emblem" src="assets/emblem.svg" alt="" width="84" height="84">
        <h1>あきないマップについて</h1>
      </div>
      <section class="about-sec">
        <h2>閲覧は無料です</h2>
        <p>あきないマップの閲覧は無料です。データセンター・コンビニ・自動車の3業界は登録なしでそのまま、
        全業界は無料のメンバー登録(メールアドレスのみ・30秒)でご覧いただけます。
        閲覧を有料化する予定はありません。</p>
      </section>
      <section class="about-sec">
        <h2>地図の中立性</h2>
        <p>マップ上のプレイヤーの位置・掲載順は編集方針にもとづいて決めており、
        広告や掲載プランによって変わることはありません。
        有料プランで変わるのは「情報量と機能」だけです(詳細プロフィール・問い合わせ受信・採用バッジなど)。</p>
      </section>
      <section class="about-sec">
        <h2>出典ポリシー</h2>
        <p>データの主原料は一次情報のみです: 官公庁統計、有価証券報告書・IR資料、
        業界団体の公開名簿、プレスリリース、企業公式サイト、そして企業自身による登録データ。
        出典はノード・フロー単位で記録し、詳細パネルからいつでも確認できます。
        金額感はすべて公表情報にもとづく規模表現で、個社の非公開情報は掲載しません。</p>
        <p style="font-size:.85em;color:var(--ink-soft)">業界カードの写真は <a href="https://commons.wikimedia.org/" target="_blank" rel="noopener">Wikimedia Commons</a> のCC0/パブリックドメイン画像を使用しています(<a href="assets/photo/credits.json" target="_blank">出典一覧</a>)。</p>
        <p>財務値の見方: 売上高は各社決算短信の直近通期<strong>実績</strong>、時価総額は取得日付きの掲載値です
        (基準日は各社の注記に記載)。「概算」と明記された値のみ、換算レートやセグメント値にもとづく規模感です。
        非上場企業は公表値または親会社連結の値であることを注記しています。</p>
      </section>
      <section class="about-sec">
        <h2>修正の提案</h2>
        <p>「この会社が抜けている」「このフローは今は違う」といった事実の修正提案を歓迎します。
        提案は出典(公開情報)を添えて、<a href="https://github.com/fanasocorpdev/shoryu-zukan/issues" target="_blank" rel="noopener">GitHubのIssue</a>
        または下記メールでお送りください。内容を確認のうえ反映します。
        ※ 第三者の取引条件・マージン率など、公開情報で確認できない情報は掲載できません。</p>
      </section>
      <section class="about-sec">
        <h2>企業の方へ・お問い合わせ</h2>
        <p>基本掲載は無料です(位置・掲載順は編集方針で決まり、課金で変わることはありません)。</p>
        <p><strong>採用枠のご案内:</strong> 業界研究中の学生が自社の業界マップを見るその場所に、
        「採用中」バッジと求人ページへのリンクを掲出できます。
        料金は<strong>月額5万円〜</strong>(企業規模により応相談)。
        マップ上の位置や掲載順は変わらない、文脈広告型の採用枠です。</p>
        <p>採用枠のお申し込み・自社掲載のご希望・修正のご連絡は
        <a href="mailto:yuhei.n@fansojp.com?subject=%E3%81%82%E3%81%8D%E3%81%AA%E3%81%84%E3%83%9E%E3%83%83%E3%83%97">yuhei.n@fansojp.com</a>
        までお寄せください。</p>
      </section>
      <section class="about-sec">
        <h2>免責</h2>
        <p>本サイトの情報は公開情報にもとづき正確性に努めていますが、内容を保証するものではありません。
        投資判断・取引判断の根拠としての利用は想定していません。誤りを見つけた場合はお知らせください —
        迅速に確認・訂正します。</p>
      </section>
      <div class="home-foot">
        <a href="#/">← マップトップへ戻る</a><br>
        運営: 株式会社Fanaso
      </div>
    </div></div>`;
  wireGlobalNav();
}

let destroyMap = null;

async function renderIndustry(id) {
  const idx0 = await loadIndex();
  if (!(idx0.open_industries ?? []).includes(id) && !isMember()) {
    const viewed = JSON.parse(localStorage.getItem("akinai_viewed") ?? "[]");
    if (!viewed.includes(id)) {
      if (viewed.length >= 1) { await renderGate(id); return; }
      localStorage.setItem("akinai_viewed", JSON.stringify([...viewed, id]));
    }
  }
  const [{ industries }, data] = await Promise.all([loadIndex(), loadIndustry(id)]);
  const parent = data.meta.parent_industry ? await loadIndustry(data.meta.parent_industry) : null;
  app.innerHTML = `
    <div class="mapapp">
      <header class="topbar">
        <a class="home-link" href="#/">トップ</a>
        <a class="home-link" href="#/rank" title="企業ランキング">ランキング</a>
        <a class="home-link" href="#/my" title="マイマップ">マイマップ</a>
        ${parent ? `<a class="home-link parent-link" href="#/i/${parent.meta.industry_id}">⬆ ${parent.meta.industry_name}</a>` : ""}
        <div class="title-wrap"><h1>${data.meta.industry_name}の商流</h1><span class="tag">${data.meta.tagline ?? ""}</span></div>
        <button id="share-btn" class="home-link share-btn" title="この業界のリンクをコピー / シェア"> シェア</button>
        <span class="spacer"></span>
        <input id="map-search" type="search" list="search-list" placeholder="企業名・役割で探す" autocomplete="off">
        <datalist id="search-list"></datalist>
        <select id="industry-select" title="業界を切り替え"></select>
        <nav class="filters" id="filters">
          <button data-f="all" class="active">すべて</button>
          <button data-f="goods"><span class="dot goods"></span>モノ・サービス</button>
          <button data-f="capex" title="設備投資・出資・買収などの一回きりの大きな支払い"><span class="dot capex"></span>カネ(一時金)</button>
          <button data-f="opex" title="利用料・仕入れ・家賃・保険料などの続く支払い"><span class="dot opex"></span>カネ(継続払い)</button>
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

  // 左サイドの縦並びレール: 上に「業界の歩き方」、下に「業界注目ニュース」
  const leftRail = document.createElement("div");
  leftRail.className = "left-rail";
  wrap.appendChild(leftRail);

  if (data.meta.guide) {
    const g = data.meta.guide;
    const card = document.createElement("details");
    card.className = "guide-card";
    card.open = localStorage.getItem("guideCollapsed") === "0"; // 既定は閉じた状態
    card.innerHTML = `
      <summary>この業界の歩き方</summary>
      <p><strong>稼ぎ方</strong> ${g.earn}</p>
      <p><strong>見どころ</strong> ${g.watch}</p>
      ${g.talk ? `<p class="g-talk"><strong>面接でこう使う</strong> ${g.talk}</p>` : ""}`;
    card.addEventListener("toggle", () =>
      localStorage.setItem("guideCollapsed", card.open ? "0" : "1"));
    leftRail.appendChild(card);
  }

  // 業界の注目ニュース(2週に1回、Workerが収集・AI要約)を歩き方の下に縦並びで
  renderIndustryNews(leftRail, id);

  // ポータル遷移で来た場合: 遷移元を示すバナー+対応ノードへ自動フォーカス
  const fromMatch = location.hash.match(/[?&]from=([a-z0-9_]+):([a-z0-9_]+)/);
  if (fromMatch) {
    const [, fromId, fromNodeId] = fromMatch;
    try {
      const fromData = await loadIndustry(fromId);
      const fromRole = fromData.nodes.find((x) => x.id === fromNodeId)?.role ?? "";
      const banner = document.createElement("div");
      banner.className = "jump-banner";
      banner.innerHTML = `<span class="jb-text">← <strong>${fromData.meta.industry_name}</strong>${
        fromRole ? `「${fromRole}」` : ""
      }から潜ってきました</span>
        <a href="#/i/${fromId}">元の地図へ戻る</a>
        <button class="jb-close" title="閉じる">✕</button>`;
      banner.querySelector(".jb-close").addEventListener("click", () => banner.remove());
      wrap.appendChild(banner);
      // この地図の中で遷移元業界を指しているノード=「いま居る場所」として光らせる
      const back = data.nodes.find((x) => !x.unsorted && x.related_industry === fromId);
      if (back) map.focusNode(back.id);
    } catch { /* 遷移元情報が壊れていても地図表示は続行 */ }
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

// 業界の注目ニュース(Workerが2週に1回Bing Newsから収集しAI要約したもの)
const NEWS_API = "https://akinaimap-news.yuhei-n.workers.dev";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const days = Math.floor((Date.now() - d) / 86400000);
  if (days <= 0) return "今日";
  if (days === 1) return "昨日";
  if (days < 14) return `${days}日前`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
async function renderIndustryNews(wrap, id) {
  const card = document.createElement("details");
  card.className = "news-card";
  card.open = localStorage.getItem("newsCollapsed") !== "1"; // 既定は開いた状態
  card.innerHTML = `<summary>業界週間ニュース</summary>
    <div class="news-body"><p class="news-loading">読み込み中…</p></div>`;
  card.addEventListener("toggle", () =>
    localStorage.setItem("newsCollapsed", card.open ? "0" : "1"));
  wrap.appendChild(card);
  const body = card.querySelector(".news-body");
  try {
    const res = await fetch(`${NEWS_API}/news?industry=${encodeURIComponent(id)}`);
    const { items } = await res.json();
    if (!items || !items.length) {
      body.innerHTML = `<p class="news-empty">この業界のニュースはまだありません。</p>`;
      return;
    }
    body.innerHTML = `<ol class="news-list">${items.map((it) => `
      <li class="news-item">
        <a href="${it.url}" target="_blank" rel="noopener noreferrer" class="news-title">${esc(it.title)}</a>
        ${it.summary ? `<p class="news-summary">${esc(it.summary)}</p>` : ""}
        <p class="news-meta">${it.source ? `<span class="news-src">${esc(it.source)}</span>` : ""}${
          it.published ? `<span class="news-date">${timeAgo(it.published)}</span>` : ""}</p>
      </li>`).join("")}</ol>
      <p class="news-note">出典元の見出しにAIが要約を付けたものです。詳細は各リンク先をご確認ください。</p>`;
  } catch {
    body.innerHTML = `<p class="news-empty">ニュースを取得できませんでした。</p>`;
  }
}

// ---- 選考体験(公開UGC)画面 ----
const RV_GRAD = ["26卒", "27卒", "28卒", "29卒", "既卒・その他"];
const RV_JOB = ["総合職・事務系", "技術・エンジニア職", "専門職(研究/金融/コンサル等)", "その他"];
const RV_ROUTE = ["本選考", "インターン選考経由", "どちらも"];
const RV_OUTCOME = ["内定", "最終選考で不合格", "途中で不合格", "自分から辞退", "選考中", "その他"];
// レビューの種類(観点)
const RV_TYPE = [
  { v: "new_grad", label: "新卒選考" },
  { v: "intern", label: "インターン" },
  { v: "mid_career", label: "中途選考" },
  { v: "ob_visit", label: "OB/OG訪問" },
  { v: "employee", label: "社員クチコミ(在籍・退職者)" },
];
const RV_TYPE_LABEL = { new_grad: "新卒選考", intern: "インターン", mid_career: "中途選考", ob_visit: "OB/OG訪問", employee: "社員クチコミ" };
const RV_TENURE = ["現職(在籍中)", "退職済み"];
const RV_OBFORMAT = ["対面", "オンライン", "電話・その他"];
// 観点ごとに表示するフォーム群
const RV_GROUP_OF = { new_grad: "selection", intern: "selection", mid_career: "selection", ob_visit: "ob", employee: "employee" };

// レビュー本文(タイプ別)。管理画面カードでも再利用。
function reviewDetailHTML(r) {
  const d = r.details ?? {};
  const seg = (label, val) => val ? `<div class="rv-seg"><span class="rv-seg-l">${label}</span>${esc(val)}</div>` : "";
  const t = r.post_type;
  const isSelection = ["new_grad", "intern", "mid_career"].includes(t);
  const byline = t === "employee"
    ? `${esc(d.tenure ?? "")}${r.job_category ? ` ・ ${esc(r.job_category)}` : ""}`
    : t === "ob_visit"
    ? `${d.format ? `${esc(d.format)}` : ""}${r.job_category ? `${d.format ? " ・ " : ""}${esc(r.job_category)}` : ""}`
    : `${esc(r.grad_year ?? "")}${r.job_category ? ` ・ ${esc(r.job_category)}` : ""}${r.route ? ` ・ ${esc(r.route)}` : ""}`;
  const badge = `<span class="rv-type-badge">${esc(RV_TYPE_LABEL[t] ?? "選考")}</span>`;
  const head = `<div class="rv-head"><span class="rv-byline">${badge}${byline}</span>
    ${isSelection && r.outcome ? `<span class="rv-outcome">${esc(r.outcome)}</span>` : ""}</div>`;
  const detail = t === "employee"
    ? seg("良かった点", d.good) + seg("気になった点", d.bad) + seg("働き方・残業", d.worklife) + seg("年収の実感", d.pay)
    : t === "ob_visit"
    ? seg("聞いてよかったこと", d.talked) + seg("訪問のコツ", d.tips)
    : seg("ES・Webテスト", d.es) + seg("GD", d.gd) + seg("面接", d.interview);
  return head + detail + (r.body ? `<p class="rv-body">${esc(r.body)}</p>` : "");
}

function reviewCardHTML(r) {
  const own = r.author_id && authUser()?.id === r.author_id;
  return `<article class="rv-card${r.status === "pending" ? " pending" : ""}" data-id="${esc(r.id)}">
    ${reviewDetailHTML(r)}
    <div class="rv-foot">
      ${r.status === "pending" ? `<span class="rv-pending-tag">承認待ち(あなただけに表示)</span>` : ""}
      ${own ? `<button class="rv-del" data-id="${esc(r.id)}">取り下げ</button>`
            : `<button class="rv-report" data-id="${esc(r.id)}">通報</button>`}
    </div>
  </article>`;
}

function reviewFormHTML() {
  const sel = (name, opts, label) => `<label>${label}
    <select name="${name}"><option value="">選択</option>${opts.map((o) => `<option>${o}</option>`).join("")}</select></label>`;
  return `<form id="rv-form" class="rv-form">
    <label class="rv-type-l">レビューの種類
      <select name="post_type" id="rv-type">${RV_TYPE.map((t) => `<option value="${t.v}">${t.label}</option>`).join("")}</select></label>
    <div class="rv-row">${sel("job_category", RV_JOB, "職種")}</div>

    <div class="rv-group" data-group="selection">
      <div class="rv-row">${sel("grad_year", RV_GRAD, "卒業年 / 入社予定年")}${sel("route", RV_ROUTE, "選考ルート")}</div>
      <label>ES設問・Webテスト <span class="opt">(任意)</span>
        <textarea name="es" rows="2" placeholder="ESの設問と回答の要点、テストの形式など"></textarea></label>
      <label>グループディスカッション <span class="opt">(任意)</span>
        <textarea name="gd" rows="2" placeholder="お題・進め方・評価されたと感じた点"></textarea></label>
      <label>面接 <span class="opt">(任意)</span>
        <textarea name="interview" rows="3" placeholder="回数・質問内容・雰囲気など"></textarea></label>
      ${sel("outcome", RV_OUTCOME, "結果")}
    </div>

    <div class="rv-group" data-group="ob" hidden>
      <div class="rv-row">${sel("ob_format", RV_OBFORMAT, "面談の形式")}</div>
      <label>聞いてよかったこと・印象 <span class="opt">(任意)</span>
        <textarea name="talked" rows="3" placeholder="仕事のリアル・社風・キャリアパスなど、聞けて役立ったこと"></textarea></label>
      <label>訪問のコツ・準備 <span class="opt">(任意)</span>
        <textarea name="tips" rows="2" placeholder="アポの取り方・質問の準備・お礼など、後輩へのアドバイス"></textarea></label>
    </div>

    <div class="rv-group" data-group="employee" hidden>
      <div class="rv-row">${sel("tenure", RV_TENURE, "在籍状況")}</div>
      <label>良かった点 <span class="opt">(任意)</span>
        <textarea name="good" rows="2" placeholder="成長環境・裁量・人・制度など"></textarea></label>
      <label>気になった点 <span class="opt">(任意)</span>
        <textarea name="bad" rows="2" placeholder="改善してほしい点・入社前に知りたかったこと"></textarea></label>
      <label>働き方・残業 <span class="opt">(任意)</span>
        <textarea name="worklife" rows="2" placeholder="残業時間の実感・リモート可否・休みの取りやすさ"></textarea></label>
      <label>年収の実感 <span class="opt">(任意)</span>
        <textarea name="pay" rows="2" placeholder="等級ごとの年収感・昇給・賞与など(具体的な個人が特定されない範囲で)"></textarea></label>
    </div>

    <label>全体の感想・後輩へのアドバイス
      <textarea name="body" rows="3" placeholder="準備しておくと良いこと、商流のどこに惹かれたか など"></textarea></label>
    <label class="rv-consent"><input type="checkbox" name="consent" required>
      <span><a href="#/guidelines" target="_blank">投稿ガイドライン</a>を読み、同意します。個人が特定される情報・誹謗中傷・守秘義務(NDA)に反する内容は書きません。</span></label>
    <button type="submit" id="rv-submit">投稿する(運営確認後に公開)</button>
    <p id="rv-msg" class="gate-msg" hidden></p>
  </form>`;
}

// 選考体験を書く: 企業を選んで、その企業のレビュー投稿へ移動する
async function renderReviewNew() {
  const all = await loadAllCompanies().catch(() => []);
  const withCode = all.filter((c) => c.code && c.name);
  const nameToCode = new Map(withCode.map((c) => [c.name, c.code]));
  app.innerHTML = `
    ${globalNavHTML(true)}
    <div class="home"><div class="home-inner">
      <div class="hero">
        <img class="compass logo-emblem" src="assets/emblem.svg" alt="" width="60" height="60">
        <h1>レビューを書く</h1>
        <p class="sub">受けた企業・働いた企業を選んで、<strong>新卒選考・インターン・中途選考・OB/OG訪問・社員クチコミ</strong>を共有できます。あなたの体験が後輩の役に立ちます。</p>
      </div>
      <div class="rv-pick">
        <input id="rv-pick-input" type="search" list="rv-pick-list" placeholder="企業名・証券コードで検索(例: トヨタ / 7203)" autocomplete="off">
        <datalist id="rv-pick-list">${withCode.map((c) => `<option value="${esc(c.name)}">`).join("")}</datalist>
        <button id="rv-pick-go" class="rv-new-btn">この企業のレビューを書く →</button>
      </div>
      <p class="rv-note">${isMember() ? "投稿は運営の確認後に公開されます。" : "※投稿にはログインが必要です。企業を選ぶとログイン画面に進みます。"}
        <a href="#/guidelines">投稿ガイドライン</a></p>
      <div class="home-foot"><a href="#/">← トップへ</a></div>
    </div></div>`;
  const input = document.getElementById("rv-pick-input");
  const go = () => {
    const q = input.value.trim();
    if (!q) return;
    let code = nameToCode.get(q) ?? (/^\d{4}[A-Z0-9]?$/.test(q) ? q : null);
    if (!code) { const hit = [...nameToCode].find(([n]) => n.includes(q)); code = hit?.[1]; }
    if (code) location.hash = `#/reviews/${code}?write=1`;
    else { input.classList.add("miss"); }
  };
  document.getElementById("rv-pick-go").addEventListener("click", go);
  input.addEventListener("change", go);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  wireGlobalNav();
}

async function renderReviews(code) {
  const all = await loadAllCompanies().catch(() => []);
  const c = all.find((x) => x.code === code);
  const name = c?.name ?? code;
  const reviews = await listReviews(code);
  const approved = reviews.filter((r) => r.status === "approved");
  const minePending = reviews.filter((r) => r.status === "pending");
  const loggedIn = isMember();
  app.innerHTML = `
    ${globalNavHTML(true)}
    <div class="home"><div class="home-inner reviews">
      <div class="hero">
        <img class="compass logo-emblem" src="assets/emblem.svg" alt="" width="60" height="60">
        <h1>${esc(name)} のレビュー</h1>
        <p class="sub">${c?.industryName ? `<a href="#/i/${esc(c.industry)}">${esc(c.industryName)}の商流マップ</a>` : "選考体験・社員クチコミを共有"}</p>
      </div>
      <div class="rv-actions">
        <button id="rv-new" class="rv-new-btn">${loggedIn ? "レビューを書く" : "ログインして書く"}</button>
        <a href="#/guidelines" class="rv-guide-link">投稿ガイドライン</a>
      </div>
      <div id="rv-form-wrap" hidden></div>
      <section class="about-sec">
        <h2>みんなのレビュー(${approved.length}件)</h2>
        <p class="rv-note-sub">新卒選考・インターン・中途選考・OB/OG訪問・社員クチコミ</p>
        ${approved.length ? approved.map(reviewCardHTML).join("")
          : `<p class="rv-empty">まだ投稿がありません。あなたの体験(選考・インターン・OB訪問・在籍)が後輩の役に立ちます。最初の1件を書いてみませんか?</p>`}
      </section>
      ${minePending.length ? `<section class="about-sec"><h2>あなたの承認待ち(${minePending.length}件)</h2>
        <p class="rv-note">運営の確認後に公開されます。</p>${minePending.map(reviewCardHTML).join("")}</section>` : ""}
      <div class="home-foot">${c?.industry ? `<a href="#/i/${esc(c.industry)}">← ${esc(c.industryName)}の商流へ</a> ・ ` : ""}<a href="#/">トップへ</a></div>
    </div></div>`;

  // 書くボタン
  document.getElementById("rv-new").addEventListener("click", () => {
    if (!isMember()) { location.hash = "#/register"; return; }
    const wrap = document.getElementById("rv-form-wrap");
    if (!wrap.hidden) { wrap.hidden = true; wrap.innerHTML = ""; return; }
    wrap.innerHTML = reviewFormHTML();
    wrap.hidden = false;
    // レビューの種類で表示する項目を切り替え
    const typeSel = document.getElementById("rv-type");
    const syncGroups = () => {
      const g = RV_GROUP_OF[typeSel.value] || "selection";
      wrap.querySelectorAll("[data-group]").forEach((el) => (el.hidden = el.dataset.group !== g));
    };
    typeSel.addEventListener("change", syncGroups);
    syncGroups();
    wrap.querySelector('[data-group="selection"] textarea')?.focus();
    document.getElementById("rv-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const msg = document.getElementById("rv-msg");
      const show = (t, k = "err") => { msg.textContent = t; msg.hidden = false; msg.className = `gate-msg ${k}`; };
      if (!fd.get("consent")) { show("ガイドラインへの同意が必要です。"); return; }
      document.getElementById("rv-submit").disabled = true; show("投稿中…", "info");
      const post_type = fd.get("post_type") || "new_grad";
      const isSelection = ["new_grad", "intern", "mid_career"].includes(post_type);
      const details = post_type === "employee"
        ? { tenure: fd.get("tenure") || "", good: fd.get("good") || "", bad: fd.get("bad") || "", worklife: fd.get("worklife") || "", pay: fd.get("pay") || "" }
        : post_type === "ob_visit"
        ? { format: fd.get("ob_format") || "", talked: fd.get("talked") || "", tips: fd.get("tips") || "" }
        : { es: fd.get("es") || "", gd: fd.get("gd") || "", interview: fd.get("interview") || "" };
      const res = await submitReview({
        company: name, code, industry: c?.industry ?? null, post_type,
        grad_year: isSelection ? (fd.get("grad_year") || null) : null,
        job_category: fd.get("job_category") || null,
        route: isSelection ? (fd.get("route") || null) : null,
        outcome: isSelection ? (fd.get("outcome") || null) : null,
        details, body: fd.get("body") || "",
      });
      if (!res.ok) { document.getElementById("rv-submit").disabled = false; show(`投稿できませんでした: ${res.error}`); return; }
      show("投稿ありがとうございます。運営の確認後に公開されます。", "info");
      setTimeout(() => renderReviews(code), 1200);
    });
  });
  // 通報・取り下げ(委譲)
  app.querySelector(".reviews").addEventListener("click", async (ev) => {
    const rep = ev.target.closest(".rv-report");
    if (rep) {
      if (!isMember()) { location.hash = "#/register"; return; }
      if (!confirm("この投稿を運営に通報しますか?(誹謗中傷・虚偽・個人特定など)")) return;
      await reportReview(rep.dataset.id, "ユーザー通報");
      rep.textContent = "通報しました"; rep.disabled = true;
      return;
    }
    const del = ev.target.closest(".rv-del");
    if (del) {
      if (!confirm("この投稿を取り下げますか?")) return;
      await deleteReview(del.dataset.id);
      renderReviews(code);
    }
  });
  // 「選考体験を書く」からの遷移(?write=1)ならフォームを自動で開く
  if (location.hash.includes("write=1") && isMember()) document.getElementById("rv-new")?.click();
  wireGlobalNav();
}

function renderGuidelines() {
  app.innerHTML = `
    ${globalNavHTML(true)}
    <div class="home"><div class="home-inner">
      <div class="hero"><h1>選考体験 投稿ガイドライン</h1></div>
      <section class="about-sec">
        <p>選考体験は、これから就活する仲間のための情報共有です。安心して使える場にするため、次のルールを守ってください。</p>
        <h2>禁止事項</h2>
        <p>・特定の個人が分かる情報(面接官・社員・OB/OGの実名や部署など)<br>
        ・事実に反する内容、誹謗中傷、差別的表現<br>
        ・守秘義務(NDA)・選考課題の非公開指定に反する内容<br>
        ・他サイトからの転載、宣伝・勧誘</p>
        <h2>運営について</h2>
        <p>・投稿は運営の確認後に公開されます(事前承認)。<br>
        ・公開後も、通報や企業・個人からの申し出により、内容を非表示・削除する場合があります。<br>
        ・掲載内容は投稿者個人の体験・意見であり、企業の公式見解や事実の保証ではありません。参考情報としてご利用ください。</p>
        <h2>お問い合わせ・削除依頼</h2>
        <p>掲載内容についてのご連絡は <a href="mailto:yuhei.n@fansojp.com">yuhei.n@fansojp.com</a> まで。速やかに対応します。</p>
        <div class="home-foot"><a href="#/">← トップへ戻る</a></div>
      </section>
    </div></div>`;
  wireGlobalNav();
}

// ---- 運営管理画面 #/admin ----
function adminReviewCardHTML(r, ctx) {
  const when = r.created_at ? new Date(r.created_at).toLocaleString("ja-JP") : "";
  const actions = ctx === "pending"
    ? `<button class="adm-btn ok" data-act="approve" data-id="${esc(r.id)}">承認して公開</button>
       <button class="adm-btn" data-act="reject" data-id="${esc(r.id)}">却下(非公開)</button>
       <button class="adm-btn danger" data-act="delete" data-id="${esc(r.id)}">削除</button>`
    : `<button class="adm-btn" data-act="reject" data-id="${esc(r.id)}">非公開に戻す</button>
       <button class="adm-btn danger" data-act="delete" data-id="${esc(r.id)}">削除</button>`;
  return `<article class="adm-card" data-id="${esc(r.id)}">
    <div class="adm-meta"><strong>${esc(r.company ?? "")}</strong>${r.code ? ` <span class="cmp-sub">${esc(r.code)}</span>` : ""}
      <span class="adm-when">${esc(when)}</span></div>
    ${reviewDetailHTML(r)}
    <div class="adm-actions">${actions}</div>
  </article>`;
}

async function renderAdmin() {
  if (!isMember()) {
    app.innerHTML = `${globalNavHTML(true)}<div class="home"><div class="home-inner"><div class="hero"><h1>運営管理</h1>
      <p class="sub">運営者としてログインしてください。</p></div>
      <div style="text-align:center"><a class="rv-new-btn" href="#/register">ログイン</a></div></div></div>`;
    wireGlobalNav(); return;
  }
  if (!isAdmin()) {
    app.innerHTML = `${globalNavHTML(true)}<div class="home"><div class="home-inner"><div class="hero"><h1>運営管理</h1>
      <p class="sub">このページは運営者専用です。</p></div>
      <div class="home-foot"><a href="#/">← トップへ</a></div></div></div>`;
    wireGlobalNav(); return;
  }
  app.innerHTML = `${globalNavHTML(true)}<div class="home"><div class="home-inner admin">
    <div class="hero"><h1>運営管理 — 選考体験</h1><p class="sub">投稿の承認・却下・削除、通報の対応</p></div>
    <div id="adm-body"><p>読み込み中…</p></div>
    <div class="home-foot"><a href="#/">← トップへ</a></div></div></div>`;
  wireGlobalNav();

  const body = document.getElementById("adm-body");
  const load = async () => {
    const [pending, reports, approved] = await Promise.all([
      adminListReviews("pending"), adminListReports(), adminListReviews("approved", 50),
    ]);
    if (pending.error || reports.error) {
      body.innerHTML = `<p class="gate-msg err">読み込みエラー: ${esc(pending.error || reports.error)}<br>
        (reviewsテーブルの管理者ポリシー未設定の可能性。cloud/supabase/0003_admin.sql を実行してください)</p>`;
      return;
    }
    body.innerHTML = `
      <section class="about-sec">
        <h2>承認待ち(${pending.rows.length})</h2>
        ${pending.rows.length ? pending.rows.map((r) => adminReviewCardHTML(r, "pending")).join("") : `<p class="rv-empty">承認待ちはありません。</p>`}
      </section>
      <section class="about-sec">
        <h2>通報(${reports.rows.length})</h2>
        ${reports.rows.length ? reports.rows.map((rep) => `
          <div class="adm-report">
            <p class="adm-report-h">通報理由: ${esc(rep.reason ?? "-")} <span class="adm-when">${esc(rep.created_at ? new Date(rep.created_at).toLocaleString("ja-JP") : "")}</span></p>
            ${rep.review ? adminReviewCardHTML(rep.review, rep.review.status === "approved" ? "approved" : "pending") : `<p class="rv-empty">対象の投稿は削除済みです。</p>`}
            <button class="adm-btn" data-act="delreport" data-id="${esc(rep.id)}">この通報を消す</button>
          </div>`).join("") : `<p class="rv-empty">通報はありません。</p>`}
      </section>
      <section class="about-sec">
        <h2>公開中(直近${approved.rows.length})</h2>
        ${approved.rows.length ? approved.rows.map((r) => adminReviewCardHTML(r, "approved")).join("") : `<p class="rv-empty">公開中の投稿はありません。</p>`}
      </section>`;
  };
  await load();

  body.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-act]");
    if (!btn) return;
    const { act, id } = btn.dataset;
    btn.disabled = true;
    if (act === "approve") await adminSetStatus(id, "approved");
    else if (act === "reject") await adminSetStatus(id, "rejected");
    else if (act === "delete") { if (!confirm("この投稿を完全に削除しますか?")) { btn.disabled = false; return; } await adminDeleteReview(id); }
    else if (act === "delreport") await adminDeleteReport(id);
    await load();
  });
}

async function route() {
  if (destroyMap) { destroyMap(); destroyMap = null; }
  const hash = location.hash || "#/";
  try {
    const m = hash.match(/^#\/i\/([a-z0-9_]+)/);
    const rv = hash.match(/^#\/reviews\/([A-Za-z0-9]+)/);
    if (m) await renderIndustry(m[1]);
    else if (rv) await renderReviews(rv[1]);
    else if (hash.startsWith("#/review")) await renderReviewNew();
    else if (hash.startsWith("#/admin")) await renderAdmin();
    else if (hash.startsWith("#/guidelines")) renderGuidelines();
    else if (hash.startsWith("#/rank")) await renderRanking();
    else if (hash.startsWith("#/register")) await renderGate(null);
    else if (hash.startsWith("#/my")) await renderMy();
    else if (hash.startsWith("#/privacy")) renderPrivacy();
    else if (hash.startsWith("#/operator")) renderOperator();
    else if (hash.startsWith("#/terms")) renderTerms();
    else if (hash.startsWith("#/about")) renderAbout();
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

// 認証セッションを読み込んでから初回描画。ログイン/ログアウト時は再描画する。
initAuth((user) => {
  // メール確認リンク等でURLにトークンが付く場合はクリーンアップ
  if (location.hash.includes("access_token") || location.search.includes("code=")) {
    history.replaceState(null, "", location.pathname + "#/");
  }
  route();
}).finally(route);
