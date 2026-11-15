import { requireUser } from "@/lib/server/auth";
import { applyOwnAi, OwnAiError, OwnAiPatchSchema, ownAiView } from "@/lib/server/ownAi";
import { updateStore } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 自分で設定したAI（キーは末尾4文字だけ） */
export async function GET(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  return Response.json(ownAiView(g.user));
}

/** 自分のAI設定を保存する（一般ユーザーだけ）。apiKey は省略で据え置き、空文字で削除 */
export async function PUT(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  const parsed = OwnAiPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "入力が正しくありません。" }, { status: 400 });
  try {
    const view = await updateStore((d) => {
      const user = d.users.find((u) => u.id === g.user.id);
      if (!user) throw new OwnAiError("ユーザーが見つかりません。", 404);
      applyOwnAi(user, parsed.data);
      return ownAiView(user);
    });
    return Response.json(view);
  } catch (err) {
    if (err instanceof OwnAiError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
