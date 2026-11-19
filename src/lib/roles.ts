/**
 * 画面とサーバーの両方で使うロールの定義。
 * 表示名はここだけで決める（名称を変えるときはここを変える。保存するIDの admin / ai / user は変えない）
 */
export const ROLE_LABELS = { admin: "管理者", ai: "プレミアムユーザー", user: "一般" } as const;
export type RoleId = keyof typeof ROLE_LABELS;
export type SessionUser = { id: string; username: string; role: RoleId };

/** ログインしていない人（ロールとしては保存しない） */
export const GUEST_LABEL = "ログインなし";

/** ロールの並び（一覧の並べ替え・選択肢の順） */
export const ROLE_ORDER: RoleId[] = ["admin", "ai", "user"];

export const ROLE_HELP: Record<RoleId, string> = {
  admin: "AI（サーバーのAPIキー）・AI設定・ユーザー管理・お知らせ・使用量",
  ai: "AI（管理者が選んだモデルとサーバーのAPIキー）を使える。自分のAPIキーを登録すれば、そちらを使うこともできる",
  user: "自分で設定したAPIキーでAIを使える",
};

/**
 * AIをどのキーで使うか。
 * server = 管理者が設定したサーバーのキー、own = 自分で設定したキー、none = 使えない（ログインなし）
 */
export type AiAccess = "server" | "own" | "none";

export function aiAccessOf(role: RoleId | null | undefined): AiAccess {
  if (role === "admin" || role === "ai") return "server";
  if (role === "user") return "own";
  return "none";
}

/** 自分のAPIキーを登録できるロール（一般とプレミアムユーザー）。プレミアムユーザーは登録したときだけ自分のキーを使う */
export function canSetOwnKey(role: RoleId | null | undefined): boolean {
  return role === "ai" || role === "user";
}

/** APIキー登録のチュートリアル */
export const API_KEY_GUIDE_PATH = "/guide/api-key";

/** JSON を送って、失敗なら error を投げる */
export async function api<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth/")) {
    window.location.href = "/login";
  }
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}
