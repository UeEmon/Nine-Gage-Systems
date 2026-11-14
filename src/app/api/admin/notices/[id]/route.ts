import { requireUser } from "@/lib/server/auth";
import { adminNotices, deleteNotice, NoticeError, NoticeInputSchema, updateNotice, zodMessage } from "@/lib/server/notices";
import { updateStore } from "@/lib/server/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function fail(err: unknown) {
  if (err instanceof NoticeError) return Response.json({ error: err.message }, { status: err.status });
  throw err;
}

/** お知らせの編集（管理者だけ。リリースノートの分は変えられない） */
export async function PUT(req: Request, ctx: Ctx) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  const parsed = NoticeInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: zodMessage(parsed.error) }, { status: 400 });
  try {
    const notices = await updateStore((d) => {
      updateNotice(d, id, parsed.data);
      return adminNotices(d);
    });
    return Response.json({ notices });
  } catch (err) {
    return fail(err);
  }
}

/** お知らせの削除（管理者だけ） */
export async function DELETE(req: Request, ctx: Ctx) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  try {
    const notices = await updateStore((d) => {
      deleteNotice(d, id);
      return adminNotices(d);
    });
    return Response.json({ notices });
  } catch (err) {
    return fail(err);
  }
}
