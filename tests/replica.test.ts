import { describe, expect, it, vi } from "vitest";
import { FIT_MARGIN_MM, fitBoard, lineProblems, proposeLayout, sessionOptions, systemPrompt } from "../src/lib/ai";
import { analyze, worldSamples } from "../src/lib/geometry";
import type { ChatSession } from "../src/lib/llm/types";
import { buildFromPlan, planSchemaFor, type LayoutPlan } from "../src/lib/plan";
import { toPatternFile, parsePatternFile } from "../src/lib/patternFile";
import { isSimObject, replicaRequest, SIZE_LIMITS, type PlanReplica } from "../src/lib/replica";
import { p as pc, sidingPlan } from "./fixtures";

const board = { width: 1400, height: 800 };

function fakeSession(outputs: unknown[]) {
  const prompts: string[] = [];
  const session: ChatSession = {
    ask: vi.fn(async (text: string) => {
      prompts.push(text);
      const json = outputs.shift() ?? null;
      return { json, text: JSON.stringify(json) };
    }),
  };
  return { session, prompts };
}

const replica = (objects: PlanReplica["objects"]): PlanReplica => ({
  target: "テスト線",
  features: ["複線", "長いトンネル"],
  lines: [],
  objects,
});

// 区間0の部品1は (300,120) から右向きに進んだ所の直線 S248
const tunnel = { name: "テストトンネル", kind: "tunnel" as const, segment: 0, piece: 1, side: "L" as const, length: 186, width: 60, height: 40, note: "山を貫く長いトンネル" };

function withReplica(objects: PlanReplica["objects"]): LayoutPlan {
  return { ...sidingPlan(), replica: replica(objects) };
}

describe("再現してみた: 仮オブジェクトの配置", () => {
  it("トンネルは線路をまたぐ（部品の中央に置く）", () => {
    const b = buildFromPlan(withReplica([tunnel]));
    expect(b.errors).toEqual([]);
    expect(b.sims).toHaveLength(1);
    const s = b.sims[0];
    const host = b.pieces.find((p) => p.uid === s.host)!;
    expect(host).toBeTruthy();
    // 右向きの直線の中央（線路の上）
    expect(s.y).toBeCloseTo(120, 0);
    expect(s.x).toBeGreaterThan(300);
    expect(host.partId).toContain("S248");
    expect(s.kind).toBe("tunnel");
  });

  it("建物は線路から離して、指定した側に置く", () => {
    const left = buildFromPlan(withReplica([{ ...tunnel, kind: "landmark", name: "名所", width: 40 }])).sims[0];
    const right = buildFromPlan(withReplica([{ ...tunnel, kind: "landmark", name: "名所", width: 40, side: "R" }])).sims[0];
    // 右向きに進むので、左は画面の上（y が小さい）
    expect(left.y).toBeLessThan(120 - 20);
    expect(right.y).toBeGreaterThan(120 + 20);
  });

  it("ポイントの上では直進側のまんなかに置く", () => {
    const s = buildFromPlan(withReplica([{ ...tunnel, piece: 0 }])).sims[0];
    expect(s.y).toBeCloseTo(120, 0);
    expect(s.x).toBeGreaterThan(300);
  });

  it("ない部品を指定するとAIへの指摘になる", () => {
    const b = buildFromPlan(withReplica([{ ...tunnel, segment: 9 }]));
    expect(b.sims).toHaveLength(0);
    expect(b.errors.join("\n")).toContain("仮オブジェクト0");
  });

  it("大きさは範囲内に収める", () => {
    const s = buildFromPlan(withReplica([{ ...tunnel, length: 99999, width: -5, height: Number.NaN }])).sims[0];
    expect(s.length).toBe(SIZE_LIMITS.length[1]);
    expect(s.width).toBe(SIZE_LIMITS.width[0]);
    expect(s.height).toBe(SIZE_LIMITS.height[0]);
    expect(isSimObject(s)).toBe(true);
  });

  it("再現なしの計画では仮オブジェクトはない", () => {
    expect(buildFromPlan(sidingPlan()).sims).toEqual([]);
  });
});

