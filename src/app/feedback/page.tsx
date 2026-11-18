import Link from "next/link";
import { redirect } from "next/navigation";
import { FeedbackForm } from "@/components/FeedbackForm";
import { UserMenu } from "@/components/UserMenu";
import { BrandLogo } from "@/components/BrandLogo";
import { currentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function FeedbackPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/feedback");
  return (
    <div className="page-wrap">
      <header className="header">
        <h1>
          <Link href="/" aria-label="SenroLab のトップへ">
            <BrandLogo />
          </Link> 
          / 改善リクエスト
        </h1>
        <UserMenu user={user} />
      </header>
      <main className="page feedback-page">
        <FeedbackForm />
      </main>
    </div>
  );
}
