// 運転席視点のための3Dの情景（three.js）。単位は mm。
// three の座標: X = レイアウトの x、Y = 高さ（レール面が0）、Z = レイアウトの y。
// 真上から見るとレイアウトの図と同じ向きになる。

import * as THREE from "three";
import type { BedType } from "../data/trackCatalog";
import { PIER_MIN_MM, type Pier } from "./elevation";
import type { Board, Piece } from "./geometry";
import { makeSegment, N_CAR, type DriveGraph, type DrivePoint } from "./drive";
import { getPart } from "./parts";

/** ボードの面の高さ（地上の線路のレール面からの深さ） */
export const BOARD_Y = -6;
const RAIL_HALF_GAUGE = 4.5;
const RAIL_TOP = 0;
const RAIL_BOTTOM = -1.6;
const SLEEPER_TOP = -1.5;
const SLEEPER_BOTTOM = -2.4;

type Profile = [number, number][]; // [横方向(右が正), 高さ]

type BedStyle = {
  ballastTop: number;
  ballastBottom: number;
  ballastColor: number;
  sleeperColor: number | null;
  sleeperLength: number;
  sleeperPitch: number;
  slab: boolean;
  /** カント（曲線で内側へ傾く角度, 度） */
  cantDeg: number;
};

const BED_STYLE: Record<BedType, BedStyle> = {
  ballast: { ballastTop: 18, ballastBottom: 25, ballastColor: 0x8b847a, sleeperColor: 0x5a4030, sleeperLength: 15, sleeperPitch: 4.6, slab: false, cantDeg: 0 },
  pc: { ballastTop: 18, ballastBottom: 25, ballastColor: 0x8f8a82, sleeperColor: 0xbfbcb4, sleeperLength: 15, sleeperPitch: 4.6, slab: false, cantDeg: 0 },
  synthetic: { ballastTop: 18, ballastBottom: 25, ballastColor: 0x8b847a, sleeperColor: 0x3f3a36, sleeperLength: 15, sleeperPitch: 4.6, slab: false, cantDeg: 0 },
  widePc: { ballastTop: 24, ballastBottom: 32, ballastColor: 0x948f86, sleeperColor: 0xc4c1ba, sleeperLength: 16, sleeperPitch: 4.2, slab: false, cantDeg: 3 },
  slab: { ballastTop: 19, ballastBottom: 21, ballastColor: 0xa9aaa6, sleeperColor: null, sleeperLength: 0, sleeperPitch: 0, slab: true, cantDeg: 0 },
  viaduct: { ballastTop: 18, ballastBottom: 22, ballastColor: 0x8f8a82, sleeperColor: 0xbfbcb4, sleeperLength: 15, sleeperPitch: 4.6, slab: false, cantDeg: 0 },
};

export function bedStyle(bed: BedType): BedStyle {
  return BED_STYLE[bed];
}

type Frame = { p: THREE.Vector3; right: THREE.Vector3 };

/** 中心線の点から、各点の位置と右向きの水平ベクトル */
function framesOf(points: DrivePoint[]): Frame[] {
  return points.map((pt, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.y - a.y;
    const len = Math.hypot(dx, dz) || 1;
    // 進行方向 (dx, dz) に対して右は (-dz, dx)（Y が上、真上から見て時計回りが右）
    return { p: new THREE.Vector3(pt.x, pt.z, pt.y), right: new THREE.Vector3(-dz / len, 0, dx / len) };
  });
}

