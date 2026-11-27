// ホームのない行き止まりを端からポイントまでたどり、番線として使える区間を求める。
import { buildDriveGraph, makeSegment, nextOptions, routeKey, type TrackRoute, type DriveGraph, type Segment } from "../drive";
import type { Piece } from "../geometry";
import { getPart } from "../parts";
import type { Station, trackIndex } from "./stations";

/** 分岐器から線路でつながるホームのうち、線路をたどる距離が最も短い駅。複線の上下線は別々にたどる。 */
function nearestStation(graph: DriveGraph, turnout: Piece, platforms: ReturnType<typeof trackIndex>): Station | undefined {
  const queue = getPart(turnout.partId).routes.map((_, routeIndex) => ({ uid: turnout.uid, routeIndex, distance: 0 }));
  const visited = new Set<string>();
  while (queue.length) {
    queue.sort((a, b) => b.distance - a.distance);
    const route = queue.pop()!;
    const key = routeKey(route);
    if (visited.has(key)) continue;
    visited.add(key);
    const platform = platforms.get(key);
    if (platform) return platform.station;
    const ends = graph.routeEnds.get(route.uid)![route.routeIndex];
    const distance = route.distance + makeSegment(graph, { ...route, reverse: false }).length;
    for (const exitJoint of [ends.start, ends.end]) {
      for (const next of nextOptions(graph, { uid: route.uid, exitJoint })) {
        if (!visited.has(routeKey(next))) queue.push({ uid: next.uid, routeIndex: next.routeIndex, distance });
      }
    }
  }
}

/** 線路に沿った中点。曲線を含む引き込み線でも、編成の中心を線路上に置く。 */
function middleOf(run: Segment[], length: number) {
  let offset = length / 2;
  for (const seg of run) {
    if (offset <= seg.length) {
      const i = Math.max(1, seg.dist.findIndex(d => d >= offset));
      const a = seg.points[i - 1], b = seg.points[i];
      const f = (offset - seg.dist[i - 1]) / (seg.dist[i] - seg.dist[i - 1] || 1);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    offset -= seg.length;
  }
  return run[0].points[0];
}

export function addSidingTracks(stations: Station[], pieces: Piece[], platforms: ReturnType<typeof trackIndex>) {
  if (!pieces.some(p => getPart(p.partId).category === "turnout")) return;
  const graph = buildDriveGraph(pieces);
  const owner = new Map<string, Station>();
  // 配置データの配列順が変わっても、引き込み線の番線を同じ順序で付ける。
  for (const piece of [...pieces].sort((a, b) => a.uid.localeCompare(b.uid))) {
    const ends = graph.routeEnds.get(piece.uid)!;
    if (getPart(piece.partId).category === "turnout") continue;
    ends.forEach((end, routeIndex) => {
      for (const reverse of [false, true]) {
        const inlet = reverse ? end.end : end.start;
        if (inlet !== null && graph.partner.has(`${piece.uid}:${inlet}`)) continue;
        const run: Segment[] = [];
        const seen = new Set<string>();
        let seg = makeSegment(graph, { uid: piece.uid, routeIndex, reverse });
        while (!platforms.has(routeKey(seg)) && !seen.has(routeKey(seg))) {
          seen.add(routeKey(seg));
          run.push(seg);
          const next = nextOptions(graph, seg);
          if (!next.length) break;
          const joint = graph.pieces.get(next[0].uid)!;
          if (getPart(joint.partId).category === "turnout") {
            // 車止めがない場合は分岐側だけ。未完成の本線を引き込み線にしない。
            if (!getPart(piece.partId).bumper && next.some(r => r.routeIndex === 0)) break;
            let station = owner.get(joint.uid);
            if (!station) {
              station = nearestStation(graph, joint, platforms);
              if (!station) {
                station = { id: `siding:${joint.uid}`, defaultName: `留置線${stations.filter(s => !s.platforms.length).length + 1}`, platforms: [], tracks: [], x: joint.x, y: joint.y };
                stations.push(station);
              }
              owner.set(joint.uid, station);
            }
            const length = run.reduce((sum, segment) => sum + segment.length, 0);
            const routes: TrackRoute[] = run.map(({ uid, routeIndex }) => ({ uid, routeIndex }));
            station.tracks.push({ number: station.tracks.length + 1, siding: true, routes, pieces: [...new Set(routes.map(r => r.uid))],
              platformLength: length, platformCenter: middleOf(run, length) });
            break;
          }
          if (next.length !== 1) break;
          seg = makeSegment(graph, next[0]);
        }
      }
    });
  }
}
