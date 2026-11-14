import { BED_INFO, getPart } from "@/lib/parts";
import { routeSamples } from "@/lib/shapes";
import { TrackPiece } from "./TrackPiece";

const CATEGORY_BADGE: Partial<Record<string, string>> = {
  turnout: "分岐",
  crossing: "交差",
  bridge: "鉄橋",
  bumper: "終端",
};

type Props = {
  partId: string;
  mirror?: boolean;
  /** 大きく表示する（仕様の詳細）ときは true。寸法の目盛りを出す */
  large?: boolean;
};

/**
 * 部品の形のアイコン。キャンバスと同じ描き方（道床・まくら木・レール）で形を描き、
 * 右下に道床の略号（SL=スラブ、WP=ワイドPC など）、左上に分類（分岐・交差・鉄橋・終端）を出す。
 */
export function PartIcon({ partId, mirror = false, large = false }: Props) {
  const part = getPart(partId);
  // 形の外接矩形に合わせて表示範囲を決める
  const pts = part.routes.flatMap((r) => routeSamples(r, 20)).map((p) => ({ x: p.x, y: mirror ? -p.y : p.y }));
  const pad = part.bed === "widePc" ? 20 : 15;
  const minX = Math.min(...pts.map((p) => p.x)) - pad;
  const maxX = Math.max(...pts.map((p) => p.x)) + pad;
  const minY = Math.min(...pts.map((p) => p.y)) - pad;
  const maxY = Math.max(...pts.map((p) => p.y)) + pad;
  // 表示枠の縦横比（パレットは横長のボタン、詳細は横長の枠）に合わせて表示範囲を決める
  const aspect = large ? 2.8 : 2.2;
  const vbH = Math.max(maxY - minY, (maxX - minX) / aspect, 70);
  const vbW = vbH * aspect;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const x0 = cx - vbW / 2;
  const y0 = cy - vbH / 2;
  const bed = BED_INFO[part.bed].short;
  const cat = CATEGORY_BADGE[part.category];
  const fs = vbH * (large ? 0.13 : 0.24);
  // 略号の幅（全角は1文字ぶん、半角は約0.6文字ぶん）
  const bedW = [...bed].reduce((w, ch) => w + (/[\x00-\x7f]/.test(ch) ? 0.78 : 0.95), 0) * fs * 0.85 + fs * 0.4;
  return (
    <svg
      className={`part-icon${large ? " large" : ""}`}
      viewBox={`${x0} ${y0} ${vbW} ${vbH}`}
      role="img"
      aria-label={`${part.name}の形`}
    >
      <TrackPiece piece={{ uid: "icon", partId: part.key, mirror, x: 0, y: 0, rot: 0 }} selected={false} warn={false} />
      {cat && (
        <text x={x0 + fs * 0.2} y={y0 + fs * 1.05} fontSize={fs} className="icon-badge cat">
          {cat}
        </text>
      )}
      {bed && (
        <g>
          <rect
            x={x0 + vbW - bedW - fs * 0.2}
            y={y0 + vbH - fs * 1.3}
            width={bedW}
            height={fs * 1.15}
            rx={fs * 0.2}
            className={`icon-badge-bg bed-${part.bed}`}
          />
          <text
            x={x0 + vbW - fs * 0.45}
            y={y0 + vbH - fs * 0.38}
            fontSize={fs * 0.85}
            textAnchor="end"
            className="icon-badge bed"
          >
            {bed}
          </text>
        </g>
      )}
    </svg>
  );
}
