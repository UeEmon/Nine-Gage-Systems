import { assemblyProblems } from "../../../lib/assembly";
import { LIMITS, parseSetInput } from "../../../lib/validate";
import { db, json, readJson, requireUser } from "../../../lib/server";
import { createSet, getPosts, listSets, recentCount } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  return json({ sets: listSets(db(), { limit: Number(u.get("limit")) || 24, offset: Number(u.get("offset")) || 0 }) });
}

export async function POST(req: Request) {
  const g = requireUser(req);
  if (!g.ok) return g.response;
  const body = await readJson(req, 100_000);
  if (!body.ok) return body.response;
  const input = parseSetInput(body.body);
  if (!input.ok) return json({ error: input.error }, 400);
  const store = db();
  const problems = assemblyProblems(input.value.modules, getPosts(store, input.value.modules.map((m) => m.postId)));
  if (problems.length) return json({ error: problems.join("。") + "。" }, 400);
  if (!g.user.admin && recentCount(store, "sets", g.user.sub) >= LIMITS.setsPerDay) {
    return json({ error: `つないだレイアウトの保存は1日${LIMITS.setsPerDay}件までです。` }, 429);
  }
  const set = createSet(store, { id: g.user.sub, name: g.user.name }, input.value);
  return json({ id: set.id }, 201);
}
