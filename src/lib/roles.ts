/**
 * 画面とサーバーの両方で使うロールの定義。
 * 表示名はここだけで決める（名称を変えるときはここを変える。保存するIDの admin / ai / user は変えない）
 */
export const ROLE_LABELS = { admin: "管理者", plus: "プレミアムプラス", ai: "プレミアムユーザー", user: "一般" } as const;
/**
 * 画面に出すロール。プレミアムユーザー（ai）は保存せず、一般のうち GitHub Sponsors で支援中の人をそう扱う（premium.ts）。
 * 管理者が選べるのは admin / plus / user（ASSIGNABLE_ROLES）
 */
export type RoleId = keyof typeof ROLE_LABELS;
export type SessionUser = { id: string; username: string; role: RoleId };

/** ログインしていない人（ロールとしては保存しない） */
export const GUEST_LABEL = "ログインなし";

/** ロールの並び（一覧の並べ替え・選択肢の順） */
export const ROLE_ORDER: RoleId[] = ["admin", "plus", "ai", "user"];

/** 管理者がユーザー管理で選べるロール（プレミアムユーザーは GitHub Sponsors の支援で決まる） */
export const ASSIGNABLE_ROLES = ["admin", "plus", "user"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const ROLE_HELP: Record<RoleId, string> = {
  admin: "AI（サーバーのAPIキー）・AI設定・ユーザー管理・お知らせ・使用量",
  plus: "管理者が指定した人。サーバーのAIを、管理者が決めた月の上限まで使える。上限に達したら、登録した自分のAPIキーで続けられる",
  ai: "GitHub Sponsors で支援してくれた人。サーバーのAIを、支援額に応じた上限まで使える。上限に達したら、登録した自分のAPIキーで続けられる",
  user: "自分で設定したAPIキーでAIを使える。GitHub Sponsors で支援するとプレミアムユーザーになる",
};

/** GitHub Sponsors のページ */
export const SPONSORS_URL = "https://github.com/sponsors/UeEmon";

/**
 * AIをどのキーで使うか。
 * server = 管理者が設定したサーバーのキー、own = 自分で設定したキー、none = 使えない（ログインなし）
 */
export type AiAccess = "server" | "own" | "none";

export function aiAccessOf(role: RoleId | null | undefined): AiAccess {
  if (role === "admin" || role === "plus" || role === "ai") return "server";
  if (role === "user") return "own";
  return "none";
}

/** 自分のAPIキーを登録できるロール（管理者以外）。プレミアムユーザー・プレミアムプラスは月の上限に達したあとに自分のキーを使う */
export function canSetOwnKey(role: RoleId | null | undefined): boolean {
  return role === "plus" || role === "ai" || role === "user";
}

/** 走行の映像で RealTrainMod の車両を読み込んで使えるロール（プレミアムユーザー・プレミアムプラス・管理者） */
export function canUseRtm(role: RoleId | null | undefined): boolean {
  return role === "admin" || role === "plus" || role === "ai";
}

/** RealTrainMod の設置物を読み込んでレイアウトに置けるロール（RealTrainMod の車両と同じ。仮オブジェクト・3Dモデルは誰でも使える） */
export function canUseModels(role: RoleId | null | undefined): boolean {
  return canUseRtm(role);
}

/** 月の上限があるロール（サーバーのAIを上限まで使う） */
export function hasAiLimit(role: RoleId | null | undefined): boolean {
  return role === "plus" || role === "ai";
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
