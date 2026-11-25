/**
 * アクセス解析（自前の集計）。画面とサーバーで共通の定義と、画面から送る track()。
 *
 * 外部の解析サービスは使わず、プラットフォームの /api/events に送ってサーバーの analytics.sqlite に残す
 * （src/lib/server/analytics.ts）。個人を追いかけないよう、次のものは送らない・残さない:
 * - IPアドレス・ブラウザの種類（User-Agent）・URLの ? 以降・レイアウトの中身・入力した文字
 * - 投稿やパターンのIDは、パスの中でも :id に置き換える
 * - 参照元はホスト名だけ（自分のサイトどうしは残さない）
 * 訪問者は乱数の ID（Cookie sl_vid）で数え、ログインしていればユーザーIDも付く（サーバーが Cookie から付ける）。
 *
 * ターミナル（別のアプリ）からも読むので、@/ の別名と node: のモジュールは使わない。
 */

/** 画面から送れるイベント（signup・login はサーバーだけが記録する） */
export const CLIENT_EVENTS = [
  "view",
  "save",
  "export",
  "import",
  "drive",
  "operation",
  "twin",
  "ai",
  "terminal_post",
  "terminal_set",
] as const;
export type ClientEvent = (typeof CLIENT_EVENTS)[number];

export const SERVER_EVENTS = ["signup", "login"] as const;
export type ServerEvent = (typeof SERVER_EVENTS)[number];

export type EventName = ClientEvent | ServerEvent;

/** 機能別の利用状況に出すイベントと名前（view・signup・login は別に出す） */
export const FEATURE_EVENTS: { id: EventName; label: string }[] = [
  { id: "save", label: "パターンを保存（ブラウザに登録・上書き）" },
  { id: "export", label: "ファイルに書き出し" },
  { id: "import", label: "ファイルを読み込み" },
  { id: "drive", label: "運転席で走る" },
  { id: "operation", label: "運行計画を開く" },
  { id: "twin", label: "デジタルツインを開く" },
  { id: "ai", label: "AI提案を頼む" },
  { id: "terminal_post", label: "ターミナルに投稿" },
  { id: "terminal_set", label: "ターミナルでつないだレイアウトを公開" },
  { id: "login", label: "ログイン" },
];

export const SITES = ["www", "platform", "terminal"] as const;
export type Site = (typeof SITES)[number];
export const SITE_LABELS: Record<Site, string> = {
  www: "トップページ（www）",
  platform: "プラットフォーム（エディタ）",
  terminal: "ターミナル（共有）",
};

/** イベントに付けられる補足（AI提案のモードなど）。短い英数字だけ */
export const DETAIL_RE = /^[a-z0-9_-]{1,32}$/;

/**
 * 残すパスの形。? 以降を落とし、IDらしい部分を :id にし、長さを抑える。
 * 数字だけ・16文字以上の英数字・UUID の区切りは ID とみなす。
 */
export function normalizePath(raw: string): string {
  let p = raw.split(/[?#]/)[0] || "/";
  if (!p.startsWith("/")) p = `/${p}`;
  const parts = p
    .split("/")
    .filter(Boolean)
    .slice(0, 5)
    .map((s, i, all) => {
      let seg = s;
      try {
        seg = decodeURIComponent(s);
      } catch {
        /* そのまま */
      }
      // ターミナルの投稿（/l/…）とつないだレイアウト（/s/…）
      if (i === 1 && (all[0] === "l" || all[0] === "s")) return ":id";
      if (/^\d+$/.test(seg) || /^[A-Za-z0-9_-]{16,}$/.test(seg) || (seg.length >= 8 && /\d/.test(seg))) return ":id";
      return /^[A-Za-z0-9._-]{1,40}$/.test(seg) ? seg : ":id";
    });
  return `/${parts.join("/")}`;
}

/** 参照元のホスト名（自分のサイト・読めないものは null） */
export function referrerHost(referrer: string, ownHosts: string[]): string | null {
  if (!referrer) return null;
  try {
    const u = new URL(referrer);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.toLowerCase();
    if (ownHosts.some((h) => host === h || host.endsWith(`.${h}`))) return null;
    return host.slice(0, 100);
  } catch {
    return null;
  }
}

export type EventPayload = {
  name: ClientEvent;
  path: string;
  detail?: string;
  referrer?: string;
  mobile?: boolean;
  /** 送り元のサイト（ターミナルだけが付ける。ほかは Host から決める） */
  site?: Site;
};

let endpoint = "/api/events";
let fixedSite: Site | undefined;

/** 送り先を変える（ターミナルからプラットフォームへ送るとき） */
export function configureTracking(opts: { endpoint?: string; site?: Site }) {
  if (opts.endpoint) endpoint = opts.endpoint;
  if (opts.site) fixedSite = opts.site;
}

/** 画面で何かをしたことを送る。失敗しても何もしない（使い方を止めない） */
export function track(name: ClientEvent, detail?: string) {
  if (typeof window === "undefined") return;
  try {
    const payload: EventPayload = {
      name,
      path: normalizePath(location.pathname),
      ...(detail && DETAIL_RE.test(detail) ? { detail } : {}),
      ...(name === "view" && document.referrer ? { referrer: document.referrer } : {}),
      mobile: window.matchMedia?.("(pointer: coarse)").matches ?? false,
      ...(fixedSite ? { site: fixedSite } : {}),
    };
    const body = JSON.stringify(payload);
    // text/plain なら別のサブドメインからでも事前確認なしで送れる（ターミナル→プラットフォーム）
    const blob = new Blob([body], { type: "text/plain" });
    if (navigator.sendBeacon?.(endpoint, blob)) return;
    void fetch(endpoint, { method: "POST", body, keepalive: true, credentials: "include", headers: { "Content-Type": "text/plain" } }).catch(
      () => {},
    );
  } catch {
    /* 送れない環境 */
  }
}
