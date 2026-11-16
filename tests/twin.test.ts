import { describe, expect, it } from "vitest";
import { getAccessory, placeOnPiece } from "../src/lib/accessories";
import { buildFromPlan } from "../src/lib/plan";
import { detectStations, newTrain, type OperationPlan, type Train } from "../src/lib/operation";
import {
  applyTwinEvent,
  buildTwinMap,
  DccExConnection,
  duplicateIds,
  extractFrames,
  normalizeTwinSettings,
  sensorKey,
  SYNC_COMMANDS,
  type TextTransport,
  currentDelay,
  formatCommand,
  formatEvent,
  initialTwinState,
  occupiedPieces,
  parseEvent,
  SimulatedLayout,
  type TwinContext,
  type TwinEvent,
  type TwinState,
} from "../src/lib/twin";
import { sidingPlan } from "./fixtures";

/** 待避線付きエンドレスに、本線の直線2か所へ相対式ホームを置いたレイアウト */
function layout() {
  const { pieces } = buildFromPlan(sidingPlan());
  const def = getAccessory("kato:SIDE-A");
  const a = placeOnPiece(def, pieces.find((p) => p.uid === "s0p1")!, undefined, "L", "accA");
  const b = placeOnPiece(def, pieces.find((p) => p.uid === "s0p9")!, undefined, "R", "accB");
  return { pieces, accessories: [a, b] };
}

function train(over: Partial<Train>, stationIds: string[]): Train {
  return { ...newTrain(0, stationIds), ...over };
}

function setup(slowness: number, trains?: Train[]) {
  const { pieces, accessories } = layout();
  const stations = detectStations(pieces, accessories);
  const plan: OperationPlan = { stationNames: {}, trains: trains ?? [train({ id: "t1", name: "1列車", departSec: 10, laps: 2 }, ["accA", "accB"])] };
  const sim = new SimulatedLayout(pieces, stations, plan, { seed: 4, slowness });
  const ctx: TwinContext = {
    map: sim.map,
    schedule: sim.schedule,
    trainName: (id) => plan.trains.find((t) => t.id === id)?.name ?? id,
    trackName: (st, tr) => `${st} ${tr}番線`,
  };
  let state = initialTwinState();
  const events: TwinEvent[] = [];
  sim.subscribe((ev) => {
    events.push(ev);
    state = applyTwinEvent(state, ev, sim.time, ctx);
  });
  const run = (sec: number, step = 0.5) => {
    for (let t = 0; t < sec; t += step) sim.advance(step);
  };
  return { sim, ctx, events, run, get state(): TwinState { return state; }, pieces, stations, plan };
}

describe("twin: DCC-EX の文字の形", () => {
  it("出来事を文字にして、読み戻せる", () => {
    const evs: TwinEvent[] = [
      { type: "sensor", id: 3, active: true },
      { type: "sensor", id: 3, active: false },
      { type: "turnout", id: 12, thrown: true },
      { type: "loco", cab: 3, speed: 40, forward: true },
      { type: "loco", cab: 4, speed: 0, forward: false },
      { type: "power", on: false },
    ];
    for (const ev of evs) expect(parseEvent(formatEvent(ev))).toEqual(ev);
    expect(formatEvent({ type: "sensor", id: 3, active: true })).toBe("<Q 3>");
    expect(formatEvent({ type: "turnout", id: 12, thrown: true })).toBe("<H 12 1>");
  });

  it("操作をコマンドにする", () => {
    expect(formatCommand({ type: "turnout", id: 2, thrown: false })).toBe("<T 2 0>");
    expect(formatCommand({ type: "throttle", cab: 3, speed: 200, forward: true })).toBe("<t 3 126 1>");
    expect(formatCommand({ type: "estop" })).toBe("<!>");
    expect(formatCommand({ type: "power", on: true })).toBe("<1>");
  });

  it("知らない形は読まない", () => {
    expect(parseEvent("hello")).toBeNull();
    expect(parseEvent("<Z 1>")).toBeNull();
    expect(parseEvent("<Q x>")).toBeNull();
  });
});

describe("twin: 対応表", () => {
  it("ポイントと番線と列車に番号をつける", () => {
    const { pieces, stations, plan } = setup(0);
    const map = buildTwinMap(pieces, stations, plan);
    expect(map.turnouts.length).toBe(2);
    expect(map.turnouts.map((t) => t.id)).toEqual([1, 2]);
    expect(map.sensors.map((s) => [s.id, s.stationId, s.track])).toEqual([
      [1, stations[0].id, 1],
      [2, stations[1].id, 1],
    ]);
    expect(map.locos).toEqual([{ cab: 3, trainId: "t1" }]);
  });
});

