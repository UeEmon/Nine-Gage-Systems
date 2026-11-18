import { db } from "../../../lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  db().prepare("SELECT 1").get();
  return Response.json({ ok: true });
}
