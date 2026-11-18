import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_IDS,
  FEEDBACK_FEATURES,
  FEEDBACK_TITLE_MAX,
  type FeedbackCategory,
  type FeedbackView,
} from "@/lib/feedback";
import type { Env, StoreData, StoredFeedback, StoredUser } from "./store";

/**
 * 改善リクエスト。
 * ログインした人が画面から送り、サーバーに保存してから GitHub の Issue にする。
 * リポジトリは公開なので、Issue にはユーザー名・メールアドレスなど送った人がわかる情報を載せない（だれが送ったかは管理画面でだけ見られる）。
 *
 * 環境変数
 * - NINEGAGE_FEEDBACK_GITHUB_TOKEN … Issue を作るトークン（fine-grained、対象リポジトリだけ、Issues: Read and write）。未設定なら保存だけ
 * - NINEGAGE_FEEDBACK_GITHUB_REPO  … 起票先（既定 UeEmon/Nine-Gage-Systems）
 */

export const DEFAULT_FEEDBACK_REPO = "UeEmon/Nine-Gage-Systems";
/** Issue に付けるラベル。どれから来たかがわかるように */
export const FEEDBACK_LABEL = "改善リクエスト";
const CATEGORY_LABEL: Record<FeedbackCategory, string | undefined> = { feature: "enhancement", bug: "bug", other: undefined };

/** 1人あたりの送信の上限 */
export const FEEDBACK_PER_HOUR = 5;
export const FEEDBACK_PER_DAY = 20;
/** サーバーに残す件数（古いものから消す） */
export const MAX_FEEDBACK = 2000;

export class FeedbackError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export const FeedbackInputSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORY_IDS as [FeedbackCategory, ...FeedbackCategory[]]),
  feature: z
    .string()
    .max(50)
    .optional()
    .refine((v) => !v || FEEDBACK_FEATURES.some((f) => f.id === v), "機能区分が正しくありません。"),
  title: z.string().trim().min(1, "件名を書いてください。").max(FEEDBACK_TITLE_MAX, `件名は${FEEDBACK_TITLE_MAX}文字までです。`),
  body: z.string().trim().min(1, "内容を書いてください。").max(FEEDBACK_BODY_MAX, `内容は${FEEDBACK_BODY_MAX}文字までです。`),
});
export type FeedbackInput = z.infer<typeof FeedbackInputSchema>;

export type GithubConfig = { token: string; repo: string };

export function githubConfig(env: Env = process.env): GithubConfig | null {
  const token = env.NINEGAGE_FEEDBACK_GITHUB_TOKEN?.trim();
  if (!token) return null;
  const repo = env.NINEGAGE_FEEDBACK_GITHUB_REPO?.trim() || DEFAULT_FEEDBACK_REPO;
  if (!/^[A-Za-z0-9-]+\/(?!\.\.?$)[\w.-]+$/.test(repo)) return null;
  return { token, repo };
}

/**
 * 公開の Issue に載せる前に、本文を無害にする。
 * - メールアドレスは伏せる（うっかり書いた個人情報を公開しない）
 * - @ユーザー名 はメンションにならないようにする（GitHub の利用者に通知が飛ばないように）
 */
export function sanitizeForIssue(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "（メールアドレスは省略）")
    .replace(/@(?=[A-Za-z0-9])/g, "@​")
    .replace(/\r\n?/g, "\n");
}

/** 送信の上限を超えていればエラー（保存したリクエストの日時で数えるので、再起動しても続く） */
export function checkFeedbackLimit(data: StoreData, userId: string, now = Date.now()) {
  const times = data.feedback.filter((f) => f.userId === userId).map((f) => Date.parse(f.createdAt));
  if (times.filter((t) => now - t < 3600_000).length >= FEEDBACK_PER_HOUR) {
    throw new FeedbackError(`送信は1時間に${FEEDBACK_PER_HOUR}件までです。しばらくしてからお送りください。`, 429);
  }
  if (times.filter((t) => now - t < 86400_000).length >= FEEDBACK_PER_DAY) {
    throw new FeedbackError(`送信は1日に${FEEDBACK_PER_DAY}件までです。明日またお送りください。`, 429);
  }
}