/** 断面 profile（点ごとに変えてよい、点の数は同じ）を中心線に沿って押し出したメッシュの頂点 */
function sweep(frames: Frame[], profileAt: (i: number) => Profile, closed = true): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = profileAt(0).length;
  frames.forEach((f, i) => {
    for (const [u, v] of profileAt(i)) {
      pos.push(f.p.x + f.right.x * u, f.p.y + v, f.p.z + f.right.z * u);
    }
  });
  const edges = closed ? n : n - 1;
  for (let i = 0; i < frames.length - 1; i++) {
    for (let k = 0; k < edges; k++) {
      const a = i * n + k;
      const b = i * n + ((k + 1) % n);
      const c = (i + 1) * n + k;
      const d = (i + 1) * n + ((k + 1) % n);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const box = (w: number, h: number): Profile => [
  [-w / 2, h],
  [w / 2, h],
  [w / 2, 0],
  [-w / 2, 0],
];

type Built = { group: THREE.Group; dispose: () => void };

/** 乱数（同じレイアウトなら同じ情景にする） */
function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function grassTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#6f8f4e";
  ctx.fillRect(0, 0, 256, 256);
  const r = seeded(7);
  for (let i = 0; i < 2500; i++) {
    const g = 110 + Math.floor(r() * 60);
    ctx.fillStyle = `rgba(${g - 40},${g},${g - 60},0.5)`;
    ctx.fillRect(r() * 256, r() * 256, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** レイアウト全体の情景（ボード・線路・橋脚・木と建物） */
export function buildScene(graph: DriveGraph, pieces: Piece[], piers: Pier[], board: Board): Built {
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, ...extra });
    disposables.push(m);
    return m;
  };
  const add = (g: THREE.BufferGeometry, m: THREE.Material) => {
    disposables.push(g);
    const mesh = new THREE.Mesh(g, m);
    group.add(mesh);
    return mesh;
  };

  // ボード（芝）とまわりの床
  const grass = grassTexture();
  disposables.push(grass);
  grass.repeat.set(board.width / 300, board.height / 300);
  const boardMesh = add(new THREE.PlaneGeometry(board.width, board.height), mat(0xffffff, { map: grass }));
  boardMesh.rotation.x = -Math.PI / 2;
  boardMesh.position.set(board.width / 2, BOARD_Y, board.height / 2);
  const floor = add(new THREE.PlaneGeometry(40000, 40000), mat(0x6b5a48));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(board.width / 2, BOARD_Y - 40, board.height / 2);
  // ボードの縁（木の枠）
  const frameMat = mat(0x8a6a48);
  const edge = (w: number, d: number, x: number, z: number) => {
    const m = add(new THREE.BoxGeometry(w, 40, d), frameMat);
    m.position.set(x, BOARD_Y - 19.5, z);
  };
  edge(board.width + 20, 10, board.width / 2, -5);
  edge(board.width + 20, 10, board.width / 2, board.height + 5);
  edge(10, board.height, -5, board.height / 2);
  edge(10, board.height, board.width + 5, board.height / 2);

  const railMat = mat(0x8a8f96, { metalness: 0.7, roughness: 0.35 });
  const deckMat = mat(0xb9b8b2);
  const sleeperMats = new Map<number, THREE.Material>();
  const ballastMats = new Map<number, THREE.Material>();
  const sleeperBoxes = new Map<number, THREE.Matrix4[]>();
  const slabBlocks: THREE.Matrix4[] = [];
  const allPoints: DrivePoint[] = [];

  for (const piece of pieces) {
    const part = getPart(piece.partId);
    const style = BED_STYLE[part.bed];
    part.routes.forEach((_, routeIndex) => {
      const seg = makeSegment(graph, { uid: piece.uid, routeIndex, reverse: false }, 4);
      const frames = framesOf(seg.points);
      allPoints.push(...seg.points);
      const elevated = (i: number) => seg.points[i].z >= PIER_MIN_MM || part.bed === "viaduct";
      const groundDepth = (i: number) => BOARD_Y - seg.points[i].z - 0.2;

      // 道床（地上は築堤のようにボードまで、高架は桁の上）
      if (!ballastMats.has(style.ballastColor)) ballastMats.set(style.ballastColor, mat(style.ballastColor));
      add(
        sweep(frames, (i) => {
          const bottom = elevated(i) ? -3.2 : groundDepth(i);
          const top = style.slab ? -1.9 : -2.1;
          return [
            [-style.ballastTop / 2, top],
            [style.ballastTop / 2, top],
            [style.ballastBottom / 2, bottom],
            [-style.ballastBottom / 2, bottom],
          ];
        }),
        ballastMats.get(style.ballastColor)!,
      );
      // 高架の桁と側壁
      if (seg.points.some((_, i) => elevated(i))) {
        add(
          sweep(frames, (i) => {
            const on = elevated(i);
            const w = on ? 30 : 0.01;
            const bottom = on ? -9 : -3;
            return [
              [-w / 2, 2.5],
              [-w / 2 + 1.2, 2.5],
              [-w / 2 + 1.2, -3],
              [w / 2 - 1.2, -3],
              [w / 2 - 1.2, 2.5],
              [w / 2, 2.5],
              [w / 2, bottom],
              [-w / 2, bottom],
            ];
          }),
          deckMat,
        );
      }
      // レール
      for (const side of [-1, 1]) {
        add(
          sweep(frames, () =>
            box(0.7, RAIL_TOP - RAIL_BOTTOM).map(([u, v]) => [u + side * RAIL_HALF_GAUGE, v + RAIL_BOTTOM] as [number, number]),
          ),
          railMat,
        );
      }
      // まくら木（スラブは板）
      const pitch = style.slab ? 32 : style.sleeperPitch;
      if (!pitch) return;
      const color = style.slab ? -1 : style.sleeperColor!;
      if (!style.slab && !sleeperBoxes.has(color)) sleeperBoxes.set(color, []);
      for (let d = pitch / 2; d < seg.length; d += pitch) {
        const k = Math.max(1, seg.dist.findIndex((v) => v >= d));
        const a = seg.points[k - 1];
        const b = seg.points[k];
        const t = (d - seg.dist[k - 1]) / (seg.dist[k] - seg.dist[k - 1] || 1);
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, a.y + (b.y - a.y) * t),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(b.y - a.y, b.x - a.x)),
          new THREE.Vector3(1, 1, 1),
        );
        (style.slab ? slabBlocks : sleeperBoxes.get(color)!).push(m);
      }
    });
    if (part.bumper) {
      const seg = makeSegment(graph, { uid: piece.uid, routeIndex: 0, reverse: false }, 4);
      const end = seg.points[seg.points.length - 1];
      const prev = seg.points[seg.points.length - 2];
      const g = new THREE.BoxGeometry(2, 6, 14);
      const m = add(g, mat(0xd8442f));
      m.position.set(end.x, end.z + 2, end.y);
      m.rotation.y = -Math.atan2(end.y - prev.y, end.x - prev.x);
    }
  }

  const instanced = (geo: THREE.BufferGeometry, material: THREE.Material, list: THREE.Matrix4[]) => {
    if (!list.length) return;
    disposables.push(geo);
    const inst = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  };
  for (const [color, list] of sleeperBoxes) {
    if (!sleeperMats.has(color)) sleeperMats.set(color, mat(color));
    const geo = new THREE.BoxGeometry(1.6, SLEEPER_TOP - SLEEPER_BOTTOM, 15);
    geo.translate(0, (SLEEPER_TOP + SLEEPER_BOTTOM) / 2, 0);
    instanced(geo, sleeperMats.get(color)!, list);
  }
  {
    const geo = new THREE.BoxGeometry(31, 0.6, 15);
    geo.translate(0, -1.6, 0);
    instanced(geo, mat(0xc9c9c4), slabBlocks);
  }

  // 橋脚
  const pierMat = mat(0xcfcdc6);
  for (const pier of piers) {
    const h = pier.z - 9 - BOARD_Y;
    if (h <= 0) continue;
    const g = pier.double ? new THREE.BoxGeometry(10, h, 44) : new THREE.CylinderGeometry(4, 5, h, 12);
    const m = add(g, pierMat);
    m.position.set(pier.x, BOARD_Y + h / 2, pier.y);
  }

  // 木と建物（線路から離れた所に）
  const rand = seeded(pieces.length * 7919 + Math.round(board.width + board.height));
  const farFromTrack = (x: number, y: number, r: number) =>
    allPoints.every((p) => Math.abs(p.x - x) > r || Math.abs(p.y - y) > r || Math.hypot(p.x - x, p.y - y) > r);
  const trunkMat = mat(0x6b4a2e);
  const leafMats = [mat(0x3f6b34), mat(0x4f7d3a), mat(0x355c2d)];
  const houseMats = [mat(0xe8e2d4), mat(0xd9c7a8), mat(0xbfc8cf), mat(0xe2d0c4)];
  const roofMats = [mat(0x7a3b2e), mat(0x3d4a5c), mat(0x555555)];
  const trunkGeo = new THREE.CylinderGeometry(1.2, 1.6, 10, 6);
  const leafGeo = new THREE.ConeGeometry(9, 26, 8);
  disposables.push(trunkGeo, leafGeo);
  const count = Math.min(220, Math.round((board.width * board.height) / 18000));
  for (let i = 0; i < count; i++) {
    const x = 20 + rand() * (board.width - 40);
    const y = 20 + rand() * (board.height - 40);
    const house = rand() < 0.3;
    if (!farFromTrack(x, y, house ? 55 : 30)) continue;
    if (house) {
      const w = 30 + rand() * 30;
      const d = 25 + rand() * 25;
      const h = 18 + rand() * 30;
      const body = add(new THREE.BoxGeometry(w, h, d), houseMats[Math.floor(rand() * houseMats.length)]);
      body.position.set(x, BOARD_Y + h / 2, y);
      body.rotation.y = rand() * Math.PI;
      const roof = add(new THREE.ConeGeometry(Math.hypot(w, d) / 2 + 2, 10, 4), roofMats[Math.floor(rand() * roofMats.length)]);
      roof.position.set(x, BOARD_Y + h + 5, y);
      roof.rotation.y = body.rotation.y + Math.PI / 4;
    } else {
      const s = 0.7 + rand() * 0.8;
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(x, BOARD_Y + 5 * s, y);
      trunk.scale.setScalar(s);
      const leaf = new THREE.Mesh(leafGeo, leafMats[Math.floor(rand() * leafMats.length)]);
      leaf.position.set(x, BOARD_Y + (10 + 12) * s, y);
      leaf.scale.setScalar(s);
      group.add(trunk, leaf);
    }
  }

  return {
    group,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}

