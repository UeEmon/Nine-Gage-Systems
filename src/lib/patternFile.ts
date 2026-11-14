// パターン（レイアウト）の保存形式。アプリ内の登録（localStorage）とファイル出力・読み込みで共通。

import type { Layout } from "./geometry";
import { hasPart } from "./parts";

export type SavedPattern = {
  id: string;
  name: string;
  /** ISO 8601 */
  savedAt: string;
  layout: Layout;
};

export const PATTERN_FILE_FORMAT = "nine-gage-patterns";
export const PATTERN_FILE_VERSION = 1;

export type PatternFile = {
  format: typeof PATTERN_FILE_FORMAT;
  version: number;
  exportedAt: string;
  patterns: SavedPattern[];
};

export function newPatternId(): string {
  return `pat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function toPatternFile(patterns: SavedPattern[]): PatternFile {
  return { format: PATTERN_FILE_FORMAT, version: PATTERN_FILE_VERSION, exportedAt: new Date().toISOString(), patterns };
}

function validLayout(l: unknown): l is Layout {
  const x = l as Layout;
  return (
    !!x &&
    typeof x === "object" &&
    !!x.board &&
    typeof x.board.width === "number" &&
    typeof x.board.height === "number" &&
    Array.isArray(x.pieces) &&
    x.pieces.every(
      (p) =>
        p &&
        typeof p.uid === "string" &&
        typeof p.partId === "string" &&
        hasPart(p.partId) &&
        typeof p.x === "number" &&
        typeof p.y === "number" &&
        typeof p.rot === "number",
    )
  );
}

/**
 * ファイルの中身からパターンを取り出す。
 * パターン集（複数）と、1つのレイアウトだけのファイル（以前の「JSONで保存」）の両方を読める。
 */
export function parsePatternFile(text: string): SavedPattern[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("JSONとして読み込めませんでした");
  }
  const d = data as Partial<PatternFile> & Partial<Layout>;
  if (d && d.format === PATTERN_FILE_FORMAT && Array.isArray(d.patterns)) {
    const out = d.patterns.filter((p) => p && validLayout(p.layout));
    if (!out.length) throw new Error("読み込めるパターンがありませんでした");
    return out.map((p) => ({
      id: typeof p.id === "string" ? p.id : newPatternId(),
      name: String(p.name ?? p.layout.title ?? "パターン"),
      savedAt: typeof p.savedAt === "string" ? p.savedAt : new Date().toISOString(),
      layout: p.layout,
    }));
  }
  if (validLayout(d)) {
    const layout = d as Layout;
    return [{ id: newPatternId(), name: layout.title || "パターン", savedAt: new Date().toISOString(), layout }];
  }
  throw new Error("Nine-Gage のパターンファイルではありません");
}

/** 取り込み時、同じ id があれば別の id にして両方残す */
export function mergePatterns(current: SavedPattern[], incoming: SavedPattern[]): SavedPattern[] {
  const ids = new Set(current.map((p) => p.id));
  return [...current, ...incoming.map((p) => (ids.has(p.id) ? { ...p, id: newPatternId() } : p))];
}
