// レイアウトの平面図（SVG）。サーバーでもブラウザでも描ける（フックを使わない）
import { TrackPiece } from "../../../src/components/TrackPiece";
import { AccessoryShape } from "../../../src/components/AccessoryShape";
import type { Layout, Piece } from "../../../src/lib/geometry";
import { boardRect, type Connector, type Placement } from "../../../src/lib/modules";

const PAD = 60;

export type ConnectorState = "free" | "linked" | "problem" | "selected";

/** 端子の印（線路の端の丸と、ボードの端へ向かう矢印） */
function ConnectorMark({ c, state, label, onClick }: { c: Connector; state: ConnectorState; label?: string; onClick?: () => void }) {
  const dir = { right: [1, 0], left: [-1, 0], bottom: [0, 1], top: [0, -1] }[c.edge];
  const ex = c.x + dir[0] * c.inset;
  const ey = c.y + dir[1] * c.inset;
  return (
    <g
      className={`connector is-${state}${onClick ? " is-clickable" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      aria-label={onClick ? `端子${label ?? ""}につなぐ` : undefined}
    >
      {c.inset > 1 && <line x1={c.x} y1={c.y} x2={ex} y2={ey} className="connector-gap" />}
      <circle cx={c.x} cy={c.y} r={onClick ? 16 : 11} className="connector-dot" />
      {label && (
        <text x={c.x} y={c.y} className="connector-label" dominantBaseline="central" textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  );
}

function Tracks({ layout }: { layout: Layout }) {
  return (
    <>
      {layout.pieces.map((p) => (
        <TrackPiece key={p.uid} piece={p} selected={false} warn={false} level={(p.z ?? 0) > 0 ? "elevated" : p.ramp ? "ramp" : "ground"} />
      ))}
      {(layout.accessories ?? []).map((a) => (
        <AccessoryShape key={a.uid} acc={a} />
      ))}
    </>
  );
}

/** 1枚のレイアウト。端子に番号を付ける */
export function LayoutSvg({ layout, connectors = [], className }: { layout: Layout; connectors?: Connector[]; className?: string }) {
  const { width, height } = layout.board;
  return (
    <svg
      className={`layout-svg ${className ?? ""}`}
      viewBox={`${-PAD} ${-PAD} ${width + PAD * 2} ${height + PAD * 2}`}
      role="img"
      aria-label={`${layout.title}の平面図`}
    >
      <rect x={0} y={0} width={width} height={height} className="board-rect" />
      <Tracks layout={layout} />
      {connectors.map((c, i) => (
        <ConnectorMark key={c.id} c={c} state="free" label={String(i + 1)} />
      ))}
    </svg>
  );
}

export type AssemblyModule = { key: string; title: string; layout: Layout; connectors: Connector[]; placement: Placement };

/**
 * つないだレイアウト。ボードごとに置き方で回して描き、すき間を埋める線路（fillers）は上に重ねる。
 * connectorState で端子の状態を、onConnector で空いている端子を押したときの動きを決める。
 */
export function AssemblySvg({
  modules,
  fillers = [],
  fillerOffset = { x: 0, y: 0 },
  connectorState,
  onConnector,
  ghost,
  className,
}: {
  modules: AssemblyModule[];
  fillers?: Piece[];
  /** fillers の座標の原点（mergeAssembly の offset） */
  fillerOffset?: { x: number; y: number };
  connectorState?: (module: number, c: Connector) => ConnectorState | null;
  onConnector?: (module: number, c: Connector) => void;
  /** 候補の試し置き（薄く描く） */
  ghost?: AssemblyModule | null;
  className?: string;
}) {
  const all = ghost ? [...modules, ghost] : modules;
  const rects = all.map((m) => boardRect(m.layout.board, m.placement));
  const x0 = Math.min(...rects.map((r) => r.x0), 0);
  const y0 = Math.min(...rects.map((r) => r.y0), 0);
  const x1 = Math.max(...rects.map((r) => r.x1), 1);
  const y1 = Math.max(...rects.map((r) => r.y1), 1);
  return (
    <svg className={`layout-svg ${className ?? ""}`} viewBox={`${x0 - PAD} ${y0 - PAD} ${x1 - x0 + PAD * 2} ${y1 - y0 + PAD * 2}`} role="img" aria-label="つないだレイアウトの平面図">
      {all.map((m, i) => {
        const isGhost = ghost && i === all.length - 1;
        return (
          <g key={`${m.key}-${i}`} transform={`translate(${m.placement.x} ${m.placement.y}) rotate(${m.placement.rot})`} className={isGhost ? "module is-ghost" : "module"}>
            <rect x={0} y={0} width={m.layout.board.width} height={m.layout.board.height} className="board-rect" />
            <Tracks layout={m.layout} />
          </g>
        );
      })}
      <g transform={`translate(${fillerOffset.x} ${fillerOffset.y})`} className="filler">
        {fillers.map((p) => (
          <TrackPiece key={p.uid} piece={p} selected={false} warn={false} level={(p.z ?? 0) > 0 ? "elevated" : "ground"} />
        ))}
      </g>
      {/* 端子はボードの上に重ねて描く（隣のボードに隠れないように） */}
      {modules.map((m, i) => (
        <g key={`c${m.key}-${i}`} transform={`translate(${m.placement.x} ${m.placement.y}) rotate(${m.placement.rot})`}>
          {m.connectors.map((c) => {
            const state = connectorState ? connectorState(i, c) : "free";
            if (!state) return null;
            const click = onConnector && (state === "free" || state === "selected") ? () => onConnector(i, c) : undefined;
            return <ConnectorMark key={c.id} c={c} state={state} onClick={click} />;
          })}
        </g>
      ))}
      {modules.map((m, i) => {
        const r = rects[i];
        return (
          <text key={`t${i}`} x={(r.x0 + r.x1) / 2} y={(r.y0 + r.y1) / 2} className="module-label" textAnchor="middle" dominantBaseline="central">
            {i + 1}
          </text>
        );
      })}
    </svg>
  );
}