describe("twin: 模擬の実機", () => {
  it("はじめに電源・ポイント・機関車・センサーを知らせる", () => {
    const t = setup(0);
    t.sim.advance(0);
    expect(t.state.power).toBe(true);
    expect(Object.keys(t.state.turnouts)).toHaveLength(2);
    expect(t.state.locos[3].speed).toBeGreaterThan(0);
    // 始発駅の番線に列車がいる
    const origin = t.sim.map.sensors.find((s) => s.stationId === t.sim.schedule.trains[0].events[0].stationId)!;
    expect(t.state.sensors[origin.id]).toBe(true);
  });

  it("ダイヤどおりに走れば、着いたときの遅れは0", () => {
    const t = setup(0);
    const arr = t.sim.schedule.trains[0].events[1].arr!;
    t.run(arr + 5, 0.1);
    expect(t.state.nextStop.t1).toBe(2);
    expect(Math.abs(t.state.delays.t1)).toBeLessThan(0.5);
  });

  it("遅い列車は、センサーで遅れが分かる", () => {
    const t = setup(0.5);
    const arr = t.sim.schedule.trains[0].events[2].arr!;
    // 2回目の A駅に着くまで走らせる
    while ((t.state.nextStop.t1 ?? 1) < 3 && t.sim.time < arr * 3) t.sim.advance(0.1);
    expect(t.state.nextStop.t1).toBe(3);
    expect(t.state.delays.t1).toBeGreaterThan(1);
    // 推定位置の列車は、実物（模擬）の列車と同じ部品にいる
    const est = occupiedPieces(t.state, t.ctx, t.sim.time);
    const truth = t.sim.progressOf("t1")!;
    const real = t.sim.schedule.trains[0].occupancy.filter((o) => o.from <= truth && truth < o.to).map((o) => o.uid);
    expect(real.some((uid) => est.has(uid))).toBe(true);
  });

  it("機関車を止めると列車が進まず、遅れが増える", () => {
    const t = setup(0);
    t.run(20);
    const before = t.sim.progressOf("t1")!;
    t.sim.send({ type: "throttle", cab: 3, speed: 0, forward: true });
    t.run(30);
    expect(t.sim.progressOf("t1")).toBeCloseTo(before, 5);
    expect(currentDelay(t.state, "t1", t.sim.time)).toBeCloseTo(30, 0);
    t.sim.send({ type: "throttle", cab: 3, speed: 40, forward: true });
    expect(t.state.stoppedAt.t1).toBeUndefined();
    expect(t.state.delays.t1).toBeCloseTo(30, 0);
    t.run(5);
    expect(t.sim.progressOf("t1")!).toBeGreaterThan(before);
  });

  it("電源を切ると列車が止まる", () => {
    const t = setup(0);
    t.run(20);
    const before = t.sim.progressOf("t1")!;
    t.sim.send({ type: "power", on: false });
    t.run(10);
    expect(t.sim.progressOf("t1")).toBeCloseTo(before, 5);
    expect(t.state.stoppedAt.t1).toBeDefined();
  });

  it("アプリからポイントを切り替えると、実機から切り替わったと返ってくる", () => {
    const t = setup(0, []);
    t.sim.advance(0);
    expect(t.state.turnouts[1]).toBe(false);
    t.sim.send({ type: "turnout", id: 1, thrown: true });
    expect(t.state.turnouts[1]).toBe(true);
    expect(t.state.log[0].raw).toBe("<H 1 1>");
  });

  it("待避線に入る列車の前でポイントを分岐に切り替える", () => {
    const t = setup(0);
    // 待避線の部品を通る経路があれば、そのポイントが分岐になる。このレイアウトでは本線だけを通るので直進のまま
    t.run(200, 0.5);
    const used = new Set(t.sim.schedule.trains[0].occupancy.map((o) => `${o.uid}:${o.routeIndex}`));
    for (const tu of t.sim.map.turnouts) {
      const thrown = [...used].some((k) => k.startsWith(`${tu.uid}:`) && !k.endsWith(":0"));
      if (!thrown) expect(t.state.turnouts[tu.id]).toBe(false);
    }
  });
});

describe("twin: 着いた列車の見分け", () => {
  it("はじめから別の駅に止まっている列車を、着いた列車と取り違えない", () => {
    const t = setup(0, [
      train({ id: "t1", name: "1列車", departSec: 5, laps: 2 }, ["accA", "accB"]),
      train({ id: "t2", name: "2列車", departSec: 5, laps: 2 }, ["accB", "accA"]),
    ]);
    t.sim.advance(0);
    expect(t.state.nextStop).toEqual({});
    while ((t.state.nextStop.t1 ?? 1) < 2 && t.sim.time < 300) t.sim.advance(0.1);
    expect(Math.abs(t.state.delays.t1)).toBeLessThan(0.5);
    expect(Math.abs(t.state.delays.t2 ?? 0)).toBeLessThan(0.5);
  });
});