describe("再現してみた: AIへの指示", () => {
  it("再現モードだけ、スキーマに replica が必須で入り、プロンプトに再現の説明が入る", () => {
    expect(planSchemaFor("kato", true).safeParse(sidingPlan()).success).toBe(false);
    expect(planSchemaFor("kato", true).safeParse(withReplica([tunnel])).success).toBe(true);
    expect(planSchemaFor("kato").safeParse(sidingPlan()).success).toBe(true);
    expect(systemPrompt("kato", true)).toContain("再現モード");
    expect(systemPrompt("kato")).not.toContain("再現モード");
    expect(sessionOptions("kato", true).system).not.toBe(sessionOptions("kato").system);
    // ふだんのプロンプトは変えない（プロンプトキャッシュを保つ）
    expect(systemPrompt("kato", true).startsWith(systemPrompt("kato"))).toBe(true);
  });

  it("路線名・駅名から要望の文を作る", () => {
    expect(replicaRequest({ kind: "line", name: "山手線" }, "")).toContain("路線「山手線」");
    expect(replicaRequest({ kind: "station", name: "東京駅" }, "周回したい")).toContain("駅「東京駅」の駅舎とホーム");
    expect(replicaRequest({ kind: "station", name: "東京駅" }, "周回したい")).toContain("追加の要望: 周回したい");
  });

  it("proposeLayout が仮オブジェクトと再現の内容を返す", async () => {
    const { session, prompts } = fakeSession([withReplica([tunnel])]);
    const res = await proposeLayout({ board, request: "", replica: { kind: "line", name: "テスト線" } }, session, "m");
    expect(prompts[0]).toContain("路線「テスト線」");
    expect(res.remainingProblems).toBeNull();
    expect(res.sims).toHaveLength(1);
    expect(res.replica).toEqual({ kind: "line", level: "standard", target: "テスト線", features: ["複線", "長いトンネル"] });
    expect(prompts[0]).toContain("再現度「標準」");
  });

  it("再現度ごとに指示が変わり、忠実モードは実物の配線どおりにさせる", async () => {
    const light = replicaRequest({ kind: "line", name: "山手線", level: "light" }, "");
    const faithful = replicaRequest({ kind: "station", name: "東京駅", level: "faithful" }, "");
    expect(light).toContain("「雰囲気」");
    expect(light).toContain("2〜4個まで");
    expect(faithful).toContain("「忠実」");
    expect(faithful).toContain("配線");
    expect(faithful).toContain("推測");
    expect(replicaRequest({ kind: "line", name: "山手線" }, "")).toContain("「標準」");

    const { session, prompts } = fakeSession([withReplica([tunnel])]);
    const res = await proposeLayout(
      { board, request: "", replica: { kind: "line", name: "テスト線", level: "faithful" } },
      session,
      "m",
    );
    expect(prompts[0]).toContain("再現度「忠実」");
    expect(prompts[0]).toContain("実物どおり");
    expect(res.replica?.level).toBe("faithful");
  });

  it("再現モードで replica がないと形式違いとして出し直させる", async () => {
    const { session, prompts } = fakeSession([sidingPlan(), withReplica([])]);
    const res = await proposeLayout({ board, request: "", replica: { kind: "station", name: "テスト駅" } }, session, "m");
    expect(prompts).toHaveLength(2);
    expect(res.replica?.target).toBe("テスト線");
  });

  it("ふだんのモードでは再現の結果は空", async () => {
    const { session } = fakeSession([sidingPlan()]);
    const res = await proposeLayout({ board, request: "待避線" }, session, "m");
    expect(res.sims).toEqual([]);
    expect(res.replica).toBeNull();
  });
});

describe("再現してみた: 保存", () => {
  it("仮オブジェクトはパターンファイルに書き出して読み戻せる", () => {
    const b = buildFromPlan(withReplica([tunnel]));
    const layout = {
      title: "t",
      description: "",
      board,
      pieces: b.pieces,
      accessories: b.accessories,
      sims: b.sims,
      replica: { kind: "line" as const, target: "テスト線", features: ["複線"] },
    };
    const file = toPatternFile([{ id: "a", name: "a", savedAt: new Date().toISOString(), layout }]);
    const back = parsePatternFile(JSON.stringify(file));
    expect(back[0].layout.sims).toEqual(b.sims);
    expect(back[0].layout.replica?.target).toBe("テスト線");
  });

  it("壊れた仮オブジェクトを含むパターンは読み込まない", () => {
    const b = buildFromPlan(sidingPlan());
    const layout = { title: "t", description: "", board, pieces: b.pieces, sims: [{ uid: "x", kind: "ufo" }] };
    const text = JSON.stringify(toPatternFile([{ id: "a", name: "a", savedAt: "", layout: layout as never }]));
    expect(() => parsePatternFile(text)).toThrow();
  });
});

