import Link from "next/link";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/SignupForm";
import { currentUser } from "@/lib/server/auth";
import { mailLinksReady } from "@/lib/server/mailer";
import { signupOpen } from "@/lib/server/users";
import { BrandLogo } from "@/components/BrandLogo";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await currentUser()) redirect("/account");
  return (
    <main className="page narrow">
      <h1>
        <Link href="/" aria-label="SenroLab のトップへ">
          <BrandLogo height={44} />
        </Link>
      </h1>
      {signupOpen() && mailLinksReady() ? (
        <SignupForm />
      ) : (
        <section className="card">
          <h2>ユーザー登録</h2>
          <p>このサーバーではユーザー登録を受け付けていません。アカウントは管理者に依頼してください。</p>
          <p className="hint">
            <Link href="/login">ログイン</Link> ／ <a href="/editor">ログインせずに使う</a>
          </p>
        </section>
      )}
    </main>
  );
}
