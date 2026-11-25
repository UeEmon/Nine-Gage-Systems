import { describe, expect, it } from "vitest";
import { validLayout } from "../src/lib/patternFile";
import { canUseModels } from "../src/lib/roles";
import { defaultSizeMm, gltfUris, modelsFromEntries, parseMtl, parseRtmObjectConfig, readModelFiles, unitMm } from "../src/lib/models3d/pack";
import { isPlacedModel, placedCorners, scalePlaced, type PlacedModel } from "../src/lib/models3d/placed";
import { buildModelKit, buildPlacedModels, placeModel } from "../src/lib/models3d/three";
import { MM_PER_M } from "../src/lib/rtm/pack";
import { Box3, Vector3 } from "three";

const enc = (s: string) => new TextEncoder().encode(s);

/** テスト用の ZIP（無圧縮） */
function makeZip(files: { path: string; data: string | Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const data = typeof f.data === "string" ? enc(f.data) : f.data;
    const name = enc(f.path);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(6, 0x800, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(8, 0x800, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    chunks.push(new Uint8Array(local.buffer), name, data);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** 幅 4m・高さ 3m・奥行き 2m の箱（m） */
const BOX_OBJ = `mtllib house.mtl
o house
v -2 0 -1
v 2 0 -1
v 2 3 -1
v -2 3 -1
v -2 0 1
v 2 0 1
v 2 3 1
v -2 3 1
vt 0 0
vt 1 0
vt 1 1
usemtl wall
f 1/1 2/2 3/3 4/3
f 5/1 6/2 7/3 8/3
usemtl roof
f 4 3 7 8
f 1 2 6 5
`;
const BOX_MTL = `newmtl wall
Kd 0.9 0.8 0.7
map_Kd -s 1 1 1 textures/wall.png
newmtl roof
Kd 0.5 0.1 0.1
`;

describe("RealTrainMod の設置物の json", () => {
  it("ModelOrnament・ModelMachine の書き方を読む", () => {
    expect(parseRtmObjectConfig({ ornamentName: "街灯", ornamentType: "Lamp", model: { modelFile: "lamp.mqo", textures: [["default", "textures/lamp.png", ""]] } })).toEqual({
      name: "街灯",
      kind: "Lamp",
      modelFile: "lamp.mqo",
      textures: [{ material: "default", path: "textures/lamp.png", option: "" }],
    });
    expect(parseRtmObjectConfig({ name: "改札機", machineType: "Turnstile", model: { modelFile: "gate.obj", textures: [] } })?.kind).toBe("Turnstile");
    // 古い書き方（xxxModel と xxxTexture）
    expect(parseRtmObjectConfig({ signalName: "信号", signalModel: "sig.mqo", signalTexture: "sig.png" })?.textures[0].path).toBe("sig.png");
  });

  it("車両・レール・架線は読まない", () => {
    expect(parseRtmObjectConfig({ trainName: "E233", trainModel2: { modelFile: "a.mqo" } })).toBeNull();
    expect(parseRtmObjectConfig({ railName: "rail", model: { modelFile: "r.mqo" } })).toBeNull();
    expect(parseRtmObjectConfig({ wireName: "wire", model: { modelFile: "w.mqo" } })).toBeNull();
    expect(parseRtmObjectConfig({ name: "no model" })).toBeNull();
  });
});

describe("3D モデルのファイルを読む", () => {
  it("RTM の設置物パック（ZIP）からモデルとテクスチャを取り出し、中の .obj は単独で並べない", async () => {
    const zip = makeZip([
      { path: "assets/minecraft/models/ModelOrnament_lamp.json", data: `{ "ornamentName": "駅の街灯", ornamentType: "Lamp", "model": { "modelFile": "lamp.obj", "textures": [["default", "textures/lamp.png", ""]] } }` },
      { path: "assets/minecraft/models/lamp.obj", data: BOX_OBJ },
      { path: "assets/minecraft/textures/lamp.png", data: new Uint8Array([1, 2, 3]) },
    ]);
    const r = await readModelFiles([{ name: "lamps.zip", data: zip }]);
    expect(r.problems).toEqual([]);
    expect(r.models.map((m) => [m.name, m.format, m.kind])).toEqual([["駅の街灯", "rtm", "Lamp"]]);
    expect(Object.keys(r.models[0].files).sort()).toEqual(["assets/minecraft/models/lamp.obj", "assets/minecraft/textures/lamp.png"]);
  });

  it("RTM の車両パックは車両の読み込みのほうへ案内する", async () => {
    const zip = makeZip([
      { path: "ModelTrain_a.json", data: `{ "trainName": "test", "trainModel2": { "modelFile": "a.mqo", "textures": [] } }` },
      { path: "a.mqo", data: "Metasequoia Document" },
    ]);
    const r = await readModelFiles([{ name: "train.zip", data: zip }]);
    expect(r.models).toEqual([]);
    expect(r.problems[0]).toContain("RTMの車両");
  });

  it("OBJ は .mtl の色とテクスチャもいっしょに読む", async () => {
    const r = await readModelFiles([
      { name: "house.obj", path: "house/house.obj", data: enc(BOX_OBJ) },
      { name: "house.mtl", path: "house/house.mtl", data: enc(BOX_MTL) },
      { name: "wall.png", path: "house/textures/wall.png", data: new Uint8Array([1]) },
    ]);
    expect(r.problems).toEqual([]);
    const m = r.models[0];
    expect(m.format).toBe("obj");
    expect(m.colors?.roof).toEqual([0.5, 0.1, 0.1]);
    expect(m.textures).toEqual([{ material: "wall", path: "house/textures/wall.png", option: "" }]);
  });

  it(".mtl の map_Kd のオプションを飛ばす", () => {
    expect(parseMtl(BOX_MTL).maps).toEqual({ wall: "textures/wall.png" });
  });

  it("glTF の外部ファイル（.bin）がないときは理由を出す", () => {
    const gltf = JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "scene.bin", byteLength: 10 }], images: [{ uri: "tex%20a.png" }] });
    expect(gltfUris("scene.gltf", enc(gltf))).toEqual(["scene.bin", "tex a.png"]);
    const r = modelsFromEntries([{ path: "scene.gltf", data: enc(gltf) }], "scene.gltf");
    expect(r.models).toEqual([]);
    expect(r.problems[0]).toContain("scene.bin");
    const ok = modelsFromEntries([{ path: "scene.gltf", data: enc(gltf) }, { path: "scene.bin", data: new Uint8Array(10) }, { path: "tex a.png", data: new Uint8Array(1) }], "x");
    expect(Object.keys(ok.models[0].files).sort()).toEqual(["scene.bin", "scene.gltf", "tex a.png"]);
  });

  it("圧縮された glTF や対応していない形式は理由を出す", async () => {
    const draco = JSON.stringify({ asset: { version: "2.0" }, extensionsUsed: ["KHR_draco_mesh_compression"] });
    const r = await readModelFiles([
      { name: "a.gltf", data: enc(draco) },
      { name: "b.fbx", data: new Uint8Array(1) },
    ]);
    expect(r.models).toEqual([]);
    expect(r.problems.join("\n")).toMatch(/Draco/);
    expect(r.problems.join("\n")).toMatch(/b\.fbx/);
  });
});

