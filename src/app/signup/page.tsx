import Link from "next/link";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/SignupForm";
import { currentUser } from "@/lib/server/auth";
import { canSendMail } from "@/lib/server/mailer";
import { signupOpen } from "@/lib/server/users";
import { BrandLogo } from "@/components/BrandLogo";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await currentUser()) redirect("/");
  return (
    <main className="page narrow">
      <h1>
        <BrandLogo height={44} />
      </h1>
      {signupOpen() && canSendMail() && (process.env.NODE_ENV !== "production" || !!process.env.NINEGAGE_PUBLIC_URL) ? (
        <SignupForm />
      ) : (
        <section className="card">
          <h2>ユーザー登録</h2>
          <p>このサーバーではユーザー登録を受け付けていません。アカウントは管理者に依頼してください。</p>
          <p className="hint">
            <Link href="/login">ログイン</Link> ／ <Link href="/">ログインせずに使う</Link>
          </p>
        </section>
      )}
    </main>
  );
}
