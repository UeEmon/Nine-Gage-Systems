import { randomUUID } from "node:crypto";

/**
 * AI提案をバックグラウンドで作るための、実行中・完了した作業の置き場（このサーバーのメモリ上）。
 *
 * 忠実モードなど1回の応答に数分かかる提案は、1つのHTTPリクエストの中で待つと
 * サーバー（Node の requestTimeout 300秒）やブラウザ・プロキシが先に接続を切ってしまう。
 * そこで作業を受け付けたらすぐ id を返し、画面は数秒ごとに状態を問い合わせる。
 * 結果は自動保存（ai-layouts）にも残るので、サーバーが再起動して作業が消えても、作れた案は履歴から開ける。
 */

export type ProposeJobState =
  | { status: "running"; startedAt: number }
  | { status: "done"; startedAt: number; finishedAt: number; httpStatus: number; body: unknown };

type Job = { userId: string; state: ProposeJobState };

/** 終わった作業を取っておく時間（この間に画面が結果を取りに来る） */
export const JOB_KEEP_MS = 30 * 60 * 1000;

type Store = { jobs: Map<string, Job> };
// ルートごとに別のバンドルになっても同じ置き場を使うよう、globalThis に置く
const g = globalThis as unknown as { __ninegageProposeJobs?: Store };
const store: Store = (g.__ninegageProposeJobs ??= { jobs: new Map() });

function sweep(now: number) {
  for (const [id, job] of store.jobs) {
    if (job.state.status === "done" && now - job.state.finishedAt > JOB_KEEP_MS) store.jobs.delete(id);
  }
}

/** 作業を始めて id を返す。run は最終的な応答（JSON）を返す */
export function startProposeJob(userId: string, run: () => Promise<Response>, now: () => number = Date.now): string {
  sweep(now());
  const id = randomUUID();
  const job: Job = { userId, state: { status: "running", startedAt: now() } };
  store.jobs.set(id, job);
  const finish = (httpStatus: number, body: unknown) => {
    job.state = { status: "done", startedAt: job.state.startedAt, finishedAt: now(), httpStatus, body };
  };
  run()
    .then(async (res) => {
      const body = await res.json().catch(() => ({ error: "AI提案の結果を読み取れませんでした。" }));
      finish(res.status, body);
    })
    .catch((err) => {
      console.error("propose job failed", err);
      finish(500, { error: "AI提案の途中でエラーが起きました。少し時間をおいてお試しください。" });
    });
  return id;
}

/** 本人の作業の状態。見つからない（期限切れ・再起動・他人の作業）ときは undefined */
export function getProposeJob(userId: string, id: string): ProposeJobState | undefined {
  const job = store.jobs.get(id);
  if (!job || job.userId !== userId) return undefined;
  return job.state;
}
