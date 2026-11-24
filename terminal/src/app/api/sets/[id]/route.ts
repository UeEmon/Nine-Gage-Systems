import { assemblyProblems } from "../../../../lib/assembly";
import { parseSetInput } from "../../../../lib/validate";
import { canEdit, db, json, readJson, requireUser, userFrom } from "../../../../lib/server";
import { deleteSet, getPosts, getSet, updateSet } from "../../../../lib/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const store = db();
  const set = getSet(store, (await params).id);
  if (!set) return json({ error: "見つかりません。" }, 404);
  const posts = getPosts(store, set.modules.map((m) => m.postId));
  return json({ set, posts, canEdit: canEdit(userFrom(req), set.ownerId) });
}

export async function PUT(req: Request, { params }: Ctx) {
  const g = requireUser(req);
  if (!g.ok) return g.response;
  const store = db();
  const set = getSet(store, (await params).id);
  if (!set) return json({ error: "見つかりません。" }, 404);
  if (!canEdit(g.user, set.ownerId)) return json({ error: "保存した人だけが変えられます。" }, 403);
  const body = await readJson(req, 100_000);
  if (!body.ok) return body.response;
  const input = parseSetInput(body.body);
  if (!input.ok) return json({ error: input.error }, 400);
  const problems = assemblyProblems(input.value.modules, getPosts(store, input.value.modules.map((m) => m.postId)));
  if (problems.length) return json({ error: problems.join("。") + "。" }, 400);
  updateSet(store, set.id, input.value);
  return json({ id: set.id });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const g = requireUser(req);
  if (!g.ok) return g.response;
  const store = db();
  const set = getSet(store, (await params).id);
  if (!set) return json({ error: "見つかりません。" }, 404);
  if (!canEdit(g.user, set.ownerId)) return json({ error: "保存した人だけが削除できます。" }, 403);
  deleteSet(store, set.id);
  return json({ ok: true });
}
