import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RELEASES, type Release } from "../src/data/releases";
import {
  adminNotices,
  createNotice,
  deleteNotice,
  markNoticesRead,
  MAX_READ_IDS,
  NoticeError,
  NoticeInputSchema,
  noticesFor,
  releaseProblems,
  updateNotice,
} from "../src/lib/server/notices";
import { loadStore, newUser, updateStore, type StoreData } from "../src/lib/server/store";

const T0 = Date.parse("2026-11-10T00:00:00Z");
const day = 86400_000;

const releases: Release[] = [
  { id: "2026-11-12-new", date: "2026-11-12T00:00:00Z", title: "新しい機能", body: "本文" },
  { id: "2026-11-12-admin", date: "2026-11-12T01:00:00Z", title: "管理者向け", body: "", audience: "admin" },
  { id: "2026-11-01-old", date: "2026-11-01T00:00:00+09:00", title: "昔の機能", body: "" },
  { id: "2026-12-01-future", date: "2026-12-01T00:00:00Z", title: "まだ先", body: "" },
];

function store(): StoreData {
  const admin = { ...newUser("owner", "admin", "x"), createdAt: new Date(T0).toISOString() };
  const user = { ...newUser("alice", "user", "x"), createdAt: new Date(T0).toISOString() };
  return { version: 3, sessionSecret: "s".repeat(64), users: [admin, user], ai: { byProvider: {} }, notices: [], aiCost: { usdJpy: 150 }, sponsorPlan: { multiplier: 0.75, oneTimeDays: 30 }, sponsors: {}, feedback: [] };
}

describe("お知らせ", () => {
  it("リリースノートの書き方が正しい（id の重複なし・タイムゾーン付きの日時）", () => {
    expect(releaseProblems(RELEASES)).toEqual([]);
    expect(releaseProblems([{ id: "x", date: "2026-11-01", title: "", body: "" }])).toHaveLength(3);
  });

  it("公開済みで対象のものだけを新しい順に見せ、登録前のものは既読扱い", () => {
    const d = store();
    const now = T0 + 5 * day;
    const [admin, user] = d.users;
    const u = noticesFor(d, user, now, releases);
    expect(u.notices.map((n) => n.title)).toEqual(["新しい機能", "昔の機能"]);
    expect(u.notices.map((n) => n.unread)).toEqual([true, false]);
    expect(u.unread).toBe(1);
    const a = noticesFor(d, admin, now, releases);
    expect(a.notices.map((n) => n.title)).toEqual(["管理者向け", "新しい機能", "昔の機能"]);
    expect(a.unread).toBe(2);
  });

  it("既読はユーザーごと。ids を省くと全部既読", () => {
    const d = store();
    const now = T0 + 5 * day;
    const [admin, user] = d.users;
    expect(markNoticesRead(d, admin.id, undefined, now, releases).unread).toBe(0);
    expect(noticesFor(d, user, now, releases).unread).toBe(1);
    // 見えていない（管理者向け・未公開）お知らせは既読にしない
    markNoticesRead(d, user.id, ["release:2026-11-12-admin", "release:2026-12-01-future"], now, releases);
    expect(user.readNoticeIds ?? []).toEqual([]);
    markNoticesRead(d, user.id, ["release:2026-11-12-new"], now, releases);
    expect(noticesFor(d, user, now, releases).unread).toBe(0);
  });

  it("予約したお知らせは公開日時になってから出る", () => {
    const d = store();
    const [admin, user] = d.users;
    const at = new Date(T0 + 3 * day).toISOString();
    createNotice(d, NoticeInputSchema.parse({ title: "メンテナンス", body: "", audience: "all", publishedAt: at }), admin.id, T0 + day);
    expect(noticesFor(d, user, T0 + 2 * day, []).notices).toHaveLength(0);
    expect(adminNotices(d, T0 + 2 * day, [])[0]).toMatchObject({ scheduled: true, createdBy: "owner" });
    expect(noticesFor(d, user, T0 + 4 * day, []).unread).toBe(1);
  });

  it("管理者が登録したものは編集・削除でき、リリースノートの分は変えられない", () => {
    const d = store();
    const [admin, user] = d.users;
    const n = createNotice(d, { title: "お知らせ", body: "a", audience: "all" }, admin.id, T0 + day);
    markNoticesRead(d, user.id, [n.id], T0 + 2 * day, []);
    updateNotice(d, n.id, { title: "お知らせ（修正）", body: "b", audience: "all" });
    // 内容の修正では未読に戻さない
    expect(noticesFor(d, user, T0 + 2 * day, [])).toMatchObject({ unread: 0, notices: [{ title: "お知らせ（修正）" }] });
    deleteNotice(d, n.id);
    expect(d.notices).toHaveLength(0);
    expect(user.readNoticeIds).toEqual([]);
    expect(() => deleteNotice(d, "release:2026-11-12-new")).toThrow(NoticeError);
    expect(() => updateNotice(d, "nope", { title: "x", body: "", audience: "all" })).toThrow(NoticeError);
  });

  it("入力の検査", () => {
    expect(NoticeInputSchema.safeParse({ title: " ", body: "", audience: "all" }).success).toBe(false);
    expect(NoticeInputSchema.safeParse({ title: "a", body: "", audience: "everyone" }).success).toBe(false);
    expect(NoticeInputSchema.safeParse({ title: "a", body: "", audience: "all", publishedAt: "明日" }).success).toBe(false);
    expect(NoticeInputSchema.safeParse({ title: "a", body: "", audience: "all", publishedAt: "2026-11-20T09:00:00.000Z" }).success).toBe(true);
  });

  it("既読のIDは上限まで", () => {
    const d = store();
    const [admin, user] = d.users;
    for (let i = 0; i < MAX_READ_IDS + 20; i++) createNotice(d, { title: `n${i}`, body: "", audience: "all" }, admin.id, T0 + day);
    markNoticesRead(d, user.id, undefined, T0 + 2 * day, []);
    expect(user.readNoticeIds).toHaveLength(MAX_READ_IDS);
  });

  it("保存され、以前の形式（notices なし）も読める", async () => {
    const e = { NINEGAGE_DATA_DIR: mkdtempSync(path.join(tmpdir(), "ng-")), NINEGAGE_ADMIN_USER: "owner", NINEGAGE_ADMIN_PASSWORD: "first-password-123" };
    expect((await loadStore(e)).notices).toEqual([]);
    const owner = (await loadStore(e)).users[0];
    await updateStore((d) => createNotice(d, { title: "保存テスト", body: "", audience: "all" }, owner.id), e);
    await updateStore((d) => markNoticesRead(d, owner.id), e);
    const after = await loadStore(e);
    expect(after.notices[0].title).toBe("保存テスト");
    expect(after.users[0].readNoticeIds).toContain(after.notices[0].id);
  });
});
