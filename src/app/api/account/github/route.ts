import { requireUser } from "@/lib/server/auth";
import { currentAllowance } from "@/lib/server/ownAi";
import { activeOneTime, effectiveRole, sponsorOf } from "@/lib/server/premium";
import { updateStore } from "@/lib/server/store";
import { githubOAuth, sponsorable, unlinkGithub } from "@/lib/server/sponsors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GitHub 連携と支援の状態、月の上限と使った分（自分の分）。
 * configured: GitHub 連携が使えるか（サーバーに OAuth App の設定があるか）
 */
export async function GET(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  const s = sponsorOf(g.user, g.data);
  const now = new Date();
  return Response.json({
    configured: !!githubOAuth(),
    sponsorable: sponsorable(),
    github: g.user.github ? { login: g.user.github.login, linkedAt: g.user.github.linkedAt } : null,
    role: effectiveRole(g.user, g.data, now),
    sponsor: s
      ? {
          monthlyUsd: s.monthlyUsd,
          oneTime: activeOneTime(s, g.data.sponsorPlan, now),
        }
      : null,
    oneTimeDays: g.data.sponsorPlan.oneTimeDays,
    allowance: await currentAllowance(g.data, g.user, now),
  });
}

/** GitHub 連携を外す（支援の記録は GitHub のアカウントごとに残るので、結び付け直せば戻る） */
export async function DELETE(req: Request) {
  const g = await requireUser(req);
  if (!g.ok) return g.response;
  await updateStore((d) => {
    const user = d.users.find((u) => u.id === g.user.id);
    if (user?.github) {
      unlinkGithub(user);
    }
  });
  return Response.json({ ok: true });
}
