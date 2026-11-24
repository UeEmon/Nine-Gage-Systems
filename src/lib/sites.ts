/**
 * トップページ（www.）とプラットフォーム（エディタ）の振り分け。同じアプリが両方のアドレスで動く。
 *
 * - NINEGAGE_HOME_URL: トップページ（例 https://www.senrolab.com）。ログイン・登録・アカウントもここ。
 * - NINEGAGE_PUBLIC_URL: プラットフォーム（例 https://platform.senrolab.com）。
 *
 * 両方があってアドレスが違うときだけ振り分ける。どちらかがなければ（開発・ステージング）1つのアドレスで全部を出し、
 * トップページは /home で見られる。
 * proxy.ts からも読むので、node: のモジュールは使わない。
 */

export type Env = Record<string, string | undefined>;

export type Sites = { home: string; app: string };

/** トップページの中身のパス（1つのアドレスのときもここで見られる） */
export const HOME_PAGE_PATH = "/home";

/** プラットフォームのトップへ移るためのパス（どちらのアドレスからでも） */
export const EDITOR_PATH = "/editor";

/** トップページ側に置く画面（ログイン・登録・アカウントまわり） */
const ACCOUNT_PATHS = ["/login", "/signup", "/verify", "/forgot", "/reset", "/account", "/guide"];

function originOf(url: string | undefined): string | null {
  const v = url?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function sitesFrom(env: Env = process.env): Sites | null {
  const home = originOf(env.NINEGAGE_HOME_URL);
  const app = originOf(env.NINEGAGE_PUBLIC_URL);
  if (!home || !app || home === app) return null;
  return { home, app };
}

function under(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isAccountPath(pathname: string): boolean {
  return under(pathname, ACCOUNT_PATHS);
}

/** トップページのアドレスで出す画面か */
function isHomePath(pathname: string): boolean {
  return pathname === "/" || pathname === HOME_PAGE_PATH || isAccountPath(pathname);
}

export type Route = { kind: "rewrite"; path: string } | { kind: "redirect"; url: string } | null;

/**
 * 要求をどこへ回すか。host は要求の Host（ポート付きでもよい）。search は "?..." か ""。
 * /api と /_next と静的ファイルは呼ばない（proxy.ts の matcher で外す）。
 */
export function routeFor(host: string | null, pathname: string, search: string, sites: Sites | null): Route {
  if (!sites) {
    if (pathname === EDITOR_PATH) return { kind: "redirect", url: `/${search}` };
    return null;
  }
  const homeHost = new URL(sites.home).host;
  const appHost = new URL(sites.app).host;
  if (pathname === EDITOR_PATH) return { kind: "redirect", url: `${sites.app}/${search}` };
  if (host === homeHost) {
    if (pathname === "/") return { kind: "rewrite", path: HOME_PAGE_PATH };
    if (pathname === HOME_PAGE_PATH) return { kind: "redirect", url: `${sites.home}/${search}` };
    if (isHomePath(pathname)) return null;
    // プラットフォームの画面（管理・改善リクエストなど）
    return { kind: "redirect", url: `${sites.app}${pathname}${search}` };
  }
  if (host === appHost) {
    if (pathname === HOME_PAGE_PATH) return { kind: "redirect", url: `${sites.home}/` };
    if (!isAccountPath(pathname)) return null;
    // ログインなどはトップページで。ログインのあとはプラットフォームのもとの画面へ戻す
    const params = new URLSearchParams(search);
    if (pathname === "/login") {
      const next = params.get("next");
      params.set("next", next && next.startsWith("/") && !next.startsWith("//") ? `${sites.app}${next}` : `${sites.app}/`);
    }
    const q = params.toString();
    return { kind: "redirect", url: `${sites.home}${pathname}${q ? `?${q}` : ""}` };
  }
  return null;
}

/**
 * ログイン後に戻る先。このサイトの中のパスか、トップページ・プラットフォームのアドレスだけを受け付ける
 * （ほかのサイトへ飛ばされないように）。
 */
export function safeNext(next: string | null | undefined, sites: Sites | null = sitesFrom()): string {
  if (!next) return "/";
  if (next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")) return next;
  if (sites) {
    try {
      const u = new URL(next);
      if (u.origin === sites.home || u.origin === sites.app) return u.href;
    } catch {
      /* 形が違う */
    }
  }
  return "/";
}

/** メールに書くリンクの基点に使う、トップページのアドレス（なければ null） */
export function homeUrl(env: Env = process.env): string | null {
  return sitesFrom(env)?.home ?? null;
}
