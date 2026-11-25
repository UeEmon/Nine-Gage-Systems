import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminAiPanel } from "@/components/AdminAiPanel";
import { AdminAnalyticsPanel } from "@/components/AdminAnalyticsPanel";
import { AdminAiUsagePanel } from "@/components/AdminAiUsagePanel";
import { AdminFeedbackPanel } from "@/components/AdminFeedbackPanel";
import { AdminNoticesPanel } from "@/components/AdminNoticesPanel";
import { AdminSponsorsPanel } from "@/components/AdminSponsorsPanel";
import { AdminUsersPanel } from "@/components/AdminUsersPanel";
import { UserMenu } from "@/components/UserMenu";
import { currentUser } from "@/lib/server/auth";
import { BrandLogo } from "@/components/BrandLogo";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");
  return (
    <div className="page-wrap">
      <header className="header">
        <h1>
          <Link href="/" aria-label="SenroLab のトップへ">
            <BrandLogo />
          </Link> 
          / 管理
        </h1>
        <UserMenu user={user} />
      </header>
      <main className="page">
        <AdminAnalyticsPanel />
        <AdminAiPanel />
        <AdminAiUsagePanel />
        <AdminUsersPanel currentUserId={user.id} />
        <AdminSponsorsPanel />
        <AdminNoticesPanel />
        <AdminFeedbackPanel />
      </main>
    </div>
  );
}
