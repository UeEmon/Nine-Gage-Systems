"use client";

import { useState } from "react";
import { heightText } from "@/data/piers";
import { samplesWithZ, type Elevation, type Pier } from "@/lib/elevation";
import type { Board, Piece } from "@/lib/geometry";
import type { Level } from "./TrackPiece";

type Props = {
  pieces: Piece[];
  elevation: Elevation;
  piers: Pier[];
  board: Board;
  standardHeight: number;
  levelOf: (uid: string) => Level;
  selectedUid: string | null;
  onClose: () => void;
};

/** 高さを強調した横からの図（断面図）。手前から見る（x）か、横から見る（y）かを選べる */
export function LevelProfile({ pieces, elevation, piers, board, standardHeight, levelOf, selectedUid, onClose }: Props) {
  const [axis, setAxis] = useState<"x" | "y">("x");
  const len = axis === "x" ? board.width : board.height;
  const maxZ = Math.max(standardHeight, ...pieces.flatMap((p) => elevation.joints.get(p.uid) ?? [0])) + 15;
  // 高さは横の長さに比べて小さいので、縦を広げて描く（縦の範囲は -10mm〜maxZ）
  const h = maxZ + 10;
  const pos = (pt: { x: number; y: number }) => (axis === "x" ? pt.x : pt.y);
  const lines = pieces.map((p) => ({
    uid: p.uid,
    level: levelOf(p.uid),
    points: samplesWithZ(p, elevation, 15)
      .map((s) => `${pos(s).toFixed(1)},${(maxZ - s.z).toFixed(2)}`)
      .join(" "),
  }));
  // 下の線路を先に、高い線路を後に描く
  lines.sort((a, b) => (a.level === "elevated" ? 1 : 0) - (b.level === "elevated" ? 1 : 0));

  return (
    <div className="profile" role="img" aria-label="線路の高さの断面図">
      <div className="profile-head">
        <strong>断面図</strong>
        <span>
          {axis === "x" ? "手前から見た高さ（横軸=ボードの幅）" : "横から見た高さ（横軸=ボードの奥行）"}。高さは強調して表示
        </span>
        <span style={{ flex: 1 }} />
        <span className="seg" style={{ width: 150 }}>
          <button className={axis === "x" ? "on" : ""} onClick={() => setAxis("x")}>
            手前から
          </button>
          <button className={axis === "y" ? "on" : ""} onClick={() => setAxis("y")}>
            横から
          </button>
        </span>
        <button className="mini" onClick={onClose} aria-label="断面図を閉じる" style={{ pointerEvents: "auto" }}>
          ×
        </button>
      </div>
      <svg viewBox={`-20 ${-24} ${len + 40} ${h + 30}`} preserveAspectRatio="none">
        <line x1={-20} x2={len + 20} y1={maxZ} y2={maxZ} className="p-ground" />
        <line x1={-20} x2={len + 20} y1={maxZ - standardHeight} y2={maxZ - standardHeight} className="p-std" />
        {piers.map((p, i) => (
          <line key={i} x1={pos(p)} x2={pos(p)} y1={maxZ} y2={maxZ - p.z} className="p-pier" />
        ))}
        {lines.map((l) => (
          <polyline key={l.uid} points={l.points} className={`p-track lv-${l.level}${l.uid === selectedUid ? " is-selected" : ""}`} />
        ))}
      </svg>
      <span className="hint" style={{ position: "absolute", left: 10, bottom: 4, fontSize: 11 }}>
        破線: 標準の高架 {heightText(standardHeight)}mm ／ 縦線: 橋脚
      </span>
    </div>
  );
}