describe("twin: 模擬の実機の安全", () => {
  it("ほかの列車が止まっている番線には入らずに手前で待つ", () => {
    const t = setup(0, [
      train({ id: "t1", name: "1列車", departSec: 5, laps: 3 }, ["accA", "accB"]),
      train({ id: "t2", name: "2列車", departSec: 5, laps: 3 }, ["accB", "accA"]),
    ]);
    t.sim.advance(0);
    // 2列車を始発の B駅で止めたまま、1列車を走らせる
    t.sim.send({ type: "throttle", cab: 4, speed: 0, forward: true });
    t.run(200);
    const p1 = t.sim.progressOf("t1")!;
    const b = t.sim.schedule.trains[0].occupancy.find((o) => o.uid === "s0p9")!;
    expect(p1).toBeLessThan(b.from);
    expect(p1).toBeGreaterThan(b.from - 1);
    // 2列車が出ていけば入れる
    t.sim.send({ type: "throttle", cab: 4, speed: 40, forward: true });
    t.run(60);
    expect(t.sim.progressOf("t1")!).toBeGreaterThan(b.from);
  });
});

describe("twin: DCC-EX の版による違い", () => {
  it("後ろに語が付く形も読む", () => {
    expect(parseEvent("<p1 MAIN>")).toEqual({ type: "power", on: true });
    expect(parseEvent("<H 7 DCC 5 0 1>")).toEqual({ type: "turnout", id: 7, thrown: true });
    expect(parseEvent("<H 7 SERVO 100 410 205 2 0>")).toEqual({ type: "turnout", id: 7, thrown: false });
    // センサーの定義（<Q id pin pullup>）は状態ではない
    expect(parseEvent("<Q 3 22 1>")).toBeNull();
    expect(parseEvent("<iDCC-EX V-5.0.0 / MEGA / STANDARD_MOTOR_SHIELD G-abc>")).toBeNull();
  });

  it("届いた文字から <...> を取り出し、途中で切れた分は残す", () => {
    expect(extractFrames("<Q 1><q 2>\n<H 3")).toEqual({ frames: ["<Q 1>", "<q 2>"], rest: "<H 3" });
    expect(extractFrames("ごみ<Q 1")).toEqual({ frames: [], rest: "<Q 1" });
    expect(extractFrames("<Q <q 2>")).toEqual({ frames: ["<q 2>"], rest: "" });
  });
});

/** 偽物の道（送った文字を記録し、届く文字をテストから流す） */
function fakeTransport() {
  const written: string[] = [];
  let text: (c: string) => void = () => {};
  let closed: (r: string | null) => void = () => {};
  let closedByUs = false;
  const t: TextTransport = {
    write: (x) => void written.push(x),
    onText: (cb) => (text = cb),
    onClose: (cb) => (closed = cb),
    close: () => void (closedByUs = true),
  };
  return { t, written, push: (c: string) => text(c), drop: (r: string) => closed(r), get closedByUs() { return closedByUs; } };
}