export function newFeedback(userId: string, input: FeedbackInput, now = Date.now()): StoredFeedback {
  return {
    id: randomUUID(),
    userId,
    category: input.category,
    ...(input.feature ? { feature: input.feature } : {}),
    title: input.title,
    body: input.body,
    createdAt: new Date(now).toISOString(),
  };
}

/** 受付番号（Issue と管理画面の突き合わせ用。送った人はわからない） */
export function receiptOf(f: Pick<StoredFeedback, "id">) {
  return f.id.slice(0, 8);
}

/** Issue の件名・本文・ラベル。機能区分は本文の先頭に書き、Issue 用のワークフローがラベルと担当者を付ける */
export function buildIssue(f: StoredFeedback): { title: string; body: string; labels: string[] } {
  const feature = FEEDBACK_FEATURES.find((x) => x.id === f.feature);
  const lines = [
    `### 機能区分`,
    feature ? `${feature.name}（feature:${feature.id}）` : "わからない・複数にまたがる",
    "",
    `### 種類`,
    FEEDBACK_CATEGORIES[f.category],
    "",
    `### 内容`,
    sanitizeForIssue(f.body),
    "",
    "---",
    `SenroLab のアプリ内の「改善リクエスト」から送られました（受付番号 ${receiptOf(f)}、${f.createdAt.slice(0, 10)}）。送った人の情報は載せていません。`,
  ];
  const label = CATEGORY_LABEL[f.category];
  return {
    title: sanitizeForIssue(f.title).replace(/\n/g, " "),
    body: lines.join("\n"),
    labels: label ? [FEEDBACK_LABEL, label] : [FEEDBACK_LABEL],
  };
}

type Fetch = typeof fetch;

/** GitHub に Issue を作る。ラベルが付けられずに断られたら、ラベルなしでもう一度だけ試す */
export async function createGithubIssue(
  f: StoredFeedback,
  config: GithubConfig,
  fetchImpl: Fetch = fetch,
): Promise<{ number: number; url: string }> {
  const issue = buildIssue(f);
  const send = (payload: object) =>
    fetchImpl(`https://api.github.com/repos/${config.repo}/issues`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "SenroLab-feedback",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  let res = await send(issue);
  if (res.status === 422) res = await send({ title: issue.title, body: issue.body });
  if (!res.ok) {
    const detail = ((await res.json().catch(() => ({}))) as { message?: string }).message ?? "";
    throw new Error(`GitHub が ${res.status} を返しました${detail ? `（${detail.slice(0, 200)}）` : ""}`);
  }
  const json = (await res.json()) as { number?: unknown; html_url?: unknown };
  if (typeof json.number !== "number" || typeof json.html_url !== "string") throw new Error("GitHub の応答が読めません。");
  return { number: json.number, url: json.html_url };
}

/** Issue にした結果を保存した1件に書き込む */
export function recordIssueResult(data: StoreData, id: string, result: { number: number; url: string } | { error: string }) {
  const f = data.feedback.find((x) => x.id === id);
  if (!f) return;
  if ("error" in result) {
    f.error = result.error.slice(0, 300);
  } else {
    f.issue = { number: result.number, url: result.url };
    delete f.error;
  }
}

export function addFeedback(data: StoreData, f: StoredFeedback) {
  data.feedback.push(f);
  if (data.feedback.length > MAX_FEEDBACK) data.feedback.splice(0, data.feedback.length - MAX_FEEDBACK);
}

function view(f: StoredFeedback): FeedbackView {
  return {
    id: f.id,
    category: f.category,
    feature: f.feature,
    title: f.title,
    body: f.body,
    createdAt: f.createdAt,
    issueNumber: f.issue?.number,
    issueUrl: f.issue?.url,
  };
}

/** 自分が送った分（新しい順） */
export function feedbackFor(data: StoreData, user: StoredUser): FeedbackView[] {
  return data.feedback
    .filter((f) => f.userId === user.id)
    .map(view)
    .reverse();
}

/** 管理画面: 全員の分（新しい順、送った人と登録できなかった理由つき） */
export function adminFeedback(data: StoreData, limit = 200): FeedbackView[] {
  const names = new Map(data.users.map((u) => [u.id, u.username]));
  return data.feedback
    .slice(-limit)
    .reverse()
    .map((f) => ({ ...view(f), error: f.error, username: names.get(f.userId) ?? "（削除されたユーザー）" }));
}
