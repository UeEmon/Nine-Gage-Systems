import { updateStore } from "@/lib/server/store";
import { applyWebhook, verifySignature, webhookSecret } from "@/lib/server/sponsors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GitHub Sponsors の Webhook（sponsorship イベント）。署名を確かめてから支援の記録に反映する */
export async function POST(req: Request) {
  const secret = webhookSecret();
  if (!secret) return Response.json({ error: "not configured" }, { status: 503 });
  const body = await req.text();
  if (body.length > 100_000 || !verifySignature(body, req.headers.get("x-hub-signature-256"), secret)) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }
  const event = req.headers.get("x-github-event");
  if (event === "ping") return Response.json({ ok: true });
  if (event !== "sponsorship") return Response.json({ ok: true, ignored: event });
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const applied = await updateStore((d) => applyWebhook(d, payload));
  return Response.json({ ok: true, applied });
}
