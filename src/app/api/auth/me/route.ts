import { requireUser } from "@/lib/server/auth";
import { publicUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  return Response.json({ user: publicUser(g.user, g.data) });
}
