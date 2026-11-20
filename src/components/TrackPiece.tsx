import { localPaths, type Piece } from "@/lib/geometry";
import { getPart } from "@/lib/parts";
import type { Level } from "@/lib/elevation";

export type { Level };

type Props = {
  piece: Piece;
  selected: boolean;
  warn: boolean;
  /** 高さの階層（色分けに使う）。省略時は地上 */
  level?: Level;
  /** ほかの階層を強調しているときに薄く表示する */
  dim?: boolean;
  onPointerDown?: (e: React.PointerEvent<SVGGElement>) => void;
};

/** 1つの線路部品。道床・まくら木・レール2本を、太さの違う線を重ねて描く。道床の種類は bed-* のクラスで描き分ける */
export function TrackPiece({ piece, selected, warn, level = "ground", dim = false, onPointerDown }: Props) {
  const part = getPart(piece.partId);
  const paths = localPaths(part);
  const flip = piece.mirror ? " scale(1,-1)" : "";
  return (
    <g
      transform={`translate(${piece.x} ${piece.y}) rotate(${piece.rot})${flip}`}
      onPointerDown={onPointerDown}
      className={`piece bed-${part.bed} cat-${part.category} lv-${level}${selected ? " is-selected" : ""}${warn ? " is-warn" : ""}${dim ? " is-dim" : ""}`}
      data-uid={piece.uid}
    >
      {paths.map((d, i) => (
        <path key={`b${i}`} d={d} className="ballast" />
      ))}
      {paths.map((d, i) => (
        <path key={`s${i}`} d={d} className="sleepers" />
      ))}
      {paths.map((d, i) => (
        <path key={`r${i}`} d={d} className="rails" />
      ))}
      {paths.map((d, i) => (
        <path key={`g${i}`} d={d} className="gauge" />
      ))}
      {part.bumper && (
        <line x1={part.routeLength} y1={-9} x2={part.routeLength} y2={9} className="bumper" />
      )}
      {paths.map((d, i) => (
        <path key={`h${i}`} d={d} className="hit" />
      ))}
    </g>
  );
}
