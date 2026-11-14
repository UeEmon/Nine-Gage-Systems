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
import { getPart, normDeg, PARTS } from "@/lib/parts";
import { TrackPiece } from "./TrackPiece";

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
  description: "",
  board: { width: 1200, height: 600 },
  pieces: [],
});

type Selection = { kind: "joint"; uid: string; index: number } | { kind: "piece"; uid: string } | null;

type AiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; attempts: number; remaining: string | null; model: string }
  | { status: "error"; message: string };

export function Editor() {
  const [layout, setLayout] = useState<Layout>(emptyLayout);
  const [selection, setSelection] = useState<Selection>(null);
  const [mirrorNext, setMirrorNext] = useState(false);
  const [attachJoint, setAttachJoint] = useState(0);
  const [request, setRequest] = useState("エンドレスに待避線を1本。駅を置けるスペースもほしい");
  const [ai, setAi] = useState<AiState>({ status: "idle" });
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

  const analysis = useMemo(() => analyze(layout), [layout]);
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
    const piece = placeAt(partId, part.handed && mirrorNext, jIdx, target, newUid());
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
  const flipSelected = () => updateSelected((p) => (getPart(p.partId).handed ? { ...p, mirror: !p.mirror } : p));
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
  const runAi = async () => {
    setAi({ status: "loading" });
    try {
      const res = await fetch("/api/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board: layout.board, request }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setLayout((l) => ({ ...l, title: data.plan.title, description: data.plan.description, pieces: data.pieces }));
      setSelection(null);
      setAi({ status: "done", attempts: data.attempts, remaining: data.remainingProblems, model: data.model });
    } catch (err) {
      setAi({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  // ---- ファイル ----
  const download = () => {
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${layout.title || "layout"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const upload = async (file: File) => {
    try {
      const l = JSON.parse(await file.text()) as Layout;
      if (!Array.isArray(l.pieces) || !l.board) throw new Error();
      l.pieces.forEach((p) => getPart(p.partId));
      setLayout(l);
      setSelection(null);
    } catch {
      alert("レイアウトファイルを読み込めませんでした");
    }
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
          <h2>線路パーツ</h2>
          <p className="hint">
            {selection?.kind === "joint" ? "選択中の端（青）につなぎます" : "端（赤い丸）をクリックして選ぶと、そこにつなげます"}
          </p>
          <div className="row">
            <div className="seg">
              <button className={!mirrorNext ? "on" : ""} onClick={() => setMirrorNext(false)}>
                左カーブ
              </button>
              <button className={mirrorNext ? "on" : ""} onClick={() => setMirrorNext(true)}>
                右カーブ
              </button>
            </div>
          </div>
          <div className="row">
            <label className="small">
              つなぐ側
              <select value={attachJoint} onChange={(e) => setAttachJoint(Number(e.target.value))}>
                <option value={0}>始端 (ポイントはトング側)</option>
                <option value={1}>終端 (ポイントは直進側)</option>
                <option value={2}>ポイント分岐側</option>
              </select>
            </label>
          </div>
          <div className="palette">
            {PARTS.map((p) => (
              <button key={p.id} className="part" onClick={() => addPart(p.id)} title={p.description}>
                <PartIcon partId={p.id} mirror={p.handed && mirrorNext} />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>選択中の部品</h2>
          {selectedPiece ? (
            <>
              <p className="hint">{getPart(selectedPiece.partId).name}</p>
              <div className="row wrap">
                <button onClick={() => rotateSelected(-15)}>⟲ 15°</button>
                <button onClick={() => rotateSelected(15)}>⟳ 15°</button>
                <button onClick={flipSelected} disabled={!getPart(selectedPiece.partId).handed}>
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

        <section>
          <h2>ファイル</h2>
          <div className="row wrap">
            <button onClick={download}>JSONで保存</button>
            <label className="button">
              読み込み
              <input
                type="file"
                accept="application/json"
                hidden
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
            </label>
            <button
              className="danger"
              onClick={() => {
                if (confirm("すべての線路を消しますか？")) {
                  setPieces(() => []);
                  setSelection(null);
                }
              }}
            >
              全消去
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
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            rows={5}
            placeholder="例: 複線のエンドレスと、車両基地への引き込み線を2本"
          />
          <button className="primary" onClick={runAi} disabled={ai.status === "loading"}>
            {ai.status === "loading" ? "設計中…（1〜3分かかります）" : "提案してもらう"}
          </button>
          <p className="hint">今のボードの大きさで設計し、現在の線路は置き換わります。</p>
          {ai.status === "error" && <p className="error">{ai.message}</p>}
          {ai.status === "done" && (
            <p className={ai.remaining ? "warn-text" : "ok-text"}>
              {ai.remaining
                ? `${ai.attempts}回試しましたが、まだ問題が残っています。下の確認結果を見て手直ししてください。`
                : `AIが${ai.attempts}回の検証で完成させました。`}
            </p>
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
                <tbody>
                  {Object.entries(analysis.partCounts)
                    .sort()
                    .map(([k, n]) => (
                      <tr key={k}>
                        <td>{k}</td>
                        <td className="num">{n}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="hint">
                合計 {layout.pieces.length} 本 / 線路延長 約{(analysis.totalLengthMm / 1000).toFixed(2)}m
              </p>
            </>
          )}
        </section>
      </aside>
    </div>
  );
}

function PartIcon({ partId, mirror }: { partId: string; mirror: boolean }) {
  const piece: Piece = { uid: "icon", partId, mirror, x: 0, y: 0, rot: 0 };
  const part = getPart(partId);
  const len = part.kind === "curve" ? Math.max(part.joints[1].x, 120) : Math.max(part.length ?? 60, 60);
  const span = Math.max(len, 120) + 30;
  return (
    <svg className="part-icon" viewBox={`-15 ${-span / 2} ${span} ${span}`} aria-hidden>
      <TrackPiece piece={{ ...piece, y: mirror ? -span / 4 : span / 4 }} selected={false} warn={false} />
    </svg>
  );
}
