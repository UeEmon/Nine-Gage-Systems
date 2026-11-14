import { cookies } from "next/headers";
import { sameOrigin } from "@/lib/server/auth";
import { SESSION_COOKIE } from "@/lib/server/session";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "別のサイトからの要求は受け付けません。" }, { status: 403 });
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