describe("3D モデルの大きさ", () => {
  it("実物の m のモデルは 1/150、STL は mm のまま。極端な大きさは最長辺を 100mm に", () => {
    expect(unitMm("gltf")).toBe(MM_PER_M);
    expect(defaultSizeMm({ format: "obj", size: [15, 6, 30] })).toEqual({ length: 100, height: 40, width: 200 });
    expect(defaultSizeMm({ format: "stl", size: [40, 20, 30] })).toEqual({ length: 40, height: 20, width: 30 });
    // cm で書き出した建物（1500 単位 = 10m のつもりが 10000mm になる）
    expect(defaultSizeMm({ format: "gltf", size: [1500, 900, 600] }).length).toBe(100);
  });

  it("縦横比を保って大きさを変える", () => {
    const m: PlacedModel = { uid: "a", modelId: "m", name: "x", x: 0, y: 0, rot: 0, length: 100, width: 50, height: 20 };
    expect(scalePlaced(m, 0.5)).toMatchObject({ length: 50, width: 25, height: 10 });
    expect(scalePlaced(m, 1000).length).toBe(3000);
    expect(placedCorners({ ...m, rot: 90 }).map((c) => [Math.round(c.x), Math.round(c.y)])).toEqual([[25, -50], [25, 50], [-25, 50], [-25, -50]]);
  });
});