describe("再現度「忠実」: ボードの大きさを制限しない", () => {
  it("はみ出しを問題にせず、できた形に合わせたボードを返す", async () => {
    // 小さなボードでは収まらない案でも、忠実なら出し直しにならない
    const small = { width: 300, height: 200 };
    const { session, prompts } = fakeSession([withReplica([tunnel])]);
    const res = await proposeLayout(
      { board: small, request: "", replica: { kind: "line", name: "テスト線", level: "faithful" }, unboundedBoard: true },
      session,
      "m",
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("ボードの大きさ: 制限なし");
    expect(res.remainingProblems).toBeNull();
    expect(res.board).toBeDefined();
    const b = res.board!;
    expect(b.width).toBeGreaterThan(small.width);
    expect(analyze({ board: b, pieces: res.pieces }).outOfBoard).toEqual([]);
    const xs = res.pieces.flatMap((p) => worldSamples(p).map((pt) => pt.x));
    expect(Math.min(...xs)).toBeCloseTo(FIT_MARGIN_MM, 0);
    for (const s of res.sims) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(b.width);
    }
  });

  it("制限しないときだけボードを返す", async () => {
    const { session } = fakeSession([withReplica([tunnel])]);
    const res = await proposeLayout({ board, request: "", replica: { kind: "line", name: "テスト線" } }, session, "m");
    expect(res.board).toBeUndefined();
  });

  it("fitBoard は全体を余白の内側へ移す", () => {
    const pieces = buildFromPlan(sidingPlan()).pieces.map((p) => ({ ...p, x: p.x - 5000, y: p.y - 3000 }));
    const f = fitBoard(pieces, [], []);
    const pts = f.pieces.flatMap((p) => worldSamples(p));
    expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(FIT_MARGIN_MM, 5);
    expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(FIT_MARGIN_MM, 5);
    expect(Math.max(...pts.map((p) => p.x))).toBeLessThanOrEqual(f.board.width - FIT_MARGIN_MM + 10);
    expect(f.board.width % 10).toBe(0);
  });
});

describe("複数の路線が乗り入れる駅", () => {
  it("駅名のときは乗り入れる路線をすべて再現するよう指示する", () => {
    expect(replicaRequest({ kind: "station", name: "新宿駅" }, "")).toContain("乗り入れる路線をそれぞれ再現");
    expect(systemPrompt("kato", true)).toContain("replica.lines");
    expect(replicaRequest({ kind: "station", name: "新宿駅", level: "faithful" }, "")).toContain("乗り入れる路線はすべて");
    expect(replicaRequest({ kind: "station", name: "新宿駅", level: "light" }, "")).toContain("主な2路線まで");
  });

  it("再現した路線を結果に入れる（路線名のときは入れない）", async () => {
    const plan = { ...withReplica([tunnel]), replica: { ...replica([tunnel]), lines: ["山手線", " 中央線 ", ""] } };
    const st = fakeSession([plan]);
    const res = await proposeLayout({ board, request: "", replica: { kind: "station", name: "テスト駅" } }, st.session, "m");
    expect(res.replica?.lines).toEqual(["山手線", "中央線"]);
    const ln = fakeSession([plan]);
    const res2 = await proposeLayout({ board, request: "", replica: { kind: "line", name: "テスト線" } }, ln.session, "m");
    expect(res2.replica?.lines).toBeUndefined();
  });

  it("lines がない出力も受け付ける", () => {
    const { lines: _omit, ...noLines } = replica([tunnel]);
    const parsed = planSchemaFor("kato", true).safeParse({ ...sidingPlan(), replica: noLines });
    expect(parsed.success).toBe(true);
  });
});

