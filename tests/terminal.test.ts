import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { placeAt, worldJoints, type Layout, type Piece } from "../src/lib/geometry";
import { findConnectors } from "../src/lib/modules";
import { signHandoff, verifyHandoff } from "../src/lib/terminalLink";
import { safeNext, terminalConfig } from "../src/lib/server/terminal";
import { assemble, assemblyProblems } from "../terminal/src/lib/assembly";
import { safePath } from "../terminal/src/lib/paths";
import { createSession, readSession } from "../terminal/src/lib/session";
import {
  closeStore,
  connectablePosts,
  createPost,
  createSet,
  deletePost,
  getPost,
  getSet,
  listPosts,
  listSets,
  openStore,
  recentCount,
} from "../terminal/src/lib/store";
import { parsePostInput, parseSetInput } from "../terminal/src/lib/validate";

const SECRET = "x".repeat(40);

function line(y: number, startX: number, parts: string[], prefix: string): Piece[] {
  const out: Piece[] = [];
  let joint = { x: startX, y, deg: 0 };
  parts.forEach((id, i) => {
    const p = placeAt(`kato:${id}`, false, 0, joint, `${prefix}${i}`);
    out.push(p);
    joint = worldJoints(p)[1];
  });
  return out;
}

// 端から 31mm（すき間 62mm は S62 一本で埋まる）
const moduleLayout = (title = "直線モジュール"): Layout => ({
  title,
  maker: "kato",
  description: "",
  board: { width: 682, height: 300 },
  pieces: line(150, 31, ["S248", "S248", "S124"], "a"),
});

describe("terminal: login handoff", () => {
  it("accepts a fresh token with the same state", () => {
    const t = signHandoff({ sub: "u1", name: "taro", role: "user" }, "state-abcdefghijklmnop", SECRET);
    expect(verifyHandoff(t, "state-abcdefghijklmnop", SECRET)).toEqual({ sub: "u1", name: "taro", role: "user" });
  });

  it("refuses another state, another key, a changed body and an old token", () => {
    const now = Date.now();
    const t = signHandoff({ sub: "u1", name: "taro", role: "user" }, "s".repeat(20), SECRET, now);
    expect(verifyHandoff(t, "t".repeat(20), SECRET, now)).toBeNull();
    expect(verifyHandoff(t, "s".repeat(20), "y".repeat(40), now)).toBeNull();
    const [body, mac] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), role: "admin" })).toString("base64url");
    expect(verifyHandoff(`${forged}.${mac}`, "s".repeat(20), SECRET, now)).toBeNull();
    expect(verifyHandoff(t, "s".repeat(20), SECRET, now + 61_000)).toBeNull();
    expect(verifyHandoff(t, "", SECRET, now)).toBeNull();
  });

  it("refuses a short key", () => {
    expect(() => signHandoff({ sub: "u", name: "n", role: "user" }, "s".repeat(20), "short")).toThrow();
    expect(verifyHandoff("a.b", "s".repeat(20), "short")).toBeNull();
  });

  it("keeps the terminal session for 7 days and marks admins", () => {
    const now = Date.now();
    const s = createSession({ sub: "u1", name: "hanako", role: "admin" }, SECRET, now);
    expect(readSession(s, SECRET, now)).toEqual({ sub: "u1", name: "hanako", role: "admin", admin: true });
    expect(readSession(s, SECRET, now + 8 * 86400_000)).toBeNull();
    expect(readSession(s, "z".repeat(40), now)).toBeNull();
  });

  it("only returns to paths on the same site", () => {
    for (const bad of ["https://evil.example/", "//evil.example", "/\\evil.example", "", null]) {
      expect(safeNext(bad)).toBe("/");
      expect(safePath(bad)).toBe("/");
    }
    expect(safeNext("/api/terminal/handoff?state=abc")).toBe("/api/terminal/handoff?state=abc");
    expect(safePath("/connect?resume=1")).toBe("/connect?resume=1");
  });
});

describe("terminal: platform config", () => {
  const keys = ["SENROLAB_TERMINAL_URL", "SENROLAB_TERMINAL_SECRET", "SENROLAB_SHARE_URL", "SENROLAB_SHARE_SECRET"];
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
  });
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("reads the new names, and the old SENROLAB_SHARE_* names from before the rename", () => {
    expect(terminalConfig()).toBeNull();
    process.env.SENROLAB_SHARE_URL = "https://share.example.jp/";
    process.env.SENROLAB_SHARE_SECRET = SECRET;
    expect(terminalConfig()).toEqual({ url: "https://share.example.jp", secret: SECRET });
    process.env.SENROLAB_TERMINAL_URL = "https://terminal.example.jp";
    expect(terminalConfig()?.url).toBe("https://terminal.example.jp");
  });
});