describe("three.js の物体にする", () => {
  it("OBJ の寸法を測り、底の中心を原点にして置く", async () => {
    const r = modelsFromEntries([{ path: "house.obj", data: enc(BOX_OBJ.replace(/^v (\S+) (\S+) (\S+)$/gm, (_, x, y, z) => `v ${+x + 10} ${+y + 5} ${z}`)) }], "x");
    const kit = await buildModelKit(r.models[0]);
    expect(kit.size.map((v) => Math.round(v * 100) / 100)).toEqual([4, 3, 2]);
    const placed: PlacedModel = { uid: "a", modelId: kit.id, name: "家", x: 300, y: 200, z: 10, rot: 90, length: 40, width: 20, height: 30 };
    const obj = placeModel(kit, placed);
    obj.updateMatrixWorld(true);
    const box = new Box3().setFromObject(obj);
    const size = box.getSize(new Vector3());
    // 90° 回すと、横（X）と奥行き（Z）が入れ替わる
    expect([size.x, size.y, size.z].map((v) => Math.round(v))).toEqual([20, 30, 40]);
    expect(Math.round(box.min.y)).toBe(10);
    expect(Math.round((box.min.x + box.max.x) / 2)).toBe(300);
    expect(Math.round((box.min.z + box.max.z) / 2)).toBe(200);
    kit.dispose();
  });

  it("STL の Z を高さにする", async () => {
    const stl = `solid t
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 10 0 0
vertex 0 20 5
endloop
endfacet
endsolid t`;
    const [m] = modelsFromEntries([{ path: "t.stl", data: enc(stl) }], "t.stl").models;
    const kit = await buildModelKit(m);
    expect(kit.size.map((v) => Math.round(v))).toEqual([10, 5, 20]);
    kit.dispose();
  });

  it("glTF（.gltf と .bin）を読む", async () => {
    // Node にはない（three.js の FileLoader が使う）
    const g = globalThis as { ProgressEvent?: unknown };
    g.ProgressEvent ??= class extends Event {
      constructor(type: string, init: object = {}) {
        super(type);
        Object.assign(this, init);
      }
    };
    // 三角形 1 枚（x 0〜2, y 0〜1, z 0〜3）
    const pos = new Float32Array([0, 0, 0, 2, 0, 0, 0, 1, 3]);
    const bin = new Uint8Array(pos.buffer);
    const gltf = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{ uri: "tri.bin", byteLength: bin.length }],
      bufferViews: [{ buffer: 0, byteLength: bin.length }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [2, 1, 3] }],
    };
    const [m] = modelsFromEntries([{ path: "tri/tri.gltf", data: enc(JSON.stringify(gltf)) }, { path: "tri/tri.bin", data: bin }], "tri").models;
    expect(m.format).toBe("gltf");
    const kit = await buildModelKit(m);
    expect(kit.size.map((v) => Math.round(v))).toEqual([2, 1, 3]);
    kit.dispose();
  });

  it("この端末にないモデルは飛ばして名前を返す", async () => {
    const r = modelsFromEntries([{ path: "house.obj", data: enc(BOX_OBJ) }], "x");
    const base = { x: 0, y: 0, rot: 0, length: 10, width: 10, height: 10 };
    const built = await buildPlacedModels(
      [
        { uid: "1", modelId: r.models[0].id, name: "家", ...base },
        { uid: "2", modelId: r.models[0].id, name: "家", ...base, x: 50 },
        { uid: "3", modelId: "nothing", name: "駅舎", ...base },
      ],
      r.models,
    );
    expect(built.group.children).toHaveLength(2);
    expect(built.missing).toEqual(["駅舎"]);
    built.dispose();
  });
});

describe("レイアウトに保存する", () => {
  const layout = { title: "t", description: "", board: { width: 900, height: 600 }, pieces: [] };
  it("置いたモデルを検査する", () => {
    const m: PlacedModel = { uid: "a", modelId: "m1", name: "家", x: 1, y: 2, rot: 0, length: 10, width: 10, height: 10 };
    expect(isPlacedModel(m)).toBe(true);
    expect(validLayout({ ...layout, models: [m] })).toBe(true);
    expect(validLayout({ ...layout, models: [{ ...m, length: -1 }] })).toBe(false);
    expect(validLayout({ ...layout, models: [{ ...m, x: "1" }] })).toBe(false);
  });

  it("プレミアムユーザー・プレミアムプラス・管理者だけが使える", () => {
    expect(["admin", "plus", "ai", "user", null].map((r) => canUseModels(r as never))).toEqual([true, true, true, false, false]);
  });
});