describe("乗り入れる路線をまとめない", () => {
  // 区間0・1は「A線」、区間2はつながらない別の線路の「B線」
  const twoLines = (): LayoutPlan => {
    const base = sidingPlan();
    const C = pc("R249-45", "R");
    return {
      ...base,
      segments: [
        { ...base.segments[0], line: "A線" },
        { ...base.segments[1], line: "A線" },
        { from: null, start: { x: 300, y: 700, heading: 0 }, line: "B線", pieces: [pc("S248"), C, C, C, C, pc("S248"), C, C, C, C] },
      ],
      replica: { ...replica([]), lines: ["A線", "B線"] },
    };
  };

  it("区間ごとの start で、つながらない別の線路を置ける", () => {
    const b = buildFromPlan(twoLines());
    expect(b.errors).toEqual([]);
    expect(b.index[2]).toHaveLength(10);
    const first = b.pieces.find((x) => x.uid === b.index[2][0])!;
    expect(first.y).toBeCloseTo(700, 0);
  });

  it("start がない from=null の区間1以降はエラー", () => {
    const plan = twoLines();
    plan.segments[2] = { ...plan.segments[2], start: null };
    expect(buildFromPlan(plan).errors.join()).toContain("start");
  });

  it("replica.lines の路線に区間がないと出し直させる", () => {
    const plan = twoLines();
    plan.segments[2] = { ...plan.segments[2], line: "A線" };
    const station = { kind: "station" as const, name: "テスト駅", level: "faithful" as const };
    expect(lineProblems(plan, station).join()).toContain("B線 の線路がありません");
    expect(lineProblems(twoLines(), station)).toEqual([]);
    // 「線」の有無や空白の違いは同じ路線とみなす
    const loose = twoLines();
    loose.segments[2] = { ...loose.segments[2], line: " B " };
    expect(lineProblems(loose, station)).toEqual([]);
    // 路線名のときは確かめない
    expect(lineProblems(plan, { kind: "line", name: "A線" })).toEqual([]);
    // 忠実で路線が空なら書かせる
    expect(lineProblems({ ...plan, replica: { ...replica([]), lines: [] } }, station).join()).toContain("replica.lines");
  });

  it("忠実の駅で路線をまとめた案は、出し直しを求める", async () => {
    const merged = twoLines();
    merged.segments[2] = { ...merged.segments[2], line: "A線" };
    const { session, prompts } = fakeSession([merged, twoLines()]);
    const res = await proposeLayout(
      { board: { width: 2000, height: 1200 }, request: "", replica: { kind: "station", name: "テスト駅", level: "faithful" } },
      session,
      "m",
    );
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("B線 の線路がありません");
    expect(res.remainingProblems).toBeNull();
    expect(res.replica?.lines).toEqual(["A線", "B線"]);
  });
});

describe("持ち時間（deadline）", () => {
  it("持ち時間を過ぎたら出し直さず、それまでの一番よい案を返す", async () => {
    const bad = { ...withReplica([tunnel]), segments: sidingPlan().segments.slice(0, 1) };
    const { session, prompts } = fakeSession([bad, withReplica([tunnel])]);
    const res = await proposeLayout(
      { board, request: "", replica: { kind: "line", name: "テスト線" }, deadline: Date.now() - 1 },
      session,
      "m",
    );
    expect(prompts).toHaveLength(1);
    expect(res.attempts).toBe(1);
  });

  it("持ち時間を過ぎて案が1つもなければ、分かる文で返す", async () => {
    const { session } = fakeSession([{ nope: true }, withReplica([tunnel])]);
    await expect(
      proposeLayout({ board, request: "", replica: { kind: "line", name: "テスト線" }, deadline: Date.now() - 1 }, session, "m"),
    ).rejects.toThrow("時間内に作れませんでした");
  });

  it("持ち時間内なら今までどおり出し直す", async () => {
    const bad = { ...withReplica([tunnel]), segments: sidingPlan().segments.slice(0, 1) };
    const { session, prompts } = fakeSession([bad, withReplica([tunnel])]);
    await proposeLayout(
      { board, request: "", replica: { kind: "line", name: "テスト線" }, deadline: Date.now() + 60_000 },
      session,
      "m",
    );
    expect(prompts).toHaveLength(2);
  });
});

