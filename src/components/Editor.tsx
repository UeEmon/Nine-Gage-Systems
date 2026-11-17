"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  analyze,
  newUid,
  placeAt,
  worldJoints,
  worldSamples,
  type Board,
  type Layout,
  type Piece,
  type WorldJoint,
} from "@/lib/geometry";
import { billOfMaterials, usageOf } from "@/lib/bom";
import { shortfall, stockFromInventory, type Inventory, type Shortfall } from "@/lib/productDb";
import type { SavedPattern } from "@/lib/patternFile";
import { CATALOG_SOURCES } from "@/data/trackCatalog";
import { heightText, PIER_SYSTEMS } from "@/data/piers";
import { isRamp, PIER_MIN_MM, zRange } from "@/lib/elevation";
import { BED_INFO, bedVariantsOf, CATEGORY_LABELS, getPart, MAKER_INFO, MAKERS, normDeg, partsFor, type Maker } from "@/lib/parts";
import type { BedType, PartCategory } from "@/data/trackCatalog";
import type { SessionUser } from "@/lib/roles";
import { AiStatus } from "./AiStatus";
import { UserMenu } from "./UserMenu";
import { TrackPiece, type Level } from "./TrackPiece";
import { LevelProfile } from "./LevelProfile";
import { PartIcon } from "./PartIcon";
import { PartDetail } from "./PartDetail";
import { InventoryPanel, yen } from "./InventoryPanel";
import { AiHistoryPanel, type AiLayoutEntry } from "./AiHistoryPanel";
import { LibraryPanel } from "./LibraryPanel";
import { OperationView } from "./operation/OperationView";
import { TwinView } from "./twin/TwinView";
import { AccessoryIcon, AccessoryShape } from "./AccessoryShape";
import { SimObjectShape } from "./SimObjectShape";
import { REPLICA_KIND_LABELS, REPLICA_LEVEL_HELP, REPLICA_LEVEL_LABELS, REPLICA_LEVELS, SIM_DISCLAIMER, SIM_KIND_LABELS, type ReplicaInfo, type ReplicaKind, type ReplicaLevel, type SimObject } from "@/lib/replica";
import {
  accessoriesFor,
  getAccessory,
  KIND_ORDER,
  MOUNT_HELP,
  newAccessoryUid,
  placeOnPiece,
  snapAccessory,
  snapsToTrack,
  type Accessory,
} from "@/lib/accessories";
import { ACCESSORY_KIND_LABELS, type AccessoryKind } from "@/data/accessories";
import { useLocalState } from "./useLocalState";
import { BrandLogo } from "@/components/BrandLogo";

// three.js はブラウザでだけ読み込む
const DriveView = dynamic(() => import("./DriveView").then((m) => m.DriveView), { ssr: false });

const STORAGE_KEY = "nine-gage-layout-v1";
const SNAP_MM = 15;
const SNAP_DEG = 20;

const BOARD_PRESETS: { label: string; board: Board }[] = [
  { label: "900×600", board: { width: 900, height: 600 } },
  { label: "1200×600", board: { width: 1200, height: 600 } },
  { label: "サブロク 1820×910", board: { width: 1820, height: 910 } },
  { label: "1800×1200", board: { width: 1800, height: 1200 } },
];

const emptyLayout = (): Layout => ({
  title: "新しいレイアウト",
  maker: "kato",
  description: "",
  board: { width: 1200, height: 600 },
  pieces: [],
});

type Selection =
  | { kind: "joint"; uid: string; index: number }
  | { kind: "piece"; uid: string }
  | { kind: "acc"; uid: string }
  | null;

type ProposedPattern =
  | {
      ok: true;
      plan: { title: string; description: string };
      pieces: Piece[];
      accessories?: Accessory[];
      /** 「再現してみた」の仮オブジェクト（実在の製品ではない） */
      sims?: SimObject[];
      replica?: ReplicaInfo | null;
      /** ボードの大きさを制限しなかったとき（再現度「忠実」）、できた形に合わせたボード */
      board?: Board;
      attempts: number;
      remainingProblems: string | null;
      model: string;
      hint: string | null;
      shortfall: Shortfall;
      /** 同じ条件で前に作った案を自動保存から返した（AIは呼んでいない） */
      cached?: boolean;
      /** 自動保存した日時（ISO）。保存できなかったときは null */
      savedAt?: string | null;
    }
  | { ok: false; error: string };

type LevelFilter = "all" | Level;
const LEVEL_FILTERS: { value: LevelFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "ground", label: "地上" },
  { value: "ramp", label: "勾配" },
  { value: "elevated", label: "高架" },
];
/** 新しく置く部品の高さ。auto はつなぐ先の部品に合わせる */
type PlaceHeight = "auto" | "ground" | "elevated" | "ramp";

type AiMode = "free" | "owned" | "expand" | "replica";
const AI_MODES: { mode: AiMode; label: string; help: string }[] = [
  { mode: "free", label: "自由に", help: "部品の制限なしで設計します" },
  { mode: "owned", label: "手持ちだけ", help: "登録した所有パーツの本数の範囲だけで組める案を出します" },
  { mode: "expand", label: "拡張案", help: "所有パーツを活かし、買い足しで広げる案を出します（追加の部品と費用つき）" },
  {
    mode: "replica",
    label: "再現してみた",
    help: "実在の路線名か駅名から、路線の特徴と沿線の名所、または駅舎とホームの形を再現します。製品にない物はシミュレーション上の仮オブジェクトで置きます",
  },
];
const escHtml = (t: string) =>
  t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * 展開図の印刷用の画面。SVG は <img> で出す（SVG の中のスクリプトは動かない）。
 * 実寸で印刷できるよう、用紙と同じ大きさ（mm）で並べる。
 */
