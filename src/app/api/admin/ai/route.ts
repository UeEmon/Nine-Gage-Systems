import { adminAiView, AiPatchSchema, applyAiPatch } from "@/lib/server/aiSettings";
import { requireUser } from "@/lib/server/auth";
import { updateStore } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** AIの設定（管理者だけ）。キーは末尾4文字だけ返す */
export async function GET(req: Request) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  return Response.json(adminAiView(g.data.ai));
}

/** AIの設定を保存する（管理者だけ）。apiKey は省略で据え置き、空文字で削除 */
export async function PUT(req: Request) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  const parsed = AiPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "入力が正しくありません。" }, { status: 400 });
  }
  const ai = await updateStore((d) => {
    applyAiPatch(d.ai, parsed.data);
    return structuredClone(d.ai);
  });
  return Response.json(adminAiView(ai));
}
