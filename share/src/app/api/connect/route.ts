import { findCandidates, layoutMaker } from "../../../../../src/lib/modules";
import { placedOf, sourcesOf } from "../../../lib/assembly";
import { parseModules } from "../../../lib/validate";
import { db, json, readJson } from "../../../lib/server";
import { connectablePosts, getPosts } from "../../../lib/store";

export const dynamic = "force-dynamic";

/**
 * 並べたボードの空いている端子に、つなげられる投稿と置き方を返す。
 * 本文: { modules: [{ postId, placement }], target: { module, connector } }（modules は1枚からでよい）
 */
export async function POST(req: Request) {
  const body = await readJson(req, 100_000);
  if (!body.ok) return body.response;
  const b = body.body as { modules?: unknown; target?: { module?: unknown; connector?: unknown } };
  const raw = Array.isArray(b.modules) ? b.modules : [];
  // 1枚目だけのときも同じ確かめ方を使う
  const parsed = parseModules(raw.length === 1 ? [raw[0], raw[0]] : raw);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const modules = raw.length === 1 ? parsed.value.slice(0, 1) : parsed.value;
  const t = b.target;
  if (!t || typeof t.module !== "number" || typeof t.connector !== "string" || !modules[t.module]) {
    return json({ error: "つなぐ端子を選んでください。" }, 400);
  }
  const store = db();
  const placed = getPosts(store, modules.map((m) => m.postId));
  const sources = sourcesOf(placed);
  const base = sources.get(modules[t.module].postId);
  if (!base) return json({ error: "レイアウトが見つかりません。" }, 404);
  const pool = connectablePosts(store, layoutMaker(base.layout));
  const byId = new Map(pool.map((p) => [p.id, p]));
  const candidates = findCandidates(placedOf(modules), { module: t.module, connector: t.connector }, sources, [...sourcesOf(pool).values()]).slice(0, 40);
  const used = [...new Set(candidates.map((c) => c.key))].map((id) => byId.get(id)!);
  return json({
    candidates,
    posts: used.map((p) => ({ id: p.id, title: p.title, ownerName: p.ownerName, layout: p.layout, connectors: p.connectors })),
  });
}
