// あきないマップ 無料メンバー登録API (POSTのみ)。
// 集計はデプロイ側から `wrangler d1 execute akinaimap-db --remote --command "..."` で行う。
const ALLOWED_ORIGINS = [
  "https://fanasocorpdev.github.io",
  "https://akinaimap.pages.dev",
  "https://akinaimap.com",
  "https://www.akinaimap.com",
  "https://akinaimap.jp",
  "https://www.akinaimap.jp",
  "http://localhost:8137",
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    // アクセス計測ビーコン(クッキーレス/一次データ)。個人を特定する情報(IP・Cookie)は
    // 保存しない。経路(hash)・参照元・粗いUAのみをD1のpageviewsに記録する。
    if (url.pathname === "/pv" && request.method === "POST") {
      try {
        const b = await request.json();
        const now = new Date();
        await env.DB.prepare(
          "INSERT INTO pageviews (ts, day, path, ref, ua) VALUES (?, ?, ?, ?, ?)"
        ).bind(
          now.toISOString(),
          now.toISOString().slice(0, 10),
          String(b.p ?? "").slice(0, 120),
          String(b.r ?? "").slice(0, 200),
          String(request.headers.get("User-Agent") ?? "").slice(0, 160)
        ).run();
      } catch { /* 計測失敗は握りつぶす(サイト側に影響させない) */ }
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method === "GET") {
      return new Response("akinaimap-register: ok", { headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405, headers: corsHeaders(origin) });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "invalid json" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }
    const email = String(body.email ?? "").slice(0, 254);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ ok: false, error: "invalid email" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }
    const s = (v, n = 60) => (v == null ? null : String(v).slice(0, n));
    await env.DB.prepare(
      `INSERT INTO registrations (ts, email, name, school_name, segment, school, grad_year, bunri, exp_industry, job, exp_years, scout_ok, industries, ua)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      new Date().toISOString(),
      email,
      s(body.name),
      s(body.school_name, 80),
      s(body.segment),
      s(body.school),
      s(body.grad_year),
      s(body.bunri),
      s(body.exp_industry),
      s(body.job),
      s(body.exp_years),
      body.scout_ok ? 1 : 0,
      JSON.stringify(Array.isArray(body.industries) ? body.industries.slice(0, 5) : []),
      s(request.headers.get("User-Agent"), 200)
    ).run();
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  },
};