describe("terminal: input", () => {
  it("accepts a SenroLab layout and refuses broken ones", () => {
    expect(parsePostInput({ title: " 直線 ", layout: moduleLayout() })).toMatchObject({ ok: true, value: { title: "直線" } });
    expect(parsePostInput({ title: "", layout: moduleLayout() }).ok).toBe(false);
    expect(parsePostInput({ title: "x", layout: { ...moduleLayout(), pieces: [{ uid: "a", partId: "kato:NOPE", x: 0, y: 0, rot: 0 }] } }).ok).toBe(false);
    expect(parsePostInput({ title: "x", layout: { ...moduleLayout(), board: { width: Infinity, height: 300 } } }).ok).toBe(false);
    expect(parsePostInput({ title: "x".repeat(81), layout: moduleLayout() }).ok).toBe(false);
  });

  it("checks set modules", () => {
    const m = { postId: "labcdefghij", placement: { x: 0, y: 0, rot: 0 } };
    expect(parseSetInput({ title: "s", modules: [m, { ...m, placement: { x: 682, y: 0, rot: 90 } }] }).ok).toBe(true);
    expect(parseSetInput({ title: "s", modules: [m] }).ok).toBe(false);
    expect(parseSetInput({ title: "s", modules: [m, { ...m, placement: { x: 0, y: 0, rot: 45 } }] }).ok).toBe(false);
    expect(parseSetInput({ title: "s", modules: [m, { ...m, postId: "../x" }] }).ok).toBe(false);
  });
});

const withOperation = (layout: Layout): Layout => ({
  ...layout,
  operation: {
    stationNames: { plat1: "東駅" },
    trains: [
      { id: "t1", name: "1列車", kind: "local", color: "#2f6fb5", cars: 40, speedKmh: 80, departSec: 0, laps: 1, stops: [{ stationId: "plat1", track: null, pass: false, dwellSec: 20 }] },
    ],
  },
});

