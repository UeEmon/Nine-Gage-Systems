// 運行計画の路線名。
//
// 「再現してみた」で作ったレイアウトは、線路の部品ごとに路線名を持っている（Piece.line）。
// 路線を1つだけ再現したレイアウトで線路に路線名がないときは、再現した路線の名前を使う。
// 駅の番線の路線はその番線の線路から、列車の路線は実際に使う番線から決める（列車に路線を指定したときはそちら）。

import type { Piece } from "../geometry";
import { canonicalLine, type ReplicaInfo } from "../replica";
import type { Train } from "./model";
import type { StopEvent } from "./schedule";
import type { Station } from "./stations";

/** 路線名を決めるのに使うレイアウトの中身 */
export type LineSource = { pieces: Piece[]; replica?: Pick<ReplicaInfo, "kind" | "target" | "lines"> | null };

/** 線路の部品の路線 */
export function pieceLine(piece: Piece, replica?: LineSource["replica"]): string | undefined {
  const own = piece.line?.trim();
  if (own) return own;
  return replica?.kind === "line" ? replica.target.trim() || undefined : undefined;
}

/** レイアウトの路線の一覧（再現した路線の順、そのあとに線路にだけある路線） */
export function layoutLines({ pieces, replica }: LineSource): string[] {
  const present: string[] = [];
  for (const p of pieces) {
    const l = pieceLine(p, replica);
    if (l && !present.includes(l)) present.push(l);
  }
  const ordered: string[] = [];
  for (const l of replica?.lines ?? []) {
    const c = canonicalLine(l, present);
    if (c && present.includes(c) && !ordered.includes(c)) ordered.push(c);
  }
  return [...ordered, ...present.filter((l) => !ordered.includes(l))];
}

/** 駅ID → 番線ごとの路線（[0] が1番線）。番線の線路の部品でいちばん多い路線 */
export type TrackLines = Map<string, (string | undefined)[]>;

export function trackLines(stations: Station[], source: LineSource): TrackLines {
  const byUid = new Map(source.pieces.map((p) => [p.uid, p]));
  const m: TrackLines = new Map();
  for (const st of stations) {
    m.set(
      st.id,
      st.tracks.map((t) => {
        const count = new Map<string, number>();
        for (const uid of t.pieces) {
          const p = byUid.get(uid);
          const l = p ? pieceLine(p, source.replica) : undefined;
          if (l) count.set(l, (count.get(l) ?? 0) + 1);
        }
        return [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
      }),
    );
  }
  return m;
}

/** 駅に乗り入れる路線（番線の順） */
export function stationLines(stationId: string, lines: TrackLines): string[] {
  const out: string[] = [];
  for (const l of lines.get(stationId) ?? []) if (l && !out.includes(l)) out.push(l);
  return out;
}

/** 列車が実際に使う番線から決めた路線（いちばん多く使う路線。路線のない番線だけなら undefined） */
export function lineFromEvents(events: Pick<StopEvent, "stationId" | "track">[], lines: TrackLines): string | undefined {
  const count = new Map<string, number>();
  for (const e of events) {
    const l = lines.get(e.stationId)?.[e.track - 1];
    if (l) count.set(l, (count.get(l) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** 列車の路線。指定があればそれ、なければ使う番線から決めた路線 */
export function trainLine(train: Pick<Train, "line">, events: Pick<StopEvent, "stationId" | "track">[] | undefined, lines: TrackLines): string | undefined {
  return train.line?.trim() || (events ? lineFromEvents(events, lines) : undefined);
}
