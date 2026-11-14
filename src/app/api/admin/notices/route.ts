import { requireUser } from "@/lib/server/auth";
import { adminNotices, createNotice, NoticeInputSchema, zodMessage } from "@/lib/server/notices";
import { updateStore } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** お知らせの一覧（予約中・管理者向けも含む。管理者だけ） */
export async function GET(req: Request) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  return Response.json({ notices: adminNotices(g.data) });
}

/** お知らせの登録（管理者だけ） */
export async function POST(req: Request) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  const parsed = NoticeInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: zodMessage(parsed.error) }, { status: 400 });
  const notices = await updateStore((d) => {
    createNotice(d, parsed.data, g.user.id);
    return adminNotices(d);
  });
  return Response.json({ notices }, { status: 201 });
}
