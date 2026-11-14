import { z } from "zod";
import { PRICES_AS_OF, priceFor, priceTable } from "@/lib/llm/pricing";
import { PERIODS, usageLog, usageView, type Period } from "@/lib/server/aiUsage";
import { requireUser } from "@/lib/server/auth";
import { proposeCache } from "@/lib/server/proposeCache";
import { updateStore } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function view(period: Period, usdJpy: number) {
  const records = await usageLog.all();
  const v = usageView(records, period);
  const models = [...new Set(records.map((r) => r.model))];
  return {
    ...v,
    usdJpy,
    pricesAsOf: PRICES_AS_OF,
    unpricedModels: models.filter((m) => !priceFor(m, priceTable())),
    savedResults: proposeCache.size,
  };
}

const periodOf = (req: Request): Period => {
  const p = new URL(req.url).searchParams.get("period");
  return (PERIODS as readonly string[]).includes(p ?? "") ? (p as Period) : "this-month";
};

/** AIのトークン使用量と料金（管理者だけ）。?period=this-month|last-month|30d|all */
export async function GET(req: Request) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  return Response.json(await view(periodOf(req), g.data.aiCost.usdJpy));
}

const PutSchema = z.object({ usdJpy: z.number().min(1).max(9999) });

/** 円換算のレートを保存する（管理者だけ） */
export async function PUT(req: Request) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  const parsed = PutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "レートは1〜9999の数で入力してください。" }, { status: 400 });
  const usdJpy = await updateStore((d) => {
    d.aiCost.usdJpy = parsed.data.usdJpy;
    return d.aiCost.usdJpy;
  });
  return Response.json(await view(periodOf(req), usdJpy));
}

/** 保存済みの提案結果を消す（管理者だけ）。使用記録は消さない */
export async function DELETE(req: Request) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  proposeCache.clear();
  return Response.json(await view(periodOf(req), g.data.aiCost.usdJpy));
}
