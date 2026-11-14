"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analyze,
  newUid,
  placeAt,
  worldJoints,
  type Board,
  type Layout,
  type Piece,
  type WorldJoint,
} from "@/lib/geometry";
import { billOfMaterials, usageOf } from "@/lib/bom";
import { shortfall, stockFromInventory, type Inventory, type Shortfall } from "@/lib/productDb";
import type { SavedPattern } from "@/lib/patternFile";
import { CATALOG_SOURCES } from "@/data/trackCatalog";
import { CATEGORY_LABELS, getPart, MAKER_INFO, MAKERS, normDeg, partsFor, type Maker } from "@/lib/parts";
import type { PartCategory } from "@/data/trackCatalog";
import { routeSamples } from "@/lib/shapes";
import { AiSettingsPanel, useAiSettings } from "./AiSettingsPanel";
import { TrackPiece } from "./TrackPiece";
import { InventoryPanel, yen } from "./InventoryPanel";
import { LibraryPanel } from "./LibraryPanel";
import { useLocalState } from "./useLocalState";

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

type Selection = { kind: "joint"; uid: string; index: number } | { kind: "piece"; uid: string } | null;

type ProposedPattern =
  | {
      ok: true;
      plan: { title: string; description: string };
      pieces: Piece[];
      attempts: number;
      remainingProblems: string | null;
      model: string;
      hint: string | null;
      shortfall: Shortfall;
    }
  | { ok: false; error: string };

type AiMode = "free" | "owned" | "expand";
const AI_MODES: { mode: AiMode; label: string; help: string }[] = [
  { mode: "free", label: "自由に", help: "部品の制限なしで設計します" },
  { mode: "owned", label: "手持ちだけ", help: "登録した所有パーツの本数の範囲だけで組める案を出します" },
  { mode: "expand", label: "拡張案", help: "所有パーツを活かし、買い足しで広げる案を出します（追加の部品と費用つき）" },
];

type AiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; provider: string; mode: AiMode; patterns: ProposedPattern[]; shown: number }
  | { status: "error"; message: string };

const isInventory = (v: unknown): v is Inventory =>
  !!v && typeof v === "object" && Object.values(v as object).every((n) => typeof n === "number");
const isPatterns = (v: unknown): v is SavedPattern[] => Array.isArray(v);

