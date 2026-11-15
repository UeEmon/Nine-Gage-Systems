import Link from "next/link";
import { redirect } from "next/navigation";
import { OwnAiForm } from "@/components/OwnAiForm";
import { PasswordForm } from "@/components/PasswordForm";
import { UserMenu } from "@/components/UserMenu";
import { ROLE_HELP, ROLE_LABELS } from "@/lib/roles";
import { currentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <div className="page-wrap">
      <header className="header">
        <h1>
          <Link href="/">Nine-Gage レイアウトプランナー</Link> / アカウント
        </h1>
        <UserMenu user={user} />
      </header>
      <main className="page narrow">
        <section className="card">
          <h2>ロール</h2>
          <p>
            <strong>{ROLE_LABELS[user.role]}</strong>: {ROLE_HELP[user.role]}
          </p>
          {user.role !== "user" && <p className="hint">AI提案には管理者が設定したAIを使います。</p>}
        </section>
        {user.role === "user" && <OwnAiForm />}
        <PasswordForm />
      </main>
    </div>
  );
}
