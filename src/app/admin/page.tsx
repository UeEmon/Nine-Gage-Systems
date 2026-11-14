import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminAiPanel } from "@/components/AdminAiPanel";
import { AdminNoticesPanel } from "@/components/AdminNoticesPanel";
import { AdminUsersPanel } from "@/components/AdminUsersPanel";
import { UserMenu } from "@/components/UserMenu";
import { currentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");
  return (
    <div className="page-wrap">
      <header className="header">
        <h1>
          <Link href="/">Nine-Gage レイアウトプランナー</Link> / 管理
        </h1>
        <UserMenu user={user} />
      </header>
      <main className="page">
        <AdminAiPanel />
        <AdminUsersPanel currentUserId={user.id} />
        <AdminNoticesPanel />
      </main>
    </div>
  );
}
