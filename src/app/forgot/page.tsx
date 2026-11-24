import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { ForgotForm } from "@/components/ForgotForm";
import { mailLinksReady } from "@/lib/server/mailer";

export const dynamic = "force-dynamic";

export default function ForgotPage() {
  return (
    <main className="page narrow">
      <h1>
        <Link href="/" aria-label="SenroLab のトップへ">
          <BrandLogo height={44} />
        </Link>
      </h1>
      {mailLinksReady() ? (
        <ForgotForm />
      ) : (
        <section className="card">
          <h2>パスワードの再設定</h2>
          <p>このサーバーはメールを送れないため、パスワードの再設定は管理者に依頼してください。</p>
          <p className="hint">
            <Link href="/login">ログインへ戻る</Link>
          </p>
        </section>
      )}
    </main>
  );
}