describe("terminal: operation plans", () => {
  it("keeps the operation plan with the post, normalized", () => {
    const r = parsePostInput({ title: "ダイヤつき", layout: withOperation(moduleLayout()) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.layout.operation?.trains).toHaveLength(1);
    // 両数は上限（16両）にそろえる
    expect(r.value.layout.operation?.trains[0].cars).toBe(16);
    expect(r.value.layout.operation?.stationNames).toEqual({ plat1: "東駅" });
  });

  it("drops an empty or broken operation plan", () => {
    const empty = parsePostInput({ title: "x", layout: { ...moduleLayout(), operation: { stationNames: {}, trains: [] } } });
    expect(empty.ok && empty.value.layout.operation).toBe(undefined);
    const broken = parsePostInput({ title: "x", layout: { ...moduleLayout(), operation: "nope" } });
    expect(broken.ok && broken.value.layout.operation).toBe(undefined);
  });

  it("merges each board's trains with their stations renamed like the platforms", () => {
    const posts = [
      { id: "A", title: "A", ownerName: "a", layout: withOperation(moduleLayout()), connectors: [] },
      { id: "B", title: "B", ownerName: "b", layout: withOperation(moduleLayout()), connectors: [] },
    ].map((p) => ({ ...p, connectors: findConnectors(p.layout) }));
    const merged = assemble(
      "つないだ",
      [
        { postId: "A", placement: { x: 0, y: 0, rot: 0 } },
        { postId: "B", placement: { x: 682, y: 0, rot: 0 } },
      ],
      posts,
    );
    expect(merged.layout.operation?.trains.map((t) => t.id)).toEqual(["m0_t1", "m1_t1"]);
    expect(merged.layout.operation?.trains[1].stops[0].stationId).toBe("m1_plat1");
    expect(merged.layout.operation?.stationNames).toEqual({ m0_plat1: "東駅", m1_plat1: "東駅" });
  });
});

describe("terminal: store", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "terminal-"));
  });
  afterEach(() => {
    closeStore(dir);
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves posts with their connectors and finds them", () => {
    const db = openStore(dir);
    const a = createPost(db, { id: "u1", name: "taro" }, { title: "直線A", description: "駅の手前", layout: moduleLayout() });
    createPost(db, { id: "u2", name: "jiro" }, { title: "TOMIXの円", description: "", layout: { ...moduleLayout(), maker: "tomix", board: { width: 1200, height: 300 }, pieces: [placeAt("tomix:S280", false, 0, { x: 350, y: 150, deg: 0 }, "t")] } });
    expect(a.connectors).toHaveLength(2);
    expect(getPost(db, a.id)?.layout.title).toBe("直線A");
    expect(listPosts(db).total).toBe(2);
    expect(listPosts(db, { q: "駅" }).posts.map((p) => p.id)).toEqual([a.id]);
    expect(listPosts(db, { q: "100%" }).total).toBe(0);
    expect(listPosts(db, { maker: "tomix" }).total).toBe(1);
    expect(listPosts(db, { connectable: true }).posts.map((p) => p.id)).toEqual([a.id]);
    expect(connectablePosts(db, "kato").map((p) => p.id)).toEqual([a.id]);
    expect(recentCount(db, "posts", "u1")).toBe(1);
  });

  it("counts trains, filters by them, and adds the column to an older database", () => {
    const db = openStore(dir);
    const parsed = parsePostInput({ title: "ダイヤつき", layout: withOperation(moduleLayout()) });
    if (!parsed.ok) throw new Error(parsed.error);
    const a = createPost(db, { id: "u1", name: "taro" }, parsed.value);
    createPost(db, { id: "u1", name: "taro" }, { title: "なし", description: "", layout: moduleLayout() });
    expect(getPost(db, a.id)?.trainCount).toBe(1);
    expect(listPosts(db, { withOperation: true }).posts.map((p) => p.id)).toEqual([a.id]);
    closeStore(dir);
    // 列を消した古い形にして開き直すと、レイアウトの中から数え直す
    const raw = new DatabaseSync(path.join(dir, "terminal.sqlite"));
    raw.exec("ALTER TABLE posts DROP COLUMN train_count");
    raw.close();
    const again = openStore(dir);
    expect(getPost(again, a.id)?.trainCount).toBe(1);
    expect(listPosts(again, { withOperation: true }).total).toBe(1);
  });

  it("moves the data file from before the rename (share.sqlite) to terminal.sqlite", () => {
    const db = openStore(dir);
    const a = createPost(db, { id: "u1", name: "taro" }, { title: "旧名のまま", description: "", layout: moduleLayout() });
    closeStore(dir);
    renameSync(path.join(dir, "terminal.sqlite"), path.join(dir, "share.sqlite"));
    const again = openStore(dir);
    expect(getPost(again, a.id)?.title).toBe("旧名のまま");
    expect(existsSync(path.join(dir, "share.sqlite"))).toBe(false);
  });

  it("saves a set of connected posts and merges it into one layout", () => {
    const db = openStore(dir);
    const a = createPost(db, { id: "u1", name: "taro" }, { title: "A", description: "", layout: moduleLayout() });
    const b = createPost(db, { id: "u2", name: "jiro" }, { title: "B", description: "", layout: moduleLayout() });
    const modules = [
      { postId: a.id, placement: { x: 0, y: 0, rot: 0 } },
      { postId: b.id, placement: { x: 682, y: 0, rot: 0 } },
    ];
    const posts = [getPost(db, a.id)!, getPost(db, b.id)!];
    expect(assemblyProblems(modules, posts)).toEqual([]);
    // 離して置くとつながっていない
    expect(assemblyProblems([modules[0], { ...modules[1], placement: { x: 900, y: 0, rot: 0 } }], posts)).toContain("どこにもつながっていないボードがあります");
    // 重ねて置くと重なり
    expect(assemblyProblems([modules[0], { ...modules[1], placement: { x: 300, y: 0, rot: 0 } }], posts)).toContain("重なっているボードがあります");
    const set = createSet(db, { id: "u3", name: "saburo" }, { title: "つないだ", description: "", modules });
    expect(getSet(db, set.id)?.modules).toEqual(modules);
    expect(listSets(db, { postId: b.id }).map((s) => s.id)).toEqual([set.id]);
    const merged = assemble("つないだ", modules, posts);
    expect(merged.layout.pieces.filter((p) => p.uid.startsWith("fill")).map((p) => p.partId)).toEqual(["kato:S62"]);
    // 投稿を消すと、つないだレイアウトでは欠ける
    deletePost(db, b.id);
    const after = assemble("つないだ", modules, [getPost(db, a.id)!]);
    expect(after.missing).toBe(1);
  });
});
