import type { SimObject } from "@/lib/replica";

type Props = {
  sim: SimObject;
  /** 文字の大きさ（表示の拡大率に合わせる） */
  fontSize: number;
  /** body=形（線路の下に描く）, label=名前（線路の上に描く） */
  layer: "body" | "label";
};

/**
 * 「再現してみた」の仮オブジェクト（実在の製品ではない）。
 * 製品のパーツと見分けられるよう、点線の枠と「仮」の札をつけて描く。
 * 線路の下に描き、クリックは受けない（説明と削除は右のパネルで）。
 */
export function SimObjectShape({ sim, fontSize, layer }: Props) {
  if (layer === "label") {
    return (
      <text x={sim.x} y={sim.y} className="sim sim-label" style={{ fontSize }}>
        {sim.model ? "3D" : "仮"} {sim.name}
      </text>
    );
  }
  const hl = sim.length / 2;
  const hw = sim.width / 2;
  /** 鉄橋・高架橋の桁の区切り */
  const ribs = Math.max(1, Math.floor(sim.length / 40));
  return (
    <g className={`sim sim-${sim.kind}`}>
      <g transform={`translate(${sim.x} ${sim.y}) rotate(${sim.rot})`}>
        {sim.kind === "tunnel" ? (
          <>
            <rect x={-hl} y={-hw} width={sim.length} height={sim.width} rx={Math.min(hw, 12)} className="sim-body" />
            <line x1={-hl} y1={-hw + 3} x2={-hl} y2={hw - 3} className="sim-portal" />
            <line x1={hl} y1={-hw + 3} x2={hl} y2={hw - 3} className="sim-portal" />
          </>
        ) : sim.kind === "bridge" || sim.kind === "viaduct" ? (
          <>
            <rect x={-hl} y={-hw} width={sim.length} height={sim.width} className="sim-body" />
            {Array.from({ length: ribs }, (_, i) => {
              const x = -hl + ((i + 1) * sim.length) / (ribs + 1);
              return <line key={i} x1={x} y1={-hw} x2={x} y2={hw} className="sim-rib" />;
            })}
          </>
        ) : sim.kind === "mountain" || sim.kind === "water" ? (
          <ellipse cx={0} cy={0} rx={hl} ry={hw} className="sim-body" />
        ) : (
          <rect x={-hl} y={-hw} width={sim.length} height={sim.width} rx={2} className="sim-body" />
        )}
      </g>
    </g>
  );
}
