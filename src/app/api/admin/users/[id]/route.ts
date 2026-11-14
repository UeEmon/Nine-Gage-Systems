import { requireUser } from "@/lib/server/auth";
import { updateStore } from "@/lib/server/store";
import { deleteUser, updateUser, UpdateUserSchema, UserError } from "@/lib/server/users";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function fail(err: unknown) {
  if (err instanceof UserError) return Response.json({ error: err.message }, { status: err.status });
  throw err;
}

/** ロールの変更・パスワードの再設定（管理者だけ） */
export async function PATCH(req: Request, ctx: Ctx) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  const parsed = UpdateUserSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "入力が正しくありません。" }, { status: 400 });
  try {
    const user = await updateStore((d) => updateUser(d, id, parsed.data));
    return Response.json({ user });
  } catch (err) {
    return fail(err);
  }
}

/** ユーザーの削除（管理者だけ。自分自身と最後の管理者は消せない） */
export async function DELETE(req: Request, ctx: Ctx) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  try {
    await updateStore((d) => deleteUser(d, id, g.user.id));
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