describe("twin: DCC-EX とのつながり", () => {
  it("つないだら状態を問い合わせ、届いた応答を出来事にする（分かれて届いても読む）", () => {
    const f = fakeTransport();
    const c = new DccExConnection("DCC-EX（USB）", f.t);
    const evs: TwinEvent[] = [];
    c.subscribe((e) => evs.push(e));
    c.sync();
    expect(f.written).toEqual(SYNC_COMMANDS);
    f.push("<iDCC-EX V-5.0.0>\n<p1 MA");
    f.push("IN>\n<H 1 0>\n<Q 2>");
    f.push("<q 3>");
    expect(evs).toEqual([
      { type: "power", on: true },
      { type: "turnout", id: 1, thrown: false },
      { type: "sensor", id: 2, active: true },
      { type: "sensor", id: 3, active: false },
    ]);
  });

  it("操作をコマンドにして送る。機関車の速度は返事がなくても反映する", () => {
    const f = fakeTransport();
    const c = new DccExConnection("x", f.t);
    const evs: TwinEvent[] = [];
    c.subscribe((e) => evs.push(e));
    c.watchCabs([3, 4]);
    c.send({ type: "turnout", id: 5, thrown: true });
    c.send({ type: "throttle", cab: 3, speed: 50, forward: true });
    c.send({ type: "estop" });
    expect(f.written).toEqual(["<T 5 1>", "<t 3 50 1>", "<!>"]);
    expect(evs).toEqual([
      { type: "loco", cab: 3, speed: 50, forward: true },
      { type: "loco", cab: 3, speed: 0, forward: true },
      { type: "loco", cab: 4, speed: 0, forward: true },
    ]);
  });

  it("切れたら知らせる。自分で切ったら知らせない", () => {
    const f = fakeTransport();
    const c = new DccExConnection("x", f.t);
    const reasons: (string | null)[] = [];
    c.onClose((r) => reasons.push(r));
    f.drop("USB の接続が切れました");
    expect(reasons).toEqual(["USB の接続が切れました"]);
    c.send({ type: "estop" });
    expect(f.written).toEqual([]);

    const g = fakeTransport();
    const d = new DccExConnection("y", g.t);
    const r2: (string | null)[] = [];
    d.onClose((r) => r2.push(r));
    d.close();
    g.drop("x");
    expect(g.closedByUs).toBe(true);
    expect(r2).toEqual([]);
  });

  it("実物から届いたセンサーで、ダイヤとの遅れが分かる", () => {
    const { pieces, accessories } = layout();
    const stations = detectStations(pieces, accessories);
    const plan: OperationPlan = { stationNames: {}, trains: [train({ id: "t1", departSec: 10 }, ["accA", "accB"])] };
    const sim = new SimulatedLayout(pieces, stations, plan, { slowness: 0 });
    const ctx: TwinContext = { map: sim.map, schedule: sim.schedule, trainName: () => "1列車", trackName: (a, b) => `${a}${b}` };
    const f = fakeTransport();
    const c = new DccExConnection("x", f.t);
    let state = initialTwinState();
    let now = 0;
    c.subscribe((e) => (state = applyTwinEvent(state, e, now, ctx)));
    const b = sim.map.sensors.find((s) => s.stationId === "accB")!;
    const enter = sim.schedule.trains[0].occupancy.find((o) => b.pieces.includes(o.uid))!.from;
    now = enter + 12;
    f.push(`<Q ${b.id}>`);
    expect(state.delays.t1).toBeCloseTo(12, 5);
  });
});

describe("twin: 番号の付け替え", () => {
  it("付け替えた番号を使い、付けていないものは自動の番号のまま", () => {
    const { pieces, stations, plan } = setup(0);
    const turnoutUid = buildTwinMap(pieces, stations, plan).turnouts[0].uid;
    const map = buildTwinMap(pieces, stations, plan, {
      turnouts: { [turnoutUid]: 101 },
      sensors: { [sensorKey(stations[1].id, 1)]: 7 },
      locos: { t1: 1234 },
    });
    expect(map.turnouts.map((t) => [t.name, t.id])).toEqual([
      ["P1", 101],
      ["P2", 2],
    ]);
    expect(map.sensors.map((s) => s.id)).toEqual([1, 7]);
    expect(map.locos).toEqual([{ cab: 1234, trainId: "t1" }]);
    expect(duplicateIds(map)).toEqual({ turnouts: [], sensors: [], locos: [] });
  });

  it("同じ番号が重なっていれば見つける", () => {
    const { pieces, stations, plan } = setup(0);
    const map = buildTwinMap(pieces, stations, plan, { sensors: { [sensorKey(stations[1].id, 1)]: 1 } });
    expect(duplicateIds(map).sensors).toEqual([1]);
  });

  it("模擬の実機も付け替えた番号で動く", () => {
    const { pieces, accessories } = layout();
    const stations = detectStations(pieces, accessories);
    const plan: OperationPlan = { stationNames: {}, trains: [train({ id: "t1" }, ["accA", "accB"])] };
    const sim = new SimulatedLayout(pieces, stations, plan, { settings: { sensors: { [sensorKey(stations[0].id, 1)]: 42 }, locos: { t1: 9 } } });
    const evs: TwinEvent[] = [];
    sim.subscribe((e) => evs.push(e));
    sim.advance(0);
    expect(evs).toContainEqual({ type: "sensor", id: 42, active: true });
    expect(evs.some((e) => e.type === "loco" && e.cab === 9)).toBe(true);
  });

  it("壊れた保存データは捨てる", () => {
    expect(normalizeTwinSettings(null)).toBeUndefined();
    expect(
      normalizeTwinSettings({ turnouts: { a: 3, b: -1, c: "x", d: 1.5 }, sensors: "bad", locos: { t: 99999 }, wsUrl: "http://x" }),
    ).toEqual({ turnouts: { a: 3 }, sensors: {}, locos: {} });
    expect(normalizeTwinSettings({ wsUrl: "ws://192.168.4.1:2560" })?.wsUrl).toBe("ws://192.168.4.1:2560");
  });
});