function papercraftPrintHtml(name: string, pages: string[], warnings: string[]): string {
  const imgs = pages
    .map((svg, i) => `<img class="page" alt="展開図 ${i + 1}/${pages.length}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`)
    .join("");
  const warn = warnings.length ? `<ul class="warn">${warnings.map((w) => `<li>${escHtml(w)}</li>`).join("")}</ul>` : "";
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>展開図: ${escHtml(name)}</title>
<style>
body{margin:0;font-family:sans-serif;background:#eee}
.bar{padding:12px 16px;background:#fff;border-bottom:1px solid #ccc;font-size:14px;line-height:1.6}
.bar button{font-size:14px;padding:4px 12px;margin-right:8px}
.warn{color:#b3261e;margin:4px 0}
.page{display:block;width:210mm;margin:12px auto;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.2)}
@page{size:A4;margin:0}
@media print{.bar{display:none}body{background:#fff}.page{margin:0;box-shadow:none;page-break-after:always}}
</style></head><body>
<div class="bar"><button onclick="print()">印刷</button><strong>${escHtml(name)}</strong> の展開図（${pages.length}枚・A4）。
印刷するときは「実際のサイズ（100%）」を選んでください。これは実在の製品ではなく、シミュレーション上の仮オブジェクトです。${warn}</div>
${imgs}</body></html>`;
}

/** 所有パーツの登録が必要なモード */
const needsStock = (m: AiMode) => m === "owned" || m === "expand";

/** AIの案をレイアウトに入れるときの中身 */
const patternLayout = (p: Extract<ProposedPattern, { ok: true }>) => ({
  title: p.plan.title,
  description: p.plan.description,
  pieces: p.pieces,
  accessories: p.accessories ?? [],
  sims: p.sims ?? [],
  replica: p.replica ?? undefined,
  ...(p.board ? { board: p.board } : {}),
});

/** 再現度「忠実」で提案を始める前の確認 */
const FAITHFUL_CONFIRM = [
  "再現度「忠実」で作ります。",
  "",
  "・ボードの大きさは、出来上がったレイアウトに合わせて決め直します（いまのボードの大きさにはしばられません）。",
  "・実物の配線どおりにするため部品が多くなり、AIのトークン消費が「標準」よりかなり多くなります（自分のAPIキーなら、その分の料金がかかります）。出す案の数を増やすと、さらに増えます。",
  "",
  "続けますか？",
].join("\n");

type AiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; provider: string; mode: AiMode; budgetJpy: number | null; patterns: ProposedPattern[]; shown: number }
  | { status: "error"; message: string };

const isInventory = (v: unknown): v is Inventory =>
  !!v && typeof v === "object" && Object.values(v as object).every((n) => typeof n === "number");
const isPatterns = (v: unknown): v is SavedPattern[] => Array.isArray(v);

/** user が null ならログインなし（AI提案は使えない。保存はこのブラウザとファイルだけ） */
export function Editor({ user }: { user: SessionUser | null }) {
  const [layout, setLayout] = useState<Layout>(emptyLayout);
  const [selection, setSelection] = useState<Selection>(null);
  const [mirrorNext, setMirrorNext] = useState(false);
  const [attachJoint, setAttachJoint] = useState(0);
  const [category, setCategory] = useState<PartCategory>("straight");
  /** 線路以外のパーツのパレットの分類 */
  const [accKind, setAccKind] = useState<AccessoryKind>("platform");
  /** パレットの道床の絞り込み（"all" はすべて） */
  const [bedFilter, setBedFilter] = useState<BedType | "all">("all");
  /** 仕様を表示している部品のキー */
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [request, setRequest] = useState("エンドレスに待避線を1本。駅を置けるスペースもほしい");
  const [ai, setAi] = useState<AiState>({ status: "idle" });
  /** 「AIで作ったレイアウト」の一覧を読み直すための番号 */
  const [aiHistoryVersion, setAiHistoryVersion] = useState(0);
  const [aiMode, setAiMode] = useState<AiMode>("free");
  const [patternCount, setPatternCount] = useState(1);
  /** 追加購入の予算上限（円）。空なら制限なし */
  const [budget, setBudget] = useState("");
  /** 「再現してみた」の路線名・駅名 */
  const [replicaKind, setReplicaKind] = useState<ReplicaKind>("line");
  const [replicaName, setReplicaName] = useState("");
  /** 「再現してみた」の再現度 */
  const [replicaLevel, setReplicaLevel] = useState<ReplicaLevel>("standard");
  /** 「再現してみた」の追加の要望（ふだんの要望とは分けて持つ） */
  const [replicaExtra, setReplicaExtra] = useState("");
  /** ペーパークラフトジェネレーターとの連携が使えるか（null=未確認） */
  const [papercraftEnabled, setPapercraftEnabled] = useState<boolean | null>(null);
  /** 展開図を作っている仮オブジェクトの uid */
  const [papercraftBusy, setPapercraftBusy] = useState<string | null>(null);
  const [papercraftError, setPapercraftError] = useState<string | null>(null);
  const budgetJpy = aiMode !== "owned" && budget.trim() !== "" && Number(budget) >= 0 ? Math.floor(Number(budget)) : undefined;
  const [inventory, setInventory] = useLocalState<Inventory>("nine-gage-inventory-v1", {}, isInventory);
  const [library, setLibrary] = useLocalState<SavedPattern[]>("nine-gage-library-v1", [], isPatterns);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [view, setView] = useState({ x: -100, y: -100, w: 1400, h: 800 });
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [hideOthers, setHideOthers] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showDrive, setShowDrive] = useState(false);
  const [showOperation, setShowOperation] = useState(false);
  const [showTwin, setShowTwin] = useState(false);
  const twinVisible = user?.role === "admin";
  const [showPiers, setShowPiers] = useState(true);
  const [placeHeight, setPlaceHeight] = useState<PlaceHeight>("auto");
  const [applyToRun, setApplyToRun] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<
    | { kind: "piece"; uid: string; dx: number; dy: number; moved: boolean }
    | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
    | { kind: "acc"; uid: string; dx: number; dy: number }
    | null
  >(null);

  // ---- 保存・復元 ----
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const l = JSON.parse(saved) as Layout;
        if (Array.isArray(l.pieces)) setLayout(l);
      }
    } catch {
      /* 保存データなし */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      /* 保存できない環境 */
    }
  }, [layout]);

  const fitView = useCallback((b: Board) => {
    const m = Math.max(b.width, b.height) * 0.08;
    setView({ x: -m, y: -m, w: b.width + 2 * m, h: b.height + 2 * m });
  }, []);
  useEffect(() => fitView(layout.board), [layout.board, fitView]);

  const maker: Maker = layout.maker ?? "kato";
  const analysis = useMemo(() => analyze(layout), [layout]);
  const accessories = useMemo(() => layout.accessories ?? [], [layout.accessories]);
  const sims = useMemo(() => layout.sims ?? [], [layout.sims]);
  const hasSims = sims.length > 0;
  // 仮オブジェクトがあるときだけ、展開図の連携が使えるかを1回確かめる
  useEffect(() => {
    if (!user || !hasSims || papercraftEnabled !== null) return;
    fetch("/api/papercraft")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => setPapercraftEnabled(!!d.enabled))
      .catch(() => setPapercraftEnabled(false));
  }, [user, hasSims, papercraftEnabled]);
  const bom = useMemo(() => billOfMaterials(layout.pieces, accessories), [layout.pieces, accessories]);
  const stock = useMemo(() => stockFromInventory(inventory, maker), [inventory, maker]);
  const hasStock = stock.size > 0;
  const need = useMemo(() => shortfall(usageOf(layout.pieces, accessories), stock), [layout.pieces, accessories, stock]);
  const needByKey = useMemo(() => new Map(need.rows.map((r) => [r.stockKey, r])), [need]);
  // 橋脚は勾配橋脚セットなどまとめ買いになるので、何も持っていない前提の買い方で箱数と費用を出す
  const pierBuy = useMemo(() => {
    const sf = shortfall(new Map([...usageOf(layout.pieces)].filter(([k]) => k.includes(":pier:"))), new Map());
    return { rows: new Map(sf.rows.map((r) => [r.stockKey, r])), total: sf.totalCostJpy };
  }, [layout.pieces]);
  const trackTotal = bom
    .filter((r) => r.kind !== "pier")
    .reduce((s, r) => s + (r.priceJpy != null && r.packs != null ? r.priceJpy * r.packs : 0), 0);
  const otherMakerPieces = layout.pieces.filter((p) => getPart(p.partId).maker !== maker).length;
  const openSet = useMemo(
    () => new Set(analysis.openJoints.map((j) => `${j.pieceUid}:${j.index}`)),
    [analysis],
  );
  const warnSet = useMemo(
    () =>
      new Set([
        ...analysis.outOfBoard,
        ...analysis.overlaps.flat(),
        ...analysis.steepGrades.map((g) => g.uid),
        ...analysis.heightSteps.flatMap((h) => [h.a.pieceUid, h.b.pieceUid]),
        ...analysis.pierHits.map((h) => h.uid),
      ]),
    [analysis],
  );
  const standardHeight = PIER_SYSTEMS[maker].standardHeight;
  // 部品ごとの階層（地上・勾配・高架）
  const levels = useMemo(() => {
    const m = new Map<string, Level>();
    for (const p of layout.pieces) {
      m.set(p.uid, isRamp(p) ? "ramp" : zRange(analysis.elevation, p.uid).max >= PIER_MIN_MM ? "elevated" : "ground");
    }
    return m;
  }, [layout.pieces, analysis]);
  const levelOf = (uid: string): Level => levels.get(uid) ?? "ground";
  const isVisible = (uid: string) => levelFilter === "all" || levelOf(uid) === levelFilter;
  const levelCounts = useMemo(() => {
    const c: Record<Level, number> = { ground: 0, ramp: 0, elevated: 0 };
    for (const l of levels.values()) c[l] += 1;
    return c;
  }, [levels]);
  // 低い部品から描き、高架が上に重なるようにする
  const drawOrder = useMemo(
    () =>
      [...layout.pieces].sort(
        (a, b) => zRange(analysis.elevation, a.uid).max - zRange(analysis.elevation, b.uid).max,
      ),
    [layout.pieces, analysis],
  );
  /** 選択中の部品の高さの説明 */
  const heightInfo = (uid: string): string => {
    const zs = analysis.elevation.joints.get(uid) ?? [0];
    const grade = analysis.elevation.grades.get(uid);
    const piers = analysis.piers.filter((p) => p.owners.includes(uid));
    const lo = Math.min(...zs);
    const hi = Math.max(...zs);
    const z = lo === hi ? `高さ ${heightText(Math.round(lo * 10) / 10)}mm` : `高さ ${heightText(Math.round(lo * 10) / 10)}〜${heightText(Math.round(hi * 10) / 10)}mm`;
    const g = grade !== undefined ? `・勾配 ${grade.toFixed(1)}%` : "";
    const p = piers.length ? `・橋脚 ${piers.map((q) => `${heightText(q.height)}mm`).join("/")}` : "";
    const viaduct = hi >= PIER_MIN_MM && !getPart(layout.pieces.find((q) => q.uid === uid)?.partId ?? "").elevatedProducts && levelOf(uid) !== "ground"
      ? "。この部品には高架用の品番がないため、台の自作が必要です"
      : "";
    return `${z}${g}${p}${viaduct}`;
  };
  const pierWarn = useMemo(() => new Set([...analysis.pierMisfits, ...analysis.pierHits.map((h) => h.pier)]), [analysis]);

  const setPieces = (fn: (pieces: Piece[]) => Piece[]) => setLayout((l) => ({ ...l, pieces: fn(l.pieces) }));
  const setAccessories = (fn: (as: Accessory[]) => Accessory[]) =>
    setLayout((l) => ({ ...l, accessories: fn(l.accessories ?? []) }));
  const accTotal = bom.filter((r) => r.kind === "accessory").reduce((s, r) => s + (r.priceJpy ?? 0) * r.count, 0);

  // ---- 線路以外のパーツの追加 ----
  const addAccessory = (key: string) => {
    const def = getAccessory(key);
    const uid = newAccessoryUid();
    const host = selection && selection.kind !== "acc" ? layout.pieces.find((q) => q.uid === selection.uid) : undefined;
    let acc: Accessory;
    if (host) {
      acc = placeOnPiece(def, host, analysis.elevation, "L", uid);
    } else {
      const b = layout.board;
      const center = { x: b.width / 2, y: b.height / 2 };
      const snapped = snapsToTrack(def.mount) ? snapAccessory(def, center, layout.pieces, analysis.elevation) : null;
      acc = snapped ? { uid, itemId: key, ...snapped } : { uid, itemId: key, x: center.x, y: center.y, rot: 0 };
    }
    setAccessories((as) => [...as, acc]);
    setSelection({ kind: "acc", uid });
  };

  // ---- 部品の追加 ----
  const addPart = (partId: string) => {
    const part = getPart(partId);
    const jIdx = Math.min(attachJoint, part.joints.length - 1);
    let target: { x: number; y: number; deg: number };
    if (selection?.kind === "joint") {
      const p = layout.pieces.find((q) => q.uid === selection.uid);
      const j = p && worldJoints(p)[selection.index];
      if (!j) return;
      target = j;
    } else {
      const b = layout.board;
      // 何も選んでいなければ、ボード上部の中央付近から右向きに置く
      target = { x: b.width / 2 - 250, y: Math.max(60, b.height * 0.12), deg: 0 };
    }
    // 置く高さ: つなぐ先に合わせる（auto）か、指定した階層
    let height: Pick<Piece, "z" | "ramp"> = {};
    const src = selection?.kind === "joint" ? layout.pieces.find((q) => q.uid === selection.uid) : undefined;
    if (placeHeight === "elevated") height = { z: standardHeight };
    else if (placeHeight === "ramp") height = { ramp: true };
    else if (placeHeight === "auto" && src) height = isRamp(src) ? { ramp: true } : src.z ? { z: src.z } : {};
    if (height.ramp && !part.rampEnds) height = {}; // ポイントなどは勾配にできない
    if (part.category === "bridge" && !height.ramp && !height.z) height = { z: standardHeight };
    const piece: Piece = { ...placeAt(partId, mirrorNext, jIdx, target, newUid()), ...height };
    const next = [...layout.pieces, piece];
    setPieces(() => next);
    // 続けてつなげるよう、新しい部品の空いている出口を選ぶ
    const a = analyze({ board: layout.board, pieces: next });
    const exits = a.openJoints.filter((j) => j.pieceUid === piece.uid && j.index !== jIdx);
    const exit = exits.find((j) => j.index === (jIdx === 0 ? 1 : 0)) ?? exits[0];
    setSelection(exit ? { kind: "joint", uid: piece.uid, index: exit.index } : { kind: "piece", uid: piece.uid });
  };

  // ---- 選択中の部品の操作 ----
  const selectedUid = selection && selection.kind !== "acc" ? selection.uid : null;
  const selectedAccUid = selection?.kind === "acc" ? selection.uid : null;
  const selectedAcc = selectedAccUid ? accessories.find((a) => a.uid === selectedAccUid) : undefined;
  const updateSelectedAcc = (fn: (a: Accessory) => Accessory) => {
    if (!selectedAccUid) return;
    setAccessories((as) => as.map((a) => (a.uid === selectedAccUid ? fn(a) : a)));
  };
  /** 選択中のパーツを線路の反対側へ（ホーム・信号機の柱） */
  const flipAccSide = () =>
    updateSelectedAcc((a) => {
      const def = getAccessory(a.itemId);
      const side = a.side === "R" ? "L" : "R";
      const host = a.host ? layout.pieces.find((p) => p.uid === a.host) : undefined;
      if (!host || !snapsToTrack(def.mount)) return { ...a, side };
      const s = snapAccessory(def, a, [host], analysis.elevation, { side, only: host.uid, rot: a.rot });
      return s ? { ...a, ...s } : { ...a, side };
    });
  const updateSelected = (fn: (p: Piece) => Piece) => {
    if (!selectedUid) return;
    setPieces((ps) => ps.map((p) => (p.uid === selectedUid ? fn(p) : p)));
  };
  const deleteSelected = () => {
    if (selectedAccUid) {
      setAccessories((as) => as.filter((a) => a.uid !== selectedAccUid));
      setSelection(null);
      return;
    }
    if (!selectedUid) return;
    setPieces((ps) => ps.filter((p) => p.uid !== selectedUid));
    setSelection(null);
  };
  const flipSelected = () => (selectedAccUid ? flipAccSide() : updateSelected((p) => ({ ...p, mirror: !p.mirror })));
  /** 選択中の部品を、同じ形で道床の違う部品に取り替える（位置・向き・高さはそのまま） */
  const changeBed = (partKey: string) => updateSelected((p) => ({ ...p, partId: partKey }));

  /** 選択中の部品の高さを変える。applyToRun なら、同じ設定でつながっている部品にもまとめて適用 */
  const setSelectedHeight = (next: { z?: number; ramp?: boolean }) => {
    if (!selectedUid) return;
    const origin = layout.pieces.find((p) => p.uid === selectedUid);
    if (!origin) return;
    const sameSetting = (p: Piece) => Boolean(p.ramp) === Boolean(origin.ramp) && (p.z ?? 0) === (origin.z ?? 0);
    const targets = new Set([selectedUid]);
    if (applyToRun) {
      const adj = new Map<string, string[]>();
      for (const c of analysis.connections) {
        adj.set(c.a.pieceUid, [...(adj.get(c.a.pieceUid) ?? []), c.b.pieceUid]);
        adj.set(c.b.pieceUid, [...(adj.get(c.b.pieceUid) ?? []), c.a.pieceUid]);
      }
      const byUid = new Map(layout.pieces.map((p) => [p.uid, p]));
      const queue = [selectedUid];
      while (queue.length) {
        const u = queue.pop()!;
        for (const v of adj.get(u) ?? []) {
          const pv = byUid.get(v);
          if (pv && !targets.has(v) && sameSetting(pv)) {
            targets.add(v);
            queue.push(v);
          }
        }
      }
    }
    setPieces((ps) =>
      ps.map((p) => {
        if (!targets.has(p.uid)) return p;
        const { z: _z, ramp: _r, ...rest } = p;
        void _z;
        void _r;
        if (next.ramp && getPart(p.partId).rampEnds) return { ...rest, ramp: true };
        return next.z ? { ...rest, z: next.z } : rest;
      }),
    );
  };
  const rotateSelected = (d: number) =>
    selectedAccUid
      ? updateSelectedAcc((a) => ({ ...a, rot: normDeg(a.rot + d) }))
      : updateSelected((p) => ({ ...p, rot: normDeg(p.rot + d) }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
      else if (e.key === "f" || e.key === "F") flipSelected();
      else if (e.key === "r") rotateSelected(15);
      else if (e.key === "R") rotateSelected(-15);
      else if (e.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- マウス操作 ----
  const toSvg = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  };

  const onPiecePointerDown = (piece: Piece) => (e: React.PointerEvent<SVGGElement>) => {
    e.stopPropagation();
    const p = toSvg(e);
    drag.current = { kind: "piece", uid: piece.uid, dx: p.x - piece.x, dy: p.y - piece.y, moved: false };
    svgRef.current?.setPointerCapture(e.pointerId);
    setSelection({ kind: "piece", uid: piece.uid });
  };

  const onAccPointerDown = (acc: Accessory) => (e: React.PointerEvent<SVGGElement>) => {
    e.stopPropagation();
    const p = toSvg(e);
    drag.current = { kind: "acc", uid: acc.uid, dx: p.x - acc.x, dy: p.y - acc.y };
    svgRef.current?.setPointerCapture(e.pointerId);
    setSelection({ kind: "acc", uid: acc.uid });
  };

  const onBgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      const rect = svgRef.current!.getBoundingClientRect();
      const scale = Math.max(view.w / rect.width, view.h / rect.height);
      setView((v) => ({ ...v, x: d.vx - (e.clientX - d.sx) * scale, y: d.vy - (e.clientY - d.sy) * scale }));
      return;
    }
    const p = toSvg(e);
    if (d.kind === "acc") {
      // 線路に吸着するパーツは近くの線路に合わせる（離すと自由に動く）
      const at = { x: p.x - d.dx, y: p.y - d.dy };
      setAccessories((as) =>
        as.map((a) => {
          if (a.uid !== d.uid) return a;
          const def = getAccessory(a.itemId);
          const s = snapsToTrack(def.mount) ? snapAccessory(def, at, layout.pieces, analysis.elevation, { rot: a.rot }) : null;
          if (s) return { ...a, ...s };
          const { host: _h, z: _z, ...rest } = a;
          void _h;
          void _z;
          return { ...rest, ...at };
        }),
      );
      return;
    }
    d.moved = true;
    setPieces((ps) => ps.map((q) => (q.uid === d.uid ? { ...q, x: p.x - d.dx, y: p.y - d.dy } : q)));
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "pan") {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) setSelection(null);
      return;
    }
    if (d.kind === "acc" || !d.moved) return;
    // 近くの空き端に吸着させる
    setPieces((ps) => {
      const piece = ps.find((q) => q.uid === d.uid);
      if (!piece) return ps;
      const others = analyze({ board: layout.board, pieces: ps.filter((q) => q.uid !== d.uid) }).openJoints;
      let best: { j: WorldJoint; index: number; dist: number } | null = null;
      for (const mj of worldJoints(piece)) {
        for (const oj of others) {
          const dist = Math.hypot(mj.x - oj.x, mj.y - oj.y);
          const ad = 180 - Math.abs(normDeg(mj.deg - oj.deg));
          if (dist < SNAP_MM && ad < SNAP_DEG && (!best || dist < best.dist)) best = { j: oj, index: mj.index, dist };
        }
      }
      if (!best) return ps;
      const snapped = placeAt(piece.partId, piece.mirror, best.index, best.j, piece.uid);
      return ps.map((q) => (q.uid === piece.uid ? snapped : q));
    });
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const p = toSvg(e);
    const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    setView((v) => {
      const w = Math.min(Math.max(v.w * k, 150), 20000);
      const h = (v.h / v.w) * w;
      return { x: p.x - ((p.x - v.x) * w) / v.w, y: p.y - ((p.y - v.y) * h) / v.h, w, h };
    });
  };

  // ---- AI ----
  const showPattern = (p: ProposedPattern, index: number) => {
    if (!p.ok) return;
    setLayout((l) => ({ ...l, ...patternLayout(p) }));
    setSelection(null);
    setCurrentId(null);
    setAi((a) => (a.status === "done" ? { ...a, shown: index } : a));
  };

  const runAi = async (fresh = false) => {
    if (needsStock(aiMode) && !hasStock) {
      setAi({ status: "error", message: "先に左の「所有パーツ」に品番と箱数を登録してください。" });
      return;
    }
    if (aiMode === "replica" && !replicaName.trim()) {
      setAi({ status: "error", message: `再現する${REPLICA_KIND_LABELS[replicaKind]}を入力してください。` });
      return;
    }
    if (aiMode === "replica" && replicaLevel === "faithful" && !window.confirm(FAITHFUL_CONFIRM)) return;
    setAi({ status: "loading" });
    try {
      const res = await fetch("/api/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          board: layout.board,
          request: aiMode === "replica" ? replicaExtra : request,
          maker,
          mode: aiMode,
          inventory,
          patterns: patternCount,
          budgetJpy,
          ...(aiMode === "replica" ? { replica: { kind: replicaKind, name: replicaName.trim(), level: replicaLevel } } : {}),
          fresh,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const patterns = data.patterns as ProposedPattern[];
      const first = patterns.findIndex((p) => p.ok);
      setAi({ status: "done", provider: data.provider, mode: data.mode, budgetJpy: data.budgetJpy ?? null, patterns, shown: first });
      if (first >= 0) {
        const p = patterns[first];
        if (p.ok) {
          setLayout((l) => ({ ...l, ...patternLayout(p) }));
          setSelection(null);
          setCurrentId(null);
        }
      }
    } catch (err) {
      setAi({ status: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setAiHistoryVersion((v) => v + 1);
    }
  };

  /** 自動保存の1件を、AI提案の1案の形にする */
  const entryPattern = (e: AiLayoutEntry): Extract<ProposedPattern, { ok: true }> =>
    ({ ...(e.value as object), ok: true }) as Extract<ProposedPattern, { ok: true }>;
  /** 自動保存の1件のボードとメーカー（頼んだときのもの。忠実はできた形に合わせたボード） */
  const entryBase = (e: AiLayoutEntry) => ({
    maker: ((MAKERS as readonly string[]).includes(e.maker) ? e.maker : "kato") as Maker,
    board: e.input?.board ?? e.board,
  });

  const openAiLayout = (e: AiLayoutEntry) => {
    setLayout((l) => ({ ...l, ...entryBase(e), ...patternLayout(entryPattern(e)) }));
    setSelection(null);
    setCurrentId(null);
    setAi((a) => (a.status === "done" ? { ...a, shown: -1 } : a));
  };

  /** 仮オブジェクトの展開図をジェネレーターに作ってもらい、印刷用の画面を開く */
  const makePapercraft = async (s: SimObject) => {
    // 非同期のあとに開くとポップアップとして止められるので、先に開いておく
    const win = window.open("", "_blank");
    if (win) win.document.title = "展開図を作成中…";
    setPapercraftBusy(s.uid);
    setPapercraftError(null);
    try {
      const res = await fetch("/api/papercraft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          object: { name: s.name, kind: s.kind, length: s.length, width: s.width, height: s.height, note: s.note ?? "" },
          paper: "A4",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const html = papercraftPrintHtml(s.name, data.pages as string[], (data.warnings as string[]) ?? []);
      if (win) {
        win.document.open();
        win.document.write(html);
        win.document.close();
      } else {
        setPapercraftError("ポップアップが止められました。ブラウザの設定でこのサイトのポップアップを許可してください。");
      }
    } catch (err) {
      win?.close();
      setPapercraftError(err instanceof Error ? err.message : String(err));
    } finally {
      setPapercraftBusy(null);
    }
  };

  const savePattern = (p: ProposedPattern) => {
    if (!p.ok) return;
    const id = `pat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const saved: SavedPattern = {
      id,
      name: p.plan.title,
      savedAt: new Date().toISOString(),
      layout: { maker, board: layout.board, ...patternLayout(p) },
    };
    setLibrary((ps) => [saved, ...ps]);
  };

  const saveAiLayout = (e: AiLayoutEntry) => {
    const p = entryPattern(e);
    const saved: SavedPattern = {
      id: `pat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name: p.plan.title,
      savedAt: new Date().toISOString(),
      layout: { ...entryBase(e), ...patternLayout(p) },
    };
    setLibrary((ps) => [saved, ...ps]);
    alert(`「${saved.name}」をパターンに登録しました`);
  };

  const selectedPiece = selectedUid ? layout.pieces.find((p) => p.uid === selectedUid) : undefined;
  const b = layout.board;
  const jointR = Math.max(view.w / 180, 5);

  return (
    <div className="app">
      <header className="header">
        <h1>
          <BrandLogo />
        </h1>
        <input
          className="title-input"
          value={layout.title}
          onChange={(e) => setLayout((l) => ({ ...l, title: e.target.value }))}
          aria-label="レイアウト名"
        />
        <UserMenu user={user} />
      </header>

      <aside className="panel left">
        <section>
          <h2>ボード</h2>
          <div className="row">
            <label>
              幅
              <input
                type="number"
                value={b.width}
                min={200}
                step={10}
                onChange={(e) => setLayout((l) => ({ ...l, board: { ...l.board, width: Number(e.target.value) || 200 } }))}
              />
            </label>
            <label>
              奥行
              <input
                type="number"
                value={b.height}
                min={200}
                step={10}
                onChange={(e) => setLayout((l) => ({ ...l, board: { ...l.board, height: Number(e.target.value) || 200 } }))}
              />
            </label>
            <span className="unit">mm</span>
          </div>
          <div className="chips">
            {BOARD_PRESETS.map((p) => (
              <button key={p.label} className="chip" onClick={() => setLayout((l) => ({ ...l, board: p.board }))}>
                {p.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <InventoryPanel maker={maker} inventory={inventory} setInventory={setInventory} bom={bom} />
        </section>

        <section>
          <h2>線路パーツ</h2>
          <div className="row">
            <div className="seg">
              {MAKERS.map((m) => (
                <button
                  key={m}
                  className={maker === m ? "on" : ""}
                  onClick={() => {
                    setLayout((l) => ({ ...l, maker: m }));
                    setAttachJoint(0);
                  }}
                >
                  {MAKER_INFO[m].label}
                </button>
              ))}
            </div>
          </div>
          {otherMakerPieces > 0 && (
            <p className="warn-text">
              {MAKER_INFO[maker].label}以外の線路が{otherMakerPieces}本あります（つなぐには変換線路が必要です）
            </p>
          )}
          <p className="hint">
            {selection?.kind === "joint" ? "選択中の端（青）につなぎます" : "端（赤い丸）をクリックして選ぶと、そこにつなげます"}
          </p>
          <div className="row">
            <div className="seg">
              <button className={!mirrorNext ? "on" : ""} onClick={() => setMirrorNext(false)}>
                左向き
              </button>
              <button className={mirrorNext ? "on" : ""} onClick={() => setMirrorNext(true)}>
                右向き
              </button>
            </div>
          </div>
          <div className="row">
            <label className="small">
              つなぐ側
              <select value={attachJoint} onChange={(e) => setAttachJoint(Number(e.target.value))}>
                <option value={0}>j0 始端（ポイントはトング側）</option>
                <option value={1}>j1 終端（ポイントは直進側）</option>
                <option value={2}>j2（ポイントの分岐側・複線の左側の線路）</option>
                <option value={3}>j3（3方ポイント・交差・複線の左側の終端）</option>
              </select>
            </label>
          </div>
          <div className="row">
            <label className="small">
              置く高さ
              <select value={placeHeight} onChange={(e) => setPlaceHeight(e.target.value as PlaceHeight)}>
                <option value="auto">つなぐ先に合わせる</option>
                <option value="ground">地上</option>
                <option value="elevated">高架（{standardHeight}mm）</option>
                <option value="ramp">勾配（前後の高さの間を自動で上り下り）</option>
              </select>
            </label>
          </div>
          <div className="chips cats">
            {(Object.keys(CATEGORY_LABELS) as PartCategory[])
              .filter((c) => partsFor(maker).some((p) => p.category === c))
              .map((c) => (
                <button key={c} className={`chip${category === c ? " on" : ""}`} onClick={() => setCategory(c)}>
                  {CATEGORY_LABELS[c]}
                </button>
              ))}
          </div>
          {(() => {
            const inCat = partsFor(maker).filter((p) => p.category === category);
            const beds = (Object.keys(BED_INFO) as BedType[]).filter((b) => inCat.some((p) => p.bed === b));
            const shown = bedFilter === "all" || !beds.includes(bedFilter) ? inCat : inCat.filter((p) => p.bed === bedFilter);
            return (
              <>
                {beds.length > 1 && (
                  <div className="chips beds" role="group" aria-label="道床で絞り込む">
                    <span className="hint" style={{ margin: 0, alignSelf: "center" }}>道床</span>
                    <button className={`chip${bedFilter === "all" || !beds.includes(bedFilter) ? " on" : ""}`} onClick={() => setBedFilter("all")}>
                      すべて
                    </button>
                    {beds.map((b) => (
                      <button key={b} className={`chip${bedFilter === b ? " on" : ""}`} onClick={() => setBedFilter(b)} title={BED_INFO[b].note}>
                        {BED_INFO[b].label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="palette">
                  {shown.map((p) => (
                    <div key={p.key} className="part-wrap">
                      <button
                        className="part"
                        onClick={() => addPart(p.key)}
                        title={[p.description, p.jointHelp, p.geometryNote].filter(Boolean).join("\n")}
                      >
                        <PartIcon partId={p.key} mirror={mirrorNext} />
                        <span>{p.name}</span>
                      </button>
                      <button className="info" onClick={() => setDetailKey(p.key)} aria-label={`${p.name}の仕様`} title="仕様の詳細">
                        i
                      </button>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </section>

        <section>
          <h2>線路以外のパーツ</h2>
          <p className="hint">
            {selection && selection.kind !== "acc"
              ? "選択中の線路のまんなかに置きます"
              : "線路を選んでから押すとその線路に置きます。ドラッグすると近くの線路に吸着します"}
          </p>
          <div className="chips cats accs">
            {KIND_ORDER.filter((k) => accessoriesFor(maker).some((a) => a.kind === k)).map((k) => (
              <button key={k} className={`chip${accKind === k ? " on" : ""}`} onClick={() => setAccKind(k)}>
                {ACCESSORY_KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <div className="palette">
            {accessoriesFor(maker)
              .filter((a) => a.kind === accKind)
              .map((a) => (
                <div key={a.key} className="part-wrap">
                  <button
                    className="part"
                    onClick={() => addAccessory(a.key)}
                    title={[`${a.code} ${a.name}（${yen(a.priceJpy)}）`, a.description, MOUNT_HELP[a.mount], a.geometryNote].filter(Boolean).join("\n")}
                  >
                    <AccessoryIcon itemKey={a.key} />
                    <span>{a.label}</span>
                  </button>
                </div>
              ))}
          </div>
        </section>

        <section>
          <h2>選択中の部品</h2>
          {selectedAcc ? (
            (() => {
              const def = getAccessory(selectedAcc.itemId);
              const host = selectedAcc.host ? layout.pieces.find((p) => p.uid === selectedAcc.host) : undefined;
              const replaced = def.replaces && host && getPart(host.partId).id === def.replaces;
              return (
                <>
                  <p className="hint">
                    {def.code} {def.name}（{yen(def.priceJpy)}）
                    <br />
                    {def.description}
                    {def.geometryNote && <><br />{def.geometryNote}</>}
                  </p>
                  <div className="row wrap">
                    <button onClick={() => rotateSelected(-15)}>⟲ 15°</button>
                    <button onClick={() => rotateSelected(15)}>⟳ 15°</button>
                    {(def.mount === "beside" || def.kind === "signal") && <button onClick={flipAccSide}>線路の反対側へ</button>}
                    <button className="danger" onClick={deleteSelected}>
                      削除
                    </button>
                  </div>
                  <p className="hint">
                    {host ? `線路（${getPart(host.partId).name}）に吸着しています` : snapsToTrack(def.mount) ? "線路の近くにドラッグすると吸着します" : MOUNT_HELP[def.mount]}
                    {selectedAcc.z ? `・高さ ${heightText(Math.round(selectedAcc.z))}mm` : ""}
                    {def.replaces &&
                      (replaced
                        ? `。製品に入っている線路を使うので、部品リストではこの${def.replaces}を数えません`
                        : `。${def.replaces}の上に置くと、部品リストでその線路を数えません`)}
                  </p>
                </>
              );
            })()
          ) : selectedPiece ? (
            <>
              <p className="hint">
                {getPart(selectedPiece.partId).name}
                {getPart(selectedPiece.partId).jointHelp && <><br />{getPart(selectedPiece.partId).jointHelp}</>}
              </p>
              <div className="row wrap">
                <button onClick={() => rotateSelected(-15)}>⟲ 15°</button>
                <button onClick={() => rotateSelected(15)}>⟳ 15°</button>
                <button onClick={flipSelected}>
                  左右反転
                </button>
                <button onClick={() => setDetailKey(selectedPiece.partId)}>仕様</button>
                <button className="danger" onClick={deleteSelected}>
                  削除
                </button>
              </div>
              <p className="hint">ドラッグで移動、近くの端に吸着します。キー: Delete / R / F</p>
              {(() => {
                const variants = bedVariantsOf(getPart(selectedPiece.partId));
                if (variants.length < 2) return null;
                return (
                  <>
                    <h3 className="sub">道床</h3>
                    <div className="chips beds" role="group" aria-label="道床を変える">
                      {variants.map((v) => (
                        <button
                          key={v.key}
                          className={`chip${v.key === getPart(selectedPiece.partId).key ? " on" : ""}`}
                          onClick={() => changeBed(v.key)}
                          title={BED_INFO[v.bed].note}
                        >
                          {BED_INFO[v.bed].label}
                        </button>
                      ))}
                    </div>
                  </>
                );
              })()}
              <h3 className="sub">高さ</h3>
              <div className="row">
                <div className="seg">
                  <button
                    className={!selectedPiece.ramp && !selectedPiece.z ? "on" : ""}
                    onClick={() => setSelectedHeight({})}
                  >
                    地上
                  </button>
                  <button
                    className={!selectedPiece.ramp && (selectedPiece.z ?? 0) > 0 ? "on" : ""}
                    onClick={() => setSelectedHeight({ z: standardHeight })}
                  >
                    高架
                  </button>
                  <button
                    className={selectedPiece.ramp ? "on" : ""}
                    disabled={!getPart(selectedPiece.partId).rampEnds}
                    title={getPart(selectedPiece.partId).rampEnds ? "前後の高さの間を自動で上り下りします" : "ポイント・交差は勾配にできません"}
                    onClick={() => setSelectedHeight({ ramp: true })}
                  >
                    勾配
                  </button>
                </div>
              </div>
              {!selectedPiece.ramp && (
                <div className="row">
                  <label className="small">
                    高さ（レール面、地上からmm）
                    <span className="input-row">
                      <input
                        type="number"
                        min={0}
                        max={300}
                        step={5}
                        value={selectedPiece.z ?? 0}
                        onChange={(e) => setSelectedHeight({ z: Math.max(0, Math.min(300, Number(e.target.value) || 0)) })}
                        aria-label="高さ"
                      />
                      <span className="unit">mm</span>
                    </span>
                  </label>
                </div>
              )}
              <label className="check">
                <input type="checkbox" checked={applyToRun} onChange={(e) => setApplyToRun(e.target.checked)} />
                つながっている同じ高さの線路にもまとめて適用
              </label>
              <p className="hint">{heightInfo(selectedPiece.uid)}</p>
            </>
          ) : (
            <p className="hint">線路やパーツをクリックすると選択できます</p>
          )}
        </section>

        <LibraryPanel
          layout={layout}
          patterns={library}
          setPatterns={setLibrary}
          currentId={currentId}
          setCurrentId={setCurrentId}
          onOpen={(l) => {
            setLayout({ ...l, maker: l.maker ?? "kato" });
            setSelection(null);
          }}
        />
        <section>
          <div className="row wrap">
            <button
              className="danger"
              onClick={() => {
                if (confirm("すべての線路とパーツを消しますか？")) {
                  setLayout((l) => ({ ...l, pieces: [], accessories: [], sims: [], replica: undefined }));
                  setSelection(null);
                }
              }}
            >
              線路とパーツを全消去
            </button>
          </div>
        </section>
      </aside>

      <main className="canvas-wrap">
        <svg
          ref={svgRef}
          className="canvas"
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          onPointerDown={onBgPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
        >
          <defs>
            <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
              <path d="M100 0 L0 0 0 100" className="grid-line" />
            </pattern>
          </defs>
          <rect x={0} y={0} width={b.width} height={b.height} className="board" />
          <rect x={0} y={0} width={b.width} height={b.height} fill="url(#grid)" pointerEvents="none" />
          <text x={4} y={-12} className="board-label">
            {b.width} × {b.height} mm（グリッド100mm）
          </text>
          {/* 仮オブジェクトは線路の下に描く（線路をクリックできるように） */}
          {sims.map((s) => (
            <SimObjectShape key={s.uid} sim={s} fontSize={Math.max(view.w / 110, 9)} layer="body" />
          ))}
          {drawOrder.map((p) => {
            const visible = isVisible(p.uid);
            if (!visible && hideOthers) return null;
            return (
              <TrackPiece
                key={p.uid}
                piece={p}
                selected={p.uid === selectedUid}
                warn={warnSet.has(p.uid)}
                level={levelOf(p.uid)}
                dim={!visible}
                onPointerDown={visible ? onPiecePointerDown(p) : undefined}
              />
            );
          })}
          {showPiers &&
            analysis.piers.map((pier, i) => {
              const visible = pier.owners.some(isVisible);
              if (!visible && hideOthers) return null;
              const s = pier.double ? 14 : 10;
              return (
                <rect
                  key={`pier${i}`}
                  x={pier.x - s / 2}
                  y={pier.y - s / 2}
                  width={s}
                  height={s}
                  rx={2}
                  className={`pier${pierWarn.has(i) ? " is-warn" : ""}${visible ? "" : " is-dim"}`}
                >
                  <title>{`${pier.double ? "複線" : "単線"}橋脚 ${heightText(pier.height)}mm（線路の高さ ${heightText(pier.z)}mm）`}</title>
                </rect>
              );
            })}
          {layout.pieces
            .filter((p) => levelOf(p.uid) !== "ground" && isVisible(p.uid))
            .map((p) => {
              const zs = analysis.elevation.joints.get(p.uid) ?? [0];
              const mid = midPoint(p);
              const text = levelOf(p.uid) === "ramp" ? `${heightText(Math.round(zs[0]))}→${heightText(Math.round(zs[1] ?? zs[0]))}` : heightText(zs[0]);
              return (
                <text key={`z${p.uid}`} x={mid.x} y={mid.y} className="z-label" style={{ fontSize: Math.max(view.w / 110, 9) }}>
                  {text}
                </text>
              );
            })}
          {accessories.map((a) => {
            const visible = !a.host || isVisible(a.host);
            if (!visible && hideOthers) return null;
            return (
              <AccessoryShape
                key={a.uid}
                acc={a}
                selected={a.uid === selectedAccUid}
                dim={!visible}
                onPointerDown={visible ? onAccPointerDown(a) : undefined}
              />
            );
          })}
          {sims.map((s) => (
            <SimObjectShape key={`l${s.uid}`} sim={s} fontSize={Math.max(view.w / 110, 9)} layer="label" />
          ))}
          {layout.pieces.filter((p) => isVisible(p.uid)).flatMap((p) =>
            worldJoints(p)
              .filter((j) => openSet.has(`${j.pieceUid}:${j.index}`))
              .map((j) => {
                const sel = selection?.kind === "joint" && selection.uid === j.pieceUid && selection.index === j.index;
                return (
                  <circle
                    key={`${j.pieceUid}:${j.index}`}
                    cx={j.x}
                    cy={j.y}
                    r={sel ? jointR * 1.4 : jointR}
                    className={`joint${sel ? " is-selected" : ""}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelection({ kind: "joint", uid: j.pieceUid, index: j.index });
                    }}
                  />
                );
              }),
          )}
        </svg>
        <div className="levels">
          <span className="seg" role="group" aria-label="表示する階層">
            {LEVEL_FILTERS.map((f) => (
              <button
                key={f.value}
                className={levelFilter === f.value ? "on" : ""}
                onClick={() => setLevelFilter(f.value)}
                title={f.value === "all" ? "すべての高さを表示" : `${f.label}の線路だけを強調`}
              >
                {f.value !== "all" && <i className={`swatch lv-${f.value}`} />}
                {f.label}
                {f.value !== "all" && <span className="muted"> {levelCounts[f.value]}</span>}
              </button>
            ))}
          </span>
          <label className="check">
            <input type="checkbox" checked={hideOthers} onChange={(e) => setHideOthers(e.target.checked)} disabled={levelFilter === "all"} />
            ほかの階層を隠す
          </label>
          <label className="check">
            <input type="checkbox" checked={showPiers} onChange={(e) => setShowPiers(e.target.checked)} />
            橋脚
          </label>
          <button className={showProfile ? "on" : ""} onClick={() => setShowProfile((v) => !v)}>
            断面図
          </button>
          <button
            className={showDrive ? "on" : ""}
            onClick={() => setShowDrive(true)}
            disabled={layout.pieces.length === 0}
            title="線路の上を運転席の視点で走る3Dの映像（選択中の部品から走り始めます）"
          >
            ▶ 運転席で走る
          </button>
          <button
            className={showOperation ? "on" : ""}
            onClick={() => setShowOperation(true)}
            disabled={layout.pieces.length === 0}
            title="ホームを置いた駅に列車を走らせる計画（ダイヤ）を立て、時刻表とダイヤグラムを作ります"
          >
            運行計画
          </button>
          {/* デジタルツインは開発を止めているあいだ管理者だけに出す（全員に戻すときは条件を外す） */}
          {twinVisible && (
            <button
              className={showTwin ? "on" : ""}
              onClick={() => setShowTwin(true)}
              disabled={layout.pieces.length === 0}
              title="実物のレイアウト（いまは模擬の実機）とつなぎ、列車の位置・ポイント・センサーを映して操作します"
            >
              デジタルツイン
            </button>
          )}
        </div>
        {showProfile && (
          <LevelProfile
            pieces={layout.pieces.filter((p) => isVisible(p.uid))}
            elevation={analysis.elevation}
            piers={analysis.piers.filter((pr) => pr.owners.some(isVisible))}
            board={b}
            standardHeight={standardHeight}
            levelOf={levelOf}
            selectedUid={selectedUid}
            onClose={() => setShowProfile(false)}
          />
        )}
        <div className="zoom">
          <button onClick={() => fitView(b)}>全体表示</button>
        </div>
      </main>
      {showDrive && <DriveView layout={layout} startUid={selectedUid} onClose={() => setShowDrive(false)} />}
      {showOperation && (
        <OperationView
          layout={layout}
          elevation={analysis.elevation}
          canUseAi={!!user}
          onChange={(operation) => setLayout((l) => ({ ...l, operation }))}
          onClose={() => setShowOperation(false)}
        />
      )}
      {showTwin && twinVisible && <TwinView layout={layout} elevation={analysis.elevation} onClose={() => setShowTwin(false)} />}

      <aside className="panel right">
        <section className="ai">
          <h2>AIにレイアウトを提案してもらう</h2>
          {user ? (
            <>
          <AiStatus user={user} />
          <div className="row">
            <div className="seg">
              {AI_MODES.map((m) => (
                <button key={m.mode} className={aiMode === m.mode ? "on" : ""} onClick={() => setAiMode(m.mode)} title={m.help}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <p className="hint">{AI_MODES.find((m) => m.mode === aiMode)!.help}</p>
          {needsStock(aiMode) && !hasStock && <p className="warn-text">所有パーツが未登録です（左の「所有パーツ」から登録）</p>}
          {aiMode === "replica" && (
            <>
              <div className="replica-input">
                <span className="seg" role="group" aria-label="再現するもの">
                  {(["line", "station"] as const).map((k) => (
                    <button key={k} className={replicaKind === k ? "on" : ""} onClick={() => setReplicaKind(k)}>
                      {REPLICA_KIND_LABELS[k]}
                    </button>
                  ))}
                </span>
                <input
                  type="text"
                  value={replicaName}
                  maxLength={60}
                  onChange={(e) => setReplicaName(e.target.value)}
                  placeholder={replicaKind === "line" ? "例: 山手線、箱根登山鉄道" : "例: 東京駅、嵯峨野観光鉄道のトロッコ嵐山駅"}
                  aria-label={REPLICA_KIND_LABELS[replicaKind]}
                />
              </div>
              <div className="replica-level">
                <span className="replica-level-label">再現度</span>
                <span className="seg" role="group" aria-label="再現度">
                  {REPLICA_LEVELS.map((lv) => (
                    <button key={lv} className={replicaLevel === lv ? "on" : ""} onClick={() => setReplicaLevel(lv)}>
                      {REPLICA_LEVEL_LABELS[lv]}
                    </button>
                  ))}
                </span>
              </div>
              <p className="hint">{REPLICA_LEVEL_HELP[replicaLevel]}</p>
              <p className="hint">
                {replicaKind === "line"
                  ? "複線・単線、高架やトンネル、カーブなど路線の特徴と、沿線の有名なストラクチャーを再現します。"
                  : "ホームの形（島式・対向式）や番線数、駅舎の形を再現します。複数の路線が乗り入れる駅は、それぞれの路線を再現します。"}
                製品にない物は点線の「仮」オブジェクト（シミュレーション上のみ）で置きます。
              </p>
            </>
          )}
          <textarea
            value={aiMode === "replica" ? replicaExtra : request}
            onChange={(e) => (aiMode === "replica" ? setReplicaExtra(e.target.value) : setRequest(e.target.value))}
            rows={aiMode === "replica" ? 2 : 4}
            placeholder={aiMode === "replica" ? "追加の要望（任意）。例: エンドレスにして周回できるように" : "例: 複線のエンドレスと、車両基地への引き込み線を2本"}
          />
          <div className="row">
            <label className="small">
              出す案の数
              <select value={patternCount} onChange={(e) => setPatternCount(Number(e.target.value))}>
                <option value={1}>1案</option>
                <option value={2}>2案</option>
                <option value={3}>3案</option>
              </select>
            </label>
          </div>
          {aiMode !== "owned" && (
            <div className="row">
              <label className="small">
                予算の上限（任意）
                <span className="input-row">
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={budget}
                    placeholder="上限なし"
                    onChange={(e) => setBudget(e.target.value)}
                    aria-label="予算の上限"
                  />
                  <span className="unit">円</span>
                </span>
              </label>
            </div>
          )}
          {budgetJpy !== undefined && (
            <p className="hint">
              追加で買う部品の合計（メーカー希望小売価格・税込）が{yen(budgetJpy)}以内の案だけを出します
              {hasStock ? "。所有パーツの分は費用に数えません" : ""}。
            </p>
          )}
          <button className="primary" onClick={() => runAi()} disabled={ai.status === "loading"}>
            {ai.status === "loading" ? "設計中…（1〜3分かかります）" : "提案してもらう"}
          </button>
          <p className="hint">今のボードの大きさで設計し、1つ目の案がキャンバスに表示されます（編集中の線路は置き換わります）。</p>
          {ai.status === "error" && <p className="error">{ai.message}</p>}
          {ai.status === "done" && ai.patterns.some((p) => p.ok && p.cached) && (
            <p className="hint">
              {(() => {
                const at = ai.patterns.find((p) => p.ok && p.cached && p.savedAt);
                const when = at?.ok && at.savedAt ? `${new Date(at.savedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}に` : "前に";
                return `同じ条件で${when}作った案を、自動保存から表示しています（AIは使っていないのでトークンはかかりません）。`;
              })()}
              <button type="button" className="link-button" onClick={() => runAi(true)}>
                新しく作り直す
              </button>
            </p>
          )}
          {ai.status === "done" && (
            <ol className="proposals">
              {ai.patterns.map((p, i) => (
                <li key={i} className={i === ai.shown ? "on" : ""}>
                  {p.ok ? (
                    <>
                      <div className="proposal-head">
                        <strong>案{i + 1}: {p.plan.title}</strong>
                        <span className={p.remainingProblems ? "warn-text" : "ok-text"}>
                          {p.remainingProblems ? "要手直し" : "検証OK"}
                        </span>
                      </div>
                      {p.hint && <p className="hint">{p.hint}</p>}
                      {p.replica && (
                        <p className="hint">
                          再現: {p.replica.target}（再現度: {REPLICA_LEVEL_LABELS[p.replica.level ?? "standard"]}）
                          {p.replica.lines && p.replica.lines.length > 0 && ` ／ ${p.replica.lines.length}路線`}
                          {p.sims && p.sims.length > 0 && ` ／ 仮オブジェクト ${p.sims.length}個（シミュレーション上のみ）`}
                        </p>
                      )}
                      <p className="hint">
                        {p.pieces.length}本
                        {(needsStock(ai.mode) || ai.budgetJpy !== null) &&
                          (p.shortfall.totalCostJpy > 0 || p.shortfall.hasUnknownPrice
                            ? ` ／ 追加 ${p.shortfall.rows.filter((r) => r.missing > 0).length}品番・${yen(p.shortfall.totalCostJpy)}${p.shortfall.hasUnknownPrice ? "＋価格不明分" : ""}${ai.budgetJpy !== null ? `（上限${yen(ai.budgetJpy)}）` : ""}`
                            : " ／ 追加購入なし")}
                        {` ／ ${p.model}・${p.attempts}回`}
                      </p>
                      {(needsStock(ai.mode) || ai.budgetJpy !== null) && p.shortfall.rows.some((r) => r.missing > 0) && (
                        <table className="bom">
                          <tbody>
                            {p.shortfall.rows
                              .filter((r) => r.missing > 0)
                              .map((r) => (
                                <tr key={r.stockKey}>
                                  <td className="code">{r.buy?.code ?? r.partId}</td>
                                  <td>{r.buy?.name ?? r.partId}</td>
                                  <td className="num">{r.missing}本</td>
                                  <td className="num">{r.packs}箱</td>
                                  <td className="num">{r.costJpy === null ? "—" : yen(r.costJpy)}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      )}
                      <div className="row wrap">
                        <button onClick={() => showPattern(p, i)} disabled={i === ai.shown}>
                          {i === ai.shown ? "表示中" : "表示して編集"}
                        </button>
                        <button onClick={() => savePattern(p)}>登録</button>
                      </div>
                    </>
                  ) : (
                    <p className="error">案{i + 1}: {p.error}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
          <AiHistoryPanel version={aiHistoryVersion} onOpen={openAiLayout} onSave={saveAiLayout} />
            </>
          ) : (
            <div className="guest-ai">
              <p>AI提案はログインした人が使えます。ログインしなくても、線路の配置・部品リスト・運転席の映像・ブラウザへの保存とファイルの書き出しはそのまま使えます。</p>
              <p>
                <a href="/signup">ユーザー登録</a>すると、自分のAPIキーを設定してAI提案を使えます。登録済みの方は<a href="/login">ログイン</a>してください。
              </p>
            </div>
          )}
          {layout.description && <p className="desc">{layout.description}</p>}
          {(layout.replica || sims.length > 0) && (
            <div className="sim-note">
              {layout.replica && (
                <>
                  <strong>
                    再現してみた: {layout.replica.target}（{REPLICA_KIND_LABELS[layout.replica.kind]}・再現度: {REPLICA_LEVEL_LABELS[layout.replica.level ?? "standard"]}）
                  </strong>
                  {layout.replica.lines && layout.replica.lines.length > 0 && (
                    <p className="hint">乗り入れ路線: {layout.replica.lines.join("、")}</p>
                  )}
                  {layout.replica.features.length > 0 && (
                    <ul>
                      {layout.replica.features.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              {sims.length > 0 && (
                <>
                  <p className="hint">仮オブジェクト（{sims.length}個）</p>
                  <ul>
                    {sims.map((s) => (
                      <li key={s.uid}>
                        {s.name}（{SIM_KIND_LABELS[s.kind]}）{s.note && <span className="muted">: {s.note}</span>}{" "}
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => setLayout((l) => ({ ...l, sims: (l.sims ?? []).filter((x) => x.uid !== s.uid) }))}
                        >
                          消す
                        </button>
                        {papercraftEnabled && (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => makePapercraft(s)}
                            disabled={papercraftBusy !== null}
                            title="ペーパークラフトジェネレーターで、この仮オブジェクトの展開図（実寸・A4）を作って印刷用の画面を開きます"
                          >
                            {papercraftBusy === s.uid ? "展開図を作成中…" : "展開図"}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {papercraftError && <p className="error">{papercraftError}</p>}
                </>
              )}
              <p className="warn-text small-text">{SIM_DISCLAIMER}</p>
            </div>
          )}
        </section>

        <section>
          <h2>確認結果</h2>
          <ul className="checks">
            <li className={analysis.openJoints.length ? "ng" : "ok"}>
              つながっていない端: {analysis.openJoints.length}
            </li>
            <li className={analysis.nearMisses.length ? "ng" : "ok"}>ずれ: {analysis.nearMisses.length}</li>
            <li className={analysis.outOfBoard.length ? "ng" : "ok"}>ボード外: {analysis.outOfBoard.length}</li>
            <li className={analysis.overlaps.length ? "ng" : "ok"}>
              重なり: {analysis.overlaps.length}
              {analysis.lowClearance.length > 0 && `（うち高さ不足 ${analysis.lowClearance.length}）`}
            </li>
            <li className={analysis.heightSteps.length ? "ng" : "ok"}>段差: {analysis.heightSteps.length}</li>
            <li className={analysis.steepGrades.length ? "ng" : "ok"}>
              急勾配（{PIER_SYSTEMS[maker].maxGradePct}%超）: {analysis.steepGrades.length}
            </li>
            <li className={analysis.pierHits.length || analysis.pierMisfits.length ? "ng" : "ok"}>
              橋脚の問題: {analysis.pierHits.length + analysis.pierMisfits.length}
            </li>
            {analysis.crossings.length > 0 && <li className="ok">立体交差: {analysis.crossings.length}</li>}
          </ul>
          {(analysis.elevation.grades.size > 0 || analysis.piers.length > 0) && (
            <p className="hint">
              {analysis.elevation.grades.size > 0 &&
                `最大勾配 ${Math.max(...analysis.elevation.grades.values()).toFixed(1)}%。`}
              {analysis.piers.length > 0 && `橋脚 ${analysis.piers.length}本。`}
              {PIER_SYSTEMS[maker].note}。立体交差は高さの差 {PIER_SYSTEMS[maker].clearance}mm 以上。
            </p>
          )}
          {analysis.pierHits.length > 0 && (
            <p className="warn-text">橋脚が下の線路に当たっています（赤い四角）。上の線路のつなぎ目を下の線路の真上からずらしてください。</p>
          )}
          {analysis.pierMisfits.length > 0 && (
            <p className="warn-text">合う高さの橋脚がない所があります（赤い四角）。高架は標準の高さにそろえるのがおすすめです。</p>
          )}
        </section>

        <section>
          <h2>部品リスト</h2>
          {layout.pieces.length === 0 && accessories.length === 0 ? (
            <p className="hint">まだ線路がありません</p>
          ) : (
            <>
              <table className="bom">
                <thead>
                  <tr>
                    <th>品番</th>
                    <th>製品</th>
                    <th className="num">本</th>
                    {hasStock && <th className="num">不足</th>}
                    <th className="num">箱</th>
                    <th className="num">価格</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.map((r) => {
                    const pier = r.kind === "pier" ? pierBuy.rows.get(r.key) : undefined;
                    return (
                      <tr
                        key={r.key}
                        className={r.kind === "pier" ? "pier-row" : r.kind === "accessory" ? "acc-row" : undefined}
                        title={r.alternatives.length ? `ほかの品番: ${r.alternatives.map((a) => `${a.code} ${a.name}`).join(" / ")}` : undefined}
                      >
                        <td className="code">{pier ? (pier.buy?.code ?? "—") : r.product.code}</td>
                        <td>
                          {r.kind === "pier" ? r.label : r.product.name}
                          {r.kind === "track" && r.alternatives.length > 0 && <span className="muted"> 他{r.alternatives.length}</span>}
                          {pier && pier.packs === 0 && <span className="muted">（セットに含む）</span>}
                        </td>
                        <td className="num">{r.count}</td>
                        {hasStock && (
                          <td className={`num${(needByKey.get(r.key)?.missing ?? 0) > 0 ? " warn-text" : ""}`}>
                            {needByKey.get(r.key)?.missing || "—"}
                          </td>
                        )}
                        <td className="num">{pier ? pier.packs || "—" : (r.packs ?? "—")}</td>
                        <td className="num">
                          {pier
                            ? pier.packs
                              ? pier.costJpy === null
                                ? "—"
                                : yen(pier.costJpy)
                              : "—"
                            : r.priceJpy != null && r.packs != null
                              ? yen(r.priceJpy * r.packs)
                              : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="hint">
                すべて新しく買う場合: {yen(trackTotal + pierBuy.total)}
                {(pierBuy.total > 0 || accTotal > 0) &&
                  `（うち${[pierBuy.total > 0 ? `橋脚 ${yen(pierBuy.total)}` : "", accTotal > 0 ? `線路以外のパーツ ${yen(accTotal)}` : ""].filter(Boolean).join("・")}）`}
                {hasStock && (
                  <>
                    <br />
                    所有パーツとの差分: 追加 {need.rows.filter((r) => r.missing > 0).length}品番・{yen(need.totalCostJpy)}
                    {need.hasUnknownPrice && "（価格不明分を除く）"}
                  </>
                )}
              </p>
              <p className="hint">
                合計 {layout.pieces.length} 本 / 線路延長 約{(analysis.totalLengthMm / 1000).toFixed(2)}m。箱と価格は代表品番の入数・メーカー希望小売価格（税込）で計算。不足の追加費用は1本あたりが安い品番で計算。
                高さのある線路は高架用の品番（高架線路・高架橋付レール）で数え、橋脚は高さごとに数えています。
                踏切・信号機などで線路の入っている製品は、その線路の上に置くと線路の本数から差し引いています。
              </p>
              <p className="hint">
                品番の出典:{" "}
                <a href={CATALOG_SOURCES[maker].urls[0]} target="_blank" rel="noreferrer">
                  {CATALOG_SOURCES[maker].label} 公式サイト
                </a>
                （{CATALOG_SOURCES[maker].fetchedAt} 時点）
              </p>
            </>
          )}
        </section>
      </aside>
      {detailKey && (
        <PartDetail
          partKey={detailKey}
          mirror={mirrorNext}
          onClose={() => setDetailKey(null)}
          onShow={setDetailKey}
          onPlace={(k) => {
            addPart(k);
            setDetailKey(null);
          }}
        />
      )}
    </div>
  );
}

/** 部品の中心線のまんなかの点（高さの表示位置） */
function midPoint(piece: Piece) {
  const pts = worldSamples(piece, 10);
  return pts[Math.floor(pts.length / 2)] ?? { x: piece.x, y: piece.y };
}
