import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FEEDBACK_FEATURES } from "../src/lib/feedback";
import {
  addFeedback,
  adminFeedback,
  buildIssue,
  checkFeedbackLimit,
  createGithubIssue,
  FEEDBACK_LABEL,
  FEEDBACK_PER_DAY,
  FEEDBACK_PER_HOUR,
  FeedbackError,
  FeedbackInputSchema,
  feedbackFor,
  githubConfig,
  MAX_FEEDBACK,
  newFeedback,
  recordIssueResult,
  sanitizeForIssue,
} from "../src/lib/server/feedback";
import { loadStore, newUser, updateStore, type StoreData } from "../src/lib/server/store";

const T0 = Date.parse("2026-11-18T00:00:00Z");

function store(): StoreData {
  const alice = newUser("alice", "user", "x");
  const bob = newUser("bob", "ai", "x");
  return { version: 2, sessionSecret: "s".repeat(64), users: [alice, bob], ai: { byProvider: {} }, notices: [], aiCost: { usdJpy: 150 }, feedback: [] };
}

const input = { category: "feature" as const, feature: "editor", title: "曲線ポイントを反転したい", body: "左右を切り替えたい" };

describe("改善リクエスト", () => {
  it("入力を検査する（件名・内容は必須、機能区分は機能マップにあるものだけ）", () => {
    expect(FeedbackInputSchema.safeParse(input).success).toBe(true);
    expect(FeedbackInputSchema.safeParse({ ...input, feature: undefined }).success).toBe(true);
    expect(FeedbackInputSchema.safeParse({ ...input, title: "   " }).success).toBe(false);
    expect(FeedbackInputSchema.safeParse({ ...input, body: "x".repeat(4001) }).success).toBe(false);
    expect(FeedbackInputSchema.safeParse({ ...input, feature: "nope" }).success).toBe(false);
    expect(FeedbackInputSchema.safeParse({ ...input, category: "spam" }).success).toBe(false);
    expect(FEEDBACK_FEATURES.some((f) => f.id === "feedback")).toBe(true);
  });

  it("Issue には送った人の情報を載せず、メールアドレスを伏せ、メンションにならないようにする", () => {
    const d = store();
    const [alice] = d.users;
    const f = newFeedback(alice.id, { ...input, title: "@octocat へ", body: "連絡は alice@example.com まで。@someone も見て" }, T0);
    const issue = buildIssue(f);
    const text = issue.title + issue.body;
    expect(text).not.toContain("alice");
    expect(text).not.toContain(alice.id);
    expect(text).not.toContain("example.com");
    expect(text).toContain("（メールアドレスは省略）");
    expect(text).not.toMatch(/@[A-Za-z]/);
    expect(issue.labels).toEqual([FEEDBACK_LABEL, "enhancement"]);
    // 機能区分は本文の最初に出る（Issue 用のワークフローが最初の feature:… を読む）
    expect(issue.body.match(/feature:[a-z-]+/)?.[0]).toBe("feature:editor");
    expect(buildIssue({ ...f, category: "bug", feature: undefined }).labels).toEqual([FEEDBACK_LABEL, "bug"]);
    expect(buildIssue({ ...f, category: "other" }).labels).toEqual([FEEDBACK_LABEL]);
    expect(sanitizeForIssue("a\r\nb")).toBe("a\nb");
  });

  it("1人あたり1時間・1日の上限を超えると断る（ほかの人には影響しない）", () => {
    const d = store();
    const [alice, bob] = d.users;
    for (let i = 0; i < FEEDBACK_PER_HOUR; i++) addFeedback(d, newFeedback(alice.id, input, T0 + i * 1000));
    expect(() => checkFeedbackLimit(d, alice.id, T0 + 10_000)).toThrow(FeedbackError);
    expect(() => checkFeedbackLimit(d, bob.id, T0 + 10_000)).not.toThrow();
    expect(() => checkFeedbackLimit(d, alice.id, T0 + 3600_000 + 10_000)).not.toThrow();
    const e = store();
    for (let i = 0; i < FEEDBACK_PER_DAY; i++) addFeedback(e, newFeedback(alice.id, input, T0 + i * 3600_000 * 0.9));
    expect(() => checkFeedbackLimit(e, alice.id, T0 + 20 * 3600_000)).toThrow(/1日/);
  });

  it("古いものから消して上限の件数を保つ", () => {
    const d = store();
    for (let i = 0; i < MAX_FEEDBACK + 3; i++) addFeedback(d, newFeedback(d.users[0].id, input, T0));
    expect(d.feedback).toHaveLength(MAX_FEEDBACK);
  });

  it("自分の分だけを新しい順に見せ、管理者には送った人と失敗の理由も見せる", () => {
    const d = store();
    const [alice, bob] = d.users;
    const a1 = newFeedback(alice.id, input, T0);
    const a2 = newFeedback(alice.id, { ...input, title: "2件目" }, T0 + 1000);
    const b1 = newFeedback(bob.id, input, T0 + 2000);
    [a1, a2, b1].forEach((f) => addFeedback(d, f));
    recordIssueResult(d, a1.id, { number: 12, url: "https://github.com/x/y/issues/12" });
    recordIssueResult(d, a2.id, { error: "GitHub が 500 を返しました" });
    const mine = feedbackFor(d, alice);
    expect(mine.map((f) => f.title)).toEqual(["2件目", input.title]);
    expect(mine[1].issueNumber).toBe(12);
    expect(mine[0]).not.toHaveProperty("error", expect.anything());
    const all = adminFeedback(d);
    expect(all.map((f) => f.username)).toEqual(["bob", "alice", "alice"]);
    expect(all[1].error).toContain("500");
    // あとで成功したら理由は消える
    recordIssueResult(d, a2.id, { number: 13, url: "u" });
    expect(adminFeedback(d)[1].error).toBeUndefined();
  });

  it("トークンがなければ GitHub には送らない。起票先は既定のリポジトリ", () => {
    expect(githubConfig({})).toBeNull();
    expect(githubConfig({ NINEGAGE_FEEDBACK_GITHUB_TOKEN: "t" })).toEqual({ token: "t", repo: "UeEmon/Nine-Gage-Systems" });
    expect(githubConfig({ NINEGAGE_FEEDBACK_GITHUB_TOKEN: "t", NINEGAGE_FEEDBACK_GITHUB_REPO: "a/b" })?.repo).toBe("a/b");
    expect(githubConfig({ NINEGAGE_FEEDBACK_GITHUB_TOKEN: "t", NINEGAGE_FEEDBACK_GITHUB_REPO: "../x" })).toBeNull();
    expect(githubConfig({ NINEGAGE_FEEDBACK_GITHUB_TOKEN: "t", NINEGAGE_FEEDBACK_GITHUB_REPO: "a/.." })).toBeNull();
  });

  it("GitHub の API に Issue を作る。ラベルで断られたらラベルなしでもう一度試す", async () => {
    const f = newFeedback("u", input, T0);
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      if (calls.length === 1) return Response.json({ message: "Validation Failed" }, { status: 422 });
      return Response.json({ number: 7, html_url: "https://github.com/a/b/issues/7" }, { status: 201 });
    });
    const r = await createGithubIssue(f, { token: "secret", repo: "a/b" }, fetchMock as unknown as typeof fetch);
    expect(r).toEqual({ number: 7, url: "https://github.com/a/b/issues/7" });
    expect(calls[0].url).toBe("https://api.github.com/repos/a/b/issues");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    expect(JSON.parse(String(calls[0].init.body)).labels).toContain(FEEDBACK_LABEL);
    expect(JSON.parse(String(calls[1].init.body)).labels).toBeUndefined();

    const failing = vi.fn(async () => Response.json({ message: "Bad credentials" }, { status: 401 }));
    await expect(createGithubIssue(f, { token: "x", repo: "a/b" }, failing as unknown as typeof fetch)).rejects.toThrow(/401.*Bad credentials/);
  });

  it("保存して読み直しても残る（以前のデータには空の一覧が入る）", async () => {
    const env = { NINEGAGE_DATA_DIR: mkdtempSync(path.join(tmpdir(), "ng-feedback-")) };
    const before = await loadStore(env);
    expect(before.feedback).toEqual([]);
    await updateStore((d) => {
      d.users.push(newUser("carol", "user", "x"));
      addFeedback(d, newFeedback(d.users[0].id, input, T0));
    }, env);
    const after = await loadStore(env);
    expect(after.feedback).toHaveLength(1);
    expect(after.feedback[0].title).toBe(input.title);
  });
});
