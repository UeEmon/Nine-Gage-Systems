import { requireUser } from "@/lib/server/auth";
import { updateStore } from "@/lib/server/store";
import { createUser, CreateUserSchema, listUsers, UserError } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ユーザーの一覧（管理者だけ） */
export async function GET(req: Request) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  return Response.json({ users: listUsers(g.data) });
}

/** ユーザーの追加（管理者だけ） */
export async function POST(req: Request) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  const parsed = CreateUserSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "ユーザー名・パスワード・ロールを入力してください。" }, { status: 400 });
  try {
    const user = await updateStore((d) => createUser(d, parsed.data));
    return Response.json({ user }, { status: 201 });
  } catch (err) {
    if (err instanceof UserError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
