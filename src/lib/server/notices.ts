import { randomUUID } from "node:crypto";
import { z } from "zod";
import { RELEASES, type Release } from "@/data/releases";
import { AUDIENCES, type Audience, type StoreData, type StoredNotice, type StoredUser } from "./store";

/**
 * 新機能のお知らせ。
 * - リリースノート（src/data/releases.ts）はアプリと一緒にデプロイされ、自動で出る
 * - 管理者が画面から登録したお知らせは store.json に保存する
 * 既読はユーザーごとに、お知らせのIDで持つ。ユーザー登録より前のお知らせは既読扱い。
 */

export const MAX_READ_IDS = 500;

export type Notice = {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  audience: Audience;
  source: "release" | "admin";
  unread: boolean;
};

/** 管理画面で見る形（予約中も含む） */
export type AdminNotice = Omit<Notice, "unread"> & { scheduled: boolean; createdBy?: string };

export class NoticeError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

type Base = Omit<Notice, "unread">;

function fromRelease(r: Release): Base {
  return {
    id: `release:${r.id}`,
    title: r.title,
    body: r.body,
    publishedAt: new Date(r.date).toISOString(),
    audience: r.audience ?? "all",
    source: "release",
  };
}

function fromStored(n: StoredNotice): Base {
  return { id: n.id, title: n.title, body: n.body, publishedAt: n.publishedAt, audience: n.audience, source: "admin" };
}

function allNotices(data: StoreData, releases: Release[]): Base[] {
  return [...releases.map(fromRelease), ...data.notices.map(fromStored)].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt),
  );
}

function visibleTo(n: Base, user: StoredUser) {
  return n.audience === "all" || user.role === "admin";
}

/** そのユーザーに見せるお知らせ（公開済みだけ、新しい順）と未読数 */
export function noticesFor(data: StoreData, user: StoredUser, now = Date.now(), releases = RELEASES) {
  const read = new Set(user.readNoticeIds ?? []);
  const since = user.createdAt;
  const notices: Notice[] = allNotices(data, releases)
    .filter((n) => visibleTo(n, user) && Date.parse(n.publishedAt) <= now)
    .map((n) => ({ ...n, unread: n.publishedAt > since && !read.has(n.id) }));
  return { notices, unread: notices.filter((n) => n.unread).length };
}

/** 既読にする。ids を省くと、いま見えているものを全部既読にする */
export function markNoticesRead(data: StoreData, userId: string, ids?: string[], now = Date.now(), releases = RELEASES) {
  const user = data.users.find((u) => u.id === userId);
  if (!user) throw new NoticeError("ユーザーが見つかりません。", 404);
  const { notices } = noticesFor(data, user, now, releases);
  const visible = new Set(notices.map((n) => n.id));
  const targets = (ids ?? notices.map((n) => n.id)).filter((id) => visible.has(id));
  const current = user.readNoticeIds ?? [];
  const add = targets.filter((id) => !current.includes(id));
  if (add.length > 0) user.readNoticeIds = [...add, ...current].slice(0, MAX_READ_IDS);
  return noticesFor(data, user, now, releases);
}

export function adminNotices(data: StoreData, now = Date.now(), releases = RELEASES): AdminNotice[] {
  const creators = new Map(data.users.map((u) => [u.id, u.username]));
  const stored = new Map(data.notices.map((n) => [n.id, n]));
  return allNotices(data, releases).map((n) => ({
    ...n,
    scheduled: Date.parse(n.publishedAt) > now,
    createdBy: n.source === "admin" ? (creators.get(stored.get(n.id)?.createdBy ?? "") ?? "（削除されたユーザー）") : undefined,
  }));
}

export const NoticeInputSchema = z.object({
  title: z.string().trim().min(1, "タイトルを入力してください。").max(100, "タイトルは100文字までです。"),
  body: z.string().trim().max(2000, "本文は2000文字までです。"),
  audience: z.enum(AUDIENCES),
  /** 省略なら今すぐ公開 */
  publishedAt: z.iso.datetime({ offset: true }).optional(),
});
export type NoticeInput = z.infer<typeof NoticeInputSchema>;

export function zodMessage(err: z.ZodError) {
  return err.issues[0]?.message ?? "入力が正しくありません。";
}

export function createNotice(data: StoreData, input: NoticeInput, createdBy: string, now = Date.now()): StoredNotice {
  const notice: StoredNotice = {
    id: randomUUID(),
    title: input.title,
    body: input.body,
    audience: input.audience,
    publishedAt: new Date(input.publishedAt ?? now).toISOString(),
    createdBy,
    createdAt: new Date(now).toISOString(),
  };
  data.notices.push(notice);
  return notice;
}

function findStored(data: StoreData, id: string) {
  if (id.startsWith("release:")) {
    throw new NoticeError("リリースノートのお知らせは src/data/releases.ts で変更してください。", 400);
  }
  const n = data.notices.find((x) => x.id === id);
  if (!n) throw new NoticeError("お知らせが見つかりません。", 404);
  return n;
}

/**
 * 編集。公開日時を変えたときは、既読を消さずに日時だけ変える
 * （内容を直しただけで全員に未読を出し直さないため）。
 */
export function updateNotice(data: StoreData, id: string, input: NoticeInput): StoredNotice {
  const n = findStored(data, id);
  n.title = input.title;
  n.body = input.body;
  n.audience = input.audience;
  if (input.publishedAt) n.publishedAt = new Date(input.publishedAt).toISOString();
  return n;
}

export function deleteNotice(data: StoreData, id: string) {
  findStored(data, id);
  data.notices = data.notices.filter((n) => n.id !== id);
  for (const u of data.users) {
    if (u.readNoticeIds?.includes(id)) u.readNoticeIds = u.readNoticeIds.filter((x) => x !== id);
  }
}

/** リリースノートの書き方の検査（テストで使う） */
export function releaseProblems(releases: Release[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of releases) {
    if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(r.id)) problems.push(`${r.id}: id の形式が違います`);
    if (seen.has(r.id)) problems.push(`${r.id}: id が重複しています`);
    seen.add(r.id);
    if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(r.date) || Number.isNaN(Date.parse(r.date))) {
      problems.push(`${r.id}: date はタイムゾーン付きの ISO 8601 にしてください`);
    }
    if (!r.title.trim()) problems.push(`${r.id}: title が空です`);
  }
  return problems;
}
