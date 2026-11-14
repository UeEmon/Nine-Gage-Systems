import { localPaths, type Piece } from "@/lib/geometry";
import { getPart } from "@/lib/parts";

type Props = {
  piece: Piece;
  selected: boolean;
  warn: boolean;
  onPointerDown?: (e: React.PointerEvent<SVGGElement>) => void;
};

/** 1つの線路部品。道床(灰色)とレール2本を、太さの違う線を重ねて描く */
export function TrackPiece({ piece, selected, warn, onPointerDown }: Props) {
  const part = getPart(piece.partId);
  const paths = localPaths(part);
  const flip = piece.mirror ? " scale(1,-1)" : "";
  return (
    <g
      transform={`translate(${piece.x} ${piece.y}) rotate(${piece.rot})${flip}`}
      onPointerDown={onPointerDown}
      className={`piece${selected ? " is-selected" : ""}${warn ? " is-warn" : ""}`}
      data-uid={piece.uid}
    >
      {paths.map((d, i) => (
        <path key={`b${i}`} d={d} className="ballast" />
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
