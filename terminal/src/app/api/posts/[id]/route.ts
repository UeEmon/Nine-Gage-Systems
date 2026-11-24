import { parseMeta } from "../../../../lib/validate";
import { canEdit, db, json, readJson, requireUser, userFrom } from "../../../../lib/server";
import { deletePost, getPost, updatePost } from "../../../../lib/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const post = getPost(db(), (await params).id);
  if (!post) return json({ error: "見つかりません。" }, 404);
  return json({ post, canEdit: canEdit(userFrom(req), post.ownerId) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = requireUser(req);
  if (!g.ok) return g.response;
  const store = db();
  const post = getPost(store, (await params).id);
  if (!post) return json({ error: "見つかりません。" }, 404);
  if (!canEdit(g.user, post.ownerId)) return json({ error: "投稿した人だけが変えられます。" }, 403);
  const body = await readJson(req, 20_000);
  if (!body.ok) return body.response;
  const meta = parseMeta(body.body);
  if (!meta.ok) return json({ error: meta.error }, 400);
  updatePost(store, post.id, meta.value);
  return json({ ok: true });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const g = requireUser(req);
  if (!g.ok) return g.response;
  const store = db();
  const post = getPost(store, (await params).id);
  if (!post) return json({ error: "見つかりません。" }, 404);
  if (!canEdit(g.user, post.ownerId)) return json({ error: "投稿した人だけが削除できます。" }, 403);
  deletePost(store, post.id);
  return json({ ok: true });
}
