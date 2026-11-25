import { deflateRawSync } from "node:zlib";
import { Box3, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { isVehicleType, N_CAR, rtmVehicleId, rtmVehicleType } from "../src/lib/drive";
import { buildTrain } from "../src/lib/driveScene";
import { normalizeOperation } from "../src/lib/operation";
import { canUseRtm } from "../src/lib/roles";
import { modelBounds, parseMqo, parseObj } from "../src/lib/rtm/model";
import { findFile, parseLenientJson, parseTrainConfig, readVehicleFiles, vehicleId } from "../src/lib/rtm/pack";
import { buildVehicleKit, lightIndex, MM_PER_M } from "../src/lib/rtm/three";
import { readZip } from "../src/lib/rtm/zip";

/** テスト用の ZIP（deflate）を作る */
function makeZip(files: { path: string; data: Uint8Array | string; nameBytes?: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const data = typeof f.data === "string" ? new TextEncoder().encode(f.data) : f.data;
    const comp = deflateRawSync(data);
    const name = f.nameBytes ?? new TextEncoder().encode(f.path);
    const utf8 = f.nameBytes ? 0 : 0x800;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(6, utf8, true);
    local.setUint16(8, 8, true);
    local.setUint32(18, comp.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(8, utf8, true);
    cd.setUint16(10, 8, true);
    cd.setUint32(20, comp.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    chunks.push(new Uint8Array(local.buffer), name, comp);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + comp.length;
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

/** 幅 290cm・高さ 380cm・長さ 2000cm の箱の右半分（X を左右反転して全体になる）。y=100cm から上 */
const BODY_MQO = `Metasequoia Document
Format Text Ver 1.1

Material 2 {
\t"body" shader(3) col(1.000 1.000 1.000 1.000) tex("body.png")
\t"light" shader(3) col(1.000 1.000 1.000 1.000)
}
Object "body" {
\tdepth 0
\tmirror 1
\tmirror_axis 1
\tvertex 8 {
\t\t0.0000 100.0000 -1000.0000
\t\t145.0000 100.0000 -1000.0000
\t\t145.0000 480.0000 -1000.0000
\t\t0.0000 480.0000 -1000.0000
\t\t0.0000 100.0000 1000.0000
\t\t145.0000 100.0000 1000.0000
\t\t145.0000 480.0000 1000.0000
\t\t0.0000 480.0000 1000.0000
\t}
\tvertexattr {
\t\tuid {
\t\t\t1
\t\t}
\t}
\tface 3 {
\t\t4 V(1 5 6 2) M(0) UV(0 0 1 0 1 1 0 1)
\t\t4 V(2 6 7 3) M(0) UV(0 0 1 0 1 1 0 1)
\t\t3 V(4 5 6) M(1) UV(0 0 1 0 1 1)
\t}
}
Eof
`;

const BOGIE_OBJ = `# bogie
o bogie
usemtl bogie
v -1 0 -1.5
v 1 0 -1.5
v 1 0.9 1.5
v -1 0.9 1.5
vt 0 0
vt 1 0
vt 1 1
vt 0 1
f 1/1 2/2 3/3 4/4
`;

const TRAIN_JSON = `{
  // コメントと末尾のカンマがあっても読む
  "trainName": "テスト103系 クハ",
  "trainType": "EC",
  "trainModel2": {"modelFile": "test_103.mqo", "textures": [["default", "textures/train/test_103.png", ""], ["light", "textures/train/test_103_light.png", "Light"],]},
  "bogieModel2": {"modelFile": "test_bogie.obj", "textures": [["default", "textures/train/test_bogie.png", ""]]},
  "bogiePos": [[0.0, 0.0, 7.0], [0.0, 0.0, -7.0]],
  "trainDistance": 10.0,
}`;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function samplePack(): Uint8Array {
  return makeZip([
    { path: "ModelTrain_test103.json", data: TRAIN_JSON },
    { path: "assets/minecraft/models/test_103.mqo", data: BODY_MQO },
    { path: "assets/minecraft/models/test_bogie.obj", data: BOGIE_OBJ },
    { path: "assets/minecraft/textures/train/test_103.png", data: PNG },
    { path: "assets/minecraft/textures/train/test_103_light.png", data: PNG },
    { path: "assets/minecraft/textures/train/test_103_light_light0.png", data: PNG },
    { path: "assets/minecraft/textures/train/test_103_light_light1.png", data: PNG },
    { path: "assets/minecraft/textures/train/test_103_light_light2.png", data: PNG },
    { path: "assets/minecraft/textures/train/test_bogie.png", data: PNG },
    { path: "assets/minecraft/sounds/test.ogg", data: "x" },
  ]);
}

describe("RealTrainMod の車両パック", () => {
  it("ZIP を読める（Shift_JIS のファイル名も）", async () => {
    const sjis = new Uint8Array([0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x2e, 0x6a, 0x73, 0x6f, 0x6e]); // テスト.json
    const entries = await readZip(makeZip([{ path: "a/b.txt", data: "hello" }, { path: "", data: "{}", nameBytes: sjis }]));
    expect(entries.map((e) => e.path)).toEqual(["a/b.txt", "テスト.json"]);
    expect(new TextDecoder().decode(entries[0].data)).toBe("hello");
  });

  it("ゆるい json（コメント・末尾のカンマ）を読む", () => {
    expect(parseLenientJson(`{"a": 1, /* x */ "b": ["//", 2,], // c\n}`)).toEqual({ a: 1, b: ["//", 2] });
  });

  it("ModelTrain の json を読む（古い書き方も）", () => {
    const c = parseTrainConfig(parseLenientJson(TRAIN_JSON))!;
    expect(c.name).toBe("テスト103系 クハ");
    expect(c.body.modelFile).toBe("test_103.mqo");
    expect(c.body.textures[1]).toEqual({ material: "light", path: "textures/train/test_103_light.png", option: "Light" });
    expect(c.bogies[0]?.modelFile).toBe("test_bogie.obj");
    expect(c.trainDistance).toBe(10);
    const old = parseTrainConfig({ trainName: "old", trainModel: "a.mqo", trainTexture: "t.png", bogieModel: "b.obj" })!;
    expect(old.body.textures).toEqual([{ material: "default", path: "t.png", option: "" }]);
    expect(old.bogies[0]?.modelFile).toBe("b.obj");
    expect(old.bogiePos).toEqual([[0, 0, 7.125], [0, 0, -7.125]]);
    expect(old.trainDistance).toBe(10.125);
    expect(parseTrainConfig({ rails: 1 })).toBeNull();
  });

  it("パックの中のファイルを、RTM と同じように assets/minecraft/ の下やファイル名で探す", () => {
    const paths = ["assets/minecraft/models/a.mqo", "assets/minecraft/textures/train/B.png"];
    expect(findFile(paths, "models/a.mqo")).toBe(paths[0]);
    expect(findFile(paths, "a.mqo")).toBe(paths[0]);
    expect(findFile(paths, "textures/train/b.png")).toBe(paths[1]);
    expect(findFile(paths, "c.png")).toBeNull();
  });

  it("MQO を m に直し、ミラーの反対側も作る", () => {
    const m = parseMqo(BODY_MQO);
    const b = modelBounds(m)!;
    expect(b.min[0]).toBeCloseTo(-1.45);
    expect(b.max[0]).toBeCloseTo(1.45);
    expect(b.min[1]).toBeCloseTo(1);
    expect(b.max[2] - b.min[2]).toBeCloseTo(20);
    const body = m.parts.find((p) => p.material === "body")!;
    // 四角2枚 → 三角4枚、ミラーで倍
    expect(body.positions.length / 9).toBe(8);
    expect(m.parts.find((p) => p.material === "light")!.positions.length / 9).toBe(2);
  });

  it("OBJ の UV は上下を反転する", () => {
    const m = parseObj(BOGIE_OBJ);
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].material).toBe("bogie");
    expect(m.parts[0].uvs.slice(0, 2)).toEqual([0, 1]);
  });

  it("車両パックから車両・モデル・テクスチャを取り出す（音などは持たない）", async () => {
    const r = await readVehicleFiles([{ name: "test-pack.zip", data: samplePack() }]);
    expect(r.problems).toEqual([]);
    expect(r.vehicles).toHaveLength(1);
    const v = r.vehicles[0];
    expect(v.id).toBe(vehicleId("テスト103系 クハ"));
    expect(v.source).toBe("test-pack.zip");
    expect(v.config.body.modelFile).toBe("assets/minecraft/models/test_103.mqo");
    expect(Object.keys(v.files).some((p) => p.endsWith(".ogg"))).toBe(false);
    // Light のテクスチャは xxx_light0〜2.png を重ねる（先頭は前照灯、最後尾は尾灯）
    const lights = v.config.body.textures[1].lights!;
    expect(lights).toEqual([0, 1, 2].map((n) => `assets/minecraft/textures/train/test_103_light_light${n}.png`));
    expect(lights[lightIndex("rear")]).toMatch(/light2\.png$/);
    expect(lights[lightIndex("front")]).toMatch(/light1\.png$/);
    expect(lights[lightIndex("middle")]).toMatch(/light0\.png$/);
  });

  it("見つからないモデルや暗号化されたモデルは理由を返す", async () => {
    const zip = makeZip([
      { path: "ModelTrain_a.json", data: `{"trainName":"A","trainModel2":{"modelFile":"a.mqo","textures":[]}}` },
      { path: "ModelTrain_b.json", data: `{"trainName":"B","trainModel2":{"modelFile":"b.npm","textures":[]}}` },
    ]);
    const r = await readVehicleFiles([{ name: "p.zip", data: zip }]);
    expect(r.vehicles).toHaveLength(0);
    expect(r.problems.join("\n")).toMatch(/a\.mqo が見つかりません/);
    expect(r.problems.join("\n")).toMatch(/b\.npm は読めない形式/);
    const none = await readVehicleFiles([{ name: "x.zip", data: makeZip([{ path: "readme.txt", data: "x" }]) }]);
    expect(none.problems[0]).toMatch(/見つかりませんでした/);
  });

  it("json・モデル・テクスチャをばらばらに選んでも読める", async () => {
    const r = await readVehicleFiles([
      { name: "ModelTrain_test103.json", data: new TextEncoder().encode(TRAIN_JSON) },
      { name: "test_103.mqo", data: new TextEncoder().encode(BODY_MQO) },
      { name: "test_bogie.obj", data: new TextEncoder().encode(BOGIE_OBJ) },
      { name: "test_103.png", data: PNG },
    ]);
    expect(r.vehicles).toHaveLength(1);
    expect(r.problems.some((p) => p.includes("test_bogie.png"))).toBe(true);
  });

  it("映像の車両は幅・高さが 1/150、長さは1両分（編成の長さの計算と同じ）になる", async () => {
    const { vehicles } = await readVehicleFiles([{ name: "test-pack.zip", data: samplePack() }]);
    const kit = await buildVehicleKit(vehicles[0]);
    const train = buildTrain(3, 0x2f6fb5, rtmVehicleType(vehicles[0].id), { front: kit });
    expect(train.cars).toHaveLength(3);
    train.group.updateMatrixWorld(true);
    const box = new Box3().setFromObject(train.cars[0].children[0].children[0].children[0]);
    const size = box.getSize(new Vector3());
    // 連結面の間（20m）が N_CAR の全長 + すきま になる
    expect(size.x).toBeCloseTo(20 * ((N_CAR.length + N_CAR.gap) / 20), 1);
    expect(size.z).toBeCloseTo(2.9 * MM_PER_M, 1);
    // 台車の車輪の下（y=0）がレール面。車体の床下は 1m の高さ
    expect(box.min.y).toBeCloseTo(1 * MM_PER_M, 1);
    const whole = new Box3().setFromObject(train.cars[1]);
    expect(whole.min.y).toBeCloseTo(0, 1);
    // 最後尾は向きを逆にする
    expect(train.cars[2].children[0].rotation.y).toBeCloseTo(Math.PI / 2 + Math.PI);
    kit.dispose();
  });

  it("運行計画に RealTrainMod の車両を保存できる（おかしな値は捨てる）", () => {
    expect(isVehicleType("rtm:v1abc")).toBe(true);
    expect(isVehicleType("rtm:../x")).toBe(false);
    expect(rtmVehicleId("rtm:v1abc")).toBe("v1abc");
    expect(rtmVehicleId("commuter")).toBeNull();
    const plan = normalizeOperation({
      stationNames: {},
      trains: [
        { id: "a", name: "A", kind: "local", vehicleType: "rtm:v1abc", color: "#2f6fb5", cars: 4, speedKmh: 80, departSec: 0, laps: 1, stops: [] },
        { id: "b", name: "B", kind: "local", vehicleType: "rtm:<script>", color: "#2f6fb5", cars: 4, speedKmh: 80, departSec: 0, laps: 1, stops: [] },
      ],
    })!;
    expect(plan.trains[0].vehicleType).toBe("rtm:v1abc");
    expect(plan.trains[1].vehicleType).toBeUndefined();
  });

  it("使えるのはプレミアムユーザー・プレミアムプラス・管理者だけ", () => {
    expect(canUseRtm("admin")).toBe(true);
    expect(canUseRtm("plus")).toBe(true);
    expect(canUseRtm("ai")).toBe(true);
    expect(canUseRtm("user")).toBe(false);
    expect(canUseRtm(null)).toBe(false);
  });

  it("引用符のない値・; 区切りなど、Gson なら読める json も読む", () => {
    const j = parseLenientJson(`{\r\n"trainName": trta010_7001,\r\n'a' = 1.5; b: [x, -2, true,],\r\n"c": "AlphaBlend,Light"}`);
    expect(j).toEqual({ trainName: "trta010_7001", a: 1.5, b: ["x", -2, true], c: "AlphaBlend,Light" });
  });

  it("macOS で圧縮し直したパック（フォルダ付き・__MACOSX 入り）や、ZIP の中の ZIP も読む", async () => {
    const pack = samplePack();
    const entries = await readZip(pack);
    const mac = makeZip([
      ...entries.map((e) => ({ path: `MyPack/${e.path}`, data: e.data })),
      { path: "__MACOSX/MyPack/._ModelTrain_test103.json", data: new Uint8Array([0, 5, 22, 7, 0, 2]) },
      { path: "__MACOSX/MyPack/assets/minecraft/models/._test_103.mqo", data: new Uint8Array([0, 5, 22, 7]) },
    ]);
    const r = await readVehicleFiles([{ name: "mac.zip", data: mac }]);
    expect(r.problems).toEqual([]);
    expect(r.vehicles.map((v) => v.name)).toEqual(["テスト103系 クハ"]);
    const outer = makeZip([{ path: "readme.txt", data: "読んでね" }, { path: "pack/test-pack.zip", data: pack }]);
    const n = await readVehicleFiles([{ name: "配布.zip", data: outer }]);
    expect(n.problems).toEqual([]);
    expect(n.vehicles[0].source).toBe("配布.zip/test-pack.zip");
  });

  it("ほかのパックの台車を使う車両は、簡易な台車で表示する", async () => {
    const zip = makeZip([
      { path: "ModelTrain_x.json", data: `{"trainName":"X","trainModel2":{"modelFile":"test_103.mqo","textures":[["default","t.png"]]},"bogieModel2":{"modelFile":"Other/bogie_DT71.mqo","textures":[]},"bogiePos":[[0,0,7],[0,0,-7]],"trainDistance":10}` },
      { path: "models/test_103.mqo", data: BODY_MQO },
      { path: "t.png", data: PNG },
    ]);
    const r = await readVehicleFiles([{ name: "x.zip", data: zip }]);
    expect(r.vehicles).toHaveLength(1);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/簡易な台車/);
    const kit = await buildVehicleKit(r.vehicles[0]);
    const car = kit.makeCar("front");
    car.updateMatrixWorld(true);
    const bogies: Object3D[] = [];
    car.traverse((o) => o.name === "rtm-simple-bogie" && bogies.push(o));
    expect(bogies).toHaveLength(2);
    // 台車がなくても、RTM の標準どおり y=-1.04m をレール面にする
    expect(new Box3().setFromObject(bogies[0]).min.y).toBeCloseTo(0, 1);
    kit.dispose();
  });

  it("展開したフォルダを選んでも読める", async () => {
    const entries = await readZip(samplePack());
    const r = await readVehicleFiles(entries.map((e) => ({ name: e.path.split("/").pop()!, path: `MyPack/${e.path}`, data: e.data })));
    expect(r.problems).toEqual([]);
    expect(r.vehicles[0].source).toBe("MyPack");
    expect(r.vehicles[0].config.bogies[0]?.modelFile).toBe("MyPack/assets/minecraft/models/test_bogie.obj");
  });
});
