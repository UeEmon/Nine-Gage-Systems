import { LIMITS, parsePostInput } from "../../../lib/validate";
import { db, json, readJson, requireUser } from "../../../lib/server";
import { createPost, listPosts, recentCount } from "../../../lib/store";
import { MAKERS, type Maker } from "../../../../../src/lib/parts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const maker = u.get("maker");
  return json(
    listPosts(db(), {
      q: u.get("q") ?? undefined,
      maker: MAKERS.includes(maker as Maker) ? (maker as Maker) : undefined,
      connectable: u.get("connectable") === "1",
      withOperation: u.get("operation") === "1",
      limit: Number(u.get("limit")) || 24,
      offset: Number(u.get("offset")) || 0,
    }),
  );
}

export async function POST(req: Request) {
  const g = requireUser(req);
  if (!g.ok) return g.response;
  const body = await readJson(req, LIMITS.bodyBytes);
  if (!body.ok) return body.response;
  const input = parsePostInput(body.body);
  if (!input.ok) return json({ error: input.error }, 400);
  const store = db();
  if (!g.user.admin && recentCount(store, "posts", g.user.sub) >= LIMITS.postsPerDay) {
    return json({ error: `投稿は1日${LIMITS.postsPerDay}件までです。` }, 429);
  }
  const post = createPost(store, { id: g.user.sub, name: g.user.name }, input.value);
  return json({ id: post.id, connectors: post.connectors.length }, 201);
}
