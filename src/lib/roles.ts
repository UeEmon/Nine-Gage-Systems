/** 画面とサーバーの両方で使うロールの定義 */
export const ROLE_LABELS = { admin: "管理者", user: "一般" } as const;
export type RoleId = keyof typeof ROLE_LABELS;
export type SessionUser = { id: string; username: string; role: RoleId };

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
