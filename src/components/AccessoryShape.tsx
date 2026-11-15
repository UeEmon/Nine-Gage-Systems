import { getAccessory, type Accessory, type AccessoryDef } from "@/lib/accessories";

type Props = {
  acc: Pick<Accessory, "x" | "y" | "rot" | "side" | "itemId">;
  selected?: boolean;
  dim?: boolean;
  onPointerDown?: (e: React.PointerEvent<SVGGElement>) => void;
};

/** パーツの平面の形（ローカル座標、中心が原点・線路の方向が +x） */
export function AccessoryBody({ def, side = "L" }: { def: AccessoryDef; side?: "L" | "R" }) {
  const L = def.length;
  const W = def.width;
  const hl = L / 2;
  const hw = W / 2;
  // 進行方向の左は画面の -y
  const sgn = side === "L" ? -1 : 1;
  switch (def.kind) {
    case "crossing":
      return (
        <>
          <rect x={-hl} y={-hw} width={L} height={W} className="acc-plate" />
          <rect x={-14} y={-hw} width={28} height={W} className="acc-road" />
          <line x1={-14} y1={-hw + 4} x2={-14} y2={-12} className="acc-gate" />
          <line x1={14} y1={hw - 4} x2={14} y2={12} className="acc-gate" />
          <circle cx={-18} cy={-hw + 4} r={2.6} className="acc-lamp" />
          <circle cx={18} cy={hw - 4} r={2.6} className="acc-lamp" />
        </>
      );
    case "signal": {
      const py = sgn * 13;
      return (
        <>
          <rect x={-hl} y={-6} width={L} height={12} className="acc-outline" />
          <line x1={0} y1={sgn * 6} x2={0} y2={py} className="acc-mast" />
          <rect x={-4.5} y={py - 3.5} width={9} height={7} rx={1.5} className="acc-head" />
          <circle cx={-2.5} cy={py} r={1.2} className="acc-g" />
          <circle cx={0} cy={py} r={1.2} className="acc-y" />
          <circle cx={2.5} cy={py} r={1.2} className="acc-r" />
        </>
      );
    }
    case "platform":
    case "island": {
      // 線路側の縁（黄色い線）。対向式は線路のある側、島式は両側
      const edgeY = side === "L" ? hw : -hw;
      return (
        <>
          <rect x={-hl} y={-hw} width={L} height={W} rx={2} className="acc-platform" />
          {def.roof && <rect x={-Math.min(hl, 140)} y={-hw + 3} width={Math.min(L, 280)} height={W - 6} className="acc-roof" />}
          {def.kind === "island" ? (
            <>
              <line x1={-hl + 2} y1={-hw + 1.5} x2={hl - 2} y2={-hw + 1.5} className="acc-edge" />
              <line x1={-hl + 2} y1={hw - 1.5} x2={hl - 2} y2={hw - 1.5} className="acc-edge" />
            </>
          ) : (
            <line x1={-hl + 2} y1={edgeY - Math.sign(edgeY) * 1.5} x2={hl - 2} y2={edgeY - Math.sign(edgeY) * 1.5} className="acc-edge" />
          )}
        </>
      );
    }
    case "bridgeStation":
      return (
        <>
          <rect x={-hl} y={-hw} width={L} height={W} rx={2} className="acc-bridge" />
          <line x1={-hl} y1={0} x2={hl} y2={0} className="acc-ridge" />
        </>
      );
    default:
      return (
        <>
          <rect x={-hl} y={-hw} width={L} height={W} rx={1.5} className={`acc-building ${def.kind === "station" ? "station" : ""}`} />
          <line x1={-hl + 4} y1={0} x2={hl - 4} y2={0} className="acc-ridge" />
        </>
      );
  }
}

/** キャンバスに置いた線路以外のパーツ */
export function AccessoryShape({ acc, selected = false, dim = false, onPointerDown }: Props) {
  const def = getAccessory(acc.itemId);
  return (
    <g
      transform={`translate(${acc.x} ${acc.y}) rotate(${acc.rot})`}
      className={`acc kind-${def.kind}${selected ? " is-selected" : ""}${dim ? " is-dim" : ""}`}
      onPointerDown={onPointerDown}
    >
      <AccessoryBody def={def} side={acc.side} />
      <rect x={-def.length / 2} y={-def.width / 2} width={def.length} height={def.width} className="acc-hit" />
    </g>
  );
}

/** パレット用のアイコン。線路に置くものは線路も一緒に描く */
export function AccessoryIcon({ itemKey }: { itemKey: string }) {
  const def = getAccessory(itemKey);
  const aspect = 2.2;
  const track = def.mount !== "free";
  const side = "L";
  // ホームは線路の横にずらして描く
  const oy = def.mount === "beside" ? -(def.offset ?? 0) : 0;
  const extentY = Math.max(def.width / 2 + Math.abs(oy), track ? 14 : 0) + 6;
  const extentX = def.length / 2 + 8;
  const h = Math.max(extentY * 2, (extentX * 2) / aspect, 40);
  const w = h * aspect;
  const cy = oy / 2;
  return (
    <svg className="part-icon" viewBox={`${-w / 2} ${cy - h / 2} ${w} ${h}`} role="img" aria-label={`${def.label}の形`}>
      {track && (
        <g className="piece bed-ballast">
          <path d={`M${-w / 2} 0 H${w / 2}`} className="ballast" />
          <path d={`M${-w / 2} 0 H${w / 2}`} className="rails" />
        </g>
      )}
      <g transform={`translate(0 ${oy})`} className={`acc kind-${def.kind}`}>
        <AccessoryBody def={def} side={side} />
      </g>
    </svg>
  );
}
