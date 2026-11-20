// 投稿・つないだレイアウトの入力の確かめ
import type { Layout } from "../../../src/lib/geometry";
import { validLayout } from "../../../src/lib/patternFile";
import { normalizeOperation } from "../../../src/lib/operation/model";
import type { SetModule } from "./store";

export const LIMITS = {
  title: 80,
  description: 2000,
  pieces: 3000,
  boardMm: 20000,
  bodyBytes: 2_000_000,
  modules: 30,
  postsPerDay: 20,
  setsPerDay: 20,
  trains: 200,
  stopsPerTrain: 200,
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function text(v: unknown, max: number, label: string, required: boolean): Result<string> {
  const s = typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "";
  if (required && !s) return { ok: false, error: `${label}を入れてください。` };
  if ([...s].length > max) return { ok: false, error: `${label}は${max}文字までです。` };
  return { ok: true, value: s };
}

export function parseMeta(body: unknown): Result<{ title: string; description: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const title = text(b.title, LIMITS.title, "題名", true);
  if (!title.ok) return title;
  const description = text(b.description, LIMITS.description, "説明", false);
  if (!description.ok) return description;
  return { ok: true, value: { title: title.value, description: description.value } };
}

export function parsePostInput(body: unknown): Result<{ title: string; description: string; layout: Layout }> {
  const meta = parseMeta(body);
  if (!meta.ok) return meta;
  const layout = (body as { layout?: unknown }).layout;
  if (!validLayout(layout)) return { ok: false, error: "SenroLab のレイアウトとして読み込めませんでした。" };
  const { width, height } = layout.board;
  if (!(width > 0 && height > 0 && width <= LIMITS.boardMm && height <= LIMITS.boardMm)) {
    return { ok: false, error: `ボードの大きさは ${LIMITS.boardMm}mm 以内にしてください（大きさを決めていないレイアウトは投稿できません）。` };
  }
  if (!layout.pieces.length) return { ok: false, error: "線路が1本もありません。" };
  if (layout.pieces.length > LIMITS.pieces) return { ok: false, error: `線路は${LIMITS.pieces}本までです。` };
  const finite = layout.pieces.every((p) => [p.x, p.y, p.rot, p.z ?? 0].every(Number.isFinite));
  if (!finite) return { ok: false, error: "線路の位置が正しくありません。" };
  // 運行計画（ダイヤ）は、読み込める形にそろえてから一緒に保存する。列車がなければ載せない
  const { operation: rawOperation, ...rest } = layout;
  const operation = normalizeOperation(rawOperation);
  if (operation && operation.trains.length > LIMITS.trains) return { ok: false, error: `運行計画の列車は${LIMITS.trains}本までです。` };
  if (operation?.trains.some((t) => t.stops.length > LIMITS.stopsPerTrain)) {
    return { ok: false, error: `運行計画の停車駅は1列車${LIMITS.stopsPerTrain}駅までです。` };
  }
  return { ok: true, value: { ...meta.value, layout: operation?.trains.length ? { ...rest, operation } : rest } };
}

export function parseModules(v: unknown): Result<SetModule[]> {
  if (!Array.isArray(v) || v.length < 2) return { ok: false, error: "2枚以上のレイアウトをつないでください。" };
  if (v.length > LIMITS.modules) return { ok: false, error: `つなげるのは${LIMITS.modules}枚までです。` };
  const out: SetModule[] = [];
  for (const m of v) {
    const pl = m?.placement;
    if (
      typeof m?.postId !== "string" ||
      !/^l[A-Za-z0-9]{10}$/.test(m.postId) ||
      !pl ||
      ![pl.x, pl.y].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e6) ||
      ![0, 90, 180, 270].includes(pl.rot)
    ) {
      return { ok: false, error: "ボードの置き方が正しくありません。" };
    }
    out.push({ postId: m.postId, placement: { x: pl.x, y: pl.y, rot: pl.rot } });
  }
  return { ok: true, value: out };
}

export function parseSetInput(body: unknown): Result<{ title: string; description: string; modules: SetModule[] }> {
  const meta = parseMeta(body);
  if (!meta.ok) return meta;
  const modules = parseModules((body as { modules?: unknown }).modules);
  if (!modules.ok) return modules;
  return { ok: true, value: { ...meta.value, modules: modules.value } };
}
