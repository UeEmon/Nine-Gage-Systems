import Link from "next/link";
import { redirect } from "next/navigation";
import { OwnAiForm } from "@/components/OwnAiForm";
import { PasswordForm } from "@/components/PasswordForm";
import { UserMenu } from "@/components/UserMenu";
import { ROLE_HELP, ROLE_LABELS } from "@/lib/roles";
import { currentUser } from "@/lib/server/auth";
import { BrandLogo } from "@/components/BrandLogo";

export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const user = await currentUser();
  const welcome = (await searchParams).welcome === "1";
  if (!user) redirect("/login");
  return (
    <div className="page-wrap">
      <header className="header">
        <h1>
          <Link href="/" aria-label="SenroLab のトップへ">
            <BrandLogo />
          </Link> 
          / アカウント
        </h1>
        <UserMenu user={user} />
      </header>
      <main className="page narrow">
        {welcome && user.role === "user" && (
          <section className="card welcome">
            <h2>登録が完了しました</h2>
            <p>
              線路の配置や部品リストはすぐに使えます。AI提案を使うには、下の「AIの設定」で
              <strong>自分のAPIキー</strong>を登録してください（1分ほどで済みます）。
            </p>
            <p className="hint">
              あとで登録するときは、右上の「アカウント・AI設定」からいつでも開けます。<Link href="/">エディタへ</Link>
            </p>
          </section>
        )}
        {user.role === "user" && <OwnAiForm />}
        <section className="card">
          <h2>ロール</h2>
          <p>
            <strong>{ROLE_LABELS[user.role]}</strong>: {ROLE_HELP[user.role]}
          </p>
          {user.role !== "user" && <p className="hint">AI提案には管理者が設定したAIを使います。</p>}
        </section>
        <PasswordForm />
      </main>
    </div>
  );
}