export function Editor() {
  const [layout, setLayout] = useState<Layout>(emptyLayout);
  const [selection, setSelection] = useState<Selection>(null);
  const [mirrorNext, setMirrorNext] = useState(false);
  const [attachJoint, setAttachJoint] = useState(0);
  const [category, setCategory] = useState<PartCategory>("straight");
  const [request, setRequest] = useState("エンドレスに待避線を1本。駅を置けるスペースもほしい");
  const [ai, setAi] = useState<AiState>({ status: "idle" });
  const aiSettings = useAiSettings();
  const [aiMode, setAiMode] = useState<AiMode>("free");
  const [patternCount, setPatternCount] = useState(1);
  const [inventory, setInventory] = useLocalState<Inventory>("nine-gage-inventory-v1", {}, isInventory);
  const [library, setLibrary] = useLocalState<SavedPattern[]>("nine-gage-library-v1", [], isPatterns);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [view, setView] = useState({ x: -100, y: -100, w: 1400, h: 800 });
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<
    | { kind: "piece"; uid: string; dx: number; dy: number; moved: boolean }
    | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
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
  const bom = useMemo(() => billOfMaterials(layout.pieces), [layout.pieces]);
  const stock = useMemo(() => stockFromInventory(inventory, maker), [inventory, maker]);
  const hasStock = stock.size > 0;
  const need = useMemo(() => shortfall(usageOf(layout.pieces), stock), [layout.pieces, stock]);
  const needByKey = useMemo(() => new Map(need.rows.map((r) => [r.stockKey, r])), [need]);
  const otherMakerPieces = layout.pieces.filter((p) => getPart(p.partId).maker !== maker).length;
  const openSet = useMemo(
    () => new Set(analysis.openJoints.map((j) => `${j.pieceUid}:${j.index}`)),
    [analysis],
  );
  const warnSet = useMemo(
    () => new Set([...analysis.outOfBoard, ...analysis.overlaps.flat()]),
    [analysis],
  );

  const setPieces = (fn: (pieces: Piece[]) => Piece[]) => setLayout((l) => ({ ...l, pieces: fn(l.pieces) }));

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
    const piece = placeAt(partId, mirrorNext, jIdx, target, newUid());
    const next = [...layout.pieces, piece];
    setPieces(() => next);
    // 続けてつなげるよう、新しい部品の空いている出口を選ぶ
    const a = analyze({ board: layout.board, pieces: next });
    const exits = a.openJoints.filter((j) => j.pieceUid === piece.uid && j.index !== jIdx);
    const exit = exits.find((j) => j.index === (jIdx === 0 ? 1 : 0)) ?? exits[0];
    setSelection(exit ? { kind: "joint", uid: piece.uid, index: exit.index } : { kind: "piece", uid: piece.uid });
  };

  // ---- 選択中の部品の操作 ----
  const selectedUid = selection?.uid ?? null;
  const updateSelected = (fn: (p: Piece) => Piece) => {
    if (!selectedUid) return;
    setPieces((ps) => ps.map((p) => (p.uid === selectedUid ? fn(p) : p)));
  };
  const deleteSelected = () => {
    if (!selectedUid) return;
    setPieces((ps) => ps.filter((p) => p.uid !== selectedUid));
    setSelection(null);
  };
  const flipSelected = () => updateSelected((p) => ({ ...p, mirror: !p.mirror }));
  const rotateSelected = (d: number) => updateSelected((p) => ({ ...p, rot: normDeg(p.rot + d) }));

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
    if (!d.moved) return;
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
    setLayout((l) => ({ ...l, title: p.plan.title, description: p.plan.description, pieces: p.pieces }));
    setSelection(null);
    setCurrentId(null);
    setAi((a) => (a.status === "done" ? { ...a, shown: index } : a));
  };

  const runAi = async () => {
    if (aiMode !== "free" && !hasStock) {
      setAi({ status: "error", message: "先に左の「所有パーツ」に品番と箱数を登録してください。" });
      return;
    }
    setAi({ status: "loading" });
    try {
      const res = await fetch("/api/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          board: layout.board,
          request,
          ai: aiSettings.settings,
          maker,
          mode: aiMode,
          inventory,
          patterns: patternCount,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const patterns = data.patterns as ProposedPattern[];
      const first = patterns.findIndex((p) => p.ok);
      setAi({ status: "done", provider: data.provider, mode: data.mode, patterns, shown: first });
      if (first >= 0) {
        const p = patterns[first];
        if (p.ok) {
          setLayout((l) => ({ ...l, title: p.plan.title, description: p.plan.description, pieces: p.pieces }));
          setSelection(null);
          setCurrentId(null);
        }
      }
    } catch (err) {
      setAi({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const savePattern = (p: ProposedPattern) => {
    if (!p.ok) return;
    const id = `pat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const saved: SavedPattern = {
      id,
      name: p.plan.title,
      savedAt: new Date().toISOString(),
      layout: { title: p.plan.title, description: p.plan.description, maker, board: layout.board, pieces: p.pieces },
    };
    setLibrary((ps) => [saved, ...ps]);
  };

  const selectedPiece = selectedUid ? layout.pieces.find((p) => p.uid === selectedUid) : undefined;
  const b = layout.board;
  const jointR = Math.max(view.w / 180, 5);

  return (
    <div className="app">
      <header className="header">
        <h1>Nine-Gage レイアウトプランナー</h1>
        <input
          className="title-input"
          value={layout.title}
          onChange={(e) => setLayout((l) => ({ ...l, title: e.target.value }))}
          aria-label="レイアウト名"
        />
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
          <div className="chips cats">
            {(Object.keys(CATEGORY_LABELS) as PartCategory[])
              .filter((c) => partsFor(maker).some((p) => p.category === c))
              .map((c) => (
                <button key={c} className={`chip${category === c ? " on" : ""}`} onClick={() => setCategory(c)}>
                  {CATEGORY_LABELS[c]}
                </button>
              ))}
          </div>
          <div className="palette">
            {partsFor(maker)
              .filter((p) => p.category === category)
              .map((p) => (
              <button
                key={p.key}
                className="part"
                onClick={() => addPart(p.key)}
                title={[p.description, p.jointHelp, p.geometryNote].filter(Boolean).join("\n")}
              >
                <PartIcon partId={p.key} mirror={mirrorNext} />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>選択中の部品</h2>
          {selectedPiece ? (
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
                <button className="danger" onClick={deleteSelected}>
                  削除
                </button>
              </div>
              <p className="hint">ドラッグで移動、近くの端に吸着します。キー: Delete / R / F</p>
            </>
          ) : (
            <p className="hint">線路をクリックすると選択できます</p>
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
                if (confirm("すべての線路を消しますか？")) {
                  setPieces(() => []);
                  setSelection(null);
                }
              }}
            >
              線路を全消去
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
          {layout.pieces.map((p) => (
            <TrackPiece
              key={p.uid}
              piece={p}
              selected={p.uid === selectedUid}
              warn={warnSet.has(p.uid)}
              onPointerDown={onPiecePointerDown(p)}
            />
          ))}
          {layout.pieces.flatMap((p) =>
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
        <div className="zoom">
          <button onClick={() => fitView(b)}>全体表示</button>
        </div>
      </main>

      <aside className="panel right">
        <section className="ai">
          <h2>AIにレイアウトを提案してもらう</h2>
          <AiSettingsPanel {...aiSettings} />
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
          {aiMode !== "free" && !hasStock && <p className="warn-text">所有パーツが未登録です（左の「所有パーツ」から登録）</p>}
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            rows={4}
            placeholder="例: 複線のエンドレスと、車両基地への引き込み線を2本"
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
          <button className="primary" onClick={runAi} disabled={ai.status === "loading"}>
            {ai.status === "loading" ? "設計中…（1〜3分かかります）" : "提案してもらう"}
          </button>
          <p className="hint">今のボードの大きさで設計し、1つ目の案がキャンバスに表示されます（編集中の線路は置き換わります）。</p>
          {ai.status === "error" && <p className="error">{ai.message}</p>}
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
                      <p className="hint">
                        {p.pieces.length}本
                        {ai.mode !== "free" &&
                          (p.shortfall.totalCostJpy > 0 || p.shortfall.hasUnknownPrice
                            ? ` ／ 追加 ${p.shortfall.rows.filter((r) => r.missing > 0).length}品番・${yen(p.shortfall.totalCostJpy)}${p.shortfall.hasUnknownPrice ? "＋価格不明分" : ""}`
                            : " ／ 追加購入なし")}
                        {` ／ ${p.model}・${p.attempts}回`}
                      </p>
                      {ai.mode !== "free" && p.shortfall.rows.some((r) => r.missing > 0) && (
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
          {layout.description && <p className="desc">{layout.description}</p>}
        </section>

        <section>
          <h2>確認結果</h2>
          <ul className="checks">
            <li className={analysis.openJoints.length ? "ng" : "ok"}>
              つながっていない端: {analysis.openJoints.length}
            </li>
            <li className={analysis.nearMisses.length ? "ng" : "ok"}>ずれ: {analysis.nearMisses.length}</li>
            <li className={analysis.outOfBoard.length ? "ng" : "ok"}>ボード外: {analysis.outOfBoard.length}</li>
            <li className={analysis.overlaps.length ? "ng" : "ok"}>重なり: {analysis.overlaps.length}</li>
          </ul>
        </section>

        <section>
          <h2>部品リスト</h2>
          {layout.pieces.length === 0 ? (
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
                  {bom.map((r) => (
                    <tr
                      key={r.key}
                      title={r.alternatives.length ? `ほかの品番: ${r.alternatives.map((a) => `${a.code} ${a.name}`).join(" / ")}` : undefined}
                    >
                      <td className="code">{r.product.code}</td>
                      <td>
                        {r.product.name}
                        {r.alternatives.length > 0 && <span className="muted"> 他{r.alternatives.length}</span>}
                      </td>
                      <td className="num">{r.count}</td>
                      {hasStock && (
                        <td className={`num${(needByKey.get(r.key)?.missing ?? 0) > 0 ? " warn-text" : ""}`}>
                          {needByKey.get(r.key)?.missing || "—"}
                        </td>
                      )}
                      <td className="num">{r.packs ?? "—"}</td>
                      <td className="num">{r.priceJpy != null && r.packs != null ? yen(r.priceJpy * r.packs) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint">
                すべて新しく買う場合: {yen(bom.reduce((s, r) => s + (r.priceJpy != null && r.packs != null ? r.priceJpy * r.packs : 0), 0))}
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
    </div>
  );
}

function PartIcon({ partId, mirror }: { partId: string; mirror: boolean }) {
  const part = getPart(partId);
  // 形の外接矩形に合わせて表示範囲を決める
  const pts = part.routes.flatMap((r) => routeSamples(r, 20)).map((p) => ({ x: p.x, y: mirror ? -p.y : p.y }));
  const minX = Math.min(...pts.map((p) => p.x)) - 15;
  const maxX = Math.max(...pts.map((p) => p.x)) + 15;
  const minY = Math.min(...pts.map((p) => p.y)) - 15;
  const maxY = Math.max(...pts.map((p) => p.y)) + 15;
  const size = Math.max(maxX - minX, maxY - minY, 120);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return (
    <svg className="part-icon" viewBox={`${cx - size / 2} ${cy - size / 2} ${size} ${size}`} aria-hidden>
      <TrackPiece piece={{ uid: "icon", partId, mirror, x: 0, y: 0, rot: 0 }} selected={false} warn={false} />
    </svg>
  );
}
