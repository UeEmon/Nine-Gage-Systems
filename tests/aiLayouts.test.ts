import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AiLayoutStore, MAX_PER_USER } from "../src/lib/server/aiLayouts";
import { closeDb } from "../src/lib/server/db";

const summary = (title: string) => ({
  title,
  mode: "free",
  maker: "kato",
  target: null,
  board: { width: 1200, height: 600 },
  pieces: 10,
  model: "claude-opus-5-5",
  hint: null,
});

function store() {
  const dir = mkdtempSync(path.join(tmpdir(), "ng-ailayouts-"));
  let t = Date.parse("2026-11-17T00:00:00Z");
  return { dir, s: new AiLayoutStore(() => dir, () => new Date((t += 1000))) };
}

describe("AIで作ったレイアウトの自動保存", () => {
  it("同じ条件の最新を返し、再起動しても残る", () => {
    const { dir, s } = store();
    s.add("u1", "k1", summary("A"), { request: "x" }, { pieces: [1] });
    const b = s.add("u1", "k1", summary("B"), { request: "x" }, { pieces: [2] });
    s.add("u2", "k2", summary("C"), {}, { pieces: [3] });
    expect(s.find("u1", "k1")).toMatchObject({ id: b.id, title: "B", value: { pieces: [2] }, input: { request: "x" } });
    expect(s.find("u1", "k2")).toBeUndefined();
    expect(s.find("u2", "k1")).toBeUndefined();

    closeDb(dir);
    const again = new AiLayoutStore(() => dir);
    expect(again.list("u1").map((x) => x.title)).toEqual(["B", "A"]);
    expect(again.list("u1")[0]).not.toHaveProperty("value");
    expect(again.get("u1", b.id)?.value).toEqual({ pieces: [2] });
    expect(again.count()).toBe(3);
  });

  it("他の人のものは読めず消せない。ユーザー削除でまとめて消える", () => {
    const { s } = store();
    const a = s.add("u1", "k", summary("A"), {}, {});
    s.add("u1", "k2", summary("B"), {}, {});
    expect(s.get("u2", a.id)).toBeUndefined();
    expect(s.remove("u2", a.id)).toBe(0);
    expect(s.remove("u1", a.id)).toBe(1);
    expect(s.find("u1", "k")).toBeUndefined();
    expect(s.removeUser("u1")).toBe(1);
    expect(s.list("u1")).toEqual([]);
  });

  it(`1人${MAX_PER_USER}件までで、古いものから消える`, () => {
    const { s } = store();
    for (let i = 0; i < MAX_PER_USER + 5; i++) s.add("u1", `k${i}`, summary(`L${i}`), {}, {});
    s.add("u2", "k", summary("other"), {}, {});
    const list = s.list("u1");
    expect(list).toHaveLength(MAX_PER_USER);
    expect(list[0].title).toBe(`L${MAX_PER_USER + 4}`);
    expect(s.find("u1", "k0")).toBeUndefined();
    expect(s.find("u1", "k5")).toBeDefined();
    expect(s.list("u2")).toHaveLength(1);
  });
});
