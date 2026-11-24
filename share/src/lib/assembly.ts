// 投稿の一覧と置き方から、つないだレイアウトを組み立てる（画面とAPIの両方で使う）
import type { Layout } from "../../../src/lib/geometry";
import { mergeAssembly, type Connector, type ModuleSource, type PlacedModule } from "../../../src/lib/modules";
import { PATTERN_FILE_FORMAT, PATTERN_FILE_VERSION, type PatternFile } from "../../../src/lib/patternFile";

export type ModulePost = { id: string; title: string; ownerName: string; layout: Layout; connectors: Connector[] };
export type ModuleRef = { postId: string; placement: PlacedModule["placement"] };

export function sourcesOf(posts: ModulePost[]): Map<string, ModuleSource> {
  return new Map(posts.map((p) => [p.id, { key: p.id, layout: p.layout, connectors: p.connectors }]));
}

export function placedOf(modules: ModuleRef[]): PlacedModule[] {
  return modules.map((m) => ({ key: m.postId, placement: m.placement }));
}

export function assemble(title: string, modules: ModuleRef[], posts: ModulePost[]) {
  const sources = sourcesOf(posts);
  const present = modules.filter((m) => sources.has(m.postId));
  return { ...mergeAssembly(title, placedOf(present), sources), present, missing: modules.length - present.length };
}

/** プラットフォームの「パターンの保存」で読み込めるファイル */
export function patternFileOf(name: string, layout: Layout, now = new Date()): PatternFile {
  return {
    format: PATTERN_FILE_FORMAT,
    version: PATTERN_FILE_VERSION,
    exportedAt: now.toISOString(),
    patterns: [{ id: `pat_share_${now.getTime().toString(36)}`, name, savedAt: now.toISOString(), layout }],
  };
}

export function fileName(title: string) {
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 60) || "layout";
  return `${safe}.json`;
}

/** 保存できるか: ボードが重ならず、すべてのボードがどこかでつながっている */
export function assemblyProblems(modules: ModuleRef[], posts: ModulePost[]): string[] {
  const { check, present, missing } = assemble("", modules, posts);
  const out: string[] = [];
  if (missing) out.push("削除されたレイアウトが含まれています");
  if (check.overlaps.length) out.push("重なっているボードがあります");
  const parent = present.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const j of check.junctions) parent[find(j.a.module)] = find(j.b.module);
  if (new Set(present.map((_, i) => find(i))).size > 1) out.push("どこにもつながっていないボードがあります");
  return out;
}
