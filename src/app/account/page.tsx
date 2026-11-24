import Link from "next/link";
import { redirect } from "next/navigation";
import { OwnAiForm } from "@/components/OwnAiForm";
import { PasswordForm } from "@/components/PasswordForm";
import { UserMenu } from "@/components/UserMenu";
import { API_KEY_GUIDE_PATH, canSetOwnKey, ROLE_HELP, ROLE_LABELS } from "@/lib/roles";
import { currentUser } from "@/lib/server/auth";
import { BrandLogo } from "@/components/BrandLogo";

export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ welcome?: string; reset?: string }> }) {
  const user = await currentUser();
  const params = await searchParams;
  const welcome = params.welcome === "1";
  const reset = params.reset === "1";
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
        {reset && (
          <section className="card welcome">
            <h2>パスワードを変えました</h2>
            <p>
              新しいパスワードでログインしています。<a href="/editor">プラットフォームへ</a>
            </p>
          </section>
        )}
        {welcome && user.role === "user" && (
          <section className="card welcome">
            <h2>登録が完了しました</h2>
            <p>
              線路の配置や部品リストはすぐに使えます。AI提案を使うには、下の「AIの設定」で
              <strong>自分のAPIキー</strong>を登録してください（1分ほどで済みます）。手順は
              <Link href={API_KEY_GUIDE_PATH}>APIキー登録のチュートリアル</Link>にまとめています。
            </p>
            <p className="hint">
              あとで登録するときは、右上の「アカウント・AI設定」からいつでも開けます。<a href="/editor">プラットフォームへ</a>
            </p>
          </section>
        )}
        {canSetOwnKey(user.role) && <OwnAiForm premium={user.role === "ai"} />}
        <section className="card">
          <h2>ロール</h2>
          <p>
            <strong>{ROLE_LABELS[user.role]}</strong>: {ROLE_HELP[user.role]}
          </p>
          {user.role === "admin" && <p className="hint">AI提案には「管理」画面のAI設定（管理者用）を使います。</p>}
        </section>
        <PasswordForm />
      </main>
    </div>
  );
}
