import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { activeOneTime, sponsorActive } from "@/lib/server/premium";
import { updateStore, type StoreData } from "@/lib/server/store";
import { githubOAuth, maintainerToken, sponsorable, SponsorsError, fetchAllSponsorships, applyAllSponsorships, webhookSecret } from "@/lib/server/sponsors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function view(d: StoreData) {
  const now = new Date();
  const byGithub = new Map(d.users.filter((u) => u.github).map((u) => [String(u.github!.id), u.username]));
  return {
    plan: d.sponsorPlan,
    usdJpy: d.aiCost.usdJpy,
    sponsorable: sponsorable(),
    configured: { oauth: !!githubOAuth(), webhook: !!webhookSecret(), token: !!maintainerToken() },
    sponsors: Object.entries(d.sponsors)
      .map(([id, s]) => ({
        login: s.login,
        username: byGithub.get(id) ?? null,
        active: sponsorActive(s, d.sponsorPlan, now),
        monthlyUsd: s.monthlyUsd,
        oneTime: activeOneTime(s, d.sponsorPlan, now),
        updatedAt: s.updatedAt,
      }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.login.localeCompare(b.login)),
  };
}

/** 支援した人の一覧と、上限の決め方（管理者だけ） */
export async function GET(req: Request) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  return Response.json(view(g.data));
}

const PutSchema = z.object({
  multiplier: z.number().min(0).max(100),
  oneTimeDays: z.number().int().min(1).max(366),
});

/** 上限の決め方を保存する（管理者だけ） */
export async function PUT(req: Request) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  const parsed = PutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "倍率は0〜100、日数は1〜366で入力してください。" }, { status: 400 });
  return Response.json(
    await updateStore((d) => {
      d.sponsorPlan = parsed.data;
      return view(d);
    }),
  );
}

/** GitHub から全員の支援を読み直す（管理者だけ。NINEGAGE_SPONSORS_TOKEN が要る） */
export async function POST(req: Request) {
  const g = await requireUser(req, "admin");
  if (!g.ok) return g.response;
  try {
    const found = await fetchAllSponsorships();
    return Response.json(
      await updateStore((d) => {
        applyAllSponsorships(d, found);
        return { ...view(d), synced: found.length };
      }),
    );
  } catch (err) {
    if (err instanceof SponsorsError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
