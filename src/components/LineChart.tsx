"use client";

import { useEffect, useRef, useState } from "react";

export type LineSeries = {
  key: string;
  label: string;
  /** CSS の色（--series-1 など。globals.css でライト・ダークそれぞれに決めてある） */
  color: string;
};

type Props<T extends { day: string }> = {
  data: T[];
  series: LineSeries[];
  /** 値の単位（目盛り・表に付ける） */
  unit: string;
  /** グラフの説明（読み上げ用） */
  ariaLabel: string;
  /** 吹き出しに足す行（その日の補足） */
  extra?: (row: T) => string | null;
};

const HEIGHT = 200;
const PAD = { top: 12, right: 12, bottom: 22, left: 36 };

const num = (n: number) => n.toLocaleString("ja-JP");
const dayLabel = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

/** 目盛りのきりのよい最大値と間隔（4本前後） */
function niceScale(max: number): { top: number; step: number } {
  if (max <= 4) return { top: 4, step: 1 };
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  return { top: Math.ceil(max / step) * step, step };
}

/**
 * 日別の折れ線グラフ（縦軸は1本）。マウス・指を乗せると縦線と、その日の値の吹き出しを出す。
 * 2本以上なら凡例と線の右端の名前を出す。下の「表で見る」で同じ数を表で見られる。
 */
export function LineChart<T extends { day: string }>({ data, series, unit, ariaLabel, extra }: Props<T>) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const value = (row: T, key: string) => Number((row as Record<string, unknown>)[key] ?? 0);
  const max = Math.max(0, ...data.flatMap((r) => series.map((s) => value(r, s.key))));
  const { top, step } = niceScale(max);
  const multi = series.length > 1;
  // 2本以上は右端に名前を書くので、その分あける
  const right = PAD.right + (multi ? 64 : 0);
  const plotW = width - PAD.left - right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plotW / 56))));

  const pick = (clientX: number) => {
    const el = wrap.current;
    if (!el || !data.length) return;
    const rel = clientX - el.getBoundingClientRect().left - PAD.left;
    const i = Math.round((rel / plotW) * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  };

  // 右端の名前が重ならないよう、近いものはずらす
  const endLabels = multi
    ? series
        .map((s) => ({ s, y: y(value(data[data.length - 1], s.key)) }))
        .sort((a, b) => a.y - b.y)
        .map((l, i, all) => {
          if (i > 0 && l.y - all[i - 1].y < 14) l.y = all[i - 1].y + 14;
          return l;
        })
    : [];

  const shown = hover === null ? null : data[hover];
  const tipLeft = hover === null ? 0 : x(hover);
  const tipOnLeft = tipLeft > width / 2;

  return (
    <div className="line-chart">
      {multi && (
        <div className="line-legend">
          {series.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div
        ref={wrap}
        className="line-plot"
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <svg width={width} height={HEIGHT} role="img" aria-label={ariaLabel}>
          {ticks.map((v) => (
            <g key={v}>
              <line className="line-grid" x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} />
              <text className="line-axis" x={PAD.left - 6} y={y(v)} textAnchor="end" dominantBaseline="middle">
                {num(v)}
              </text>
            </g>
          ))}
          {data.map((r, i) =>
            i % labelEvery === 0 || i === data.length - 1 ? (
              (i === data.length - 1 || data.length - 1 - i >= labelEvery / 2) && (
                <text key={r.day} className="line-axis" x={x(i)} y={HEIGHT - 6} textAnchor="middle">
                  {dayLabel(r.day)}
                </text>
              )
            ) : null,
          )}
          {hover !== null && <line className="line-cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} />}
          {series.map((s) => (
            <polyline
              key={s.key}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={data.map((r, i) => `${x(i)},${y(value(r, s.key))}`).join(" ")}
            />
          ))}
          {hover !== null &&
            series.map((s) => (
              <circle key={s.key} className="line-dot" cx={x(hover)} cy={y(value(data[hover], s.key))} r={4.5} fill={s.color} />
            ))}
          {endLabels.map(({ s, y: ly }) => (
            <text key={s.key} className="line-end" x={PAD.left + plotW + 6} y={ly} dominantBaseline="middle">
              {s.label}
            </text>
          ))}
        </svg>
        {shown && (
          <div className="line-tip" style={tipOnLeft ? { right: width - tipLeft + 10 } : { left: tipLeft + 10 }}>
            <strong>{dayLabel(shown.day)}</strong>
            {series.map((s) => (
              <span key={s.key}>
                <i style={{ background: s.color }} />
                {s.label} <b>{num(value(shown, s.key))}</b>
                {unit}
              </span>
            ))}
            {extra?.(shown) && <span className="muted">{extra(shown)}</span>}
          </div>
        )}
      </div>
      <details className="line-table">
        <summary>表で見る</summary>
        <div className="table-scroll">
          <table className="bom usage-table">
            <thead>
              <tr>
                <th>日付</th>
                {series.map((s) => (
                  <th key={s.key} className="num">
                    {s.label}（{unit}）
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((r) => (
                <tr key={r.day}>
                  <td>{r.day}</td>
                  {series.map((s) => (
                    <td key={s.key} className="num">
                      {num(value(r, s.key))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
