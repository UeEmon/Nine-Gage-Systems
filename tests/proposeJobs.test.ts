import { describe, expect, it } from "vitest";
import { getProposeJob, JOB_KEEP_MS, startProposeJob } from "@/lib/server/proposeJobs";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("AI提案のバックグラウンド作業", () => {
  it("作業中は running、終わると応答の中身と状態コードを返す", async () => {
    let finish: (r: Response) => void = () => {};
    const id = startProposeJob("u1", () => new Promise<Response>((r) => (finish = r)));
    expect(getProposeJob("u1", id)?.status).toBe("running");
    finish(Response.json({ patterns: [1] }, { status: 200 }));
    await tick();
    await tick();
    const s = getProposeJob("u1", id);
    expect(s).toMatchObject({ status: "done", httpStatus: 200, body: { patterns: [1] } });
  });

  it("失敗した応答（422など）もそのまま返す", async () => {
    const id = startProposeJob("u1", async () => Response.json({ error: "だめ" }, { status: 422 }));
    await tick();
    await tick();
    expect(getProposeJob("u1", id)).toMatchObject({ status: "done", httpStatus: 422, body: { error: "だめ" } });
  });

  it("例外は 500 のエラーにする", async () => {
    const id = startProposeJob("u1", async () => {
      throw new Error("boom");
    });
    await tick();
    await tick();
    expect(getProposeJob("u1", id)).toMatchObject({ status: "done", httpStatus: 500 });
  });

  it("他人の作業は見えない", () => {
    const id = startProposeJob("u1", () => new Promise<Response>(() => {}));
    expect(getProposeJob("u2", id)).toBeUndefined();
    expect(getProposeJob("u1", "no-such-id")).toBeUndefined();
  });

  it("終わってから時間がたった作業は片付ける", async () => {
    let now = 1_000;
    const clock = () => now;
    const id = startProposeJob("u1", async () => Response.json({}), clock);
    await tick();
    await tick();
    now += JOB_KEEP_MS + 1;
    startProposeJob("u1", () => new Promise<Response>(() => {}), clock);
    expect(getProposeJob("u1", id)).toBeUndefined();
  });
});
