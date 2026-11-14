import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { markNoticesRead } from "@/lib/server/notices";
import { updateStore } from "@/lib/server/store";

export const runtime = "nodejs";

const Schema = z.object({ ids: z.array(z.string().max(100)).max(500).optional() });

/** 既読にする。ids を省くと全部 */
export async function POST(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "入力が正しくありません。" }, { status: 400 });
  const result = await updateStore((d) => markNoticesRead(d, g.user.id, parsed.data.ids));
  return Response.json(result);
}
