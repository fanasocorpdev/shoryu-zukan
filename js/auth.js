// あきないマップ — 認証(Supabase Auth / メール+パスワード)
// パスワードはSupabase側で安全に保管(当サイトは生パスワードを保持しない)。
// セッションはlocalStorageに保持し自動更新するため、同一端末では長期間ログイン状態が続く。
// window.supabase は index.html で読み込むUMDが提供する。

const SUPABASE_URL = "https://dupjlawmbnwgxfbwvowy.supabase.co";
const SUPABASE_KEY = "sb_publishable_BNVOfBqZmJUbZtx0HlSXyQ_7ns0ZNSE";

// クライアントは遅延生成する。UMD(window.supabase)の読込順に依存して
// モジュール評価時にcreateClientが失敗し、アプリ全体が起動しなくなるのを防ぐ。
let _client = null;
function getClient() {
  if (_client) return _client;
  if (!window.supabase?.createClient) throw new Error("supabase-js(UMD)が未読込です");
  _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: "akinai_auth",
      detectSessionInUrl: true, // メール確認リンク等からの復帰に対応
    },
  });
  return _client;
}
// 既存コードが sb.auth... で使えるよう、アクセス時に遅延解決するプロキシを公開
export const sb = new Proxy({}, { get: (_t, prop) => getClient()[prop] });

// キャッシュした認証状態(同期的にisMember判定するため)
let _user = null;
export function authUser() { return _user; }
export function isLoggedIn() { return !!_user; }

// 起動時に一度セッションを読み、以後の変化を購読する。onChangeは再描画コールバック。
export async function initAuth(onChange) {
  try {
    const { data } = await sb.auth.getSession();
    _user = data.session?.user ?? null;
    sb.auth.onAuthStateChange((_event, session) => {
      const next = session?.user ?? null;
      const changed = (_user?.id ?? null) !== (next?.id ?? null);
      _user = next;
      if (changed && typeof onChange === "function") onChange(_user);
    });
  } catch (e) {
    console.warn("認証の初期化に失敗(ログアウト状態で継続):", e.message);
    _user = null;
  }
  return _user;
}

// 新規登録: email+password でアカウント作成。確認メールON時は session が返らない。
export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) return { ok: false, error: error.message };
  // session があれば即ログイン、無ければメール確認待ち
  return { ok: true, needsConfirm: !data.session, user: data.user };
}

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  _user = data.user;
  return { ok: true, user: data.user };
}

export async function signOut() {
  await sb.auth.signOut();
  _user = null;
}

export async function resetPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin + location.pathname + "#/my",
  });
  return { error: error?.message ?? null };
}