/**
 * 後ろから見るときの列車（N_CAR の寸法の車両を cars 両）。
 * 各車両のグループは車体の中心が原点で +X が前。位置と向きは carPlacements で合わせる
 */
export function buildTrain(cars: number, color = 0x2f6fb5): { cars: THREE.Group[]; group: THREE.Group; dispose: () => void } {
  const { length, width, height, floor, bogieCenters } = N_CAR;
  const group = new THREE.Group();
  const mats = {
    body: new THREE.MeshStandardMaterial({ color, roughness: 0.5 }),
    band: new THREE.MeshStandardMaterial({ color: 0xe9eef2, roughness: 0.5 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x8e959c, roughness: 0.7 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.2, metalness: 0.3 }),
    under: new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.8 }),
  };
  const roofH = 2.5;
  const bodyTop = height - roofH;
  const geos: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    geos.push(g);
    return g;
  };
  const bodyGeo = box(length, bodyTop - floor, width, 0, (floor + bodyTop) / 2);
  const roofGeo = box(length - 2, roofH, width - 3, 0, bodyTop + roofH / 2);
  // 窓の帯（側面）と、先頭車の前面の窓
  const sideWin = box(length - 16, 5, width + 0.2, 0, floor + 13);
  const frontWin = box(0.6, 7, width - 4, length / 2, floor + 13);
  const bogie = box(20, 3.5, 13, 0, 2.6);
  const cargroups: THREE.Group[] = [];
  for (let i = 0; i < cars; i++) {
    const car = new THREE.Group();
    car.add(new THREE.Mesh(bodyGeo, mats.body), new THREE.Mesh(roofGeo, mats.roof), new THREE.Mesh(sideWin, mats.glass));
    if (i === 0) car.add(new THREE.Mesh(frontWin, mats.glass));
    for (const sx of [-1, 1]) {
      const b = new THREE.Mesh(bogie, mats.under);
      b.position.x = (sx * bogieCenters) / 2;
      car.add(b);
    }
    cargroups.push(car);
    group.add(car);
  }
  return {
    cars: cargroups,
    group,
    dispose: () => {
      for (const g of geos) g.dispose();
      for (const m of Object.values(mats)) m.dispose();
    },
  };
}
