import Link from "next/link";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/SignupForm";
import { currentUser } from "@/lib/server/auth";
import { signupOpen } from "@/lib/server/users";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await currentUser()) redirect("/");
  return (
    <main className="page narrow">
      <h1>Nine-Gage レイアウトプランナー</h1>
      {signupOpen() ? (
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