describe("アップロードしたSTLモデル", () => {
  it("バイナリSTLを配置用に正規化し、JSON保存後も形を読み戻せる", async () => {
    const { parseStl, modelGeometry } = await import("../src/lib/object3d");
    const { isSimObject } = await import("../src/lib/replica");
    const bytes = new Uint8Array(134);
    const d = new DataView(bytes.buffer);
    d.setUint32(80, 1, true);
    [[0, 0, 0], [10, 0, 0], [0, 20, 30]].flat().forEach((v, i) => d.setFloat32(96 + i * 4, v, true));
    const g = parseStl(bytes.buffer);
    expect(g.boundingBox!.min.y).toBeCloseTo(0);
    expect(g.boundingBox!.max.y).toBeCloseTo(30);
    expect(g.boundingBox!.max.x - g.boundingBox!.min.x).toBeCloseTo(10);
    g.dispose();
    const model = { format: "stl" as const, data: Buffer.from(bytes).toString("base64") };
    const obj = { uid: "upload", name: "モデル", kind: "other", x: 20, y: 30, z: 40, rot: 90, length: 10, width: 20, height: 30, note: "説明", model };
    const { parsePatternFile } = await import("../src/lib/patternFile");
    const saved = parsePatternFile(JSON.stringify({ title: "モデル配置", board: { width: 900, height: 600 }, pieces: [], sims: [obj] }))[0].layout.sims![0];
    expect(saved).toEqual(obj);
    expect(isSimObject(saved)).toBe(true);
    expect(saved.model).toBeDefined();
    const restored = modelGeometry(saved.model!);
    expect(restored.getAttribute("position").count).toBe(3);
    restored.dispose();
    expect(isSimObject({ ...obj, model: { format: "obj", data: "bad" } })).toBe(false);
  });
  it("glTF（.glb）と OBJ（.mtl の色つき）も読み、底の中心を原点にする", async () => {
    const { loadModelObject, initialSizeMm, isUploadedModel, mtlColors } = await import("../src/lib/object3d");
    // 三角形1枚の .glb（x 0〜2, y 0〜1, z 0〜3）
    const pos = new Float32Array([0, 0, 0, 2, 0, 0, 0, 1, 3]);
    const json = new TextEncoder().encode(JSON.stringify({
      asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [2, 1, 3] }],
    }));
    const jsonPad = new Uint8Array(Math.ceil(json.length / 4) * 4).fill(0x20);
    jsonPad.set(json);
    const glb = new Uint8Array(12 + 8 + jsonPad.length + 8 + 36);
    const v = new DataView(glb.buffer);
    v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, glb.length, true);
    v.setUint32(12, jsonPad.length, true); v.setUint32(16, 0x4e4f534a, true); glb.set(jsonPad, 20);
    v.setUint32(20 + jsonPad.length, 36, true); v.setUint32(24 + jsonPad.length, 0x004e4942, true);
    glb.set(new Uint8Array(pos.buffer), 28 + jsonPad.length);
    const g = await loadModelObject({ format: "glb", data: Buffer.from(glb).toString("base64") });
    expect(g.size.map((x) => Math.round(x))).toEqual([2, 1, 3]);
    g.dispose();

    const obj = "v 0 0 0\nv 15 0 0\nv 15 6 30\nusemtl roof\nf 1 2 3\n";
    const mtl = "newmtl roof\nKd 0.5 0.1 0.1\n";
    expect(mtlColors(mtl)).toEqual({ roof: [0.5, 0.1, 0.1] });
    const model = { format: "obj" as const, data: Buffer.from(obj).toString("base64"), mtl };
    expect(isUploadedModel(model)).toBe(true);
    const o = await loadModelObject(model);
    expect(o.size).toEqual([15, 6, 30]);
    let color = "";
    o.object.traverse((x) => { const m = (x as import("three").Mesh).material as import("three").MeshStandardMaterial | undefined; if (m?.color) color = m.color.getHexString(); });
    expect(color).not.toBe("9ea8b5");
    o.dispose();
    // 実物の m は 1/150、STL は最長辺 100mm
    expect(initialSizeMm("obj", [15, 6, 30])).toEqual({ length: 100, height: 40, width: 200 });
    expect(initialSizeMm("stl", [10, 20, 50])).toEqual({ length: 20, height: 40, width: 100 });
    expect(isUploadedModel({ format: "stl", data: model.data, mtl })).toBe(false);
  });
  it("壊れたヘッダー、巨大な面数、空のモデルを拒否する", async () => {
    const { parseStl, MODEL_MAX_BYTES } = await import("../src/lib/object3d");
    expect(() => parseStl(new ArrayBuffer(0))).toThrow();
    expect(() => parseStl(new ArrayBuffer(MODEL_MAX_BYTES + 1))).toThrow();
    const broken = new ArrayBuffer(84);
    new DataView(broken).setUint32(80, 0xffffffff, true);
    expect(() => parseStl(broken)).toThrow();
    expect(() => parseStl(new TextEncoder().encode("solid empty\nendsolid empty").buffer)).toThrow();
  });
});
