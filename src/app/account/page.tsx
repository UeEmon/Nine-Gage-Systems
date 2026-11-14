import Link from "next/link";
import { redirect } from "next/navigation";
import { PasswordForm } from "@/components/PasswordForm";
import { UserMenu } from "@/components/UserMenu";
import { currentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <div className="page-wrap">
      <header className="header">
        <h1>
          <Link href="/">Nine-Gage レイアウトプランナー</Link> / パスワード変更
        </h1>
        <UserMenu user={user} />
      </header>
      <main className="page narrow">
        <PasswordForm />
      </main>
    </div>
  );
}
